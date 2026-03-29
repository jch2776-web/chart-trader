import React from 'react';
import type { Interval } from '../types/candle';
import type { DrawingMode } from '../types/drawing';
import { DRAWING_COLORS } from '../types/drawing';
import type { IndicatorConfig } from './Chart/useChartRenderer';
import { ErrorNotificationBell } from './ErrorNotificationBell';
import type { ActivityLog } from '../types/trade';

interface Props {
  interval: Interval;
  onIntervalChange: (i: Interval) => void;
  drawingMode: DrawingMode;
  onDrawingModeChange: (m: DrawingMode) => void;
  fontSize: number;
  onFontSizeChange: (n: number) => void;
  activeColor: string;
  onActiveColorChange: (c: string) => void;
  isMultiMode: boolean;
  onToggleMultiMode: () => void;
  isPaperMode: boolean;
  onTogglePaperMode: () => void;
  indicators: IndicatorConfig;
  onToggleIndicator: (name: keyof IndicatorConfig) => void;
  onOpenBoard: () => void;
  onOpenUserBoard?: () => void;
  onOpenSecurityFaq?: () => void;
  onOpenAltScanner?: () => void;
  onOpenSoundSettings?: () => void;
  onOpenAutoTradeSettings?: () => void;
  onOpenScalpSettings?: () => void;
  /** Direct start/stop toggle — validation is done in App before calling */
  onToggleScalp?: () => void;
  isScalpActive?: boolean;
  isAutoTradeActive?: boolean;
  autoTradeScanning?: boolean;
  autoScanProgress?: { interval: string; done: number; total: number };
  onToggleAutoTrade?: () => void;
  onTriggerAutoTradeNow?: () => void;
  autoTradeMode?: 'paper' | 'live';
  autoTradeCadenceMinutes?: number;
  onChangeAutoTradeMode?: (m: 'paper' | 'live') => void;
  isMobile?: boolean;
  mobilePanel?: 'none' | 'tickers' | 'settings';
  onToggleMobilePanel?: (panel: 'tickers' | 'settings') => void;
  // Scalp status
  scalpMode?: 'paper' | 'live';
  scalpActiveOrderCount?: number;
  scalpBreakOpen?: boolean;
  scalpStreamConnected?: boolean;
  scalpStats?: {
    sessionTrades: number;
    exposureUsd: number;
    symbolCount: number;
    signalMode: string;
    maxSpreadBps: number;
    minDepthUsd: number;
    maxPerTradeRiskUsd: number;
  };
  // Notification bell
  errorLogs?: ActivityLog[];
  onClearErrors?: () => void;
  // Live account stats (real-time display)
  liveBalance?: number;
  liveMarginBalance?: number;
  liveUnrealizedPnl?: number;
  // Paper account stats
  paperBalance?: number;
  paperUnrealizedPnl?: number;
  // Binance API weight usage (0–2400)
  apiWeightUsed?: number;
}

