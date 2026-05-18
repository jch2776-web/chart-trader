import { useState, useCallback, useRef } from 'react';
import type { Candle } from '../../types/candle';
import type {
  Drawing, DrawingMode, TrendlineDrawing, BoxDrawing, HlineDrawing, Point,
  FibRetracementDrawing, PriceRangeDrawing, DateRangeDrawing, ParallelChannelDrawing,
  TextDrawing, LabelDrawing, XabcdDrawing, BrushDrawing,
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

function buildFib(ticker: string, p1: Point, p2: Point, color?: string): FibRetracementDrawing {
  return { id: uid(), type: 'fib', ticker, p1, p2, color };
}

function buildPriceRange(ticker: string, p1: Point, p2: Point, color?: string): PriceRangeDrawing {
  return { id: uid(), type: 'pricerange', ticker, p1, p2, color };
}

function buildDateRange(ticker: string, p1: Point, p2: Point, color?: string): DateRangeDrawing {
  return { id: uid(), type: 'daterange', ticker, p1, p2, color };
}

function buildChannel(ticker: string, p1: Point, p2: Point, p3: Point, color?: string): ParallelChannelDrawing {
  const slope = p2.time !== p1.time ? (p2.price - p1.price) / (p2.time - p1.time) : 0;
  const offset = p3.price - (p1.price + slope * (p3.time - p1.time));
  return { id: uid(), type: 'channel', ticker, p1, p2, p3, slope, offset, color };
}

function rebuildHline(existing: HlineDrawing, price: number): HlineDrawing {
  return { ...existing, price };
}

/** Preserve id/memo/color when rebuilding an existing drawing */
function rebuildTrendline(existing: TrendlineDrawing, p1: Point, p2: Point): TrendlineDrawing {
  return { ...existing, ...buildTrendline(existing.ticker, p1, p2, existing.color), id: existing.id };
}

function rebuildBox(existing: BoxDrawing, p1: Point, p2: Point): BoxDrawing {
  return { ...existing, ...buildBox(existing.ticker, p1, p2, existing.color), id: existing.id };
}

function rebuildFib(existing: FibRetracementDrawing, p1: Point, p2: Point): FibRetracementDrawing {
  return { ...existing, ...buildFib(existing.ticker, p1, p2, existing.color), id: existing.id };
}

function rebuildPriceRange(existing: PriceRangeDrawing, p1: Point, p2: Point): PriceRangeDrawing {
  return { ...existing, ...buildPriceRange(existing.ticker, p1, p2, existing.color), id: existing.id };
}

function rebuildDateRange(existing: DateRangeDrawing, p1: Point, p2: Point): DateRangeDrawing {
  return { ...existing, ...buildDateRange(existing.ticker, p1, p2, existing.color), id: existing.id };
}

function rebuildChannel(existing: ParallelChannelDrawing, p1: Point, p2: Point, p3: Point): ParallelChannelDrawing {
  return { ...existing, ...buildChannel(existing.ticker, p1, p2, p3, existing.color), id: existing.id };
}

function buildText(ticker: string, p: Point, text: string, color?: string, fontSize = 13): TextDrawing {
  return { id: uid(), type: 'text', ticker, p, text, color, fontSize };
}

function buildLabel(ticker: string, p1: Point, p2: Point, color?: string, fontSize = 13, text = ''): LabelDrawing {
  const topPrice = Math.max(p1.price, p2.price);
  const bottomPrice = Math.min(p1.price, p2.price);
  const leftTime = Math.min(p1.time, p2.time);
  const rightTime = Math.max(p1.time, p2.time);
  return {
    id: uid(), type: 'label', ticker, p1, p2,
    corners: [
      { pos: 'TL', time: leftTime,  price: topPrice },
      { pos: 'TR', time: rightTime, price: topPrice },
      { pos: 'BR', time: rightTime, price: bottomPrice },
      { pos: 'BL', time: leftTime,  price: bottomPrice },
    ],
    topPrice, bottomPrice, text, color, fontSize,
  };
}

function rebuildText(existing: TextDrawing, p: Point): TextDrawing {
  return { ...existing, p };
}

function buildXabcd(ticker: string, px: Point, pa: Point, pb: Point, pc: Point, pd: Point, color?: string): XabcdDrawing {
  return { id: uid(), type: 'xabcd', ticker, px, pa, pb, pc, pd, color };
}

function rebuildXabcd(existing: XabcdDrawing, px: Point, pa: Point, pb: Point, pc: Point, pd: Point): XabcdDrawing {
  return { ...existing, px, pa, pb, pc, pd };
}

function rebuildLabel(existing: LabelDrawing, p1: Point, p2: Point): LabelDrawing {
  return { ...existing, ...buildLabel(existing.ticker, p1, p2, existing.color, existing.fontSize, existing.text), id: existing.id };
}

function buildBrush(ticker: string, points: Point[], color?: string, lineWidth = 8, opacity = 0.45): BrushDrawing {
  return { id: uid(), type: 'brush', ticker, points, color, lineWidth, opacity };
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
  textFontSize = 13,
  brushLineWidth = 8,
  brushOpacity = 0.45,
) {
  // ── Core drawings state + sync ref ───────────────────────────────────────
  const [drawings, _setDrawings] = useState<Drawing[]>(initialDrawings);
  const drawingsRef = useRef<Drawing[]>(initialDrawings);

  // ── History (undo/redo) ───────────────────────────────────────────────────
  const MAX_HISTORY = 30;
  const historyRef = useRef<Drawing[][]>([[...initialDrawings]]);
  const historyIdxRef = useRef<number>(0);
  const [histVer, setHistVer] = useState({ canUndo: false, canRedo: false });

  // Pre-drag snapshot — saved on mouseDown, committed on mouseUp if drawings moved
  const preDragSnapshotRef = useRef<Drawing[] | null>(null);

  // Silent setter: keeps ref in sync, no history push (used during drag)
  function setDrawingsSilent(updater: (prev: Drawing[]) => Drawing[]) {
    _setDrawings(prev => {
      const next = updater(prev);
      drawingsRef.current = next;
      return next;
    });
  }

  // Committed setter: keeps ref in sync AND pushes snapshot to history
  function commitDrawings(newState: Drawing[]) {
    drawingsRef.current = newState;
    _setDrawings(newState);
    const h = historyRef.current.slice(0, historyIdxRef.current + 1);
    h.push([...newState]);
    if (h.length > MAX_HISTORY) h.shift();
    historyRef.current = h;
    historyIdxRef.current = h.length - 1;
    setHistVer({
      canUndo: historyIdxRef.current > 0,
      canRedo: false,
    });
  }

  // External setter (Firebase restore / import): resets history entirely
  const setDrawings = useCallback((update: Drawing[] | ((prev: Drawing[]) => Drawing[])) => {
    _setDrawings(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      drawingsRef.current = next;
      historyRef.current = [[...next]];
      historyIdxRef.current = 0;
      setHistVer({ canUndo: false, canRedo: false });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const state = [...historyRef.current[historyIdxRef.current]];
    drawingsRef.current = state;
    _setDrawings(state);
    setHistVer({
      canUndo: historyIdxRef.current > 0,
      canRedo: historyIdxRef.current < historyRef.current.length - 1,
    });
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const idx = historyIdxRef.current;
    if (idx >= h.length - 1) return;
    historyIdxRef.current++;
    const state = [...h[historyIdxRef.current]];
    drawingsRef.current = state;
    _setDrawings(state);
    setHistVer({
      canUndo: historyIdxRef.current > 0,
      canRedo: historyIdxRef.current < h.length - 1,
    });
  }, []);

  const canUndo = histVer.canUndo;
  const canRedo = histVer.canRedo;

  const [previewDrawing, setPreviewDrawing] = useState<Drawing | null>(null);
  const [hoverHandle, setHoverHandle] = useState<HoverHandle | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<HoverHandle | null>(null);

  type PendingText = { type: 'text'; p: Point } | { type: 'label'; p1: Point; p2: Point };
  const [pendingText, setPendingText] = useState<PendingText | null>(null);

  const firstPointRef = useRef<Point | null>(null);
  const secondPointRef = useRef<Point | null>(null); // used by 3-click tools (channel)
  const thirdPointRef = useRef<Point | null>(null);  // used by 5-click tools (xabcd)
  const fourthPointRef = useRef<Point | null>(null); // used by 5-click tools (xabcd)
  const isDraggingRef = useRef(false);
  const isBrushingRef = useRef(false);
  const brushPointsRef = useRef<Point[]>([]);
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

      } else if (d.type === 'fib' || d.type === 'pricerange') {
        const p1px = pointToPixel(d.p1, candles, viewport, area);
        const p2px = pointToPixel(d.p2, candles, viewport, area);
        if (Math.hypot(mouseX - p1px.x, mouseY - p1px.y) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 0 };
        if (Math.hypot(mouseX - p2px.x, mouseY - p2px.y) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 1 };
        // Body: inside bounding box
        const minX = Math.min(p1px.x, p2px.x) - 4;
        const maxX = Math.max(p1px.x, p2px.x) + 4;
        const minY = Math.min(p1px.y, p2px.y) - 4;
        const maxY = Math.max(p1px.y, p2px.y) + 4;
        if (mouseX > minX && mouseX < maxX && mouseY > minY && mouseY < maxY)
          return { drawingId: d.id, handleIdx: -1 };

      } else if (d.type === 'daterange') {
        const p1px = pointToPixel(d.p1, candles, viewport, area);
        const p2px = pointToPixel(d.p2, candles, viewport, area);
        const midY = area.y + area.h / 2;
        if (Math.hypot(mouseX - p1px.x, mouseY - midY) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 0 };
        if (Math.hypot(mouseX - p2px.x, mouseY - midY) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 1 };
        const leftX = Math.min(p1px.x, p2px.x);
        const rightX = Math.max(p1px.x, p2px.x);
        if (mouseX > leftX && mouseX < rightX && mouseY > area.y && mouseY < area.y + area.h)
          return { drawingId: d.id, handleIdx: -1 };

      } else if (d.type === 'channel') {
        const p1px = pointToPixel(d.p1, candles, viewport, area);
        const p2px = pointToPixel(d.p2, candles, viewport, area);
        const p3px = pointToPixel(d.p3, candles, viewport, area);
        if (Math.hypot(mouseX - p1px.x, mouseY - p1px.y) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 0 };
        if (Math.hypot(mouseX - p2px.x, mouseY - p2px.y) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 1 };
        if (Math.hypot(mouseX - p3px.x, mouseY - p3px.y) <= HIT_RADIUS)
          return { drawingId: d.id, handleIdx: 2 };
        // Body: proximity to either line
        const pxOffset = p3px.y - p1px.y; // pixel offset between parallel and base
        const p1ParY = p1px.y + pxOffset;
        const p2ParY = p2px.y + pxOffset;
        if (distToSegment(mouseX, mouseY, p1px.x, p1px.y, p2px.x, p2px.y) <= BODY_RADIUS ||
            distToSegment(mouseX, mouseY, p1px.x, p1ParY, p2px.x, p2ParY) <= BODY_RADIUS)
          return { drawingId: d.id, handleIdx: -1 };
      } else if (d.type === 'text') {
        const ppx = pointToPixel(d.p, candles, viewport, area);
        const approxW = (d.text.length * (d.fontSize ?? 13) * 0.6) + 16;
        const fh = d.fontSize ?? 13;
        if (mouseX >= ppx.x - 4 && mouseX <= ppx.x + approxW &&
            mouseY >= ppx.y - fh - 4 && mouseY <= ppx.y + 6)
          return { drawingId: d.id, handleIdx: -1 };
      } else if (d.type === 'label') {
        for (let i = 0; i < d.corners.length; i++) {
          const cpx = pointToPixel({ time: d.corners[i].time, price: d.corners[i].price }, candles, viewport, area);
          if (Math.hypot(mouseX - cpx.x, mouseY - cpx.y) <= HIT_RADIUS)
            return { drawingId: d.id, handleIdx: i };
        }
        const tlPx = pointToPixel({ time: d.corners[0].time, price: d.corners[0].price }, candles, viewport, area);
        const brPx = pointToPixel({ time: d.corners[2].time, price: d.corners[2].price }, candles, viewport, area);
        const minX = Math.min(tlPx.x, brPx.x); const maxX = Math.max(tlPx.x, brPx.x);
        const minY = Math.min(tlPx.y, brPx.y); const maxY = Math.max(tlPx.y, brPx.y);
        if (mouseX > minX && mouseX < maxX && mouseY > minY && mouseY < maxY)
          return { drawingId: d.id, handleIdx: -1 };
      } else if (d.type === 'xabcd') {
        const pts = [d.px, d.pa, d.pb, d.pc, d.pd];
        const pxs = pts.map(p => pointToPixel(p, candles, viewport, area));
        for (let i = 0; i < pxs.length; i++) {
          if (Math.hypot(mouseX - pxs[i].x, mouseY - pxs[i].y) <= HIT_RADIUS)
            return { drawingId: d.id, handleIdx: i };
        }
        for (let i = 0; i < pxs.length - 1; i++) {
          if (distToSegment(mouseX, mouseY, pxs[i].x, pxs[i].y, pxs[i + 1].x, pxs[i + 1].y) <= BODY_RADIUS)
            return { drawingId: d.id, handleIdx: -1 };
        }
      } else if (d.type === 'brush') {
        const hitR = Math.max(BODY_RADIUS, (d.lineWidth ?? 8) / 2 + 2);
        const pxs = d.points.map(p => pointToPixel(p, candles, viewport, area));
        for (let i = 0; i < pxs.length - 1; i++) {
          if (distToSegment(mouseX, mouseY, pxs[i].x, pxs[i].y, pxs[i + 1].x, pxs[i + 1].y) <= hitR)
            return { drawingId: d.id, handleIdx: -1 };
        }
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

          setDrawingsSilent(prevDs => prevDs.map(d => {
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
            } else if (d.type === 'fib' || d.type === 'pricerange') {
              const newP1: Point = { time: d.p1.time + dTime, price: d.p1.price + dPrice };
              const newP2: Point = { time: d.p2.time + dTime, price: d.p2.price + dPrice };
              if (d.type === 'fib') return rebuildFib(d, newP1, newP2);
              return rebuildPriceRange(d, newP1, newP2);
            } else if (d.type === 'daterange') {
              const newP1: Point = { time: d.p1.time + dTime, price: d.p1.price };
              const newP2: Point = { time: d.p2.time + dTime, price: d.p2.price };
              return rebuildDateRange(d, newP1, newP2);
            } else if (d.type === 'channel') {
              const newP1: Point = { time: d.p1.time + dTime, price: d.p1.price + dPrice };
              const newP2: Point = { time: d.p2.time + dTime, price: d.p2.price + dPrice };
              const newP3: Point = { time: d.p3.time + dTime, price: d.p3.price + dPrice };
              return rebuildChannel(d, newP1, newP2, newP3);
            } else if (d.type === 'text') {
              return rebuildText(d, { time: d.p.time + dTime, price: d.p.price + dPrice });
            } else if (d.type === 'label') {
              const newTL: Point = { time: d.corners[0].time + dTime, price: d.corners[0].price + dPrice };
              const newBR: Point = { time: d.corners[2].time + dTime, price: d.corners[2].price + dPrice };
              return rebuildLabel(d, newTL, newBR);
            } else if (d.type === 'xabcd') {
              return rebuildXabcd(d,
                { time: d.px.time + dTime, price: d.px.price + dPrice },
                { time: d.pa.time + dTime, price: d.pa.price + dPrice },
                { time: d.pb.time + dTime, price: d.pb.price + dPrice },
                { time: d.pc.time + dTime, price: d.pc.price + dPrice },
                { time: d.pd.time + dTime, price: d.pd.price + dPrice },
              );
            } else if (d.type === 'brush') {
              return { ...d, points: d.points.map(p => ({ time: p.time + dTime, price: p.price + dPrice })) };
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

        setDrawingsSilent(prev => prev.map(d => {
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
          } else if (d.type === 'fib' || d.type === 'pricerange') {
            const newP1 = activeDrag.handleIdx === 0 ? pt : d.p1;
            const newP2 = activeDrag.handleIdx === 1 ? pt : d.p2;
            if (d.type === 'fib') return rebuildFib(d, newP1, newP2);
            return rebuildPriceRange(d, newP1, newP2);
          } else if (d.type === 'daterange') {
            const newTime = pt.time;
            if (activeDrag.handleIdx === 0) {
              return rebuildDateRange(d, { time: newTime, price: d.p1.price }, d.p2);
            } else {
              return rebuildDateRange(d, d.p1, { time: newTime, price: d.p2.price });
            }
          } else if (d.type === 'channel') {
            if (activeDrag.handleIdx === 0) return rebuildChannel(d, pt, d.p2, d.p3);
            if (activeDrag.handleIdx === 1) return rebuildChannel(d, d.p1, pt, d.p3);
            if (activeDrag.handleIdx === 2) return rebuildChannel(d, d.p1, d.p2, pt);
          } else if (d.type === 'label') {
            const oppositeIdx = (activeDrag.handleIdx + 2) % 4;
            const opp = d.corners[oppositeIdx];
            return rebuildLabel(d, pt, { time: opp.time, price: opp.price });
          } else if (d.type === 'xabcd') {
            const pts: Point[] = [d.px, d.pa, d.pb, d.pc, d.pd];
            pts[activeDrag.handleIdx] = pt;
            return rebuildXabcd(d, pts[0], pts[1], pts[2], pts[3], pts[4]);
          }
          return d;
        }));
      }
      return;
    }

    // Brush: accumulate points during active stroke
    if (mode === 'brush' && isBrushingRef.current) {
      const pt = mouseToPoint(e);
      brushPointsRef.current = [...brushPointsRef.current, pt];
      setPreviewDrawing({ ...buildBrush(ticker, brushPointsRef.current, drawingColor, brushLineWidth, brushOpacity), id: '__preview__' });
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
        } else if (mode === 'label') {
          setPreviewDrawing({ ...buildLabel(ticker, p1, pt, drawingColor, textFontSize), id: '__preview__' });
        } else if (mode === 'fib') {
          setPreviewDrawing({ ...buildFib(ticker, p1, pt, drawingColor), id: '__preview__' });
        } else if (mode === 'pricerange') {
          setPreviewDrawing({ ...buildPriceRange(ticker, p1, pt, drawingColor), id: '__preview__' });
        } else if (mode === 'daterange') {
          setPreviewDrawing({ ...buildDateRange(ticker, p1, pt, drawingColor), id: '__preview__' });
        } else if (mode === 'channel') {
          if (!secondPointRef.current) {
            setPreviewDrawing({ ...buildTrendline(ticker, p1, pt, drawingColor), id: '__preview__' });
          } else {
            setPreviewDrawing({ ...buildChannel(ticker, p1, secondPointRef.current, pt, drawingColor), id: '__preview__' });
          }
        } else if (mode === 'xabcd') {
          if (!secondPointRef.current) {
            // Phase 1: X fixed, show X label + line to mouse (pa=pb=pc=pd=mouse)
            setPreviewDrawing({ ...buildXabcd(ticker, p1, pt, pt, pt, pt, drawingColor), id: '__preview__' });
          } else if (!thirdPointRef.current) {
            setPreviewDrawing({ ...buildXabcd(ticker, p1, secondPointRef.current, pt, pt, pt, drawingColor), id: '__preview__' });
          } else if (!fourthPointRef.current) {
            setPreviewDrawing({ ...buildXabcd(ticker, p1, secondPointRef.current, thirdPointRef.current, pt, pt, drawingColor), id: '__preview__' });
          } else {
            setPreviewDrawing({ ...buildXabcd(ticker, p1, secondPointRef.current, thirdPointRef.current, fourthPointRef.current, pt, drawingColor), id: '__preview__' });
          }
        }
      }
    }

    // Hover handle detection
    if (mode === 'none' && !isDraggingRef.current) {
      const hit = hitTestHandle(mouseX, mouseY);
      setHoverHandle(hit);
    }
  }, [mode, mouseToPoint, ticker, hitTestHandle, candles, viewport, getArea, drawingColor, textFontSize]);

  // ── Mouse Down ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check handle drag
    const hit = hitTestHandle(mouseX, mouseY);
    if (hit && mode === 'none') {
      preDragSnapshotRef.current = drawingsRef.current; // save state before drag
      isDraggingRef.current = true;
      lastDragPosRef.current = { x: mouseX, y: mouseY };
      draggingHandleRef.current = hit;  // sync — effective immediately in onMouseMove
      setDraggingHandle(hit);
      return;
    }

    if (mode === 'none') return;

    // Brush: start stroke on mousedown (drag-based, not click-based)
    if (mode === 'brush') {
      const pt = mouseToPoint(e);
      isBrushingRef.current = true;
      brushPointsRef.current = [pt];
      setPreviewDrawing({ ...buildBrush(ticker, [pt], drawingColor, brushLineWidth, brushOpacity), id: '__preview__' });
      return;
    }

    // Hline: single click creates at mouse Y immediately
    if (mode === 'hline') {
      const area = getArea();
      const price = yToPrice(mouseY, viewport, area);
      commitDrawings([...drawingsRef.current, buildHline(ticker, price, drawingColor)]);
      setPreviewDrawing(null);
      setMode('none');
      return;
    }

    // Text: single click places text at mouse position
    if (mode === 'text') {
      setPendingText({ type: 'text', p: mouseToPoint(e) });
      setPreviewDrawing(null);
      setMode('none');
      return;
    }

    // Drawing mode: first or second click
    const pt = mouseToPoint(e);

    if (!firstPointRef.current) {
      firstPointRef.current = pt;
    } else if (mode === 'channel' && !secondPointRef.current) {
      secondPointRef.current = pt;
    } else if (mode === 'xabcd' && !secondPointRef.current) {
      secondPointRef.current = pt; // A
    } else if (mode === 'xabcd' && !thirdPointRef.current) {
      thirdPointRef.current = pt;  // B
    } else if (mode === 'xabcd' && !fourthPointRef.current) {
      fourthPointRef.current = pt; // C
    } else {
      const p1 = firstPointRef.current;
      const p2 = (mode === 'channel' || mode === 'xabcd') ? secondPointRef.current! : pt;
      const p3 = pt;
      let newDrawing: Drawing;
      if (mode === 'trendline') {
        newDrawing = buildTrendline(ticker, p1, p2, drawingColor);
      } else if (mode === 'fib') {
        newDrawing = buildFib(ticker, p1, p2, drawingColor);
      } else if (mode === 'pricerange') {
        newDrawing = buildPriceRange(ticker, p1, p2, drawingColor);
      } else if (mode === 'daterange') {
        newDrawing = buildDateRange(ticker, p1, p2, drawingColor);
      } else if (mode === 'channel') {
        newDrawing = buildChannel(ticker, p1, p2, p3, drawingColor);
      } else if (mode === 'xabcd') {
        newDrawing = buildXabcd(ticker, p1, p2, thirdPointRef.current!, fourthPointRef.current!, pt, drawingColor);
      } else if (mode === 'label') {
        setPendingText({ type: 'label', p1, p2: pt });
        setPreviewDrawing(null);
        firstPointRef.current = null;
        secondPointRef.current = null;
        thirdPointRef.current = null;
        fourthPointRef.current = null;
        setMode('none');
        return;
      } else {
        newDrawing = buildBox(ticker, p1, p2, drawingColor);
      }
      commitDrawings([...drawingsRef.current, newDrawing]);
      setPreviewDrawing(null);
      firstPointRef.current = null;
      secondPointRef.current = null;
      thirdPointRef.current = null;
      fourthPointRef.current = null;
      setMode('none');
    }
  }, [mode, mouseToPoint, ticker, hitTestHandle, setMode, drawingColor, getArea, viewport]);

  // ── Mouse Up ─────────────────────────────────────────────────────────────
  const onMouseUp = useCallback(() => {
    // Finalize brush stroke
    if (isBrushingRef.current) {
      isBrushingRef.current = false;
      const pts = brushPointsRef.current;
      if (pts.length >= 2) {
        commitDrawings([...drawingsRef.current, buildBrush(ticker, pts, drawingColor, brushLineWidth, brushOpacity)]);
      }
      brushPointsRef.current = [];
      setPreviewDrawing(null);
      // Keep brush mode active so user can draw more strokes without re-clicking the button
      return;
    }
    // Commit drag to history if the drawings actually moved
    if (isDraggingRef.current && preDragSnapshotRef.current !== null) {
      if (drawingsRef.current !== preDragSnapshotRef.current) {
        commitDrawings(drawingsRef.current);
      }
      preDragSnapshotRef.current = null;
    }
    isDraggingRef.current = false;
    lastDragPosRef.current = null;
    draggingHandleRef.current = null;
    setDraggingHandle(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, drawingColor, brushLineWidth, brushOpacity]);

  // ── Right Click: cancel drawing OR delete hovered drawing ────────────────
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (mode !== 'none') {
      e.preventDefault();
      firstPointRef.current = null;
      secondPointRef.current = null;
      thirdPointRef.current = null;
      fourthPointRef.current = null;
      isBrushingRef.current = false;
      brushPointsRef.current = [];
      setPreviewDrawing(null);
      setMode('none');
      return;
    }
    // In pointer mode: right-click on a hovered drawing to delete it
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const hit = hitTestHandle(mouseX, mouseY);
    if (hit) {
      e.preventDefault();
      commitDrawings(drawingsRef.current.filter(d => d.id !== hit.drawingId));
    }
  }, [mode, setMode, hitTestHandle]);

  // ── Delete drawing ────────────────────────────────────────────────────────
  const deleteDrawing = useCallback((id: string) => {
    commitDrawings(drawingsRef.current.filter(d => d.id !== id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update drawing memo ───────────────────────────────────────────────────
  const updateDrawingMemo = useCallback((id: string, memo: string) => {
    setDrawingsSilent(prev => prev.map(d => d.id === id ? { ...d, memo } : d));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update drawing color ──────────────────────────────────────────────────
  const updateDrawingColor = useCallback((id: string, color: string) => {
    setDrawingsSilent(prev => prev.map(d => d.id === id ? { ...d, color } : d));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Toggle drawing monitoring active state ────────────────────────────────
  const updateDrawingActive = useCallback((id: string, active: boolean) => {
    setDrawingsSilent(prev => prev.map(d => d.id === id ? { ...d, active } : d));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pending text confirmation ─────────────────────────────────────────────
  const confirmPendingText = useCallback((text: string, fontSize: number) => {
    if (!pendingText || !text.trim()) { setPendingText(null); return; }
    if (pendingText.type === 'text') {
      commitDrawings([...drawingsRef.current, buildText(ticker, pendingText.p, text, drawingColor, fontSize)]);
    } else {
      commitDrawings([...drawingsRef.current, buildLabel(ticker, pendingText.p1, pendingText.p2, drawingColor, fontSize, text)]);
    }
    setPendingText(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingText, ticker, drawingColor]);

  const cancelPendingText = useCallback(() => { setPendingText(null); }, []);

  // ── Update drawing text / fontSize ────────────────────────────────────────
  const updateDrawingText = useCallback((id: string, text: string, fontSize?: number) => {
    setDrawingsSilent(prev => prev.map(d => {
      if (d.id !== id) return d;
      if (d.type === 'text' || d.type === 'label') {
        return { ...d, text, ...(fontSize != null ? { fontSize } : {}) };
      }
      return d;
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cursor style ──────────────────────────────────────────────────────────
  let cursor = 'default';
  if (mode === 'brush') cursor = 'cell';
  else if (mode !== 'none') cursor = 'crosshair';
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
    pendingText,
    confirmPendingText,
    cancelPendingText,
    updateDrawingText,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
