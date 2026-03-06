import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Candle, Interval } from '../../types/candle';
import type { Drawing } from '../../types/drawing';
import { CandleChart } from '../Chart/CandleChart';
import { runBreakoutScan } from './breakoutScanner';
import type { ScanCandidate, ScanInterval, ScanDirection } from './breakoutScanner';
import { useBinanceWS } from '../../hooks/useBinanceWS';

export interface AltTradeParams {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  tp1Price?: number;
  leverage: number;
}

interface Props {
  symbols: string[];
  initialCandidates: ScanCandidate[];
  onCandidatesChange: (candidates: ScanCandidate[]) => void;
  onClose: () => void;
  onOpenInMain?: (symbol: string) => void;
  onPaperTrade?: (params: AltTradeParams) => void;
  onLiveTrade?: (params: AltTradeParams) => void;
}

type LevelMode = 'core' | 'all';

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
];

function scoreColor(s: number) { return s >= 75 ? '#0ecb81' : s >= 50 ? '#f0b90b' : '#848e9c'; }
function pf(p: number) { return p >= 1 ? p.toFixed(2) : p.toFixed(6); }
function pctStr(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }

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

  const stars = pts >= 80 ? 5 : pts >= 65 ? 4 : pts >= 50 ? 3 : pts >= 35 ? 2 : 1;
  const dirKo = c.direction === 'long' ? '▲ 롱' : '▼ 숏';
  const color = pts >= 65 ? '#0ecb81' : pts >= 45 ? '#f0b90b' : '#f6465d';

  let text: string;
  if (pts >= 65)      text = `${dirKo} 강추 — ${notes.slice(0, 2).join(' · ')}`;
  else if (pts >= 45) text = `${dirKo} 검토 — ${notes.slice(0, 2).join(' · ')}`;
  else                text = `${dirKo} 신중 — 추가 확인 필요`;

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
      { num: '─',  color: 'rgba(14,203,129,0.22)', dash: true, label: '지지 레벨' },
      { num: '─',  color: 'rgba(246,70,93,0.22)',  dash: true, label: '저항 레벨' },
    );
  }
  if (showHVN) {
    items.push({ num: '⑧', color: 'rgba(240,185,11,0.60)', dash: false, label: 'HVN 매물대' });
  }
  return items;
}

