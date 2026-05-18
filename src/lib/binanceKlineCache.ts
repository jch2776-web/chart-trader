import type { Candle } from '../types/candle';
import { computeKlineWeight, governedBinanceFetch } from './binanceRequestGovernor';

type KlineInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '1w';

interface CacheRow {
  freshnessKey: number;
  candles?: Candle[];
  inFlight?: Promise<Candle[]>;
  touchedAt: number;
}

const BASE = 'https://fapi.binance.com';
const cache = new Map<string, CacheRow>();

function intervalToMs(interval: string): number {
  if (interval.endsWith('m')) return Number(interval.slice(0, -1)) * 60_000;
  if (interval.endsWith('h')) return Number(interval.slice(0, -1)) * 3_600_000;
  if (interval.endsWith('d')) return Number(interval.slice(0, -1)) * 86_400_000;
  return 60_000;
}

function makeCacheKey(symbol: string, interval: string, limit: number): string {
  return `${symbol}|${interval}|${limit}`;
}

function parseLimitFromKey(key: string): number {
  const idx = key.lastIndexOf('|');
  if (idx < 0) return 0;
  const parsed = Number(key.slice(idx + 1));
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeFreshnessKey(interval: string): number {
  const ivMs = intervalToMs(interval);
  const now = Date.now();
  // safety buffer: do not consider the in-progress candle as fresh boundary
  return Math.floor((now - 4_000) / ivMs);
}

function pruneCache() {
  // lightweight bound to prevent unbounded growth
  if (cache.size <= 400) return;
  const rows = Array.from(cache.entries()).sort((a, b) => a[1].touchedAt - b[1].touchedAt);
  const removeCount = Math.max(0, rows.length - 320);
  for (let i = 0; i < removeCount; i++) cache.delete(rows[i][0]);
}

export const API_MAX = 1500; // Binance Futures klines hard limit per request

async function fetchSingleBatch(
  symbol: string,
  interval: string,
  limit: number,
  endTime?: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const safeLimit = Math.min(Math.max(Math.round(limit), 1), API_MAX);
  const url = endTime
    ? `${BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${safeLimit}&endTime=${endTime}`
    : `${BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${safeLimit}`;
  const res = await governedBinanceFetch(url, { signal }, {
    weight: computeKlineWeight(safeLimit),
    scope: 'scan',
    label: `klines:${symbol}:${interval}:${safeLimit}`,
  });
  if (!res.ok) throw new Error(`klines ${symbol} ${res.status}`);
  const raw = await res.json() as unknown[][];
  return raw.map(r => ({
    time:   Number(r[0]),
    open:   parseFloat(r[1] as string),
    high:   parseFloat(r[2] as string),
    low:    parseFloat(r[3] as string),
    close:  parseFloat(r[4] as string),
    volume: parseFloat(r[5] as string),
    quoteVolume:         r[7]  != null ? parseFloat(r[7]  as string) || 0 : 0,
    tradeCount:          r[8]  != null ? Number(r[8])  || 0 : 0,
    takerBuyBaseVolume:  r[9]  != null ? parseFloat(r[9]  as string) || 0 : 0,
    takerBuyQuoteVolume: r[10] != null ? parseFloat(r[10] as string) || 0 : 0,
  }));
}

export async function fetchBinanceKlinesCached(
  symbol: string,
  interval: KlineInterval | string,
  limit: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  // Multi-batch path: when limit exceeds API_MAX, fetch in chunks
  if (limit > API_MAX) {
    const chunk1 = await fetchBinanceKlinesCached(symbol, interval, API_MAX, signal);
    if (chunk1.length === 0) return chunk1;
    const remaining = limit - chunk1.length;
    if (remaining <= 0) return chunk1;
    const oldestTime = chunk1[0].time;
    const chunk2 = await fetchSingleBatch(symbol, interval, remaining, oldestTime - 1, signal);
    // Merge: older first, remove any overlap by time
    const seen = new Set(chunk1.map(c => c.time));
    const merged = [...chunk2.filter(c => !seen.has(c.time)), ...chunk1];
    merged.sort((a, b) => a.time - b.time);
    return merged;
  }

  const safeLimit = Math.min(Math.max(Math.round(limit), 1), API_MAX);
  const key = makeCacheKey(symbol, interval, safeLimit);
  const freshnessKey = computeFreshnessKey(interval);
  const now = Date.now();

  const current = cache.get(key);
  if (current && current.freshnessKey === freshnessKey && current.candles) {
    current.touchedAt = now;
    return current.candles;
  }

  // Reuse larger fresh windows for smaller limit requests to cut duplicate calls
  // during burst scans (e.g. 202 + 500 lookups in nearby flows).
  const prefix = `${symbol}|${interval}|`;
  let fallbackCandles: Candle[] | null = null;
  let fallbackKey: string | null = null;
  let fallbackLimit = Number.POSITIVE_INFINITY;
  for (const [k, row] of cache.entries()) {
    if (!k.startsWith(prefix)) continue;
    if (row.freshnessKey !== freshnessKey || !row.candles) continue;
    const cachedLimit = parseLimitFromKey(k);
    if (cachedLimit < safeLimit) continue;
    if (cachedLimit >= fallbackLimit) continue;
    fallbackLimit = cachedLimit;
    fallbackKey = k;
    fallbackCandles = row.candles;
  }
  if (fallbackCandles) {
    const sliced = fallbackCandles.slice(-safeLimit);
    cache.set(key, {
      freshnessKey,
      candles: sliced,
      touchedAt: now,
    });
    if (fallbackKey) {
      const src = cache.get(fallbackKey);
      if (src) src.touchedAt = now;
    }
    return sliced;
  }

  if (current?.inFlight) {
    current.touchedAt = now;
    return current.inFlight;
  }

  const fetchPromise = (async () => {
    const parsed = await fetchSingleBatch(symbol, interval, safeLimit, undefined, signal);
    cache.set(key, { freshnessKey, candles: parsed, touchedAt: Date.now() });
    pruneCache();
    return parsed;
  })();

  cache.set(key, {
    freshnessKey,
    inFlight: fetchPromise,
    touchedAt: now,
  });

  try {
    return await fetchPromise;
  } catch (e) {
    const latest = cache.get(key);
    if (latest?.inFlight === fetchPromise) {
      cache.delete(key);
    }
    throw e;
  }
}

/** Fetch candles strictly older than `beforeTime` (ms epoch). Not cached — historical data. */
export async function fetchBinanceKlinesOlder(
  symbol: string,
  interval: string,
  limit: number,
  beforeTime: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const safeLimit = Math.min(Math.max(limit, 1), API_MAX);
  return fetchSingleBatch(symbol, interval, safeLimit, beforeTime - 1, signal);
}
