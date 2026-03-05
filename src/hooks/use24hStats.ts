import { useState, useEffect } from 'react';

export interface Stats24h {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;      // base asset
  quoteVolume: number; // USDT volume
}

export function use24hStats(symbol: string) {
  const [stats, setStats] = useState<Stats24h | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetch24h() {
      try {
        const res = await fetch(
          `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
        );
        if (!res.ok || cancelled) return;
        const d = await res.json();
        setStats({
          symbol: d.symbol,
          lastPrice: parseFloat(d.lastPrice),
          priceChange: parseFloat(d.priceChange),
          priceChangePercent: parseFloat(d.priceChangePercent),
          highPrice: parseFloat(d.highPrice),
          lowPrice: parseFloat(d.lowPrice),
          volume: parseFloat(d.volume),
          quoteVolume: parseFloat(d.quoteVolume),
        });
      } catch {
        // ignore fetch errors
      }
    }

    setStats(null);
    fetch24h();
    const id = setInterval(fetch24h, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);

  return stats;
}
