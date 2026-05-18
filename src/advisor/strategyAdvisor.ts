/**
 * strategyAdvisor.ts
 *
 * 레짐 스냅샷을 받아 전략별 normalized suitability score + advice status를 생성한다.
 * - pure function
 * - rule-based (ML 없음)
 * - 전략별 raw score 직접 비교 금지 — 레짐 중심 normalized score 사용
 * - 주문 실행 로직에 영향 없음 (advisory only)
 */

import type { MarketRegimeSnapshot, MarketRegimeState } from './marketRegimeEngine';

// ── Public types ──────────────────────────────────────────────────────────────

export type AdviceStatus = 'recommended' | 'allowed' | 'avoid' | 'blocked';

export type StrategyId = 'breakout' | 'leader-retest' | 'fvg-poc-ema72' | 'bb-mtf-dca' | 'scalp';

export interface StrategyAdvice {
  strategyId: StrategyId;
  status: AdviceStatus;
  suitabilityScore: number; // 0~100 normalized — 전략 간 직접 비교 금지
  reasons: string[];
  blockedReasons?: string[];
  /** scalp 전용 */
  preferredSignalMode?: 'off' | 'momentum' | 'revert' | 'both';
}

export interface StrategyAdvisorOutput {
  regime: MarketRegimeSnapshot;
  headline: string;
  subheadline?: string;
  noRecommendation: boolean;
  noRecommendationReason?: string;
  strategies: StrategyAdvice[];
}

// ── Regime → strategy mapping ─────────────────────────────────────────────────

function makeBlocked(strategyId: StrategyId, reasons: string[]): StrategyAdvice {
  return {
    strategyId,
    status: 'blocked',
    suitabilityScore: 0,
    reasons: [],
    blockedReasons: reasons,
    ...(strategyId === 'scalp' ? { preferredSignalMode: 'off' as const } : {}),
  };
}

