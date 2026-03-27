/**
 * Scoring model for leader-retest candidates.
 *
 * scoreRetestCandidate() converts a RetestCandidate (with optional enriched
 * leader/location fields) into a RetestScoreBreakdown whose `total` is used
 * to rank candidates and populate the ScanCandidate `score` field (×100).
 *
 * Score architecture
 * ──────────────────
 * total = W_LEADER   × leaderScore
 *       + W_IMPULSE  × impulseScore
 *       + W_PULLBACK × pullbackScore
 *       + W_LOCATION × locationScore
 *       + W_AIR      × airScore
 *       − penalties.crowding
 *       − penalties.execution
 *
 * Each sub-score is normalised to [0, 1] before weighting.
 * The sum of weights = 0.84; the remaining 0.16 is reserved for penalties
 * and future components.
 *
 * Penalty wiring
 * ──────────────
 * penalties.crowding   — future: deduct when too many positions already open
 *                         in the same direction on the same timeframe.
 * penalties.execution  — future: deduct when bid/ask spread is wide or market
 *                         depth is shallow relative to position size.
 * Both are wired to 0 until the data sources are available.
 */

import type { RetestCandidate } from './retestCandidates';

// ── Score breakdown shape ─────────────────────────────────────────────────────

export interface RetestScoreBreakdown {
  /** Composite score in [0, 1]. Multiply by 100 for the ScanCandidate score field. */
  total: number;

  /** How "leading" the coin is vs BTC / universe (rs, turnover). */
  leaderScore: number;

  /** Quality of the breakout candle (body, CLV, vol z-score). */
  impulseScore: number;

  /** Quality of the pullback + reclaim (light vol, strong close, taker flow). */
  pullbackScore: number;

  /** Structural confluence at the retest level + AVWAP positioning. */
  locationScore: number;

  /** Clear space from entry to the next opposing supply/demand. */
  airScore: number;

  penalties: {
    /** Deduction for crowded market positioning (0 until wired). */
    crowding: number;
    /** Deduction for poor execution conditions (0 until wired). */
    execution: number;
  };
}

// ── Weights ───────────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = {
  LEADER:   0.22,
  IMPULSE:  0.18,
  PULLBACK: 0.18,
  LOCATION: 0.14,
  AIR:      0.12,
} as const;

// ── Normalisation helpers ─────────────────────────────────────────────────────

/** Hard clamp to [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * RS [-1, +1] → [0, 1] via linear shift.
 * RS = -1 → 0.0,  RS = 0 → 0.5,  RS = +1 → 1.0
 */
function normalizeRS(rs: number): number {
  return clamp01((rs + 1) / 2);
}

/**
 * Volume z-score → [0, 1].
 * z = 0 → 0.0,  z = 3 → 1.0,  z < 0 → 0.0
 */
function normalizeVolZ(z: number): number {
  return clamp01(z / 3);
}

/**
 * Pullback volume ratio → [0, 1].
 * ratio = 0 → 1.0,  ratio = 1 → 0.5,  ratio = 2 → 0.0
 * (< 1 means pullback volume < breakout volume = healthy)
 */
function normalizePullbackVolRatio(ratio: number): number {
  return clamp01(1 - ratio * 0.5);
}

/**
 * Turnover acceleration → [0, 1].
 * accel = 1.0 (doubled)  → 1.0
 * accel = 0.0 (flat)     → 0.5
 * accel = -0.5 (halved)  → 0.0
 */
function normalizeTurnoverAccel(accel: number): number {
  return clamp01((accel + 0.5) / 1.5);
}

/**
 * Air-R [0, AIR_R_CAP=3] → [0, 1].
 * airR = 0 → 0.0,  airR = 3 → 1.0
 */
function normalizeAirR(air: number): number {
  return clamp01(air / 3);
}

/**
 * AVWAP breakout field → [0, 1].
 * avwapBreakout is signed: positive = price on favorable side of AVWAP.
 * +1.5 ATR above (long) or below (short) = full score.
 * At AVWAP (0) = 0.33.  On wrong side = approaches 0.
 */
function normalizeAvwapBreakout(v: number): number {
  // Linear: (-1.5 ATR → 0, 0 → 0.33, +1.5 ATR → 1.0)
  return clamp01((v + 1.5) / 3);
}

// ── Sub-score calculations ─────────────────────────────────────────────────────

/**
 * Leader score: how well the coin is outperforming its benchmark/universe.
 *
 * Signals and their base priority weights (when all five are present):
 *   rsVsBtc       0.30  — RS vs BTC on scan timeframe (primary benchmark)
 *   rs4h          0.25  — RS vs BTC on 4H timeframe (trend confirmation)
 *   rs1h          0.15  — RS vs BTC on 1H timeframe (short-term momentum)
 *   rsVsUniverse  0.15  — RS vs scan-universe average (relative ranking)
 *   turnoverAccel 0.15  — volume participation growth
 *
 * Missing fields are excluded; remaining weights are renormalised so the
 * result is always a proper weighted average of whatever signals are present.
 * Returns 0.5 (neutral) only when no signal is available at all.
 */
