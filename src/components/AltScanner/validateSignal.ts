import type { Candle } from '../../types/candle';
import type { ScanCandidate } from './breakoutScanner';
import { triggerPrice, getMaxDistPct } from './timeUtils';

// ── Volume SMA helper ──────────────────────────────────────────────────────

/**
 * SMA20 of volume on the 20 candles immediately preceding the last element.
 * Pass the full closed-candles array; the last element is lastClosed.
 */
export function calcSMA20Volume(candles: Candle[]): number {
  if (candles.length < 21) return 0;
  return candles.slice(-21, -1).reduce((a, c) => a + c.volume, 0) / 20;
}

// ── Core revalidation ──────────────────────────────────────────────────────

/**
 * Re-evaluate a candidate against the latest pair of confirmed closed candles.
 * Returns a partial update to merge into the candidate; empty object = no change.
 *
 * Call this whenever a new candle closes for the candidate's symbol.
 *
 * @param c              The current candidate
 * @param lastClosed     Most recent confirmed closed candle
 * @param prevClosed     The candle before lastClosed
 * @param closedCandles  All confirmed closed candles (lastClosed is the last element)
 * @param intervalMs     Interval in milliseconds
 * @param now            Current timestamp (Date.now())
 */
export function revalidateCandidate(
  c: ScanCandidate,
  lastClosed: Candle,
  prevClosed: Candle,
  closedCandles: Candle[],
  intervalMs: number,
  now: number,
): Partial<ScanCandidate> {
  // Already settled — no further updates
  if (c.status === 'TRIGGERED' || c.status === 'INVALID') return {};

  // ── 1. EXPIRED ────────────────────────────────────────────────────────────
  if (now > c.validUntilTime) {
    return { status: 'EXPIRED', expiredReason: 'TTL 만료' };
  }

  const lastClosedCloseTime = lastClosed.time + intervalMs;
  const prevClosedCloseTime = prevClosed.time + intervalMs;
  const triggerLast = triggerPrice(c.triggerSpec, lastClosedCloseTime);
  const triggerPrev = triggerPrice(c.triggerSpec, prevClosedCloseTime);
  const maxDistPct  = getMaxDistPct(c.interval);

  // Next-candle trigger projection
  const nextCandleCloseTime   = lastClosedCloseTime + intervalMs;
  const triggerAtNextClose    = triggerPrice(c.triggerSpec, nextCandleCloseTime);
  const commonUpdates: Partial<ScanCandidate> = {
    nextCandleCloseTime,
    triggerPriceAtNextClose: triggerAtNextClose,
  };

  if (c.direction === 'long') {
    // ── 2a. INVALID — structural break ────────────────────────────────────
    const coreSup = c.topLevels.find(z => z.kind === 'support');
    if (coreSup) {
      if (lastClosed.close < coreSup.zoneBottom) {
        return {
          ...commonUpdates,
          status: 'INVALID',
          invalidReason: `핵심 지지 존 하단 이탈 (${coreSup.zoneBottom.toFixed(4)})`,
        };
      }
    } else if (lastClosed.close < c.entryPrice - 1.0 * c.atr) {
      return {
        ...commonUpdates,
        status: 'INVALID',
        invalidReason: 'Entry−ATR 이탈 (지지 존 없음)',
      };
    }

    // ── 2b. INVALID — distance blow-out ───────────────────────────────────
    const dist = triggerLast > 0
      ? ((triggerLast - lastClosed.close) / triggerLast) * 100
      : 0;
    if (dist > maxDistPct * 1.8) {
      return {
        ...commonUpdates,
        status: 'INVALID',
        invalidReason: `트리거 거리 초과 (${dist.toFixed(2)}% > ${(maxDistPct * 1.8).toFixed(2)}%)`,
      };
    }

    // ── 3. TRIGGERED ──────────────────────────────────────────────────────
    // crossed = fresh crossover this candle
    // For PENDING status: crossover already happened at scan time (vol wasn't met).
    // Allow TRIGGERED on any later candle where price is still above trigger + vol is now met.
    const priceOkL = lastClosed.close > triggerLast;
    const crossedL = priceOkL && prevClosed.close <= triggerPrev;
    if (crossedL || (c.status === 'PENDING' && priceOkL)) {
      const sma20vol = calcSMA20Volume(closedCandles);
      if (
        lastClosed.volume >= sma20vol * c.volFactor &&
        lastClosed.volume >= prevClosed.volume
      ) {
        return {
          ...commonUpdates,
          distanceNowPct: dist,
          status: 'TRIGGERED',
          triggeredAt: lastClosedCloseTime,
        };
      }
    }

    return { ...commonUpdates, distanceNowPct: dist };
  } else {
    // ── SHORT ─────────────────────────────────────────────────────────────
    const coreRes = c.topLevels.find(z => z.kind === 'resistance');
    if (coreRes) {
      if (lastClosed.close > coreRes.zoneTop) {
        return {
          ...commonUpdates,
          status: 'INVALID',
          invalidReason: `핵심 저항 존 상단 돌파 (${coreRes.zoneTop.toFixed(4)})`,
        };
      }
    } else if (lastClosed.close > c.entryPrice + 1.0 * c.atr) {
      return {
        ...commonUpdates,
        status: 'INVALID',
        invalidReason: 'Entry+ATR 돌파 (저항 존 없음)',
      };
    }

    const dist = triggerLast > 0
      ? ((lastClosed.close - triggerLast) / triggerLast) * 100
      : 0;
    if (dist > maxDistPct * 1.8) {
      return {
        ...commonUpdates,
        status: 'INVALID',
        invalidReason: `트리거 거리 초과 (${dist.toFixed(2)}% > ${(maxDistPct * 1.8).toFixed(2)}%)`,
      };
    }

    const priceOkS = lastClosed.close < triggerLast;
    const crossedS = priceOkS && prevClosed.close >= triggerPrev;
    if (crossedS || (c.status === 'PENDING' && priceOkS)) {
      const sma20vol = calcSMA20Volume(closedCandles);
      if (
        lastClosed.volume >= sma20vol * c.volFactor &&
        lastClosed.volume >= prevClosed.volume
      ) {
        return {
          ...commonUpdates,
          distanceNowPct: dist,
          status: 'TRIGGERED',
          triggeredAt: lastClosedCloseTime,
        };
      }
    }

    return { ...commonUpdates, distanceNowPct: dist };
  }
}
