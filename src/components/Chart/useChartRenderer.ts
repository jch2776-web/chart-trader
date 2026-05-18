import { useCallback, useMemo } from 'react';
import type { Candle, Interval } from '../../types/candle';
import type {
  Drawing, TrendlineDrawing, BoxDrawing, HlineDrawing, PixelPoint,
  FibRetracementDrawing, PriceRangeDrawing, DateRangeDrawing, L2LOverlay,
  ParallelChannelDrawing, TextDrawing, LabelDrawing, XabcdDrawing, BrushDrawing,
} from '../../types/drawing';
import { FIB_LEVELS, FIB_LEVEL_COLORS } from '../../types/drawing';
import type { FuturesPosition, FuturesOrder } from '../../types/futures';
import type { ChartViewport, ChartLayout, ChartArea } from './chartMath';
import {
  getChartAreas, idxToX, priceToY, candleWidth,
  computePriceTicks, computeTimeTicks, candleTimeAt, pointToPixel,
} from './chartMath';
import { formatPrice, formatTime } from '../../utils/priceFormat';

// ── Color helpers ─────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getBadgeTextColor(bgColor: string): string {
  const hex = bgColor.replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 170 ? '#131722' : '#ffffff';
}

function getLineDash(style: 'solid' | 'dashed' | 'dotted' | undefined, fallbackDashed = false): number[] {
  if (style === 'dashed') return [10, 6];
  if (style === 'dotted') return [2, 6];
  if (fallbackDashed) return [6, 4];
  return [];
}

// ── Binance color palette ────────────────────────────────────────────────────
const BG        = '#131722';
const GRID      = 'rgba(42,46,57,0.5)';
const AXIS_BG   = '#1e222d';
const AXIS_LINE = '#2a2e39';
const TEXT      = '#848e9c';
const BULL      = '#0ecb81';
const BEAR      = '#f6465d';
const CROSS_H   = 'rgba(182,189,198,0.6)';

const MA_DEFS = [
  { period: 7,  color: '#e5b94e', label: 'MA(7)' },
  { period: 25, color: '#c67ba5', label: 'MA(25)' },
  { period: 99, color: '#5d87c4', label: 'MA(99)' },
] as const;

// Coin Duck MA&BB — MA set
const CD_MA_DEFS = [
  { period: 5,   color: '#ffffff', label: 'MA5' },
  { period: 10,  color: '#f0b90b', label: 'MA10' },
  { period: 20,  color: '#5b9bd5', label: 'MA20' },
  { period: 60,  color: '#a259d9', label: 'MA60' },
  { period: 120, color: '#0ecb81', label: 'MA120' },
  { period: 200, color: '#f6465d', label: 'MA200' },
] as const;

export interface IndicatorConfig {
  coinDuckMABB: boolean;
  dwCloud: boolean;
  /** Render ONLY Bollinger Band curves (upper/mid/lower) — no MA, no Ichimoku */
  bbOnly?: boolean;
  /** Show default MA lines (MA7/25/99). Default true when undefined. */
  showMA?: boolean;
  /** Show default Bollinger Band (BB20). Default true when undefined. */
  showBB?: boolean;
}

// ── Indicator computations ────────────────────────────────────────────────────
function computeMA(candles: Candle[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

function computeEMA(candles: Candle[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return result;
  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

interface BBResult { upper: (number | null)[]; lower: (number | null)[]; mid: (number | null)[]; }
function computeBB(candles: Candle[], period: number, mult: number): BBResult {
  const mid:   (number | null)[] = new Array(candles.length).fill(null);
  const upper: (number | null)[] = new Array(candles.length).fill(null);
  const lower: (number | null)[] = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      const sma = sum / period;
      mid[i] = sma;
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) variance += (candles[j].close - sma) ** 2;
      const std = Math.sqrt(variance / period);
      upper[i] = sma + mult * std;
      lower[i] = sma - mult * std;
    }
  }
  return { mid, upper, lower };
}

// ── RSI computation ───────────────────────────────────────────────────────────
function computeRSI(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + Math.max(0,  d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/** EMA of a nullable array (skips nulls, seeds from first non-null value) */
function computeNullableEMA(src: (number | null)[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(src.length).fill(null);
  let ema: number | null = null;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) continue;
    ema = ema === null ? v : ema + k * (v - ema);
    out[i] = ema;
  }
  return out;
}

// ── Ichimoku Cloud computation ────────────────────────────────────────────────
const ICHI_TENKAN  = 9;
const ICHI_KIJUN   = 26;
const ICHI_SENKOU_B = 52;
const ICHI_DISP    = 26;

interface IchimokuResult {
  tenkan:  (number | null)[];   // length = candles.length
  kijun:   (number | null)[];
  spanA:   (number | null)[];   // length = candles.length + DISP  (displayed at i+DISP)
  spanB:   (number | null)[];   // same
  chikou:  (number | null)[];   // length = candles.length  (close of candle[i+DISP] shown at i)
}

function computeIchimoku(candles: Candle[]): IchimokuResult {
  const len = candles.length;
  const midHL = (endIdx: number, period: number): number => {
    let hi = -Infinity, lo = Infinity;
    const from = Math.max(0, endIdx - period + 1);
    for (let j = from; j <= endIdx; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low  < lo) lo = candles[j].low;
    }
    return (hi + lo) / 2;
  };
  const tenkan: (number | null)[] = new Array(len).fill(null);
  const kijun:  (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    if (i >= ICHI_TENKAN  - 1) tenkan[i] = midHL(i, ICHI_TENKAN);
    if (i >= ICHI_KIJUN   - 1) kijun[i]  = midHL(i, ICHI_KIJUN);
  }
  // spanA/spanB: computed at candle i, displayed at position i + DISP
  const spanA: (number | null)[] = new Array(len + ICHI_DISP).fill(null);
  const spanB: (number | null)[] = new Array(len + ICHI_DISP).fill(null);
  for (let i = 0; i < len; i++) {
    const t = tenkan[i], k = kijun[i];
    if (t !== null && k !== null) spanA[i + ICHI_DISP] = (t + k) / 2;
    if (i >= ICHI_SENKOU_B - 1)  spanB[i + ICHI_DISP] = midHL(i, ICHI_SENKOU_B);
  }
  // chikou: close of candle[i+DISP] shown at position i
  const chikou: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i + ICHI_DISP < len; i++) chikou[i] = candles[i + ICHI_DISP].close;
  return { tenkan, kijun, spanA, spanB, chikou };
}

interface HoverHandle { drawingId: string; handleIdx: number }

const INTERVAL_LABEL: Record<Interval, string> = {
  '1m': '1분', '3m': '3분', '5m': '5분', '15m': '15분',
  '1h': '1시간', '4h': '4시간', '1d': '1일', '1w': '1주',
};

