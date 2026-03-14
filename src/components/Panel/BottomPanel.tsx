import React, { useRef, useState, useEffect, useMemo } from 'react';
import type { FuturesPosition, FuturesOrder, LiveTradeHistoryEntry } from '../../types/futures';
import type { ClientSlMap } from '../../hooks/useBinanceFutures';
import type { PaperHistoryEntry, PaperPosition, PaperOrder, AltMeta } from '../../types/paperTrading';
import { downloadExcel } from '../../utils/exportExcel';
import type { ExcelCell } from '../../utils/exportExcel';
import { fetchBinanceKlinesCached } from '../../lib/binanceKlineCache';

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
  liveAltEntryOrderTagMap?: Record<string, true>;
  // Live trading history
  liveHistory?: LiveTradeHistoryEntry[];
  liveBalanceHistory?: Array<{ time: number; balance: number }>;
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

type Tab = 'positions' | 'orders' | 'paper-orders' | 'paper-history' | 'paper-asset' | 'paper-performance' | 'live-history' | 'live-asset' | 'live-performance';

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
  isAltTrade?: boolean;
  candidateScore?: number | null;
  plannedEntry?: number | null;
  plannedTP?: number | null;
  plannedSL?: number | null;
  entrySource?: 'manual' | 'auto';
  candidateId?: string;
  timeStopEnabledAtEntry?: boolean | null;
  validUntilTimeAtEntry?: number | null;
  scanCadenceMinutesAtEntry?: number | null;
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

interface MetricSummary {
  count: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgRoi: number | null;
}

const ALT_INTERVAL_ORDER: Record<string, number> = {
  '15m': 1,
  '1h': 2,
  '4h': 3,
  '1d': 4,
};

function fmtShortInterval(iv?: string) {
  if (!iv) return '—';
  return iv;
}

function calcTradeRoi(row: UnifiedHistoryRow): number | null {
  if (row.pnl == null || row.entryPrice == null || row.leverage == null || row.leverage <= 0 || row.qty <= 0) return null;
  const margin = (row.entryPrice * row.qty) / row.leverage;
  if (!isFinite(margin) || margin <= 0) return null;
  return (row.pnl / margin) * 100;
}

function summarizeRows(rows: UnifiedHistoryRow[]): MetricSummary {
  if (rows.length === 0) return { count: 0, winRate: 0, totalPnl: 0, avgPnl: 0, avgRoi: null };
  const totalPnl = rows.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const wins = rows.filter(r => (r.pnl ?? 0) > 0).length;
  const roiRows = rows.map(calcTradeRoi).filter((v): v is number => v != null && isFinite(v));
  return {
    count: rows.length,
    winRate: (wins / rows.length) * 100,
    totalPnl,
    avgPnl: totalPnl / rows.length,
    avgRoi: roiRows.length > 0 ? roiRows.reduce((s, v) => s + v, 0) / roiRows.length : null,
  };
}


interface AnalyticsGroupRow extends MetricSummary {
  key: string;
  label: string;
  color?: string;
}

