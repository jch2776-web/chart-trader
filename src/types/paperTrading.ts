import type { Drawing } from './drawing';
import type { Interval } from './candle';

export interface AltMeta {
  source: 'altscanner';
  candidateId: string;
  symbol: string;
  direction: 'long' | 'short';
  candidateScore: number;
  plannedEntry: number;
  plannedTP: number | null;
  plannedSL: number | null;
  scanInterval: Interval;
  validUntilTime: number;
  signalCloseTime?: number;
  monitorStartTime?: number;
  slPrice: number;            // invalidation threshold (used by AltPositionMonitor)
  drawingsSnapshot: Drawing[];
  entrySource?: 'manual' | 'auto';
  timeStopEnabled?: boolean;
  timeStopEnabledAtEntry?: boolean | null;
  validUntilTimeAtEntry?: number | null;
  scanCadenceMinutesAtEntry?: number | null;
  // Live ALT entry provenance/enrichment (optional for backward compatibility)
  liveEntryOrderId?: string;
  liveEntrySubmittedAt?: number;
  liveEntryTime?: number;
  liveEntryFee?: number | null;
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
  closeReason: 'manual' | 'tp' | 'sl' | 'liq' | 'expired';
  interval?: string;          // timeframe of entry candle (e.g. '15m', '1h') — ALT추천 positions only
  isAltTrade?: boolean;
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

export interface PaperState {
  balance: number;            // available USDT (not locked in open positions)
  initialBalance: number;
  positions: PaperPosition[];
  orders: PaperOrder[];       // pending limit orders
  history: PaperHistoryEntry[];
}
