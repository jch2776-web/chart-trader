// ── Interval utilities ─────────────────────────────────────────────────────

export interface TriggerSpec {
  type: 'trendline' | 'hline' | 'box';
  fixedPrice: number;  // for hline/box; trendline fallback at scan time
  slope: number;       // 0 for non-trendline
  p1Time: number;      // candle open-time of anchor pivot (ms)
  p1Price: number;
}

/** Convert interval string to milliseconds */
export function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    '1m':  60_000,   '3m':  180_000,  '5m':   300_000,  '15m':  900_000,
    '30m': 1_800_000, '1h': 3_600_000, '2h':  7_200_000, '4h': 14_400_000,
    '6h': 21_600_000, '8h': 28_800_000,'12h': 43_200_000,'1d': 86_400_000,
    '3d': 259_200_000,'1w': 604_800_000,
  };
  return map[interval] ?? 3_600_000;
}

/**
 * Returns the next candle close time aligned to the interval boundary.
 * e.g. for 1h at 14:23 UTC → 15:00 UTC
 */
export function getNextAlignedCloseTime(nowMs: number, intervalMs: number): number {
  const remainder = nowMs % intervalMs;
  return remainder === 0 ? nowMs + intervalMs : nowMs - remainder + intervalMs;
}

// ── TTL / vol-factor / max-distance maps ───────────────────────────────────

const TTL_BARS: Record<string, number> = {
  '15m': 12, '30m': 8, '1h': 6, '2h': 4,
  '4h': 3,  '6h': 3,  '8h': 2, '12h': 2, '1d': 2,
};
export function getTtlBars(interval: string): number {
  return TTL_BARS[interval] ?? 4;
}

const VOL_FACTOR: Record<string, number> = {
  '15m': 1.5, '30m': 1.4, '1h': 1.3, '2h': 1.3,
  '4h': 1.5,  '6h': 1.4,  '1d': 1.3,
};
export function getVolFactor(interval: string): number {
  return VOL_FACTOR[interval] ?? 1.3;
}

const MAX_DIST_PCT: Record<string, number> = {
  '15m': 0.8, '30m': 1.0, '1h': 1.2, '2h': 1.2,
  '4h': 1.2,  '6h': 1.5,  '1d': 2.0,
};
export function getMaxDistPct(interval: string): number {
  return MAX_DIST_PCT[interval] ?? 1.2;
}

/** Should auto-scan be ON by default for this interval? */
export function defaultAutoScan(interval: string): boolean {
  return !['15m', '30m', '5m', '3m', '1m'].includes(interval);
}

// ── Trigger price calculation ──────────────────────────────────────────────

/**
 * Returns the trigger price at a given candle close time.
 * For trendlines the price drifts over time; for hline/box it is fixed.
 */
export function triggerPrice(spec: TriggerSpec, closeTimeMs: number): number {
  if (spec.type === 'trendline') {
    return spec.p1Price + spec.slope * (closeTimeMs - spec.p1Time);
  }
  return spec.fixedPrice;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

/** Format ms duration as HH:MM:SS */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600).toString().padStart(2, '0');
  const mm = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Format ms timestamp as MM-DD HH:mm (local time) */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const dy = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${mo}-${dy} ${hh}:${mm}`;
}

/** Format ms timestamp as HH:mm (local time) */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
