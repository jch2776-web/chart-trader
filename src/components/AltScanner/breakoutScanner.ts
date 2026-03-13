import type { Candle } from '../../types/candle';
import type { TrendlineDrawing, HlineDrawing, BoxDrawing, BoxCorner, Drawing } from '../../types/drawing';
import { calcSRLevels } from './supportResistance';
import type { LevelZone } from './supportResistance';
import { calcHVN } from './volumeProfile';
import type { HVNZone } from './volumeProfile';
import {
  intervalToMs, getTtlBars, getVolFactor, triggerPrice,
  type TriggerSpec,
} from './timeUtils';
import { fetchBinanceKlinesCached } from '../../lib/binanceKlineCache';
import { acquireScanSlot, getBinanceGovernorSnapshot } from '../../lib/binanceRequestGovernor';

export type ScanInterval = '15m' | '1h' | '4h' | '1d';
export type ScanDirection = 'both' | 'long' | 'short';
export type CandidateStatus = 'PENDING' | 'TRIGGERED' | 'INVALID' | 'EXPIRED';

export interface DrawingGroups {
  breakout: Drawing[];
  dimSR: Drawing[];
  topSR: Drawing[];
  hvn: Drawing[];
  entryLines: Drawing[];
}

export interface ScanCandidate {
  symbol: string;
  direction: 'long' | 'short';
  score: number;
  entryPrice: number;       // lastClosed.close at scan time (SL/TP reference)
  slPrice: number;
  tpPrice: number;
  tp1Price?: number;
  atr: number;
  breakoutType: 'trendline' | 'hline' | 'box';
  srLevels: LevelZone[];
  hvnZones: HVNZone[];
  topLevels: LevelZone[];
  drawingGroups: DrawingGroups;
  candles: Candle[];

  // ── new fields ────────────────────────────────────────────────────────────
  interval: ScanInterval;
  volFactor: number;

  // TTL / validity
  status: CandidateStatus;
  asOfCloseTime: number;      // ms — close time of last confirmed candle at scan
  validBars: number;
  validUntilTime: number;     // ms — asOfCloseTime + validBars * intervalMs
  nextCandleCloseTime: number;// ms — next expected candle close
  triggerPriceAtNextClose: number; // trigger level projected to nextCandleCloseTime

  // Trigger spec (for future price evaluation)
  triggerSpec: TriggerSpec;

  // Mutable status fields (updated by revalidation)
  triggeredAt?: number;
  invalidReason?: string;
  expiredReason?: string;
  distanceNowPct?: number;
}

// ── Utilities ──────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt(p: number) { return p >= 1 ? p.toFixed(2) : p.toFixed(6); }

const SAFETY_MS = 4000; // buffer to treat a candle as "closed"

async function fetchKlines(
  symbol: string,
  interval: ScanInterval,
  limit: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  return fetchBinanceKlinesCached(symbol, interval, limit, signal);
}

// ── Closed-candle filtering ────────────────────────────────────────────────

/**
 * Strip the in-progress (current) candle if it hasn't closed yet.
 * Returns only confirmed closed candles.
 */
function closedOnly(candles: Candle[], intervalMs: number): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const isClosed = (last.time + intervalMs) <= (Date.now() - SAFETY_MS);
  return isClosed ? candles : candles.slice(0, -1);
}

// ── Indicators ─────────────────────────────────────────────────────────────
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

function calcBBWidth(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period).map(c => c.close);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return mean > 0 ? (4 * std) / mean : 0;
}

/**
 * Volume ratio: lastClosed.volume / SMA20(volume, excluding lastClosed)
 */
function calcVolRatio(candles: Candle[], period = 20): number {
  if (candles.length < period + 1) return 1;
  const recent = candles[candles.length - 1].volume;
  const sma = candles.slice(-period - 1, -1).reduce((a, c) => a + c.volume, 0) / period;
  return sma > 0 ? recent / sma : 1;
}

/** SMA20 of volume for the 20 candles before the last element */
function calcSMA20Volume(candles: Candle[], period = 20): number {
  if (candles.length < period + 1) return 0;
  return candles.slice(-period - 1, -1).reduce((a, c) => a + c.volume, 0) / period;
}

