/**
 * Shared types for the scalp auto-trade module.
 *
 * Completely independent of the leader-retest / breakout / fvg types.
 * Import only from this file within the scalp module.
 */

// ── Candidate signal ──────────────────────────────────────────────────────────

/** A microstructure signal produced by the signal engine. */
export interface ScalpCandidate {
  /** Unique identifier for this signal instance (nanoid-style). */
  id: string;
  symbol: string;
  side: 'long' | 'short';
  /** Signal quality in [0, 1]. Higher = stronger setup. */
  score: number;
  signalType: 'micro-momentum' | 'micro-revert';
  /** Reference price for limit entry (typically mid or best-bid/ask). */
  entryRef: number;
  /** Stop-loss price. */
  stopRef: number;
  /** Take-profit price. */
  tpRef: number;
  /** Signal validity window in ms. Signal is stale after signalTs + ttlMs. */
  ttlMs: number;
  meta: {
    spreadBps: number;
    /** (bidQty − askQty) / (bidQty + askQty) at top-of-book. */
    imbalance: number;
    /** (aggBuyUsd − aggSellUsd) / (aggBuyUsd + aggSellUsd) over recent 2s. */
    tradePressure: number;
    depth10bpsUsd?: number;
    signalTs: number;
  };
}

// ── Order lifecycle ───────────────────────────────────────────────────────────

export type ScalpOrderState =
  | 'pending_submit'   // queued, not yet sent to exchange
  | 'open'             // resting on the book
  | 'partially_filled' // at least one fill, still open
  | 'filled'           // fully filled
  | 'canceled'         // canceled (timeout / risk / reprice)
  | 'rejected'         // exchange rejected
  | 'timed_out';       // entry TTL exceeded before fill

/** Parameters driving a single scalp order attempt. */
export interface ScalpOrderContext {
  candidateId: string;
  symbol: string;
  side: 'long' | 'short';
  /** Planned quantity in base asset. */
  quantity: number;
  /** Limit price at submission time. */
  submitPrice: number;
  /** ms the entry order is allowed to rest before cancel. */
  entryTtlMs: number;
  /** Maximum reprice attempts. Each reprice resets TTL. */
  maxRepriceCount: number;
  stopPrice: number;
  takeProfitPrice: number;
}

/** Live tracking record maintained by the execution engine. */
export interface ScalpActiveOrder {
  ctx: ScalpOrderContext;
  orderId: string;
  state: ScalpOrderState;
  filledQty: number;
  avgFillPrice: number;
  repriceCount: number;
  submittedAt: number;
  lastUpdatedAt: number;
  /** Order ID of the attached stop-loss order (set after full fill). */
  slOrderId?: string;
  /** Order ID of the attached take-profit order (set after full fill). */
  tpOrderId?: string;
  /** Guard: prevent duplicate TP/SL attachment on repeated FILLED updates. */
  tpslAttachStarted?: boolean;
  /** Guard: prevent concurrent TP/SL attach retries. */
  tpslAttachInFlight?: boolean;
  /** Last protection attach attempt timestamp. */
  lastProtectionAttemptAt?: number;
  /** Number of protection attach retries performed. */
  protectionRetryCount?: number;
  /** True after entry exposure has been booked into risk engine. */
  exposureBooked?: boolean;
  /** True when fill was recovered from live position snapshot (WS fill event missing). */
  filledRecoveredByPositionCheck?: boolean;
  /** Timestamp when live position snapshot first showed no open position for this order. */
  positionAbsentSince?: number;
}

// ── Broker interface ──────────────────────────────────────────────────────────

export interface ScalpLimitOrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  reduceOnly: boolean;
  timeInForce: 'GTC' | 'IOC' | 'GTX';
}

/** Parameters for a stop/take-profit market order. */
export interface ScalpStopOrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** Trigger price for STOP_MARKET or TAKE_PROFIT_MARKET. */
  stopPrice: number;
  quantity: number;
  reduceOnly: boolean;
  orderType: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
}

export interface ScalpOpenProtectionOrderRef {
  orderId: string;
  time?: number;
  type?: string;
}

/**
 * Minimal broker interface supplied from App.tsx.
 * Decoupled from Binance SDK — callers adapt to this contract.
 * Returns orderId on success; throws on failure.
 */
export interface ScalpBrokerCallbacks {
  placeLimitOrder(params: ScalpLimitOrderParams): Promise<string>;
  /** Place a STOP_MARKET or TAKE_PROFIT_MARKET reduce-only order. */
  placeStopMarketOrder(params: ScalpStopOrderParams): Promise<string>;
  cancelOrder(orderId: string, symbol: string): Promise<void>;
  /**
   * Optional runtime guard for duplicate protection orders.
   * Returns currently open TP/SL-like order refs for symbol+side.
   */
  getOpenProtectionOrders?: (
    symbol: string,
    side: 'long' | 'short',
  ) => ScalpOpenProtectionOrderRef[];
  /**
   * Optional live snapshot fallback:
   * Returns currently open position for symbol+side (if any), used to recover missed FILLED events.
   */
  getOpenPosition?: (
    symbol: string,
    side: 'long' | 'short',
  ) => { qty: number; entryPrice?: number } | null;
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

export type ScalpTelemetryEvent =
  | { type: 'signal_emitted';    candidate: ScalpCandidate; ts: number }
  | { type: 'order_submitted';   ctx: ScalpOrderContext; orderId: string; ts: number }
  | { type: 'order_repriced';    orderId: string; oldPrice: number; newPrice: number; repriceCount: number; ts: number }
  | { type: 'order_canceled';    orderId: string; reason: string; ts: number }
  | { type: 'partial_fill';      orderId: string; filledQty: number; price: number; ts: number }
  | { type: 'full_fill';         orderId: string; qty: number; price: number; ts: number }
  | { type: 'tpsl_attached';     entryOrderId: string; tpOrderId: string; slOrderId: string; ts: number }
  | { type: 'stop_hit';          orderId: string; exitPrice: number; pnl: number; ts: number }
  | { type: 'tp_hit';            orderId: string; exitPrice: number; pnl: number; ts: number }
  | { type: 'timeout_exit';      orderId: string; ts: number }
  | { type: 'breaker_triggered'; reason: string; symbol?: string; ts: number }
  | { type: 'symbol_cooldown';   symbol: string; cooldownUntil: number; ts: number };

// ── Log ───────────────────────────────────────────────────────────────────────

export interface ScalpLog {
  id: number;
  ts: number;
  msg: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

// ── User stream update ────────────────────────────────────────────────────────

/** Normalised ORDER_TRADE_UPDATE payload passed to the execution engine. */
export interface ScalpOrderUpdate {
  orderId: string;
  symbol: string;
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';
  executedQty: number;
  avgPrice: number;
  lastFilledQty: number;
  lastFilledPrice: number;
  reduceOnly: boolean;
  ts: number;
}