function calcLeaderScore(c: RetestCandidate): number {
  // [normalised value, base priority weight]
  type WeightedSignal = [number, number];
  const signals: WeightedSignal[] = [];

  if (c.rsVsBtc       !== undefined) signals.push([normalizeRS(c.rsVsBtc),                     0.30]);
  if (c.rs4h          !== undefined) signals.push([normalizeRS(c.rs4h),                        0.25]);
  if (c.rs1h          !== undefined) signals.push([normalizeRS(c.rs1h),                        0.15]);
  if (c.rsVsUniverse  !== undefined) signals.push([normalizeRS(c.rsVsUniverse),                0.15]);
  if (c.turnoverAccel !== undefined) signals.push([normalizeTurnoverAccel(c.turnoverAccel),    0.15]);

  if (signals.length === 0) return 0.5;

  const totalWeight = signals.reduce((s, sig) => s + sig[1], 0);
  return signals.reduce((s, sig) => s + sig[0] * (sig[1] / totalWeight), 0);
}

/**
 * Impulse score: quality of the breakout candle.
 *
 * Components:
 *   impulseBodyPct  [0,1]  — decisive body (doji → 0, full-body → 1)
 *   impulseClv      [0,1]  — close near extreme (CLV)
 *   breakoutVolZ    [0,∞)  — normalised to [0,1]
 */
function calcImpulseScore(c: RetestCandidate): number {
  const body = clamp01(c.impulseBodyPct);
  const clv  = clamp01(c.impulseClv);
  const volZ = normalizeVolZ(c.breakoutVolZ);

  return body * 0.30 + clv * 0.30 + volZ * 0.40;
}

/**
 * Pullback score: quality of the pullback and reclaim bar.
 *
 * Components:
 *   pullbackVolRatio        — low ratio = healthy (normalized)
 *   reclaimClv              — strong directional close on reclaim bar
 *   reclaimTakerImbalance   — aggressive directional flow on reclaim
 */
function calcPullbackScore(c: RetestCandidate): number {
  const dirSign = c.direction === 'long' ? 1 : -1;

  const pvr   = normalizePullbackVolRatio(c.pullbackVolRatio);
  const rClv  = clamp01(c.reclaimClv);
  // taker imbalance: scale from [-1,+1] directional to [0,1]
  const taker = clamp01((c.reclaimTakerImbalance * dirSign + 1) / 2);

  return pvr * 0.40 + rClv * 0.35 + taker * 0.25;
}

/**
 * Location score: structural confluence at the retest level.
 *
 * Components:
 *   confluenceScore  — SR / HVN / AVWAP cluster (already [0,1])
 *   avwapBreakout    — signed distance from anchored VWAP
 */
function calcLocationScore(c: RetestCandidate): number {
  const conf  = c.confluenceScore !== undefined ? clamp01(c.confluenceScore) : 0.5;
  const avwap = c.avwapBreakout   !== undefined ? normalizeAvwapBreakout(c.avwapBreakout) : 0.5;

  return conf * 0.60 + avwap * 0.40;
}

/**
 * Air score: clear space from entry to the next opposing supply/demand.
 *
 * airR is in R-multiples; normalised from [0, AIR_R_CAP=3] → [0, 1].
 */
function calcAirScore(c: RetestCandidate): number {
  if (c.airR === undefined) return 0.5;
  return normalizeAirR(c.airR);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Scores a retest candidate and returns the full breakdown.
 *
 * Call this after the candidate has been enriched with leader/location
 * metrics (rsVsBtc, rs4h, turnoverAccel, avwapBreakout, confluenceScore, airR).
 * Missing optional fields fall back to neutral (0.5) contributions.
 *
 * The `total` field in the returned breakdown is suitable for sorting:
 * higher = better quality setup.
 */
export function scoreRetestCandidate(c: RetestCandidate): RetestScoreBreakdown {
  const leaderScore   = calcLeaderScore(c);
  const impulseScore  = calcImpulseScore(c);
  const pullbackScore = calcPullbackScore(c);
  const locationScore = calcLocationScore(c);
  const airScore      = calcAirScore(c);

  // Penalty placeholders — wired to 0 until crowding/execution data is available.
  // crowding:  connect when open-position registry tracks live direction counts.
  // execution: connect when bid/ask spread data is streamed via WebSocket.
  const penalties = { crowding: 0, execution: 0 };
  const totalPenalty = penalties.crowding + penalties.execution;

  const total = clamp01(
    SCORE_WEIGHTS.LEADER   * leaderScore  +
    SCORE_WEIGHTS.IMPULSE  * impulseScore +
    SCORE_WEIGHTS.PULLBACK * pullbackScore +
    SCORE_WEIGHTS.LOCATION * locationScore +
    SCORE_WEIGHTS.AIR      * airScore     -
    totalPenalty,
  );

  return {
    total,
    leaderScore,
    impulseScore,
    pullbackScore,
    locationScore,
    airScore,
    penalties,
  };
}
