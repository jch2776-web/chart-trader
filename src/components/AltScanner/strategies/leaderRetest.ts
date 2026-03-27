/**
 * Leader-Retest Strategy (v2)
 *
 * Finds coins where price broke out of a key SR level some bars ago
 * and has now pulled back to retest that level WITH CONFIRMATION.
 *
 * v2 changes vs v1:
 *  - detectRetest: no longer accepts "close near level" alone.
 *    Requires a historical bar where low <= level+tol AND close >= level
 *    (touched the level but closed back above it = retest confirmed).
 *  - 4H uptrend filter: for LONG, EMA20 > EMA50 on 4H must hold.
 *  - Default maxBars reduced 12 → 8 (tighter recency).
 *
 * Completely separate from the legacy breakout strategy.
 */

import type { Candle } from '../../../types/candle';
import type { HlineDrawing, BoxDrawing, Drawing, BoxCorner } from '../../../types/drawing';
import type {
  ScanCandidate, ScanInterval, ScanDirection, ScanOptions,
  DrawingGroups, CandidateStatus,
} from '../breakoutScanner';
import { calcSRLevels } from '../supportResistance';
import type { LevelZone } from '../supportResistance';
import { calcHVN } from '../volumeProfile';
import type { HVNZone } from '../volumeProfile';
import { intervalToMs, getTtlBars, getVolFactor, triggerPrice } from '../timeUtils';
import { fetchBinanceKlinesCached } from '../../../lib/binanceKlineCache';
import { acquireScanSlot, getBinanceGovernorSnapshot } from '../../../lib/binanceRequestGovernor';
import type { ScanFn, ScanStrategy } from '../strategyTypes';
import { buildRetestCandidates, pickBestRetestCandidate } from '../features/retestCandidates';
import type { RetestCandidate, RetestDetectOptions } from '../features/retestCandidates';
import { calcRelativeStrengthVsBenchmark, calcTurnoverAccel, RS_DEFAULT_PERIOD } from '../features/leaderMetrics';
import { calcAnchoredVwapFromIndex, calcConfluenceScore, calcAirR } from '../features/locationMetrics';
import { scoreRetestCandidate } from '../features/retestScoring';
import type { RetestScoreBreakdown } from '../features/retestScoring';

// ── Retest detection parameters ────────────────────────────────────────────

/**
 * Tunable parameters for the leader-retest detector.
 * All values are per-symbol; defaults are applied when a field is omitted.
 */
export interface RetestOptions {
  /** Min bars between the breakout candle and current bar (default 1) */
  minBars?: number;
  /** Max bars between the breakout candle and current bar (default 8) */
  maxBars?: number;
  /** Candle low must be within level + toleranceAtr × ATR to count as retest touch (default 0.30) */
  toleranceAtr?: number;
  /** Max allowed overshoot of current close beyond the far side of the level, in ATR multiples (default 1.0) */
  maxOvershootAtr?: number;
  /** Require 4H EMA20 > EMA50 before allowing LONG entry (default true) */
  require4hTrend?: boolean;
}

const DEFAULT_RETEST_OPTIONS: Required<RetestOptions> = {
  minBars: 1,
  maxBars: 8,          // v2: reduced from 12 — keep retest recent
  toleranceAtr: 0.30,
  maxOvershootAtr: 1.0,
  require4hTrend: true, // v2: 4H uptrend guard for LONG
};

// ── Utilities ──────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt(p: number) { return p >= 1 ? p.toFixed(2) : p.toFixed(6); }

const SAFETY_MS = 4000;

function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i], p = candles[i - 1];
    atr += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

/** EMA of close prices; returns the last (most recent) EMA value. */
function calcEMA(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

function closedOnly(candles: Candle[], intervalMs: number): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const isClosed = (last.time + intervalMs) <= (Date.now() - SAFETY_MS);
  return isClosed ? candles : candles.slice(0, -1);
}

// ── Retest detection ───────────────────────────────────────────────────────

interface RetestResult {
  level: number;
  direction: 'long' | 'short';
}

