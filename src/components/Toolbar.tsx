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
  isAutoTradeActive?: boolean;
  autoTradeScanning?: boolean;
  onToggleAutoTrade?: () => void;
  onTriggerAutoTradeNow?: () => void;
  autoTradeMode?: 'paper' | 'live';
  onChangeAutoTradeMode?: (m: 'paper' | 'live') => void;
  isMobile?: boolean;
  mobilePanel?: 'none' | 'tickers' | 'settings';
  onToggleMobilePanel?: (panel: 'tickers' | 'settings') => void;
  // Error notification
  errorLogs?: ActivityLog[];
  onClearErrors?: () => void;
}

const INTERVALS: Interval[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

const FONT_MIN = 11;
const FONT_MAX = 36;

export function Toolbar({
  interval, onIntervalChange, drawingMode, onDrawingModeChange,
  fontSize, onFontSizeChange, activeColor, onActiveColorChange,
  isMultiMode, onToggleMultiMode, isPaperMode, onTogglePaperMode,
  indicators, onToggleIndicator,
  onOpenBoard, onOpenUserBoard, onOpenSecurityFaq, onOpenAltScanner, onOpenSoundSettings, onOpenAutoTradeSettings,
  isAutoTradeActive, autoTradeScanning, onToggleAutoTrade, onTriggerAutoTradeNow,
  autoTradeMode = 'paper', onChangeAutoTradeMode,
  isMobile, mobilePanel, onToggleMobilePanel,
  errorLogs = [], onClearErrors,
}: Props) {
  const toggleMode = (m: DrawingMode) => {
    onDrawingModeChange(drawingMode === m ? 'none' : m);
  };

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
        title={isAutoTradeActive ? '자동매매 끄기' : '자동매매 켜기 (매 정각 1h→4h→1d 스캔, 90점+ 상위 2개 자동 진입)'}
        style={{
          ...styles.featureBtn,
          ...(isAutoTradeActive ? (autoTradeMode === 'live' ? styles.featureBtnRed : styles.featureBtnGreen) : {}),
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        <span style={{
          display: 'inline-block', width: 26, height: 13, borderRadius: 7, position: 'relative',
          background: isAutoTradeActive ? (autoTradeMode === 'live' ? '#f6465d' : '#0ecb81') : '#3a4455',
          transition: 'background 0.2s', flexShrink: 0,
        }}>
          <span style={{
            display: 'block', width: 9, height: 9, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 2,
            left: isAutoTradeActive ? 15 : 2,
            transition: 'left 0.2s',
          }} />
        </span>
        {autoTradeScanning ? '⟳ 스캔 중...' : autoTradeMode === 'live' ? '⚡ 자동매매(실전)' : '⚡ 자동매매(모의)'}
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
        title="자동매매 진입 설정 (레버리지 · 마진 크기)"
      >
        ⚙ 자동설정
      </button>

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
        errors={errorLogs}
        onClear={onClearErrors ?? (() => {})}
      />
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
    padding: '4px 10px',
    transition: 'all 0.1s',
    fontFamily: '"SF Mono", Consolas, monospace',
    whiteSpace: 'nowrap',
    flexShrink: 0,
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
    padding: '4px 10px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
    flexShrink: 0,
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
    padding: '3px 7px',
    fontFamily: '"SF Mono", Consolas, monospace',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    flexShrink: 0,
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
    padding: '4px 10px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap',
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
    padding: '2px 6px',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.1s',
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
    padding: '3px 8px', transition: 'all 0.1s', fontFamily: 'inherit',
    flexShrink: 0, whiteSpace: 'nowrap' as const,
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
};
