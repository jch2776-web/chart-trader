import React from 'react';
import type { Interval } from '../types/candle';
import type { DrawingMode } from '../types/drawing';
import { DRAWING_COLORS } from '../types/drawing';
import type { IndicatorConfig } from './Chart/useChartRenderer';

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
  isMobile?: boolean;
  mobilePanel?: 'none' | 'tickers' | 'settings';
  onToggleMobilePanel?: (panel: 'tickers' | 'settings') => void;
}

const INTERVALS: Interval[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

const FONT_MIN = 11;
const FONT_MAX = 36;

export function Toolbar({
  interval, onIntervalChange, drawingMode, onDrawingModeChange,
  fontSize, onFontSizeChange, activeColor, onActiveColorChange,
  isMultiMode, onToggleMultiMode, isPaperMode, onTogglePaperMode,
  indicators, onToggleIndicator,
  onOpenBoard, onOpenUserBoard, onOpenSecurityFaq, onOpenAltScanner,
  isMobile, mobilePanel, onToggleMobilePanel,
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
        style={{
          ...styles.multiBtn,
          ...(isMultiMode ? styles.multiBtnActive : {}),
        }}
        onClick={onToggleMultiMode}
        title={isMultiMode ? '단일 차트로 돌아가기' : '다중 분할 모니터링'}
      >
        {isMultiMode ? '✕ 단일 차트' : '⊞ 분할'}
      </button>

      {/* Paper trading toggle */}
      <button
        style={{ ...styles.paperBtn, ...(isPaperMode ? styles.paperBtnActive : {}) }}
        onClick={onTogglePaperMode}
        title={isPaperMode ? '모의거래 모드 ON — 클릭하여 해제' : '모의거래 모드 (실제 주문 없음)'}
      >
        📄 모의거래
      </button>

      {/* Board button */}
      <button
        style={styles.boardBtn}
        onClick={onOpenBoard}
        title="도형 게시판"
      >
        📋 도형게시판
      </button>

      {/* Alt scanner button */}
      <button
        style={styles.altScannerBtn}
        onClick={onOpenAltScanner}
        title="알트추천 (돌파 스캐너)"
      >
        🔍 알트추천
      </button>

      {/* User board button */}
      <button
        style={styles.boardBtn}
        onClick={onOpenUserBoard}
        title="유저 게시판"
      >
        💬 유저게시판
      </button>

      {/* Security FAQ button */}
      <button
        style={styles.securityBtn}
        onClick={onOpenSecurityFaq}
        title="보안 FAQ"
      >
        🔒 보안FAQ
      </button>
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
  // ── Multi-panel toggle ────────────────────────────────────────────────────
  multiBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    padding: '4px 10px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  multiBtnActive: {
    borderColor: '#3b8beb',
    color: '#3b8beb',
    background: 'rgba(59,139,235,0.1)',
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
  // ── Paper trading toggle ──────────────────────────────────────────────────
  paperBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    padding: '4px 10px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  paperBtnActive: {
    borderColor: '#f0b90b',
    color: '#f0b90b',
    background: 'rgba(240,185,11,0.12)',
  },
  // ── Alt scanner button ───────────────────────────────────────────────────
  altScannerBtn: {
    background: 'none',
    border: '1px solid rgba(240,185,11,0.45)',
    borderRadius: 4,
    color: '#f0b90b',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    padding: '4px 10px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    opacity: 0.85,
  },
  // ── Board button ──────────────────────────────────────────────────────────
  boardBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    padding: '4px 10px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  // ── Security FAQ button ───────────────────────────────────────────────────
  securityBtn: {
    background: 'none',
    border: '1px solid rgba(59,139,235,0.35)',
    borderRadius: 4,
    color: '#3b8beb',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    padding: '4px 10px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    opacity: 0.75,
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
