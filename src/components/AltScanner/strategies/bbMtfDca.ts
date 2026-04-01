/**
 * BB MTF Dip + Auto Rescue DCA Strategy
 *
 * Entry conditions (LONG only):
 *   1. Any of last breachLookback1h (default 3) 1h bars closed below 1h BB lower
 *   2. Last closed 15m bar is below 15m BB lower
 *   3. Fresh-breach guard: within the previous breachLookback15m (default 4) 15m bars,
 *      at least ONE bar was still ABOVE the 15m BB lower.
 *      → prevents buying into coins already stuck below BB for many bars
 *   4. Knife-catching gate: close > MA(maPeriod) × (1 − maxMaDropPct)
 *      → prevents entering free-fall (>maxMaDropPct% below MA)
 *
 * Previously-broken filters (removed):
 *   - prevPrevM15.close < ma15m → null  ← too strict: always fails during real 1h breach
 *   - prevM15.close < bb15m.lower * (1-ε) → null  ← only 1st breach bar passes; useless
 *
 * Execution:
 *   Entry  — LIMIT at last 15m close (already below BB lower)
 *   SL     — entry − slAtr × ATR
 *   TP1    — 15m BB middle band (SMA(bbPeriod)) — mean reversion target
 *   TP2    — entry + 2R  (R = entry − SL)
 *   Rescue — up to rescueCount levels, each rescueSpacingAtr × ATR below entry
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
  /** Bollinger Band period for both 1h and 15m (default 20) */
  bbPeriod?: number;
  /** Bollinger Band standard deviation multiplier (default 2.0) */
  bbStdDev?: number;
  /** MA period for knife-catching gate (default 50) */
  maPeriod?: number;
  /**
   * Knife-catching gate: reject if close < MA × (1 − maxMaDropPct).
   * Default 0.06 (reject if >6% below MA).
   */
  maxMaDropPct?: number;
  /**
   * Minimum 1h BB breach depth as a fraction of the lower band.
   * Default 0.001 (0.1%). Any of the last breachLookback1h bars must satisfy this.
   */
  minH1BreachFrac?: number;
  /**
   * Minimum 15m BB breach depth as a fraction of the lower band.
   * Default 0.0005 (0.05%). Only the LAST bar is checked.
   */
  minM15BreachFrac?: number;
  /**
   * How many recent 1h bars to check for a breach (default 3).
   * Allows entry even if price is recovering from a breach that started 1-2 hours ago.
   */
  breachLookback1h?: number;
  /**
   * Within this many recent 15m bars (excluding the last), at least one must have
   * closed ABOVE the 15m BB lower (fresh-breach guard). Default 4 (= 1 hour).
   */
  breachLookback15m?: number;
  /** ATR multiplier for SL below entry (default 1.5) */
  slAtr?: number;
  /** Number of rescue DCA levels below entry (default 2) */
  rescueCount?: number;
  /** ATR spacing between consecutive rescue levels (default 1.0) */
  rescueSpacingAtr?: number;
  /**
   * Maximum total budget as a multiplier of the initial position notional.
   * Default 3.10 — shown in UI; actual enforcement in auto-trade hook.
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
  breachLookback1h: 3,
  breachLookback15m: 4,
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

function calcBB(
  candles: Candle[],
  period: number,
  stdDev: number,
): { upper: number; middle: number; lower: number } | null {
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
  atr: number,
  bb15m: BbBands,
  bb1h: BbBands,
  rescueLevels: number[],
  candles: Candle[],
  lastCandleHigh: number,
  lastCandleLow: number,
): DrawingGroups {
  const R  = Math.abs(entryPrice - sl);
  const rr = R > 0 ? Math.abs(tp2 - entryPrice) / R : 0;

  // ── 침범 캔들 박스: 마지막 캔들만 금색 하이라이트 ────────────────────────
  const breachCandleTime = candles[candles.length - 1].time;
  const prevCandleTime   = candles.length >= 2 ? candles[candles.length - 2].time : candles[0].time;
  const breachTop        = Math.max(lastCandleHigh, bb15m.lower);
  const breachCandleBox: BoxDrawing = {
    id: uid(), type: 'box', ticker: symbol,
    p1: { time: prevCandleTime, price: breachTop },
    p2: { time: breachCandleTime, price: lastCandleLow },
    corners: [
      { pos: 'TL', time: prevCandleTime,   price: breachTop      },
      { pos: 'TR', time: breachCandleTime, price: breachTop      },
      { pos: 'BR', time: breachCandleTime, price: lastCandleLow  },
      { pos: 'BL', time: prevCandleTime,   price: lastCandleLow  },
    ],
    topPrice: breachTop,
    bottomPrice: lastCandleLow,
    color: '#f0b90b',
    memo: '⚡ BB 침범 캔들',
  };

  // ── BB 3선: 하단(침범트리거) / 중심(TP1기준) / 상단 ─────────────────────
  const bb15mLowerLine: HlineDrawing = {
    id: uid(), type: 'hline', ticker: symbol, price: bb15m.lower,
    color: '#38bdf8',   // 하늘색 — 가장 중요한 기준선
    memo: `BB 하단 ${fmt(bb15m.lower)} ← 침범 트리거`,
  };
  const bb15mMiddleLine: HlineDrawing = {
    id: uid(), type: 'hline', ticker: symbol, price: bb15m.middle,
    color: '#f0b90b',   // 노란색 — TP1 기준 (진입가와 같은 계열)
    memo: `BB 중심 ${fmt(bb15m.middle)} · TP1 기준`,
  };
  const bb15mUpperLine: HlineDrawing = {
    id: uid(), type: 'hline', ticker: symbol, price: bb15m.upper,
    color: '#0ecb81',   // 초록 — 상단 목표
    memo: `BB 상단 ${fmt(bb15m.upper)}`,
  };

  // ── 핵심 진입·익절·손절 3선 ──────────────────────────────────────────────
  const entryLines: Drawing[] = [
    {
      id: uid(), type: 'hline', ticker: symbol, price: entryPrice,
      color: '#f0b90b',
      memo: `▶ 진입 ${fmt(entryPrice)} · LIMIT IOC · RR≈${rr.toFixed(1)}`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: tp1,
      color: '#0ecb81',
      memo: `✔ TP ${fmt(tp1)} · BB중심 복귀`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: sl,
      color: '#f6465d',
      memo: `✖ SL ${fmt(sl)}`,
    } satisfies HlineDrawing,
  ];

  // ── dimSR: 상세 모드에서만 표시 (1h 컨텍스트 + 구출레벨 + TP2) ──────────
  const dimSR: Drawing[] = [
    {
      id: uid(), type: 'hline', ticker: symbol, price: bb1h.lower,
      color: '#3b8beb',
      memo: `1h BB 하단 ${fmt(bb1h.lower)}`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: tp2,
      color: '#00b4a0',
      memo: `TP2(2R) ${fmt(tp2)}`,
    } satisfies HlineDrawing,
    ...rescueLevels.map((level, i) => ({
      id: uid(), type: 'hline', ticker: symbol, price: level,
      color: '#9b59b2',
      memo: `구출${i + 1} ${fmt(level)}`,
    } satisfies HlineDrawing)),
    {
      id: uid(), type: 'hline', ticker: symbol, price: bb1h.upper,
      color: '#0ecb81',
      memo: `1h BB 상단 ${fmt(bb1h.upper)}`,
    } satisfies HlineDrawing,
  ];

  return {
    // breakout: 항상 표시 — 침범 캔들 + BB 3선 (총 4개)
    breakout: [
      breachCandleBox,  // ⚡ 침범 캔들 하이라이트
      bb15mLowerLine,   // BB 하단 (침범 트리거, 하늘색)
      bb15mMiddleLine,  // BB 중심 (TP1, 노란색)
      bb15mUpperLine,   // BB 상단 (목표, 초록)
    ],
    dimSR,              // 1h 컨텍스트 + 구출레벨 + TP2 (상세 모드)
    topSR: [],
    hvn: [],
    entryLines,         // 진입 / TP / SL (3선)
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

  // ── 1h 캔들 ─────────────────────────────────────────────────────────────────
  // breachLookback1h 개의 최근 봉을 검사하므로 여유 포함
  const h1Limit = opts.bbPeriod + opts.breachLookback1h + 5;
  const rawH1 = await fetchBinanceKlinesCached(symbol, '1h', h1Limit, signal);
  if (rawH1.length < opts.bbPeriod + 2) return null;
  const closedH1 = closedOnly(rawH1, iMs1h);
  if (closedH1.length < opts.bbPeriod + 2) return null;

  // 1h BB (마지막 bbPeriod 봉 기준)
  const bb1h = calcBB(closedH1, opts.bbPeriod, opts.bbStdDev);
  if (!bb1h) return null;

  // 1h 침범 체크: 최근 breachLookback1h 봉 중 가장 깊은 침범값
  const nH1 = closedH1.length;
  const h1Window = closedH1.slice(Math.max(0, nH1 - opts.breachLookback1h));
  const h1BestBreach = Math.max(0, ...h1Window.map(c => bb1h.lower - c.close));
  if (h1BestBreach < bb1h.lower * opts.minH1BreachFrac) return null;

  // ── 15m 캔들 ─────────────────────────────────────────────────────────────────
  // maPeriod + bbPeriod + lookback 여유 확보
  const m15Limit = opts.maPeriod + opts.bbPeriod + opts.breachLookback15m + 10;
  const rawM15 = await fetchBinanceKlinesCached(symbol, '15m', m15Limit, signal);
  if (rawM15.length < opts.maPeriod + 5) return null;
  const closedM15 = closedOnly(rawM15, iMs15m);
  if (closedM15.length < opts.maPeriod + 5) return null;

  const n15 = closedM15.length;
  const lastM15 = closedM15[n15 - 1];

  // 15m BB (마지막 bbPeriod 봉 기준)
  const bb15m = calcBB(closedM15, opts.bbPeriod, opts.bbStdDev);
  if (!bb15m) return null;

  // 현재(마지막) 15m 봉이 BB 하단 아래에 있어야 함
  const m15BreachDepth = bb15m.lower - lastM15.close; // 양수 = 하단 아래
  if (m15BreachDepth < bb15m.lower * opts.minM15BreachFrac) return null;

  // 신선한 침범 확인: 최근 breachLookback15m 봉(현재 제외) 중 하나 이상이 BB 하단 위에 있었어야 함
  // → 오래 전부터 BB 하단 아래에 갇혀있는 코인 제외
  const freshWindow = closedM15.slice(
    Math.max(0, n15 - 1 - opts.breachLookback15m),
    n15 - 1,
  );
  const wasFreshAbove = freshWindow.some(c => c.close >= bb15m.lower);
  if (!wasFreshAbove) return null;

  // 낙도 방지 게이트: MA 기준 maxMaDropPct 이상 하락하면 자유낙하로 판단 후 제외
  const ma15m = calcSMA(closedM15, opts.maPeriod);
  if (ma15m === 0) return null;
  if (lastM15.close < ma15m * (1 - opts.maxMaDropPct)) return null;

  // ATR (15m 기준)
  const atr = calcATR(closedM15);
  if (atr === 0) return null;

  // ── Entry / SL / TP ──────────────────────────────────────────────────────────
  const entryPrice = lastM15.close;
  const sl  = entryPrice - opts.slAtr * atr;
  const R   = entryPrice - sl;
  const tp1 = bb15m.middle; // mean reversion 1차 목표
  const tp2 = entryPrice + 2 * R;

  // 점수: 두 타임프레임 침범 깊이의 합산 (40~100점)
  const h1BreachPct  = (h1BestBreach / bb1h.lower) * 100;
  const m15BreachPct = (m15BreachDepth / bb15m.lower) * 100;
  const rawScore = 40
    + Math.min(30, h1BreachPct * 500)   // 최대 +30: 1h 침범 0.1%→6pt, 0.6%→30pt
    + Math.min(30, m15BreachPct * 1000); // 최대 +30: 15m 침범 0.05%→5pt, 0.3%→30pt
  const score = Math.round(Math.min(100, rawScore));

  // 구출 DCA 레벨
  const rescueLevels: number[] = [];
  for (let i = 1; i <= opts.rescueCount; i++) {
    rescueLevels.push(entryPrice - i * opts.rescueSpacingAtr * atr);
  }

  // ── 상태: BB 하단 침범 = 즉시 TRIGGERED ──────────────────────────────────
  const status: CandidateStatus = 'TRIGGERED';

  // SR / HVN (가벼운 계산)
  const srLevels  = calcSRLevels(closedM15, atr, entryPrice);
  const hvnZones  = calcHVN(closedM15.slice(-200), 80, 5, entryPrice);
  const topLevels = [
    ...srLevels.filter(z => z.kind === 'support').sort((a, b) => b.score - a.score).slice(0, 1),
    ...srLevels.filter(z => z.kind === 'resistance').sort((a, b) => b.score - a.score).slice(0, 1),
  ];

  const asOfCloseTime  = lastM15.time + iMs15m;
  const validBars      = getTtlBars('15m');
  const validUntilTime = asOfCloseTime + validBars * iMs15m;
  const nextCloseTime  = asOfCloseTime + iMs15m;
  const vf             = getVolFactor('15m');
  const triggerSpec    = {
    type: 'hline' as const, fixedPrice: bb15m.lower, slope: 0, p1Time: 0, p1Price: 0,
  };
  const triggerAtNext  = triggerPrice(triggerSpec, nextCloseTime);

  const drawingGroups = buildBbMtfDrawings(
    symbol, entryPrice, sl, tp1, tp2, atr,
    bb15m, bb1h, rescueLevels, closedM15,
    lastM15.high, lastM15.low,
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
    // BB MTF 전용 메타데이터
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
  // BB MTF DCA 는 롱(딥 매수) 전용
  if (direction === 'short') {
    options?.onStatus?.('BB MTF DCA는 롱(딥 매수) 전용입니다. 숏 방향은 지원하지 않습니다.', 'warn');
    return;
  }

  const gov = getBinanceGovernorSnapshot();
  if (gov.cooldownUntil > Date.now()) {
    const remainSec = Math.ceil((gov.cooldownUntil - Date.now()) / 1000);
    options?.onStatus?.(`바이낸스 쿨다운 중(${remainSec}s) — 스캔 일시 중단`, 'warn');
    return;
  }

  const scanTag  = options?.scanTag ?? `bb-mtf-dca:${direction}`;
  const scanSlot = await acquireScanSlot({ tag: scanTag, policy: options?.busyPolicy ?? 'queue' });
  if (!scanSlot) {
    options?.onStatus?.('다른 스캔이 진행 중이라 이번 스캔은 건너뜀', 'warn');
    return;
  }
  if (scanSlot.waitedMs >= 200) {
    options?.onStatus?.(`다른 스캔 종료 대기 후 시작 (${(scanSlot.waitedMs / 1000).toFixed(1)}s)`, 'info');
  }

  const total    = symbols.length;
  let done       = 0;
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
 * Factory: BbMtfOptions 를 bake-in 한 ScanFn 반환.
 * useAltAutoTrade / AltScannerModal 의 자동매매·수동스캔에서 사용.
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
