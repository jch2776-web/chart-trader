import { useState, useEffect, useCallback } from 'react';
import type { Candle, Interval } from '../types/candle';

const BASE = 'https://fapi.binance.com';

export function useBinanceKlines(symbol: string, interval: Interval) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCandles([]); // Clear old candles immediately so chart resets
    try {
      const url = `${BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=500`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown[][] = await res.json();
      const parsed: Candle[] = data.map((d) => ({
        time: Number(d[0]),
        open: parseFloat(d[1] as string),
        high: parseFloat(d[2] as string),
        low: parseFloat(d[3] as string),
        close: parseFloat(d[4] as string),
        volume: parseFloat(d[5] as string),
      }));
      setCandles(parsed);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, interval]);

  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  return { candles, setCandles, loading, error, refetch: fetchCandles };
}
