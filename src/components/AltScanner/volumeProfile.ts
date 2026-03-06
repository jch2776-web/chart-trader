import type { Candle } from '../../types/candle';

export interface HVNZone {
  priceLow: number;
  priceHigh: number;
  centerPrice: number;
  volume: number;
  kind: 'support' | 'resistance';
}

export function calcHVN(
  candles: Candle[],
  bins = 100,
  topK = 5,
  currentPrice: number,
): HVNZone[] {
  if (candles.length < 10) return [];

  const minLow = Math.min(...candles.map(c => c.low));
  const maxHigh = Math.max(...candles.map(c => c.high));
  const range = maxHigh - minLow;
  if (range <= 0) return [];

  const binSize = range / bins;
  const volumes = new Float64Array(bins);

  for (const c of candles) {
    // Distribute volume across candle range proportionally
    const lo = Math.max(0, Math.floor((c.low - minLow) / binSize));
    const hi = Math.min(bins - 1, Math.floor((c.high - minLow) / binSize));
    const count = Math.max(1, hi - lo + 1);
    const vpp = c.volume / count;
    for (let b = lo; b <= hi; b++) volumes[b] += vpp;
  }

  const sorted = Array.from(volumes)
    .map((v, i) => ({ i, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, topK);

  return sorted.map(({ i, v }) => {
    const priceLow = minLow + i * binSize;
    const priceHigh = priceLow + binSize;
    const centerPrice = (priceLow + priceHigh) / 2;
    return {
      priceLow,
      priceHigh,
      centerPrice,
      volume: v,
      kind: centerPrice < currentPrice ? 'support' : 'resistance',
    } as HVNZone;
  });
}
