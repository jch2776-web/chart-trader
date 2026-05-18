/**
 * StrategyAdviceCards.tsx
 *
 * 전략별 advice 카드 목록 + 우측 뉴스 패널.
 * - status badge (추천/가능/비추천/금지)
 * - suitability score 게이지 바 (변경 시 CSS transition 애니메이션)
 * - 이유 2~3개
 * - scalp: preferredSignalMode 표시
 * - 갱신 카운트다운 (헤더)
 * - 우측: NewsCard (FOMC + 암호화폐 뉴스)
 * 읽기 전용. 주문 실행 없음.
 */

import { useState, useEffect, useRef } from 'react';
import type { StrategyAdvice, StrategyAdvisorOutput, AdviceStatus } from '../../advisor/strategyAdvisor';
import { NewsCard } from './NewsCard';

interface Props {
  advisor: StrategyAdvisorOutput;
}

// ── 레이블 / 색상 ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AdviceStatus, string> = {
  recommended: '추천',
  allowed: '가능',
  avoid: '비추천',
  blocked: '금지',
};

const STATUS_COLOR: Record<AdviceStatus, { bg: string; border: string; text: string }> = {
  recommended: { bg: 'rgba(14,203,129,0.15)',  border: 'rgba(14,203,129,0.50)', text: '#0ecb81' },
  allowed:     { bg: 'rgba(59,139,235,0.12)',  border: 'rgba(59,139,235,0.40)', text: '#3b8beb' },
  avoid:       { bg: 'rgba(132,142,156,0.10)', border: 'rgba(132,142,156,0.30)', text: '#848e9c' },
  blocked:     { bg: 'rgba(246,70,93,0.12)',   border: 'rgba(246,70,93,0.45)',  text: '#f6465d' },
};

const SCORE_BAR_COLOR: Record<AdviceStatus, string> = {
  recommended: '#0ecb81',
  allowed:     '#3b8beb',
  avoid:       '#4a4f5b',
  blocked:     '#f6465d',
};

const STRATEGY_LABEL: Record<string, string> = {
  'breakout':       '기존 돌파',
  'leader-retest':  '리더 리테스트',
  'fvg-poc-ema72':  'FVG POC + EMA72',
  'bb-mtf-dca':     'BB MTF DCA',
  'scalp':          '스캘핑',
};

const SIGNAL_MODE_LABEL: Record<string, string> = {
  off:      '비활성',
  momentum: '모멘텀',
  revert:   '역추세',
  both:     '양방향',
};

// ── AnimatedBar ───────────────────────────────────────────────────────────────
// score prop이 바뀔 때 width를 animate하기 위해 별도 컴포넌트로 분리.
// 첫 마운트: 0 → target 애니메이션 보장.

function AnimatedBar({ score, color }: { score: number; color: string }) {
  const [displayWidth, setDisplayWidth] = useState(0);
  const prevScore = useRef<number | null>(null);

  useEffect(() => {
    // 마운트 직후 혹은 score 변경 시: requestAnimationFrame으로 한 프레임 후 세팅
    // → CSS transition이 0 또는 이전값에서 새 값으로 애니메이션됨
    const raf = requestAnimationFrame(() => {
      setDisplayWidth(score);
    });
    prevScore.current = score;
    return () => cancelAnimationFrame(raf);
  }, [score]);

  return (
    <div style={{ background: '#1e222d', borderRadius: 3, height: 4, overflow: 'hidden' }}>
      <div style={{
        background: color,
        borderRadius: 3,
        height: '100%',
        transition: 'width 0.55s cubic-bezier(0.4, 0, 0.2, 1)',
        width: `${displayWidth}%`,
      }} />
    </div>
  );
}

// ── ScoreNumber — 숫자도 부드럽게 변경 ─────────────────────────────────────

function ScoreNumber({ value, color }: { value: number; color: string }) {
  const [displayed, setDisplayed] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<{ from: number; to: number; startTime: number } | null>(null);

  useEffect(() => {
    const from = displayed;
    const to   = value;
    if (from === to) return;
    const DURATION = 550; // ms, matches bar transition
    startRef.current = { from, to, startTime: performance.now() };
    function step(now: number) {
      if (!startRef.current) return;
      const { from: f, to: t, startTime } = startRef.current;
      const progress = Math.min(1, (now - startTime) / DURATION);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(f + (t - f) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span style={{ color, fontSize: '0.72rem', fontWeight: 600 }}>
      {displayed}
    </span>
  );
}

// ── StrategyCard ──────────────────────────────────────────────────────────────

function StrategyCard({ advice }: { advice: StrategyAdvice }) {
  const colors    = STATUS_COLOR[advice.status];
  const barColor  = SCORE_BAR_COLOR[advice.status];
  const isBlocked = advice.status === 'blocked';
  const visibleReasons = isBlocked ? (advice.blockedReasons ?? []).slice(0, 2) : advice.reasons.slice(0, 3);

  return (
    <div style={{
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      flex: '1 1 150px',
      maxWidth: 210,
      minWidth: 135,
      padding: '8px 10px',
      opacity: isBlocked ? 0.75 : 1,
    }}>
      {/* 헤더 */}
      <div style={{ alignItems: 'center', display: 'flex', gap: 6, marginBottom: 6 }}>
        <span style={{ color: '#d1d4dc', fontWeight: 600, fontSize: '0.76rem', flex: 1 }}>
          {STRATEGY_LABEL[advice.strategyId] ?? advice.strategyId}
        </span>
        <span style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 3,
          color: colors.text,
          fontSize: '0.67rem',
          fontWeight: 700,
          padding: '1px 5px',
          whiteSpace: 'nowrap',
        }}>
          {STATUS_LABEL[advice.status]}
        </span>
      </div>

      {/* Score bar + 숫자 */}
      <div style={{ marginBottom: 7 }}>
        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ color: '#848e9c', fontSize: '0.67rem' }}>적합도</span>
          <ScoreNumber value={advice.suitabilityScore} color={colors.text} />
        </div>
        <AnimatedBar score={advice.suitabilityScore} color={barColor} />
      </div>

      {/* 이유 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleReasons.map((r, i) => (
          <span key={i} style={{ color: isBlocked ? '#f6465d' : '#848e9c', fontSize: '0.69rem' }}>
            {isBlocked ? '✕' : '•'} {r}
          </span>
        ))}
      </div>

      {/* scalp: preferredSignalMode */}
      {advice.strategyId === 'scalp' && advice.preferredSignalMode && (
        <div style={{ marginTop: 6 }}>
          <span style={{
            background: 'rgba(240,185,11,0.12)',
            border: '1px solid rgba(240,185,11,0.30)',
            borderRadius: 3,
            color: '#f0b90b',
            fontSize: '0.67rem',
            padding: '1px 6px',
          }}>
            권장 모드: {SIGNAL_MODE_LABEL[advice.preferredSignalMode] ?? advice.preferredSignalMode}
          </span>
        </div>
      )}
    </div>
  );
}

