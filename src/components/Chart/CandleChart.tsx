import React, {
  useRef, useEffect, useState, useCallback, useLayoutEffect,
} from 'react';
import type { Candle, Interval } from '../../types/candle';
import type { Drawing, DrawingMode } from '../../types/drawing';
import type { FuturesPosition, FuturesOrder } from '../../types/futures';
import type { ChartViewport, ChartLayout } from './chartMath';
import { autoFitPriceRange, getChartAreas, idxToX, priceToY } from './chartMath';
import { formatPrice } from '../../utils/priceFormat';
import { useChartRenderer } from './useChartRenderer';
import type { IndicatorConfig } from './useChartRenderer';
import { useChartInteraction } from './useChartInteraction';
import { useDrawingTool } from './useDrawingTool';
import type { BreakoutFlash } from '../../App';

interface Props {
  candles: Candle[];
  interval: Interval;
  ticker: string;
  drawingMode: DrawingMode;
  setDrawingMode: (m: DrawingMode) => void;
  onDrawingsChange: (drawings: Drawing[]) => void;
  selectedDrawingId?: string | null;
  onSetDeleteFn?: (fn: (id: string) => void) => void;
  onSetUpdateMemoFn?: (fn: (id: string, memo: string) => void) => void;
  onSetUpdateColorFn?: (fn: (id: string, color: string) => void) => void;
  onSetUpdateActiveFn?: (fn: (id: string, active: boolean) => void) => void;
  flashes?: BreakoutFlash[];
  initialDrawings?: Drawing[];
  activeColor?: string;
  positions?: FuturesPosition[];
  orders?: FuturesOrder[];
  orderTargetPrice?: number | null;
  highlightedDrawingPrice?: number | null;
  conditionalFormPrices?: number[];
  indicators?: IndicatorConfig;
}

const PADDING = { left: 0, right: 70, top: 8, bottom: 24 };
const FLASH_DURATION = 4500;

