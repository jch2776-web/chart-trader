import { useCallback, useMemo } from 'react';
import type { Candle, Interval } from '../../types/candle';
import type { Drawing, TrendlineDrawing, BoxDrawing, HlineDrawing, PixelPoint } from '../../types/drawing';
import type { FuturesPosition, FuturesOrder } from '../../types/futures';
import type { ChartViewport, ChartLayout, ChartArea } from './chartMath';
import {
  getChartAreas, idxToX, priceToY, candleWidth,
  computePriceTicks, computeTimeTicks, pointToPixel,
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

export function useChartRenderer(
  candles: Candle[],
  interval: Interval,
  drawings: Drawing[],
  previewDrawing: Drawing | null,
  crosshair: { x: number; y: number; visible: boolean },
  hoverHandle: HoverHandle | null,
  draggingHandle: HoverHandle | null,
  positions: FuturesPosition[] = [],
  orders: FuturesOrder[] = [],
  countdown: number = 0,
  indicators: IndicatorConfig = { coinDuckMABB: false, dwCloud: false },
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
    return { cdMAs, cdBB, dwEMA9, dwEMA26, ichi };
  }, [candles, indicators.coinDuckMABB, indicators.dwCloud]);

  const render = useCallback((
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    vp: ChartViewport,
  ) => {
    const { width, height } = layout;
    const { price: priceArea, volume: volArea } = getChartAreas(layout);

    // ── Background ──────────────────────────────────────────────────────
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

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

    // ── MA lines (hidden when any indicator is active) ───────────────────
    const anyIndicatorOn = indicators.coinDuckMABB || indicators.dwCloud;
    if (!anyIndicatorOn) MA_DEFS.forEach(({ period, color }) => {
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
    ctx.lineTo(axisX, priceArea.y + priceArea.h + volArea.h + 4);
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

    // ── Futures positions & orders overlay ───────────────────────────────
    // Drawn AFTER Y-axis background so axis-zone tags are visible
    if (positions.length > 0 || orders.length > 0) {
      renderPositionOverlay(ctx, positions, orders, vp, priceArea, axisX);
    }

    // ── X-Axis (bottom) ───────────────────────────────────────────────────
    const xAxisY = priceArea.y + priceArea.h + volArea.h + 4;
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
      if (idx < 0 || idx >= candles.length) return;
      const x = idxToX(idx + 0.5, vp, priceArea);
      ctx.fillText(formatTime(candles[idx].time, interval), x, xAxisY + 14);
    });

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
      }
    }
  }, [candles, interval, drawings, previewDrawing, crosshair, hoverHandle, draggingHandle, maArrays, indicatorArrays, indicators, positions, orders, countdown]);

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
  if (isPreview || isInactive) ctx.setLineDash([6, 4]);
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
      ctx.fillStyle = hexToRgba(baseColor, 0.95);
      ctx.textAlign = 'left';
      const textX = Math.max(area.x + 4, startPx.x + 4);
      const textY = startPx.y - 8;
      if (textY > area.y + 4 && textY < area.y + area.h) {
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
  if (isPreview || isInactive) ctx.setLineDash([6, 4]);
  ctx.strokeRect(left, top, bw, bh);
  ctx.setLineDash([]);

  if (!isPreview) {
    ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
    ctx.fillStyle = baseColor;
    ctx.textAlign = 'right';
    ctx.fillText(formatPrice(d.topPrice),    right - 4, top + 12);
    ctx.fillText(formatPrice(d.bottomPrice), right - 4, bot - 4);

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
      ctx.fillStyle = hexToRgba(baseColor, 0.95);
      ctx.textAlign = 'left';
      const textX = left + 6;
      const textY = top + 22;
      if (textY > area.y && textY < area.y + area.h && textX < right - 4) {
        ctx.fillText(d.memo, textX, textY);
      }
      ctx.restore();
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
  if (isPreview || isInactive) ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(area.x, py);
  ctx.lineTo(area.x + area.w, py);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!isPreview) {
    // Price label near the right edge (above the line to not overlap with axis)
    ctx.font = '11px "SF Mono","Cascadia Code",Consolas,monospace';
    ctx.fillStyle = hexToRgba(baseColor, 0.85);
    ctx.textAlign = 'right';
    ctx.fillText(formatPrice(d.price), area.x + area.w - 6, py - 4);

    // Center handle for dragging
    const centerX = area.x + area.w / 2;
    drawHandle(ctx, { x: centerX, y: py }, d.id, 0, hoverHandle, draggingHandle, baseColor);

    // Memo text
    if (d.memo?.trim()) {
      ctx.save();
      ctx.font = 'bold 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      ctx.fillStyle = hexToRgba(baseColor, 0.95);
      ctx.textAlign = 'left';
      const textY = py - 8;
      if (textY > area.y + 4) {
        ctx.fillText(d.memo, area.x + 8, textY);
      }
      ctx.restore();
    }
  }
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
