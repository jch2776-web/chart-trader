/**
 * Scalp signal engine — microstructure-based entry signal generation.
 *
 * Two signal types:
 *   micro-momentum — bid/ask imbalance and trade flow agree directionally.
 *                    Enter in the direction of the pressure.
 *   micro-revert   — short-term price moved significantly in one direction
 *                    while book pressure points the opposite way.
 *                    Fade the move.
 *
 * Signals have a short TTL (1–5 s) and are stale if not acted upon.
 * All inputs come from ScalpMarketSnapshot (pure function — no side effects).
 */

import type { ScalpCandidate } from './types';
import type { ScalpMarketSnapshot } from '../lib/binanceScalpMarketData';
import type { ScalpSettings } from './scalpSettings';

let candidateSeq = 0;
function genId(): string {
  return `sc_${Date.now().toString(36)}_${(++candidateSeq).toString(36)}`;
}

// ── Signal parameters ─────────────────────────────────────────────────────────

/** Fraction of spread used to offset entry from mid. */
const ENTRY_MID_OFFSET = 0.3; // enter 30% of half-spread inside mid
/** Stop distance as a fraction of spread. */
const STOP_SPREAD_MULT = 3.0;
/** TP distance as a multiple of stop distance. */
const TP_RR            = 1.5;
/** TTL for momentum signals (ms). */
const MOMENTUM_TTL_MS  = 3_000;
/** TTL for revert signals (ms). */
const REVERT_TTL_MS    = 2_000;
/** Trade pressure threshold for revert signal (extreme reading). */
const REVERT_PRESSURE_THRESHOLD = 0.55;

// ── Score helpers ─────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Normalise an imbalance value [0, 1] → signal strength [0, 1]. */
function scoreImbalance(imb: number): number {
  // imb is absolute value [0, 1]; anything above 0.15 starts contributing
  return clamp01((Math.abs(imb) - 0.10) / 0.40);
}

/** Normalise trade pressure [0, 1] → signal strength. */
function scorePressure(p: number): number {
  return clamp01((Math.abs(p) - 0.10) / 0.50);
}

// ── Micro-momentum signal ─────────────────────────────────────────────────────

/**
 * Fires when both bookImbalance and tradePressure agree on direction and
 * both exceed their minimum thresholds.
 * Direction is determined by the sign of tradePressure (buy > sell = long).
 */
function evalMicroMomentum(
  snap: ScalpMarketSnapshot,
  settings: ScalpSettings,
): ScalpCandidate | null {
  const { bookImbalance, tradePressure, spreadBps, bid, ask, microMid, symbol, depth10bpsUsd } = snap;

  if (spreadBps > settings.maxSpreadBps) return null;
  if (Math.abs(bookImbalance) < settings.minImbalance) return null;
  if (Math.abs(tradePressure) < settings.minTradePressure) return null;
  // Signals must agree in direction
  if (Math.sign(bookImbalance) !== Math.sign(tradePressure)) return null;

  const side: 'long' | 'short' = tradePressure > 0 ? 'long' : 'short';

  const halfSpread = (ask - bid) / 2;
  const entryRef   = side === 'long'
    ? microMid - halfSpread * ENTRY_MID_OFFSET  // slightly below mid for maker fill
    : microMid + halfSpread * ENTRY_MID_OFFSET;
  const stopDist   = halfSpread * STOP_SPREAD_MULT;
  const stopRef    = side === 'long' ? entryRef - stopDist : entryRef + stopDist;
  const tpRef      = side === 'long' ? entryRef + stopDist * TP_RR : entryRef - stopDist * TP_RR;

  const score = clamp01(
    scoreImbalance(bookImbalance) * 0.45 +
    scorePressure(tradePressure)  * 0.45 +
    (spreadBps <= 1.5 ? 0.10 : spreadBps <= 2.5 ? 0.05 : 0),
  );

  return {
    id: genId(),
    symbol,
    side,
    score,
    signalType: 'micro-momentum',
    entryRef,
    stopRef,
    tpRef,
    ttlMs: MOMENTUM_TTL_MS,
    meta: {
      spreadBps,
      imbalance: bookImbalance,
      tradePressure,
      depth10bpsUsd: depth10bpsUsd > 0 ? depth10bpsUsd : undefined,
      signalTs: snap.updatedAt,
    },
  };
}

// ── Micro-revert signal ───────────────────────────────────────────────────────

/**
 * Fires when trade flow has been extreme in one direction but the current
 * top-of-book imbalance has flipped (mean-reversion setup).
 * Fade the trade-flow direction.
 */
function evalMicroRevert(
  snap: ScalpMarketSnapshot,
  settings: ScalpSettings,
): ScalpCandidate | null {
  const { bookImbalance, tradePressure, spreadBps, bid, ask, microMid, symbol, depth10bpsUsd } = snap;

  if (spreadBps > settings.maxSpreadBps) return null;
  // Trade pressure must be extreme
  if (Math.abs(tradePressure) < REVERT_PRESSURE_THRESHOLD) return null;
  // Book imbalance must oppose trade pressure (fading signal)
  if (Math.sign(bookImbalance) === Math.sign(tradePressure)) return null;
  // Book imbalance must be at least weakly opposing
  if (Math.abs(bookImbalance) < 0.10) return null;

  // Fade the trade pressure: if buy pressure is extreme, go short
  const side: 'long' | 'short' = tradePressure > 0 ? 'short' : 'long';

  const halfSpread = (ask - bid) / 2;
  const entryRef   = side === 'long'
    ? microMid - halfSpread * ENTRY_MID_OFFSET
    : microMid + halfSpread * ENTRY_MID_OFFSET;
  const stopDist = halfSpread * STOP_SPREAD_MULT;
  const stopRef  = side === 'long' ? entryRef - stopDist : entryRef + stopDist;
  const tpRef    = side === 'long' ? entryRef + stopDist * TP_RR : entryRef - stopDist * TP_RR;

  const score = clamp01(
    scorePressure(tradePressure)  * 0.50 +
    scoreImbalance(bookImbalance) * 0.40 +
    (spreadBps <= 1.5 ? 0.10 : 0),
  );

  return {
    id: genId(),
    symbol,
    side,
    score,
    signalType: 'micro-revert',
    entryRef,
    stopRef,
    tpRef,
    ttlMs: REVERT_TTL_MS,
    meta: {
      spreadBps,
      imbalance: bookImbalance,
      tradePressure,
      depth10bpsUsd: depth10bpsUsd > 0 ? depth10bpsUsd : undefined,
      signalTs: snap.updatedAt,
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluates the current market snapshot and returns a ScalpCandidate if any
 * signal fires, or `null` if no signal qualifies.
 * Pure function — safe to call from any context.
 */
export function evaluateSignals(
  snap: ScalpMarketSnapshot,
  settings: ScalpSettings,
): ScalpCandidate | null {
  const { signalMode } = settings;
  if (signalMode === 'momentum' || signalMode === 'both') {
    const c = evalMicroMomentum(snap, settings);
    if (c) return c;
  }
  if (signalMode === 'revert' || signalMode === 'both') {
    const c = evalMicroRevert(snap, settings);
    if (c) return c;
  }
  return null;
}
