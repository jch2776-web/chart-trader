import { useState, useCallback, useRef } from 'react';
import type { Candle } from '../../types/candle';
import type {
  Drawing, DrawingMode, TrendlineDrawing, BoxDrawing, HlineDrawing, Point,
} from '../../types/drawing';
import type { ChartViewport, ChartLayout } from './chartMath';
import {
  getChartAreas, yToPrice, priceToY, xToTime, pointToPixel,
} from './chartMath';

interface HoverHandle {
  drawingId: string;
  handleIdx: number; // -1 = body drag, 0..1 = trendline endpoints, 0..3 = box corners (TL TR BR BL)
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function buildTrendline(ticker: string, p1: Point, p2: Point, color?: string): TrendlineDrawing {
  const slope = p2.time !== p1.time
    ? (p2.price - p1.price) / (p2.time - p1.time)
    : 0;
  return { id: uid(), type: 'trendline', ticker, p1, p2, slope, color };
}

function buildBox(ticker: string, p1: Point, p2: Point, color?: string): BoxDrawing {
  const topPrice = Math.max(p1.price, p2.price);
  const bottomPrice = Math.min(p1.price, p2.price);
  const leftTime = Math.min(p1.time, p2.time);
  const rightTime = Math.max(p1.time, p2.time);
  return {
    id: uid(),
    type: 'box',
    ticker,
    p1,
    p2,
    corners: [
      { pos: 'TL', time: leftTime,  price: topPrice },
      { pos: 'TR', time: rightTime, price: topPrice },
      { pos: 'BR', time: rightTime, price: bottomPrice },
      { pos: 'BL', time: leftTime,  price: bottomPrice },
    ],
    topPrice,
    bottomPrice,
    color,
  };
}

function buildHline(ticker: string, price: number, color?: string): HlineDrawing {
  return { id: uid(), type: 'hline', ticker, price, color };
}

function rebuildHline(existing: HlineDrawing, price: number): HlineDrawing {
  return { ...existing, price };
}

/** Preserve id/memo/color when rebuilding an existing drawing */
function rebuildTrendline(existing: TrendlineDrawing, p1: Point, p2: Point): TrendlineDrawing {
  return { ...buildTrendline(existing.ticker, p1, p2, existing.color), id: existing.id, memo: existing.memo };
}

function rebuildBox(existing: BoxDrawing, p1: Point, p2: Point): BoxDrawing {
  return { ...buildBox(existing.ticker, p1, p2, existing.color), id: existing.id, memo: existing.memo };
}

/** Point-to-segment distance (pixels) */
function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function useDrawingTool(
  candles: Candle[],
  ticker: string,
  layout: ChartLayout,
  viewport: ChartViewport,
  mode: DrawingMode,
  setMode: (m: DrawingMode) => void,
  initialDrawings: Drawing[] = [],
  drawingColor: string = '#3b8beb',
) {
  const [drawings, setDrawings] = useState<Drawing[]>(initialDrawings);
  const [previewDrawing, setPreviewDrawing] = useState<Drawing | null>(null);
  const [hoverHandle, setHoverHandle] = useState<HoverHandle | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<HoverHandle | null>(null);

  const firstPointRef = useRef<Point | null>(null);
  const isDraggingRef = useRef(false);
  // Sync ref copy of draggingHandle — avoids stale-closure problem with useState
  const draggingHandleRef = useRef<HoverHandle | null>(null);
  // Previous mouse position for body drag delta calculation
  const lastDragPosRef = useRef<{ x: number; y: number } | null>(null);

  const getArea = useCallback(() => getChartAreas(layout).price, [layout]);

  // Convert mouse event to chart Point
  const mouseToPoint = useCallback((e: React.MouseEvent | MouseEvent): Point => {
    const rect = (e.currentTarget as HTMLElement)?.getBoundingClientRect?.()
      ?? { left: 0, top: 0 };
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const area = getArea();
    const time = xToTime(mouseX, candles, viewport, area);
    const price = yToPrice(mouseY, viewport, area);
    return { time, price };
  }, [candles, viewport, getArea]);

  // ── Hit-test handles + body ──────────────────────────────────────────────
  const hitTestHandle = useCallback((mouseX: number, mouseY: number): HoverHandle | null => {
    const area = getArea();
    const HIT_RADIUS   = 10;  // px for endpoint / corner handles
    const BODY_RADIUS  = 6;   // px for line body proximity

    for (const d of drawings) {
      if (d.type === 'trendline') {
        const p1px = pointToPixel(d.p1, candles, viewport, area);
        const p2px = pointToPixel(d.p2, candles, viewport, area);

        // Endpoint handles (checked first — higher priority)
        if (Math.hypot(mouseX - p1px.x, mouseY - p1px.y) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 0 };
        if (Math.hypot(mouseX - p2px.x, mouseY - p2px.y) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 1 };

        // Body: proximity to line segment → body drag
        if (distToSegment(mouseX, mouseY, p1px.x, p1px.y, p2px.x, p2px.y) <= BODY_RADIUS)
          return { drawingId: d.id, handleIdx: -1 };

      } else if (d.type === 'box') {
        // 4 corner handles: 0=TL 1=TR 2=BR 3=BL
        for (let i = 0; i < d.corners.length; i++) {
          const cpx = pointToPixel({ time: d.corners[i].time, price: d.corners[i].price }, candles, viewport, area);
          if (Math.hypot(mouseX - cpx.x, mouseY - cpx.y) <= HIT_RADIUS)
            return { drawingId: d.id, handleIdx: i };
        }

        // Body: inside box rectangle → body drag
        const tlPx = pointToPixel({ time: d.corners[0].time, price: d.corners[0].price }, candles, viewport, area);
        const brPx = pointToPixel({ time: d.corners[2].time, price: d.corners[2].price }, candles, viewport, area);
        const minX = Math.min(tlPx.x, brPx.x);
        const maxX = Math.max(tlPx.x, brPx.x);
        const minY = Math.min(tlPx.y, brPx.y);
        const maxY = Math.max(tlPx.y, brPx.y);
        if (mouseX > minX && mouseX < maxX && mouseY > minY && mouseY < maxY)
          return { drawingId: d.id, handleIdx: -1 };

      } else if (d.type === 'hline') {
        const py = priceToY(d.price, viewport, area);
        // Center handle (handleIdx 0)
        const centerX = area.x + area.w / 2;
        if (Math.hypot(mouseX - centerX, mouseY - py) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 0 };
        // Body: horizontal proximity within chart x bounds
        if (mouseX >= area.x && mouseX <= area.x + area.w && Math.abs(mouseY - py) <= BODY_RADIUS)
          return { drawingId: d.id, handleIdx: -1 };
      }
    }
    return null;
  }, [drawings, candles, viewport, getArea]);

  // ── Mouse Move ───────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Use ref (sync) instead of state (async) so the drag works on the very first mousemove
    const activeDrag = draggingHandleRef.current;
    if (isDraggingRef.current && activeDrag) {
      const area = getArea();

      if (activeDrag.handleIdx === -1) {
        // ── Body drag: translate by delta from last position ─────────────
        const prev = lastDragPosRef.current;
        if (prev) {
          const dTime  = xToTime(mouseX, candles, viewport, area) - xToTime(prev.x, candles, viewport, area);
          const dPrice = yToPrice(mouseY, viewport, area) - yToPrice(prev.y, viewport, area);

          setDrawings(prevDs => prevDs.map(d => {
            if (d.id !== activeDrag.drawingId) return d;
            if (d.type === 'trendline') {
              const newP1: Point = { time: d.p1.time + dTime, price: d.p1.price + dPrice };
              const newP2: Point = { time: d.p2.time + dTime, price: d.p2.price + dPrice };
              return rebuildTrendline(d, newP1, newP2);
            } else if (d.type === 'box') {
              // Translate using TL and BR corners
              const newTL: Point = { time: d.corners[0].time + dTime, price: d.corners[0].price + dPrice };
              const newBR: Point = { time: d.corners[2].time + dTime, price: d.corners[2].price + dPrice };
              return rebuildBox(d, newTL, newBR);
            } else if (d.type === 'hline') {
              return rebuildHline(d, d.price + dPrice);
            }
            return d;
          }));
        }
        lastDragPosRef.current = { x: mouseX, y: mouseY };

      } else {
        // ── Corner / endpoint handle drag ─────────────────────────────────
        const time  = xToTime(mouseX, candles, viewport, area);
        const price = yToPrice(mouseY, viewport, area);
        const pt: Point = { time, price };

        setDrawings(prev => prev.map(d => {
          if (d.id !== activeDrag.drawingId) return d;
          if (d.type === 'trendline') {
            const newP1 = activeDrag.handleIdx === 0 ? pt : d.p1;
            const newP2 = activeDrag.handleIdx === 1 ? pt : d.p2;
            return rebuildTrendline(d, newP1, newP2);
          } else if (d.type === 'box') {
            // Corner drag: fix the opposite corner (diagonally opposite: 0↔2, 1↔3)
            const oppositeIdx = (activeDrag.handleIdx + 2) % 4;
            const opp = d.corners[oppositeIdx];
            return rebuildBox(d, pt, { time: opp.time, price: opp.price });
          } else if (d.type === 'hline') {
            // Center handle drag: move price to mouse Y
            return rebuildHline(d, pt.price);
          }
          return d;
        }));
      }
      return;
    }

    // Preview while drawing
    if (mode !== 'none') {
      if (mode === 'hline') {
        // Hline preview: show line at current mouse Y (no first-point needed)
        const area = getArea();
        const price = yToPrice(mouseY, viewport, area);
        setPreviewDrawing({ ...buildHline(ticker, price, drawingColor), id: '__preview__' });
      } else if (firstPointRef.current) {
        const pt = mouseToPoint(e);
        const p1 = firstPointRef.current;
        if (mode === 'trendline') {
          setPreviewDrawing({ ...buildTrendline(ticker, p1, pt, drawingColor), id: '__preview__' });
        } else if (mode === 'box') {
          setPreviewDrawing({ ...buildBox(ticker, p1, pt, drawingColor), id: '__preview__' });
        }
      }
    }

    // Hover handle detection
    if (mode === 'none' && !isDraggingRef.current) {
      const hit = hitTestHandle(mouseX, mouseY);
      setHoverHandle(hit);
    }
  }, [mode, mouseToPoint, ticker, hitTestHandle, candles, viewport, getArea, drawingColor]);

  // ── Mouse Down ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check handle drag
    const hit = hitTestHandle(mouseX, mouseY);
    if (hit && mode === 'none') {
      isDraggingRef.current = true;
      lastDragPosRef.current = { x: mouseX, y: mouseY };
      draggingHandleRef.current = hit;  // sync — effective immediately in onMouseMove
      setDraggingHandle(hit);
      return;
    }

    if (mode === 'none') return;

    // Hline: single click creates at mouse Y immediately
    if (mode === 'hline') {
      const area = getArea();
      const price = yToPrice(mouseY, viewport, area);
      setDrawings(prev => [...prev, buildHline(ticker, price, drawingColor)]);
      setPreviewDrawing(null);
      setMode('none');
      return;
    }

    // Drawing mode: first or second click
    const pt = mouseToPoint(e);

    if (!firstPointRef.current) {
      firstPointRef.current = pt;
    } else {
      const p1 = firstPointRef.current;
      const p2 = pt;
      let newDrawing: Drawing;
      if (mode === 'trendline') {
        newDrawing = buildTrendline(ticker, p1, p2, drawingColor);
      } else {
        newDrawing = buildBox(ticker, p1, p2, drawingColor);
      }
      setDrawings(prev => [...prev, newDrawing]);
      setPreviewDrawing(null);
      firstPointRef.current = null;
      setMode('none');
    }
  }, [mode, mouseToPoint, ticker, hitTestHandle, setMode, drawingColor, getArea, viewport]);

  // ── Mouse Up ─────────────────────────────────────────────────────────────
  const onMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    lastDragPosRef.current = null;
    draggingHandleRef.current = null;
    setDraggingHandle(null);
  }, []);

  // ── Right Click: cancel drawing ───────────────────────────────────────────
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (mode !== 'none') {
      e.preventDefault();
      firstPointRef.current = null;
      setPreviewDrawing(null);
      setMode('none');
    }
  }, [mode, setMode]);

  // ── Delete drawing ────────────────────────────────────────────────────────
  const deleteDrawing = useCallback((id: string) => {
    setDrawings(prev => prev.filter(d => d.id !== id));
  }, []);

  // ── Update drawing memo ───────────────────────────────────────────────────
  const updateDrawingMemo = useCallback((id: string, memo: string) => {
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, memo } : d));
  }, []);

  // ── Update drawing color ──────────────────────────────────────────────────
  const updateDrawingColor = useCallback((id: string, color: string) => {
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, color } : d));
  }, []);

  // ── Toggle drawing monitoring active state ────────────────────────────────
  const updateDrawingActive = useCallback((id: string, active: boolean) => {
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, active } : d));
  }, []);

  // ── Cursor style ──────────────────────────────────────────────────────────
  let cursor = 'default';
  if (mode !== 'none') cursor = 'crosshair';
  else if (draggingHandle) cursor = draggingHandle.handleIdx === -1 ? 'grabbing' : 'grabbing';
  else if (hoverHandle) cursor = hoverHandle.handleIdx === -1 ? 'grab' : 'grab';

  return {
    drawings,
    setDrawings,
    previewDrawing,
    hoverHandle,
    draggingHandle,
    cursor,
    onMouseMove,
    onMouseDown,
    onMouseUp,
    onContextMenu,
    deleteDrawing,
    updateDrawingMemo,
    updateDrawingColor,
    updateDrawingActive,
  };
}
