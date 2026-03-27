/**
 * Retest candidate generation — Step 2 of leader-retest strategy.
 *
 * Replaces the single-match `detectRetest` with `buildRetestCandidates`,
 * which walks every qualifying SR level and returns all valid setups
 * with raw participation metrics attached.
 *
 * retestIndex and reclaimIndex are kept distinct:
 *   retestIndex  = first bar that probed the level (wick touch)
 *   reclaimIndex = first bar at/after retestIndex whose close reclaimed the level
 *
 * Call pickBestRetestCandidate() to select the highest-quality setup.
 * TODO(step-3): replace pickBestRetestCandidate with scoreRetestCandidate().
 */

import type { Candle } from '../../../types/candle';
import type { LevelZone } from '../supportResistance';
import { calcTakerImbalance } from './participationMetrics';

// ── Minimal detection params (avoids circular import with leaderRetest.ts) ──

/** Detection-side options; a subset of RetestOptions that is direction-agnostic. */
export interface RetestDetectOptions {
  minBars: number;
  maxBars: number;
  toleranceAtr: number;
  maxOvershootAtr: number;
}

// ── Candidate shape ──────────────────────────────────────────────────────────

export interface RetestCandidate {
  symbol: string;
  direction: 'long' | 'short';
  level: number;
  /** Index into `closed[]` for the bar that confirmed the breakout. */
  breakoutIndex: number;
  /** Index of the first bar whose wick probed the level after the breakout. */
  retestIndex: number;
  /** Index of the first bar at/after retestIndex whose close reclaimed the level. */
  reclaimIndex: number;
  atr: number;
  /** SR zone score of the matched level (higher = stronger zone). */
  srScore?: number;

  // ── Impulse quality (breakout candle) ──────────────────────────────────
  /** Body / full range of the breakout candle (0–1). Higher = more decisive. */
  impulseBodyPct: number;
  /**
   * Close Location Value of the breakout candle.
   *   LONG  → (close − low)  / (high − low)  — close near high = strong
   *   SHORT → (high − close) / (high − low)  — close near low  = strong
   */
  impulseClv: number;
  /** Rolling z-score of breakout candle quoteVolume vs prior 20 bars. */
  breakoutVolZ: number;

  // ── Pullback quality ────────────────────────────────────────────────────
  /**
   * How deep the pullback probed the level, measured in ATR multiples.
   * LONG  → (breakout_close − min_low_of_pullback_bars) / ATR
   * SHORT → (max_high_of_pullback_bars − breakout_close) / ATR
   * Pullback window = breakoutIndex+1 … reclaimIndex (inclusive).
   */
  pullbackDepth: number;
  /**
   * Mean per-bar quoteVolume during pullback bars relative to breakout bar.
   * < 1 = pullback on lighter volume than breakout (healthy).
   */
  pullbackVolRatio: number;

