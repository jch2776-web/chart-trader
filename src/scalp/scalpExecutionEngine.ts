/**
 * Scalp execution engine — maker-first limit order lifecycle management.
 *
 * Design:
 *   1. Entry submitted as LIMIT GTX (post-only maker intent).
 *   2. If not filled within entryTtlMs, reprice up to maxRepriceCount times,
 *      each time using the current best bid/ask from the market snapshot.
 *   3. (optional) final LIMIT IOC fallback can be enabled for aggressive catch-up.
 *   4. If fallback misses, skip this candidate entirely.
 *   5. On full fill: attach reduce-only LIMIT GTC TP + STOP_MARKET SL via broker.
 *   6. Partial fills: cancel remainder immediately; proceed with filled qty.
 *   7. When TP fills → SL is auto-canceled; when SL fills → TP is auto-canceled.
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
  ScalpOpenProtectionOrderRef,
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

export interface ScalpEngineCallbacks {
  /** Called when an entry order fully fills (position is now open). */
  onPositionOpen?: (
    symbol: string,
    positionSide: 'LONG' | 'SHORT',
    plannedTP: number,
    plannedSL: number,
  ) => void;
  /** Called when a TP or SL exit fills (position is now closed). */
  onPositionClose?: (
    symbol: string,
    positionSide: 'LONG' | 'SHORT',
    reason: 'tp' | 'sl',
  ) => void;
}

