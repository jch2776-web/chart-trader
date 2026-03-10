import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Candle, Interval } from '../../types/candle';
import type { Drawing, HlineDrawing } from '../../types/drawing';
import type { AltMeta } from '../../types/paperTrading';
import { CandleChart } from '../Chart/CandleChart';
import { runBreakoutScan } from './breakoutScanner';
import type { ScanCandidate, ScanInterval, ScanDirection, CandidateStatus } from './breakoutScanner';
import { useBinanceWS } from '../../hooks/useBinanceWS';
import { revalidateCandidate } from './validateSignal';
import {
  intervalToMs, getNextAlignedCloseTime, defaultAutoScan,
  fmtCountdown, fmtDateTime,
} from './timeUtils';
import { AltScannerFAQ } from './AltScannerFAQ';

export interface AltTradeParams {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  tp1Price?: number;
  leverage: number;
  marginType: 'ISOLATED' | 'CROSSED';
  riskPct: number;              // e.g. 2 = 2% of balance at risk
  // AltScanner meta — attached to the paper/live position for monitoring
  candidateId: string;
  candidateScore: number;
  plannedEntry: number;
  plannedTP: number | null;
  plannedSL: number | null;
  scanInterval: Interval;
  validUntilTime: number;
  drawingsSnapshot: Drawing[];
  // Signal classification — used for conditional entry logic
  breakoutType: 'trendline' | 'hline' | 'box';
  candidateStatus: CandidateStatus;
  triggerPriceAtNextClose?: number; // only for trendline signals
  // Paper sizing mode
  sizeMode: 'risk' | 'margin';
  marginUsdt?: number; // only when sizeMode === 'margin'
}

interface Props {
  symbols: string[];
  initialCandidates: ScanCandidate[];
  onCandidatesChange: (candidates: ScanCandidate[]) => void;
  onClose: () => void;
  onOpenInMain?: (symbol: string) => void;
  onPaperTrade?: (params: AltTradeParams) => void;
  onLiveTrade?: (params: AltTradeParams) => void;
  snapshotMeta?: AltMeta;
  paperBalance?: number;
}

type LevelMode = 'core' | 'all';
type StatusFilter = 'all' | 'PENDING' | 'TRIGGERED';

const DIR_OPTS: { value: ScanDirection; label: string }[] = [
  { value: 'both', label: '전체' },
  { value: 'long', label: '롱(상방)' },
  { value: 'short', label: '숏(하방)' },
];
const INTV_OPTS: { value: ScanInterval; label: string }[] = [
  { value: '15m', label: '15분' }, { value: '1h', label: '1시간' },
  { value: '4h', label: '4시간' }, { value: '1d', label: '일봉' },
];

const GLOSSARY = [
  { term: 'RR (위험수익비)', def: '손실 1에 대한 수익의 비율. RR=2는 "1 잃으면 2 번다"는 뜻' },
  { term: 'SR (지지/저항)', def: '가격이 반복적으로 반응하는 가격대. 터치 횟수가 많을수록 신뢰도 ↑' },
  { term: 'HVN ⑧ 매물대', def: '과거 거래량이 집중된 구간 — 돌파 시 강한 모멘텀 또는 저항 예상' },
  { term: 'ATR', def: '평균 변동폭(Average True Range). SL/TP 거리 계산에 사용' },
  { term: 'SL ④ (손절)', def: 'Stop Loss — 손실을 제한하는 가격. 진입 전 반드시 설정' },
  { term: 'TP ②③ (익절)', def: 'Take Profit — 수익 실현 목표가. TP1=1차, TP2=최종(RR=2)' },
  { term: 'ST/MT/LT', def: '단기(60봉)/중기(150봉)/장기(300봉) 시간대 분석 결과' },
  { term: 'Pivot', def: '주변 봉보다 고가/저가인 전환점. 지지/저항 레벨 산출에 사용' },
  { term: 'TRG (트리거가)', def: '추세선 돌파 신호의 기준가. 다음 봉 마감 시점에 이 가격을 돌파하면 신호 발동' },
  { term: '대기 (PENDING)', def: '아직 진입 조건 미충족 — 신호가 유효한 상태로 트리거를 기다리는 중' },
  { term: '발생 (TRIGGERED)', def: '트리거 조건 충족 — 진입 가격에 도달하여 신호가 활성화됨' },
  { term: '무효 (INVALID)', def: '시그널이 깨짐 — SL 터치 또는 구조 붕괴로 신호 무효화' },
  { term: '만료 (EXPIRED)', def: '유효 기간 초과 — 지정된 시간 내 트리거되지 않아 신호 소멸' },
];

const SCAN_DELAY_MS = 3000; // fire this many ms after candle close

// ── Helpers ────────────────────────────────────────────────────────────────
function scoreColor(s: number) { return s >= 75 ? '#0ecb81' : s >= 50 ? '#f0b90b' : '#848e9c'; }
function pf(p: number) { return p >= 1 ? p.toFixed(2) : p.toFixed(6); }
function pctStr(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }
function fmt(p: number) { return p >= 1 ? p.toFixed(2) : p.toFixed(6); }

const STATUS_LABEL: Record<CandidateStatus, string> = {
  PENDING: '대기', TRIGGERED: '발생', INVALID: '무효', EXPIRED: '만료',
};
const STATUS_COLOR: Record<CandidateStatus, string> = {
  PENDING: '#f0b90b', TRIGGERED: '#0ecb81', INVALID: '#f6465d', EXPIRED: '#5e6673',
};
const STATUS_ORDER: Record<CandidateStatus, number> = {
  PENDING: 0, TRIGGERED: 1, INVALID: 2, EXPIRED: 3,
};

// ── Opinion generator ──────────────────────────────────────────────────────
function buildOpinion(c: ScanCandidate): { text: string; stars: number; color: string } {
  const R  = Math.abs(c.entryPrice - c.slPrice);
  const rr = R > 0 ? Math.abs(c.tpPrice - c.entryPrice) / R : 0;
  const top = c.topLevels[0];
  const nearHVN = c.hvnZones.filter(z => Math.abs(z.centerPrice - c.entryPrice) / c.entryPrice < 0.03).length;

  let pts = Math.round(c.score * 0.35);
  const notes: string[] = [];

  if (rr >= 2)        { pts += 20; notes.push(`RR ${rr.toFixed(1)} 양호`); }
  else if (rr >= 1.5) { pts += 12; }
  else                { notes.push('RR 개선 권장'); }

  if (top) {
    if (top.score > 60)      { pts += 25; notes.push(`${top.horizon} 핵심 레벨(${top.touches}회 터치)`); }
    else if (top.score > 30) { pts += 15; }
    else                     { pts += 5; }
  }
  if (nearHVN > 0) { pts += 10; notes.push('HVN 매물대 근접'); }
  pts += c.breakoutType === 'trendline' ? 10 : c.breakoutType === 'hline' ? 7 : 5;

  const stars  = pts >= 80 ? 5 : pts >= 65 ? 4 : pts >= 50 ? 3 : pts >= 35 ? 2 : 1;
  const dirKo  = c.direction === 'long' ? '▲ 롱' : '▼ 숏';
  const color  = pts >= 65 ? '#0ecb81' : pts >= 45 ? '#f0b90b' : '#f6465d';
  const text   = pts >= 65
    ? `${dirKo} 강추 — ${notes.slice(0, 2).join(' · ')}`
    : pts >= 45
      ? `${dirKo} 검토 — ${notes.slice(0, 2).join(' · ')}`
      : `${dirKo} 신중 — 추가 확인 필요`;

  return { text, stars, color };
}

// ── Legend bar ─────────────────────────────────────────────────────────────
interface LegendItem { num: string; color: string; dash: boolean; label: string; }

function getLegendItems(levelMode: LevelMode, showHVN: boolean, hasTP1: boolean): LegendItem[] {
  const items: LegendItem[] = [
    { num: '①', color: '#f0b90b',               dash: false, label: '진입가 (Entry)' },
    { num: '②', color: '#0ecb81',               dash: false, label: 'TP2 최종 목표' },
    ...(hasTP1 ? [{ num: '③', color: 'rgba(14,203,129,0.65)', dash: true, label: 'TP1 1차 목표' }] : []),
    { num: '④', color: '#f6465d',               dash: false, label: 'SL 손절선' },
    { num: '⑤', color: 'rgba(14,203,129,0.90)', dash: false, label: '핵심 지지 레벨' },
    { num: '⑥', color: 'rgba(246,70,93,0.90)',  dash: false, label: '핵심 저항 레벨' },
    { num: '⑦', color: '#e8b73a',               dash: false, label: '돌파 패턴' },
  ];
  if (levelMode === 'all') {
    items.push(
      { num: '─', color: 'rgba(14,203,129,0.22)', dash: true, label: '지지 레벨' },
      { num: '─', color: 'rgba(246,70,93,0.22)',  dash: true, label: '저항 레벨' },
    );
  }
  if (showHVN) {
    items.push({ num: '⑧', color: 'rgba(240,185,11,0.60)', dash: false, label: 'HVN 매물대' });
  }
  return items;
}

function LegendBar({ levelMode, showHVN, hasTP1 }: { levelMode: LevelMode; showHVN: boolean; hasTP1: boolean }) {
  return (
    <div style={S.legendBar}>
      {getLegendItems(levelMode, showHVN, hasTP1).map(({ num, color, dash, label }) => (
        <div key={label} style={S.legendItem}>
          <span style={{ ...S.legendNum, color }}>{num}</span>
          <div style={{ width: 20, height: 0, borderTop: `2px ${dash ? 'dashed' : 'solid'} ${color}`, flexShrink: 0 }} />
          <span style={S.legendLabel}>{label}</span>
        </div>
      ))}
    </div>
  );
}