// ── StrategyAdviceCards ───────────────────────────────────────────────────────

function secsToNextHour(): number {
  const now = Date.now();
  const nextHour = Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000;
  return Math.max(0, Math.round((nextHour - now) / 1000));
}

function nextHourLabel(): string {
  const next = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 3_600_000);
  return `${String(next.getHours()).padStart(2, '0')}:00`;
}

function formatSecs(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function StrategyAdviceCards({ advisor }: Props) {
  const [visible, setVisible] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(secsToNextHour);
  const [cardsHeight, setCardsHeight] = useState<number>(0);
  const cardsColRef = useRef<HTMLDivElement>(null);
  const { strategies, noRecommendation, noRecommendationReason } = advisor;

  // 전략 카드 컬럼 높이 측정 → NewsCard 높이 상한으로 전달
  useEffect(() => {
    const el = cardsColRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setCardsHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  // 다음 1H 봉 마감까지 카운트다운
  useEffect(() => {
    setSecondsLeft(secsToNextHour());
    const id = window.setInterval(() => setSecondsLeft(secsToNextHour()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const progress = Math.max(0, Math.min(1, 1 - secondsLeft / 3600));

  return (
    <div style={{
      background: '#131722',
      borderBottom: '1px solid #2a2e39',
      flexShrink: 0,
    }}>
      {/* ── 토글 헤더 ── */}
      <button
        onClick={() => setVisible(v => !v)}
        style={{
          alignItems: 'center',
          background: 'none',
          border: 'none',
          borderBottom: visible ? '1px solid #2a2e39' : 'none',
          color: '#848e9c',
          cursor: 'pointer',
          display: 'flex',
          fontSize: '0.73rem',
          fontFamily: 'inherit',
          gap: 8,
          padding: '5px 12px',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{ fontWeight: 600 }}>전략 어드바이저</span>

        {noRecommendation && (
          <span style={{ color: '#f6465d', fontWeight: 600 }}>⚠ 추천 없음</span>
        )}
        {!noRecommendation && strategies.some(s => s.status === 'recommended') && (
          <span style={{ color: '#0ecb81' }}>
            {strategies.filter(s => s.status === 'recommended').map(s => STRATEGY_LABEL[s.strategyId]).join(', ')} 추천
          </span>
        )}

        {/* 갱신 주기 + 카운트다운 */}
        <span style={{ color: '#4a4f5b', fontSize: '0.68rem', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          매 1H 봉 기준 ·&nbsp;
          {secondsLeft > 0
            ? <span style={{ color: secondsLeft <= 60 ? '#f0b90b' : '#4a4f5b' }}>
                {nextHourLabel()} 갱신 ({formatSecs(secondsLeft)})
              </span>
            : <span style={{ color: '#0ecb81' }}>갱신 중…</span>
          }
        </span>

        {/* 진행 바 */}
        <div style={{ width: 36, height: 3, background: '#2a2e39', borderRadius: 2, flexShrink: 0 }}>
          <div style={{
            background: secondsLeft <= 60 ? '#f0b90b' : '#3b8beb',
            borderRadius: 2,
            height: '100%',
            transition: 'width 0.9s linear',
            width: `${progress * 100}%`,
          }} />
        </div>

        <span style={{ marginLeft: 4 }}>{visible ? '▲' : '▼'}</span>
      </button>

      {/* ── 본문 (펼침) ── */}
      {visible && (
        <div style={{ display: 'flex', gap: 12, padding: '8px 12px 12px', alignItems: 'flex-start' }}>

          {/* 좌측: 전략 카드 */}
          <div ref={cardsColRef} style={{ flex: '3 1 500px', minWidth: 0 }}>
            {noRecommendation && (
              <div style={{
                background: 'rgba(246,70,93,0.08)',
                border: '1px solid rgba(246,70,93,0.25)',
                borderRadius: 6,
                color: '#f6465d',
                fontSize: '0.78rem',
                fontWeight: 600,
                marginBottom: 10,
                padding: '8px 12px',
              }}>
                ⚠ {noRecommendationReason ?? '현재 시장 상황에서 권장 전략 없음'}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {strategies.map(advice => (
                <StrategyCard key={advice.strategyId} advice={advice} />
              ))}
            </div>
          </div>

          {/* 우측: 뉴스 카드 — 전략 카드 높이에 맞춤 */}
          <NewsCard maxHeight={cardsHeight || undefined} />
        </div>
      )}
    </div>
  );
}