function adviseForState(state: MarketRegimeState, regime: MarketRegimeSnapshot): StrategyAdvice[] {
  switch (state) {
    case 'EVENT_RISK_OFF': {
      const reason = ['이벤트 리스크 활성화 — 모든 전략 금지'];
      return ALL_STRATEGY_IDS.map(id => makeBlocked(id, reason));
    }

    case 'MICROSTRUCTURE_BAD': {
      const reason = ['마이크로스트럭처 악화 — 체결 품질 불량, 진입 금지'];
      return ALL_STRATEGY_IDS.map(id => makeBlocked(id, reason));
    }

    case 'TREND_EXPANSION': {
      const confidenceBonus = regime.confidence >= 80 ? 10 : 0;
      return [
        {
          strategyId: 'breakout',
          status: 'recommended',
          suitabilityScore: Math.min(100, 80 + confidenceBonus),
          reasons: ['추세 확장 구간 — 돌파 성공률 상승', '4H + 1H 모멘텀 정렬'],
        },
        {
          strategyId: 'fvg-poc-ema72',
          status: 'recommended',
          suitabilityScore: Math.min(100, 75 + confidenceBonus),
          reasons: ['EMA72 추세 정렬 구간', 'FVG POC 크로스 신호 유효'],
        },
        {
          strategyId: 'leader-retest',
          status: 'allowed',
          suitabilityScore: 60,
          reasons: ['추세는 우호적이나 리테스트 타이밍 까다로움', '추세 가속 구간에서는 진입 시점 선별 필요'],
        },
        {
          strategyId: 'bb-mtf-dca',
          status: 'avoid',
          suitabilityScore: 20,
          reasons: ['추세 확장 구간에서 BB 딥 매수는 과매수 대응 전략', '추세 추종과 반대 방향 포지션 위험'],
        },
        {
          strategyId: 'scalp',
          status: 'allowed',
          suitabilityScore: 62,
          reasons: ['추세 방향 모멘텀 스캘핑 유리', '역추세 스캘핑은 자제'],
          preferredSignalMode: 'momentum',
        },
      ];
    }

    case 'TREND_PULLBACK': {
      return [
        {
          strategyId: 'leader-retest',
          status: 'recommended',
          suitabilityScore: 80,
          reasons: ['리테스트 전략 최적 구간', '추세 살아 있고 되돌림에서 구조적 진입 가능'],
        },
        {
          strategyId: 'breakout',
          status: 'allowed',
          suitabilityScore: 55,
          reasons: ['추세 방향 돌파 가능', '되돌림 구간이라 허위 돌파 주의'],
        },
        {
          strategyId: 'fvg-poc-ema72',
          status: 'allowed',
          suitabilityScore: 52,
          reasons: ['FVG POC 크로스 후 추세 재개 신호로 활용 가능'],
        },
        {
          strategyId: 'bb-mtf-dca',
          status: 'avoid',
          suitabilityScore: 30,
          reasons: ['되돌림 깊이 예측 어려움', '추세 방향 포지션이 더 안전'],
        },
        {
          strategyId: 'scalp',
          status: 'allowed',
          suitabilityScore: 55,
          reasons: ['추세 방향 모멘텀 스캘핑 조심스럽게 허용'],
          preferredSignalMode: 'momentum',
        },
      ];
    }

    case 'MEAN_REVERT_DIP': {
      const isBearContext = regime.inputs.btcTrend === 'bear';
      return [
        {
          strategyId: 'bb-mtf-dca',
          status: 'recommended',
          suitabilityScore: 80,
          reasons: ['급락/과매도 딥 매수 최적 구간', 'BB 하단 침범 + 평균회귀 신호 활용'],
        },
        {
          strategyId: 'leader-retest',
          status: isBearContext ? 'avoid' : 'allowed',
          suitabilityScore: isBearContext ? 30 : 45,
          reasons: isBearContext
            ? ['하락 추세에서 리테스트 롱 위험', '추세 역방향 진입 주의']
            : ['딥 이후 반등 구간 리테스트 가능', '추세 방향 확인 후 진입'],
        },
        {
          strategyId: 'breakout',
          status: 'avoid',
          suitabilityScore: 15,
          reasons: ['급락 구간에서 상방 돌파 신호 부재', '평균회귀 국면에서 돌파 전략 불리'],
        },
        {
          strategyId: 'fvg-poc-ema72',
          status: 'avoid',
          suitabilityScore: 18,
          reasons: ['급락 구간 FVG 신호 신뢰도 낮음', 'EMA72 하향 시 롱 신호 무효'],
        },
        {
          strategyId: 'scalp',
          status: 'allowed',
          suitabilityScore: 48,
          reasons: ['딥 구간 역추세 스캘핑 조심스럽게 허용', '오버슛 리스크 관리 필수'],
          preferredSignalMode: 'revert',
        },
      ];
    }

    case 'RANGE_LOW_EDGE': {
      return [
        {
          strategyId: 'breakout',
          status: 'avoid',
          suitabilityScore: 22,
          reasons: ['횡보 구간 돌파 신호 허위 확률 높음', '방향성 확인 후 진입 권장'],
        },
        {
          strategyId: 'leader-retest',
          status: 'avoid',
          suitabilityScore: 25,
          reasons: ['촙 구간 리테스트 신호 신뢰도 저하', '유니버스 breadth 저조'],
        },
        {
          strategyId: 'fvg-poc-ema72',
          status: 'avoid',
          suitabilityScore: 20,
          reasons: ['범위 제한 시장에서 EMA72 추세 신호 약화'],
        },
        {
          strategyId: 'bb-mtf-dca',
          status: 'avoid',
          suitabilityScore: 28,
          reasons: ['하락 추세 불확실 — 평균회귀 진입 조건 미충족'],
        },
        {
          strategyId: 'scalp',
          status: 'avoid',
          suitabilityScore: 35,
          reasons: ['횡보 구간 스캘핑 수익성 저하', '방향 불명확'],
          preferredSignalMode: 'revert',
        },
      ];
    }

    case 'NEUTRAL':
    default: {
      return [
        {
          strategyId: 'breakout',
          status: 'allowed',
          suitabilityScore: 50,
          reasons: ['중립 구간 — 신중한 진입 가능', '추세 방향 확인 필수'],
        },
        {
          strategyId: 'leader-retest',
          status: 'allowed',
          suitabilityScore: 50,
          reasons: ['중립 구간 — 보수적 리테스트 진입 가능'],
        },
        {
          strategyId: 'fvg-poc-ema72',
          status: 'allowed',
          suitabilityScore: 45,
          reasons: ['중립 구간 FVG 신호 조심스럽게 허용'],
        },
        {
          strategyId: 'bb-mtf-dca',
          status: 'avoid',
          suitabilityScore: 32,
          reasons: ['딥 매수 조건 미성숙', '명확한 과매도 신호 대기'],
        },
        {
          strategyId: 'scalp',
          status: 'allowed',
          suitabilityScore: 50,
          reasons: ['중립 구간 양방향 스캘핑 소폭 허용'],
          preferredSignalMode: 'both',
        },
      ];
    }
  }
}

