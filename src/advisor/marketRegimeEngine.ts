/**
 * marketRegimeEngine.ts
 *
 * App-level 30초 cadence로 실행되는 마켓 레짐 스냅샷 계산기.
 * 기존 regimeMetrics.ts의 fetchBenchmarkTrend / classifyRegime을 재사용하고
 * advisory용 MarketRegimeState 타입으로 매핑한다.
 *
 * 주의: 이 모듈은 scalp hot path에 절대 import하지 마라.
 */

import {
  fetchBenchmarkTrend,
  classifyRegime,
} from '../components/AltScanner/features/regimeMetrics';
import type { BenchmarkTrend } from '../components/AltScanner/features/regimeMetrics';

// ── Public types ──────────────────────────────────────────────────────────────

export type MarketRegimeState =
  | 'EVENT_RISK_OFF'
  | 'MICROSTRUCTURE_BAD'
  | 'TREND_EXPANSION'
  | 'TREND_PULLBACK'
  | 'MEAN_REVERT_DIP'
  | 'RANGE_LOW_EDGE'
  | 'NEUTRAL';

export interface MarketRegimeSnapshot {
  state: MarketRegimeState;
  confidence: number; // 0~100
  reasons: string[];
  inputs: {
    btcTrend?: 'bull' | 'neutral' | 'chop' | 'bear' | 'unknown';
    breadth?: number | null;
    volatilityBurst?: boolean;
    dipContext?: boolean;
    microstructureBad?: boolean;
    manualEventRisk?: boolean;
  };
  updatedAt: number;
}