export function useChartRenderer(
  candles: Candle[],
  interval: Interval,
  ticker: string,
  drawings: Drawing[],
  previewDrawing: Drawing | null,
  crosshair: { x: number; y: number; visible: boolean },
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  positions: FuturesPosition[] = [],
  orders: FuturesOrder[] = [],
  countdown: number = 0,
  indicators: IndicatorConfig = { coinDuckMABB: false, dwCloud: false },
  tp1Lines: Array<{ price: number; hit: boolean }> = [],
  l2lOverlay: L2LOverlay | null = null,
) {
  // Pre-compute MA arrays whenever candles change
  const maArrays = useMemo(() => ({
    7:  computeMA(candles, 7),
    25: computeMA(candles, 25),
    99: computeMA(candles, 99),
  }), [candles]);

  // Pre-compute indicator arrays
  const indicatorArrays = useMemo(() => {
    const cdMAs = indicators.coinDuckMABB
      ? { 5: computeMA(candles, 5), 10: computeMA(candles, 10), 20: computeMA(candles, 20),
          60: computeMA(candles, 60), 120: computeMA(candles, 120), 200: computeMA(candles, 200) }
      : null;
    const cdBB  = indicators.coinDuckMABB ? computeBB(candles, 20, 2) : null;
    const dwEMA9  = indicators.dwCloud ? computeEMA(candles, 9)  : null;
    const dwEMA26 = indicators.dwCloud ? computeEMA(candles, 26) : null;
    // Ichimoku is bundled with coinDuckMABB (MA&BB&LCH)
    const ichi  = indicators.coinDuckMABB ? computeIchimoku(candles) : null;
    // bbOnly: BB-only mode (no MA/Ichimoku)
    const bbOnlyBB = indicators.bbOnly ? computeBB(candles, 20, 2) : null;
    // Always-on: default BB (20, 2σ) and RSI(14)
    const defaultBB = computeBB(candles, 20, 2);
    const rsiArr    = computeRSI(candles, 14);
    const rsiMaArr  = computeNullableEMA(rsiArr, 9);
    return { cdMAs, cdBB, dwEMA9, dwEMA26, ichi, bbOnlyBB, defaultBB, rsiArr, rsiMaArr };
  }, [candles, indicators.coinDuckMABB, indicators.dwCloud, indicators.bbOnly]);

  const render = useCallback((
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    vp: ChartViewport,
  ) => {
    const { width, height } = layout;
    const { price: priceArea, volume: volArea, rsi: rsiArea } = getChartAreas(layout);

    // ── Background ──────────────────────────────────────────────────────
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    // ── Watermark ───────────────────────────────────────────────────────
    const cx = priceArea.x + priceArea.w / 2;
    const cy = priceArea.y + priceArea.h / 2;
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText(ticker, cx, cy - 30);
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(INTERVAL_LABEL[interval] ?? interval, cx, cy + 36);
    ctx.restore();

    // ── Price area clip path ─────────────────────────────────────────────
    const startI = Math.max(0, Math.floor(vp.startIdx));
    const endI   = Math.min(candles.length - 1, Math.ceil(vp.endIdx));

    // ── Grid lines (horizontal only, Binance style) ──────────────────────
    const priceTicks = computePriceTicks(vp.minPrice, vp.maxPrice, 7);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    priceTicks.forEach(price => {
      const y = priceToY(price, vp, priceArea);
      if (y < priceArea.y || y > priceArea.y + priceArea.h) return;
      ctx.beginPath();
      ctx.moveTo(priceArea.x, y);
      ctx.lineTo(priceArea.x + priceArea.w, y);
      ctx.stroke();
    });

    // Subtle vertical grid
    const timeTicks = computeTimeTicks(candles, vp.startIdx, vp.endIdx, interval, 7);
    ctx.strokeStyle = GRID;
    timeTicks.forEach(idx => {
      const x = idxToX(idx + 0.5, vp, priceArea);
      ctx.beginPath();
      ctx.moveTo(x, priceArea.y);
      ctx.lineTo(x, priceArea.y + priceArea.h + volArea.h + 4);
      ctx.stroke();
    });

    const cw = candleWidth(vp, priceArea);

    // ── Ichimoku Cloud (bundled with MA&BB&LCH) ───────────────────────────
    if (indicators.coinDuckMABB && indicatorArrays.ichi) {
      const { tenkan, kijun, spanA, spanB, chikou } = indicatorArrays.ichi;
      const cloudStart = Math.max(startI, ICHI_DISP - 1);
      const cloudEnd   = Math.min(endI + ICHI_DISP, spanA.length - 1);

      // Helper: draw a line array between from/to indices
      const drawIchiLine = (arr: (number | null)[], from: number, to: number, color: string, lw = 1) => {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lw; let s = false;
        for (let i = from; i <= to; i++) {
          const v = arr[i]; if (v === null) { s = false; continue; }
          const x = idxToX(i + 0.5, vp, priceArea); const y = priceToY(v, vp, priceArea);
          if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      // Kumo (cloud) fill — drawn first so lines render on top
      let seg: { x: number; ya: number; yb: number }[] = [];
      let segBull: boolean | null = null;
      const flushCloud = (bull: boolean) => {
        if (seg.length < 2) { seg = []; return; }
        ctx.beginPath();
        seg.forEach((pt, j) => { j === 0 ? ctx.moveTo(pt.x, pt.ya) : ctx.lineTo(pt.x, pt.ya); });
        for (let j = seg.length - 1; j >= 0; j--) ctx.lineTo(seg[j].x, seg[j].yb);
        ctx.closePath();
        ctx.fillStyle = bull ? 'rgba(1,194,52,0.15)' : 'rgba(225,51,34,0.15)';
        ctx.fill();
        seg = [];
      };
      for (let i = cloudStart; i <= cloudEnd; i++) {
        const a = spanA[i], b = spanB[i];
        if (a === null || b === null) { if (seg.length) flushCloud(segBull ?? true); continue; }
        const bull = a >= b;
        if (segBull !== null && bull !== segBull) flushCloud(segBull);
        seg.push({ x: idxToX(i + 0.5, vp, priceArea), ya: priceToY(a, vp, priceArea), yb: priceToY(b, vp, priceArea) });
        segBull = bull;
      }
      if (seg.length) flushCloud(segBull ?? true);

      // Tenkan-sen (blue, current)
      drawIchiLine(tenkan, startI, endI, '#0098ea');
      // Kijun-sen (orange-red, current)
      drawIchiLine(kijun, startI, endI, '#ff6b35');
      // Chikou Span (grey, shifted 26 bars back)
      ctx.setLineDash([4, 3]);
      drawIchiLine(chikou, startI, Math.min(endI, chikou.length - 1), 'rgba(180,180,180,0.7)');
      ctx.setLineDash([]);

      // Future zone separator (vertical dashed line at last candle)
      const sepX = idxToX(candles.length + 0.5, vp, priceArea);
      if (sepX > priceArea.x && sepX < priceArea.x + priceArea.w) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(sepX, priceArea.y);
        ctx.lineTo(sepX, priceArea.y + priceArea.h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── Divergence-Weighted Cloud (drawn first, below everything) ────────
    if (indicators.dwCloud && indicatorArrays.dwEMA9 && indicatorArrays.dwEMA26) {
      const ema9  = indicatorArrays.dwEMA9;
      const ema26 = indicatorArrays.dwEMA26;
      // Draw cloud as filled polygon segments, switching color at crossovers
      let seg: { x: number; y9: number; y26: number }[] = [];
      const flushSeg = (bullish: boolean) => {
        if (seg.length < 2) { seg = []; return; }
        // Compute max divergence in segment for opacity weighting
        let maxDiv = 0;
        for (const pt of seg) maxDiv = Math.max(maxDiv, Math.abs(pt.y9 - pt.y26));
        const opacity = Math.min(0.35, 0.08 + (maxDiv / (priceArea.h * 0.15)) * 0.27);
        const col = bullish ? `rgba(14,203,129,${opacity})` : `rgba(246,70,93,${opacity})`;
        ctx.beginPath();
        seg.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y9); else ctx.lineTo(pt.x, pt.y9); });
        for (let i = seg.length - 1; i >= 0; i--) ctx.lineTo(seg[i].x, seg[i].y26);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        seg = [];
      };
      let prevBullish: boolean | null = null;
      for (let i = startI; i <= endI; i++) {
        const v9 = ema9[i]; const v26 = ema26[i];
        if (v9 === null || v26 === null) { if (seg.length) flushSeg(prevBullish ?? true); continue; }
        const bullish = v9 >= v26;
        if (prevBullish !== null && bullish !== prevBullish) flushSeg(prevBullish);
        seg.push({ x: idxToX(i + 0.5, vp, priceArea), y9: priceToY(v9, vp, priceArea), y26: priceToY(v26, vp, priceArea) });
        prevBullish = bullish;
      }
      if (seg.length) flushSeg(prevBullish ?? true);
    }

    // ── Coin Duck MA&BB (drawn before candles) ────────────────────────────
    if (indicators.coinDuckMABB && indicatorArrays.cdBB) {
      const bb = indicatorArrays.cdBB;
      // BB band fill
      const fillPts: { x: number; yu: number; yl: number }[] = [];
      for (let i = startI; i <= endI; i++) {
        const u = bb.upper[i]; const l = bb.lower[i];
        if (u === null || l === null) continue;
        fillPts.push({ x: idxToX(i + 0.5, vp, priceArea), yu: priceToY(u, vp, priceArea), yl: priceToY(l, vp, priceArea) });
      }
      if (fillPts.length >= 2) {
        ctx.beginPath();
        fillPts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.yu); else ctx.lineTo(pt.x, pt.yu); });
        for (let i = fillPts.length - 1; i >= 0; i--) ctx.lineTo(fillPts[i].x, fillPts[i].yl);
        ctx.closePath();
        ctx.fillStyle = 'rgba(91,155,213,0.07)';
        ctx.fill();
      }
      // BB lines: upper, mid, lower
      [{ arr: bb.upper, col: 'rgba(91,155,213,0.6)' }, { arr: bb.mid, col: 'rgba(91,155,213,0.4)' }, { arr: bb.lower, col: 'rgba(91,155,213,0.6)' }]
        .forEach(({ arr, col }) => {
          ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 1; let s = false;
          for (let i = startI; i <= endI; i++) {
            const v = arr[i]; if (v === null) continue;
            const x = idxToX(i + 0.5, vp, priceArea); const y = priceToY(v, vp, priceArea);
            if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
      // CD MA lines
      CD_MA_DEFS.forEach(({ period, color }) => {
        const maArr = indicatorArrays.cdMAs![period as keyof typeof indicatorArrays.cdMAs];
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1; let s = false;
        for (let i = startI; i <= endI; i++) {
          const v = maArr[i]; if (v === null) continue;
          const x = idxToX(i + 0.5, vp, priceArea); const y = priceToY(v, vp, priceArea);
          if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    }

    // ── Default BB (20, 2σ) — shown unless explicitly disabled ─────────
    // When coinDuckMABB is on its own cdBB is already visible; skip duplicate.
    if (!indicators.coinDuckMABB && indicatorArrays.defaultBB && indicators.showBB !== false) {
      const bb = indicatorArrays.defaultBB;
      // Band fill
      const fillPts: { x: number; yu: number; yl: number }[] = [];
      for (let i = startI; i <= endI; i++) {
        const u = bb.upper[i]; const l = bb.lower[i];
        if (u === null || l === null) continue;
        fillPts.push({ x: idxToX(i + 0.5, vp, priceArea), yu: priceToY(u, vp, priceArea), yl: priceToY(l, vp, priceArea) });
      }
      if (fillPts.length >= 2) {
        ctx.beginPath();
        fillPts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.yu); else ctx.lineTo(pt.x, pt.yu); });
        for (let i = fillPts.length - 1; i >= 0; i--) ctx.lineTo(fillPts[i].x, fillPts[i].yl);
        ctx.closePath();
        ctx.fillStyle = indicators.bbOnly ? 'rgba(56,189,248,0.07)' : 'rgba(56,189,248,0.05)';
        ctx.fill();
      }
      const bbStyle = indicators.bbOnly
        ? [{ arr: bb.upper, col: 'rgba(56,189,248,0.75)', w: 1.5 }, { arr: bb.mid, col: 'rgba(240,185,11,0.65)', w: 1 }, { arr: bb.lower, col: 'rgba(56,189,248,0.75)', w: 1.5 }]
        : [{ arr: bb.upper, col: 'rgba(56,189,248,0.55)', w: 1   }, { arr: bb.mid, col: 'rgba(240,185,11,0.45)', w: 0.8 }, { arr: bb.lower, col: 'rgba(56,189,248,0.55)', w: 1   }];
      bbStyle.forEach(({ arr, col, w }) => {
        ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = w; let s = false;
        for (let i = startI; i <= endI; i++) {
          const v = arr[i]; if (v === null) continue;
          const x = idxToX(i + 0.5, vp, priceArea); const y = priceToY(v, vp, priceArea);
          if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    }

    // bbOnly flag: BB is already drawn by defaultBB block above (with prominent style when bbOnly=true)
    // MA suppression still applies via anyIndicatorOn check below.

    // ── MA lines (hidden when any indicator is active) ───────────────────
    const anyIndicatorOn = indicators.coinDuckMABB || indicators.dwCloud || !!indicators.bbOnly;
    const maVisible = indicators.showMA !== false;
    if (!anyIndicatorOn && maVisible) MA_DEFS.forEach(({ period, color }) => {
      const maArr = maArrays[period as 7 | 25 | 99];
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      let started = false;
      for (let i = startI; i <= endI; i++) {
        const v = maArr[i];
        if (v === null) continue;
        const x = idxToX(i + 0.5, vp, priceArea);
        const y = priceToY(v, vp, priceArea);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    // ── Candles ─────────────────────────────────────────────────────────
    for (let i = startI; i <= endI; i++) {
      const c = candles[i];
      const x = idxToX(i + 0.5, vp, priceArea);
      const isBull = c.close >= c.open;
      const color = isBull ? BULL : BEAR;

      const bodyTop = priceToY(Math.max(c.open, c.close), vp, priceArea);
      const bodyBot = priceToY(Math.min(c.open, c.close), vp, priceArea);
      const bodyH = Math.max(1, bodyBot - bodyTop);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, priceToY(c.high, vp, priceArea));
      ctx.lineTo(x, priceToY(c.low, vp, priceArea));
      ctx.stroke();

      // Body — always solid fill (Binance style)
      ctx.fillStyle = color;
      ctx.fillRect(x - cw / 2, bodyTop, cw, bodyH);
    }

    // ── Volume bars ───────────────────────────────────────────────────────
    let maxVol = 0;
    for (let i = startI; i <= endI; i++) {
      if (candles[i].volume > maxVol) maxVol = candles[i].volume;
    }
    if (maxVol > 0) {
      for (let i = startI; i <= endI; i++) {
        const c = candles[i];
        const x = idxToX(i + 0.5, vp, priceArea);
        const isBull = c.close >= c.open;
        const barH = Math.max(1, (c.volume / maxVol) * volArea.h);
        ctx.fillStyle = isBull
          ? 'rgba(14,203,129,0.45)'
          : 'rgba(246,70,93,0.45)';
        ctx.fillRect(
          x - cw / 2,
          volArea.y + volArea.h - barH,
          cw,
          barH,
        );
      }
    }

    // ── RSI panel ────────────────────────────────────────────────────────
    {
      const rsi = indicatorArrays.rsiArr;
      // Panel background
      ctx.fillStyle = 'rgba(19,23,34,0.95)';
      ctx.fillRect(rsiArea.x, rsiArea.y, rsiArea.w, rsiArea.h);

      // Helper: RSI value → Y pixel in rsiArea
      const rsiY = (v: number) => rsiArea.y + rsiArea.h - (v / 100) * rsiArea.h;

      // Overbought / oversold zone bands
      const y70 = rsiY(70); const y30 = rsiY(30);
      ctx.fillStyle = 'rgba(246,70,93,0.07)';
      ctx.fillRect(rsiArea.x, rsiArea.y, rsiArea.w, y70 - rsiArea.y);
      ctx.fillStyle = 'rgba(14,203,129,0.07)';
      ctx.fillRect(rsiArea.x, y30, rsiArea.w, rsiArea.y + rsiArea.h - y30);

      // Collect visible RSI points
      const pts: { x: number; y: number; v: number }[] = [];
      for (let i = startI; i <= endI; i++) {
        const v = rsi[i]; if (v === null) continue;
        pts.push({ x: idxToX(i + 0.5, vp, priceArea), y: rsiY(v), v });
      }

      if (pts.length >= 2) {
        // Gradient fill below RSI line (from line to panel bottom)
        const lastV = pts[pts.length - 1].v;
        const gradColor = lastV > 70 ? '246,70,93' : lastV < 30 ? '14,203,129' : '56,189,248';
        const grad = ctx.createLinearGradient(0, rsiArea.y, 0, rsiArea.y + rsiArea.h);
        grad.addColorStop(0,   `rgba(${gradColor},0.30)`);
        grad.addColorStop(0.6, `rgba(${gradColor},0.10)`);
        grad.addColorStop(1,   `rgba(${gradColor},0.00)`);
        ctx.beginPath();
        pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.lineTo(pts[pts.length - 1].x, rsiArea.y + rsiArea.h);
        ctx.lineTo(pts[0].x, rsiArea.y + rsiArea.h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // RSI line
        ctx.beginPath();
        ctx.strokeStyle = lastV > 70 ? 'rgba(246,70,93,0.9)' : lastV < 30 ? 'rgba(14,203,129,0.9)' : 'rgba(56,189,248,0.9)';
        ctx.lineWidth = 1.5;
        pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
      }

      // RSI MA(9) line — EMA of RSI, orange like Binance
      {
        const rsiMa = indicatorArrays.rsiMaArr;
        const maPts: { x: number; y: number }[] = [];
        for (let i = startI; i <= endI; i++) {
          const v = rsiMa[i]; if (v === null) continue;
          maPts.push({ x: idxToX(i + 0.5, vp, priceArea), y: rsiY(v) });
        }
        if (maPts.length >= 2) {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(243,146,55,0.85)';
          ctx.lineWidth = 1.2;
          maPts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
          ctx.stroke();
        }
      }

      // Reference lines at 70, 50, 30
      [[70, 'rgba(246,70,93,0.4)'], [50, 'rgba(120,130,150,0.35)'], [30, 'rgba(14,203,129,0.4)']].forEach(([level, col]) => {
        ctx.beginPath();
        ctx.strokeStyle = col as string;
        ctx.lineWidth = 0.75;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(rsiArea.x, rsiY(level as number));
        ctx.lineTo(rsiArea.x + rsiArea.w, rsiY(level as number));
        ctx.stroke();
        ctx.setLineDash([]);
        // Level label on right axis
        ctx.fillStyle = col as string;
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(level), rsiArea.x + rsiArea.w - 2, rsiY(level as number) - 2);
      });

      // RSI(14) · MA(9) static labels — only when not hovering (hover block draws values instead)
      if (!crosshair.visible) {
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'right';
        const axisEdge = rsiArea.x + rsiArea.w;
        ctx.fillStyle = 'rgba(243,146,55,0.8)';
        ctx.fillText('MA(9)', axisEdge - 4, rsiArea.y + 10);
        const maLabelW = ctx.measureText('MA(9)').width;
        ctx.fillStyle = 'rgba(160,170,185,0.7)';
        ctx.fillText('RSI(14)', axisEdge - 4 - maLabelW - 6, rsiArea.y + 10);
      }

    }

    // ── Drawings ─────────────────────────────────────────────────────────
    const allDrawings = previewDrawing
      ? [...drawings, previewDrawing]
      : drawings;

    allDrawings.forEach(d => {
      const isPreview  = previewDrawing !== null && d.id === previewDrawing.id;
      const isInactive = !isPreview && d.active === false;
      if (isInactive) {
        ctx.save();
        ctx.globalAlpha = 0.35;
      }
      if (d.type === 'trendline') {
        renderTrendline(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle, isInactive);
      } else if (d.type === 'box') {
        renderBox(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle, isInactive);
      } else if (d.type === 'hline') {
        renderHline(ctx, d, vp, priceArea, isPreview, hoverHandle, draggingHandle, isInactive);
      } else if (d.type === 'fib') {
        renderFib(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle, isInactive);
      } else if (d.type === 'pricerange') {
        renderPriceRange(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle, isInactive);
      } else if (d.type === 'daterange') {
        renderDateRange(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle, isInactive);
      } else if (d.type === 'channel') {
        renderChannel(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle, isInactive);
      } else if (d.type === 'text') {
        renderText(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle);
      } else if (d.type === 'label') {
        renderLabel(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle);
      } else if (d.type === 'xabcd') {
        renderXabcd(ctx, d, candles, vp, priceArea, isPreview, hoverHandle, draggingHandle);
      } else if (d.type === 'brush') {
        renderBrush(ctx, d, candles, vp, priceArea);
      }
      if (isInactive) ctx.restore();
    });

    // ── Y-Axis (right) ───────────────────────────────────────────────────
    const axisX = priceArea.x + priceArea.w;
    ctx.fillStyle = AXIS_BG;
    ctx.fillRect(axisX, 0, layout.paddingRight, height);
    ctx.strokeStyle = AXIS_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX, priceArea.y);
    ctx.lineTo(axisX, rsiArea.y + rsiArea.h);
    ctx.stroke();

    ctx.fillStyle = TEXT;
    ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
    ctx.textAlign = 'left';
    priceTicks.forEach(price => {
      const y = priceToY(price, vp, priceArea);
      if (y < priceArea.y + 8 || y > priceArea.y + priceArea.h - 6) return;
      ctx.fillStyle = TEXT;
      ctx.fillText(formatPrice(price), axisX + 6, y + 4);

      // Tick mark
      ctx.strokeStyle = AXIS_LINE;
      ctx.beginPath();
      ctx.moveTo(axisX, y);
      ctx.lineTo(axisX + 4, y);
      ctx.stroke();
    });

    allDrawings.forEach(d => {
      if (d.type !== 'hline' || !d.showAxisLabel) return;
      renderHlineAxisBadge(ctx, d, vp, priceArea, axisX);
    });

    // ── Futures positions & orders overlay ───────────────────────────────
    // Drawn AFTER Y-axis background so axis-zone tags are visible
    if (positions.length > 0 || orders.length > 0 || tp1Lines.length > 0) {
      renderPositionOverlay(ctx, positions, orders, vp, priceArea, axisX, tp1Lines);
    }

    // ── L2L Overlay ──────────────────────────────────────────────────────
    if (l2lOverlay) {
      renderL2LOverlay(ctx, l2lOverlay, vp, priceArea, axisX);
    }

    // ── Current RSI badge on right axis (drawn after Y-axis BG) ──────────
    {
      const rsi = indicatorArrays.rsiArr;
      const curRsi = (() => { for (let i = endI; i >= startI; i--) { const v = rsi[i]; if (v !== null) return v; } return null; })();
      if (curRsi !== null) {
        const rsiToY  = (v: number) => rsiArea.y + rsiArea.h - (v / 100) * rsiArea.h;
        const vCol    = curRsi > 70 ? '#f6465d' : curRsi < 30 ? '#0ecb81' : '#38bdf8';
        const curRsiY = rsiToY(curRsi);
        // Dashed line across RSI panel
        ctx.strokeStyle = vCol;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rsiArea.x, curRsiY);
        ctx.lineTo(axisX, curRsiY);
        ctx.stroke();
        ctx.setLineDash([]);
        // Colored filled badge on right axis (same style as price badge)
        const rsiLabel = curRsi.toFixed(1);
        ctx.font = '10px "SF Mono","Cascadia Code",Consolas,monospace';
        const bw = ctx.measureText(rsiLabel).width + 12;
        ctx.fillStyle = vCol;
        ctx.fillRect(axisX, curRsiY - 9, bw, 18);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(rsiLabel, axisX + 5, curRsiY + 4);
      }
    }

    // ── X-Axis (bottom) ───────────────────────────────────────────────────
    const xAxisY = rsiArea.y + rsiArea.h;
    ctx.fillStyle = AXIS_BG;
    ctx.fillRect(0, xAxisY, width, layout.paddingBottom);
    ctx.strokeStyle = AXIS_LINE;
    ctx.beginPath();
    ctx.moveTo(priceArea.x, xAxisY);
    ctx.lineTo(axisX, xAxisY);
    ctx.stroke();

    ctx.fillStyle = TEXT;
    ctx.textAlign = 'center';
    ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
    timeTicks.forEach(idx => {
      if (idx < 0) return;
      const x = idxToX(idx + 0.5, vp, priceArea);
      const ts = candleTimeAt(candles, idx, interval);
      const isFuture = idx >= candles.length;
      ctx.fillStyle = isFuture ? 'rgba(132,142,156,0.45)' : TEXT;
      ctx.fillText(formatTime(ts, interval), x, xAxisY + 14);
    });
    ctx.fillStyle = TEXT;

    // ── Current price dashed line ─────────────────────────────────────────
    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      const isBull = last.close >= last.open;
      const color = isBull ? BULL : BEAR;
      const y = priceToY(last.close, vp, priceArea);

      if (y >= priceArea.y && y <= priceArea.y + priceArea.h) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(priceArea.x, y);
        ctx.lineTo(axisX, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price label + countdown on Y-axis
        const label = formatPrice(last.close);
        const h = Math.floor(countdown / 3600);
        const m = Math.floor((countdown % 3600) / 60);
        const s = countdown % 60;
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const cdLabel = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
        const priceLw  = ctx.measureText(label).width;
        const cdLw     = ctx.measureText(cdLabel).width;
        const boxW = Math.max(priceLw, cdLw) + 12;
        const boxH = 30;  // price row + countdown row
        ctx.fillStyle = color;
        ctx.fillRect(axisX, y - boxH / 2, boxW, boxH);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
        ctx.fillText(label,   axisX + 6, y - 3);
        ctx.font = '10px "SF Mono","Cascadia Code",Consolas,monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(cdLabel, axisX + 6, y + 11);
      }
    }

    // ── MA legend (top-left) ────────────────────────────────────────────
    ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
    ctx.textAlign = 'left';
    let legendX = priceArea.x + 8;
    const legendY1 = priceArea.y + 16;
    const legendY2 = priceArea.y + 30;
    if (!anyIndicatorOn) MA_DEFS.forEach(({ period, color, label }) => {
      const maArr = maArrays[period as 7 | 25 | 99];
      const lastVal = maArr[endI];
      if (lastVal === null) return;
      ctx.fillStyle = color;
      ctx.fillText(`${label}: ${formatPrice(lastVal)}`, legendX, legendY1);
      legendX += ctx.measureText(`${label}: ${formatPrice(lastVal)}`).width + 16;
    });
    // Coin Duck MA&BB legend
    if (indicators.coinDuckMABB && indicatorArrays.cdMAs && indicatorArrays.cdBB) {
      let lx2 = priceArea.x + 8;
      CD_MA_DEFS.forEach(({ period, color, label }) => {
        const v = indicatorArrays.cdMAs![period as keyof typeof indicatorArrays.cdMAs][endI];
        if (v === null) return;
        ctx.fillStyle = color;
        const txt = `${label}: ${formatPrice(v)}`;
        ctx.fillText(txt, lx2, legendY2);
        lx2 += ctx.measureText(txt).width + 12;
      });
      const bbu = indicatorArrays.cdBB.upper[endI];
      const bbl = indicatorArrays.cdBB.lower[endI];
      if (bbu !== null && bbl !== null) {
        ctx.fillStyle = 'rgba(91,155,213,0.8)';
        const txt = `BB: ${formatPrice(bbl)}~${formatPrice(bbu)}`;
        ctx.fillText(txt, lx2, legendY2);
      }
    }
    // Ichimoku legend (always shown together with MA&BB)
    if (indicators.coinDuckMABB && indicatorArrays.ichi) {
      const { tenkan, kijun, spanA, spanB } = indicatorArrays.ichi;
      const tV = tenkan[endI], kV = kijun[endI];
      const aV = spanA[endI + ICHI_DISP], bV = spanB[endI + ICHI_DISP];
      const ly = legendY2 + 14;
      let lx = priceArea.x + 8;
      ctx.font = '10px "SF Mono","Cascadia Code",Consolas,monospace';
      const parts: { txt: string; col: string }[] = [
        { txt: `전환: ${tV !== null ? formatPrice(tV) : '—'}`, col: '#0098ea' },
        { txt: `기준: ${kV !== null ? formatPrice(kV) : '—'}`, col: '#ff6b35' },
        { txt: `선행A: ${aV !== null ? formatPrice(aV) : '—'}`, col: '#01c234' },
        { txt: `선행B: ${bV !== null ? formatPrice(bV) : '—'}`, col: '#e13322' },
      ];
      parts.forEach(({ txt, col }) => {
        ctx.fillStyle = col;
        ctx.fillText(txt, lx, ly);
        lx += ctx.measureText(txt).width + 12;
      });
    }
    // DW Cloud legend
    if (indicators.dwCloud && indicatorArrays.dwEMA9 && indicatorArrays.dwEMA26) {
      const v9  = indicatorArrays.dwEMA9[endI];
      const v26 = indicatorArrays.dwEMA26[endI];
      if (v9 !== null && v26 !== null) {
        const bullish = v9 >= v26;
        const lxDW = indicators.coinDuckMABB ? legendX : priceArea.x + 8;
        const lyDW = legendY1;
        ctx.fillStyle = bullish ? '#0ecb81' : '#f6465d';
        ctx.fillText(bullish ? '▲DW구름' : '▼DW구름', lxDW, lyDW);
      }
    }

    // ── Crosshair ─────────────────────────────────────────────────────────
    if (crosshair.visible) {
      const { x: cx, y: cy } = crosshair;
      const totalBottom = xAxisY;

      ctx.strokeStyle = CROSS_H;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      // Horizontal (only in price area)
      if (cy >= priceArea.y && cy <= priceArea.y + priceArea.h) {
        ctx.beginPath();
        ctx.moveTo(priceArea.x, cy);
        ctx.lineTo(axisX, cy);
        ctx.stroke();

        // Y-axis label for crosshair price
        const crossPrice = vp.minPrice + ((priceArea.y + priceArea.h - cy) / priceArea.h) * (vp.maxPrice - vp.minPrice);
        const priceLabel = formatPrice(crossPrice);
        const plw = ctx.measureText(priceLabel).width + 12;
        ctx.setLineDash([]);
        ctx.fillStyle = '#2b3043';
        ctx.fillRect(axisX, cy - 9, plw, 18);
        ctx.strokeStyle = AXIS_LINE;
        ctx.strokeRect(axisX, cy - 9, plw, 18);
        ctx.fillStyle = '#d1d4dc';
        ctx.textAlign = 'left';
        ctx.fillText(priceLabel, axisX + 6, cy + 4);
        ctx.setLineDash([4, 4]);
      }

      // Vertical (full height)
      if (cx >= priceArea.x && cx <= axisX) {
        ctx.strokeStyle = CROSS_H;
        ctx.beginPath();
        ctx.moveTo(cx, priceArea.y);
        ctx.lineTo(cx, totalBottom);
        ctx.stroke();

        // X-axis time label
        const idxAtX = vp.startIdx + ((cx - priceArea.x) / priceArea.w) * (vp.endIdx - vp.startIdx);
        const candleIdx = Math.round(idxAtX - 0.5);
        if (candleIdx >= 0 && candleIdx < candles.length) {
          const timeLabel = formatTime(candles[candleIdx].time, interval);
          ctx.setLineDash([]);
          const tlw = ctx.measureText(timeLabel).width + 12;
          ctx.fillStyle = '#2b3043';
          ctx.fillRect(cx - tlw / 2, xAxisY, tlw, 18);
          ctx.strokeStyle = AXIS_LINE;
          ctx.strokeRect(cx - tlw / 2, xAxisY, tlw, 18);
          ctx.fillStyle = '#d1d4dc';
          ctx.textAlign = 'center';
          ctx.fillText(timeLabel, cx, xAxisY + 14);
        }
      }
      ctx.setLineDash([]);

      // ── OHLCV overlay (top-left) ────────────────────────────────────
      const idxAtX = vp.startIdx + ((cx - priceArea.x) / priceArea.w) * (vp.endIdx - vp.startIdx);
      const hoverIdx = Math.round(idxAtX - 0.5);
      if (hoverIdx >= 0 && hoverIdx < candles.length) {
        const hc = candles[hoverIdx];
        const isBull = hc.close >= hc.open;
        const col = isBull ? BULL : BEAR;
        const mono = '"SF Mono","Cascadia Code",Consolas,monospace';
        ctx.font = `11px ${mono}`;
        ctx.textAlign = 'left';
        const pad = priceArea.x + 8;
        const top = priceArea.y + 28;
        const items = [
          { label: 'O', val: formatPrice(hc.open) },
          { label: 'H', val: formatPrice(hc.high) },
          { label: 'L', val: formatPrice(hc.low) },
          { label: 'C', val: formatPrice(hc.close) },
          { label: 'V', val: hc.volume.toFixed(2) },
        ];
        items.forEach(({ label, val }, i) => {
          ctx.fillStyle = TEXT;
          ctx.fillText(label + ':', pad + i * 90, top);
          ctx.fillStyle = col;
          ctx.fillText(val, pad + i * 90 + 14, top);
        });

        // ── RSI value at hovered candle ────────────────────────────────
        const hoverRsi = indicatorArrays.rsiArr[hoverIdx];
        if (hoverRsi !== null) {
          const rsiHoverY = rsiArea.y + rsiArea.h - (hoverRsi / 100) * rsiArea.h;
          const rsiVCol   = hoverRsi > 70 ? '#f6465d' : hoverRsi < 30 ? '#0ecb81' : '#38bdf8';
          const axisX     = priceArea.x + priceArea.w;

          // Horizontal line across RSI panel at hovered RSI value
          ctx.strokeStyle = 'rgba(182,189,198,0.4)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(rsiArea.x, rsiHoverY);
          ctx.lineTo(axisX, rsiHoverY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Dot on RSI line at hovered position
          ctx.beginPath();
          ctx.arc(cx, rsiHoverY, 3, 0, Math.PI * 2);
          ctx.fillStyle = rsiVCol;
          ctx.fill();

          // RSI hover badge on right axis
          const rsiHoverLabel = hoverRsi.toFixed(1);
          ctx.font = '10px "SF Mono","Cascadia Code",Consolas,monospace';
          const bw = ctx.measureText(rsiHoverLabel).width + 10;
          ctx.fillStyle = '#2b3043';
          ctx.fillRect(axisX, rsiHoverY - 9, bw, 18);
          ctx.strokeStyle = rsiVCol;
          ctx.lineWidth = 1;
          ctx.strokeRect(axisX, rsiHoverY - 9, bw, 18);
          ctx.fillStyle = rsiVCol;
          ctx.textAlign = 'left';
          ctx.fillText(rsiHoverLabel, axisX + 5, rsiHoverY + 4);

          // RSI + MA hover values — top-right (aligned with static labels, overrides them)
          ctx.font = 'bold 10px "SF Mono","Cascadia Code",Consolas,monospace';
          const hoverRsiMa = indicatorArrays.rsiMaArr[hoverIdx];
          const axisEdgeHov = rsiArea.x + rsiArea.w;
          ctx.textAlign = 'right';
          if (hoverRsiMa !== null) {
            ctx.fillStyle = 'rgba(243,146,55,0.95)';
            ctx.fillText(`MA ${hoverRsiMa.toFixed(1)}`, axisEdgeHov - 4, rsiArea.y + 10);
            const maHovW = ctx.measureText(`MA ${hoverRsiMa.toFixed(1)}`).width;
            ctx.fillStyle = rsiVCol;
            ctx.fillText(`RSI ${rsiHoverLabel}`, axisEdgeHov - 4 - maHovW - 8, rsiArea.y + 10);
          } else {
            ctx.fillStyle = rsiVCol;
            ctx.fillText(`RSI ${rsiHoverLabel}`, axisEdgeHov - 4, rsiArea.y + 10);
          }
        }
      }
    }
  }, [candles, interval, drawings, previewDrawing, crosshair, hoverHandle, draggingHandle, maArrays, indicatorArrays, indicators, positions, orders, countdown, tp1Lines, l2lOverlay]);

  return { render };
}

// ── Trendline renderer ────────────────────────────────────────────────────────
function renderTrendline(
  ctx: CanvasRenderingContext2D,
  d: TrendlineDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  isInactive = false,
) {
  const baseColor = d.color ?? '#3b8beb';
  const p1px = pointToPixel(d.p1, candles, vp, area);
  const p2px = pointToPixel(d.p2, candles, vp, area);
  const { startPx, endPx } = extendRay(p1px, p2px, area);

  ctx.strokeStyle = isPreview ? hexToRgba(baseColor, 0.5) : baseColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(getLineDash(d.lineStyle, isPreview || isInactive));
  ctx.beginPath();
  ctx.moveTo(startPx.x, startPx.y);
  ctx.lineTo(endPx.x, endPx.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!isPreview) {
    // Highlight line when body is hovered/dragged
    const isBodyHovered  = hoverHandle?.drawingId  === d.id && hoverHandle?.handleIdx  === -1;
    const isBodyDragging = draggingHandle?.drawingId === d.id && draggingHandle?.handleIdx === -1;
    if (isBodyHovered || isBodyDragging) {
      ctx.strokeStyle = hexToRgba(baseColor, 0.4);
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(startPx.x, startPx.y);
      ctx.lineTo(endPx.x, endPx.y);
      ctx.stroke();
    }
    drawHandle(ctx, p1px, d.id, 0, hoverHandle, draggingHandle, baseColor);
    drawHandle(ctx, p2px, d.id, 1, hoverHandle, draggingHandle, baseColor);

    // Memo text — shown above the start (left/earlier) point
    if (d.memo?.trim()) {
      ctx.save();
      ctx.font = 'bold 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      ctx.textAlign = 'left';
      const textX = Math.max(area.x + 4, startPx.x + 4);
      const textY = startPx.y - 8;
      if (textY > area.y + 4 && textY < area.y + area.h) {
        const tw = ctx.measureText(d.memo).width;
        ctx.fillStyle = 'rgba(13,17,28,0.78)';
        ctx.fillRect(textX - 2, textY - 12, tw + 6, 15);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(d.memo, textX, textY);
      }
      ctx.restore();
    }
  }
}

// ── Box renderer ──────────────────────────────────────────────────────────────
function renderBox(
  ctx: CanvasRenderingContext2D,
  d: BoxDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  isInactive = false,
) {
  const baseColor = d.color ?? '#e8b73a';
  const p1px = pointToPixel(d.p1, candles, vp, area);
  const p2px = pointToPixel(d.p2, candles, vp, area);

  const left  = Math.min(p1px.x, p2px.x);
  const right = Math.max(p1px.x, p2px.x);
  const top   = Math.min(p1px.y, p2px.y);
  const bot   = Math.max(p1px.y, p2px.y);
  const bw = right - left;
  const bh = bot - top;

  ctx.fillStyle = isPreview ? hexToRgba(baseColor, 0.07) : hexToRgba(baseColor, 0.09);
  ctx.fillRect(left, top, bw, bh);

  ctx.strokeStyle = isPreview ? hexToRgba(baseColor, 0.5) : baseColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(getLineDash(undefined, isPreview || isInactive));
  ctx.strokeRect(left, top, bw, bh);
  ctx.setLineDash([]);

  if (!isPreview) {
    if (d.showPriceLabels !== false) {
      ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
      ctx.fillStyle = baseColor;
      ctx.textAlign = 'right';
      ctx.fillText(formatPrice(d.topPrice), right - 4, top + 12);
      ctx.fillText(formatPrice(d.bottomPrice), right - 4, bot - 4);
    }

    // Body-hover highlight (handleIdx === -1 means body)
    const isBodyHovered  = hoverHandle?.drawingId  === d.id && hoverHandle?.handleIdx  === -1;
    const isBodyDragging = draggingHandle?.drawingId === d.id && draggingHandle?.handleIdx === -1;
    if (isBodyHovered || isBodyDragging) {
      ctx.fillStyle = hexToRgba(baseColor, 0.1);
      ctx.fillRect(left, top, bw, bh);
    }

    // 4 corner handles: 0=TL 1=TR 2=BR 3=BL
    for (let i = 0; i < d.corners.length; i++) {
      const cpx = pointToPixel({ time: d.corners[i].time, price: d.corners[i].price }, candles, vp, area);
      drawHandle(ctx, cpx, d.id, i, hoverHandle, draggingHandle, baseColor);
    }

    // Memo text — shown inside the box near the top-left corner
    if (d.memo?.trim()) {
      ctx.save();
      ctx.font = 'bold 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      const memoAlign = d.memoAlign ?? 'left';
      const isCentered = memoAlign === 'center';
      ctx.textAlign = memoAlign;
      const textY = isCentered ? top + bh / 2 + 4 : top + 22;
      const textX = memoAlign === 'right'
        ? right - 6
        : memoAlign === 'center'
          ? left + bw / 2
          : left + 6;
      if (textY > area.y && textY < area.y + area.h && textX < right - 4) {
        const fullWidth = ctx.measureText(d.memo).width;
        const tw = Math.min(fullWidth, Math.max(0, bw - 12));
        const bgX = memoAlign === 'right'
          ? textX - tw - 4
          : memoAlign === 'center'
            ? textX - tw / 2 - 4
            : textX - 2;
        ctx.fillStyle = 'rgba(13,17,28,0.78)';
        ctx.fillRect(bgX, textY - 12, tw + 8, 15);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(d.memo, textX, textY);
      }
      ctx.restore();
    }
  }
}

// ── Text drawing renderer ─────────────────────────────────────────────────────
function renderText(
  ctx: CanvasRenderingContext2D,
  d: TextDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  _isPreview: boolean,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
) {
  const pos = pointToPixel(d.p, candles, vp, area);
  const color = d.color ?? '#d1d4dc';
  const fontSize = d.fontSize ?? 13;
  const isHovered = hoverHandle?.drawingId === d.id;
  const isDragging = draggingHandle?.drawingId === d.id;

  ctx.save();
  // Anchor dot
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  // Text
  ctx.font = `${fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = color;
  if (isHovered || isDragging) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
  ctx.fillText(d.text, pos.x + 6, pos.y + 2);
  ctx.restore();
}

// ── Label drawing renderer ────────────────────────────────────────────────────
function renderLabel(
  ctx: CanvasRenderingContext2D,
  d: LabelDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
) {
  const p1px = pointToPixel(d.p1, candles, vp, area);
  const p2px = pointToPixel(d.p2, candles, vp, area);
  const left = Math.min(p1px.x, p2px.x);
  const right = Math.max(p1px.x, p2px.x);
  const top = Math.min(p1px.y, p2px.y);
  const bot = Math.max(p1px.y, p2px.y);
  const bw = right - left;
  const bh = bot - top;
  const baseColor = d.color ?? '#e8b73a';
  const fontSize = d.fontSize ?? 13;
  const isBodyHovered = hoverHandle?.drawingId === d.id && hoverHandle.handleIdx === -1;
  const isBodyDragging = draggingHandle?.drawingId === d.id && draggingHandle.handleIdx === -1;

  ctx.fillStyle = hexToRgba(baseColor, isBodyHovered || isBodyDragging ? 0.18 : 0.09);
  ctx.fillRect(left, top, bw, bh);
  ctx.strokeStyle = isPreview ? hexToRgba(baseColor, 0.5) : hexToRgba(baseColor, isBodyHovered ? 0.9 : 0.7);
  ctx.lineWidth = isBodyHovered || isBodyDragging ? 2 : 1.5;
  ctx.setLineDash(isPreview ? [6, 4] : []);
  ctx.strokeRect(left, top, bw, bh);
  ctx.setLineDash([]);

  if (!isPreview && d.text) {
    ctx.save();
    ctx.font = `${fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
    ctx.fillStyle = baseColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = left + bw / 2;
    const cy = top + bh / 2;
    const maxW = bw - 12;
    if (maxW > 10) ctx.fillText(d.text, cx, cy, maxW);
    ctx.restore();
  }

  if (!isPreview) {
    for (let i = 0; i < d.corners.length; i++) {
      const cpx = pointToPixel({ time: d.corners[i].time, price: d.corners[i].price }, candles, vp, area);
      drawHandle(ctx, cpx, d.id, i, hoverHandle, draggingHandle, baseColor);
    }
  }
}

// ── Handle dot ────────────────────────────────────────────────────────────────
function drawHandle(
  ctx: CanvasRenderingContext2D,
  px: PixelPoint,
  drawingId: string,
  handleIdx: number,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  baseColor: string = '#3b8beb',
) {
  const isHovered  = hoverHandle?.drawingId  === drawingId && hoverHandle?.handleIdx  === handleIdx;
  const isDragging = draggingHandle?.drawingId === drawingId && draggingHandle?.handleIdx === handleIdx;
  const r     = isHovered || isDragging ? 6 : 4;
  const color = isDragging ? '#f59e42' : isHovered ? '#f59e42' : baseColor;

  ctx.beginPath();
  ctx.arc(px.x, px.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#131722';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ── Horizontal line renderer ──────────────────────────────────────────────────
function renderHline(
  ctx: CanvasRenderingContext2D,
  d: HlineDrawing,
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  isInactive = false,
) {
  const baseColor = d.color ?? '#0ecb81';
  const py = priceToY(d.price, vp, area);
  if (py < area.y - 4 || py > area.y + area.h + 4) return; // out of visible range

  // Hover/drag body highlight (wide glow behind the line)
  const isBodyHovered  = hoverHandle?.drawingId  === d.id && hoverHandle?.handleIdx  === -1;
  const isBodyDragging = draggingHandle?.drawingId === d.id && draggingHandle?.handleIdx === -1;
  if (isBodyHovered || isBodyDragging) {
    ctx.strokeStyle = hexToRgba(baseColor, 0.35);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(area.x, py);
    ctx.lineTo(area.x + area.w, py);
    ctx.stroke();
  }

  // Main horizontal line
  ctx.strokeStyle = isPreview ? hexToRgba(baseColor, 0.5) : baseColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(getLineDash(d.lineStyle, isPreview || isInactive));
  ctx.beginPath();
  ctx.moveTo(area.x, py);
  ctx.lineTo(area.x + area.w, py);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!isPreview) {
    if (d.showPriceLabel !== false) {
      // Price label near the right edge (above the line to not overlap with axis)
      ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
      ctx.fillStyle = hexToRgba(baseColor, 0.85);
      ctx.textAlign = 'right';
      ctx.fillText(formatPrice(d.price), area.x + area.w - 6, py - 4);
    }

    // Center handle for dragging
    const centerX = area.x + area.w / 2;
    drawHandle(ctx, { x: centerX, y: py }, d.id, 0, hoverHandle, draggingHandle, baseColor);

    // Memo text
    if (d.memo?.trim()) {
      ctx.save();
      ctx.font = 'bold 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      const memoAlign = d.memoAlign ?? 'left';
      ctx.textAlign = memoAlign;
      const tw = ctx.measureText(d.memo).width;
      const textX = memoAlign === 'right'
        ? area.x + area.w - 8
        : memoAlign === 'center'
          ? area.x + area.w / 2
          : area.x + 8;
      const textY = py - 8;
      if (textY > area.y + 4) {
        const bgX = memoAlign === 'right'
          ? textX - tw - 4
          : memoAlign === 'center'
            ? textX - tw / 2 - 4
            : area.x + 6;
        ctx.fillStyle = 'rgba(13,17,28,0.78)';
        ctx.fillRect(bgX, textY - 12, tw + 8, 15);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(d.memo, textX, textY);
      }
      ctx.restore();
    }
  }
}

function renderHlineAxisBadge(
  ctx: CanvasRenderingContext2D,
  d: HlineDrawing,
  vp: ChartViewport,
  area: ChartArea,
  axisX: number,
) {
  const bgColor = d.color ?? '#0ecb81';
  const y = priceToY(d.price, vp, area);
  if (y < area.y - 10 || y > area.y + area.h + 10) return;

  ctx.save();
  ctx.font = 'bold 10px "SF Mono","Cascadia Code",Consolas,monospace';
  const label = formatPrice(d.price);
  const tagW = ctx.measureText(label).width + 12;
  ctx.fillStyle = bgColor;
  ctx.fillRect(axisX + 1, y - 9, tagW, 18);
  ctx.fillStyle = getBadgeTextColor(bgColor);
  ctx.textAlign = 'left';
  ctx.fillText(label, axisX + 6, y + 4);
  ctx.restore();
}

// ── Fibonacci Retracement renderer ───────────────────────────────────────────
function renderFib(
  ctx: CanvasRenderingContext2D,
  d: FibRetracementDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  isInactive = false,
) {
  const handleColor = d.color ?? '#e8b73a';
  const p1px = pointToPixel(d.p1, candles, vp, area);
  const p2px = pointToPixel(d.p2, candles, vp, area);
  const leftX = Math.min(p1px.x, p2px.x);
  const rightX = area.x + area.w;
  const range = d.p2.price - d.p1.price;

  ctx.save();
  if (isPreview) ctx.globalAlpha = 0.55;

  // Zone fills between consecutive levels
  for (let i = 0; i < FIB_LEVELS.length - 1; i++) {
    const price1 = d.p1.price + FIB_LEVELS[i] * range;
    const price2 = d.p1.price + FIB_LEVELS[i + 1] * range;
    const y1 = priceToY(price1, vp, area);
    const y2 = priceToY(price2, vp, area);
    const topY = Math.max(Math.min(y1, y2), area.y);
    const botY = Math.min(Math.max(y1, y2), area.y + area.h);
    if (botY <= topY) continue;
    ctx.fillStyle = hexToRgba(FIB_LEVEL_COLORS[i], 0.06);
    ctx.fillRect(leftX, topY, rightX - leftX, botY - topY);
  }

  // Horizontal lines at each fib level
  FIB_LEVELS.forEach((lvl, i) => {
    const price = d.p1.price + lvl * range;
    const y = priceToY(price, vp, area);
    if (y < area.y - 4 || y > area.y + area.h + 4) return;

    ctx.strokeStyle = hexToRgba(FIB_LEVEL_COLORS[i], isPreview || isInactive ? 0.55 : 0.85);
    ctx.lineWidth = (lvl === 0 || lvl === 1) ? 1.5 : 1;
    if (isPreview || isInactive) ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(leftX, y);
    ctx.lineTo(rightX, y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!isPreview) {
      ctx.font = '10px "SF Mono","Cascadia Code",Consolas,monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = hexToRgba(FIB_LEVEL_COLORS[i], 0.9);
      const pctLabel = lvl === 0 ? '0%' : lvl === 1 ? '100%' : `${(lvl * 100).toFixed(1)}%`;
      ctx.fillText(`${pctLabel} ${formatPrice(price)}`, rightX - 6, y - 3);
    }
  });

  if (!isPreview) {
    // Dashed connector between endpoints
    ctx.strokeStyle = hexToRgba(handleColor, 0.45);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(p1px.x, p1px.y);
    ctx.lineTo(p2px.x, p2px.y);
    ctx.stroke();
    ctx.setLineDash([]);

    drawHandle(ctx, p1px, d.id, 0, hoverHandle, draggingHandle, handleColor);
    drawHandle(ctx, p2px, d.id, 1, hoverHandle, draggingHandle, handleColor);
  }

  ctx.restore();
}

// ── Price Range renderer ──────────────────────────────────────────────────────
function renderPriceRange(
  ctx: CanvasRenderingContext2D,
  d: PriceRangeDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  isInactive = false,
) {
  const baseColor = d.color ?? '#22d3ee';
  const p1px = pointToPixel(d.p1, candles, vp, area);
  const p2px = pointToPixel(d.p2, candles, vp, area);

  const left  = Math.min(p1px.x, p2px.x);
  const right = Math.max(p1px.x, p2px.x);
  const top   = Math.min(p1px.y, p2px.y);
  const bot   = Math.max(p1px.y, p2px.y);
  const midX  = (left + right) / 2;
  const midY  = (top + bot) / 2;
  const bh = bot - top;

  // Directional: p1 = first click, p2 = second click
  const priceDiff = d.p2.price - d.p1.price;  // negative = down, positive = up
  const pctDiff   = d.p1.price > 0 ? (priceDiff / d.p1.price * 100) : 0;

  // Direction-aware color: green for up (p2 > p1), red for down (p2 < p1)
  const dirColor = priceDiff >= 0 ? '#0ecb81' : '#f6465d';
  const fillColor = isPreview ? baseColor : dirColor;

  ctx.save();
  if (isPreview) ctx.globalAlpha = 0.55;

  // Filled rectangle
  ctx.fillStyle = hexToRgba(fillColor, 0.08);
  ctx.fillRect(left, top, right - left, bh);

  // Border
  ctx.strokeStyle = hexToRgba(fillColor, isPreview || isInactive ? 0.5 : 0.8);
  ctx.lineWidth = 1.5;
  if (isPreview || isInactive) ctx.setLineDash([5, 3]);
  ctx.strokeRect(left, top, right - left, bh);
  ctx.setLineDash([]);

  if (!isPreview) {
    // Body-hover highlight
    const isBodyHovered  = hoverHandle?.drawingId  === d.id && hoverHandle?.handleIdx  === -1;
    const isBodyDragging = draggingHandle?.drawingId === d.id && draggingHandle?.handleIdx === -1;
    if (isBodyHovered || isBodyDragging) {
      ctx.fillStyle = hexToRgba(fillColor, 0.1);
      ctx.fillRect(left, top, right - left, bh);
    }

    // Directional arrow on the left side: from p1 toward p2
    const bx = left + 12;
    const arrowH = Math.min(6, bh * 0.2);
    ctx.fillStyle = hexToRgba(fillColor, 0.7);
    // Arrowhead at p2 side
    ctx.beginPath();
    if (priceDiff > 0) {
      // up: arrowhead at top
      ctx.moveTo(bx, top + 2);
      ctx.lineTo(bx - 4, top + 2 + arrowH);
      ctx.lineTo(bx + 4, top + 2 + arrowH);
    } else {
      // down: arrowhead at bottom
      ctx.moveTo(bx, bot - 2);
      ctx.lineTo(bx - 4, bot - 2 - arrowH);
      ctx.lineTo(bx + 4, bot - 2 - arrowH);
    }
    ctx.closePath();
    ctx.fill();
    // Vertical connector
    if (bh > arrowH + 8) {
      ctx.strokeStyle = hexToRgba(fillColor, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, priceDiff > 0 ? top + 2 + arrowH : top + 2);
      ctx.lineTo(bx, priceDiff > 0 ? bot - 2          : bot - 2 - arrowH);
      ctx.stroke();
    }
    // Tick at the tail (p1 side)
    ctx.strokeStyle = hexToRgba(fillColor, 0.5);
    ctx.lineWidth = 1.5;
    const tickY = priceDiff > 0 ? bot : top;
    ctx.beginPath();
    ctx.moveTo(bx - 4, tickY);
    ctx.lineTo(bx + 4, tickY);
    ctx.stroke();

    // Center label: ΔPrice and % with sign
    if (bh > 24) {
      const sign = priceDiff >= 0 ? '+' : '';
      const diffLabel = `${sign}${formatPrice(priceDiff)}  ${sign}${pctDiff.toFixed(2)}%`;
      ctx.font = 'bold 10px "SF Mono","Cascadia Code",Consolas,monospace';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(diffLabel).width;
      ctx.fillStyle = 'rgba(13,17,28,0.8)';
      ctx.fillRect(midX - tw / 2 - 3, midY - 8, tw + 6, 13);
      ctx.fillStyle = hexToRgba(fillColor, 0.95);
      ctx.fillText(diffLabel, midX, midY + 3);
    }

    // Price labels on right edge: p1 at p1px.y, p2 at p2px.y
    ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = hexToRgba(fillColor, 0.85);
    // p1 label
    const p1LabelY = Math.max(p1px.y + 12, top + 12);
    ctx.fillText(formatPrice(d.p1.price), right - 4, p1LabelY);
    // p2 label (avoid overlap with p1)
    const p2LabelY = priceDiff >= 0 ? Math.min(p2px.y + 12, bot - 4) : Math.max(p2px.y - 4, top + 12);
    if (Math.abs(p2LabelY - p1LabelY) > 14) {
      ctx.fillText(formatPrice(d.p2.price), right - 4, priceDiff >= 0 ? top + 12 : bot - 4);
    }

    drawHandle(ctx, p1px, d.id, 0, hoverHandle, draggingHandle, fillColor);
    drawHandle(ctx, p2px, d.id, 1, hoverHandle, draggingHandle, fillColor);
  }

  ctx.restore();
}

// ── Date Range renderer ───────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function renderDateRange(
  ctx: CanvasRenderingContext2D,
  d: DateRangeDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  isInactive = false,
) {
  const baseColor = d.color ?? '#a855f7';
  const p1px = pointToPixel(d.p1, candles, vp, area);
  const p2px = pointToPixel(d.p2, candles, vp, area);

  const leftX  = Math.min(p1px.x, p2px.x);
  const rightX = Math.max(p1px.x, p2px.x);
  const topY   = area.y;
  const botY   = area.y + area.h;
  const midY   = (topY + botY) / 2;
  const midX   = (leftX + rightX) / 2;
  const bandW  = rightX - leftX;

  // Handle indices: 0 = whichever handle is at p1 (could be left or right)
  const p1IsLeft = d.p1.time <= d.p2.time;
  const leftHandleIdx  = p1IsLeft ? 0 : 1;
  const rightHandleIdx = p1IsLeft ? 1 : 0;

  ctx.save();
  if (isPreview) ctx.globalAlpha = 0.55;

  // Shaded band
  ctx.fillStyle = hexToRgba(baseColor, 0.07);
  ctx.fillRect(leftX, topY, bandW, botY - topY);

  // Left vertical boundary
  ctx.strokeStyle = hexToRgba(baseColor, isPreview || isInactive ? 0.5 : 0.8);
  ctx.lineWidth = 1.5;
  if (isPreview || isInactive) ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(leftX, topY);
  ctx.lineTo(leftX, botY);
  ctx.stroke();

  // Right vertical boundary
  ctx.beginPath();
  ctx.moveTo(rightX, topY);
  ctx.lineTo(rightX, botY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Dashed horizontal arrow at mid-height
  ctx.strokeStyle = hexToRgba(baseColor, 0.35);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(leftX, midY);
  ctx.lineTo(rightX, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!isPreview) {
    // Body-hover highlight
    const isBodyHovered  = hoverHandle?.drawingId  === d.id && hoverHandle?.handleIdx  === -1;
    const isBodyDragging = draggingHandle?.drawingId === d.id && draggingHandle?.handleIdx === -1;
    if (isBodyHovered || isBodyDragging) {
      ctx.fillStyle = hexToRgba(baseColor, 0.08);
      ctx.fillRect(leftX, topY, bandW, botY - topY);
    }

    // Duration label
    const durationLabel = formatDuration(d.p2.time - d.p1.time);
    ctx.font = 'bold 11px "SF Mono","Cascadia Code",Consolas,monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(durationLabel).width;
    if (bandW > tw + 16) {
      ctx.fillStyle = 'rgba(13,17,28,0.8)';
      ctx.fillRect(midX - tw / 2 - 3, midY - 8, tw + 6, 13);
      ctx.fillStyle = hexToRgba(baseColor, 0.95);
      ctx.fillText(durationLabel, midX, midY + 3);
    }

    // Handles at mid-height of boundary lines
    drawHandle(ctx, { x: leftX,  y: midY }, d.id, leftHandleIdx,  hoverHandle, draggingHandle, baseColor);
    drawHandle(ctx, { x: rightX, y: midY }, d.id, rightHandleIdx, hoverHandle, draggingHandle, baseColor);
  }

  ctx.restore();
}

// ── Futures position & order overlay ─────────────────────────────────────────────
function orderTypeShort(type: string): string {
  switch (type) {
    case 'LIMIT':                return 'LMT';
    case 'MARKET':               return 'MKT';
    case 'STOP':                 return 'STOP';
    case 'STOP_MARKET':          return 'STOP';
    case 'TAKE_PROFIT':          return 'TP';
    case 'TAKE_PROFIT_MARKET':   return 'TP';
    case 'TRAILING_STOP_MARKET': return 'TRAIL';
    default:                     return type.slice(0, 5);
  }
}

function renderPositionOverlay(
  ctx: CanvasRenderingContext2D,
  positions: FuturesPosition[],
  orders: FuturesOrder[],
  vp: ChartViewport,
  area: ChartArea,
  axisX: number,
  tp1Lines: Array<{ price: number; hit: boolean }> = [],
) {
  const mono = '"SF Mono","Cascadia Code",Consolas,monospace';

  // Pulse value shared across all positions (0 → 1 → 0, period ~2s)
  const pulse = (Math.sin(Date.now() / 320) + 1) / 2;

  // ── Positions ──────────────────────────────────────────────────────────
  positions.forEach(p => {
    const isLong     = p.positionSide === 'LONG' || (p.positionSide === 'BOTH' && p.positionAmt > 0);
    const entryColor = isLong ? '#0ecb81' : '#f6465d';
    const liqColor   = '#f59e42';
    const pnlUsdt    = p.unrealizedProfit;
    const pnlSign    = pnlUsdt >= 0 ? '+' : '';
    const pnlColor   = pnlUsdt >= 0 ? '#0ecb81' : '#f6465d';
    const pnlUsdtStr = `${pnlSign}${pnlUsdt.toFixed(2)} USDT`;

    const ey = priceToY(p.entryPrice, vp, area);
    if (ey >= area.y && ey <= area.y + area.h) {

      // ── Pulsing glow + blinking line (all in one save/restore) ─────
      ctx.save();

      // Wide outer glow (fades in/out with pulse)
      ctx.globalAlpha = 0.06 + 0.20 * pulse;
      ctx.strokeStyle = entryColor;
      ctx.lineWidth = 12;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(area.x, ey);
      ctx.lineTo(axisX, ey);
      ctx.stroke();

      // Main line — opacity itself blinks (0.45 → 1.0)
      ctx.globalAlpha = 0.45 + 0.55 * pulse;
      ctx.strokeStyle = entryColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(area.x, ey);
      ctx.lineTo(axisX, ey);
      ctx.stroke();

      ctx.restore();

      // ── Arrow at left edge (▶ pointing right into the chart) ────────
      const aSize = 6;
      ctx.save();
      ctx.globalAlpha = 0.6 + 0.4 * pulse; // also pulses subtly
      ctx.fillStyle = entryColor;
      ctx.beginPath();
      ctx.moveTo(area.x + aSize * 1.6, ey);  // tip
      ctx.lineTo(area.x, ey - aSize);         // upper base
      ctx.lineTo(area.x, ey + aSize);         // lower base
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // ── Y-axis entry price tag (colored filled rect) ─────────────────
      ctx.font = `bold 10px ${mono}`;
      const entryLabel = formatPrice(p.entryPrice);
      const elw = ctx.measureText(entryLabel).width + 12;
      ctx.fillStyle = entryColor;
      ctx.fillRect(axisX, ey - 9, elw, 18);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(entryLabel, axisX + 6, ey + 4);

      // ── "LONG 10x" label — right-aligned, above the line ───────────
      ctx.font = `bold 11px ${mono}`;
      ctx.fillStyle = entryColor;
      ctx.textAlign = 'right';
      ctx.fillText(`${isLong ? 'LONG' : 'SHORT'} ${p.leverage}x`, axisX - 6, ey - 5);

      // ── PnL USDT — right-aligned, below the line ───────────────────
      ctx.font = `10px ${mono}`;
      ctx.fillStyle = pnlColor;
      ctx.textAlign = 'right';
      ctx.fillText(pnlUsdtStr, axisX - 6, ey + 14);
    }

    // ── Liquidation price line (dashed amber) ─────────────────────────
    if (p.liquidationPrice > 0) {
      const ly = priceToY(p.liquidationPrice, vp, area);
      if (ly >= area.y && ly <= area.y + area.h) {
        ctx.strokeStyle = liqColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(area.x, ly);
        ctx.lineTo(axisX, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        // Y-axis LIQ tag
        ctx.font = `bold 10px ${mono}`;
        const liqLabel = `LIQ  ${formatPrice(p.liquidationPrice)}`;
        const llw = ctx.measureText(liqLabel).width + 10;
        ctx.fillStyle = hexToRgba(liqColor, 0.75);
        ctx.fillRect(axisX, ly - 9, llw, 18);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(liqLabel, axisX + 5, ly + 4);
      }
    }
  });

  // ── Orders ─────────────────────────────────────────────────────────────
  orders.forEach(o => {
    const effPrice = o.price > 0 ? o.price : o.stopPrice;
    if (effPrice <= 0) return;
    const isBuy   = o.side === 'BUY';
    const baseCol = isBuy ? '#0ecb81' : '#f6465d';

    const oy = priceToY(effPrice, vp, area);
    if (oy < area.y || oy > area.y + area.h) return;

    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = baseCol;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(area.x, oy);
    ctx.lineTo(axisX, oy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Right-aligned label inside chart area
    ctx.font = `10px ${mono}`;
    ctx.fillStyle = baseCol;
    ctx.textAlign = 'right';
    ctx.fillText(`${o.side} ${orderTypeShort(o.type)}  ${o.origQty}`, axisX - 6, oy - 3);
    ctx.restore();
  });

  // ── TP1 target lines ───────────────────────────────────────────────────
  tp1Lines.forEach(({ price, hit }) => {
    const y = priceToY(price, vp, area);
    if (y < area.y || y > area.y + area.h) return;
    const color = hit ? '#0ecb81' : '#3b8beb';
    ctx.save();
    ctx.globalAlpha = hit ? 0.40 : 0.65;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(axisX, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `bold 10px ${mono}`;
    const label = hit ? `TP1 ✓  ${formatPrice(price)}` : `TP1  ${formatPrice(price)}`;
    const tagW = ctx.measureText(label).width + 10;
    ctx.globalAlpha = 1;
    ctx.fillStyle = hexToRgba(color, hit ? 0.55 : 0.75);
    ctx.fillRect(axisX, y - 9, tagW, 18);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(label, axisX + 5, y + 4);
    ctx.restore();
  });
}

// ── Extend trendline as a ray: starts at the earlier (left) point, extends right ─
function extendRay(p1: PixelPoint, p2: PixelPoint, area: ChartArea) {
  const chartRight = area.x + area.w;

  // Earlier point in time = smaller x coordinate
  const [left, right] = p1.x <= p2.x ? [p1, p2] : [p2, p1];

  if (Math.abs(right.x - left.x) < 0.001) {
    // Vertical: just span the price area height
    return {
      startPx: { x: left.x, y: area.y },
      endPx:   { x: left.x, y: area.y + area.h },
    };
  }

  const slope = (right.y - left.y) / (right.x - left.x);
  return {
    startPx: left,
    endPx:   { x: chartRight, y: left.y + slope * (chartRight - left.x) },
  };
}

// ── Parallel Channel renderer ─────────────────────────────────────────────────
function renderChannel(
  ctx: CanvasRenderingContext2D,
  d: ParallelChannelDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: { drawingId: string; handleIdx: number } | null,
  draggingHandle: { drawingId: string; handleIdx: number } | null,
  isInactive: boolean,
) {
  const color = d.color ?? '#3b8beb';
  const lineAlpha = isPreview ? 0.7 : isInactive ? 0.4 : 1;

  const p1px = pointToPixel(d.p1, candles, vp, area);
  const p2px = pointToPixel(d.p2, candles, vp, area);

  // Pixel offset from base line to parallel line (price offset → pixel delta)
  const priceRange = vp.maxPrice - vp.minPrice;
  const pxOffset = priceRange > 0 ? -(d.offset / priceRange) * area.h : 0;

  const p1ParPx: PixelPoint = { x: p1px.x, y: p1px.y + pxOffset };
  const p2ParPx: PixelPoint = { x: p2px.x, y: p2px.y + pxOffset };

  const ray1 = extendRay(p1px, p2px, area);
  const ray2 = extendRay(p1ParPx, p2ParPx, area);

  ctx.save();
  ctx.globalAlpha = lineAlpha;

  // Fill between the two lines
  ctx.fillStyle = hexToRgba(color, 0.07);
  ctx.beginPath();
  ctx.moveTo(ray1.startPx.x, ray1.startPx.y);
  ctx.lineTo(ray1.endPx.x, ray1.endPx.y);
  ctx.lineTo(ray2.endPx.x, ray2.endPx.y);
  ctx.lineTo(ray2.startPx.x, ray2.startPx.y);
  ctx.closePath();
  ctx.fill();

  // Base line (solid)
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ray1.startPx.x, ray1.startPx.y);
  ctx.lineTo(ray1.endPx.x, ray1.endPx.y);
  ctx.stroke();

  // Parallel line (solid)
  ctx.beginPath();
  ctx.moveTo(ray2.startPx.x, ray2.startPx.y);
  ctx.lineTo(ray2.endPx.x, ray2.endPx.y);
  ctx.stroke();

  // Center line (dashed) — midpoint between base and parallel
  const midStart: PixelPoint = { x: ray1.startPx.x, y: (ray1.startPx.y + ray2.startPx.y) / 2 };
  const midEnd:   PixelPoint = { x: ray1.endPx.x,   y: (ray1.endPx.y   + ray2.endPx.y)   / 2 };
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  ctx.globalAlpha = lineAlpha * 0.7;
  ctx.beginPath();
  ctx.moveTo(midStart.x, midStart.y);
  ctx.lineTo(midEnd.x, midEnd.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = lineAlpha;

  // Handles: p1 (base start), p2 (base end), p3 (parallel offset point)
  if (!isPreview) {
    const isHit = (idx: number) =>
      (hoverHandle?.drawingId === d.id && hoverHandle.handleIdx === idx) ||
      (draggingHandle?.drawingId === d.id && draggingHandle.handleIdx === idx);
    const p3px = pointToPixel(d.p3, candles, vp, area);
    [p1px, p2px, p3px].forEach((h, i) => {
      ctx.fillStyle = isHit(i) ? '#ffffff' : color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  ctx.restore();
}

// ── Freehand Brush Stroke renderer ───────────────────────────────────────────
function renderBrush(
  ctx: CanvasRenderingContext2D,
  d: BrushDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
) {
  if (d.points.length < 2) return;
  const color = d.color ?? '#3b8beb';
  const lw = d.lineWidth ?? 8;
  const alpha = d.opacity ?? 0.45;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  ctx.beginPath();
  const first = pointToPixel(d.points[0], candles, vp, area);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < d.points.length; i++) {
    const px = pointToPixel(d.points[i], candles, vp, area);
    ctx.lineTo(px.x, px.y);
  }
  ctx.stroke();
  ctx.restore();
}

// ── XABCD Harmonic Pattern renderer ──────────────────────────────────────────
function renderXabcd(
  ctx: CanvasRenderingContext2D,
  d: XabcdDrawing,
  candles: Candle[],
  vp: ChartViewport,
  area: ChartArea,
  isPreview: boolean,
  hoverHandle: { drawingId: string; handleIdx: number } | null,
  draggingHandle: { drawingId: string; handleIdx: number } | null,
) {
  const color = d.color ?? '#3b8beb';
  const alpha = isPreview ? 0.65 : 1;

  // Price-based harmonic ratios (price distance, not time)
  const pxPrice = d.px.price, paPrice = d.pa.price, pbPrice = d.pb.price, pcPrice = d.pc.price, pdPrice = d.pd.price;
  const XA = Math.abs(paPrice - pxPrice);
  const AB = Math.abs(pbPrice - paPrice);
  const BC = Math.abs(pcPrice - pbPrice);
  const CD = Math.abs(pdPrice - pcPrice);
  const ratioAB = XA > 0 ? AB / XA : 0;  // AB/XA
  const ratioBC = AB > 0 ? BC / AB : 0;  // BC/AB
  const ratioCD = BC > 0 ? CD / BC : 0;  // CD/BC

  const LABELS = ['X', 'A', 'B', 'C', 'D'];
  const pts = [d.px, d.pa, d.pb, d.pc, d.pd];
  const pxs = pts.map(p => pointToPixel(p, candles, vp, area));
  const [X, A, B, C, D_] = pxs;

  ctx.save();
  ctx.globalAlpha = alpha;

  // ── Filled triangles (XAB and BCD) ──────────────────────────────────────
  const fillAlpha = isPreview ? 0.06 : 0.1;
  ctx.globalAlpha = alpha * fillAlpha / alpha; // relative fill
  ctx.save();
  ctx.globalAlpha = fillAlpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(X.x, X.y); ctx.lineTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D_.x, D_.y); ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.globalAlpha = alpha;

  // ── Dotted diagonal lines: X→B, A→C, B→D (showing ratio relationships) ─
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  const diagonals: [PixelPoint, PixelPoint][] = [[X, B], [A, C], [B, D_]];
  diagonals.forEach(([from, to]) => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // ── Solid zigzag: X→A→B→C→D ─────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(X.x, X.y);
  pxs.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = isPreview ? 1.5 : 2;
  ctx.stroke();

  // ── Ratio labels on dotted diagonals ────────────────────────────────────
  const labelFont = '700 10px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
  const ratios = [ratioAB, ratioBC, ratioCD];
  const ratioLines: [PixelPoint, PixelPoint][] = [[X, B], [A, C], [B, D_]];
  ctx.font = labelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ratios.forEach((ratio, i) => {
    if (ratio === 0) return;
    const [from, to] = ratioLines[i];
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const label = ratio.toFixed(3);
    const tw = ctx.measureText(label).width + 8;
    const th = 14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(mx - tw / 2, my - th / 2, tw, th, 3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, mx, my);
  });

  // ── Point handles and labels (X, A, B, C, D) ────────────────────────────
  const ptFont = '700 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
  pxs.forEach((px, i) => {
    const isHovered = (hoverHandle?.drawingId === d.id && hoverHandle.handleIdx === i)
                   || (draggingHandle?.drawingId === d.id && draggingHandle.handleIdx === i);

    // Circle handle
    ctx.beginPath();
    ctx.arc(px.x, px.y, isHovered ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (isHovered) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label pill — place above or below based on local extremum direction
    const prevY = i > 0 ? pxs[i - 1].y : null;
    const nextY = i < pxs.length - 1 ? pxs[i + 1].y : null;
    const isLow = (prevY == null || px.y >= prevY) && (nextY == null || px.y >= nextY);
    const ly = px.y + (isLow ? 16 : -16);
    const lw = 14;
    const lh = 14;
    ctx.font = ptFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(px.x - lw / 2, ly - lh / 2, lw, lh, 3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(LABELS[i], px.x, ly);
  });

  ctx.restore();
}

// ── Level-to-Level overlay renderer ──────────────────────────────────────────
function renderL2LOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: L2LOverlay,
  vp: ChartViewport,
  area: ChartArea,
  axisX: number,
) {
  const mono = '"SF Mono","Cascadia Code",Consolas,monospace';
  const chartLeft  = area.x;
  const chartRight = axisX;

  // ── helpers ─────────────────────────────────────────────────────────────
  function inView(price: number) {
    const y = priceToY(price, vp, area);
    return y >= area.y && y <= area.y + area.h;
  }

  function drawHLine(price: number, color: string, dash: number[], lineW = 1.5) {
    const y = priceToY(price, vp, area);
    if (y < area.y || y > area.y + area.h) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawBand(top: number, bottom: number, color: string, alpha: number) {
    const yTop    = priceToY(Math.max(top, bottom), vp, area);
    const yBottom = priceToY(Math.min(top, bottom), vp, area);
    const h = Math.abs(yBottom - yTop);
    if (h < 1) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(chartLeft, Math.min(yTop, yBottom), chartRight - chartLeft, h);
    ctx.restore();
  }

  /** Pill badge on the Y-axis (right side) */
  function drawAxisBadge(price: number, label: string, bgColor: string, textColor = '#fff') {
    const y = priceToY(price, vp, area);
    if (y < area.y - 10 || y > area.y + area.h + 10) return;
    ctx.save();
    ctx.font = `bold 10px ${mono}`;
    const tw = ctx.measureText(label).width;
    const bw = tw + 14;
    const bh = 18;
    ctx.fillStyle = bgColor;
    // slight rounding via rect (canvas doesn't have roundRect in all browsers)
    ctx.fillRect(axisX + 1, y - bh / 2, bw, bh);
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.fillText(label, axisX + 8, y + 4);
    ctx.restore();
  }

  /** In-chart right-aligned floating label (inside price area) */
  function drawInlineLabel(
    price: number, text: string, color: string,
    offsetY = -6, bgAlpha = 0.55,
  ) {
    const y = priceToY(price, vp, area);
    if (y < area.y || y > area.y + area.h) return;
    ctx.save();
    ctx.font = `bold 11px ${mono}`;
    const tw = ctx.measureText(text).width;
    const pad = 6;
    const bx = chartRight - tw - pad * 2 - 4;
    const by = y + offsetY - 11;
    ctx.globalAlpha = bgAlpha;
    ctx.fillStyle = '#131722';
    ctx.fillRect(bx - 2, by, tw + pad * 2 + 4, 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(text, chartRight - 6, y + offsetY);
    ctx.restore();
  }

  // ── 1. SR Levels — show top 6 as faint background zones ─────────────────
  const topSR = [...overlay.srLevels]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  topSR.forEach((lvl, i) => {
    const isResist = lvl.kind === 'resistance';
    const col = isResist ? '#f6465d' : '#0ecb81';
    drawBand(lvl.zoneTop, lvl.zoneBottom, col, 0.07);
    drawHLine(lvl.centerPrice, hexToRgba(col, 0.35), [6, 4], 1);
    // Left-side label: "저항 R1 / 지지 S1" with full Korean label
    const num = i + 1;
    const tag = isResist ? `저항 R${num}` : `지지 S${num}`;
    const y = priceToY(lvl.centerPrice, vp, area);
    if (y >= area.y && y <= area.y + area.h) {
      ctx.save();
      ctx.font = `bold 10px ${mono}`;
      ctx.textAlign = 'left';
      // small pill background for readability
      const tw = ctx.measureText(tag).width;
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = '#131722';
      ctx.fillRect(chartLeft + 2, y - 12, tw + 8, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hexToRgba(col, 0.9);
      ctx.fillText(tag, chartLeft + 6, y - 2);
      ctx.restore();
    }
  });

  // ── 2. "No setup" panel — centered ──────────────────────────────────────
  if (overlay.setups.length === 0) {
    const boxW = 280;
    const boxH = 44;
    const cx = chartLeft + (chartRight - chartLeft) / 2;
    const px = cx - boxW / 2;
    const py = area.y + 12;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#1e222d';
    ctx.fillRect(px, py, boxW, boxH);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = `bold 12px ${mono}`;
    ctx.fillStyle = '#f59e42';
    ctx.fillText('⚠  L2L 분석', cx, py + 15);
    ctx.font = `11px ${mono}`;
    ctx.fillStyle = '#848e9c';
    ctx.fillText('현재 차트에서 유효한 리테스트 셋업 없음', cx, py + 31);
    ctx.restore();
    return;
  }

  // ── 3. Per-setup overlays ────────────────────────────────────────────────
  overlay.setups.forEach((setup) => {
    const isLong     = setup.direction === 'long';
    const entryColor = isLong ? '#0ecb81' : '#f6465d';
    const tpColor    = '#38bdf8';
    const slColor    = isLong ? '#f6465d' : '#f59e42';

    const pctFn = (a: number, b: number) =>
      ((Math.abs(a - b) / b) * 100).toFixed(2) + '%';

    // ── Entry zone: colored filled band ────────────────────────────────
    drawBand(setup.entryZoneHigh, setup.entryZoneLow, entryColor, 0.15);
    // Zone border lines (dashed)
    drawHLine(setup.entryZoneHigh, hexToRgba(entryColor, 0.5), [4, 3], 1);
    drawHLine(setup.entryZoneLow,  hexToRgba(entryColor, 0.5), [4, 3], 1);
    // "진입 구간" label at the center of the zone
    const zoneMid = (setup.entryZoneHigh + setup.entryZoneLow) / 2;
    if (inView(zoneMid)) {
      const yz = priceToY(zoneMid, vp, area);
      ctx.save();
      ctx.font = `bold 11px ${mono}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = hexToRgba(entryColor, 0.85);
      ctx.fillText(isLong ? '▲ 진입 구간' : '▼ 진입 구간', chartLeft + 8, yz + 4);
      ctx.restore();
    }

    // ── Ideal entry: solid 2px line + axis badge ────────────────────────
    drawHLine(setup.idealEntry, entryColor, [], 2);
    drawAxisBadge(
      setup.idealEntry,
      `진입  ${formatPrice(setup.idealEntry)}`,
      entryColor,
    );
    drawInlineLabel(
      setup.idealEntry,
      `이상적 진입  ${formatPrice(setup.idealEntry)}`,
      entryColor, -8,
    );

    // ── TP1: blue solid line + axis badge ──────────────────────────────
    drawHLine(setup.tp1, tpColor, [], 2);
    drawAxisBadge(
      setup.tp1,
      `목표  ${formatPrice(setup.tp1)}`,
      '#1a4d6e',
      tpColor,
    );
    drawInlineLabel(
      setup.tp1,
      `목표가 (TP1)  ${formatPrice(setup.tp1)}  +${pctFn(setup.tp1, setup.idealEntry)}`,
      tpColor, -8,
    );

    // ── SL: colored solid line + axis badge ────────────────────────────
    drawHLine(setup.hardStop, slColor, [], 2);
    drawAxisBadge(
      setup.hardStop,
      `손절  ${formatPrice(setup.hardStop)}`,
      isLong ? '#4d1a1a' : '#3d2a00',
      slColor,
    );
    drawInlineLabel(
      setup.hardStop,
      `손절 (SL)  ${formatPrice(setup.hardStop)}  -${pctFn(setup.hardStop, setup.idealEntry)}`,
      slColor, 16, 0.55,
    );

  });

  // ── 4. Bottom legend strip ───────────────────────────────────────────────
  const lgY = area.y + area.h - 20;
  const legendItems = [
    { color: '#0ecb81', dash: true,  label: '지지 (S1~S6) — 가격이 하락 후 반등하는 구간' },
    { color: '#f6465d', dash: true,  label: '저항 (R1~R6) — 가격이 상승 후 되돌리는 구간' },
    { color: '#0ecb81', dash: false, label: '진입 구간 / 이상적 진입가' },
    { color: '#38bdf8', dash: false, label: '목표가 TP1 (다음 저항까지)' },
    { color: '#f59e42', dash: false, label: '손절 SL' },
  ];
  ctx.save();
  ctx.globalAlpha = 0.90;
  ctx.fillStyle = '#1a1e2d';
  ctx.fillRect(chartLeft, lgY - 2, chartRight - chartLeft, 22);
  ctx.globalAlpha = 1;

  // Title
  ctx.font = `bold 10px ${mono}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f0b90b';
  ctx.fillText('■ L2L 범례', chartLeft + 6, lgY + 13);
  let lx = chartLeft + 76;

  legendItems.forEach(item => {
    // colored line swatch
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.dash ? 1 : 2;
    ctx.setLineDash(item.dash ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(lx, lgY + 8);
    ctx.lineTo(lx + 14, lgY + 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `10px ${mono}`;
    ctx.fillStyle = '#848e9c';
    ctx.fillText(item.label, lx + 18, lgY + 13);
    lx += ctx.measureText(item.label).width + 34;
  });
  ctx.restore();
}
