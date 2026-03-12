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
import { useBinanceFutures, getPositionMode } from './hooks/useBinanceFutures';
import type { PlacedTPSLOrderRef } from './hooks/useBinanceFutures';
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
import { runBreakoutScan } from './components/AltScanner/breakoutScanner';
import type { ScanCandidate, ScanInterval } from './components/AltScanner/breakoutScanner';
import type { FuturesUserTrade, LiveCloseReason, LiveTradeHistoryEntry } from './types/futures';
import { intervalToMs } from './components/AltScanner/timeUtils';
import { AltPositionMonitor, LiveAltPositionMonitor } from './components/AltScanner/AltPositionMonitor';
import type { TimeStopRequestPayload } from './components/AltScanner/AltPositionMonitor';
import { TimeStopDecisionModal } from './components/AltScanner/TimeStopDecisionModal';
import type { AltMeta } from './types/paperTrading';
import { useAltAutoTrade } from './hooks/useAltAutoTrade';
import { useSoundPlayer } from './hooks/useSoundPlayer';
import { SoundSettingsModal } from './components/SoundSettingsModal';
import { AutoTradeSettingsModal, DEFAULT_AUTO_TRADE_SETTINGS, DEFAULT_LIVE_AUTO_TRADE_SETTINGS } from './components/AutoTradeSettingsModal';
import type { AutoTradeSettings } from './components/AutoTradeSettingsModal';
import { db, isFirebaseConfigured } from './lib/firebase';
import { doc, onSnapshot, runTransaction } from 'firebase/firestore';

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

function coinLabel(symbol: string): string {
  return symbol.replace(/USDT$/i, '');
}

