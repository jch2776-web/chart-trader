import type { Candle } from '../../types/candle';

export type Horizon = 'ST' | 'MT' | 'LT';
export type LevelKind = 'support' | 'resistance';

export interface LevelZone {
  kind: LevelKind;
  horizon: Horizon;
  centerPrice: number;
  zoneTop: number;
  zoneBottom: number;
  touches: number;
  lastTouchIndex: number;
  score: number;
}

function pivotHighs(candles: Candle[], w: number, lookback: number): { price: number; index: number }[] {
  const result: { price: number; index: number }[] = [];
  const start = Math.max(w, candles.length - lookback - w);
  for (let i = start; i < candles.length - w; i++) {
    const h = candles[i].high;
    let ok = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j !== i && candles[j].high >= h) { ok = false; break; }
    }
    if (ok) result.push({ price: h, index: i });
  }
  return result;
}

function pivotLows(candles: Candle[], w: number, lookback: number): { price: number; index: number }[] {
  const result: { price: number; index: number }[] = [];
  const start = Math.max(w, candles.length - lookback - w);
  for (let i = start; i < candles.length - w; i++) {
    const l = candles[i].low;
    let ok = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j !== i && candles[j].low <= l) { ok = false; break; }
    }
    if (ok) result.push({ price: l, index: i });
  }
  return result;
}

function clusterPivots(
  pivots: { price: number; index: number }[],
  tol: number,
  horizon: Horizon,
  kind: LevelKind,
): LevelZone[] {
  if (pivots.length === 0) return [];
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const zones: LevelZone[] = [];
  let buf = [sorted[0]];

  const flush = () => {
    const prices = buf.map(p => p.price);
    const center = prices.reduce((a, b) => a + b, 0) / prices.length;
    const lastTouchIndex = Math.max(...buf.map(p => p.index));
    zones.push({
      kind, horizon,
      centerPrice: center,
      zoneTop: center + tol * 0.5,
      zoneBottom: center - tol * 0.5,
      touches: buf.length,
      lastTouchIndex,
      score: 0,
    });
  };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].price - buf[buf.length - 1].price <= tol) {
      buf.push(sorted[i]);
    } else {
      flush();
      buf = [sorted[i]];
    }
  }
  flush();
  return zones;
}

function calcMA(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  return candles.slice(-period).reduce((s, c) => s + c.close, 0) / period;
}

export function calcSRLevels(
  candles: Candle[],
  atr: number,
  currentPrice: number,
): LevelZone[] {
  const tol = Math.max(atr * 0.35, currentPrice * 0.003);
  const n = candles.length;
  const ma25 = calcMA(candles, 25);
  const ma99 = calcMA(candles, 99);

  const configs: { horizon: Horizon; w: number; lookback: number }[] = [
    { horizon: 'ST', w: 2, lookback: 60 },
    { horizon: 'MT', w: 3, lookback: 150 },
    { horizon: 'LT', w: 5, lookback: 300 },
  ];

  const raw: LevelZone[] = [];

  for (const cfg of configs) {
    const hWeight = cfg.horizon === 'LT' ? 1.4 : cfg.horizon === 'MT' ? 1.2 : 1.0;
    const ph = pivotHighs(candles, cfg.w, cfg.lookback);
    const pl = pivotLows(candles, cfg.w, cfg.lookback);
    const rZones = clusterPivots(ph, tol, cfg.horizon, 'resistance');
    const sZones = clusterPivots(pl, tol, cfg.horizon, 'support');

    for (const z of [...rZones, ...sZones]) {
      const lookbackStart = Math.max(0, n - cfg.lookback);
      const range = n - lookbackStart;
      const recencyRatio = range > 0 ? (z.lastTouchIndex - lookbackStart) / range : 0;
      const touchScore = Math.min(z.touches * 12, 48);
      const recencyScore = Math.max(0, recencyRatio) * 20;
      const maBonus =
        (ma25 > 0 && Math.abs(z.centerPrice - ma25) < tol * 2 ? 8 : 0) +
        (ma99 > 0 && Math.abs(z.centerPrice - ma99) < tol * 2 ? 12 : 0);
      z.score = Math.round((touchScore + recencyScore + maBonus) * hWeight);
      raw.push(z);
    }
  }

  // Merge overlapping zones across horizons (keep higher score)
  const merged: LevelZone[] = [];
  for (const z of raw) {
    const existing = merged.find(
      m => m.kind === z.kind && Math.abs(m.centerPrice - z.centerPrice) < tol,
    );
    if (existing) {
      if (z.score > existing.score) {
        existing.centerPrice = z.centerPrice;
        existing.zoneTop = z.zoneTop;
        existing.zoneBottom = z.zoneBottom;
        existing.score = z.score;
        existing.horizon = z.horizon;
        existing.touches = Math.max(existing.touches, z.touches);
        existing.lastTouchIndex = Math.max(existing.lastTouchIndex, z.lastTouchIndex);
      } else {
        existing.touches = Math.max(existing.touches, z.touches);
      }
    } else {
      merged.push({ ...z });
    }
  }

  return merged;
}
