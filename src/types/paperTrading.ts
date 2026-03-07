import type { Drawing } from './drawing';

export interface AltMeta {
  source: 'altscanner';
  candidateId: string;
  symbol: string;
  direction: 'long' | 'short';
  scanInterval: string;
  validUntilTime: number;
  slPrice: number;            // invalidation threshold (used by AltPositionMonitor)
  drawingsSnapshot: Drawing[];
}

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
  altMeta?: AltMeta;          // present when opened from AltScanner
}

export interface PaperOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  limitPrice: number;
  /** 'limit': fire when mark touches limitPrice intrabar (default)
   *  'close_above': fire when candle CLOSES >= limitPrice (trendline LONG pending)
   *  'close_below': fire when candle CLOSES <= limitPrice (trendline SHORT pending) */
  triggerType: 'limit' | 'close_above' | 'close_below';
  leverage: number;
  marginType: 'isolated' | 'cross';
  reduceOnly: boolean;
  placedAt: number;
  tpPrice?: number;
  slPrice?: number;
  altMeta?: AltMeta;
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