export function createScalpExecutionEngine(
  broker: ScalpBrokerCallbacks,
  telemetry: ScalpTelemetry,
  risk: ScalpRiskEngine,
  onLog: (msg: string, level: 'info' | 'warn' | 'error') => void,
  /** Returns the latest market snapshot for a symbol, or null if unavailable. */
  getSnapshot: (symbol: string) => ScalpMarketSnapshot | null,
  /** Returns current session settings (read each use — never captured at construction). */
  getSettings: () => ScalpSettings,
  /** Optional lifecycle callbacks for trade history integration. */
  callbacks?: ScalpEngineCallbacks,
): ScalpExecutionEngine {

  // orderId → active entry order
  const _orders = new Map<string, ScalpActiveOrder>();
  // symbol → candidateId (one order per symbol at a time)
  const _symbolLock = new Map<string, string>();
  // symbol → timestamp until which new entries are blocked after a broker error
  const _errorCooldownUntil = new Map<string, number>();
  // tpOrderId → entry orderId (reverse index for sibling cancel)
  const _tpIndex = new Map<string, string>();
  // slOrderId → entry orderId (reverse index for sibling cancel)
  const _slIndex = new Map<string, string>();
  // orderIds currently in-flight for sibling cancel (dedup guard)
  const _siblingCancelInFlight = new Set<string>();
  const _protectionCleanupCancelInFlight = new Set<string>();
  // symbol → next timestamp when duplicate-protection warning may be emitted
  const _protectionGuardLogUntil = new Map<string, number>();
  const ERROR_COOLDOWN_MS = 15_000;
  const MAKER_REJECT_COOLDOWN_MS = 1_200;
  const MARGIN_INSUFFICIENT_COOLDOWN_MS = 20_000;
  const MIN_QTY_COOLDOWN_MS = 45_000;
  const PROTECTION_OVERLOAD_BLOCK_MS = 8_000;
  const PROTECTION_OVERLOAD_LOG_COOLDOWN_MS = 15_000;
  // Global order throttle: prevents >2 broker calls/second across all symbols
  const MIN_ORDER_INTERVAL_MS = 500;
  const PROTECTION_RETRY_INTERVAL_MS = 15_000;
  const LOCK_RELEASE_GRACE_MS = 25_000;
  const POSITION_CLOSE_CONFIRM_MS = 25_000;
  const LATE_FILL_RECOVERY_WINDOW_MS = 45_000;
  const ENTRY_TIME_IN_FORCE: 'GTC' | 'GTX' = 'GTX';
  const ENABLE_IOC_FALLBACK = false;
  let _lastOrderAt = 0;
  // Stop guard: prevents late async broker responses from reviving a stopped session.
  let _disposed = false;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setState(orderId: string, state: ScalpOrderState): void {
    const o = _orders.get(orderId);
    if (o) { o.state = state; o.lastUpdatedAt = Date.now(); }
  }

  function tryRecoverMissedFill(order: ScalpActiveOrder): boolean {
    if (!broker.getOpenPosition) return false;
    if (
      order.state !== 'open' &&
      order.state !== 'partially_filled' &&
      order.state !== 'timed_out' &&
      order.state !== 'canceled'
    ) return false;
    // Only one tracked order may own an open position per symbol/side.
    for (const [, existing] of _orders) {
      if (existing.orderId === order.orderId) continue;
      if (existing.ctx.symbol !== order.ctx.symbol || existing.ctx.side !== order.ctx.side) continue;
      if ((existing.state === 'filled' || existing.state === 'partially_filled') && existing.filledQty > 0) {
        return false;
      }
    }
    const pos = broker.getOpenPosition(order.ctx.symbol, order.ctx.side);
    if (!pos || !Number.isFinite(pos.qty) || pos.qty <= 0) return false;
    // Guard against unrelated very large manual positions.
    // Do NOT require a minimum ratio here: tiny partial fills can be valid and
    // still must be protected by TP/SL immediately.
    const expected = order.ctx.quantity;
    if (expected > 0 && pos.qty > expected * 3) return false;

    order.state = 'filled';
    order.filledQty = pos.qty;
    order.avgFillPrice =
      pos.entryPrice && pos.entryPrice > 0
        ? pos.entryPrice
        : (order.avgFillPrice > 0 ? order.avgFillPrice : order.ctx.submitPrice);
    order.lastUpdatedAt = Date.now();
    order.filledRecoveredByPositionCheck = true;
    order.positionAbsentSince = undefined;
    _symbolLock.set(order.ctx.symbol, order.ctx.candidateId);
    if (!order.exposureBooked) {
      risk.updateExposure(order.avgFillPrice * order.filledQty);
      order.exposureBooked = true;
    }
    telemetry.emit({ type: 'full_fill', orderId: order.orderId, qty: order.filledQty, price: order.avgFillPrice, ts: Date.now() });
    onLog(`[${order.ctx.symbol}] 체결 이벤트 누락 복구 — 포지션 감지 ${order.filledQty} @ ${order.avgFillPrice.toFixed(4)}`, 'warn');
    callbacks?.onPositionOpen?.(
      order.ctx.symbol,
      order.ctx.side === 'long' ? 'LONG' : 'SHORT',
      order.ctx.takeProfitPrice,
      order.ctx.stopPrice,
    );
    if (!order.tpslAttachStarted) {
      order.tpslAttachStarted = true;
      void attachTpSl(order);
    }
    return true;
  }

  function side(ctx: ScalpOrderContext): 'BUY' | 'SELL' {
    return ctx.side === 'long' ? 'BUY' : 'SELL';
  }

  function oppositeSide(ctx: ScalpOrderContext): 'BUY' | 'SELL' {
    return ctx.side === 'long' ? 'SELL' : 'BUY';
  }

  // ── Sibling cancel ─────────────────────────────────────────────────────────

  function cancelSibling(siblingId: string, symbol: string, role: 'TP' | 'SL'): void {
    if (_siblingCancelInFlight.has(siblingId)) {
      onLog(`[${symbol}] sibling ${role} 이미 종료 — 취소 생략`, 'info');
      return;
    }
    _siblingCancelInFlight.add(siblingId);
    broker.cancelOrder(siblingId, symbol)
      .then(() => {
        onLog(`[${symbol}] sibling ${role} 자동 취소 완료`, 'info');
      })
      .catch((e: unknown) => {
        // Already filled or canceled — safe to ignore
        onLog(`[${symbol}] sibling ${role} 취소 불필요 (이미 종료됨): ${e instanceof Error ? e.message : String(e)}`, 'info');
      })
      .finally(() => {
        _siblingCancelInFlight.delete(siblingId);
        _tpIndex.delete(siblingId);
        _slIndex.delete(siblingId);
      });
  }

  function cancelCompetingProtection(owner: ScalpActiveOrder): void {
    for (const [, other] of _orders) {
      if (other.orderId === owner.orderId) continue;
      if (other.ctx.symbol !== owner.ctx.symbol || other.ctx.side !== owner.ctx.side) continue;
      if (other.tpOrderId) {
        cancelSibling(other.tpOrderId, owner.ctx.symbol, 'TP');
        other.tpOrderId = undefined;
      }
      if (other.slOrderId) {
        cancelSibling(other.slOrderId, owner.ctx.symbol, 'SL');
        other.slOrderId = undefined;
      }
    }
  }

  function getOpenProtectionOrders(symbol: string, side: 'long' | 'short'): ScalpOpenProtectionOrderRef[] {
    const rows = broker.getOpenProtectionOrders?.(symbol, side) ?? [];
    if (rows.length <= 1) return rows;
    const dedup = new Map<string, ScalpOpenProtectionOrderRef>();
    for (const row of rows) {
      if (!row?.orderId) continue;
      const key = String(row.orderId);
      if (!dedup.has(key)) dedup.set(key, row);
    }
    return [...dedup.values()];
  }

  function cleanupExcessProtectionOrders(
    symbol: string,
    rows: ScalpOpenProtectionOrderRef[],
  ): void {
    if (rows.length <= 2) return;
    const sorted = [...rows].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
    const keep = new Set(sorted.slice(0, 2).map(r => String(r.orderId)));
    const drop = sorted.filter(r => !keep.has(String(r.orderId)));
    for (const ref of drop) {
      const orderId = String(ref.orderId);
      if (!orderId || _protectionCleanupCancelInFlight.has(orderId)) continue;
      _protectionCleanupCancelInFlight.add(orderId);
      broker.cancelOrder(orderId, symbol)
        .catch(() => { /* ignore: already filled/canceled */ })
        .finally(() => {
          _protectionCleanupCancelInFlight.delete(orderId);
        });
    }
  }

  // ── Exit fill handler (shared by TP and SL paths) ─────────────────────────

  function handleExitFill(
    entryOrderId: string,
    update: ScalpOrderUpdate,
    kind: 'tp' | 'sl',
  ): void {
    const entryOrder = _orders.get(entryOrderId);
    if (!entryOrder) return;

    const { ctx } = entryOrder;
    const exitPrice = update.avgPrice > 0 ? update.avgPrice : update.lastFilledPrice;
    const pnl = ctx.side === 'long'
      ? (exitPrice - entryOrder.avgFillPrice) * entryOrder.filledQty
      : (entryOrder.avgFillPrice - exitPrice) * entryOrder.filledQty;

    // Reduce open exposure and record exit in risk engine
    risk.updateExposure(-(entryOrder.avgFillPrice * entryOrder.filledQty));
    risk.recordExit(ctx.symbol, pnl, getSettings().symbolCooldownMs);
    _symbolLock.delete(ctx.symbol);

    if (kind === 'tp') {
      entryOrder.tpOrderId = undefined;
      _tpIndex.delete(update.orderId);
      telemetry.emit({ type: 'tp_hit', orderId: update.orderId, exitPrice, pnl, ts: update.ts });
      onLog(
        `[${ctx.symbol}] TP 체결 — 가 ${exitPrice.toFixed(4)} PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD`,
        'info',
      );
      onLog(`[${ctx.symbol}] TP 체결 감지 → SL 자동 취소`, 'info');
      if (entryOrder.slOrderId) cancelSibling(entryOrder.slOrderId, ctx.symbol, 'SL');
    } else {
      entryOrder.slOrderId = undefined;
      _slIndex.delete(update.orderId);
      telemetry.emit({ type: 'stop_hit', orderId: update.orderId, exitPrice, pnl, ts: update.ts });
      onLog(
        `[${ctx.symbol}] SL 체결 — 가 ${exitPrice.toFixed(4)} PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD`,
        pnl >= 0 ? 'info' : 'warn',
      );
      onLog(`[${ctx.symbol}] SL 체결 감지 → TP 자동 취소`, 'warn');
      if (entryOrder.tpOrderId) cancelSibling(entryOrder.tpOrderId, ctx.symbol, 'TP');
    }

    // Notify trade-history integration
    callbacks?.onPositionClose?.(
      ctx.symbol,
      ctx.side === 'long' ? 'LONG' : 'SHORT',
      kind,
    );

    // Mark entry order as terminal so it's eventually pruned
    entryOrder.filledQty = 0;
    setState(entryOrderId, 'filled');
  }

  // ── TP/SL attachment ───────────────────────────────────────────────────────

  async function attachTpSl(order: ScalpActiveOrder): Promise<void> {
    if (_disposed) return;
    if (order.tpslAttachInFlight) return;
    if (order.tpOrderId && order.slOrderId) return;
    order.tpslAttachInFlight = true;
    order.lastProtectionAttemptAt = Date.now();
    order.protectionRetryCount = (order.protectionRetryCount ?? 0) + 1;
    const { ctx } = order;
    const qty = order.filledQty;
    try {
      if (qty <= 0) return;
      const now = Date.now();
      const protectionRows = getOpenProtectionOrders(ctx.symbol, ctx.side);
      const protectionCount = protectionRows.length;
      if (protectionCount > 2) {
        cleanupExcessProtectionOrders(ctx.symbol, protectionRows);
        const nextLogAt = _protectionGuardLogUntil.get(ctx.symbol) ?? 0;
        if (now >= nextLogAt) {
          onLog(
            `[${ctx.symbol}] 보호주문 과다(${protectionCount}) 감지 — 초과 주문 자동정리 후 재시도`,
            'warn',
          );
          _protectionGuardLogUntil.set(ctx.symbol, now + PROTECTION_OVERLOAD_LOG_COOLDOWN_MS);
        }
        _errorCooldownUntil.set(
          ctx.symbol,
          Math.max(_errorCooldownUntil.get(ctx.symbol) ?? 0, now + PROTECTION_OVERLOAD_BLOCK_MS),
        );
        order.lastProtectionAttemptAt = now + PROTECTION_OVERLOAD_BLOCK_MS;
        return;
      }

      const exitSide = oppositeSide(ctx);
      let tpOrderId = '';
      let slOrderId = '';

      // Adjust TP/SL for fill price drift: if the order filled at a different price than the
      // original submitPrice (e.g. after repricing), the RR ratio would be inverted without adjustment.
      // Shift TP and SL by the same delta so the original distances from entry are preserved.
      const fillPrice = order.avgFillPrice > 0 ? order.avgFillPrice : ctx.submitPrice;
      const priceDelta = fillPrice - ctx.submitPrice;
      const adjustedStopPrice      = ctx.stopPrice      + priceDelta;
      const adjustedTakeProfitPrice = ctx.takeProfitPrice + priceDelta;

      // Prevent duplicate protective orders for the same symbol/side from stale tracked entries.
      cancelCompetingProtection(order);

      // Always prioritize SL first so position is protected even if TP placement fails.
      if (!order.slOrderId) {
        try {
          // SL: reduce-only STOP_MARKET — triggers at market to prevent stop miss
          slOrderId = await broker.placeStopMarketOrder({
            symbol: ctx.symbol,
            side: exitSide,
            stopPrice: adjustedStopPrice,
            quantity: qty,
            reduceOnly: true,
            orderType: 'STOP_MARKET',
          });
        } catch (e) {
          onLog(`[${ctx.symbol}] SL 주문 실패 — 포지션 무보호 상태: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }
      }

      if (!order.tpOrderId) {
        let tpErrMsg = '';
        try {
          // TP: reduce-only LIMIT GTC (passive maker — saves taker fees on favourable moves)
          tpOrderId = await broker.placeLimitOrder({
            symbol: ctx.symbol,
            side: exitSide,
            price: adjustedTakeProfitPrice,
            quantity: qty,
            reduceOnly: true,
            timeInForce: 'GTC',
          });
        } catch (e) {
          tpErrMsg = e instanceof Error ? e.message : String(e);
          onLog(`[${ctx.symbol}] TP 주문 실패: ${tpErrMsg}`, 'error');
        }

        // Some one-way reduce-only cases reject TP LIMIT while SL is already reserved.
        // Fallback to TAKE_PROFIT_MARKET once before entering periodic retry loop.
        if (!tpOrderId && tpErrMsg && /-2022|-4118|ReduceOnly/i.test(tpErrMsg)) {
          try {
            tpOrderId = await broker.placeStopMarketOrder({
              symbol: ctx.symbol,
              side: exitSide,
              stopPrice: adjustedTakeProfitPrice,
              quantity: qty,
              reduceOnly: true,
              orderType: 'TAKE_PROFIT_MARKET',
            });
            onLog(`[${ctx.symbol}] TP LIMIT 거부 → TP_MARKET 대체 주문 성공`, 'warn');
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2);
            onLog(`[${ctx.symbol}] TP 대체 주문 실패: ${msg2}`, 'error');
            // Avoid noisy rapid retries on known reduce-only conflicts.
            order.lastProtectionAttemptAt = Date.now() + 60_000;
          }
        }
      }

      if (tpOrderId || slOrderId) {
        // Keep already valid leg IDs; only fill missing ones.
        if (!order.tpOrderId && tpOrderId) order.tpOrderId = tpOrderId;
        if (!order.slOrderId && slOrderId) order.slOrderId = slOrderId;

        // Register in reverse indices for sibling cancel
        if (tpOrderId) _tpIndex.set(tpOrderId, order.orderId);
        if (slOrderId) _slIndex.set(slOrderId, order.orderId);

        telemetry.emit({
          type: 'tpsl_attached',
          entryOrderId: order.orderId,
          tpOrderId: tpOrderId || '(실패)',
          slOrderId:  slOrderId || '(실패)',
          ts: Date.now(),
        });
        const driftBps = ctx.submitPrice > 0
          ? Math.round(Math.abs(priceDelta) / ctx.submitPrice * 10_000)
          : 0;
        const driftNote = driftBps > 0 ? ` (체결가 드리프트 ${priceDelta >= 0 ? '+' : ''}${driftBps}bps 보정)` : '';
        onLog(
          `[${ctx.symbol}] TP/SL 부착 — TP=${order.tpOrderId ? adjustedTakeProfitPrice.toFixed(4) : '실패'} SL=${order.slOrderId ? adjustedStopPrice.toFixed(4) : '실패'}${driftNote}`,
          order.slOrderId ? 'info' : 'warn',
        );
      }
    } finally {
      order.tpslAttachInFlight = false;
    }
  }

  // ── Entry submission ───────────────────────────────────────────────────────

  async function submitEntry(ctx: ScalpOrderContext, ioc: boolean, makerRetryCount = 0): Promise<void> {
    if (_disposed) return;
    try {
      const orderId = await broker.placeLimitOrder({
        symbol: ctx.symbol,
        side: side(ctx),
        price: ctx.submitPrice,
        quantity: ctx.quantity,
        reduceOnly: false,
        timeInForce: ioc ? 'IOC' : ENTRY_TIME_IN_FORCE,
      });
      if (_disposed) {
        broker.cancelOrder(orderId, ctx.symbol).catch(() => {});
        return;
      }

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
      risk.recordEntry(ctx.symbol);
      telemetry.emit({ type: 'order_submitted', ctx, orderId, ts: Date.now() });
      onLog(
        `[${ctx.symbol}] 주문 제출 — ${ioc ? 'IOC' : ENTRY_TIME_IN_FORCE} ${side(ctx)} ${ctx.quantity} @ ${ctx.submitPrice.toFixed(4)}`,
        'info',
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const lower = errMsg.toLowerCase();
      const isMinNotionalError = errMsg.includes('-4164') || /notional/i.test(errMsg);
      const isMakerRejectError = errMsg.includes('-5022') || (lower.includes('post only') && lower.includes('maker'));
      const isMinQtyError =
        lower.includes('최소 단위 미만') ||
        lower.includes('lot size') ||
        lower.includes('step size');
      const isMarginInsufficientError = errMsg.includes('-2019') || lower.includes('margin is insufficient');

      // Post-only reject can occur on fast-tick boundaries.
      // Retry once immediately with a safer maker price before applying cooldown.
      if (!ioc && isMakerRejectError && makerRetryCount < 1) {
        const snap = getSnapshot(ctx.symbol);
        if (snap) {
          const nextPrice = ctx.side === 'long'
            ? Math.min(ctx.submitPrice, snap.bid)
            : Math.max(ctx.submitPrice, snap.ask);
          if (Number.isFinite(nextPrice) && nextPrice > 0) {
            const relDiff = Math.abs(nextPrice - ctx.submitPrice) / Math.max(1e-9, ctx.submitPrice);
            if (relDiff > 1e-9) {
              onLog(
                `[${ctx.symbol}] Post-only 거부(-5022) → 메이커 가격 재시도 ${ctx.submitPrice.toFixed(4)} → ${nextPrice.toFixed(4)}`,
                'warn',
              );
              await submitEntry({ ...ctx, submitPrice: nextPrice }, ioc, makerRetryCount + 1);
              return;
            }
          }
        }
        _errorCooldownUntil.set(ctx.symbol, Date.now() + MAKER_REJECT_COOLDOWN_MS);
        _symbolLock.delete(ctx.symbol);
        onLog(
          `[${ctx.symbol}] Post-only 거부(-5022) — 호가 급변 구간, ${Math.ceil(MAKER_REJECT_COOLDOWN_MS / 1000)}초 후 재평가`,
          'warn',
        );
        return;
      }

      const cooldownMs = isMinNotionalError
        ? 60_000
        : isMinQtyError
          ? MIN_QTY_COOLDOWN_MS
          : isMarginInsufficientError
            ? MARGIN_INSUFFICIENT_COOLDOWN_MS
            : ERROR_COOLDOWN_MS;
      const until = Date.now() + cooldownMs;
      _errorCooldownUntil.set(ctx.symbol, until);
      _symbolLock.delete(ctx.symbol);
      onLog(
        `[${ctx.symbol}] 주문 제출 실패: ${errMsg} — ${Math.ceil(cooldownMs / 1000)}초 쿨다운`,
        'error',
      );
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
    const useIoc = ENABLE_IOC_FALLBACK && order.repriceCount >= newCtx.maxRepriceCount;
    await submitEntry(newCtx, useIoc);
  }

  // ── onSignal ───────────────────────────────────────────────────────────────

  function onSignal(candidate: ScalpCandidate, quantityUsd: number, settings: ScalpSettings): void {
    if (_disposed) return;
    const now = Date.now();
    // One active order per symbol at a time
    if (_symbolLock.has(candidate.symbol)) return;
    const protectionRows = getOpenProtectionOrders(candidate.symbol, candidate.side);
    const protectionCount = protectionRows.length;
    if (protectionCount > 2) {
      cleanupExcessProtectionOrders(candidate.symbol, protectionRows);
      const nextLogAt = _protectionGuardLogUntil.get(candidate.symbol) ?? 0;
      if (now >= nextLogAt) {
        onLog(
          `[${candidate.symbol}] 보호주문 과다(${protectionCount}) 상태로 신규 진입 일시차단 — 초과 주문 자동정리 중`,
          'warn',
        );
        _protectionGuardLogUntil.set(candidate.symbol, now + PROTECTION_OVERLOAD_LOG_COOLDOWN_MS);
      }
      _errorCooldownUntil.set(
        candidate.symbol,
        Math.max(_errorCooldownUntil.get(candidate.symbol) ?? 0, now + PROTECTION_OVERLOAD_BLOCK_MS),
      );
      return;
    }
    const cooldownUntil = _errorCooldownUntil.get(candidate.symbol) ?? 0;
    if (cooldownUntil > now) return;
    if (cooldownUntil > 0) _errorCooldownUntil.delete(candidate.symbol);
    if (now - _lastOrderAt < MIN_ORDER_INTERVAL_MS) return;

    const qty = quantityUsd / candidate.entryRef;
    if (qty <= 0) return;
    const roundedQty = parseFloat(qty.toFixed(3));
    if (roundedQty <= 0) return;

    const ctx: ScalpOrderContext = {
      candidateId: candidate.id,
      symbol: candidate.symbol,
      side: candidate.side,
      quantity: roundedQty, // rounded to reasonable precision
      submitPrice: candidate.entryRef,
      entryTtlMs: settings.entryTtlMs,
      maxRepriceCount: settings.maxRepriceCount,
      stopPrice: candidate.stopRef,
      takeProfitPrice: candidate.tpRef,
    };

    _lastOrderAt = now;
    // Acquire lock before async broker call to prevent duplicate orders from hot WS loop races.
    _symbolLock.set(candidate.symbol, candidate.id);
    telemetry.emit({ type: 'signal_emitted', candidate, ts: Date.now() });
    void submitEntry(ctx, false);
  }

  // ── onOrderUpdate ──────────────────────────────────────────────────────────

  function onOrderUpdate(update: ScalpOrderUpdate): void {
    if (_disposed) return;
    // ── Path A: entry order update ──────────────────────────────────────────
    const entryOrder = _orders.get(update.orderId);
    if (entryOrder) {
      entryOrder.lastUpdatedAt = update.ts;

      if (update.status === 'PARTIALLY_FILLED') {
        entryOrder.state = 'partially_filled';
        entryOrder.filledQty = update.executedQty;
        entryOrder.avgFillPrice = update.avgPrice;
        telemetry.emit({ type: 'partial_fill', orderId: update.orderId, filledQty: update.executedQty, price: update.avgPrice, ts: update.ts });

      } else if (update.status === 'FILLED') {
        const recovered = !!entryOrder.filledRecoveredByPositionCheck;
        entryOrder.state = 'filled';
        if (update.executedQty > 0) entryOrder.filledQty = update.executedQty;
        if (update.avgPrice > 0) entryOrder.avgFillPrice = update.avgPrice;
        entryOrder.positionAbsentSince = undefined;
        _symbolLock.set(entryOrder.ctx.symbol, entryOrder.ctx.candidateId);
        if (!entryOrder.exposureBooked) {
          risk.updateExposure(entryOrder.avgFillPrice * entryOrder.filledQty);
          entryOrder.exposureBooked = true;
        }
        telemetry.emit({ type: 'full_fill', orderId: update.orderId, qty: update.executedQty, price: update.avgPrice, ts: update.ts });
        if (!recovered) {
          onLog(`[${entryOrder.ctx.symbol}] 체결 완료 — ${entryOrder.filledQty} @ ${entryOrder.avgFillPrice.toFixed(4)}`, 'info');
        }
        // Notify trade-history integration (planned TP/SL adjusted for actual fill price)
        {
          const fillDelta = entryOrder.avgFillPrice > 0
            ? entryOrder.avgFillPrice - entryOrder.ctx.submitPrice
            : 0;
          callbacks?.onPositionOpen?.(
            entryOrder.ctx.symbol,
            entryOrder.ctx.side === 'long' ? 'LONG' : 'SHORT',
            entryOrder.ctx.takeProfitPrice + fillDelta,
            entryOrder.ctx.stopPrice      + fillDelta,
          );
        }
        if (!entryOrder.tpslAttachStarted) {
          entryOrder.tpslAttachStarted = true;
          void attachTpSl(entryOrder);
        }

      } else if (update.status === 'CANCELED' || update.status === 'REJECTED' || update.status === 'EXPIRED') {
        // Handle partial fill on cancel: proceed with filled qty if > 0
        if (entryOrder.filledQty > 0) {
          entryOrder.state = 'partially_filled';
          entryOrder.positionAbsentSince = undefined;
          onLog(`[${entryOrder.ctx.symbol}] 부분 체결 후 취소 — 체결된 ${entryOrder.filledQty} 기준 TP/SL 부착`, 'warn');
          _symbolLock.set(entryOrder.ctx.symbol, entryOrder.ctx.candidateId);
          if (!entryOrder.exposureBooked) {
            risk.updateExposure(entryOrder.avgFillPrice * entryOrder.filledQty);
            entryOrder.exposureBooked = true;
          }
          if (!entryOrder.tpslAttachStarted) {
            entryOrder.tpslAttachStarted = true;
            void attachTpSl(entryOrder);
          }
        } else {
          const newState: ScalpOrderState = update.status === 'REJECTED' ? 'rejected' : 'canceled';
          setState(update.orderId, newState);
          if (update.status === 'REJECTED') {
            _symbolLock.delete(entryOrder.ctx.symbol);
            entryOrder.positionAbsentSince = undefined;
          } else {
            // Keep lock briefly for late-fill race window; released in tick() once no live position is confirmed.
            entryOrder.positionAbsentSince = Date.now();
          }
          telemetry.emit({ type: 'order_canceled', orderId: update.orderId, reason: update.status, ts: update.ts });
          onLog(`[${entryOrder.ctx.symbol}] 주문 ${update.status}`, 'warn');
        }
      }
      return;
    }

    // ── Path B: TP order update ─────────────────────────────────────────────
    const tpEntryId = _tpIndex.get(update.orderId);
    if (tpEntryId) {
      if (update.status === 'FILLED') {
        handleExitFill(tpEntryId, update, 'tp');
      } else if (update.status === 'CANCELED' || update.status === 'REJECTED' || update.status === 'EXPIRED') {
        _tpIndex.delete(update.orderId);
        const parent = _orders.get(tpEntryId);
        if (parent) parent.tpOrderId = undefined;
      }
      return;
    }

    // ── Path C: SL order update ─────────────────────────────────────────────
    const slEntryId = _slIndex.get(update.orderId);
    if (slEntryId) {
      if (update.status === 'FILLED') {
        handleExitFill(slEntryId, update, 'sl');
      } else if (update.status === 'CANCELED' || update.status === 'REJECTED' || update.status === 'EXPIRED') {
        _slIndex.delete(update.orderId);
        const parent = _orders.get(slEntryId);
        if (parent) parent.slOrderId = undefined;
      }
    }
  }

  // ── tick ───────────────────────────────────────────────────────────────────

  function tick(): void {
    if (_disposed) return;
    const now = Date.now();
    for (const [, order] of _orders) {
      if (order.state !== 'open' && order.state !== 'partially_filled') continue;
      if (tryRecoverMissedFill(order)) continue;
      const elapsed = now - order.submittedAt;
      if (elapsed < order.ctx.entryTtlMs) continue;

      // TTL exceeded
      if (order.repriceCount < order.ctx.maxRepriceCount) {
        // Reprice to current live best bid/ask (maker-biased)
        const snap = getSnapshot(order.ctx.symbol);
        const newPrice = snap
          ? (order.ctx.side === 'long'
              ? snap.bid   // join best bid queue
              : snap.ask)  // join best ask queue
          : order.ctx.submitPrice; // fallback: hold previous price
        void reprice(order, newPrice);
      } else {
        // All reprices exhausted
        setState(order.orderId, 'timed_out');
        order.positionAbsentSince = now;
        broker.cancelOrder(order.orderId, order.ctx.symbol).catch(() => {});
        telemetry.emit({ type: 'timeout_exit', orderId: order.orderId, ts: now });
        onLog(`[${order.ctx.symbol}] 진입 타임아웃 — 주문 취소`, 'warn');
      }
    }

    // Late fill reconciliation: some fills can arrive after timeout/cancel path
    // when user-stream/polling is delayed. Keep a short recovery window.
    for (const [, order] of _orders) {
      if (order.state !== 'timed_out' && order.state !== 'canceled') continue;
      if (order.filledQty > 0) continue;
      if (now - order.lastUpdatedAt > LATE_FILL_RECOVERY_WINDOW_MS) continue;
      if (tryRecoverMissedFill(order)) {
        onLog(`[${order.ctx.symbol}] 타임아웃 이후 체결 복구 감지 — 보호주문 재부착`, 'warn');
        continue;
      }
      if (!broker.getOpenPosition) {
        _symbolLock.delete(order.ctx.symbol);
        continue;
      }
      const pos = broker.getOpenPosition(order.ctx.symbol, order.ctx.side);
      if (pos && Number.isFinite(pos.qty) && pos.qty > 0) {
        order.positionAbsentSince = undefined;
        continue;
      }
      if (!order.positionAbsentSince) {
        order.positionAbsentSince = now;
        continue;
      }
      if (now - order.positionAbsentSince >= LOCK_RELEASE_GRACE_MS) {
        const hasAnotherActive = Array.from(_orders.values()).some(o =>
          o.orderId !== order.orderId &&
          o.ctx.symbol === order.ctx.symbol &&
          (
            o.state === 'open' ||
            o.state === 'partially_filled' ||
            (o.state === 'filled' && o.filledQty > 0)
          )
        );
        if (!hasAnotherActive) {
          _symbolLock.delete(order.ctx.symbol);
        }
        order.positionAbsentSince = undefined;
      }
    }

    // Protection watchdog: if a filled scalp position has missing TP/SL, retry attach periodically.
    for (const [, order] of _orders) {
      if (order.state !== 'filled' && order.state !== 'partially_filled') continue;
      if (order.filledQty <= 0) continue;
      // Live position reconciliation:
      // if position disappears without TP/SL fill event, release symbol lock/exposure and cleanup stale protection orders.
      if (broker.getOpenPosition) {
        const livePos = broker.getOpenPosition(order.ctx.symbol, order.ctx.side);
        if (livePos && Number.isFinite(livePos.qty) && livePos.qty > 0) {
          order.positionAbsentSince = undefined;
          const diffQty = Math.abs(livePos.qty - order.filledQty);
          if (diffQty > 1e-9) {
            if (order.exposureBooked && order.avgFillPrice > 0) {
              const deltaQty = livePos.qty - order.filledQty;
              risk.updateExposure(order.avgFillPrice * deltaQty);
            }
            order.filledQty = livePos.qty;
            if (livePos.entryPrice && livePos.entryPrice > 0) order.avgFillPrice = livePos.entryPrice;
          }
        } else {
          if (!order.positionAbsentSince) {
            order.positionAbsentSince = now;
          } else if (now - order.positionAbsentSince >= POSITION_CLOSE_CONFIRM_MS) {
            const sym = order.ctx.symbol;
            if (order.tpOrderId) {
              cancelSibling(order.tpOrderId, sym, 'TP');
              order.tpOrderId = undefined;
            }
            if (order.slOrderId) {
              cancelSibling(order.slOrderId, sym, 'SL');
              order.slOrderId = undefined;
            }
            if (order.exposureBooked && order.avgFillPrice > 0 && order.filledQty > 0) {
              risk.updateExposure(-(order.avgFillPrice * order.filledQty));
              risk.recordExit(sym, 0, getSettings().symbolCooldownMs);
              order.exposureBooked = false;
            }
            _symbolLock.delete(sym);
            order.filledQty = 0;
            order.positionAbsentSince = undefined;
            setState(order.orderId, 'filled');
            onLog(`[${sym}] 포지션 종료 감지(스냅샷) — 보호주문/락 정리`, 'warn');
            continue;
          }
        }
      }
      if (order.tpOrderId && order.slOrderId) continue;
      if (order.tpslAttachInFlight) continue;
      const last = order.lastProtectionAttemptAt ?? 0;
      if (now - last < PROTECTION_RETRY_INTERVAL_MS) continue;
      onLog(
        `[${order.ctx.symbol}] 보호주문 복구 시도 #${(order.protectionRetryCount ?? 0) + 1} (TP:${order.tpOrderId ? 'ok' : 'missing'} SL:${order.slOrderId ? 'ok' : 'missing'})`,
        'warn',
      );
      void attachTpSl(order);
    }

    // Prune terminal entry orders older than 10 min; clean up sibling indices
    for (const [id, order] of _orders) {
      const terminal: ScalpOrderState[] = ['filled', 'canceled', 'rejected', 'timed_out'];
      const keepForProtection = order.state === 'filled' && order.filledQty > 0;
      if (keepForProtection) continue;
      if (terminal.includes(order.state) && now - order.lastUpdatedAt > 600_000) {
        if (order.tpOrderId) _tpIndex.delete(order.tpOrderId);
        if (order.slOrderId) _slIndex.delete(order.slOrderId);
        _orders.delete(id);
      }
    }
  }

  // ── cancelAll ─────────────────────────────────────────────────────────────

  function cancelAll(): void {
    _disposed = true;
    const now = Date.now();
    for (const [, order] of _orders) {
      if (order.state === 'open' || order.state === 'partially_filled') {
        broker.cancelOrder(order.orderId, order.ctx.symbol).catch(() => {});
        setState(order.orderId, 'canceled');
        telemetry.emit({ type: 'order_canceled', orderId: order.orderId, reason: 'session_stop', ts: now });
      }
      // Cancel attached TP/SL for filled (open position) entries
      if (order.tpOrderId && !_siblingCancelInFlight.has(order.tpOrderId)) {
        broker.cancelOrder(order.tpOrderId, order.ctx.symbol).catch(() => {});
      }
      if (order.slOrderId && !_siblingCancelInFlight.has(order.slOrderId)) {
        broker.cancelOrder(order.slOrderId, order.ctx.symbol).catch(() => {});
      }
    }
    _orders.clear();
    _symbolLock.clear();
    _errorCooldownUntil.clear();
    _lastOrderAt = 0;
    _tpIndex.clear();
    _slIndex.clear();
    _siblingCancelInFlight.clear();
    _protectionCleanupCancelInFlight.clear();
    _protectionGuardLogUntil.clear();
  }

  return { onSignal, onOrderUpdate, getActiveOrders: () => [..._orders.values()], tick, cancelAll };
}
