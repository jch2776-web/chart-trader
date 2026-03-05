import { useState, useEffect } from 'react';

export interface TickerInfo {
  symbol: string;
  baseAsset: string;
}

const POPULAR = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'];

export function useTickers() {
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const data = await res.json();
        const symbols: TickerInfo[] = (data.symbols as { symbol: string; baseAsset: string; status: string; contractType: string }[])
          .filter(s => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.symbol.endsWith('USDT'))
          .map(s => ({ symbol: s.symbol, baseAsset: s.baseAsset }));

        // Sort: popular first, then alphabetical
        symbols.sort((a, b) => {
          const ai = POPULAR.indexOf(a.baseAsset);
          const bi = POPULAR.indexOf(b.baseAsset);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          return a.symbol.localeCompare(b.symbol);
        });

        setTickers(symbols);
      } catch (e) {
        console.error('Failed to load tickers', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { tickers, loading };
}
