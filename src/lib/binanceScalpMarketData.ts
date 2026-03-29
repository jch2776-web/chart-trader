/**
 * binanceScalpMarketData — microstructure market data for the scalp module.
 *
 * Per-symbol combined WebSocket subscribes to three streams:
 *   <symbol>@bookTicker   — best bid/ask + quantity
 *   <symbol>@aggTrade     — individual aggressive trades
 *   <symbol>@depth5@100ms — top-5 order book levels (partial)
 *
 * Provides a synchronous ScalpMarketSnapshot per symbol for use in the
 * signal engine, updated at stream frequency (~100 ms).
 *
 * All state is module-level (not React) for zero-latency hot path access.
 */

const WS_COMBINED_BASE = 'wss://fstream.binance.com/stream?streams=';
const STALE_MS       = 2_000;  // snapshot older than this = stale
const TRADE_WINDOW_MS = 2_000; // rolling aggTrade window
const MAX_TRADES     = 200;    // max aggTrade entries per symbol

// ── Raw WS payload types ──────────────────────────────────────────────────────

interface RawBookTicker {
  b: string; // best bid price
  B: string; // best bid qty
  a: string; // best ask price
  A: string; // best ask qty
}

interface RawAggTrade {
  e: 'aggTrade';
  s: string;  // symbol
  p: string;  // price
  q: string;  // quantity
  m: boolean; // true = buyer is maker = aggressive sell
  T: number;  // trade time ms
}

interface RawDepth {
  b: [string, string][]; // bids [price, qty]
  a: [string, string][]; // asks [price, qty]
}

interface CombinedMsg {
  stream: string;
  data: RawBookTicker | RawAggTrade | RawDepth;
}

// ── Internal state ────────────────────────────────────────────────────────────

interface BookState {
  bid: number; bidQty: number;
  ask: number; askQty: number;
  updatedAt: number;
}

interface AggTradeEntry {
  price: number;
  qty: number;
  isBuy: boolean; // aggressive buy = !m
  ts: number;
}

interface DepthLevel { price: number; qty: number; }

interface DepthState {
  bids: DepthLevel[];
  asks: DepthLevel[];
  updatedAt: number;
}

// ── Public snapshot ───────────────────────────────────────────────────────────

export interface ScalpMarketSnapshot {
  symbol: string;
  bid: number;
  ask: number;
  spreadBps: number;
  microMid: number;
  bidQty: number;
  askQty: number;
  /** (bidQty − askQty) / (bidQty + askQty) at top-of-book. Range [-1, 1]. */
  bookImbalance: number;
  /** (aggBuyUsd − aggSellUsd) / (aggBuyUsd + aggSellUsd) over last 2s. Range [-1, 1]. */
  tradePressure: number;
  /** USD depth on bid side within 10 bps of mid. */
  depth10bpsUsd: number;
  /** ms elapsed since last book update. */
  staleness: number;
  updatedAt: number;
}

type UpdateCallback = (snapshot: ScalpMarketSnapshot) => void;

// ── Module-level stores ───────────────────────────────────────────────────────

const bookStore   = new Map<string, BookState>();
const tradeStore  = new Map<string, AggTradeEntry[]>();
const depthStore  = new Map<string, DepthState>();
const callbacks   = new Map<string, Set<UpdateCallback>>();

interface Conn {
  ws: WebSocket;
  backoffMs: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}
const connections = new Map<string, Conn>();

const INIT_BACKOFF = 1_000;
const MAX_BACKOFF  = 30_000;

// ── Snapshot computation ──────────────────────────────────────────────────────

function computeSnapshot(symbol: string): ScalpMarketSnapshot | null {
  const book  = bookStore.get(symbol);
  if (!book || book.bid <= 0 || book.ask <= 0) return null;

  const { bid, ask, bidQty, askQty, updatedAt } = book;
  const microMid  = (bid + ask) / 2;
  const spreadBps = microMid > 0 ? ((ask - bid) / microMid) * 10_000 : 0;

  const totalBook = bidQty + askQty;
  const bookImbalance = totalBook > 0 ? (bidQty - askQty) / totalBook : 0;

  // Rolling trade pressure
  const now    = Date.now();
  const trades = tradeStore.get(symbol) ?? [];
  const recent = trades.filter(t => now - t.ts <= TRADE_WINDOW_MS);
  let buyUsd = 0; let sellUsd = 0;
  for (const t of recent) {
    const usd = t.price * t.qty;
    if (t.isBuy) buyUsd += usd; else sellUsd += usd;
  }
  const totalUsd     = buyUsd + sellUsd;
  const tradePressure = totalUsd > 0 ? (buyUsd - sellUsd) / totalUsd : 0;

  // Bid-side depth within 10 bps of mid
  const depth = depthStore.get(symbol);
  let depth10bpsUsd = 0;
  if (depth) {
    const floor = microMid * (1 - 10 / 10_000);
    for (const { price, qty } of depth.bids) {
      if (price >= floor) depth10bpsUsd += price * qty;
    }
  }

  return {
    symbol, bid, ask, spreadBps, microMid,
    bidQty, askQty, bookImbalance, tradePressure,
    depth10bpsUsd,
    staleness: now - updatedAt,
    updatedAt,
  };
}

