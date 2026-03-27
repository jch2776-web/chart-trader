import { useEffect, useRef } from 'react';
import type { Candle, Interval } from '../types/candle';

const WS_BASE = 'wss://fstream.binance.com/ws';

interface KlineMsg {
  k: {
    t: number;  // kline start time
    o: string;  // open
    h: string;  // high
    l: string;  // low
    c: string;  // close
    v: string;  // base asset volume
    x: boolean; // is kline closed
    q: string;  // quote asset volume
    n: number;  // number of trades
    V: string;  // taker buy base asset volume
    Q: string;  // taker buy quote asset volume
  };
}

export function useBinanceWS(
  symbol: string,
  interval: Interval,
  onUpdate: (candle: Candle, isClosed: boolean) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    const ws = new WebSocket(`${WS_BASE}/${stream}`);
    wsRef.current = ws;
    let closed = false; // guard: prevent stale buffered messages after ws.close()

    ws.onmessage = (ev) => {
      if (closed) return; // discard messages queued before close completed
      try {
        const msg: KlineMsg = JSON.parse(ev.data);
        const k = msg.k;
        const candle: Candle = {
          time:   k.t,
          open:   parseFloat(k.o),
          high:   parseFloat(k.h),
          low:    parseFloat(k.l),
          close:  parseFloat(k.c),
          volume: parseFloat(k.v),
          quoteVolume:         parseFloat(k.q) || 0,
          tradeCount:          k.n || 0,
          takerBuyBaseVolume:  parseFloat(k.V) || 0,
          takerBuyQuoteVolume: parseFloat(k.Q) || 0,
        };
        onUpdateRef.current(candle, k.x);
      } catch (_) {
        // ignore parse errors
      }
    };

    ws.onerror = (e) => console.error('WS error', e);

    return () => {
      closed = true; // set BEFORE ws.close() so any already-queued messages are discarded
      ws.close();
    };
  }, [symbol, interval]);
}