export function CandleChart({
  candles,
  interval,
  ticker,
  drawingMode,
  setDrawingMode,
  onDrawingsChange,
  selectedDrawingId,
  onSetDeleteFn,
  onSetUpdateMemoFn,
  onSetUpdateColorFn,
  onSetUpdateActiveFn,
  flashes = [],
  initialDrawings = [],
  activeColor = '#3b8beb',
  positions = [],
  orders = [],
  orderTargetPrice,
  highlightedDrawingPrice,
  conditionalFormPrices = [],
  indicators = { coinDuckMABB: false, dwCloud: false },
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashCanvasRef = useRef<HTMLCanvasElement>(null);
  const orderCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [layout, setLayout] = useState<ChartLayout>({
    width: 800, height: 500,
    paddingLeft: PADDING.left,
    paddingRight: PADDING.right,
    paddingTop: PADDING.top,
    paddingBottom: PADDING.bottom,
  });

  const [viewport, setViewport] = useState<ChartViewport>({
    startIdx: 0, endIdx: 1, minPrice: 0, maxPrice: 1,
  });

  const [crosshair, setCrosshair] = useState({ x: 0, y: 0, visible: false });

  // ── Viewport management refs ──────────────────────────────────────────
  const isYManualRef = useRef(false);
  const initializedTickerRef = useRef(''); // tracks `${ticker}-${interval}` to detect changes
  const prevCandlesLenRef = useRef(0);

  // Keep viewport in a ref for the flash animation loop
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  // ── Responsive resize ─────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setLayout(prev => ({ ...prev, width, height }));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Viewport management ───────────────────────────────────────────────
  useEffect(() => {
    if (candles.length === 0) return;

    // Case 1: New ticker or interval → full viewport reset
    const tickerIntervalKey = `${ticker}-${interval}`;
    if (initializedTickerRef.current !== tickerIntervalKey) {
      initializedTickerRef.current = tickerIntervalKey;
      prevCandlesLenRef.current = candles.length;
      isYManualRef.current = false;
      const RIGHT_PAD = 10; // blank candle slots to the right of last candle
      const startIdx = Math.max(0, candles.length - 130);
      const endIdx = candles.length + RIGHT_PAD;
      const { minPrice, maxPrice } = autoFitPriceRange(candles, startIdx, endIdx);
      // Sync viewportRef immediately so the canvas effect uses the correct values
      // even before setViewport triggers a re-render
      viewportRef.current = { startIdx, endIdx, minPrice, maxPrice };
      setViewport({ startIdx, endIdx, minPrice, maxPrice });
      return;
    }

    // Case 2: Same ticker, candle update (WS tick)
    if (candles.length <= prevCandlesLenRef.current) {
      prevCandlesLenRef.current = candles.length;
      return;
    }

    // Case 3: New candle appended → auto-scroll if at right edge
    const prevLen = prevCandlesLenRef.current;
    prevCandlesLenRef.current = candles.length;

    setViewport(prev => {
      const RIGHT_PAD = 10;
      const wasAtRightEdge = prev.endIdx >= prevLen + RIGHT_PAD - 0.5;
      if (!wasAtRightEdge) return prev;

      const range = prev.endIdx - prev.startIdx;
      const newEnd = candles.length + RIGHT_PAD;
      const newStart = Math.max(0, newEnd - range);

      if (!isYManualRef.current) {
        const { minPrice, maxPrice } = autoFitPriceRange(candles, newStart, newEnd);
        return { startIdx: newStart, endIdx: newEnd, minPrice, maxPrice };
      }
      return { ...prev, startIdx: newStart, endIdx: newEnd };
    });
  }, [candles, ticker, interval]);

  // ── Drawing tool ──────────────────────────────────────────────────────
  const {
    drawings, previewDrawing, hoverHandle, draggingHandle, cursor,
    onMouseMove: drawMouseMove,
    onMouseDown: drawMouseDown,
    onMouseUp: drawMouseUp,
    onContextMenu,
    deleteDrawing,
    updateDrawingMemo,
    updateDrawingColor,
    updateDrawingActive,
  } = useDrawingTool(candles, ticker, layout, viewport, drawingMode, setDrawingMode, initialDrawings, activeColor);

  useEffect(() => { onDrawingsChange(drawings); }, [drawings, onDrawingsChange]);
  useEffect(() => { onSetDeleteFn?.(deleteDrawing); }, [onSetDeleteFn, deleteDrawing]);
  useEffect(() => { onSetUpdateMemoFn?.(updateDrawingMemo); }, [onSetUpdateMemoFn, updateDrawingMemo]);
  useEffect(() => { onSetUpdateColorFn?.(updateDrawingColor); }, [onSetUpdateColorFn, updateDrawingColor]);
  useEffect(() => { onSetUpdateActiveFn?.(updateDrawingActive); }, [onSetUpdateActiveFn, updateDrawingActive]);

  // ── Interaction (zoom/pan) ────────────────────────────────────────────
  const isDrawing = drawingMode !== 'none';
  const {
    onWheel,
    onMouseDown: interactMouseDown,
    onMouseMove: interactMouseMove,
    onMouseUp: interactMouseUp,
    onMouseLeave,
    onDoubleClick,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  } = useChartInteraction({
    candles, layout, setViewport, setCrosshair, isDrawing, isYManualRef,
  });

  // ── Merge handlers ────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    interactMouseMove(e);
    drawMouseMove(e);
  }, [interactMouseMove, drawMouseMove]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // If the cursor is over a drawing handle, only drag the handle — never pan
    if (hoverHandle) {
      drawMouseDown(e);
      return;
    }
    interactMouseDown(e);
    drawMouseDown(e);
  }, [interactMouseDown, drawMouseDown, hoverHandle]);

  const handleMouseUp = useCallback((_e: React.MouseEvent) => {
    interactMouseUp();
    drawMouseUp();
  }, [interactMouseUp, drawMouseUp]);

  // ── Candle-close countdown (seconds remaining in current bar) ────────
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    const INTERVAL_SEC: Record<string, number> = {
      '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
    };
    const period = INTERVAL_SEC[interval] ?? 60;
    const update = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      setCountdown(period - (nowSec % period));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [interval]);

  // ── Renderer ──────────────────────────────────────────────────────────
  const { render } = useChartRenderer(
    candles, interval, drawings, previewDrawing,
    crosshair, hoverHandle, draggingHandle,
    positions, orders, countdown, indicators,
  );

  // ── Delete key ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        deleteDrawing(selectedDrawingId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedDrawingId, deleteDrawing]);

  // ── Wheel — must be non-passive for preventDefault ────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => onWheel(e);
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [onWheel]);

  // ── Touch — non-passive for preventDefault (needed for smooth scroll block) ──
  // When in drawing mode, single-touch is routed to the drawing tool instead of pan/zoom.
  // Strategy:
  //   touchstart  → drawMouseDown  (sets first point for trendline/box; creates hline instantly)
  //   touchmove   → drawMouseMove  (rubber-band preview)
  //   touchend    → drawMouseDown  (completes trendline/box at lift position) + drawMouseUp
  //   hline mode  → completes on touchstart, touchend is a no-op for drawing

  // Refs so the touch closures always see the latest functions without re-registering listeners.
  const drawModeRef        = useRef(drawingMode);
  drawModeRef.current      = drawingMode;
  const drawMouseDownRef   = useRef(drawMouseDown);
  drawMouseDownRef.current = drawMouseDown;
  const drawMouseMoveRef   = useRef(drawMouseMove);
  drawMouseMoveRef.current = drawMouseMove;
  const drawMouseUpRef     = useRef(drawMouseUp);
  drawMouseUpRef.current   = drawMouseUp;
  // True while a two-point drawing (trendline/box) is in progress via touch
  const touchDrawingActiveRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Build a minimal synthetic event that satisfies the drawing tool's needs.
    // The drawing tool reads: e.button, e.clientX/Y, e.currentTarget (for getBoundingClientRect).
    const makeSynth = (clientX: number, clientY: number) =>
      ({ clientX, clientY, button: 0, currentTarget: canvas } as unknown as React.MouseEvent);

    const startH = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const mode = drawModeRef.current;
        if (mode !== 'none') {
          const t = e.touches[0];
          drawMouseDownRef.current(makeSynth(t.clientX, t.clientY));
          // hline creates instantly on mouseDown; trendline/box needs a second point on touchend
          touchDrawingActiveRef.current = mode === 'trendline' || mode === 'box';
          return;
        }
      }
      touchDrawingActiveRef.current = false;
      onTouchStart(e);
    };

    const moveH = (e: TouchEvent) => {
      e.preventDefault();
      if (touchDrawingActiveRef.current && e.touches.length === 1) {
        drawMouseMoveRef.current(makeSynth(e.touches[0].clientX, e.touches[0].clientY));
        return;
      }
      onTouchMove(e);
    };

    const endH = (e: TouchEvent) => {
      if (touchDrawingActiveRef.current && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        drawMouseDownRef.current(makeSynth(t.clientX, t.clientY)); // second point → completes drawing
        drawMouseUpRef.current();
        touchDrawingActiveRef.current = false;
        return;
      }
      touchDrawingActiveRef.current = false;
      onTouchEnd(e);
    };

    canvas.addEventListener('touchstart', startH, { passive: false });
    canvas.addEventListener('touchmove',  moveH,  { passive: false });
    canvas.addEventListener('touchend',   endH,   { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', startH);
      canvas.removeEventListener('touchmove',  moveH);
      canvas.removeEventListener('touchend',   endH);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]); // refs keep drawing functions up-to-date without re-registering

  // ── Order target price marker — rAF loop on separate canvas ──────────
  const orderTargetPriceRef = useRef(orderTargetPrice);
  orderTargetPriceRef.current = orderTargetPrice;
  const highlightedDrawingPriceRef = useRef(highlightedDrawingPrice);
  highlightedDrawingPriceRef.current = highlightedDrawingPrice;
  const conditionalFormPricesRef = useRef(conditionalFormPrices);
  conditionalFormPricesRef.current = conditionalFormPrices;

  useEffect(() => {
    const oc = orderCanvasRef.current;
    if (!oc) return;
    if (!orderTargetPrice && !highlightedDrawingPrice && !conditionalFormPrices.length) {
      const ctx = oc.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, oc.width, oc.height);
      return;
    }

    let animId: number;

    const loop = () => {
      const oc = orderCanvasRef.current;
      if (!oc) return;
      const dpr = window.devicePixelRatio || 1;
      oc.width = layoutRef.current.width * dpr;
      oc.height = layoutRef.current.height * dpr;
      oc.style.width = `${layoutRef.current.width}px`;
      oc.style.height = `${layoutRef.current.height}px`;
      const ctx = oc.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, layoutRef.current.width, layoutRef.current.height);

      const curPrice = candlesRef.current[candlesRef.current.length - 1]?.close ?? 0;

      const price = orderTargetPriceRef.current;
      if (price) {
        const phase = (Date.now() % 2000) / 2000;
        drawOrderTargetLine(ctx, layoutRef.current, viewportRef.current, price, curPrice, phase);
      }

      const hlPrice = highlightedDrawingPriceRef.current;
      if (hlPrice) {
        const tapPhase = (Date.now() % 1200) / 1200;
        drawDrawingHighlightArrow(ctx, layoutRef.current, viewportRef.current, hlPrice, tapPhase);
      }

      const coPrices = conditionalFormPricesRef.current;
      if (coPrices.length > 0) {
        const coPhase = (Date.now() % 2000) / 2000;
        const coLabels = ['진입', '청산'];
        for (let i = 0; i < coPrices.length; i++) {
          drawConditionalPriceLine(ctx, layoutRef.current, viewportRef.current, coPrices[i], curPrice, coPhase, coLabels[i] ?? '조건');
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderTargetPrice, highlightedDrawingPrice, conditionalFormPrices.length]);

  // ── Canvas render ─────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = layout.width * dpr;
    canvas.height = layout.height * dpr;
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    ctx.scale(dpr, dpr);

    if (candles.length === 0) {
      ctx.fillStyle = '#131722';
      ctx.fillRect(0, 0, layout.width, layout.height);
      ctx.fillStyle = '#4a5568';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('데이터 로딩 중...', layout.width / 2, layout.height / 2);
      return;
    }

    // Use viewportRef.current so we always get the freshest value —
    // this prevents the blank-frame when the viewport effect updates
    // viewportRef.current synchronously before setViewport is processed.
    render(ctx, layout, viewportRef.current);
  }, [candles, layout, viewport, render]);

  // ── Flash overlay — requestAnimationFrame loop ────────────────────────
  useEffect(() => {
    if (flashes.length === 0) {
      // Clear overlay when no flashes
      const fc = flashCanvasRef.current;
      if (fc) {
        const ctx = fc.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, fc.width, fc.height);
      }
      return;
    }

    let animId: number;

    const loop = () => {
      const fc = flashCanvasRef.current;
      if (!fc) return;

      const dpr = window.devicePixelRatio || 1;
      fc.width = layoutRef.current.width * dpr;
      fc.height = layoutRef.current.height * dpr;
      fc.style.width = `${layoutRef.current.width}px`;
      fc.style.height = `${layoutRef.current.height}px`;

      const ctx = fc.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, layoutRef.current.width, layoutRef.current.height);

      const now = Date.now();
      let anyActive = false;

      for (const flash of flashes) {
        const elapsed = now - flash.startTime;
        if (elapsed >= FLASH_DURATION) continue;
        anyActive = true;
        drawFlash(ctx, layoutRef.current, viewportRef.current, candlesRef.current, flash, elapsed);
      }

      if (anyActive) {
        animId = requestAnimationFrame(loop);
      } else {
        ctx.clearRect(0, 0, layoutRef.current.width, layoutRef.current.height);
      }
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [flashes]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#131722', touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={onMouseLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
      {/* Order target price animation — below flash overlay */}
      <canvas
        ref={orderCanvasRef}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      />
      {/* Flash animation overlay — pointer-events: none so mouse still reaches chart */}
      <canvas
        ref={flashCanvasRef}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}

