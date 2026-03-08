import React, { useState, useCallback, useRef } from 'react';
import { LoginPage } from './components/Auth/LoginPage';
import { logout as authLogout } from './hooks/useAuth';
import type { Candle, Interval } from './types/candle';
import type { Drawing, DrawingMode } from './types/drawing';
import type { TrendlineDrawing, BoxDrawing, HlineDrawing } from './types/drawing';
import type { TradeSettings, ActivityLog, TelegramSettings } from './types/trade';
import type { ConditionalOrderPair } from './types/conditionalOrder';
import { useBinanceKlines } from './hooks/useBinanceKlines';
import { useBinanceWS } from './hooks/useBinanceWS';
import { useBinanceFutures } from './hooks/useBinanceFutures';
import { usePaperTrading } from './hooks/usePaperTrading';
import { useTickers } from './hooks/useTickers';
import { use24hStats } from './hooks/use24hStats';
import { CandleChart } from './components/Chart/CandleChart';
import type { IndicatorConfig } from './components/Chart/useChartRenderer';
import { Toolbar } from './components/Toolbar';
import { TickerHeader } from './components/TickerHeader';
import { TickerList } from './components/Sidebar/TickerList';
import { RightPanel } from './components/Panel/RightPanel';
import { BottomPanel } from './components/Panel/BottomPanel';
import { MultiChartView } from './components/MultiPanel/MultiChartView';
import { BackgroundMonitor } from './components/BackgroundMonitor';
import {
  checkTrendlineBreakout,
  checkBoxBreakout,
  getBoxState,
  checkHlineBreakout,
  getHlineState,
} from './utils/breakoutDetector';
import type { BoxState, HlineState } from './utils/breakoutDetector';
import { formatPrice } from './utils/priceFormat';
import { BoardModal } from './components/Board/BoardModal';
import { UserBoardModal } from './components/Board/UserBoardModal';
import { DisclaimerModal, hasAgreedDisclaimer } from './components/Disclaimer/DisclaimerModal';
import { SecurityFaqModal } from './components/Security/SecurityFaqModal';
import { AltScannerModal } from './components/AltScanner/AltScannerModal';
import type { AltTradeParams } from './components/AltScanner/AltScannerModal';
import type { ScanCandidate } from './components/AltScanner/breakoutScanner';
import type { LiveHistoryEntry } from './types/futures';
import { AltPositionMonitor, LiveAltPositionMonitor } from './components/AltScanner/AltPositionMonitor';
import type { AltMeta } from './types/paperTrading';
import { useAltAutoTrade } from './hooks/useAltAutoTrade';

export interface BreakoutFlash {
  id: string;
  price: number;
  direction: 'long' | 'short';
  type: 'trendline' | 'box' | 'hline';
  startTime: number;
  candleTime: number;
  drawingLabel: string; // e.g. "추세선#2 (95000→96000)"
}

const FLASH_DURATION = 4500;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const DEFAULT_TELEGRAM: TelegramSettings = {
  enabled: false,
  botToken: '',
  chatId: '',
};

// ── Per-user localStorage namespace ──────────────────────────────────────────
// Read once at module load; page reloads on login/logout so this stays correct.
const CURRENT_USER = (() => {
  try { return localStorage.getItem('auth-current-user'); } catch { return null; }
})();
/** Returns a per-user namespaced key, or the bare key if not logged in. */
const uk = (key: string) => CURRENT_USER ? `u:${CURRENT_USER}:${key}` : key;

interface PendingLiveTPSL {
  symbol: string;
  direction: 'long' | 'short';
  closeSide: 'BUY' | 'SELL';
  tp?: number;
  sl?: number;
  plannedQty: number;
  createdAt: number;
}

const DEFAULT_SETTINGS: TradeSettings = {
  leverage: 10,
  marginPct: 5,
  direction: 'both',
  executionMode: 'alert',
  active: false,
};

