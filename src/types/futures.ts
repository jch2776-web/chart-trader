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

export interface FuturesOrder {
  symbol: string;
  orderId: string;
  side: 'BUY' | 'SELL';
  type: string;               // LIMIT, MARKET, STOP, STOP_MARKET, TAKE_PROFIT, TAKE_PROFIT_MARKET, etc.
  price: number;              // 0 for market/stop-market → use stopPrice
  origQty: number;
  stopPrice: number;
  status: string;
  algoType?: string;          // CONDITIONAL, OCO
  isAlgo?: boolean;           // true when sourced from /fapi/v1/openAlgoOrders
}