// ── Flash animation drawing ───────────────────────────────────────────────────
function drawFlash(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  vp: ChartViewport,
  candles: Candle[],
  flash: BreakoutFlash,
  elapsed: number,
) {
  const t = elapsed / FLASH_DURATION; // 0 → 1
  const { price: area } = getChartAreas(layout);

  const isLong = flash.direction === 'long';
  const rgb    = isLong ? '14,203,129' : '246,70,93';
  const color  = isLong ? '#0ecb81'    : '#f6465d';

  // Fade out in last 25 %
  const alpha = t > 0.75 ? (1 - t) / 0.25 : 1.0;

  // Y position — breakout price level
  const py = priceToY(flash.price, vp, area);
  if (py < area.y - 60 || py > area.y + area.h + 60) return;

  // X position — the candle that triggered
  const ci = candles.findIndex(c => c.time === flash.candleTime);
  const px = ci >= 0
    ? idxToX(ci + 0.5, vp, area)
    : area.x + area.w * 0.75;

  ctx.save();

  // ① Full-screen flash on first 150 ms
  if (elapsed < 150) {
    const fAlpha = ((150 - elapsed) / 150) * 0.35 * alpha;
    ctx.fillStyle = `rgba(${rgb},${fAlpha})`;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }

  // ② Horizontal glow line at breakout price
  ctx.shadowBlur = 24;
  ctx.shadowColor = color;
  ctx.strokeStyle = `rgba(${rgb},${alpha * 0.9})`;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(area.x, py);
  ctx.lineTo(area.x + area.w, py);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ③ Price band highlight
  const bandH = 48;
  const grad = ctx.createLinearGradient(area.x, py - bandH / 2, area.x, py + bandH / 2);
  grad.addColorStop(0,   `rgba(${rgb},0)`);
  grad.addColorStop(0.5, `rgba(${rgb},${alpha * 0.18})`);
  grad.addColorStop(1,   `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(area.x, py - bandH / 2, area.w, bandH);

  // ④ Expanding concentric rings at candle position
  const numRings = 4;
  for (let r = 0; r < numRings; r++) {
    const phase  = ((t * 1.8) + r / numRings) % 1;
    const radius = phase * 90;
    const rAlpha = (1 - phase) * alpha * 0.85;
    if (rAlpha <= 0) continue;

    ctx.shadowBlur  = 12;
    ctx.shadowColor = color;
    ctx.strokeStyle = `rgba(${rgb},${rAlpha})`;
    ctx.lineWidth   = 2.5 - r * 0.4;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // ⑤ Bright center dot at candle
  const dotPulse = 0.5 + 0.5 * Math.sin(elapsed / 80);
  const dotR     = 6 + dotPulse * 4;
  ctx.shadowBlur  = 20;
  ctx.shadowColor = color;
  ctx.fillStyle   = `rgba(${rgb},${alpha})`;
  ctx.beginPath();
  ctx.arc(px, py, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // ⑥ Alert text + drawing label + price
  const dirLabel = isLong ? '▲  LONG BREAKOUT' : '▼  SHORT BREAKOUT';
  const textCX = area.x + area.w * 0.5;
  // Place text above or below the price line to avoid overlap
  const textY  = py < area.y + area.h * 0.4
    ? py + 56
    : py - 52;

  ctx.shadowBlur  = 28;
  ctx.shadowColor = color;
  ctx.font        = `bold 20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
  ctx.textAlign   = 'center';
  ctx.fillStyle   = `rgba(${rgb},${alpha})`;
  ctx.fillText(dirLabel, textCX, textY);

  // Drawing name (which drawing triggered this)
  if (flash.drawingLabel) {
    ctx.shadowBlur = 10;
    ctx.font       = `bold 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
    ctx.fillStyle  = `rgba(${rgb},${alpha * 0.9})`;
    ctx.fillText(flash.drawingLabel, textCX, textY + 20);
  }

  // Price sub-label
  ctx.shadowBlur  = 14;
  ctx.font        = `12px "SF Mono","Cascadia Code",Consolas,monospace`;
  ctx.fillStyle   = `rgba(255,255,255,${alpha * 0.75})`;
  ctx.fillText(`@ ${flash.price.toFixed(2)}`, textCX, textY + (flash.drawingLabel ? 38 : 20));
  ctx.shadowBlur  = 0;

  // ⑦ Ticker-wide pulse bar (horizontal sweep across bottom of price area)
  const sweepPhase = (t * 2.2) % 1;
  const sweepX     = area.x + sweepPhase * area.w;
  const sweepGrad  = ctx.createLinearGradient(sweepX - 80, 0, sweepX + 80, 0);
  sweepGrad.addColorStop(0,   `rgba(${rgb},0)`);
  sweepGrad.addColorStop(0.5, `rgba(${rgb},${alpha * 0.6})`);
  sweepGrad.addColorStop(1,   `rgba(${rgb},0)`);
  ctx.fillStyle = sweepGrad;
  ctx.fillRect(sweepX - 80, py - 1, 160, 3);

  ctx.restore();
}

// ── Drawing highlight arrow (bouncing / tapping animation) ───────────────────
function drawDrawingHighlightArrow(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  vp: ChartViewport,
  price: number,
  tapPhase: number, // 0–1, one tap cycle per 1.2 s
) {
  const { price: area } = getChartAreas(layout);
  const y = priceToY(price, vp, area);
  if (y < area.y - 50 || y > area.y + area.h + 10) return;

  const cx = area.x + area.w / 2;
  // Smooth bounce: sin(tapPhase * π) → 0 at contact, 1 at peak
  const bounce = Math.sin(tapPhase * Math.PI);
  // Tip of arrowhead (very bottom): rests ~4 px above the line when pressed
  const tipY = y - 4 - bounce * 42;

  const headH = 11;
  const headW = 9;
  const stemLen = 22;
  const headBaseY = tipY - headH;
  const stemTopY  = headBaseY - stemLen;

  const rgb   = '240,185,11';
  const color = '#f0b90b';

  ctx.save();

  // ① Dashed horizontal guide at the price level
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = `rgba(${rgb},0.22)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.x + 4, y);
  ctx.lineTo(area.x + area.w - 4, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // ② Ripple rings when the arrow tip is near the price line
  if (bounce < 0.2) {
    const t = (0.2 - bounce) / 0.2; // 0→1 as bounce→0
    for (let i = 0; i < 3; i++) {
      const rr = 10 + i * 9 + t * 5;
      const ra = t * (0.5 - i * 0.14);
      if (ra <= 0) continue;
      ctx.strokeStyle = `rgba(${rgb},${ra})`;
      ctx.lineWidth = 1.5 - i * 0.35;
      ctx.beginPath();
      ctx.arc(cx, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ③ Stem
  ctx.shadowBlur = 10;
  ctx.shadowColor = color;
  ctx.strokeStyle = `rgba(${rgb},0.88)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, stemTopY);
  ctx.lineTo(cx, headBaseY);
  ctx.stroke();

  // ④ Arrowhead (downward-pointing triangle)
  ctx.fillStyle = `rgba(${rgb},0.9)`;
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(cx - headW, headBaseY);
  ctx.lineTo(cx + headW, headBaseY);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // ⑤ Small price label above the stem
  const priceStr = formatPrice(price);
  ctx.font = `bold 10px "SF Mono",Consolas,monospace`;
  const tw = ctx.measureText(priceStr).width;
  const lx = cx - tw / 2 - 4;
  const ly = stemTopY - 14;
  ctx.fillStyle = `rgba(30,34,45,0.85)`;
  ctx.fillRect(lx - 1, ly, tw + 10, 14);
  ctx.strokeStyle = `rgba(${rgb},0.35)`;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(lx - 1, ly, tw + 10, 14);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(priceStr, cx, ly + 10);

  ctx.restore();
}

// ── Order target price animation ──────────────────────────────────────────────
function drawOrderTargetLine(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  vp: ChartViewport,
  price: number,
  currentPrice: number,
  phase: number, // 0–1, one cycle per 2 s
) {
  const { price: area } = getChartAreas(layout);
  const y = priceToY(price, vp, area);
  if (y < area.y - 12 || y > area.y + area.h + 12) return;

  const pct = currentPrice > 0 ? ((price / currentPrice) - 1) * 100 : 0;
  const pctSign = pct >= 0 ? '+' : '';
  const pulse = Math.sin(phase * Math.PI * 2); // –1 → +1
  const rgb = '240,185,11';
  const color = '#f0b90b';

  ctx.save();

  // ① Subtle background band (pulsing opacity)
  const bandH = 28;
  const bandAlpha = 0.04 + 0.025 * Math.abs(pulse);
  const band = ctx.createLinearGradient(area.x, y - bandH / 2, area.x, y + bandH / 2);
  band.addColorStop(0,   `rgba(${rgb},0)`);
  band.addColorStop(0.5, `rgba(${rgb},${bandAlpha})`);
  band.addColorStop(1,   `rgba(${rgb},0)`);
  ctx.fillStyle = band;
  ctx.fillRect(area.x, y - bandH / 2, area.w, bandH);

  // ② Marching-ant dashed line
  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  ctx.strokeStyle = `rgba(${rgb},0.9)`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 5]);
  ctx.lineDashOffset = -phase * 13; // 13 = dash(8) + gap(5) → full cycle per phase
  ctx.beginPath();
  ctx.moveTo(area.x + 18, y);
  ctx.lineTo(area.x + area.w, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // ③ Pulsing diamond on left edge
  const dR = 4 + 1.5 * ((pulse + 1) / 2); // 4 → 5.5
  ctx.shadowBlur = 12;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(area.x + 8, y - dR);
  ctx.lineTo(area.x + 8 + dR, y);
  ctx.lineTo(area.x + 8, y + dR);
  ctx.lineTo(area.x + 8 - dR, y);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // ④ Arrow-shaped price tag in the Y-axis strip
  const tagX  = area.x + area.w + 1;
  const tagW  = layout.paddingRight - 3;
  const tagH  = 30;
  const notch = 5;
  const tagAlpha = 0.88 + 0.1 * ((pulse + 1) / 2);

  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  ctx.fillStyle = `rgba(${rgb},${tagAlpha})`;
  ctx.beginPath();
  ctx.moveTo(tagX, y);
  ctx.lineTo(tagX + notch, y - tagH / 2);
  ctx.lineTo(tagX + tagW, y - tagH / 2);
  ctx.lineTo(tagX + tagW, y + tagH / 2);
  ctx.lineTo(tagX + notch, y + tagH / 2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // Tag text
  const txtX = tagX + notch + (tagW - notch) / 2;
  ctx.fillStyle = '#0d0f17';
  ctx.textAlign = 'center';
  ctx.font = `bold 10px "SF Mono",Consolas,monospace`;
  ctx.fillText(formatPrice(price), txtX, y - 2);
  ctx.font = `bold 9px "SF Mono",Consolas,monospace`;
  ctx.fillStyle = pct >= 0 ? '#155735' : '#7a1c28';
  ctx.fillText(`${pctSign}${pct.toFixed(2)}%`, txtX, y + 9);

  ctx.restore();
}

// ── Conditional order form price overlay (cyan) ───────────────────────────────
function drawConditionalPriceLine(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  vp: ChartViewport,
  price: number,
  currentPrice: number,
  phase: number, // 0–1, one cycle per 2 s
  label: string, // e.g. "진입" or "청산"
) {
  const { price: area } = getChartAreas(layout);
  const y = priceToY(price, vp, area);
  if (y < area.y - 12 || y > area.y + area.h + 12) return;

  const pct = currentPrice > 0 ? ((price / currentPrice) - 1) * 100 : 0;
  const pctSign = pct >= 0 ? '+' : '';
  const rgb = '34,211,238'; // #22d3ee cyan
  const color = '#22d3ee';

  ctx.save();

  // ① Subtle background band
  const bandH = 22;
  const band = ctx.createLinearGradient(area.x, y - bandH / 2, area.x, y + bandH / 2);
  band.addColorStop(0,   `rgba(${rgb},0)`);
  band.addColorStop(0.5, `rgba(${rgb},0.04)`);
  band.addColorStop(1,   `rgba(${rgb},0)`);
  ctx.fillStyle = band;
  ctx.fillRect(area.x, y - bandH / 2, area.w, bandH);

  // ② Marching-ant dashed line
  ctx.strokeStyle = `rgba(${rgb},0.65)`;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 5]);
  ctx.lineDashOffset = -phase * 11;
  ctx.beginPath();
  ctx.moveTo(area.x + 14, y);
  ctx.lineTo(area.x + area.w, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // ③ Small diamond on left edge
  const dR = 3.5;
  ctx.shadowBlur = 10;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(area.x + 7, y - dR);
  ctx.lineTo(area.x + 7 + dR, y);
  ctx.lineTo(area.x + 7, y + dR);
  ctx.lineTo(area.x + 7 - dR, y);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // ④ Arrow-shaped price tag in the Y-axis strip
  const tagX  = area.x + area.w + 1;
  const tagW  = layout.paddingRight - 3;
  const tagH  = 30;
  const notch = 4;

  ctx.fillStyle = `rgba(${rgb},0.82)`;
  ctx.beginPath();
  ctx.moveTo(tagX, y);
  ctx.lineTo(tagX + notch, y - tagH / 2);
  ctx.lineTo(tagX + tagW, y - tagH / 2);
  ctx.lineTo(tagX + tagW, y + tagH / 2);
  ctx.lineTo(tagX + notch, y + tagH / 2);
  ctx.closePath();
  ctx.fill();

  // Tag text — label on top row, price on second row
  const txtX = tagX + notch + (tagW - notch) / 2;
  ctx.fillStyle = '#0d1520';
  ctx.textAlign = 'center';
  ctx.font = `bold 8px "SF Mono",Consolas,monospace`;
  ctx.fillText(`${label} ${pctSign}${pct.toFixed(1)}%`, txtX, y - 2);
  ctx.font = `bold 10px "SF Mono",Consolas,monospace`;
  ctx.fillText(formatPrice(price), txtX, y + 9);

  ctx.restore();
}
