import type { Candle } from '../../types/candle';
import type { TrendlineDrawing, HlineDrawing, BoxDrawing, BoxCorner, Drawing } from '../../types/drawing';
import { calcSRLevels } from './supportResistance';
import type { LevelZone } from './supportResistance';
import { calcHVN } from './volumeProfile';
import type { HVNZone } from './volumeProfile';

export type ScanInterval = '15m' | '1h' | '4h' | '1d';
export type ScanDirection = 'both' | 'long' | 'short';

export interface DrawingGroups {
  breakout: Drawing[];  // detected pattern (trendline / hline / box)
  dimSR: Drawing[];     // all SR hlines dimmed (for "전체" mode)
  topSR: Drawing[];     // top 1-2 SR hlines bright
  hvn: Drawing[];       // HVN box drawings
  entryLines: Drawing[];// Entry / SL / TP hlines
}

export interface ScanCandidate {
  symbol: string;
  direction: 'long' | 'short';
  score: number;
  entryPrice: number;
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
}

// ── Utilities ──────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt(p: number) { return p >= 1 ? p.toFixed(2) : p.toFixed(6); }

async function fetchKlines(
  symbol: string,
  interval: ScanInterval,
  limit: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`klines ${symbol} ${res.status}`);
  const raw = await res.json() as unknown[][];
  return raw.map(r => ({
    time: r[0] as number,
    open: parseFloat(r[1] as string),
    high: parseFloat(r[2] as string),
    low: parseFloat(r[3] as string),
    close: parseFloat(r[4] as string),
    volume: parseFloat(r[5] as string),
  }));
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

function calcVolRatio(candles: Candle[], period = 20): number {
  if (candles.length < period + 1) return 1;
  const recent = candles[candles.length - 1].volume;
  const sma = candles.slice(-period - 1, -1).reduce((a, c) => a + c.volume, 0) / period;
  return sma > 0 ? recent / sma : 1;
}

