/**
 * Scalp risk engine — circuit breakers and per-trade entry gates.
 *
 * Completely independent of the leader-retest / alt-auto risk logic.
 * Instantiate one engine per active scalp session via createScalpRiskEngine().
 * All state is internal to the closure (no React state).
 */

import type { ScalpCandidate } from './types';
import type { ScalpSettings } from './scalpSettings';
import type { ScalpMarketSnapshot } from '../lib/binanceScalpMarketData';

// ── Public types ──────────────────────────────────────────────────────────────

export interface EntryCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface ScalpRiskEngine {
  /** Pre-entry gate — returns allowed=true if all checks pass. */
  checkEntry(candidate: ScalpCandidate, snapshot: ScalpMarketSnapshot, settings: ScalpSettings): EntryCheckResult;
  /** Call after a trade entry is confirmed. Applies short entry-cooldown. */
  recordEntry(symbol: string): void;
  /**
   * Call after a trade is fully exited.
   * pnl > 0 = profit, < 0 = loss.
   * cooldownMs is taken from current settings.symbolCooldownMs.
   */
  recordExit(symbol: string, pnl: number, cooldownMs: number): void;
  /** Trip the consecutive-loss breaker manually (e.g. after N losses). */
  tripBreaker(reason: string): void;
  /** Current session trade count. */
  sessionTradeCount(): number;
  /** Current consecutive loss count. */
  consecutiveLosses(): number;
  /** True if the circuit breaker has tripped. */
  isBreakerOpen(): boolean;
  /** Reset consecutive loss counter and re-arm the breaker. */
  resetBreaker(): void;
  /** Current open notional exposure in USD. */
  openExposureUsd(): number;
  /** Update open exposure (call from execution engine on fill/close). */
  updateExposure(deltaUsd: number): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createScalpRiskEngine(): ScalpRiskEngine {
  let _consecutiveLosses = 0;
  let _sessionTrades     = 0;
  let _breakerOpen       = false;
  let _exposureUsd       = 0;
  const _cooldownUntil   = new Map<string, number>();

  function checkEntry(
    candidate: ScalpCandidate,
    snapshot: ScalpMarketSnapshot,
    settings: ScalpSettings,
  ): EntryCheckResult {
    // 1. Circuit breaker
    if (_breakerOpen) {
      return { allowed: false, reason: `연속 손절 차단기 동작 중 (${_consecutiveLosses}회 연속 손실)` };
    }

    // 2. Daily trade limit
    if (_sessionTrades >= settings.maxDailyTrades) {
      return { allowed: false, reason: `일일 최대 거래 수(${settings.maxDailyTrades}) 도달` };
    }

    // 3. Open exposure cap
    if (_exposureUsd >= settings.maxOpenExposureUsd) {
      return { allowed: false, reason: `최대 노출 한도 $${settings.maxOpenExposureUsd} 초과` };
    }

    // 4. Symbol cooldown
    const cooldownUntil = _cooldownUntil.get(candidate.symbol) ?? 0;
    if (Date.now() < cooldownUntil) {
      const remainSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
      return { allowed: false, reason: `${candidate.symbol} 쿨다운 중 (${remainSec}s 남음)` };
    }

    // 5. Spread gate
    if (snapshot.spreadBps > settings.maxSpreadBps) {
      return { allowed: false, reason: `스프레드 ${snapshot.spreadBps.toFixed(1)} bps > 최대 ${settings.maxSpreadBps} bps` };
    }

    // 6. Depth gate
    if (settings.minDepthUsd > 0 && snapshot.depth10bpsUsd < settings.minDepthUsd) {
      return { allowed: false, reason: `뎁스 $${snapshot.depth10bpsUsd.toFixed(0)} < 최소 $${settings.minDepthUsd}` };
    }

    // 7. Stale data gate
    if (snapshot.staleness > settings.maxLatencyMs) {
      return { allowed: false, reason: `시장 데이터 지연 ${snapshot.staleness} ms > 최대 ${settings.maxLatencyMs} ms` };
    }

    // 8. Minimum signal score
    if (candidate.score < 0.25) {
      return { allowed: false, reason: `신호 강도 ${(candidate.score * 100).toFixed(0)} < 25 (미달)` };
    }

    return { allowed: true };
  }

  function recordEntry(symbol: string): void {
    _sessionTrades++;
    // Short cooldown on entry to prevent rapid re-entry before exit is processed
    _cooldownUntil.set(symbol, Date.now() + 5_000);
  }

  function recordExit(symbol: string, pnl: number, cooldownMs: number): void {
    _cooldownUntil.set(symbol, Date.now() + cooldownMs);
    if (pnl < 0) {
      _consecutiveLosses++;
    } else {
      _consecutiveLosses = 0; // reset streak on any profitable exit
    }
  }

  function tripBreaker(reason: string): void {
    _breakerOpen = true;
    console.warn(`[ScalpRisk] breaker tripped: ${reason}`);
  }

  return {
    checkEntry,
    recordEntry,
    recordExit,
    tripBreaker,
    sessionTradeCount: () => _sessionTrades,
    consecutiveLosses: () => _consecutiveLosses,
    isBreakerOpen: () => _breakerOpen,
    resetBreaker: () => { _breakerOpen = false; _consecutiveLosses = 0; },
    openExposureUsd: () => _exposureUsd,
    updateExposure: (deltaUsd: number) => { _exposureUsd = Math.max(0, _exposureUsd + deltaUsd); },
  };
}