/**
 * @deprecated Use buildRetestCandidates (features/retestCandidates.ts) instead.
 *
 * v2 detectRetest: requires confirmed retest candle.
 *
 * LONG conditions:
 *  1. A breakout candle exists in [n-maxBars .. n-minBars] range
 *     (prev.close < level, bar.close > level)
 *  2. At least one bar AFTER the breakout has:
 *     - low  <= level + tol  (touched the level from above)
 *     - close >= level       (closed back above = retest confirmed)
 *  3. Current close (n-1) >= level - tol  (still holding, not broken down)
 *
 * SHORT is the exact mirror.
 */
function detectRetest(
  closed: Candle[],
  dir: 'long' | 'short',
  atr: number,
  srLevels: LevelZone[],
  opts: Required<RetestOptions>,
): RetestResult | null {
  const n = closed.length;
  if (n < 15) return null;

  const currentClose = closed[n - 1].close;
  const tol = atr * opts.toleranceAtr;
  const searchStart = Math.max(1, n - opts.maxBars);
  const searchEnd   = n - opts.minBars;
  if (searchEnd < searchStart) return null;

  if (dir === 'long') {
    const candidates = srLevels
      .filter(z => z.kind === 'resistance' && z.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    for (const zone of candidates) {
      const level = zone.centerPrice;

      // 1. Find breakout candle in the search window
      let breakoutIdx = -1;
      for (let i = searchStart; i <= searchEnd; i++) {
        if (closed[i - 1].close < level - atr * 0.05 && closed[i].close > level + atr * 0.1) {
          breakoutIdx = i;
          break;
        }
      }
      if (breakoutIdx < 0) continue;

      // 2. Confirmed retest: any bar after the breakout where
      //    low touched level AND close reclaimed it
      let confirmed = false;
      for (let i = breakoutIdx + 1; i < n; i++) {
        const bar = closed[i];
        if (bar.low <= level + tol && bar.close >= level) {
          confirmed = true;
          break;
        }
      }
      if (!confirmed) continue;

      // 3. Current close still at or above level (not blown through),
      //    and hasn't overshot too far above the level
      if (currentClose < level - tol) continue;
      if (currentClose > level + atr * opts.maxOvershootAtr) continue;

      return { level, direction: 'long' };
    }
  } else {
    const candidates = srLevels
      .filter(z => z.kind === 'support' && z.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    for (const zone of candidates) {
      const level = zone.centerPrice;

      // 1. Find breakout candle (broke below support)
      let breakoutIdx = -1;
      for (let i = searchStart; i <= searchEnd; i++) {
        if (closed[i - 1].close > level + atr * 0.05 && closed[i].close < level - atr * 0.1) {
          breakoutIdx = i;
          break;
        }
      }
      if (breakoutIdx < 0) continue;

      // 2. Confirmed retest: high touched level AND close reclaimed below
      let confirmed = false;
      for (let i = breakoutIdx + 1; i < n; i++) {
        const bar = closed[i];
        if (bar.high >= level - tol && bar.close <= level) {
          confirmed = true;
          break;
        }
      }
      if (!confirmed) continue;

      // 3. Current close still at or below level,
      //    and hasn't overshot too far below the level
      if (currentClose > level + tol) continue;
      if (currentClose < level - atr * opts.maxOvershootAtr) continue;

      return { level, direction: 'short' };
    }
  }

  return null;
}

// ── Drawing groups ─────────────────────────────────────────────────────────

function buildRetestDrawings(
  symbol: string,
  direction: 'long' | 'short',
  level: number,
  entryPrice: number,
  sl: number,
  tp1: number | undefined,
  tp2: number,
  srLevels: LevelZone[],
  hvnZones: HVNZone[],
  candles: Candle[],
): DrawingGroups {
  const n = candles.length;
  const boxT1 = candles[Math.floor(n * 0.5)].time;
  const boxT2 = candles[n - 1].time;
  const isLong = direction === 'long';

  const dimClr = (kind: string) =>
    kind === 'support' ? 'rgba(14,203,129,0.22)' : 'rgba(246,70,93,0.22)';
  const brightClr = (kind: string) =>
    kind === 'support' ? 'rgba(14,203,129,0.90)' : 'rgba(246,70,93,0.90)';

  const topLevels = [
    ...srLevels.filter(z => z.kind === 'support').sort((a, b) => b.score - a.score).slice(0, 1),
    ...srLevels.filter(z => z.kind === 'resistance').sort((a, b) => b.score - a.score).slice(0, 1),
  ];
  const topSet = new Set(topLevels.map(z => z.centerPrice));
  const sorted = [...srLevels].sort((a, b) => b.score - a.score);

  const dimSR: Drawing[] = [
    ...sorted.filter(z => z.kind === 'support').slice(0, 10),
    ...sorted.filter(z => z.kind === 'resistance').slice(0, 10),
  ]
    .filter(z => !topSet.has(z.centerPrice))
    .map(z => ({
      id: uid(), type: 'hline' as const, ticker: symbol,
      price: z.centerPrice, color: dimClr(z.kind),
      memo: `${z.horizon} ${z.kind} · touches=${z.touches} · score=${z.score}`,
    } satisfies HlineDrawing));

  const topSR: Drawing[] = topLevels.map(z => ({
    id: uid(), type: 'hline' as const, ticker: symbol,
    price: z.centerPrice, color: brightClr(z.kind),
    memo: `${z.kind === 'support' ? '⑤' : '⑥'} ★ ${z.horizon} ${z.kind === 'support' ? '지지' : '저항'} · ${z.touches}회 터치 · score=${z.score}`,
  } satisfies HlineDrawing));

  const makeBoxCorners = (t1: number, t2: number, hi: number, lo: number): BoxCorner[] => [
    { pos: 'TL', time: t1, price: hi }, { pos: 'TR', time: t2, price: hi },
    { pos: 'BR', time: t2, price: lo }, { pos: 'BL', time: t1, price: lo },
  ];

  const hvn: Drawing[] = hvnZones
    .filter(z => Math.abs(z.centerPrice - entryPrice) / entryPrice <= 0.03)
    .slice(0, 3)
    .map(z => ({
      id: uid(), type: 'box' as const, ticker: symbol,
      p1: { time: boxT1, price: z.priceHigh }, p2: { time: boxT2, price: z.priceLow },
      corners: makeBoxCorners(boxT1, boxT2, z.priceHigh, z.priceLow),
      topPrice: z.priceHigh, bottomPrice: z.priceLow,
      color: 'rgba(240,185,11,0.25)',
      memo: `⑧ HVN 매물대 · ${fmt(z.priceLow)}~${fmt(z.priceHigh)}`,
    } satisfies BoxDrawing));

  const R = Math.abs(entryPrice - sl);
  const rr = R > 0 ? Math.abs(tp2 - entryPrice) / R : 0;

  const retestLine: HlineDrawing = {
    id: uid(), type: 'hline', ticker: symbol, price: level,
    color: isLong ? 'rgba(14,203,129,0.65)' : 'rgba(246,70,93,0.65)',
    memo: `⑦ 리테스트 레벨 ${fmt(level)} · ${isLong ? '저항→지지 전환' : '지지→저항 전환'}`,
  };

  const entryLines: Drawing[] = [
    {
      id: uid(), type: 'hline', ticker: symbol, price: entryPrice,
      color: '#f0b90b',
      memo: `① ${isLong ? '▲ 롱' : '▼ 숏'} 리테스트 진입 · RR≈${rr.toFixed(1)}`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: sl,
      color: '#f6465d',
      memo: `④ SL ${fmt(sl)} · 리테스트 레벨 하단 기준`,
    } satisfies HlineDrawing,
    ...(tp1 !== undefined ? [{
      id: uid(), type: 'hline' as const, ticker: symbol, price: tp1,
      color: 'rgba(14,203,129,0.65)',
      memo: `③ TP1 ${fmt(tp1)} · 1차 목표`,
    } satisfies HlineDrawing] : []),
    {
      id: uid(), type: 'hline', ticker: symbol, price: tp2,
      color: '#0ecb81',
      memo: `② TP2 ${fmt(tp2)} · 최종 목표 RR=2`,
    } satisfies HlineDrawing,
  ];

  return { breakout: [retestLine], dimSR, topSR, hvn, entryLines };
}

// ── Scan one symbol ────────────────────────────────────────────────────────

async function scanSymbolRetest(
  symbol: string,
  interval: ScanInterval,
  direction: ScanDirection,
  opts: Required<RetestOptions>,
  signal?: AbortSignal,
): Promise<ScanCandidate | null> {
  const iMs = intervalToMs(interval);

  const raw = await fetchBinanceKlinesCached(symbol, interval, 302, signal);
  if (raw.length < 52) return null;
  const closed = closedOnly(raw, iMs);
  if (closed.length < 15) return null;

  const lastClosed = closed[closed.length - 1];
  const lastClosedCloseTime = lastClosed.time + iMs;

  const atr = calcATR(closed);
  if (atr === 0) return null;

  // Build direction list; may be narrowed by 4H trend filter below
  let activeDirs: ('long' | 'short')[] = direction === 'both' ? ['long', 'short'] : [direction];

  // candles4h is hoisted so the enrichment step can reuse them for rs4h
  let candles4h: Candle[] = [];

  // ── 4H uptrend filter (LONG only, v2) ──────────────────────────────────
  if (opts.require4hTrend && activeDirs.includes('long')) {
    // When scanning on 4H or 1D, reuse already-fetched candles; otherwise fetch separately
    if (interval === '4h' || interval === '1d') {
      candles4h = closed;
    } else {
      try {
        const raw4h = await fetchBinanceKlinesCached(symbol, '4h', 60, signal);
        candles4h = closedOnly(raw4h, intervalToMs('4h'));
      } catch {
        candles4h = [];
      }
    }
    if (candles4h.length >= 50) {
      const ema20 = calcEMA(candles4h, 20);
      const ema50 = calcEMA(candles4h, 50);
      if (ema20 <= ema50) {
        activeDirs = activeDirs.filter(d => d !== 'long');
      }
    } else {
      activeDirs = activeDirs.filter(d => d !== 'long');
    }
    if (activeDirs.length === 0) return null;
  }
  // ───────────────────────────────────────────────────────────────────────

  const entryPrice = lastClosed.close;
  const srLevels = calcSRLevels(closed, atr, entryPrice);
  const hvnZones = calcHVN(closed.slice(-300), 100, 5, entryPrice);

  const detectOpts: RetestDetectOptions = {
    minBars:         opts.minBars,
    maxBars:         opts.maxBars,
    toleranceAtr:    opts.toleranceAtr,
    maxOvershootAtr: opts.maxOvershootAtr,
  };
  const allCandidates: RetestCandidate[] = activeDirs.flatMap(dir =>
    buildRetestCandidates(closed, dir, atr, srLevels, detectOpts, symbol),
  );
  if (allCandidates.length === 0) return null;

  // ── Enrich candidates with leader / location metrics ─────────────────────
  // BTC candles for RS (skipped when symbol is BTCUSDT; cached after first call).
  let btcCandles: Candle[] = [];
  if (symbol !== 'BTCUSDT') {
    try {
      btcCandles = await fetchBinanceKlinesCached('BTCUSDT', interval, 302, signal);
    } catch { /* non-fatal — rs fields remain undefined */ }
  }

  // BTC 4H candles for rs4h (reuse btcCandles when scan interval is 4h/1d).
  let btcCandles4h: Candle[] = [];
  if (symbol !== 'BTCUSDT' && candles4h.length >= RS_DEFAULT_PERIOD + 1) {
    if (interval === '4h' || interval === '1d') {
      btcCandles4h = btcCandles; // already on the 4h / 1d timeframe
    } else {
      try {
        const rawBtc4h = await fetchBinanceKlinesCached('BTCUSDT', '4h', 60, signal);
        btcCandles4h = closedOnly(rawBtc4h, intervalToMs('4h'));
      } catch { /* non-fatal */ }
    }
  }

  for (const c of allCandidates) {
    // ── Leader metrics ──────────────────────────────────────────────────
    if (btcCandles.length >= RS_DEFAULT_PERIOD + 1) {
      c.rsVsBtc = calcRelativeStrengthVsBenchmark(closed, btcCandles, RS_DEFAULT_PERIOD);
    }
    if (candles4h.length >= RS_DEFAULT_PERIOD + 1 && btcCandles4h.length >= RS_DEFAULT_PERIOD + 1) {
      c.rs4h = calcRelativeStrengthVsBenchmark(candles4h, btcCandles4h, RS_DEFAULT_PERIOD);
    }
    c.turnoverAccel = calcTurnoverAccel(closed);

    // ── Location metrics ────────────────────────────────────────────────
    const avwap = calcAnchoredVwapFromIndex(closed, c.breakoutIndex);
    if (avwap > 0) {
      // Signed: positive = price on the favorable side of AVWAP for direction
      const raw = (entryPrice - avwap) / c.atr;
      c.avwapBreakout = c.direction === 'long' ? raw : -raw;
    }
    c.confluenceScore = calcConfluenceScore(c.level, c.atr, srLevels, hvnZones, avwap);
    const provSl = c.direction === 'long'
      ? c.level - c.atr * 1.5
      : c.level + c.atr * 1.5;
    c.airR = calcAirR(c.direction, entryPrice, provSl, srLevels, c.atr);
    const R = Math.abs(entryPrice - provSl);
    c.distanceToNextSupply = R > 0 ? c.airR * R / c.atr : undefined;
  }

  // ── Score all candidates and pick the best ────────────────────────────────
  // scoreRetestCandidate() computes a weighted composite (see retestScoring.ts).
  // TODO(step-4): feed breakdown into UI so users can inspect sub-scores.
  type Scored = { candidate: RetestCandidate; breakdown: RetestScoreBreakdown };
  const scored: Scored[] = allCandidates.map(c => ({
    candidate: c,
    breakdown: scoreRetestCandidate(c),
  }));
  scored.sort((a, b) => b.breakdown.total - a.breakdown.total);
  const { candidate: best, breakdown: bestBreakdown } = scored[0];

  const { level, direction: foundDir } = best;
  const isLong = foundDir === 'long';

  // SL / TP calculation
  const R_base = atr * 1.5;
  let sl: number, tp2: number, tp1: number | undefined;

  if (isLong) {
    sl = level - R_base;
    const R = entryPrice - sl;
    tp2 = entryPrice + 2 * R;
    const nextRes = srLevels
      .filter(z => z.kind === 'resistance' && z.centerPrice > entryPrice)
      .sort((a, b) => a.centerPrice - b.centerPrice)[0];
    if (nextRes && nextRes.centerPrice - entryPrice >= R * 0.8 && nextRes.centerPrice < tp2) {
      tp1 = nextRes.centerPrice;
    }
  } else {
    sl = level + R_base;
    const R = sl - entryPrice;
    tp2 = entryPrice - 2 * R;
    const nextSup = srLevels
      .filter(z => z.kind === 'support' && z.centerPrice < entryPrice)
      .sort((a, b) => b.centerPrice - a.centerPrice)[0];
    if (nextSup && entryPrice - nextSup.centerPrice >= R * 0.8 && nextSup.centerPrice > tp2) {
      tp1 = nextSup.centerPrice;
    }
  }

  const topLevels = [
    ...srLevels.filter(z => z.kind === 'support').sort((a, b) => b.score - a.score).slice(0, 1),
    ...srLevels.filter(z => z.kind === 'resistance').sort((a, b) => b.score - a.score).slice(0, 1),
  ];

  const vf = getVolFactor(interval);
  const validBars = getTtlBars(interval);
  const nextCandleCloseTime = lastClosedCloseTime + iMs;
  const validUntilTime = lastClosedCloseTime + validBars * iMs;
  const triggerSpec = { type: 'hline' as const, fixedPrice: level, slope: 0, p1Time: 0, p1Price: 0 };
  const triggerAtNextClose = triggerPrice(triggerSpec, nextCandleCloseTime);

  const drawingGroups = buildRetestDrawings(
    symbol, foundDir, level, entryPrice, sl, tp1, tp2,
    srLevels, hvnZones, closed,
  );

  // Score: probability-ranking composite from scoreRetestCandidate()
  // (leader 22% + impulse 18% + pullback 18% + location 14% + air 12%)
  // mapped to 0-100 for the ScanCandidate score field.
  const score = Math.round(bestBreakdown.total * 100);

  // Distance to retest level
  const distanceNowPct = isLong
    ? ((level - entryPrice) / level) * 100
    : ((entryPrice - level) / level) * 100;

  const status: CandidateStatus = Math.abs(distanceNowPct) <= 0.5 ? 'TRIGGERED' : 'PENDING';

  return {
    symbol, direction: foundDir,
    score,
    entryPrice, slPrice: sl, tpPrice: tp2, tp1Price: tp1,
    atr,
    breakoutType: 'hline',
    srLevels, hvnZones, topLevels, drawingGroups,
    candles: closed,
    interval,
    volFactor: vf,
    status,
    asOfCloseTime: lastClosedCloseTime,
    validBars,
    validUntilTime,
    nextCandleCloseTime,
    triggerPriceAtNextClose: triggerAtNextClose,
    triggerSpec,
    triggeredAt: status === 'TRIGGERED' ? lastClosedCloseTime : undefined,
    distanceNowPct,
    strategyId: 'leader-retest',
  };
}

// ── Internal scan runner (accepts retestOptions) ───────────────────────────

async function runLeaderRetestScanInternal(
  symbols: string[],
  interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  retestOpts: Required<RetestOptions>,
  signal?: AbortSignal,
  options?: ScanOptions,
): Promise<void> {
  const gov = getBinanceGovernorSnapshot();
  if (gov.cooldownUntil > Date.now()) {
    const remainSec = Math.ceil((gov.cooldownUntil - Date.now()) / 1000);
    options?.onStatus?.(`바이낸스 쿨다운 중(${remainSec}s) — 스캔 일시 중단`, 'warn');
    return;
  }

  const scanTag = options?.scanTag ?? `retest:${interval}:${direction}`;
  const scanSlot = await acquireScanSlot({
    tag: scanTag,
    policy: options?.busyPolicy ?? 'queue',
  });
  if (!scanSlot) {
    options?.onStatus?.('다른 스캔이 진행 중이라 이번 스캔은 건너뜀', 'warn');
    return;
  }
  if (scanSlot.waitedMs >= 200) {
    options?.onStatus?.(`다른 스캔 종료 대기 후 시작 (${(scanSlot.waitedMs / 1000).toFixed(1)}s)`, 'info');
  }

  const total = symbols.length;
  let done = 0;
  if (total === 0) { scanSlot.release(); return; }

  const concurrency = Math.max(1, options?.concurrency ?? 3);
  const delayMs = Math.max(0, options?.delayMs ?? 200);
  const queue = [...symbols];

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const sym = queue.shift();
      if (!sym) return;
      try {
        const result = await scanSymbolRetest(sym, interval, direction, retestOpts, signal);
        if (result) onResult(result);
      } catch { /* swallow per-symbol errors */ } finally {
        done++;
        onProgress(done, total);
      }
      if (!signal?.aborted) await new Promise(r => setTimeout(r, delayMs));
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    scanSlot.release();
  }
}

// ── Public scan function (ScanFn-compatible, uses defaults) ────────────────

export async function runLeaderRetestScan(
  symbols: string[],
  interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  signal?: AbortSignal,
  options?: ScanOptions,
): Promise<void> {
  return runLeaderRetestScanInternal(
    symbols, interval, direction, onProgress, onResult,
    DEFAULT_RETEST_OPTIONS, signal, options,
  );
}

/**
 * Factory: creates a ScanFn with custom retest options baked in.
 * Used by useAltAutoTrade when the auto-trade settings include retest params.
 */
export function createLeaderRetestScan(retestOptions?: RetestOptions): ScanFn {
  // Filter out undefined values so they don't override DEFAULT_RETEST_OPTIONS
  const defined = retestOptions
    ? Object.fromEntries(Object.entries(retestOptions).filter(([, v]) => v !== undefined))
    : {};
  const opts: Required<RetestOptions> = {
    ...DEFAULT_RETEST_OPTIONS,
    ...defined,
  };
  return (symbols, interval, direction, onProgress, onResult, signal, options) =>
    runLeaderRetestScanInternal(symbols, interval, direction, onProgress, onResult, opts, signal, options);
}

export const leaderRetestStrategy: ScanStrategy = {
  id: 'leader-retest',
  label: '리더-리테스트',
  scan: runLeaderRetestScan,
};
