/**
 * OrderPlan — execution blueprint for a leader-retest entry.
 *
 * Separates the entry/exit structure from the scan score so that the
 * auto-trade hook can act on it independently from the ScanCandidate metadata.
 *
 * Design goals:
 *   - No late/chasing entries  → entryZone + lateAbove gate
 *   - Wick-based stops instead of fixed-ATR    → hardStop
 *   - Fastest-available TP1 from real structure → tp1 (nearest swing / SR)
 *   - Runner holds beyond TP1 via trailing mode → runnerMode
 *   - Both time and failed-auction exits wired  → timeStopBars / failedAuctionExitLevel
 */

import type { Candle } from '../../../types/candle';
import type { LevelZone } from '../supportResistance';
import type { RetestCandidate } from './retestCandidates';
import { calcAnchoredVwapFromIndex } from './locationMetrics';

// ── Constants ─────────────────────────────────────────────────────────────────

/** ATR band around the flip level that defines the acceptable entry zone. */
const ENTRY_TOLERANCE_ATR  = 0.30;

/**
 * ATR distance from the flip level beyond which entry is considered "late".
 *   LONG  — price > level + LATE_THRESHOLD_ATR × ATR → chasing the bounce
 *   SHORT — price < level − LATE_THRESHOLD_ATR × ATR → chasing the reversal
 */
const LATE_THRESHOLD_ATR   = 0.50;

/** Cancel unfilled entry orders after this many bars. */
export const CANCEL_AFTER_BARS = 2;

/**
 * Small buffer added beyond the retest wick for the hard stop.
 * Prevents a 1-tick stop-out from normal wick noise.
 */
const STOP_WICK_BUFFER_ATR = 0.10;

/**
 * Minimum distance from the flip level to the hard stop, in ATR multiples.
 * Guards against placing the stop too close to the entry zone.
 */
const STOP_MIN_FROM_LEVEL  = 0.30;

/**
 * ATR distance beyond the flip level used for the failed-auction exit (FAEL).
 * Intentionally wider than ENTRY_TOLERANCE_ATR so a bar that closes just below
 * the entry zone does NOT immediately trigger FAEL — only a genuine re-breach
 * of the level by this margin fires the exit.
 *
 * LONG  → FAEL = level − FAEL_TOLERANCE_ATR × ATR
 * SHORT → FAEL = level + FAEL_TOLERANCE_ATR × ATR
 */
const FAEL_TOLERANCE_ATR   = 0.60;

/** Exit a position if it hasn't hit TP1 after this many bars. */
export const TIME_STOP_BARS = 8;

/** Fallback TP1 in ATR when no SR structure is found above/below entry. */
const TP_FALLBACK_ATR       = 2.0;

// ── Type ──────────────────────────────────────────────────────────────────────

export interface OrderPlan {
  // ── Entry zone ──────────────────────────────────────────────────────────
  /** Lower bound of the acceptable entry band. */
  entryZoneLow: number;
  /** Upper bound of the acceptable entry band (breakout AVWAP when available). */
  entryZoneHigh: number;
  /** Ideal fill price — the flip level itself. */
  idealEntry: number;
  /**
   * Chasing threshold.
   *   LONG  → skip entry if currentPrice > chaseThreshold (chasing the bounce).
   *   SHORT → skip entry if currentPrice < chaseThreshold (chasing the drop).
   * Always set; check `direction` to interpret correctly.
   */
  chaseThreshold: number;
  /** Cancel the limit order if not filled within this many bars. */
  cancelAfterBars: number;

  // ── Stop loss ────────────────────────────────────────────────────────────
  /**
   * Hard stop derived from the extreme wick of the retest-to-reclaim window.
   * LONG  → lowest low of that window minus STOP_WICK_BUFFER_ATR × ATR.
   * SHORT → highest high of that window plus  STOP_WICK_BUFFER_ATR × ATR.
   * Replaces the legacy fixed `level ± 1.5 ATR` stop.
   */
  hardStop: number;
  /**
   * Failed-auction exit: close back through the flip level signals the
   * breakout/retest thesis has failed.
   * LONG  → close < level − ENTRY_TOLERANCE_ATR × ATR
   * SHORT → close > level + ENTRY_TOLERANCE_ATR × ATR
   */
  failedAuctionExitLevel: number;
  /** Exit a live position if still open after this many bars from entry. */
  timeStopBars: number;