const INTERVALS: Interval[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

const FONT_MIN = 11;
const FONT_MAX = 36;

export function Toolbar({
  interval, onIntervalChange, drawingMode, onDrawingModeChange,
  fontSize, onFontSizeChange, activeColor, onActiveColorChange,
  isMultiMode, onToggleMultiMode, isPaperMode, onTogglePaperMode,
  indicators, onToggleIndicator,
  onOpenBoard, onOpenUserBoard, onOpenSecurityFaq, onOpenAltScanner, onOpenSoundSettings, onOpenAutoTradeSettings, onOpenScalpSettings,
  onToggleScalp,
  isAutoTradeActive, isScalpActive, autoTradeScanning, onToggleAutoTrade, onTriggerAutoTradeNow,
  autoTradeMode = 'paper', autoTradeCadenceMinutes = 60, onChangeAutoTradeMode,
  autoScanProgress,
  isMobile, mobilePanel, onToggleMobilePanel,
  scalpMode, scalpActiveOrderCount = 0, scalpBreakOpen, scalpStreamConnected, scalpStats,
  errorLogs = [], onClearErrors,
  liveBalance, liveMarginBalance, liveUnrealizedPnl,
  paperBalance, paperUnrealizedPnl,
  apiWeightUsed,
}: Props) {
  const toggleMode = (m: DrawingMode) => {
    onDrawingModeChange(drawingMode === m ? 'none' : m);
  };
  const cadence = Math.max(15, Math.round(autoTradeCadenceMinutes || 60));
  const cadenceLabel = cadence >= 60 && cadence % 60 === 0 ? `${cadence / 60}시간` : `${cadence}분`;

  // ── Scalp quick-info popover ────────────────────────────────────────────
  const [showScalpInfo, setShowScalpInfo] = React.useState(false);
  const [scalpInfoPos, setScalpInfoPos] = React.useState<{ top: number; right: number }>({ top: 44, right: 0 });
  const scalpChipRef = React.useRef<HTMLButtonElement>(null);
  const scalpPopRef  = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!showScalpInfo) return;
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      if (
        scalpChipRef.current && !scalpChipRef.current.contains(target) &&
        scalpPopRef.current  && !scalpPopRef.current.contains(target)
      ) {
        setShowScalpInfo(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showScalpInfo]);

  function handleChipClick() {
    if (showScalpInfo) { setShowScalpInfo(false); return; }
    const rect = scalpChipRef.current?.getBoundingClientRect();
    if (rect) {
      setScalpInfoPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setShowScalpInfo(true);
  }

  // Chip label + color
  let chipLabel: string;
  let chipColor: string;
  let chipBg: string;
  let chipBorder: string;
  if (!isScalpActive) {
    chipLabel = 'SCALP OFF';
    chipColor = '#5e6673';
    chipBg = 'none';
    chipBorder = '#2a2e39';
  } else if (scalpMode === 'live') {
    chipLabel = scalpBreakOpen
      ? 'SCALP LIVE ⛔'
      : `SCALP LIVE ${scalpStreamConnected ? '●' : '○'}${scalpActiveOrderCount > 0 ? ` ${scalpActiveOrderCount}ord` : ''}`;
    chipColor = scalpBreakOpen ? '#f6465d' : '#f0b90b';
    chipBg = scalpBreakOpen ? 'rgba(246,70,93,0.10)' : 'rgba(240,185,11,0.10)';
    chipBorder = scalpBreakOpen ? 'rgba(246,70,93,0.50)' : 'rgba(240,185,11,0.50)';
  } else {
    chipLabel = `SCALP PAPER${scalpActiveOrderCount > 0 ? ` ● ${scalpActiveOrderCount}ord` : ''}`;
    chipColor = '#0ecb81';
    chipBg = 'rgba(14,203,129,0.08)';
    chipBorder = 'rgba(14,203,129,0.40)';
  }

  return (
    <div style={styles.toolbar}>
      {/* Mobile panel nav buttons — shown at front of toolbar on mobile */}
      {isMobile && (
        <>
          <button
            style={{ ...styles.mobileNavBtn, ...(mobilePanel === 'tickers' ? styles.mobileNavActive : {}) }}
            onClick={() => onToggleMobilePanel?.('tickers')}
          >
            ☰ 종목
          </button>
          <button
            style={{ ...styles.mobileNavBtn, ...(mobilePanel === 'settings' ? styles.mobileNavActive : {}) }}
            onClick={() => onToggleMobilePanel?.('settings')}
          >
            ⚙ 설정
          </button>
          <div style={styles.divider} />
        </>
      )}

      {/* Intervals — hidden in multi-panel mode (each panel has its own) */}
      {!isMultiMode && (
        <div style={styles.intervalGroup}>
          {INTERVALS.map(iv => (
            <button
              key={iv}
              style={{ ...styles.intervalBtn, ...(interval === iv ? styles.intervalActive : {}) }}
              onClick={() => onIntervalChange(iv)}
            >
              {iv}
            </button>
          ))}
        </div>
      )}

      {!isMultiMode && <div style={styles.divider} />}

      {/* Drawing tools — hidden in multi-panel mode */}
      {!isMultiMode && (
        <div style={styles.drawingGroup}>
          <button
            style={{ ...styles.drawBtn, ...(drawingMode === 'none' ? styles.drawActive : {}) }}
            onClick={() => onDrawingModeChange('none')}
            title="포인터 (Esc)"
          >
            ↖
          </button>
          <button
            style={{ ...styles.drawBtn, ...(drawingMode === 'trendline' ? styles.drawTrendlineActive : {}) }}
            onClick={() => toggleMode('trendline')}
            title="추세선 그리기"
          >
            ╱ 추세선
          </button>
          <button
            style={{ ...styles.drawBtn, ...(drawingMode === 'box' ? styles.drawBoxActive : {}) }}
            onClick={() => toggleMode('box')}
            title="박스 그리기"
          >
            □ 박스
          </button>
          <button
            style={{ ...styles.drawBtn, ...(drawingMode === 'hline' ? styles.drawHlineActive : {}) }}
            onClick={() => toggleMode('hline')}
            title="수평선 그리기"
          >
            — 수평선
          </button>
          <button
            style={{ ...styles.drawBtn, ...(drawingMode === 'fib' ? styles.drawFibActive : {}) }}
            onClick={() => toggleMode('fib')}
            title="피보나치 되돌림 (두 점 클릭)"
          >
            ⟨⟩ 피보나치
          </button>
          <button
            style={{ ...styles.drawBtn, ...(drawingMode === 'pricerange' ? styles.drawPriceRangeActive : {}) }}
            onClick={() => toggleMode('pricerange')}
            title="가격 범위 측정 (두 점 클릭)"
          >
            ↕ 가격범위
          </button>
          <button
            style={{ ...styles.drawBtn, ...(drawingMode === 'daterange' ? styles.drawDateRangeActive : {}) }}
            onClick={() => toggleMode('daterange')}
            title="기간 범위 측정 (두 점 클릭)"
          >
            ↔ 기간범위
          </button>
        </div>
      )}

      {/* Indicator toggles */}
      {!isMultiMode && (
        <>
          <div style={styles.divider} />
          <div style={styles.indicatorGroup}>
            <span style={styles.indicatorLabel}>지표</span>
            <button
              style={{ ...styles.indicatorBtn, ...(indicators.coinDuckMABB ? styles.indicatorActive : {}) }}
              onClick={() => onToggleIndicator('coinDuckMABB')}
              title="코인덕 MA&BB&LCH (MA5/10/20/60/120/200 + 볼린저밴드 + 일목균형표)"
            >MA&amp;BB&amp;LCH</button>
            <button
              style={{ ...styles.indicatorBtn, ...(indicators.dwCloud ? styles.indicatorDWActive : {}) }}
              onClick={() => onToggleIndicator('dwCloud')}
              title="Divergence-Weighted Clouds (EMA9/26 구름)"
            >DW구름</button>
          </div>
        </>
      )}

      {/* Color swatches — shown only when a drawing tool is active */}
      {!isMultiMode && drawingMode !== 'none' && (
        <>
          <div style={styles.divider} />
          <div style={styles.colorGroup}>
            {DRAWING_COLORS.map(c => (
              <button
                key={c}
                title={c}
                style={{
                  ...styles.colorDot,
                  background: c,
                  boxShadow: activeColor === c ? `0 0 0 2px #131722, 0 0 0 4px ${c}` : 'none',
                  transform: activeColor === c ? 'scale(1.25)' : 'scale(1)',
                }}
                onClick={() => onActiveColorChange(c)}
              />
            ))}
          </div>
        </>
      )}

      {/* Push right */}
      <div style={{ flex: 1 }} />

      <div style={styles.divider} />

      {/* Font size control */}
      <div style={styles.fontGroup}>
        <button
          style={{ ...styles.fontBtn, opacity: fontSize <= FONT_MIN ? 0.35 : 1 }}
          onClick={() => onFontSizeChange(Math.max(FONT_MIN, fontSize - 1))}
          title="글자 작게"
          disabled={fontSize <= FONT_MIN}
        >
          A−
        </button>
        <span style={styles.fontLabel}>{fontSize}px</span>
        <button
          style={{ ...styles.fontBtn, opacity: fontSize >= FONT_MAX ? 0.35 : 1 }}
          onClick={() => onFontSizeChange(Math.min(FONT_MAX, fontSize + 1))}
          title="글자 크게"
          disabled={fontSize >= FONT_MAX}
        >
          A+
        </button>
      </div>

      <div style={styles.divider} />

      {/* Multi-panel toggle */}
      <button
        style={{ ...styles.featureBtn, ...(isMultiMode ? styles.featureBtnBlue : {}) }}
        onClick={onToggleMultiMode}
        title={isMultiMode ? '단일 차트로 돌아가기' : '다중 분할 모니터링'}
      >
        {isMultiMode ? '✕ 단일 차트' : '⊞ 분할'}
      </button>

      {/* Paper trading toggle */}
      <button
        style={{ ...styles.featureBtn, ...(isPaperMode ? styles.featureBtnYellow : {}) }}
        onClick={onTogglePaperMode}
        title={isPaperMode ? '모의거래 모드 ON — 클릭하여 해제' : '모의거래 모드 (실제 주문 없음)'}
      >
        📄 모의거래
      </button>

      {/* Board button */}
      <button
        style={styles.featureBtn}
        onClick={onOpenBoard}
        title="도형 게시판"
      >
        📋 도형게시판
      </button>

      {/* Alt scanner button */}
      <button
        style={styles.featureBtn}
        onClick={onOpenAltScanner}
        title="알트추천 (돌파 스캐너)"
      >
        🔍 알트추천
      </button>

      {/* Auto trade mode toggle [모의] [실전] */}
      {onChangeAutoTradeMode && (
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          <button
            style={{ ...styles.modeBtn, ...(autoTradeMode === 'paper' ? styles.modeBtnActivePaper : {}) }}
            onClick={() => onChangeAutoTradeMode('paper')}
            title="모의 자동매매"
          >모의</button>
          <button
            style={{ ...styles.modeBtn, ...(autoTradeMode === 'live' ? styles.modeBtnActiveLive : {}) }}
            onClick={() => onChangeAutoTradeMode('live')}
            title="실전 자동매매 (실제 주문 발생)"
          >실전</button>
        </div>
      )}

      {/* Auto trade toggle */}
      <button
        onClick={onToggleAutoTrade}
        title={isAutoTradeActive
          ? `자동매매 끄기 (현재 주기: ${cadenceLabel})`
          : `자동매매 켜기 (${cadenceLabel} 경계마다 스캔, 90점+ 상위 2개 진입)`}
        style={{
          ...styles.featureBtn,
          ...(isAutoTradeActive ? (autoTradeMode === 'live' ? styles.featureBtnRed : styles.featureBtnGreen) : {}),
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          justifyContent: isAutoTradeActive ? 'flex-end' : 'flex-start',
          width: 26, height: 13, borderRadius: 7,
          background: isAutoTradeActive ? (autoTradeMode === 'live' ? '#f6465d' : '#0ecb81') : '#3a4455',
          transition: 'background 0.2s', flexShrink: 0,
          padding: '0 2px', boxSizing: 'border-box',
        }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%', background: '#fff', flexShrink: 0,
          }} />
        </span>
        {autoTradeScanning
          ? autoScanProgress
            ? `⟳ [${autoScanProgress.interval}] ${autoScanProgress.done}/${autoScanProgress.total}`
            : '⟳ 스캔 준비 중...'
          : autoTradeMode === 'live' ? '⚡ 자동매매(실전)' : '⚡ 자동매매(모의)'}
      </button>
      {isAutoTradeActive && !autoTradeScanning && (
        <button
          onClick={onTriggerAutoTradeNow}
          title="지금 즉시 스캔 실행"
          style={{ ...styles.featureBtn, ...styles.featureBtnYellow }}
        >▶ 즉시실행</button>
      )}

      {/* Auto trade settings button */}
      <button
        style={styles.featureBtn}
        onClick={onOpenAutoTradeSettings}
        title={`자동매매 진입 설정 (레버리지 · 마진 · 무인 스캔 주기: ${cadenceLabel})`}
      >
        ⚙ 자동설정
      </button>

      {/* ── Scalp section ─────────────────────────────────────────────────── */}
      <div style={styles.divider} />

      {/* Scalp status chip — click to open quick-info popover */}
      <button
        ref={scalpChipRef}
        style={{
          ...styles.featureBtn,
          background: chipBg,
          border: `1px solid ${chipBorder}`,
          color: chipColor,
          fontFamily: '"SF Mono", Consolas, monospace',
          fontSize: '0.72rem',
          letterSpacing: '0.02em',
          fontWeight: 700,
          paddingLeft: 8,
          paddingRight: 8,
        }}
        onClick={handleChipClick}
        title="스캘핑 상태 — 클릭하여 요약 보기"
      >
        {chipLabel}
      </button>

      {/* Scalp direct start/stop toggle */}
      {onToggleScalp && (
        <button
          style={{
            ...styles.featureBtn,
            display: 'flex', alignItems: 'center', gap: 5,
            ...(isScalpActive
              ? { background: 'rgba(246,70,93,0.10)', border: '1px solid rgba(246,70,93,0.55)', color: '#f6465d' }
              : { background: 'rgba(14,203,129,0.10)', border: '1px solid rgba(14,203,129,0.55)', color: '#0ecb81' }),
          }}
          onClick={onToggleScalp}
          title={isScalpActive ? '스캘핑 정지' : '스캘핑 시작'}
        >
          {/* Toggle knob — same style as auto-trade */}
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            justifyContent: isScalpActive ? 'flex-end' : 'flex-start',
            width: 26, height: 13, borderRadius: 7,
            background: isScalpActive ? '#f6465d' : '#0ecb81',
            transition: 'background 0.2s', flexShrink: 0,
            padding: '0 2px', boxSizing: 'border-box',
          }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />
          </span>
          {isScalpActive ? '⏹ 스캘핑 정지' : '▶ 스캘핑 시작'}
        </button>
      )}

      {/* Scalp settings gear button — opens full settings modal */}
      <button
        style={{
          ...styles.featureBtn,
          ...(isScalpActive ? { background: '#f0b90b22', border: '1px solid #f0b90b55', color: '#f0b90b' } : {}),
        }}
        onClick={onOpenScalpSettings}
        title="초단타 스캘핑 자동매매 상세 설정"
      >
        ⚙ 스캘핑설정
      </button>

      {/* ── Quick-info popover ─────────────────────────────────────────────── */}
      {showScalpInfo && (
        <div
          ref={scalpPopRef}
          style={{
            position: 'fixed',
            top: scalpInfoPos.top,
            right: scalpInfoPos.right,
            zIndex: 9200,
            background: '#1a2232',
            border: '1px solid #2d3a4e',
            borderRadius: 8,
            padding: '12px 16px',
            minWidth: 220,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            color: '#c9d1d9',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 12,
          }}
        >
          {/* Header */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8b9db0', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            스캘핑 요약
          </div>

          {/* Session stats — only when active */}
          {isScalpActive && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #2d3a4e' }}>
              <Stat label="세션 진입" value={String(scalpStats?.sessionTrades ?? 0)} />
              <Stat label="노출 (USD)" value={`$${(scalpStats?.exposureUsd ?? 0).toFixed(1)}`} />
              <Stat label="활성 주문" value={String(scalpActiveOrderCount)} />
              <Stat label="스트림" value={scalpMode === 'live' ? (scalpStreamConnected ? '● 연결' : '○ 끊김') : 'PAPER'} valueColor={scalpMode === 'live' ? (scalpStreamConnected ? '#0ecb81' : '#f6465d') : '#0ecb81'} />
            </div>
          )}

          {/* Settings snapshot */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <Stat label="심볼" value={`${scalpStats?.symbolCount ?? 0}개`} />
            <Stat label="신호 모드" value={scalpStats?.signalMode ?? '—'} />
            <Stat label="최대 스프레드" value={scalpStats ? `${scalpStats.maxSpreadBps}bps` : '—'} />
            <Stat label="최소 뎁스" value={scalpStats ? (scalpStats.minDepthUsd > 0 ? `$${(scalpStats.minDepthUsd / 1000).toFixed(0)}k` : 'OFF') : '—'} />
            <Stat label="최대 리스크" value={scalpStats ? `$${scalpStats.maxPerTradeRiskUsd}` : '—'} />
          </div>

          {/* Breaker warning */}
          {scalpBreakOpen && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#f6465d', fontWeight: 700 }}>
              ⛔ 연속 손실 차단기 동작 중
            </div>
          )}

          {/* Footer hint */}
          <div style={{ marginTop: 10, fontSize: 10, color: '#3a4a5a', borderTop: '1px solid #2d3a4e', paddingTop: 8 }}>
            ⚙ 상세 설정은 [스캘핑설정] 버튼
          </div>
        </div>
      )}

      {/* User board button */}
      <button
        style={styles.featureBtn}
        onClick={onOpenUserBoard}
        title="유저 게시판"
      >
        💬 유저게시판
      </button>

      {/* Security FAQ button */}
      <button
        style={styles.featureBtn}
        onClick={onOpenSecurityFaq}
        title="보안 FAQ"
      >
        🔒 보안FAQ
      </button>

      {/* ── Realtime account stats ────────────────── */}
      {isPaperMode ? (
        paperBalance != null && (
          <div style={styles.statsStrip}>
            <div style={styles.statItem}>
              <span style={styles.statLabel}>잔고</span>
              <span style={styles.statValue}>${paperBalance.toFixed(2)}</span>
            </div>
            {paperUnrealizedPnl != null && (
              <>
                <div style={styles.statDivider} />
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>미실현</span>
                  <span style={{ ...styles.statValue, color: paperUnrealizedPnl >= 0 ? '#0ecb81' : '#f6465d' }}>
                    {paperUnrealizedPnl >= 0 ? '+' : ''}{paperUnrealizedPnl.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>
        )
      ) : (
        (liveBalance != null || liveMarginBalance != null) && (
          <div style={styles.statsStrip}>
            {liveBalance != null && (
              <div style={styles.statItem}>
                <span style={styles.statLabel}>가용</span>
                <span style={styles.statValue}>${liveBalance.toFixed(2)}</span>
              </div>
            )}
            {liveUnrealizedPnl != null && (
              <>
                <div style={styles.statDivider} />
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>미실현</span>
                  <span style={{ ...styles.statValue, color: liveUnrealizedPnl >= 0 ? '#0ecb81' : '#f6465d' }}>
                    {liveUnrealizedPnl >= 0 ? '+' : ''}{liveUnrealizedPnl.toFixed(2)}
                  </span>
                </div>
              </>
            )}
            {liveMarginBalance != null && (
              <>
                <div style={styles.statDivider} />
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>마진잔고</span>
                  <span style={styles.statValue}>${liveMarginBalance.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        )
      )}

      {/* ── Binance API weight gauge ────────────────── */}
      {(() => {
        const w = apiWeightUsed ?? 0;
        const HARD = 2400;
        const pct = Math.min(100, (w / HARD) * 100);
        const barColor = w >= 1800 ? '#f6465d' : w >= 1200 ? '#f0b90b' : '#0ecb81';
        const bgColor = w >= 1800 ? 'rgba(246,70,93,0.12)' : w >= 1200 ? 'rgba(240,185,11,0.10)' : 'rgba(14,203,129,0.08)';
        return (
          <div
            style={{
              ...styles.weightGauge,
              background: bgColor,
              border: `1px solid ${barColor}44`,
              borderRadius: 5,
              padding: '0 7px',
              gap: 4,
              height: 26,
              boxSizing: 'border-box',
            }}
            title={`바이낸스 API 가중치: ${w} / ${HARD}\n소프트 한도: 1800 / 분\n현재 ${pct.toFixed(0)}% 사용 중`}
          >
            <span style={{ fontSize: '0.62rem', color: '#5e6e82', fontWeight: 600, letterSpacing: '0.01em' }}>API</span>
            <div style={styles.weightBarTrack}>
              <div style={{ ...styles.weightBarFill, width: `${pct}%`, background: barColor }} />
              <div style={styles.weightSoftMark} />
            </div>
            <span style={{ ...styles.weightNum, color: barColor, minWidth: 26 }}>{pct.toFixed(0)}%</span>
          </div>
        );
      })()}

      {/* Sound settings button */}
      <button
        style={styles.featureBtn}
        onClick={onOpenSoundSettings}
        title="매매음 설정"
      >
        🔊
      </button>

      {/* Error notification bell */}
      <ErrorNotificationBell
        logs={errorLogs}
        onClear={onClearErrors ?? (() => {})}
      />
    </div>
  );
}

// ── Compact stat cell (used in popover) ───────────────────────────────────────

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#4a5a70', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: valueColor ?? '#c9d1d9', fontFamily: '"SF Mono", Consolas, monospace' }}>
        {value}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    height: 40,
    background: '#1e222d',
    borderBottom: '1px solid #2a2e39',
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: 8,
    overflowX: 'auto',
    overflowY: 'hidden',
    flexShrink: 0,
  },
  intervalGroup: {
    display: 'flex',
    gap: 0,
    flexShrink: 0,
  },
  intervalBtn: {
    background: 'none',
    border: 'none',
    borderRadius: 3,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.92rem',
    fontWeight: 500,
    padding: '0 10px',
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'all 0.1s',
    fontFamily: '"SF Mono", Consolas, monospace',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  intervalActive: {
    color: '#f0b90b',
    background: 'rgba(240,185,11,0.1)',
  },
  divider: {
    width: 1,
    height: 20,
    background: '#2a2e39',
    margin: '0 4px',
    flexShrink: 0,
  },
  drawingGroup: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    flexShrink: 0,
  },
  drawBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    padding: '0 10px',
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  drawActive: {
    borderColor: '#444',
    color: '#d1d4dc',
    background: '#2a2e39',
  },
  drawTrendlineActive: {
    borderColor: '#4a90d9',
    color: '#4a90d9',
    background: 'rgba(74,144,217,0.12)',
  },
  drawBoxActive: {
    borderColor: '#f0b90b',
    color: '#f0b90b',
    background: 'rgba(240,185,11,0.1)',
  },
  drawHlineActive: {
    borderColor: '#0ecb81',
    color: '#0ecb81',
    background: 'rgba(14,203,129,0.1)',
  },
  drawFibActive: {
    borderColor: '#e8b73a',
    color: '#e8b73a',
    background: 'rgba(232,183,58,0.12)',
  },
  drawPriceRangeActive: {
    borderColor: '#22d3ee',
    color: '#22d3ee',
    background: 'rgba(34,211,238,0.1)',
  },
  drawDateRangeActive: {
    borderColor: '#a855f7',
    color: '#a855f7',
    background: 'rgba(168,85,247,0.1)',
  },
  // ── Color swatches ────────────────────────────────────────────────────────
  colorGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    transition: 'transform 0.1s, box-shadow 0.1s',
  } as React.CSSProperties,
  // ── Font controls ─────────────────────────────────────────────────────────
  fontGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  fontBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '0 7px',
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: '"SF Mono", Consolas, monospace',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  fontLabel: {
    color: '#5e6673',
    fontSize: '0.77rem',
    fontFamily: '"SF Mono", Consolas, monospace',
    minWidth: 30,
    textAlign: 'center' as const,
  },
  // ── Feature buttons (right side) — shared base ───────────────────────────
  featureBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 600,
    padding: '0 10px',
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  },
  featureBtnYellow: {
    borderColor: 'rgba(240,185,11,0.55)',
    color: '#f0b90b',
    background: 'rgba(240,185,11,0.10)',
  },
  featureBtnGreen: {
    borderColor: 'rgba(14,203,129,0.55)',
    color: '#0ecb81',
    background: 'rgba(14,203,129,0.10)',
  },
  featureBtnBlue: {
    borderColor: 'rgba(59,139,235,0.55)',
    color: '#3b8beb',
    background: 'rgba(59,139,235,0.10)',
  },
  featureBtnRed: {
    borderColor: 'rgba(246,70,93,0.55)',
    color: '#f6465d',
    background: 'rgba(246,70,93,0.10)',
  },
  // ── Auto trade mode mini-toggle ───────────────────────────────────────────
  modeBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 3,
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '0 6px',
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.1s',
    boxSizing: 'border-box' as const,
  },
  modeBtnActivePaper: {
    borderColor: 'rgba(14,203,129,0.5)',
    color: '#0ecb81',
    background: 'rgba(14,203,129,0.1)',
  },
  modeBtnActiveLive: {
    borderColor: 'rgba(246,70,93,0.5)',
    color: '#f6465d',
    background: 'rgba(246,70,93,0.1)',
  },
  // ── Indicator toggles ────────────────────────────────────────────────────
  indicatorGroup: {
    display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
  },
  indicatorLabel: {
    color: '#5e6673', fontSize: '0.77rem', fontFamily: '"SF Mono", Consolas, monospace', whiteSpace: 'nowrap' as const,
  },
  indicatorBtn: {
    background: 'none', border: '1px solid #2a2e39', borderRadius: 4,
    color: '#848e9c', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500,
    padding: '0 8px', height: 26, display: 'inline-flex', alignItems: 'center',
    transition: 'all 0.1s', fontFamily: 'inherit',
    flexShrink: 0, whiteSpace: 'nowrap' as const, boxSizing: 'border-box' as const,
  },
  indicatorActive: {
    borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.1)',
  },
  indicatorDWActive: {
    borderColor: '#22d3ee', color: '#22d3ee', background: 'rgba(34,211,238,0.1)',
  },
  // ── Mobile nav buttons ────────────────────────────────────────────────────
  mobileNavBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '4px 12px',
    fontFamily: 'inherit',
    flexShrink: 0,
    transition: 'all 0.1s',
  },
  mobileNavActive: {
    borderColor: '#3b8beb',
    color: '#3b8beb',
    background: 'rgba(59,139,235,0.1)',
  },
  // ── Realtime stats strip ─────────────────────────────────────────────────
  statsStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
    padding: '0 10px',
    height: 26,
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  // ── API weight gauge ──────────────────────────────────────────────────────
  weightGauge: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    cursor: 'default',
  },
  weightLabel: {
    fontSize: '0.7rem',
    fontWeight: 700,
    whiteSpace: 'nowrap' as const,
    letterSpacing: '0.02em',
  },
  weightBarTrack: {
    position: 'relative' as const,
    width: 48,
    height: 5,
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'visible' as const,
    flexShrink: 0,
  },
  weightBarFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.6s ease, background 0.3s',
  },
  weightSoftMark: {
    position: 'absolute' as const,
    left: '75%',
    top: -2,
    width: 1,
    height: 9,
    background: 'rgba(255,255,255,0.25)',
  },
  weightNum: {
    fontSize: '0.68rem',
    fontWeight: 700,
    fontFamily: '"SF Mono", Consolas, monospace',
    whiteSpace: 'nowrap' as const,
    minWidth: 28,
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 0,
    padding: '0 8px',
  },
  statLabel: {
    fontSize: '0.6rem',
    color: '#4a5a70',
    fontWeight: 600,
    letterSpacing: '0.03em',
    textTransform: 'uppercase' as const,
    lineHeight: 1.2,
  },
  statValue: {
    fontSize: '0.75rem',
    color: '#b8c8d8',
    fontWeight: 700,
    fontFamily: '"SF Mono", Consolas, monospace',
    lineHeight: 1.3,
  },
  statDivider: {
    width: 1,
    height: 22,
    background: 'rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
};
