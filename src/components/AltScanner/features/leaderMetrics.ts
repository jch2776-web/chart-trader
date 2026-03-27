/**
 * Leader metrics — measures how "leading" a coin is relative to
 * a benchmark (typically BTCUSDT) and its own recent turnover history.
 *
 * All return values are normalised to predictable ranges so callers
 * can composite them without additional scaling:
 *   calcRelativeStrength*  → [-1, +1]  (positive = outperforming)
 *   calcTurnoverAccel      → unbounded (> 0 = accelerating, 0 = flat, < 0 = fading)
 */

import type { Candle } from '../../../types/candle';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default lookback for RS calculation (bars). */
export const RS_DEFAULT_PERIOD = 14;

/**
 * Scaling factor applied to the raw return difference before clamping to [-1, 1].
 * A raw diff of 1/RS_SCALE (≈ 20 %) maps to ±1.
 */
const RS_SCALE = 5;

/** Recent-window length for turnover acceleration. */
export const TURNOVER_RECENT_BARS = 5;

/** Baseline-window length for turnover acceleration. */
export const TURNOVER_BASELINE_BARS = 20;

// ── Relative strength ─────────────────────────────────────────────────────────

/**
 * Relative strength of `symbolCandles` vs `benchmarkCandles` over `period` bars.
 *
 * Formula:  clamp( (sReturn − bReturn) × RS_SCALE, -1, +1 )
 *
 * Returns 0 when either series lacks enough history or contains a zero base price.
 */
export function calcRelativeStrengthVsBenchmark(
  symbolCandles: Candle[],
  benchmarkCandles: Candle[],
  period: number = RS_DEFAULT_PERIOD,
): number {
  const sLen = symbolCandles.length;
  const bLen = benchmarkCandles.length;
  if (sLen < period + 1 || bLen < period + 1) return 0;

  const sClose = symbolCandles[sLen - 1].close;
  const sBase  = symbolCandles[sLen - 1 - period].close;
  const bClose = benchmarkCandles[bLen - 1].close;
  const bBase  = benchmarkCandles[bLen - 1 - period].close;

  if (sBase === 0 || bBase === 0) return 0;

  const sReturn = (sClose - sBase) / sBase;
  const bReturn = (bClose - bBase) / bBase;
  return Math.max(-1, Math.min(1, (sReturn - bReturn) * RS_SCALE));
}

/**
 * Relative strength of `symbolCandles` vs a pre-computed universe of returns.
 *
 * `universeReturns` should be an array of `(closeNow - closeNBarsAgo) / closeNBarsAgo`
 * values for each universe member over the same `period`.
 *
 * Returns 0 when the series is too short or the universe array is empty.
 */
export function calcRelativeStrengthVsUniverse(
  symbolCandles: Candle[],
  universeReturns: number[],
  period: number = RS_DEFAULT_PERIOD,
): number {
  const n = symbolCandles.length;
  if (n < period + 1 || universeReturns.length === 0) return 0;

  const sClose = symbolCandles[n - 1].close;
  const sBase  = symbolCandles[n - 1 - period].close;
  if (sBase === 0) return 0;

  const sReturn     = (sClose - sBase) / sBase;
  const universeAvg = universeReturns.reduce((s, v) => s + v, 0) / universeReturns.length;
  return Math.max(-1, Math.min(1, (sReturn - universeAvg) * RS_SCALE));
}

// ── Turnover acceleration ──────────────────────────────────────────────────────

/**
 * Ratio of recent average quoteVolume to baseline average quoteVolume, minus 1.
 *
 *   > 0  → recent turnover is above baseline (accelerating — bullish participation)
 *   = 0  → flat
 *   < 0  → recent turnover below baseline (fading)
 *
 * Returns 0 when there is insufficient history.
 */
export function calcTurnoverAccel(
  candles: Candle[],
  recentBars: number = TURNOVER_RECENT_BARS,
  baselineBars: number = TURNOVER_BASELINE_BARS,
): number {
  const n = candles.length;
  if (n < recentBars + baselineBars) return 0;

  const recent   = candles.slice(-recentBars);
  const baseline = candles.slice(-(recentBars + baselineBars), -recentBars);

  const recentAvg   = recent.reduce((s, c) => s + c.quoteVolume, 0)   / recent.length;
  const baselineAvg = baseline.reduce((s, c) => s + c.quoteVolume, 0) / baseline.length;

  if (baselineAvg === 0) return 0;
  return recentAvg / baselineAvg - 1;
}
