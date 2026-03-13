import type { Interval } from './candle';

export interface FuturesPosition {
  symbol: string;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  positionAmt: number;        // positive = long, negative = short
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  leverage: number;
  liquidationPrice: number;
  marginType: 'isolated' | 'cross';
  updateTime?: number;        // ms epoch — Binance positionRisk last-update (not entry time)
  entryTime?: number;         // ms epoch — time of the actual opening trade (from userTrades)
}

export interface LiveHistoryEntry {
  tranId: string;
  symbol: string;
  income: number;   // realized PnL (USDT, can be negative)
  asset: string;    // "USDT"
  time: number;     // ms timestamp
  tradeId: string;
  info: string;
}

export type LiveCloseReason = 'time' | 'invalid' | 'manual' | 'tp' | 'sl' | 'unknown';

export interface LiveTradeHistoryEntry {
  id: string;
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  qty: number;
  leverage: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  pnl: number | null;
  fees: number | null;
  entryTime: number | null;
  exitTime: number;
  closeReason: LiveCloseReason;
  isAltTrade?: boolean;
  interval?: Interval;
  candidateScore?: number | null;
  plannedEntry?: number | null;
  plannedTP?: number | null;
  plannedSL?: number | null;
  entrySource?: 'manual' | 'auto';
  candidateId?: string;
  timeStopEnabledAtEntry?: boolean | null;
  validUntilTimeAtEntry?: number | null;
  scanCadenceMinutesAtEntry?: number | null;
}

export interface FuturesUserTrade {
  id: string;
  orderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  realizedPnl: number;
  time: number;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
}

export interface FuturesOrder {
  symbol: string;
  orderId: string;
  side: 'BUY' | 'SELL';
  type: string;               // LIMIT, MARKET, STOP, STOP_MARKET, TAKE_PROFIT, TAKE_PROFIT_MARKET, etc.
  price: number;              // 0 for market/stop-market → use stopPrice
  origQty: number;
  stopPrice: number;
  status: string;
  time?: number;              // ms epoch — order placement time
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  algoType?: string;          // CONDITIONAL, OCO
  isAlgo?: boolean;           // true when sourced from /fapi/v1/openAlgoOrders
}
