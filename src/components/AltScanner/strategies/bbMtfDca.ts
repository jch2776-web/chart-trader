/**
 * BB MTF Dip + Auto Rescue DCA Strategy
 *
 * Entry conditions (LONG only):
 *   1. 1h candle closed below 1h Bollinger Band lower band  (H1 breach)
 *   2. 15m candle closed below 15m Bollinger Band lower band (M15 breach)
 *   3. prevPrev filter: closed[-3] > SMA(maPeriod) on 15m — avoids knife-catching
 *      in an established downtrend
 *   4. Knife-catching gate: closed[-1] > MA × (1 − maxMaDropPct) — rejects
 *      symbols that have already fallen too far from MA
 *
 * Execution:
 *   Entry  — LIMIT at 15m last closed price
 *   SL     — entry − slAtr × ATR
 *   TP1    — 15m BB middle band (SMA(bbPeriod))
 *   TP2    — entry + 2R  (R = entry − SL)
 *   Rescue — up to rescueCount additional limit levels, spaced rescueSpacingAtr × ATR below entry
 *
 * Rescue DCA info is encoded in the ScanCandidate for display and auto-trade use.
 * Actual execution of rescue orders is handled by the auto-trade hook.
 */

import type { Candle } from '../../../types/candle';
import type { HlineDrawing, BoxDrawing, BoxCorner, Drawing } from '../../../types/drawing';
import type {
  ScanCandidate, ScanInterval, ScanDirection, ScanOptions,
  DrawingGroups, CandidateStatus,
} from '../breakoutScanner';
import { calcSRLevels } from '../supportResistance';
import { calcHVN } from '../volumeProfile';
import { intervalToMs, getTtlBars, getVolFactor, triggerPrice } from '../timeUtils';
import { fetchBinanceKlinesCached } from '../../../lib/binanceKlineCache';
import { acquireScanSlot, getBinanceGovernorSnapshot } from '../../../lib/binanceRequestGovernor';
import type { ScanFn, ScanStrategy } from '../strategyTypes';

// ── Options ─────────────────────────────────────────────────────────────────

export interface BbMtfOptions {
  /** Bollinger Band period (default 20) */
  bbPeriod?: number;
  /** Bollinger Band standard deviation multiplier (default 2.0) */
  bbStdDev?: number;
  /** MA period for prevPrev filter (default 50) */
  maPeriod?: number;
  /**
   * Knife-catching gate: reject if close < MA × (1 − maxMaDropPct).
   * Default 0.06 (6% — allow up to 6% drop from MA before declaring free-fall).
   */
  maxMaDropPct?: number;
  /**
   * Minimum 1h BB breach depth as a fraction of the lower band price.
   * Default 0.001 (0.1%).
   */
  minH1BreachFrac?: number;
  /**
   * Minimum 15m BB breach depth as a fraction of the lower band price.
   * Default 0.0005 (0.05%).
   */
  minM15BreachFrac?: number;
  /** ATR multiplier for SL below entry (default 1.5) */
  slAtr?: number;
  /** Number of rescue DCA levels below entry (default 2) */
  rescueCount?: number;
  /** ATR spacing between rescue levels (default 1.0) */
  rescueSpacingAtr?: number;
  /**
   * Maximum total budget as a multiplier of the initial position notional
   * (initial + all rescue levels combined).  Default 3.10.
   * Used for display / sizing guidance; enforcement is in the auto-trade hook.
   */
  maxBudgetMultiplier?: number;
}

const DEFAULT_BB_MTF_OPTIONS: Required<BbMtfOptions> = {
  bbPeriod: 20,
  bbStdDev: 2.0,
  maPeriod: 50,
  maxMaDropPct: 0.06,
  minH1BreachFrac: 0.001,
  minM15BreachFrac: 0.0005,
  slAtr: 1.5,
  rescueCount: 2,
  rescueSpacingAtr: 1.0,
  maxBudgetMultiplier: 3.10,
};

// ── Utilities ────────────────────────────────────────────────────────────────

const SAFETY_MS = 4000;
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt(p: number) { return p >= 1 ? p.toFixed(2) : p.toFixed(6); }

function closedOnly(candles: Candle[], intervalMs: number): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const isClosed = last.time + intervalMs <= Date.now() - SAFETY_MS;
  return isClosed ? candles : candles.slice(0, -1);
}

// ── Indicators ────────────────────────────────────────────────────────────────

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

function calcSMA(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(candles.length - period);
  return slice.reduce((s, c) => s + c.close, 0) / period;
}

/**
 * Calculates Bollinger Bands at the last closed candle.
 * Returns { upper, middle, lower } or null if not enough data.
 */
