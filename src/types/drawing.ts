export type DrawingType = 'trendline' | 'box' | 'hline' | 'fib' | 'pricerange' | 'daterange';

export interface Point {
  time: number;   // Unix ms (candle open time)
  price: number;  // USDT
}

export interface TrendlineDrawing {
  id: string;
  type: 'trendline';
  ticker: string;
  p1: Point;
  p2: Point;
  slope: number;  // (p2.price - p1.price) / (p2.time - p1.time)
  memo?: string;
  color?: string;
  active?: boolean; // undefined / true = monitoring on, false = monitoring off
}

export interface BoxCorner {
  pos: 'TL' | 'TR' | 'BR' | 'BL';
  time: number;
  price: number;
}

export interface BoxDrawing {
  id: string;
  type: 'box';
  ticker: string;
  p1: Point;  // first clicked corner
  p2: Point;  // second clicked corner
  corners: BoxCorner[];
  topPrice: number;
  bottomPrice: number;
  memo?: string;
  color?: string;
  active?: boolean;
}

export interface HlineDrawing {
  id: string;
  type: 'hline';
  ticker: string;
  price: number;
  memo?: string;
  color?: string;
  active?: boolean;
}

// ── Fibonacci Retracement ─────────────────────────────────────────────────────
// Levels computed as: price = p1.price + level * (p2.price - p1.price)
// 0% = p1.price, 100% = p2.price
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0] as const;
export const FIB_LEVEL_COLORS = ['#0ecb81', '#3b8beb', '#f0b90b', '#f59e42', '#a855f7', '#f6465d', '#0ecb81'] as const;

export interface FibRetracementDrawing {
  id: string;
  type: 'fib';
  ticker: string;
  p1: Point;
  p2: Point;
  color?: string;
  memo?: string;
  active?: boolean;
}

// ── Price Range ───────────────────────────────────────────────────────────────
// Shows the absolute and percentage price range between p1 and p2
export interface PriceRangeDrawing {
  id: string;
  type: 'pricerange';
  ticker: string;
  p1: Point;
  p2: Point;
  color?: string;
  memo?: string;
  active?: boolean;
}

// ── Date Range ────────────────────────────────────────────────────────────────
// Shows the time span between p1.time and p2.time (price is ignored)
export interface DateRangeDrawing {
  id: string;
  type: 'daterange';
  ticker: string;
  p1: Point;
  p2: Point;
  color?: string;
  memo?: string;
  active?: boolean;
}

export type Drawing = TrendlineDrawing | BoxDrawing | HlineDrawing | FibRetracementDrawing | PriceRangeDrawing | DateRangeDrawing;

export type DrawingMode = 'none' | 'trendline' | 'box' | 'hline' | 'fib' | 'pricerange' | 'daterange';

// Canvas pixel coordinates
export interface PixelPoint {
  x: number;
  y: number;
}

export const DRAWING_COLORS = [
  '#3b8beb',  // blue (trendline default)
  '#e8b73a',  // golden (box default)
  '#0ecb81',  // green
  '#f6465d',  // red
  '#a855f7',  // purple
  '#ff6b35',  // orange
  '#ffffff',  // white
] as const;
