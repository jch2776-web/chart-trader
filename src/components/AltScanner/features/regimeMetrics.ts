/**
 * Market regime detection for leader-retest auto-trade.
 *
 * Regime is evaluated at the start of each interval scan and controls
 * auto-entry strictness without hiding candidates from manual scan UI.
 *
 * Inputs
 * ──────
 * 1. BTCUSDT 4H  — EMA20 vs EMA50 (structural trend)
 * 2. BTCUSDT 1H  — EMA20 vs EMA50 (momentum confirmation)
 * 3. Universe breadth — fraction of symbols that produced any long retest
 *    candidate this scan (proxy; exact breadth fetch is too expensive)
 *
 * Regime classification
 * ─────────────────────
 * bull    — BTC 4H up + BTC 1H up + breadth ≥ 0.45
 * neutral — BTC 4H up + (1H mixed OR breadth < 0.45)
 * chop    — BTC 4H up + BTC 1H down + breadth < 0.35
 * bear    — BTC 4H down (regardless of lower timeframes)
 */

import { fetchBinanceKlinesCached } from '../../../lib/binanceKlineCache';
import type { Candle } from '../../../types/candle';

// ── Public types ──────────────────────────────────────────────────────────────

export type MarketRegime = 'bull' | 'neutral' | 'chop' | 'bear';

export type RegimeStrictness = 'relaxed' | 'normal' | 'strict';

export interface BenchmarkTrend {
  /** EMA20 > EMA50 on 4H chart */
  ema4hBull: boolean;
  /** EMA20 > EMA50 on 1H chart */
  ema1hBull: boolean;
  /** Normalised EMA20 slope on 4H: (ema[last] - ema[last-5]) / ema[last] */
  slope4h: number;
}

export interface RegimeResult {
  regime: MarketRegime;
  /** [0,1] fraction of symbols producing any long candidate this scan */
  breadth: number;
  trend: BenchmarkTrend;
  reason: string;
  computedAt: number;
}

export interface RegimeAdjustment {
  /** Add to minCandidateScore threshold (0 = no change) */
  scoreThresholdBump: number;
  /** Block PENDING (resting GTC) entries — only TRIGGERED allowed */
  suppressPending: boolean;
  /** Disable long auto-entry entirely */
  disableLong: boolean;
  /** Only meaningful when direction === 'both': allow short-only entry */
  allowShortOnly: boolean;
}

// ── EMA calculation ───────────────────────────────────────────────────────────

function calcEma(candles: Candle[], period: number): number[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  // Seed with simple average of first `period` bars
  const seedLen = Math.min(period, candles.length);
  let ema = candles.slice(0, seedLen).reduce((s, c) => s + c.close, 0) / seedLen;
  for (const c of candles) {
    ema = c.close * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ── Benchmark trend ───────────────────────────────────────────────────────────

function calcBenchmarkTrend(candles4h: Candle[], candles1h: Candle[]): BenchmarkTrend {
  const ema4hFast = calcEma(candles4h, 20);
  const ema4hSlow = calcEma(candles4h, 50);
  const ema1hFast = calcEma(candles1h, 20);
  const ema1hSlow = calcEma(candles1h, 50);

  const last4h  = ema4hFast.length - 1;
  const last1h  = ema1hFast.length - 1;

  const ema4hBull = last4h >= 0 && ema4hFast[last4h] > ema4hSlow[last4h];
  const ema1hBull = last1h >= 0 && ema1hFast[last1h] > ema1hSlow[last1h];

  // Slope: change over last 5 bars relative to current EMA, as a signed fraction
  const slopeLookback = Math.min(5, last4h);
  const slope4h = last4h >= slopeLookback && ema4hFast[last4h] > 0
    ? (ema4hFast[last4h] - ema4hFast[last4h - slopeLookback]) / ema4hFast[last4h]
    : 0;

  return { ema4hBull, ema1hBull, slope4h };
}

// ── Regime classification ─────────────────────────────────────────────────────

export function classifyRegime(trend: BenchmarkTrend, breadth: number): MarketRegime {
  if (!trend.ema4hBull) return 'bear';
  // 4H bull confirmed — look at 1H and breadth for quality
  if (!trend.ema1hBull && breadth < 0.35) return 'chop';
  if (!trend.ema1hBull || breadth < 0.45) return 'neutral';
  return 'bull';
}

function buildReason(regime: MarketRegime, trend: BenchmarkTrend, breadth: number): string {
  const b4h  = trend.ema4hBull ? 'up' : 'down';
  const b1h  = trend.ema1hBull ? 'up' : 'down';
  const slp  = (trend.slope4h * 100).toFixed(2) + '%';
  const brd  = (breadth * 100).toFixed(0) + '%';
  switch (regime) {
    case 'bull':    return `regime=bull | btc4h=${b4h} btc1h=${b1h} slope4h=${slp} breadth=${brd}`;
    case 'neutral': return `regime=neutral | btc4h=${b4h} btc1h=${b1h} breadth=${brd}`;
    case 'chop':    return `regime=chop | btc4h=${b4h} btc1h=${b1h} breadth=${brd} — PENDING suppressed`;
    case 'bear':    return `regime=bear | btc4h=${b4h} btc1h=${b1h} breadth=${brd} — long auto disabled`;
  }
}

export function finalizeRegime(trend: BenchmarkTrend, breadth: number): RegimeResult {
  const regime = classifyRegime(trend, breadth);
  return {
    regime,
    breadth,
    trend,
    reason: buildReason(regime, trend, breadth),
    computedAt: Date.now(),
  };
}

// ── Regime → auto-trade adjustments ──────────────────────────────────────────

/**
 * Maps a regime + strictness preset to concrete auto-trade adjustments.
 *
 * relaxed — only bear disables long; chop/neutral: no score adjustment
 * normal  — bear disables; chop: suppressPending; neutral: no score change
 * strict  — bear disables; chop: +10 + suppressPending; neutral: +5
 */
export function calcRegimeAdjustment(
  regime: MarketRegime,
  strictness: RegimeStrictness,
  autoDirection: 'long' | 'both',
): RegimeAdjustment {
  const disableLong    = regime === 'bear';
  const allowShortOnly = disableLong && autoDirection === 'both';

  if (regime === 'bull') {
    return { scoreThresholdBump: 0, suppressPending: false, disableLong, allowShortOnly };
  }

  if (regime === 'bear') {
    return { scoreThresholdBump: 0, suppressPending: true, disableLong, allowShortOnly };
  }

  if (regime === 'chop') {
    // normal: suppressPending only (no score bump); strict: +10 + suppressPending
    const bump = strictness === 'strict' ? 10 : 0;
    return { scoreThresholdBump: bump, suppressPending: true, disableLong: false, allowShortOnly: false };
  }

  // neutral
  const bump = strictness === 'strict' ? 5 : 0;
  return { scoreThresholdBump: bump, suppressPending: false, disableLong: false, allowShortOnly: false };
}

// ── BTC kline fetch ───────────────────────────────────────────────────────────

/**
 * Fetches BTCUSDT 4H + 1H candles and returns the benchmark trend.
 * Uses the shared kline cache — very cheap on repeat calls.
 * Throws on network failure; callers should catch and skip regime gate.
 */
export async function fetchBenchmarkTrend(signal?: AbortSignal): Promise<BenchmarkTrend> {
  const [candles4h, candles1h] = await Promise.all([
    fetchBinanceKlinesCached('BTCUSDT', '4h', 60, signal),
    fetchBinanceKlinesCached('BTCUSDT', '1h', 60, signal),
  ]);
  return calcBenchmarkTrend(candles4h, candles1h);
}
