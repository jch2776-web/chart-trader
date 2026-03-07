import { useCallback } from 'react';
import type { Candle, Interval } from '../../types/candle';
import type { PaperHistoryEntry } from '../../types/paperTrading';
import type { AltMeta } from '../../types/paperTrading';
import { useBinanceWS } from '../../hooks/useBinanceWS';

interface Props {
  meta: AltMeta;
  onClose: (price: number, reason: PaperHistoryEntry['closeReason']) => void;
}

/**
 * Invisible component that watches a paper position opened from AltScanner.
 * Closes the position automatically when:
 *   1. Time-stop: now > meta.validUntilTime (reason: 'manual')
 *   2. Structural invalidation: close crosses the SL in the direction of loss (reason: 'sl')
 *
 * Renders nothing — mount one per alt-scanned paper position.
 */
export function AltPositionMonitor({ meta, onClose }: Props) {
  const handleCandle = useCallback((candle: Candle, isClosed: boolean) => {
    if (!isClosed) return;

    // ── Time-stop ──────────────────────────────────────────────────────────
    if (Date.now() > meta.validUntilTime) {
      onClose(candle.close, 'manual');
      return;
    }

    // ── Structural invalidation (close breaches SL) ────────────────────────
    if (meta.direction === 'long' && candle.close < meta.slPrice) {
      onClose(candle.close, 'sl');
    } else if (meta.direction === 'short' && candle.close > meta.slPrice) {
      onClose(candle.close, 'sl');
    }
  }, [meta, onClose]);

  useBinanceWS(meta.symbol, meta.scanInterval as Interval, handleCandle);

  return null;
}