function calcScore(volRatio: number, bbWidth: number, atr: number, entryPrice: number): number {
  const volScore = Math.min(40, (volRatio / 2) * 40);
  const bbScore  = bbWidth < 0.04 ? 30 : bbWidth < 0.08 ? 20 : bbWidth < 0.15 ? 10 : 5;
  const atrPct   = entryPrice > 0 ? (atr / entryPrice) * 100 : 0;
  const atrScore = atrPct > 2 ? 30 : atrPct > 1 ? 20 : atrPct > 0.5 ? 10 : 5;
  return Math.round(Math.min(100, volScore + bbScore + atrScore));
}

// ── Pivot helpers ──────────────────────────────────────────────────────────
interface PivotPt { index: number; price: number; time: number; }

function pivotHighs(candles: Candle[], w = 2): PivotPt[] {
  const result: PivotPt[] = [];
  for (let i = w; i < candles.length - w; i++) {
    const h = candles[i].high;
    let ok = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j !== i && candles[j].high >= h) { ok = false; break; }
    }
    if (ok) result.push({ index: i, price: h, time: candles[i].time });
  }
  return result;
}

function pivotLows(candles: Candle[], w = 2): PivotPt[] {
  const result: PivotPt[] = [];
  for (let i = w; i < candles.length - w; i++) {
    const l = candles[i].low;
    let ok = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j !== i && candles[j].low <= l) { ok = false; break; }
    }
    if (ok) result.push({ index: i, price: l, time: candles[i].time });
  }
  return result;
}

// ── Breakout detection (works on confirmed closed candles only) ─────────────
interface BreakoutResult {
  type: 'trendline' | 'hline' | 'box';
  drawing: TrendlineDrawing | HlineDrawing | BoxDrawing;
  breakoutPrice: number;
  triggerSpec: TriggerSpec;
}

/**
 * All detect functions receive `closed` — an array of confirmed closed candles
 * where [last] = lastClosed, [last-1] = prevClosed.
 * pivot detection intentionally excludes lastClosed (slice(0,-1)).
 */
function detectTrendline(symbol: string, closed: Candle[], dir: 'long' | 'short'): BreakoutResult | null {
  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];

  if (dir === 'long') {
    const highs = pivotHighs(closed.slice(0, -1)).slice(-5);
    if (highs.length < 2) return null;
    for (let i = highs.length - 1; i >= 1; i--) {
      const h2 = highs[i], h1 = highs[i - 1];
      if (h2.price >= h1.price) continue;
      const dt = h2.time - h1.time;
      if (dt <= 0) continue;
      const slope = (h2.price - h1.price) / dt;
      const trendAtPrev = h2.price + slope * (prev.time - h2.time);
      const trendAtLast = h2.price + slope * (last.time - h2.time);
      if (prev.close < trendAtPrev && last.close > trendAtLast) {
        return {
          type: 'trendline',
          drawing: {
            id: uid(), type: 'trendline', ticker: symbol, slope, color: '#f6465d',
            p1: { time: h1.time, price: h1.price }, p2: { time: h2.time, price: h2.price },
            memo: '⑦ 저항선 돌파 ↑',
          } satisfies TrendlineDrawing,
          breakoutPrice: last.close,
          triggerSpec: { type: 'trendline', fixedPrice: last.close, slope, p1Time: h1.time, p1Price: h1.price },
        };
      }
    }
  } else {
    const lows = pivotLows(closed.slice(0, -1)).slice(-5);
    if (lows.length < 2) return null;
    for (let i = lows.length - 1; i >= 1; i--) {
      const l2 = lows[i], l1 = lows[i - 1];
      if (l2.price <= l1.price) continue;
      const dt = l2.time - l1.time;
      if (dt <= 0) continue;
      const slope = (l2.price - l1.price) / dt;
      const trendAtPrev = l2.price + slope * (prev.time - l2.time);
      const trendAtLast = l2.price + slope * (last.time - l2.time);
      if (prev.close > trendAtPrev && last.close < trendAtLast) {
        return {
          type: 'trendline',
          drawing: {
            id: uid(), type: 'trendline', ticker: symbol, slope, color: '#0ecb81',
            p1: { time: l1.time, price: l1.price }, p2: { time: l2.time, price: l2.price },
            memo: '⑦ 지지선 이탈 ↓',
          } satisfies TrendlineDrawing,
          breakoutPrice: last.close,
          triggerSpec: { type: 'trendline', fixedPrice: last.close, slope, p1Time: l1.time, p1Price: l1.price },
        };
      }
    }
  }
  return null;
}

