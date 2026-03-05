export interface PaperPosition {
  id: string;
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  positionAmt: number;        // positive=LONG, negative=SHORT
  entryPrice: number;
  entryTime: number;
  leverage: number;
  marginType: 'isolated' | 'cross';
  isolatedMargin: number;     // entryPrice * |qty| / leverage (locked margin)
  entryFee: number;           // taker fee paid at entry (already deducted from balance)
  tpPrice?: number;
  slPrice?: number;
}

export interface PaperOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  limitPrice: number;
  leverage: number;
  marginType: 'isolated' | 'cross';
  reduceOnly: boolean;
  placedAt: number;
}

export interface PaperHistoryEntry {
  id: string;
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  qty: number;
  leverage: number;
  pnl: number;                // realized P&L net of entry+exit fees
  fees: number;               // total taker fees (entry + exit)
  entryTime: number;
  exitTime: number;
  closeReason: 'manual' | 'tp' | 'sl' | 'liq';
}

export interface PaperState {
  balance: number;            // available USDT (not locked in open positions)
  initialBalance: number;
  positions: PaperPosition[];
  orders: PaperOrder[];       // pending limit orders
  history: PaperHistoryEntry[];
}
