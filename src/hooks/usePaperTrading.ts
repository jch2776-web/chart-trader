import { useState, useEffect, useCallback, useRef } from 'react';
import type { FuturesPosition } from '../types/futures';
import type { PaperPosition, PaperOrder, PaperHistoryEntry, PaperState, AltMeta } from '../types/paperTrading';

const DEFAULT_BALANCE = 10000;
const FEE_RATE = 0.0004; // Binance Futures taker fee 0.04%

const DEFAULT_STATE: PaperState = {
  balance: DEFAULT_BALANCE,
  initialBalance: DEFAULT_BALANCE,
  positions: [],
  orders: [],
  history: [],
};

function load(key: string): PaperState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PaperState;
    // Migrate old state without orders field
    if (!parsed.orders) parsed.orders = [];
    // Migrate old orders without triggerType
    parsed.orders = parsed.orders.map(o => (o.triggerType ? o : { ...o, triggerType: 'limit' as const }));
    return parsed;
  } catch {
    return null;
  }
}

function save(key: string, state: PaperState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {}
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function liqPrice(entryPrice: number, leverage: number, side: 'LONG' | 'SHORT'): number {
  return side === 'LONG'
    ? entryPrice * (1 - 1 / leverage)
    : entryPrice * (1 + 1 / leverage);
}

function isAltOrigin(meta?: AltMeta): boolean {
  return meta?.source === 'altscanner';
}

function isDirectionalTPValid(side: 'LONG' | 'SHORT', entry: number, tp?: number): boolean {
  if (tp == null) return true;
  return side === 'LONG' ? tp > entry : tp < entry;
}

function isDirectionalSLValid(side: 'LONG' | 'SHORT', entry: number, sl?: number): boolean {
  if (sl == null) return true;
  return side === 'LONG' ? sl < entry : sl > entry;
}

export function usePaperTrading(storageKey: string, onAutoClose?: (reason: 'tp' | 'sl' | 'liq') => void) {
  const [state, setState] = useState<PaperState>(() => load(storageKey) ?? { ...DEFAULT_STATE });

  useEffect(() => {
    save(storageKey, state);
  }, [state, storageKey]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const onAutoCloseRef = useRef(onAutoClose);
  onAutoCloseRef.current = onAutoClose;

  const openPosition = useCallback((
    symbol: string,
    side: 'LONG' | 'SHORT',
    qty: number,
    price: number,
    leverage: number,
    marginType: 'isolated' | 'cross',
    tpPrice?: number,
    slPrice?: number,
    altMeta?: AltMeta,
  ) => {
    const margin = (price * qty) / leverage;
    const entryFee = parseFloat((price * qty * FEE_RATE).toFixed(8));
    setState(prev => {
      if (prev.balance < margin) return prev; // not enough even for margin
      if (isAltOrigin(altMeta)) {
        const tpOk = isDirectionalTPValid(side, price, tpPrice);
        const slOk = isDirectionalSLValid(side, price, slPrice);
        if (!tpOk || !slOk) {
          console.info(
            `[ALT모의] 오픈 거부(${symbol} ${side}) - TP/SL 불변식 위반: entry=${price} tp=${tpPrice ?? '—'} sl=${slPrice ?? '—'}`,
          );
          return prev;
        }
      }
      // Cap fee to remaining balance so rounding/price-improvement never silently blocks the order
      const actualFee = Math.min(entryFee, parseFloat((prev.balance - margin).toFixed(8)));
      const actualCost = parseFloat((margin + actualFee).toFixed(8));

      // If same symbol + same side already open → average into existing position (물타기)
      // Exception: altMeta positions must never be water-averaged — each alt entry is independent.
      // If either the existing position or the incoming fill has altMeta, reject the fill silently.
      const existing = prev.positions.find(p => p.symbol === symbol && p.positionSide === side);
      if (existing && (existing.altMeta || altMeta)) return prev; // block water-avg for alt positions
      if (existing) {
        const existingQty = Math.abs(existing.positionAmt);
        const newTotalQty = existingQty + qty;
        const avgEntryPrice = parseFloat(
          ((existingQty * existing.entryPrice + qty * price) / newTotalQty).toFixed(8)
        );
        return {
          ...prev,
          balance: parseFloat((prev.balance - actualCost).toFixed(8)),
          positions: prev.positions.map(p => p.id !== existing.id ? p : {
            ...p,
            positionAmt: parseFloat((side === 'LONG' ? newTotalQty : -newTotalQty).toFixed(8)),
            entryPrice: avgEntryPrice,
            isolatedMargin: parseFloat((existing.isolatedMargin + margin).toFixed(8)),
            entryFee: parseFloat((existing.entryFee + actualFee).toFixed(8)),
            // New call wins if provided; otherwise keep existing value
            tpPrice: tpPrice ?? existing.tpPrice,
            slPrice: slPrice ?? existing.slPrice,
            altMeta: altMeta ?? existing.altMeta,
          }),
        };
      }

      const pos: PaperPosition = {
        id: uid(),
        symbol,
        positionSide: side,
        positionAmt: side === 'LONG' ? qty : -qty,
        entryPrice: price,
        entryTime: Date.now(),
        leverage,
        marginType,
        isolatedMargin: margin,
        entryFee: actualFee,
        tpPrice,
        slPrice,
        altMeta,
      };
      return {
        ...prev,
        balance: parseFloat((prev.balance - actualCost).toFixed(8)),
        positions: [...prev.positions, pos],
      };
    });
  }, []);

  const closePosition = useCallback((
    id: string,
    closePrice: number,
    reason: PaperHistoryEntry['closeReason'],
  ) => {
    setState(prev => {
      const pos = prev.positions.find(p => p.id === id);
      if (!pos) return prev;
      const qty = Math.abs(pos.positionAmt);
      const isLong = pos.positionSide === 'LONG';
      const rawPnl = (isLong ? closePrice - pos.entryPrice : pos.entryPrice - closePrice) * qty;
      const exitFee = parseFloat((closePrice * qty * FEE_RATE).toFixed(8));
      const netPnl = rawPnl - pos.entryFee - exitFee;
      const returned = pos.isolatedMargin + netPnl;
      const entry: PaperHistoryEntry = {
        id: uid(),
        symbol: pos.symbol,
        positionSide: pos.positionSide,
        entryPrice: pos.entryPrice,
        exitPrice: closePrice,
        qty,
        leverage: pos.leverage,
        pnl: parseFloat(netPnl.toFixed(8)),
        fees: parseFloat((pos.entryFee + exitFee).toFixed(8)),
        entryTime: pos.entryTime,
        exitTime: Date.now(),
        closeReason: reason,
        interval: pos.altMeta?.scanInterval,
        isAltTrade: pos.altMeta ? true : undefined,
        candidateScore: pos.altMeta?.candidateScore ?? null,
        plannedEntry: pos.altMeta?.plannedEntry ?? null,
        plannedTP: pos.altMeta?.plannedTP ?? null,
        plannedSL: pos.altMeta?.plannedSL ?? null,
        entrySource: pos.altMeta?.entrySource,
      };
      return {
        ...prev,
        balance: parseFloat((prev.balance + Math.max(0, returned)).toFixed(8)),
        positions: prev.positions.filter(p => p.id !== id),
        history: [entry, ...prev.history].slice(0, 500),
      };
    });
  }, []);

  // Partial close — closes `closeQty` units (full close if closeQty >= position size)
  const partialClosePosition = useCallback((
    id: string,
    closePrice: number,
    reason: PaperHistoryEntry['closeReason'],
    closeQty: number,
  ) => {
    setState(prev => {
      const pos = prev.positions.find(p => p.id === id);
      if (!pos) return prev;
      const totalQty = Math.abs(pos.positionAmt);
      const qty = Math.min(Math.max(closeQty, 0), totalQty);
      if (qty <= 0) return prev;
      const isLong = pos.positionSide === 'LONG';
      const qtyRatio = qty / totalQty;
      const partialMargin = pos.isolatedMargin * qtyRatio;
      const partialEntryFee = pos.entryFee * qtyRatio;
      const rawPnl = (isLong ? closePrice - pos.entryPrice : pos.entryPrice - closePrice) * qty;
      const exitFee = parseFloat((closePrice * qty * FEE_RATE).toFixed(8));
      const netPnl = rawPnl - partialEntryFee - exitFee;
      const returned = partialMargin + netPnl;
      const entry: PaperHistoryEntry = {
        id: uid(),
        symbol: pos.symbol,
        positionSide: pos.positionSide,
        entryPrice: pos.entryPrice,
        exitPrice: closePrice,
        qty,
        leverage: pos.leverage,
        pnl: parseFloat(netPnl.toFixed(8)),
        fees: parseFloat((partialEntryFee + exitFee).toFixed(8)),
        entryTime: pos.entryTime,
        exitTime: Date.now(),
        closeReason: reason,
        interval: pos.altMeta?.scanInterval,
        isAltTrade: pos.altMeta ? true : undefined,
        candidateScore: pos.altMeta?.candidateScore ?? null,
        plannedEntry: pos.altMeta?.plannedEntry ?? null,
        plannedTP: pos.altMeta?.plannedTP ?? null,
        plannedSL: pos.altMeta?.plannedSL ?? null,
        entrySource: pos.altMeta?.entrySource,
      };
      const isFull = qty >= totalQty;
      return {
        ...prev,
        balance: parseFloat((prev.balance + Math.max(0, returned)).toFixed(8)),
        positions: isFull
          ? prev.positions.filter(p => p.id !== id)
          : prev.positions.map(p => p.id !== id ? p : {
              ...p,
              positionAmt: parseFloat((isLong ? totalQty - qty : -(totalQty - qty)).toFixed(8)),
              isolatedMargin: parseFloat((pos.isolatedMargin - partialMargin).toFixed(8)),
              entryFee: parseFloat((pos.entryFee - partialEntryFee).toFixed(8)),
            }),
        history: [entry, ...prev.history].slice(0, 500),
      };
    });
  }, []);

  const setTPSL = useCallback((id: string, tpPrice?: number, slPrice?: number) => {
    setState(prev => ({
      ...prev,
      positions: prev.positions.map(p =>
        p.id === id
          ? (() => {
              if (!isAltOrigin(p.altMeta)) return { ...p, tpPrice, slPrice };
              const tpOk = isDirectionalTPValid(p.positionSide, p.entryPrice, tpPrice);
              const slOk = isDirectionalSLValid(p.positionSide, p.entryPrice, slPrice);
              if (tpOk && slOk) return { ...p, tpPrice, slPrice };
              const nextTp = tpOk ? tpPrice : p.tpPrice;
              const nextSl = slOk ? slPrice : p.slPrice;
              console.info(
                `[ALT모의] 포지션 TP/SL 보정(${p.symbol} ${p.positionSide}) - 기존 TP:${p.tpPrice ?? '—'} SL:${p.slPrice ?? '—'} / 입력 TP:${tpPrice ?? '—'} SL:${slPrice ?? '—'} / 유지 TP:${nextTp ?? '—'} SL:${nextSl ?? '—'}`,
              );
              return { ...p, tpPrice: nextTp, slPrice: nextSl };
            })()
          : p,
      ),
    }));
  }, []);

  const updateAltMeta = useCallback((id: string, patch: Partial<AltMeta>) => {
    setState(prev => ({
      ...prev,
      positions: prev.positions.map(p => {
        if (p.id !== id || !p.altMeta) return p;
        return { ...p, altMeta: { ...p.altMeta, ...patch } };
      }),
    }));
  }, []);

  // Place a limit order (queued — executed when price reaches limitPrice).
  // Returns true if the order was accepted, false if rejected (e.g. duplicate altMeta guard).
  const placeLimitOrder = useCallback((
    symbol: string,
    side: 'BUY' | 'SELL',
    qty: number,
    limitPrice: number,
    leverage: number,
    marginType: 'isolated' | 'cross',
    reduceOnly: boolean,
    tpPrice?: number,
    slPrice?: number,
    altMeta?: AltMeta,
    triggerType: PaperOrder['triggerType'] = 'limit',
  ): boolean => {
    if (isAltOrigin(altMeta)) {
      const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
      const tpOk = isDirectionalTPValid(posSide, limitPrice, tpPrice);
      const slOk = isDirectionalSLValid(posSide, limitPrice, slPrice);
      if (!tpOk || !slOk) {
        console.info(
          `[ALT모의] 예약주문 거부(${symbol} ${posSide}) - TP/SL 불변식 위반: entry=${limitPrice} tp=${tpPrice ?? '—'} sl=${slPrice ?? '—'}`,
        );
        return false;
      }
    }
    // Pre-check with stateRef (latest rendered state) for a fast synchronous return value.
    if (altMeta) {
      const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
      const dupOrder = stateRef.current.orders.find(o => o.symbol === symbol && o.side === side && o.altMeta);
      const dupPos   = stateRef.current.positions.find(p => p.symbol === symbol && p.positionSide === posSide && p.altMeta);
      if (dupOrder || dupPos) return false;
    }
    const order: PaperOrder = {
      id: uid(), symbol, side, qty, limitPrice, triggerType, leverage, marginType, reduceOnly,
      placedAt: Date.now(), tpPrice, slPrice, altMeta,
    };
    setState(prev => {
      // Secondary guard inside setState (covers rapid concurrent calls within same render cycle).
      if (altMeta) {
        const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
        const dupOrder = prev.orders.find(o => o.symbol === symbol && o.side === side && o.altMeta);
        const dupPos   = prev.positions.find(p => p.symbol === symbol && p.positionSide === posSide && p.altMeta);
        if (dupOrder || dupPos) return prev;
      }
      return { ...prev, orders: [...prev.orders, order] };
    });
    return true;
  }, []);

  const cancelOrder = useCallback((id: string) => {
    setState(prev => ({ ...prev, orders: prev.orders.filter(o => o.id !== id) }));
  }, []);

  // Called on each WS price tick
  const checkPricesRef = useRef<(markPrices: Record<string, number>) => void>(() => {});
  checkPricesRef.current = (markPrices: Record<string, number>) => {
    const { positions, orders } = stateRef.current;

    // Check TP/SL/liquidation for open positions
    for (const pos of positions) {
      const mark = markPrices[pos.symbol];
      if (mark === undefined || mark <= 0) continue; // skip invalid/zero prices
      const isLong = pos.positionSide === 'LONG';
      const liq = liqPrice(pos.entryPrice, pos.leverage, pos.positionSide);

      if (isLong ? mark <= liq : mark >= liq) {
        closePosition(pos.id, liq, 'liq');
        onAutoCloseRef.current?.('liq');
      } else if (pos.slPrice !== undefined && (isLong ? mark <= pos.slPrice : mark >= pos.slPrice)) {
        closePosition(pos.id, pos.slPrice, 'sl');
        onAutoCloseRef.current?.('sl');
      } else if (pos.tpPrice !== undefined && (isLong ? mark >= pos.tpPrice : mark <= pos.tpPrice)) {
        closePosition(pos.id, pos.tpPrice, 'tp');
        onAutoCloseRef.current?.('tp');
      }
    }

    // Check pending limit orders (only intrabar 'limit' type; candle-close orders handled in checkCandleClose)
    const triggeredIds: string[] = [];
    for (const order of orders) {
      if (order.triggerType !== 'limit') continue;
      const mark = markPrices[order.symbol];
      if (mark === undefined || mark <= 0) continue; // skip invalid/zero prices
      // BUY limit: trigger when price drops to or below limitPrice
      // SELL limit: trigger when price rises to or above limitPrice
      const triggered = order.side === 'BUY'
        ? mark <= order.limitPrice
        : mark >= order.limitPrice;
      if (!triggered) continue;
      // Safety guard: reject fill prices that are wildly out of range of the limit price.
      // Ratio >100× or <0.01× indicates a corrupted price (e.g. BTC price written to an alt key).
      const ratio = mark / order.limitPrice;
      if (ratio > 100 || ratio < 0.01) continue;
      triggeredIds.push(order.id);
      // Fill at the current mark price (price improvement over limitPrice)
      const fillPrice = order.side === 'BUY'
        ? Math.min(mark, order.limitPrice)
        : Math.max(mark, order.limitPrice);
      if (order.reduceOnly) {
        const posSide = order.side === 'BUY' ? 'SHORT' : 'LONG';
        const pos = stateRef.current.positions.find(
          p => p.symbol === order.symbol && p.positionSide === posSide,
        );
        if (pos) partialClosePosition(pos.id, fillPrice, 'manual', order.qty);
      } else {
        // Recalculate qty based on actual fill price to maintain original target margin.
        // targetMargin = order.qty * order.limitPrice / order.leverage
        const targetMargin = (order.qty * order.limitPrice) / order.leverage;
        const actualQty = parseFloat(((targetMargin * order.leverage) / fillPrice).toFixed(6));
        const posSide = order.side === 'BUY' ? 'LONG' : 'SHORT';
        let tpForOpen = order.tpPrice;
        let slForOpen = order.slPrice;
        if (isAltOrigin(order.altMeta)) {
          const tpOk = isDirectionalTPValid(posSide, fillPrice, tpForOpen);
          const slOk = isDirectionalSLValid(posSide, fillPrice, slForOpen);
          if (!tpOk || !slOk) {
            const nextTp = tpOk ? tpForOpen : undefined;
            const nextSl = slOk ? slForOpen : undefined;
            console.info(
              `[ALT모의] 체결 시 TP/SL 재검증(${order.symbol} ${posSide}) - 기존 TP:${tpForOpen ?? '—'} SL:${slForOpen ?? '—'} / 보정 TP:${nextTp ?? '—'} SL:${nextSl ?? '—'} / fill:${fillPrice}`,
            );
            tpForOpen = nextTp;
            slForOpen = nextSl;
            if (tpForOpen == null && slForOpen == null && (order.tpPrice != null || order.slPrice != null)) {
              console.info(
                `[ALT모의] 체결 취소(${order.symbol} ${posSide}) - fill 기준 유효 TP/SL 부재: fill=${fillPrice} tp=${order.tpPrice ?? '—'} sl=${order.slPrice ?? '—'}`,
              );
              continue;
            }
          }
        }
        openPosition(order.symbol, order.side === 'BUY' ? 'LONG' : 'SHORT',
          actualQty, fillPrice, order.leverage, order.marginType,
          tpForOpen, slForOpen, order.altMeta);
      }
    }
    if (triggeredIds.length > 0) {
      setState(prev => ({ ...prev, orders: prev.orders.filter(o => !triggeredIds.includes(o.id)) }));
    }
  };

  const checkPrices = useCallback((markPrices: Record<string, number>) => {
    checkPricesRef.current(markPrices);
  }, []);

  // Called when a candle closes — checks close_above / close_below orders
  const checkCandleCloseRef = useRef<(closedPrices: Record<string, number>) => void>(() => {});
  checkCandleCloseRef.current = (closedPrices: Record<string, number>) => {
    const { orders } = stateRef.current;
    const triggeredIds: string[] = [];
    for (const order of orders) {
      if (order.triggerType === 'limit') continue;
      const closePrice = closedPrices[order.symbol];
      if (closePrice === undefined || closePrice <= 0) continue;
      const triggered =
        (order.triggerType === 'close_above' && closePrice >= order.limitPrice) ||
        (order.triggerType === 'close_below' && closePrice <= order.limitPrice);
      if (!triggered) continue;
      triggeredIds.push(order.id);
      // Recalculate qty so that margin stays at the original intended amount even
      // when the actual close price overshoots the trigger level.
      // targetMargin = order.qty * order.limitPrice / order.leverage  (what qty was based on)
      // actualQty    = targetMargin * order.leverage / closePrice
      const targetMargin = (order.qty * order.limitPrice) / order.leverage;
      const actualQty = parseFloat(((targetMargin * order.leverage) / closePrice).toFixed(6));
      const posSide = order.side === 'BUY' ? 'LONG' : 'SHORT';
      let tpForOpen = order.tpPrice;
      let slForOpen = order.slPrice;
      if (isAltOrigin(order.altMeta)) {
        const tpOk = isDirectionalTPValid(posSide, closePrice, tpForOpen);
        const slOk = isDirectionalSLValid(posSide, closePrice, slForOpen);
        if (!tpOk || !slOk) {
          const nextTp = tpOk ? tpForOpen : undefined;
          const nextSl = slOk ? slForOpen : undefined;
          console.info(
            `[ALT모의] 봉마감 체결 재검증(${order.symbol} ${posSide}) - 기존 TP:${tpForOpen ?? '—'} SL:${slForOpen ?? '—'} / 보정 TP:${nextTp ?? '—'} SL:${nextSl ?? '—'} / fill:${closePrice}`,
          );
          tpForOpen = nextTp;
          slForOpen = nextSl;
          if (tpForOpen == null && slForOpen == null && (order.tpPrice != null || order.slPrice != null)) {
            console.info(
              `[ALT모의] 봉마감 체결 취소(${order.symbol} ${posSide}) - fill 기준 유효 TP/SL 부재: fill=${closePrice} tp=${order.tpPrice ?? '—'} sl=${order.slPrice ?? '—'}`,
            );
            continue;
          }
        }
      }
      openPosition(
        order.symbol, order.side === 'BUY' ? 'LONG' : 'SHORT',
        actualQty, closePrice, order.leverage, order.marginType,
        tpForOpen, slForOpen, order.altMeta,
      );
    }
    if (triggeredIds.length > 0) {
      setState(prev => ({ ...prev, orders: prev.orders.filter(o => !triggeredIds.includes(o.id)) }));
    }
  };

  const checkCandleClose = useCallback((closedPrices: Record<string, number>) => {
    checkCandleCloseRef.current(closedPrices);
  }, []);

  const updateOrder = useCallback((id: string, updates: Partial<Pick<PaperOrder, 'limitPrice' | 'tpPrice' | 'slPrice'>>) => {
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => {
        if (o.id !== id) return o;
        const candidate = { ...o, ...updates };
        if (!isAltOrigin(o.altMeta)) return candidate;
        const side = candidate.side === 'BUY' ? 'LONG' : 'SHORT';
        const tpOk = isDirectionalTPValid(side, candidate.limitPrice, candidate.tpPrice);
        const slOk = isDirectionalSLValid(side, candidate.limitPrice, candidate.slPrice);
        if (tpOk && slOk) return candidate;
        const preserved = {
          ...candidate,
          tpPrice: tpOk ? candidate.tpPrice : o.tpPrice,
          slPrice: slOk ? candidate.slPrice : o.slPrice,
        };
        const preservedOk = isDirectionalTPValid(side, preserved.limitPrice, preserved.tpPrice)
          && isDirectionalSLValid(side, preserved.limitPrice, preserved.slPrice);
        if (!preservedOk) {
          console.info(
            `[ALT모의] 예약주문 업데이트 거부(${candidate.symbol} ${side}) - 유효 TP/SL 부재: 기존 TP:${o.tpPrice ?? '—'} SL:${o.slPrice ?? '—'} / 입력 TP:${candidate.tpPrice ?? '—'} SL:${candidate.slPrice ?? '—'} / entry:${preserved.limitPrice}`,
          );
          return o;
        }
        console.info(
          `[ALT모의] 예약주문 TP/SL 보정(${candidate.symbol} ${side}) - 기존 TP:${o.tpPrice ?? '—'} SL:${o.slPrice ?? '—'} / 입력 TP:${candidate.tpPrice ?? '—'} SL:${candidate.slPrice ?? '—'} / 유지 TP:${preserved.tpPrice ?? '—'} SL:${preserved.slPrice ?? '—'}`,
        );
        return preserved;
      }),
    }));
  }, []);

  const toFuturesPositions = useCallback((markPrices: Record<string, number>): FuturesPosition[] => {
    return stateRef.current.positions.map(pos => {
      const mark = markPrices[pos.symbol] ?? pos.entryPrice;
      const qty = Math.abs(pos.positionAmt);
      const isLong = pos.positionSide === 'LONG';
      const unrealizedProfit = (isLong ? mark - pos.entryPrice : pos.entryPrice - mark) * qty;
      const liq = liqPrice(pos.entryPrice, pos.leverage, pos.positionSide);
      return {
        symbol: pos.symbol,
        positionSide: pos.positionSide,
        positionAmt: pos.positionAmt,
        entryPrice: pos.entryPrice,
        markPrice: mark,
        unrealizedProfit: parseFloat(unrealizedProfit.toFixed(8)),
        leverage: pos.leverage,
        liquidationPrice: parseFloat(liq.toFixed(8)),
        marginType: pos.marginType,
        updateTime: pos.entryTime,
        entryTime: pos.entryTime,
      } satisfies FuturesPosition;
    });
  }, []);

  const resetBalance = useCallback((amount: number) => {
    setState(prev => ({ ...prev, balance: amount, initialBalance: amount }));
  }, []);

  const clearHistory = useCallback(() => {
    setState(prev => ({ ...prev, history: [] }));
  }, []);

  return {
    balance: state.balance,
    initialBalance: state.initialBalance,
    positions: state.positions,
    orders: state.orders,
    history: state.history,
    openPosition,
    closePosition,
    partialClosePosition,
    setTPSL,
    updateAltMeta,
    placeLimitOrder,
    cancelOrder,
    checkPrices,
    checkCandleClose,
    updateOrder,
    toFuturesPositions,
    resetBalance,
    clearHistory,
  };
}
