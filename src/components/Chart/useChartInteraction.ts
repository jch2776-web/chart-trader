import { useRef, useCallback } from 'react';
import type { Candle } from '../../types/candle';
import type { ChartViewport, ChartLayout } from './chartMath';
import { getChartAreas, xToIdx, yToPrice, autoFitPriceRange } from './chartMath';

interface CrosshairState {
  x: number;
  y: number;
  visible: boolean;
}

interface UseChartInteractionProps {
  candles: Candle[];
  layout: ChartLayout;
  setViewport: React.Dispatch<React.SetStateAction<ChartViewport>>;
  setCrosshair: React.Dispatch<React.SetStateAction<CrosshairState>>;
  isDrawing: boolean;
  isYManualRef: React.MutableRefObject<boolean>;
}

const MIN_VISIBLE_CANDLES = 5;
// How far right (into future) the user can scroll: 50 % of visible range
const FUTURE_RATIO = 0.5;

export function useChartInteraction({
  candles,
  layout,
  setViewport,
  setCrosshair,
  isDrawing,
  isYManualRef,
}: UseChartInteractionProps) {
  const isPanningRef   = useRef(false);
  const lastMouseXRef  = useRef(0);

  // Touch state refs
  const isTouchPanRef     = useRef(false);
  const lastTouchXRef     = useRef(0);
  const lastPinchDistRef  = useRef<number | null>(null);
  const lastPinchMidXRef  = useRef(0);

  const getAreas = useCallback(() => getChartAreas(layout), [layout]);

  // ── Clamp helper — allows scrolling into the future ───────────────────
  function clampViewport(
    start: number,
    end: number,
    candleCount: number,
  ): [number, number] {
    const range = end - start;
    const maxFuture = Math.ceil(range * FUTURE_RATIO);
    const maxEnd    = candleCount + maxFuture;

    // Allow some blank space on the left (same ratio as future on the right)
    const minStart = -Math.ceil(range * FUTURE_RATIO);
    if (end > maxEnd) { start -= end - maxEnd; end = maxEnd; }
    start = Math.max(minStart, start);
    end   = Math.min(maxEnd, end);
    return [start, end];
  }

  // ── Y-fit helper (only uses real candle data, ignores future) ─────────
  function fitY(candles: Candle[], start: number, end: number) {
    const fitStart = Math.max(0, start);
    const fitEnd   = Math.min(candles.length - 1, end);
    return autoFitPriceRange(candles, fitStart, fitEnd);
  }

  // ── Wheel: X-zoom (default) or Y-zoom (Shift/Alt) ────────────────────
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const { price: area } = getAreas();
    const rect   = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // Auto Y-zoom when cursor is in the right price axis zone (no modifier needed)
    const isInPriceAxis = mouseX >= area.x + area.w;
    const isYZoom = e.shiftKey || e.altKey || isInPriceAxis;

    setViewport(prev => {
      // ── Y-axis zoom (Shift/Alt + wheel) ──────────────────────────────
      if (isYZoom) {
        isYManualRef.current = true;
        const mousePrice = yToPrice(mouseY, prev, area);
        // scroll UP (deltaY < 0) = zoom IN on price (tighter Y range)
        const factor = e.deltaY > 0 ? 1.12 : 0.88;
        const newMin = mousePrice - (mousePrice - prev.minPrice) * factor;
        const newMax = mousePrice + (prev.maxPrice - mousePrice) * factor;
        if (newMax - newMin < 0.0001) return prev;
        return { ...prev, minPrice: newMin, maxPrice: newMax };
      }

      // ── X-axis zoom ───────────────────────────────────────────────────
      const pivotIdx = xToIdx(mouseX, prev, area);

      // scroll UP (wheel up / macOS natural scroll up, deltaY > 0) → range GROWS → zoom out → "chart stretches"
      // scroll DOWN → range SHRINKS → zoom in → "chart narrows"
      const factor    = e.deltaY > 0 ? 1.12 : 0.88;
      let newRange    = (prev.endIdx - prev.startIdx) * factor;
      newRange = Math.max(MIN_VISIBLE_CANDLES, Math.min(candles.length * 2, newRange));

      // Keep pivot candle under mouse
      const pivotFrac = Math.max(0, Math.min(1, (mouseX - area.x) / area.w));
      let newStart    = pivotIdx - pivotFrac * newRange;
      let newEnd      = newStart + newRange;

      [newStart, newEnd] = clampViewport(newStart, newEnd, candles.length);

      if (!isYManualRef.current) {
        const { minPrice, maxPrice } = fitY(candles, newStart, newEnd);
        return { startIdx: newStart, endIdx: newEnd, minPrice, maxPrice };
      }
      return { ...prev, startIdx: newStart, endIdx: newEnd };
    });
  }, [candles, getAreas, setViewport, isYManualRef]);

  // ── Mouse Down: start pan ─────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (isDrawing) return;
    if (e.button === 0) {
      isPanningRef.current  = true;
      lastMouseXRef.current = e.clientX;
    }
  }, [isDrawing]);

  // ── Mouse Move: pan + crosshair ───────────────────────────────────────
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect   = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { price: area } = getAreas();

    // Crosshair visible in chart area (extend slightly for volume panel)
    const inChart = mouseX >= area.x && mouseX <= area.x + area.w
      && mouseY >= area.y && mouseY <= area.y + area.h + 60;
    setCrosshair({ x: mouseX, y: mouseY, visible: inChart });

    if (!isPanningRef.current || isDrawing) return;

    const dx = e.clientX - lastMouseXRef.current;
    lastMouseXRef.current = e.clientX;
    if (dx === 0) return;

    setViewport(prev => {
      const { price: a } = getAreas();
      const range   = prev.endIdx - prev.startIdx;
      const dIdx    = -(dx / a.w) * range;
      let newStart  = prev.startIdx + dIdx;
      let newEnd    = prev.endIdx   + dIdx;

      [newStart, newEnd] = clampViewport(newStart, newEnd, candles.length);

      if (!isYManualRef.current) {
        const { minPrice, maxPrice } = fitY(candles, newStart, newEnd);
        return { startIdx: newStart, endIdx: newEnd, minPrice, maxPrice };
      }
      return { ...prev, startIdx: newStart, endIdx: newEnd };
    });
  }, [candles, getAreas, setCrosshair, setViewport, isDrawing, isYManualRef]);

  const onMouseUp    = useCallback(() => { isPanningRef.current = false; }, []);
  const onMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    setCrosshair(p => ({ ...p, visible: false }));
  }, [setCrosshair]);

  // ── Double-click: reset Y auto-fit ───────────────────────────────────
  const onDoubleClick = useCallback(() => {
    isYManualRef.current = false;
    setViewport(prev => {
      const { minPrice, maxPrice } = fitY(candles, prev.startIdx, prev.endIdx);
      return { ...prev, minPrice, maxPrice };
    });
  }, [candles, setViewport, isYManualRef]);

  // ── Touch: pan (1 finger) and pinch zoom (2 fingers) ─────────────────
  function getTouchDist(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  const onTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      isTouchPanRef.current    = true;
      lastTouchXRef.current    = e.touches[0].clientX;
      lastPinchDistRef.current = null;
    } else if (e.touches.length >= 2) {
      isTouchPanRef.current    = false;
      lastPinchDistRef.current = getTouchDist(e.touches);
      lastPinchMidXRef.current = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const { price: area } = getAreas();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    if (e.touches.length === 1 && isTouchPanRef.current) {
      const dx = e.touches[0].clientX - lastTouchXRef.current;
      lastTouchXRef.current = e.touches[0].clientX;
      if (dx === 0) return;
      setViewport(prev => {
        const range  = prev.endIdx - prev.startIdx;
        const dIdx   = -(dx / area.w) * range;
        let newStart = prev.startIdx + dIdx;
        let newEnd   = prev.endIdx   + dIdx;
        [newStart, newEnd] = clampViewport(newStart, newEnd, candles.length);
        if (!isYManualRef.current) {
          const { minPrice, maxPrice } = fitY(candles, newStart, newEnd);
          return { startIdx: newStart, endIdx: newEnd, minPrice, maxPrice };
        }
        return { ...prev, startIdx: newStart, endIdx: newEnd };
      });

    } else if (e.touches.length >= 2 && lastPinchDistRef.current !== null) {
      const newDist    = getTouchDist(e.touches);
      const midClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midX       = midClientX - rect.left;
      const factor     = lastPinchDistRef.current / newDist;

      setViewport(prev => {
        const pivotIdx = xToIdx(midX, prev, area);
        let newRange   = (prev.endIdx - prev.startIdx) * factor;
        newRange = Math.max(MIN_VISIBLE_CANDLES, Math.min(candles.length * 2, newRange));
        const pivotFrac = Math.max(0, Math.min(1, (midX - area.x) / area.w));
        let newStart    = pivotIdx - pivotFrac * newRange;
        let newEnd      = newStart + newRange;
        [newStart, newEnd] = clampViewport(newStart, newEnd, candles.length);
        if (!isYManualRef.current) {
          const { minPrice, maxPrice } = fitY(candles, newStart, newEnd);
          return { startIdx: newStart, endIdx: newEnd, minPrice, maxPrice };
        }
        return { ...prev, startIdx: newStart, endIdx: newEnd };
      });

      lastPinchDistRef.current = newDist;
      lastPinchMidXRef.current = midClientX;
    }
  }, [candles, getAreas, setViewport, isYManualRef]);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (e.touches.length === 0) {
      isTouchPanRef.current    = false;
      lastPinchDistRef.current = null;
    } else if (e.touches.length === 1) {
      isTouchPanRef.current    = true;
      lastTouchXRef.current    = e.touches[0].clientX;
      lastPinchDistRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { onWheel, onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onDoubleClick, onTouchStart, onTouchMove, onTouchEnd };
}