const LEVERAGE_PRESETS = [3, 5, 10, 20, 50];
const RISK_PRESETS = [1, 2, 3, 5];

// ── Info panel ─────────────────────────────────────────────────────────────
const MARGIN_PRESETS = [50, 100, 200, 500];
const MMR = 0.005; // 0.5% maintenance margin rate (Binance Futures default)

function calcLiqPrice(entry: number, isLong: boolean, leverage: number): number {
  return isLong
    ? entry * (1 - 1 / leverage + MMR)
    : entry * (1 + 1 / leverage - MMR);
}

function TradingInfoPanel({
  c, onPaperTrade, onLiveTrade,
  paperLeverage, setPaperLeverage, paperMarginType, setPaperMarginType, paperRiskPct, setPaperRiskPct,
  paperSizeMode, setPaperSizeMode, paperMarginUsdt, setPaperMarginUsdt,
  liveLeverage, setLiveLeverage, liveMarginType, setLiveMarginType, liveRiskPct, setLiveRiskPct,
  liveSizeMode, setLiveSizeMode, liveMarginUsdt, setLiveMarginUsdt,
  paperBalance,
}: {
  c: ScanCandidate;
  onPaperTrade?: (p: AltTradeParams) => void;
  onLiveTrade?: (p: AltTradeParams) => void;
  paperLeverage: number; setPaperLeverage: (v: number) => void;
  paperMarginType: 'ISOLATED' | 'CROSSED'; setPaperMarginType: (v: 'ISOLATED' | 'CROSSED') => void;
  paperRiskPct: number; setPaperRiskPct: (v: number) => void;
  paperSizeMode: 'risk' | 'margin'; setPaperSizeMode: (v: 'risk' | 'margin') => void;
  paperMarginUsdt: number; setPaperMarginUsdt: (v: number) => void;
  liveLeverage: number; setLiveLeverage: (v: number) => void;
  liveMarginType: 'ISOLATED' | 'CROSSED'; setLiveMarginType: (v: 'ISOLATED' | 'CROSSED') => void;
  liveRiskPct: number; setLiveRiskPct: (v: number) => void;
  liveSizeMode: 'risk' | 'margin'; setLiveSizeMode: (v: 'risk' | 'margin') => void;
  liveMarginUsdt: number; setLiveMarginUsdt: (v: number) => void;
  paperBalance?: number;
}) {
  const [showGlossary, setShowGlossary] = useState(false);
  const [showLiveTip, setShowLiveTip] = useState(false);
  const [showPaperSettings, setShowPaperSettings] = useState(false);
  const [showLiveSettings, setShowLiveSettings] = useState(false);
  const isLong = c.direction === 'long';
  const slPct  = (c.slPrice  - c.entryPrice) / c.entryPrice * 100;
  const tpPct  = (c.tpPrice  - c.entryPrice) / c.entryPrice * 100;
  const tp1Pct = c.tp1Price != null ? (c.tp1Price - c.entryPrice) / c.entryPrice * 100 : undefined;
  const R  = Math.abs(c.entryPrice - c.slPrice);
  const rr = R > 0 ? Math.abs(c.tpPrice - c.entryPrice) / R : 0;
  const breakEvenPct = Math.round(100 / (1 + rr));
  const nTrials      = Math.round(1 + rr);
  const volFactor    = c.volFactor;
  const supZone = c.topLevels.find(z => z.kind === 'support');
  const resZone = c.topLevels.find(z => z.kind === 'resistance');
  const slBasisText = isLong
    ? (supZone ? `${supZone.horizon} 지지 존 하단 기준` : 'ATR 기반 구조적 손절')
    : (resZone ? `${resZone.horizon} 저항 존 상단 기준` : 'ATR 기반 구조적 손절');
  const breakoutKo = c.breakoutType === 'trendline' ? '추세선 돌파'
    : c.breakoutType === 'hline' ? '수평 레벨 돌파' : '박스권 돌파';
  const opinion  = buildOpinion(c);
  const topLevel = c.topLevels[0];

  // Liquidation price estimates (isolated margin only)
  const paperLiqPrice = paperMarginType === 'ISOLATED' ? calcLiqPrice(c.entryPrice, isLong, paperLeverage) : null;
  const paperSlBeyondLiq = paperLiqPrice != null
    ? (isLong ? c.slPrice <= paperLiqPrice : c.slPrice >= paperLiqPrice)
    : false;
  const liveLiqPrice = liveMarginType === 'ISOLATED' ? calcLiqPrice(c.entryPrice, isLong, liveLeverage) : null;
  const liveSlBeyondLiq = liveLiqPrice != null
    ? (isLong ? c.slPrice <= liveLiqPrice : c.slPrice >= liveLiqPrice)
    : false;

  const drawingsSnapshot: Drawing[] = [
    ...c.drawingGroups.breakout,
    ...c.drawingGroups.topSR,
    ...c.drawingGroups.hvn,
    ...c.drawingGroups.entryLines,
  ];
  const baseParams = {
    symbol: c.symbol, direction: c.direction,
    entryPrice: c.entryPrice, slPrice: c.slPrice,
    tpPrice: c.tpPrice, tp1Price: c.tp1Price,
    candidateId: `${c.symbol}_${c.direction}_${c.asOfCloseTime}`,
    candidateScore: c.score,
    plannedEntry: c.entryPrice,
    plannedTP: c.tpPrice ?? null,
    plannedSL: c.slPrice ?? null,
    scanInterval: c.interval,
    validUntilTime: c.validUntilTime,
    drawingsSnapshot,
    breakoutType: c.breakoutType,
    candidateStatus: c.status,
    triggerPriceAtNextClose: c.triggerPriceAtNextClose,
  };
  const paperTradeParams: AltTradeParams = {
    ...baseParams,
    leverage: paperLeverage,
    marginType: paperMarginType,
    riskPct: paperRiskPct,
    sizeMode: paperSizeMode,
    marginUsdt: paperSizeMode === 'margin' ? paperMarginUsdt : undefined,
  };
  const liveTradeParams: AltTradeParams = {
    ...baseParams,
    leverage: liveLeverage,
    marginType: liveMarginType,
    riskPct: liveRiskPct,
    sizeMode: liveSizeMode,
    marginUsdt: liveSizeMode === 'margin' ? liveMarginUsdt : undefined,
  };

  return (
    <div style={S.infoPanel}>
      {/* Row 1: metrics + trade buttons */}
      <div style={S.metricRow}>
        <span style={{
          ...S.dirBadge,
          background: isLong ? 'rgba(14,203,129,0.15)' : 'rgba(246,70,93,0.15)',
          color: isLong ? '#0ecb81' : '#f6465d',
          borderColor: isLong ? '#0ecb81' : '#f6465d',
        }}>{isLong ? '▲ 롱 매수' : '▼ 숏 매도'}</span>

        <MBadge num="①" label="진입가" value={pf(c.entryPrice)} color="#f0b90b" />
        <div style={S.msep} />
        <MBadge num="④" label="손절 SL" value={pf(c.slPrice)} sub={pctStr(slPct)} color="#f6465d" />
        {tp1Pct != null && c.tp1Price != null && (
          <>
            <div style={S.msep} />
            <MBadge num="③" label="1차 목표" value={pf(c.tp1Price)} sub={pctStr(tp1Pct)} color="rgba(14,203,129,0.75)" />
          </>
        )}
        <div style={S.msep} />
        <MBadge num="②" label="최종 목표" value={pf(c.tpPrice)} sub={pctStr(tpPct)} color="#0ecb81" />

        {/* Trigger price at next close (for trendlines) */}
        {c.breakoutType === 'trendline' && (
          <>
            <div style={S.msep} />
            <div style={{ ...S.mbadge, cursor: 'help' }}
              title={isLong
                ? `TRG: 추세선 돌파 기준가입니다.\n다음 봉이 완전히 마감(종가 확정)될 때,\n종가 ≥ ${pf(c.triggerPriceAtNextClose)} 이면 롱 진입 신호가 발동됩니다.`
                : `TRG: 추세선 돌파 기준가입니다.\n다음 봉이 완전히 마감(종가 확정)될 때,\n종가 ≤ ${pf(c.triggerPriceAtNextClose)} 이면 숏 진입 신호가 발동됩니다.`
              }>
              <span style={{ ...S.mbadgeNum, color: '#f0b90b' }}>TRG</span>
              <div style={S.mbadgeInner}>
                <span style={{ ...S.mbadgeLabel, textTransform: 'none' as const }}>
                  {isLong ? '다음봉 종가 ≥ 이면 롱 신호 발동 ❓' : '다음봉 종가 ≤ 이면 숏 신호 발동 ❓'}
                </span>
                <span style={{ ...S.mbadgeValue, color: '#f0b90b' }}>{pf(c.triggerPriceAtNextClose)}</span>
              </div>
            </div>
          </>
        )}

        <div style={{ flex: 1 }} />

        <div style={S.rrBox}>
          <span style={S.rrLabel}>위험/수익비</span>
          <span style={S.rrValue}>RR 1:{rr.toFixed(1)}</span>
        </div>

        {onPaperTrade && (
          <>
            <button style={S.paperTradeBtn} onClick={() => onPaperTrade(paperTradeParams)}
              title="모의 포지션 자동 개설 (지정가 예약)">
              📄 모의진입
            </button>
            <button
              style={{ ...S.paperTradeBtn,
                ...(showPaperSettings ? { borderColor: '#f0b90b', background: 'rgba(240,185,11,0.20)' } : { opacity: 0.8 }),
              }}
              onClick={() => { setShowPaperSettings(v => !v); setShowLiveSettings(false); }}
              title="모의 진입 레버리지·마진·비율 설정">
              ⚙ 모의 설정 {showPaperSettings ? '▲' : '▼'}
            </button>
          </>
        )}
        {onLiveTrade && (
          <>
            <button style={S.liveTradeBtn} onClick={() => onLiveTrade(liveTradeParams)}
              title="실전 모드 — 지정가 주문 자동 접수">
              ⚡ 실전진입
            </button>
            <button
              style={{ ...S.liveTradeBtn,
                ...(showLiveSettings ? { borderColor: '#0ecb81', background: 'rgba(14,203,129,0.20)' } : { opacity: 0.8 }),
              }}
              onClick={() => { setShowLiveSettings(v => !v); setShowPaperSettings(false); }}
              title="실전 투입 레버리지·마진·비율 설정">
              ⚙ 실전 설정 {showLiveSettings ? '▲' : '▼'}
            </button>
          </>
        )}
      </div>

      {/* Liquidation warning row */}
      {(paperSlBeyondLiq || liveSlBeyondLiq) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, padding: '5px 8px', background: 'rgba(246,70,93,0.10)', border: '1px solid rgba(246,70,93,0.35)', borderRadius: 5 }}>
          {paperSlBeyondLiq && paperLiqPrice != null && (
            <span style={{ fontSize: '0.76rem', color: '#f6465d' }}>
              ⚠️ 모의 {paperLeverage}x 격리: 예상 청산가 <b>{paperLiqPrice >= 1 ? paperLiqPrice.toFixed(2) : paperLiqPrice.toFixed(6)}</b> ({((paperLiqPrice - c.entryPrice) / c.entryPrice * 100).toFixed(1)}%) — SL이 청산가 {isLong ? '아래' : '위'}에 있어 청산이 먼저 발생합니다
            </span>
          )}
          {liveSlBeyondLiq && liveLiqPrice != null && (
            <span style={{ fontSize: '0.76rem', color: '#f6465d' }}>
              ⚠️ 실전 {liveLeverage}x 격리: 예상 청산가 <b>{liveLiqPrice >= 1 ? liveLiqPrice.toFixed(2) : liveLiqPrice.toFixed(6)}</b> ({((liveLiqPrice - c.entryPrice) / c.entryPrice * 100).toFixed(1)}%) — SL이 청산가 {isLong ? '아래' : '위'}에 있어 청산이 먼저 발생합니다
            </span>
          )}
        </div>
      )}

      {/* Paper settings panel */}
      {showPaperSettings && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'rgba(0,0,0,0.30)', borderRadius: 6, border: '1px solid rgba(240,185,11,0.25)', flexWrap: 'wrap' as const }}>
          <span style={{ color: '#f0b90b', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' as const }}>📄 모의 설정</span>
          <div style={{ width: 1, height: 22, background: '#2a2e39', flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>레버리지</span>
            {LEVERAGE_PRESETS.map(lv => (
              <button key={lv}
                style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                  ...(paperLeverage === lv ? { borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.12)' } : {}),
                }}
                onClick={() => setPaperLeverage(lv)}>
                {lv}x
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: '#2a2e39', flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>마진</span>
            {(['ISOLATED', 'CROSSED'] as const).map(mt => (
              <button key={mt}
                style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                  ...(paperMarginType === mt ? { borderColor: '#3b8beb', color: '#3b8beb', background: 'rgba(59,139,235,0.12)' } : {}),
                }}
                onClick={() => setPaperMarginType(mt)}>
                {mt === 'ISOLATED' ? '격리' : '교차'}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: '#2a2e39', flexShrink: 0 }} />
          {/* Size mode toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>수량 기준</span>
            {(['risk', 'margin'] as const).map(m => (
              <button key={m}
                style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                  ...(paperSizeMode === m ? { borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.12)' } : {}),
                }}
                onClick={() => setPaperSizeMode(m)}>
                {m === 'risk' ? '리스크%' : '마진'}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: '#2a2e39', flexShrink: 0 }} />
          {paperSizeMode === 'risk' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>리스크</span>
              {RISK_PRESETS.map(r => (
                <button key={r}
                  style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                    ...(paperRiskPct === r ? { borderColor: '#0ecb81', color: '#0ecb81', background: 'rgba(14,203,129,0.12)' } : {}),
                  }}
                  onClick={() => setPaperRiskPct(r)}>
                  {r}%
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>마진(USDT)</span>
              {MARGIN_PRESETS.map(m => (
                <button key={m}
                  style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                    ...(paperMarginUsdt === m ? { borderColor: '#0ecb81', color: '#0ecb81', background: 'rgba(14,203,129,0.12)' } : {}),
                  }}
                  onClick={() => setPaperMarginUsdt(m)}>
                  ${m}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={paperMarginUsdt}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setPaperMarginUsdt(v); }}
                style={{ width: 72, padding: '2px 6px', borderRadius: 4, border: '1px solid #3b8beb', background: '#131722', color: '#d1d4dc', fontSize: '0.78rem', fontFamily: 'inherit' }}
              />
            </div>
          )}
          <span style={{ color: '#5e6673', fontSize: '0.72rem', marginLeft: 2 }}>
            <b style={{ color: '#f0b90b' }}>{paperLeverage}x</b> · <b style={{ color: '#3b8beb' }}>{paperMarginType === 'ISOLATED' ? '격리' : '교차'}</b>
            {paperSizeMode === 'risk' ? (
              <>
                {' · '}<b style={{ color: '#0ecb81' }}>{paperRiskPct}%</b> 리스크
                {paperBalance != null && paperBalance > 0 && (
                  <> = <b style={{ color: '#0ecb81' }}>${(paperBalance * paperRiskPct / 100).toFixed(2)}</b></>
                )}
              </>
            ) : (
              <> · 투입마진 <b style={{ color: '#0ecb81' }}>${paperMarginUsdt}</b></>
            )}
          </span>
        </div>
      )}

      {/* Live settings panel */}
      {showLiveSettings && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'rgba(0,0,0,0.30)', borderRadius: 6, border: '1px solid rgba(14,203,129,0.25)', flexWrap: 'wrap' as const }}>
          <span style={{ color: '#0ecb81', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' as const }}>⚡ 실전 설정</span>
          <div style={{ width: 1, height: 22, background: '#2a2e39', flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>레버리지</span>
            {LEVERAGE_PRESETS.map(lv => (
              <button key={lv}
                style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                  ...(liveLeverage === lv ? { borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.12)' } : {}),
                }}
                onClick={() => setLiveLeverage(lv)}>
                {lv}x
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: '#2a2e39', flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>마진</span>
            {(['ISOLATED', 'CROSSED'] as const).map(mt => (
              <button key={mt}
                style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                  ...(liveMarginType === mt ? { borderColor: '#3b8beb', color: '#3b8beb', background: 'rgba(59,139,235,0.12)' } : {}),
                }}
                onClick={() => setLiveMarginType(mt)}>
                {mt === 'ISOLATED' ? '격리' : '교차'}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: '#2a2e39', flexShrink: 0 }} />
          {/* Size mode toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>수량 기준</span>
            {(['risk', 'margin'] as const).map(m => (
              <button key={m}
                style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                  ...(liveSizeMode === m ? { borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.12)' } : {}),
                }}
                onClick={() => setLiveSizeMode(m)}>
                {m === 'risk' ? '리스크%' : '마진'}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: '#2a2e39', flexShrink: 0 }} />
          {liveSizeMode === 'risk' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>리스크</span>
              {RISK_PRESETS.map(r => (
                <button key={r}
                  style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                    ...(liveRiskPct === r ? { borderColor: '#0ecb81', color: '#0ecb81', background: 'rgba(14,203,129,0.12)' } : {}),
                  }}
                  onClick={() => setLiveRiskPct(r)}>
                  {r}%
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: '#5e6673', fontSize: '0.75rem', whiteSpace: 'nowrap' as const }}>마진(USDT)</span>
              {MARGIN_PRESETS.map(m => (
                <button key={m}
                  style={{ ...S.glossaryBtn, padding: '2px 9px', fontSize: '0.78rem',
                    ...(liveMarginUsdt === m ? { borderColor: '#f6465d', color: '#f6465d', background: 'rgba(246,70,93,0.12)' } : {}),
                  }}
                  onClick={() => setLiveMarginUsdt(m)}>
                  ${m}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={liveMarginUsdt}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setLiveMarginUsdt(v); }}
                style={{ width: 72, padding: '2px 6px', borderRadius: 4, border: '1px solid #f6465d', background: '#131722', color: '#d1d4dc', fontSize: '0.78rem', fontFamily: 'inherit' }}
              />
            </div>
          )}
          <span style={{ color: '#5e6673', fontSize: '0.72rem', marginLeft: 2 }}>
            <b style={{ color: '#f0b90b' }}>{liveLeverage}x</b> · <b style={{ color: '#3b8beb' }}>{liveMarginType === 'ISOLATED' ? '격리' : '교차'}</b>
            {liveSizeMode === 'risk'
              ? <> · 잔고 <b style={{ color: '#f6465d' }}>{liveRiskPct}%</b> 리스크</>
              : <> · 투입마진 <b style={{ color: '#f6465d' }}>${liveMarginUsdt}</b></>
            }
          </span>
        </div>
      )}

      {/* Entry method notice for trendline signals */}
      {c.breakoutType === 'trendline' && (c.status === 'PENDING' || c.status === 'TRIGGERED') && (
        <div style={{ display: 'flex', gap: 12, padding: '6px 12px', borderRadius: 6, flexWrap: 'wrap' as const, fontSize: '0.74rem',
          ...(c.status === 'PENDING'
            ? { background: 'rgba(240,185,11,0.06)', border: '1px solid rgba(240,185,11,0.22)' }
            : { background: 'rgba(14,203,129,0.05)', border: '1px solid rgba(14,203,129,0.2)' }),
        }}>
          {c.status === 'PENDING' ? (
            <>
              <span style={{ color: '#f0b90b', fontWeight: 700, whiteSpace: 'nowrap' as const }}>⏳ 조건부 진입 (대기중)</span>
              <span style={{ color: '#ccc' }}>
                📄 <b style={{ color: '#f0b90b' }}>모의</b>: 다음 봉 종가 {isLong ? '≥' : '≤'} <b style={{ color: '#f0b90b' }}>{pf(c.triggerPriceAtNextClose)}</b> 확정 시 자동 체결
              </span>
              <span style={{ color: '#848e9c' }}>|</span>
              <span style={{ color: '#ccc' }}>
                ⚡ <b style={{ color: '#0ecb81' }}>실전</b>: 지정가 @ <b style={{ color: '#0ecb81' }}>{pf(c.triggerPriceAtNextClose)}</b> <span style={{ color: '#f6465d' }}>(봉마감 미확인)</span>
              </span>
            </>
          ) : (
            <>
              <span style={{ color: '#0ecb81', fontWeight: 700, whiteSpace: 'nowrap' as const }}>✅ 돌파 확인됨 (즉시 진입)</span>
              <span style={{ color: '#ccc' }}>
                📄 <b style={{ color: '#f0b90b' }}>모의</b>: 지정가 @ <b style={{ color: '#f0b90b' }}>{pf(c.entryPrice)}</b> 예약 — 현재가 도달 시 체결
              </span>
              <span style={{ color: '#848e9c' }}>|</span>
              <span style={{ color: '#ccc' }}>
                ⚡ <b style={{ color: '#0ecb81' }}>실전</b>: 지정가 @ <b style={{ color: '#0ecb81' }}>{pf(c.entryPrice)}</b> 즉시 접수
              </span>
            </>
          )}
        </div>
      )}

      {/* Row 2: 4 explanation blocks */}
      <div style={S.blockRow}>
        <InfoBlock icon="📌" title="진입 조건">
          <div>종가 기준 <b>{breakoutKo}</b> 확인 후 진입</div>
          <div>거래량 ≥ SMA20(20봉) × <b>{volFactor}배</b> 이상</div>
        </InfoBlock>
        <InfoBlock icon="🛡" title="손절 기준">
          <div><b>{slBasisText}</b></div>
          <div>진입 전 손절가 설정 필수</div>
        </InfoBlock>
        <InfoBlock icon="🔍" title="분석 근거">
          <div>SR 레벨 <b>{c.srLevels.length}개</b> · HVN <b>{c.hvnZones.length}개</b></div>
          {topLevel && (
            <div>{topLevel.horizon} {topLevel.kind === 'support' ? '지지' : '저항'} ·&nbsp;
              <b>{topLevel.touches}회 터치</b> · score {topLevel.score}</div>
          )}
        </InfoBlock>
        <InfoBlock icon="⭐" title="종합 의견">
          <div style={{ color: opinion.color, fontWeight: 700 }}>
            {'★'.repeat(opinion.stars)}{'☆'.repeat(5 - opinion.stars)}
          </div>
          <div style={{ color: opinion.color }}>{opinion.text}</div>
        </InfoBlock>
      </div>

      {/* Row 3: tip + glossary toggle */}
      <div style={S.footerRow}>
        <span style={S.tipText}>
          💡 RR={rr.toFixed(1)} → 승률 <b>{breakEvenPct}%</b> 이상이면 수익 ({nTrials}번 중 1번만 성공해도 손익분기)
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ background: showGlossary ? 'rgba(59,139,235,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${showGlossary ? 'rgba(59,139,235,0.5)' : '#3a3f4b'}`, borderRadius: 5, color: showGlossary ? '#3b8beb' : '#848e9c', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600, padding: '5px 14px', fontFamily: 'inherit', whiteSpace: 'nowrap' as const, flexShrink: 0, lineHeight: 1.4, height: 32 }}
            onClick={() => { setShowLiveTip(false); setShowGlossary(v => !v); }}>
            📖 용어 사전 {showGlossary ? '▲' : '▼'}
          </button>
          {onLiveTrade && (
            <button style={{ ...S.liveTradeBtn, opacity: 0.9 }}
              onClick={() => { setShowGlossary(false); setShowLiveTip(v => !v); }}>
              ⚡ 실전진입 안내 {showLiveTip ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>

      {showGlossary && (
        <div style={S.glossaryGrid}>
          {GLOSSARY.map(({ term, def }) => (
            <div key={term} style={S.glossaryItem}>
              <span style={S.glossaryTerm}>{term}</span>
              <span style={S.glossaryDef}>{def}</span>
            </div>
          ))}
        </div>
      )}

      {showLiveTip && (
        <div style={{ ...S.glossaryGrid, gridTemplateColumns: '1fr', gap: 6, borderTop: '1px solid rgba(240,185,11,0.2)', paddingTop: 8 }}>
          {[
            { icon: '📋', title: '주문 방식', desc: '진입가 기준 지정가(Limit) 주문으로 자동 접수됩니다. 가격에 도달하지 않으면 미체결 상태로 남습니다.' },
            { icon: '💰', title: '수량 계산', desc: `잔고의 ${liveRiskPct}% 리스크 기준으로 수량이 자동 산출됩니다. (수량 = 잔고 × ${liveRiskPct}% ÷ SL 거리)` },
            { icon: '⚙️', title: '레버리지 · 마진', desc: `현재 설정: 레버리지 ${liveLeverage}x · ${liveMarginType === 'ISOLATED' ? '격리 마진(Isolated)' : '교차 마진(Cross)'}. ⚙ 실전 설정 버튼으로 변경 가능합니다.` },
            { icon: '🎯', title: 'TP/SL 자동 설정', desc: '진입 주문 체결 직후 TP(익절)와 SL(손절) 조건부 주문이 자동으로 등록됩니다.' },
            { icon: '⚠️', title: '단방향(One-way) 필수', desc: '바이낸스 선물 계정이 단방향(One-way) 모드여야 합니다. Hedge 모드는 미지원 — positionSide를 미전송하므로 Hedge 계정에서는 오류가 발생합니다. 진입 전 자동으로 모드를 확인하며, Hedge 감지 시 진입이 중단됩니다.' },
            { icon: '🔑', title: 'API 키 필요', desc: '설정 > API 키에 바이낸스 Futures API Key / Secret이 입력되어 있어야 실전 주문이 가능합니다.' },
            { icon: '📌', title: '알아두세요', desc: '실전 주문 접수 후 바이낸스 앱에서 체결 여부를 반드시 확인하세요. 미체결 주문은 수동으로 취소 가능합니다.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{icon}</span>
              <div>
                <span style={{ color: '#f0b90b', fontWeight: 600, fontSize: 11 }}>{title}　</span>
                <span style={{ color: '#c9cfd8', fontSize: 11 }}>{desc}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MBadge({ num, label, value, sub, color }: {
  num: string; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div style={S.mbadge}>
      <span style={{ ...S.mbadgeNum, color }}>{num}</span>
      <div style={S.mbadgeInner}>
        <span style={S.mbadgeLabel}>{label}</span>
        <span style={{ ...S.mbadgeValue, color }}>{value}</span>
        {sub && <span style={{ ...S.mbadgeSub, color }}>{sub}</span>}
      </div>
    </div>
  );
}

function InfoBlock({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={S.infoBlock}>
      <div style={S.infoBlockTitle}>{icon} {title}</div>
      <div style={S.infoBlockBody}>{children}</div>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────
export function AltScannerModal({
  symbols, initialCandidates, onCandidatesChange, onClose, onOpenInMain,
  onPaperTrade, onLiveTrade, snapshotMeta, paperBalance,
}: Props) {
  const [showFAQ, setShowFAQ]           = useState(false);
  const [scanInterval, setScanInterval] = useState<ScanInterval>('1h');
  const [direction, setDirection]       = useState<ScanDirection>('both');
  const [scanning, setScanning]         = useState(false);
  const [progress, setProgress]         = useState({ done: 0, total: 0 });
  // Per-interval candidate cache so switching interval back restores previous results
  const [candidatesCache, setCandidatesCache] = useState<Record<string, ScanCandidate[]>>(() => {
    const cache: Record<string, ScanCandidate[]> = {};
    for (const c of initialCandidates) {
      cache[c.interval] = [...(cache[c.interval] ?? []), c];
    }
    return cache;
  });
  const candidates = useMemo(() => candidatesCache[scanInterval] ?? [], [candidatesCache, scanInterval]);
  const [selected, setSelected]         = useState<ScanCandidate | null>(
    initialCandidates.length > 0 ? initialCandidates[0] : null,
  );
  const [chartCandles, setChartCandles] = useState<Candle[]>(
    initialCandidates.length > 0 ? initialCandidates[0].candles : [],
  );
  // Independent chart view interval (can differ from scanInterval)
  const [chartViewInterval, setChartViewInterval] = useState<Interval>(
    initialCandidates.length > 0 ? initialCandidates[0].interval as Interval : '1h',
  );
  // Candles fetched for chart view when chartViewInterval !== scanInterval
  const [chartViewCandles, setChartViewCandles] = useState<Candle[]>([]);
  const [levelMode, setLevelMode]       = useState<LevelMode>('core');
  const [showHVN, setShowHVN]           = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [paperLeverage, setPaperLeverage]       = useState(10);
  const [paperMarginType, setPaperMarginType]   = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
  const [paperRiskPct, setPaperRiskPct]         = useState(2);
  const [paperSizeMode, setPaperSizeMode]       = useState<'risk' | 'margin'>('risk');
  const [paperMarginUsdt, setPaperMarginUsdt]   = useState(100);
  const [liveLeverage, setLiveLeverage]         = useState(10);
  const [liveMarginType, setLiveMarginType]     = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
  const [liveRiskPct, setLiveRiskPct]           = useState(2);
  const [liveSizeMode, setLiveSizeMode]         = useState<'risk' | 'margin'>('risk');
  const [liveMarginUsdt, setLiveMarginUsdt]     = useState(100);

  // Snapshot view: candles fetched when snapshotMeta is provided
  const [snapshotCandles, setSnapshotCandles] = useState<Candle[]>([]);

  // Auto-scan
  const [autoScanEnabled, setAutoScanEnabled] = useState<boolean>(() => defaultAutoScan('1h'));
  const [nextAutoScanAt, setNextAutoScanAt]   = useState<number | null>(null);
  const [lastScanAt, setLastScanAt]           = useState<number | null>(null);

  // 1-second ticker for countdown + EXPIRED updates
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const tid = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tid);
  }, []);

  // Abort ref
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs (avoid stale closures in async callbacks)
  const scanningRef        = useRef(false);
  const selectedRef        = useRef<ScanCandidate | null>(null);
  const autoScanEnabledRef = useRef(autoScanEnabled);
  const scanIntervalRef    = useRef(scanInterval);
  useEffect(() => { scanningRef.current = scanning; }, [scanning]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { autoScanEnabledRef.current = autoScanEnabled; }, [autoScanEnabled]);
  useEffect(() => { scanIntervalRef.current = scanInterval; }, [scanInterval]);

  // ── EXPIRED status sweep (every second) ──────────────────────────────────
  useEffect(() => {
    const now = Date.now();
    setCandidatesCache(prev => {
      const iv = scanIntervalRef.current;
      const cur = prev[iv] ?? [];
      const needsUpdate = cur.some(c => c.status === 'PENDING' && now > c.validUntilTime);
      if (!needsUpdate) return prev;
      return {
        ...prev,
        [iv]: cur.map(c =>
          c.status === 'PENDING' && now > c.validUntilTime
            ? { ...c, status: 'EXPIRED' as const, expiredReason: 'TTL 만료' }
            : c,
        ),
      };
    });
    setSelected(s =>
      s && s.status === 'PENDING' && now > s.validUntilTime
        ? { ...s, status: 'EXPIRED' as const, expiredReason: 'TTL 만료' }
        : s,
    );
  }, [nowMs]);

  useEffect(() => { onCandidatesChange(candidates); }, [candidates, onCandidatesChange]);

  // ── Snapshot: fetch candles when snapshotMeta changes ────────────────────
  // Always fetch fresh candles and use the stored drawingsSnapshot.
  // Do NOT try to match candidates — the stored snapshot may differ from the
  // current scan results (e.g. auto-trade ran while the modal was closed).
  useEffect(() => {
    if (!snapshotMeta) { setSnapshotCandles([]); return; }
    setSelected(null); // clear any previously selected candidate
    setSnapshotCandles([]); // show "로딩 중…" while fetching
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${snapshotMeta.symbol}&interval=${snapshotMeta.scanInterval}&limit=300`;
    fetch(url)
      .then(r => r.json())
      .then((raw: unknown[][]) => setSnapshotCandles(raw.map(r => ({
        time:   r[0] as number,
        open:   parseFloat(r[1] as string),
        high:   parseFloat(r[2] as string),
        low:    parseFloat(r[3] as string),
        close:  parseFloat(r[4] as string),
        volume: parseFloat(r[5] as string),
      }))))
      .catch(() => {});
  }, [snapshotMeta?.candidateId]);

  // ── Fetch candles when chart view interval differs from scan interval ────
  useEffect(() => {
    if (!selected) { setChartViewCandles([]); return; }
    if (chartViewInterval === (selected.interval as Interval)) {
      setChartViewCandles([]);
      return;
    }
    setChartViewCandles([]);
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${selected.symbol}&interval=${chartViewInterval}&limit=300`;
    fetch(url)
      .then(r => r.json())
      .then((raw: unknown[][]) => setChartViewCandles(raw.map(r => ({
        time:   r[0] as number,
        open:   parseFloat(r[1] as string),
        high:   parseFloat(r[2] as string),
        low:    parseFloat(r[3] as string),
        close:  parseFloat(r[4] as string),
        volume: parseFloat(r[5] as string),
      }))))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.symbol, selected?.direction, chartViewInterval]);

  // ── WS: real-time chart + revalidation on candle close ───────────────────
  useBinanceWS(selected?.symbol ?? '', scanInterval as Interval, useCallback((candle: Candle) => {
    setChartCandles(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const isNewCandle = last.time !== candle.time;

      // New candle opened → "last" just closed → revalidate selected candidate
      if (isNewCandle && prev.length >= 2) {
        const sel = selectedRef.current;

        if (sel && (sel.status === 'PENDING' || sel.status === 'EXPIRED')) {
          const lastClosed = last;
          const prevClosed = prev[prev.length - 2];
          const iMs  = intervalToMs(sel.interval);
          const now  = Date.now();
          // prev is all closed candles (last element = lastClosed)
          const updates = revalidateCandidate(sel, lastClosed, prevClosed, prev, iMs, now);
          if (Object.keys(updates).length > 0) {
            const next = { ...sel, ...updates } as ScanCandidate;
            const iv = scanIntervalRef.current;
            setCandidatesCache(prev => ({
              ...prev,
              [iv]: (prev[iv] ?? []).map(c =>
                c.symbol === sel.symbol && c.direction === sel.direction ? next : c,
              ),
            }));
            setSelected(next);
          }
        }
        return [...prev, candle];
      }

      // Same candle — update in place
      return [...prev.slice(0, -1), candle];
    });
  }, []));

  // ── Candidate selection ───────────────────────────────────────────────────
  const handleSelect = useCallback((c: ScanCandidate) => {
    setSelected(c);
    setChartCandles(c.candles);
    setChartViewInterval(c.interval as Interval);
    setChartViewCandles([]);
  }, []);

  // ── Manual scan ───────────────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    if (scanning) { abortRef.current?.abort(); return; }
    abortRef.current = new AbortController();
    setScanning(true);
    setCandidatesCache(prev => ({ ...prev, [scanInterval]: [] }));
    setSelected(null);
    setProgress({ done: 0, total: symbols.length });
    try {
      await runBreakoutScan(symbols, scanInterval, direction,
        (done, total) => setProgress({ done, total }),
        (c) => setCandidatesCache(prev => ({
          ...prev,
          [scanInterval]: [...(prev[scanInterval] ?? []), c].sort((a, b) => {
            const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
            return so !== 0 ? so : b.score - a.score;
          }),
        })),
        abortRef.current.signal);
    } finally {
      setScanning(false);
      setLastScanAt(Date.now());
    }
  }, [scanning, symbols, scanInterval, direction]);

  // Auto-select first candidate after scan
  useEffect(() => {
    if (!scanning && candidates.length > 0 && !selected) handleSelect(candidates[0]);
  }, [scanning, candidates, selected, handleSelect]);

  // ── Auto-scan: schedule next aligned close time ───────────────────────────
  useEffect(() => {
    if (!autoScanEnabled) {
      setNextAutoScanAt(null);
      return;
    }
    const iMs    = intervalToMs(scanInterval);
    const fireAt = getNextAlignedCloseTime(Date.now(), iMs) + SCAN_DELAY_MS;
    setNextAutoScanAt(fireAt);
  }, [autoScanEnabled, scanInterval]);

  // Auto-scan executor — fires at nextAutoScanAt
  useEffect(() => {
    if (!nextAutoScanAt || !autoScanEnabled) return;
    const delay = nextAutoScanAt - Date.now();
    if (delay <= 0) {
      // Already past — jump to next interval
      const iMs = intervalToMs(scanInterval);
      setNextAutoScanAt(getNextAlignedCloseTime(Date.now(), iMs) + SCAN_DELAY_MS);
      return;
    }

    const tid = setTimeout(async () => {
      if (scanningRef.current) {
        // Busy — skip this slot, reschedule
        const iMs = intervalToMs(scanInterval);
        setNextAutoScanAt(getNextAlignedCloseTime(Date.now(), iMs) + SCAN_DELAY_MS);
        return;
      }
      abortRef.current = new AbortController();
      setScanning(true);
      setCandidatesCache(prev => ({ ...prev, [scanInterval]: [] }));
      setSelected(null);
      setProgress({ done: 0, total: symbols.length });
      try {
        await runBreakoutScan(
          symbols, scanInterval, direction,
          (done, total) => setProgress({ done, total }),
          (c) => setCandidatesCache(prev => ({
            ...prev,
            [scanInterval]: [...(prev[scanInterval] ?? []), c].sort((a, b) => {
              const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
              return so !== 0 ? so : b.score - a.score;
            }),
          })),
          abortRef.current.signal,
        );
      } finally {
        if (!abortRef.current?.signal.aborted) {
          setScanning(false);
          setLastScanAt(Date.now());
          // Use ref to get current value, not stale closure value
          if (autoScanEnabledRef.current) {
            const iMs = intervalToMs(scanInterval);
            setNextAutoScanAt(getNextAlignedCloseTime(Date.now(), iMs) + SCAN_DELAY_MS);
          }
        }
      }
    }, delay);

    return () => clearTimeout(tid);
  }, [nextAutoScanAt, autoScanEnabled, symbols, scanInterval, direction]);

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── Drawing computation ───────────────────────────────────────────────────
  const activeDrawings = useMemo((): Drawing[] => {
    if (!selected) return [];
    const { drawingGroups: g } = selected;

    // For trendlines, annotate the entry hline memo with triggerPriceAtNextClose
    // (do NOT move the price — entry line must stay at entryPrice above SL)
    const entryLines = g.entryLines.map((d): Drawing => {
      if (d.type === 'hline' && d.memo?.startsWith('① ') && selected.breakoutType === 'trendline' && selected.triggerPriceAtNextClose) {
        const hd = d as HlineDrawing;
        const updated: HlineDrawing = {
          ...hd,
          memo: `${hd.memo} · 다음봉 기준: ${fmt(selected.triggerPriceAtNextClose)}`,
        };
        return updated;
      }
      return d;
    });

    if (levelMode === 'core') return [...g.breakout, ...g.topSR, ...entryLines];
    return [...g.breakout, ...g.dimSR, ...g.topSR, ...(showHVN ? g.hvn : []), ...entryLines];
  }, [selected, levelMode, showHVN]);

  // ── Sorted + filtered candidate list ─────────────────────────────────────
  const displayCandidates = useMemo(() => {
    let list = [...candidates];
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    return list.sort((a, b) => {
      const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return so !== 0 ? so : b.score - a.score;
    });
  }, [candidates, statusFilter]);

  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const hasTP1      = selected?.tp1Price != null;
  const countdown   = nextAutoScanAt ? fmtCountdown(nextAutoScanAt - nowMs) : null;

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={S.header}>
          <span style={S.title}>🔍 알트추천 (돌파 스캐너)</span>
          <div style={S.headerRight}>
            <span style={S.toggleLabel}>레벨 표시</span>
            <button
              style={{ ...S.toggleBtn, ...(levelMode === 'core' ? S.toggleActive : {}) }}
              onClick={() => setLevelMode('core')}>핵심만</button>
            <button
              style={{ ...S.toggleBtn, ...(levelMode === 'all' ? S.toggleActive : {}) }}
              onClick={() => setLevelMode('all')}>전체</button>
            <div style={S.sep} />
            <span style={S.toggleLabel}>매물대 ⑧</span>
            <button
              style={{ ...S.toggleBtn, ...(showHVN ? S.hvnActive : {}) }}
              onClick={() => setShowHVN(v => !v)}>
              {showHVN ? 'ON' : 'OFF'}
            </button>
            <div style={S.sep} />
            <button
              style={{ ...S.toggleBtn, borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.08)', fontSize: '0.78rem', padding: '2px 10px' }}
              onClick={() => setShowFAQ(true)}
              title="ALT추천 매수 로직 전체 해설">
              📋 FAQ
            </button>
            <div style={S.sep} />
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {showFAQ && <AltScannerFAQ onClose={() => setShowFAQ(false)} />}

        {/* ── Auto-scan status bar ────────────────────────────────────────── */}
        <div style={S.autoBar}>
          {/* Left: scan timing info */}
          <div style={S.autoBarLeft}>
            {lastScanAt && (
              <span style={S.autoBarInfo}>
                최근 스캔: <b>{fmtDateTime(lastScanAt)}</b>
              </span>
            )}
            {autoScanEnabled && countdown && !scanning && (
              <span style={S.autoBarCountdown}>
                다음 자동 스캔: <b style={{ color: '#3b8beb', fontFamily: 'monospace' }}>{countdown}</b>
              </span>
            )}
            {autoScanEnabled && scanning && (
              <span style={{ ...S.autoBarInfo, color: '#f0b90b' }}>자동 스캔 실행 중…</span>
            )}
          </div>

          {/* Right: auto-scan toggle */}
          <div style={S.autoBarRight}>
            {scanInterval === '15m' && (
              <span style={S.autoBarNote}>15m은 비용 절감을 위해 기본 OFF</span>
            )}
            <span style={S.toggleLabel}>자동 스캔</span>
            <button
              style={{ ...S.toggleBtn, ...(autoScanEnabled ? S.autoScanActive : {}) }}
              onClick={() => setAutoScanEnabled(v => !v)}
              title={autoScanEnabled ? '봉 마감 직후 자동으로 전수 스캔합니다' : '자동 스캔이 꺼져 있습니다'}>
              {autoScanEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* ── Controls ────────────────────────────────────────────────────── */}
        <div style={S.controls}>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>방향</span>
            {DIR_OPTS.map(o => (
              <button key={o.value}
                style={{ ...S.ctrlBtn, ...(direction === o.value ? S.ctrlActive : {}) }}
                onClick={() => setDirection(o.value)}>{o.label}</button>
            ))}
          </div>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>타임프레임</span>
            {INTV_OPTS.map(o => (
              <button key={o.value}
                style={{ ...S.ctrlBtn, ...(scanInterval === o.value ? S.ctrlActive : {}) }}
                onClick={() => {
                  const cached = candidatesCache[o.value] ?? [];
                  setScanInterval(o.value);
                  setAutoScanEnabled(defaultAutoScan(o.value));
                  // Restore cached results for this interval (or clear if none)
                  const first = cached[0] ?? null;
                  setSelected(first);
                  setChartCandles(first?.candles ?? []);
                  setChartViewInterval(first ? first.interval as Interval : o.value as Interval);
                  setChartViewCandles([]);
                }}>{o.label}</button>
            ))}
          </div>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>상태</span>
            {(['all', 'PENDING', 'TRIGGERED'] as StatusFilter[]).map(f => (
              <button key={f}
                style={{ ...S.ctrlBtn, ...(statusFilter === f ? S.ctrlActive : {}) }}
                onClick={() => setStatusFilter(f)}>
                {f === 'all' ? '전체' : STATUS_LABEL[f as CandidateStatus]}
              </button>
            ))}
          </div>
          <button
            style={{ ...S.scanBtn, ...(scanning ? S.scanStop : {}) }}
            onClick={handleScan}>
            {scanning ? '⏹ 중지' : '▶ 스캔 시작'}
          </button>
        </div>

        {/* ── Progress ─────────────────────────────────────────────────────── */}
        {(scanning || progress.done > 0) && (
          <div style={S.progressWrap}>
            <div style={{ ...S.progressBar, width: `${progressPct}%` }} />
            <span style={S.progressText}>
              {progress.done}/{progress.total} ({progressPct}%) — 발굴: {candidates.length}개
            </span>
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div style={S.body}>
          {/* List */}
          <div style={S.list}>
            {displayCandidates.length === 0 && !scanning && (
              <div style={S.emptyMsg}>
                {progress.done > 0 ? '발굴된 종목 없음' : '스캔을 시작하세요'}
              </div>
            )}
            {displayCandidates.map(c => {
              const op     = buildOpinion(c);
              const active = selected?.symbol === c.symbol && selected?.direction === c.direction;
              const iMs    = intervalToMs(c.interval);
              const remMs  = c.validUntilTime - nowMs;
              const remBars = remMs > 0 ? Math.ceil(remMs / iMs) : 0;
              return (
                <div key={c.symbol + c.direction}
                  style={{ ...S.listItem, ...(active ? S.listItemActive : {}) }}
                  onClick={() => handleSelect(c)}>
                  {/* Top row: symbol + score */}
                  <div style={S.listTop}>
                    <span style={S.listSymbol}>{c.symbol.replace('USDT', '')}</span>
                    <span style={{ fontSize: '0.75rem', color: op.color }}>{'★'.repeat(op.stars)}</span>
                  </div>
                  {/* Direction + type */}
                  <div style={S.listMeta}>
                    <span style={{
                      ...S.dirBadgeSm,
                      background: c.direction === 'long' ? 'rgba(14,203,129,0.15)' : 'rgba(246,70,93,0.15)',
                      color: c.direction === 'long' ? '#0ecb81' : '#f6465d',
                    }}>{c.direction === 'long' ? '▲ 롱' : '▼ 숏'}</span>
                    <span style={S.listType}>{c.breakoutType}</span>
                    <span style={{ ...S.listScore, color: scoreColor(c.score) }}>{c.score}</span>
                  </div>
                  {/* Status badge + remaining validity */}
                  <div style={S.listStatusRow}>
                    <span style={{
                      ...S.statusBadge,
                      background: `${STATUS_COLOR[c.status]}22`,
                      color: STATUS_COLOR[c.status],
                      borderColor: STATUS_COLOR[c.status],
                    }}>
                      {STATUS_LABEL[c.status]}
                    </span>
                    {c.status === 'PENDING' && remBars > 0 && (
                      <span style={{ color: '#5e6673', fontSize: '0.68rem' }}>{remBars}봉 남음</span>
                    )}
                    {c.status === 'TRIGGERED' && (
                      <span style={{ color: '#0ecb81', fontSize: '0.68rem' }}>발생!</span>
                    )}
                    {(c.status === 'INVALID' || c.status === 'EXPIRED') && (
                      <span style={{ color: '#5e6673', fontSize: '0.67rem' }}>
                        {c.invalidReason?.slice(0, 10) ?? c.expiredReason ?? ''}
                      </span>
                    )}
                  </div>
                  {/* asOf */}
                  <div style={S.listAsOf}>
                    기준: {fmtDateTime(c.asOfCloseTime)}
                  </div>
                  {/* Entry / TP / SL prices */}
                  <div style={S.listTpsl}>
                    <span style={{ color: '#848e9c', fontSize: '0.72rem' }}>진입 {pf(c.entryPrice)}</span>
                  </div>
                  <div style={S.listTpsl}>
                    <span style={{ color: '#0ecb81', fontSize: '0.72rem' }}>목표 {pf(c.tpPrice)}</span>
                    <span style={{ color: '#f6465d', fontSize: '0.72rem' }}>손절 {pf(c.slPrice)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chart panel */}
          <div style={S.chartWrap}>
            {snapshotMeta && snapshotCandles.length > 0 ? (
              /* ── Snapshot view (position opened from AltScanner) ── */
              <>
                <div style={S.chartHeader}>
                  <div style={S.chartHeaderLeft}>
                    <span style={S.chartTitle}>
                      {snapshotMeta.symbol} · {snapshotMeta.scanInterval} · 포지션 스냅샷
                    </span>
                    <span style={{ fontSize: '0.78rem', color: snapshotMeta.direction === 'long' ? '#0ecb81' : '#f6465d',
                      background: snapshotMeta.direction === 'long' ? 'rgba(14,203,129,0.12)' : 'rgba(246,70,93,0.12)',
                      border: `1px solid ${snapshotMeta.direction === 'long' ? 'rgba(14,203,129,0.4)' : 'rgba(246,70,93,0.4)'}`,
                      borderRadius: 4, padding: '1px 7px', fontWeight: 700 }}>
                      {snapshotMeta.direction === 'long' ? '▲ 롱' : '▼ 숏'}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#3b8beb', background: 'rgba(59,139,235,0.12)',
                      border: '1px solid rgba(59,139,235,0.35)', borderRadius: 4, padding: '1px 6px' }}>
                      ALT추천 진입
                    </span>
                  </div>
                  <div style={S.chartHeaderRight}>
                    <span style={{ color: '#5e6673', fontSize: '0.72rem' }}>
                      만료: {fmtDateTime(snapshotMeta.validUntilTime)}
                    </span>
                    <span style={{ fontSize: '0.72rem', fontFamily: 'monospace',
                      color: nowMs < snapshotMeta.validUntilTime ? '#0ecb81' : '#f6465d' }}>
                      {nowMs < snapshotMeta.validUntilTime
                        ? `남은시간: ${fmtCountdown(snapshotMeta.validUntilTime - nowMs)}`
                        : '만료됨'}
                    </span>
                    {onOpenInMain && (
                      <button style={S.openMainBtn}
                        onClick={() => { onOpenInMain(snapshotMeta.symbol); onClose(); }}>
                        메인 차트로 열기 →
                      </button>
                    )}
                  </div>
                </div>
                <div style={S.chartArea}>
                  <div style={S.chartCanvasWrap}>
                    <CandleChart
                      key={`snapshot-${snapshotMeta.candidateId}`}
                      candles={snapshotCandles}
                      interval={snapshotMeta.scanInterval as Interval}
                      ticker={snapshotMeta.symbol}
                      drawingMode="none"
                      setDrawingMode={() => {}}
                      onDrawingsChange={() => {}}
                      initialDrawings={snapshotMeta.drawingsSnapshot}
                    />
                  </div>
                </div>
              </>
            ) : snapshotMeta ? (
              <div style={S.chartPlaceholder}>차트 로딩 중…</div>
            ) : selected ? (
              <>
                <div style={S.chartHeader}>
                  <div style={S.chartHeaderLeft}>
                    <span style={S.chartTitle}>
                      {selected.symbol} · {scanInterval} ·&nbsp;
                      <span style={{ color: scoreColor(selected.score) }}>{selected.score}점</span>
                    </span>
                    {/* Status inline */}
                    <span style={{
                      ...S.statusBadge,
                      background: `${STATUS_COLOR[selected.status]}22`,
                      color: STATUS_COLOR[selected.status],
                      borderColor: STATUS_COLOR[selected.status],
                      fontSize: '0.76rem',
                    }}>
                      {STATUS_LABEL[selected.status]}
                    </span>
                    {selected.invalidReason && (
                      <span style={{ color: '#f6465d', fontSize: '0.72rem' }}>{selected.invalidReason}</span>
                    )}
                  </div>
                  <div style={S.chartHeaderRight}>
                    {/* Validity info */}
                    <div style={S.validityInfo}>
                      <span style={{ color: '#5e6673', fontSize: '0.72rem' }}>
                        기준: {fmtDateTime(selected.asOfCloseTime)}
                      </span>
                      <span style={{ color: '#5e6673', fontSize: '0.72rem' }}>
                        만료: {fmtDateTime(selected.validUntilTime)}
                      </span>
                      {selected.status === 'PENDING' && (
                        <span style={{ color: '#848e9c', fontSize: '0.72rem' }}>
                          유효: {Math.ceil(Math.max(0, selected.validUntilTime - nowMs) / intervalToMs(selected.interval))}봉
                        </span>
                      )}
                    </div>
                    <span style={{ color: '#5e6673', fontSize: '0.75rem' }}>
                      SR {selected.srLevels.length}개 · HVN {selected.hvnZones.length}개
                    </span>
                    {onOpenInMain && (
                      <button style={S.openMainBtn}
                        onClick={() => { onOpenInMain(selected.symbol); onClose(); }}>
                        메인 차트로 열기 →
                      </button>
                    )}
                  </div>
                </div>

                <LegendBar levelMode={levelMode} showHVN={showHVN} hasTP1={hasTP1} />

                {/* Chart timeframe selector (independent of scan interval) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderBottom: '1px solid #2a2e39', background: '#181c27' }}>
                  <span style={{ fontSize: '0.7rem', color: '#5e6673', marginRight: 4 }}>차트 봉:</span>
                  {(['5m','15m','30m','1h','4h','1d'] as Interval[]).map(iv => (
                    <button key={iv}
                      style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 4, border: '1px solid',
                        borderColor: chartViewInterval === iv ? '#3b8beb' : '#2a2e39',
                        background: chartViewInterval === iv ? 'rgba(59,139,235,0.18)' : 'rgba(255,255,255,0.04)',
                        color: chartViewInterval === iv ? '#3b8beb' : '#848e9c',
                        cursor: 'pointer', fontWeight: chartViewInterval === iv ? 700 : 400,
                      }}
                      onClick={() => setChartViewInterval(iv)}
                    >{iv}</button>
                  ))}
                  {chartViewInterval !== (selected.interval as Interval) && (
                    <span style={{ fontSize: '0.68rem', color: '#5e6673', marginLeft: 4 }}>
                      (스캔: {selected.interval} · 도형은 스캔 봉 기준)
                    </span>
                  )}
                </div>

                <div style={S.chartArea}>
                  <div style={S.chartCanvasWrap}>
                    <CandleChart
                      key={selected.symbol + selected.direction + chartViewInterval}
                      candles={chartViewInterval === (selected.interval as Interval) ? chartCandles : chartViewCandles}
                      interval={chartViewInterval}
                      ticker={selected.symbol}
                      drawingMode="none"
                      setDrawingMode={() => {}}
                      onDrawingsChange={() => {}}
                      initialDrawings={chartViewInterval === (selected.interval as Interval) ? activeDrawings : []}
                    />
                  </div>
                </div>

                <TradingInfoPanel c={selected} onPaperTrade={onPaperTrade} onLiveTrade={onLiveTrade}
                  paperLeverage={paperLeverage} setPaperLeverage={setPaperLeverage}
                  paperMarginType={paperMarginType} setPaperMarginType={setPaperMarginType}
                  paperRiskPct={paperRiskPct} setPaperRiskPct={setPaperRiskPct}
                  paperSizeMode={paperSizeMode} setPaperSizeMode={setPaperSizeMode}
                  paperMarginUsdt={paperMarginUsdt} setPaperMarginUsdt={setPaperMarginUsdt}
                  liveLeverage={liveLeverage} setLiveLeverage={setLiveLeverage}
                  liveMarginType={liveMarginType} setLiveMarginType={setLiveMarginType}
                  liveRiskPct={liveRiskPct} setLiveRiskPct={setLiveRiskPct}
                  liveSizeMode={liveSizeMode} setLiveSizeMode={setLiveSizeMode}
                  liveMarginUsdt={liveMarginUsdt} setLiveMarginUsdt={setLiveMarginUsdt}
                  paperBalance={paperBalance} />
              </>
            ) : (
              <div style={S.chartPlaceholder}>
                {candidates.length > 0 ? '← 종목을 선택하세요' : '스캔 후 종목을 선택하면 차트가 표시됩니다'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.70)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 8, display: 'flex', flexDirection: 'column', width: 'min(1440px, 97vw)', height: 'min(960px, 97vh)', overflow: 'hidden' },
  // Header
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #2a2e39', flexShrink: 0 },
  title: { color: '#d1d4dc', fontWeight: 600, fontSize: '0.95rem' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 6 },
  toggleLabel: { color: '#5e6673', fontSize: '0.77rem', whiteSpace: 'nowrap' as const },
  toggleBtn: { background: 'none', border: '1px solid #2a2e39', borderRadius: 4, color: '#848e9c', cursor: 'pointer', fontSize: '0.78rem', padding: '2px 8px', fontFamily: 'inherit' },
  toggleActive: { borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.1)' },
  hvnActive: { borderColor: '#3b8beb', color: '#3b8beb', background: 'rgba(59,139,235,0.1)' },
  autoScanActive: { borderColor: '#0ecb81', color: '#0ecb81', background: 'rgba(14,203,129,0.1)' },
  sep: { width: 1, height: 18, background: '#2a2e39', margin: '0 2px' },
  closeBtn: { background: 'none', border: 'none', color: '#848e9c', cursor: 'pointer', fontSize: '1rem', padding: '2px 6px' },
  // Auto-scan bar
  autoBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 16px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid #2a2e39', flexShrink: 0, gap: 10, flexWrap: 'wrap' as const },
  autoBarLeft: { display: 'flex', alignItems: 'center', gap: 14 },
  autoBarRight: { display: 'flex', alignItems: 'center', gap: 6 },
  autoBarInfo: { color: '#5e6673', fontSize: '0.76rem' },
  autoBarCountdown: { color: '#848e9c', fontSize: '0.76rem' },
  autoBarNote: { color: '#5e6673', fontSize: '0.72rem', fontStyle: 'italic' },
  // Controls
  controls: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', borderBottom: '1px solid #2a2e39', flexShrink: 0, flexWrap: 'wrap' as const },
  ctrlGroup: { display: 'flex', alignItems: 'center', gap: 4 },
  ctrlLabel: { color: '#5e6673', fontSize: '0.78rem', marginRight: 4, whiteSpace: 'nowrap' as const },
  ctrlBtn: { background: 'none', border: '1px solid #2a2e39', borderRadius: 4, color: '#848e9c', cursor: 'pointer', fontSize: '0.82rem', padding: '3px 9px', fontFamily: 'inherit', whiteSpace: 'nowrap' as const },
  ctrlActive: { borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.1)' },
  scanBtn: { marginLeft: 'auto', background: '#3b8beb', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, padding: '5px 18px', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  scanStop: { background: '#f6465d' },
  progressWrap: { position: 'relative', height: 24, background: '#131722', borderBottom: '1px solid #2a2e39', flexShrink: 0, display: 'flex', alignItems: 'center' },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, background: 'rgba(59,139,235,0.25)', transition: 'width 0.2s' },
  progressText: { position: 'relative', zIndex: 1, color: '#848e9c', fontSize: '0.75rem', paddingLeft: 10 },
  body: { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 },
  // List
  list: { width: 230, flexShrink: 0, overflowY: 'auto' as const, borderRight: '1px solid #2a2e39' },
  emptyMsg: { color: '#5e6673', fontSize: '0.82rem', padding: '20px 12px', textAlign: 'center' as const },
  listItem: { padding: '9px 11px', borderBottom: '1px solid #2a2e39', cursor: 'pointer', transition: 'background 0.1s' },
  listItemActive: { background: 'rgba(59,139,235,0.12)' },
  listTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  listSymbol: { color: '#d1d4dc', fontWeight: 600, fontSize: '0.88rem' },
  listScore: { fontSize: '0.75rem', fontWeight: 700 },
  listMeta: { display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 },
  dirBadgeSm: { fontSize: '0.72rem', fontWeight: 600, padding: '1px 5px', borderRadius: 3 },
  listType: { color: '#5e6673', fontSize: '0.72rem' },
  listStatusRow: { display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 },
  listAsOf: { color: '#3e4452', fontSize: '0.67rem', marginBottom: 2 },
  listTpsl: { display: 'flex', justifyContent: 'space-between', marginTop: 2 },
  // Status badge
  statusBadge: { fontSize: '0.70rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, border: '1px solid', flexShrink: 0 },
  validityBadge: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' as const },
  // Chart panel
  chartWrap: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 420 },
  chartHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #2a2e39', flexShrink: 0, gap: 8 },
  chartHeaderLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  chartTitle: { color: '#d1d4dc', fontWeight: 600, fontSize: '0.88rem' },
  chartHeaderRight: { display: 'flex', alignItems: 'center', gap: 10 },
  validityInfo: { display: 'flex', gap: 8, alignItems: 'center' },
  openMainBtn: { background: 'none', border: '1px solid #3b8beb', borderRadius: 4, color: '#3b8beb', cursor: 'pointer', fontSize: '0.8rem', padding: '3px 10px' },
  // Legend
  legendBar: { display: 'flex', alignItems: 'center', gap: 14, padding: '5px 14px', background: 'rgba(0,0,0,0.20)', borderBottom: '1px solid #2a2e39', flexShrink: 0, flexWrap: 'wrap' as const },
  legendItem: { display: 'flex', alignItems: 'center', gap: 4 },
  legendNum: { fontSize: '0.80rem', fontWeight: 700, minWidth: 14, textAlign: 'center' as const },
  legendLabel: { color: '#7a8292', fontSize: '0.72rem', whiteSpace: 'nowrap' as const },
  chartArea: { flex: 1, position: 'relative', minHeight: 300, overflow: 'hidden' },
  chartCanvasWrap: { position: 'absolute', inset: 0, opacity: 0.80, display: 'flex', flexDirection: 'column' },
  chartPlaceholder: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5e6673', fontSize: '0.88rem' },
  // Info panel
  infoPanel: { flexShrink: 0, background: 'linear-gradient(180deg, #161a24 0%, #1a1e2a 100%)', borderTop: '1px solid #2a2e39', padding: '9px 14px 8px', display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 280, overflowY: 'auto' as const },
  metricRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  dirBadge: { fontSize: '0.82rem', fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: '1px solid', flexShrink: 0 },
  mbadge: { display: 'flex', alignItems: 'center', gap: 4 },
  mbadgeNum: { fontSize: '0.88rem', fontWeight: 800, lineHeight: 1 },
  mbadgeInner: { display: 'flex', flexDirection: 'column', gap: 1 },
  mbadgeLabel: { color: '#5e6673', fontSize: '0.66rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  mbadgeValue: { fontSize: '0.86rem', fontWeight: 700, fontFamily: '"SF Mono", Consolas, monospace' },
  mbadgeSub: { fontSize: '0.69rem', fontFamily: '"SF Mono", Consolas, monospace', opacity: 0.85 },
  msep: { width: 1, height: 30, background: '#2a2e39' },
  rrBox: { background: 'rgba(240,185,11,0.08)', border: '1px solid rgba(240,185,11,0.3)', borderRadius: 6, padding: '3px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  rrLabel: { color: '#5e6673', fontSize: '0.66rem', textTransform: 'uppercase' as const },
  rrValue: { color: '#f0b90b', fontSize: '0.95rem', fontWeight: 800, fontFamily: '"SF Mono", Consolas, monospace' },
  paperTradeBtn: { background: 'rgba(240,185,11,0.12)', border: '1px solid rgba(240,185,11,0.5)', borderRadius: 5, color: '#f0b90b', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600, padding: '5px 14px', fontFamily: 'inherit', whiteSpace: 'nowrap' as const, flexShrink: 0, lineHeight: 1.4, height: 32 },
  liveTradeBtn: { background: 'rgba(14,203,129,0.12)', border: '1px solid rgba(14,203,129,0.5)', borderRadius: 5, color: '#0ecb81', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600, padding: '5px 14px', fontFamily: 'inherit', whiteSpace: 'nowrap' as const, flexShrink: 0, lineHeight: 1.4, height: 32 },
  blockRow: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 7 },
  infoBlock: { background: 'rgba(255,255,255,0.025)', border: '1px solid #2a2e39', borderRadius: 6, padding: '6px 10px' },
  infoBlockTitle: { color: '#848e9c', fontSize: '0.74rem', fontWeight: 600, marginBottom: 4 },
  infoBlockBody: { color: '#b2b8c4', fontSize: '0.77rem', lineHeight: 1.55 },
  footerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  tipText: { color: '#5e6673', fontSize: '0.76rem' },
  glossaryBtn: { background: 'none', border: '1px solid #2a2e39', borderRadius: 4, color: '#5e6673', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 8px', fontFamily: 'inherit', whiteSpace: 'nowrap' as const },
  glossaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, padding: '6px 0 2px' },
  glossaryItem: { background: 'rgba(255,255,255,0.02)', border: '1px solid #252930', borderRadius: 4, padding: '5px 8px' },
  glossaryTerm: { display: 'block', color: '#f0b90b', fontSize: '0.73rem', fontWeight: 600, marginBottom: 2 },
  glossaryDef: { display: 'block', color: '#848e9c', fontSize: '0.71rem', lineHeight: 1.45 },
};
