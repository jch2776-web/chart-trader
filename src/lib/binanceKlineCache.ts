import type { Candle } from '../types/candle';
import { computeKlineWeight, governedBinanceFetch } from './binanceRequestGovernor';

type KlineInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d';

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

export async function fetchBinanceKlinesCached(
  symbol: string,
  interval: KlineInterval | string,
  limit: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 1500);
  const key = makeCacheKey(symbol, interval, safeLimit);
  const freshnessKey = computeFreshnessKey(interval);
  const now = Date.now();

  const current = cache.get(key);
  if (current && current.freshnessKey === freshnessKey && current.candles) {
    current.touchedAt = now;
    return current.candles;
  }
  if (current?.inFlight) {
    current.touchedAt = now;
    return current.inFlight;
  }

  const fetchPromise = (async () => {
    const url = `${BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${safeLimit}`;
    const res = await governedBinanceFetch(url, { signal }, {
      weight: computeKlineWeight(safeLimit),
      scope: 'scan',
      label: `klines:${symbol}:${interval}:${safeLimit}`,
    });
    if (!res.ok) {
      throw new Error(`klines ${symbol} ${res.status}`);
    }
    const raw = await res.json() as unknown[][];
    const parsed: Candle[] = raw.map(r => ({
      time: Number(r[0]),
      open: parseFloat(r[1] as string),
      high: parseFloat(r[2] as string),
      low: parseFloat(r[3] as string),
      close: parseFloat(r[4] as string),
      volume: parseFloat(r[5] as string),
    }));
    cache.set(key, {
      freshnessKey,
      candles: parsed,
      touchedAt: Date.now(),
    });
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
