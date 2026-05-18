export interface Candle {
  time: number;      // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;    // base asset volume  [5]
  // Extended fields from Binance USDⓈ-M futures kline response
  quoteVolume: number;           // [7]  quote asset volume (USDT notional)
  tradeCount: number;            // [8]  number of trades
  takerBuyBaseVolume: number;    // [9]  taker buy base asset volume
  takerBuyQuoteVolume: number;   // [10] taker buy quote asset volume
}

export type Interval = '1m' | '3m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
