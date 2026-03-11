import { useCallback, useRef } from 'react';
import type { Candle, Interval } from '../../types/candle';
import type { PaperHistoryEntry } from '../../types/paperTrading';
import type { AltMeta } from '../../types/paperTrading';
import { useBinanceWS } from '../../hooks/useBinanceWS';

export interface TimeStopRequestPayload {
  mode: 'paper' | 'live';
  symbol: string;
  direction: 'long' | 'short';
  scanInterval: Interval;
  currentSl: number;
  candidateId: string;
  metaKey?: string;
  qty: number;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  closeSide: 'BUY' | 'SELL';
  lastClosePrice: number;
  requestedAt: number;
  paperPosId?: string;
}

interface Props {
  meta: AltMeta;
  qty: number;
  positionSide: 'LONG' | 'SHORT';
  paperPosId: string;
  onClose: (price: number, reason: Extract<PaperHistoryEntry['closeReason'], 'sl'>) => void;
  onTimeStopRequest: (payload: TimeStopRequestPayload) => void;
}

/**
 * Invisible component that watches a paper position opened from AltScanner.
 * Closes the position automatically when:
 *   1. Time-stop: now > meta.validUntilTime (reason: 'expired')
 *   2. Structural invalidation: close crosses the SL in the direction of loss (reason: 'sl')
 *
 * Renders nothing — mount one per alt-scanned paper position.
 */
export function AltPositionMonitor({ meta, qty, positionSide, paperPosId, onClose, onTimeStopRequest }: Props) {
  const timeStopRequestedRef = useRef(false);
  const handleCandle = useCallback((candle: Candle, isClosed: boolean) => {
    if (!isClosed) return;

    // ── Structural invalidation (close breaches SL) ────────────────────────
    if (meta.direction === 'long' && candle.close < meta.slPrice) {
      onClose(candle.close, 'sl');
      return;
    }
    if (meta.direction === 'short' && candle.close > meta.slPrice) {
      onClose(candle.close, 'sl');
      return;
    }

    // ── Time-stop request (single-shot) ────────────────────────────────────
    if (meta.timeStopEnabled !== false && Date.now() > meta.validUntilTime && !timeStopRequestedRef.current) {
      timeStopRequestedRef.current = true;
      onTimeStopRequest({
        mode: 'paper',
        symbol: meta.symbol,
        direction: meta.direction,
        scanInterval: meta.scanInterval as Interval,
        currentSl: meta.slPrice,
        candidateId: meta.candidateId,
        qty,
        positionSide,
        closeSide: meta.direction === 'long' ? 'SELL' : 'BUY',
        lastClosePrice: candle.close,
        requestedAt: Date.now(),
        paperPosId,
      });
    }
  }, [meta, qty, positionSide, paperPosId, onClose, onTimeStopRequest]);

  useBinanceWS(meta.symbol, meta.scanInterval as Interval, handleCandle);

  return null;
}

// ── Live position monitor ────────────────────────────────────────────────────
interface LiveProps {
  meta: AltMeta;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  qty: number;
  onCloseMarket: (
    symbol: string,
    closeSide: 'BUY' | 'SELL',
    qty: number,
    positionSide: 'LONG' | 'SHORT' | 'BOTH',
    reason: 'sl',
  ) => void;
  onTimeStopRequest: (payload: TimeStopRequestPayload) => void;
  metaKey: string;
}

/**
 * Mirrors AltPositionMonitor for live positions.
 * Watches the scanInterval WS; on closed candle fires MARKET reduceOnly close when:
 *   1. now > validUntilTime  (time-stop)
 *   2. close crosses slPrice in loss direction  (structural invalidation)
 */
export function LiveAltPositionMonitor({ meta, positionSide, qty, onCloseMarket, onTimeStopRequest, metaKey }: LiveProps) {
  const closeSide: 'BUY' | 'SELL' = meta.direction === 'long' ? 'SELL' : 'BUY';
  // Prevent double-firing for immediate SL close if WS duplicates closed candles.
  const firedRef = useRef(false);
  // Time-stop request must be deduplicated separately from SL auto-close.
  const timeStopRequestedRef = useRef(false);

  const handleCandle = useCallback((candle: Candle, isClosed: boolean) => {
    if (!isClosed) return;

    if (!firedRef.current && meta.direction === 'long' && candle.close < meta.slPrice) {
      firedRef.current = true;
      onCloseMarket(meta.symbol, closeSide, qty, positionSide, 'sl');
      return;
    }
    if (!firedRef.current && meta.direction === 'short' && candle.close > meta.slPrice) {
      firedRef.current = true;
      onCloseMarket(meta.symbol, closeSide, qty, positionSide, 'sl');
      return;
    }

    if (meta.timeStopEnabled !== false && Date.now() > meta.validUntilTime && !timeStopRequestedRef.current) {
      timeStopRequestedRef.current = true;
      onTimeStopRequest({
        mode: 'live',
        symbol: meta.symbol,
        direction: meta.direction,
        scanInterval: meta.scanInterval as Interval,
        currentSl: meta.slPrice,
        candidateId: meta.candidateId,
        metaKey,
        qty,
        positionSide,
        closeSide,
        lastClosePrice: candle.close,
        requestedAt: Date.now(),
      });
    }
  }, [meta, closeSide, qty, positionSide, onCloseMarket, onTimeStopRequest, metaKey]);

  useBinanceWS(meta.symbol, meta.scanInterval as Interval, handleCandle);

  return null;
}
