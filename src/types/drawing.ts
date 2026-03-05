export type DrawingType = 'trendline' | 'box' | 'hline';

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

export type Drawing = TrendlineDrawing | BoxDrawing | HlineDrawing;

export type DrawingMode = 'none' | 'trendline' | 'box' | 'hline';

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
