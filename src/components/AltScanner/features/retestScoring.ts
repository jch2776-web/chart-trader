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
 * The sum of weights = 0.84; the remaining 0.16 is reserved for penalties.
 *
 * Penalty wiring
 * ──────────────
 * penalties.execution  — spread + depth penalty (live order-book data).
 *                        Supplied via RetestPenaltyContext from useAltAutoTrade.
 * penalties.crowding   — direction saturation + same-symbol duplicate penalty.
 *                        Supplied via RetestPenaltyContext from useAltAutoTrade.
 * Both default to 0 when context is absent (scan-time call without live data).
 */

import type { RetestCandidate } from './retestCandidates';

// ── Penalty context ────────────────────────────────────────────────────────────

/**
 * Live-data context fed by useAltAutoTrade at ranking time.
 * Not available inside the scan function — computed from the trading hook's
 * position registry and order-book cache.
 * All fields are optional; missing values contribute 0 penalty (safe, never fail).
 */
export interface RetestPenaltyContext {
  /** Live bid/ask spread in bps at decision time. */
  spreadBps?: number;
  /** USD depth within 10 bps of mid-price (bid side). Fetched per scan cycle via getDepth10bpsUsd. */
  depth10bpsUsd?: number;
  /** Planned position notional in USD (from sizingHint). Used for depth coverage ratio. */
  plannedNotionalUsd?: number;
  /** Open live/paper positions in the same direction as this candidate. */
  sameDirectionOpenCount?: number;
  /** Pending resting entry orders (GTC) in the same direction. */
  sameDirectionPendingCount?: number;
  /** True when the same symbol+direction already has an open position. */
  sameSymbolOpen?: boolean;
  /** True when the same symbol+direction already has a pending resting entry. */
  sameSymbolPending?: boolean;
}

/**
 * Pre-computed snapshot of open positions and pending GTC orders.
 * Built once per render in App.tsx and passed to useAltAutoTrade.
 * Converted to per-candidate RetestPenaltyContext inside the hook.
 */
export interface RetestCrowdingSnapshot {
  openLong:   number;
  openShort:  number;
  pendingLong:  number;
  pendingShort: number;
  /** `${symbol}_long` | `${symbol}_short` for each open position */
  openKeys:    ReadonlySet<string>;
  /** Same format for pending resting entries */
  pendingKeys: ReadonlySet<string>;
}

// ── Penalty helpers ────────────────────────────────────────────────────────────

/**
 * Execution penalty: deduction for wide spread or shallow depth.
 * - spread <= 1.5 bps : 0
 * - spread 1.5 – 4 bps : 0 → 0.04 (linear)
 * - spread 4 – 8 bps   : 0.04 → 0.08 (linear)
 * - spread >= 8 bps    : capped at 0.08 (hard gate already blocks >= maxSpreadBps)
 * Total cap: 0.10.
 */
export function computeExecutionPenalty(ctx: RetestPenaltyContext): number {
  let pen = 0;

  if (ctx.spreadBps != null) {
    const s = ctx.spreadBps;
    if (s > 1.5 && s <= 4) {
      pen += ((s - 1.5) / 2.5) * 0.04;
    } else if (s > 4 && s <= 8) {
      pen += 0.04 + ((s - 4) / 4) * 0.04;
    } else if (s > 8) {
      pen += 0.08;
    }
  }

  // Depth coverage: penalty scales from 0 → 0.04 as coverage ratio drops from 20× to 0×
  if (ctx.depth10bpsUsd != null && ctx.plannedNotionalUsd != null && ctx.plannedNotionalUsd > 0) {
    const coverage = ctx.depth10bpsUsd / ctx.plannedNotionalUsd;
    if (coverage < 20) {
      pen += clamp01(1 - coverage / 20) * 0.04;
    }
  }

  return Math.min(pen, 0.10);
}

/**
 * Crowding penalty: deduction for same-symbol duplicate or overcrowded direction.
 * - sameSymbolOpen     → 0.06 (strong — same position already exists)
 * - sameSymbolPending  → 0.03 (moderate — resting order pending)
 * - direction count 2–3 → +0.02
 * - direction count 4+  → +0.04
 * Total cap: 0.10.
 */
export function computeCrowdingPenalty(ctx: RetestPenaltyContext): number {
  let pen = 0;

  if (ctx.sameSymbolOpen) {
    pen += 0.06;
  } else if (ctx.sameSymbolPending) {
    pen += 0.03;
  }

  const openCount    = ctx.sameDirectionOpenCount    ?? 0;
  const pendingCount = ctx.sameDirectionPendingCount ?? 0;
  const totalCount   = openCount + pendingCount;
  if (totalCount >= 4) {
    pen += 0.04;
  } else if (totalCount >= 2) {
    pen += 0.02;
  }

  return Math.min(pen, 0.10);
}

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
 * z = 0 → 0.0,  z = 2 → 1.0,  z < 0 → 0.0
 * (Threshold lowered from 3 to 2: real breakout candles are typically 1–2z)
 */
function normalizeVolZ(z: number): number {
  return clamp01(z / 2);
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
 * accel = +0.5 (50 % growth) → 1.0
 * accel =  0.0 (flat)        → 0.5
 * accel = -0.5 (halved)      → 0.0
 * (Range tightened from 1.5 span to 1.0 span: +50 % growth is a meaningful signal)
 */
function normalizeTurnoverAccel(accel: number): number {
  return clamp01(accel + 0.5);
}

/**
 * Air-R → [0, 1].
 * airR = 0 → 0.0,  airR = 2 → 1.0
 * (Threshold lowered from 3R to 2R: 2R of clear space is a strong setup)
 */
function normalizeAirR(air: number): number {
  return clamp01(air / 2);
}

/**
 * AVWAP breakout field → [0, 1].
 * avwapBreakout is signed: positive = price on favorable side of AVWAP.
 *   v = +1 ATR (favorable side) → 1.0
 *   v =  0 ATR (at AVWAP)       → 0.5  (neutral)
 *   v = -1 ATR (wrong side)     → 0.0
 */
function normalizeAvwapBreakout(v: number): number {
  return clamp01((v + 1) / 2);
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
 * The optional `ctx` parameter supplies live execution/crowding data that is
 * not available inside the scan function.  When omitted, penalties are 0.
 * useAltAutoTrade re-applies penalties after scanning via the exported
 * computeExecutionPenalty / computeCrowdingPenalty helpers.
 *
 * The `total` field in the returned breakdown is suitable for sorting:
 * higher = better quality setup.
 */
export function scoreRetestCandidate(c: RetestCandidate, ctx?: RetestPenaltyContext): RetestScoreBreakdown {
  const leaderScore   = calcLeaderScore(c);
  const impulseScore  = calcImpulseScore(c);
  const pullbackScore = calcPullbackScore(c);
  const locationScore = calcLocationScore(c);
  const airScore      = calcAirScore(c);

  const penalties = {
    crowding:  ctx ? computeCrowdingPenalty(ctx)  : 0,
    execution: ctx ? computeExecutionPenalty(ctx) : 0,
  };
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