const ALL_STRATEGY_IDS: StrategyId[] = [
  'breakout',
  'leader-retest',
  'fvg-poc-ema72',
  'bb-mtf-dca',
  'scalp',
];

// ── Headline builder ──────────────────────────────────────────────────────────

function buildHeadline(state: MarketRegimeState): { headline: string; subheadline?: string } {
  switch (state) {
    case 'EVENT_RISK_OFF':
      return { headline: '이벤트 리스크 — 모든 전략 금지', subheadline: '이벤트 해소 시까지 대기' };
    case 'MICROSTRUCTURE_BAD':
      return { headline: '마이크로스트럭처 악화 — 진입 금지', subheadline: '체결 품질 회복 대기' };
    case 'TREND_EXPANSION':
      return { headline: '추세 확장 구간 — 돌파·추세 전략 유리', subheadline: 'BTC 4H + 1H 상승 모멘텀 정렬' };
    case 'TREND_PULLBACK':
      return { headline: '추세 유지 중 되돌림 — 리테스트 전략 최적', subheadline: '추세 방향 되돌림 진입 구간' };
    case 'MEAN_REVERT_DIP':
      return { headline: '급락 과매도 — BB 딥 매수 전략 주목', subheadline: '평균회귀 전략 활성화 구간' };
    case 'RANGE_LOW_EDGE':
      return { headline: '횡보·촙 구간 — 전략 진입 자제', subheadline: '방향성 확인 후 재진입 권장' };
    case 'NEUTRAL':
    default:
      return { headline: '중립 — 보수적 접근 권장', subheadline: '신호 강도 부족, 선별적 진입만 허용' };
  }
}

// ── noRecommendation 판정 ─────────────────────────────────────────────────────

function checkNoRecommendation(
  strategies: StrategyAdvice[],
  state: MarketRegimeState,
): { noRecommendation: boolean; reason?: string } {
  const allBlocked = strategies.every(s => s.status === 'blocked');
  if (allBlocked) {
    return {
      noRecommendation: true,
      reason: state === 'EVENT_RISK_OFF'
        ? '이벤트 위험으로 모든 전략 차단'
        : '마이크로스트럭처 악화로 모든 전략 차단',
    };
  }

  const hasRecommended = strategies.some(s => s.status === 'recommended');
  if (hasRecommended) return { noRecommendation: false };

  const allAvoidOrBlocked = strategies.every(s => s.status === 'avoid' || s.status === 'blocked');
  if (allAvoidOrBlocked) {
    return {
      noRecommendation: true,
      reason: '현재 시장 상황에서 권장 전략 없음 — 모든 전략 비추천 또는 금지',
    };
  }

  return { noRecommendation: false };
}

// ── Public entry point ────────────────────────────────────────────────────────

export function computeStrategyAdvisor(regime: MarketRegimeSnapshot): StrategyAdvisorOutput {
  const strategies = adviseForState(regime.state, regime);
  const { headline, subheadline } = buildHeadline(regime.state);
  const { noRecommendation, reason } = checkNoRecommendation(strategies, regime.state);

  return {
    regime,
    headline,
    subheadline,
    noRecommendation,
    noRecommendationReason: reason,
    strategies,
  };
}