  // ── Take profit ──────────────────────────────────────────────────────────
  /**
   * TP1 — nearest opposing structure (swing high/low or key SR zone).
   * Replaces the legacy fixed 2R TP as the primary target.
   */
  tp1: number;
  /**
   * Runner trailing mode applied to the remainder after TP1:
   *   'avwap'     — trail stop to the breakout-anchored VWAP
   *   'ema9'      — trail stop to EMA-9 (short-term mean)
   *   'structure' — trail stop to the most recent swing low/high
   */
  runnerMode: 'avwap' | 'ema9' | 'structure';
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds an OrderPlan from a scored RetestCandidate.
 *
 * All levels are derived from structural inputs — the flip level, AVWAP, and
 * wick extremes of the retest-reclaim window.  Current close price is NOT
 * an input here; it is a state-determination input used by the caller to
 * classify the signal as PENDING / TRIGGERED / INVALID after the plan is built.
 *
 * @param candidate  The picked RetestCandidate (has retestIndex, reclaimIndex, etc.)
 * @param candles    Closed candles used during the scan (same array as candidate was built from)
 * @param srLevels   SR levels for locating the nearest structural TP1 target
 */
export function buildLeaderRetestOrderPlan(
  candidate: RetestCandidate,
  candles: Candle[],
  srLevels: LevelZone[],
): OrderPlan {
  const { level, direction, retestIndex, reclaimIndex, breakoutIndex, atr } = candidate;
  const isLong = direction === 'long';

  // Breakout-anchored VWAP — defines the "should-be-above-this" line for longs
  const avwap = calcAnchoredVwapFromIndex(candles, breakoutIndex);

  // Slice of candles from retest touch through reclaim — used for wick extremes
  const safeRetestIdx  = Math.max(0, Math.min(retestIndex,  candles.length - 1));
  const safeReclaimIdx = Math.max(0, Math.min(reclaimIndex, candles.length - 1));
  const retestSlice    = candles.slice(safeRetestIdx, safeReclaimIdx + 1);

  if (isLong) {
    // ── Entry zone ────────────────────────────────────────────────────────
    // Lower edge: tolerance band below the flip level (wick acceptance)
    const entryZoneLow  = level - atr * ENTRY_TOLERANCE_ATR;
    // Upper edge: breakout AVWAP (if meaningfully above level), else tolerance band above
    const entryZoneHigh = avwap > level + atr * 0.10
      ? Math.min(avwap, level + atr * LATE_THRESHOLD_ATR)
      : level + atr * ENTRY_TOLERANCE_ATR;
    const idealEntry    = level;
    const chaseThreshold = level + atr * LATE_THRESHOLD_ATR;

    // ── Hard stop: wick low of retest-reclaim window minus buffer ─────────
    const retestWickLow = retestSlice.length > 0
      ? retestSlice.reduce((m, c) => Math.min(m, c.low), retestSlice[0].low)
      : level - atr * STOP_MIN_FROM_LEVEL;
    const hardStop = Math.min(
      retestWickLow - atr * STOP_WICK_BUFFER_ATR,
      level - atr * STOP_MIN_FROM_LEVEL,
    );

    // ── Failed auction: close back below flip level (with tolerance) ──────
    const failedAuctionExitLevel = level - atr * FAEL_TOLERANCE_ATR;

    // ── TP1: nearest resistance clearly above the flip level ─────────────
    // Anchored to `level` (= idealEntry), not to current close price.
    const nearestRes = srLevels
      .filter(z => z.kind === 'resistance' && z.centerPrice > level + atr * 1.0)
      .sort((a, b) => a.centerPrice - b.centerPrice)[0];
    const tp1 = nearestRes ? nearestRes.centerPrice : level + atr * TP_FALLBACK_ATR;

    return {
      entryZoneLow,
      entryZoneHigh,
      idealEntry,
      chaseThreshold,
      cancelAfterBars: CANCEL_AFTER_BARS,
      hardStop,
      failedAuctionExitLevel,
      timeStopBars: TIME_STOP_BARS,
      tp1,
      runnerMode: 'avwap',
    };

  } else {
    // ── SHORT: directional mirror ─────────────────────────────────────────

    // Upper edge: tolerance band above the flip level (wick acceptance)
    const entryZoneHigh = level + atr * ENTRY_TOLERANCE_ATR;
    // Lower edge: breakout AVWAP (if meaningfully below level), else tolerance band below
    const entryZoneLow  = avwap > 0 && avwap < level - atr * 0.10
      ? Math.max(avwap, level - atr * LATE_THRESHOLD_ATR)
      : level - atr * ENTRY_TOLERANCE_ATR;
    const idealEntry    = level;
    // For SHORT, chaseThreshold is a lower bound:
    // skip entry if currentPrice < chaseThreshold (already moved too far below level)
    const chaseThreshold = level - atr * LATE_THRESHOLD_ATR;

    // ── Hard stop: wick high of retest-reclaim window plus buffer ─────────
    const retestWickHigh = retestSlice.length > 0
      ? retestSlice.reduce((m, c) => Math.max(m, c.high), retestSlice[0].high)
      : level + atr * STOP_MIN_FROM_LEVEL;
    const hardStop = Math.max(
      retestWickHigh + atr * STOP_WICK_BUFFER_ATR,
      level + atr * STOP_MIN_FROM_LEVEL,
    );

    // ── Failed auction: close back above flip level (with tolerance) ──────
    const failedAuctionExitLevel = level + atr * FAEL_TOLERANCE_ATR;

    // ── TP1: nearest support clearly below the flip level ────────────────
    // Anchored to `level` (= idealEntry), not to current close price.
    const nearestSup = srLevels
      .filter(z => z.kind === 'support' && z.centerPrice < level - atr * 1.0)
      .sort((a, b) => b.centerPrice - a.centerPrice)[0];
    const tp1 = nearestSup ? nearestSup.centerPrice : level - atr * TP_FALLBACK_ATR;

    return {
      entryZoneLow,
      entryZoneHigh,
      idealEntry,
      chaseThreshold,
      cancelAfterBars: CANCEL_AFTER_BARS,
      hardStop,
      failedAuctionExitLevel,
      timeStopBars: TIME_STOP_BARS,
      tp1,
      runnerMode: 'avwap',
    };
  }
}
