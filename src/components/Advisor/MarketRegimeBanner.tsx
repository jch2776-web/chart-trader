/**
 * MarketRegimeBanner.tsx
 *
 * 상단 배너 — 현재 레짐 상태, confidence, 핵심 이유, 신규 진입 권고 여부를 표시한다.
 * 읽기 전용. 자동 전략 전환 버튼 없음.
 */

import { useState } from 'react';
import type { StrategyAdvisorOutput } from '../../advisor/strategyAdvisor';
import type { MarketRegimeState } from '../../advisor/marketRegimeEngine';

interface Props {
  advisor: StrategyAdvisorOutput;
}

// ── 색상 팔레트 ───────────────────────────────────────────────────────────────

const STATE_COLOR: Record<MarketRegimeState, { bg: string; border: string; text: string; badge: string }> = {
  TREND_EXPANSION:  { bg: 'rgba(14,203,129,0.08)',  border: 'rgba(14,203,129,0.30)',  text: '#0ecb81', badge: '#0ecb81' },
  TREND_PULLBACK:   { bg: 'rgba(59,139,235,0.08)',  border: 'rgba(59,139,235,0.30)',  text: '#3b8beb', badge: '#3b8beb' },
  MEAN_REVERT_DIP:  { bg: 'rgba(240,185,11,0.08)',  border: 'rgba(240,185,11,0.30)',  text: '#f0b90b', badge: '#f0b90b' },
  RANGE_LOW_EDGE:   { bg: 'rgba(132,142,156,0.08)', border: 'rgba(132,142,156,0.30)', text: '#848e9c', badge: '#848e9c' },
  NEUTRAL:          { bg: 'rgba(132,142,156,0.06)', border: 'rgba(132,142,156,0.20)', text: '#848e9c', badge: '#848e9c' },
  EVENT_RISK_OFF:   { bg: 'rgba(246,70,93,0.10)',   border: 'rgba(246,70,93,0.40)',   text: '#f6465d', badge: '#f6465d' },
  MICROSTRUCTURE_BAD: { bg: 'rgba(246,70,93,0.08)', border: 'rgba(246,70,93,0.35)',  text: '#f6465d', badge: '#f6465d' },
};

const STATE_LABEL: Record<MarketRegimeState, string> = {
  TREND_EXPANSION:    '추세 확장',
  TREND_PULLBACK:     '추세 되돌림',
  MEAN_REVERT_DIP:    '급락 딥',
  RANGE_LOW_EDGE:     '횡보·촙',
  NEUTRAL:            '중립',
  EVENT_RISK_OFF:     '이벤트 차단',
  MICROSTRUCTURE_BAD: '마이크로 악화',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function MarketRegimeBanner({ advisor }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { regime, headline, subheadline, noRecommendation, noRecommendationReason } = advisor;
  const colors = STATE_COLOR[regime.state];
  const isBlocking = regime.state === 'EVENT_RISK_OFF' || regime.state === 'MICROSTRUCTURE_BAD';

  const updatedMin = Math.round((Date.now() - regime.updatedAt) / 60000);
  const updatedLabel = updatedMin < 1 ? '방금' : `${updatedMin}분 전`;

  // 최대 4개 이유 표시
  const visibleReasons = expanded ? regime.reasons : regime.reasons.slice(0, 2);

  return (
    <div style={{
      background: colors.bg,
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
      fontSize: '0.78rem',
      userSelect: 'none',
    }}>
      {/* 메인 행 */}
      <div style={{
        alignItems: 'center',
        display: 'flex',
        gap: 10,
        padding: '5px 12px',
        flexWrap: 'wrap',
      }}>
        {/* 레짐 배지 */}
        <span style={{
          background: isBlocking ? colors.badge : 'transparent',
          border: `1px solid ${colors.badge}`,
          borderRadius: 4,
          color: isBlocking ? '#fff' : colors.text,
          fontWeight: 700,
          fontSize: '0.72rem',
          padding: '1px 7px',
          whiteSpace: 'nowrap',
        }}>
          {STATE_LABEL[regime.state]}
        </span>

        {/* 헤드라인 */}
        <span style={{ color: colors.text, fontWeight: 600, flex: 1, minWidth: 120 }}>
          {headline}
        </span>

        {/* Confidence */}
        <span style={{ color: '#848e9c', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
          신뢰도 {regime.confidence}%
        </span>

        {/* 진입 권고 뱃지 */}
        {noRecommendation ? (
          <span style={{
            background: 'rgba(246,70,93,0.15)',
            border: '1px solid rgba(246,70,93,0.4)',
            borderRadius: 4,
            color: '#f6465d',
            fontSize: '0.70rem',
            fontWeight: 600,
            padding: '1px 7px',
            whiteSpace: 'nowrap',
          }}>
            신규 진입 비권장
          </span>
        ) : (
          <span style={{
            background: 'rgba(14,203,129,0.10)',
            border: '1px solid rgba(14,203,129,0.30)',
            borderRadius: 4,
            color: '#0ecb81',
            fontSize: '0.70rem',
            fontWeight: 600,
            padding: '1px 7px',
            whiteSpace: 'nowrap',
          }}>
            신규 진입 가능
          </span>
        )}

        {/* 갱신 시간 */}
        <span style={{ color: '#4a4f5b', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
          {updatedLabel} 갱신
        </span>

        {/* 펼치기/접기 */}
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            background: 'none',
            border: 'none',
            color: '#4a4f5b',
            cursor: 'pointer',
            fontSize: '0.72rem',
            padding: '0 4px',
            fontFamily: 'inherit',
          }}
          title={expanded ? '접기' : '상세 보기'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* 서브헤드라인 + 이유 (펼침 시) */}
      {expanded && (
        <div style={{ padding: '0 12px 7px 12px' }}>
          {subheadline && (
            <div style={{ color: '#848e9c', marginBottom: 4 }}>{subheadline}</div>
          )}
          {noRecommendationReason && (
            <div style={{ color: '#f6465d', marginBottom: 4, fontWeight: 600 }}>
              {noRecommendationReason}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
            {visibleReasons.map((r, i) => (
              <span key={i} style={{ color: '#848e9c' }}>• {r}</span>
            ))}
            {regime.reasons.length > 2 && !expanded && (
              <span style={{ color: '#4a4f5b' }}>+{regime.reasons.length - 2}개 더</span>
            )}
          </div>
        </div>
      )}

      {/* 미펼침 상태에서도 이유 한 줄 미리보기 */}
      {!expanded && regime.reasons.length > 0 && (
        <div style={{ padding: '0 12px 5px 12px', color: '#4a4f5b' }}>
          {visibleReasons.map((r, i) => (
            <span key={i} style={{ marginRight: 12 }}>• {r}</span>
          ))}
        </div>
      )}
    </div>
  );
}
