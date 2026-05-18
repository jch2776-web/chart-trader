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

const WS_BASE      = 'wss://fstream.binance.com/private/ws';
const RENEW_MS     = 30 * 60 * 1_000; // Binance requires keep-alive every ≤60 min
const RECONNECT_MS = 5_000;
const RECONNECT_MAX_MS = 180_000;

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
  /** Called when the WebSocket connection is first established (or re-established). */
  onConnect?: () => void;
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
  let reconnectDelayMs = RECONNECT_MS;
  let lastOpenAt = 0;
  let consecutiveEarlyClose = 0;

  function isListenKeyExpiredMsg(msg: string): boolean {
    const m = msg.toLowerCase();
    return (
      m.includes('listenkey') &&
      (m.includes('expired') || m.includes('not found') || m.includes('invalid') || m.includes('-1125'))
    );
  }

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
    } else if ((msg as { e?: string }).e === 'listenKeyExpired') {
      cfg.handlers.onError?.('listenKey 만료 감지 — 재발급 후 재연결');
      listenKey = '';
      ws?.close();
    }
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    try {
      // Reuse existing listenKey across reconnects to avoid listenKey POST floods.
      if (!listenKey) {
        listenKey = await cfg.getListenKey();
      }
      reconnectDelayMs = RECONNECT_MS;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      cfg.handlers.onError?.(`listenKey 발급 실패: ${msg}`);
      if (msg.includes('418')) reconnectDelayMs = Math.max(reconnectDelayMs, 120_000);
      else if (msg.includes('429')) reconnectDelayMs = Math.max(reconnectDelayMs, 30_000);
      else reconnectDelayMs = Math.min(RECONNECT_MAX_MS, Math.round(reconnectDelayMs * 1.5));
      if (!stopped) reconnectTimer = setTimeout(() => { void connect(); }, reconnectDelayMs);
      return;
    }

    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch (e) {
        void e;
      }
      ws = null;
    }

    ws = new WebSocket(`${WS_BASE}/${listenKey}`);
    ws.onopen  = () => {
      lastOpenAt = Date.now();
      consecutiveEarlyClose = 0;
      cfg.handlers.onConnect?.();
    };
    ws.onmessage = (evt: MessageEvent<string>) => handleMessage(evt.data);
    ws.onclose = () => {
      if (stopped) return;
      const now = Date.now();
      if (lastOpenAt > 0 && now - lastOpenAt < 2_000) {
        consecutiveEarlyClose += 1;
      } else {
        consecutiveEarlyClose = 0;
      }
      // Likely stale/invalid key loop: force key refresh after repeated fast closes.
      if (consecutiveEarlyClose >= 3) {
        listenKey = '';
        consecutiveEarlyClose = 0;
      }
      cfg.handlers.onReconnect?.();
      reconnectDelayMs = Math.min(RECONNECT_MAX_MS, Math.round(reconnectDelayMs * 1.25));
      reconnectTimer = setTimeout(() => { void connect(); }, reconnectDelayMs);
    };
    ws.onerror = () => { ws?.close(); };

    // Keep-alive: renew every RENEW_MS
    if (renewTimer) clearInterval(renewTimer);
    renewTimer = setInterval(() => {
      if (stopped || !listenKey) return;
      cfg.renewListenKey(listenKey).catch(e => {
        const msg = e instanceof Error ? e.message : String(e);
        cfg.handlers.onError?.(`listenKey 갱신 실패: ${msg}`);
        if (isListenKeyExpiredMsg(msg)) {
          listenKey = '';
          ws?.close();
        }
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
