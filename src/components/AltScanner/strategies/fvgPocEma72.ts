/**
 * FVG POC + EMA72 Strategy
 *
 * Entry signal: last closed bar crosses a rolling FVG-based Point of Control (POC)
 * in the direction confirmed by EMA72 trend.
 *
 * Universe filter: top N futures symbols by rolling-24h quoteVolume (Binance /fapi/v1/ticker/24hr,
 * cached 4 h).  This is a rolling 24h window, not strictly yesterday's daily candle.
 * A strict "prior-day" filter would require per-symbol 1d kline fetches (prohibitive cost),
 * so rolling-24h is used as the practical approximation.  The cache TTL of 4 h means the
 * ranking refreshes at most 6 times per day, which is sufficient for this purpose.
 *
 * FVG (Fair Value Gap):
 *   Bullish: high[i-2] < low[i]  → midpoint = (high[i-2] + low[i]) / 2
 *   Bearish: low[i-2]  > high[i] → midpoint = (high[i]  + low[i-2]) / 2
 *
 * Rolling POC:
 *   Collect all FVG midpoints from the last `fvgPocLookbackBars` closed bars,
 *   bin them into `fvgPocBins` equal-width bins, return the centre of the bin
 *   with the highest count.
 *
 * SL / TP: ATR-based (consistent with existing strategies).
 *   LONG:  SL = entryPrice − 1.5×ATR   TP = entryPrice + 2×(entryPrice − SL)
 *   SHORT: SL = entryPrice + 1.5×ATR   TP = entryPrice − 2×(SL − entryPrice)
 */

import type { Candle } from '../../../types/candle';
import type { HlineDrawing, Drawing } from '../../../types/drawing';
import type {
  ScanCandidate, ScanInterval, ScanDirection, ScanOptions,
  DrawingGroups, CandidateStatus,
} from '../breakoutScanner';
import { calcSRLevels } from '../supportResistance';
import { calcHVN } from '../volumeProfile';
import { intervalToMs, getTtlBars, getVolFactor, triggerPrice } from '../timeUtils';
import { fetchBinanceKlinesCached } from '../../../lib/binanceKlineCache';
import { acquireScanSlot, getBinanceGovernorSnapshot, governedBinanceFetch } from '../../../lib/binanceRequestGovernor';
import type { ScanFn, ScanStrategy } from '../strategyTypes';

// ── Options ────────────────────────────────────────────────────────────────

export interface FvgPocOptions {
  /** Bars to look back when collecting FVG midpoints for POC (default 500) */
  fvgPocLookbackBars?: number;
  /** Number of bins for POC histogram (default 40) */
  fvgPocBins?: number;
  /** EMA period for trend filter (default 72) */
  fvgEmaPeriod?: number;
  /** Restrict scan universe to top-N symbols by prior-day volume (default 100) */
  fvgUniverseTopN?: number;
  /** Which directions to scan (default 'both') */
  fvgDirection?: 'long' | 'short' | 'both';
}

const DEFAULT_FVG_OPTIONS: Required<FvgPocOptions> = {
  fvgPocLookbackBars: 500,
  fvgPocBins: 40,
  fvgEmaPeriod: 72,
  fvgUniverseTopN: 100,
  fvgDirection: 'both',
};

// ── Universe cache ─────────────────────────────────────────────────────────
// Source: /fapi/v1/ticker/24hr  quoteVolume = rolling 24h USDT turnover.
// NOT strictly prior-day.  Per-symbol 1d klines would be exact but cost is prohibitive.

interface UniverseEntry {
  symbol: string;
  quoteVolume: number;
}

interface UniverseCache {
  fetchedAt: number;
  symbols: string[];
}

const UNIVERSE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
let universeCache: UniverseCache | null = null;

