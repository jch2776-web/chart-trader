import type { Candle } from '../types/candle';
import type { Drawing, TrendlineDrawing, BoxDrawing, HlineDrawing } from '../types/drawing';
import type { TradeDirection } from '../types/trade';

export type BreakoutSignal = {
  drawingId: string;
  type: 'trendline' | 'box' | 'hline';
  subtype: 'breakout' | 'entry';   // entry = 박스 진입, breakout = 돌파
  direction: 'long' | 'short';
  price: number;
  time: number;
};

/** Position of price relative to a box */
export type BoxState = 'above' | 'inside' | 'below';

export function getBoxState(d: BoxDrawing, price: number): BoxState {
  if (price > d.topPrice)    return 'above';
  if (price < d.bottomPrice) return 'below';
  return 'inside';
}

// No slippage buffer — fire the instant price strictly crosses the line.
// Dedup (candle.time key in App.tsx) prevents repeated signals within the same kline.
const SLIPPAGE = 0;

/**
 * Real-time trendline breakout — checks current price against the line.
 * Stateless: dedup is handled by the caller (triggeredRef keyed by candle.time).
 */
export function checkTrendlineBreakout(
  d: TrendlineDrawing,
  _candles: Candle[],
  direction: TradeDirection,
  currentPrice: number,
  currentTime: number,
): BreakoutSignal | null {
  const lineNow = d.p1.price + d.slope * (currentTime - d.p1.time);

  const aboveBreak = currentPrice > lineNow * (1 + SLIPPAGE);
  const belowBreak = currentPrice < lineNow * (1 - SLIPPAGE);

  if (aboveBreak && (direction === 'long' || direction === 'both')) {
    return { drawingId: d.id, type: 'trendline', subtype: 'breakout', direction: 'long', price: currentPrice, time: currentTime };
  }
  if (belowBreak && (direction === 'short' || direction === 'both')) {
    return { drawingId: d.id, type: 'trendline', subtype: 'breakout', direction: 'short', price: currentPrice, time: currentTime };
  }
  return null;
}

/**
 * Stateful box detection based on price-state transitions.
 *
 * Long direction (upward moves only):
 *   below → inside  = 박스권 진입 (entry from below)
 *   below → above   = 박스 상단 돌파 (breakout)
 *   inside → above  = 박스 상단 돌파 (breakout)
 *
 * Short direction (downward moves only):
 *   above → inside  = 박스권 진입 (entry from above)
 *   above → below   = 박스 하단 돌파 (breakout)
 *   inside → below  = 박스 하단 돌파 (breakout)
 *
 * No dedup needed — state machine fires exactly once per transition.
 */
export function checkBoxBreakout(
  d: BoxDrawing,
  direction: TradeDirection,
  currentPrice: number,
  currentTime: number,
  prevState: BoxState | null,
): BreakoutSignal[] {
  if (prevState === null) return [];

  const newState = getBoxState(d, currentPrice);
  if (newState === prevState) return [];

  const signals: BreakoutSignal[] = [];

  if (direction === 'long' || direction === 'both') {
    if (prevState === 'below' && newState === 'inside') {
      signals.push({ drawingId: d.id, type: 'box', subtype: 'entry', direction: 'long', price: currentPrice, time: currentTime });
    } else if (newState === 'above') {
      signals.push({ drawingId: d.id, type: 'box', subtype: 'breakout', direction: 'long', price: currentPrice, time: currentTime });
    }
  }

  if (direction === 'short' || direction === 'both') {
    if (prevState === 'above' && newState === 'inside') {
      signals.push({ drawingId: d.id, type: 'box', subtype: 'entry', direction: 'short', price: currentPrice, time: currentTime });
    } else if (newState === 'below') {
      signals.push({ drawingId: d.id, type: 'box', subtype: 'breakout', direction: 'short', price: currentPrice, time: currentTime });
    }
  }

  return signals;
}

// ── Horizontal line breakout ──────────────────────────────────────────────────

/** Position of price relative to a horizontal line */
export type HlineState = 'above' | 'below';

export function getHlineState(d: HlineDrawing, price: number): HlineState {
  return price >= d.price ? 'above' : 'below';
}

/**
 * Stateful hline breakout detection.
 * Long:  below → above = upward breakout
 * Short: above → below = downward breakout
 */
export function checkHlineBreakout(
  d: HlineDrawing,
  direction: TradeDirection,
  price: number,
  time: number,
  prevState: HlineState | null,
): BreakoutSignal[] {
  if (prevState === null) return [];
  const newState = getHlineState(d, price);
  if (newState === prevState) return [];

  const signals: BreakoutSignal[] = [];
  if ((direction === 'long' || direction === 'both') && prevState === 'below' && newState === 'above') {
    signals.push({ drawingId: d.id, type: 'hline', subtype: 'breakout', direction: 'long', price, time });
  }
  if ((direction === 'short' || direction === 'both') && prevState === 'above' && newState === 'below') {
    signals.push({ drawingId: d.id, type: 'hline', subtype: 'breakout', direction: 'short', price, time });
  }
  return signals;
}

/** Check trendline drawings only. Boxes handled statefu lly in App.tsx. */
export function checkAllBreakouts(
  drawings: Drawing[],
  candles: Candle[],
  direction: TradeDirection,
  currentPrice: number,
  currentTime: number,
): BreakoutSignal[] {
  const signals: BreakoutSignal[] = [];
  for (const d of drawings) {
    if (d.type === 'trendline') {
      const sig = checkTrendlineBreakout(d, candles, direction, currentPrice, currentTime);
      if (sig) signals.push(sig);
    }
  }
  return signals;
}
