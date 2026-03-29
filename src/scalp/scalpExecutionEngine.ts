/**
 * Scalp execution engine — maker-first limit order lifecycle management.
 *
 * Design:
 *   1. Entry submitted as LIMIT GTC (post-only intent; exchange enforces maker).
 *   2. If not filled within entryTtlMs, reprice up to maxRepriceCount times,
 *      each time using the current best bid/ask from the market snapshot.
 *   3. After maxRepriceCount reprices, submit LIMIT IOC as last-resort fallback.
 *   4. If IOC misses, skip this candidate entirely.
 *   5. On full fill: attach reduce-only LIMIT GTC TP + STOP_MARKET SL via broker.
 *   6. Partial fills: cancel remainder immediately; proceed with filled qty.
 *
 * All async operations delegate to ScalpBrokerCallbacks.
 * No React state — pure closure.
 */

import type {
  ScalpCandidate,
  ScalpOrderContext,
  ScalpActiveOrder,
  ScalpOrderState,
  ScalpOrderUpdate,
  ScalpBrokerCallbacks,
} from './types';
import type { ScalpMarketSnapshot } from '../lib/binanceScalpMarketData';
import type { ScalpTelemetry } from './scalpTelemetry';
import type { ScalpRiskEngine } from './scalpRiskEngine';
import type { ScalpSettings } from './scalpSettings';

// ── Public API ────────────────────────────────────────────────────────────────

