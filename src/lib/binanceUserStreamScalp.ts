/**
 * binanceUserStreamScalp — dedicated user data stream for the scalp module.
 *
 * Maintains its own listenKey and WebSocket, independent from the main
 * trading hook's user stream.  Handles:
 *   ORDER_TRADE_UPDATE  — fill / partial fill / cancel / reject events
 *   ACCOUNT_UPDATE      — balance change notifications
 *
 * Usage:
 *   const stop = connectScalpUserStream({ getListenKey, renewListenKey, handlers });
 *   // later:
 *   stop();
 */

import type { ScalpOrderUpdate } from '../scalp/types';

const WS_BASE      = 'wss://fstream.binance.com/ws';
const RENEW_MS     = 30 * 60 * 1_000; // Binance requires keep-alive every ≤60 min
const RECONNECT_MS = 5_000;

// ── Payload types ─────────────────────────────────────────────────────────────

interface RawOrderUpdate {
  e: 'ORDER_TRADE_UPDATE';
  T: number; // transaction time
  o: {
    s: string;  // symbol
    i: number;  // orderId
    X: string;  // status: NEW / PARTIALLY_FILLED / FILLED / CANCELED / REJECTED / EXPIRED
    z: string;  // cumulative filled qty
    ap: string; // average price
    L: string;  // last filled qty
    lp?: string;// last filled price (futures)
    l: string;  // last filled qty (alias)
    cp: boolean;// reduce only
  };
}

interface RawAccountUpdate {
  e: 'ACCOUNT_UPDATE';
  T: number;
  a: {
    B: { a: string; wb: string }[]; // balances
    P: { s: string; pa: string; iw: string }[]; // positions
  };
}

type RawUserMsg = RawOrderUpdate | RawAccountUpdate | { e: string };

// ── Handlers ─────────────────────────────────────────────────────────────────

export interface ScalpUserStreamHandlers {
  onOrderUpdate?: (update: ScalpOrderUpdate) => void;
  onBalanceChange?: (asset: string, walletBalance: number) => void;
  onReconnect?: () => void;
  onError?: (msg: string) => void;
}

// ── Connection ────────────────────────────────────────────────────────────────

export interface ScalpUserStreamConfig {
  /** Called to obtain a fresh listenKey (POST /fapi/v1/listenKey). */
  getListenKey: () => Promise<string>;
  /** Called to keep the listenKey alive (PUT /fapi/v1/listenKey). */
  renewListenKey: (key: string) => Promise<void>;
  handlers: ScalpUserStreamHandlers;
}

/**
 * Opens a dedicated user-data WebSocket for scalp order tracking.
 * Automatically renews the listenKey and reconnects on close.
 * Returns a cleanup/disconnect function.
 */
export function connectScalpUserStream(cfg: ScalpUserStreamConfig): () => void {
  let ws: WebSocket | null = null;
  let listenKey = '';
  let renewTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function parseOrderUpdate(raw: RawOrderUpdate): ScalpOrderUpdate {
    const o = raw.o;
    type Status = ScalpOrderUpdate['status'];
    const statusMap: Record<string, Status> = {
      NEW: 'NEW',
      PARTIALLY_FILLED: 'PARTIALLY_FILLED',
      FILLED: 'FILLED',
      CANCELED: 'CANCELED',
      REJECTED: 'REJECTED',
      EXPIRED: 'CANCELED', // treat expired as canceled
    };
    return {
      orderId: String(o.i),
      symbol: o.s,
      status: statusMap[o.X] ?? 'CANCELED',
      executedQty: parseFloat(o.z),
      avgPrice: parseFloat(o.ap),
      lastFilledQty: parseFloat(o.L),
      lastFilledPrice: parseFloat(o.lp ?? o.l ?? '0'),
      reduceOnly: o.cp,
      ts: raw.T,
    };
  }

  function handleMessage(data: string): void {
    let msg: RawUserMsg;
    try { msg = JSON.parse(data) as RawUserMsg; } catch { return; }
    if (msg.e === 'ORDER_TRADE_UPDATE') {
      const upd = parseOrderUpdate(msg as RawOrderUpdate);
      cfg.handlers.onOrderUpdate?.(upd);
    } else if (msg.e === 'ACCOUNT_UPDATE') {
      const au = msg as RawAccountUpdate;
      for (const b of au.a.B) {
        cfg.handlers.onBalanceChange?.(b.a, parseFloat(b.wb));
      }
    }
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    try {
      listenKey = await cfg.getListenKey();
    } catch (e) {
      cfg.handlers.onError?.(`listenKey 발급 실패: ${e instanceof Error ? e.message : String(e)}`);
      if (!stopped) reconnectTimer = setTimeout(() => { void connect(); }, RECONNECT_MS);
      return;
    }

    ws = new WebSocket(`${WS_BASE}/${listenKey}`);
    ws.onmessage = (evt: MessageEvent<string>) => handleMessage(evt.data);
    ws.onclose = () => {
      if (stopped) return;
      cfg.handlers.onReconnect?.();
      reconnectTimer = setTimeout(() => { void connect(); }, RECONNECT_MS);
    };
    ws.onerror = () => { ws?.close(); };

    // Keep-alive: renew every RENEW_MS
    if (renewTimer) clearInterval(renewTimer);
    renewTimer = setInterval(() => {
      if (stopped || !listenKey) return;
      cfg.renewListenKey(listenKey).catch(e => {
        cfg.handlers.onError?.(`listenKey 갱신 실패: ${e instanceof Error ? e.message : String(e)}`);
      });
    }, RENEW_MS);
  }

  void connect();

  return function stop() {
    stopped = true;
    if (renewTimer)    clearInterval(renewTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) { ws.onclose = null; ws.close(); }
  };
}
