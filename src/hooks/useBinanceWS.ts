import { useEffect, useRef } from 'react';
import type { Candle, Interval } from '../types/candle';

const WS_BASE = 'wss://fstream.binance.com/market/ws';

/** Reconnect delay schedule (ms): 1s, 2s, 4s, 8s, 16s, capped at 30s */
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

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
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    let destroyed = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    function connect() {
      if (destroyed) return;
      ws = new WebSocket(`${WS_BASE}/${stream}`);

      ws.onopen = () => {
        retryCount = 0; // reset backoff on successful connection
      };

      ws.onmessage = (ev) => {
        if (destroyed) return;
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

      ws.onerror = (e) => console.error('[useBinanceWS] WS error', e);

      ws.onclose = (ev) => {
        if (destroyed) return;
        // Normal closure (code 1000) on symbol/interval change is handled by destroyed flag.
        // Any other closure triggers reconnect with exponential backoff.
        const delay = RECONNECT_DELAYS[Math.min(retryCount, RECONNECT_DELAYS.length - 1)];
        retryCount++;
        console.warn(
          `[useBinanceWS] ${stream} closed (code=${ev.code}), reconnecting in ${delay}ms (attempt ${retryCount})`,
        );
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (ws) {
        ws.onclose = null; // prevent reconnect on intentional teardown
        ws.close();
      }
    };
  }, [symbol, interval]);
}
