import type { Candle } from '../../../types/candle';

/**
 * Dollar Turnover — total USDT notional traded in the candle.
 * Directly maps to quoteVolume (Binance kline index [7]).
 */
export function calcDollarTurnover(candle: Candle): number {
  return candle.quoteVolume;
}

/**
 * Average Trade Notional — mean USDT value per individual trade.
 * Useful for distinguishing retail noise from institutional activity.
 */
export function calcAvgTradeNotional(candle: Candle): number {
  return candle.quoteVolume / Math.max(candle.tradeCount, 1);
}

/**
 * Taker Imbalance — normalised net taker-buy pressure in [-1, +1].
 *   > 0  aggressive buyers dominate (bullish flow)
 *   < 0  aggressive sellers dominate (bearish flow)
 *   = 0  balanced or no volume
 *
 * Formula: (2 * takerBuyQuoteVolume − quoteVolume) / quoteVolume
 */
export function calcTakerImbalance(candle: Candle): number {
  if (candle.quoteVolume <= 0) return 0;
  return (2 * candle.takerBuyQuoteVolume - candle.quoteVolume) / candle.quoteVolume;
}
