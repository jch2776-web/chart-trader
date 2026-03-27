/**
 * Location metrics — measures how well the retest level is positioned
 * relative to structural landmarks (SR zones, HVN, VWAP) and how much
 * clear space (air) exists between entry and the next opposing supply/demand.
 */

import type { Candle } from '../../../types/candle';
import type { LevelZone } from '../supportResistance';
import type { HVNZone } from '../volumeProfile';

// ── Constants ─────────────────────────────────────────────────────────────────

/** ATR multiplier that defines "nearby" for confluence checks. */
export const CONFLUENCE_PROXIMITY_ATR = 0.5;

/**
 * Maximum airR value returned (caps open-sky setups so they don't
 * dominate the score over setups with very good other metrics).
 */
export const AIR_R_CAP = 3;

// ── Anchored VWAP ──────────────────────────────────────────────────────────────

/**
 * Volume-weighted average price anchored at `startIndex` (inclusive) through
 * the last element of `candles`.
 *
 * Typical price = (high + low + close) / 3.
 * Returns 0 when the slice has zero total volume.
 */
export function calcAnchoredVwapFromIndex(
  candles: Candle[],
  startIndex: number,
): number {
  if (startIndex < 0 || startIndex >= candles.length) return 0;

  let cumPV = 0;
  let cumV  = 0;
  for (let i = startIndex; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV  += c.volume;
  }
  return cumV > 0 ? cumPV / cumV : 0;
}

// ── Confluence score ───────────────────────────────────────────────────────────

/**
 * Scores how many structural landmarks cluster near `level` (0 → 1).
 *
 * Contributions:
 *   • Each nearby qualifying SR zone  →  +0.20 (capped at 0.40)
 *   • Each overlapping HVN zone       →  +0.20 (capped at 0.40)
 *   • AVWAP within proximity          →  +0.20
 *
 * Max score = 1.0 (hard capped).
 */
export function calcConfluenceScore(
  level: number,
  atr: number,
  srLevels: LevelZone[],
  hvnZones: HVNZone[],
  avwap: number,
): number {
  const prox = atr * CONFLUENCE_PROXIMITY_ATR;
  let score = 0;

  // SR zones within proximity
  const nearbySR = srLevels.filter(
    z => Math.abs(z.centerPrice - level) <= prox && z.score >= 20,
  );
  score += Math.min(nearbySR.length * 0.20, 0.40);

  // HVN zones that overlap the level band
  const nearbyHVN = hvnZones.filter(
    z => z.priceLow <= level + prox && z.priceHigh >= level - prox,
  );
  score += Math.min(nearbyHVN.length * 0.20, 0.40);

  // AVWAP proximity
  if (avwap > 0 && Math.abs(avwap - level) <= prox) {
    score += 0.20;
  }

  return Math.min(score, 1);
}

// ── Air-R ──────────────────────────────────────────────────────────────────────

/**
 * Distance from `entryPrice` to the nearest opposing SR level, expressed in
 * multiples of R (|entryPrice − provisionalSl|), capped at `AIR_R_CAP`.
 *
 * LONG  → nearest resistance above entryPrice
 * SHORT → nearest support below entryPrice
 *
 * "Opposing" is filtered to be at least 0.1 × ATR away from entry so a
 * nearby weak cluster doesn't collapse the score.
 *
 * Returns 0 when R = 0 (degenerate SL).
 * Returns AIR_R_CAP when no opposing level is found (open sky).
 */
export function calcAirR(
  direction: 'long' | 'short',
  entryPrice: number,
  provisionalSl: number,
  srLevels: LevelZone[],
  atr: number,
): number {
  const R = Math.abs(entryPrice - provisionalSl);
  if (R === 0) return 0;

  if (direction === 'long') {
    const nearest = srLevels
      .filter(z => z.kind === 'resistance' && z.centerPrice > entryPrice + atr * 0.1)
      .sort((a, b) => a.centerPrice - b.centerPrice)[0];
    if (!nearest) return AIR_R_CAP;
    return Math.min((nearest.centerPrice - entryPrice) / R, AIR_R_CAP);
  } else {
    const nearest = srLevels
      .filter(z => z.kind === 'support' && z.centerPrice < entryPrice - atr * 0.1)
      .sort((a, b) => b.centerPrice - a.centerPrice)[0];
    if (!nearest) return AIR_R_CAP;
    return Math.min((entryPrice - nearest.centerPrice) / R, AIR_R_CAP);
  }
}