function detectHline(symbol: string, closed: Candle[], dir: 'long' | 'short', atr: number): BreakoutResult | null {
  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  const tol  = atr * 0.5;

  const pivots = dir === 'long'
    ? [...pivotHighs(closed.slice(0, -1)).slice(-10)].reverse()
    : [...pivotLows(closed.slice(0, -1)).slice(-10)].reverse();

  for (const pt of pivots) {
    if (dir === 'long' && prev.close < pt.price - tol && last.close > pt.price + tol) {
      return {
        type: 'hline',
        drawing: {
          id: uid(), type: 'hline', ticker: symbol, price: pt.price,
          color: '#f6465d', memo: `⑦ 수평 저항 돌파 ↑ ${fmt(pt.price)}`,
        } satisfies HlineDrawing,
        breakoutPrice: last.close,
        triggerSpec: { type: 'hline', fixedPrice: pt.price, slope: 0, p1Time: 0, p1Price: 0 },
      };
    }
    if (dir === 'short' && prev.close > pt.price + tol && last.close < pt.price - tol) {
      return {
        type: 'hline',
        drawing: {
          id: uid(), type: 'hline', ticker: symbol, price: pt.price,
          color: '#0ecb81', memo: `⑦ 수평 지지 이탈 ↓ ${fmt(pt.price)}`,
        } satisfies HlineDrawing,
        breakoutPrice: last.close,
        triggerSpec: { type: 'hline', fixedPrice: pt.price, slope: 0, p1Time: 0, p1Price: 0 },
      };
    }
  }
  return null;
}

function detectBox(symbol: string, closed: Candle[], dir: 'long' | 'short', atr: number): BreakoutResult | null {
  if (closed.length < 30) return null;
  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  const lb   = closed.slice(-31, -1);
  const highP = Math.max(...lb.map(c => c.high));
  const lowP  = Math.min(...lb.map(c => c.low));
  if (highP - lowP > atr * 3) return null;

  const t1 = lb[0].time, t2 = lb[lb.length - 1].time;
  const makeCorners = (): BoxCorner[] => [
    { pos: 'TL', time: t1, price: highP }, { pos: 'TR', time: t2, price: highP },
    { pos: 'BR', time: t2, price: lowP  }, { pos: 'BL', time: t1, price: lowP  },
  ];

  if (dir === 'long' && prev.close <= highP && last.close > highP + atr * 0.2) {
    return {
      type: 'box',
      drawing: {
        id: uid(), type: 'box', ticker: symbol, color: '#f6465d',
        p1: { time: t1, price: highP }, p2: { time: t2, price: lowP },
        corners: makeCorners(), topPrice: highP, bottomPrice: lowP,
        memo: '⑦ 박스 상단 돌파 ↑',
      } satisfies BoxDrawing,
      breakoutPrice: last.close,
      triggerSpec: { type: 'box', fixedPrice: highP, slope: 0, p1Time: 0, p1Price: 0 },
    };
  }
  if (dir === 'short' && prev.close >= lowP && last.close < lowP - atr * 0.2) {
    return {
      type: 'box',
      drawing: {
        id: uid(), type: 'box', ticker: symbol, color: '#0ecb81',
        p1: { time: t1, price: highP }, p2: { time: t2, price: lowP },
        corners: makeCorners(), topPrice: highP, bottomPrice: lowP,
        memo: '⑦ 박스 하단 이탈 ↓',
      } satisfies BoxDrawing,
      breakoutPrice: last.close,
      triggerSpec: { type: 'box', fixedPrice: lowP, slope: 0, p1Time: 0, p1Price: 0 },
    };
  }
  return null;
}

