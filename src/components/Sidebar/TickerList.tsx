import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { TickerInfo } from '../../hooks/useTickers';
import { formatPrice } from '../../utils/priceFormat';

interface Props {
  tickers: TickerInfo[];
  loading: boolean;
  selected: string;
  onSelect: (symbol: string) => void;
  drawingCounts: Record<string, number>;
  width?: number;
}

// ── Coin icon ─────────────────────────────────────────────────────────────────

const ICON_COLORS = ['#f0b90b', '#0ecb81', '#4a90d9', '#e569a0', '#a855f7', '#ff6b35', '#26c6da'];

function CoinIcon({ symbol }: { symbol: string }) {
  const lower = symbol.toLowerCase();
  const [failed, setFailed] = React.useState(false);
  const color = ICON_COLORS[symbol.charCodeAt(0) % ICON_COLORS.length];

  if (failed) {
    return (
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.62rem', fontWeight: 700, color: '#131722',
      }}>
        {symbol.slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      src={`https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${lower}.svg`}
      width={22} height={22}
      style={{ borderRadius: '50%', flexShrink: 0 }}
      onError={() => setFailed(true)}
      alt={symbol}
    />
  );
}

// ── Standard ticker item ──────────────────────────────────────────────────────

function TickerItem({ ticker, selected, onSelect, count }: {
  ticker: TickerInfo; selected: string; onSelect: (s: string) => void; count: number;
}) {
  return (
    <div
      style={{ ...styles.item, ...(selected === ticker.symbol ? styles.itemSelected : {}) }}
      onClick={() => onSelect(ticker.symbol)}
    >
      <CoinIcon symbol={ticker.baseAsset} />
      <span style={styles.symbol}>{ticker.baseAsset}</span>
      {count > 0 && <span style={styles.badge}>{count}</span>}
    </div>
  );
}

// ── Vertical resize handle ────────────────────────────────────────────────────

function FavResizeHandle({ onDelta }: { onDelta: (delta: number) => void }) {
  const lastY = useRef(0);
  const [hovered, setHovered] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    lastY.current = e.clientY;
    const onMove = (ev: MouseEvent) => { const d = ev.clientY - lastY.current; lastY.current = ev.clientY; onDelta(d); };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      style={{ height: 6, cursor: 'ns-resize', background: hovered ? 'rgba(255,255,255,0.08)' : 'transparent', flexShrink: 0, transition: 'background 0.1s', borderTop: '1px solid #2a2e39', borderBottom: '1px solid #2a2e39' }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    />
  );
}

// ── Surge ticker type & hook ──────────────────────────────────────────────────

interface SurgeTicker extends TickerInfo {
  price: number;
  change1m: number;
  change3m: number;
  change5m: number;
  change15m: number;
  change30m: number;
}

type Period = 1 | 3 | 5 | 15 | 30;

const WS_URL = 'wss://fstream.binance.com/ws/!miniTicker@arr';

// Snapshot entry: timestamp + prices for all symbols
interface PriceSnap { time: number; prices: Record<string, number>; }

