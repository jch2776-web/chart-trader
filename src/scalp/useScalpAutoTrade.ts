/**
 * useScalpAutoTrade — main React hook for the scalp auto-trade module.
 *
 * Lifecycle:
 *   isActive=false → all streams closed, engines idle
 *   isActive=true  → market data subscribed, signal/risk/exec engines running
 *
 * Hot path (WebSocket callback → signal → risk → exec) never touches React state.
 * React state is updated only for UI: logs, active orders list, telemetry summary.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeScalp, unsubscribeScalp, getScalpSnapshot } from '../lib/binanceScalpMarketData';
import type { ScalpMarketSnapshot } from '../lib/binanceScalpMarketData';
import { connectScalpUserStream } from '../lib/binanceUserStreamScalp';
import type { ScalpUserStreamConfig } from '../lib/binanceUserStreamScalp';
import { evaluateSignals } from './scalpSignalEngine';
import { createScalpRiskEngine } from './scalpRiskEngine';
import { createScalpExecutionEngine } from './scalpExecutionEngine';
import { createScalpTelemetry } from './scalpTelemetry';
import type {
  ScalpLog,
  ScalpActiveOrder,
  ScalpTelemetryEvent,
  ScalpBrokerCallbacks,
  ScalpOrderUpdate,
} from './types';
import type { ScalpSettings } from './scalpSettings';

let logSeq = 0;

// ── Hook interface ────────────────────────────────────────────────────────────

export interface UseScalpAutoTradeProps {
  settings: ScalpSettings;
  mode: 'live' | 'paper';
  /** Called with every log entry (routable to the shared activity panel). */
  onLog?: (msg: string, level: ScalpLog['level']) => void;
  /** Required for live mode. Omit or pass undefined for paper mode. */
  broker?: ScalpBrokerCallbacks;
  /** Required for live user stream. Omit to skip user stream (paper/polling). */
  userStream?: Omit<ScalpUserStreamConfig, 'handlers'>;
}

export interface UseScalpAutoTradeResult {
  isActive: boolean;
  setActive: (active: boolean) => void;
  logs: ScalpLog[];
  activeOrders: ScalpActiveOrder[];
  recentTelemetry: ScalpTelemetryEvent[];
  /** Session stats: fills, losses, breaker state */
  stats: {
    sessionTrades: number;
    consecutiveLosses: number;
    breakerOpen: boolean;
    exposureUsd: number;
  };
  /** True when the live user-data WebSocket is connected. Always false in paper mode. */
  userStreamConnected: boolean;
  resetBreaker: () => void;
  clearLogs: () => void;
}

// ── Paper broker (simulates fills and stop/tp triggers) ───────────────────────

interface PaperPendingOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  /** 'limit' fills after one tick; 'stop_market'/'take_profit_market' triggers on price cross */
  kind: 'limit' | 'stop_market' | 'take_profit_market';
  reduceOnly: boolean;
  ticksRemaining: number; // for limit: 1 (fill after one tick)
  canceled: boolean;
}

interface ScalpPaperBroker extends ScalpBrokerCallbacks {
  tickPaper(
    getSnapshot: (symbol: string) => ScalpMarketSnapshot | null,
    onUpdate: (upd: ScalpOrderUpdate) => void,
  ): void;
}

