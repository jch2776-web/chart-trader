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

// ── Paper broker (simulates fills for testing) ────────────────────────────────

function createPaperBroker(): ScalpBrokerCallbacks {
  let orderSeq = 0;
  return {
    placeLimitOrder: (params) =>
      Promise.resolve(`PAPER_${++orderSeq}_${params.symbol}_${params.side}`),
    placeStopMarketOrder: (params) =>
      Promise.resolve(`PAPER_STOP_${++orderSeq}_${params.symbol}_${params.orderType}`),
    cancelOrder: () => Promise.resolve(),
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
  const riskRef  = useRef(createScalpRiskEngine());
  const telemRef = useRef(createScalpTelemetry());
  const execRef  = useRef<ReturnType<typeof createScalpExecutionEngine> | null>(null);

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
      const activeBroker: ScalpBrokerCallbacks =
        mode === 'live' && brokerRef.current
          ? brokerRef.current
          : createPaperBroker();

      execRef.current = createScalpExecutionEngine(
        activeBroker,
        telemRef.current,
        riskRef.current,
        (msg, level) => addLog(msg, level),
        getScalpSnapshot,
      );
      addLog(`⚡ 스캘핑 시작 — ${mode === 'live' ? '실전' : '페이퍼'} | ${settings.symbols.length}개 심볼`, 'success');
    } else {
      execRef.current?.cancelAll();
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

  // ── Tick: order timeout / reprice / UI refresh ───────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      execRef.current?.tick();
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