// ── SL / TP calculation ────────────────────────────────────────────────────
function calcSLTP(
  entryPrice: number, direction: 'long' | 'short',
  srLevels: LevelZone[], hvnZones: HVNZone[], atr: number, candles: Candle[],
): { sl: number; tp1: number | undefined; tp2: number } {
  const slice50  = candles.slice(-51, -1);
  const swingLow  = Math.min(...slice50.map(c => c.low));
  const swingHigh = Math.max(...slice50.map(c => c.high));

  if (direction === 'long') {
    const bestSup = srLevels
      .filter(z => z.kind === 'support' && z.centerPrice < entryPrice)
      .sort((a, b) => b.score - a.score)[0];
    const sl1 = bestSup && (entryPrice - bestSup.zoneBottom) <= 3 * atr ? bestSup.zoneBottom : undefined;
    const sl  = sl1 ?? Math.min(entryPrice - atr, swingLow);
    const R   = entryPrice - sl;
    const tp1Cands = [
      srLevels.filter(z => z.kind === 'resistance' && z.centerPrice > entryPrice)
        .sort((a, b) => a.centerPrice - b.centerPrice)[0]?.centerPrice,
      hvnZones.filter(z => z.centerPrice > entryPrice)
        .sort((a, b) => a.centerPrice - b.centerPrice)[0]?.centerPrice,
    ].filter((p): p is number => p !== undefined).sort((a, b) => a - b);
    let tp1: number | undefined = tp1Cands[0];
    if (tp1 !== undefined && tp1 - entryPrice < R) tp1 = undefined;
    return { sl, tp1, tp2: entryPrice + 2 * R };
  } else {
    const bestRes = srLevels
      .filter(z => z.kind === 'resistance' && z.centerPrice > entryPrice)
      .sort((a, b) => b.score - a.score)[0];
    const sl1 = bestRes && (bestRes.zoneTop - entryPrice) <= 3 * atr ? bestRes.zoneTop : undefined;
    const sl  = sl1 ?? Math.max(entryPrice + atr, swingHigh);
    const R   = sl - entryPrice;
    const tp1Cands = [
      srLevels.filter(z => z.kind === 'support' && z.centerPrice < entryPrice)
        .sort((a, b) => b.centerPrice - a.centerPrice)[0]?.centerPrice,
      hvnZones.filter(z => z.centerPrice < entryPrice)
        .sort((a, b) => b.centerPrice - a.centerPrice)[0]?.centerPrice,
    ].filter((p): p is number => p !== undefined).sort((a, b) => b - a);
    let tp1: number | undefined = tp1Cands[0];
    if (tp1 !== undefined && entryPrice - tp1 < R) tp1 = undefined;
    return { sl, tp1, tp2: entryPrice - 2 * R };
  }
}

// ── Drawing groups ─────────────────────────────────────────────────────────
function buildDrawingGroups(
  symbol: string, direction: 'long' | 'short',
  breakoutResult: BreakoutResult, candles: Candle[],
  srLevels: LevelZone[], hvnZones: HVNZone[], topLevels: LevelZone[],
  entryPrice: number, sl: number, tp1: number | undefined, tp2: number,
  volFactor: number,
): DrawingGroups {
  const n = candles.length;
  const boxT1 = candles[Math.floor(n * 0.5)].time;
  const boxT2 = candles[n - 1].time;

  const dimClr    = (kind: string) => kind === 'support' ? 'rgba(14,203,129,0.22)' : 'rgba(246,70,93,0.22)';
  const brightClr = (kind: string) => kind === 'support' ? 'rgba(14,203,129,0.90)' : 'rgba(246,70,93,0.90)';
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

  const isLong = direction === 'long';
  const R  = Math.abs(entryPrice - sl);
  const rr = R > 0 ? Math.abs(tp2 - entryPrice) / R : 0;
  const entryMemo = `${isLong ? '▲ 롱' : '▼ 숏'} 진입 · 종가 기준 ${isLong ? '돌파' : '이탈'} 시 진입 · 거래량≥SMA20(20봉)×${volFactor} · RR≈${rr.toFixed(1)}`;

  const entryLines: Drawing[] = [
    {
      id: uid(), type: 'hline', ticker: symbol, price: entryPrice,
      color: '#f0b90b', memo: `① ${entryMemo}`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: sl,
      color: '#f6465d',
      memo: `④ SL ${fmt(sl)} · ${isLong ? '구조 지지 존' : '구조 저항 존'} + ATR`,
    } satisfies HlineDrawing,
    ...(tp1 !== undefined ? [{
      id: uid(), type: 'hline' as const, ticker: symbol, price: tp1,
      color: 'rgba(14,203,129,0.65)',
      memo: `③ TP1 ${fmt(tp1)} · 1차 목표 (다음 레벨)`,
    } satisfies HlineDrawing] : []),
    {
      id: uid(), type: 'hline', ticker: symbol, price: tp2,
      color: '#0ecb81', memo: `② TP2 ${fmt(tp2)} · 최종 목표 RR=2`,
    } satisfies HlineDrawing,
  ];

  return { breakout: [breakoutResult.drawing], dimSR, topSR, hvn, entryLines };
}