function createPaperBroker(onLog: (msg: string, level: 'info' | 'warn' | 'error') => void): ScalpPaperBroker {
  let orderSeq = 0;
  const pending = new Map<string, PaperPendingOrder>();

  function makeFillUpdate(o: PaperPendingOrder): ScalpOrderUpdate {
    return {
      orderId: o.orderId,
      symbol: o.symbol,
      status: 'FILLED',
      executedQty: o.quantity,
      avgPrice: o.price,
      lastFilledQty: o.quantity,
      lastFilledPrice: o.price,
      reduceOnly: o.reduceOnly,
      ts: Date.now(),
    };
  }

  return {
    placeLimitOrder: (params) => {
      const id = `PAPER_LMT_${++orderSeq}_${params.symbol}_${params.side}`;
      pending.set(id, {
        orderId: id,
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        price: params.price,
        kind: 'limit',
        reduceOnly: params.reduceOnly,
        ticksRemaining: 1,
        canceled: false,
      });
      onLog(`[PAPER] LIMIT ${params.side} ${params.quantity} ${params.symbol} @ ${params.price.toFixed(4)} 접수`, 'info');
      return Promise.resolve(id);
    },

    placeStopMarketOrder: (params) => {
      const kind = params.orderType === 'TAKE_PROFIT_MARKET' ? 'take_profit_market' : 'stop_market';
      const id = `PAPER_${kind.toUpperCase()}_${++orderSeq}_${params.symbol}`;
      pending.set(id, {
        orderId: id,
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        price: params.stopPrice,
        kind,
        reduceOnly: params.reduceOnly,
        ticksRemaining: 0,
        canceled: false,
      });
      onLog(`[PAPER] ${params.orderType} ${params.side} ${params.quantity} ${params.symbol} stopPrice=${params.stopPrice.toFixed(4)} 접수`, 'info');
      return Promise.resolve(id);
    },

    cancelOrder: (orderId) => {
      const o = pending.get(orderId);
      if (o) {
        o.canceled = true;
        pending.delete(orderId);
        onLog(`[PAPER] 주문 취소: ${orderId}`, 'info');
      }
      return Promise.resolve();
    },

    tickPaper: (getSnapshot, onUpdate) => {
      for (const [id, o] of pending) {
        if (o.canceled) { pending.delete(id); continue; }

        if (o.kind === 'limit') {
          o.ticksRemaining--;
          if (o.ticksRemaining <= 0) {
            // Simulate fill at submitted price
            pending.delete(id);
            onLog(`[PAPER] LIMIT ${o.side} 체결 — ${o.symbol} @ ${o.price.toFixed(4)}`, 'info');
            onUpdate(makeFillUpdate(o));
          }
          continue;
        }

        // stop_market / take_profit_market — check price trigger
        const snap = getSnapshot(o.symbol);
        if (!snap) continue;
        const mid = (snap.bid + snap.ask) / 2;

        let triggered = false;
        if (o.kind === 'stop_market') {
          // SL sell (long position): trigger when price drops to/below stopPrice
          // SL buy  (short position): trigger when price rises to/above stopPrice
          triggered = o.side === 'SELL' ? mid <= o.price : mid >= o.price;
        } else {
          // take_profit_market sell (long position): trigger when price rises to/above stopPrice
          // take_profit_market buy  (short position): trigger when price drops to/below stopPrice
          triggered = o.side === 'SELL' ? mid >= o.price : mid <= o.price;
        }

        if (triggered) {
          pending.delete(id);
          const fillPrice = mid;
          onLog(`[PAPER] ${o.kind.toUpperCase()} ${o.side} 트리거 — ${o.symbol} @ ${fillPrice.toFixed(4)}`, 'warn');
          onUpdate({ ...makeFillUpdate(o), avgPrice: fillPrice, lastFilledPrice: fillPrice });
        }
      }
    },
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useScalpAutoTrade({
  settings,
  mode,
  onLog,
  broker,
  userStream,
}: UseScalpAutoTradeProps): UseScalpAutoTradeResult {

  const [isActive, setIsActiveState] = useState(false);
  const [logs, setLogs]              = useState<ScalpLog[]>([]);
  const [activeOrders, setActiveOrders] = useState<ScalpActiveOrder[]>([]);
  const [recentTelemetry, setRecentTelemetry] = useState<ScalpTelemetryEvent[]>([]);
  const [userStreamConnected, setUserStreamConnected] = useState(false);

  // ── Refs (hot path never reads React state) ─────────────────────────────
  const isActiveRef  = useRef(false);
  const settingsRef  = useRef(settings);
  settingsRef.current = settings;
  const brokerRef    = useRef(broker);
  brokerRef.current  = broker;
  const onLogRef     = useRef(onLog);
  onLogRef.current   = onLog;

  // Engine instances live in refs — recreated on session start
  const riskRef        = useRef(createScalpRiskEngine());
  const telemRef       = useRef(createScalpTelemetry());
  const execRef        = useRef<ReturnType<typeof createScalpExecutionEngine> | null>(null);
  const paperBrokerRef = useRef<ScalpPaperBroker | null>(null);

  // ── Internal log helper ─────────────────────────────────────────────────
  const addLog = useCallback((msg: string, level: ScalpLog['level'] = 'info') => {
    const entry: ScalpLog = { id: ++logSeq, ts: Date.now(), msg, level };
    setLogs(prev => [entry, ...prev].slice(0, 300));
    onLogRef.current?.(msg, level);
  }, []);

  // ── UI refresh (throttled via tick) ─────────────────────────────────────
  const refreshUi = useCallback(() => {
    const exec = execRef.current;
    if (exec) setActiveOrders(exec.getActiveOrders());
    setRecentTelemetry(telemRef.current.getRecent(30));
  }, []);

  // ── Market data callback (hot path) ─────────────────────────────────────
  const handleMarketUpdate = useCallback((snap: ScalpMarketSnapshot) => {
    if (!isActiveRef.current) return;
    const settings = settingsRef.current;
    const exec     = execRef.current;
    if (!exec) return;

    const candidate = evaluateSignals(snap, settings);
    if (!candidate) return;

    const { allowed, reason } = riskRef.current.checkEntry(candidate, snap, settings);
    if (!allowed) {
      if (reason) {
        telemRef.current.emit({ type: 'breaker_triggered', reason, symbol: snap.symbol, ts: Date.now() });
      }
      return;
    }

    // Check consecutive loss breaker (trip if needed)
    const consec = riskRef.current.consecutiveLosses();
    if (consec >= settings.consecutiveLossBreaker) {
      riskRef.current.tripBreaker(`${consec}회 연속 손실 — 자동 차단`);
      telemRef.current.emit({ type: 'breaker_triggered', reason: `${consec}회 연속 손실`, ts: Date.now() });
      return;
    }

    // Compute planned quantity
    const stopDistPct = Math.abs(candidate.entryRef - candidate.stopRef) / candidate.entryRef;
    const quantityUsd = stopDistPct > 0
      ? settings.maxPerTradeRiskUsd / stopDistPct
      : settings.maxPerTradeRiskUsd * 10; // fallback when stop is trivially close

    exec.onSignal(candidate, Math.min(quantityUsd, settings.maxOpenExposureUsd), settings);
  }, []);

  // ── Activation ───────────────────────────────────────────────────────────
  const setActive = useCallback((active: boolean) => {
    setIsActiveState(active);
    isActiveRef.current = active;

    if (active) {
      // Fresh engines per session
      riskRef.current  = createScalpRiskEngine();
      telemRef.current = createScalpTelemetry();

      let activeBroker: ScalpBrokerCallbacks;
      if (mode === 'live' && brokerRef.current) {
        activeBroker = brokerRef.current;
        paperBrokerRef.current = null;
      } else {
        const pb = createPaperBroker((msg, level) => addLog(msg, level));
        paperBrokerRef.current = pb;
        activeBroker = pb;
      }

      execRef.current = createScalpExecutionEngine(
        activeBroker,
        telemRef.current,
        riskRef.current,
        (msg, level) => addLog(msg, level),
        getScalpSnapshot,
        () => settingsRef.current,
      );
      addLog(`⚡ 스캘핑 시작 — ${mode === 'live' ? '실전' : '페이퍼'} | ${settings.symbols.length}개 심볼`, 'success');
    } else {
      execRef.current?.cancelAll();
      paperBrokerRef.current = null;
      setUserStreamConnected(false);
      addLog('⏹ 스캘핑 중단 — 미체결 주문 취소', 'warn');
    }
  }, [mode, settings.symbols.length, addLog]);

  // ── Market data subscriptions ────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const symbols = settingsRef.current.symbols;
    for (const sym of symbols) subscribeScalp(sym, handleMarketUpdate);
    return () => {
      for (const sym of symbols) unsubscribeScalp(sym, handleMarketUpdate);
    };
  }, [isActive, settings.symbols, handleMarketUpdate]);

  // ── User stream ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive || !userStream || mode !== 'live') return;
    const stop = connectScalpUserStream({
      ...userStream,
      handlers: {
        onOrderUpdate: (upd) => execRef.current?.onOrderUpdate(upd),
        onConnect:     () => { setUserStreamConnected(true);  addLog('✅ 유저 스트림 연결됨', 'success'); },
        onReconnect:   () => { setUserStreamConnected(false); addLog('↺ 유저 스트림 재연결 중…', 'warn'); },
        onError:       (msg) => addLog(`유저 스트림 오류: ${msg}`, 'error'),
      },
    });
    return () => { setUserStreamConnected(false); stop(); };
  }, [isActive, mode, userStream, addLog]);

  // ── Tick: order timeout / reprice / UI refresh / paper simulation ────────
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      execRef.current?.tick();
      // Paper mode: simulate stop/tp triggers
      paperBrokerRef.current?.tickPaper(
        getScalpSnapshot,
        (upd) => execRef.current?.onOrderUpdate(upd),
      );
      refreshUi();
    }, 200);
    return () => clearInterval(timer);
  }, [isActive, refreshUi]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const stats = {
    sessionTrades:     riskRef.current.sessionTradeCount(),
    consecutiveLosses: riskRef.current.consecutiveLosses(),
    breakerOpen:       riskRef.current.isBreakerOpen(),
    exposureUsd:       riskRef.current.openExposureUsd(),
  };

  return {
    isActive,
    setActive,
    logs,
    activeOrders,
    recentTelemetry,
    stats,
    userStreamConnected,
    resetBreaker: () => { riskRef.current.resetBreaker(); addLog('✅ 차단기 수동 해제', 'success'); },
    clearLogs: () => setLogs([]),
  };
}