function AnalyticsGroupBars({
  rows,
  emptyText = '데이터 없음',
}: {
  rows: AnalyticsGroupRow[];
  emptyText?: string;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setEntered(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, [rows]);
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.totalPnl)));
  return (
    <div style={{ borderRadius: 10, padding: '8px 10px', background: 'rgba(10,16,28,0.55)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {rows.length === 0 ? (
        <div style={{ color: '#5d6776', fontSize: '0.72rem', minHeight: 28 }}>{emptyText}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map((row, idx) => {
            const ratio = Math.abs(row.totalPnl) / maxAbs;
            const targetWidth = Math.max(3, ratio * 46);
            const pos = row.totalPnl >= 0;
            const accent = pos ? '#0ecb81' : '#f6465d';
            return (
              <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: 7, alignItems: 'center' }}>
                <span style={{ color: row.color ?? '#c9d0db', fontSize: '0.71rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                <div style={{ position: 'relative', height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'rgba(255,255,255,0.12)', zIndex: 1 }} />
                  <div
                    style={{
                      position: 'absolute',
                      top: 0, bottom: 0,
                      left: pos ? '50%' : undefined,
                      right: pos ? undefined : '50%',
                      width: entered ? `${targetWidth}%` : '0%',
                      background: pos
                        ? `linear-gradient(90deg, rgba(14,203,129,0.9), rgba(14,203,129,0.35))`
                        : `linear-gradient(270deg, rgba(246,70,93,0.9), rgba(246,70,93,0.35))`,
                      boxShadow: entered ? `0 0 8px ${accent}44` : 'none',
                      borderRadius: 6,
                      transition: `width 700ms cubic-bezier(0.16,1,0.3,1) ${idx * 80}ms, box-shadow 400ms ease ${idx * 80 + 300}ms`,
                    }}
                  />
                </div>
                <span style={{
                  fontSize: '0.67rem', color: pos ? '#0ecb81' : '#f6465d',
                  fontFamily: '"SF Mono",Consolas,monospace', fontWeight: 700,
                  opacity: entered ? 1 : 0,
                  transition: `opacity 400ms ease ${idx * 80 + 200}ms`,
                  minWidth: 90, textAlign: 'right',
                }}>
                  {row.totalPnl >= 0 ? '+' : ''}{row.totalPnl.toFixed(1)} · {row.winRate.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CohortSummary extends MetricSummary {
  avgHoldMin: number | null;
}

function summarizeCohort(rows: UnifiedHistoryRow[]): CohortSummary {
  const base = summarizeRows(rows);
  const holdRows = rows.filter(r => r.entryTime != null && r.exitTime > (r.entryTime ?? 0));
  const avgHoldMin = holdRows.length > 0
    ? holdRows.reduce((s, r) => s + ((r.exitTime - (r.entryTime ?? r.exitTime)) / 60000), 0) / holdRows.length
    : null;
  return { ...base, avgHoldMin };
}

function toKlineInterval(iv?: string): '15m' | '1h' | '4h' | '1d' {
  if (iv === '15m' || iv === '1h' || iv === '4h' || iv === '1d') return iv;
  return '1h';
}

function intervalMsFromStr(iv?: string): number {
  if (iv === '15m') return 15 * 60_000;
  if (iv === '1h') return 60 * 60_000;
  if (iv === '4h') return 4 * 60 * 60_000;
  return 24 * 60 * 60_000;
}

function simulatePnl(row: UnifiedHistoryRow, exitPrice: number | null): number | null {
  if (exitPrice == null || row.entryPrice == null) return null;
  const dir = row.positionSide === 'LONG' ? 1 : -1;
  return (exitPrice - row.entryPrice) * dir * row.qty;
}

// ── Type for counterfactual simulation result ─────────────────────────────────
interface CfSummary {
  helpedOff: number; hurtOff: number;
  avgDeltaOff: number | null; avgDeltaOffPlus1: number | null; avgDeltaOffPlus3: number | null;
  helpedOn: number; hurtOn: number; avgDeltaOn: number | null;
  samplesOff: number; samplesOn: number;
  avgMfePct: number | null; avgMaePct: number | null;
}
// Module-level: survives tab switches / component remounts within the same session
const _cfModuleCache = new Map<string, CfSummary>();

// ── 24-hour ring chart (KST) ─────────────────────────────────────────────────
function HourlyRingChart({ data }: {
  data: Array<{ hour: number; totalPnl: number; count: number }>;
}) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const cx = 70, cy = 70, R = 54, r = 30;
  const maxAbs = Math.max(1, ...data.map(d => Math.abs(d.totalPnl)));
  const GAP = 1.5;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const segments = data.map(({ hour, totalPnl, count }) => {
    const s = toRad((hour / 24) * 360 - 90);
    const e = toRad(((hour + 1) / 24) * 360 - 90 - GAP);
    const x1 = cx + R * Math.cos(s), y1 = cy + R * Math.sin(s);
    const x2 = cx + R * Math.cos(e), y2 = cy + R * Math.sin(e);
    const x3 = cx + r * Math.cos(e), y3 = cy + r * Math.sin(e);
    const x4 = cx + r * Math.cos(s), y4 = cy + r * Math.sin(s);
    const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${r} ${r} 0 0 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
    const intensity = count > 0 ? 0.2 + (Math.abs(totalPnl) / maxAbs) * 0.7 : 0;
    const fill = count === 0
      ? 'rgba(255,255,255,0.05)'
      : totalPnl > 0 ? `rgba(14,203,129,${intensity.toFixed(2)})` : `rgba(246,70,93,${intensity.toFixed(2)})`;
    const midAngleRad = toRad(((hour + 0.5) / 24) * 360 - 90);
    const midR = (R + r) / 2;
    const mx = cx + midR * Math.cos(midAngleRad);
    const my = cy + midR * Math.sin(midAngleRad);
    return { d, fill, hour, totalPnl, count, mx, my };
  });
  const hov = hoveredHour !== null ? data.find(d => d.hour === hoveredHour) ?? null : null;
  return (
    <svg width={140} height={140} viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
      {segments.map(seg => {
        const isHov = seg.hour === hoveredHour;
        const dimmed = hoveredHour !== null && !isHov;
        return (
          <path
            key={seg.hour}
            d={seg.d}
            fill={seg.fill}
            stroke={isHov ? (seg.totalPnl > 0 ? '#0ecb81' : seg.count === 0 ? '#3d506a' : '#f6465d') : '#1a2232'}
            strokeWidth={isHov ? 1.5 : 0.8}
            style={{
              transformOrigin: `${seg.mx.toFixed(2)}px ${seg.my.toFixed(2)}px`,
              transform: isHov ? 'scale(1.14)' : 'scale(1)',
              opacity: dimmed ? 0.35 : 1,
              transition: 'transform 140ms ease, opacity 140ms ease, stroke 140ms ease',
              cursor: seg.count > 0 ? 'pointer' : 'default',
            }}
            onMouseEnter={() => setHoveredHour(seg.hour)}
            onMouseLeave={() => setHoveredHour(null)}
          />
        );
      })}
      {[0, 6, 12, 18].map(h => {
        const a = toRad((h / 24) * 360 - 90);
        const lx = (cx + (R + 9) * Math.cos(a)).toFixed(1);
        const ly = (cy + (R + 9) * Math.sin(a)).toFixed(1);
        return <text key={h} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="#3d506a" style={{ pointerEvents: 'none' }}>{h}h</text>;
      })}
      {hov && hov.count > 0 ? (
        <>
          <text x={cx} y={cy - 13} textAnchor="middle" fontSize={7} fill="#8fa8c0" style={{ pointerEvents: 'none' }}>
            {String(hov.hour).padStart(2, '0')}:00~{String((hov.hour + 1) % 24).padStart(2, '0')}:00
          </text>
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize={6.5} fill="#5d7080" style={{ pointerEvents: 'none' }}>{hov.count}건</text>
          <text x={cx} y={cy + 10} textAnchor="middle" fontSize={8} fontWeight="700" fill={hov.totalPnl >= 0 ? '#0ecb81' : '#f6465d'} style={{ pointerEvents: 'none' }}>
            {hov.totalPnl >= 0 ? '+' : ''}{hov.totalPnl.toFixed(1)}
          </text>
        </>
      ) : (
        <>
          <text x={cx} y={cy - 5} textAnchor="middle" fontSize={7.5} fill="#4a6070" style={{ pointerEvents: 'none' }}>KST</text>
          <text x={cx} y={cy + 6} textAnchor="middle" fontSize={6.5} fill="#3a5060" style={{ pointerEvents: 'none' }}>청산시각</text>
        </>
      )}
    </svg>
  );
}

// ── Reusable card components (defined outside to avoid remount on parent render) ─
function PerfCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 14,
      background: 'linear-gradient(145deg, rgba(26,38,56,0.85), rgba(14,22,36,0.7))',
      backdropFilter: 'blur(6px)',
      padding: '13px 15px',
      marginBottom: 10,
      ...style,
    }}>{children}</div>
  );
}

function PerfCardTitle({ icon, title, badge }: { icon: string; title: string; badge?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
      <span style={{ fontSize: '0.85rem' }}>{icon}</span>
      <span style={{ fontSize: '0.77rem', color: '#b8c8e0', fontWeight: 700, letterSpacing: '0.01em' }}>{title}</span>
      {badge && <div style={{ marginLeft: 'auto' }}>{badge}</div>}
    </div>
  );
}

function PerformanceAnalysisSection({
  rows,
  mode,
  active,
}: {
  rows: UnifiedHistoryRow[];
  mode: 'paper' | 'live';
  active: boolean;
}) {
  const [cfLoading, setCfLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [drillKey, setDrillKey] = useState<'timeframe' | 'side' | 'source' | 'leverage' | 'cadence'>('timeframe');
  const [cfSummary, setCfSummary] = useState<CfSummary | null>(null);

  const altRows = useMemo(() => rows.filter(r => r.isAltTrade), [rows]);
  const overallSummary = useMemo(() => summarizeCohort(rows), [rows]);
  const onRows = useMemo(() => altRows.filter(r => r.timeStopEnabledAtEntry !== false), [altRows]);
  const offRows = useMemo(() => altRows.filter(r => r.timeStopEnabledAtEntry === false), [altRows]);
  const onSummary = useMemo(() => summarizeCohort(onRows), [onRows]);
  const offSummary = useMemo(() => summarizeCohort(offRows), [offRows]);
  const maxDrawdownProxy = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.exitTime - b.exitTime);
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    for (const row of sorted) {
      cum += row.pnl ?? 0;
      if (cum > peak) peak = cum;
      maxDd = Math.max(maxDd, peak - cum);
    }
    return maxDd;
  }, [rows]);

  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, [active, mode]);

  useEffect(() => {
    if (!active) return;
    const target = altRows
      .filter(r => r.entryPrice != null && r.entryPrice > 0 && r.validUntilTimeAtEntry != null)
      .slice(0, 20);
    if (target.length === 0) {
      return;
    }
    // ── Cache check: skip expensive API calls if data hasn't changed ──────────
    const cfCacheKey = target.map(r => `${r.exitTime}:${r.validUntilTimeAtEntry ?? 0}`).join('|');
    if (_cfModuleCache.has(cfCacheKey)) {
      setCfSummary(_cfModuleCache.get(cfCacheKey)!);
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────
    let cancelled = false;
    const startLoadingTimer = window.setTimeout(() => setCfLoading(true), 0);
    void (async () => {
      let helpedOff = 0;
      let hurtOff = 0;
      let deltaOffSum = 0;
      let deltaOffCount = 0;
      let deltaOffPlus1Sum = 0;
      let deltaOffPlus1Count = 0;
      let deltaOffPlus3Sum = 0;
      let deltaOffPlus3Count = 0;
      let helpedOn = 0;
      let hurtOn = 0;
      let deltaOnSum = 0;
      let deltaOnCount = 0;
      let mfeSum = 0;
      let maeSum = 0;
      let mfeMaeCount = 0;

      const seriesCache = new Map<string, Awaited<ReturnType<typeof fetchBinanceKlinesCached>>>();
      for (const row of target) {
        if (cancelled) return;
        const interval = toKlineInterval(row.interval);
        const cacheKey = `${row.symbol}_${interval}`;
        let candles = seriesCache.get(cacheKey);
        if (!candles) {
          try {
            candles = await fetchBinanceKlinesCached(row.symbol, interval, 400);
            seriesCache.set(cacheKey, candles);
          } catch {
            continue;
          }
        }
        if (!candles || candles.length < 5) continue;
        const ivMs = intervalMsFromStr(interval);
        const expiry = row.validUntilTimeAtEntry ?? 0;
        const idx = candles.findIndex(c => (c.time + ivMs) >= expiry);
        if (idx < 0) continue;
        const atExpiry = candles[idx]?.close ?? null;
        const plus1 = candles[idx + 1]?.close ?? atExpiry;
        const plus3 = candles[idx + 3]?.close ?? candles[candles.length - 1]?.close ?? atExpiry;
        const latest = candles[candles.length - 1]?.close ?? null;
        const cfPrice = latest ?? plus3 ?? plus1 ?? atExpiry;
        const simulated = simulatePnl(row, cfPrice);
        if (simulated == null || row.pnl == null) continue;

        if (row.closeReason === 'time' || row.closeReason === 'expired') {
          const delta = simulated - row.pnl;
          deltaOffSum += delta;
          deltaOffCount += 1;
          const simulatedPlus1 = simulatePnl(row, plus1);
          if (simulatedPlus1 != null) {
            deltaOffPlus1Sum += simulatedPlus1 - row.pnl;
            deltaOffPlus1Count += 1;
          }
          const simulatedPlus3 = simulatePnl(row, plus3);
          if (simulatedPlus3 != null) {
            deltaOffPlus3Sum += simulatedPlus3 - row.pnl;
            deltaOffPlus3Count += 1;
          }
          if (delta < 0) helpedOff += 1;
          else if (delta > 0) hurtOff += 1;

          const baseExit = row.exitPrice ?? atExpiry;
          if (baseExit != null && baseExit > 0) {
            const window = candles.slice(idx, Math.min(candles.length, idx + 4));
            if (window.length > 0) {
              const maxHigh = Math.max(...window.map(c => c.high));
              const minLow = Math.min(...window.map(c => c.low));
              const isLong = row.positionSide === 'LONG';
              const mfePct = isLong
                ? ((maxHigh - baseExit) / baseExit) * 100
                : ((baseExit - minLow) / baseExit) * 100;
              const maePct = isLong
                ? ((minLow - baseExit) / baseExit) * 100
                : ((baseExit - maxHigh) / baseExit) * 100;
              mfeSum += mfePct;
              maeSum += maePct;
              mfeMaeCount += 1;
            }
          }
        } else if (row.timeStopEnabledAtEntry === false) {
          const hypoExit = simulatePnl(row, atExpiry);
          if (hypoExit == null) continue;
          const delta = row.pnl - hypoExit;
          deltaOnSum += delta;
          deltaOnCount += 1;
          if (delta < 0) helpedOn += 1;
          else if (delta > 0) hurtOn += 1;
        }
      }

      if (cancelled) return;
      const cfResult: CfSummary = {
        helpedOff,
        hurtOff,
        avgDeltaOff: deltaOffCount > 0 ? deltaOffSum / deltaOffCount : null,
        avgDeltaOffPlus1: deltaOffPlus1Count > 0 ? deltaOffPlus1Sum / deltaOffPlus1Count : null,
        avgDeltaOffPlus3: deltaOffPlus3Count > 0 ? deltaOffPlus3Sum / deltaOffPlus3Count : null,
        helpedOn,
        hurtOn,
        avgDeltaOn: deltaOnCount > 0 ? deltaOnSum / deltaOnCount : null,
        samplesOff: deltaOffCount,
        samplesOn: deltaOnCount,
        avgMfePct: mfeMaeCount > 0 ? mfeSum / mfeMaeCount : null,
        avgMaePct: mfeMaeCount > 0 ? maeSum / mfeMaeCount : null,
      };
      _cfModuleCache.set(cfCacheKey, cfResult);
      setCfSummary(cfResult);
      setCfLoading(false);
    })().finally(() => {
      if (!cancelled) setCfLoading(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(startLoadingTimer);
      setCfLoading(false);
    };
  }, [active, altRows]);

  const byTimeframe = useMemo(() => {
    const map = new Map<string, UnifiedHistoryRow[]>();
    for (const row of altRows) {
      const k = row.interval ?? 'unknown';
      map.set(k, [...(map.get(k) ?? []), row]);
    }
    return Array.from(map.entries())
      .map(([k, grouped]) => ({ key: k, label: fmtShortInterval(k), ...summarizeCohort(grouped) }))
      .sort((a, b) => (ALT_INTERVAL_ORDER[a.key] ?? 999) - (ALT_INTERVAL_ORDER[b.key] ?? 999));
  }, [altRows]);

  const bySide = useMemo(() => {
    return [
      { key: 'long', label: 'LONG', ...summarizeCohort(altRows.filter(r => r.positionSide === 'LONG')) },
      { key: 'short', label: 'SHORT', ...summarizeCohort(altRows.filter(r => r.positionSide === 'SHORT')) },
    ];
  }, [altRows]);

  const byEntrySource = useMemo(() => {
    return [
      { key: 'auto', label: 'ALT 자동', ...summarizeCohort(altRows.filter(r => r.entrySource === 'auto')) },
      { key: 'manual', label: 'ALT 수동', ...summarizeCohort(altRows.filter(r => r.entrySource !== 'auto')) },
    ];
  }, [altRows]);

  const byLeverage = useMemo(() => {
    const map = new Map<string, UnifiedHistoryRow[]>();
    for (const row of altRows) {
      const lv = row.leverage ?? 0;
      const key = lv && isFinite(lv) ? `${lv}x` : 'unknown';
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return Array.from(map.entries())
      .map(([k, grouped]) => ({ key: k, label: k === 'unknown' ? '미지정' : k, ...summarizeCohort(grouped) }))
      .filter(x => x.count > 0)
      .sort((a, b) => (parseInt(a.label) || 999) - (parseInt(b.label) || 999));
  }, [altRows]);

  const byCadence = useMemo(() => {
    const map = new Map<string, UnifiedHistoryRow[]>();
    for (const row of altRows) {
      const key = row.scanCadenceMinutesAtEntry != null ? `${row.scanCadenceMinutesAtEntry}m` : 'unknown';
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return Array.from(map.entries())
      .map(([k, grouped]) => ({ key: k, label: k === 'unknown' ? '미지정' : k, ...summarizeCohort(grouped) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }, [altRows]);
  const hasCounterfactualTarget = useMemo(
    () => altRows.some(r => r.entryPrice != null && r.entryPrice > 0 && r.validUntilTimeAtEntry != null),
    [altRows],
  );

  const bySymbol = useMemo(() => {
    const map = new Map<string, UnifiedHistoryRow[]>();
    for (const row of rows) {
      const sym = extractCoin(row.symbol);
      map.set(sym, [...(map.get(sym) ?? []), row]);
    }
    return Array.from(map.entries())
      .map(([k, grouped]) => ({ key: k, label: k, ...summarizeCohort(grouped) }))
      .filter(x => x.count >= 1)
      .sort((a, b) => b.totalPnl - a.totalPnl);
  }, [rows]);

  const byHour = useMemo(() => {
    const map = new Map<number, UnifiedHistoryRow[]>();
    for (let h = 0; h < 24; h++) map.set(h, []);
    for (const row of rows) {
      const kstH = (new Date(row.exitTime).getUTCHours() + 9) % 24; // KST = UTC+9
      map.get(kstH)!.push(row);
    }
    return Array.from(map.entries()).map(([hour, rs]) => ({ hour, ...summarizeCohort(rs) }));
  }, [rows]);

  const closeReasonRows = useMemo(() => {
    const grouped = new Map<string, UnifiedHistoryRow[]>();
    for (const row of altRows) {
      const key = row.closeReason ?? 'unknown';
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return Array.from(grouped.entries())
      .map(([reason, groupedRows]) => ({
        key: reason,
        label: reasonLabel(reason as UnifiedHistoryReason),
        color: reasonColorByReason(reason as UnifiedHistoryReason),
        ...summarizeCohort(groupedRows),
      }))
      .sort((a, b) => b.count - a.count);
  }, [altRows]);

  const verdict = useMemo(() => {
    if (!cfSummary || cfSummary.samplesOff <= 0 || cfSummary.avgDeltaOff == null) return null;
    if (cfSummary.avgDeltaOff < 0 && cfSummary.helpedOff >= cfSummary.hurtOff) {
      return { label: '✅ 타임스탑 효과 좋음', color: '#0ecb81' };
    }
    if (cfSummary.avgDeltaOff > 0 && cfSummary.hurtOff > cfSummary.helpedOff) {
      return { label: '⚠ 타임스탑 역효과', color: '#f6465d' };
    }
    return { label: '📊 데이터 축적 중', color: '#f0b90b' };
  }, [cfSummary]);

  const drillRows = useMemo(() => {
    if (drillKey === 'timeframe') return byTimeframe;
    if (drillKey === 'side') return bySide;
    if (drillKey === 'source') return byEntrySource;
    if (drillKey === 'leverage') return byLeverage;
    return byCadence;
  }, [drillKey, byTimeframe, bySide, byEntrySource, byLeverage, byCadence]);

  const drillTitle = useMemo(() => {
    if (drillKey === 'timeframe') return '봉 기준별 성과 (총손익 | 승률)';
    if (drillKey === 'side') return 'LONG / SHORT 성과';
    if (drillKey === 'source') return '진입 방식별 성과';
    if (drillKey === 'leverage') return '레버리지 구간별 성과';
    return '스캔 주기별 성과';
  }, [drillKey]);

  const helpedRatio = cfSummary && cfSummary.samplesOff > 0
    ? (cfSummary.helpedOff / cfSummary.samplesOff) * 100
    : null;
  const fmtDelta = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} USDT`);
  const fmtHold = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}분`);
  const revealStyle = (index: number) => ({
    opacity: revealed ? 1 : 0,
    transform: revealed ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.992)',
    transition: `opacity 420ms ease ${index * 90}ms, transform 480ms cubic-bezier(0.22,1,0.36,1) ${index * 90}ms`,
  }) as const;

  const topGainers = bySymbol.slice(0, 10);
  const topLosers = [...bySymbol].reverse().slice(0, 10);
  const symMaxAbs = Math.max(1, ...bySymbol.map(s => Math.abs(s.totalPnl)));

  return (
    <div style={{ padding: '10px 14px 14px', color: '#d4d9e1' }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '1rem' }}>📊</span>
        <span style={{ fontSize: '0.85rem', color: '#f0b90b', fontWeight: 800, letterSpacing: '0.02em' }}>
          성과 분석
        </span>
        <span style={{ fontSize: '0.72rem', color: '#f0b90b', background: 'rgba(240,185,11,0.12)', border: '1px solid rgba(240,185,11,0.3)', borderRadius: 999, padding: '1px 8px', fontWeight: 700 }}>
          {mode === 'paper' ? '모의거래' : '실전거래'}
        </span>
        {rows.length === 0 && (
          <span style={{ fontSize: '0.72rem', color: '#5d6776', marginLeft: 4 }}>거래 내역이 없어 분석할 데이터가 없습니다.</span>
        )}
      </div>

      {/* ── Row 1: 거래 성과 요약 (full width) ─────────────────── */}
      <div style={{ ...revealStyle(0) }}>
        <PerfCard>
          <PerfCardTitle
            icon="🏆"
            title="거래 성과 요약"
            badge={verdict && (
              <span style={{ fontSize: '0.68rem', color: verdict.color, border: `1px solid ${verdict.color}55`, background: `${verdict.color}18`, borderRadius: 999, padding: '2px 10px', fontWeight: 700, letterSpacing: '0.01em' }}>
                {verdict.label}
              </span>
            )}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 7 }}>
            {[
              { label: '누적 실현손익', value: `${overallSummary.totalPnl >= 0 ? '+' : ''}${overallSummary.totalPnl.toFixed(2)}`, unit: 'USDT', color: overallSummary.totalPnl >= 0 ? '#0ecb81' : '#f6465d', glow: overallSummary.totalPnl !== 0 },
              { label: '승률', value: `${overallSummary.winRate.toFixed(1)}%`, unit: `${rows.filter(r => (r.pnl ?? 0) > 0).length}승 / ${rows.length}건`, color: overallSummary.winRate >= 50 ? '#a3e4c4' : '#e4a3a3', glow: false },
              { label: '거래당 평균 손익', value: `${overallSummary.avgPnl >= 0 ? '+' : ''}${overallSummary.avgPnl.toFixed(2)}`, unit: 'USDT', color: overallSummary.avgPnl >= 0 ? '#0ecb81' : '#f6465d', glow: false },
              { label: '평균 보유 시간', value: fmtHold(overallSummary.avgHoldMin), unit: '', color: '#b8d0f0', glow: false },
              { label: '최대 손실폭', value: `-${maxDrawdownProxy.toFixed(2)}`, unit: 'USDT', color: '#f6465d', glow: false },
              { label: '타임스탑 효과율', value: helpedRatio != null ? `${helpedRatio.toFixed(1)}%` : '—', unit: helpedRatio != null ? '손실 방어' : '', color: helpedRatio != null ? '#f0b90b' : '#5d6776', glow: false },
            ].map(item => (
              <div key={item.label} style={{ border: `1px solid ${item.glow ? `${item.color}30` : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '9px 11px', background: item.glow ? `${item.color}08` : 'rgba(8,13,22,0.4)', boxShadow: item.glow ? `0 0 12px ${item.color}18` : 'none' }}>
                <div style={{ fontSize: '0.62rem', color: '#5d7085', marginBottom: 4, fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase' as const }}>{item.label}</div>
                <div style={{ fontSize: '0.86rem', color: item.color, fontWeight: 800, fontFamily: '"SF Mono",Consolas,monospace', lineHeight: 1.2 }}>{item.value}</div>
                {item.unit && <div style={{ fontSize: '0.6rem', color: '#4a5a6e', marginTop: 2 }}>{item.unit}</div>}
              </div>
            ))}
          </div>
        </PerfCard>
      </div>

      {/* ── Row 2: 타임스탑 비교 | 심볼 순위 (2-column) ─────────── */}
      <div style={{ ...revealStyle(1), display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* 타임스탑 효과 비교 */}
        <PerfCard style={{ marginBottom: 0 }}>
          <PerfCardTitle icon="⏱" title="타임스탑 효과 비교" badge={
            <span style={{ fontSize: '0.63rem', color: '#6b7892' }}>ON·OFF</span>
          } />
          {onSummary.count === 0 && offSummary.count === 0 ? (
            <div style={{ fontSize: '0.73rem', color: '#5d6776' }}>비교 데이터 없음</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { col: 'ON — 타임스탑 사용', summary: onSummary, helped: cfSummary?.helpedOff, hurt: cfSummary?.hurtOff, accent: '#3b8beb' },
                { col: 'OFF — 타임스탑 미사용', summary: offSummary, helped: cfSummary?.helpedOn, hurt: cfSummary?.hurtOn, accent: '#7f8aa0' },
              ].map(({ col, summary, helped, hurt, accent }) => (
                <div key={col} style={{ border: `1px solid ${accent}28`, borderRadius: 10, padding: '9px 11px', background: `${accent}06` }}>
                  <div style={{ fontSize: '0.67rem', color: accent, fontWeight: 700, marginBottom: 6, letterSpacing: '0.01em' }}>{col}</div>
                  {[
                    { label: '거래', value: `${summary.count}건` },
                    { label: '승률', value: `${summary.winRate.toFixed(1)}%`, color: summary.winRate >= 50 ? '#0ecb81' : '#f6465d' },
                    { label: '누적 손익', value: `${summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toFixed(2)}`, color: summary.totalPnl >= 0 ? '#0ecb81' : '#f6465d' },
                    { label: '거래당', value: `${summary.avgPnl >= 0 ? '+' : ''}${summary.avgPnl.toFixed(2)}`, color: summary.avgPnl >= 0 ? '#0ecb81' : '#f6465d' },
                    { label: '보유', value: fmtHold(summary.avgHoldMin) },
                    { label: '방어/역효과', value: helped != null && hurt != null ? `${helped} / ${hurt}` : '—' },
                  ].map((r, i) => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.69rem', padding: '2px 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                      <span style={{ color: '#6a7a8e' }}>{r.label}</span>
                      <span style={{ color: r.color ?? '#c8d4e5', fontWeight: 600, fontFamily: '"SF Mono",Consolas,monospace' }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </PerfCard>

        {/* 심볼별 손익 순위 */}
        <PerfCard style={{ marginBottom: 0 }}>
          <PerfCardTitle icon="🏅" title="심볼별 손익 순위" badge={
            <span style={{ fontSize: '0.63rem', color: '#6b7892' }}>{bySymbol.length}종목</span>
          } />
          {bySymbol.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: '#5d6776' }}>거래 내역이 없습니다.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* Top Gainers */}
              <div>
                <div style={{ fontSize: '0.63rem', color: '#0ecb81', fontWeight: 700, letterSpacing: '0.03em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0ecb81', display: 'inline-block', boxShadow: '0 0 5px #0ecb8188' }} />
                  수익 TOP
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {topGainers.map((s, i) => {
                    const w = Math.max(4, (Math.abs(s.totalPnl) / symMaxAbs) * 88);
                    return (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: '0.6rem', color: '#3a5070', fontWeight: 700, width: 12, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                        <span style={{ fontSize: '0.7rem', color: '#c8d8f0', fontWeight: 700, width: 44, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.label}</span>
                        <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.04)', overflow: 'hidden', position: 'relative' }}>
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${w}%`, background: 'linear-gradient(90deg,#0ecb81,#0ecb8144)', borderRadius: 5, boxShadow: '0 0 6px #0ecb8133' }} />
                        </div>
                        <span style={{ fontSize: '0.64rem', color: '#0ecb81', fontWeight: 700, fontFamily: '"SF Mono",Consolas,monospace', flexShrink: 0, minWidth: 42, textAlign: 'right' }}>+{s.totalPnl.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Top Losers */}
              <div>
                <div style={{ fontSize: '0.63rem', color: '#f6465d', fontWeight: 700, letterSpacing: '0.03em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f6465d', display: 'inline-block', boxShadow: '0 0 5px #f6465d88' }} />
                  손실 TOP
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {topLosers.map((s, i) => {
                    const w = Math.max(4, (Math.abs(s.totalPnl) / symMaxAbs) * 88);
                    return (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: '0.6rem', color: '#3a5070', fontWeight: 700, width: 12, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                        <span style={{ fontSize: '0.7rem', color: '#c8d8f0', fontWeight: 700, width: 44, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.label}</span>
                        <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.04)', overflow: 'hidden', position: 'relative' }}>
                          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${w}%`, background: 'linear-gradient(270deg,#f6465d,#f6465d44)', borderRadius: 5, boxShadow: '0 0 6px #f6465d33' }} />
                        </div>
                        <span style={{ fontSize: '0.64rem', color: '#f6465d', fontWeight: 700, fontFamily: '"SF Mono",Consolas,monospace', flexShrink: 0, minWidth: 42, textAlign: 'right' }}>{s.totalPnl.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {/* Most traded + best win rate symbols */}
          {bySymbol.length >= 2 && (() => {
            const mostTraded = [...bySymbol].sort((a, b) => b.count - a.count)[0];
            const bestWr = [...bySymbol].filter(s => s.count >= 2).sort((a, b) => b.winRate - a.winRate)[0];
            return (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {[
                  { icon: '🔥', label: '최다 거래', name: mostTraded.label, sub: `${mostTraded.count}건` },
                  bestWr && { icon: '🎯', label: '최고 승률', name: bestWr.label, sub: `${bestWr.winRate.toFixed(0)}%` },
                ].filter(Boolean).map((item) => {
                  if (!item) return null;
                  return (
                    <div key={item.label} style={{ flex: 1, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '6px 8px', background: 'rgba(255,255,255,0.02)' }}>
                      <div style={{ fontSize: '0.6rem', color: '#5d7085', fontWeight: 600, marginBottom: 2 }}>{item.icon} {item.label}</div>
                      <div style={{ fontSize: '0.74rem', color: '#d0dff0', fontWeight: 700 }}>{item.name}</div>
                      <div style={{ fontSize: '0.62rem', color: '#7a8da0', fontFamily: '"SF Mono",Consolas,monospace' }}>{item.sub}</div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </PerfCard>
      </div>

      {/* ── Row 3: 타임스탑 분석 (full width) ──────────────────── */}
      <div style={{ ...revealStyle(2), marginTop: 10 }}>
        <PerfCard>
          <PerfCardTitle icon="🔬" title="타임스탑 분석" />
          {!hasCounterfactualTarget ? (
            <div style={{ fontSize: '0.73rem', color: '#5d6776' }}>분석에 필요한 데이터가 아직 부족합니다.</div>
          ) : cfLoading ? (
            <div style={{ fontSize: '0.73rem', color: '#7f8aa0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#3b8beb', animation: 'pulse 1.2s infinite' }} />
              시뮬레이션 계산 중...
            </div>
          ) : !cfSummary ? (
            <div style={{ fontSize: '0.73rem', color: '#5d6776' }}>분석에 필요한 데이터가 아직 부족합니다.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 9 }}>
              {/* Card 1: 타임스탑 후 실제 결과 */}
              {(() => {
                const total = cfSummary.helpedOff + cfSummary.hurtOff;
                const helpedPct = total > 0 ? (cfSummary.helpedOff / total) * 100 : 50;
                const deltaColor = (cfSummary.avgDeltaOff ?? 0) <= 0 ? '#0ecb81' : '#f6465d';
                return (
                  <div title={"[타임스탑 후 실제 결과] 상세 설명\n\n이 카드는 타임스탑(시간 만료)으로 강제 청산된 거래를 대상으로 역시뮬레이션 분석을 수행합니다.\n\n분석 방법: 타임스탑 시점에 청산하지 않고 계속 보유했다면 PnL이 어떻게 달라졌을지 시뮬레이션합니다.\n\n[방어] 청산 덕분에 추가 손실을 피한 횟수입니다. 타임스탑이 없었다면 더 큰 손실이 났을 거래의 건수입니다.\n[기회비용] 청산하지 않고 버텼더라면 더 좋은 결과가 나왔을 것으로 예상되는 건수입니다. 타임스탑이 잠재적 수익을 잘라낸 횟수입니다.\n\n[평균 효과] (역시뮬레이션 PnL - 실제 청산 PnL)의 평균값입니다.\n  · 음수(↓)일수록 타임스탑이 평균적으로 손실을 줄여줬다는 의미입니다.\n  · 양수(↑)이면 타임스탑이 오히려 수익 기회를 방해했다는 의미입니다.\n\n[+1봉 / +3봉] 청산 후 1봉·3봉 뒤 가격을 기준으로 재계산한 평균 효과입니다.\n0에 가까울수록 타이밍이 통계적으로 중립적이었음을 나타냅니다."} style={{ border: '1px solid rgba(59,139,235,0.2)', borderRadius: 10, padding: '10px 12px', background: 'rgba(59,139,235,0.05)', cursor: 'help' }}>
                    <div style={{ fontSize: '0.62rem', color: '#3b8beb', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 2 }}>타임스탑 후 실제 결과</div>
                    <div style={{ fontSize: '0.68rem', color: '#7f8fa8', marginBottom: 8 }}>강제청산 시점 기준 역시뮬레이션</div>
                    {/* Ratio bar */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: '0.61rem', color: '#0ecb81' }}>방어 {cfSummary.helpedOff}</span>
                        <span style={{ fontSize: '0.59rem', color: '#5d7080' }}>총 {cfSummary.samplesOff}건</span>
                        <span style={{ fontSize: '0.61rem', color: '#f6465d' }}>기회비용 {cfSummary.hurtOff}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: 'rgba(246,70,93,0.25)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${helpedPct}%`, background: '#0ecb81', borderRadius: 4, opacity: 0.85 }} />
                      </div>
                    </div>
                    {/* Stats row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                      {[
                        { label: '평균 효과', value: fmtDelta(cfSummary.avgDeltaOff), color: deltaColor },
                        { label: '+1봉', value: fmtDelta(cfSummary.avgDeltaOffPlus1), color: '#7f8fa8' },
                        { label: '+3봉', value: fmtDelta(cfSummary.avgDeltaOffPlus3), color: '#7f8fa8' },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '5px 6px', textAlign: 'center' as const }}>
                          <div style={{ fontSize: '0.57rem', color: '#3d5060', marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: '0.73rem', color, fontWeight: 700, fontFamily: '"SF Mono",Consolas,monospace' }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Card 2: 타임스탑 없이 청산 */}
              {(() => {
                const total = cfSummary.helpedOn + cfSummary.hurtOn;
                const helpedPct = total > 0 ? (cfSummary.helpedOn / total) * 100 : 50;
                const deltaColor = (cfSummary.avgDeltaOn ?? 0) >= 0 ? '#0ecb81' : '#f6465d';
                return (
                  <div title={"[타임스탑 없이 청산] 상세 설명\n\n이 카드는 타임스탑이 꺼진 상태(OFF)에서 TP·SL·수동으로 청산된 거래를 대상으로,\n\"만약 타임스탑이 켜져 있었다면?\"을 역시뮬레이션합니다.\n\n분석 방법: 해당 거래의 타임스탑 만료 시각에 강제 청산됐다고 가정하고 PnL을 재계산합니다.\n\n[방어] 타임스탑이 있었다면 더 일찍 빠져나와 손실을 줄였을 것으로 예상되는 건수입니다.\n[기회비용] 타임스탑 없이 TP까지 온전히 수익을 실현한 건수입니다. 타임스탑이 수익을 가로막았을 것으로 예상되는 건수입니다.\n\n[평균 효과] (타임스탑 가정 PnL - 실제 PnL)의 평균값입니다.\n  · 양수(↑)이면 타임스탑을 쓰는 것이 평균적으로 더 유리했다는 의미입니다.\n  · 음수(↓)이면 타임스탑 없이 청산하는 것이 더 유리했다는 의미입니다.\n\n카드 1과 이 카드를 함께 보면 타임스탑의 효과를 양방향으로 종합 평가할 수 있습니다."} style={{ border: '1px solid rgba(127,138,160,0.2)', borderRadius: 10, padding: '10px 12px', background: 'rgba(127,138,160,0.04)', cursor: 'help' }}>
                    <div style={{ fontSize: '0.62rem', color: '#9aa4b5', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 2 }}>타임스탑 없이 청산</div>
                    <div style={{ fontSize: '0.68rem', color: '#7f8fa8', marginBottom: 8 }}>TP/SL 청산 시 타임스탑 적용 가정</div>
                    {/* Ratio bar */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: '0.61rem', color: '#0ecb81' }}>방어 {cfSummary.helpedOn}</span>
                        <span style={{ fontSize: '0.59rem', color: '#5d7080' }}>총 {cfSummary.samplesOn}건</span>
                        <span style={{ fontSize: '0.61rem', color: '#f6465d' }}>기회비용 {cfSummary.hurtOn}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: 'rgba(246,70,93,0.25)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${helpedPct}%`, background: '#0ecb81', borderRadius: 4, opacity: 0.85 }} />
                      </div>
                    </div>
                    {/* Stats row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 5 }}>
                      <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '5px 8px', textAlign: 'center' as const }}>
                        <div style={{ fontSize: '0.57rem', color: '#3d5060', marginBottom: 2 }}>평균 효과</div>
                        <div style={{ fontSize: '0.78rem', color: deltaColor, fontWeight: 700, fontFamily: '"SF Mono",Consolas,monospace' }}>{fmtDelta(cfSummary.avgDeltaOn)}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* Card 3: 청산 후 3봉 흐름 */}
              {(cfSummary.avgMfePct != null || cfSummary.avgMaePct != null) && (() => {
                const mfe = cfSummary.avgMfePct ?? 0;
                const mae = cfSummary.avgMaePct ?? 0;
                const maxAbs = Math.max(Math.abs(mfe), Math.abs(mae), 0.01);
                return (
                  <div title={"[청산 후 3봉 흐름] 상세 설명\n\n타임스탑으로 청산한 직후 3봉(캔들) 동안 실제 시장 가격이 어떤 방향으로 얼마나 움직였는지를 분석합니다.\n\n[MFE (Maximum Favorable Excursion) — 최대 상승 여지]\n청산 후 3봉 안에서 내 포지션 방향으로 가격이 최대 얼마나 유리하게 움직였는지의 평균 비율입니다.\n  · LONG이면: 청산가 대비 3봉 내 최고 고점까지의 상승률 평균\n  · SHORT이면: 청산가 대비 3봉 내 최저 저점까지의 하락률 평균\n이 값이 클수록 \"조금만 더 버텼으면 수익이 늘었을 것\"이라는 의미입니다.\n\n[MAE (Maximum Adverse Excursion) — 최대 하락 위험]\n청산 후 3봉 안에서 내 포지션에 불리한 방향으로 가격이 최대 얼마나 움직였는지의 평균 비율입니다.\n이 값이 클수록 청산이 실제로 손실을 방어해줬다는 의미입니다.\n\n해석 기준:\n  · MFE ≈ MAE → 청산 타이밍이 통계적으로 중립적이었습니다.\n  · MFE > MAE → 평균적으로 청산 후 내 방향으로 더 움직였습니다.\n               조기청산으로 수익 기회를 놓쳤을 가능성이 있습니다.\n  · MFE < MAE → 평균적으로 청산 후 반대 방향으로 움직였습니다.\n               타임스탑이 손실을 효과적으로 방어했습니다."} style={{ border: '1px solid rgba(240,185,11,0.18)', borderRadius: 10, padding: '10px 12px', background: 'rgba(240,185,11,0.04)', cursor: 'help' }}>
                    <div style={{ fontSize: '0.62rem', color: '#f0b90b', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 2 }}>청산 후 3봉 흐름</div>
                    <div style={{ fontSize: '0.68rem', color: '#7f8fa8', marginBottom: 10 }}>청산 후 3봉 동안 가격 이동 범위</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: '0.62rem', color: '#0ecb81' }}>MFE 상승 여지</span>
                          <span style={{ fontSize: '0.68rem', color: '#0ecb81', fontWeight: 700, fontFamily: '"SF Mono",Consolas,monospace' }}>{mfe >= 0 ? '+' : ''}{mfe.toFixed(2)}%</span>
                        </div>
                        <div style={{ height: 7, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(Math.abs(mfe) / maxAbs) * 100}%`, background: '#0ecb81', borderRadius: 3, opacity: 0.8 }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: '0.62rem', color: '#f6465d' }}>MAE 하락 위험</span>
                          <span style={{ fontSize: '0.68rem', color: '#f6465d', fontWeight: 700, fontFamily: '"SF Mono",Consolas,monospace' }}>{mae >= 0 ? '+' : ''}{mae.toFixed(2)}%</span>
                        </div>
                        <div style={{ height: 7, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(Math.abs(mae) / maxAbs) * 100}%`, background: '#f6465d', borderRadius: 3, opacity: 0.8 }} />
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.59rem', color: '#4a5060', marginTop: 8, lineHeight: 1.5 }}>MFE ≈ MAE면 타이밍 적절 · MFE &gt; MAE면 조기청산 손실 가능</div>
                  </div>
                );
              })()}
            </div>
          )}
        </PerfCard>
      </div>

      {/* ── Row 4: 구간별 성과 | 종료 사유 | 시간대별 성과 (3-column) ──────────── */}
      <div style={{ ...revealStyle(3), display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10 }}>
        {/* 구간별 성과 */}
        <PerfCard style={{ marginBottom: 0 }}>
          <PerfCardTitle icon="📈" title="구간별 성과 보기" badge={<span style={{ fontSize: '0.63rem', color: '#6b7892' }}>{drillTitle}</span>} />
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4, marginBottom: 9 }}>
            {[
              { key: 'timeframe', label: '봉' },
              { key: 'side', label: 'L/S' },
              { key: 'source', label: '진입' },
              { key: 'leverage', label: '레버' },
              { key: 'cadence', label: '주기' },
            ].map(x => {
              const active = drillKey === x.key;
              return (
                <button
                  key={x.key}
                  onClick={() => setDrillKey(x.key as typeof drillKey)}
                  style={{
                    fontSize: '0.69rem',
                    color: active ? '#e8f0ff' : '#6f7c90',
                    border: `1px solid ${active ? 'rgba(59,139,235,0.5)' : 'rgba(255,255,255,0.07)'}`,
                    background: active ? 'linear-gradient(135deg, rgba(59,139,235,0.25), rgba(59,139,235,0.12))' : 'rgba(255,255,255,0.03)',
                    borderRadius: 999,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontWeight: active ? 700 : 500,
                    boxShadow: active ? '0 0 8px rgba(59,139,235,0.2)' : 'none',
                    transition: 'all 180ms ease',
                  }}
                >
                  {x.label}
                </button>
              );
            })}
          </div>
          <AnalyticsGroupBars key={drillKey} rows={drillRows} />
        </PerfCard>

        {/* 종료 사유 */}
        <PerfCard style={{ marginBottom: 0 }}>
          <PerfCardTitle icon="🎯" title="어떻게 끝났나?" badge={
            <span style={{ fontSize: '0.63rem', color: '#6b7892' }}>종료 사유</span>
          } />
          {closeReasonRows.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: '#5d6776' }}>종료된 ALT 거래 내역이 없습니다.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {closeReasonRows.map((r, idx) => {
                const barW = Math.max(4, (r.count / closeReasonRows[0].count) * 80);
                return (
                  <div key={r.key} style={{ padding: '6px 0', borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.color ?? '#848e9c', flexShrink: 0, boxShadow: `0 0 5px ${r.color ?? '#848e9c'}99` }} />
                        <span style={{ fontSize: '0.73rem', color: r.color ?? '#c9d0db', fontWeight: 700 }}>{r.label}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: '0.67rem', color: r.winRate >= 50 ? '#0ecb81' : '#e07070', fontFamily: '"SF Mono",Consolas,monospace', fontWeight: 600 }}>{r.winRate.toFixed(0)}%</span>
                        <span style={{ fontSize: '0.67rem', color: r.totalPnl >= 0 ? '#0ecb81' : '#f6465d', fontFamily: '"SF Mono",Consolas,monospace', fontWeight: 700 }}>{r.totalPnl >= 0 ? '+' : ''}{r.totalPnl.toFixed(1)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${barW}%`, background: r.color ?? '#848e9c', borderRadius: 3, opacity: 0.7 }} />
                      </div>
                      <span style={{ fontSize: '0.64rem', color: '#6a7a90', fontFamily: '"SF Mono",Consolas,monospace', flexShrink: 0 }}>{r.count}건</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </PerfCard>

        {/* 시간대별 성과 */}
        <PerfCard style={{ marginBottom: 0 }}>
          <PerfCardTitle icon="⏰" title="시간대별 성과" badge={<span style={{ fontSize: '0.63rem', color: '#6b7892' }}>KST 기준 청산 시각</span>} />
          {rows.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: '#5d6776' }}>거래 내역이 없습니다.</div>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <HourlyRingChart data={byHour} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
                <div style={{ fontSize: '0.59rem', color: '#3b8beb', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const, marginBottom: 4 }}>상위 수익 시간대</div>
                {byHour.filter(h => h.count > 0).sort((a, b) => b.totalPnl - a.totalPnl).slice(0, 3).map(h => (
                  <div key={h.hour} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: '0.63rem', color: '#7f8fa8' }}>{String(h.hour).padStart(2, '0')}:00 KST</span>
                    <div style={{ textAlign: 'right' as const }}>
                      <span style={{ fontSize: '0.65rem', color: '#0ecb81', fontFamily: '"SF Mono",Consolas,monospace', fontWeight: 600 }}>{h.totalPnl >= 0 ? '+' : ''}{h.totalPnl.toFixed(1)}</span>
                      <span style={{ fontSize: '0.59rem', color: '#3d5060', marginLeft: 4 }}>{h.count}건</span>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: '0.59rem', color: '#f6465d', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const, marginTop: 8, marginBottom: 4 }}>상위 손실 시간대</div>
                {byHour.filter(h => h.count > 0).sort((a, b) => a.totalPnl - b.totalPnl).slice(0, 3).map(h => (
                  <div key={h.hour} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: '0.63rem', color: '#7f8fa8' }}>{String(h.hour).padStart(2, '0')}:00 KST</span>
                    <div style={{ textAlign: 'right' as const }}>
                      <span style={{ fontSize: '0.65rem', color: '#f6465d', fontFamily: '"SF Mono",Consolas,monospace', fontWeight: 600 }}>{h.totalPnl >= 0 ? '+' : ''}{h.totalPnl.toFixed(1)}</span>
                      <span style={{ fontSize: '0.59rem', color: '#3d5060', marginLeft: 4 }}>{h.count}건</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </PerfCard>
      </div>
    </div>
  );
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
const CHART_H = 136;

function AssetLineChart({ pts, gradId, showZeroLine, color, label, period, fmtTooltip }: AssetLineChartProps) {
  const lineRef = useRef<SVGPathElement>(null);
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

  // Tooltip position in px — conservative flip threshold for compact panel widths
  const tooltipLeft = hover
    ? (hover.pxX > 180 ? hover.pxX - 118 : hover.pxX + 8)
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
    <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
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
function LiveAssetChart({
  history,
  balanceHistory,
}: {
  history: LiveTradeHistoryEntry[];
  balanceHistory?: Array<{ time: number; balance: number }>;
}) {
  const [period, setPeriod] = useState<AssetPeriod>('1M');

  const sorted = useMemo(() => [...history].sort((a, b) => a.exitTime - b.exitTime), [history]);
  const cutMs  = useMemo(() => (period === 'ALL' ? 0 : Date.now() - PERIOD_OFFSETS[period]), [period]);

  const baselineCumPnl = useMemo(() => {
    let acc = 0;
    for (const h of sorted) { if (h.exitTime < cutMs) acc += h.pnl ?? 0; }
    return acc;
  }, [sorted, cutMs]);

  const { filtered, cumPnlPts, tradeCountPts, winRatePts, balancePts } = useMemo(() => {
    const filtered = sorted.filter(h => h.exitTime >= cutMs);
    const cumPnlPts: AssetPt[] = [];
    const tradeCountPts: AssetPt[] = [];
    const winRatePts: AssetPt[] = [];
    const balancePts: AssetPt[] = (balanceHistory ?? [])
      .filter(x => x.time >= cutMs && isFinite(x.balance) && x.balance > 0)
      .map(x => ({ time: x.time, value: x.balance }));
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
    return { filtered, cumPnlPts, tradeCountPts, winRatePts, balancePts };
  }, [sorted, cutMs, baselineCumPnl, balanceHistory]);

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
        <AssetLineChart pts={balancePts} gradId="lg-margin-balance" color="#f0b90b" label="선물 마진 밸런스" period={period}
          fmtTooltip={v => `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`} />
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
  liveAltOrderTagMap, liveAltEntryOrderTagMap, liveHistory, liveBalanceHistory, onLiveCloseMarket, onLiveCloseCurrentPrice,
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
    if (isPaperMode) {
      if (tab === 'live-history' || tab === 'live-asset' || tab === 'live-performance' || tab === 'orders') {
        setTab('positions');
      }
      return;
    }
    if (tab === 'paper-orders' || tab === 'paper-history' || tab === 'paper-asset' || tab === 'paper-performance') {
      setTab('positions');
    }
  }, [isPaperMode, tab]);
  useEffect(() => {
    if (tab === 'paper-history') setPaperHistoryLimit(10);
    if (tab === 'live-history') setLiveHistoryLimit(10);
  }, [tab]);

  // ── Performance tab expand / collapse ──────────────────────────────────────
  type ExpandState = 'collapsed' | 'expanding' | 'full' | 'collapsing';
  const [expandState, setExpandState] = useState<ExpandState>('collapsed');
  const expandHeightRef = useRef(height);
  const expandFullHeightRef = useRef(typeof window !== 'undefined' ? window.innerHeight : 600);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const EXPAND_MS = 380;

  useEffect(() => {
    const isPerf = tab === 'paper-performance' || tab === 'live-performance';
    if (isPerf) {
      if (expandState === 'collapsed') {
        expandHeightRef.current = height;
        expandFullHeightRef.current = window.innerHeight;
        setExpandState('expanding');
        const id = window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => setExpandState('full'))
        );
        return () => window.cancelAnimationFrame(id);
      }
    } else {
      if (expandState === 'full' || expandState === 'expanding') {
        if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
        setExpandState('collapsing');
        expandTimerRef.current = setTimeout(() => setExpandState('collapsed'), EXPAND_MS + 50);
        return () => { if (expandTimerRef.current) clearTimeout(expandTimerRef.current); };
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const isExpanded = expandState !== 'collapsed';
  const capturedH = expandHeightRef.current;
  const fullH = expandFullHeightRef.current;

  const containerStyle: React.CSSProperties = (() => {
    const base = s.container as React.CSSProperties;
    switch (expandState) {
      case 'collapsed':
        return { ...base, height };
      case 'expanding':
        return { ...base, position: 'fixed', bottom: 0, left: 0, right: 0, height: capturedH, zIndex: 4999, transition: `height ${EXPAND_MS}ms cubic-bezier(0.22,1,0.36,1)` };
      case 'full':
        return { ...base, position: 'fixed', bottom: 0, left: 0, right: 0, height: fullH, zIndex: 4999, transition: `height ${EXPAND_MS}ms cubic-bezier(0.22,1,0.36,1)` };
      case 'collapsing':
        return { ...base, position: 'fixed', bottom: 0, left: 0, right: 0, height: capturedH, zIndex: 4999, transition: `height ${EXPAND_MS}ms cubic-bezier(0.22,1,0.36,1)` };
    }
  })();

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
      isAltTrade: h.isAltTrade,
      candidateScore: h.candidateScore ?? null,
      plannedEntry: h.plannedEntry ?? null,
      plannedTP: h.plannedTP ?? null,
      plannedSL: h.plannedSL ?? null,
      entrySource: h.entrySource,
      candidateId: h.candidateId,
      timeStopEnabledAtEntry: h.timeStopEnabledAtEntry ?? null,
      validUntilTimeAtEntry: h.validUntilTimeAtEntry ?? null,
      scanCadenceMinutesAtEntry: h.scanCadenceMinutesAtEntry ?? null,
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
      isAltTrade: h.isAltTrade,
      interval: h.interval,
      candidateScore: h.candidateScore ?? null,
      plannedEntry: h.plannedEntry ?? null,
      plannedTP: h.plannedTP ?? null,
      plannedSL: h.plannedSL ?? null,
      entrySource: h.entrySource,
      candidateId: h.candidateId,
      timeStopEnabledAtEntry: h.timeStopEnabledAtEntry ?? null,
      validUntilTimeAtEntry: h.validUntilTimeAtEntry ?? null,
      scanCadenceMinutesAtEntry: h.scanCadenceMinutesAtEntry ?? null,
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
                    {h.isAltTrade && (
                      <span style={{ fontSize: '0.58rem', background: 'rgba(59,139,235,0.18)', color: '#3b8beb', borderRadius: 3, padding: '1px 5px', fontWeight: 700, border: '1px solid rgba(59,139,235,0.4)', marginLeft: 4 }}>
                        ALT추천
                      </span>
                    )}
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
    <>
      {/* Spacer keeps layout intact while panel is fixed-position */}
      {isExpanded && <div style={{ flexShrink: 0, height: capturedH }} />}
      <div style={containerStyle}>
        {/* Drag handle — hidden when expanded */}
        {!isExpanded && <div style={s.resizeHandle} onMouseDown={handleResizeMouseDown} title="드래그하여 크기 조절" />}

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
            <button style={{ ...s.tab, ...(tab === 'paper-performance' ? s.tabActive : {}) }} onClick={() => setTab('paper-performance')}>
              성과분석
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
            <button style={{ ...s.tab, ...(tab === 'live-performance' ? s.tabActive : {}) }} onClick={() => setTab('live-performance')}>
              성과분석
            </button>
          </>
        )}
        {isExpanded && (
          <button
            style={{ marginLeft: 'auto', marginRight: 8, background: 'rgba(246,70,93,0.15)', border: '1px solid rgba(246,70,93,0.3)', borderRadius: 5, color: '#f6465d', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, padding: '3px 12px', fontFamily: 'inherit' }}
            onClick={() => setTab('positions')}
          >닫기</button>
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
        {isPaperMode && tab === 'paper-performance' && (
          <PerformanceAnalysisSection rows={paperHistoryRows} mode="paper" active={tab === 'paper-performance'} />
        )}

        {/* Live history tab */}
        {!isPaperMode && tab === 'live-history' && (
          renderTradeHistory('live', filteredLiveHistory, visibleLiveHistory, liveHistoryLimit, setLiveHistoryLimit)
        )}

        {/* Live asset tab */}
        {!isPaperMode && tab === 'live-asset' && (
          <LiveAssetChart history={liveHistory ?? []} balanceHistory={liveBalanceHistory} />
        )}
        {!isPaperMode && tab === 'live-performance' && (
          <PerformanceAnalysisSection rows={liveHistoryRows} mode="live" active={tab === 'live-performance'} />
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
                    const paperTimeStopOff = altMeta?.timeStopEnabled === false;
                    const remStr = remMs > 0
                      ? `${String(remH).padStart(2,'0')}:${String(remM).padStart(2,'0')}:${String(remS).padStart(2,'0')}`
                      : (paperTimeStopOff ? '만료(OFF)' : '만료');
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
                              <span
                                title={paperTimeStopOff ? '타임스탑 OFF: 시간 만료로 자동청산하지 않습니다.' : undefined}
                                style={{ color: remMs > 0 ? '#848e9c' : (paperTimeStopOff ? '#f0b90b' : '#f6465d') }}
                              >
                                {remStr}
                              </span>
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
                    const liveTimeStopOff = liveMeta?.timeStopEnabled === false;
                    const liveRemStr = liveRemMs > 0
                      ? `${String(liveRemH).padStart(2,'0')}:${String(liveRemM).padStart(2,'0')}:${String(liveRemS).padStart(2,'0')}`
                      : (liveTimeStopOff ? '만료(OFF)' : '만료');
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
                              <span
                                title={liveTimeStopOff ? '타임스탑 OFF: 시간 만료로 자동청산하지 않습니다.' : undefined}
                                style={{ color: liveRemMs > 0 ? '#848e9c' : (liveTimeStopOff ? '#f0b90b' : '#f6465d') }}
                              >
                                {liveRemStr}
                              </span>
                            </div>
                          ) : '—'}
                        </td>
                        {/* 진입시간 column (live) */}
                        <td style={{ ...s.td, color: '#5d6776', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                          {(liveMeta?.liveEntryTime ?? pos.entryTime ?? pos.updateTime) ? fmtEntryTime((liveMeta?.liveEntryTime ?? pos.entryTime ?? pos.updateTime)!) : '—'}
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
                const isAltEntry = liveAltEntryOrderTagMap?.[ord.orderId] === true;
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
                        {isAltEntry && (
                          <span style={{
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            color: '#3b8beb',
                            background: 'rgba(59,139,235,0.14)',
                            border: '1px solid rgba(59,139,235,0.35)',
                            borderRadius: 3,
                            padding: '1px 5px',
                            lineHeight: 1.2,
                          }}>
                            ALT추천
                          </span>
                        )}
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
    </>
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
