/**
 * binanceBookTicker — live best-bid/ask cache for USDT-M Futures symbols.
 *
 * Maintains one WebSocket per subscribed symbol (bookTicker stream).
 * Used by the leader-retest spread gate in useAltAutoTrade.
 *
 *   subscribeBookTicker('SOLUSDT')   // idempotent
 *   getSpreadBps('SOLUSDT')          // bps or undefined (stale / not connected → skip gate)
 *   unsubscribeBookTicker('SOLUSDT') // cleanup when symbol no longer needed
 */

const WS_BASE = 'wss://fstream.binance.com/market/ws';

interface BidAsk {
  bid: number;
  ask: number;
  updatedAt: number; // ms epoch
}

interface Conn {
  ws: WebSocket;
  backoffMs: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Set to true on intentional unsubscribe — prevents reconnect loop. */
  closed: boolean;
}

/** Staleness threshold: if no bookTicker message in this window, treat as missing data. */
const STALE_MS = 5_000;
const INIT_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const store = new Map<string, BidAsk>();
const connections = new Map<string, Conn>();

function connect(symbol: string): void {
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@bookTicker`);
  } catch {
    // WebSocket unavailable (SSR / test env) — schedule retry
    const conn = connections.get(symbol);
    if (conn && !conn.closed) {
      const delay = conn.backoffMs;
      conn.backoffMs = Math.min(delay * 2, MAX_BACKOFF_MS);
      conn.reconnectTimer = setTimeout(() => { if (!conn.closed) connect(symbol); }, delay);
    }
    return;
  }

  const conn: Conn = { ws, backoffMs: INIT_BACKOFF_MS, reconnectTimer: null, closed: false };
  connections.set(symbol, conn);

  ws.onmessage = (evt: MessageEvent<string>) => {
    try {
      // bookTicker payload: { "b": "<best bid>", "a": "<best ask>", ... }
      const data = JSON.parse(evt.data) as { b: string; a: string };
      const bid = parseFloat(data.b);
      const ask = parseFloat(data.a);
      if (bid > 0 && ask > 0) {
        store.set(symbol, { bid, ask, updatedAt: Date.now() });
        conn.backoffMs = INIT_BACKOFF_MS; // reset backoff on successful message
      }
    } catch { /* ignore malformed messages */ }
  };

  ws.onclose = () => {
    if (conn.closed) return; // intentional close — do not reconnect
    const delay = conn.backoffMs;
    conn.backoffMs = Math.min(delay * 2, MAX_BACKOFF_MS);
    conn.reconnectTimer = setTimeout(() => { if (!conn.closed) connect(symbol); }, delay);
  };

  ws.onerror = () => { ws.close(); }; // triggers onclose → backoff reconnect
}

/**
 * Subscribe to the bookTicker stream for `symbol`.
 * Idempotent — safe to call repeatedly for the same symbol.
 */
export function subscribeBookTicker(symbol: string): void {
  if (connections.has(symbol)) return;
  connect(symbol);
}

/**
 * Unsubscribe and release resources for `symbol`.
 * Call when the symbol is no longer a scan candidate to prevent WS accumulation.
 */
export function unsubscribeBookTicker(symbol: string): void {
  const conn = connections.get(symbol);
  if (conn) {
    conn.closed = true;
    if (conn.reconnectTimer != null) clearTimeout(conn.reconnectTimer);
    conn.ws.onclose = null; // block reconnect before close()
    conn.ws.close();
    connections.delete(symbol);
  }
  store.delete(symbol);
}

/**
 * Returns the freshest best bid/ask for `symbol`, or `undefined` when:
 *   - not yet subscribed, or
 *   - last update older than STALE_MS (5 s) — gate-skip semantics.
 */
export function getBestBidAsk(symbol: string): { bid: number; ask: number } | undefined {
  const entry = store.get(symbol);
  if (!entry || Date.now() - entry.updatedAt > STALE_MS) return undefined;
  return { bid: entry.bid, ask: entry.ask };
}

// ── Depth cache ───────────────────────────────────────────────────────────────

const DEPTH_CACHE_TTL_MS = 30_000;
const depthCache = new Map<string, { depth10bpsUsd: number; fetchedAt: number }>();

/**
 * Returns the USD liquidity within 10 bps of mid on the bid side for `symbol`.
 * Fetches /fapi/v1/depth?limit=5 (weight 2) and caches the result for 30 seconds
 * to avoid redundant calls within the same scan cycle.
 * Returns `undefined` on any error — caller uses 0 penalty.
 */
export async function getDepth10bpsUsd(symbol: string, signal?: AbortSignal): Promise<number | undefined> {
  const cached = depthCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < DEPTH_CACHE_TTL_MS) {
    return cached.depth10bpsUsd;
  }
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=5`,
      { signal },
    );
    if (!res.ok) return undefined;
    const data = await res.json() as { bids: [string, string][]; asks: [string, string][] };
    const bestBid = parseFloat(data.bids[0]?.[0] ?? '0');
    const bestAsk = parseFloat(data.asks[0]?.[0] ?? '0');
    if (bestBid <= 0 || bestAsk <= 0) return undefined;
    const mid   = (bestBid + bestAsk) / 2;
    const floor = mid * (1 - 10 / 10_000); // 10 bps below mid
    let depth = 0;
    for (const [priceStr, qtyStr] of data.bids) {
      const price = parseFloat(priceStr);
      const qty   = parseFloat(qtyStr);
      if (price >= floor) depth += price * qty;
    }
    depthCache.set(symbol, { depth10bpsUsd: depth, fetchedAt: Date.now() });
    return depth;
  } catch {
    return undefined;
  }
}

/**
 * Returns the bid/ask spread in basis points for `symbol`, or `undefined`
 * when fresh data is unavailable (caller should skip the gate, not block entry).
 *
 *   spreadBps = (ask − bid) / mid × 10 000
 */
export function getSpreadBps(symbol: string): number | undefined {
  const ba = getBestBidAsk(symbol);
  if (!ba || ba.bid <= 0 || ba.ask <= 0) return undefined;
  const mid = (ba.bid + ba.ask) / 2;
  return mid > 0 ? ((ba.ask - ba.bid) / mid) * 10_000 : undefined;
}
