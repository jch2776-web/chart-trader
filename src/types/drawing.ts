export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type MemoAlign = 'left' | 'center' | 'right';

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
  lineStyle?: LineStyle;
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
  memoAlign?: MemoAlign;
  showPriceLabels?: boolean;
  active?: boolean;
}

export interface HlineDrawing {
  id: string;
  type: 'hline';
  ticker: string;
  price: number;
  memo?: string;
  color?: string;
  lineStyle?: LineStyle;
  memoAlign?: MemoAlign;
  showPriceLabel?: boolean;
  showAxisLabel?: boolean;
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

// ── Parallel Channel ──────────────────────────────────────────────────────────
// p1/p2 define the base trendline; p3 is a user-clicked point on the parallel line.
// offset = p3.price − (p1.price + slope × (p3.time − p1.time))
export interface ParallelChannelDrawing {
  id: string;
  type: 'channel';
  ticker: string;
  p1: Point;
  p2: Point;
  /** Point that defines the parallel line's offset from the base line. */
  p3: Point;
  slope: number;
  /** Signed price offset: parallel line = base line price + offset at every time. */
  offset: number;
  color?: string;
  memo?: string;
  active?: boolean;
}

export interface TextDrawing {
  id: string;
  type: 'text';
  ticker: string;
  p: Point;
  text: string;
  color?: string;
  fontSize?: number;
  active?: boolean;
}

export interface LabelDrawing {
  id: string;
  type: 'label';
  ticker: string;
  p1: Point;
  p2: Point;
  corners: BoxCorner[];
  topPrice: number;
  bottomPrice: number;
  text: string;
  color?: string;
  fontSize?: number;
  active?: boolean;
}

// ── Freehand Brush Stroke ─────────────────────────────────────────────────────
// Stores points in data-space (time/price) so the stroke tracks zoom/pan.
export interface BrushDrawing {
  id: string;
  type: 'brush';
  ticker: string;
  points: Point[];
  color?: string;
  lineWidth?: number;  // canvas px at default zoom; default 8
  opacity?: number;    // 0–1; default 0.45
  active?: boolean;
}

// ── XABCD Harmonic Pattern ────────────────────────────────────────────────────
// Five-point zigzag: X → A → B → C → D
export interface XabcdDrawing {
  id: string;
  type: 'xabcd';
  ticker: string;
  px: Point;  // X
  pa: Point;  // A
  pb: Point;  // B
  pc: Point;  // C
  pd: Point;  // D
  color?: string;
  memo?: string;
  active?: boolean;
}

export type Drawing = TrendlineDrawing | BoxDrawing | HlineDrawing | FibRetracementDrawing | PriceRangeDrawing | DateRangeDrawing | ParallelChannelDrawing | TextDrawing | LabelDrawing | XabcdDrawing | BrushDrawing;

export type DrawingType = 'trendline' | 'box' | 'hline' | 'fib' | 'pricerange' | 'daterange' | 'channel' | 'text' | 'label' | 'xabcd' | 'brush';

export type DrawingMode = 'none' | 'trendline' | 'box' | 'hline' | 'fib' | 'pricerange' | 'daterange' | 'channel' | 'text' | 'label' | 'xabcd' | 'brush';

// ── Level-to-Level Analysis Overlay ──────────────────────────────────────────
// Computed (not user-drawn) overlay that shows L2L entry/TP/SL structure.

export interface L2LSetup {
  direction: 'long' | 'short';
  level: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  idealEntry: number;
  /** Chasing threshold: LONG → skip if price > this; SHORT → skip if price < this. */
  chaseThreshold: number;
  cancelAfterBars: number;
  tp1: number;
  hardStop: number;
  /** Calibrated chart confidence score in [0, 1]. This is not a win probability. */
  score: number;
  /** Original strategy score before chart-only calibration. */
  rawScore: number;
  /** Reward/risk ratio from ideal entry to TP1/SL. */
  rr: number;
  label: string;
  /** openTime (ms) of the reclaimIndex candle — when the setup was first detected */
  detectedAt: number;
  /** Duration of one bar in ms (e.g. 900000 for 15m) */
  barIntervalMs: number;
  /** How many bars have passed since reclaimIndex (computed at useMemo time) */
  barsElapsed: number;
}

export interface L2LBacktestSummary {
  /** Filled trades evaluated after filters. */
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  /** Setups that matched filters but were not filled before cancellation. */
  unfilled: number;
  /** Distinct setups that matched filters before fill checks. */
  candidates: number;
  winRate: number;
  avgR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  sampleQuality: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface L2LOverlay {
  /** Current candle close price — used to compute entry status in the panel */
  currentPrice: number;
  /** The latest candle close time used for setup detection. Open candles are excluded. */
  asOfClosedTime: number;
  srLevels: Array<{
    centerPrice: number;
    zoneTop: number;
    zoneBottom: number;
    kind: 'support' | 'resistance';
    score: number;
  }>;
  setups: L2LSetup[];
  backtest: L2LBacktestSummary | null;
  filteredBacktest: L2LBacktestSummary | null;
  /** Out-of-sample (last 30 % of signal bars) filtered backtest. */
  filteredOosBacktest: L2LBacktestSummary | null;
  /** Walk-forward 3-fold consistency (fraction of positive folds, 0–1), null if insufficient data. */
  filteredWalktestConsistency: number | null;
  /** avgR per fold for walk-forward display. */
  filteredWalktestFolds: (number | null)[] | null;
}

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
