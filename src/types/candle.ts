export interface Candle {
  time: number;      // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Interval = '1m' | '3m' | '5m' | '15m' | '1h' | '4h' | '1d';
