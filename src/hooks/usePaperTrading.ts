import { useState, useEffect, useCallback, useRef } from 'react';
import type { FuturesPosition } from '../types/futures';
import type { PaperPosition, PaperOrder, PaperHistoryEntry, PaperState } from '../types/paperTrading';

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

export function usePaperTrading(storageKey: string) {
  const [state, setState] = useState<PaperState>(() => load(storageKey) ?? { ...DEFAULT_STATE });

  useEffect(() => {
    save(storageKey, state);
  }, [state, storageKey]);

  const stateRef = useRef(state);
  stateRef.current = state;

  const openPosition = useCallback((
    symbol: string,
    side: 'LONG' | 'SHORT',
    qty: number,
    price: number,
    leverage: number,
    marginType: 'isolated' | 'cross',
  ) => {
    const margin = (price * qty) / leverage;
    const entryFee = parseFloat((price * qty * FEE_RATE).toFixed(8));
    setState(prev => {
      if (prev.balance < margin) return prev; // not enough even for margin
      // Cap fee to remaining balance so rounding/price-improvement never silently blocks the order
      const actualFee = Math.min(entryFee, parseFloat((prev.balance - margin).toFixed(8)));
      const actualCost = parseFloat((margin + actualFee).toFixed(8));
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
      };
      return {
        ...prev,
        balance: parseFloat((prev.balance + Math.max(0, returned)).toFixed(8)),
        positions: prev.positions.filter(p => p.id !== id),
        history: [entry, ...prev.history].slice(0, 500),
      };
    });
  }, []);

  const setTPSL = useCallback((id: string, tpPrice?: number, slPrice?: number) => {
    setState(prev => ({
      ...prev,
      positions: prev.positions.map(p =>
        p.id === id ? { ...p, tpPrice, slPrice } : p,
      ),
    }));
  }, []);

  // Place a limit order (queued — executed when price reaches limitPrice)
  const placeLimitOrder = useCallback((
    symbol: string,
    side: 'BUY' | 'SELL',
    qty: number,
    limitPrice: number,
    leverage: number,
    marginType: 'isolated' | 'cross',
    reduceOnly: boolean,
  ) => {
    const order: PaperOrder = {
      id: uid(), symbol, side, qty, limitPrice, leverage, marginType, reduceOnly,
      placedAt: Date.now(),
    };
    setState(prev => ({ ...prev, orders: [...prev.orders, order] }));
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
      } else if (pos.slPrice !== undefined && (isLong ? mark <= pos.slPrice : mark >= pos.slPrice)) {
        closePosition(pos.id, pos.slPrice, 'sl');
      } else if (pos.tpPrice !== undefined && (isLong ? mark >= pos.tpPrice : mark <= pos.tpPrice)) {
        closePosition(pos.id, pos.tpPrice, 'tp');
      }
    }

    // Check pending limit orders
    const triggeredIds: string[] = [];
    for (const order of orders) {
      const mark = markPrices[order.symbol];
      if (mark === undefined || mark <= 0) continue; // skip invalid/zero prices
      // BUY limit: trigger when price drops to or below limitPrice
      // SELL limit: trigger when price rises to or above limitPrice
      const triggered = order.side === 'BUY'
        ? mark <= order.limitPrice
        : mark >= order.limitPrice;
      if (!triggered) continue;
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
        if (pos) closePosition(pos.id, fillPrice, 'manual');
      } else {
        openPosition(order.symbol, order.side === 'BUY' ? 'LONG' : 'SHORT',
          order.qty, fillPrice, order.leverage, order.marginType);
      }
    }
    if (triggeredIds.length > 0) {
      setState(prev => ({ ...prev, orders: prev.orders.filter(o => !triggeredIds.includes(o.id)) }));
    }
  };

  const checkPrices = useCallback((markPrices: Record<string, number>) => {
    checkPricesRef.current(markPrices);
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
    setTPSL,
    placeLimitOrder,
    cancelOrder,
    checkPrices,
    toFuturesPositions,
    resetBalance,
    clearHistory,
  };
}