  // ── Reclaim quality (reclaimIndex bar) ──────────────────────────────────
  /** CLV of the reclaim candle (same directional convention as impulseClv). */
  reclaimClv: number;
  /**
   * Taker buy/sell imbalance on the reclaim candle (−1 to +1).
   * LONG → positive = aggressive buyers reclaimed; SHORT → negative = sellers.
   */
  reclaimTakerImbalance: number;
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Rolling z-score of `candles[idx].quoteVolume` vs the preceding `window` bars.
 * Returns 0 when there is insufficient history or zero variance.
 */
function volZScore(candles: Candle[], idx: number, window = 20): number {
  const start = Math.max(0, idx - window);
  const slice = candles.slice(start, idx);
  if (slice.length < 2) return 0;
  const values = slice.map(c => c.quoteVolume);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (candles[idx].quoteVolume - mean) / std;
}

function clvLong(c: Candle): number {
  const range = c.high - c.low;
  return range > 0 ? (c.close - c.low) / range : 0.5;
}

function clvShort(c: Candle): number {
  const range = c.high - c.low;
  return range > 0 ? (c.high - c.close) / range : 0.5;
}

function bodyPct(c: Candle): number {
  const range = c.high - c.low;
  return range > 0 ? Math.abs(c.close - c.open) / range : 0;
}

// ── Quality ranking ──────────────────────────────────────────────────────────

/**
 * Composite quality score for a retest candidate (higher = better).
 *
 * Weights:
 *   0.35  breakoutVolZ              — decisive breakout volume
 *   0.25  1 − pullbackVolRatio      — quiet pullback (< 1 = healthy)
 *   0.15  impulseBodyPct            — decisive breakout body
 *   0.15  reclaimClv                — strong close on reclaim bar
 *   0.05  reclaimTakerImbalance     — aggressive directional flow on reclaim
 *   0.05  srScore / 100             — zone strength tiebreaker
 */
function candidateQualityScore(c: RetestCandidate): number {
  const dirSign = c.direction === 'long' ? 1 : -1;
  return (
    c.breakoutVolZ                             * 0.35 +
    (1 - Math.min(c.pullbackVolRatio, 2))      * 0.25 +
    c.impulseBodyPct                           * 0.15 +
    c.reclaimClv                               * 0.15 +
    c.reclaimTakerImbalance * dirSign          * 0.05 +
    ((c.srScore ?? 0) / 100)                   * 0.05
  );
}

/**
 * Returns the highest-quality candidate from the list, or null if empty.
 *
 * Selection uses candidateQualityScore() which combines breakoutVolZ,
 * pullbackVolRatio, impulseBodyPct, reclaimClv, reclaimTakerImbalance,
 * and srScore into a single weighted score.
 *
 * TODO(step-3): replace with scoreRetestCandidate() once the full model is calibrated.
 */
export function pickBestRetestCandidate(
  candidates: RetestCandidate[],
): RetestCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) =>
    candidateQualityScore(c) > candidateQualityScore(best) ? c : best,
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Walks every qualifying SR level in `direction` and returns all setups
 * that satisfy the breakout → retest → reclaim structure.
 *
 * retestIndex  = first bar whose wick probed the level (touch only)
 * reclaimIndex = first bar at/after retestIndex whose close reclaimed the level
 * These are always distinct concepts; they may fall on the same bar when the
 * retest and reclaim happen in a single candle.
 *
 * Intentionally does **not** score or rank — call pickBestRetestCandidate()
 * or a future scoreRetestCandidate() on the result list.
 */
