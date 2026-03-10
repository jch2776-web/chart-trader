import React, { useRef, useState, useEffect, useMemo } from 'react';
import type { FuturesPosition, FuturesOrder, LiveTradeHistoryEntry } from '../../types/futures';
import type { ClientSlMap } from '../../hooks/useBinanceFutures';
import type { PaperHistoryEntry, PaperPosition, PaperOrder, AltMeta } from '../../types/paperTrading';
import { downloadExcel } from '../../utils/exportExcel';
import type { ExcelCell } from '../../utils/exportExcel';

interface Props {
  allPositions: FuturesPosition[];
  allOrders: FuturesOrder[];
  onCancelOrder: (orderId: string, symbol: string) => Promise<void>;
  onPlaceTPSL: (symbol: string, closeSide: 'BUY' | 'SELL', qty: number, tpPrice?: number, slPrice?: number, positionSide?: 'LONG' | 'SHORT' | 'BOTH') => Promise<void>;
  onSelectTicker: (symbol: string) => void;
  height: number;
  onHeightChange: (delta: number) => void;
  clientSlMap?: ClientSlMap;
  onRemoveClientSL?: (symbol: string, positionSide: 'LONG' | 'SHORT' | 'BOTH') => void;
  // Paper trading
  isPaperMode?: boolean;
  paperPositions?: FuturesPosition[];
  paperRawPositions?: PaperPosition[];
  paperBalance?: number;
  paperOrders?: PaperOrder[];
  paperHistory?: PaperHistoryEntry[];
  onPaperClosePosition?: (entryTime: number) => void;
  onPaperSetTPSL?: (entryTime: number, tp?: number, sl?: number) => void;
  onPaperResetBalance?: (amount: number) => void;
  onPaperCancelOrder?: (id: string) => void;
  onPaperClearHistory?: () => void;
  paperInitialBalance?: number;
  onOpenAltPosition?: (meta: AltMeta) => void;
  onOpenAltInMain?: (meta: AltMeta) => void;
  liveAltMetaMap?: Record<string, AltMeta>;
  liveAltOrderTagMap?: Record<string, 'ALT-AUTO TP' | 'ALT-AUTO SL'>;
  // Live trading history
  liveHistory?: LiveTradeHistoryEntry[];
  onLiveCloseMarket?: (
    symbol: string,
    direction: 'long' | 'short',
    closeSide: 'BUY' | 'SELL',
    qty: number,
    positionSide: 'LONG' | 'SHORT' | 'BOTH',
  ) => Promise<void>;
  onLiveCloseCurrentPrice?: (
    symbol: string,
    direction: 'long' | 'short',
    closeSide: 'BUY' | 'SELL',
    qty: number,
    limitPrice: number,
  ) => Promise<void>;
}

type Tab = 'positions' | 'orders' | 'paper-orders' | 'paper-history' | 'paper-asset' | 'live-history' | 'live-asset';

// ── TP/SL modal state ─────────────────────────────────────────────────────────
interface TPSLModal {
  position: FuturesPosition;
  existingTP?: number;
  existingSL?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractCoin(symbol: string): string {
  for (const q of ['USDT', 'BUSD', 'USDC', 'PERP']) {
    if (symbol.endsWith(q)) return symbol.slice(0, -q.length);
  }
  return symbol.replace(/_PERP$/, '').split('_')[0];
}

function fmtPrice(price: number): string {
  if (!isFinite(price) || price === 0) return '—';
  if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100)   return price.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  if (price >= 1)     return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (price >= 0.01)  return price.toFixed(6);
  return price.toFixed(8);
}

function fmtQty(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 1)    return abs.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return abs.toFixed(6);
}

function pnlColor(pnl: number) {
  if (pnl > 0) return '#0ecb81';
  if (pnl < 0) return '#f6465d';
  return '#848e9c';
}

function sideColor(side: 'LONG' | 'SHORT' | 'BUY' | 'SELL') {
  return side === 'LONG' || side === 'BUY' ? '#0ecb81' : '#f6465d';
}

function orderTypeLabel(type: string) {
  const m: Record<string, string> = {
    LIMIT: 'Limit', MARKET: 'Market',
    STOP: 'Stop Limit', STOP_MARKET: 'Stop Market',
    TAKE_PROFIT: 'TP Limit', TAKE_PROFIT_MARKET: 'TP Market',
    TRAILING_STOP_MARKET: 'Trailing Stop',
  };
  return m[type] ?? type;
}

type UnifiedHistoryReason = PaperHistoryEntry['closeReason'] | 'time' | 'invalid' | 'unknown';

interface UnifiedHistoryRow {
  id: string;
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  qty: number;
  leverage: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  pnl: number | null;
  fees: number | null;
  entryTime: number | null;
  exitTime: number;
  closeReason: UnifiedHistoryReason;
  interval?: string;
  candidateScore?: number | null;
  plannedEntry?: number | null;
  plannedTP?: number | null;
  plannedSL?: number | null;
}

function reasonLabel(reason: UnifiedHistoryReason): string {
  if (reason === 'tp') return '익절';
  if (reason === 'sl') return '손절';
  if (reason === 'liq') return '청산';
  if (reason === 'expired' || reason === 'time') return '타임스탑';
  if (reason === 'invalid') return '구조무효';
  if (reason === 'manual') return '수동';
  return '미확인';
}

function reasonColorByReason(reason: UnifiedHistoryReason): string {
  if (reason === 'tp') return '#0ecb81';
  if (reason === 'liq') return '#f59e42';
  if (reason === 'expired' || reason === 'time') return '#f0b90b';
  if (reason === 'invalid') return '#3b8beb';
  if (reason === 'manual') return '#b9c1d0';
  return '#848e9c';
}

// ── Horizontal bar meter (price slider) ──────────────────────────────────────
interface TickDef { pct: number; label: string; major: boolean; }

