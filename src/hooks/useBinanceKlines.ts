import { useState, useEffect, useCallback } from 'react';
import type { Candle, Interval } from '../types/candle';
import { fetchBinanceKlinesCached } from '../lib/binanceKlineCache';

export function useBinanceKlines(symbol: string, interval: Interval) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCandles([]); // Clear old candles immediately so chart resets
    try {
      const parsed = await fetchBinanceKlinesCached(symbol, interval, 500);
      setCandles(parsed as Candle[]);
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