function useSurgeData(
  tickers: TickerInfo[],
  active: boolean,
): { rawList: SurgeTicker[]; ready: boolean; historyMinutes: number; minuteHistoryMinutes: number } {
  const currentRef   = useRef<Record<string, number>>({});
  // Fine-grained: every 5s, keep ~5.5 min (66 entries) — used for 1m/3m/5m
  const snapsRef     = useRef<PriceSnap[]>([]);
  // Coarse-grained: every 60s, keep 31 entries (30 min) — used for 15m/30m
  const minuteSnapsRef = useRef<PriceSnap[]>([]);
  const tickersRef   = useRef(tickers);
  const connectedRef = useRef(false);

  const [rawList, setRawList]                     = useState<SurgeTicker[]>([]);
  const [ready, setReady]                         = useState(false);
  const [historyMinutes, setHistMin]              = useState(0);
  const [minuteHistoryMinutes, setMinuteHistMin]  = useState(0);

  useEffect(() => { tickersRef.current = tickers; }, [tickers]);

  useEffect(() => {
    if (!active || !tickers.length) return;

    const tickerSet = new Set(tickers.map(t => t.symbol));
    let ws: WebSocket | null = null;
    let destroyed = false;

    // Find the latest snapshot at or before (now - minsAgo*60s).
    // For periods >= 15 use the coarse minute-level array; otherwise fine-grained.
    function getSnap(minsAgo: number): Record<string, number> {
      const snaps = minsAgo >= 15 ? minuteSnapsRef.current : snapsRef.current;
      if (!snaps.length) return {};
      const targetTime = Date.now() - minsAgo * 60_000;
      let best = snaps[0].prices; // fallback = oldest available
      for (const s of snaps) {
        if (s.time <= targetTime) best = s.prices;
        else break;
      }
      return best;
    }

    function tick() {
      if (!connectedRef.current || !Object.keys(currentRef.current).length) return;

      const now = Date.now();

      // Append fine-grained snapshot (every 5s, keep ~5.5 min)
      snapsRef.current = [...snapsRef.current, { time: now, prices: { ...currentRef.current } }];
      if (snapsRef.current.length > 66) snapsRef.current = snapsRef.current.slice(-66);

      const ageMs = now - (snapsRef.current[0]?.time ?? now);
      setHistMin(Math.floor(ageMs / 60_000));

      // Compute change for each period
      const snap1  = getSnap(1);
      const snap3  = getSnap(3);
      const snap5  = getSnap(5);
      const snap15 = getSnap(15);
      const snap30 = getSnap(30);
      const tickerMap = new Map(tickersRef.current.map(t => [t.symbol, t]));
      const items: SurgeTicker[] = [];

      for (const [symbol, price] of Object.entries(currentRef.current)) {
        const t = tickerMap.get(symbol);
        if (!t) continue;
        const chg = (snap: Record<string, number>) => {
          const p = snap[symbol];
          return p && p > 0 ? ((price - p) / p) * 100 : 0;
        };
        items.push({
          ...t, price,
          change1m:  chg(snap1),
          change3m:  chg(snap3),
          change5m:  chg(snap5),
          change15m: chg(snap15),
          change30m: chg(snap30),
        });
      }
      setRawList(items);
      if (!ready) setReady(true);
    }

    function minuteTick() {
      if (!connectedRef.current || !Object.keys(currentRef.current).length) return;
      const now = Date.now();
      minuteSnapsRef.current = [...minuteSnapsRef.current, { time: now, prices: { ...currentRef.current } }];
      if (minuteSnapsRef.current.length > 31) minuteSnapsRef.current = minuteSnapsRef.current.slice(-31);
      const ageMs = now - (minuteSnapsRef.current[0]?.time ?? now);
      setMinuteHistMin(Math.floor(ageMs / 60_000));
    }

    function connect() {
      if (destroyed) return;
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => {
        try {
          const data: Array<{ s: string; c: string }> = JSON.parse(e.data as string);
          for (const d of data) {
            if (tickerSet.has(d.s)) {
              const p = parseFloat(d.c);
              if (p > 0) currentRef.current[d.s] = p;
            }
          }
          if (!connectedRef.current && Object.keys(currentRef.current).length > 10) {
            connectedRef.current = true;
          }
        } catch {}
      };
      ws.onclose = () => { if (!destroyed) setTimeout(connect, 3000); };
      ws.onerror = () => { ws?.close(); };
    }

    connect();

    // Fine-grained tick every 5s; coarse minute tick every 60s
    const tickTimer       = setInterval(tick, 5_000);
    const minuteTickTimer = setInterval(minuteTick, 60_000);

    return () => {
      destroyed = true;
      ws?.close();
      clearInterval(tickTimer);
      clearInterval(minuteTickTimer);
      connectedRef.current = false;
      snapsRef.current = [];
      minuteSnapsRef.current = [];
      setReady(false);
      setHistMin(0);
      setMinuteHistMin(0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tickers.length]);

  return { rawList, ready, historyMinutes, minuteHistoryMinutes };
}

// ── Surge/Plunge list item ────────────────────────────────────────────────────

function SurgeItem({ ticker, change, selected, onSelect, flash, rankDelta }: {
  ticker: SurgeTicker;
  change: number;
  selected: string;
  onSelect: (s: string) => void;
  flash: 'up' | 'down' | null;
  rankDelta: number;
}) {
  const isSelected = selected === ticker.symbol;
  const isPos = change >= 0;

  const animStyle: React.CSSProperties = flash === 'up'
    ? { animation: 'surgeFlashUp 0.9s ease forwards' }
    : flash === 'down'
    ? { animation: 'surgeFlashDown 0.9s ease forwards' }
    : {};

  return (
    <div
      style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}), ...animStyle, paddingRight: 8 }}
      onClick={() => onSelect(ticker.symbol)}
    >
      <CoinIcon symbol={ticker.baseAsset} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.symbol}>{ticker.baseAsset}</div>
        <div style={{ color: '#4a5060', fontSize: '0.66rem', fontFamily: '"SF Mono", monospace', marginTop: 1 }}>
          {formatPrice(ticker.price)}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ color: isPos ? '#0ecb81' : '#f6465d', fontSize: '0.8rem', fontWeight: 700, fontFamily: '"SF Mono", monospace' }}>
          {isPos ? '+' : ''}{change.toFixed(2)}%
        </div>
        {rankDelta !== 0 && (
          <div style={{ color: rankDelta > 0 ? '#0ecb81' : '#f6465d', fontSize: '0.63rem', fontWeight: 600, marginTop: 1 }}>
            {rankDelta > 0 ? `▲${rankDelta}` : `▼${Math.abs(rankDelta)}`}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main TickerList component ─────────────────────────────────────────────────

type Tab = 'all' | 'surge' | 'plunge';

const TAB_LABELS: Record<Tab, string> = { all: '전체', surge: '급등순', plunge: '급락순' };
const PERIODS: Period[] = [1, 3, 5, 15, 30];

function periodChangeKey(p: Period): keyof SurgeTicker {
  if (p === 1)  return 'change1m';
  if (p === 3)  return 'change3m';
  if (p === 5)  return 'change5m';
  if (p === 15) return 'change15m';
  return 'change30m';
}

export function TickerList({ tickers, loading, selected, onSelect, drawingCounts, width }: Props) {
  const [search, setSearch] = useState('');
  const [favHeight, setFavHeight] = useState<number>(() => {
    try { return Number(localStorage.getItem('fav-height')) || 200; } catch { return 200; }
  });
  const [tab, setTab] = useState<Tab>('all');
  const [period, setPeriod] = useState<Period>(1);

  React.useEffect(() => {
    try { localStorage.setItem('fav-height', String(favHeight)); } catch {}
  }, [favHeight]);

  const isRankTab = tab === 'surge' || tab === 'plunge';
  const { rawList, ready, historyMinutes, minuteHistoryMinutes } = useSurgeData(tickers, isRankTab);

  // Use the right history counter based on selected period
  const effectiveHistory = period >= 15 ? minuteHistoryMinutes : historyMinutes;

  // Sorted display list for current tab + period
  const displayList = useMemo(() => {
    if (!isRankTab || !rawList.length) return [];
    const key = periodChangeKey(period);
    const sorted = [...rawList].sort((a, b) =>
      tab === 'surge'
        ? (b[key] as number) - (a[key] as number)
        : (a[key] as number) - (b[key] as number)
    );
    return sorted;
  }, [rawList, tab, period, isRankTab]);

  // Reset rank tracking when tab or period changes
  const prevRanksRef = useRef<Map<string, number>>(new Map());
  useEffect(() => { prevRanksRef.current = new Map(); }, [tab, period]);

  // Track rank changes for flash animation
  const [flashMap, setFlashMap] = useState<Map<string, 'up' | 'down'>>(new Map());
  const [rankDeltaMap, setRankDeltaMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!displayList.length) return;
    const newRanks = new Map(displayList.map((t, i) => [t.symbol, i]));
    const newFlash = new Map<string, 'up' | 'down'>();
    const newDelta = new Map<string, number>();

    for (const [sym, rank] of newRanks) {
      const prev = prevRanksRef.current.get(sym);
      if (prev !== undefined && prev !== rank) {
        const delta = prev - rank; // positive = moved up (lower index)
        newFlash.set(sym, delta > 0 ? 'up' : 'down');
        newDelta.set(sym, delta);
      }
    }
    prevRanksRef.current = newRanks;

    if (newFlash.size > 0) {
      setFlashMap(newFlash);
      setRankDeltaMap(newDelta);
      setTimeout(() => { setFlashMap(new Map()); setRankDeltaMap(new Map()); }, 900);
    }
  }, [displayList]);

  // "전체" tab data
  const favoriteTickers = useMemo(() => {
    return Object.keys(drawingCounts)
      .filter(sym => drawingCounts[sym] > 0)
      .map(sym => tickers.find(t => t.symbol === sym))
      .filter((t): t is TickerInfo => !!t)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [drawingCounts, tickers]);

  const filtered = useMemo(() => {
    const q = search.toUpperCase();
    return tickers.filter(t => t.symbol.includes(q));
  }, [tickers, search]);

  const changeKey = periodChangeKey(period);

  return (
    <div style={{ ...styles.container, width: width ?? 180 }}>
      {/* CSS keyframes */}
      <style>{`
        @keyframes surgeFlashUp {
          0%   { background: rgba(14,203,129,0.3); }
          100% { background: transparent; }
        }
        @keyframes surgeFlashDown {
          0%   { background: rgba(246,70,93,0.22); }
          100% { background: transparent; }
        }
      `}</style>

      {/* ── Main tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2a2e39', flexShrink: 0 }}>
        {(['all', 'surge', 'plunge'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              borderBottom: tab === t
                ? `2px solid ${t === 'surge' ? '#0ecb81' : t === 'plunge' ? '#f6465d' : '#f0b90b'}`
                : '2px solid transparent',
              color: tab === t
                ? (t === 'surge' ? '#0ecb81' : t === 'plunge' ? '#f6465d' : '#f0b90b')
                : '#5e6673',
              cursor: 'pointer',
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.02em',
              padding: '7px 2px',
              transition: 'color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* ── Period selector (급등순 / 급락순 only) ── */}
      {isRankTab && (
        <div style={{ display: 'flex', borderBottom: '1px solid #2a2e39', flexShrink: 0, padding: '4px 6px', gap: 3 }}>
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1,
                background: period === p ? 'rgba(240,185,11,0.12)' : 'none',
                border: `1px solid ${period === p ? '#f0b90b' : '#3a3e4a'}`,
                borderRadius: 3,
                color: period === p ? '#f0b90b' : '#5e6673',
                cursor: 'pointer',
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '3px 0',
                transition: 'all 0.12s',
                whiteSpace: 'nowrap',
              }}
            >
              {p}분
            </button>
          ))}
        </div>
      )}

      {/* ── 전체 tab ── */}
      {tab === 'all' && (
        <>
          {favoriteTickers.length > 0 && (
            <div style={{ ...styles.favSection, height: favHeight }}>
              <div style={styles.sectionLabel}>⭐ 즐겨찾기</div>
              <div style={styles.favList}>
                {favoriteTickers.map(t => (
                  <TickerItem key={t.symbol} ticker={t} selected={selected} onSelect={onSelect} count={drawingCounts[t.symbol] ?? 0} />
                ))}
              </div>
              <FavResizeHandle onDelta={d => setFavHeight(h => Math.max(60, Math.min(500, h + d)))} />
            </div>
          )}
          <div style={styles.sectionLabel}>전체</div>
          <div style={{ ...styles.searchWrap, position: 'relative' }}>
            <input
              style={styles.searchInput}
              placeholder="검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search !== '' && (
              <button style={styles.searchClear} onClick={() => setSearch('')} tabIndex={-1}>✕</button>
            )}
          </div>
          <div style={styles.list}>
            {loading && <div style={styles.loading}>로딩 중...</div>}
            {filtered.map(t => (
              <TickerItem key={t.symbol} ticker={t} selected={selected} onSelect={onSelect} count={drawingCounts[t.symbol] ?? 0} />
            ))}
          </div>
        </>
      )}

      {/* ── 급등순 / 급락순 tabs ── */}
      {isRankTab && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Status bar */}
          <div style={{ padding: '3px 10px', fontSize: '0.66rem', color: '#4a5060', borderBottom: '1px solid #2a2e39', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{ready ? `${displayList.length}개` : '연결 중...'}</span>
            <span style={{ color: tab === 'surge' ? 'rgba(14,203,129,0.6)' : 'rgba(246,70,93,0.6)' }}>
              {tab === 'surge' ? '↑' : '↓'}{' '}
              {effectiveHistory >= period
                ? `${period}분`
                : ready
                ? `~${Math.max(effectiveHistory, 0)}분`
                : `${period}분`}
              {ready && effectiveHistory < period && (
                <span style={{ color: '#3a3e4a', marginLeft: 3 }}>({period - effectiveHistory}분 후 정확)</span>
              )}
            </span>
          </div>

          {!ready ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#5e6673' }}>
              <div style={{ fontSize: '1.4rem' }}>📡</div>
              <div style={{ fontSize: '0.8rem' }}>데이터 수집 중...</div>
              <div style={{ fontSize: '0.72rem', color: '#3a3e4a', textAlign: 'center', padding: '0 16px' }}>
                잠시 후 {period}분 변동률이<br />표시됩니다
              </div>
            </div>
          ) : (
            <div style={styles.list}>
              {displayList.map(t => (
                <SurgeItem
                  key={t.symbol}
                  ticker={t}
                  change={t[changeKey] as number}
                  selected={selected}
                  onSelect={onSelect}
                  flash={flashMap.get(t.symbol) ?? null}
                  rankDelta={rankDeltaMap.get(t.symbol) ?? 0}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 180,
    background: '#1e222d',
    borderRight: '1px solid #2a2e39',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'hidden',
  },
  favSection: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sectionLabel: {
    padding: '6px 10px 4px',
    fontSize: '0.77rem',
    color: '#5e6673',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    flexShrink: 0,
  },
  favList: {
    flex: 1,
    overflowY: 'auto',
  },
  searchWrap: {
    padding: '4px 8px 6px',
    flexShrink: 0,
  },
  searchInput: {
    width: '100%',
    background: '#2a2e39',
    border: '1px solid #3a3e4a',
    borderRadius: 3,
    color: '#d1d4dc',
    fontSize: '0.85rem',
    padding: '4px 24px 4px 7px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  searchClear: {
    position: 'absolute',
    right: 4,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.77rem',
    lineHeight: 1,
    padding: '2px 4px',
  } as React.CSSProperties,
  list: {
    flex: 1,
    overflowY: 'auto',
  },
  loading: {
    color: '#5e6673',
    fontSize: '0.85rem',
    padding: '12px 10px',
  },
  item: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    cursor: 'pointer',
    borderLeft: '2px solid transparent',
    transition: 'background 0.1s',
    userSelect: 'none',
  },
  itemSelected: {
    borderLeft: '2px solid #f0b90b',
    background: 'rgba(240,185,11,0.06)',
  },
  symbol: {
    color: '#d1d4dc',
    fontSize: '0.95rem',
    fontWeight: 600,
    fontFamily: '"SF Mono", Consolas, monospace',
    flex: 1,
  },
  badge: {
    background: '#2a2e39',
    color: '#848e9c',
    fontSize: '0.7rem',
    fontWeight: 700,
    borderRadius: 8,
    padding: '1px 5px',
    minWidth: 16,
    textAlign: 'center',
    fontFamily: '"SF Mono", Consolas, monospace',
  },
};