function HBarMeter({ label, displayValue, accentColor = '#f0b90b', disabled = false,
  sliderMin, sliderMax, sliderStep, sliderValue, ticks, biDir = false, reverseDir = false, onSliderChange,
}: {
  label: string; displayValue: string; accentColor?: string; disabled?: boolean;
  sliderMin: number; sliderMax: number; sliderStep: number; sliderValue: number;
  ticks: TickDef[]; biDir?: boolean; reverseDir?: boolean;
  onSliderChange: (v: number) => void;
}) {
  const norm       = (sliderValue - sliderMin) / (sliderMax - sliderMin);
  const centerNorm = (0 - sliderMin) / (sliderMax - sliderMin);
  // biDir: 가운데 기준 양방향 / reverseDir: 오른쪽(max)에서 왼쪽으로 채워짐 / 기본: 왼쪽에서 오른쪽
  const fillLeft  = biDir ? Math.min(norm, centerNorm) * 100 : reverseDir ? norm * 100 : 0;
  const fillWidth = biDir ? Math.abs(norm - centerNorm) * 100 : reverseDir ? (1 - norm) * 100 : norm * 100;

  const containerRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef({ sliderValue, sliderMin, sliderMax, sliderStep, onSliderChange, disabled });
  useEffect(() => { latestRef.current = { sliderValue, sliderMin, sliderMax, sliderStep, onSliderChange, disabled }; });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const { disabled, sliderValue, sliderStep, sliderMin, sliderMax, onSliderChange } = latestRef.current;
      if (disabled) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.round((sliderValue + dir * sliderStep) * 1000) / 1000;
      onSliderChange(Math.max(sliderMin, Math.min(sliderMax, next)));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div ref={containerRef} style={{
      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
      opacity: disabled ? 0.38 : 1, pointerEvents: disabled ? 'none' : 'auto',
    }}>
      {label && (
        <span style={{ width: 44, fontSize: '0.72rem', color: '#8892a4', fontWeight: 600, flexShrink: 0 }}>
          {label}
        </span>
      )}
      <div style={{ flex: 1 }}>
        <div style={{ position: 'relative', height: 18 }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 3, transform: 'translateY(-50%)', background: '#1a2535', borderRadius: 2 }} />
          <div style={{ position: 'absolute', top: '50%', left: `${fillLeft}%`, width: `${fillWidth}%`, height: 3, transform: 'translateY(-50%)', background: accentColor, borderRadius: 2, boxShadow: `0 0 5px ${accentColor}55`, pointerEvents: 'none' }} />
          {biDir && (
            <div style={{ position: 'absolute', top: '50%', left: `${centerNorm * 100}%`, width: 1, height: 10, transform: 'translate(-50%, -50%)', background: '#4a5568', pointerEvents: 'none' }} />
          )}
          <div style={{ position: 'absolute', top: '50%', left: `${norm * 100}%`, width: 10, height: 10, borderRadius: '50%', background: accentColor, boxShadow: `0 0 6px ${accentColor}99`, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />
          <input type="range" min={sliderMin} max={sliderMax} step={sliderStep} value={sliderValue} disabled={disabled}
            onChange={e => onSliderChange(Number(e.target.value))}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', margin: 0, padding: 0 }} />
        </div>
        <div style={{ position: 'relative', height: 14 }}>
          {ticks.map((tk, i) => (
            <div key={i} style={{ position: 'absolute', left: `${tk.pct}%`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <div style={{ width: 1, height: tk.major ? 4 : 3, background: '#2d3a4e' }} />
              <span style={{ fontSize: '0.58rem', color: '#3d4e62', whiteSpace: 'nowrap', lineHeight: 1 }}>{tk.label}</span>
            </div>
          ))}
        </div>
      </div>
      <span style={{ width: 44, textAlign: 'right', fontSize: '0.82rem', fontWeight: 700, color: accentColor, fontFamily: '"SF Mono",Consolas,monospace', flexShrink: 0 }}>
        {displayValue}
      </span>
    </div>
  );
}

// ── Paper Asset Chart ─────────────────────────────────────────────────────────
type AssetPeriod = '6H' | '12H' | '1D' | '1W' | '1M' | '3M' | '6M' | 'ALL';

interface AssetPt { time: number; value: number }

const PERIOD_OFFSETS: Record<AssetPeriod, number> = {
  '6H':  6 * 3600000,
  '12H': 12 * 3600000,
  '1D':  86400000,
  '1W':  7 * 86400000,
  '1M':  30 * 86400000,
  '3M':  90 * 86400000,
  '6M':  180 * 86400000,
  'ALL': 0,
};
const PERIOD_LABELS: Record<AssetPeriod, string> = {
  '6H': '6H', '12H': '12H', '1D': '1D', '1W': '1W', '1M': '1M', '3M': '3M', '6M': '6M', 'ALL': 'ALL',
};

// Smooth bezier path (cubic – horizontal tangents at each point)
function smoothBezier(screenPts: { x: number; y: number }[]): string {
  if (screenPts.length < 2) return screenPts.length === 1 ? `M ${screenPts[0].x} ${screenPts[0].y}` : '';
  let d = `M ${screenPts[0].x.toFixed(1)} ${screenPts[0].y.toFixed(1)}`;
  for (let i = 0; i < screenPts.length - 1; i++) {
    const cp = (screenPts[i].x + screenPts[i + 1].x) / 2;
    d += ` C ${cp.toFixed(1)} ${screenPts[i].y.toFixed(1)}, ${cp.toFixed(1)} ${screenPts[i + 1].y.toFixed(1)}, ${screenPts[i + 1].x.toFixed(1)} ${screenPts[i + 1].y.toFixed(1)}`;
  }
  return d;
}

interface AssetLineChartProps {
  pts: AssetPt[];
  gradId: string;
  showZeroLine?: boolean;
  color: string;
  label: string;
  period: AssetPeriod;
  fmtTooltip: (v: number) => string;
}

// Fixed pixel height for the chart — keeps size predictable regardless of container width
const CHART_H = 68;

function AssetLineChart({ pts, gradId, showZeroLine, color, label, period, fmtTooltip }: AssetLineChartProps) {
  const lineRef = useRef<SVGPathElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Hover stores pixel coords (relative to container) for HTML tooltip
  const [hover, setHover] = useState<{ pxX: number; pxY: number; idx: number } | null>(null);

  // SVG logical coordinate space — width arbitrary, height matches CHART_H
  const W = 600, H = CHART_H, PT = 4, PB = 16, PL = 0;
  const iW = W, iH = H - PT - PB;

  const yVals = pts.map(p => p.value);
  const yMinRaw = pts.length ? Math.min(...yVals) : 0;
  const yMaxRaw = pts.length ? Math.max(...yVals) : 1;
  const yPad = (yMaxRaw - yMinRaw || 200) * 0.18;
  const yMin = yMinRaw - yPad, yMax = yMaxRaw + yPad;
  const tMin = pts.length ? pts[0].time : 0;
  const tMax = pts.length ? (pts[pts.length - 1].time || tMin + 1) : 1;
  const tRange = tMax - tMin || 1, yRange = yMax - yMin;
  const toX = (t: number) => PL + ((t - tMin) / tRange) * iW;
  const toY = (v: number) => PT + (1 - (v - yMin) / yRange) * iH;

  const screenPts = pts.map(p => ({ x: toX(p.time), y: toY(p.value) }));
  const linePath = smoothBezier(screenPts);
  const areaPath = pts.length
    ? `${linePath} L ${toX(pts[pts.length - 1].time).toFixed(1)} ${(PT + iH).toFixed(1)} L ${PL.toFixed(1)} ${(PT + iH).toFixed(1)} Z`
    : '';

  // Draw animation
  useEffect(() => {
    const el = lineRef.current;
    if (!el || !linePath) return;
    const len = el.getTotalLength();
    el.style.transition = 'none';
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!el) return;
        el.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)';
        el.style.strokeDashoffset = '0';
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [linePath]);

  const fmtDate = (t: number) => {
    const d = new Date(t);
    if (period === '6H' || period === '12H') return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (period === '1D' || period === '1W') return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}h`;
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const xTickCount = Math.min(5, pts.length);
  const xTicks: number[] = [];
  for (let i = 0; i < xTickCount; i++) {
    xTicks.push(pts[Math.round((i / (xTickCount - 1 || 1)) * (pts.length - 1))].time);
  }

  // Hover: track pixel coords for HTML tooltip, SVG coords for dot/line
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const svgX = (pxX / rect.width) * W;
    let minDist = Infinity, nearestIdx = 0;
    for (let i = 0; i < screenPts.length; i++) {
      const d = Math.abs(screenPts[i].x - svgX);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    setHover({ pxX, pxY, idx: nearestIdx });
  };

  const zeroY = toY(0);
  const showZero = showZeroLine && zeroY > PT && zeroY < PT + iH;

  // Hover dot position in SVG coords
  const hoverSvgX = hover ? screenPts[hover.idx].x : 0;
  const hoverSvgY = hover ? screenPts[hover.idx].y : 0;
  const hoverPt   = hover ? pts[hover.idx] : null;

  // Tooltip position in px — flip to left when near right edge
  const containerW = containerRef.current?.offsetWidth ?? 200;
  const tooltipLeft = hover
    ? (hover.pxX > containerW * 0.55 ? hover.pxX - 118 : hover.pxX + 8)
    : 0;

  // Y-axis label formatter (compact: k/M suffix)
  const fmtYLabel = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 10) return v.toFixed(1);
    return v.toFixed(2);
  };

  if (pts.length === 0) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.6rem', color: '#4a5568', marginBottom: 3, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ height: CHART_H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2d3a4e', fontSize: '0.68rem', background: 'rgba(255,255,255,0.012)', borderRadius: 4 }}>
          데이터 없음
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
      <div style={{ fontSize: '0.6rem', color: '#4a5568', marginBottom: 3, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
      {/* preserveAspectRatio="none" + fixed px height = no scaling surprises */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: CHART_H, cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="85%" stopColor={color} stopOpacity="0.03" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {showZero && <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="#2d3a4e" strokeWidth="0.6" strokeDasharray="4,3" />}
        <path d={areaPath} fill={`url(#${gradId})`} style={{ animation: 'assetFadeIn 1.2s ease forwards', opacity: 0 }} />
        <path ref={lineRef} d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1={0} y1={PT + iH} x2={W} y2={PT + iH} stroke="#1a2535" strokeWidth="0.6" />
        {/* X-axis labels are HTML, not SVG — avoids scaling issues */}
        {!hover && pts.length > 0 && (
          <circle cx={screenPts[screenPts.length - 1].x} cy={screenPts[screenPts.length - 1].y} r="2.5" fill={color} stroke="#131722" strokeWidth="1.2" />
        )}
        {hover && (
          <g>
            <line x1={hoverSvgX} y1={PT} x2={hoverSvgX} y2={PT + iH} stroke="#2d3a4e" strokeWidth="0.6" strokeDasharray="3,3" />
            <circle cx={hoverSvgX} cy={hoverSvgY} r="3" fill={color} stroke="#131722" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {/* Y-axis min/max labels — absolute overlay on chart area */}
      <div style={{ position: 'absolute', top: 16, left: 2, pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: CHART_H - 16 }}>
        <span style={{ fontSize: '0.52rem', color: '#3e4f64', lineHeight: 1, background: 'rgba(19,23,34,0.7)', padding: '0 2px', borderRadius: 2 }}>{fmtYLabel(yMaxRaw)}</span>
        <span style={{ fontSize: '0.52rem', color: '#3e4f64', lineHeight: 1, background: 'rgba(19,23,34,0.7)', padding: '0 2px', borderRadius: 2 }}>{fmtYLabel(yMinRaw)}</span>
      </div>

      {/* X-axis date labels — rendered as HTML to avoid SVG text scaling */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {xTicks.map((t, i) => (
          <span key={i} style={{ fontSize: '0.55rem', color: '#3e4f64', lineHeight: 1 }}>{fmtDate(t)}</span>
        ))}
      </div>

      {/* HTML tooltip overlay */}
      {hover && hoverPt && (
        <div style={{
          position: 'absolute', top: Math.max(0, hover.pxY - 36), left: tooltipLeft,
          background: '#181f2e', border: '1px solid #2a3546', borderRadius: 5,
          padding: '4px 8px', pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap',
        }}>
          <div style={{ fontSize: '0.6rem', color: '#6b7892', lineHeight: 1.3 }}>{fmtDate(hoverPt.time)}</div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color, fontFamily: '"SF Mono",Consolas,monospace', lineHeight: 1.3 }}>
            {fmtTooltip(hoverPt.value)}
          </div>
        </div>
      )}
    </div>
  );
}

function PaperAssetChart({ history, initialBalance }: { history: PaperHistoryEntry[]; initialBalance: number }) {
  const [period, setPeriod] = useState<AssetPeriod>('1M');

  const sorted = useMemo(() => [...history].sort((a, b) => a.exitTime - b.exitTime), [history]);
  // eslint-disable-next-line react-hooks/purity
  const cutMs = useMemo(() => (period === 'ALL' ? 0 : Date.now() - PERIOD_OFFSETS[period]), [period]);

  const baselineCumPnl = useMemo(() => {
    let acc = 0;
    for (const h of sorted) { if (h.exitTime < cutMs) acc += h.pnl; }
    return acc;
  }, [sorted, cutMs]);

  const { filtered, balancePts, cumPnlPts, tradeCountPts, winRatePts, feePts, drawdownPts } = useMemo(() => {
    const filtered = sorted.filter(h => h.exitTime >= cutMs);
    const balancePts: AssetPt[] = [];
    const cumPnlPts: AssetPt[] = [];
    const tradeCountPts: AssetPt[] = [];
    const winRatePts: AssetPt[] = [];
    const feePts: AssetPt[] = [];
    const drawdownPts: AssetPt[] = [];

    let cumPnl = baselineCumPnl;
    let cumFees = 0;
    let wins = 0;
    let peakBalance = initialBalance + baselineCumPnl;

    filtered.forEach((h, i) => {
      cumPnl += h.pnl;
      cumFees += h.fees;
      if (h.pnl > 0) wins++;
      const bal = initialBalance + cumPnl;
      if (bal > peakBalance) peakBalance = bal;
      const dd = peakBalance > 0 ? ((peakBalance - bal) / peakBalance) * 100 : 0;
      balancePts.push({ time: h.exitTime, value: bal });
      cumPnlPts.push({ time: h.exitTime, value: cumPnl });
      tradeCountPts.push({ time: h.exitTime, value: i + 1 });
      winRatePts.push({ time: h.exitTime, value: (wins / (i + 1)) * 100 });
      feePts.push({ time: h.exitTime, value: cumFees });
      drawdownPts.push({ time: h.exitTime, value: -dd });
    });

    return { filtered, balancePts, cumPnlPts, tradeCountPts, winRatePts, feePts, drawdownPts };
  }, [sorted, cutMs, baselineCumPnl, initialBalance]);

  const totalPnl = filtered.reduce((s, h) => s + h.pnl, 0);
  const totalFees = filtered.reduce((s, h) => s + h.fees, 0);
  const winCount = filtered.filter(h => h.pnl > 0).length;
  const winRate = filtered.length > 0 ? (winCount / filtered.length) * 100 : 0;
  const currentBalance = initialBalance + sorted.reduce((s, h) => s + h.pnl, 0);
  const roiPct = initialBalance > 0 ? ((currentBalance - initialBalance) / initialBalance) * 100 : 0;
  const pnlColor2 = totalPnl >= 0 ? '#0ecb81' : '#f6465d';
  const balColor = currentBalance >= initialBalance ? '#0ecb81' : '#f6465d';

  const fmtUsdt = (v: number) => {
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div style={{ padding: '8px 14px 6px', color: '#d4d9e1' }}>

      {/* Top bar: stats + period selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        {/* Key stats — compact inline */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { label: '잔고', value: `${currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, unit: 'USDT', color: '#f0b90b' },
            { label: '기간손익', value: fmtUsdt(totalPnl), unit: 'USDT', color: pnlColor2 },
            { label: '수익률', value: `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(2)}%`, unit: '', color: balColor },
            { label: '승률', value: `${winRate.toFixed(1)}%`, unit: `(${winCount}/${filtered.length})`, color: '#d4d9e1' },
            { label: '수수료', value: `-${totalFees.toFixed(2)}`, unit: 'USDT', color: '#f59e42' },
          ].map(({ label, value, unit, color }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: '0.62rem', color: '#4a5568', lineHeight: 1 }}>{label}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color, fontFamily: '"SF Mono",Consolas,monospace', lineHeight: 1.2 }}>
                {value}{unit ? <span style={{ fontSize: '0.62rem', color: '#4a5568', fontWeight: 400, marginLeft: 2 }}>{unit}</span> : null}
              </span>
            </div>
          ))}
        </div>

        {/* Period buttons */}
        <div style={{ display: 'flex', gap: 0, alignItems: 'center', flexShrink: 0 }}>
          {(Object.keys(PERIOD_LABELS) as AssetPeriod[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              fontSize: '0.72rem', padding: '2px 7px', background: 'none', border: 'none',
              cursor: 'pointer', fontWeight: period === p ? 700 : 400,
              color: period === p ? '#e0e3eb' : '#3e4f64',
            }}>{PERIOD_LABELS[p]}</button>
          ))}
        </div>
      </div>

      {/* 6 Charts — all in one row */}
      <div style={{ display: 'flex', gap: 10 }}>
        <AssetLineChart
          pts={balancePts}
          gradId="ag-balance"
          color="#f0b90b"
          label="계좌 잔고 추이"
          period={period}
          fmtTooltip={v => `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}
        />
        <AssetLineChart
          pts={cumPnlPts}
          gradId="ag-cumpnl"
          showZeroLine
          color={totalPnl >= 0 ? '#0ecb81' : '#f6465d'}
          label="누적 실현손익"
          period={period}
          fmtTooltip={v => `${v >= 0 ? '+' : ''}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}
        />
        <AssetLineChart
          pts={tradeCountPts}
          gradId="ag-trades"
          color="#7b8cde"
          label="누적 거래횟수"
          period={period}
          fmtTooltip={v => `${Math.round(v)} 건`}
        />
        <AssetLineChart
          pts={winRatePts}
          gradId="ag-winrate"
          color="#a78bfa"
          label="승률 추이"
          period={period}
          fmtTooltip={v => `${v.toFixed(1)}%`}
        />
        <AssetLineChart
          pts={feePts}
          gradId="ag-fees"
          color="#f59e42"
          label="누적 수수료"
          period={period}
          fmtTooltip={v => `-${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}
        />
        <AssetLineChart
          pts={drawdownPts}
          gradId="ag-drawdown"
          color="#f6465d"
          label="최대 드로우다운"
          period={period}
          fmtTooltip={v => `${v.toFixed(2)}%`}
        />
      </div>

    </div>
  );
}


// ── Live Asset Chart ──────────────────────────────────────────────────────────
function LiveAssetChart({ history }: { history: LiveTradeHistoryEntry[] }) {
  const [period, setPeriod] = useState<AssetPeriod>('1M');

  const sorted = useMemo(() => [...history].sort((a, b) => a.exitTime - b.exitTime), [history]);
  const cutMs  = useMemo(() => (period === 'ALL' ? 0 : Date.now() - PERIOD_OFFSETS[period]), [period]);

  const baselineCumPnl = useMemo(() => {
    let acc = 0;
    for (const h of sorted) { if (h.exitTime < cutMs) acc += h.pnl ?? 0; }
    return acc;
  }, [sorted, cutMs]);

  const { filtered, cumPnlPts, tradeCountPts, winRatePts } = useMemo(() => {
    const filtered = sorted.filter(h => h.exitTime >= cutMs);
    const cumPnlPts: AssetPt[] = [];
    const tradeCountPts: AssetPt[] = [];
    const winRatePts: AssetPt[] = [];
    let cumPnl = baselineCumPnl;
    let wins = 0;
    filtered.forEach((h, i) => {
      const pnl = h.pnl ?? 0;
      cumPnl += pnl;
      if (pnl > 0) wins++;
      cumPnlPts.push({ time: h.exitTime, value: cumPnl });
      tradeCountPts.push({ time: h.exitTime, value: i + 1 });
      winRatePts.push({ time: h.exitTime, value: (wins / (i + 1)) * 100 });
    });
    return { filtered, cumPnlPts, tradeCountPts, winRatePts };
  }, [sorted, cutMs, baselineCumPnl]);

  const totalPnl  = filtered.reduce((s, h) => s + (h.pnl ?? 0), 0);
  const winCount  = filtered.filter(h => (h.pnl ?? 0) > 0).length;
  const winRate   = filtered.length > 0 ? (winCount / filtered.length) * 100 : 0;
  const pnlColor2 = totalPnl >= 0 ? '#0ecb81' : '#f6465d';

  return (
    <div style={{ padding: '8px 14px 6px', color: '#d4d9e1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { label: '기간손익', value: `${totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, unit: 'USDT', color: pnlColor2 },
            { label: '승률', value: `${winRate.toFixed(1)}%`, unit: `(${winCount}/${filtered.length})`, color: '#d4d9e1' },
            { label: '거래횟수', value: `${filtered.length}`, unit: '건', color: '#7b8cde' },
          ].map(({ label, value, unit, color }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: '0.62rem', color: '#4a5568', lineHeight: 1 }}>{label}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color, fontFamily: '"SF Mono",Consolas,monospace', lineHeight: 1.2 }}>
                {value}{unit ? <span style={{ fontSize: '0.62rem', color: '#4a5568', fontWeight: 400, marginLeft: 2 }}>{unit}</span> : null}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 0, alignItems: 'center', flexShrink: 0 }}>
          {(Object.keys(PERIOD_LABELS) as AssetPeriod[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              fontSize: '0.72rem', padding: '2px 7px', background: 'none', border: 'none',
              cursor: 'pointer', fontWeight: period === p ? 700 : 400,
              color: period === p ? '#e0e3eb' : '#3e4f64',
            }}>{PERIOD_LABELS[p]}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <AssetLineChart pts={cumPnlPts} gradId="lg-cumpnl" showZeroLine color={pnlColor2} label="누적 실현손익" period={period}
          fmtTooltip={v => `${v >= 0 ? '+' : ''}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`} />
        <AssetLineChart pts={tradeCountPts} gradId="lg-trades" color="#7b8cde" label="누적 거래횟수" period={period}
          fmtTooltip={v => `${Math.round(v)} 건`} />
        <AssetLineChart pts={winRatePts} gradId="lg-winrate" color="#a78bfa" label="승률 추이" period={period}
          fmtTooltip={v => `${v.toFixed(1)}%`} />
      </div>
    </div>
  );
}

// ── Coin logo component ───────────────────────────────────────────────────────
function CoinLogo({ symbol }: { symbol: string }) {
  const coin = extractCoin(symbol).toLowerCase();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div style={s.logoFallback}>
        {coin.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${coin}.png`}
      alt={coin}
      style={s.logoImg}
      onError={() => setFailed(true)}
    />
  );
}

// ── TP/SL Modal ───────────────────────────────────────────────────────────────
const ROI_BTNS_SL = [-5, -10, -20, -30, -50, -75, -90];
const ROI_BTNS_TP = [10, 25, 50, 100, 150, 200, 300];
const TP_ROI_MAX = 500;

function PriceSliderSection({ title, hint, price, markPrice, entryPrice, positionAmt, leverage,
  liquidationPrice, marginType, sectionType, qty, maxQty, coin, onPriceChange, onQtyChange }: {
  title: string; hint: string; price: string; markPrice: number;
  entryPrice: number; positionAmt: number; leverage: number;
  liquidationPrice: number; marginType: 'isolated' | 'cross';
  sectionType: 'tp' | 'sl';
  qty: number; maxQty: number; coin: string;
  onPriceChange: (v: string) => void;
  onQtyChange: (v: number) => void;
}) {
  const parsed = parseFloat(price) || 0;
  const isLong = positionAmt > 0;
  const isTP = sectionType === 'tp';

  // ROI 계산: (isLong ? 1 : -1) * ((exitPrice - entryPrice) / entryPrice) * leverage * 100
  const roi = entryPrice > 0 && parsed > 0
    ? (isLong ? 1 : -1) * ((parsed - entryPrice) / entryPrice) * leverage * 100
    : 0;

  // 청산가 ROI (항상 음수 — 손실 방향)
  const liqROI = entryPrice > 0 && liquidationPrice > 0
    ? (isLong ? 1 : -1) * ((liquidationPrice - entryPrice) / entryPrice) * leverage * 100
    : -100;

  // 슬라이더 범위: TP는 0~TP_ROI_MAX, SL는 liqROI~0
  const slMin = isTP ? 0 : Math.min(-1, liqROI);
  const slMax = isTP ? TP_ROI_MAX : 0;

  const clampedROI = isTP
    ? Math.round(Math.max(0, Math.min(TP_ROI_MAX, roi)))
    : Math.round(Math.max(slMin, Math.min(0, roi)));
  const sliderVal = parsed > 0 ? clampedROI : 0;

  // 눈금: TP는 0→+100→+250→+500, SL는 청산ROI→중간→0
  const sliderTicks: TickDef[] = isTP
    ? [0, 100, 250, 500].map(v => ({
        pct: (v / TP_ROI_MAX) * 100,
        label: v === 0 ? '0' : `+${v}%`,
        major: true,
      }))
    : [
        { pct: 0, label: `${Math.round(liqROI)}%`, major: true },
        { pct: 50, label: `${Math.round(liqROI / 2)}%`, major: false },
        { pct: 100, label: '0', major: true },
      ];

  const color = roi > 0.3 ? '#0ecb81' : roi < -0.3 ? '#f6465d' : '#f0b90b';

  // ROI → 가격 변환: price = entry * (1 + roi / leverage * (isLong ? 1 : -1) / 100)
  const setROI = (r: number) => {
    if (entryPrice <= 0) return;
    const pricePct = r / leverage * (isLong ? 1 : -1);
    const newPrice = entryPrice * (1 + pricePct / 100);
    onPriceChange(String(parseFloat(newPrice.toPrecision(8))));
  };

  // 청산가를 넘는 SL 경고
  const beyondLiq = !isTP && parsed > 0 && liqROI < 0 && roi < liqROI;

  // ── 예상 PnL 계산 (선택된 수량 기준) ──────────────────────────────────────
  const pnl = parsed > 0 && qty > 0 && entryPrice > 0
    ? (isLong ? parsed - entryPrice : entryPrice - parsed) * qty
    : null;
  const fullMargin = entryPrice > 0 && maxQty > 0 && leverage > 0
    ? (entryPrice * maxQty) / leverage
    : 0;
  const partialMargin = maxQty > 0 ? fullMargin * (qty / maxQty) : 0;
  const roiFromPnl = pnl !== null && partialMargin > 0 ? (pnl / partialMargin) * 100 : null;
  const pnlColor = pnl === null ? '#848e9c' : pnl >= 0 ? '#0ecb81' : '#f6465d';

  // SL ROI 버튼: liqROI 이상인 것만 표시
  const slBtns = ROI_BTNS_SL.filter(r => r >= liqROI);

  const qtyPct = maxQty > 0 ? Math.round((qty / maxQty) * 100) : 100;

  return (
    <div style={s.modalInputGroup}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <label style={s.modalLabel}>{title}</label>
        {parsed > 0 && (
          <span style={{ fontSize: '0.72rem', color, fontWeight: 700 }}>
            {roi >= 0 ? '+' : ''}{roi.toFixed(2)}% ROI
          </span>
        )}
      </div>
      <div style={s.modalInputRow}>
        <input
          style={s.modalInput} type="number" step="any"
          placeholder={`현재가: ${fmtPrice(markPrice)}`}
          value={price} onChange={e => onPriceChange(e.target.value)}
        />
        <span style={s.modalUnit}>USDT</span>
      </div>
      <span style={s.modalHint}>{hint}</span>

      {/* 청산가 ROI 힌트 (SL 전용) */}
      {!isTP && liquidationPrice > 0 && (
        <span style={{ ...s.modalHint, color: '#f59e42', marginTop: 2 }}>
          {marginType === 'isolated' ? '격리마진' : '교차마진'} · 청산가 {fmtPrice(liquidationPrice)} USDT (ROI ≈ {liqROI.toFixed(1)}%)
        </span>
      )}

      {/* 청산가 초과 경고 */}
      {beyondLiq && (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(246,70,93,0.1)', border: '1px solid rgba(246,70,93,0.35)', borderRadius: 4, fontSize: '0.72rem', color: '#f6465d', lineHeight: 1.4 }}>
          ⚠ 설정한 손절가({fmtPrice(parsed)})가 청산가({fmtPrice(liquidationPrice)})를 초과합니다. 청산이 먼저 발생할 수 있습니다.
        </div>
      )}

      {/* 예상 PnL 배너 */}
      {pnl !== null && (
        <div style={{ ...s.pnlBanner, borderColor: `${pnlColor}44`, background: `${pnlColor}0d` }}>
          <span style={s.pnlLabel}>예상 손익</span>
          <span style={{ ...s.pnlValue, color: pnlColor }}>
            {pnl >= 0 ? '+' : ''}{fmtPrice(pnl)} USDT
          </span>
          {roiFromPnl !== null && (
            <>
              <span style={s.pnlSep}>|</span>
              <span style={s.pnlLabel}>ROI</span>
              <span style={{ ...s.pnlValue, color: pnlColor }}>
                {roiFromPnl >= 0 ? '+' : ''}{roiFromPnl.toFixed(2)}%
              </span>
            </>
          )}
        </div>
      )}

      {/* Slider */}
      <div style={{ marginTop: 6 }}>
        <HBarMeter
          label=""
          displayValue={parsed > 0 ? `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}
          accentColor={color}
          sliderMin={slMin} sliderMax={slMax} sliderStep={1}
          sliderValue={sliderVal}
          reverseDir={!isTP}
          ticks={sliderTicks}
          onSliderChange={setROI}
        />
      </div>

      {/* Quick ROI buttons */}
      {isTP ? (
        <div style={s.modalQuickRow}>
          <button style={s.modalQuickCur} onClick={() => setROI(0)}>진입가</button>
          {ROI_BTNS_TP.map(r => (
            <button key={r} style={s.modalQuickPos} onClick={() => setROI(r)}>+{r}%</button>
          ))}
        </div>
      ) : (
        <div style={s.modalQuickRow}>
          <button style={s.modalQuickCur} onClick={() => setROI(0)}>진입가</button>
          {slBtns.map(r => (
            <button key={r} style={s.modalQuickNeg} onClick={() => setROI(r)}>{r}%</button>
          ))}
        </div>
      )}

      {/* ── 수량 선택기 ── */}
      <div style={s.qtySection}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ ...s.modalLabel, marginBottom: 0, fontSize: '0.74rem' }}>수량</label>
          <span style={{ fontSize: '0.7rem', color: '#5d6776' }}>
            포지션의 <span style={{ color: '#f0b90b', fontWeight: 700 }}>{qtyPct}%</span>
          </span>
        </div>
        <div style={s.modalInputRow}>
          <input
            style={{ ...s.modalInput, textAlign: 'right' as const }}
            type="number" step="any" min={0} max={maxQty}
            value={qty}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onQtyChange(Math.max(0, Math.min(maxQty, parseFloat(v.toPrecision(8)))));
            }}
          />
          <span style={{ ...s.modalUnit, minWidth: 44, textAlign: 'left' as const }}>{coin}</span>
        </div>
        <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
          {[25, 50, 75, 100].map(qp => {
            const isActive = Math.abs(qtyPct - qp) < 1;
            return (
              <button
                key={qp}
                style={{
                  ...s.modalQuickCur, flex: 1, padding: '4px 0',
                  background: isActive ? 'rgba(240,185,11,0.18)' : '#0d1520',
                  borderColor: isActive ? 'rgba(240,185,11,0.6)' : 'rgba(240,185,11,0.22)',
                  color: isActive ? '#f0b90b' : '#7a8090',
                }}
                onClick={() => onQtyChange(parseFloat((maxQty * qp / 100).toPrecision(8)))}
              >
                {qp}%
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TPSLModalView({
  modal,
  onClose,
  onSubmit,
}: {
  modal: TPSLModal;
  onClose: () => void;
  onSubmit: (tp?: number, sl?: number, tpQty?: number, slQty?: number) => Promise<void>;
}) {
  const pos = modal.position;
  const side = pos.positionAmt > 0 ? 'LONG' : 'SHORT';
  const maxQty = Math.abs(pos.positionAmt);
  const coin = extractCoin(pos.symbol);

  const [tp, setTp] = useState(modal.existingTP ? String(modal.existingTP) : '');
  const [sl, setSl] = useState(modal.existingSL ? String(modal.existingSL) : '');
  const [tpQty, setTpQty] = useState(maxQty);
  const [slQty, setSlQty] = useState(maxQty);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async () => {
    const tpVal = tp.trim() !== '' ? Number(tp) : undefined;
    const slVal = sl.trim() !== '' ? Number(sl) : undefined;
    if (tpVal !== undefined && isNaN(tpVal)) { setErr('TP 가격이 올바르지 않습니다'); return; }
    if (slVal !== undefined && isNaN(slVal)) { setErr('SL 가격이 올바르지 않습니다'); return; }
    if (!tpVal && !slVal) { setErr('TP 또는 SL 중 하나는 입력해야 합니다'); return; }
    if (tpVal && tpQty <= 0) { setErr('TP 수량은 0보다 커야 합니다'); return; }
    if (slVal && slQty <= 0) { setErr('SL 수량은 0보다 커야 합니다'); return; }
    setErr('');
    setLoading(true);
    try {
      await onSubmit(tpVal, slVal, tpQty, slQty);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '주문 실패');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalBox} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>
            <CoinLogo symbol={pos.symbol} />
            <span style={{ marginLeft: 8 }}>{pos.symbol}</span>
            <span style={{ ...s.sideBadge, background: side === 'LONG' ? 'rgba(14,203,129,0.15)' : 'rgba(246,70,93,0.15)', color: sideColor(side), marginLeft: 8 }}>
              {side} {pos.leverage}x
            </span>
          </div>
          <button style={s.modalClose} onClick={onClose}>✕</button>
        </div>

        {/* Position info */}
        <div style={s.modalInfo}>
          <div style={s.modalInfoRow}>
            <span style={s.modalInfoLabel}>진입가</span>
            <span style={s.modalInfoVal}>{fmtPrice(pos.entryPrice)} USDT</span>
          </div>
          <div style={s.modalInfoRow}>
            <span style={s.modalInfoLabel}>현재가</span>
            <span style={s.modalInfoVal}>{fmtPrice(pos.markPrice)} USDT</span>
          </div>
          <div style={s.modalInfoRow}>
            <span style={s.modalInfoLabel}>청산가</span>
            <span style={{ ...s.modalInfoVal, color: '#f59e42' }}>{fmtPrice(pos.liquidationPrice)} USDT</span>
          </div>
          <div style={s.modalInfoRow}>
            <span style={s.modalInfoLabel}>보유 수량</span>
            <span style={s.modalInfoVal}>{fmtQty(maxQty)} {coin}</span>
          </div>
        </div>

        {/* 익절가 */}
        <PriceSliderSection
          title="익절가 (Take Profit)"
          hint={side === 'LONG' ? `진입가보다 높게 설정하세요 (진입 ${fmtPrice(pos.entryPrice)})` : `진입가보다 낮게 설정하세요 (진입 ${fmtPrice(pos.entryPrice)})`}
          price={tp} markPrice={pos.markPrice}
          entryPrice={pos.entryPrice} positionAmt={pos.positionAmt} leverage={pos.leverage}
          liquidationPrice={pos.liquidationPrice} marginType={pos.marginType}
          sectionType="tp"
          qty={tpQty} maxQty={maxQty} coin={coin}
          onPriceChange={setTp}
          onQtyChange={setTpQty}
        />

        {/* 손절가 */}
        <PriceSliderSection
          title="손절가 (Stop Loss)"
          hint={side === 'LONG' ? '진입가보다 낮게 설정하세요' : '진입가보다 높게 설정하세요'}
          price={sl} markPrice={pos.markPrice}
          entryPrice={pos.entryPrice} positionAmt={pos.positionAmt} leverage={pos.leverage}
          liquidationPrice={pos.liquidationPrice} marginType={pos.marginType}
          sectionType="sl"
          qty={slQty} maxQty={maxQty} coin={coin}
          onPriceChange={setSl}
          onQtyChange={setSlQty}
        />

        {err && <div style={s.modalErr}>{err}</div>}

        {/* Disclaimer note */}
        <div style={{
          background: 'rgba(248,193,0,0.07)',
          border: '1px solid rgba(248,193,0,0.22)',
          borderRadius: 4,
          color: '#7a8090',
          fontSize: '0.75rem',
          lineHeight: 1.55,
          marginTop: 8,
          padding: '7px 10px',
        }}>
          ⚠ 기본적으로 거래소 TP/SL 주문을 우선 시도하며, 거래소 주문이 거절될 때에만 앱 내부 모니터링 SL로 보조 처리될 수 있습니다. 브라우저 종료 또는 네트워크 장애 시 앱 감시 SL은 작동하지 않을 수 있으므로, 중요한 포지션은 반드시 바이낸스 앱 주문 등록 여부를 함께 확인하세요.
        </div>

        <div style={s.modalActions}>
          <button style={s.modalCancelBtn} onClick={onClose} disabled={loading}>취소</button>
          <button style={s.modalSubmitBtn} onClick={handleSubmit} disabled={loading}>
            {loading ? '처리 중...' : '설정'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function BottomPanel({
  allPositions, allOrders, onCancelOrder, onPlaceTPSL, onSelectTicker, height, onHeightChange,
  clientSlMap, onRemoveClientSL,
  isPaperMode, paperPositions, paperRawPositions, paperBalance,
  paperOrders, paperHistory, paperInitialBalance,
  onPaperClosePosition, onPaperSetTPSL, onPaperResetBalance,
  onPaperCancelOrder, onPaperClearHistory, onOpenAltPosition, onOpenAltInMain, liveAltMetaMap,
  liveAltOrderTagMap, liveHistory, onLiveCloseMarket, onLiveCloseCurrentPrice,
}: Props) {
  const [tab, setTab] = useState<Tab>('positions');

  // Date range filter for history tabs
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [paperHistoryLimit, setPaperHistoryLimit] = useState<number | null>(10);
  const [liveHistoryLimit, setLiveHistoryLimit] = useState<number | null>(10);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [tpslModal, setTpslModal] = useState<TPSLModal | null>(null);
  const [liveCurrentCloseState, setLiveCurrentCloseState] = useState<Record<string, { kind: 'pending' | 'sent' | 'success' | 'not_filled' | 'failed'; message: string }>>({});
  const lastY = useRef(0);
  const allPositionsRef = useRef<FuturesPosition[]>(allPositions);
  allPositionsRef.current = allPositions;
  // 1-second tick for ALT meta countdown
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const tid = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tid);
  }, []);
  useEffect(() => {
    if (tab === 'paper-history') setPaperHistoryLimit(10);
    if (tab === 'live-history') setLiveHistoryLimit(10);
  }, [tab]);

  const fromTs = dateFrom ? new Date(dateFrom).getTime() : 0;
  const toTs = dateTo ? new Date(dateTo).getTime() + 86399999 : Number.POSITIVE_INFINITY;

  const paperHistoryRows = useMemo<UnifiedHistoryRow[]>(
    () => (paperHistory ?? []).map(h => ({
      id: h.id,
      symbol: h.symbol,
      positionSide: h.positionSide,
      qty: h.qty,
      leverage: h.leverage,
      entryPrice: h.entryPrice,
      exitPrice: h.exitPrice,
      pnl: h.pnl,
      fees: h.fees,
      entryTime: h.entryTime,
      exitTime: h.exitTime,
      closeReason: h.closeReason,
      interval: h.interval,
      candidateScore: h.candidateScore ?? null,
      plannedEntry: h.plannedEntry ?? null,
      plannedTP: h.plannedTP ?? null,
      plannedSL: h.plannedSL ?? null,
    })),
    [paperHistory],
  );

  const liveHistoryRows = useMemo<UnifiedHistoryRow[]>(
    () => (liveHistory ?? []).map(h => ({
      id: h.id,
      symbol: h.symbol,
      positionSide: h.positionSide,
      qty: h.qty,
      leverage: h.leverage,
      entryPrice: h.entryPrice,
      exitPrice: h.exitPrice,
      pnl: h.pnl,
      fees: h.fees,
      entryTime: h.entryTime,
      exitTime: h.exitTime,
      closeReason: h.closeReason,
      interval: h.interval,
      candidateScore: h.candidateScore ?? null,
      plannedEntry: h.plannedEntry ?? null,
      plannedTP: h.plannedTP ?? null,
      plannedSL: h.plannedSL ?? null,
    })),
    [liveHistory],
  );

  const filteredPaperHistory = useMemo(
    () => paperHistoryRows.filter(h => h.exitTime >= fromTs && h.exitTime <= toTs).sort((a, b) => b.exitTime - a.exitTime),
    [paperHistoryRows, fromTs, toTs],
  );
  const filteredLiveHistory = useMemo(
    () => liveHistoryRows.filter(h => h.exitTime >= fromTs && h.exitTime <= toTs).sort((a, b) => b.exitTime - a.exitTime),
    [liveHistoryRows, fromTs, toTs],
  );

  const visiblePaperHistory = paperHistoryLimit == null ? filteredPaperHistory : filteredPaperHistory.slice(0, paperHistoryLimit);
  const visibleLiveHistory = liveHistoryLimit == null ? filteredLiveHistory : filteredLiveHistory.slice(0, liveHistoryLimit);

  // Shared time formatter (MM/DD HH:MM:SS)
  const fmtEntryTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  };

  // Balance reset state (shown in tab bar)
  const [resetBalInput, setResetBalInput] = useState('');
  const [showResetBal, setShowResetBal] = useState(false);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    lastY.current = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const delta = lastY.current - ev.clientY;
      lastY.current = ev.clientY;
      onHeightChange(delta);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleCancel = async (orderId: string, symbol: string) => {
    setCancellingId(orderId);
    try { await onCancelOrder(orderId, symbol); } finally { setCancellingId(null); }
  };

  const openTPSL = (pos: FuturesPosition, isPaper = false) => {
    if (isPaper) {
      const raw = paperRawPositions?.find(p => p.entryTime === pos.updateTime);
      setTpslModal({ position: pos, existingTP: raw?.tpPrice, existingSL: raw?.slPrice });
      return;
    }
    const sym = pos.symbol;
    const side = pos.positionAmt > 0 ? 'LONG' : 'SHORT';
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
    // 조건부 TP(TAKE_PROFIT_MARKET/TAKE_PROFIT) 또는 LIMIT 주문(조건부 미지원 심볼 fallback)
    const tpCond = allOrders.find(o => o.symbol === sym && o.side === closeSide &&
      (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT'));
    const tpLimitFallback = allOrders.find(o => o.symbol === sym && o.side === closeSide &&
      o.type === 'LIMIT' &&
      ((side === 'LONG' && o.price > pos.entryPrice) || (side === 'SHORT' && o.price < pos.entryPrice)));
    const existingTP = tpCond ? (tpCond.stopPrice > 0 ? tpCond.stopPrice : tpCond.price)
      : tpLimitFallback?.price;
    const slCond = allOrders.find(o => o.symbol === sym && o.side === closeSide &&
      (o.type === 'STOP_MARKET' || o.type === 'STOP'));
    const clientSlPrice = clientSlMap?.[`${sym}_${pos.positionSide}`]?.price;
    const existingSL = slCond
      ? (slCond.stopPrice > 0 ? slCond.stopPrice : slCond.price)
      : clientSlPrice;
    setTpslModal({ position: pos, existingTP, existingSL });
  };

  const renderTradeHistory = (
    mode: 'paper' | 'live',
    filteredRows: UnifiedHistoryRow[],
    visibleRows: UnifiedHistoryRow[],
    limit: number | null,
    setLimit: (v: number | null) => void,
  ) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 4px', borderBottom: '1px solid #1a2535' }}>
        <span style={{ fontSize: '0.72rem', color: '#848e9c' }}>기간:</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={{ ...s.paperInput, width: 130, fontSize: '0.74rem', padding: '2px 6px' }} />
        <span style={{ fontSize: '0.72rem', color: '#848e9c' }}>~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          style={{ ...s.paperInput, width: 130, fontSize: '0.74rem', padding: '2px 6px' }} />
        <button
          style={{ ...s.cancelBtn, color: '#f0b90b', borderColor: 'rgba(240,185,11,0.35)' }}
          onClick={() => {
            const dataRows: ExcelCell[][] = filteredRows.map(h => {
              const margin = h.entryPrice != null && h.leverage != null && h.leverage > 0
                ? (h.entryPrice * h.qty / h.leverage)
                : null;
              const roi = margin != null && margin > 0 && h.pnl != null ? (h.pnl / margin) * 100 : null;
              const pnlText = h.pnl != null ? `${h.pnl >= 0 ? '+' : ''}${h.pnl.toFixed(4)}` : '-';
              return [
                { value: h.symbol },
                { value: h.positionSide, color: h.positionSide === 'LONG' ? 'green' : 'red' },
                { value: h.qty, align: 'right' },
                { value: h.leverage != null ? `${h.leverage}x` : '-', align: 'center' },
                { value: margin != null ? margin.toFixed(2) : '-', align: 'right' },
                { value: h.entryPrice != null ? h.entryPrice : '-', align: 'right' },
                { value: h.exitPrice != null ? h.exitPrice : '-', align: 'right' },
                { value: pnlText, color: h.pnl != null ? (h.pnl >= 0 ? 'green' : 'red') : 'gray', bold: true, align: 'right' },
                { value: roi != null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%` : '-', color: roi != null ? (roi >= 0 ? 'green' : 'red') : 'gray', align: 'right' },
                { value: h.fees != null ? `-${h.fees.toFixed(4)}` : '-', color: 'orange', align: 'right' },
                { value: reasonLabel(h.closeReason), color: reasonColorByReason(h.closeReason) },
                { value: h.interval ?? '—', align: 'center' },
                { value: h.candidateScore != null ? h.candidateScore.toFixed(1) : '-', align: 'right' },
                { value: h.plannedTP != null ? h.plannedTP : '-', align: 'right' },
                { value: h.plannedSL != null ? h.plannedSL : '-', align: 'right' },
                { value: h.entryTime ? fmtEntryTime(h.entryTime) : '-' },
                { value: fmtEntryTime(h.exitTime) },
              ] as ExcelCell[];
            });
            downloadExcel(`${mode === 'paper' ? '모의거래' : '실전거래'}_히스토리_${dateFrom || '전체'}_${dateTo || '전체'}.xls`, [
              { label: '심볼', width: 14 }, { label: '방향', width: 8 }, { label: '수량', width: 12 },
              { label: '레버리지', width: 8 }, { label: '투입마진(USDT)', width: 14 },
              { label: '진입가(USDT)', width: 14 }, { label: '청산가(USDT)', width: 14 },
              { label: '실현손익(USDT)', width: 16 }, { label: 'ROI(%)', width: 10 },
              { label: '수수료(USDT)', width: 14 }, { label: '사유', width: 10 },
              { label: '타임프레임', width: 10 },
              { label: 'Score', width: 8 }, { label: '계획TP', width: 12 }, { label: '계획SL', width: 12 },
              { label: '진입시간', width: 20 }, { label: '종료시간', width: 20 },
            ], dataRows);
          }}
        >
          엑셀 내보내기
        </button>
        <div style={{ marginLeft: 8, display: 'flex', gap: 6 }}>
          <button
            style={{ ...s.cancelBtn, color: '#d1d4dc', borderColor: 'rgba(132,142,156,0.35)' }}
            onClick={() => setLimit(50)}
          >
            더보기
          </button>
          <button
            style={{ ...s.cancelBtn, color: '#d1d4dc', borderColor: 'rgba(132,142,156,0.35)' }}
            onClick={() => setLimit(null)}
          >
            전체보기
          </button>
          {limit !== 10 && (
            <button
              style={{ ...s.cancelBtn, color: '#d1d4dc', borderColor: 'rgba(132,142,156,0.35)' }}
              onClick={() => setLimit(10)}
            >
              최근10개
            </button>
          )}
        </div>
        <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#5d6776' }}>
          {limit == null ? `${filteredRows.length}/${filteredRows.length}` : `${Math.min(filteredRows.length, limit)}/${filteredRows.length}`}
        </span>
        <div style={{ flex: 1 }} />
        {mode === 'paper' && (paperHistory?.length ?? 0) > 0 && (
          <button style={{ ...s.cancelBtn, color: '#f6465d', borderColor: 'rgba(246,70,93,0.3)' }} onClick={onPaperClearHistory}>
            전체 삭제
          </button>
        )}
      </div>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>심볼</th>
            <th style={s.th}>방향</th>
            <th style={s.th}>수량</th>
            <th style={s.th}>레버리지</th>
            <th style={s.th}>투입마진 (USDT)</th>
            <th style={s.th}>진입가 (USDT)</th>
            <th style={s.th}>청산가 (USDT)</th>
            <th style={s.th}>실현손익 (USDT) / ROI</th>
            <th style={s.th}>수수료 (USDT)</th>
            <th style={s.th}>사유</th>
            <th style={s.th}>타임프레임</th>
            <th style={s.th}>Score</th>
            <th style={s.th}>계획 TP</th>
            <th style={s.th}>계획 SL</th>
            <th style={s.th}>진입시간</th>
            <th style={s.th}>종료시간</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr><td colSpan={16} style={s.empty}>거래 히스토리 없음</td></tr>
          ) : visibleRows.map(h => {
            const margin = h.entryPrice != null && h.leverage != null && h.leverage > 0
              ? (h.entryPrice * h.qty / h.leverage)
              : null;
            const roi = margin != null && margin > 0 && h.pnl != null ? (h.pnl / margin) * 100 : null;
            const pnlCol = h.pnl == null ? '#848e9c' : (h.pnl >= 0 ? '#0ecb81' : '#f6465d');
            return (
              <tr key={h.id} style={s.tr}>
                <td style={s.td}>
                  <div style={s.symbolCell}>
                    <CoinLogo symbol={h.symbol} />
                    <div style={{ ...s.symbolText, ...s.symbolClickable }} onClick={() => onSelectTicker(h.symbol)}>
                      <span style={s.symbolName}>{extractCoin(h.symbol)}</span>
                      <span style={s.symbolFull}>{h.symbol}</span>
                    </div>
                  </div>
                </td>
                <td style={s.td}><span style={{ ...s.sideBadge, background: h.positionSide === 'LONG' ? 'rgba(14,203,129,0.12)' : 'rgba(246,70,93,0.12)', color: h.positionSide === 'LONG' ? '#0ecb81' : '#f6465d' }}>{h.positionSide}</span></td>
                <td style={s.td}>{fmtQty(h.qty)}</td>
                <td style={s.td}>{h.leverage != null ? `${h.leverage}x` : '—'}</td>
                <td style={s.td}><div style={s.priceCell}><span>{margin != null ? fmtPrice(margin) : '—'}</span><span style={s.priceUnit}>USDT</span></div></td>
                <td style={s.td}><div style={s.priceCell}><span>{h.entryPrice != null ? fmtPrice(h.entryPrice) : '—'}</span><span style={s.priceUnit}>USDT</span></div></td>
                <td style={s.td}><div style={s.priceCell}><span>{h.exitPrice != null ? fmtPrice(h.exitPrice) : '—'}</span><span style={s.priceUnit}>USDT</span></div></td>
                <td style={{ ...s.td, color: pnlCol, fontWeight: 700 }}>
                  <div style={s.pnlCell}>
                    <span>{h.pnl != null ? `${h.pnl >= 0 ? '+' : ''}${fmtPrice(h.pnl)} USDT` : '—'}</span>
                    <span style={{ ...s.roiTag, color: pnlCol }}>{roi != null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%` : '—'}</span>
                  </div>
                </td>
                <td style={{ ...s.td, color: '#f59e42', fontSize: '0.73rem' }}>
                  <div style={s.priceCell}><span>{h.fees != null ? `−${fmtPrice(h.fees)}` : '—'}</span><span style={s.priceUnit}>USDT</span></div>
                </td>
                <td style={{ ...s.td, color: reasonColorByReason(h.closeReason), fontWeight: 600 }}>{reasonLabel(h.closeReason)}</td>
                <td style={{ ...s.td, textAlign: 'center' }}>
                  {h.interval
                    ? <span style={{ color: '#3b8beb', fontWeight: 700, fontSize: '0.8rem', background: 'rgba(59,139,235,0.12)', borderRadius: 4, padding: '2px 7px' }}>{h.interval}</span>
                    : <span style={{ color: '#3a4558', fontSize: '0.75rem' }}>—</span>
                  }
                </td>
                <td style={s.td}>{h.candidateScore != null ? h.candidateScore.toFixed(1) : '—'}</td>
                <td style={s.td}>{h.plannedTP != null ? fmtPrice(h.plannedTP) : '—'}</td>
                <td style={s.td}>{h.plannedSL != null ? fmtPrice(h.plannedSL) : '—'}</td>
                <td style={{ ...s.td, color: '#5d6776', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{h.entryTime ? fmtEntryTime(h.entryTime) : '—'}</td>
                <td style={{ ...s.td, color: '#5d6776', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{fmtEntryTime(h.exitTime)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ ...s.container, height }}>
      {/* Drag handle */}
      <div style={s.resizeHandle} onMouseDown={handleResizeMouseDown} title="드래그하여 크기 조절" />

      {/* Tab bar */}
      <div style={s.tabBar}>
        {isPaperMode ? (
          <>
            {/* Paper mode tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
              <span style={{ fontSize: '0.72rem', color: '#f0b90b', fontWeight: 700, background: 'rgba(240,185,11,0.12)', border: '1px solid rgba(240,185,11,0.35)', borderRadius: 3, padding: '1px 6px' }}>
                📄 모의거래
              </span>
            </div>
            <button style={{ ...s.tab, ...(tab === 'positions' ? s.tabActive : {}) }} onClick={() => setTab('positions')}>
              포지션
              {(paperPositions?.length ?? 0) > 0 && <span style={s.badge}>{paperPositions!.length}</span>}
            </button>
            <button style={{ ...s.tab, ...(tab === 'paper-orders' ? s.tabActive : {}) }} onClick={() => setTab('paper-orders')}>
              예약주문
              {(paperOrders?.length ?? 0) > 0 && <span style={{ ...s.badge, background: '#f0b90b', color: '#131722' }}>{paperOrders!.length}</span>}
            </button>
            <button style={{ ...s.tab, ...(tab === 'paper-history' ? s.tabActive : {}) }} onClick={() => setTab('paper-history')}>
              거래 히스토리
              {(paperHistory?.length ?? 0) > 0 && <span style={s.badge}>{paperHistory!.length}</span>}
            </button>
            <button style={{ ...s.tab, ...(tab === 'paper-asset' ? s.tabActive : {}) }} onClick={() => setTab('paper-asset')}>
              자산현황
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: '0.78rem', color: '#848e9c', paddingRight: 8 }}>
              잔고: <span style={{ color: '#f0b90b', fontWeight: 700 }}>{(paperBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span>
            </span>
            {showResetBal ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8 }}>
                <input
                  type="number" min="0" placeholder="10000"
                  value={resetBalInput}
                  onChange={e => setResetBalInput(e.target.value)}
                  style={{ ...s.paperInput, width: 72, fontSize: '0.76rem', padding: '3px 6px' }}
                />
                <button style={s.paperResetConfirm} onClick={() => {
                  const v = parseFloat(resetBalInput);
                  if (v > 0) onPaperResetBalance?.(v);
                  setShowResetBal(false); setResetBalInput('');
                }}>확인</button>
                <button style={s.cancelBtn} onClick={() => { setShowResetBal(false); setResetBalInput(''); }}>취소</button>
              </div>
            ) : (
              <button style={{ ...s.cancelBtn, marginRight: 8 }} onClick={() => setShowResetBal(true)}>잔고초기화</button>
            )}
          </>
        ) : (
          <>
            <button style={{ ...s.tab, ...(tab === 'positions' ? s.tabActive : {}) }} onClick={() => setTab('positions')}>
              포지션
              {allPositions.length > 0 && <span style={s.badge}>{allPositions.length}</span>}
            </button>
            <button style={{ ...s.tab, ...(tab === 'orders' ? s.tabActive : {}) }} onClick={() => setTab('orders')}>
              미체결 주문
              {allOrders.length > 0 && <span style={s.badge}>{allOrders.length}</span>}
            </button>
            <button style={{ ...s.tab, ...(tab === 'live-history' ? s.tabActive : {}) }} onClick={() => setTab('live-history')}>
              거래 히스토리
            </button>
            <button style={{ ...s.tab, ...(tab === 'live-asset' ? s.tabActive : {}) }} onClick={() => setTab('live-asset')}>
              자산현황
            </button>
          </>
        )}
      </div>

      {/* Table */}
      <div style={s.tableWrap}>
        {/* Paper pending orders tab */}
        {isPaperMode && tab === 'paper-orders' && (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>심볼</th>
                <th style={s.th}>방향</th>
                <th style={s.th}>수량</th>
                <th style={s.th}>레버리지</th>
                <th style={s.th}>지정가 (USDT)</th>
                <th style={s.th}>예상마진 (USDT)</th>
                <th style={s.th}>구분</th>
                <th style={s.th}>등록시간</th>
                <th style={s.th}>취소</th>
              </tr>
            </thead>
            <tbody>
              {(paperOrders?.length ?? 0) === 0 ? (
                <tr><td colSpan={9} style={s.empty}>예약주문 없음</td></tr>
              ) : paperOrders!.map(o => {
                const isBuy = o.side === 'BUY';
                const label = o.reduceOnly ? (isBuy ? '숏 청산' : '롱 청산') : (isBuy ? '롱 매수' : '숏 매도');
                const col = o.reduceOnly ? '#f59e42' : isBuy ? '#0ecb81' : '#f6465d';
                const isConditional = o.triggerType === 'close_above' || o.triggerType === 'close_below';
                const triggerLabel = isConditional
                  ? (o.triggerType === 'close_above' ? '종가≥ 조건부' : '종가≤ 조건부')
                  : '지정가';
                return (
                  <tr key={o.id} style={s.tr}>
                    <td style={s.td}>
                      <div style={s.symbolCell}>
                        <CoinLogo symbol={o.symbol} />
                        <div style={{ ...s.symbolText, ...s.symbolClickable }}
                          onClick={() => onSelectTicker(o.symbol)} title={`${o.symbol} 차트로 이동`}>
                          <span style={s.symbolName}>{extractCoin(o.symbol)}</span>
                          <span style={s.symbolFull}>{o.symbol}</span>
                        </div>
                        <span style={{ fontSize: '0.6rem', background: 'rgba(240,185,11,0.15)', color: '#f0b90b', borderRadius: 3, padding: '1px 4px', fontWeight: 700, marginLeft: 2 }}>모의</span>
                        {o.altMeta && (
                          <button
                            style={{ fontSize: '0.58rem', background: 'rgba(59,139,235,0.18)', color: '#3b8beb', borderRadius: 3, padding: '1px 5px', fontWeight: 700, border: '1px solid rgba(59,139,235,0.4)', cursor: 'pointer', lineHeight: 1.3, marginLeft: 4 }}
                            onClick={() => onOpenAltPosition?.(o.altMeta!)}
                            title="ALT추천 스냅샷 보기"
                          >ALT추천</button>
                        )}
                      </div>
                    </td>
                    <td style={s.td}><span style={{ ...s.sideBadge, background: isBuy ? 'rgba(14,203,129,0.12)' : 'rgba(246,70,93,0.12)', color: isBuy ? '#0ecb81' : '#f6465d' }}>{o.side}</span></td>
                    <td style={s.td}>{o.qty}</td>
                    <td style={s.td}>{o.leverage}x</td>
                    <td style={s.td}>
                      <div style={s.priceCell}>
                        <span>{o.limitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</span>
                        <span style={s.priceUnit}>USDT</span>
                      </div>
                      <div style={{ fontSize: '0.64rem', color: isConditional ? '#f0b90b' : '#848e9c', marginTop: 1 }}>{triggerLabel}</div>
                    </td>
                    <td style={s.td}>
                      <div style={s.priceCell}>
                        <span>{(o.limitPrice * o.qty / o.leverage).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span style={s.priceUnit}>USDT</span>
                      </div>
                    </td>
                    <td style={{ ...s.td, color: col, fontWeight: 600, fontSize: '0.8rem' }}>{label}</td>
                    <td style={{ ...s.td, color: '#5d6776', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{fmtEntryTime(o.placedAt)}</td>
                    <td style={s.td}>
                      <button
                        style={{ ...s.cancelBtn, color: '#f6465d', borderColor: 'rgba(246,70,93,0.3)' }}
                        onClick={() => onPaperCancelOrder?.(o.id)}
                      >취소</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Paper history tab */}
        {isPaperMode && tab === 'paper-history' && (
          renderTradeHistory('paper', filteredPaperHistory, visiblePaperHistory, paperHistoryLimit, setPaperHistoryLimit)
        )}

        {/* Paper asset tab */}
        {isPaperMode && tab === 'paper-asset' && (
          <PaperAssetChart
            history={paperHistory ?? []}
            initialBalance={paperInitialBalance ?? 10000}
          />
        )}

        {/* Live history tab */}
        {!isPaperMode && tab === 'live-history' && (
          renderTradeHistory('live', filteredLiveHistory, visibleLiveHistory, liveHistoryLimit, setLiveHistoryLimit)
        )}

        {/* Live asset tab */}
        {!isPaperMode && tab === 'live-asset' && (
          <LiveAssetChart history={liveHistory ?? []} />
        )}

        {/* Positions tab */}
        {tab === 'positions' && (
          <>
            {/* Positions table */}
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>심볼</th>
                  <th style={s.th}>방향 / 레버리지</th>
                  <th style={s.th}>크기 (수량 / USDT)</th>
                  <th style={s.th}>진입가 (USDT)</th>
                  <th style={s.th}>현재가 (USDT)</th>
                  <th style={s.th}>청산가 (USDT)</th>
                  <th style={s.th}>마진</th>
                  <th style={s.th}>미실현 손익 (ROI)</th>
                  <th style={s.th}>TP / SL</th>
                  <th style={s.th}>유효 시간</th>
                  <th style={s.th}>진입시간</th>
                  <th style={s.th}>청산</th>
                </tr>
              </thead>
              <tbody>
                {isPaperMode ? (
                  (paperPositions?.length ?? 0) === 0 ? (
                    <tr><td colSpan={12} style={s.empty}>모의 포지션 없음 — 위 폼에서 주문을 넣어보세요</td></tr>
                  ) : paperPositions!.map(pos => {
                    const side = pos.positionAmt > 0 ? 'LONG' : 'SHORT';
                    const absAmt = Math.abs(pos.positionAmt);
                    const notionalUsdt = absAmt * pos.markPrice;
                    const margin = pos.entryPrice > 0 ? absAmt * pos.entryPrice / pos.leverage : 0;
                    const roi = margin > 0 ? (pos.unrealizedProfit / margin) * 100 : 0;
                    const rawForBadge = paperRawPositions?.find(p => p.entryTime === pos.updateTime);
                    const altMeta = rawForBadge?.altMeta;
                    const remMs = altMeta ? Math.max(0, altMeta.validUntilTime - nowMs) : 0;
                    const remH = Math.floor(remMs / 3600000);
                    const remM = Math.floor((remMs % 3600000) / 60000);
                    const remS = Math.floor((remMs % 60000) / 1000);
                    const remStr = remMs > 0
                      ? `${String(remH).padStart(2,'0')}:${String(remM).padStart(2,'0')}:${String(remS).padStart(2,'0')}`
                      : '만료';
                    return (
                      <tr key={`paper-${pos.symbol}-${pos.positionSide}-${pos.updateTime}`} style={s.tr}>
                        <td style={s.td}>
                          <div style={s.symbolCell}>
                            <CoinLogo symbol={pos.symbol} />
                            <div style={{ ...s.symbolText, ...s.symbolClickable }}
                              onClick={() => altMeta ? onOpenAltInMain?.(altMeta) : onSelectTicker(pos.symbol)} title={`${pos.symbol} 차트로 이동`}>
                              <span style={s.symbolName}>{extractCoin(pos.symbol)}</span>
                              <span style={s.symbolFull}>{pos.symbol}</span>
                            </div>
                            <span style={{ fontSize: '0.6rem', background: 'rgba(240,185,11,0.15)', color: '#f0b90b', borderRadius: 3, padding: '1px 4px', fontWeight: 700, marginLeft: 2 }}>모의</span>
                            {altMeta && (
                              <button
                                style={{ fontSize: '0.58rem', background: 'rgba(59,139,235,0.18)', color: '#3b8beb', borderRadius: 3, padding: '1px 5px', fontWeight: 700, border: '1px solid rgba(59,139,235,0.4)', cursor: 'pointer', lineHeight: 1.3, marginLeft: 4 }}
                                onClick={() => onOpenAltPosition?.(altMeta)}
                                title="ALT추천 스냅샷 보기"
                              >ALT추천</button>
                            )}
                          </div>
                        </td>
                        <td style={s.td}>
                          <span style={{ ...s.sideBadge, background: side === 'LONG' ? 'rgba(14,203,129,0.12)' : 'rgba(246,70,93,0.12)', color: sideColor(side) }}>{side}</span>
                          <span style={s.leverageTag}>{pos.leverage}x</span>
                          <span style={s.marginTypeTag}>{pos.marginType === 'isolated' ? '격리' : '교차'}</span>
                        </td>
                        <td style={s.td}>
                          <div style={s.sizeCell}>
                            <span style={s.sizeQty}>{fmtQty(absAmt)} {extractCoin(pos.symbol)}</span>
                            <span style={s.sizeUsdt}>{notionalUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span>
                          </div>
                        </td>
                        <td style={s.td}><div style={s.priceCell}><span>{fmtPrice(pos.entryPrice)}</span><span style={s.priceUnit}>USDT</span></div></td>
                        <td style={s.td}><div style={s.priceCell}><span>{fmtPrice(pos.markPrice)}</span><span style={s.priceUnit}>USDT</span></div></td>
                        <td style={s.td}><div style={s.priceCell}><span style={{ color: '#f59e42' }}>{fmtPrice(pos.liquidationPrice)}</span><span style={s.priceUnit}>USDT</span></div></td>
                        <td style={s.td}><div style={s.priceCell}><span>{margin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span style={s.priceUnit}>USDT</span></div></td>
                        <td style={{ ...s.td, color: pnlColor(pos.unrealizedProfit) }}>
                          <div style={s.pnlCell}>
                            <span>{pos.unrealizedProfit >= 0 ? '+' : ''}{fmtPrice(pos.unrealizedProfit)} USDT</span>
                            <span style={s.roiTag}>({roi >= 0 ? '+' : ''}{roi.toFixed(2)}%)</span>
                          </div>
                        </td>
                        <td style={s.td}>
                          {(() => {
                            const raw = paperRawPositions?.find(p => p.entryTime === pos.updateTime);
                            return (
                              <div style={s.tpslCell}>
                                {(raw?.tpPrice || raw?.slPrice) && (
                                  <div style={s.tpslPrices}>
                                    <span style={{ color: '#0ecb81', fontSize: '0.74rem' }}>TP: {raw.tpPrice ? fmtPrice(raw.tpPrice) : '—'}</span>
                                    <span style={{ color: '#f6465d', fontSize: '0.74rem' }}>SL: {raw.slPrice ? fmtPrice(raw.slPrice) : '—'}</span>
                                  </div>
                                )}
                                <button style={s.tpslBtn} onClick={() => openTPSL(pos, true)}>
                                  {raw?.tpPrice || raw?.slPrice ? '수정' : 'TP/SL 설정'}
                                </button>
                              </div>
                            );
                          })()}
                        </td>
                        {/* 유효 시간 column (paper) */}
                        <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                          {altMeta ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ color: '#3b8beb', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.03em' }}>{altMeta.scanInterval}</span>
                              <span style={{ color: remMs > 0 ? '#848e9c' : '#f6465d' }}>{remStr}</span>
                            </div>
                          ) : '—'}
                        </td>
                        {/* 진입시간 column (paper) */}
                        <td style={{ ...s.td, color: '#5d6776', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                          {rawForBadge?.entryTime ? fmtEntryTime(rawForBadge.entryTime) : '—'}
                        </td>
                        <td style={s.td}>
                          <button
                            style={{ ...s.cancelBtn, color: '#f6465d', borderColor: 'rgba(246,70,93,0.3)' }}
                            onClick={() => onPaperClosePosition?.(pos.updateTime!)}
                          >청산</button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  allPositions.length === 0 ? (
                    <tr><td colSpan={12} style={s.empty}>포지션 없음</td></tr>
                  ) : allPositions.map(pos => {
                    const side = pos.positionAmt > 0 ? 'LONG' : 'SHORT';
                    const liveDir = side === 'LONG' ? 'long' : 'short';
                    const liveMeta = liveAltMetaMap?.[`${pos.symbol}_${liveDir}`];
                    const liveRemMs = liveMeta ? Math.max(0, liveMeta.validUntilTime - nowMs) : 0;
                    const liveRemH = Math.floor(liveRemMs / 3600000);
                    const liveRemM = Math.floor((liveRemMs % 3600000) / 60000);
                    const liveRemS = Math.floor((liveRemMs % 60000) / 1000);
                    const liveRemStr = liveRemMs > 0
                      ? `${String(liveRemH).padStart(2,'0')}:${String(liveRemM).padStart(2,'0')}:${String(liveRemS).padStart(2,'0')}`
                      : '만료';
                    const absAmt = Math.abs(pos.positionAmt);
                    const notionalUsdt = absAmt * pos.markPrice;
                    const margin = pos.entryPrice > 0 ? absAmt * pos.entryPrice / pos.leverage : 0;
                    const roi = margin > 0 ? (pos.unrealizedProfit / margin) * 100 : 0;
                    const closeSideForPos = side === 'LONG' ? 'SELL' : 'BUY';
                    const iocCloseKey = `${pos.symbol}_${pos.positionSide}_ioc`;
                    const iocStatus = liveCurrentCloseState[iocCloseKey];
                    const iocBusy = iocStatus?.kind === 'pending' || iocStatus?.kind === 'sent';
                    const tpOrder = allOrders.find(o => o.symbol === pos.symbol && o.side === closeSideForPos &&
                      (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' ||
                        (o.type === 'LIMIT' && ((side === 'LONG' && o.price > pos.entryPrice) || (side === 'SHORT' && o.price < pos.entryPrice)))));
                    const slOrder = allOrders.find(o => o.symbol === pos.symbol && o.side === closeSideForPos &&
                      (o.type === 'STOP_MARKET' || o.type === 'STOP'));
                    const tpPrice = tpOrder ? (tpOrder.stopPrice > 0 ? tpOrder.stopPrice : tpOrder.price) : 0;
                    const clientSl = clientSlMap?.[`${pos.symbol}_${pos.positionSide}`];
                    const slDisplayPrice = slOrder
                      ? (slOrder.stopPrice > 0 ? slOrder.stopPrice : slOrder.price)
                      : (clientSl?.price ?? 0);
                    const isClientSl = !slOrder && (clientSl?.price ?? 0) > 0;
                    return (
                      <tr key={`${pos.symbol}-${pos.positionSide}`} style={s.tr}>
                        <td style={s.td}>
                          <div style={s.symbolCell}>
                            <CoinLogo symbol={pos.symbol} />
                            <div style={{ ...s.symbolText, ...s.symbolClickable }}
                              onClick={() => liveMeta ? onOpenAltInMain?.(liveMeta) : onSelectTicker(pos.symbol)} title={`${pos.symbol} 차트로 이동`}>
                              <span style={s.symbolName}>{extractCoin(pos.symbol)}</span>
                              <span style={s.symbolFull}>{pos.symbol}</span>
                            </div>
                            {liveMeta && (
                              <button
                                style={{ fontSize: '0.58rem', background: 'rgba(59,139,235,0.18)', color: '#3b8beb', borderRadius: 3, padding: '1px 5px', fontWeight: 700, border: '1px solid rgba(59,139,235,0.4)', cursor: 'pointer', lineHeight: 1.3, marginLeft: 4 }}
                                onClick={() => onOpenAltPosition?.(liveMeta)}
                                title="ALT추천 스냅샷 보기"
                              >ALT추천</button>
                            )}
                          </div>
                        </td>
                        <td style={s.td}>
                          <span style={{ ...s.sideBadge, background: side === 'LONG' ? 'rgba(14,203,129,0.12)' : 'rgba(246,70,93,0.12)', color: sideColor(side) }}>{side}</span>
                          <span style={s.leverageTag}>{pos.leverage}x</span>
                          <span style={s.marginTypeTag}>{pos.marginType === 'isolated' ? '격리' : '교차'}</span>
                        </td>
                        <td style={s.td}>
                          <div style={s.sizeCell}>
                            <span style={s.sizeQty}>{fmtQty(absAmt)} {extractCoin(pos.symbol)}</span>
                            <span style={s.sizeUsdt}>{notionalUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span>
                          </div>
                        </td>
                        <td style={s.td}><div style={s.priceCell}><span>{fmtPrice(pos.entryPrice)}</span><span style={s.priceUnit}>USDT</span></div></td>
                        <td style={s.td}><div style={s.priceCell}><span>{fmtPrice(pos.markPrice)}</span><span style={s.priceUnit}>USDT</span></div></td>
                        <td style={s.td}><div style={s.priceCell}><span style={{ color: '#f59e42' }}>{fmtPrice(pos.liquidationPrice)}</span><span style={s.priceUnit}>USDT</span></div></td>
                        <td style={s.td}><div style={s.priceCell}><span>{margin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span style={s.priceUnit}>USDT</span></div></td>
                        <td style={{ ...s.td, color: pnlColor(pos.unrealizedProfit) }}>
                          <div style={s.pnlCell}>
                            <span>{pos.unrealizedProfit >= 0 ? '+' : ''}{fmtPrice(pos.unrealizedProfit)} USDT</span>
                            <span style={s.roiTag}>({roi >= 0 ? '+' : ''}{roi.toFixed(2)}%)</span>
                          </div>
                        </td>
                        <td style={s.td}>
                          <div style={s.tpslCell}>
                            <div style={s.tpslPrices}>
                              <span style={{ color: '#0ecb81', fontSize: '0.74rem' }}>TP: {tpPrice > 0 ? fmtPrice(tpPrice) : '—'}</span>
                              <span style={{ color: '#f6465d', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: 3 }}>
                                SL: {slDisplayPrice > 0 ? fmtPrice(slDisplayPrice) : '—'}
                                {isClientSl && (
                                  <>
                                    <span style={{ fontSize: '0.58rem', background: 'rgba(240,185,11,0.18)', color: '#f0b90b', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>앱</span>
                                    <button
                                      onClick={() => onRemoveClientSL?.(pos.symbol, pos.positionSide)}
                                      style={{ background: 'none', border: 'none', color: '#848e9c', cursor: 'pointer', fontSize: '0.65rem', padding: '0 2px', lineHeight: 1 }}
                                      title="앱 감시 SL 취소"
                                    >✕</button>
                                  </>
                                )}
                              </span>
                            </div>
                            <button style={s.tpslBtn} onClick={() => openTPSL(pos)}>설정</button>
                          </div>
                        </td>
                        {/* 유효 시간 column (live) */}
                        <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                          {liveMeta ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ color: '#3b8beb', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.03em' }}>{liveMeta.scanInterval}</span>
                              <span style={{ color: liveRemMs > 0 ? '#848e9c' : '#f6465d' }}>{liveRemStr}</span>
                            </div>
                          ) : '—'}
                        </td>
                        {/* 진입시간 column (live) */}
                        <td style={{ ...s.td, color: '#5d6776', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                          {pos.entryTime ? fmtEntryTime(pos.entryTime) : (pos.updateTime ? fmtEntryTime(pos.updateTime) : '—')}
                        </td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button
                                style={{ ...s.cancelBtn, color: '#f6465d', borderColor: 'rgba(246,70,93,0.35)' }}
                                onClick={async () => {
                                  const ok = window.confirm(`${pos.symbol} 포지션을 시장가로 청산할까요?`);
                                  if (!ok) return;
                                  try {
                                    await onLiveCloseMarket?.(
                                      pos.symbol,
                                      liveDir,
                                      closeSideForPos,
                                      absAmt,
                                      pos.positionSide,
                                    );
                                  } catch (e) {
                                    window.alert(e instanceof Error ? e.message : '시장가 청산 실패');
                                  }
                                }}
                              >
                                시장가 청산
                              </button>
                              <button
                                style={{ ...s.cancelBtn, color: '#f0b90b', borderColor: 'rgba(240,185,11,0.35)' }}
                                disabled={iocBusy}
                                onClick={async () => {
                                  const curPx = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
                                  const ok = window.confirm(`${pos.symbol} 포지션을 현재가(IOC)로 청산할까요?\n가격: ${fmtPrice(curPx)}`);
                                  if (!ok) return;
                                  setLiveCurrentCloseState(prev => ({
                                    ...prev,
                                    [iocCloseKey]: { kind: 'pending', message: '요청 전송 중...' },
                                  }));
                                  try {
                                    await onLiveCloseCurrentPrice?.(
                                      pos.symbol,
                                      liveDir,
                                      closeSideForPos,
                                      absAmt,
                                      curPx,
                                    );
                                    setLiveCurrentCloseState(prev => ({
                                      ...prev,
                                      [iocCloseKey]: { kind: 'sent', message: '주문 전송됨(IOC 체결 확인 중)...' },
                                    }));
                                    window.setTimeout(() => {
                                      const stillOpen = allPositionsRef.current.some(p =>
                                        p.symbol === pos.symbol &&
                                        p.positionSide === pos.positionSide &&
                                        Math.abs(p.positionAmt) > 0,
                                      );
                                      setLiveCurrentCloseState(prev => ({
                                        ...prev,
                                        [iocCloseKey]: stillOpen
                                          ? { kind: 'not_filled', message: 'IOC 만료/미체결: 포지션이 아직 열려 있습니다.' }
                                          : { kind: 'success', message: '체결 완료: 포지션 종료 확인.' },
                                      }));
                                    }, 1800);
                                  } catch (e) {
                                    setLiveCurrentCloseState(prev => ({
                                      ...prev,
                                      [iocCloseKey]: { kind: 'failed', message: e instanceof Error ? e.message : '현재가 청산 실패' },
                                    }));
                                  }
                                }}
                              >
                                {iocBusy ? '전송중...' : '현재가 청산'}
                              </button>
                            </div>
                            {iocStatus && (
                              <div style={{
                                fontSize: '0.68rem',
                                color:
                                  iocStatus.kind === 'failed' ? '#f6465d' :
                                  iocStatus.kind === 'success' ? '#0ecb81' :
                                  iocStatus.kind === 'not_filled' ? '#f0b90b' :
                                  '#9aa4b5',
                                lineHeight: 1.35,
                                maxWidth: 230,
                                textAlign: 'center',
                              }}>
                                {iocStatus.message}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </>
        )}

        {/* Orders tab (real mode only) */}
        {!isPaperMode && tab === 'orders' && (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>심볼</th>
                <th style={s.th}>유형</th>
                <th style={s.th}>방향</th>
                <th style={s.th}>가격 (USDT)</th>
                <th style={s.th}>수량</th>
                <th style={s.th}>상태</th>
                <th style={s.th}>등록시간</th>
                <th style={s.th}>취소</th>
              </tr>
            </thead>
            <tbody>
              {allOrders.length === 0 ? (
                <tr><td colSpan={8} style={s.empty}>미체결 주문 없음</td></tr>
              ) : allOrders.map(ord => {
                const effectivePrice = ord.price > 0 ? ord.price : ord.stopPrice;
                const altAutoTag = liveAltOrderTagMap?.[ord.orderId];
                return (
                  <tr key={ord.orderId} style={s.tr}>
                    <td style={s.td}>
                      <div style={s.symbolCell}>
                        <CoinLogo symbol={ord.symbol} />
                        <span
                          style={{ ...s.symbolName, marginLeft: 6, ...s.symbolClickable }}
                          onClick={() => onSelectTicker(ord.symbol)}
                          title={`${ord.symbol} 차트로 이동`}
                        >
                          {ord.symbol}
                        </span>
                      </div>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={s.typeTag}>{orderTypeLabel(ord.type)}</span>
                        {altAutoTag && (
                          <span style={{
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            color: altAutoTag.includes('SL') ? '#f6465d' : '#0ecb81',
                            background: altAutoTag.includes('SL') ? 'rgba(246,70,93,0.14)' : 'rgba(14,203,129,0.14)',
                            border: altAutoTag.includes('SL') ? '1px solid rgba(246,70,93,0.35)' : '1px solid rgba(14,203,129,0.35)',
                            borderRadius: 3,
                            padding: '1px 5px',
                            lineHeight: 1.2,
                          }}>
                            {altAutoTag}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...s.td, color: sideColor(ord.side), fontWeight: 700 }}>{ord.side}</td>
                    <td style={s.td}>
                      <div style={s.priceCell}>
                        <span>{fmtPrice(effectivePrice)}</span>
                        <span style={s.priceUnit}>USDT</span>
                      </div>
                    </td>
                    <td style={s.td}>{ord.origQty}</td>
                    <td style={s.td}><span style={s.statusTag}>{ord.status}</span></td>
                    <td style={{ ...s.td, color: '#5d6776', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                      {ord.time ? fmtEntryTime(ord.time) : '—'}
                    </td>
                    <td style={s.td}>
                      <button
                        style={s.cancelBtn}
                        disabled={cancellingId === ord.orderId}
                        onClick={() => handleCancel(ord.orderId, ord.symbol)}
                      >
                        {cancellingId === ord.orderId ? '...' : '취소'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* TP/SL Modal */}
      {tpslModal && (
        <TPSLModalView
          modal={tpslModal}
          onClose={() => setTpslModal(null)}
          onSubmit={async (tpPrice, slPrice, tpQty, slQty) => {
            const pos = tpslModal.position;
            if (isPaperMode) {
              onPaperSetTPSL?.(pos.updateTime!, tpPrice, slPrice);
              return;
            }
            const closeSide: 'BUY' | 'SELL' = pos.positionAmt > 0 ? 'SELL' : 'BUY';
            const defaultQty = Math.abs(pos.positionAmt);
            const effectiveTpQty = tpQty ?? defaultQty;
            const effectiveSlQty = slQty ?? defaultQty;
            // 수량이 같으면 한 번에, 다르면 TP·SL 각각 별도 호출
            if (effectiveTpQty === effectiveSlQty) {
              await onPlaceTPSL(pos.symbol, closeSide, effectiveTpQty, tpPrice, slPrice, pos.positionSide);
            } else {
              if (tpPrice !== undefined) {
                await onPlaceTPSL(pos.symbol, closeSide, effectiveTpQty, tpPrice, undefined, pos.positionSide);
              }
              if (slPrice !== undefined) {
                await onPlaceTPSL(pos.symbol, closeSide, effectiveSlQty, undefined, slPrice, pos.positionSide);
              }
            }
          }}
        />
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  container: {
    flexShrink: 0,
    background: '#131722',
    borderTop: '1px solid #2a2e39',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  resizeHandle: {
    height: 5,
    cursor: 'ns-resize',
    flexShrink: 0,
    background: 'transparent',
    borderTop: '1px solid #2a2e39',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    borderBottom: '1px solid #2a2e39',
    background: '#1a1e2a',
    flexShrink: 0,
    height: 36,
    paddingLeft: 8,
  },
  tab: {
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontFamily: 'inherit',
    fontWeight: 500,
    padding: '0 14px',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: -1,
  },
  tabActive: {
    color: '#f0b90b',
    borderBottom: '2px solid #f0b90b',
  },
  badge: {
    background: 'rgba(240,185,11,0.18)',
    borderRadius: 8,
    color: '#f0b90b',
    fontSize: '0.7rem',
    fontWeight: 700,
    padding: '1px 6px',
    lineHeight: '1.5',
  },
  tableWrap: {
    overflowY: 'auto',
    overflowX: 'auto',
    flex: 1,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.79rem',
  },
  th: {
    background: '#1a1e2a',
    borderBottom: '1px solid #2a2e39',
    color: '#5d6776',
    fontWeight: 500,
    padding: '5px 10px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    fontSize: '0.75rem',
  },
  tr: {
    borderBottom: '1px solid rgba(42,46,57,0.5)',
  },
  td: {
    color: '#d1d4dc',
    padding: '6px 10px',
    whiteSpace: 'nowrap',
    fontSize: '0.79rem',
    verticalAlign: 'middle',
  },
  empty: {
    color: '#4a5568',
    fontSize: '0.82rem',
    padding: '28px 16px',
    textAlign: 'center',
  },
  // Symbol cell
  symbolCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  logoImg: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    flexShrink: 0,
  },
  logoFallback: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#2a2e3d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.55rem',
    fontWeight: 700,
    color: '#848e9c',
    flexShrink: 0,
  },
  symbolText: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.3,
  },
  symbolClickable: {
    cursor: 'pointer',
    borderRadius: 3,
    transition: 'opacity 0.1s',
  },
  symbolName: {
    color: '#d1d4dc',
    fontWeight: 600,
    fontSize: '0.8rem',
  },
  symbolFull: {
    color: '#5d6776',
    fontSize: '0.69rem',
  },
  // Side badge
  sideBadge: {
    borderRadius: 3,
    fontSize: '0.73rem',
    fontWeight: 700,
    padding: '2px 6px',
    display: 'inline-block',
  },
  leverageTag: {
    marginLeft: 4,
    background: 'rgba(240,185,11,0.1)',
    borderRadius: 3,
    color: '#f0b90b',
    fontSize: '0.71rem',
    fontWeight: 700,
    padding: '2px 5px',
    display: 'inline-block',
  },
  marginTypeTag: {
    marginLeft: 4,
    background: 'rgba(93,103,118,0.15)',
    borderRadius: 3,
    color: '#848e9c',
    fontSize: '0.68rem',
    padding: '2px 5px',
    display: 'inline-block',
  },
  // Size cell
  sizeCell: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.4,
  },
  sizeQty: {
    color: '#d1d4dc',
    fontWeight: 500,
  },
  sizeUsdt: {
    color: '#848e9c',
    fontSize: '0.73rem',
  },
  // Price cell
  priceCell: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.3,
  },
  priceUnit: {
    color: '#5d6776',
    fontSize: '0.68rem',
    marginTop: 1,
  },
  // PnL cell
  pnlCell: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.4,
  },
  roiTag: {
    fontSize: '0.72rem',
    opacity: 0.85,
  },
  // TP/SL cell
  tpslCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  tpslPrices: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.5,
    minWidth: 80,
  },
  tpslBtn: {
    background: 'rgba(240,185,11,0.1)',
    border: '1px solid rgba(240,185,11,0.35)',
    borderRadius: 4,
    color: '#f0b90b',
    cursor: 'pointer',
    fontSize: '0.73rem',
    fontFamily: 'inherit',
    padding: '3px 10px',
    whiteSpace: 'nowrap',
  },
  // Order table misc
  typeTag: {
    background: 'rgba(93,103,118,0.12)',
    borderRadius: 3,
    color: '#848e9c',
    fontSize: '0.72rem',
    padding: '2px 6px',
    display: 'inline-block',
  },
  statusTag: {
    color: '#848e9c',
    fontSize: '0.72rem',
  },
  cancelBtn: {
    background: 'rgba(132,142,156,0.08)',
    border: '1px solid rgba(132,142,156,0.25)',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.73rem',
    fontFamily: 'inherit',
    padding: '3px 10px',
  },

  // ── Modal ────────────────────────────────────────────────────────────────────
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    zIndex: 500,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBox: {
    background: '#1e222d',
    border: '1px solid #2a2e39',
    borderRadius: 10,
    width: 520,
    maxWidth: '96vw',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    padding: '20px 22px 18px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    display: 'flex',
    alignItems: 'center',
    color: '#d1d4dc',
    fontWeight: 700,
    fontSize: '0.95rem',
  },
  modalClose: {
    background: 'none',
    border: 'none',
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: '2px 6px',
    fontFamily: 'inherit',
  },
  modalInfo: {
    background: 'rgba(13,21,32,0.5)',
    border: '1px solid #2a2e39',
    borderRadius: 6,
    padding: '10px 12px',
    marginBottom: 14,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '6px 0',
  },
  modalInfoRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  modalInfoLabel: {
    color: '#5d6776',
    fontSize: '0.72rem',
  },
  modalInfoVal: {
    color: '#d1d4dc',
    fontSize: '0.82rem',
    fontWeight: 600,
  },
  modalInputGroup: {
    marginBottom: 10,
    border: '1px solid #2a2e39',
    borderRadius: 6,
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.015)',
  },
  modalLabel: {
    display: 'block',
    color: '#848e9c',
    fontSize: '0.78rem',
    marginBottom: 5,
    fontWeight: 500,
  },
  modalInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  modalInput: {
    flex: 1,
    background: '#0d1520',
    border: '1px solid #2a3550',
    borderRadius: 5,
    color: '#d1d4dc',
    fontSize: '0.88rem',
    fontFamily: 'inherit',
    outline: 'none',
    padding: '7px 10px',
  },
  modalUnit: {
    color: '#848e9c',
    fontSize: '0.78rem',
    minWidth: 36,
  },
  modalHint: {
    display: 'block',
    color: '#5d6776',
    fontSize: '0.7rem',
    marginTop: 3,
  },
  modalErr: {
    background: 'rgba(246,70,93,0.08)',
    border: '1px solid rgba(246,70,93,0.25)',
    borderRadius: 4,
    color: '#f6465d',
    fontSize: '0.78rem',
    padding: '6px 10px',
    marginBottom: 12,
  },
  modalActions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  modalCancelBtn: {
    flex: 1,
    background: 'rgba(132,142,156,0.1)',
    border: '1px solid rgba(132,142,156,0.25)',
    borderRadius: 6,
    color: '#848e9c',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '9px 0',
  },
  modalSubmitBtn: {
    flex: 2,
    background: 'rgba(240,185,11,0.12)',
    border: '1px solid rgba(240,185,11,0.4)',
    borderRadius: 6,
    color: '#f0b90b',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 700,
    padding: '9px 0',
  },

  // PnL banner
  pnlBanner: {
    display: 'flex', alignItems: 'center', gap: 6,
    border: '1px solid', borderRadius: 5,
    padding: '5px 10px', marginTop: 5,
  },
  pnlLabel: {
    fontSize: '0.72rem', color: '#848e9c', fontWeight: 500,
  },
  pnlValue: {
    fontSize: '0.82rem', fontWeight: 700,
    fontFamily: '"SF Mono",Consolas,monospace',
  },
  pnlSep: {
    color: '#2a3550', fontSize: '0.75rem',
  },

  // quantity selector section
  qtySection: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid #1e2a3a',
  },
  // quick pct buttons in TP/SL modal
  modalQuickRow: {
    display: 'flex', gap: 3, marginTop: 4,
  },
  modalQuickNeg: {
    flex: 1, background: '#0d1520', border: '1px solid rgba(246,70,93,0.28)',
    borderRadius: 4, color: '#f6465d', cursor: 'pointer',
    fontSize: '0.63rem', fontWeight: 600, padding: '5px 0',
    fontFamily: '"SF Mono",Consolas,monospace', textAlign: 'center' as const, whiteSpace: 'nowrap' as const,
  },
  modalQuickCur: {
    flex: 2, background: 'rgba(240,185,11,0.1)', border: '1px solid rgba(240,185,11,0.4)',
    borderRadius: 4, color: '#f0b90b', cursor: 'pointer',
    fontSize: '0.63rem', fontWeight: 700, padding: '5px 0',
    fontFamily: 'inherit', textAlign: 'center' as const, whiteSpace: 'nowrap' as const,
  },
  modalQuickPos: {
    flex: 1, background: '#0d1520', border: '1px solid rgba(14,203,129,0.28)',
    borderRadius: 4, color: '#0ecb81', cursor: 'pointer',
    fontSize: '0.63rem', fontWeight: 600, padding: '5px 0',
    fontFamily: '"SF Mono",Consolas,monospace', textAlign: 'center' as const, whiteSpace: 'nowrap' as const,
  },

  // ── Paper trading order form ──────────────────────────────────────────────
  paperOrderForm: {
    padding: '8px 12px',
    borderBottom: '1px solid #2a2e39',
    background: '#1a1e2a',
    flexShrink: 0,
  },
  paperInput: {
    background: '#0d1520',
    border: '1px solid #2a3550',
    borderRadius: 5,
    color: '#d1d4dc',
    fontSize: '0.82rem',
    fontFamily: 'inherit',
    outline: 'none',
    padding: '5px 8px',
  },
  paperBuyBtn: {
    background: 'rgba(14,203,129,0.12)',
    border: '1px solid rgba(14,203,129,0.35)',
    borderRadius: 5,
    color: '#0ecb81',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 700,
    padding: '5px 14px',
    fontFamily: 'inherit',
  },
  paperSellBtn: {
    background: 'rgba(246,70,93,0.12)',
    border: '1px solid rgba(246,70,93,0.35)',
    borderRadius: 5,
    color: '#f6465d',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 700,
    padding: '5px 14px',
    fontFamily: 'inherit',
  },
  paperResetConfirm: {
    background: 'rgba(240,185,11,0.1)',
    border: '1px solid rgba(240,185,11,0.35)',
    borderRadius: 4,
    color: '#f0b90b',
    cursor: 'pointer',
    fontSize: '0.73rem',
    fontFamily: 'inherit',
    padding: '3px 10px',
  },
};