export interface ScalpExecutionEngine {
  /** Submit entry order for a candidate signal. No-op if symbol already has active order. */
  onSignal(
    candidate: ScalpCandidate,
    quantityUsd: number,
    settings: ScalpSettings,
  ): void;
  /** Feed exchange order updates (from user stream or polling). */
  onOrderUpdate(update: ScalpOrderUpdate): void;
  /** Returns all currently tracked orders. */
  getActiveOrders(): ScalpActiveOrder[];
  /** Tick: cancel timed-out orders, trigger reprices. Call ~200ms. */
  tick(): void;
  /** Cancel all open orders and clear state (used on stop/cleanup). */
  cancelAll(): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createScalpExecutionEngine(
  broker: ScalpBrokerCallbacks,
  telemetry: ScalpTelemetry,
  risk: ScalpRiskEngine,
  onLog: (msg: string, level: 'info' | 'warn' | 'error') => void,
  /** Returns the latest market snapshot for a symbol, or null if unavailable. */
  getSnapshot: (symbol: string) => ScalpMarketSnapshot | null,
): ScalpExecutionEngine {

  // orderId → active order
  const _orders = new Map<string, ScalpActiveOrder>();
  // symbol → candidateId (one order per symbol at a time)
  const _symbolLock = new Map<string, string>();

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setState(orderId: string, state: ScalpOrderState): void {
    const o = _orders.get(orderId);
    if (o) { o.state = state; o.lastUpdatedAt = Date.now(); }
  }

  function side(ctx: ScalpOrderContext): 'BUY' | 'SELL' {
    return ctx.side === 'long' ? 'BUY' : 'SELL';
  }

  function oppositeSide(ctx: ScalpOrderContext): 'BUY' | 'SELL' {
    return ctx.side === 'long' ? 'SELL' : 'BUY';
  }

  // ── TP/SL attachment ───────────────────────────────────────────────────────

  async function attachTpSl(order: ScalpActiveOrder): Promise<void> {
    const { ctx } = order;
    const qty = order.filledQty;
    if (qty <= 0) return;

    const exitSide = oppositeSide(ctx);
    let tpOrderId = '';
    let slOrderId = '';

    try {
      // TP: reduce-only LIMIT GTC (passive maker — saves taker fees on favourable moves)
      tpOrderId = await broker.placeLimitOrder({
        symbol: ctx.symbol,
        side: exitSide,
        price: ctx.takeProfitPrice,
        quantity: qty,
        reduceOnly: true,
        timeInForce: 'GTC',
      });
    } catch (e) {
      onLog(`[${ctx.symbol}] TP 주문 실패: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }

    try {
      // SL: reduce-only STOP_MARKET — triggers at market to prevent stop miss
      slOrderId = await broker.placeStopMarketOrder({
        symbol: ctx.symbol,
        side: exitSide,
        stopPrice: ctx.stopPrice,
        quantity: qty,
        reduceOnly: true,
        orderType: 'STOP_MARKET',
      });
    } catch (e) {
      onLog(`[${ctx.symbol}] SL 주문 실패 — 포지션 무보호 상태: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }

    if (tpOrderId || slOrderId) {
      order.tpOrderId = tpOrderId || undefined;
      order.slOrderId = slOrderId || undefined;
      telemetry.emit({
        type: 'tpsl_attached',
        entryOrderId: order.orderId,
        tpOrderId: tpOrderId || '(실패)',
        slOrderId:  slOrderId || '(실패)',
        ts: Date.now(),
      });
      onLog(
        `[${ctx.symbol}] TP/SL 부착 — TP=${tpOrderId ? ctx.takeProfitPrice.toFixed(4) : '실패'} SL=${slOrderId ? ctx.stopPrice.toFixed(4) : '실패'}`,
        slOrderId ? 'info' : 'warn',
      );
    }
  }

  // ── Entry submission ───────────────────────────────────────────────────────

  async function submitEntry(ctx: ScalpOrderContext, ioc: boolean): Promise<void> {
    try {
      const orderId = await broker.placeLimitOrder({
        symbol: ctx.symbol,
        side: side(ctx),
        price: ctx.submitPrice,
        quantity: ctx.quantity,
        reduceOnly: false,
        timeInForce: ioc ? 'IOC' : 'GTC',
      });

      const activeOrder: ScalpActiveOrder = {
        ctx,
        orderId,
        state: 'open',
        filledQty: 0,
        avgFillPrice: 0,
        repriceCount: ctx.maxRepriceCount - (ioc ? 1 : 0), // IOC = final attempt
        submittedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      };
      _orders.set(orderId, activeOrder);
      _symbolLock.set(ctx.symbol, ctx.candidateId);
      risk.recordEntry(ctx.symbol);
      telemetry.emit({ type: 'order_submitted', ctx, orderId, ts: Date.now() });
      onLog(`[${ctx.symbol}] 주문 제출 — ${ioc ? 'IOC' : 'GTC'} ${side(ctx)} ${ctx.quantity} @ ${ctx.submitPrice.toFixed(4)}`, 'info');
    } catch (e) {
      _symbolLock.delete(ctx.symbol);
      onLog(`[${ctx.symbol}] 주문 제출 실패: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  // ── Reprice ────────────────────────────────────────────────────────────────

  async function reprice(order: ScalpActiveOrder, newPrice: number): Promise<void> {
    const { ctx, orderId } = order;
    try {
      await broker.cancelOrder(orderId, ctx.symbol);
      telemetry.emit({ type: 'order_canceled', orderId, reason: 'reprice', ts: Date.now() });
    } catch { /* ignore cancel errors — order may already be gone */ }

    _orders.delete(orderId);
    const newCtx: ScalpOrderContext = { ...ctx, submitPrice: newPrice };
    order.repriceCount++;
    telemetry.emit({ type: 'order_repriced', orderId, oldPrice: ctx.submitPrice, newPrice, repriceCount: order.repriceCount, ts: Date.now() });
    onLog(`[${ctx.symbol}] 재호가 #${order.repriceCount} → ${newPrice.toFixed(4)}`, 'info');
    await submitEntry(newCtx, order.repriceCount >= newCtx.maxRepriceCount);
  }

  // ── onSignal ───────────────────────────────────────────────────────────────

  function onSignal(candidate: ScalpCandidate, quantityUsd: number, settings: ScalpSettings): void {
    // One active order per symbol at a time
    if (_symbolLock.has(candidate.symbol)) return;

    const qty = quantityUsd / candidate.entryRef;
    if (qty <= 0) return;

    const ctx: ScalpOrderContext = {
      candidateId: candidate.id,
      symbol: candidate.symbol,
      side: candidate.side,
      quantity: parseFloat(qty.toFixed(3)), // rounded to reasonable precision
      submitPrice: candidate.entryRef,
      entryTtlMs: settings.entryTtlMs,
      maxRepriceCount: settings.maxRepriceCount,
      stopPrice: candidate.stopRef,
      takeProfitPrice: candidate.tpRef,
    };

    telemetry.emit({ type: 'signal_emitted', candidate, ts: Date.now() });
    void submitEntry(ctx, false);
  }

  // ── onOrderUpdate ──────────────────────────────────────────────────────────

  function onOrderUpdate(update: ScalpOrderUpdate): void {
    const order = _orders.get(update.orderId);
    if (!order) return;

    order.lastUpdatedAt = update.ts;

    if (update.status === 'PARTIALLY_FILLED') {
      order.state = 'partially_filled';
      order.filledQty = update.executedQty;
      order.avgFillPrice = update.avgPrice;
      telemetry.emit({ type: 'partial_fill', orderId: update.orderId, filledQty: update.executedQty, price: update.avgPrice, ts: update.ts });

    } else if (update.status === 'FILLED') {
      order.state = 'filled';
      order.filledQty = update.executedQty;
      order.avgFillPrice = update.avgPrice;
      _symbolLock.delete(order.ctx.symbol);
      const notionalUsd = order.avgFillPrice * order.filledQty;
      risk.updateExposure(notionalUsd);
      telemetry.emit({ type: 'full_fill', orderId: update.orderId, qty: update.executedQty, price: update.avgPrice, ts: update.ts });
      onLog(`[${order.ctx.symbol}] 체결 완료 — ${order.filledQty} @ ${order.avgFillPrice.toFixed(4)}`, 'info');
      void attachTpSl(order);

    } else if (update.status === 'CANCELED' || update.status === 'REJECTED' || update.status === 'EXPIRED') {
      // Handle partial fill on cancel: proceed with filled qty if > 0
      if (order.filledQty > 0) {
        order.state = 'partially_filled';
        onLog(`[${order.ctx.symbol}] 부분 체결 후 취소 — 체결된 ${order.filledQty} 기준 TP/SL 부착`, 'warn');
        _symbolLock.delete(order.ctx.symbol);
        risk.updateExposure(order.avgFillPrice * order.filledQty);
        void attachTpSl(order);
      } else {
        const newState: ScalpOrderState = update.status === 'REJECTED' ? 'rejected' : 'canceled';
        setState(update.orderId, newState);
        _symbolLock.delete(order.ctx.symbol);
        telemetry.emit({ type: 'order_canceled', orderId: update.orderId, reason: update.status, ts: update.ts });
        onLog(`[${order.ctx.symbol}] 주문 ${update.status}`, 'warn');
      }
    }
  }

  // ── tick ───────────────────────────────────────────────────────────────────

  function tick(): void {
    const now = Date.now();
    for (const [, order] of _orders) {
      if (order.state !== 'open' && order.state !== 'partially_filled') continue;
      const elapsed = now - order.submittedAt;
      if (elapsed < order.ctx.entryTtlMs) continue;

      // TTL exceeded
      if (order.repriceCount < order.ctx.maxRepriceCount) {
        // Reprice to current live best bid/ask (maker-biased, one tick inside mid)
        const snap = getSnapshot(order.ctx.symbol);
        const newPrice = snap
          ? (order.ctx.side === 'long'
              ? snap.bid                         // join best bid queue
              : snap.ask)                        // join best ask queue
          : order.ctx.submitPrice;               // fallback: hold previous price
        void reprice(order, newPrice);
      } else {
        // All reprices exhausted
        setState(order.orderId, 'timed_out');
        _symbolLock.delete(order.ctx.symbol);
        broker.cancelOrder(order.orderId, order.ctx.symbol).catch(() => {});
        telemetry.emit({ type: 'timeout_exit', orderId: order.orderId, ts: now });
        onLog(`[${order.ctx.symbol}] 진입 타임아웃 — 주문 취소`, 'warn');
      }
    }

    // Prune terminal orders older than 10 min
    for (const [id, order] of _orders) {
      const terminal: ScalpOrderState[] = ['filled', 'canceled', 'rejected', 'timed_out'];
      if (terminal.includes(order.state) && now - order.lastUpdatedAt > 600_000) {
        _orders.delete(id);
      }
    }
  }

  // ── cancelAll ─────────────────────────────────────────────────────────────

  function cancelAll(): void {
    for (const [, order] of _orders) {
      if (order.state === 'open' || order.state === 'partially_filled') {
        broker.cancelOrder(order.orderId, order.ctx.symbol).catch(() => {});
        setState(order.orderId, 'canceled');
        telemetry.emit({ type: 'order_canceled', orderId: order.orderId, reason: 'session_stop', ts: Date.now() });
      }
    }
    _orders.clear();
    _symbolLock.clear();
  }

  return { onSignal, onOrderUpdate, getActiveOrders: () => [..._orders.values()], tick, cancelAll };
}