function calcScore(volRatio: number, bbWidth: number, atr: number, entryPrice: number): number {
  const volScore = Math.min(40, (volRatio / 2) * 40);
  const bbScore = bbWidth < 0.04 ? 30 : bbWidth < 0.08 ? 20 : bbWidth < 0.15 ? 10 : 5;
  const atrPct = entryPrice > 0 ? (atr / entryPrice) * 100 : 0;
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

// ── Breakout detection (stage 1 — 200 candles) ────────────────────────────
interface BreakoutResult {
  type: 'trendline' | 'hline' | 'box';
  drawing: TrendlineDrawing | HlineDrawing | BoxDrawing;
  breakoutPrice: number;
}

function detectTrendline(symbol: string, candles: Candle[], dir: 'long' | 'short'): BreakoutResult | null {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  if (dir === 'long') {
    const highs = pivotHighs(candles.slice(0, -1)).slice(-5);
    if (highs.length < 2) return null;
    for (let i = highs.length - 1; i >= 1; i--) {
      const h2 = highs[i], h1 = highs[i - 1];
      if (h2.price >= h1.price) continue;
      const dt = h2.time - h1.time;
      if (dt <= 0) continue;
      const slope = (h2.price - h1.price) / dt;
      if (prev.close < h2.price + slope * (prev.time - h2.time) &&
          last.close > h2.price + slope * (last.time - h2.time)) {
        return {
          type: 'trendline',
          drawing: { id: uid(), type: 'trendline', ticker: symbol, slope, color: '#f6465d',
            p1: { time: h1.time, price: h1.price }, p2: { time: h2.time, price: h2.price },
            memo: '⑦ 저항선 돌파 ↑' } satisfies TrendlineDrawing,
          breakoutPrice: last.close,
        };
      }
    }
  } else {
    const lows = pivotLows(candles.slice(0, -1)).slice(-5);
    if (lows.length < 2) return null;
    for (let i = lows.length - 1; i >= 1; i--) {
      const l2 = lows[i], l1 = lows[i - 1];
      if (l2.price <= l1.price) continue;
      const dt = l2.time - l1.time;
      if (dt <= 0) continue;
      const slope = (l2.price - l1.price) / dt;
      if (prev.close > l2.price + slope * (prev.time - l2.time) &&
          last.close < l2.price + slope * (last.time - l2.time)) {
        return {
          type: 'trendline',
          drawing: { id: uid(), type: 'trendline', ticker: symbol, slope, color: '#0ecb81',
            p1: { time: l1.time, price: l1.price }, p2: { time: l2.time, price: l2.price },
            memo: '⑦ 지지선 이탈 ↓' } satisfies TrendlineDrawing,
          breakoutPrice: last.close,
        };
      }
    }
  }
  return null;
}

function detectHline(symbol: string, candles: Candle[], dir: 'long' | 'short', atr: number): BreakoutResult | null {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const tol = atr * 0.5;

  const pivots = dir === 'long'
    ? [...pivotHighs(candles.slice(0, -1)).slice(-10)].reverse()
    : [...pivotLows(candles.slice(0, -1)).slice(-10)].reverse();

  for (const pt of pivots) {
    if (dir === 'long' && prev.close < pt.price - tol && last.close > pt.price + tol) {
      return {
        type: 'hline',
        drawing: { id: uid(), type: 'hline', ticker: symbol, price: pt.price,
          color: '#f6465d', memo: `⑦ 수평 저항 돌파 ↑ ${fmt(pt.price)}` } satisfies HlineDrawing,
        breakoutPrice: last.close,
      };
    }
    if (dir === 'short' && prev.close > pt.price + tol && last.close < pt.price - tol) {
      return {
        type: 'hline',
        drawing: { id: uid(), type: 'hline', ticker: symbol, price: pt.price,
          color: '#0ecb81', memo: `⑦ 수평 지지 이탈 ↓ ${fmt(pt.price)}` } satisfies HlineDrawing,
        breakoutPrice: last.close,
      };
    }
  }
  return null;
}

function detectBox(symbol: string, candles: Candle[], dir: 'long' | 'short', atr: number): BreakoutResult | null {
  if (candles.length < 30) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lb = candles.slice(-31, -1);
  const highP = Math.max(...lb.map(c => c.high));
  const lowP = Math.min(...lb.map(c => c.low));
  if (highP - lowP > atr * 3) return null;

  const t1 = lb[0].time, t2 = lb[lb.length - 1].time;
  const makeCorners = (): BoxCorner[] => [
    { pos: 'TL', time: t1, price: highP }, { pos: 'TR', time: t2, price: highP },
    { pos: 'BR', time: t2, price: lowP },  { pos: 'BL', time: t1, price: lowP },
  ];

  if (dir === 'long' && prev.close <= highP && last.close > highP + atr * 0.2) {
    return {
      type: 'box',
      drawing: { id: uid(), type: 'box', ticker: symbol, color: '#f6465d',
        p1: { time: t1, price: highP }, p2: { time: t2, price: lowP },
        corners: makeCorners(), topPrice: highP, bottomPrice: lowP,
        memo: '⑦ 박스 상단 돌파 ↑' } satisfies BoxDrawing,
      breakoutPrice: last.close,
    };
  }
  if (dir === 'short' && prev.close >= lowP && last.close < lowP - atr * 0.2) {
    return {
      type: 'box',
      drawing: { id: uid(), type: 'box', ticker: symbol, color: '#0ecb81',
        p1: { time: t1, price: highP }, p2: { time: t2, price: lowP },
        corners: makeCorners(), topPrice: highP, bottomPrice: lowP,
        memo: '⑦ 박스 하단 이탈 ↓' } satisfies BoxDrawing,
      breakoutPrice: last.close,
    };
  }
  return null;
}

// ── Level-based SL / TP ────────────────────────────────────────────────────
function calcSLTP(
  entryPrice: number,
  direction: 'long' | 'short',
  srLevels: LevelZone[],
  hvnZones: HVNZone[],
  atr: number,
  candles: Candle[],
): { sl: number; tp1: number | undefined; tp2: number } {
  const slice50 = candles.slice(-51, -1);
  const swingLow = Math.min(...slice50.map(c => c.low));
  const swingHigh = Math.max(...slice50.map(c => c.high));

  if (direction === 'long') {
    const bestSup = srLevels
      .filter(z => z.kind === 'support' && z.centerPrice < entryPrice)
      .sort((a, b) => b.score - a.score)[0];
    const sl1 = bestSup && (entryPrice - bestSup.zoneBottom) <= 3 * atr ? bestSup.zoneBottom : undefined;
    const sl = sl1 ?? Math.min(entryPrice - atr, swingLow);
    const R = entryPrice - sl;

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
    const sl = sl1 ?? Math.max(entryPrice + atr, swingHigh);
    const R = sl - entryPrice;

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

// ── Build drawing groups ───────────────────────────────────────────────────
function buildDrawingGroups(
  symbol: string,
  direction: 'long' | 'short',
  breakoutResult: BreakoutResult,
  candles: Candle[],
  srLevels: LevelZone[],
  hvnZones: HVNZone[],
  topLevels: LevelZone[],
  entryPrice: number,
  sl: number,
  tp1: number | undefined,
  tp2: number,
  atr: number,
): DrawingGroups {
  const n = candles.length;
  const boxT1 = candles[Math.floor(n * 0.5)].time;
  const boxT2 = candles[n - 1].time;

  // dim color helpers
  const dimClr = (kind: string) =>
    kind === 'support' ? 'rgba(14,203,129,0.22)' : 'rgba(246,70,93,0.22)';
  const brightClr = (kind: string) =>
    kind === 'support' ? 'rgba(14,203,129,0.90)' : 'rgba(246,70,93,0.90)';

  const topSet = new Set(topLevels.map(z => z.centerPrice));
  const sorted = [...srLevels].sort((a, b) => b.score - a.score);

  const dimSR: Drawing[] = [
    ...sorted.filter(z => z.kind === 'support').slice(0, 10),
    ...sorted.filter(z => z.kind === 'resistance').slice(0, 10),
  ]
    .filter(z => !topSet.has(z.centerPrice))
    .map(z => ({
      id: uid(), type: 'hline' as const, ticker: symbol,
      price: z.centerPrice,
      color: dimClr(z.kind),
      memo: `${z.horizon} ${z.kind} · touches=${z.touches} · score=${z.score}`,
    } satisfies HlineDrawing));

  const topSR: Drawing[] = topLevels.map(z => ({
    id: uid(), type: 'hline' as const, ticker: symbol,
    price: z.centerPrice,
    color: brightClr(z.kind),
    memo: `${z.kind === 'support' ? '⑤' : '⑥'} ★ ${z.horizon} ${z.kind === 'support' ? '지지' : '저항'} · ${z.touches}회 터치 · score=${z.score}`,
  } satisfies HlineDrawing));

  // HVN boxes near entry ±3%
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

  // Entry / SL / TP lines
  const isLong = direction === 'long';
  const R = Math.abs(entryPrice - sl);
  const rr = R > 0 ? Math.abs(tp2 - entryPrice) / R : 0;
  const volFactor = (atr / entryPrice) > 0.015 ? 1.5 : 1.3;
  const entryMemo =
    `${isLong ? '▲ 롱' : '▼ 숏'} 진입 · 종가 기준 ${isLong ? '돌파' : '이탈'} 시 진입 · 거래량≥SMA20×${volFactor} · RR≈${rr.toFixed(1)}`;

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
  // Stage 1: 200 candles for fast breakout detection
  const candles200 = await fetchKlines(symbol, interval, 200, signal);
  if (candles200.length < 50) return null;

  const atr200 = calcATR(candles200);
  const volRatio = calcVolRatio(candles200);
  const bbWidth = calcBBWidth(candles200);
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

  // Stage 2: 500 candles for deep SR + HVN analysis
  const candles500 = await fetchKlines(symbol, interval, 500, signal);
  const atr = calcATR(candles500);
  const entryPrice = found.breakoutPrice;

  const srLevels = calcSRLevels(candles500, atr, entryPrice);
  const hvnZones = calcHVN(candles500.slice(-300), 100, 5, entryPrice);

  const { sl, tp1, tp2 } = calcSLTP(entryPrice, foundDir, srLevels, hvnZones, atr, candles500);

  const topLevels = [
    ...srLevels.filter(z => z.kind === 'support').sort((a, b) => b.score - a.score).slice(0, 1),
    ...srLevels.filter(z => z.kind === 'resistance').sort((a, b) => b.score - a.score).slice(0, 1),
  ];

  const drawingGroups = buildDrawingGroups(
    symbol, foundDir, found, candles500, srLevels, hvnZones, topLevels,
    entryPrice, sl, tp1, tp2, atr,
  );

  return {
    symbol, direction: foundDir,
    score: calcScore(volRatio, bbWidth, atr, entryPrice),
    entryPrice, slPrice: sl, tpPrice: tp2, tp1Price: tp1,
    atr, breakoutType: found.type,
    srLevels, hvnZones, topLevels, drawingGroups,
    candles: candles500,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function runBreakoutScan(
  symbols: string[],
  interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = symbols.length;
  let done = 0;
  const queue = [...symbols];
  const CONCURRENCY = 6;

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
      if (!signal?.aborted) await new Promise(r => setTimeout(r, 120));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}