async function fetchTopNByVolume(topN: number, signal?: AbortSignal): Promise<string[]> {
  const now = Date.now();
  if (universeCache && now - universeCache.fetchedAt < UNIVERSE_TTL_MS) {
    return universeCache.symbols.slice(0, topN);
  }

  const res = await governedBinanceFetch(
    'https://fapi.binance.com/fapi/v1/ticker/24hr',
    signal ? { signal } : undefined,
    { weight: 40, scope: 'scan', label: 'fvg-universe' },
  );
  if (!res.ok) throw new Error(`Universe fetch failed: ${res.status}`);

  const data = (await res.json()) as Array<{ symbol: string; quoteVolume: string }>;

  // Keep only perpetual USDT contracts (no delivery dates)
  const entries: UniverseEntry[] = data
    .filter(d => d.symbol.endsWith('USDT') && !/\d{6}$/.test(d.symbol))
    .map(d => ({ symbol: d.symbol, quoteVolume: parseFloat(d.quoteVolume) }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  universeCache = {
    fetchedAt: now,
    symbols: entries.map(e => e.symbol),
  };

  return universeCache.symbols.slice(0, topN);
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

function calcEMA(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

const SAFETY_MS = 4000;

function closedOnly(candles: Candle[], intervalMs: number): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const isClosed = last.time + intervalMs <= Date.now() - SAFETY_MS;
  return isClosed ? candles : candles.slice(0, -1);
}

// ── FVG detection & Rolling POC ────────────────────────────────────────────

interface FVG {
  midpoint: number;
  kind: 'bullish' | 'bearish';
  barIndex: number;
}

function detectFVGs(candles: Candle[], lookback: number): FVG[] {
  const start = Math.max(2, candles.length - lookback);
  const fvgs: FVG[] = [];
  for (let i = start; i < candles.length; i++) {
    const prev2 = candles[i - 2];
    const curr  = candles[i];
    if (prev2.high < curr.low) {
      // Bullish FVG: gap between i-2 high and i low
      fvgs.push({ midpoint: (prev2.high + curr.low) / 2, kind: 'bullish', barIndex: i });
    } else if (prev2.low > curr.high) {
      // Bearish FVG: gap between i high and i-2 low
      fvgs.push({ midpoint: (curr.high + prev2.low) / 2, kind: 'bearish', barIndex: i });
    }
  }
  return fvgs;
}

function calcRollingPOC(fvgs: FVG[], bins: number): number | null {
  if (fvgs.length === 0) return null;

  const prices = fvgs.map(f => f.midpoint);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  if (hi === lo) return lo;

  const binWidth = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const p of prices) {
    const idx = Math.min(bins - 1, Math.floor((p - lo) / binWidth));
    counts[idx]++;
  }

  let maxIdx = 0;
  for (let i = 1; i < bins; i++) {
    if (counts[i] > counts[maxIdx]) maxIdx = i;
  }

  // Return bin centre
  return lo + (maxIdx + 0.5) * binWidth;
}

// ── Drawing helpers ────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt(p: number) { return p >= 1 ? p.toFixed(2) : p.toFixed(6); }

function buildFvgDrawings(
  symbol: string,
  direction: 'long' | 'short',
  poc: number,
  entryPrice: number,
  sl: number,
  tp2: number,
): DrawingGroups {
  const isLong = direction === 'long';
  const R = Math.abs(entryPrice - sl);
  const rr = R > 0 ? Math.abs(tp2 - entryPrice) / R : 0;

  const pocLine: HlineDrawing = {
    id: uid(), type: 'hline', ticker: symbol, price: poc,
    color: 'rgba(240,185,11,0.75)',
    memo: `⑦ FVG POC ${fmt(poc)} · 롤링 볼륨 중심가`,
  };

  const entryLines: Drawing[] = [
    {
      id: uid(), type: 'hline', ticker: symbol, price: entryPrice,
      color: '#f0b90b',
      memo: `① ${isLong ? '▲ 롱' : '▼ 숏'} FVG POC 크로스 진입 · RR≈${rr.toFixed(1)}`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: sl,
      color: '#f6465d',
      memo: `④ SL ${fmt(sl)} · ATR×1.5 기준`,
    } satisfies HlineDrawing,
    {
      id: uid(), type: 'hline', ticker: symbol, price: tp2,
      color: '#0ecb81',
      memo: `② TP ${fmt(tp2)} · RR≈${rr.toFixed(1)}`,
    } satisfies HlineDrawing,
  ];

  return { breakout: [pocLine], dimSR: [], topSR: [], hvn: [], entryLines };
}

// ── Scan one symbol ────────────────────────────────────────────────────────

async function scanSymbolFvg(
  symbol: string,
  interval: ScanInterval,
  direction: ScanDirection,
  opts: Required<FvgPocOptions>,
  passedUniverseFilter: boolean,
  signal?: AbortSignal,
): Promise<ScanCandidate | null> {
  const iMs = intervalToMs(interval);
  const fetchLimit = Math.min(1000, opts.fvgPocLookbackBars + 80);

  const raw = await fetchBinanceKlinesCached(symbol, interval, fetchLimit, signal);
  if (raw.length < opts.fvgEmaPeriod + 10) return null;

  const closed = closedOnly(raw, iMs);
  if (closed.length < opts.fvgEmaPeriod + 5) return null;

  const n = closed.length;
  const lastClosed   = closed[n - 1];
  const prevClosed   = closed[n - 2];
  const lastClose    = lastClosed.close;
  const prevClose    = prevClosed.close;
  const lastCloseTime = lastClosed.time + iMs;

  // EMA72 trend
  const ema = calcEMA(closed, opts.fvgEmaPeriod);
  if (ema === 0) return null;

  // FVG-based rolling POC
  const fvgs = detectFVGs(closed, opts.fvgPocLookbackBars);
  if (fvgs.length < 3) return null;

  const poc = calcRollingPOC(fvgs, opts.fvgPocBins);
  if (poc === null) return null;

  // Determine which directions to evaluate
  const dirsToCheck: ('long' | 'short')[] =
    direction === 'both' ? ['long', 'short'] : [direction];

  // Apply fvgDirection filter
  const allowedDirs = opts.fvgDirection === 'both' ? dirsToCheck
    : dirsToCheck.filter(d => d === opts.fvgDirection);

  let foundDir: 'long' | 'short' | null = null;

  for (const dir of allowedDirs) {
    if (dir === 'long') {
      // Long: EMA trend up + last bar crosses POC from below
      if (lastClose <= ema) continue;
      if (!(prevClose < poc && lastClose >= poc)) continue;
      foundDir = 'long';
      break;
    } else {
      // Short: EMA trend down + last bar crosses POC from above
      if (lastClose >= ema) continue;
      if (!(prevClose > poc && lastClose <= poc)) continue;
      foundDir = 'short';
      break;
    }
  }

  if (!foundDir) return null;

  const isLong = foundDir === 'long';

  const atr = calcATR(closed);
  if (atr === 0) return null;

  // SL / TP
  const sl  = isLong ? lastClose - atr * 1.5 : lastClose + atr * 1.5;
  const R   = Math.abs(lastClose - sl);
  const tp2 = isLong ? lastClose + 2 * R : lastClose - 2 * R;

  // For ScanCandidate compatibility, compute SR + HVN (lightweight)
  const srLevels = calcSRLevels(closed, atr, lastClose);
  const hvnZones = calcHVN(closed.slice(-300), 100, 5, lastClose);
  const topLevels = [
    ...srLevels.filter(z => z.kind === 'support').sort((a, b) => b.score - a.score).slice(0, 1),
    ...srLevels.filter(z => z.kind === 'resistance').sort((a, b) => b.score - a.score).slice(0, 1),
  ];

  const vf           = getVolFactor(interval);
  const validBars    = getTtlBars(interval);
  const nextCloseTime = lastCloseTime + iMs;
  const validUntil   = lastCloseTime + validBars * iMs;
  const triggerSpec  = { type: 'hline' as const, fixedPrice: poc, slope: 0, p1Time: 0, p1Price: 0 };
  const triggerAtNext = triggerPrice(triggerSpec, nextCloseTime);

  const distanceNowPct = isLong
    ? ((poc - lastClose) / poc) * 100
    : ((lastClose - poc) / poc) * 100;
  const status: CandidateStatus = Math.abs(distanceNowPct) <= 0.5 ? 'TRIGGERED' : 'PENDING';

  const rr = R > 0 ? Math.abs(tp2 - lastClose) / R : 0;
  const score = Math.round(Math.min(100, 40 + rr * 15 + Math.min(fvgs.length, 20)));

  // FVG metadata: how far the confirmed bar closed beyond the POC
  // LONG: positive means close > poc (bar extended above poc)
  // SHORT: positive means poc > close (bar extended below poc)
  const fvgBreakoutExtensionPct = isLong
    ? (lastClose - poc) / poc * 100
    : (poc - lastClose) / poc * 100;

  const drawingGroups = buildFvgDrawings(symbol, foundDir, poc, lastClose, sl, tp2);

  return {
    symbol,
    direction: foundDir,
    score,
    entryPrice: lastClose,
    slPrice: sl,
    tpPrice: tp2,
    atr,
    breakoutType: 'hline',
    srLevels,
    hvnZones,
    topLevels,
    drawingGroups,
    candles: closed,
    interval,
    volFactor: vf,
    status,
    asOfCloseTime: lastCloseTime,
    validBars,
    validUntilTime: validUntil,
    nextCandleCloseTime: nextCloseTime,
    triggerPriceAtNextClose: triggerAtNext,
    triggerSpec,
    triggeredAt: status === 'TRIGGERED' ? lastCloseTime : undefined,
    distanceNowPct,
    strategyId: 'fvg-poc-ema72',
    // FVG analysis metadata
    pocPrice: poc,
    fvgEma: ema,
    fvgBreakoutExtensionPct,
    fvgPassedUniverseFilter: passedUniverseFilter,
  };
}

// ── Internal scan runner ───────────────────────────────────────────────────

async function runFvgPocEma72ScanInternal(
  symbols: string[],
  interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  opts: Required<FvgPocOptions>,
  signal?: AbortSignal,
  options?: ScanOptions,
): Promise<void> {
  const gov = getBinanceGovernorSnapshot();
  if (gov.cooldownUntil > Date.now()) {
    const remainSec = Math.ceil((gov.cooldownUntil - Date.now()) / 1000);
    options?.onStatus?.(`바이낸스 쿨다운 중(${remainSec}s) — 스캔 일시 중단`, 'warn');
    return;
  }

  // Apply universe filter: intersect provided symbols with top-N by rolling-24h quoteVolume.
  // (Not strictly prior-day — see file header comment for rationale.)
  let filteredSymbols = symbols;
  let passedUniverseFilter = false; // true = filter was active AND fetch succeeded
  if (opts.fvgUniverseTopN > 0) {
    try {
      const universe = await fetchTopNByVolume(opts.fvgUniverseTopN, signal);
      const universeSet = new Set(universe);
      filteredSymbols = symbols.filter(s => universeSet.has(s));
      if (filteredSymbols.length === 0) {
        options?.onStatus?.('FVG 유니버스 필터 후 심볼 없음', 'warn');
        return;
      }
      passedUniverseFilter = true;
    } catch {
      options?.onStatus?.('유니버스 로드 실패 — 필터 없이 진행 (passedUniverseFilter=false)', 'warn');
      filteredSymbols = symbols;
      passedUniverseFilter = false;
    }
  }

  const scanTag = options?.scanTag ?? `fvg-poc-ema72:${interval}:${direction}`;
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

  const total = filteredSymbols.length;
  let done = 0;
  if (total === 0) { scanSlot.release(); return; }

  const concurrency = Math.max(1, options?.concurrency ?? 3);
  const delayMs     = Math.max(0, options?.delayMs ?? 200);
  const queue       = [...filteredSymbols];

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const sym = queue.shift();
      if (!sym) return;
      try {
        const result = await scanSymbolFvg(sym, interval, direction, opts, passedUniverseFilter, signal);
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

// ── Public scan function ───────────────────────────────────────────────────

export async function runFvgPocEma72Scan(
  symbols: string[],
  interval: ScanInterval,
  direction: ScanDirection,
  onProgress: (done: number, total: number) => void,
  onResult: (candidate: ScanCandidate) => void,
  signal?: AbortSignal,
  options?: ScanOptions,
): Promise<void> {
  return runFvgPocEma72ScanInternal(
    symbols, interval, direction, onProgress, onResult,
    DEFAULT_FVG_OPTIONS, signal, options,
  );
}

/**
 * Factory: creates a ScanFn with custom FVG options baked in.
 * Used by useAltAutoTrade / useLabExperiment when custom params are configured.
 */
export function createFvgPocEma72Scan(fvgOptions?: FvgPocOptions): ScanFn {
  const defined = fvgOptions
    ? Object.fromEntries(Object.entries(fvgOptions).filter(([, v]) => v !== undefined))
    : {};
  const opts: Required<FvgPocOptions> = { ...DEFAULT_FVG_OPTIONS, ...defined };
  return (symbols, interval, direction, onProgress, onResult, signal, options) =>
    runFvgPocEma72ScanInternal(symbols, interval, direction, onProgress, onResult, opts, signal, options);
}

export const fvgPocEma72Strategy: ScanStrategy = {
  id: 'fvg-poc-ema72',
  label: 'FVG POC + EMA72',
  scan: runFvgPocEma72Scan,
};