export interface MarketRegimeInput {
  /** BTC 4H + 1H 추세 데이터 (fetchBenchmarkTrend 결과) */
  btcTrend?: BenchmarkTrend;
  /** [0,1] 유니버스 breadth — 스캔 없이 계산 불가하면 null */
  breadth?: number | null;
  /** 변동성 급증 감지 (향후 ATR spike 감지 등으로 연결 가능) */
  volatilityBurst?: boolean;
  /** 급락 과매도 컨텍스트 (향후 RSI < 20 등으로 연결 가능) */
  dipContext?: boolean;
  /** 마이크로스트럭처 악화 (spread/depth/latency) */
  microstructureBad?: boolean;
  /** FOMC/정치 이벤트 등 수동 위험 플래그 — 기본 false, 향후 이벤트 캘린더 연동 placeholder */
  manualEventRisk?: boolean;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function summarizeBtcTrend(
  btcTrend: BenchmarkTrend | undefined,
  breadth: number | null | undefined,
): 'bull' | 'neutral' | 'chop' | 'bear' | 'unknown' {
  if (!btcTrend) return 'unknown';
  return classifyRegime(btcTrend, breadth ?? 0.4);
}

// ── Pure computation function ─────────────────────────────────────────────────

export function computeMarketRegimeSnapshot(input: MarketRegimeInput): MarketRegimeSnapshot {
  const now = Date.now();
  const breadth = input.breadth ?? null;

  const inputSummary: MarketRegimeSnapshot['inputs'] = {
    btcTrend: summarizeBtcTrend(input.btcTrend, breadth),
    breadth,
    volatilityBurst: input.volatilityBurst,
    dipContext: input.dipContext,
    microstructureBad: input.microstructureBad,
    manualEventRisk: input.manualEventRisk,
  };

  // 1. 이벤트 위험 — 최우선 차단
  if (input.manualEventRisk) {
    return {
      state: 'EVENT_RISK_OFF',
      confidence: 95,
      reasons: ['수동 이벤트 위험 활성화 (FOMC/정치 이벤트)'],
      inputs: inputSummary,
      updatedAt: now,
    };
  }

  // 2. 마이크로스트럭처 / 변동성 급증
  if (input.microstructureBad || input.volatilityBurst) {
    return {
      state: 'MICROSTRUCTURE_BAD',
      confidence: 80,
      reasons: [
        ...(input.volatilityBurst ? ['변동성 급증 감지'] : []),
        ...(input.microstructureBad ? ['마이크로스트럭처 악화 (스프레드/뎁스/레이턴시)'] : []),
      ],
      inputs: inputSummary,
      updatedAt: now,
    };
  }

  // 3. BTC 추세 데이터 없음 → NEUTRAL
  if (!input.btcTrend) {
    return {
      state: 'NEUTRAL',
      confidence: 30,
      reasons: ['BTC 추세 데이터 없음 — 정보 부족으로 중립 처리'],
      inputs: inputSummary,
      updatedAt: now,
    };
  }

  const { ema4hBull, ema1hBull, slope4h } = input.btcTrend;
  const breadthKnown = breadth !== null;

  // 4. 4H 하락 — 딥 컨텍스트면 MEAN_REVERT_DIP, 아니면 RANGE_LOW_EDGE
  if (!ema4hBull) {
    if (input.dipContext) {
      return {
        state: 'MEAN_REVERT_DIP',
        confidence: 65,
        reasons: [
          'BTC 4H 하락 추세',
          '급락/과매도 딥 컨텍스트 감지',
          '평균회귀 전략(BB MTF DCA) 유리한 구간',
        ],
        inputs: inputSummary,
        updatedAt: now,
      };
    }
    return {
      state: 'RANGE_LOW_EDGE',
      confidence: 70,
      reasons: [
        'BTC 4H 하락 추세 (EMA20 < EMA50)',
        '추세 전략 진입 위험 구간',
      ],
      inputs: inputSummary,
      updatedAt: now,
    };
  }

  // 5. 4H 상승 확인 이후
  const slopeStr = (slope4h * 100).toFixed(2) + '%';

  // TREND_EXPANSION: 4H↑ + 1H↑ + (breadth 양호하거나 미확인)
  if (ema1hBull && (!breadthKnown || breadth >= 0.35)) {
    const confidence = breadthKnown && breadth >= 0.45 ? 82 : 68;
    return {
      state: 'TREND_EXPANSION',
      confidence,
      reasons: [
        'BTC 4H 상승 추세 (EMA20 > EMA50)',
        'BTC 1H 모멘텀 확인',
        ...(breadthKnown ? [`유니버스 breadth ${(breadth! * 100).toFixed(0)}%`] : ['breadth 미확인 — 신호 기반 판단']),
        `4H EMA 기울기 ${slopeStr}`,
      ],
      inputs: inputSummary,
      updatedAt: now,
    };
  }

  // TREND_PULLBACK: 4H↑ + 1H 약화 또는 breadth 저조
  if (ema1hBull && breadthKnown && breadth < 0.35) {
    return {
      state: 'TREND_PULLBACK',
      confidence: 60,
      reasons: [
        'BTC 4H 상승 추세 유지',
        'BTC 1H 모멘텀 있으나 breadth 저조',
        `유니버스 breadth ${(breadth * 100).toFixed(0)}% (기준 35% 미달)`,
      ],
      inputs: inputSummary,
      updatedAt: now,
    };
  }

  if (!ema1hBull && slope4h > 0.001) {
    return {
      state: 'TREND_PULLBACK',
      confidence: 58,
      reasons: [
        'BTC 4H 상승 추세 유지 (기울기 양호)',
        'BTC 1H 되돌림 구간 진입',
        `4H EMA 기울기 ${slopeStr}`,
      ],
      inputs: inputSummary,
      updatedAt: now,
    };
  }

  // RANGE_LOW_EDGE: 4H↑ 이지만 1H↓ + 기울기 약함 = chop
  if (!ema1hBull) {
    return {
      state: 'RANGE_LOW_EDGE',
      confidence: 60,
      reasons: [
        'BTC 4H 소폭 상승이나 1H 하락 전환',
        `4H EMA 기울기 ${slopeStr} — 추세 약화`,
        '횡보/촙 성격 구간',
      ],
      inputs: inputSummary,
      updatedAt: now,
    };
  }

  // 기본값: NEUTRAL
  return {
    state: 'NEUTRAL',
    confidence: 40,
    reasons: ['시장 신호 애매 — 중립 처리'],
    inputs: inputSummary,
    updatedAt: now,
  };
}

// ── BTC 24h 변화율 fetch ──────────────────────────────────────────────────────

/**
 * BTCUSDT 24h 가격 변화율(%)을 반환한다.
 * 실패 시 null 반환 (throw 하지 않음).
 */
async function fetchBtcPriceChangePct(signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(
      'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT',
      signal ? { signal } : undefined,
    );
    if (!res.ok) return null;
    const d = await res.json() as { priceChangePercent: string };
    const pct = parseFloat(d.priceChangePercent);
    return Number.isFinite(pct) ? pct : null;
  } catch {
    return null;
  }
}

// ── App-level fetch wrapper ────────────────────────────────────────────────────

/**
 * App useEffect에서 호출하는 비동기 fetch + compute 래퍼.
 * - BTC 4H/1H 추세 + BTC 24h 변화율을 병렬 fetch한다.
 * - BTC 24h 변화율 < -5% 이면 dipContext=true로 자동 설정 (extraInput으로 덮어쓸 수 있음).
 * - 네트워크 실패 시 NEUTRAL snapshot을 반환하고 throw하지 않는다.
 */
export async function fetchAndComputeRegimeSnapshot(
  extraInput?: Omit<MarketRegimeInput, 'btcTrend'>,
  signal?: AbortSignal,
): Promise<MarketRegimeSnapshot> {
  try {
    const [btcTrend, btcChangePct] = await Promise.all([
      fetchBenchmarkTrend(signal),
      fetchBtcPriceChangePct(signal),
    ]);
    // dipContext: 명시적 값이 없으면 BTC 24h 변화율로 자동 계산
    const dipContext = extraInput?.dipContext
      ?? (btcChangePct !== null && btcChangePct < -5);
    return computeMarketRegimeSnapshot({ ...extraInput, btcTrend, dipContext });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // 네트워크 오류: NEUTRAL로 degrade
    return computeMarketRegimeSnapshot({ ...extraInput, btcTrend: undefined });
  }
}