function LegendBar({ levelMode, showHVN, hasTP1 }: { levelMode: LevelMode; showHVN: boolean; hasTP1: boolean }) {
  const items = getLegendItems(levelMode, showHVN, hasTP1);
  return (
    <div style={S.legendBar}>
      {items.map(({ num, color, dash, label }) => (
        <div key={label} style={S.legendItem}>
          <span style={{ ...S.legendNum, color }}>{num}</span>
          <div style={{
            width: 20, height: 0,
            borderTop: `2px ${dash ? 'dashed' : 'solid'} ${color}`,
            flexShrink: 0,
          }} />
          <span style={S.legendLabel}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Info panel ─────────────────────────────────────────────────────────────
function TradingInfoPanel({
  c, onPaperTrade, onLiveTrade,
}: {
  c: ScanCandidate;
  onPaperTrade?: (p: AltTradeParams) => void;
  onLiveTrade?: (p: AltTradeParams) => void;
}) {
  const [showGlossary, setShowGlossary] = useState(false);
  const isLong = c.direction === 'long';
  const slPct  = (c.slPrice  - c.entryPrice) / c.entryPrice * 100;
  const tpPct  = (c.tpPrice  - c.entryPrice) / c.entryPrice * 100;
  const tp1Pct = c.tp1Price != null ? (c.tp1Price - c.entryPrice) / c.entryPrice * 100 : undefined;
  const R  = Math.abs(c.entryPrice - c.slPrice);
  const rr = R > 0 ? Math.abs(c.tpPrice - c.entryPrice) / R : 0;
  const breakEvenPct = Math.round(100 / (1 + rr));
  const nTrials      = Math.round(1 + rr);
  const volFactor    = (c.atr / c.entryPrice) > 0.015 ? 1.5 : 1.3;
  const supZone = c.topLevels.find(z => z.kind === 'support');
  const resZone = c.topLevels.find(z => z.kind === 'resistance');
  const slBasisText = isLong
    ? (supZone ? `${supZone.horizon} 지지 존 하단 기준` : 'ATR 기반 구조적 손절')
    : (resZone ? `${resZone.horizon} 저항 존 상단 기준` : 'ATR 기반 구조적 손절');
  const breakoutKo = c.breakoutType === 'trendline' ? '추세선 돌파'
    : c.breakoutType === 'hline' ? '수평 레벨 돌파' : '박스권 돌파';
  const opinion  = buildOpinion(c);
  const topLevel = c.topLevels[0];

  const tradeParams: AltTradeParams = {
    symbol: c.symbol, direction: c.direction,
    entryPrice: c.entryPrice, slPrice: c.slPrice,
    tpPrice: c.tpPrice, tp1Price: c.tp1Price,
    leverage: 10,
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

        <div style={{ flex: 1 }} />

        <div style={S.rrBox}>
          <span style={S.rrLabel}>위험/수익비</span>
          <span style={S.rrValue}>RR 1:{rr.toFixed(1)}</span>
        </div>

        {onPaperTrade && (
          <button style={S.paperTradeBtn} onClick={() => onPaperTrade(tradeParams)}
            title="잔고 2% 리스크 기준 모의 포지션 자동 개설">
            📄 모의진입
          </button>
        )}
        {onLiveTrade && (
          <button style={S.liveTradeBtn} onClick={() => onLiveTrade(tradeParams)}
            title="실전 모드 — 아래 설정을 참고하여 직접 주문하세요">
            ⚡ 실전진입
          </button>
        )}
      </div>

      {/* Row 2: 4 explanation blocks */}
      <div style={S.blockRow}>
        <InfoBlock icon="📌" title="진입 조건">
          <div>종가 기준 <b>{breakoutKo}</b> 확인 후 진입</div>
          <div>거래량 ≥ 20일 평균의 <b>{volFactor}배</b> 이상</div>
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
        <button style={S.glossaryBtn} onClick={() => setShowGlossary(v => !v)}>
          📖 용어 사전 {showGlossary ? '▲' : '▼'}
        </button>
      </div>

      {/* Glossary (collapsible) */}
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
    </div>
  );
}

function MBadge({ num, label, value, sub, color }: { num: string; label: string; value: string; sub?: string; color: string }) {
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
  onPaperTrade, onLiveTrade,
}: Props) {
  const [scanInterval, setScanInterval] = useState<ScanInterval>('1h');
  const [direction, setDirection] = useState<ScanDirection>('both');
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [candidates, setCandidates] = useState<ScanCandidate[]>(initialCandidates);
  const [selected, setSelected] = useState<ScanCandidate | null>(
    initialCandidates.length > 0 ? initialCandidates[0] : null,
  );
  const [chartCandles, setChartCandles] = useState<Candle[]>(
    initialCandidates.length > 0 ? initialCandidates[0].candles : [],
  );
  const [levelMode, setLevelMode] = useState<LevelMode>('core');
  const [showHVN, setShowHVN] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { onCandidatesChange(candidates); }, [candidates, onCandidatesChange]);

  useBinanceWS(selected?.symbol ?? '', scanInterval as Interval, useCallback((candle: Candle) => {
    setChartCandles(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.time === candle.time) return [...prev.slice(0, -1), candle];
      return [...prev, candle];
    });
  }, []));

  const handleSelect = useCallback((c: ScanCandidate) => {
    setSelected(c); setChartCandles(c.candles);
  }, []);

  const handleScan = useCallback(async () => {
    if (scanning) { abortRef.current?.abort(); return; }
    abortRef.current = new AbortController();
    setScanning(true); setCandidates([]); setSelected(null);
    setProgress({ done: 0, total: symbols.length });
    try {
      await runBreakoutScan(symbols, scanInterval, direction,
        (done, total) => setProgress({ done, total }),
        (c) => setCandidates(prev => [...prev, c].sort((a, b) => b.score - a.score)),
        abortRef.current.signal);
    } finally { setScanning(false); }
  }, [scanning, symbols, scanInterval, direction]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    if (!scanning && candidates.length > 0 && !selected) handleSelect(candidates[0]);
  }, [scanning, candidates, selected, handleSelect]);

  const activeDrawings = useMemo((): Drawing[] => {
    if (!selected) return [];
    const { drawingGroups: g } = selected;
    if (levelMode === 'core') return [...g.breakout, ...g.topSR, ...g.entryLines];
    return [...g.breakout, ...g.dimSR, ...g.topSR, ...(showHVN ? g.hvn : []), ...g.entryLines];
  }, [selected, levelMode, showHVN]);

  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const hasTP1 = selected?.tp1Price != null;

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        {/* Header */}
        <div style={S.header}>
          <span style={S.title}>🔍 알트추천 (돌파 스캐너)</span>
          <div style={S.headerRight}>
            <span style={S.toggleLabel}>레벨 표시</span>
            <button style={{ ...S.toggleBtn, ...(levelMode === 'core' ? S.toggleActive : {}) }} onClick={() => setLevelMode('core')}>핵심만</button>
            <button style={{ ...S.toggleBtn, ...(levelMode === 'all' ? S.toggleActive : {}) }} onClick={() => setLevelMode('all')}>전체</button>
            <div style={S.sep} />
            <span style={S.toggleLabel}>매물대 ⑧</span>
            <button style={{ ...S.toggleBtn, ...(showHVN ? S.hvnActive : {}) }} onClick={() => setShowHVN(v => !v)}>
              {showHVN ? 'ON' : 'OFF'}
            </button>
            <div style={S.sep} />
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Controls */}
        <div style={S.controls}>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>방향</span>
            {DIR_OPTS.map(o => (
              <button key={o.value} style={{ ...S.ctrlBtn, ...(direction === o.value ? S.ctrlActive : {}) }}
                onClick={() => setDirection(o.value)}>{o.label}</button>
            ))}
          </div>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>타임프레임</span>
            {INTV_OPTS.map(o => (
              <button key={o.value} style={{ ...S.ctrlBtn, ...(scanInterval === o.value ? S.ctrlActive : {}) }}
                onClick={() => setScanInterval(o.value)}>{o.label}</button>
            ))}
          </div>
          <button style={{ ...S.scanBtn, ...(scanning ? S.scanStop : {}) }} onClick={handleScan}>
            {scanning ? '⏹ 중지' : '▶ 스캔 시작'}
          </button>
        </div>

        {/* Progress */}
        {(scanning || progress.done > 0) && (
          <div style={S.progressWrap}>
            <div style={{ ...S.progressBar, width: `${progressPct}%` }} />
            <span style={S.progressText}>{progress.done}/{progress.total} ({progressPct}%) — 발굴: {candidates.length}개</span>
          </div>
        )}

        {/* Body */}
        <div style={S.body}>
          {/* List */}
          <div style={S.list}>
            {candidates.length === 0 && !scanning && (
              <div style={S.emptyMsg}>{progress.done > 0 ? '발굴된 종목 없음' : '스캔을 시작하세요'}</div>
            )}
            {candidates.map(c => {
              const op = buildOpinion(c);
              const active = selected?.symbol === c.symbol && selected?.direction === c.direction;
              return (
                <div key={c.symbol + c.direction}
                  style={{ ...S.listItem, ...(active ? S.listItemActive : {}) }}
                  onClick={() => handleSelect(c)}>
                  <div style={S.listTop}>
                    <span style={S.listSymbol}>{c.symbol.replace('USDT', '')}</span>
                    <span style={{ fontSize: '0.75rem', color: op.color }}>{'★'.repeat(op.stars)}</span>
                  </div>
                  <div style={S.listMeta}>
                    <span style={{
                      ...S.dirBadgeSm,
                      background: c.direction === 'long' ? 'rgba(14,203,129,0.15)' : 'rgba(246,70,93,0.15)',
                      color: c.direction === 'long' ? '#0ecb81' : '#f6465d',
                    }}>{c.direction === 'long' ? '▲ 롱' : '▼ 숏'}</span>
                    <span style={S.listType}>{c.breakoutType}</span>
                    <span style={{ ...S.listScore, color: scoreColor(c.score) }}>{c.score}</span>
                  </div>
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
            {selected ? (
              <>
                <div style={S.chartHeader}>
                  <span style={S.chartTitle}>
                    {selected.symbol} · {scanInterval} ·&nbsp;
                    <span style={{ color: scoreColor(selected.score) }}>{selected.score}점</span>
                  </span>
                  <div style={S.chartHeaderRight}>
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

                <div style={S.chartArea}>
                  <div style={S.chartCanvasWrap}>
                    <CandleChart
                      key={selected.symbol + selected.direction + scanInterval}
                      candles={chartCandles}
                      interval={scanInterval as Interval}
                      ticker={selected.symbol}
                      drawingMode="none"
                      setDrawingMode={() => {}}
                      onDrawingsChange={() => {}}
                      initialDrawings={activeDrawings}
                    />
                  </div>
                </div>

                <TradingInfoPanel c={selected} onPaperTrade={onPaperTrade} onLiveTrade={onLiveTrade} />
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
  modal: { background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 8, display: 'flex', flexDirection: 'column', width: 'min(1440px, 97vw)', height: 'min(900px, 95vh)', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #2a2e39', flexShrink: 0 },
  title: { color: '#d1d4dc', fontWeight: 600, fontSize: '0.95rem' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 6 },
  toggleLabel: { color: '#5e6673', fontSize: '0.77rem', whiteSpace: 'nowrap' as const },
  toggleBtn: { background: 'none', border: '1px solid #2a2e39', borderRadius: 4, color: '#848e9c', cursor: 'pointer', fontSize: '0.78rem', padding: '2px 8px', fontFamily: 'inherit' },
  toggleActive: { borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.1)' },
  hvnActive: { borderColor: '#3b8beb', color: '#3b8beb', background: 'rgba(59,139,235,0.1)' },
  sep: { width: 1, height: 18, background: '#2a2e39', margin: '0 2px' },
  closeBtn: { background: 'none', border: 'none', color: '#848e9c', cursor: 'pointer', fontSize: '1rem', padding: '2px 6px' },
  controls: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid #2a2e39', flexShrink: 0, flexWrap: 'wrap' as const },
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
  list: { width: 220, flexShrink: 0, overflowY: 'auto' as const, borderRight: '1px solid #2a2e39' },
  emptyMsg: { color: '#5e6673', fontSize: '0.82rem', padding: '20px 12px', textAlign: 'center' as const },
  listItem: { padding: '10px 12px', borderBottom: '1px solid #2a2e39', cursor: 'pointer', transition: 'background 0.1s' },
  listItemActive: { background: 'rgba(59,139,235,0.12)' },
  listTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  listSymbol: { color: '#d1d4dc', fontWeight: 600, fontSize: '0.88rem' },
  listScore: { fontSize: '0.75rem', fontWeight: 700 },
  listMeta: { display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 },
  dirBadgeSm: { fontSize: '0.72rem', fontWeight: 600, padding: '1px 5px', borderRadius: 3 },
  listType: { color: '#5e6673', fontSize: '0.72rem' },
  listTpsl: { display: 'flex', justifyContent: 'space-between', marginTop: 2 },
  // Chart panel
  chartWrap: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  chartHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #2a2e39', flexShrink: 0 },
  chartTitle: { color: '#d1d4dc', fontWeight: 600, fontSize: '0.88rem' },
  chartHeaderRight: { display: 'flex', alignItems: 'center', gap: 10 },
  openMainBtn: { background: 'none', border: '1px solid #3b8beb', borderRadius: 4, color: '#3b8beb', cursor: 'pointer', fontSize: '0.8rem', padding: '3px 10px' },
  // Legend
  legendBar: { display: 'flex', alignItems: 'center', gap: 14, padding: '5px 14px', background: 'rgba(0,0,0,0.20)', borderBottom: '1px solid #2a2e39', flexShrink: 0, flexWrap: 'wrap' as const },
  legendItem: { display: 'flex', alignItems: 'center', gap: 4 },
  legendNum: { fontSize: '0.80rem', fontWeight: 700, minWidth: 14, textAlign: 'center' as const },
  legendLabel: { color: '#7a8292', fontSize: '0.72rem', whiteSpace: 'nowrap' as const },
  // Chart area — opacity only (no saturation change)
  chartArea: { flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' },
  chartCanvasWrap: { position: 'absolute', inset: 0, opacity: 0.80 },
  chartPlaceholder: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5e6673', fontSize: '0.88rem' },
  // Info panel
  infoPanel: { flexShrink: 0, background: 'linear-gradient(180deg, #161a24 0%, #1a1e2a 100%)', borderTop: '1px solid #2a2e39', padding: '9px 14px 8px', display: 'flex', flexDirection: 'column', gap: 7 },
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
  // Trade buttons
  paperTradeBtn: { background: 'rgba(240,185,11,0.12)', border: '1px solid rgba(240,185,11,0.5)', borderRadius: 5, color: '#f0b90b', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600, padding: '5px 14px', fontFamily: 'inherit', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  liveTradeBtn: { background: 'rgba(14,203,129,0.12)', border: '1px solid rgba(14,203,129,0.5)', borderRadius: 5, color: '#0ecb81', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600, padding: '5px 14px', fontFamily: 'inherit', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  // Explanation blocks
  blockRow: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 7 },
  infoBlock: { background: 'rgba(255,255,255,0.025)', border: '1px solid #2a2e39', borderRadius: 6, padding: '6px 10px' },
  infoBlockTitle: { color: '#848e9c', fontSize: '0.74rem', fontWeight: 600, marginBottom: 4 },
  infoBlockBody: { color: '#b2b8c4', fontSize: '0.77rem', lineHeight: 1.55 },
  // Footer row
  footerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  tipText: { color: '#5e6673', fontSize: '0.76rem' },
  glossaryBtn: { background: 'none', border: '1px solid #2a2e39', borderRadius: 4, color: '#5e6673', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 8px', fontFamily: 'inherit', whiteSpace: 'nowrap' as const },
  // Glossary grid
  glossaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, padding: '6px 0 2px' },
  glossaryItem: { background: 'rgba(255,255,255,0.02)', border: '1px solid #252930', borderRadius: 4, padding: '5px 8px' },
  glossaryTerm: { display: 'block', color: '#f0b90b', fontSize: '0.73rem', fontWeight: 600, marginBottom: 2 },
  glossaryDef: { display: 'block', color: '#848e9c', fontSize: '0.71rem', lineHeight: 1.45 },
};