// ── Scan one symbol ────────────────────────────────────────────────────────
async function scanSymbol(
  symbol: string,
  interval: ScanInterval,
  direction: ScanDirection,
  signal?: AbortSignal,
): Promise<ScanCandidate | null> {
  const iMs = intervalToMs(interval);

  // Stage 1: fetch 202 candles, strip the in-progress one
  const raw200 = await fetchKlines(symbol, interval, 202, signal);
  if (raw200.length < 52) return null;
  const candles200 = closedOnly(raw200, iMs);
  if (candles200.length < 50) return null;

  const lastClosed = candles200[candles200.length - 1];
  const prevClosed = candles200[candles200.length - 2];
  const lastClosedCloseTime = lastClosed.time + iMs;

  const atr200    = calcATR(candles200);
  const volRatio  = calcVolRatio(candles200);
  const bbWidth   = calcBBWidth(candles200);
  const dirs: ('long' | 'short')[] = direction === 'both' ? ['long', 'short'] : [direction];

  let found: BreakoutResult | null = null;
  let foundDir: 'long' | 'short' = 'long';
  for (const dir of dirs) {
    const r = detectTrendline(symbol, candles200, dir)
      ?? detectHline(symbol, candles200, dir, atr200)
      ?? detectBox(symbol, candles200, dir, atr200);
    if (r) { found = r; foundDir = dir; break; }
  }
  if (!found) return null;

  // Stage 2: 502 candles for SR + HVN (strip in-progress)
  const raw500 = await fetchKlines(symbol, interval, 502, signal);
  const candles500 = closedOnly(raw500, iMs);
  const atr = calcATR(candles500);

  const entryPrice = lastClosed.close; // confirmed close price
  const srLevels   = calcSRLevels(candles500, atr, entryPrice);
  const hvnZones   = calcHVN(candles500.slice(-300), 100, 5, entryPrice);
  const { sl, tp1, tp2 } = calcSLTP(entryPrice, foundDir, srLevels, hvnZones, atr, candles500);

  const topLevels = [
    ...srLevels.filter(z => z.kind === 'support').sort((a, b) => b.score - a.score).slice(0, 1),
    ...srLevels.filter(z => z.kind === 'resistance').sort((a, b) => b.score - a.score).slice(0, 1),
  ];

  // ── TTL / trigger spec ────────────────────────────────────────────────────
  const vf      = getVolFactor(interval);
  const spec = found.triggerSpec;
  const validBars             = getTtlBars(interval);
  const nextCandleCloseTime   = lastClosedCloseTime + iMs;
  const validUntilTime        = lastClosedCloseTime + validBars * iMs;
  const triggerAtNextClose    = triggerPrice(spec, nextCandleCloseTime);

  const drawingGroups = buildDrawingGroups(
    symbol, foundDir, found, candles500, srLevels, hvnZones, topLevels,
    entryPrice, sl, tp1, tp2, vf,
  );

  // ── Initial status (volume check on lastClosed) ───────────────────────────
  const sma20v  = calcSMA20Volume(candles200);
  const volMet  = lastClosed.volume >= sma20v * vf && lastClosed.volume >= prevClosed.volume;

  // Cross-over already confirmed by detect functions; status depends on volume
  const triggerAtLast = triggerPrice(spec, lastClosedCloseTime);
  const triggerAtPrev = triggerPrice(spec, prevClosed.time + iMs);
  const crossover = foundDir === 'long'
    ? (lastClosed.close > triggerAtLast && prevClosed.close <= triggerAtPrev)
    : (lastClosed.close < triggerAtLast && prevClosed.close >= triggerAtPrev);

  const initialStatus: CandidateStatus = (crossover && volMet) ? 'TRIGGERED' : 'PENDING';

  // Initial distance-to-trigger
  const distanceNowPct = foundDir === 'long'
    ? ((triggerAtLast - lastClosed.close) / triggerAtLast) * 100
    : ((lastClosed.close - triggerAtLast) / triggerAtLast) * 100;

  return {
    symbol, direction: foundDir,
    score: calcScore(volRatio, bbWidth, atr, entryPrice),
    entryPrice, slPrice: sl, tpPrice: tp2, tp1Price: tp1,
    atr, breakoutType: found.type,
    srLevels, hvnZones, topLevels, drawingGroups,
    candles: candles500,
    // new fields
    interval,
    volFactor: vf,
    status: initialStatus,
    asOfCloseTime: lastClosedCloseTime,
    validBars,
    validUntilTime,
    nextCandleCloseTime,
    triggerPriceAtNextClose: triggerAtNextClose,
    triggerSpec: spec,
    triggeredAt: initialStatus === 'TRIGGERED' ? lastClosedCloseTime : undefined,
    distanceNowPct,
  };
}