// ── Resizable divider between panels ─────────────────────────────────────────
function ResizeDivider({ onDelta }: { onDelta: (delta: number) => void }) {
  const lastX = useRef(0);
  const [hovered, setHovered] = React.useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    lastX.current = e.clientX;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onDelta(delta);
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      style={{
        width: 4,
        cursor: 'col-resize',
        background: hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
        flexShrink: 0,
        zIndex: 10,
        transition: 'background 0.1s',
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    />
  );
}

function AppInner() {
  const [ticker, setTicker] = useState('BTCUSDT');
  const [interval, setInterval] = useState<Interval>('15m');
  const [drawingMode, setDrawingMode] = useState<DrawingMode>('none');
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [flashes, setFlashes] = useState<BreakoutFlash[]>([]);

  // ── Mobile detection ─────────────────────────────────────────────────
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // ── Mobile panel overlay ('none' | 'tickers' | 'settings') ──────────
  const [mobilePanel, setMobilePanel] = useState<'none' | 'tickers' | 'settings'>('none');

  // ── Panel widths (resizable; 0 on mobile since overlays are used) ────
  const [leftWidth, setLeftWidth] = useState(isMobile ? 0 : 180);
  const [rightWidth, setRightWidth] = useState(isMobile ? 0 : 360);
  const [bottomHeight, setBottomHeight] = useState(180);

  // ── Global font size (persisted) ─────────────────────────────────────
  const [fontSize, setFontSize] = useState<number>(() => {
    try { return Number(localStorage.getItem('ui-font-size')) || 13; } catch { return 13; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('ui-font-size', String(fontSize)); } catch {}
    document.documentElement.style.fontSize = fontSize + 'px';
  }, [fontSize]);

  // ── Active drawing color (persisted) ─────────────────────────────────
  const [activeColor, setActiveColor] = useState<string>(() => {
    try { return localStorage.getItem(uk('drawing-color')) || '#3b8beb'; } catch { return '#3b8beb'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('drawing-color'), activeColor); } catch {}
  }, [activeColor]);

  // ── Multi-panel mode ──────────────────────────────────────────────────
  const [isMultiMode, setIsMultiMode] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [showUserBoard, setShowUserBoard] = useState(false);
  const [showSecurityFaq, setShowSecurityFaq] = useState(false);
  const [showAltScanner, setShowAltScanner] = useState(false);
  // Per-interval cache: keeps results from all scanned intervals so reopening restores them
  const [altScanCandidatesCache, setAltScanCandidatesCache] = useState<Record<string, ScanCandidate[]>>({});
  const [altScannerSnapshotMeta, setAltScannerSnapshotMeta] = useState<AltMeta | undefined>();

  // Live position AltMeta map: key = `${symbol}_${direction}` (persisted)
  const [liveAltMetaMap, setLiveAltMetaMap] = useState<Record<string, AltMeta>>(() => {
    try { return JSON.parse(localStorage.getItem(uk('live-alt-meta')) ?? '{}'); } catch { return {}; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('live-alt-meta'), JSON.stringify(liveAltMetaMap)); } catch {}
  }, [liveAltMetaMap]);

  // Pending live TP/SL: placed after entry order fills (persisted across reload)
  const [pendingLiveTPSLMap, setPendingLiveTPSLMap] = useState<Record<string, PendingLiveTPSL>>(() => {
    try { return JSON.parse(localStorage.getItem(uk('pending-live-tpsl')) ?? '{}'); } catch { return {}; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('pending-live-tpsl'), JSON.stringify(pendingLiveTPSLMap)); } catch {}
  }, [pendingLiveTPSLMap]);
  const inFlightTPSLRef = useRef(new Set<string>());
  const [showDisclaimer, setShowDisclaimer] = useState(() => !hasAgreedDisclaimer());
  const [multiPanelTickers, setMultiPanelTickers] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(uk('multi-panels')) ?? '["BTCUSDT","ETHUSDT"]'); }
    catch { return ['BTCUSDT', 'ETHUSDT']; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('multi-panels'), JSON.stringify(multiPanelTickers)); } catch {}
  }, [multiPanelTickers]);

  // ── Per-symbol trade settings (persisted) ────────────────────────────
  const [settingsByTicker, setSettingsByTicker] = useState<Record<string, TradeSettings>>(() => {
    try { return JSON.parse(localStorage.getItem(uk('trade-settings-v2')) ?? '{}'); }
    catch { return {}; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('trade-settings-v2'), JSON.stringify(settingsByTicker)); } catch {}
  }, [settingsByTicker]);

  // Current ticker's settings (read only — updates via handleTradeSettingsChange)
  const tradeSettings: TradeSettings = settingsByTicker[ticker] ?? DEFAULT_SETTINGS;
  const tradeRef = useRef<TradeSettings>(tradeSettings);
  tradeRef.current = tradeSettings;

  const handleTradeSettingsChange = useCallback((s: TradeSettings) => {
    setSettingsByTicker(prev => ({ ...prev, [tickerRef.current]: s }));
  }, []);

  // ── Telegram settings (persisted) ────────────────────────────────────
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings>(() => {
    try { return JSON.parse(localStorage.getItem(uk('telegram-settings')) ?? 'null') ?? DEFAULT_TELEGRAM; }
    catch { return DEFAULT_TELEGRAM; }
  });
  const telegramRef = useRef<TelegramSettings>(telegramSettings);
  telegramRef.current = telegramSettings;
  React.useEffect(() => {
    try { localStorage.setItem(uk('telegram-settings'), JSON.stringify(telegramSettings)); } catch {}
  }, [telegramSettings]);

  // ── Binance API keys (persisted) ─────────────────────────────────────
  const [binanceApiKey, setBinanceApiKey] = useState<string>(() => {
    try { return localStorage.getItem(uk('binance-api-key')) ?? ''; } catch { return ''; }
  });
  const [binanceApiSecret, setBinanceApiSecret] = useState<string>(() => {
    try { return localStorage.getItem(uk('binance-api-secret')) ?? ''; } catch { return ''; }
  });

  const handleSaveApiKeys = useCallback((key: string, secret: string) => {
    setBinanceApiKey(key);
    setBinanceApiSecret(secret);
    try { localStorage.setItem(uk('binance-api-key'), key); } catch {}
    try { localStorage.setItem(uk('binance-api-secret'), secret); } catch {}
  }, []);

  const handleClearApiKeys = useCallback(() => {
    setBinanceApiKey('');
    setBinanceApiSecret('');
    try { localStorage.removeItem(uk('binance-api-key')); } catch {}
    try { localStorage.removeItem(uk('binance-api-secret')); } catch {}
  }, []);

  const handleLogout = useCallback(() => { authLogout(); }, []);

  // ── Per-ticker drawings storage (persisted to localStorage) ──────────
  const [drawingsByTicker, setDrawingsByTicker] = useState<Record<string, Drawing[]>>(() => {
    try { return JSON.parse(localStorage.getItem(uk('chart-drawings')) ?? '{}'); }
    catch { return {}; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('chart-drawings'), JSON.stringify(drawingsByTicker)); } catch {}
  }, [drawingsByTicker]);

  // Ref to CandleChart's internal deleteDrawing fn
  const deleteDrawingFnRef = useRef<((id: string) => void) | null>(null);
  // Ref to CandleChart's internal updateDrawingMemo fn
  const updateMemoFnRef = useRef<((id: string, memo: string) => void) | null>(null);
  // Ref to CandleChart's internal updateDrawingColor fn
  const updateColorFnRef = useRef<((id: string, color: string) => void) | null>(null);
  // Ref to CandleChart's internal updateDrawingActive fn
  const updateActiveFnRef = useRef<((id: string, active: boolean) => void) | null>(null);

  const addLog = useCallback((type: ActivityLog['type'], message: string) => {
    setLogs(prev => [
      ...prev,
      { id: uid(), timestamp: Date.now(), type, message },
    ].slice(-200));
  }, []);

  const addFlash = useCallback((f: Omit<BreakoutFlash, 'id' | 'startTime'>) => {
    const id = uid();
    const flash: BreakoutFlash = { ...f, id, startTime: Date.now() };
    setFlashes(prev => [...prev, flash]);
    setTimeout(() => {
      setFlashes(prev => prev.filter(x => x.id !== id));
    }, FLASH_DURATION + 200);
  }, []);

  // ── Binance data ──────────────────────────────────────────────────────
  const { candles, setCandles, loading, error } = useBinanceKlines(ticker, interval);
  const stats = use24hStats(ticker);

  const candlesRef = useRef<Candle[]>(candles);
  candlesRef.current = candles;

  // Real-time WS refs
  const triggeredRef = useRef<Set<string>>(new Set());
  const drawingsRef  = useRef<Drawing[]>([]);
  const tickerRef    = useRef(ticker);
  tickerRef.current  = ticker;

  // Box state machine: tracks 'above' | 'inside' | 'below' per drawing ID
  const boxStatesRef = useRef<Record<string, BoxState>>({});
  // Hline state machine: tracks 'above' | 'below' per drawing ID
  const hlineStatesRef = useRef<Record<string, HlineState>>({});

  // Silent-init flag: first tick after ticker/activation change is used to
  // record current state without firing any signals
  const isInitializedRef = useRef(false);

  // Keep drawingsRef in sync with current ticker
  const currentDrawings = drawingsByTicker[ticker] ?? [];
  drawingsRef.current = currentDrawings;

  useBinanceWS(ticker, interval, useCallback((candle: Candle, _isClosed: boolean) => {
    setCandles(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (candle.time === last.time) return [...prev.slice(0, -1), candle];
      if (candle.time > last.time) return [...prev, candle];
      return prev;
    });

    // Paper trading: update price map and check TP/SL/liquidation on every tick
    if (isPaperModeRef.current) {
      markPricesMapRef.current[tickerRef.current] = candle.close;
      paperTradingRef.current.checkPrices(markPricesMapRef.current);
    }

    if (!tradeRef.current.active) return;
    if (drawingsRef.current.length === 0) return;

    const direction = tradeRef.current.direction;
    const price = candle.close;
    const time  = candle.time;

    // ── Silent init: on first tick, record state without firing ───────
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

    // ── Trendlines: stateless, dedup per kline ────────────────────────
    const trendlineSignals = drawingsRef.current
      .filter(d => d.type === 'trendline' && d.active !== false)
      .flatMap(d => {
        const sig = checkTrendlineBreakout(d as TrendlineDrawing, [], direction, price, time);
        return sig ? [sig] : [];
      });

    trendlineSignals.forEach(sig => {
      const key = `tl-${sig.drawingId}-${sig.direction}-${candle.time}`;
      if (triggeredRef.current.has(key)) return;
      triggeredRef.current.add(key);
      fireSignal(sig.drawingId, sig.direction, sig.type, 'breakout', sig.price, candle.time);
    });

    // ── Boxes: stateful state machine, no candle.time dedup needed ────
    drawingsRef.current
      .filter(d => d.type === 'box' && d.active !== false)
      .forEach(d => {
        const box = d as BoxDrawing;
        const prevState = boxStatesRef.current[box.id] ?? null;
        const sigs = checkBoxBreakout(box, direction, price, time, prevState);
        boxStatesRef.current[box.id] = getBoxState(box, price);
        sigs.forEach(sig => {
          fireSignal(sig.drawingId, sig.direction, sig.type, sig.subtype, sig.price, candle.time);
        });
      });

    // ── Hlines: stateful state machine ───────────────────────────────
    drawingsRef.current
      .filter(d => d.type === 'hline' && d.active !== false)
      .forEach(d => {
        const hline = d as HlineDrawing;
        const prevState = hlineStatesRef.current[hline.id] ?? null;
        const sigs = checkHlineBreakout(hline, direction, price, time, prevState);
        hlineStatesRef.current[hline.id] = getHlineState(hline, price);
        sigs.forEach(sig => {
          fireSignal(sig.drawingId, sig.direction, sig.type, sig.subtype, sig.price, candle.time);
        });
      });

    function fireSignal(
      drawingId: string,
      direction: 'long' | 'short',
      type: 'trendline' | 'box' | 'hline',
      subtype: 'breakout' | 'entry',
      sigPrice: number,
      klineTime: number,
    ) {
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
        ? `${direction === 'long' ? '▲' : '▼'} 박스권 진입`
        : `${direction === 'long' ? '▲ 롱' : '▼ 숏'} 돌파`;

      const logMsg = `[${tickerRef.current}] ${drawingLabel} ${actionLabel} @ ${sigPrice.toFixed(2)}`;
      addLog('signal', logMsg);
      addFlash({ price: sigPrice, direction, type, candleTime: klineTime, drawingLabel });

      const tg = telegramRef.current;
      const ts = tradeRef.current;
      if (tg.enabled && tg.botToken && tg.chatId) {
        // Skip Telegram if user opted to mute while viewing this ticker
        if (ts.muteWhenViewing) return;
        // Skip Telegram if the candle is older than configured cooldown
        const cooldown = ts.telegramCooldownMs ?? 0;
        if (cooldown > 0 && Date.now() - klineTime > cooldown) return;
        fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tg.chatId, text: logMsg }),
        }).catch(() => {});
      }

      // ── Conditional orders trigger ───────────────────────────────────
      // Map fireSignal (direction, subtype) → TriggerCondition for matching
      const firedCondition =
        subtype === 'breakout' && direction === 'long'  ? 'break_up'   :
        subtype === 'breakout' && direction === 'short' ? 'break_down' :
        subtype === 'entry'   && direction === 'long'   ? 'enter_up'   :
                                                          'enter_down';
      const matchingCOs = conditionalOrdersRef.current.filter(co =>
        co.status === 'active' &&
        co.drawingId === drawingId &&
        co.ticker === tickerRef.current &&
        // Respect the user's chosen trigger condition (fallback: match any for legacy orders)
        (!co.triggerCondition || co.triggerCondition === firedCondition),
      );
      for (const co of matchingCOs) {
        setConditionalOrders(prev =>
          prev.map(c => c.id === co.id ? { ...c, status: 'triggered', triggeredAt: Date.now() } : c),
        );
        addLog('info', `[조건부주문] ${co.drawingLabel} 트리거 → ${co.entrySide} @ ${co.entryPrice}`);

        if (isPaperModeRef.current) {
          // Paper mode: simulate order without real API call
          const paperBal = paperTradingRef.current.balance;
          const paperQty = Math.floor((paperBal * co.entryMarginPct / 100 * co.entryLeverage / co.entryPrice) * 1000) / 1000;
          if (paperQty > 0) {
            paperTradingRef.current.openPosition(
              co.ticker,
              co.entrySide === 'BUY' ? 'LONG' : 'SHORT',
              paperQty, co.entryPrice, co.entryLeverage,
              co.entryMarginType === 'CROSSED' ? 'cross' : 'isolated',
            );
            addLog('info', `[모의] 조건부주문 체결 — ${co.entrySide} ${paperQty} @ ${co.entryPrice}`);
          } else {
            addLog('error', '[모의] 잔고 부족으로 조건부주문 실패');
          }
        } else {
          const bal = futuresBalanceRef.current;
          const entryQty = Math.floor((bal * co.entryMarginPct / 100 * co.entryLeverage / co.entryPrice) * 1000) / 1000;
          futuresPlaceOrderRef.current(co.entrySide, co.entryPrice, entryQty, co.entryLeverage, co.entryMarginType)
            .then(async () => {
              if (co.exitEnabled && co.exitPrice > 0 && co.exitQtyPct > 0) {
                const exitSide: 'BUY' | 'SELL' = co.entrySide === 'BUY' ? 'SELL' : 'BUY';
                const exitQty = Math.floor(entryQty * co.exitQtyPct / 100 * 1000) / 1000;
                if (exitQty > 0) {
                  await futuresPlaceOrderRef.current(exitSide, co.exitPrice, exitQty, co.entryLeverage, co.entryMarginType);
                }
              }
              addLog('info', `[조건부주문] 완료 — ${co.entrySide} ${entryQty} @ ${co.entryPrice}`);
            })
            .catch((e: unknown) => {
              const msg = e instanceof Error ? e.message : '주문 실패';
              setConditionalOrders(prev =>
                prev.map(c => c.id === co.id ? { ...c, status: 'failed', errorMsg: msg } : c),
              );
              addLog('error', `[조건부주문] 실패: ${msg}`);
            });
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, addFlash, setCandles]));

  // ── Order target price (for chart marker) ────────────────────────────
  const [orderTargetPrice, setOrderTargetPrice] = useState<number | null>(null);

  // ── Conditional form prices (for chart overlay, different color) ──────
  const [conditionalFormPrices, setConditionalFormPrices] = useState<number[]>([]);

  // ── Conditional order drawing highlight ───────────────────────────────
  const [conditionalHighlightedDrawingId, setConditionalHighlightedDrawingId] = useState<string | null>(null);
  const handleConditionalDrawingHighlight = useCallback((id: string | null) => {
    setConditionalHighlightedDrawingId(id);
  }, []);
  // Compute the price to highlight on the chart from the selected drawing
  const highlightedDrawingPrice = React.useMemo(() => {
    if (!conditionalHighlightedDrawingId) return null;
    const d = currentDrawings.find(x => x.id === conditionalHighlightedDrawingId);
    if (!d) return null;
    if (d.type === 'hline') return (d as HlineDrawing).price;
    if (d.type === 'box') { const b = d as BoxDrawing; return (b.topPrice + b.bottomPrice) / 2; }
    if (d.type === 'trendline') { const t = d as TrendlineDrawing; return (t.p1.price + t.p2.price) / 2; }
    return null;
  }, [conditionalHighlightedDrawingId, currentDrawings]);

  // ── Conditional orders (persisted) ───────────────────────────────────
  const [conditionalOrders, setConditionalOrders] = useState<ConditionalOrderPair[]>(() => {
    try {
      const loaded = JSON.parse(localStorage.getItem(uk('conditional-orders')) ?? '[]') as ConditionalOrderPair[];
      return loaded.filter(co => co.status !== 'cancelled');
    } catch { return []; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('conditional-orders'), JSON.stringify(conditionalOrders)); } catch {}
  }, [conditionalOrders]);

  // ── Futures positions & orders ────────────────────────────────────────
  const {
    positions: futuresPositions,
    orders: futuresOrders,
    allPositions: futuresAllPositions,
    allOrders: futuresAllOrders,
    balance: futuresBalance,
    loading: futuresLoading,
    error: futuresError,
    placeOrder: futuresPlaceOrder,
    cancelOrder: futuresCancelOrder,
    placeTPSL: futuresPlaceTPSL,
    closeMarket: futuresCloseMarket,
    clientSlMap: futuresClientSlMap,
    removeClientSL: futuresRemoveClientSL,
    fetchIncomeHistory: futuresFetchIncomeHistory,
  } = useBinanceFutures(binanceApiKey, binanceApiSecret, ticker);

  // ── Live trading history ──────────────────────────────────────────────
  const [liveHistory, setLiveHistory] = useState<LiveHistoryEntry[]>([]);
  const fetchLiveHistory = useCallback(async (startTime?: number, endTime?: number) => {
    const entries = await futuresFetchIncomeHistory(startTime, endTime);
    setLiveHistory(entries);
  }, [futuresFetchIncomeHistory]);

  // ── Chart indicators ──────────────────────────────────────────────────
  const [indicators, setIndicators] = useState<IndicatorConfig>(() => {
    try { return JSON.parse(localStorage.getItem(uk('indicators')) ?? '{}') as IndicatorConfig; }
    catch { return { coinDuckMABB: false, dwCloud: false }; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('indicators'), JSON.stringify(indicators)); } catch {}
  }, [indicators]);
  const handleToggleIndicator = useCallback((name: keyof IndicatorConfig) => {
    setIndicators(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  // ── Paper trading mode ────────────────────────────────────────────────
  const [isPaperMode, setIsPaperMode] = useState(
    () => { try { return localStorage.getItem(uk('paper-mode')) === '1'; } catch { return false; } }
  );
  React.useEffect(() => {
    try { localStorage.setItem(uk('paper-mode'), isPaperMode ? '1' : '0'); } catch {}
  }, [isPaperMode]);

  const paperTrading = usePaperTrading(uk('paper-trading'));
  const isPaperModeRef = useRef(isPaperMode);
  isPaperModeRef.current = isPaperMode;
  const paperTradingRef = useRef(paperTrading);
  paperTradingRef.current = paperTrading;

  // Convert paper pending orders → FuturesOrder shape for RightPanel display
  const paperOrdersAsFutures = isPaperMode ? paperTrading.orders.map(o => ({
    symbol: o.symbol,
    orderId: o.id,
    side: o.side,
    type: 'LIMIT' as const,
    price: o.limitPrice,
    origQty: o.qty,
    stopPrice: 0,
    status: 'NEW',
  })) : undefined;

  // Cancel handler for paper mode (wraps sync cancelOrder as async)
  const paperCancelOrder = React.useCallback(async (orderId: string) => {
    paperTradingRef.current.cancelOrder(orderId);
  }, []);

  // ── Global WS monitor for conditional (close_above / close_below) paper orders ──
  // Opens a native WS for each unique (symbol, interval) pair among pending conditional orders.
  // On candle close (k.x === true), fires checkCandleClose so orders trigger even when
  // the AltScannerModal is closed or a different symbol is selected.
  React.useEffect(() => {
    const conditionalOrders = paperTrading.orders.filter(
      o => o.triggerType === 'close_above' || o.triggerType === 'close_below',
    );

    // Build unique (symbol, interval) pairs
    const pairs = [
      ...new Map(conditionalOrders.map(o => {
        const interval = o.altMeta?.scanInterval ?? '1h';
        return [`${o.symbol}_${interval}`, { symbol: o.symbol, interval }];
      })).values(),
    ];

    if (pairs.length === 0) return;

    const wsBase = 'wss://fstream.binance.com/ws';
    const sockets: WebSocket[] = [];

    for (const { symbol, interval } of pairs) {
      const ws = new WebSocket(`${wsBase}/${symbol.toLowerCase()}@kline_${interval}`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { k: { c: string; x: boolean } };
          if (msg.k.x) {
            paperTradingRef.current.checkCandleClose({ [symbol]: parseFloat(msg.k.c) });
          }
        } catch (_) {}
      };
      sockets.push(ws);
    }

    return () => {
      sockets.forEach(ws => ws.close());
    };
  // Re-run when the set of conditional order (symbol+interval) keys changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paperTrading.orders
      .filter(o => o.triggerType === 'close_above' || o.triggerType === 'close_below')
      .map(o => `${o.symbol}_${o.altMeta?.scanInterval ?? '1h'}`)
      .sort()
      .join(','),
  ]);

  // Mark prices map: accumulated as the user browses charts; also refreshed via REST for paper positions
  const markPricesMapRef = useRef<Record<string, number>>({});

  // Symbols for paper price feed: union of open positions and pending orders
  const paperSymbolsKey = isPaperMode
    ? [...new Set([
        ...paperTrading.positions.map(p => p.symbol),
        ...paperTrading.orders.map(o => o.symbol),
      ])].sort().join(',')
    : '';

  // Fetch REST mark prices for all paper symbols (positions ∪ orders), call checkPrices after each update
  React.useEffect(() => {
    if (!isPaperMode || paperSymbolsKey === '') return;
    const symbols = paperSymbolsKey.split(',');
    const fetchAndCheck = () => {
      symbols.forEach(sym => {
        fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`)
          .then(r => r.json())
          .then((d: { price: string }) => {
            markPricesMapRef.current[sym] = parseFloat(d.price);
            paperTradingRef.current.checkPrices(markPricesMapRef.current);
          })
          .catch(() => {});
      });
    };
    fetchAndCheck();
    const interval = window.setInterval(fetchAndCheck, 5000);
    return () => window.clearInterval(interval);
  }, [isPaperMode, paperSymbolsKey]);

  // paperPlaceOrder: drop-in for futuresPlaceOrder in paper mode
  // price === 0 → market order (execute immediately)
  // price > 0   → limit order (queue until price is reached)
  const paperPlaceOrder = useCallback(async (
    side: 'BUY' | 'SELL',
    price: number,
    qty: number,
    leverage: number,
    marginType: 'CROSSED' | 'ISOLATED',
    reduceOnly?: boolean,
  ) => {
    const mType = marginType === 'CROSSED' ? 'cross' : 'isolated';
    if (price === 0) {
      // Market order — execute at current mark price
      const curPrice = markPricesMapRef.current[tickerRef.current] ?? currentPriceRef.current ?? 0;
      if (!curPrice || curPrice <= 0) return; // no valid price yet — refuse to open
      if (reduceOnly) {
        const posSide = side === 'BUY' ? 'SHORT' : 'LONG';
        const raw = paperTradingRef.current.positions.find(
          p => p.symbol === tickerRef.current && p.positionSide === posSide,
        );
        if (raw) paperTradingRef.current.partialClosePosition(raw.id, curPrice, 'manual', qty);
      } else {
        paperTradingRef.current.openPosition(
          tickerRef.current, side === 'BUY' ? 'LONG' : 'SHORT',
          qty, curPrice, leverage, mType,
        );
      }
    } else {
      // Limit order — queue it
      paperTradingRef.current.placeLimitOrder(
        tickerRef.current, side, qty, price, leverage, mType, reduceOnly ?? false,
      );
    }
  }, []);

  // ── Refs for conditional order execution (inside WS callback) ────────
  const conditionalOrdersRef = useRef<ConditionalOrderPair[]>(conditionalOrders);
  conditionalOrdersRef.current = conditionalOrders;
  const futuresPlaceOrderRef = useRef(futuresPlaceOrder);
  futuresPlaceOrderRef.current = futuresPlaceOrder;
  const futuresBalanceRef = useRef(futuresBalance);
  futuresBalanceRef.current = futuresBalance;

  // ── Conditional order handlers ────────────────────────────────────────
  const handleAddConditionalOrder = useCallback((order: Omit<ConditionalOrderPair, 'id' | 'status' | 'createdAt'>) => {
    setConditionalOrders(prev => [...prev, { ...order, id: uid(), status: 'active', createdAt: Date.now() }]);
  }, []);

  const handleRemoveConditionalOrder = useCallback((id: string) => {
    setConditionalOrders(prev => prev.filter(co => co.id !== id));
  }, []);

  // ── Interval change: clear stale candles first ────────────────────────
  // Without this, the remounted CandleChart receives the OLD interval's candles
  // on its first render, sets the viewport for the wrong data, and when the
  // correct candles arrive Case 1 is already satisfied (ticker unchanged) so
  // the viewport never resets — causing a blank or misaligned chart.
  const handleIntervalChange = useCallback((iv: Interval) => {
    setCandles([]);
    setInterval(iv);
  }, [setCandles]);

  // ── Ticker change ─────────────────────────────────────────────────────
  const { tickers, loading: tickersLoading } = useTickers();

  const handleTickerSelect = useCallback((symbol: string) => {
    if (symbol === tickerRef.current) return;
    setCandles([]);
    setTicker(symbol);
    setSelectedDrawingId(null);
    setDrawingMode('none');
    setFlashes([]);
    setConditionalHighlightedDrawingId(null);
    triggeredRef.current.clear();
    boxStatesRef.current = {};
    hlineStatesRef.current = {};
    isInitializedRef.current = false;
  }, [setCandles]);

  // ── Drawings: save per-ticker ─────────────────────────────────────────
  const handleDrawingsChange = useCallback((newDrawings: Drawing[]) => {
    setDrawingsByTicker(prev => ({ ...prev, [tickerRef.current]: newDrawings }));
  }, []);

  // ── Current price ─────────────────────────────────────────────────────
  const lastCandle = candles[candles.length - 1];
  const currentPrice = lastCandle?.close;
  const currentPriceRef = useRef(currentPrice);
  currentPriceRef.current = currentPrice;

  // ── Trade activate ────────────────────────────────────────────────────
  const handleActivate = useCallback(() => {
    const current = tradeRef.current;
    const willBeActive = !current.active;
    setSettingsByTicker(prev => ({
      ...prev,
      [tickerRef.current]: { ...(prev[tickerRef.current] ?? DEFAULT_SETTINGS), active: willBeActive },
    }));
    addLog('info', willBeActive ? `[${tickerRef.current}] 모니터링 시작됨` : `[${tickerRef.current}] 모니터링 중지됨`);
    triggeredRef.current.clear();
    boxStatesRef.current = {};
    hlineStatesRef.current = {};
    if (willBeActive) {
      isInitializedRef.current = false;
    } else {
      setFlashes([]);
    }
  }, [addLog]);

  // ── Drawing counts (for TickerList favorites) ─────────────────────────
  const drawingCounts: Record<string, number> = {};
  Object.keys(drawingsByTicker).forEach(sym => {
    const n = drawingsByTicker[sym]?.length ?? 0;
    if (n > 0) drawingCounts[sym] = n;
  });

  // ── Export drawings to JSON file ──────────────────────────────────────
  const handleExport = useCallback(() => {
    const data = JSON.stringify(drawingsByTicker, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart-drawings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [drawingsByTicker]);

  // ── Import drawings from JSON file ────────────────────────────────────
  const handleImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string) as Record<string, Drawing[]>;
        setDrawingsByTicker(prev => ({ ...prev, ...imported }));
        addLog('info', `도형 임포트 완료 — ${Object.keys(imported).length}개 티커`);
      } catch {
        addLog('error', '임포트 실패: 올바른 JSON 파일이 아닙니다');
      }
    };
    reader.readAsText(file);
  }, [addLog]);

  // ── Board: import drawings from a shared post ─────────────────────────
  const handleBoardImport = useCallback((drawingsJson: string) => {
    try {
      const imported = JSON.parse(drawingsJson) as Record<string, Drawing[]>;
      setDrawingsByTicker(prev => ({ ...prev, ...imported }));
      addLog('info', `게시판에서 도형 가져오기 완료 — ${Object.keys(imported).length}개 티커`);
    } catch {
      addLog('error', '게시판 도형 가져오기 실패');
    }
  }, [addLog]);

  // Keyboard: Escape cancels drawing
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawingMode('none');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Multi-panel handlers ──────────────────────────────────────────────
  const handlePanelChange = useCallback((index: number, newTicker: string) => {
    setMultiPanelTickers(prev => prev.map((t, i) => i === index ? newTicker : t));
  }, []);

  const handleAddPanel = useCallback(() => {
    setMultiPanelTickers(prev => {
      if (prev.length >= 4) return prev;
      // Pick a default ticker not already in panels
      const fallback = tickers.find(t => !prev.includes(t.symbol))?.symbol ?? 'BTCUSDT';
      return [...prev, fallback];
    });
  }, [tickers]);

  const handleRemovePanel = useCallback((index: number) => {
    setMultiPanelTickers(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // ── Background monitors for non-viewed active tickers ────────────────
  const backgroundMonitors = Object.entries(settingsByTicker)
    .filter(([sym, s]) => s.active && sym !== ticker && (drawingsByTicker[sym]?.length ?? 0) > 0)
    .map(([sym, s]) => (
      <BackgroundMonitor
        key={sym}
        ticker={sym}
        drawings={drawingsByTicker[sym]}
        tradeSettings={s}
        telegramSettings={telegramSettings}
        onAddLog={addLog}
      />
    ));

  // ── AltScanner trade handlers ─────────────────────────────────────────
  const handleAltPaperTrade = useCallback((params: AltTradeParams) => {
    const balance = paperTradingRef.current.balance;
    const leverage = params.leverage ?? 10;
    const marginType = params.marginType === 'CROSSED' ? 'cross' : 'isolated';
    // For conditional trendline entry use triggerPriceAtNextClose as the effective entry for risk calc
    const isTrendlinePending =
      params.breakoutType === 'trendline' &&
      params.candidateStatus === 'PENDING' &&
      params.triggerPriceAtNextClose != null;
    const effectiveEntryPrice = isTrendlinePending ? params.triggerPriceAtNextClose! : params.entryPrice;
    let qty: number;
    if (params.sizeMode === 'margin' && params.marginUsdt != null && params.marginUsdt > 0) {
      // Margin mode: qty = marginUsdt * leverage / entryPrice
      qty = parseFloat(((params.marginUsdt * leverage) / effectiveEntryPrice).toFixed(6));
    } else {
      const riskAmount = balance * ((params.riskPct ?? 2) / 100);
      const slDistance = Math.abs(effectiveEntryPrice - params.slPrice);
      qty = slDistance > 0
        ? parseFloat((riskAmount / slDistance).toFixed(6))
        : parseFloat(((riskAmount * leverage) / effectiveEntryPrice).toFixed(6));
    }
    if (qty <= 0) return;
    // Warn if SL is beyond estimated liquidation price (isolated margin only)
    if (params.marginType === 'ISOLATED') {
      const isLong = params.direction === 'long';
      const mmr = 0.005;
      const liqPrice = isLong
        ? params.entryPrice * (1 - 1 / leverage + mmr)
        : params.entryPrice * (1 + 1 / leverage - mmr);
      const slBeyondLiq = isLong ? params.slPrice <= liqPrice : params.slPrice >= liqPrice;
      if (slBeyondLiq) {
        addLog('error', `[ALT모의] ${params.symbol} 주의: ${leverage}x 격리 기준 예상 청산가(${liqPrice.toFixed(4)})가 SL(${params.slPrice.toFixed(4)})보다 진입가에 가깝습니다 — 청산이 SL보다 먼저 발생할 수 있습니다`);
      }
    }
    // Reject if current mark price has already blown past the SL (setup invalidated)
    const mark = markPricesMapRef.current[params.symbol] ?? 0;
    if (mark > 0) {
      const isLong = params.direction === 'long';
      if (isLong && mark <= params.slPrice) {
        addLog('error', `[ALT모의] ${params.symbol} 현재가(${mark.toFixed(4)})가 SL(${params.slPrice.toFixed(4)}) 이하 — SL 이탈로 진입 불가`);
        return;
      }
      if (!isLong && mark >= params.slPrice) {
        addLog('error', `[ALT모의] ${params.symbol} 현재가(${mark.toFixed(4)})가 SL(${params.slPrice.toFixed(4)}) 이상 — SL 이탈로 진입 불가`);
        return;
      }
    }
    const altMeta: AltMeta = {
      source: 'altscanner',
      candidateId: params.candidateId,
      symbol: params.symbol,
      direction: params.direction,
      scanInterval: params.scanInterval,
      validUntilTime: params.validUntilTime,
      slPrice: params.slPrice,
      drawingsSnapshot: params.drawingsSnapshot,
    };
    const side: 'BUY' | 'SELL' = params.direction === 'long' ? 'BUY' : 'SELL';
    type TriggerType = 'limit' | 'close_above' | 'close_below';
    const triggerType: TriggerType = isTrendlinePending
      ? (params.direction === 'long' ? 'close_above' : 'close_below')
      : 'limit';
    const limitPrice = isTrendlinePending
      ? params.triggerPriceAtNextClose!
      : params.entryPrice;

    paperTradingRef.current.placeLimitOrder(
      params.symbol,
      side,
      qty,
      limitPrice,
      leverage,
      marginType,
      false,
      params.tpPrice,
      params.slPrice,
      altMeta,
      triggerType,
    );
    if (isTrendlinePending) {
      addLog('info', `[ALT모의] ${params.symbol} 조건부 진입 대기 — 다음 봉 종가 ${params.direction === 'long' ? '≥' : '≤'} ${limitPrice.toFixed(4)} 시 체결`);
    }
    handleTickerSelect(params.symbol);
    setIsPaperMode(true);
    setShowAltScanner(false);
  }, [handleTickerSelect]);

  // ── AltScanner auto-trade: convert ScanCandidate → AltTradeParams and paper-trade ──
  const handleAutoTradeScan = useCallback((c: ScanCandidate) => {
    const drawingsSnapshot = [
      ...c.drawingGroups.breakout,
      ...c.drawingGroups.topSR,
      ...c.drawingGroups.hvn,
      ...c.drawingGroups.entryLines,
    ];
    const params: AltTradeParams = {
      symbol:    c.symbol,
      direction: c.direction,
      entryPrice: c.entryPrice,
      slPrice:    c.slPrice,
      tpPrice:    c.tpPrice,
      tp1Price:   c.tp1Price,
      leverage:   3,
      marginType: 'ISOLATED',
      riskPct:    2,
      candidateId: `${c.symbol}_${c.direction}_${c.asOfCloseTime}`,
      scanInterval: c.interval,
      validUntilTime: c.validUntilTime,
      drawingsSnapshot,
      breakoutType:    c.breakoutType,
      candidateStatus: c.status,
      triggerPriceAtNextClose: c.triggerPriceAtNextClose,
      sizeMode:   'margin',
      marginUsdt: 100,
    };
    handleAltPaperTrade(params);
  }, [handleAltPaperTrade]);

  const altAutoTrade = useAltAutoTrade({
    symbols: tickers.map(t => t.symbol),
    onEnterTrade: handleAutoTradeScan,
    onLog: (msg, type) => {
      const mappedType: ActivityLog['type'] = type === 'error' ? 'error' : type === 'success' ? 'order' : 'info';
      addLog(mappedType, `[자동매매] ${msg}`);
    },
  });

  // Called whenever AltScanner updates its candidates (auto-scan result)
  // → also syncs TP/SL on existing matching paper orders/positions
  const handleAltCandidatesChange = useCallback((candidates: ScanCandidate[]) => {
    // Merge into per-interval cache (only overwrite when non-empty, preserving other intervals)
    if (candidates.length > 0) {
      const interval = candidates[0].interval;
      setAltScanCandidatesCache(prev => ({ ...prev, [interval]: candidates }));
    }
    for (const c of candidates) {
      // Update matching pending paper orders
      const orders = paperTradingRef.current.orders.filter(
        o => o.altMeta?.source === 'altscanner' &&
             o.symbol === c.symbol &&
             o.altMeta?.direction === c.direction,
      );
      for (const o of orders) {
        paperTradingRef.current.updateOrder(o.id, { tpPrice: c.tpPrice, slPrice: c.slPrice });
      }
      // Update matching open paper positions
      const positions = paperTradingRef.current.positions.filter(
        p => p.altMeta?.source === 'altscanner' &&
             p.symbol === c.symbol &&
             p.altMeta?.direction === c.direction,
      );
      for (const p of positions) {
        const isLong = p.altMeta!.direction === 'long';
        // Only apply new TP if it remains in profit territory relative to the actual entry price.
        // e.g. if market dropped below LONG entry and scanner re-anchors TP below entry, skip update.
        const safeTP = isLong
          ? (c.tpPrice > p.entryPrice ? c.tpPrice : p.tpPrice)
          : (c.tpPrice < p.entryPrice ? c.tpPrice : p.tpPrice);
        // Only apply new SL if it remains in loss territory (i.e. correct side of entry).
        const safeSL = isLong
          ? (c.slPrice < p.entryPrice ? c.slPrice : p.slPrice)
          : (c.slPrice > p.entryPrice ? c.slPrice : p.slPrice);
        paperTradingRef.current.setTPSL(p.id, safeTP, safeSL);
      }
    }
  }, []);

  const handleAltLiveTrade = useCallback(async (params: AltTradeParams) => {
    if (!binanceApiKey || !binanceApiSecret) {
      addLog('error', '[ALT실전] API 키가 설정되지 않았습니다');
      return;
    }
    const side: 'BUY' | 'SELL' = params.direction === 'long' ? 'BUY' : 'SELL';
    const closeSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';
    const leverage = params.leverage ?? 10;
    const liveMarginType: 'CROSSED' | 'ISOLATED' = params.marginType ?? 'ISOLATED';
    const balance = futuresBalanceRef.current;
    const riskAmount = balance * ((params.riskPct ?? 2) / 100);
    // For trendline PENDING: use triggerPriceAtNextClose as effective entry (binance can't do candle-close conditional)
    const isTrendlinePending =
      params.breakoutType === 'trendline' &&
      params.candidateStatus === 'PENDING' &&
      params.triggerPriceAtNextClose != null;
    const effectiveEntryPrice = isTrendlinePending ? params.triggerPriceAtNextClose! : params.entryPrice;
    const slDistance = Math.abs(effectiveEntryPrice - params.slPrice);
    const qty = slDistance > 0
      ? parseFloat((riskAmount / slDistance).toFixed(6))
      : parseFloat(((riskAmount * leverage) / effectiveEntryPrice).toFixed(6));
    if (qty <= 0) {
      addLog('error', '[ALT실전] 수량 계산 실패: 잔고 또는 SL 거리를 확인하세요');
      return;
    }

    const liveMeta: AltMeta = {
      source: 'altscanner',
      candidateId: params.candidateId,
      symbol: params.symbol,
      direction: params.direction,
      scanInterval: params.scanInterval,
      validUntilTime: params.validUntilTime,
      slPrice: params.slPrice,
      drawingsSnapshot: params.drawingsSnapshot,
    };

    if (isTrendlinePending) {
      addLog('info', `[ALT실전] ${params.symbol} 추세선 PENDING — 바이낸스 지정가 @ ${effectiveEntryPrice.toFixed(4)} (봉마감 조건부 불가, 지정가로 대체)`);
    }

    handleTickerSelect(params.symbol);
    setIsPaperMode(false);
    setShowAltScanner(false);

    try {
      await futuresPlaceOrder(side, effectiveEntryPrice, qty, leverage, liveMarginType, false, params.symbol);
      addLog('info', `[ALT실전] 진입 주문 — ${side} ${qty} ${params.symbol} @ ${effectiveEntryPrice}`);
      setLiveAltMetaMap(prev => ({ ...prev, [`${params.symbol}_${params.direction}`]: liveMeta }));
      // Register pending TP/SL — applied once the position is confirmed open via allPositions update
      const pendingKey = `${params.symbol}_${params.direction}`;
      setPendingLiveTPSLMap(prev => ({
        ...prev,
        [pendingKey]: {
          symbol: params.symbol, direction: params.direction, closeSide,
          tp: params.tpPrice, sl: params.slPrice,
          plannedQty: qty, createdAt: Date.now(),
        },
      }));
      addLog('info', `[ALT실전] TP/SL 대기 등록 — 포지션 확인 후 자동 적용`);
    } catch (e) {
      addLog('error', `[ALT실전] 진입 실패: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }, [handleTickerSelect, addLog, futuresPlaceOrder, binanceApiKey, binanceApiSecret]);

  // ── Pending live TP/SL processor ─────────────────────────────────────
  // Stable ref so the effect doesn't re-subscribe when futuresPlaceTPSL identity changes
  const futuresPlaceTPSLRef = useRef(futuresPlaceTPSL);
  futuresPlaceTPSLRef.current = futuresPlaceTPSL;

  React.useEffect(() => {
    const pending = Object.entries(pendingLiveTPSLMap);
    if (pending.length === 0) return;
    const EXPIRE_MS = 15 * 60 * 1000;
    const now = Date.now();
    for (const [key, entry] of pending) {
      // Discard entries older than 15 minutes
      if (now - entry.createdAt > EXPIRE_MS) {
        addLog('error', `[ALT실전] TP/SL 대기 만료(15분) — ${entry.symbol} 수동 설정 필요`);
        setPendingLiveTPSLMap(prev => { const n = { ...prev }; delete n[key]; return n; });
        continue;
      }
      if (inFlightTPSLRef.current.has(key)) continue;
      // Check if a matching position is now open
      const pos = futuresAllPositions.find(p =>
        p.symbol === entry.symbol &&
        Math.abs(p.positionAmt) > 0 &&
        (entry.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
      );
      if (!pos) continue;
      const actualQty = Math.abs(pos.positionAmt);
      inFlightTPSLRef.current.add(key);
      futuresPlaceTPSLRef.current(entry.symbol, entry.closeSide, actualQty, entry.tp, entry.sl)
        .then(() => {
          addLog('info', `[ALT실전] TP/SL 등록 완료 — ${entry.symbol} qty:${actualQty} TP:${entry.tp ?? '—'} SL:${entry.sl ?? '—'}`);
          setPendingLiveTPSLMap(prev => { const n = { ...prev }; delete n[key]; return n; });
        })
        .catch((e: unknown) => {
          addLog('error', `[ALT실전] TP/SL 실패: ${e instanceof Error ? e.message : 'unknown'}`);
        })
        .finally(() => { inFlightTPSLRef.current.delete(key); });
    }
  }, [futuresAllPositions, pendingLiveTPSLMap, addLog]);

  // ── ALT position badge click: open AltScanner modal in snapshot view ─
  const handleOpenAltPosition = useCallback((meta: AltMeta) => {
    setAltScannerSnapshotMeta(meta);
    setShowAltScanner(true);
  }, []);

  // ── Mobile panel close helper ─────────────────────────────────────────
  const handleTickerSelectMobile = useCallback((symbol: string) => {
    handleTickerSelect(symbol);
    setMobilePanel('none');
  }, [handleTickerSelect]);

  // ── AltPositionMonitor: auto-close on time-stop / structural break ────
  const altMonitors = isPaperMode
    ? paperTrading.positions
        .filter(p => p.altMeta)
        .map(p => (
          <AltPositionMonitor
            key={p.id}
            meta={p.altMeta!}
            onClose={(price, reason) => {
              setDrawingsByTicker(prev => ({ ...prev, [p.symbol]: [] }));
              paperTrading.closePosition(p.id, price, reason);
            }}
          />
        ))
    : Object.entries(liveAltMetaMap).flatMap(([key, meta]) => {
        const pos = futuresAllPositions.find(p =>
          p.symbol === meta.symbol &&
          Math.abs(p.positionAmt) > 0 &&
          (meta.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
        );
        if (!pos) return [];
        return [(
          <LiveAltPositionMonitor
            key={key}
            meta={meta}
            positionSide={pos.positionSide}
            qty={Math.abs(pos.positionAmt)}
            onCloseMarket={(symbol, closeSide, qty, positionSide, reason) => {
              addLog('info', `[ALT실전] ${symbol} 자동청산 (${reason === 'time-stop' ? '타임스탑' : '구조적 무효화'}) — MARKET ${closeSide} ${qty}`);
              futuresCloseMarket(symbol, closeSide, qty, positionSide)
                .then(() => {
                  addLog('info', `[ALT실전] ${symbol} 청산 완료`);
                  setLiveAltMetaMap(prev => { const n = { ...prev }; delete n[key]; return n; });
                })
                .catch((e: unknown) => {
                  addLog('error', `[ALT실전] ${symbol} 청산 실패: ${e instanceof Error ? e.message : 'unknown'}`);
                });
            }}
          />
        )];
      });

  return (
    <div style={styles.root}>
      {backgroundMonitors}
      {altMonitors}

      {/* ── Mobile overlays ─────────────────────────────────────────── */}
      {isMobile && mobilePanel !== 'none' && (
        <div style={styles.mobileOverlay}>
          <div style={styles.mobileOverlayHeader}>
            <span style={styles.mobileOverlayTitle}>
              {mobilePanel === 'tickers' ? '종목 선택' : '설정 / 로그'}
            </span>
            <button style={styles.mobileCloseBtn} onClick={() => setMobilePanel('none')}>✕ 닫기</button>
          </div>
          <div style={styles.mobileOverlayBody}>
            {mobilePanel === 'tickers' && (
              <TickerList
                tickers={tickers}
                loading={tickersLoading}
                selected={ticker}
                onSelect={handleTickerSelectMobile}
                drawingCounts={drawingCounts}
                width={window.innerWidth}
              />
            )}
            {mobilePanel === 'settings' && (
              <RightPanel
                drawings={currentDrawings}
                selectedDrawingId={selectedDrawingId}
                onSelectDrawing={setSelectedDrawingId}
                onDeleteDrawing={(id) => {
                  deleteDrawingFnRef.current?.(id);
                  if (selectedDrawingId === id) setSelectedDrawingId(null);
                }}
                tradeSettings={tradeSettings}
                onTradeSettingsChange={handleTradeSettingsChange}
                onActivate={handleActivate}
                logs={logs}
                telegramSettings={telegramSettings}
                onTelegramSettingsChange={setTelegramSettings}
                onExport={handleExport}
                onImport={handleImport}
                onUpdateMemo={(id, memo) => updateMemoFnRef.current?.(id, memo)}
                onUpdateColor={(id, color) => updateColorFnRef.current?.(id, color)}
                onUpdateActive={(id, active) => updateActiveFnRef.current?.(id, active)}
                binanceApiKey={binanceApiKey}
                binanceApiSecret={binanceApiSecret}
                onSaveApiKeys={handleSaveApiKeys}
                onClearApiKeys={handleClearApiKeys}
                futuresLoading={futuresLoading}
                futuresError={futuresError}
                futuresPositions={isPaperMode
                  ? paperTrading.toFuturesPositions({ ...markPricesMapRef.current, [ticker]: currentPrice ?? 0 })
                  : futuresPositions}
                futuresOrders={isPaperMode ? paperOrdersAsFutures : futuresOrders}
                width={window.innerWidth}
                currentUser={CURRENT_USER ?? ''}
                onLogout={handleLogout}
                ticker={ticker}
                currentPrice={currentPrice}
                availableUsdt={isPaperMode ? paperTrading.balance : futuresBalance}
                onPlaceOrder={isPaperMode ? paperPlaceOrder : futuresPlaceOrder}
                onCancelOrder={isPaperMode ? paperCancelOrder : futuresCancelOrder}
                onLimitPriceChange={setOrderTargetPrice}
                conditionalOrders={conditionalOrders.filter(co => co.ticker === ticker)}
                onAddConditionalOrder={handleAddConditionalOrder}
                onRemoveConditionalOrder={handleRemoveConditionalOrder}
                onConditionalDrawingHighlight={handleConditionalDrawingHighlight}
                onConditionalPriceChange={setConditionalFormPrices}
              />
            )}
          </div>
        </div>
      )}

      <TickerHeader ticker={ticker} stats={stats} currentPrice={currentPrice} />
      <Toolbar
        interval={interval}
        onIntervalChange={handleIntervalChange}
        drawingMode={drawingMode}
        onDrawingModeChange={setDrawingMode}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        activeColor={activeColor}
        onActiveColorChange={setActiveColor}
        isMultiMode={isMultiMode}
        onToggleMultiMode={() => setIsMultiMode(v => !v)}
        isPaperMode={isPaperMode}
        onTogglePaperMode={() => setIsPaperMode(v => !v)}
        indicators={indicators}
        onToggleIndicator={handleToggleIndicator}
        onOpenBoard={() => setShowBoard(true)}
        onOpenUserBoard={() => setShowUserBoard(true)}
        onOpenSecurityFaq={() => setShowSecurityFaq(true)}
        onOpenAltScanner={() => { setAltScannerSnapshotMeta(undefined); setShowAltScanner(true); }}
        isAutoTradeActive={altAutoTrade.isActive}
        autoTradeScanning={altAutoTrade.scanning}
        onToggleAutoTrade={() => altAutoTrade.setActive(!altAutoTrade.isActive)}
        onTriggerAutoTradeNow={altAutoTrade.triggerNow}
        isMobile={isMobile}
        mobilePanel={mobilePanel}
        onToggleMobilePanel={(panel) => setMobilePanel(p => p === panel ? 'none' : panel)}
      />

      {showBoard && (
        <BoardModal
          currentUser={CURRENT_USER ?? ''}
          onImport={handleBoardImport}
          onClose={() => setShowBoard(false)}
        />
      )}

      {showUserBoard && (
        <UserBoardModal
          currentUser={CURRENT_USER ?? ''}
          onClose={() => setShowUserBoard(false)}
        />
      )}

      {showDisclaimer && (
        <DisclaimerModal onAgree={() => setShowDisclaimer(false)} />
      )}

      {showSecurityFaq && (
        <SecurityFaqModal onClose={() => setShowSecurityFaq(false)} />
      )}

      {showAltScanner && (
        <AltScannerModal
          symbols={tickers.map(t => t.symbol)}
          initialCandidates={Object.values(altScanCandidatesCache).flat()}
          onCandidatesChange={handleAltCandidatesChange}
          onClose={() => setShowAltScanner(false)}
          onOpenInMain={(symbol) => {
            handleTickerSelect(symbol);
            if (altScannerSnapshotMeta?.symbol === symbol) {
              setDrawingsByTicker(prev => ({ ...prev, [symbol]: altScannerSnapshotMeta.drawingsSnapshot }));
            }
          }}
          onPaperTrade={handleAltPaperTrade}
          onLiveTrade={handleAltLiveTrade}
          snapshotMeta={altScannerSnapshotMeta}
          paperBalance={paperTrading.balance}
        />
      )}

      {/* Risk warning ticker banner */}
      <div style={{
        background: 'rgba(239,83,80,0.08)',
        borderBottom: '1px solid rgba(239,83,80,0.25)',
        flexShrink: 0,
        overflow: 'hidden',
        padding: '4px 0',
        position: 'relative',
      }}>
        <style>{`
          @keyframes riskTicker {
            0%   { transform: translateX(100vw); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
        <span style={{
          animation: 'riskTicker 28s linear infinite',
          color: '#ef9a9a',
          display: 'inline-block',
          fontSize: '0.75rem',
          whiteSpace: 'nowrap',
        }}>
          ⚠ 선물/레버리지 거래는 원금 손실을 초과하는 손실이 발생할 수 있습니다.&nbsp;&nbsp;&nbsp;본 서비스는 투자 조언을 제공하지 않으며, 모든 투자 결정의 책임은 이용자 본인에게 있습니다.&nbsp;&nbsp;&nbsp;⚠ Futures/leveraged trading can result in losses exceeding your principal. This service does not provide investment advice.
        </span>
      </div>

      <div style={styles.main}>
        {!isMobile && (
          <TickerList
            tickers={tickers}
            loading={tickersLoading}
            selected={ticker}
            onSelect={handleTickerSelect}
            drawingCounts={drawingCounts}
            width={leftWidth}
          />
        )}
        {!isMobile && <ResizeDivider onDelta={d => setLeftWidth(w => Math.max(80, Math.min(400, w + d)))} />}

        <div style={styles.chartArea}>
          {isMultiMode ? (
            <MultiChartView
              panels={multiPanelTickers}
              tickers={tickers}
              drawingsByTicker={drawingsByTicker}
              settingsByTicker={settingsByTicker}
              telegramSettings={telegramSettings}
              onAddLog={addLog}
              onPanelChange={handlePanelChange}
              onAddPanel={handleAddPanel}
              onRemovePanel={handleRemovePanel}
            />
          ) : (
            <>
              {error && <div style={styles.error}>API 오류: {error}</div>}
              {loading && candles.length === 0 && (
                <div style={styles.loadingOverlay}>로딩 중...</div>
              )}
              <CandleChart
                key={ticker}
                candles={candles}
                interval={interval}
                ticker={ticker}
                drawingMode={drawingMode}
                setDrawingMode={setDrawingMode}
                onDrawingsChange={handleDrawingsChange}
                selectedDrawingId={selectedDrawingId}
                onSetDeleteFn={(fn) => { deleteDrawingFnRef.current = fn; }}
                onSetUpdateMemoFn={(fn) => { updateMemoFnRef.current = fn; }}
                onSetUpdateColorFn={(fn) => { updateColorFnRef.current = fn; }}
                onSetUpdateActiveFn={(fn) => { updateActiveFnRef.current = fn; }}
                activeColor={activeColor}
                flashes={flashes}
                initialDrawings={currentDrawings}
                positions={futuresPositions}
                orders={futuresOrders}
                orderTargetPrice={orderTargetPrice}
                highlightedDrawingPrice={highlightedDrawingPrice}
                conditionalFormPrices={conditionalFormPrices}
                indicators={indicators}
              />
            </>
          )}
        </div>

        {!isMobile && <ResizeDivider onDelta={d => setRightWidth(w => Math.max(160, Math.min(500, w - d)))} />}
        {!isMobile && (
          <RightPanel
            drawings={currentDrawings}
            selectedDrawingId={selectedDrawingId}
            onSelectDrawing={setSelectedDrawingId}
            onDeleteDrawing={(id) => {
              deleteDrawingFnRef.current?.(id);
              if (selectedDrawingId === id) setSelectedDrawingId(null);
            }}
            tradeSettings={tradeSettings}
            onTradeSettingsChange={handleTradeSettingsChange}
            onActivate={handleActivate}
            logs={logs}
            telegramSettings={telegramSettings}
            onTelegramSettingsChange={setTelegramSettings}
            onExport={handleExport}
            onImport={handleImport}
            onUpdateMemo={(id, memo) => updateMemoFnRef.current?.(id, memo)}
            onUpdateColor={(id, color) => updateColorFnRef.current?.(id, color)}
            onUpdateActive={(id, active) => updateActiveFnRef.current?.(id, active)}
            binanceApiKey={binanceApiKey}
            binanceApiSecret={binanceApiSecret}
            onSaveApiKeys={handleSaveApiKeys}
            onClearApiKeys={handleClearApiKeys}
            futuresLoading={futuresLoading}
            futuresError={futuresError}
            futuresPositions={isPaperMode
              ? paperTrading.toFuturesPositions({ ...markPricesMapRef.current, [ticker]: currentPrice ?? 0 })
              : futuresPositions}
            futuresOrders={isPaperMode ? paperOrdersAsFutures : futuresOrders}
            width={rightWidth}
            currentUser={CURRENT_USER ?? ''}
            onLogout={handleLogout}
            ticker={ticker}
            currentPrice={currentPrice}
            availableUsdt={isPaperMode ? paperTrading.balance : futuresBalance}
            onPlaceOrder={isPaperMode ? paperPlaceOrder : futuresPlaceOrder}
            onCancelOrder={isPaperMode ? paperCancelOrder : futuresCancelOrder}
            onLimitPriceChange={setOrderTargetPrice}
            conditionalOrders={conditionalOrders.filter(co => co.ticker === ticker)}
            onAddConditionalOrder={handleAddConditionalOrder}
            onRemoveConditionalOrder={handleRemoveConditionalOrder}
            onConditionalDrawingHighlight={handleConditionalDrawingHighlight}
            onConditionalPriceChange={setConditionalFormPrices}
          />
        )}
      </div>

      {!isMobile && (
        <BottomPanel
          allPositions={futuresAllPositions}
          allOrders={futuresAllOrders}
          onCancelOrder={futuresCancelOrder}
          onPlaceTPSL={futuresPlaceTPSL}
          onSelectTicker={handleTickerSelect}
          height={bottomHeight}
          onHeightChange={delta => setBottomHeight(h => Math.max(80, Math.min(500, h + delta)))}
          clientSlMap={futuresClientSlMap}
          onRemoveClientSL={futuresRemoveClientSL}
          isPaperMode={isPaperMode}
          paperPositions={isPaperMode ? paperTrading.toFuturesPositions({ ...markPricesMapRef.current, [ticker]: currentPrice ?? 0 }) : undefined}
          paperRawPositions={isPaperMode ? paperTrading.positions : undefined}
          paperBalance={paperTrading.balance}
          paperInitialBalance={paperTrading.initialBalance}
          paperOrders={isPaperMode ? paperTrading.orders : undefined}
          paperHistory={paperTrading.history}
          onPaperCancelOrder={paperTrading.cancelOrder}
          onPaperClosePosition={(entryTime) => {
            const raw = paperTrading.positions.find(p => p.entryTime === entryTime);
            if (raw) {
              if (raw.altMeta) setDrawingsByTicker(prev => ({ ...prev, [raw.symbol]: [] }));
              paperTrading.closePosition(raw.id, markPricesMapRef.current[raw.symbol] ?? currentPrice ?? 0, 'manual');
            }
          }}
          onPaperSetTPSL={(entryTime, tp, sl) => {
            const raw = paperTrading.positions.find(p => p.entryTime === entryTime);
            if (raw) paperTrading.setTPSL(raw.id, tp, sl);
          }}
          onPaperResetBalance={paperTrading.resetBalance}
          onPaperClearHistory={paperTrading.clearHistory}
          onOpenAltPosition={handleOpenAltPosition}
          liveAltMetaMap={liveAltMetaMap}
          liveHistory={liveHistory}
          onFetchLiveHistory={fetchLiveHistory}
        />
      )}
    </div>
  );
}

/** Guard: shows LoginPage when no user is logged in, otherwise renders the full app. */
export default function App() {
  if (!CURRENT_USER) return <LoginPage />;
  return <AppInner />;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#131722',
    color: '#d1d4dc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '1rem',
    overflow: 'hidden',
    userSelect: 'none',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
  },
  chartArea: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  error: {
    background: 'rgba(240,66,92,0.1)',
    border: '1px solid rgba(240,66,92,0.3)',
    borderRadius: 4,
    color: '#f0425c',
    fontSize: '0.92rem',
    padding: '8px 12px',
    margin: 8,
  },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4a5568',
    fontSize: '1.08rem',
    zIndex: 10,
    pointerEvents: 'none',
  },
  // ── Mobile overlay ─────────────────────────────────────────────────────
  mobileOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    background: '#131722',
    display: 'flex',
    flexDirection: 'column',
  },
  mobileOverlayHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#1e222d',
    borderBottom: '1px solid #2a2e39',
    padding: '10px 16px',
    flexShrink: 0,
  },
  mobileOverlayTitle: {
    color: '#d1d4dc',
    fontSize: '1rem',
    fontWeight: 600,
  },
  mobileCloseBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 6,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    padding: '6px 12px',
    fontFamily: 'inherit',
  },
  mobileOverlayBody: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  // ── Mobile floating tabs ───────────────────────────────────────────────
  mobileTabs: {
    position: 'absolute',
    bottom: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 8,
    zIndex: 100,
    background: 'rgba(19,23,34,0.85)',
    backdropFilter: 'blur(6px)',
    borderRadius: 24,
    padding: '6px 10px',
    border: '1px solid #2a2e39',
  },
  mobileTabBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 18,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.88rem',
    fontWeight: 500,
    padding: '7px 18px',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  mobileTabActive: {
    background: 'rgba(59,139,235,0.15)',
    borderColor: '#3b8beb',
    color: '#3b8beb',
  },
};