export function buildRetestCandidates(
  closed: Candle[],
  direction: 'long' | 'short',
  atr: number,
  srLevels: LevelZone[],
  opts: RetestDetectOptions,
  symbol: string,
): RetestCandidate[] {
  const results: RetestCandidate[] = [];
  const n = closed.length;
  if (n < 15 || atr === 0) return results;

  const tol = atr * opts.toleranceAtr;
  const searchStart = Math.max(1, n - opts.maxBars);
  const searchEnd   = n - opts.minBars;
  if (searchEnd < searchStart) return results;

  const currentClose = closed[n - 1].close;

  // Top 8 SR zones by score for the relevant side
  const zones = (direction === 'long'
    ? srLevels.filter(z => z.kind === 'resistance' && z.score >= 20)
    : srLevels.filter(z => z.kind === 'support'    && z.score >= 20)
  ).sort((a, b) => b.score - a.score).slice(0, 8);

  for (const zone of zones) {
    const level = zone.centerPrice;

    if (direction === 'long') {
      // ── 1. Breakout candle: prev closed below, this closed above ─────────
      let breakoutIdx = -1;
      for (let i = searchStart; i <= searchEnd; i++) {
        if (
          closed[i - 1].close < level - atr * 0.05 &&
          closed[i].close     > level + atr * 0.1
        ) {
          breakoutIdx = i;
          break;
        }
      }
      if (breakoutIdx < 0) continue;

      // ── 2a. Retest: first bar after breakout whose low probed the level ──
      let retestIdx = -1;
      for (let i = breakoutIdx + 1; i < n; i++) {
        if (closed[i].low <= level + tol) {
          retestIdx = i;
          break;
        }
      }
      if (retestIdx < 0) continue;

      // ── 2b. Reclaim: first bar at/after retestIdx whose close reclaimed ──
      let reclaimIdx = -1;
      for (let i = retestIdx; i < n; i++) {
        if (closed[i].close >= level) {
          reclaimIdx = i;
          break;
        }
      }
      if (reclaimIdx < 0) continue;

      // ── 3. Current close still holds the level ───────────────────────────
      if (currentClose < level - tol)                         continue;
      if (currentClose > level + atr * opts.maxOvershootAtr)  continue;

      // ── Metrics ──────────────────────────────────────────────────────────
      const breakoutBar = closed[breakoutIdx];
      const reclaimBar  = closed[reclaimIdx];

      // pullback window = breakoutIdx+1 … reclaimIdx (inclusive)
      const pullbackSlice = closed.slice(breakoutIdx + 1, reclaimIdx + 1);
      const minLow = pullbackSlice.reduce((m, c) => Math.min(m, c.low), breakoutBar.close);
      const pullbackVol = pullbackSlice.reduce((s, c) => s + c.quoteVolume, 0);

      results.push({
        symbol,
        direction: 'long',
        level,
        breakoutIndex: breakoutIdx,
        retestIndex:   retestIdx,
        reclaimIndex:  reclaimIdx,
        atr,
        srScore:               zone.score,
        impulseBodyPct:        bodyPct(breakoutBar),
        impulseClv:            clvLong(breakoutBar),
        breakoutVolZ:          volZScore(closed, breakoutIdx),
        pullbackDepth:         (breakoutBar.close - minLow) / atr,
        pullbackVolRatio:      breakoutBar.quoteVolume > 0
          ? pullbackVol / (pullbackSlice.length * breakoutBar.quoteVolume)
          : 0,
        reclaimClv:            clvLong(reclaimBar),
        reclaimTakerImbalance: calcTakerImbalance(reclaimBar),
      });

    } else {
      // ── SHORT: mirror of LONG ─────────────────────────────────────────────

      // 1. Breakout candle: prev closed above, this closed below
      let breakoutIdx = -1;
      for (let i = searchStart; i <= searchEnd; i++) {
        if (
          closed[i - 1].close > level + atr * 0.05 &&
          closed[i].close     < level - atr * 0.1
        ) {
          breakoutIdx = i;
          break;
        }
      }
      if (breakoutIdx < 0) continue;

      // 2a. Retest: first bar after breakout whose high probed the level
      let retestIdx = -1;
      for (let i = breakoutIdx + 1; i < n; i++) {
        if (closed[i].high >= level - tol) {
          retestIdx = i;
          break;
        }
      }
      if (retestIdx < 0) continue;

      // 2b. Reclaim: first bar at/after retestIdx whose close stayed below
      let reclaimIdx = -1;
      for (let i = retestIdx; i < n; i++) {
        if (closed[i].close <= level) {
          reclaimIdx = i;
          break;
        }
      }
      if (reclaimIdx < 0) continue;

      // 3. Current close still holds the level
      if (currentClose > level + tol)                         continue;
      if (currentClose < level - atr * opts.maxOvershootAtr)  continue;

      // ── Metrics ──────────────────────────────────────────────────────────
      const breakoutBar = closed[breakoutIdx];
      const reclaimBar  = closed[reclaimIdx];

      // pullback window = breakoutIdx+1 … reclaimIdx (inclusive)
      const pullbackSlice = closed.slice(breakoutIdx + 1, reclaimIdx + 1);
      const maxHigh = pullbackSlice.reduce((m, c) => Math.max(m, c.high), breakoutBar.close);
      const pullbackVol = pullbackSlice.reduce((s, c) => s + c.quoteVolume, 0);

      results.push({
        symbol,
        direction: 'short',
        level,
        breakoutIndex: breakoutIdx,
        retestIndex:   retestIdx,
        reclaimIndex:  reclaimIdx,
        atr,
        srScore:               zone.score,
        impulseBodyPct:        bodyPct(breakoutBar),
        impulseClv:            clvShort(breakoutBar),
        breakoutVolZ:          volZScore(closed, breakoutIdx),
        pullbackDepth:         (maxHigh - breakoutBar.close) / atr,
        pullbackVolRatio:      breakoutBar.quoteVolume > 0
          ? pullbackVol / (pullbackSlice.length * breakoutBar.quoteVolume)
          : 0,
        reclaimClv:            clvShort(reclaimBar),
        reclaimTakerImbalance: calcTakerImbalance(reclaimBar),
      });
    }
  }

  return results;
}