// ── Rate-limit budget ──────────────────────────────────────────────────────
// Each symbol scan fetches 2 kline batches:
//   limit=202  → weight 2  (100–499 range)
//   limit=502  → weight 5  (500–999 range)
//   total per symbol = 7 weight
//
// Binance Futures IP weight limit: 2400 / minute = 40 weight/sec (rolling)
// Safe symbol throughput: 40 / 7 ≈ 5.7 symbols/sec
//
// Default (manual scan):  concurrency=3, delayMs=350 → ~3/(350+avg_http≈250)ms ≈ 5 sym/s ≈ 35 wt/s ✓
// Auto-trade (scheduled): concurrency=2, delayMs=600 → ~2/(600+250)ms ≈ 2.4 sym/s ≈ 17 wt/s ✓✓

export interface ScanOptions {
  /** Number of parallel workers (default 3). Keep low to avoid rate limits. */
  concurrency?: number;
  /** Milliseconds to wait after each symbol completes before starting the next (default 350). */
  delayMs?: number;
  /** Global scan tag for mutex/logging. */
  scanTag?: string;
  /** Busy behavior when another heavy scan is already running. */
  busyPolicy?: 'queue' | 'skip';
  /** Optional status callback for queue/skip/cooldown messages. */
  onStatus?: (message: string, level: 'info' | 'warn' | 'error') => void;
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function runBreakoutScan(
  symbols: string[],
  interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  signal?: AbortSignal,
  options?: ScanOptions,
): Promise<void> {
  const governorBefore = getBinanceGovernorSnapshot();
  if (governorBefore.cooldownUntil > Date.now()) {
    const remainSec = Math.ceil((governorBefore.cooldownUntil - Date.now()) / 1000);
    options?.onStatus?.(`바이낸스 쿨다운 중(${remainSec}s) — 스캔 일시 중단`, 'warn');
    return;
  }

  const scanTag = options?.scanTag ?? `scan:${interval}:${direction}`;
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
  if (total === 0) {
    scanSlot.release();
    return;
  }

  const baseConcurrency = Math.max(1, options?.concurrency ?? 3);
  const baseDelayMs = Math.max(0, options?.delayMs ?? 350);
  const loadAdaptive =
    total >= 220 ? { c: 1, d: 900 } :
    total >= 120 ? { c: 2, d: 650 } :
    total >= 70 ? { c: 2, d: 500 } :
    { c: baseConcurrency, d: baseDelayMs };
  const governor = getBinanceGovernorSnapshot();
  const concurrency = Math.max(1, Math.min(loadAdaptive.c, governor.scanConcurrencyCap));
  const delayMs = Math.max(loadAdaptive.d, baseDelayMs) + Math.max(0, governor.scanDelayPenaltyMs);

  if (concurrency < baseConcurrency) {
    options?.onStatus?.(`요청 부하 보호로 동시 스캔 수를 ${baseConcurrency}→${concurrency}로 조정`, 'warn');
  }
  if (delayMs > baseDelayMs + 50) {
    options?.onStatus?.(`요청 부하 보호로 심볼 간 지연을 ${delayMs}ms로 조정`, 'info');
  }

  const queue = [...symbols];

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const sym = queue.shift();
      if (!sym) return;
      try {
        const result = await scanSymbol(sym, interval, direction, signal);
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
