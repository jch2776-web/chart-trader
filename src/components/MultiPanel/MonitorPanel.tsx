import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Candle, Interval } from '../../types/candle';
import type { Drawing } from '../../types/drawing';
import type { TradeSettings, TelegramSettings, ActivityLog } from '../../types/trade';
import type { TrendlineDrawing, BoxDrawing, HlineDrawing } from '../../types/drawing';
import type { TickerInfo } from '../../hooks/useTickers';
import { useBinanceKlines } from '../../hooks/useBinanceKlines';
import { useBinanceWS } from '../../hooks/useBinanceWS';
import { CandleChart } from '../Chart/CandleChart';
import {
  checkTrendlineBreakout,
  checkBoxBreakout,
  getBoxState,
  checkHlineBreakout,
  getHlineState,
} from '../../utils/breakoutDetector';
import type { BoxState, HlineState } from '../../utils/breakoutDetector';
import { formatPrice } from '../../utils/priceFormat';
import type { BreakoutFlash } from '../../App';

const INTERVALS: Interval[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];
const FLASH_DURATION = 4500;

function uid() { return Math.random().toString(36).slice(2, 10); }

interface Props {
  panelId: number;
  ticker: string;
  onTickerChange: (ticker: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  tickers: TickerInfo[];
  drawingsByTicker: Record<string, Drawing[]>;
  settingsByTicker: Record<string, TradeSettings>;
  telegramSettings: TelegramSettings;
  onAddLog: (type: ActivityLog['type'], message: string) => void;
}

export function MonitorPanel({
  panelId,
  ticker,
  onTickerChange,
  onRemove,
  canRemove,
  tickers,
  drawingsByTicker,
  settingsByTicker,
  telegramSettings,
  onAddLog,
}: Props) {
  const [interval, setInterval] = useState<Interval>('15m');
  const [flashes, setFlashes] = useState<BreakoutFlash[]>([]);

  // ── Searchable ticker selector ──────────────────────────────────────────
  const [tickerSearch, setTickerSearch] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const tickerInputRef = useRef<HTMLInputElement>(null);

  const filteredTickers = tickerSearch.trim()
    ? tickers.filter(t => t.symbol.includes(tickerSearch.toUpperCase()))
    : tickers;

  const openTickerMenu = () => {
    if (tickerInputRef.current) {
      const r = tickerInputRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 150) });
    }
    setTickerSearch('');
    setShowMenu(true);
  };

  const closeTickerMenu = () => setTimeout(() => setShowMenu(false), 150);

  const selectTicker = (sym: string) => {
    onTickerChange(sym);
    setShowMenu(false);
    setTickerSearch('');
  };

  // Close menu on scroll/resize
  useEffect(() => {
    if (!showMenu) return;
    const close = () => setShowMenu(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [showMenu]);

  const { candles, setCandles } = useBinanceKlines(ticker, interval);

  // Refs for breakout detection
  const triggeredRef  = useRef<Set<string>>(new Set());
  const boxStatesRef   = useRef<Record<string, BoxState>>({});
  const hlineStatesRef = useRef<Record<string, HlineState>>({});
  const drawingsRef   = useRef<Drawing[]>([]);
  const tickerRef     = useRef(ticker);
  const settingsRef   = useRef<Record<string, TradeSettings>>(settingsByTicker);
  const telegramRef   = useRef(telegramSettings);
  const addLogRef     = useRef(onAddLog);

  // Keep refs current
  tickerRef.current     = ticker;
  settingsRef.current   = settingsByTicker;
  telegramRef.current   = telegramSettings;
  addLogRef.current     = onAddLog;
  drawingsRef.current   = drawingsByTicker[ticker] ?? [];

  // Reset breakout state when ticker changes
  const prevTickerRef = useRef(ticker);
  const isInitializedRef = useRef(false);
  if (prevTickerRef.current !== ticker) {
    prevTickerRef.current    = ticker;
    triggeredRef.current     = new Set();
    boxStatesRef.current     = {};
    hlineStatesRef.current   = {};
    isInitializedRef.current = false;
  }

  const addFlash = useCallback((f: Omit<BreakoutFlash, 'id' | 'startTime'>) => {
    const id = uid();
    const flash: BreakoutFlash = { ...f, id, startTime: Date.now() };
    setFlashes(prev => [...prev, flash]);
    setTimeout(() => {
      setFlashes(prev => prev.filter(x => x.id !== id));
    }, FLASH_DURATION + 200);
  }, []);

  useBinanceWS(ticker, interval, useCallback((candle: Candle) => {
    setCandles(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (candle.time === last.time) return [...prev.slice(0, -1), candle];
      if (candle.time > last.time) return [...prev, candle];
      return prev;
    });

    const tradeSettings = settingsRef.current[tickerRef.current];
    if (!tradeSettings?.active) return;
    if (drawingsRef.current.length === 0) return;

    const direction = tradeSettings.direction;
    const price = candle.close;
    const time  = candle.time;
    const currentTicker = tickerRef.current;

    // ── Silent init on first tick ──────────────────────────────────────
    if (!isInitializedRef.current) {
      drawingsRef.current.filter(d => d.type === 'box' && d.active !== false).forEach(d => {
        boxStatesRef.current[(d as BoxDrawing).id] = getBoxState(d as BoxDrawing, price);
      });
      drawingsRef.current.filter(d => d.type === 'hline' && d.active !== false).forEach(d => {
        hlineStatesRef.current[(d as HlineDrawing).id] = getHlineState(d as HlineDrawing, price);
      });
      drawingsRef.current.filter(d => d.type === 'trendline' && d.active !== false).forEach(d => {
        const sig = checkTrendlineBreakout(d as TrendlineDrawing, [], direction, price, time);
        if (sig) triggeredRef.current.add(`tl-${sig.drawingId}-${sig.direction}-${candle.time}`);
      });
      isInitializedRef.current = true;
      return;
    }

    // Trendline breakout
    drawingsRef.current
      .filter(d => d.type === 'trendline' && d.active !== false)
      .forEach(d => {
        const sig = checkTrendlineBreakout(d as TrendlineDrawing, [], direction, price, time);
        if (!sig) return;
        const key = `tl-${sig.drawingId}-${sig.direction}-${candle.time}`;
        if (triggeredRef.current.has(key)) return;
        triggeredRef.current.add(key);
        fireSignal(sig.drawingId, sig.direction, sig.type, 'breakout', sig.price, candle.time, currentTicker);
      });

    // Box breakout
    drawingsRef.current
      .filter(d => d.type === 'box' && d.active !== false)
      .forEach(d => {
        const box = d as BoxDrawing;
        const prevState = boxStatesRef.current[box.id] ?? null;
        const sigs = checkBoxBreakout(box, direction, price, time, prevState);
        boxStatesRef.current[box.id] = getBoxState(box, price);
        sigs.forEach(sig => {
          fireSignal(sig.drawingId, sig.direction, sig.type, sig.subtype, sig.price, candle.time, currentTicker);
        });
      });

    // Hline breakout
    drawingsRef.current
      .filter(d => d.type === 'hline' && d.active !== false)
      .forEach(d => {
        const hline = d as HlineDrawing;
        const prevState = hlineStatesRef.current[hline.id] ?? null;
        const sigs = checkHlineBreakout(hline, direction, price, time, prevState);
        hlineStatesRef.current[hline.id] = getHlineState(hline, price);
        sigs.forEach(sig => {
          fireSignal(sig.drawingId, sig.direction, sig.type, sig.subtype, sig.price, candle.time, currentTicker);
        });
      });

    function fireSignal(
      drawingId: string,
      dir: 'long' | 'short',
      type: 'trendline' | 'box' | 'hline',
      subtype: 'breakout' | 'entry',
      sigPrice: number,
      klineTime: number,
      sym: string,
    ) {
      const ts = settingsRef.current[tickerRef.current];
      const drawing = drawingsRef.current.find(d => d.id === drawingId);
      const drawingIdx = drawingsRef.current.findIndex(d => d.id === drawingId);
      const num = drawingIdx >= 0 ? `#${drawingIdx + 1}` : '';

      let drawingLabel = '';
      if (drawing?.type === 'trendline') {
        const tl = drawing as TrendlineDrawing;
        drawingLabel = `추세선${num} (${formatPrice(tl.p1.price)}→${formatPrice(tl.p2.price)})`;
      } else if (drawing?.type === 'box') {
        const bx = drawing as BoxDrawing;
        drawingLabel = `박스${num} (${formatPrice(bx.bottomPrice)}~${formatPrice(bx.topPrice)})`;
      } else if (drawing?.type === 'hline') {
        const hl = drawing as HlineDrawing;
        drawingLabel = `수평선${num} (${formatPrice(hl.price)})`;
      } else {
        drawingLabel = type === 'trendline' ? `추세선${num}` : type === 'box' ? `박스${num}` : `수평선${num}`;
      }

      const actionLabel = subtype === 'entry'
        ? `${dir === 'long' ? '▲' : '▼'} 박스권 진입`
        : `${dir === 'long' ? '▲ 롱' : '▼ 숏'} 돌파`;

      const logMsg = `[${sym}] ${drawingLabel} ${actionLabel} @ ${sigPrice.toFixed(2)}`;
      addLogRef.current('signal', logMsg);
      addFlash({ price: sigPrice, direction: dir, type, candleTime: klineTime, drawingLabel });

      const tg = telegramRef.current;
      if (tg.enabled && tg.botToken && tg.chatId) {
        const cooldown = ts?.telegramCooldownMs ?? 0;
        if (cooldown > 0 && Date.now() - klineTime > cooldown) return;
        fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tg.chatId, text: logMsg }),
        }).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCandles, addFlash]));

  const tradeSettings = settingsByTicker[ticker];
  const isActive = tradeSettings?.active ?? false;
  const drawings = drawingsByTicker[ticker] ?? [];

  return (
    <div style={styles.panel}>
      {/* Panel header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          {/* Searchable ticker input */}
          <div style={styles.tickerWrap}>
            <input
              ref={tickerInputRef}
              style={styles.tickerInput}
              value={showMenu ? tickerSearch : ticker}
              readOnly={!showMenu}
              onChange={e => setTickerSearch(e.target.value)}
              onFocus={openTickerMenu}
              onBlur={closeTickerMenu}
              spellCheck={false}
              title="티커 선택 (클릭 후 검색)"
            />
            {showMenu && (
              <div style={{ ...styles.tickerMenu, top: menuPos.top, left: menuPos.left, width: menuPos.width }}>
                {filteredTickers.length === 0
                  ? <div style={styles.tickerNoResult}>결과 없음</div>
                  : filteredTickers.map(t => (
                    <div
                      key={t.symbol}
                      style={{ ...styles.tickerOption, ...(t.symbol === ticker ? styles.tickerOptionActive : {}) }}
                      onMouseDown={() => selectTicker(t.symbol)}
                    >
                      {t.symbol}
                    </div>
                  ))
                }
              </div>
            )}
          </div>

          <div style={styles.intervalRow}>
            {INTERVALS.map(iv => (
              <button
                key={iv}
                style={{ ...styles.ivBtn, ...(interval === iv ? styles.ivActive : {}) }}
                onClick={() => setInterval(iv)}
              >
                {iv}
              </button>
            ))}
          </div>

          {isActive && (
            <span style={styles.activeDot} title="모니터링 활성" />
          )}
          {drawings.length > 0 && (
            <span style={styles.drawingBadge}>{drawings.length}</span>
          )}
        </div> {/* headerLeft */}

        <button
          style={{ ...styles.removeBtn, opacity: canRemove ? 1 : 0.3, cursor: canRemove ? 'pointer' : 'not-allowed' }}
          onClick={canRemove ? onRemove : undefined}
          title="패널 제거"
        >
          ✕
        </button>
      </div>

      {/* Chart */}
      <div style={styles.chartWrap}>
        <CandleChart
          key={`${panelId}-${ticker}-${interval}`}
          candles={candles}
          interval={interval}
          ticker={ticker}
          drawingMode="none"
          setDrawingMode={() => {}}
          onDrawingsChange={() => {}}
          flashes={flashes}
          initialDrawings={drawings}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid #2a2e39',
    background: '#131722',
    overflow: 'hidden',
    minHeight: 0,
    minWidth: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#1e222d',
    borderBottom: '1px solid #2a2e39',
    padding: '4px 8px',
    flexShrink: 0,
    gap: 8,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    overflow: 'hidden',
  },
  tickerWrap: {
    position: 'relative',
    flexShrink: 0,
  },
  tickerInput: {
    background: '#0d1520',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#d1d4dc',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '3px 6px',
    cursor: 'pointer',
    fontFamily: '"SF Mono", Consolas, monospace',
    outline: 'none',
    width: 110,
    boxSizing: 'border-box' as const,
  },
  tickerMenu: {
    position: 'fixed' as const,
    background: '#0d1520',
    border: '1px solid #3a4558',
    borderRadius: 5,
    zIndex: 9000,
    maxHeight: 220,
    overflowY: 'auto' as const,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  tickerOption: {
    padding: '5px 10px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    color: '#c0c4cc',
    fontFamily: '"SF Mono", Consolas, monospace',
    whiteSpace: 'nowrap' as const,
  },
  tickerOptionActive: {
    color: '#f0b90b',
    background: 'rgba(240,185,11,0.1)',
  },
  tickerNoResult: {
    padding: '8px 10px',
    fontSize: '0.8rem',
    color: '#5e6673',
  },
  intervalRow: {
    display: 'flex',
    gap: 0,
    flexShrink: 0,
  },
  ivBtn: {
    background: 'none',
    border: 'none',
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.77rem',
    fontWeight: 500,
    padding: '2px 6px',
    borderRadius: 3,
    fontFamily: '"SF Mono", Consolas, monospace',
    transition: 'all 0.1s',
  },
  ivActive: {
    color: '#f0b90b',
    background: 'rgba(240,185,11,0.1)',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#0ecb81',
    display: 'inline-block',
    flexShrink: 0,
    boxShadow: '0 0 6px #0ecb81',
  } as React.CSSProperties,
  drawingBadge: {
    background: '#2a2e39',
    color: '#848e9c',
    fontSize: '0.69rem',
    fontWeight: 700,
    borderRadius: 8,
    padding: '1px 5px',
    fontFamily: '"SF Mono", Consolas, monospace',
    flexShrink: 0,
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: '#4a5568',
    cursor: 'pointer',
    fontSize: '0.85rem',
    lineHeight: 1,
    padding: '2px 4px',
    flexShrink: 0,
    transition: 'color 0.1s',
  },
  chartWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
};