function emitSnapshot(symbol: string): void {
  const snap = computeSnapshot(symbol);
  if (!snap) return;
  const cbs = callbacks.get(symbol);
  if (!cbs) return;
  for (const cb of cbs) cb(snap);
}

// ── WebSocket message handler ─────────────────────────────────────────────────

function handleMessage(symbol: string, raw: string): void {
  let msg: CombinedMsg;
  try { msg = JSON.parse(raw) as CombinedMsg; } catch { return; }

  const { stream, data } = msg;
  const sym = symbol.toLowerCase();

  if (stream === `${sym}@bookTicker`) {
    const d = data as RawBookTicker;
    const bid    = parseFloat(d.b);
    const ask    = parseFloat(d.a);
    const bidQty = parseFloat(d.B);
    const askQty = parseFloat(d.A);
    if (bid > 0 && ask > 0) {
      bookStore.set(symbol, { bid, ask, bidQty, askQty, updatedAt: Date.now() });
      emitSnapshot(symbol);
    }
  } else if (stream === `${sym}@aggTrade`) {
    const d = data as RawAggTrade;
    const price = parseFloat(d.p);
    const qty   = parseFloat(d.q);
    if (price > 0 && qty > 0) {
      const arr = tradeStore.get(symbol) ?? [];
      arr.push({ price, qty, isBuy: !d.m, ts: d.T ?? Date.now() });
      // prune old trades and cap array size
      const cutoff = Date.now() - TRADE_WINDOW_MS * 2;
      const pruned = arr.filter(t => t.ts >= cutoff);
      tradeStore.set(symbol, pruned.slice(-MAX_TRADES));
    }
  } else if (stream === `${sym}@depth5@100ms`) {
    const d = data as RawDepth;
    const bids: DepthLevel[] = (d.b ?? []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
    const asks: DepthLevel[] = (d.a ?? []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
    depthStore.set(symbol, { bids, asks, updatedAt: Date.now() });
  }
}

// ── Connection management ─────────────────────────────────────────────────────

function connect(symbol: string): void {
  const sym = symbol.toLowerCase();
  const url = `${WS_COMBINED_BASE}${sym}@bookTicker/${sym}@aggTrade/${sym}@depth5@100ms`;

  let ws: WebSocket;
  try { ws = new WebSocket(url); } catch {
    const conn = connections.get(symbol);
    if (conn && !conn.closed) {
      const delay = conn.backoffMs;
      conn.backoffMs = Math.min(delay * 2, MAX_BACKOFF);
      conn.reconnectTimer = setTimeout(() => { if (!conn.closed) connect(symbol); }, delay);
    }
    return;
  }

  const conn: Conn = { ws, backoffMs: INIT_BACKOFF, reconnectTimer: null, closed: false };
  connections.set(symbol, conn);

  ws.onmessage = (evt: MessageEvent<string>) => handleMessage(symbol, evt.data);
  ws.onclose = () => {
    if (conn.closed) return;
    const delay = conn.backoffMs;
    conn.backoffMs = Math.min(delay * 2, MAX_BACKOFF);
    conn.reconnectTimer = setTimeout(() => { if (!conn.closed) connect(symbol); }, delay);
  };
  ws.onerror = () => { ws.close(); };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Subscribe to market data updates for `symbol`.
 * `callback` is invoked on every bookTicker update with the latest snapshot.
 * Idempotent — multiple calls for the same symbol share one WS.
 */
export function subscribeScalp(symbol: string, callback: UpdateCallback): void {
  if (!callbacks.has(symbol)) callbacks.set(symbol, new Set());
  callbacks.get(symbol)!.add(callback);
  if (!connections.has(symbol)) connect(symbol);
}

/**
 * Remove a specific callback for `symbol`.
 * When the last callback is removed the WS is closed and state cleared.
 */
export function unsubscribeScalp(symbol: string, callback: UpdateCallback): void {
  const cbs = callbacks.get(symbol);
  if (!cbs) return;
  cbs.delete(callback);
  if (cbs.size === 0) {
    callbacks.delete(symbol);
    cleanupScalpSymbol(symbol);
  }
}

/** Returns the current snapshot for `symbol`, or `null` if no data yet / stale. */
export function getScalpSnapshot(symbol: string): ScalpMarketSnapshot | null {
  const book = bookStore.get(symbol);
  if (!book || Date.now() - book.updatedAt > STALE_MS) return null;
  return computeSnapshot(symbol);
}

/** Close WS and clear all state for `symbol`. */
export function cleanupScalpSymbol(symbol: string): void {
  const conn = connections.get(symbol);
  if (conn) {
    conn.closed = true;
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    conn.ws.onclose = null;
    conn.ws.close();
    connections.delete(symbol);
  }
  bookStore.delete(symbol);
  tradeStore.delete(symbol);
  depthStore.delete(symbol);
}

/** Close all scalp WS connections and clear all state. */
export function cleanupAllScalp(): void {
  for (const symbol of [...connections.keys()]) cleanupScalpSymbol(symbol);
  callbacks.clear();
}
