import type { Candle } from '../../types/candle';
import type { Point, PixelPoint } from '../../types/drawing';

export interface ChartViewport {
  startIdx: number;
  endIdx: number;
  minPrice: number;
  maxPrice: number;
}

export interface ChartLayout {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

export interface ChartArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartAreas {
  price: ChartArea;
  volume: ChartArea;
}

/** Backward-compat: full data area (price + volume + gap) */
export function getChartArea(layout: ChartLayout): ChartArea {
  return {
    x: layout.paddingLeft,
    y: layout.paddingTop,
    w: layout.width - layout.paddingLeft - layout.paddingRight,
    h: layout.height - layout.paddingTop - layout.paddingBottom,
  };
}

/** Split into price + volume sub-areas */
export function getChartAreas(layout: ChartLayout): ChartAreas {
  const ax = layout.paddingLeft;
  const aw = layout.width - layout.paddingLeft - layout.paddingRight;
  const totalH = layout.height - layout.paddingTop - layout.paddingBottom;
  const volumeH = Math.max(36, Math.round(totalH * 0.15));
  const gap = 4;
  const priceH = totalH - volumeH - gap;
  return {
    price:  { x: ax, y: layout.paddingTop,              w: aw, h: priceH },
    volume: { x: ax, y: layout.paddingTop + priceH + gap, w: aw, h: volumeH },
  };
}

/** Map candle index → canvas X pixel */
export function idxToX(idx: number, vp: ChartViewport, area: ChartArea): number {
  const range = vp.endIdx - vp.startIdx;
  return area.x + ((idx - vp.startIdx) / range) * area.w;
}

/** Map price → canvas Y pixel (within a specific area) */
export function priceToY(price: number, vp: ChartViewport, area: ChartArea): number {
  const range = vp.maxPrice - vp.minPrice;
  return area.y + area.h - ((price - vp.minPrice) / range) * area.h;
}

/** Map canvas X → candle index (fractional) */
export function xToIdx(x: number, vp: ChartViewport, area: ChartArea): number {
  const range = vp.endIdx - vp.startIdx;
  return vp.startIdx + ((x - area.x) / area.w) * range;
}

/** Map canvas Y → price */
export function yToPrice(y: number, vp: ChartViewport, area: ChartArea): number {
  const range = vp.maxPrice - vp.minPrice;
  return vp.minPrice + ((area.y + area.h - y) / area.h) * range;
}

export function pointToPixel(p: Point, candles: Candle[], vp: ChartViewport, area: ChartArea): PixelPoint {
  const idx = candles.findIndex(c => c.time === p.time);
  const candleIdx = idx >= 0 ? idx + 0.5 : timeToCandleIdx(p.time, candles);
  return {
    x: idxToX(candleIdx, vp, area),
    y: priceToY(p.price, vp, area),
  };
}

export function timeToCandleIdx(time: number, candles: Candle[]): number {
  if (candles.length === 0) return 0;
  if (time <= candles[0].time) return 0;

  const last = candles[candles.length - 1];

  // Future: extrapolate beyond last candle using the last interval
  if (time > last.time) {
    const interval = candles.length >= 2
      ? last.time - candles[candles.length - 2].time
      : 60_000;
    return (candles.length - 1) + (time - last.time) / interval;
  }

  for (let i = 0; i < candles.length - 1; i++) {
    if (time >= candles[i].time && time <= candles[i + 1].time) {
      const frac = (time - candles[i].time) / (candles[i + 1].time - candles[i].time);
      return i + frac;
    }
  }
  return candles.length - 1;
}

export function xToTime(x: number, candles: Candle[], vp: ChartViewport, area: ChartArea): number {
  const idx = xToIdx(x, vp, area);
  if (candles.length === 0) return 0;

  const last = candles[candles.length - 1];

  // Future area: extrapolate beyond last candle using the last interval
  if (idx >= candles.length - 1) {
    const interval = candles.length >= 2
      ? last.time - candles[candles.length - 2].time
      : 60_000;
    const extraCandles = idx - (candles.length - 1);
    return last.time + extraCandles * interval;
  }

  // Past/present: interpolate between two known candles
  const floorIdx = Math.floor(Math.max(0, idx));
  const ceilIdx = Math.min(candles.length - 1, floorIdx + 1);
  if (floorIdx === ceilIdx) return candles[floorIdx].time;
  const frac = idx - floorIdx;
  return candles[floorIdx].time + frac * (candles[ceilIdx].time - candles[floorIdx].time);
}

export function candleWidth(vp: ChartViewport, area: ChartArea): number {
  const range = vp.endIdx - vp.startIdx;
  return (area.w / range) * 0.65;
}

export function autoFitPriceRange(
  candles: Candle[], startIdx: number, endIdx: number
): { minPrice: number; maxPrice: number } {
  const start = Math.max(0, Math.floor(startIdx));
  const end = Math.min(candles.length - 1, Math.ceil(endIdx));
  if (start > end) return { minPrice: 0, maxPrice: 1 };
  let min = Infinity, max = -Infinity;
  for (let i = start; i <= end; i++) {
    if (candles[i].low < min) min = candles[i].low;
    if (candles[i].high > max) max = candles[i].high;
  }
  const pad = (max - min) * 0.06;
  return { minPrice: min - pad, maxPrice: max + pad };
}

export function computePriceTicks(minPrice: number, maxPrice: number, count = 6): number[] {
  const range = maxPrice - minPrice;
  if (range <= 0) return [];
  const rawStep = range / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = Math.ceil(rawStep / magnitude) * magnitude;
  const start = Math.ceil(minPrice / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= maxPrice; v += step) {
    ticks.push(parseFloat(v.toPrecision(10)));
  }
  return ticks;
}

export function computeTimeTicks(
  candles: Candle[], startIdx: number, endIdx: number,
  _interval: string, maxTicks = 8
): number[] {
  const visibleCount = endIdx - startIdx;
  const step = Math.max(1, Math.ceil(visibleCount / maxTicks));
  const ticks: number[] = [];
  const start = Math.max(0, Math.floor(startIdx));
  const end = Math.min(candles.length - 1, Math.ceil(endIdx));
  for (let i = start; i <= end; i += step) ticks.push(i);
  return ticks;
}
