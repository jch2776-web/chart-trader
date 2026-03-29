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
import { governedBinanceFetch } from '../lib/binanceRequestGovernor';
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
const MIN_LIVE_NOTIONAL_USDT = 5;
const MIN_LIVE_NOTIONAL_BUFFER_USDT = 5.25;
const MIN_NOTIONAL_WARN_COOLDOWN_MS = 60_000;
const STREAM_STATUS_LOG_COOLDOWN_MS = 30_000;
const STREAM_ERROR_LOG_COOLDOWN_MS = 15_000;
const BINANCE_FAPI_BASE = 'https://fapi.binance.com';
const symbolMinNotionalCache = new Map<string, number>();
const symbolMinNotionalFetchInFlight = new Map<string, Promise<number>>();

async function fetchSymbolMinNotionalUsd(symbol: string): Promise<number> {
  const cached = symbolMinNotionalCache.get(symbol);
  if (cached != null && Number.isFinite(cached) && cached > 0) return cached;
  const inFlight = symbolMinNotionalFetchInFlight.get(symbol);
  if (inFlight) return inFlight;

  const task = (async () => {
    try {
      const res = await governedBinanceFetch(
        `${BINANCE_FAPI_BASE}/fapi/v1/exchangeInfo?symbol=${symbol}`,
        undefined,
        { weight: 1, scope: 'public', label: `GET:/fapi/v1/exchangeInfo:${symbol}` },
      );
      if (!res.ok) throw new Error(`exchangeInfo ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sym = (data.symbols as any[] | undefined)?.find((s: any) => s?.symbol === symbol);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filter = (sym?.filters as any[] | undefined)?.find((f: any) => f?.filterType === 'MIN_NOTIONAL' || f?.filterType === 'NOTIONAL');
      const minRaw = Number(filter?.notional ?? filter?.minNotional ?? 0);
      const minNotional = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : MIN_LIVE_NOTIONAL_USDT;
      symbolMinNotionalCache.set(symbol, minNotional);
      return minNotional;
    } catch {
      symbolMinNotionalCache.set(symbol, MIN_LIVE_NOTIONAL_USDT);
      return MIN_LIVE_NOTIONAL_USDT;
    } finally {
      symbolMinNotionalFetchInFlight.delete(symbol);
    }
  })();

  symbolMinNotionalFetchInFlight.set(symbol, task);
  return task;
}

// ── Hook interface ────────────────────────────────────────────────────────────

export interface UseScalpAutoTradeProps {
  settings: ScalpSettings;
  mode: 'live' | 'paper';
  /** Available margin/balance in USDT. Used to cap per-entry notional sizing. */
  availableMarginUsdt?: number | null;
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
  /**
   * Timestamp of the last market data tick received while active.
   * null = no data received yet this session.
   * Updated every 200 ms via the UI refresh tick.
   */
  lastMarketTickAt: number | null;
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
  availableMarginUsdt,
  onLog,
  broker,
  userStream,
}: UseScalpAutoTradeProps): UseScalpAutoTradeResult {

  const [isActive, setIsActiveState] = useState(false);
  const [logs, setLogs]              = useState<ScalpLog[]>([]);
  const [activeOrders, setActiveOrders] = useState<ScalpActiveOrder[]>([]);
  const [recentTelemetry, setRecentTelemetry] = useState<ScalpTelemetryEvent[]>([]);
  const [userStreamConnected, setUserStreamConnected] = useState(false);
  const [lastMarketTickAt, setLastMarketTickAt] = useState<number | null>(null);
  const lastMarketTickAtRef = useRef<number | null>(null);

  // ── Refs (hot path never reads React state) ─────────────────────────────
  const isActiveRef  = useRef(false);
  const settingsRef  = useRef(settings);
  settingsRef.current = settings;
  const brokerRef    = useRef(broker);
  brokerRef.current  = broker;
  const onLogRef     = useRef(onLog);
  onLogRef.current   = onLog;
  const availableMarginRef = useRef<number | null | undefined>(availableMarginUsdt);
  availableMarginRef.current = availableMarginUsdt;
  const symbolMinNotionalRef = useRef<Record<string, number>>({});
  const liveNotionalWarnUntilRef = useRef<Record<string, number>>({});
  const minNotionalLookupWarnUntilRef = useRef<Record<string, number>>({});
  const minNotionalWarnSymbolsRef = useRef<Map<string, number>>(new Map());
  const minNotionalWarnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamLogCooldownRef = useRef<{ connect: number; reconnect: number; error: number }>({
    connect: 0,
    reconnect: 0,
    error: 0,
  });
  const streamStateRef = useRef<'unknown' | 'connected' | 'disconnected'>('unknown');

  // Engine instances live in refs — recreated on session start
  const riskRef        = useRef(createScalpRiskEngine());
  const telemRef       = useRef(createScalpTelemetry());
  const execRef        = useRef<ReturnType<typeof createScalpExecutionEngine> | null>(null);
  const paperBrokerRef = useRef<ScalpPaperBroker | null>(null);

  // ── Internal log helper ─────────────────────────────────────────────────
  const addLog = useCallback((msg: string, level: ScalpLog['level'] = 'info') => {
    const now = Date.now();
    const minNotionalMatch = msg.match(/\[-4164\].*no smaller than\s+([0-9]+(?:\.[0-9]+)?)/i);
    if (minNotionalMatch) {
      const symMatch = msg.match(/\[([A-Z0-9]+USDT)\]/);
      const parsed = Number(minNotionalMatch[1]);
      if (symMatch && Number.isFinite(parsed) && parsed > 0) {
        const symbol = symMatch[1];
        symbolMinNotionalRef.current[symbol] = Math.max(symbolMinNotionalRef.current[symbol] ?? MIN_LIVE_NOTIONAL_USDT, parsed);
        symbolMinNotionalCache.set(symbol, symbolMinNotionalRef.current[symbol]);
      }
    }
    const entry: ScalpLog = { id: ++logSeq, ts: now, msg, level };
    setLogs(prev => {
      const head = prev[0];
      if (head && head.level === level && head.msg === msg && now - head.ts <= 5000) {
        return prev;
      }
      return [entry, ...prev].slice(0, 300);
    });
    onLogRef.current?.(msg, level);
  }, []);
  const queueMinNotionalWarn = useCallback((symbol: string, requiredNotional: number, available: number | null | undefined, leverage: number) => {
    const cur = minNotionalWarnSymbolsRef.current.get(symbol) ?? 0;
    minNotionalWarnSymbolsRef.current.set(symbol, Math.max(cur, requiredNotional));
    if (minNotionalWarnTimerRef.current != null) return;
    minNotionalWarnTimerRef.current = setTimeout(() => {
      minNotionalWarnTimerRef.current = null;
      const pairs = Array.from(minNotionalWarnSymbolsRef.current.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([sym, req]) => `${sym}(${req.toFixed(2)})`);
      minNotionalWarnSymbolsRef.current.clear();
      if (pairs.length === 0) return;
      const availText = available != null && Number.isFinite(available) ? available.toFixed(2) : '-';
      addLog(
        `최소 주문금액 미달로 진입 스킵: ${pairs.join(', ')} (가용마진 ${availText} USDT, 레버리지 ${Math.max(1, leverage)}x)`,
        'warn',
      );
    }, 1200);
  }, [addLog]);

  // ── UI refresh (throttled via tick) ─────────────────────────────────────
  const refreshUi = useCallback(() => {
    const exec = execRef.current;
    if (exec) setActiveOrders(exec.getActiveOrders());
    setRecentTelemetry(telemRef.current.getRecent(30));
    setLastMarketTickAt(lastMarketTickAtRef.current);
  }, []);

  // ── Market data callback (hot path) ─────────────────────────────────────
  const handleMarketUpdate = useCallback((snap: ScalpMarketSnapshot) => {
    if (!isActiveRef.current) return;
    lastMarketTickAtRef.current = Date.now();
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
    let quantityUsd = stopDistPct > 0
      ? settings.maxPerTradeRiskUsd / stopDistPct
      : settings.maxPerTradeRiskUsd * 10; // fallback when stop is trivially close

    // Margin safety cap: prevents submitting orders above available account capacity.
    const available = availableMarginRef.current;
    let marginNotionalCap = Number.POSITIVE_INFINITY;
    if (available != null && Number.isFinite(available)) {
      if (available <= 0) return;
      marginNotionalCap = available * Math.max(1, settings.leverage) * 0.98;
      quantityUsd = Math.min(quantityUsd, marginNotionalCap);
    }
    if (quantityUsd <= 0) return;

    let finalNotional = Math.min(quantityUsd, settings.maxOpenExposureUsd);
    // Optional strict precheck: block entry before order submission when symbol min-notional is not satisfiable.
    if (mode === 'live' && settings.precheckMinNotional !== false) {
      let symbolMinNotional = symbolMinNotionalRef.current[snap.symbol];
      if (symbolMinNotional == null || !Number.isFinite(symbolMinNotional) || symbolMinNotional <= 0) {
        void fetchSymbolMinNotionalUsd(snap.symbol).then((v) => {
          symbolMinNotionalRef.current[snap.symbol] = v;
        });
        const now = Date.now();
        const warnUntil = minNotionalLookupWarnUntilRef.current[snap.symbol] ?? 0;
        if (now >= warnUntil) {
          minNotionalLookupWarnUntilRef.current[snap.symbol] = now + MIN_NOTIONAL_WARN_COOLDOWN_MS;
          addLog(`[${snap.symbol}] 최소주문금액 기준 조회 중 — 완료 전까지 진입 대기`, 'info');
        }
        return;
      }
      symbolMinNotional = Math.max(MIN_LIVE_NOTIONAL_USDT, symbolMinNotional);
      const targetMinNotional = Math.max(symbolMinNotional, MIN_LIVE_NOTIONAL_BUFFER_USDT);
      const canRaiseToMin = settings.maxOpenExposureUsd >= targetMinNotional && marginNotionalCap >= targetMinNotional;
      if (canRaiseToMin) {
        finalNotional = targetMinNotional;
      } else {
        const now = Date.now();
        const warnUntil = liveNotionalWarnUntilRef.current[snap.symbol] ?? 0;
        if (now >= warnUntil) {
          liveNotionalWarnUntilRef.current[snap.symbol] = now + MIN_NOTIONAL_WARN_COOLDOWN_MS;
          queueMinNotionalWarn(snap.symbol, symbolMinNotional, available, settings.leverage);
        }
        return;
      }
    }
    if (finalNotional <= 0) return;
    exec.onSignal(candidate, finalNotional, settings);
  }, [mode, addLog, queueMinNotionalWarn]);

  // ── Activation ───────────────────────────────────────────────────────────
  const setActive = useCallback((active: boolean) => {
    if (isActiveRef.current === active) return;
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
      streamLogCooldownRef.current = { connect: 0, reconnect: 0, error: 0 };
      streamStateRef.current = 'unknown';
      minNotionalLookupWarnUntilRef.current = {};
      if (minNotionalWarnTimerRef.current != null) {
        clearTimeout(minNotionalWarnTimerRef.current);
        minNotionalWarnTimerRef.current = null;
      }
      minNotionalWarnSymbolsRef.current.clear();
      lastMarketTickAtRef.current = null;
      setLastMarketTickAt(null);
      addLog('⏹ 스캘핑 중단 — 미체결 주문 취소', 'warn');
    }
  }, [mode, settings.symbols.length, addLog]);

  // Prefetch per-symbol min notional (exchange info) once per session/symbol set.
  useEffect(() => {
    if (!isActive || mode !== 'live') return;
    let aborted = false;
    for (const sym of settings.symbols) {
      if (symbolMinNotionalRef.current[sym] != null) continue;
      void fetchSymbolMinNotionalUsd(sym).then((minNotional) => {
        if (aborted) return;
        symbolMinNotionalRef.current[sym] = minNotional;
      });
    }
    return () => { aborted = true; };
  }, [isActive, mode, settings.symbols]);

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
        onConnect:     () => {
          const now = Date.now();
          setUserStreamConnected(true);
          if (streamStateRef.current !== 'connected' || now - streamLogCooldownRef.current.connect >= STREAM_STATUS_LOG_COOLDOWN_MS) {
            streamLogCooldownRef.current.connect = now;
            addLog('✅ 유저 스트림 연결됨', 'success');
          }
          streamStateRef.current = 'connected';
        },
        onReconnect:   () => {
          const now = Date.now();
          setUserStreamConnected(false);
          if (streamStateRef.current !== 'disconnected' || now - streamLogCooldownRef.current.reconnect >= STREAM_STATUS_LOG_COOLDOWN_MS) {
            streamLogCooldownRef.current.reconnect = now;
            addLog('↺ 유저 스트림 재연결 중…', 'warn');
          }
          streamStateRef.current = 'disconnected';
        },
        onError:       (msg) => {
          const now = Date.now();
          if (now - streamLogCooldownRef.current.error >= STREAM_ERROR_LOG_COOLDOWN_MS) {
            streamLogCooldownRef.current.error = now;
            addLog(`유저 스트림 오류: ${msg}`, 'error');
          }
        },
      },
    });
    return () => {
      setUserStreamConnected(false);
      streamLogCooldownRef.current = { connect: 0, reconnect: 0, error: 0 };
      streamStateRef.current = 'unknown';
      stop();
    };
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
    lastMarketTickAt,
    resetBreaker: () => { riskRef.current.resetBreaker(); addLog('✅ 차단기 수동 해제', 'success'); },
    clearLogs: () => setLogs([]),
  };
}
