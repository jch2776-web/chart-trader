import React, {
  useRef, useEffect, useState, useCallback, useLayoutEffect, useMemo,
} from 'react';
import type { Candle, Interval } from '../../types/candle';
import type { Drawing, DrawingMode, L2LBacktestSummary, L2LOverlay, L2LSetup } from '../../types/drawing';
import type { FuturesPosition, FuturesOrder } from '../../types/futures';
import type { ChartViewport, ChartLayout } from './chartMath';
import { autoFitPriceRange, getChartAreas, idxToX, priceToY, timeToCandleIdx, pointToPixel } from './chartMath';
import { calcSRLevels } from '../AltScanner/supportResistance';
import type { LevelZone } from '../AltScanner/supportResistance';
import { buildRetestCandidates } from '../AltScanner/features/retestCandidates';
import type { RetestCandidate } from '../AltScanner/features/retestCandidates';
import { scoreRetestCandidate } from '../AltScanner/features/retestScoring';
import type { RetestScoreBreakdown } from '../AltScanner/features/retestScoring';
import { buildLeaderRetestOrderPlan } from '../AltScanner/features/orderPlan';
import type { OrderPlan } from '../AltScanner/features/orderPlan';
import { fetchBinanceKlinesCached, fetchBinanceKlinesOlder } from '../../lib/binanceKlineCache';
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
  onSetUpdateTextFn?: (fn: (id: string, text: string, fontSize?: number) => void) => void;
  onSetUndoFn?: (fn: () => void) => void;
  onSetRedoFn?: (fn: () => void) => void;
  flashes?: BreakoutFlash[];
  initialDrawings?: Drawing[];
  activeColor?: string;
  positions?: FuturesPosition[];
  orders?: FuturesOrder[];
  tp1Lines?: Array<{ price: number; hit: boolean }>;
  orderTargetPrice?: number | null;
  highlightedDrawingPrice?: number | null;
  conditionalFormPrices?: number[];
  indicators?: IndicatorConfig;
  showL2L?: boolean;
  textFontSize?: number;
  brushLineWidth?: number;
  initialViewportConfig?: {
    visibleBars?: number;
    rightPad?: number;
    minPrice?: number;
    maxPrice?: number;
  };
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
  onSetUpdateTextFn,
  onSetUndoFn,
  onSetRedoFn,
  flashes = [],
  initialDrawings = [],
  activeColor = '#3b8beb',
  positions = [],
  orders = [],
  tp1Lines = [],
  orderTargetPrice,
  highlightedDrawingPrice,
  conditionalFormPrices = [],
  indicators = { coinDuckMABB: false, dwCloud: false },
  showL2L = false,
  textFontSize = 13,
  brushLineWidth = 8,
  initialViewportConfig,
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
  const prevTickerRef = useRef('');
  const visibleTimeRangeRef = useRef<[number, number] | null>(null);

  // Keep viewport in a ref for the flash animation loop
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  // ── Infinite scroll — older candle lazy loading ───────────────────────
  const [extraCandles, setExtraCandles] = useState<Candle[]>([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const isFetchingOlderRef  = useRef(false);
  const hasNoMoreOlderRef   = useRef(false);
  const extraCandlesLenRef  = useRef(0);

  // Merged array: older extras prepended to live candles
  const allCandles = useMemo(() => {
    if (extraCandles.length === 0) return candles;
    const liveSet = new Set(candles.map(c => c.time));
    const prefix  = extraCandles.filter(c => !liveSet.has(c.time));
    return prefix.length === 0 ? candles : [...prefix, ...candles];
  }, [candles, extraCandles]);

  // Reset extras when ticker or interval changes
  const prevTickerIntervalRef = useRef('');
  useEffect(() => {
    const key = `${ticker}-${interval}`;
    if (prevTickerIntervalRef.current === key) return;
    prevTickerIntervalRef.current = key;
    setExtraCandles([]);
    extraCandlesLenRef.current  = 0;
    isFetchingOlderRef.current  = false;
    hasNoMoreOlderRef.current   = false;
  }, [ticker, interval]);

  // Shift viewport right when extra candles are prepended
  useEffect(() => {
    const delta = extraCandles.length - extraCandlesLenRef.current;
    extraCandlesLenRef.current = extraCandles.length;
    if (delta <= 0) return;
    prevCandlesLenRef.current += delta;
    setViewport(prev => ({
      ...prev,
      startIdx: prev.startIdx + delta,
      endIdx:   prev.endIdx   + delta,
    }));
  }, [extraCandles]);

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

  // ── Track visible time range (for interval switch preservation) ───────
  useEffect(() => {
    if (allCandles.length === 0) return;
    const s = allCandles[Math.max(0, Math.floor(viewport.startIdx))]?.time;
    const e = allCandles[Math.min(allCandles.length - 1, Math.ceil(viewport.endIdx))]?.time;
    if (s && e) visibleTimeRangeRef.current = [s, e];
  }, [viewport.startIdx, viewport.endIdx, allCandles]);

  // ── Viewport management ───────────────────────────────────────────────
  useEffect(() => {
    if (allCandles.length === 0) return;

    const rightPad = initialViewportConfig?.rightPad ?? 10;
    const visibleBars = initialViewportConfig?.visibleBars ?? 260;
    const fitPriceRange = (startIdx: number, endIdx: number) => {
      const fitted = autoFitPriceRange(allCandles, startIdx, endIdx);
      return {
        minPrice: initialViewportConfig?.minPrice ?? fitted.minPrice,
        maxPrice: initialViewportConfig?.maxPrice ?? fitted.maxPrice,
      };
    };

    // Case 1: New ticker or interval → viewport reset (preserve time range if same ticker)
    const tickerIntervalKey = `${ticker}-${interval}`;
    if (initializedTickerRef.current !== tickerIntervalKey) {
      const sameTicker = prevTickerRef.current === ticker;
      prevTickerRef.current = ticker;
      initializedTickerRef.current = tickerIntervalKey;
      prevCandlesLenRef.current = allCandles.length;
      isYManualRef.current = false;

      if (sameTicker && visibleTimeRangeRef.current) {
        const [visStart, visEnd] = visibleTimeRangeRef.current;
        const si = Math.max(0, Math.floor(timeToCandleIdx(visStart, allCandles)));
        const ei = Math.ceil(timeToCandleIdx(visEnd, allCandles)) + rightPad;
        const { minPrice, maxPrice } = fitPriceRange(si, ei);
        viewportRef.current = { startIdx: si, endIdx: ei, minPrice, maxPrice };
        setViewport({ startIdx: si, endIdx: ei, minPrice, maxPrice });
      } else {
        const startIdx = Math.max(0, allCandles.length - visibleBars);
        const endIdx = allCandles.length + rightPad;
        const { minPrice, maxPrice } = fitPriceRange(startIdx, endIdx);
        viewportRef.current = { startIdx, endIdx, minPrice, maxPrice };
        setViewport({ startIdx, endIdx, minPrice, maxPrice });
      }
      return;
    }

    // Case 2: Same ticker, candle update (WS tick — last candle mutated, count unchanged)
    // Also covers the "extra candles prepended" case (prevCandlesLenRef was already shifted).
    if (allCandles.length <= prevCandlesLenRef.current) {
      prevCandlesLenRef.current = allCandles.length;
      if (!isYManualRef.current) {
        const lastCandle = allCandles[allCandles.length - 1];
        setViewport(prev => {
          const margin = (prev.maxPrice - prev.minPrice) * 0.05;
          const newMin = lastCandle.low  < prev.minPrice + margin ? lastCandle.low  - margin : prev.minPrice;
          const newMax = lastCandle.high > prev.maxPrice - margin ? lastCandle.high + margin : prev.maxPrice;
          if (newMin === prev.minPrice && newMax === prev.maxPrice) return prev;
          return { ...prev, minPrice: newMin, maxPrice: newMax };
        });
      }
      return;
    }

    // Case 3: New candle appended at right edge → auto-scroll
    const prevLen = prevCandlesLenRef.current;
    prevCandlesLenRef.current = allCandles.length;

    setViewport(prev => {
      const wasAtRightEdge = prev.endIdx >= prevLen + rightPad - 0.5;
      if (!wasAtRightEdge) return prev;

      const range = prev.endIdx - prev.startIdx;
      const newEnd = allCandles.length + rightPad;
      const newStart = Math.max(0, newEnd - range);

      if (!isYManualRef.current) {
        const { minPrice, maxPrice } = fitPriceRange(newStart, newEnd);
        return { startIdx: newStart, endIdx: newEnd, minPrice, maxPrice };
      }
      return { ...prev, startIdx: newStart, endIdx: newEnd };
    });
  }, [allCandles, ticker, interval, initialViewportConfig]);

  // ── Fetch older candles when scrolled near left edge ──────────────────
  const oldestCandleTime = allCandles[0]?.time ?? 0;
  useEffect(() => {
    const THRESHOLD   = 80;  // bars from left edge to trigger fetch
    const OLDER_BATCH = 500;
    if (viewport.startIdx > THRESHOLD) return;
    if (isFetchingOlderRef.current || hasNoMoreOlderRef.current) return;
    if (oldestCandleTime === 0) return;

    isFetchingOlderRef.current = true;
    setIsLoadingOlder(true);
    const beforeTime = oldestCandleTime;

    fetchBinanceKlinesOlder(ticker, interval, OLDER_BATCH, beforeTime)
      .then(older => {
        const filtered = older.filter(c => c.time < beforeTime);
        if (filtered.length < 10) { hasNoMoreOlderRef.current = true; return; }
        setExtraCandles(prev => {
          const seen     = new Set(prev.map(c => c.time));
          const newItems = filtered.filter(c => !seen.has(c.time));
          if (newItems.length === 0) return prev;
          return [...newItems, ...prev].sort((a, b) => a.time - b.time);
        });
      })
      .catch(() => {})
      .finally(() => {
        isFetchingOlderRef.current = false;
        setIsLoadingOlder(false);
      });
  }, [viewport.startIdx, oldestCandleTime, ticker, interval]);

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
    pendingText,
    confirmPendingText,
    cancelPendingText,
    updateDrawingText,
    undo,
    redo,
  } = useDrawingTool(allCandles, ticker, layout, viewport, drawingMode, setDrawingMode, initialDrawings, activeColor, textFontSize, brushLineWidth);

  useEffect(() => { onDrawingsChange(drawings); }, [drawings, onDrawingsChange]);
  useEffect(() => { onSetDeleteFn?.(deleteDrawing); }, [onSetDeleteFn, deleteDrawing]);
  useEffect(() => { onSetUpdateMemoFn?.(updateDrawingMemo); }, [onSetUpdateMemoFn, updateDrawingMemo]);
  useEffect(() => { onSetUpdateColorFn?.(updateDrawingColor); }, [onSetUpdateColorFn, updateDrawingColor]);
  useEffect(() => { onSetUpdateActiveFn?.(updateDrawingActive); }, [onSetUpdateActiveFn, updateDrawingActive]);
  useEffect(() => { onSetUpdateTextFn?.(updateDrawingText); }, [onSetUpdateTextFn, updateDrawingText]);
  useEffect(() => { onSetUndoFn?.(undo); }, [onSetUndoFn, undo]);
  useEffect(() => { onSetRedoFn?.(redo); }, [onSetRedoFn, redo]);

  // ── Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo ──────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === 'z' && e.shiftKey)  { e.preventDefault(); redo(); }
      if (e.key === 'y')                 { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

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
    candles: allCandles, layout, setViewport, setCrosshair, isDrawing, isYManualRef,
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

  const handleMouseUp = useCallback(() => {
    interactMouseUp();
    drawMouseUp();
  }, [interactMouseUp, drawMouseUp]);

  // ── L2L info panel drag state ─────────────────────────────────────────
  const [l2lPanelPos, setL2lPanelPos] = useState<{ x: number; y: number } | null>(null);
  const l2lDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [l2lMtf, setL2lMtf] = useState<L2LMtfSummary>({
    status: 'idle',
    checked: 0,
    aligned: 0,
    conflicts: 0,
    neutral: 0,
    details: [],
  });
  // Reset panel position when ticker changes or L2L is toggled off
  useEffect(() => { setL2lPanelPos(null); }, [ticker, showL2L]);

  // ── Pending text input state ──────────────────────────────────────────
  const [pendingTextValue, setPendingTextValue] = useState('');
  useEffect(() => { if (pendingText) setPendingTextValue(''); }, [!!pendingText]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Candle-close countdown (seconds remaining in current bar) ────────
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    const INTERVAL_SEC: Record<string, number> = {
      '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800,
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

  // ── L2L Overlay computation ───────────────────────────────────────────
  const l2lOverlay = useMemo((): L2LOverlay | null => {
    if (!showL2L || allCandles.length < 30) return null;
    try {
      const closedCandles = getClosedCandlesForL2L(allCandles, interval);
      if (closedCandles.length < 30) return null;

      const currentPrice = allCandles[allCandles.length - 1]?.close ?? closedCandles[closedCandles.length - 1].close;
      const core = buildL2LCore(closedCandles, ticker, interval);
      const activeSetup = core.setups[0] ?? null;
      return {
        currentPrice,
        asOfClosedTime: closedCandles[closedCandles.length - 1].time,
        srLevels: core.srLevels.map(z => ({
          centerPrice: z.centerPrice,
          zoneTop:     z.zoneTop,
          zoneBottom:  z.zoneBottom,
          kind:        z.kind,
          score:       z.score,
        })),
        setups: core.setups,
        backtest: backtestL2L(closedCandles, ticker, interval),
        filteredBacktest: activeSetup
          ? backtestL2L(closedCandles, ticker, interval, {
              direction: activeSetup.direction,
              minScore: activeSetup.score,
              minRr: 1.5,
            })
          : null,
        filteredOosBacktest: (() => {
          if (!activeSetup) return null;
          const first = Math.max(60, closedCandles.length - L2L_BACKTEST_MAX_SIGNAL_BARS);
          const last  = closedCandles.length - 2;
          const split = first + Math.floor((last - first) * 0.7);
          return backtestL2L(closedCandles, ticker, interval, {
            direction: activeSetup.direction,
            minScore: activeSetup.score,
            minRr: 1.5,
          }, [split + 1, last]);
        })(),
        ...(() => {
          if (!activeSetup) return { filteredWalktestConsistency: null, filteredWalktestFolds: null };
          const wt = walktestL2L(closedCandles, ticker, interval, {
            direction: activeSetup.direction,
            minScore: activeSetup.score,
            minRr: 1.5,
          });
          return {
            filteredWalktestConsistency: wt ? wt.consistency : null,
            filteredWalktestFolds: wt ? wt.foldAvgR : null,
          };
        })(),
      };
    } catch {
      return null;
    }
  // Depend on the last kline time, not the mutable last close, so L2L refreshes
  // when a new candle starts while the displayed current price can still tick live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showL2L, allCandles.length, allCandles[allCandles.length - 1]?.time, ticker, interval]);

  const activeL2LSetup = l2lOverlay?.setups[0] ?? null;
  const activeL2LDirection = activeL2LSetup?.direction ?? null;
  const activeL2LDetectedAt = activeL2LSetup?.detectedAt ?? 0;
  useEffect(() => {
    if (!showL2L || !activeL2LDirection) {
      setL2lMtf({ status: 'idle', checked: 0, aligned: 0, conflicts: 0, neutral: 0, details: [] });
      return;
    }

    const higherIntervals = getL2LHigherIntervals(interval);
    if (higherIntervals.length === 0) {
      setL2lMtf({ status: 'none', checked: 0, aligned: 0, conflicts: 0, neutral: 0, details: [] });
      return;
    }

    let cancelled = false;
    setL2lMtf({ status: 'loading', checked: 0, aligned: 0, conflicts: 0, neutral: 0, details: [] });

    Promise.all(higherIntervals.map(async (higherInterval) => {
      const raw = await fetchBinanceKlinesCached(ticker, higherInterval, 500);
      const closed = getClosedCandlesForL2L(raw, higherInterval);
      const setup = buildL2LCore(closed, ticker, higherInterval).setups[0] ?? null;
      return {
        interval: higherInterval,
        direction: setup?.direction ?? null,
        score: setup?.score ?? 0,
      };
    }))
      .then((signals) => {
        if (cancelled) return;
        const aligned = signals.filter(s => s.direction === activeL2LDirection).length;
        const conflicts = signals.filter(s => s.direction !== null && s.direction !== activeL2LDirection).length;
        const neutral = signals.filter(s => s.direction === null).length;
        setL2lMtf({
          status: 'ready',
          checked: signals.length,
          aligned,
          conflicts,
          neutral,
          details: signals,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setL2lMtf({ status: 'error', checked: 0, aligned: 0, conflicts: 0, neutral: 0, details: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showL2L, ticker, interval, activeL2LDirection, activeL2LDetectedAt]);

  // ── Paper trade log ───────────────────────────────────────────────────
  const currentPrice = allCandles.length > 0 ? allCandles[allCandles.length - 1].close : 0;

  // Signal logger — fires when a TRIGGERED+ENTER setup appears
  useEffect(() => {
    if (!showL2L || !l2lOverlay || allCandles.length === 0) return;
    const setup = l2lOverlay.setups[0];
    if (!setup) return;
    const status = classifyL2LEntry(setup, currentPrice);
    if (status !== 'TRIGGERED') return;
    const filteredBt = l2lOverlay.filteredBacktest;
    const ddOk = !filteredBt || filteredBt.maxDrawdownR <= 3.0;
    const similarEnough = !!filteredBt && filteredBt.trades >= 30;
    const pfOk = !!filteredBt && (filteredBt.profitFactor === null || filteredBt.profitFactor >= 1.1);
    const similarOk = similarEnough && !!filteredBt && filteredBt.avgR > 0 && pfOk && ddOk;
    if (!similarOk) return;

    const key = `l2l_paper_log_${ticker}_${interval}`;
    const logRaw = localStorage.getItem(key);
    const log: L2LPaperEntry[] = logRaw ? JSON.parse(logRaw) : [];

    const id = `${setup.detectedAt}_${setup.direction}_${setup.level.toFixed(6)}`;
    if (log.some(e => e.id === id)) return;

    const risk   = Math.abs(setup.idealEntry - setup.hardStop);
    const reward = Math.abs(setup.tp1 - setup.idealEntry);
    const rr = risk > 0 ? reward / risk : 0;

    log.unshift({
      id, ticker, interval, direction: setup.direction,
      entryPrice: setup.idealEntry, tp1: setup.tp1, hardStop: setup.hardStop,
      score: setup.score, rr,
      loggedAt: Date.now(),
      entryBarTime: allCandles[allCandles.length - 1].time,
      outcome: 'open', exitPrice: null, exitBarTime: null, outcomeR: null,
    });
    if (log.length > 200) log.splice(200);
    localStorage.setItem(key, JSON.stringify(log));
  }, [showL2L, l2lOverlay, currentPrice, ticker, interval]);

  // Outcome checker — resolves open trades on every candle update
  useEffect(() => {
    if (!showL2L || allCandles.length === 0) return;
    const key = `l2l_paper_log_${ticker}_${interval}`;
    const logRaw = localStorage.getItem(key);
    if (!logRaw) return;
    const log: L2LPaperEntry[] = JSON.parse(logRaw);
    const openTrades = log.filter(e => e.outcome === 'open');
    if (openTrades.length === 0) return;

    let changed = false;
    for (const entry of openTrades) {
      const entryIdx = allCandles.findIndex(c => c.time === entry.entryBarTime);
      if (entryIdx < 0) continue;
      const risk = Math.abs(entry.entryPrice - entry.hardStop);
      if (risk <= 0) continue;
      const maxHoldIdx = Math.min(allCandles.length - 1, entryIdx + L2L_BACKTEST_MAX_HOLD_BARS);

      let resolved = false;
      for (let i = entryIdx + 1; i <= maxHoldIdx; i++) {
        const c = allCandles[i];
        const hitStop = entry.direction === 'long' ? c.low <= entry.hardStop : c.high >= entry.hardStop;
        const hitTp   = entry.direction === 'long' ? c.high >= entry.tp1    : c.low  <= entry.tp1;
        if (hitStop || hitTp) {
          entry.outcome    = hitStop ? 'loss' : 'win';
          entry.exitPrice  = hitStop ? entry.hardStop : entry.tp1;
          entry.exitBarTime = c.time;
          entry.outcomeR   = hitStop ? -1 : entry.rr;
          resolved = true; changed = true;
          break;
        }
      }
      if (!resolved && allCandles.length - 1 >= maxHoldIdx) {
        const exitClose = allCandles[maxHoldIdx].close;
        entry.outcome     = 'timeout';
        entry.exitPrice   = exitClose;
        entry.exitBarTime = allCandles[maxHoldIdx].time;
        entry.outcomeR    = entry.direction === 'long'
          ? (exitClose - entry.entryPrice) / risk
          : (entry.entryPrice - exitClose) / risk;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(key, JSON.stringify(log));
  }, [allCandles, ticker, interval, showL2L]);

  // ── Renderer ──────────────────────────────────────────────────────────
  const { render } = useChartRenderer(
    allCandles, interval, ticker, drawings, previewDrawing,
    crosshair, hoverHandle, draggingHandle,
    positions, orders, countdown, indicators, tp1Lines, l2lOverlay,
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
          // hline creates instantly on mouseDown; 2-point tools need a second point on touchend
          touchDrawingActiveRef.current = mode === 'trendline' || mode === 'box' || mode === 'fib' || mode === 'pricerange' || mode === 'daterange';
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

    if (allCandles.length === 0) {
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
      {/* Text / Label input overlay */}
      {pendingText && (() => {
        const area = getChartAreas(layout).price;
        const anchorPt = pendingText.type === 'text' ? pendingText.p : pendingText.p1;
        const pos = pointToPixel(anchorPt, allCandles, viewportRef.current, area);
        const left = Math.min(pos.x + 10, layout.width - 230);
        const top = Math.max(pos.y - 80, 8);
        return (
          <div style={{
            position: 'absolute', left, top, zIndex: 200,
            background: '#1e222d', border: '1px solid #3d4352', borderRadius: 8,
            padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)', minWidth: 200,
          }}>
            <div style={{ fontSize: 11, color: '#848e9c' }}>
              {pendingText.type === 'text' ? '텍스트' : '레이블 텍스트'}
            </div>
            <input
              autoFocus
              value={pendingTextValue}
              onChange={e => setPendingTextValue(e.target.value)}
              placeholder="텍스트 입력..."
              style={{
                background: '#131722', border: '1px solid #3d4352', borderRadius: 4,
                color: '#d1d4dc', padding: '5px 8px', fontSize: 12,
                outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && pendingTextValue.trim()) {
                  confirmPendingText(pendingTextValue.trim(), textFontSize);
                  setPendingTextValue('');
                }
                if (e.key === 'Escape') { cancelPendingText(); setPendingTextValue(''); }
              }}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button onClick={() => { cancelPendingText(); setPendingTextValue(''); }}
                style={{ background: 'none', border: '1px solid #3d4352', borderRadius: 4, color: '#848e9c', cursor: 'pointer', fontSize: 11, padding: '3px 10px', fontFamily: 'inherit' }}>
                취소
              </button>
              <button
                onClick={() => { if (pendingTextValue.trim()) { confirmPendingText(pendingTextValue.trim(), textFontSize); setPendingTextValue(''); } }}
                style={{ background: '#3b8beb22', border: '1px solid #3b8beb55', borderRadius: 4, color: '#3b8beb', cursor: 'pointer', fontSize: 11, padding: '3px 10px', fontFamily: 'inherit', fontWeight: 700 }}>
                확인
              </button>
            </div>
          </div>
        );
      })()}
      {/* Older-candle loading indicator */}
      {isLoadingOlder && (
        <div style={{
          position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)',
          background: 'rgba(19,23,34,0.82)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6, padding: '4px 10px', fontSize: 11, color: '#848e9c',
          pointerEvents: 'none', userSelect: 'none',
        }}>
          이전 데이터 로딩 중...
        </div>
      )}
      {/* L2L — no-setup status badge */}
      {showL2L && l2lOverlay && l2lOverlay.setups.length === 0 && (
        <div style={{
          position: 'absolute', top: 10, right: layout.paddingRight + 10,
          background: 'rgba(19,23,34,0.85)', border: '1px solid #2a3248',
          borderRadius: 6, padding: '5px 12px', fontSize: 11,
          color: '#848e9c', pointerEvents: 'none', userSelect: 'none',
          zIndex: 10,
        }}>
          ⊞ L2L — 현재 구간에서 적합한 패턴 없음
        </div>
      )}

      {/* L2L draggable info panel */}
      {showL2L && l2lOverlay && l2lOverlay.setups.length > 0 && (() => {
        const setup = l2lOverlay.setups[0];
        const cp = candles.length > 0 ? candles[candles.length - 1].close : l2lOverlay.currentPrice;
        const isLong = setup.direction === 'long';
        const entryColor = isLong ? '#0ecb81' : '#f6465d';

        const entryStatus = classifyL2LEntry(setup, cp);

        const statusMeta: Record<L2LEntryStatus, { label: string; color: string; bg: string; desc: string }> = {
          TRIGGERED: { label: '좋은 가격대', color: '#0ecb81', bg: 'rgba(14,203,129,0.18)', desc: '현재가가 진입 가격대 안에 있습니다.' },
          PENDING:   { label: '기다리는 중', color: '#f0b90b', bg: 'rgba(240,185,11,0.15)', desc: isLong
            ? (cp > setup.entryZoneHigh ? '지지선까지 내려오길 기다리는 중' : '레벨 아래 이탈 — 지지 붕괴 위험')
            : (cp < setup.entryZoneLow  ? '저항선까지 올라오길 기다리는 중' : '레벨 위로 침범 — 저항 돌파 주의'),
          },
          LATE:      { label: '너무 늦음', color: '#f59e42', bg: 'rgba(245,158,66,0.15)', desc: isLong ? '가격이 이미 많이 올라 추격 매수 위험이 큽니다.' : '가격이 이미 많이 내려 추격 매도 위험이 큽니다.' },
          INVALID:   { label: '무효', color: '#f6465d', bg: 'rgba(246,70,93,0.15)',  desc: '손절 가격을 지나 이 신호는 폐기합니다.' },
        };
        const sm = statusMeta[entryStatus];

        const scoreInt = Math.round(setup.score * 100);
        type Grade = 'STRONG' | 'GOOD' | 'WEAK' | 'POOR';
        const grade: Grade = scoreInt >= 70 ? 'STRONG' : scoreInt >= 55 ? 'GOOD' : scoreInt >= 40 ? 'WEAK' : 'POOR';
        const gradeMeta: Record<Grade, { label: string; color: string }> = {
          STRONG: { label: '점수 좋음', color: '#0ecb81' },
          GOOD:   { label: '점수 보통+', color: '#38bdf8' },
          WEAK:   { label: '점수 약함', color: '#f0b90b' },
          POOR:   { label: '점수 부족', color: '#f6465d' },
        };
        const gm = gradeMeta[grade];

        const pctFn = (a: number, b: number) => ((Math.abs(a - b) / b) * 100).toFixed(2) + '%';
        const reward = Math.abs(setup.tp1 - setup.idealEntry);
        const risk   = Math.abs(setup.idealEntry - setup.hardStop);
        const rr = risk > 0 ? (reward / risk).toFixed(1) : '—';
        const rrNum = parseFloat(rr);
        const bt = l2lOverlay.backtest;
        const filteredBt = l2lOverlay.filteredBacktest;
        const oosBt = l2lOverlay.filteredOosBacktest;
        const btQualityColor = !bt ? '#5e6673' : bt.sampleQuality === 'HIGH' ? '#0ecb81' : bt.sampleQuality === 'MEDIUM' ? '#f0b90b' : '#f6465d';
        const filteredQualityColor = !filteredBt || filteredBt.candidates === 0 ? '#5e6673' : filteredBt.sampleQuality === 'HIGH' ? '#0ecb81' : filteredBt.sampleQuality === 'MEDIUM' ? '#f0b90b' : '#f6465d';
        const mtfView = describeMtfSummary(l2lMtf);

        const paperLog: L2LPaperEntry[] = (() => {
          try {
            const raw = localStorage.getItem(`l2l_paper_log_${ticker}_${interval}`);
            return raw ? JSON.parse(raw) : [];
          } catch { return []; }
        })();
        const paperClosed = paperLog.filter(e => e.outcome !== 'open' && e.outcomeR !== null);
        const paperOpen   = paperLog.filter(e => e.outcome === 'open').length;
        const paperAvgR   = paperClosed.length > 0
          ? paperClosed.reduce((s, e) => s + (e.outcomeR ?? 0), 0) / paperClosed.length
          : null;
        const paperWins = paperClosed.filter(e => (e.outcomeR ?? 0) > 0).length;
        const tradeDecision = buildL2LTradeDecision(setup, entryStatus, filteredBt, l2lMtf);

        // "N봉 전 감지" — how stale is the setup (computed at last candle close)
        const barsElapsed = setup.barsElapsed;
        const ageColor = barsElapsed <= 2 ? '#0ecb81' : barsElapsed <= 6 ? '#f0b90b' : '#f59e42';
        const ageLabel = barsElapsed === 0 ? '방금 감지' : `${barsElapsed}봉 전 감지`;

        const formatDetectedAt = () => {
          const d = new Date(setup.detectedAt);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const mi = String(d.getMinutes()).padStart(2, '0');
          return `${mm}/${dd} ${hh}:${mi}`;
        };

        const cpArrow = isLong
          ? (cp > setup.entryZoneHigh ? '▲ 가격대 위' : cp < setup.entryZoneLow ? '▼ 가격대 아래' : '● 가격대 안')
          : (cp < setup.entryZoneLow  ? '▼ 가격대 아래' : cp > setup.entryZoneHigh ? '▲ 가격대 위' : '● 가격대 안');
        const cpArrowColor = cpArrow.includes('가격대 안') ? '#0ecb81' : '#f0b90b';

        const panelW = 300;
        const defaultX = layout.width - layout.paddingRight - panelW - 12;
        const defaultY = 12;
        const pos = l2lPanelPos ?? { x: defaultX, y: defaultY };

        const row: React.CSSProperties = {
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '2px 10px', fontSize: 11, lineHeight: '18px',
        };
        const labelStyle: React.CSSProperties = { color: '#848e9c', flexShrink: 0, marginRight: 8 };
        const val: React.CSSProperties        = { color: '#d1d4dc', textAlign: 'right' };

        const handlePanelMouseDown = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const currentPos = l2lPanelPos ?? { x: defaultX, y: defaultY };
          l2lDragRef.current = { startX: e.clientX, startY: e.clientY, origX: currentPos.x, origY: currentPos.y };
          const onMove = (me: MouseEvent) => {
            if (!l2lDragRef.current) return;
            const dx = me.clientX - l2lDragRef.current.startX;
            const dy = me.clientY - l2lDragRef.current.startY;
            setL2lPanelPos({
              x: Math.max(0, Math.min(layout.width - panelW - layout.paddingRight, l2lDragRef.current.origX + dx)),
              y: Math.max(0, Math.min(layout.height - 40, l2lDragRef.current.origY + dy)),
            });
          };
          const onUp = () => {
            l2lDragRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        };

        const mono = '"SF Mono","Cascadia Code",Consolas,monospace';

        return (
          <div
            style={{
              position: 'absolute', left: pos.x, top: pos.y,
              width: panelW, background: 'rgba(19,22,31,0.95)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderLeft: `3px solid ${entryColor}`,
              borderTop: `3px solid ${tradeDecision.color}`,
              fontFamily: mono, zIndex: 10, userSelect: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
          >
            {/* Title bar — drag handle */}
            <div
              onMouseDown={handlePanelMouseDown}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px 4px', cursor: 'grab', borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span style={{ color: entryColor, fontWeight: 700, fontSize: 12 }}>
                {isLong ? '▲ 롱 포지션' : '▼ 숏 포지션'} L2L
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: tradeDecision.color,
                background: tradeDecision.color + '33', padding: '1px 7px', borderRadius: 3,
              }}>
                {tradeDecision.label}
              </span>
            </div>

            {/* Final decision */}
            <div style={{
              padding: '6px 10px 5px',
              background: tradeDecision.bg,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ color: tradeDecision.color, fontWeight: 800, fontSize: 12 }}>최종 판단</span>
                <span style={{ color: tradeDecision.color, fontWeight: 800, fontSize: 12 }}>{tradeDecision.label}</span>
              </div>
              <div style={{ color: '#b2b8c4', fontSize: 10, lineHeight: '15px' }}>{tradeDecision.summary}</div>
              <div style={{ color: '#848e9c', fontSize: 10, lineHeight: '15px' }}>
                체크: {tradeDecision.reasons.slice(0, 3).join(' · ')}
              </div>
            </div>

            {/* Price status badge */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '4px 10px', background: sm.bg,
            }}>
              <span style={{ color: sm.color, fontWeight: 700, fontSize: 11 }}>가격 상태: {sm.label}</span>
              <span style={{ color: gm.color, fontSize: 10 }}>{gm.label} · {scoreInt}점</span>
            </div>
            <div style={{ padding: '1px 10px 4px', fontSize: 10, color: '#5e6673', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {sm.desc}
            </div>

            {/* Data rows */}
            <div style={row}>
              <span style={labelStyle}>현재가</span>
              <span style={{ ...val, color: cpArrowColor }}>{formatPrice(cp)}  {cpArrow}</span>
            </div>
            <div style={row}>
              <span style={labelStyle}>{isLong ? '살 가격대' : '팔 가격대'}</span>
              <span style={{ ...val, color: entryColor }}>{formatPrice(setup.entryZoneLow)} ~ {formatPrice(setup.entryZoneHigh)}</span>
            </div>
            <div style={row}>
              <span style={labelStyle}>목표 가격</span>
              <span style={{ ...val, color: '#38bdf8' }}>{formatPrice(setup.tp1)}  <span style={{ color: '#5e6673' }}>(+{pctFn(setup.tp1, setup.idealEntry)})</span></span>
            </div>
            <div style={row}>
              <span style={labelStyle}>손절 가격</span>
              <span style={{ ...val, color: isLong ? '#f6465d' : '#f59e42' }}>{formatPrice(setup.hardStop)}  <span style={{ color: '#5e6673' }}>(-{pctFn(setup.hardStop, setup.idealEntry)})</span></span>
            </div>
            <div style={row}>
              <span style={labelStyle}>손익비</span>
              <span style={{ ...val, color: rrNum >= 2 ? '#0ecb81' : rrNum >= 1 ? '#f59e42' : '#f6465d' }}>1 : {rr}</span>
            </div>
            <div style={row}>
              <span style={labelStyle}>점수 설명</span>
              <span style={{ ...val, color: '#848e9c' }}>
                닫힌 봉 · 원점수 {Math.round(setup.rawScore * 100)}점
              </span>
            </div>
            <div style={row}>
              <span style={labelStyle}>큰 흐름</span>
              <span style={{ ...val, color: mtfView.color }}>
                {mtfView.label}
              </span>
            </div>
            {bt && (
              <div style={row}>
                <span style={labelStyle}>과거 전체</span>
                <span style={{ ...val, color: bt.avgR > 0 ? '#0ecb81' : '#f6465d' }}>
                  {bt.trades}건 · 승률 {(bt.winRate * 100).toFixed(0)}% · {bt.avgR >= 0 ? '+' : ''}{bt.avgR.toFixed(2)}R
                </span>
              </div>
            )}
            {bt && (
              <div style={row}>
                <span style={labelStyle}>전체 품질</span>
                <span style={{ ...val, color: btQualityColor }}>
                  {bt.sampleQuality} · PF {bt.profitFactor == null ? '∞' : bt.profitFactor.toFixed(2)} · DD {bt.maxDrawdownR.toFixed(1)}R
                </span>
              </div>
            )}
            {filteredBt && (
              <div style={row}>
                <span style={labelStyle}>비슷한 과거</span>
                <span style={{ ...val, color: filteredBt.candidates === 0 ? '#5e6673' : filteredBt.avgR > 0 ? '#0ecb81' : '#f6465d' }}>
                  {filteredBt.candidates === 0
                    ? '조건 표본 없음'
                    : `${filteredBt.trades}/${filteredBt.candidates}건 · 승률 ${(filteredBt.winRate * 100).toFixed(0)}% · ${filteredBt.avgR >= 0 ? '+' : ''}${filteredBt.avgR.toFixed(2)}R`}
                </span>
              </div>
            )}
            {filteredBt && (
              <div style={row}>
                <span style={labelStyle}>비슷한 조건</span>
                <span style={{ ...val, color: filteredQualityColor }}>
                  {filteredBt.sampleQuality} · {isLong ? '매수' : '매도'} · {scoreInt}+점 · 손익비 1.5+
                </span>
              </div>
            )}
            {oosBt && oosBt.trades > 0 && (
              <div style={row}>
                <span style={labelStyle}>OOS 검증</span>
                <span style={{ ...val, color: oosBt.avgR > 0 ? '#0ecb81' : '#f6465d' }}>
                  {oosBt.trades}건 · 승률 {(oosBt.winRate * 100).toFixed(0)}% · {oosBt.avgR >= 0 ? '+' : ''}{oosBt.avgR.toFixed(2)}R
                  <span style={{ color: '#5e6673' }}> (최근 30%)</span>
                </span>
              </div>
            )}
            {l2lOverlay.filteredWalktestConsistency !== null && (
              <div style={row}>
                <span style={labelStyle}>워크포워드</span>
                <span style={{
                  ...val,
                  color: l2lOverlay.filteredWalktestConsistency >= 0.67 ? '#0ecb81'
                    : l2lOverlay.filteredWalktestConsistency >= 0.34 ? '#f59e42'
                    : '#f6465d',
                }}>
                  {Math.round(l2lOverlay.filteredWalktestConsistency * 100)}% 일관성
                  {' '}
                  <span style={{ color: '#5e6673' }}>
                    ({(l2lOverlay.filteredWalktestFolds ?? [])
                      .map(v => v === null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + 'R')
                      .join(' / ')})
                  </span>
                </span>
              </div>
            )}
            {filteredBt && filteredBt.trades > 0 && rrNum > 0 && (() => {
              const w = filteredBt.winRate;
              const raw = w - (1 - w) / rrNum;
              const halfKelly = Math.max(0, raw / 2);
              const kellyPct = Math.min(halfKelly * 100, 2);
              const kellyColor = kellyPct >= 1.5 ? '#0ecb81' : kellyPct >= 0.5 ? '#f59e42' : '#f6465d';
              return (
                <div style={row}>
                  <span style={labelStyle}>권장 리스크</span>
                  <span style={{ ...val, color: kellyColor }}>
                    {kellyPct.toFixed(1)}% <span style={{ color: '#5e6673' }}>(하프 켈리, 최대 2%)</span>
                  </span>
                </div>
              );
            })()}
            {paperLog.length > 0 && (
              <div style={{ ...row, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 2 }}>
                <span style={labelStyle}>페이퍼 결과</span>
                <span style={{ ...val, color: paperAvgR === null ? '#848e9c' : paperAvgR > 0 ? '#0ecb81' : '#f6465d' }}>
                  {paperClosed.length > 0
                    ? `${paperClosed.length}건 종결 · 승${paperWins} · ${paperAvgR! >= 0 ? '+' : ''}${paperAvgR!.toFixed(2)}R`
                    : '결과 대기 중'}
                  {paperOpen > 0 && <span style={{ color: '#5e6673' }}> · 진행 {paperOpen}건</span>}
                </span>
              </div>
            )}
            <div style={{ ...row, ...(paperLog.length === 0 ? { borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 2 } : {}) }}>
              <span style={labelStyle}>신호 시점</span>
              <span style={{ ...val, color: '#848e9c' }}>
                {formatDetectedAt()}  <span style={{ color: ageColor }}>{ageLabel}</span>
              </span>
            </div>
            <div style={row}>
              <span style={labelStyle}>다음 봉</span>
              <span style={{ ...val, color: countdown <= 10 ? '#f59e42' : '#5e6673' }}>
                {(() => {
                  const h = Math.floor(countdown / 3600);
                  const m = Math.floor((countdown % 3600) / 60);
                  const s = countdown % 60;
                  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
                  if (m > 0) return `${m}m ${String(s).padStart(2,'0')}s`;
                  return `${s}s`;
                })()} 후 봉 마감
              </span>
            </div>
            <div style={{ padding: '2px 10px 5px', fontSize: 9, color: '#3d4352', textAlign: 'right' }}>
              ⠿ 드래그로 이동
            </div>
          </div>
        );
      })()}
    </div>
  );
}

interface L2LPaperEntry {
  id: string;
  ticker: string;
  interval: string;
  direction: 'long' | 'short';
  entryPrice: number;
  tp1: number;
  hardStop: number;
  score: number;
  rr: number;
  loggedAt: number;
  /** close time of the bar that triggered the signal */
  entryBarTime: number;
  outcome: 'open' | 'win' | 'loss' | 'timeout';
  exitPrice: number | null;
  exitBarTime: number | null;
  outcomeR: number | null;
}

// ── L2L analysis helpers ─────────────────────────────────────────────────────

const L2L_SAFETY_MS = 4000;
const L2L_BACKTEST_MAX_SIGNAL_BARS = 220;
const L2L_BACKTEST_MAX_HOLD_BARS = 16;

const L2L_INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

const L2L_MAX_BARS_BY_INTERVAL: Record<Interval, number> = {
  '1m': 60,
  '3m': 60,
  '5m': 60,
  '15m': 60,
  '1h': 60,
  '4h': 40,
  '1d': 90,
  '1w': 104,
};

type L2LEntryStatus = 'TRIGGERED' | 'PENDING' | 'LATE' | 'INVALID';
type L2LTradeAction = 'ENTER' | 'WAIT' | 'WATCH' | 'AVOID' | 'INVALID';

interface L2LBacktestFilter {
  direction?: 'long' | 'short';
  minScore?: number;
  minRr?: number;
}

interface L2LMtfSignal {
  interval: Interval;
  direction: 'long' | 'short' | null;
  score: number;
}

interface L2LMtfSummary {
  status: 'idle' | 'loading' | 'none' | 'ready' | 'error';
  checked: number;
  aligned: number;
  conflicts: number;
  neutral: number;
  details: L2LMtfSignal[];
}

interface L2LTradeDecision {
  action: L2LTradeAction;
  label: string;
  color: string;
  bg: string;
  summary: string;
  reasons: string[];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function getL2LHigherIntervals(interval: Interval): Interval[] {
  const checks: Record<Interval, Interval[]> = {
    '1m': ['15m', '1h', '4h'],
    '3m': ['15m', '1h', '4h'],
    '5m': ['15m', '1h', '4h'],
    '15m': ['1h', '4h', '1d'],
    '1h': ['4h', '1d'],
    '4h': ['1d', '1w'],
    '1d': ['1w'],
    '1w': [],
  };
  return checks[interval];
}

function calcL2LAtr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i], p = candles[i - 1];
    atr += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

function getClosedCandlesForL2L(candles: Candle[], interval: Interval): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const isClosed = last.time + L2L_INTERVAL_MS[interval] <= Date.now() - L2L_SAFETY_MS;
  return isClosed ? candles : candles.slice(0, -1);
}

function classifyL2LEntry(setup: L2LSetup, price: number): L2LEntryStatus {
  if (setup.direction === 'long') {
    if (price < setup.hardStop) return 'INVALID';
    if (price > setup.chaseThreshold) return 'LATE';
    if (price >= setup.entryZoneLow && price <= setup.entryZoneHigh) return 'TRIGGERED';
    return 'PENDING';
  }
  if (price > setup.hardStop) return 'INVALID';
  if (price < setup.chaseThreshold) return 'LATE';
  if (price <= setup.entryZoneHigh && price >= setup.entryZoneLow) return 'TRIGGERED';
  return 'PENDING';
}

function describeMtfSummary(mtf: L2LMtfSummary): { label: string; color: string } {
  if (mtf.status === 'loading') return { label: '확인 중', color: '#848e9c' };
  if (mtf.status === 'error') return { label: '확인 실패', color: '#f59e42' };
  if (mtf.status === 'none') return { label: '상위봉 없음', color: '#848e9c' };
  if (mtf.status !== 'ready') return { label: '확인 전', color: '#848e9c' };
  if (mtf.conflicts > 0) return { label: `반대 ${mtf.conflicts}개`, color: '#f6465d' };
  if (mtf.aligned > 0) return { label: `같은 방향 ${mtf.aligned}/${mtf.checked}`, color: '#0ecb81' };
  return { label: '뚜렷한 신호 없음', color: '#f0b90b' };
}

function buildL2LTradeDecision(
  setup: L2LSetup,
  entryStatus: L2LEntryStatus,
  filteredBt: L2LBacktestSummary | null,
  mtf: L2LMtfSummary,
): L2LTradeDecision {
  if (entryStatus === 'INVALID') {
    return {
      action: 'INVALID',
      label: '진입 금지',
      color: '#f6465d',
      bg: 'rgba(246,70,93,0.18)',
      summary: '손절 가격을 이미 이탈했습니다.',
      reasons: ['셋업 무효'],
    };
  }

  if (entryStatus === 'LATE') {
    return {
      action: 'AVOID',
      label: '추격 금지',
      color: '#f59e42',
      bg: 'rgba(245,158,66,0.16)',
      summary: '좋은 가격대를 지나쳤습니다.',
      reasons: ['진입 구간 이탈'],
    };
  }

  if (entryStatus === 'PENDING') {
    return {
      action: 'WAIT',
      label: '기다리기',
      color: '#f0b90b',
      bg: 'rgba(240,185,11,0.15)',
      summary: '아직 좋은 가격대에 오지 않았습니다.',
      reasons: ['진입 가격대 대기'],
    };
  }

  const scoreOk = setup.score >= 0.55;
  const rrOk = setup.rr >= 1.5;
  const similarHasData = !!filteredBt && filteredBt.candidates > 0 && filteredBt.trades > 0;
  const similarEnough = !!filteredBt && filteredBt.trades >= 30;
  const pfOk = !!filteredBt && (filteredBt.profitFactor === null || filteredBt.profitFactor >= 1.1);
  const ddOk = !filteredBt || filteredBt.maxDrawdownR <= 3.0;
  const similarOk = similarEnough && filteredBt.avgR > 0 && pfOk && ddOk;
  const mtfConflict = mtf.status === 'ready' && mtf.conflicts > 0;
  const mtfLoading = mtf.status === 'loading';

  const reasons: string[] = [];
  if (!scoreOk) reasons.push('점수 낮음');
  if (!rrOk) reasons.push('손익비 부족');
  if (!similarHasData) reasons.push('비슷한 과거 없음');
  else if (!similarEnough) reasons.push('과거 표본 적음');
  else if (!ddOk) reasons.push('낙폭 과대');
  else if (!similarOk) reasons.push('비슷한 과거 약함');
  if (mtfConflict) reasons.push('큰 흐름 반대');
  if (mtfLoading) reasons.push('큰 흐름 확인 중');

  if (scoreOk && rrOk && similarOk && !mtfConflict && !mtfLoading) {
    return {
      action: 'ENTER',
      label: '진입 후보',
      color: '#0ecb81',
      bg: 'rgba(14,203,129,0.18)',
      summary: '가격, 점수, 과거 결과가 모두 통과했습니다.',
      reasons: ['조건 통과'],
    };
  }

  if (mtfConflict || !similarOk) {
    return {
      action: 'AVOID',
      label: '보류',
      color: mtfConflict ? '#f6465d' : '#f59e42',
      bg: mtfConflict ? 'rgba(246,70,93,0.16)' : 'rgba(245,158,66,0.16)',
      summary: mtfConflict ? '상위봉 방향이 현재 신호와 다릅니다.' : '비슷한 과거 결과가 충분히 좋지 않습니다.',
      reasons,
    };
  }

  return {
    action: 'WATCH',
    label: '확인 필요',
    color: '#f0b90b',
    bg: 'rgba(240,185,11,0.15)',
    summary: '가격은 좋지만 일부 조건이 부족합니다.',
    reasons,
  };
}

function calibrateL2LConfidence(
  candidate: RetestCandidate,
  breakdown: RetestScoreBreakdown,
  plan: OrderPlan,
  barsElapsed: number,
): { score: number; rr: number } {
  const reward = Math.abs(plan.tp1 - plan.idealEntry);
  const risk = Math.abs(plan.idealEntry - plan.hardStop);
  const rr = risk > 0 ? reward / risk : 0;
  const srScore = clamp01((candidate.srScore ?? 0) / 80);
  const rrScore = clamp01((rr - 0.8) / 1.7);
  const freshnessScore = barsElapsed <= 2 ? 1 : barsElapsed <= 6 ? 0.75 : barsElapsed <= 12 ? 0.45 : 0.25;

  // Chart L2L does not have live RS/order-book enrichment, so use only available
  // structural inputs instead of inflating neutral leader/location/air fields.
  const score = (
    breakdown.impulseScore * 0.34 +
    breakdown.pullbackScore * 0.34 +
    srScore * 0.12 +
    rrScore * 0.12 +
    freshnessScore * 0.08
  );

  return { score: clamp01(score), rr };
}

function l2lLevelLabel(level: number): string {
  return `Lv ${level.toFixed(level >= 1 ? 2 : 6)}`;
}

function setupFromCandidate(
  candidate: RetestCandidate,
  candles: Candle[],
  srLevels: LevelZone[],
  interval: Interval,
): L2LSetup {
  const plan = buildLeaderRetestOrderPlan(candidate, candles, srLevels);
  const breakdown = scoreRetestCandidate(candidate);
  const detectedAt = candles[candidate.reclaimIndex]?.time ?? candles[candles.length - 1].time;
  const barsElapsed = Math.max(0, (candles.length - 1) - candidate.reclaimIndex);
  const calibrated = calibrateL2LConfidence(candidate, breakdown, plan, barsElapsed);

  return {
    direction: candidate.direction,
    level:         candidate.level,
    entryZoneLow:  plan.entryZoneLow,
    entryZoneHigh: plan.entryZoneHigh,
    idealEntry:    plan.idealEntry,
    chaseThreshold: plan.chaseThreshold,
    cancelAfterBars: plan.cancelAfterBars,
    tp1:           plan.tp1,
    hardStop:      plan.hardStop,
    score:         calibrated.score,
    rawScore:      breakdown.total,
    rr:            calibrated.rr,
    label:         l2lLevelLabel(candidate.level),
    detectedAt,
    barIntervalMs: L2L_INTERVAL_MS[interval],
    barsElapsed,
  };
}

function buildL2LCore(
  candles: Candle[],
  ticker: string,
  interval: Interval,
): { srLevels: LevelZone[]; setups: L2LSetup[] } {
  const atr = calcL2LAtr(candles);
  const currentPrice = candles[candles.length - 1]?.close ?? 0;
  const srLevels = calcSRLevels(candles, atr, currentPrice);
  if (candles.length < 30 || atr === 0) return { srLevels, setups: [] };

  const detectOpts = {
    minBars: 1,
    maxBars: L2L_MAX_BARS_BY_INTERVAL[interval],
    toleranceAtr: 0.60,
    maxOvershootAtr: 2.0,
  };
  const longCandidates  = buildRetestCandidates(candles, 'long',  atr, srLevels, detectOpts, ticker);
  const shortCandidates = buildRetestCandidates(candles, 'short', atr, srLevels, detectOpts, ticker);
  const setups = [...longCandidates, ...shortCandidates]
    .map(candidate => setupFromCandidate(candidate, candles, srLevels, interval))
    .sort((a, b) => b.score - a.score)
    .slice(0, 1);

  return { srLevels, setups };
}

function l2lSetupKey(setup: L2LSetup): string {
  const priceKey = setup.level >= 1 ? setup.level.toFixed(2) : setup.level.toPrecision(6);
  return `${setup.direction}:${setup.detectedAt}:${priceKey}`;
}

function candleTouchesEntryZone(candle: Candle, setup: L2LSetup): boolean {
  return candle.low <= setup.entryZoneHigh && candle.high >= setup.entryZoneLow;
}

function chooseBacktestEntryPrice(candle: Candle, setup: L2LSetup): number {
  if (candle.low <= setup.idealEntry && candle.high >= setup.idealEntry) return setup.idealEntry;
  return setup.direction === 'long' ? setup.entryZoneHigh : setup.entryZoneLow;
}

function matchesL2LBacktestFilter(setup: L2LSetup, filter?: L2LBacktestFilter): boolean {
  if (!filter) return true;
  if (filter.direction && setup.direction !== filter.direction) return false;
  if (filter.minScore != null && setup.score + 0.000001 < filter.minScore) return false;
  if (filter.minRr != null && setup.rr + 0.000001 < filter.minRr) return false;
  return true;
}

function backtestL2L(
  candles: Candle[],
  ticker: string,
  interval: Interval,
  filter?: L2LBacktestFilter,
  signalIdxRange?: [number, number],
): L2LBacktestSummary | null {
  if (candles.length < 90) return null;

  const defaultFirst = Math.max(60, candles.length - L2L_BACKTEST_MAX_SIGNAL_BARS);
  const defaultLast = candles.length - 2;
  const firstSignalIdx = signalIdxRange ? signalIdxRange[0] : defaultFirst;
  const lastSignalIdx  = signalIdxRange ? signalIdxRange[1] : defaultLast;
  if (lastSignalIdx <= firstSignalIdx) return null;

  const seen = new Set<string>();
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let timeouts = 0;
  let unfilled = 0;
  let candidates = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let totalR = 0;
  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;

  for (let signalIdx = firstSignalIdx; signalIdx <= lastSignalIdx; signalIdx++) {
    const history = candles.slice(0, signalIdx + 1);
    const setup = buildL2LCore(history, ticker, interval).setups[0];
    if (!setup) continue;

    const key = l2lSetupKey(setup);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!matchesL2LBacktestFilter(setup, filter)) continue;

    const signalClose = candles[signalIdx].close;
    const status = classifyL2LEntry(setup, signalClose);
    if (status === 'INVALID' || status === 'LATE') continue;
    candidates++;

    let fillIdx = -1;
    let entryPrice = signalClose;
    if (status === 'TRIGGERED') {
      fillIdx = signalIdx;
    } else {
      const lastFillIdx = Math.min(candles.length - 1, signalIdx + setup.cancelAfterBars);
      for (let i = signalIdx + 1; i <= lastFillIdx; i++) {
        if (!candleTouchesEntryZone(candles[i], setup)) continue;
        fillIdx = i;
        entryPrice = chooseBacktestEntryPrice(candles[i], setup);
        break;
      }
    }
    if (fillIdx < 0) {
      unfilled++;
      continue;
    }

    const risk = Math.abs(entryPrice - setup.hardStop);
    const reward = Math.abs(setup.tp1 - entryPrice);
    if (risk <= 0 || reward <= 0) continue;

    let outcomeR: number | null = null;
    let timedOut = false;
    const firstOutcomeIdx = fillIdx === signalIdx ? fillIdx + 1 : fillIdx;
    const lastOutcomeIdx = Math.min(candles.length - 1, fillIdx + L2L_BACKTEST_MAX_HOLD_BARS);

    for (let i = firstOutcomeIdx; i <= lastOutcomeIdx; i++) {
      const c = candles[i];
      const hitStop = setup.direction === 'long' ? c.low <= setup.hardStop : c.high >= setup.hardStop;
      const hitTarget = setup.direction === 'long' ? c.high >= setup.tp1 : c.low <= setup.tp1;
      if (hitStop || hitTarget) {
        outcomeR = hitStop ? -1 : reward / risk;
        break;
      }
    }

    if (outcomeR === null) {
      const exit = candles[lastOutcomeIdx].close;
      outcomeR = setup.direction === 'long'
        ? (exit - entryPrice) / risk
        : (entryPrice - exit) / risk;
      timedOut = true;
    }

    trades++;
    totalR += outcomeR;
    equityR += outcomeR;
    peakR = Math.max(peakR, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
    if (outcomeR > 0) {
      wins++;
      grossWinR += outcomeR;
    } else if (outcomeR < 0) {
      losses++;
      grossLossR += Math.abs(outcomeR);
    }
    if (timedOut) timeouts++;
  }

  const sampleQuality: L2LBacktestSummary['sampleQuality'] =
    trades >= 100 ? 'HIGH' : trades >= 40 ? 'MEDIUM' : 'LOW';

  return {
    trades,
    wins,
    losses,
    timeouts,
    unfilled,
    candidates,
    winRate: trades > 0 ? wins / trades : 0,
    avgR: trades > 0 ? totalR / trades : 0,
    profitFactor: grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? null : 0,
    maxDrawdownR,
    sampleQuality,
  };
}

interface L2LWalkForwardResult {
  /** Number of folds that had positive avgR */
  positiveFolds: number;
  totalFolds: number;
  /** avgR values per fold (null if insufficient data) */
  foldAvgR: (number | null)[];
  /** Consistency: fraction of positive-avgR folds */
  consistency: number;
}

/** 3-fold walk-forward test over the filtered signal bar range. */
function walktestL2L(
  candles: Candle[],
  ticker: string,
  interval: Interval,
  filter: L2LBacktestFilter,
  k = 3,
): L2LWalkForwardResult | null {
  if (candles.length < 90) return null;
  const first = Math.max(60, candles.length - L2L_BACKTEST_MAX_SIGNAL_BARS);
  const last  = candles.length - 2;
  if (last <= first) return null;

  const total = last - first;
  const foldSize = Math.floor(total / k);
  if (foldSize < 10) return null;

  const foldAvgR: (number | null)[] = [];
  let positiveFolds = 0;

  for (let f = 0; f < k; f++) {
    const fStart = first + f * foldSize;
    const fEnd   = f === k - 1 ? last : fStart + foldSize - 1;
    const result = backtestL2L(candles, ticker, interval, filter, [fStart, fEnd]);
    const avgR = result && result.trades >= 5 ? result.avgR : null;
    foldAvgR.push(avgR);
    if (avgR !== null && avgR > 0) positiveFolds++;
  }

  const scored = foldAvgR.filter(v => v !== null).length;

  return {
    positiveFolds,
    totalFolds: k,
    foldAvgR,
    consistency: scored > 0 ? positiveFolds / scored : 0,
  };
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