function calcBB(candles: Candle[], period: number, stdDev: number): { upper: number; middle: number; lower: number } | null {
  if (candles.length < period) return null;
  const slice = candles.slice(candles.length - period);
  const mean = slice.reduce((s, c) => s + c.close, 0) / period;
  const variance = slice.reduce((s, c) => s + (c.close - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd };
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

interface BbBands { upper: number; middle: number; lower: number }

function buildBbMtfDrawings(
  symbol: string,
  entryPrice: number,
  sl: number,
  tp1: number,
  tp2: number,
  bb15m: BbBands,
  bb1h: BbBands,
  rescueLevels: number[],
  candles: Candle[],
): DrawingGroups {
  const R  = Math.abs(entryPrice - sl);
  const rr = R > 0 ? Math.abs(tp2 - entryPrice) / R : 0;

  // ── entryLines: 핵심 진입/청산 레벨 (항상 표시) ──────────────────────────
  const entryLines: Drawing[] = [
    {
      id: uid(), type: 'hline', ticker: symbol, price: entryPrice,
      color: '#f0b90b',
      memo: `① ▲ 롱 BB MTF 딥 진입 · RR≈${rr.toFixed(1)}`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: tp1,
      color: '#0ecb81',
      memo: `② TP1 ${fmt(tp1)} · 15m BB 중심선 복귀`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: tp2,
      color: '#00b4a0',
      memo: `③ TP2 ${fmt(tp2)} · RR≈${rr.toFixed(1)}`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: sl,
      color: '#f6465d',
      memo: `④ SL ${fmt(sl)} · ATR×1.5`,
    } satisfies HlineDrawing,
  ];

  // ── breakout: BB 밴드 컨텍스트 + 구출레벨 (항상 표시) ─────────────────────

  // 15m BB 밴드 배경 박스 (SMA20 ± 2σ 구간을 면적으로 시각화)
  const t1 = candles[0].time;
  const t2 = candles[candles.length - 1].time;
  const bbBoxCorners: BoxCorner[] = [
    { pos: 'TL', time: t1, price: bb15m.upper },
    { pos: 'TR', time: t2, price: bb15m.upper },
    { pos: 'BR', time: t2, price: bb15m.lower },
    { pos: 'BL', time: t1, price: bb15m.lower },
  ];
  const bbBandBox: BoxDrawing = {
    id: uid(), type: 'box', ticker: symbol,
    p1: { time: t1, price: bb15m.upper },
    p2: { time: t2, price: bb15m.lower },
    corners: bbBoxCorners,
    topPrice: bb15m.upper,
    bottomPrice: bb15m.lower,
    color: 'rgba(56,189,248,0.07)',
    memo: `BB 밴드 구간 (15m SMA${DEFAULT_BB_MTF_OPTIONS.bbPeriod}±${DEFAULT_BB_MTF_OPTIONS.bbStdDev}σ)`,
  };

  // 15m BB 하단선 — 침범 트리거 (가장 중요)
  const bb15mLowerLine: HlineDrawing = {
    id: uid(), type: 'hline', ticker: symbol, price: bb15m.lower,
    color: '#38bdf8',
    memo: `⑦ 15m BB 하단 ← 침범 트리거 (SMA${DEFAULT_BB_MTF_OPTIONS.bbPeriod}−${DEFAULT_BB_MTF_OPTIONS.bbStdDev}σ)`,
  };

  // 15m BB 상단선 — 반등 목표 참고
  const bb15mUpperLine: HlineDrawing = {
    id: uid(), type: 'hline', ticker: symbol, price: bb15m.upper,
    color: 'rgba(14,203,129,0.50)',
    memo: `⑧ 15m BB 상단 ${fmt(bb15m.upper)} · 반등 목표`,
  };

  // 1h BB 하단선 — 컨텍스트 침범 레벨
  const bb1hLowerLine: HlineDrawing = {
    id: uid(), type: 'hline', ticker: symbol, price: bb1h.lower,
    color: 'rgba(59,139,235,0.70)',
    memo: `⑨ 1h BB 하단 ${fmt(bb1h.lower)} ← 컨텍스트 침범`,
  };

  // 구출 DCA 레벨
  const rescueLines: Drawing[] = rescueLevels.map((level, i) => ({
    id: uid(), type: 'hline', ticker: symbol, price: level,
    color: 'rgba(155,89,182,0.80)',
    memo: `⑤ 구출DCA ${i + 1}단계 ${fmt(level)}`,
  } satisfies HlineDrawing));

  // ── dimSR: 상세 모드에서만 표시되는 추가 컨텍스트 ──────────────────────────
  const dimSR: Drawing[] = [
    {
      id: uid(), type: 'hline', ticker: symbol, price: bb1h.middle,
      color: 'rgba(240,185,11,0.35)',
      memo: `1h BB 중심선 ${fmt(bb1h.middle)}`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: bb1h.upper,
      color: 'rgba(14,203,129,0.25)',
      memo: `1h BB 상단 ${fmt(bb1h.upper)}`,
    } satisfies HlineDrawing,
  ];

  return {
    breakout: [bbBandBox, bb15mLowerLine, bb15mUpperLine, bb1hLowerLine, ...rescueLines],
    dimSR,
    topSR: [],
    hvn: [],
    entryLines,
  };
}

// ── Scan one symbol ───────────────────────────────────────────────────────────

async function scanSymbolBbMtf(
  symbol: string,
  opts: Required<BbMtfOptions>,
  signal?: AbortSignal,
): Promise<ScanCandidate | null> {
  const iMs1h  = intervalToMs('1h');
  const iMs15m = intervalToMs('15m');

  // Fetch 1h candles (enough for BB + MA)
  const h1Limit = Math.max(opts.bbPeriod, opts.maPeriod) + 10;
  const rawH1 = await fetchBinanceKlinesCached(symbol, '1h', h1Limit, signal);
  if (rawH1.length < opts.bbPeriod + 2) return null;
  const closedH1 = closedOnly(rawH1, iMs1h);
  if (closedH1.length < opts.bbPeriod + 2) return null;

  // 1h BB
  const bb1h = calcBB(closedH1, opts.bbPeriod, opts.bbStdDev);
  if (!bb1h) return null;

  const lastH1 = closedH1[closedH1.length - 1];
  const h1BreachDepth = bb1h.lower - lastH1.close; // positive = below lower band
  if (h1BreachDepth < bb1h.lower * opts.minH1BreachFrac) return null; // not breaching or not deep enough

  // Fetch 15m candles
  const m15Limit = Math.max(opts.bbPeriod, opts.maPeriod) + 20;
  const rawM15 = await fetchBinanceKlinesCached(symbol, '15m', m15Limit, signal);
  if (rawM15.length < opts.maPeriod + 5) return null;
  const closedM15 = closedOnly(rawM15, iMs15m);
  if (closedM15.length < opts.maPeriod + 5) return null;

  const n15 = closedM15.length;
  const lastM15    = closedM15[n15 - 1];
  const prevM15    = closedM15[n15 - 2];
  const prevPrevM15 = n15 >= 3 ? closedM15[n15 - 3] : null;

  // 15m BB
  const bb15m = calcBB(closedM15, opts.bbPeriod, opts.bbStdDev);
  if (!bb15m) return null;

  const m15BreachDepth = bb15m.lower - lastM15.close; // positive = below lower band
  if (m15BreachDepth < bb15m.lower * opts.minM15BreachFrac) return null;

  // 15m MA for filters
  const ma15m = calcSMA(closedM15, opts.maPeriod);
  if (ma15m === 0) return null;

  // prevPrev MA filter: bar[-3] must have been above MA (not deep in downtrend)
  if (prevPrevM15 && prevPrevM15.close < ma15m) return null;

  // Knife-catching gate: price must not have dropped more than maxMaDropPct below MA
  if (lastM15.close < ma15m * (1 - opts.maxMaDropPct)) return null;

  // Extra sanity: the previous closed bar should still be near / above the lower band
  // (ensures the breach just started — not mid-fall)
  if (prevM15.close < bb15m.lower * (1 - opts.minM15BreachFrac * 5)) return null;

  // ATR on 15m
  const atr = calcATR(closedM15);
  if (atr === 0) return null;

  // Entry / SL / TP
  const entryPrice = lastM15.close;
  const sl  = entryPrice - opts.slAtr * atr;
  const R   = entryPrice - sl;
  const tp1 = bb15m.middle;          // BB middle = mean reversion target
  const tp2 = entryPrice + 2 * R;   // 2R runner

  // Score: combine breach depths into 0–100
  const h1BreachPct  = (h1BreachDepth / bb1h.lower) * 100;
  const m15BreachPct = (m15BreachDepth / bb15m.lower) * 100;
  // Deeper breach → higher score (dip buying — deeper = more oversold)
  const rawScore = 40 + Math.min(30, h1BreachPct * 500) + Math.min(30, m15BreachPct * 1000);
  const score = Math.round(Math.min(100, rawScore));

  // Rescue DCA levels
  const rescueLevels: number[] = [];
  for (let i = 1; i <= opts.rescueCount; i++) {
    rescueLevels.push(entryPrice - i * opts.rescueSpacingAtr * atr);
  }

  // Status: price is already at/below lower band → TRIGGERED
  const status: CandidateStatus = 'TRIGGERED';

  // SR / HVN (lightweight)
  const srLevels = calcSRLevels(closedM15, atr, entryPrice);
  const hvnZones = calcHVN(closedM15.slice(-200), 80, 5, entryPrice);
  const topLevels = [
    ...srLevels.filter(z => z.kind === 'support').sort((a, b) => b.score - a.score).slice(0, 1),
    ...srLevels.filter(z => z.kind === 'resistance').sort((a, b) => b.score - a.score).slice(0, 1),
  ];

  const asOfCloseTime    = lastM15.time + iMs15m;
  const validBars        = getTtlBars('15m');
  const validUntilTime   = asOfCloseTime + validBars * iMs15m;
  const nextCloseTime    = asOfCloseTime + iMs15m;
  const vf               = getVolFactor('15m');
  const triggerSpec      = { type: 'hline' as const, fixedPrice: bb15m.lower, slope: 0, p1Time: 0, p1Price: 0 };
  const triggerAtNext    = triggerPrice(triggerSpec, nextCloseTime);

  const drawingGroups = buildBbMtfDrawings(
    symbol, entryPrice, sl, tp1, tp2,
    bb15m, bb1h, rescueLevels, closedM15,
  );

  return {
    symbol,
    direction: 'long',
    score,
    entryPrice,
    slPrice: sl,
    tpPrice: tp2,
    tp1Price: tp1,
    atr,
    breakoutType: 'hline',
    srLevels, hvnZones, topLevels,
    drawingGroups,
    candles: closedM15,
    interval: '15m',
    volFactor: vf,
    status,
    asOfCloseTime,
    validBars,
    validUntilTime,
    nextCandleCloseTime: nextCloseTime,
    triggerPriceAtNextClose: triggerAtNext,
    triggerSpec,
    triggeredAt: asOfCloseTime,
    distanceNowPct: 0,
    strategyId: 'bb-mtf-dca',
    // BB MTF specific metadata
    bbMtfH1BreachPct: h1BreachPct,
    bbMtfM15BreachPct: m15BreachPct,
    bbMtfMiddleBand: bb15m.middle,
    bbMtfUpperBand: bb15m.upper,
    bbMtfRescueLevels: rescueLevels,
    bbMtfMaxBudgetMultiplier: opts.maxBudgetMultiplier,
  };
}

// ── Internal scan runner ──────────────────────────────────────────────────────

async function runBbMtfDcaScanInternal(
  symbols: string[],
  _interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  opts: Required<BbMtfOptions>,
  signal?: AbortSignal,
  options?: ScanOptions,
): Promise<void> {
  // BB MTF is LONG only — skip scan if explicitly requesting shorts
  if (direction === 'short') {
    options?.onStatus?.('BB MTF DCA는 롱(딥 매수) 전용 전략입니다. 숏 방향은 지원하지 않습니다.', 'warn');
    return;
  }

  const gov = getBinanceGovernorSnapshot();
  if (gov.cooldownUntil > Date.now()) {
    const remainSec = Math.ceil((gov.cooldownUntil - Date.now()) / 1000);
    options?.onStatus?.(`바이낸스 쿨다운 중(${remainSec}s) — 스캔 일시 중단`, 'warn');
    return;
  }

  const scanTag = options?.scanTag ?? `bb-mtf-dca:${direction}`;
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
  const delayMs     = Math.max(0, options?.delayMs ?? 200);
  const queue       = [...symbols];

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const sym = queue.shift();
      if (!sym) return;
      try {
        const result = await scanSymbolBbMtf(sym, opts, signal);
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
    options?.onStatus?.(
      `[BB MTF DCA] 스캔 완료 — ${total}개 심볼 처리`,
      'info',
    );
  }
}

// ── Public scan function ──────────────────────────────────────────────────────

export async function runBbMtfDcaScan(
  symbols: string[],
  interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  signal?: AbortSignal,
  options?: ScanOptions,
): Promise<void> {
  return runBbMtfDcaScanInternal(
    symbols, interval, direction, onProgress, onResult,
    DEFAULT_BB_MTF_OPTIONS, signal, options,
  );
}

/**
 * Factory: creates a ScanFn with custom BB MTF options baked in.
 * Used by useAltAutoTrade when the auto-trade settings include bb-mtf params.
 */
export function createBbMtfDcaScan(bbMtfOptions?: BbMtfOptions): ScanFn {
  const defined = bbMtfOptions
    ? Object.fromEntries(Object.entries(bbMtfOptions).filter(([, v]) => v !== undefined))
    : {};
  const opts: Required<BbMtfOptions> = { ...DEFAULT_BB_MTF_OPTIONS, ...defined };
  return (symbols, interval, direction, onProgress, onResult, signal, options) =>
    runBbMtfDcaScanInternal(symbols, interval, direction, onProgress, onResult, opts, signal, options);
}

export const bbMtfDcaStrategy: ScanStrategy = {
  id: 'bb-mtf-dca',
  label: 'BB MTF DCA',
  scan: runBbMtfDcaScan,
};