function leverageSpeech(leverage: number): string {
  if (!Number.isFinite(leverage)) return '1';
  const rounded = Math.round(leverage * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

const LIVE_MARGIN_BAL_HISTORY_KEY = 'live-futures-margin-balance-history';
const AUTO_TRADE_LEADER_LOCK_COLLECTION = 'auto_trade_leader_locks';
const AUTO_TRADE_LEADER_LEASE_MS = 35_000;
const AUTO_TRADE_LEADER_HEARTBEAT_MS = 10_000;

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
  entryOrderId?: string;
  entryOrderStatus?: string;
  entrySubmittedAt?: number;
  positionOpenedAt?: number;
}

interface LiveAltOrderRegistryEntry {
  symbol: string;
  direction: 'long' | 'short';
  closeSide: 'BUY' | 'SELL';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  orders: PlacedTPSLOrderRef[];
  entryOrderId?: string;
  entrySubmittedAt?: number;
  updatedAt: number;
}

interface LiveTrackedAltPosition {
  symbol: string;
  direction: 'long' | 'short';
  qty: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  entryTime?: number;
  seenOpen: boolean;
}

interface LiveCloseMetaSnapshot {
  meta: AltMeta;
  tracked?: {
    qty: number;
    entryPrice: number;
    leverage: number;
    positionSide: 'LONG' | 'SHORT' | 'BOTH';
    entryTime?: number;
  };
  capturedAt: number;
}

interface LiveBalancePoint {
  time: number;
  balance: number;
}

interface TimeStopEvalResult {
  status: 'loading' | 'done';
  summaryText: string;
  flipSuggested?: boolean;
  candidateScore?: number;
  newSl?: number;
  newTp?: number;
  tightenOk?: boolean;
}

interface TimeStopRequestEntry {
  key: string;
  mode: 'paper' | 'live';
  symbol: string;
  direction: 'long' | 'short';
  scanInterval: Interval;
  candidateId: string;
  closeSide: 'BUY' | 'SELL';
  qty: number;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  paperPosId?: string;
  liveMetaKey?: string;
  entryPrice: number;
  currentTp?: number | null;
  currentSl: number;
  lastClosePrice: number;
  requestedAt: number;
  deadlineAt: number;
  state: 'pending' | 'closing';
  eval: TimeStopEvalResult;
  actionError?: string;
}

interface LiveEntryFillRetryState {
  attempts: number;
  nextAt: number;
  deadlineAt: number;
  running?: boolean;
}

interface LiveHistoryEnrichTask {
  rowId: string;
  meta: AltMeta;
  tracked: LiveTrackedAltPosition;
  exitTime: number;
  reasonSource: 'explicit' | 'order' | 'fallback';
  attempts: number;
  nextAt: number;
  deadlineAt: number;
  running?: boolean;
}

const DEFAULT_SETTINGS: TradeSettings = {
  leverage: 10,
  marginPct: 5,
  direction: 'both',
  executionMode: 'alert',
  active: false,
};

const CHART_INTERVALS: readonly Interval[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];
const ALT_DRAWING_PREFIX = 'altm:';
const altCandidatePrefix = (candidateId: string) => `${ALT_DRAWING_PREFIX}${candidateId}:`;
const buildAltManagedDrawingId = (candidateId: string, sourceId: string, idx: number) =>
  `${altCandidatePrefix(candidateId)}${sourceId || String(idx)}`;
const isAltManagedDrawingForCandidate = (drawingId: string, candidateId: string) =>
  drawingId.startsWith(altCandidatePrefix(candidateId));
const normalizeAutoTradeCadence = (v?: number) => Math.max(15, Math.round(v ?? 60));
const normalizeAutoTradeTimeStop = (v?: boolean) => v !== false;
const normalizeAutoTradeVoiceAlert = (v?: boolean) => v !== false;
const normalizeAutoTradeSettings = (base: AutoTradeSettings, saved: Partial<AutoTradeSettings> | null | undefined): AutoTradeSettings => ({
  ...base,
  ...(saved ?? {}),
  scanCadenceMinutes: normalizeAutoTradeCadence(saved?.scanCadenceMinutes ?? base.scanCadenceMinutes),
  timeStopEnabled: normalizeAutoTradeTimeStop(saved?.timeStopEnabled ?? base.timeStopEnabled),
  voiceAlertEnabled: normalizeAutoTradeVoiceAlert(saved?.voiceAlertEnabled ?? base.voiceAlertEnabled),
});

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
  const [showSoundSettings, setShowSoundSettings] = useState(false);

  // Sound player — exposes playBuy / playSell called at trade execution points
  const soundPlayer = useSoundPlayer();
  const playEntrySound = soundPlayer.playEntry;
  const playTpSound = soundPlayer.playTp;
  const playSlSound = soundPlayer.playSl;
  const speakSound = soundPlayer.speak;

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
  const liveAltMetaMapRef = useRef<Record<string, AltMeta>>(liveAltMetaMap);
  liveAltMetaMapRef.current = liveAltMetaMap;
  // In-flight guard: synchronously blocks duplicate live orders during async getPositionMode/futuresPlaceOrder gap
  const liveInFlightRef = useRef<Set<string>>(new Set());
  React.useEffect(() => {
    try { localStorage.setItem(uk('live-alt-meta'), JSON.stringify(liveAltMetaMap)); } catch {}
  }, [liveAltMetaMap]);
  // Close-click snapshot map: preserves ALT metadata for history even if liveAltMetaMap is cleaned early.
  const [liveCloseMetaSnapshotMap, setLiveCloseMetaSnapshotMap] = useState<Record<string, LiveCloseMetaSnapshot>>(() => {
    try { return JSON.parse(localStorage.getItem(uk('live-close-meta-snapshot-map')) ?? '{}'); } catch { return {}; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('live-close-meta-snapshot-map'), JSON.stringify(liveCloseMetaSnapshotMap)); } catch {}
  }, [liveCloseMetaSnapshotMap]);

  // Pending live TP/SL: placed after entry order fills (persisted across reload)
  const [pendingLiveTPSLMap, setPendingLiveTPSLMap] = useState<Record<string, PendingLiveTPSL>>(() => {
    try { return JSON.parse(localStorage.getItem(uk('pending-live-tpsl')) ?? '{}'); } catch { return {}; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('pending-live-tpsl'), JSON.stringify(pendingLiveTPSLMap)); } catch {}
  }, [pendingLiveTPSLMap]);
  const [liveAltOrderRegistry, setLiveAltOrderRegistry] = useState<Record<string, LiveAltOrderRegistryEntry>>(() => {
    try { return JSON.parse(localStorage.getItem(uk('live-alt-order-registry')) ?? '{}'); } catch { return {}; }
  });
  const liveAltOrderRegistryRef = useRef<Record<string, LiveAltOrderRegistryEntry>>(liveAltOrderRegistry);
  liveAltOrderRegistryRef.current = liveAltOrderRegistry;
  React.useEffect(() => {
    try { localStorage.setItem(uk('live-alt-order-registry'), JSON.stringify(liveAltOrderRegistry)); } catch {}
  }, [liveAltOrderRegistry]);
  const inFlightTPSLRef = useRef(new Set<string>());
  const [timeStopRequests, setTimeStopRequests] = useState<Record<string, TimeStopRequestEntry>>({});
  const timeStopRequestsRef = useRef<Record<string, TimeStopRequestEntry>>(timeStopRequests);
  timeStopRequestsRef.current = timeStopRequests;
  const [timeStopNowMs, setTimeStopNowMs] = useState(() => Date.now());
  const [hiddenTimeStopKeys, setHiddenTimeStopKeys] = useState<Record<string, true>>({});
  const timeStopWarnedRef = useRef<Record<string, number>>({});
  React.useEffect(() => {
    if (Object.keys(timeStopRequests).length === 0) return;
    const id = window.setInterval(() => setTimeStopNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timeStopRequests]);
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

  // ── Auto trade settings (persisted) ─────────────────────────────────
  // ── Auto trade settings: paper and live are independent ─────────────
  const [paperAutoTradeSettings, setPaperAutoTradeSettings] = useState<AutoTradeSettings>(() => {
    try {
      const legacy = localStorage.getItem(uk('alt_auto_trade_settings'));
      const saved = JSON.parse(localStorage.getItem(uk('alt_auto_trade_settings_paper')) ?? legacy ?? 'null');
      return normalizeAutoTradeSettings(DEFAULT_AUTO_TRADE_SETTINGS, saved);
    } catch { return normalizeAutoTradeSettings(DEFAULT_AUTO_TRADE_SETTINGS, null); }
  });
  const paperAutoTradeSettingsRef = useRef<AutoTradeSettings>(paperAutoTradeSettings);
  paperAutoTradeSettingsRef.current = paperAutoTradeSettings;
  React.useEffect(() => {
    try { localStorage.setItem(uk('alt_auto_trade_settings_paper'), JSON.stringify(paperAutoTradeSettings)); } catch {}
  }, [paperAutoTradeSettings]);

  const [liveAutoTradeSettings, setLiveAutoTradeSettings] = useState<AutoTradeSettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(uk('alt_auto_trade_settings_live')) ?? 'null');
      return normalizeAutoTradeSettings(DEFAULT_LIVE_AUTO_TRADE_SETTINGS, saved);
    } catch { return normalizeAutoTradeSettings(DEFAULT_LIVE_AUTO_TRADE_SETTINGS, null); }
  });
  const liveAutoTradeSettingsRef = useRef<AutoTradeSettings>(liveAutoTradeSettings);
  liveAutoTradeSettingsRef.current = liveAutoTradeSettings;
  React.useEffect(() => {
    try { localStorage.setItem(uk('alt_auto_trade_settings_live'), JSON.stringify(liveAutoTradeSettings)); } catch {}
  }, [liveAutoTradeSettings]);

  const [showAutoTradeSettings, setShowAutoTradeSettings] = useState(false);

  // ── Auto trade mode (paper / live) ──────────────────────────────────
  const [autoTradeMode, setAutoTradeMode] = useState<'paper' | 'live'>(() => {
    try { return (localStorage.getItem(uk('alt_auto_trade_mode')) as 'paper' | 'live') ?? 'paper'; } catch { return 'paper'; }
  });
  const autoTradeModeRef = useRef<'paper' | 'live'>(autoTradeMode);
  autoTradeModeRef.current = autoTradeMode;
  React.useEffect(() => {
    try { localStorage.setItem(uk('alt_auto_trade_mode'), autoTradeMode); } catch {}
  }, [autoTradeMode]);
  const autoTradeLeaderSessionIdRef = useRef(`leader_${Math.random().toString(36).slice(2, 10)}`);
  const autoTradeLeaderLockDocRef = useRef(
    CURRENT_USER && isFirebaseConfigured()
      ? doc(db, AUTO_TRADE_LEADER_LOCK_COLLECTION, encodeURIComponent(CURRENT_USER))
      : null,
  );
  const [autoTradeLeaderNotice, setAutoTradeLeaderNotice] = useState<string | null>(null);
  const autoTradeBlockedByRef = useRef<string | null>(null);

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
  const { candles, setCandles, loading, error, refetch: refetchCandles } = useBinanceKlines(ticker, interval);
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

    // Paper trading: update price map and check TP/SL/liquidation on every tick.
    // Always update the mark price and call checkPrices — it is a no-op when there
    // are no paper positions, and altMeta paper positions must be monitored even
    // when the user is in live mode (isPaperMode may be false).
    markPricesMapRef.current[tickerRef.current] = candle.close;
    paperTradingRef.current.checkPrices(markPricesMapRef.current);

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
            soundPlayer.playEntry();
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
              soundPlayer.playEntry();
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
    marginBalance: futuresMarginBalance,
    loading: futuresLoading,
    error: futuresError,
    refetch: futuresRefetch,
    placeOrder: futuresPlaceOrder,
    cancelOrder: futuresCancelOrder,
    placeTPSL: futuresPlaceTPSL,
    closeMarket: futuresCloseMarket,
    clientSlMap: futuresClientSlMap,
    recentClientSlTriggerMap: futuresRecentClientSlTriggerMap,
    removeClientSL: futuresRemoveClientSL,
    fetchUserTrades: futuresFetchUserTrades,
  } = useBinanceFutures(binanceApiKey, binanceApiSecret, ticker);
  const futuresAllPositionsRef = useRef(futuresAllPositions);
  futuresAllPositionsRef.current = futuresAllPositions;
  const futuresAllOrdersRef = useRef(futuresAllOrders);
  futuresAllOrdersRef.current = futuresAllOrders;

  // ── Live trading history ──────────────────────────────────────────────
  const [liveHistory, setLiveHistory] = useState<LiveTradeHistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(uk('live-trade-history')) ?? '[]') as LiveTradeHistoryEntry[]; }
    catch { return []; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk('live-trade-history'), JSON.stringify(liveHistory)); } catch {}
  }, [liveHistory]);
  const liveHistoryRef = useRef<LiveTradeHistoryEntry[]>(liveHistory);
  liveHistoryRef.current = liveHistory;
  const liveCloseSoundSeenRef = useRef<Set<string>>(new Set(liveHistory.map(row => row.id)));
  React.useEffect(() => {
    const seen = liveCloseSoundSeenRef.current;
    for (const row of liveHistory) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if ((row.pnl ?? 0) > 0) playTpSound();
      else if ((row.pnl ?? 0) < 0) playSlSound();
    }
  }, [liveHistory, playTpSound, playSlSound]);
  const [liveBalanceHistory, setLiveBalanceHistory] = useState<LiveBalancePoint[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(uk(LIVE_MARGIN_BAL_HISTORY_KEY)) ?? '[]') as LiveBalancePoint[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(p => isFinite(p?.time) && isFinite(p?.balance) && p.balance > 0);
    }
    catch { return []; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(uk(LIVE_MARGIN_BAL_HISTORY_KEY), JSON.stringify(liveBalanceHistory)); } catch {}
  }, [liveBalanceHistory]);
  React.useEffect(() => {
    if (!binanceApiKey || !binanceApiSecret) return;
    if (!isFinite(futuresMarginBalance) || futuresMarginBalance <= 0) return;
    const now = Date.now();
    setLiveBalanceHistory(prev => {
      const last = prev[prev.length - 1];
      // 샘플링 간격/변화량 기준으로 중복 완화
      if (last) {
        const dt = now - last.time;
        const dv = Math.abs(last.balance - futuresMarginBalance);
        if (dt < 25_000 && dv < 0.01) return prev;
      }
      const next = [...prev, { time: now, balance: futuresMarginBalance }];
      return next.slice(-4000);
    });
  }, [futuresMarginBalance, binanceApiKey, binanceApiSecret]);
  const liveTrackedRef = useRef<Record<string, LiveTrackedAltPosition>>({});
  const liveCloseReasonHintRef = useRef<Record<string, LiveCloseReason>>({});
  const liveEntryFillRetryRef = useRef<Record<string, LiveEntryFillRetryState>>({});
  const liveHistoryEnrichQueueRef = useRef<Record<string, LiveHistoryEnrichTask>>({});
  const liveAltOrderTagMap = React.useMemo(() => {
    const out: Record<string, 'ALT-AUTO TP' | 'ALT-AUTO SL'> = {};
    for (const entry of Object.values(liveAltOrderRegistry)) {
      for (const ord of entry.orders) {
        out[ord.orderId] = ord.kind === 'TP' ? 'ALT-AUTO TP' : 'ALT-AUTO SL';
      }
    }
    return out;
  }, [liveAltOrderRegistry]);
  const liveAltEntryOrderTagMap = React.useMemo(() => {
    const out: Record<string, true> = {};
    for (const entry of Object.values(liveAltOrderRegistry)) {
      if (entry.entryOrderId) out[entry.entryOrderId] = true;
    }
    return out;
  }, [liveAltOrderRegistry]);

  const upsertLiveAltOrderRegistry = useCallback((
    liveKey: string,
    symbol: string,
    direction: 'long' | 'short',
    closeSide: 'BUY' | 'SELL',
    positionSide: 'LONG' | 'SHORT' | 'BOTH',
    refs: PlacedTPSLOrderRef[],
  ) => {
    const dedup = Array.from(new Map(refs.map(r => [r.orderId, r])).values());
    setLiveAltOrderRegistry(prev => ({
      ...prev,
      [liveKey]: {
        symbol,
        direction,
        closeSide,
        positionSide,
        orders: dedup,
        entryOrderId: prev[liveKey]?.entryOrderId,
        entrySubmittedAt: prev[liveKey]?.entrySubmittedAt,
        updatedAt: Date.now(),
      },
    }));
  }, []);
  const upsertLiveAltEntryOrderRegistry = useCallback((
    liveKey: string,
    symbol: string,
    direction: 'long' | 'short',
    closeSide: 'BUY' | 'SELL',
    positionSide: 'LONG' | 'SHORT' | 'BOTH',
    entryOrderId: string,
    entrySubmittedAt: number,
  ) => {
    setLiveAltOrderRegistry(prev => ({
      ...prev,
      [liveKey]: {
        symbol,
        direction,
        closeSide,
        positionSide,
        orders: prev[liveKey]?.orders ?? [],
        entryOrderId,
        entrySubmittedAt,
        updatedAt: Date.now(),
      },
    }));
  }, []);

  const captureLiveEntryFillFromTrades = useCallback(async (liveKey: string, meta: AltMeta) => {
    const submittedAt = meta.liveEntrySubmittedAt ?? Date.now();
    const start = Math.max(0, submittedAt - 5 * 60 * 1000);
    const end = Date.now() + 2 * 60 * 1000;
    const side: 'BUY' | 'SELL' = meta.direction === 'long' ? 'BUY' : 'SELL';
    const rows = await futuresFetchUserTrades(meta.symbol, start, end, 300);
    let openRows = rows
      .filter(t => t.symbol === meta.symbol && t.side === side && t.time >= start)
      .sort((a, b) => a.time - b.time);
    if (meta.liveEntryOrderId) {
      const byOrder = openRows.filter(r => r.orderId && String(r.orderId) === String(meta.liveEntryOrderId));
      if (byOrder.length > 0) openRows = byOrder;
    }
    if (openRows.length === 0) return { found: false, nonUsdt: false };

    const entryTime = openRows[0].time;
    const nonUsdt = openRows.some(r => (r.commissionAsset ?? '').toUpperCase() !== 'USDT');
    const entryFee = nonUsdt
      ? null
      : parseFloat(openRows.reduce((sum, r) => sum + r.commission, 0).toFixed(8));

    setLiveAltMetaMap(prev => {
      const cur = prev[liveKey];
      if (!cur) return prev;
      return {
        ...prev,
        [liveKey]: {
          ...cur,
          liveEntryTime: cur.liveEntryTime ?? entryTime,
          liveEntryFee: cur.liveEntryFee ?? entryFee,
        },
      };
    });
    return { found: true, nonUsdt };
  }, [futuresFetchUserTrades]);

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
  const paperCloseSoundSeenRef = useRef<Set<string>>(new Set(paperTrading.history.map(row => row.id)));
  React.useEffect(() => {
    const seen = paperCloseSoundSeenRef.current;
    for (const row of paperTrading.history) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if ((row.pnl ?? 0) > 0) playTpSound();
      else if ((row.pnl ?? 0) < 0) playSlSound();
    }
  }, [paperTrading.history, playTpSound, playSlSound]);

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

  // Symbols for paper price feed: union of open positions and pending orders.
  // Always includes altMeta paper positions so they are monitored even in live mode.
  const paperSymbolsKey = [...new Set([
    ...(isPaperMode
      ? [
          ...paperTrading.positions.map(p => p.symbol),
          ...paperTrading.orders.map(o => o.symbol),
        ]
      : paperTrading.positions.filter(p => p.altMeta).map(p => p.symbol)
    ),
  ])].sort().join(',');

  // Fetch REST mark prices for all paper symbols (positions ∪ orders), call checkPrices after each update
  React.useEffect(() => {
    if (paperSymbolsKey === '') return;
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
  }, [paperSymbolsKey]);

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

  const handleTickerSelect = useCallback((symbol: string, force = false) => {
    if (!force && symbol === tickerRef.current) return;
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
    if (force && symbol === tickerRef.current) {
      void refetchCandles();
    }
  }, [refetchCandles, setCandles]);

  const mergeAltManagedDrawings = useCallback((meta: AltMeta) => {
    const candidateId = meta.candidateId;
    setDrawingsByTicker(prev => {
      const current = prev[meta.symbol] ?? [];
      const keep = current.filter(d => !isAltManagedDrawingForCandidate(d.id, candidateId));
      const injected = meta.drawingsSnapshot.map((d, idx) => ({
        ...d,
        id: buildAltManagedDrawingId(candidateId, d.id, idx),
        ticker: meta.symbol,
      })) as Drawing[];
      const merged = Array.from(new Map([...keep, ...injected].map(d => [d.id, d])).values());
      return { ...prev, [meta.symbol]: merged };
    });
  }, []);

  const removeAltManagedDrawingsForCandidate = useCallback((symbol: string, candidateId: string) => {
    setDrawingsByTicker(prev => {
      const current = prev[symbol] ?? [];
      const next = current.filter(d => !isAltManagedDrawingForCandidate(d.id, candidateId));
      if (next.length === current.length) return prev;
      const updated = { ...prev };
      if (next.length > 0) updated[symbol] = next;
      else delete updated[symbol];
      return updated;
    });
  }, []);

  const openAltInMain = useCallback((meta: AltMeta) => {
    if (CHART_INTERVALS.includes(meta.scanInterval as Interval)) {
      handleIntervalChange(meta.scanInterval as Interval);
    }
    mergeAltManagedDrawings(meta);
    handleTickerSelect(meta.symbol, true);
  }, [handleIntervalChange, handleTickerSelect, mergeAltManagedDrawings]);

  // Paper ALT positions: when a position is fully removed, cleanup only that candidate's managed drawings.
  const prevPaperAltByIdRef = useRef<Record<string, AltMeta>>({});
  React.useEffect(() => {
    const prev = prevPaperAltByIdRef.current;
    const next: Record<string, AltMeta> = {};
    const currentIds = new Set(paperTrading.positions.map(p => p.id));
    for (const [id, meta] of Object.entries(prev)) {
      if (!currentIds.has(id)) {
        removeAltManagedDrawingsForCandidate(meta.symbol, meta.candidateId);
      }
    }
    for (const p of paperTrading.positions) {
      if (p.altMeta) next[p.id] = p.altMeta;
    }
    prevPaperAltByIdRef.current = next;
  }, [paperTrading.positions, removeAltManagedDrawingsForCandidate]);

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

  const announceAltEntry = useCallback((
    symbol: string,
    direction: 'long' | 'short',
    leverage: number,
    opts?: { mode?: 'paper' | 'live'; reservation?: boolean; voiceEnabled?: boolean },
  ) => {
    const sideText = direction === 'long' ? '롱' : '숏';
    const actionText = opts?.reservation ? '예약되었습니다' : '진입했습니다';
    const suffix = opts?.mode === 'paper' ? ' 모의거래 입니다.' : '';
    const message = `자동매수 알림! ${coinLabel(symbol)}코인 ${sideText} 포지션으로 ${leverageSpeech(leverage)}배 ${actionText}${suffix}`;
    playEntrySound();
    if (opts?.voiceEnabled === false) return;
    window.setTimeout(() => {
      speakSound(message, { lang: 'ko-KR', rate: 1.0, pitch: 1.0 });
    }, 180);
  }, [playEntrySound, speakSound]);

  // ── AltScanner trade handlers ─────────────────────────────────────────
  const handleAltPaperTrade = useCallback((params: AltTradeParams) => {
    // ── Duplicate guard ───────────────────────────────────────────────────
    // Prevent the same symbol+direction from being entered multiple times.
    // enteredThisRun in useAltAutoTrade deduplicates within one scan run,
    // but across hourly runs the same candidate can reappear and compound
    // margin via the position averaging (물타기) logic in openPosition.
    const posSide = params.direction === 'long' ? 'LONG' : 'SHORT';
    const orderSide = params.direction === 'long' ? 'BUY' : 'SELL';
    const existingPos = paperTradingRef.current.positions.find(
      p => p.symbol === params.symbol && p.positionSide === posSide && p.altMeta,
    );
    const existingOrder = paperTradingRef.current.orders.find(
      o => o.symbol === params.symbol && o.side === orderSide && o.altMeta,
    );
    if (existingPos || existingOrder) {
      addLog('info', `[ALT모의] ${params.symbol} ${params.direction.toUpperCase()} — 이미 ${existingPos ? '포지션' : '예약주문'} 존재, 중복 진입 건너뜀`);
      return;
    }
    // ─────────────────────────────────────────────────────────────────────
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
      candidateScore: params.candidateScore,
      plannedEntry: params.plannedEntry,
      plannedTP: params.plannedTP,
      plannedSL: params.plannedSL,
      scanInterval: params.scanInterval,
      validUntilTime: params.validUntilTime,
      slPrice: params.slPrice,
      drawingsSnapshot: params.drawingsSnapshot,
      entrySource: params.entrySource,
      timeStopEnabled: params.timeStopEnabled,
    };
    const side: 'BUY' | 'SELL' = params.direction === 'long' ? 'BUY' : 'SELL';
    type TriggerType = 'limit' | 'close_above' | 'close_below';
    const triggerType: TriggerType = isTrendlinePending
      ? (params.direction === 'long' ? 'close_above' : 'close_below')
      : 'limit';
    const limitPrice = isTrendlinePending
      ? params.triggerPriceAtNextClose!
      : params.entryPrice;

    const placed = paperTradingRef.current.placeLimitOrder(
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
    if (!placed) {
      addLog('info', `[ALT모의] ${params.symbol} 예약주문 생성 거부 — 중복 진입 또는 TP/SL 불변식 위반`);
      return;
    }
    const autoVoiceEnabled = normalizeAutoTradeVoiceAlert(paperAutoTradeSettingsRef.current.voiceAlertEnabled);
    const voiceEnabled = params.entrySource === 'auto' ? autoVoiceEnabled : true;
    const reservation = isTrendlinePending || params.candidateStatus === 'PENDING';
    announceAltEntry(params.symbol, params.direction, leverage, { mode: 'paper', reservation, voiceEnabled });
    if (isTrendlinePending) {
      addLog('info', `[ALT모의] ${params.symbol} 조건부 진입 대기 — 다음 봉 종가 ${params.direction === 'long' ? '≥' : '≤'} ${limitPrice.toFixed(4)} 시 체결`);
    }
    handleTickerSelect(params.symbol);
    setIsPaperMode(true);
    setShowAltScanner(false);
  }, [announceAltEntry, handleTickerSelect]);

  // Forward refs — populated after their targets are defined below
  const handleAltLiveTradeRef    = useRef<((params: AltTradeParams) => void) | null>(null);
  const altAutoTradeSetActiveRef = useRef<((v: boolean) => void) | null>(null);

  // ── AltScanner auto-trade: convert ScanCandidate → AltTradeParams and route by mode ──
  const handleAutoTradeScan = useCallback((c: ScanCandidate) => {
    const autoSettings = (autoTradeModeRef.current === 'live' ? liveAutoTradeSettingsRef : paperAutoTradeSettingsRef).current;
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
      leverage:   autoSettings.leverage,
      marginType: autoSettings.marginType,
      riskPct:    autoSettings.riskPct,
      candidateId: `${c.symbol}_${c.direction}_${c.asOfCloseTime}`,
      candidateScore: c.score,
      plannedEntry: c.entryPrice,
      plannedTP: c.tpPrice ?? null,
      plannedSL: c.slPrice ?? null,
      scanInterval: c.interval,
      validUntilTime: c.validUntilTime,
      drawingsSnapshot,
      entrySource: 'auto',
      timeStopEnabled: normalizeAutoTradeTimeStop(autoSettings.timeStopEnabled),
      breakoutType:    c.breakoutType,
      candidateStatus: c.status,
      triggerPriceAtNextClose: c.triggerPriceAtNextClose,
      sizeMode:   autoSettings.sizeMode,
      marginUsdt: autoSettings.marginUsdt,
    };
    if (autoTradeModeRef.current === 'live') {
      if (!binanceApiKey || !binanceApiSecret) {
        addLog('info', '[자동매매] 실전 모드이지만 API 키 미설정 — 건너뜀');
        return;
      }
      getPositionMode(binanceApiKey, binanceApiSecret).then(isDual => {
        if (isDual) {
          addLog('error', '[자동매매] Hedge(헤지) 모드 감지 — 단방향(One-way) 필수. 자동매매 OFF, 모의 모드로 전환.');
          altAutoTradeSetActiveRef.current?.(false);
          setAutoTradeMode('paper');
          return;
        }
        handleAltLiveTradeRef.current?.(params);
      }).catch(() => {
        addLog('error', '[자동매매] 포지션 모드 확인 실패 — 진입 건너뜀. 네트워크 또는 API 권한 확인.');
      });
    } else {
      handleAltPaperTrade(params);
    }
  }, [handleAltPaperTrade, binanceApiKey, binanceApiSecret, addLog]);

  const altAutoTrade = useAltAutoTrade({
    symbols: tickers.map(t => t.symbol),
    onEnterTrade: handleAutoTradeScan,
    onLog: (msg, type) => {
      const mappedType: ActivityLog['type'] = type === 'error' ? 'error' : type === 'success' ? 'order' : 'info';
      addLog(mappedType, `[자동매매] ${msg}`);
    },
    enterLabel: autoTradeMode === 'live' ? '실전진입' : '모의진입',
    scanIntervals: (autoTradeMode === 'live' ? liveAutoTradeSettings : paperAutoTradeSettings).scanIntervals,
    cadenceMinutes: (autoTradeMode === 'live' ? liveAutoTradeSettings : paperAutoTradeSettings).scanCadenceMinutes,
  });
  altAutoTradeSetActiveRef.current = altAutoTrade.setActive;

  const tryAcquireAutoTradeLeaderLock = useCallback(async (): Promise<boolean> => {
    const lockDocRef = autoTradeLeaderLockDocRef.current;
    if (!lockDocRef) return true;

    const now = Date.now();
    const myId = autoTradeLeaderSessionIdRef.current;
    let acquired = false;
    let blockedBy = '';

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(lockDocRef);
        const raw = snap.data() as { holderId?: string; expiresAt?: number } | undefined;
        const holderId = typeof raw?.holderId === 'string' ? raw.holderId : '';
        const expiresAt = typeof raw?.expiresAt === 'number' ? raw.expiresAt : 0;
        blockedBy = holderId;
        if (!holderId || expiresAt <= now || holderId === myId) {
          tx.set(lockDocRef, {
            holderId: myId,
            expiresAt: now + AUTO_TRADE_LEADER_LEASE_MS,
            updatedAt: now,
          }, { merge: true });
          acquired = true;
        }
      });
    } catch {
      acquired = false;
    }

    if (acquired) {
      setAutoTradeLeaderNotice(null);
      return true;
    }

    const msg = '다른 디바이스가 자동매매 리더로 실행 중이라 이 디바이스 스캔이 차단되었습니다.';
    setAutoTradeLeaderNotice(msg);
    addLog('error', `[자동매매] ${msg}${blockedBy ? ` (holder:${blockedBy.slice(0, 6)})` : ''}`);
    return false;
  }, [addLog]);

  const releaseAutoTradeLeaderLock = useCallback(async () => {
    const lockDocRef = autoTradeLeaderLockDocRef.current;
    if (!lockDocRef) return;

    const now = Date.now();
    const myId = autoTradeLeaderSessionIdRef.current;
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(lockDocRef);
        const raw = snap.data() as { holderId?: string } | undefined;
        const holderId = typeof raw?.holderId === 'string' ? raw.holderId : '';
        if (holderId !== myId) return;
        tx.set(lockDocRef, {
          holderId: '',
          expiresAt: now - 1,
          updatedAt: now,
        }, { merge: true });
      });
    } catch {}
  }, []);

  React.useEffect(() => {
    const lockDocRef = autoTradeLeaderLockDocRef.current;
    if (!lockDocRef) return;
    const myId = autoTradeLeaderSessionIdRef.current;
    const unsub = onSnapshot(lockDocRef, snap => {
      const raw = snap.data() as { holderId?: string; expiresAt?: number } | undefined;
      const holderId = typeof raw?.holderId === 'string' ? raw.holderId : '';
      const expiresAt = typeof raw?.expiresAt === 'number' ? raw.expiresAt : 0;
      const now = Date.now();
      const blocked = !!holderId && holderId !== myId && expiresAt > now;
      if (!blocked) {
        if (autoTradeBlockedByRef.current) {
          autoTradeBlockedByRef.current = null;
          addLog('info', '[자동매매] 리더 락 해제됨 — 이 디바이스에서 다시 자동매매를 시작할 수 있습니다.');
        }
        setAutoTradeLeaderNotice(null);
        return;
      }

      if (autoTradeBlockedByRef.current !== holderId) {
        autoTradeBlockedByRef.current = holderId;
        addLog('error', `[자동매매] 다른 디바이스가 리더로 실행 중 — 이 디바이스 스캔 중지 (holder:${holderId.slice(0, 6)})`);
      }
      setAutoTradeLeaderNotice('다른 디바이스가 자동매매 리더로 실행 중이라 이 디바이스에서는 스캔이 중지됩니다.');
      if (altAutoTrade.isActive) {
        altAutoTrade.setActive(false);
      }
    });
    return () => unsub();
  }, [altAutoTrade.isActive, altAutoTrade.setActive, addLog]);

  React.useEffect(() => {
    const lockDocRef = autoTradeLeaderLockDocRef.current;
    if (!lockDocRef || !altAutoTrade.isActive) return;
    const myId = autoTradeLeaderSessionIdRef.current;
    let cancelled = false;

    const heartbeat = async () => {
      const now = Date.now();
      let ok = true;
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(lockDocRef);
          const raw = snap.data() as { holderId?: string; expiresAt?: number } | undefined;
          const holderId = typeof raw?.holderId === 'string' ? raw.holderId : '';
          const expiresAt = typeof raw?.expiresAt === 'number' ? raw.expiresAt : 0;
          if (holderId && holderId !== myId && expiresAt > now) {
            ok = false;
            return;
          }
          tx.set(lockDocRef, {
            holderId: myId,
            expiresAt: now + AUTO_TRADE_LEADER_LEASE_MS,
            updatedAt: now,
          }, { merge: true });
        });
      } catch {
        ok = false;
      }
      if (!ok && !cancelled) {
        setAutoTradeLeaderNotice('다른 디바이스가 자동매매 리더를 점유하여 이 디바이스 스캔이 중지되었습니다.');
        addLog('error', '[자동매매] 리더 락 유지 실패 — 이 디바이스 자동매매를 중지합니다.');
        altAutoTrade.setActive(false);
      }
    };

    void heartbeat();
    const id = window.setInterval(() => { void heartbeat(); }, AUTO_TRADE_LEADER_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [altAutoTrade.isActive, altAutoTrade.setActive, addLog]);

  React.useEffect(() => {
    if (altAutoTrade.isActive) return;
    void releaseAutoTradeLeaderLock();
  }, [altAutoTrade.isActive, releaseAutoTradeLeaderLock]);

  React.useEffect(() => {
    return () => { void releaseAutoTradeLeaderLock(); };
  }, [releaseAutoTradeLeaderLock]);

  const handleToggleAutoTrade = useCallback(async () => {
    if (altAutoTrade.isActive) {
      altAutoTrade.setActive(false);
      return;
    }
    const ok = await tryAcquireAutoTradeLeaderLock();
    if (!ok) return;
    altAutoTrade.setActive(true);
  }, [altAutoTrade.isActive, altAutoTrade.setActive, tryAcquireAutoTradeLeaderLock]);

  const handleTriggerAutoTradeNow = useCallback(async () => {
    if (!altAutoTrade.isActive) {
      const ok = await tryAcquireAutoTradeLeaderLock();
      if (!ok) return;
      altAutoTrade.setActive(true);
    }
    altAutoTrade.triggerNow();
  }, [altAutoTrade.isActive, altAutoTrade.setActive, altAutoTrade.triggerNow, tryAcquireAutoTradeLeaderLock]);

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
        const isLong = o.altMeta?.direction === 'long';
        const entryBasis = o.limitPrice;
        const nextTp = isLong
          ? (c.tpPrice > entryBasis ? c.tpPrice : o.tpPrice)
          : (c.tpPrice < entryBasis ? c.tpPrice : o.tpPrice);
        const nextSl = isLong
          ? (c.slPrice < entryBasis ? c.slPrice : o.slPrice)
          : (c.slPrice > entryBasis ? c.slPrice : o.slPrice);
        if (nextTp !== o.tpPrice || nextSl !== o.slPrice) {
          paperTradingRef.current.updateOrder(o.id, { tpPrice: nextTp, slPrice: nextSl });
          continue;
        }
        if (o.tpPrice !== c.tpPrice || o.slPrice !== c.slPrice) {
          addLog(
            'info',
            `[ALT모의] ${o.symbol} ${o.altMeta?.direction?.toUpperCase()} TP/SL 업데이트 보류 — 기존 TP:${o.tpPrice ?? '—'} SL:${o.slPrice ?? '—'} / 신규 TP:${c.tpPrice} SL:${c.slPrice} (진입기준:${entryBasis})`,
          );
        }
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
        if (safeTP === p.tpPrice && safeSL === p.slPrice && (c.tpPrice !== p.tpPrice || c.slPrice !== p.slPrice)) {
          addLog(
            'info',
            `[ALT모의] ${p.symbol} ${p.altMeta?.direction?.toUpperCase()} 포지션 TP/SL 유지 — 기존 TP:${p.tpPrice ?? '—'} SL:${p.slPrice ?? '—'} / 신규 TP:${c.tpPrice} SL:${c.slPrice} (실진입:${p.entryPrice})`,
          );
        }
        paperTradingRef.current.setTPSL(p.id, safeTP, safeSL);
      }
    }
  }, [addLog]);

  const handleAltLiveTrade = useCallback(async (params: AltTradeParams) => {
    if (!binanceApiKey || !binanceApiSecret) {
      addLog('error', '[ALT실전] API 키가 설정되지 않았습니다');
      return;
    }
    // ── Duplicate guard ───────────────────────────────────────────────────
    // Two layers: liveAltMetaMap (persisted, updated after re-render) +
    // liveInFlightRef (synchronous, covers the async gap between check and map update).
    const liveKey = `${params.symbol}_${params.direction}`;
    if (liveAltMetaMapRef.current[liveKey] || liveInFlightRef.current.has(liveKey)) {
      addLog('info', `[ALT실전] ${params.symbol} ${params.direction.toUpperCase()} — 이미 실전 포지션/주문 존재, 중복 진입 건너뜀`);
      return;
    }
    liveInFlightRef.current.add(liveKey); // immediately lock before any async work
    // ── Position mode check: One-way (단방향) 필수 ────────────────────────
    try {
      const isDual = await getPositionMode(binanceApiKey, binanceApiSecret);
      if (isDual) {
        addLog('error', '[ALT실전] Hedge(헤지) 모드 감지 — 단방향(One-way) 모드 필수. 바이낸스에서 포지션 모드 변경 후 재시도.');
        return;
      }
    } catch {
      addLog('error', '[ALT실전] 포지션 모드 확인 실패 — 네트워크 또는 API 권한 확인');
      return;
    }

    const side: 'BUY' | 'SELL' = params.direction === 'long' ? 'BUY' : 'SELL';
    const closeSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';
    const leverage = params.leverage ?? 10;
    const liveMarginType: 'CROSSED' | 'ISOLATED' = params.marginType ?? 'ISOLATED';
    const balance = futuresBalanceRef.current;
    // Keep the existing sizing basis as-is (planned entry / pending trigger).
    const isTrendlinePending =
      params.breakoutType === 'trendline' &&
      params.candidateStatus === 'PENDING' &&
      params.triggerPriceAtNextClose != null;
    const effectiveEntryPrice = isTrendlinePending ? params.triggerPriceAtNextClose! : params.entryPrice;

    // ── Quantity calculation: margin mode vs risk% mode ───────────────────
    let qty: number;
    if (params.sizeMode === 'margin' && (params.marginUsdt ?? 0) > 0) {
      if (params.marginUsdt! > balance) {
        addLog('error', `[ALT실전] 잔고 부족: 필요 마진 $${params.marginUsdt} > 가용 잔고 $${balance.toFixed(2)} — 건너뜀`);
        return;
      }
      qty = parseFloat(((params.marginUsdt! * leverage) / effectiveEntryPrice).toFixed(6));
    } else {
      const riskAmount = balance * ((params.riskPct ?? 2) / 100);
      const slDistance = Math.abs(effectiveEntryPrice - params.slPrice);
      qty = slDistance > 0
        ? parseFloat((riskAmount / slDistance).toFixed(6))
        : parseFloat(((riskAmount * leverage) / effectiveEntryPrice).toFixed(6));
    }
    if (qty <= 0) {
      addLog('error', '[ALT실전] 수량 계산 실패: 잔고 또는 SL 거리를 확인하세요');
      return;
    }

    const baseLiveMeta: AltMeta = {
      source: 'altscanner',
      candidateId: params.candidateId,
      symbol: params.symbol,
      direction: params.direction,
      candidateScore: params.candidateScore,
      plannedEntry: params.plannedEntry,
      plannedTP: params.plannedTP,
      plannedSL: params.plannedSL,
      scanInterval: params.scanInterval,
      validUntilTime: params.validUntilTime,
      slPrice: params.slPrice,
      drawingsSnapshot: params.drawingsSnapshot,
      entrySource: params.entrySource,
      timeStopEnabled: params.timeStopEnabled,
    };

    handleTickerSelect(params.symbol);
    setIsPaperMode(false);
    setShowAltScanner(false);

    let ackOrderId: string | undefined;
    let ackStatusRaw: string | undefined;
    let ackTime: number | undefined;
    const requestStartedAt = Date.now();
    addLog('info', `[ALT실전] 진입 요청 시작 — ${side} ${qty} ${params.symbol} (fill 우선: MARKET)`);

    try {
      await futuresPlaceOrder(side, effectiveEntryPrice, qty, leverage, liveMarginType, false, params.symbol, 'GTC', {
        orderType: 'MARKET',
        onAck: (ack) => {
          ackOrderId = ack.orderId || undefined;
          ackStatusRaw = ack.status;
          ackTime = ack.time;
        },
      });

      const ackStatus = ackStatusRaw ?? 'UNKNOWN';
      const submittedAt = ackTime ?? Date.now();

      addLog('info', `[ALT실전] 진입 주문 접수 — ${params.symbol} status:${ackStatus}${ackOrderId ? ` #${ackOrderId}` : ''}`);
      if (ackStatus === 'REJECTED' || ackStatus === 'CANCELED' || ackStatus === 'EXPIRED') {
        addLog('error', `[ALT실전] 진입 주문 미체결 종료 — ${params.symbol} status:${ackStatus}`);
        return;
      }

      const liveMeta: AltMeta = {
        ...baseLiveMeta,
        liveEntryOrderId: ackOrderId,
        liveEntrySubmittedAt: submittedAt,
      };
      setLiveAltMetaMap(prev => ({ ...prev, [liveKey]: liveMeta }));
      if (ackOrderId) {
        upsertLiveAltEntryOrderRegistry(
          liveKey,
          params.symbol,
          params.direction,
          closeSide,
          params.direction === 'long' ? 'LONG' : 'SHORT',
          ackOrderId,
          submittedAt,
        );
      }

      // Register pending TP/SL — applied once the position is confirmed open via allPositions update.
      setPendingLiveTPSLMap(prev => ({
        ...prev,
        [liveKey]: {
          symbol: params.symbol,
          direction: params.direction,
          closeSide,
          tp: params.tpPrice,
          sl: params.slPrice,
          plannedQty: qty,
          createdAt: Date.now(),
          entryOrderId: ackOrderId,
          entryOrderStatus: ackStatus,
          entrySubmittedAt: submittedAt,
        },
      }));
      addLog('info', `[ALT실전] TP/SL 대기 등록 — 포지션 체결 확인 후 자동 적용`);

      // Entry fill capture: immediate attempt + bounded retries
      liveEntryFillRetryRef.current[liveKey] = {
        attempts: 0,
        nextAt: Date.now(),
        deadlineAt: submittedAt + 15 * 60 * 1000,
      };
      void captureLiveEntryFillFromTrades(liveKey, liveMeta).catch(() => {});

      // Explicit UX feedback: filled / still-open / unknown.
      void (async () => {
        const autoVoiceEnabled = normalizeAutoTradeVoiceAlert(liveAutoTradeSettingsRef.current.voiceAlertEnabled);
        const voiceEnabled = params.entrySource === 'auto' ? autoVoiceEnabled : true;
        await new Promise(resolve => setTimeout(resolve, 900));
        const opened = futuresAllPositionsRef.current.find(p =>
          p.symbol === params.symbol &&
          Math.abs(p.positionAmt) > 0 &&
          (params.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
        );
        if (opened) {
          addLog('order', `[ALT실전] 포지션 오픈 확인 — ${params.symbol} ${params.direction.toUpperCase()} ${Math.abs(opened.positionAmt)}`);
          announceAltEntry(params.symbol, params.direction, leverage, { mode: 'live', reservation: false, voiceEnabled });
          return;
        }
        const openOrder = ackOrderId
          ? futuresAllOrdersRef.current.find(o => o.symbol === params.symbol && String(o.orderId) === String(ackOrderId))
          : futuresAllOrdersRef.current.find(o => o.symbol === params.symbol && o.side === side);
        if (openOrder) {
          addLog('info', `[ALT실전] 진입 주문 대기중 — ${params.symbol} status:${openOrder.status}`);
          announceAltEntry(params.symbol, params.direction, leverage, { mode: 'live', reservation: true, voiceEnabled });
          return;
        }
        addLog('info', `[ALT실전] 진입 주문 접수됨 — ${params.symbol} 포지션 오픈 확인 대기 (미체결/만료 여부 확인 필요)`);
      })();
    } catch (e) {
      addLog('error', `[ALT실전] 진입 실패: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      // Success path is tracked by liveAltMetaMap; unlock in-flight guard either way.
      liveInFlightRef.current.delete(liveKey);
      const elapsed = Date.now() - requestStartedAt;
      if (elapsed > 4000) {
        addLog('info', `[ALT실전] 진입 처리 완료 (${(elapsed / 1000).toFixed(1)}s)`);
      }
    }
  }, [announceAltEntry, handleTickerSelect, addLog, futuresPlaceOrder, binanceApiKey, binanceApiSecret, upsertLiveAltEntryOrderRegistry, captureLiveEntryFillFromTrades]);

  // Connect forward ref so handleAutoTradeScan can call handleAltLiveTrade
  handleAltLiveTradeRef.current = handleAltLiveTrade;

  // ── Live ALT entry fill retry (bounded) ────────────────────────────────
  React.useEffect(() => {
    const now = Date.now();
    const retryMap = liveEntryFillRetryRef.current;
    const liveKeys = new Set(Object.keys(liveAltMetaMap));
    for (const key of Object.keys(retryMap)) {
      if (!liveKeys.has(key)) delete retryMap[key];
    }
    for (const [liveKey, meta] of Object.entries(liveAltMetaMap)) {
      if (!meta.liveEntrySubmittedAt && !meta.liveEntryOrderId) continue;
      const hasEntryTime = meta.liveEntryTime != null;
      const hasEntryFee = meta.liveEntryFee != null;
      if (hasEntryTime && hasEntryFee) {
        delete retryMap[liveKey];
        continue;
      }

      const cur = retryMap[liveKey] ?? {
        attempts: 0,
        nextAt: now,
        deadlineAt: (meta.liveEntrySubmittedAt ?? now) + 15 * 60 * 1000,
      };
      retryMap[liveKey] = cur;
      if (cur.running) continue;
      if (now < cur.nextAt) continue;
      if (now > cur.deadlineAt || cur.attempts >= 30 || (hasEntryTime && cur.attempts >= 3)) {
        delete retryMap[liveKey];
        continue;
      }

      cur.running = true;
      void captureLiveEntryFillFromTrades(liveKey, meta)
        .then((res) => {
          const latest = liveEntryFillRetryRef.current[liveKey];
          if (!latest) return;
          latest.attempts += 1;
          latest.nextAt = Date.now() + (res.found ? 25_000 : 8_000);
          latest.running = false;
          const latestMeta = liveAltMetaMapRef.current[liveKey];
          if (!latestMeta) {
            delete liveEntryFillRetryRef.current[liveKey];
            return;
          }
          if (latestMeta.liveEntryTime != null && (latestMeta.liveEntryFee != null || res.nonUsdt || latest.attempts >= 3)) {
            delete liveEntryFillRetryRef.current[liveKey];
          }
        })
        .catch(() => {
          const latest = liveEntryFillRetryRef.current[liveKey];
          if (!latest) return;
          latest.attempts += 1;
          latest.nextAt = Date.now() + 12_000;
          latest.running = false;
        });
    }
  }, [liveAltMetaMap, captureLiveEntryFillFromTrades]);

  // ── Auto trade mode change handler ────────────────────────────────────
  const handleChangeAutoTradeMode = useCallback((mode: 'paper' | 'live') => {
    if (altAutoTrade.isActive) {
      altAutoTrade.setActive(false);
      addLog('info', `[자동매매] 모드 변경(${mode === 'live' ? '실전' : '모의'}) — 자동매매 OFF`);
    }
    setAutoTradeMode(mode);
  }, [altAutoTrade, addLog]);

  // ── Pending live TP/SL processor ─────────────────────────────────────
  // Stable ref so the effect doesn't re-subscribe when futuresPlaceTPSL identity changes
  const futuresPlaceTPSLRef = useRef(futuresPlaceTPSL);
  futuresPlaceTPSLRef.current = futuresPlaceTPSL;

  React.useEffect(() => {
    const pending = Object.entries(pendingLiveTPSLMap);
    if (pending.length === 0) return;
    const EXPIRE_MS = 15 * 60 * 1000;
    const LEGACY_STALE_MS = 30 * 60 * 1000;
    const now = Date.now();
    for (const [key, entry] of pending) {
      // Check if a matching position is now open
      const pos = futuresAllPositions.find(p =>
        p.symbol === entry.symbol &&
        Math.abs(p.positionAmt) > 0 &&
        (entry.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
      );
      if (!pos) {
        const entryOrder = entry.entryOrderId
          ? futuresAllOrders.find(o => o.symbol === entry.symbol && String(o.orderId) === String(entry.entryOrderId))
          : undefined;
        if (entryOrder) {
          // Entry order still pending: TP/SL timeout must not run yet.
          continue;
        }
        if (entry.entryOrderId) {
          const graceElapsed = now - (entry.entrySubmittedAt ?? entry.createdAt);
          if (graceElapsed < 30 * 1000) {
            // Fill/position reflection can lag briefly after order acknowledgement.
            continue;
          }
          addLog('info', `[ALT실전] ${entry.symbol} 진입 주문 미체결/취소/만료 — TP/SL 대기 해제`);
          setPendingLiveTPSLMap(prev => { const n = { ...prev }; delete n[key]; return n; });
          setLiveAltMetaMap(prev => { const n = { ...prev }; delete n[key]; return n; });
          setLiveAltOrderRegistry(prev => { const n = { ...prev }; delete n[key]; return n; });
          setLiveCloseMetaSnapshotMap(prev => { const n = { ...prev }; delete n[key]; return n; });
          delete liveCloseReasonHintRef.current[key];
          continue;
        }
        // Backward-compat cleanup for very old pending records created before entry-order tracking.
        if (now - entry.createdAt > LEGACY_STALE_MS) {
          setPendingLiveTPSLMap(prev => { const n = { ...prev }; delete n[key]; return n; });
          setLiveAltMetaMap(prev => { const n = { ...prev }; delete n[key]; return n; });
          setLiveAltOrderRegistry(prev => { const n = { ...prev }; delete n[key]; return n; });
          setLiveCloseMetaSnapshotMap(prev => { const n = { ...prev }; delete n[key]; return n; });
          delete liveCloseReasonHintRef.current[key];
        }
        continue;
      }

      const openedAt = entry.positionOpenedAt ?? now;
      if (!entry.positionOpenedAt) {
        setPendingLiveTPSLMap(prev => {
          const cur = prev[key];
          if (!cur || cur.positionOpenedAt) return prev;
          return { ...prev, [key]: { ...cur, positionOpenedAt: openedAt } };
        });
        addLog('info', `[ALT실전] ${entry.symbol} 포지션 체결 확인 — TP/SL 등록 시작`);
      }

      // Only enforce timeout after position actually opened.
      if (now - openedAt > EXPIRE_MS) {
        addLog('error', `[ALT실전] TP/SL 설정 지연 만료(15분) — ${entry.symbol} 포지션은 열려 있음, 수동 설정 필요`);
        setPendingLiveTPSLMap(prev => { const n = { ...prev }; delete n[key]; return n; });
        continue;
      }

      if (inFlightTPSLRef.current.has(key)) continue;
      const actualQty = Math.abs(pos.positionAmt);
      inFlightTPSLRef.current.add(key);
      futuresPlaceTPSLRef.current(
        entry.symbol,
        entry.closeSide,
        actualQty,
        entry.tp,
        entry.sl,
        pos.positionSide,
        {
          onPlacedOrders: (refs) => {
            upsertLiveAltOrderRegistry(
              key,
              entry.symbol,
              entry.direction,
              entry.closeSide,
              pos.positionSide,
              refs,
            );
          },
        },
      )
        .then(() => {
          addLog('info', `[ALT실전] TP/SL 등록 완료 — ${entry.symbol} qty:${actualQty} TP:${entry.tp ?? '—'} SL:${entry.sl ?? '—'}`);
          setPendingLiveTPSLMap(prev => { const n = { ...prev }; delete n[key]; return n; });
        })
        .catch((e: unknown) => {
          addLog('error', `[ALT실전] TP/SL 실패: ${e instanceof Error ? e.message : 'unknown'}`);
        })
        .finally(() => { inFlightTPSLRef.current.delete(key); });
    }
  }, [futuresAllPositions, futuresAllOrders, pendingLiveTPSLMap, addLog, upsertLiveAltOrderRegistry]);

  const inferLiveCloseReason = useCallback((meta: AltMeta, exitPrice: number | null): LiveCloseReason => {
    if (exitPrice == null || !isFinite(exitPrice) || exitPrice <= 0) return 'unknown';
    if (meta.direction === 'long') {
      if (meta.plannedTP != null && exitPrice >= meta.plannedTP) return 'tp';
      if (meta.plannedSL != null && exitPrice <= meta.plannedSL) return 'sl';
      return 'unknown';
    }
    if (meta.plannedTP != null && exitPrice <= meta.plannedTP) return 'tp';
    if (meta.plannedSL != null && exitPrice >= meta.plannedSL) return 'sl';
    return 'unknown';
  }, []);

  const inferLiveCloseReasonFromOrderEvidence = useCallback((liveKey: string): LiveCloseReason | null => {
    const registry = liveAltOrderRegistryRef.current[liveKey];
    if (!registry || registry.orders.length === 0) return null;
    let hasTPRef = false;
    let hasSLRef = false;
    let tpOpen = false;
    let slOpen = false;
    for (const ref of registry.orders) {
      if (ref.kind === 'TP') hasTPRef = true;
      if (ref.kind === 'SL') hasSLRef = true;
      const exists = futuresAllOrders.some(o => o.orderId === ref.orderId && o.symbol === registry.symbol);
      if (ref.kind === 'TP' && exists) tpOpen = true;
      if (ref.kind === 'SL' && exists) slOpen = true;
    }
    // If one protection leg disappeared while the opposite leg is still open,
    // treat the disappeared leg as the filled close reason.
    if (hasTPRef && hasSLRef) {
      if (!slOpen && tpOpen) return 'sl';
      if (!tpOpen && slOpen) return 'tp';
      return null;
    }
    // Single-leg disappearance is not reliable enough (could be manual/time-stop cleanup).
    // Keep TP/SL inference conservative unless opposite leg still proves a fill.
    return null;
  }, [futuresAllOrders]);

  const inferLiveCloseReasonFromClientSlEvidence = useCallback((
    symbol: string,
    tracked: LiveTrackedAltPosition | undefined,
  ): LiveCloseReason | null => {
    if (!tracked) return null;
    const byPosSide = futuresRecentClientSlTriggerMap[`${symbol}_${tracked.positionSide}`];
    const byBoth = futuresRecentClientSlTriggerMap[`${symbol}_BOTH`];
    const hitTs = Math.max(byPosSide ?? 0, byBoth ?? 0);
    if (hitTs <= 0) return null;
    if (Date.now() - hitTs > 20 * 60 * 1000) return null;
    return 'sl';
  }, [futuresRecentClientSlTriggerMap]);

  const evaluateTimeStop = useCallback(async (req: TimeStopRequestEntry) => {
    const finalize = (patch: Partial<TimeStopEvalResult>) => {
      setTimeStopRequests(prev => {
        const cur = prev[req.key];
        if (!cur) return prev;
        return {
          ...prev,
          [req.key]: {
            ...cur,
            eval: {
              ...cur.eval,
              ...patch,
              status: 'done',
            },
          },
        };
      });
    };

    try {
      const iv: ScanInterval = (req.scanInterval === '15m' || req.scanInterval === '1h' || req.scanInterval === '4h' || req.scanInterval === '1d')
        ? req.scanInterval
        : '1h';
      const candidates: ScanCandidate[] = [];
      await runBreakoutScan(
        [req.symbol],
        iv,
        'both',
        () => {},
        (c) => { candidates.push(c); },
        undefined,
        { concurrency: 1, delayMs: 0 },
      );
      const candidate = candidates[0];

      if (!candidate) {
        finalize({
          summaryText: '재평가: 신규 시그널 없음 → 타임스탑 진행 권장',
          flipSuggested: false,
          tightenOk: false,
        });
        return;
      }

      if (candidate.direction !== req.direction) {
        finalize({
          summaryText: `재평가: 반대 방향(${candidate.direction}) 시그널 감지 → 반전 자동진입은 미지원, 타임스탑 진행`,
          flipSuggested: true,
          candidateScore: candidate.score,
          tightenOk: false,
        });
        return;
      }

      const tightenOk = req.direction === 'long'
        ? candidate.slPrice > req.currentSl && candidate.slPrice < req.lastClosePrice
        : candidate.slPrice < req.currentSl && candidate.slPrice > req.lastClosePrice;

      if (tightenOk) {
        finalize({
          summaryText: '재평가: 동일방향 유지, SL 상향/하향 가능(리스크↓) → SL 갱신 후 연장 가능',
          flipSuggested: false,
          candidateScore: candidate.score,
          newSl: candidate.slPrice,
          newTp: candidate.tpPrice,
          tightenOk: true,
        });
      } else {
        finalize({
          summaryText: '재평가: 동일방향이나 SL을 더 넓혀야 함(리스크↑ 금지) → 연장 불가, 타임스탑 진행 권장',
          flipSuggested: false,
          candidateScore: candidate.score,
          newSl: candidate.slPrice,
          newTp: candidate.tpPrice,
          tightenOk: false,
        });
      }
    } catch {
      finalize({
        summaryText: '재평가 실패 → 타임스탑 진행 권장',
        flipSuggested: false,
        tightenOk: false,
      });
    }
  }, []);

  const requestTimeStop = useCallback((payload: TimeStopRequestPayload) => {
    const key = `${payload.mode}:${payload.symbol}:${payload.direction}`;
    const now = Date.now();
    setTimeStopNowMs(now);
    let createdEntry: TimeStopRequestEntry | null = null;

    setTimeStopRequests(prev => {
      if (prev[key]) return prev;

      if (payload.mode === 'paper') {
        const pos = payload.paperPosId
          ? paperTradingRef.current.positions.find(p => p.id === payload.paperPosId)
          : undefined;
        if (!pos || !pos.altMeta) return prev;
        if (pos.altMeta.timeStopEnabled === false) return prev;

        createdEntry = {
          key,
          mode: 'paper',
          symbol: payload.symbol,
          direction: payload.direction,
          scanInterval: pos.altMeta.scanInterval,
          candidateId: pos.altMeta.candidateId,
          closeSide: payload.closeSide,
          qty: Math.abs(pos.positionAmt),
          positionSide: pos.positionSide,
          paperPosId: pos.id,
          entryPrice: pos.entryPrice,
          currentTp: pos.tpPrice ?? null,
          currentSl: pos.altMeta.slPrice,
          lastClosePrice: payload.lastClosePrice,
          requestedAt: now,
          deadlineAt: now + 5 * 60 * 1000,
          state: 'pending',
          eval: { status: 'loading', summaryText: '재평가 진행 중...' },
        };
        return { ...prev, [key]: createdEntry };
      }

      const liveKey = payload.metaKey ?? `${payload.symbol}_${payload.direction}`;
      const meta = liveAltMetaMapRef.current[liveKey];
      const pos = futuresAllPositions.find(p =>
        p.symbol === payload.symbol &&
        Math.abs(p.positionAmt) > 0 &&
        (payload.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
      );
      if (!meta || !pos) return prev;
      if (meta.timeStopEnabled === false) return prev;

      createdEntry = {
        key,
        mode: 'live',
        symbol: payload.symbol,
        direction: payload.direction,
        scanInterval: meta.scanInterval,
        candidateId: meta.candidateId,
        closeSide: payload.closeSide,
        qty: Math.abs(pos.positionAmt),
        positionSide: pos.positionSide,
        liveMetaKey: liveKey,
        entryPrice: pos.entryPrice,
        currentTp: meta.plannedTP ?? null,
        currentSl: meta.slPrice,
        lastClosePrice: payload.lastClosePrice,
        requestedAt: now,
        deadlineAt: now + 5 * 60 * 1000,
        state: 'pending',
        eval: { status: 'loading', summaryText: '재평가 진행 중...' },
      };
      return { ...prev, [key]: createdEntry };
    });

    if (createdEntry) {
      setHiddenTimeStopKeys(prev => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      void evaluateTimeStop(createdEntry);
    }
  }, [evaluateTimeStop, futuresAllPositions]);

  const executeTimeStopClose = useCallback(async (reqKey: string, trigger: 'confirm' | 'auto') => {
    const req = timeStopRequestsRef.current[reqKey];
    if (!req || req.state !== 'pending') return;

    setTimeStopRequests(prev => {
      const cur = prev[reqKey];
      if (!cur || cur.state !== 'pending') return prev;
      return { ...prev, [reqKey]: { ...cur, state: 'closing', actionError: undefined } };
    });

    let success = false;
    if (req.mode === 'paper') {
      try {
        const pos = req.paperPosId
          ? paperTradingRef.current.positions.find(p => p.id === req.paperPosId)
          : undefined;
        if (pos) {
          const closePx = markPricesMapRef.current[req.symbol] ?? req.lastClosePrice ?? currentPriceRef.current ?? pos.entryPrice;
          paperTradingRef.current.closePosition(pos.id, closePx, 'expired');
          addLog('info', `[ALT모의] ${req.symbol} 타임스탑 청산 (${trigger === 'confirm' ? '사용자 확인' : '5분 자동'})`);
        }
        success = true;
      } catch (e) {
        addLog('error', `[ALT모의] ${req.symbol} 타임스탑 청산 실패: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    } else {
      const hintKey = req.liveMetaKey ?? `${req.symbol}_${req.direction}`;
      const aliasKey = `${req.symbol}_${req.direction}`;
      const prevHint = liveCloseReasonHintRef.current[hintKey];
      const prevAliasHint = liveCloseReasonHintRef.current[aliasKey];
      liveCloseReasonHintRef.current[hintKey] = 'time';
      liveCloseReasonHintRef.current[aliasKey] = 'time';
      try {
        const livePos = futuresAllPositions.find(p =>
          p.symbol === req.symbol &&
          Math.abs(p.positionAmt) > 0 &&
          (req.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
        );
        const closeQty = livePos ? Math.abs(livePos.positionAmt) : req.qty;
        const closePosSide = livePos?.positionSide ?? req.positionSide;
        if (closeQty > 0) {
          await futuresCloseMarket(req.symbol, req.closeSide, closeQty, closePosSide);
          addLog('info', `[ALT실전] ${req.symbol} 타임스탑 청산 (${trigger === 'confirm' ? '사용자 확인' : '5분 자동'})`);
        }
        success = true;
      } catch (e) {
        if (prevHint) liveCloseReasonHintRef.current[hintKey] = prevHint;
        else delete liveCloseReasonHintRef.current[hintKey];
        if (prevAliasHint) liveCloseReasonHintRef.current[aliasKey] = prevAliasHint;
        else delete liveCloseReasonHintRef.current[aliasKey];
        addLog('error', `[ALT실전] ${req.symbol} 타임스탑 청산 실패: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    setTimeStopRequests(prev => {
      const cur = prev[reqKey];
      if (!cur) return prev;
      if (success) {
        const next = { ...prev };
        delete next[reqKey];
        return next;
      }
      return { ...prev, [reqKey]: { ...cur, state: 'pending' } };
    });
    if (success) {
      setHiddenTimeStopKeys(prev => {
        if (!prev[reqKey]) return prev;
        const next = { ...prev };
        delete next[reqKey];
        return next;
      });
    }
  }, [addLog, futuresAllPositions, futuresCloseMarket]);

  const applyTightenAndExtend = useCallback(async (reqKey: string, extendBars: 1 | 2, applyTp: boolean) => {
    const req = timeStopRequestsRef.current[reqKey];
    if (!req) {
      addLog('error', `[타임스탑] 연장 요청을 찾을 수 없습니다 (${reqKey})`);
      return;
    }
    if (req.state !== 'pending') return;
    if (req.eval.status !== 'done' || req.eval.tightenOk !== true || req.eval.flipSuggested === true || req.eval.newSl == null) {
      setTimeStopRequests(prev => {
        const cur = prev[reqKey];
        if (!cur) return prev;
        return {
          ...prev,
          [reqKey]: {
            ...cur,
            actionError: '연장 조건이 아직 충족되지 않았습니다. 재평가 결과를 확인해주세요.',
          },
        };
      });
      return;
    }
    const tightenedSl = req.eval.newSl;

    setTimeStopRequests(prev => {
      const cur = prev[reqKey];
      if (!cur || cur.state !== 'pending') return prev;
      return { ...prev, [reqKey]: { ...cur, state: 'closing', actionError: undefined } };
    });

    const newValidUntil = Date.now() + extendBars * intervalToMs(req.scanInterval);
    let success = false;
    let failureMessage: string | null = null;

    if (req.mode === 'paper') {
      try {
        const pos = req.paperPosId
          ? paperTradingRef.current.positions.find(p => p.id === req.paperPosId)
          : undefined;
        if (!pos || !pos.altMeta) throw new Error('연장 대상 포지션을 찾을 수 없습니다');
        const nextTp = applyTp ? (req.eval.newTp ?? pos.tpPrice) : pos.tpPrice;
        paperTradingRef.current.setTPSL(pos.id, nextTp ?? undefined, tightenedSl);
        paperTradingRef.current.updateAltMeta(pos.id, {
          validUntilTime: newValidUntil,
          slPrice: tightenedSl,
          plannedSL: tightenedSl,
          ...(applyTp && req.eval.newTp != null ? { plannedTP: req.eval.newTp } : {}),
        });
        addLog('info', `[ALT모의] ${req.symbol} SL 갱신(${tightenedSl.toFixed(6)}) 후 ${extendBars}봉 연장`);
        success = true;
      } catch (e) {
        failureMessage = e instanceof Error ? e.message : 'unknown';
        addLog('error', `[ALT모의] ${req.symbol} 연장 적용 실패: ${failureMessage}`);
      }
    } else {
      try {
        const livePos = futuresAllPositions.find(p =>
          p.symbol === req.symbol &&
          Math.abs(p.positionAmt) > 0 &&
          (req.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
        );
        const liveKey = req.liveMetaKey ?? `${req.symbol}_${req.direction}`;
        const liveMeta = liveAltMetaMapRef.current[liveKey];
        if (!liveMeta) throw new Error('실전 ALT 메타를 찾을 수 없습니다');
        const effectiveQty = livePos ? Math.abs(livePos.positionAmt) : req.qty;
        const effectivePosSide = livePos?.positionSide ?? req.positionSide;
        if (!isFinite(effectiveQty) || effectiveQty <= 0) throw new Error('연장 대상 수량을 확인할 수 없습니다');
        if (!livePos) {
          addLog('info', `[ALT실전] ${req.symbol} 포지션 스냅샷 지연으로 요청 수량(${effectiveQty}) 기준 연장 적용 시도`);
        }
        const staleRefs = liveAltOrderRegistryRef.current[liveKey]?.orders ?? [];
        for (const ref of staleRefs) {
          if (ref.positionSide !== effectivePosSide && ref.positionSide !== 'BOTH' && effectivePosSide !== 'BOTH') continue;
          try {
            await futuresCancelOrder(ref.orderId, req.symbol);
          } catch {
            // ignore not-found/filled race
          }
        }

        const nextTp = applyTp ? (req.eval.newTp ?? undefined) : (req.currentTp ?? undefined);
        await futuresPlaceTPSL(
          req.symbol,
          req.closeSide,
          effectiveQty,
          nextTp,
          tightenedSl,
          effectivePosSide,
          {
            onPlacedOrders: (refs) => {
              upsertLiveAltOrderRegistry(
                liveKey,
                req.symbol,
                req.direction,
                req.closeSide,
                effectivePosSide,
                refs,
              );
            },
          },
        );

        setLiveAltMetaMap(prev => {
          const cur = prev[liveKey] ?? liveMeta;
          if (!cur) return prev;
          return {
            ...prev,
            [liveKey]: {
              ...cur,
              validUntilTime: newValidUntil,
              slPrice: tightenedSl,
              plannedSL: tightenedSl,
              ...(applyTp && req.eval.newTp != null ? { plannedTP: req.eval.newTp } : {}),
            },
          };
        });

        addLog('info', `[ALT실전] ${req.symbol} SL 갱신(${tightenedSl.toFixed(6)}) 후 ${extendBars}봉 연장`);
        success = true;
      } catch (e) {
        failureMessage = e instanceof Error ? e.message : 'unknown';
        addLog('error', `[ALT실전] ${req.symbol} 연장 적용 실패: ${failureMessage}`);
      }
    }

    setTimeStopRequests(prev => {
      const cur = prev[reqKey];
      if (!cur) return prev;
      if (success) {
        const next = { ...prev };
        delete next[reqKey];
        return next;
      }
      return {
        ...prev,
        [reqKey]: {
          ...cur,
          state: 'pending',
          actionError: failureMessage ?? '연장 적용에 실패했습니다',
        },
      };
    });
    if (success) {
      setHiddenTimeStopKeys(prev => {
        if (!prev[reqKey]) return prev;
        const next = { ...prev };
        delete next[reqKey];
        return next;
      });
    }
  }, [addLog, futuresAllPositions, futuresCancelOrder, futuresPlaceTPSL, upsertLiveAltOrderRegistry]);

  React.useEffect(() => {
    const now = timeStopNowMs;
    const expired = Object.values(timeStopRequests).filter(x => x.state === 'pending' && now >= x.deadlineAt);
    for (const req of expired) {
      void executeTimeStopClose(req.key, 'auto');
    }
  }, [timeStopRequests, timeStopNowMs, executeTimeStopClose]);

  React.useEffect(() => {
    if (Object.keys(timeStopRequests).length === 0) {
      if (Object.keys(hiddenTimeStopKeys).length > 0) setHiddenTimeStopKeys({});
      return;
    }

    const staleKeys: string[] = [];
    for (const req of Object.values(timeStopRequests)) {
      if (req.mode === 'paper') {
        const exists = req.paperPosId
          ? paperTrading.positions.some(p => p.id === req.paperPosId)
          : false;
        const disabled = req.paperPosId
          ? paperTrading.positions.some(p => p.id === req.paperPosId && p.altMeta?.timeStopEnabled === false)
          : false;
        if (!exists || disabled) staleKeys.push(req.key);
        continue;
      }
      const liveMetaKey = req.liveMetaKey ?? `${req.symbol}_${req.direction}`;
      const liveMeta = liveAltMetaMap[liveMetaKey];
      if (liveMeta?.timeStopEnabled === false) {
        staleKeys.push(req.key);
        continue;
      }
      const exists = futuresAllPositions.some(p =>
        p.symbol === req.symbol &&
        Math.abs(p.positionAmt) > 0 &&
        (req.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
      );
      if (!exists) staleKeys.push(req.key);
    }

    if (staleKeys.length === 0) return;
    setTimeStopRequests(prev => {
      const next = { ...prev };
      for (const k of staleKeys) delete next[k];
      return next;
    });
    setHiddenTimeStopKeys(prev => {
      let changed = false;
      const next = { ...prev };
      for (const k of staleKeys) {
        if (next[k]) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [timeStopRequests, hiddenTimeStopKeys, paperTrading.positions, futuresAllPositions, liveAltMetaMap]);

  React.useEffect(() => {
    const fiveMinutesMs = 5 * 60 * 1000;
    const id = window.setInterval(() => {
      const now = Date.now();
      const warned = timeStopWarnedRef.current;
      const activeKeys = new Set<string>();
      const dueCoins = new Set<string>();

      for (const pos of paperTradingRef.current.positions) {
        const meta = pos.altMeta;
        if (!meta || meta.source !== 'altscanner' || meta.timeStopEnabled === false) continue;
        const remain = meta.validUntilTime - now;
        const warnKey = `paper:${pos.id}:${meta.validUntilTime}`;
        activeKeys.add(warnKey);
        if (remain > 0 && remain <= fiveMinutesMs && !warned[warnKey]) {
          warned[warnKey] = now;
          dueCoins.add(coinLabel(meta.symbol));
        }
      }

      for (const [liveKey, meta] of Object.entries(liveAltMetaMapRef.current)) {
        if (!meta || meta.timeStopEnabled === false) continue;
        const pos = futuresAllPositionsRef.current.find(p =>
          p.symbol === meta.symbol &&
          Math.abs(p.positionAmt) > 0 &&
          (meta.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
        );
        if (!pos) continue;
        const remain = meta.validUntilTime - now;
        const warnKey = `live:${liveKey}:${meta.validUntilTime}`;
        activeKeys.add(warnKey);
        if (remain > 0 && remain <= fiveMinutesMs && !warned[warnKey]) {
          warned[warnKey] = now;
          dueCoins.add(coinLabel(meta.symbol));
        }
      }

      for (const key of Object.keys(warned)) {
        if (!activeKeys.has(key) && now - warned[key] > 60_000) {
          delete warned[key];
        }
      }

      if (dueCoins.size > 0) {
        const message = `${Array.from(dueCoins).join(',')}코인 타임스탑 5분 전 입니다`;
        addLog('info', `[타임스탑] ${message}`);
        speakSound(message, { lang: 'ko-KR', rate: 1.0, pitch: 1.0 });
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [addLog, speakSound]);

  const activeTimeStopRequest = React.useMemo(() => {
    const pending = Object.values(timeStopRequests).filter(x => x.state === 'pending' && !hiddenTimeStopKeys[x.key]);
    if (pending.length === 0) return null;
    return pending.sort((a, b) => b.requestedAt - a.requestedAt)[0];
  }, [timeStopRequests, hiddenTimeStopKeys]);

  const cleanupAltOrphanOrders = useCallback(async (entry: LiveAltOrderRegistryEntry) => {
    if (!entry.orders.length) {
      futuresRemoveClientSL(entry.symbol, entry.positionSide);
      return;
    }
    const cancelRefsOnce = async () => {
      for (const ref of entry.orders) {
        if (ref.side !== entry.closeSide) continue;
        if (ref.positionSide !== entry.positionSide && ref.positionSide !== 'BOTH' && entry.positionSide !== 'BOTH') continue;
        try {
          await futuresCancelOrder(ref.orderId, entry.symbol);
        } catch {
          // ignore unknown/already-filled race
        }
      }
    };

    await cancelRefsOnce();
    futuresRemoveClientSL(entry.symbol, entry.positionSide);
    await new Promise(resolve => setTimeout(resolve, 1200));
    try { await futuresRefetch(); } catch {}
    await cancelRefsOnce();
    futuresRemoveClientSL(entry.symbol, entry.positionSide);
  }, [futuresCancelOrder, futuresRemoveClientSL, futuresRefetch]);

  const enrichLiveHistoryRowFromTrades = useCallback(async (
    rowId: string,
    meta: AltMeta,
    tracked: LiveTrackedAltPosition,
    exitTime: number,
    reasonSource: 'explicit' | 'order' | 'fallback',
  ) => {
    try {
      const fallbackStart = exitTime - 7 * 24 * 60 * 60 * 1000;
      const entryHint = tracked.entryTime ?? meta.liveEntryTime ?? meta.liveEntrySubmittedAt ?? null;
      const startTime = Math.max(0, (entryHint ?? fallbackStart) - 12 * 60 * 60 * 1000);
      const trades = await futuresFetchUserTrades(meta.symbol, startTime, exitTime + 2 * 60 * 1000, 1000);
      if (trades.length === 0) return;

      const relevant = trades
        .filter(t =>
          t.symbol === meta.symbol &&
          (tracked.positionSide === 'BOTH' || t.positionSide === tracked.positionSide || t.positionSide === 'BOTH'),
        )
        .sort((a, b) => a.time - b.time);
      if (relevant.length === 0) return;

      const openSide: 'BUY' | 'SELL' = tracked.direction === 'long' ? 'BUY' : 'SELL';
      const closeSide: 'BUY' | 'SELL' = openSide === 'BUY' ? 'SELL' : 'BUY';
      const openRowsByEntryOrder = meta.liveEntryOrderId
        ? relevant.filter(t => t.side === openSide && t.orderId && String(t.orderId) === String(meta.liveEntryOrderId))
        : [];

      let remaining = tracked.qty;
      let foundEntryTime: number | null = null;
      for (let i = relevant.length - 1; i >= 0 && remaining > 1e-8; i--) {
        const t = relevant[i];
        if (t.time > exitTime + 120000) continue;
        if (t.side === openSide) {
          remaining -= Math.abs(t.qty);
          foundEntryTime = t.time;
        } else if (t.side === closeSide) {
          remaining += Math.abs(t.qty);
        }
      }
      const entryTime = openRowsByEntryOrder[0]?.time ?? foundEntryTime ?? tracked.entryTime ?? meta.liveEntryTime ?? meta.liveEntrySubmittedAt ?? null;

      const consumeFee = (rows: FuturesUserTrade[], targetQty: number, reverse: boolean) => {
        const ordered = reverse ? [...rows].sort((a, b) => b.time - a.time) : [...rows].sort((a, b) => a.time - b.time);
        let remainQty = targetQty;
        let fee = 0;
        let coveredQty = 0;
        let nonUsdt = false;
        for (const row of ordered) {
          if (remainQty <= 1e-8) break;
          const rowQty = Math.abs(row.qty);
          if (rowQty <= 0) continue;
          const usedQty = Math.min(remainQty, rowQty);
          remainQty -= usedQty;
          coveredQty += usedQty;
          if ((row.commissionAsset ?? '').toUpperCase() !== 'USDT') nonUsdt = true;
          fee += row.commission * (usedQty / rowQty);
        }
        return { fee, coveredQty, nonUsdt };
      };
      const consumeFill = (rows: FuturesUserTrade[], targetQty: number, reverse: boolean) => {
        const ordered = reverse ? [...rows].sort((a, b) => b.time - a.time) : [...rows].sort((a, b) => a.time - b.time);
        let remainQty = targetQty;
        let coveredQty = 0;
        let notional = 0;
        for (const row of ordered) {
          if (remainQty <= 1e-8) break;
          const rowQty = Math.abs(row.qty);
          if (rowQty <= 0) continue;
          const usedQty = Math.min(remainQty, rowQty);
          remainQty -= usedQty;
          coveredQty += usedQty;
          notional += row.price * usedQty;
        }
        return { coveredQty, avgPrice: coveredQty > 0 ? (notional / coveredQty) : null };
      };
      const inferByCloseFillPrice = (fillPrice: number): LiveCloseReason | null => {
        if (!isFinite(fillPrice) || fillPrice <= 0) return null;
        const tp = meta.plannedTP;
        const sl = meta.plannedSL;
        const baseTol = Math.max((tracked.entryPrice > 0 ? tracked.entryPrice : fillPrice) * 0.002, 1e-8);
        if (meta.direction === 'long') {
          if (tp != null && fillPrice >= tp - baseTol) return 'tp';
          if (sl != null && fillPrice <= sl + baseTol) return 'sl';
        } else {
          if (tp != null && fillPrice <= tp + baseTol) return 'tp';
          if (sl != null && fillPrice >= sl - baseTol) return 'sl';
        }
        if (tp != null && sl != null) {
          const spreadTol = Math.max(Math.abs(tp - sl) * 0.2, baseTol);
          const dTp = Math.abs(fillPrice - tp);
          const dSl = Math.abs(fillPrice - sl);
          if (Math.min(dTp, dSl) <= spreadTol) return dTp <= dSl ? 'tp' : 'sl';
        }
        return null;
      };

      let fees: number | null = null;
      let tradeCloseReason: LiveCloseReason | null = null;
      if (entryTime != null) {
        let openRows = relevant.filter(t => t.side === openSide && t.time >= entryTime && t.time <= exitTime + 120000);
        if (openRowsByEntryOrder.length > 0) openRows = openRowsByEntryOrder;
        const closeRows = relevant.filter(t => t.side === closeSide && t.time >= entryTime && t.time <= exitTime + 120000);
        const openFee = consumeFee(openRows, tracked.qty, false);
        const closeFee = consumeFee(closeRows, tracked.qty, true);
        const closeFill = consumeFill(closeRows, tracked.qty, true);
        const enoughCoverage = openFee.coveredQty > tracked.qty * 0.7 && closeFee.coveredQty > tracked.qty * 0.7;
        if (enoughCoverage && !openFee.nonUsdt && !closeFee.nonUsdt) {
          fees = parseFloat((openFee.fee + closeFee.fee).toFixed(8));
        } else if (meta.liveEntryFee != null && closeFee.coveredQty > tracked.qty * 0.7 && !closeFee.nonUsdt) {
          fees = parseFloat((meta.liveEntryFee + closeFee.fee).toFixed(8));
        }
        const hasCloseFillEvidence = closeFill.coveredQty > tracked.qty * 0.4;
        if (closeFill.avgPrice != null && hasCloseFillEvidence) {
          tradeCloseReason = inferByCloseFillPrice(closeFill.avgPrice);
          // External manual close (app/PC) often has no TP/SL evidence.
          // If fallback path has real close-fill evidence but TP/SL 매칭이 안 되면 수동으로 분류.
          if (!tradeCloseReason && reasonSource === 'fallback') {
            tradeCloseReason = 'manual';
          }
        }
      }

      setLiveHistory(prev => prev.map(h => h.id === rowId ? {
        ...h,
        entryTime: entryTime ?? h.entryTime,
        fees: fees ?? h.fees,
        closeReason: tradeCloseReason && (reasonSource === 'fallback' || h.closeReason === 'unknown')
          ? tradeCloseReason
          : h.closeReason,
      } : h));
    } catch {
      // keep the base history row when trade enrichment fails
    }
  }, [futuresFetchUserTrades]);

  React.useEffect(() => {
    const nextTracked = { ...liveTrackedRef.current };
    const appended: LiveTradeHistoryEntry[] = [];
    const cleanupKeys: string[] = [];
    const orphanCleanupEntries: LiveAltOrderRegistryEntry[] = [];
    const enrichTargets: Array<{ rowId: string; meta: AltMeta; tracked: LiveTrackedAltPosition; exitTime: number; reasonSource: 'explicit' | 'order' | 'fallback' }> = [];

    const allKeys = new Set<string>([
      ...Object.keys(liveAltMetaMap),
      ...Object.keys(liveCloseMetaSnapshotMap),
    ]);
    for (const key of allKeys) {
      const meta = liveAltMetaMap[key] ?? liveCloseMetaSnapshotMap[key]?.meta;
      if (!meta) continue;
      const snapTracked = liveCloseMetaSnapshotMap[key]?.tracked;
      const pos = futuresAllPositions.find(p =>
        p.symbol === meta.symbol &&
        Math.abs(p.positionAmt) > 0 &&
        (meta.direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
      );
      if (pos) {
        nextTracked[key] = {
          symbol: pos.symbol,
          direction: meta.direction,
          qty: Math.abs(pos.positionAmt),
          entryPrice: pos.entryPrice,
          markPrice: pos.markPrice,
          leverage: pos.leverage,
          positionSide: pos.positionSide,
          entryTime: pos.entryTime ?? meta.liveEntryTime ?? snapTracked?.entryTime ?? nextTracked[key]?.entryTime,
          seenOpen: true,
        };
        continue;
      }

      const tracked = nextTracked[key] ?? (snapTracked ? {
        symbol: meta.symbol,
        direction: meta.direction,
        qty: snapTracked.qty,
        entryPrice: snapTracked.entryPrice,
        markPrice: markPricesMapRef.current[meta.symbol] ?? 0,
        leverage: snapTracked.leverage,
        positionSide: snapTracked.positionSide,
        entryTime: snapTracked.entryTime ?? meta.liveEntryTime,
        seenOpen: true,
      } : undefined);
      if (!tracked?.seenOpen) continue;

      const rowId = uid();
      const exitTime = Date.now();
      const exitPrice = tracked.markPrice > 0
        ? tracked.markPrice
        : (markPricesMapRef.current[meta.symbol] ?? null);
      const explicitReason = liveCloseReasonHintRef.current[key] ?? liveCloseReasonHintRef.current[`${meta.symbol}_${meta.direction}`];
      const orderEvidenceReason = explicitReason ? null : inferLiveCloseReasonFromOrderEvidence(key);
      const clientSlEvidenceReason = explicitReason || orderEvidenceReason
        ? null
        : inferLiveCloseReasonFromClientSlEvidence(meta.symbol, tracked);
      const closeReason = explicitReason ?? orderEvidenceReason ?? clientSlEvidenceReason ?? inferLiveCloseReason(meta, exitPrice);
      const reasonSource: 'explicit' | 'order' | 'fallback' = explicitReason
        ? 'explicit'
        : ((orderEvidenceReason || clientSlEvidenceReason) ? 'order' : 'fallback');
      const pnl = exitPrice != null
        ? parseFloat((((tracked.direction === 'long' ? exitPrice - tracked.entryPrice : tracked.entryPrice - exitPrice) * tracked.qty)).toFixed(8))
        : null;
      appended.push({
        id: rowId,
        symbol: meta.symbol,
        positionSide: meta.direction === 'long' ? 'LONG' : 'SHORT',
        qty: tracked.qty,
        leverage: tracked.leverage,
        entryPrice: tracked.entryPrice,
        exitPrice,
        pnl,
        fees: null,
        entryTime: tracked.entryTime ?? meta.liveEntryTime ?? null,
        exitTime,
        closeReason,
        isAltTrade: true,
        interval: meta.scanInterval,
        candidateScore: meta.candidateScore,
        plannedEntry: meta.plannedEntry,
        plannedTP: meta.plannedTP,
        plannedSL: meta.plannedSL,
        entrySource: meta.entrySource,
      });
      removeAltManagedDrawingsForCandidate(meta.symbol, meta.candidateId);
      cleanupKeys.push(key);
      const orphan = liveAltOrderRegistryRef.current[key];
      if (orphan) orphanCleanupEntries.push(orphan);
      enrichTargets.push({ rowId, meta, tracked, exitTime, reasonSource });
      delete nextTracked[key];
      delete liveCloseReasonHintRef.current[key];
    }

    liveTrackedRef.current = nextTracked;

    if (appended.length > 0) {
      setLiveHistory(prev => [...appended, ...prev].slice(0, 1000));
      const now = Date.now();
      for (const target of enrichTargets) {
        liveHistoryEnrichQueueRef.current[target.rowId] = {
          rowId: target.rowId,
          meta: target.meta,
          tracked: target.tracked,
          exitTime: target.exitTime,
          reasonSource: target.reasonSource,
          attempts: 0,
          nextAt: now,
          deadlineAt: target.exitTime + 20 * 60 * 1000,
        };
      }
    }
    if (cleanupKeys.length > 0) {
      for (const entry of orphanCleanupEntries) {
        void cleanupAltOrphanOrders(entry);
      }
      setLiveAltMetaMap(prev => {
        const next = { ...prev };
        for (const k of cleanupKeys) delete next[k];
        return next;
      });
      setPendingLiveTPSLMap(prev => {
        const next = { ...prev };
        for (const k of cleanupKeys) delete next[k];
        return next;
      });
      setLiveAltOrderRegistry(prev => {
        const next = { ...prev };
        for (const k of cleanupKeys) delete next[k];
        return next;
      });
      setLiveCloseMetaSnapshotMap(prev => {
        const next = { ...prev };
        for (const k of cleanupKeys) delete next[k];
        return next;
      });
    }
  }, [futuresAllPositions, liveAltMetaMap, liveCloseMetaSnapshotMap, inferLiveCloseReason, inferLiveCloseReasonFromOrderEvidence, inferLiveCloseReasonFromClientSlEvidence, cleanupAltOrphanOrders, enrichLiveHistoryRowFromTrades, removeAltManagedDrawingsForCandidate]);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      const queue = liveHistoryEnrichQueueRef.current;
      const now = Date.now();
      for (const [rowId, task] of Object.entries(queue)) {
        const row = liveHistoryRef.current.find(h => h.id === rowId);
        if (!row) {
          delete queue[rowId];
          continue;
        }
        if (row.entryTime != null && row.fees != null) {
          delete queue[rowId];
          continue;
        }
        if (now > task.deadlineAt || task.attempts >= 60) {
          delete queue[rowId];
          continue;
        }
        if (task.running || now < task.nextAt) continue;

        task.running = true;
        void enrichLiveHistoryRowFromTrades(task.rowId, task.meta, task.tracked, task.exitTime, task.reasonSource)
          .finally(() => {
            const cur = liveHistoryEnrichQueueRef.current[rowId];
            if (!cur) return;
            cur.running = false;
            cur.attempts += 1;
            cur.nextAt = Date.now() + 10_000;
            const latest = liveHistoryRef.current.find(h => h.id === rowId);
            if (!latest || (latest.entryTime != null && latest.fees != null) || Date.now() > cur.deadlineAt || cur.attempts >= 60) {
              delete liveHistoryEnrichQueueRef.current[rowId];
            }
          });
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [enrichLiveHistoryRowFromTrades]);

  const handleLiveCloseMarket = useCallback(async (
    symbol: string,
    direction: 'long' | 'short',
    closeSide: 'BUY' | 'SELL',
    qty: number,
    positionSide: 'LONG' | 'SHORT' | 'BOTH',
  ) => {
    const key = `${symbol}_${direction}`;
    const aliasKey = `${symbol}_${direction}`;
    const prevHint = liveCloseReasonHintRef.current[key];
    const prevAliasHint = liveCloseReasonHintRef.current[aliasKey];
    liveCloseReasonHintRef.current[key] = 'manual';
    liveCloseReasonHintRef.current[aliasKey] = 'manual';
    try {
      await futuresCloseMarket(symbol, closeSide, qty, positionSide);
      addLog('info', `[ALT실전] ${symbol} 수동 시장가 청산 요청 완료`);
    } catch (e) {
      if (prevHint) liveCloseReasonHintRef.current[key] = prevHint;
      else delete liveCloseReasonHintRef.current[key];
      if (prevAliasHint) liveCloseReasonHintRef.current[aliasKey] = prevAliasHint;
      else delete liveCloseReasonHintRef.current[aliasKey];
      addLog('error', `[ALT실전] ${symbol} 수동 시장가 청산 실패: ${e instanceof Error ? e.message : 'unknown'}`);
      throw e;
    }
  }, [addLog, futuresCloseMarket]);

  const handleLiveCloseCurrentPrice = useCallback(async (
    symbol: string,
    direction: 'long' | 'short',
    closeSide: 'BUY' | 'SELL',
    qty: number,
    limitPrice: number,
  ) => {
    const key = `${symbol}_${direction}`;
    const aliasKey = `${symbol}_${direction}`;
    const metaSnapshot = liveAltMetaMapRef.current[key];
    if (metaSnapshot) {
      const pos = futuresAllPositionsRef.current.find(p =>
        p.symbol === symbol &&
        Math.abs(p.positionAmt) > 0 &&
        (direction === 'long' ? p.positionAmt > 0 : p.positionAmt < 0),
      );
      const trackedFromRef = liveTrackedRef.current[key];
      const fallbackTracked = pos ? {
        qty: Math.abs(pos.positionAmt),
        entryPrice: pos.entryPrice,
        leverage: pos.leverage,
        positionSide: pos.positionSide,
        entryTime: pos.entryTime,
      } : trackedFromRef ? {
        qty: trackedFromRef.qty,
        entryPrice: trackedFromRef.entryPrice,
        leverage: trackedFromRef.leverage,
        positionSide: trackedFromRef.positionSide,
        entryTime: trackedFromRef.entryTime,
      } : {
        qty,
        entryPrice: metaSnapshot.plannedEntry,
        leverage: 1,
        positionSide: direction === 'long' ? 'LONG' as const : 'SHORT' as const,
        entryTime: metaSnapshot.liveEntryTime ?? metaSnapshot.liveEntrySubmittedAt,
      };
      setLiveCloseMetaSnapshotMap(prev => ({
        ...prev,
        [key]: {
          meta: metaSnapshot,
          tracked: fallbackTracked,
          capturedAt: Date.now(),
        },
      }));
    }
    const prevHint = liveCloseReasonHintRef.current[key];
    const prevAliasHint = liveCloseReasonHintRef.current[aliasKey];
    liveCloseReasonHintRef.current[key] = 'manual';
    liveCloseReasonHintRef.current[aliasKey] = 'manual';
    try {
      await futuresPlaceOrder(closeSide, limitPrice, qty, 1, 'ISOLATED', true, symbol, 'IOC');
      addLog('info', `[ALT실전] ${symbol} 현재가(IOC) 청산 주문 완료 @ ${limitPrice}`);
    } catch (e) {
      if (prevHint) liveCloseReasonHintRef.current[key] = prevHint;
      else delete liveCloseReasonHintRef.current[key];
      if (prevAliasHint) liveCloseReasonHintRef.current[aliasKey] = prevAliasHint;
      else delete liveCloseReasonHintRef.current[aliasKey];
      addLog('error', `[ALT실전] ${symbol} 현재가(IOC) 청산 실패: ${e instanceof Error ? e.message : 'unknown'}`);
      throw e;
    }
  }, [addLog, futuresPlaceOrder]);

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
  // Paper altMeta monitors are ALWAYS active regardless of isPaperMode — so that
  // auto-trade paper positions continue to be closed (and balance returned) even
  // when the user switches to live mode.
  const altMonitors = [
    ...paperTrading.positions
        .filter(p => p.altMeta)
        .map(p => (
          <AltPositionMonitor
            key={p.id}
            meta={p.altMeta!}
            qty={Math.abs(p.positionAmt)}
            positionSide={p.positionSide}
            paperPosId={p.id}
            onClose={(price, reason) => {
              paperTrading.closePosition(p.id, price, reason);
            }}
            onTimeStopRequest={requestTimeStop}
          />
        )),
    ...(!isPaperMode ? Object.entries(liveAltMetaMap).flatMap(([key, meta]) => {
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
            metaKey={key}
            onCloseMarket={(symbol, closeSide, qty, positionSide) => {
              const aliasKey = `${meta.symbol}_${meta.direction}`;
              const prevHint = liveCloseReasonHintRef.current[key];
              const prevAliasHint = liveCloseReasonHintRef.current[aliasKey];
              liveCloseReasonHintRef.current[key] = 'invalid';
              liveCloseReasonHintRef.current[aliasKey] = 'invalid';
              addLog('info', `[ALT실전] ${symbol} 자동청산 (구조적 무효화) — MARKET ${closeSide} ${qty}`);
              futuresCloseMarket(symbol, closeSide, qty, positionSide)
                .then(() => {
                  addLog('info', `[ALT실전] ${symbol} 청산 주문 완료`);
                })
                .catch((e: unknown) => {
                  if (prevHint) liveCloseReasonHintRef.current[key] = prevHint;
                  else delete liveCloseReasonHintRef.current[key];
                  if (prevAliasHint) liveCloseReasonHintRef.current[aliasKey] = prevAliasHint;
                  else delete liveCloseReasonHintRef.current[aliasKey];
                  addLog('error', `[ALT실전] ${symbol} 청산 실패: ${e instanceof Error ? e.message : 'unknown'}`);
                });
            }}
            onTimeStopRequest={requestTimeStop}
          />
        )];
      }) : []),
  ];

  // ── Error notification ───────────────────────────────────────────────────
  const errorLogs = logs.filter(l => l.type === 'error');
  const clearErrors = useCallback(() => {
    setLogs(prev => prev.filter(l => l.type !== 'error'));
  }, []);

  return (
    <div style={styles.root}>
      {backgroundMonitors}
      {altMonitors}
      {activeTimeStopRequest && (
        <TimeStopDecisionModal
          req={activeTimeStopRequest}
          nowMs={timeStopNowMs}
          onCloseModal={() => {
            setHiddenTimeStopKeys(prev => ({ ...prev, [activeTimeStopRequest.key]: true }));
          }}
          onCloseNow={(reqKey) => { void executeTimeStopClose(reqKey, 'confirm'); }}
          onApplyTightenAndExtend={(reqKey, extendBars, applyTp) => {
            void applyTightenAndExtend(reqKey, extendBars, applyTp);
          }}
        />
      )}

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
        onOpenSoundSettings={() => setShowSoundSettings(true)}
        onOpenAutoTradeSettings={() => setShowAutoTradeSettings(true)}
        isAutoTradeActive={altAutoTrade.isActive}
        autoTradeScanning={altAutoTrade.scanning}
        onToggleAutoTrade={() => { void handleToggleAutoTrade(); }}
        onTriggerAutoTradeNow={() => { void handleTriggerAutoTradeNow(); }}
        autoTradeMode={autoTradeMode}
        autoTradeCadenceMinutes={(autoTradeMode === 'live' ? liveAutoTradeSettings : paperAutoTradeSettings).scanCadenceMinutes}
        onChangeAutoTradeMode={handleChangeAutoTradeMode}
        isMobile={isMobile}
        mobilePanel={mobilePanel}
        onToggleMobilePanel={(panel) => setMobilePanel(p => p === panel ? 'none' : panel)}
        errorLogs={errorLogs}
        onClearErrors={clearErrors}
      />
      {autoTradeLeaderNotice && (
        <div style={styles.autoTradeLockNotice}>
          {autoTradeLeaderNotice}
        </div>
      )}

      {showAutoTradeSettings && (
        <AutoTradeSettingsModal
          paperSettings={paperAutoTradeSettings}
          liveSettings={liveAutoTradeSettings}
          onSave={(paper, live) => {
            setPaperAutoTradeSettings(normalizeAutoTradeSettings(DEFAULT_AUTO_TRADE_SETTINGS, paper));
            setLiveAutoTradeSettings(normalizeAutoTradeSettings(DEFAULT_LIVE_AUTO_TRADE_SETTINGS, live));
          }}
          onClose={() => setShowAutoTradeSettings(false)}
          initialTab={autoTradeMode}
        />
      )}

      {showSoundSettings && (
        <SoundSettingsModal
          config={soundPlayer.config}
          onUpdate={soundPlayer.updateConfig}
          onPlayEntry={soundPlayer.playEntry}
          onPlayTp={soundPlayer.playTp}
          onPlaySl={soundPlayer.playSl}
          onClose={() => setShowSoundSettings(false)}
        />
      )}

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
            if (altScannerSnapshotMeta?.symbol === symbol) {
              openAltInMain(altScannerSnapshotMeta);
              return;
            }
            handleTickerSelect(symbol, true);
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
          onOpenAltInMain={openAltInMain}
          liveAltMetaMap={liveAltMetaMap}
          liveAltOrderTagMap={liveAltOrderTagMap}
          liveAltEntryOrderTagMap={liveAltEntryOrderTagMap}
          liveHistory={liveHistory}
          liveBalanceHistory={liveBalanceHistory}
          onLiveCloseMarket={handleLiveCloseMarket}
          onLiveCloseCurrentPrice={handleLiveCloseCurrentPrice}
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
  autoTradeLockNotice: {
    margin: '6px 10px 0',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid rgba(240,185,11,0.45)',
    background: 'rgba(240,185,11,0.12)',
    color: '#f0b90b',
    fontSize: '0.82rem',
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
