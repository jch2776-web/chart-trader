import React, { useState } from 'react';

// ── Chase-entry prevention mini diagrams ──────────────────────────────────────
function SignalAgeDiagram({ value }: { value: number }) {
  const disabled = value === 0;
  const W = 200; const H = 34;
  const maxSec = 300;
  const threshX = disabled ? 0 : Math.round(Math.min(1, value / maxSec) * (W - 4));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', margin: '5px 0' }}>
      <rect x={0} y={13} width={W} height={8} rx={4} fill="rgba(255,255,255,0.05)" />
      {disabled ? (
        <>
          <rect x={0} y={13} width={W} height={8} rx={4} fill="rgba(255,255,255,0.06)" />
          <text x={W / 2} y={30} fontSize={9} fill="#3a4558" textAnchor="middle" fontFamily="monospace">비활성화 (0 = 제한 없음)</text>
        </>
      ) : (
        <>
          <rect x={0} y={13} width={threshX} height={8} rx={4} fill="rgba(14,203,129,0.45)" />
          <rect x={threshX} y={13} width={W - threshX} height={8} rx={4} fill="rgba(246,70,93,0.25)" />
          <rect x={threshX - 1} y={9} width={2} height={16} rx={1} fill="#0ecb81" />
          <text x={2} y={11} fontSize={8} fill="#3a4558" fontFamily="monospace">0s</text>
          <text x={Math.max(12, Math.min(threshX, W - 42))} y={11} fontSize={9} fill="#0ecb81" textAnchor="middle" fontFamily="monospace">{value}s</text>
          {threshX > 28 && <text x={threshX / 2} y={30} fontSize={8} fill="#0ecb81" textAnchor="middle">✓ 허용</text>}
          {W - threshX > 32 && <text x={threshX + (W - threshX) / 2} y={30} fontSize={8} fill="#f6465d" textAnchor="middle">✗ 초과 차단</text>}
        </>
      )}
    </svg>
  );
}

function BreakoutExtDiagram({ value }: { value: number }) {
  const disabled = value === 0;
  const W = 200; const H = 58;
  const trigY = H - 10;
  const maxPct = 2.0;
  const threshY = disabled ? 4 : Math.round(trigY - (Math.min(value, maxPct) / maxPct) * (trigY - 14));
  const barW = 116;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', margin: '5px 0' }}>
      {!disabled ? (
        <>
          <rect x={4} y={4} width={barW} height={threshY - 4} rx={2} fill="rgba(246,70,93,0.18)" />
          <rect x={4} y={threshY} width={barW} height={trigY - threshY} rx={2} fill="rgba(14,203,129,0.2)" />
        </>
      ) : (
        <rect x={4} y={4} width={barW} height={trigY - 4} rx={2} fill="rgba(255,255,255,0.04)" />
      )}
      <line x1={0} y1={trigY} x2={barW + 4} y2={trigY} stroke="#4a5a70" strokeWidth={1.5} />
      {!disabled && <line x1={0} y1={threshY} x2={barW + 4} y2={threshY} stroke="#f0b90b" strokeWidth={1} strokeDasharray="3,2" />}
      {!disabled && (
        <>
          <polygon points={`${barW * 0.55},${threshY - 13} ${barW * 0.55 - 5},${threshY - 3} ${barW * 0.55 + 5},${threshY - 3}`} fill="rgba(240,185,11,0.7)" />
          <text x={barW * 0.55} y={threshY - 15} fontSize={8} fill="#f0b90b" textAnchor="middle">봉종가</text>
        </>
      )}
      <text x={barW + 8} y={trigY + 4} fontSize={9} fill="#4a5a70">돌파선</text>
      {!disabled && <text x={barW + 8} y={threshY + 4} fontSize={9} fill="#f0b90b">+{value}%</text>}
      {!disabled && <text x={barW + 8} y={14} fontSize={9} fill="#f6465d">✗ 차단</text>}
      {!disabled && threshY + 8 < trigY && <text x={barW + 8} y={threshY + (trigY - threshY) / 2 + 4} fontSize={9} fill="#0ecb81">✓ 허용</text>}
      {disabled && <text x={barW + 8} y={trigY / 2 + 4} fontSize={9} fill="#3a4558">비활성화</text>}
    </svg>
  );
}

function EntryDriftDiagram({ value }: { value: number }) {
  const disabled = value === 0;
  const W = 200; const H = 34;
  const entryX = 70;
  const maxPct = 4.0;
  const allowedW = disabled ? 0 : Math.round((Math.min(value, maxPct) / maxPct) * (W - entryX - 4));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', margin: '5px 0' }}>
      <rect x={0} y={13} width={W} height={8} rx={4} fill="rgba(255,255,255,0.05)" />
      <rect x={0} y={13} width={entryX} height={8} rx={4} fill="rgba(14,203,129,0.3)" />
      {disabled ? (
        <>
          <rect x={entryX} y={13} width={W - entryX} height={8} fill="rgba(255,255,255,0.05)" />
          <text x={entryX + (W - entryX) / 2} y={30} fontSize={9} fill="#3a4558" textAnchor="middle">비활성화</text>
        </>
      ) : (
        <>
          <rect x={entryX} y={13} width={allowedW} height={8} fill="rgba(14,203,129,0.3)" />
          <rect x={entryX + allowedW} y={13} width={W - entryX - allowedW} height={8} rx={4} fill="rgba(246,70,93,0.25)" />
          <rect x={entryX + allowedW - 1} y={9} width={2} height={16} rx={1} fill="#f0b90b" />
          <text x={entryX + allowedW} y={11} fontSize={9} fill="#f0b90b" textAnchor="middle" fontFamily="monospace">+{value}%</text>
          {W - entryX - allowedW > 36 && <text x={entryX + allowedW + (W - entryX - allowedW) / 2} y={30} fontSize={8} fill="#f6465d" textAnchor="middle">✗ 추격 차단</text>}
        </>
      )}
      <rect x={entryX - 1} y={9} width={2} height={16} rx={1} fill="#d1d4dc" />
      <text x={entryX} y={11} fontSize={9} fill="#d1d4dc" textAnchor="middle" fontFamily="monospace">진입가</text>
      {entryX > 30 && <text x={entryX / 2} y={30} fontSize={8} fill="#0ecb81" textAnchor="middle">✓ 비추격</text>}
    </svg>
  );
}

export type ScanTF = '15m' | '1h' | '4h' | '1d';
export const ALL_SCAN_TFS: ScanTF[] = ['15m', '1h', '4h', '1d'];

export interface LabAutoPreset {
  id: string;
  name: string;
  strategyId: string;
  savedAt: number;
  settings: AutoTradeSettings;
}

export interface AutoTradeSettings {
  sizeMode: 'margin' | 'risk';
  marginUsdt: number;
  riskPct: number;
  leverage: number;
  marginType: 'ISOLATED' | 'CROSSED';
  scanIntervals: ScanTF[];
  autoEntryIntervals?: ScanTF[];  // subset of scanIntervals that allow auto-entry (default ['1h'])
  scanCadenceMinutes?: number;
  timeStopEnabled?: boolean;
  voiceAlertEnabled?: boolean;
  liveEntryOrderType?: 'MARKET' | 'LIMIT_IOC';
  tp1Enabled?: boolean;          // TP1 partial close (default false)
  tp1R?: number;                 // TP1 location as ratio of TP distance (default 0.30)
  tp1ClosePct?: number;          // % of position to close at TP1 (default 50)
  tp1MoveSL?: boolean;           // move SL to entry after TP1 (default true)
  maxAutoPositionsPerScan?: number; // max entries per scan cycle (default 1)
  // Chase-entry prevention filter (auto-entry only)
  maxSignalAgeSec?: number;          // max age of signal since asOfCloseTime (default 120s, 0 = disable)
  maxEntryDriftPct?: number;         // max allowed drift from plannedEntry before skipping (default 1.0%, 0 = disable)
  maxBreakoutExtensionPct?: number;  // max allowed extension of confirmed candle close beyond trigger line (default 0.6%, 0 = disable)
  // Candidate score threshold for auto-entry (default 90; lower = more candidates qualify)
  minCandidateScore?: number;
  // Strategy selection (default 'breakout' — preserves existing behavior)
  strategyId?: 'breakout' | 'leader-retest' | 'fvg-poc-ema72';
  // Leader-retest specific parameters (only used when strategyId === 'leader-retest')
  retestMinBars?: number;            // min bars since breakout (default 1)
  retestMaxBars?: number;            // max bars since breakout (default 8)
  retestToleranceAtr?: number;       // price must be within level ± toleranceAtr × ATR (default 0.30)
  retestMaxOvershootAtr?: number;    // max allowed overshoot beyond level in ATR multiples (default 1.0)
  retestAutoDirection?: 'long' | 'both'; // scan direction for unattended auto-trade (default 'long')
  retestRequire4hTrend?: boolean;    // require 4H EMA20 > EMA50 for LONG entry (default true)
  // Breakout-specific direction override (default 'both')
  breakoutDirection?: 'long' | 'short' | 'both';
  // Breakout live entry precision controls (only used when strategyId === 'breakout' AND mode === 'live')
  breakoutMarketNearPct?: number;      // drift from trigger line ≤ this → MARKET (default 0.20)
  breakoutLimitIocFarPct?: number;     // drift from trigger line ≤ this → LIMIT_IOC (default 0.50); > this → SKIP
  breakoutMaxBarsAfterTrigger?: number; // 0=same bar only, 1=next bar too, N=N bars later allowed (default 0)
  // FVG POC + EMA72 specific (only used when strategyId === 'fvg-poc-ema72')
  fvgPocLookbackBars?: number;
  fvgPocBins?: number;
  fvgEmaPeriod?: number;
  fvgUniverseTopN?: number;
  fvgAutoDirection?: 'long' | 'short' | 'both';
  // Risk gates (lab-compatible)
  maxAbsLossUsd?: number;            // leader-retest: block entry if abs-loss (riskFrac × notional) > this (0 = disable)
  timeStopBars?: number;             // N bars from entry → market close if TP/SL not hit (0 = use signal TTL, default 4)
  cooldownBarsAfterLoss?: number;    // skip N bars of same TF after a losing trade (0 = disabled, default 0)
  maxConcurrentCorrelated?: number;  // max same-direction open positions (0 = unlimited, default 0)
  maxTotalPositions?: number;        // max total open positions (0 = unlimited, default 0)
}

const CADENCE_PRESETS = [15, 30, 60, 120, 240] as const;
const DEFAULT_SCAN_CADENCE_MINUTES = 60;

function normalizeCadenceMinutes(v?: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SCAN_CADENCE_MINUTES;
  return Math.max(15, Math.round(v!));
}

function normalizeTimeStopEnabled(v?: boolean): boolean {
  return v !== false;
}

function normalizeVoiceAlertEnabled(v?: boolean): boolean {
  return v !== false;
}

function tfToMinutes(tf: ScanTF): number {
  if (tf === '15m') return 15;
  if (tf === '1h') return 60;
  if (tf === '4h') return 240;
  return 1440;
}

export const DEFAULT_AUTO_TRADE_SETTINGS: AutoTradeSettings = {
  sizeMode: 'margin',
  marginUsdt: 100,
  riskPct: 2,
  leverage: 3,
  marginType: 'ISOLATED',
  scanIntervals: ['1h', '4h', '1d'],
  autoEntryIntervals: ['1h'],
  scanCadenceMinutes: DEFAULT_SCAN_CADENCE_MINUTES,
  timeStopEnabled: true,
  voiceAlertEnabled: true,
  tp1Enabled: false,
  tp1R: 0.30,
  tp1ClosePct: 50,
  tp1MoveSL: true,
  maxAutoPositionsPerScan: 1,
  maxSignalAgeSec: 120,
  maxEntryDriftPct: 1.0,
  maxBreakoutExtensionPct: 0.6,
  timeStopBars: 4,
  cooldownBarsAfterLoss: 0,
  maxConcurrentCorrelated: 0,
  maxTotalPositions: 0,
};

export const DEFAULT_LIVE_AUTO_TRADE_SETTINGS: AutoTradeSettings = {
  sizeMode: 'margin',
  marginUsdt: 100,
  riskPct: 2,
  leverage: 3,
  marginType: 'ISOLATED',
  scanIntervals: ['1h', '4h', '1d'],
  autoEntryIntervals: ['1h'],
  scanCadenceMinutes: DEFAULT_SCAN_CADENCE_MINUTES,
  timeStopEnabled: true,
  voiceAlertEnabled: true,
  liveEntryOrderType: 'MARKET',
  tp1Enabled: false,
  tp1R: 0.30,
  tp1ClosePct: 50,
  tp1MoveSL: true,
  maxAutoPositionsPerScan: 1,
  maxSignalAgeSec: 120,
  maxEntryDriftPct: 1.0,
  maxBreakoutExtensionPct: 0.6,
  timeStopBars: 4,
  cooldownBarsAfterLoss: 0,
  maxConcurrentCorrelated: 0,
  maxTotalPositions: 0,
};

interface Props {
  paperSettings: AutoTradeSettings;
  liveSettings: AutoTradeSettings;
  onSave: (paper: AutoTradeSettings, live: AutoTradeSettings) => void;
  onClose: () => void;
  initialTab?: 'paper' | 'live';
  labAutoPresets?: LabAutoPreset[];
  onDeletePreset?: (id: string) => void;
}

// ── Single-mode settings editor ─────────────────────────────────────────────
function SettingsEditor({
  draft, set, isLive,
}: {
  draft: AutoTradeSettings;
  set: <K extends keyof AutoTradeSettings>(k: K, v: AutoTradeSettings[K]) => void;
  isLive: boolean;
}) {
  const cadence = normalizeCadenceMinutes(draft.scanCadenceMinutes);
  const timeStopEnabled = normalizeTimeStopEnabled(draft.timeStopEnabled);
  const voiceAlertEnabled = normalizeVoiceAlertEnabled(draft.voiceAlertEnabled);
  const minTfMinutes = Math.min(...draft.scanIntervals.map(tfToMinutes));
  const cadenceFasterThanMinTf = cadence < minTfMinutes;
  const isLeaderRetest = (draft.strategyId ?? 'breakout') === 'leader-retest';
  const isFvg = (draft.strategyId ?? 'breakout') === 'fvg-poc-ema72';
  return (
    <>
      {/* Leverage */}
      <div style={s.fieldRow}>
        <label style={s.label}>레버리지</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={1} max={125} step={1}
            value={draft.leverage}
            onChange={e => set('leverage', Math.max(1, Math.min(125, parseInt(e.target.value) || 1)))}
            style={s.numberInput}
          />
          <span style={s.unit}>×</span>
        </div>
      </div>

      {/* Margin type */}
      <div style={s.fieldRow}>
        <label style={s.label}>마진 유형</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['ISOLATED', 'CROSSED'] as const).map(m => (
            <button
              key={m}
              style={{ ...s.toggleChip, ...(draft.marginType === m ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
              onClick={() => set('marginType', m)}
            >
              {m === 'ISOLATED' ? '격리(Isolated)' : '교차(Cross)'}
            </button>
          ))}
        </div>
      </div>

      {/* Size mode */}
      <div style={s.fieldRow}>
        <label style={s.label}>사이즈 방식</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ ...s.toggleChip, ...(draft.sizeMode === 'margin' ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
            onClick={() => set('sizeMode', 'margin')}
          >
            고정 마진 (USDT)
          </button>
          <button
            style={{ ...s.toggleChip, ...(draft.sizeMode === 'risk' ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
            onClick={() => set('sizeMode', 'risk')}
          >
            잔고 비율 (%)
          </button>
        </div>
      </div>

      {/* Margin USDT */}
      {draft.sizeMode === 'margin' && (
        <div style={s.fieldRow}>
          <label style={s.label}>마진 크기</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={1} max={100000} step={1}
              value={draft.marginUsdt}
              onChange={e => set('marginUsdt', Math.max(1, parseFloat(e.target.value) || 1))}
              style={s.numberInput}
            />
            <span style={s.unit}>USDT</span>
          </div>
          <span style={s.hint}>
            진입 포지션 크기 = {draft.marginUsdt} × {draft.leverage} = {draft.marginUsdt * draft.leverage} USDT
          </span>
        </div>
      )}

      {/* Risk pct */}
      {draft.sizeMode === 'risk' && (
        <div style={s.fieldRow}>
          <label style={s.label}>리스크 비율</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={0.1} max={100} step={0.1}
              value={draft.riskPct}
              onChange={e => set('riskPct', Math.max(0.1, Math.min(100, parseFloat(e.target.value) || 0.1)))}
              style={s.numberInput}
            />
            <span style={s.unit}>%</span>
          </div>
          <span style={s.hint}>잔고의 {draft.riskPct}%를 마진으로 사용</span>
        </div>
      )}

      {/* Scan TF */}
      <div style={s.fieldRow}>
        <label style={s.label}>스캔 타임프레임</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ALL_SCAN_TFS.map(tf => {
            const active = draft.scanIntervals.includes(tf);
            return (
              <button
                key={tf}
                style={{ ...s.toggleChip, ...(active ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
                onClick={() => {
                  if (active) {
                    if (draft.scanIntervals.length === 1) return; // at least one must be selected
                    set('scanIntervals', draft.scanIntervals.filter(t => t !== tf));
                    // Also remove from autoEntryIntervals if present
                    const curEntry = draft.autoEntryIntervals ?? ['1h'];
                    set('autoEntryIntervals', curEntry.filter(t => t !== tf));
                  } else {
                    const order: ScanTF[] = ['15m', '1h', '4h', '1d'];
                    const next = [...draft.scanIntervals, tf].sort((a, b) => order.indexOf(a) - order.indexOf(b));
                    set('scanIntervals', next);
                  }
                }}
              >
                {tf}
              </button>
            );
          })}
        </div>
        <span style={s.hint}>선택한 타임프레임만 스캔합니다 (최소 1개 필수)</span>
      </div>

      {/* Auto-entry intervals */}
      <div style={s.fieldRow}>
        <label style={s.label}>자동진입 허용 TF</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {draft.scanIntervals.map(tf => {
            const entryAllowed = (draft.autoEntryIntervals ?? ['1h']).includes(tf);
            return (
              <button
                key={tf}
                style={{ ...s.toggleChip, ...(entryAllowed ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
                onClick={() => {
                  const cur = draft.autoEntryIntervals ?? ['1h'];
                  if (entryAllowed) {
                    if (cur.length === 1) return; // at least one must be allowed
                    set('autoEntryIntervals', cur.filter(t => t !== tf));
                  } else {
                    const order: ScanTF[] = ['15m', '1h', '4h', '1d'];
                    set('autoEntryIntervals', [...cur, tf].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
                  }
                }}
              >
                {tf}
              </button>
            );
          })}
        </div>
        <span style={s.hint}>체크된 TF만 자동 진입합니다. 비체크 TF는 스캔 결과만 기록됩니다. (최소 1개 필수)</span>
      </div>

      {/* Max auto positions per scan */}
      <div style={s.fieldRow}>
        <label style={s.label}>최대 스캔 진입 수</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={1} max={10} step={1}
            value={draft.maxAutoPositionsPerScan ?? 1}
            onChange={e => set('maxAutoPositionsPerScan', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
            style={s.numberInput}
          />
          <span style={s.unit}>개</span>
        </div>
        <span style={s.hint}>한 번의 스캔 사이클에서 자동 진입 허용 수 (전체 TF 합산, 기본 1)</span>
      </div>

      {/* Chase-entry prevention — shown for breakout & FVG; hidden for leader-retest (not applicable) */}
      {!isLeaderRetest && (
      <div style={s.fieldRow}>
        <label style={s.label}>추격 진입 방지</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* ① Signal age */}
          <div style={{ background: 'rgba(14,203,129,0.04)', border: '1px solid rgba(14,203,129,0.12)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: '0.76rem', color: '#9aa4b5', fontWeight: 700 }}>① 신호봉 경과 시간</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min={0} max={600} step={10}
                  value={draft.maxSignalAgeSec ?? 120}
                  onChange={e => set('maxSignalAgeSec', Math.max(0, Math.min(600, parseInt(e.target.value) || 0)))}
                  style={s.numberInput}
                />
                <span style={s.unit}>초</span>
              </div>
            </div>
            <SignalAgeDiagram value={draft.maxSignalAgeSec ?? 120} />
            <div style={s.hint}>
              {isFvg
                ? 'POC 확정봉 이후 이 시간 안에 진입해야 함. 예) 90초 → FVG 신호봉 확정 후 90초 내 처리 안 되면 스킵.'
                : '신호봉 확정 후 이 시간 안에 진입해야 함. 예) 120초 → 정각 스캔 후 2분 내 처리 안 되면 스킵.'}
            </div>
          </div>

          {/* ② Extension — POC-based for FVG, breakout-line for breakout */}
          <div style={{ background: 'rgba(240,185,11,0.04)', border: '1px solid rgba(240,185,11,0.12)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: '0.76rem', color: '#9aa4b5', fontWeight: 700 }}>
                {isFvg ? '② POC 이탈폭' : '② 신호봉 돌파선 이탈폭'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min={0} max={10} step={0.1}
                  value={draft.maxBreakoutExtensionPct ?? 0.6}
                  onChange={e => set('maxBreakoutExtensionPct', Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)))}
                  style={s.numberInput}
                />
                <span style={s.unit}>%</span>
              </div>
            </div>
            <BreakoutExtDiagram value={draft.maxBreakoutExtensionPct ?? 0.6} />
            <div style={s.hint}>
              {isFvg
                ? 'POC 돌파 확정봉 종가가 POC 대비 이 % 이상 벌어지면 과열로 차단. 예) 0.45% → POC 100 기준 종가 100.45 이상이면 스킵.'
                : '신호봉 종가가 돌파선(트리거)에서 너무 멀리 닫히면 과열 신호로 차단. 예) 0.6% → 돌파선 100 기준 종가 100.6 이상이면 스킵.'}
            </div>
          </div>

          {/* ③ Entry drift */}
          <div style={{ background: 'rgba(59,139,235,0.04)', border: '1px solid rgba(59,139,235,0.12)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: '0.76rem', color: '#9aa4b5', fontWeight: 700 }}>③ 주문 시점 추격 이탈폭</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min={0} max={10} step={0.1}
                  value={draft.maxEntryDriftPct ?? 1.0}
                  onChange={e => set('maxEntryDriftPct', Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)))}
                  style={s.numberInput}
                />
                <span style={s.unit}>%</span>
              </div>
            </div>
            <EntryDriftDiagram value={draft.maxEntryDriftPct ?? 1.0} />
            <div style={s.hint}>
              {isFvg
                ? '주문 시점 현재가가 계획 진입가 대비 추격 방향으로 이 % 이상 이탈하면 차단. LONG: 현재가 > 진입가 + N%. SHORT: 현재가 < 진입가 − N%.'
                : '스캔 후 주문 시점 현재가가 계획 진입가 대비 이 % 이상 추격 방향으로 이탈하면 차단. 예) 1% → LONG 시 현재가가 진입가보다 1% 이상 높으면 스킵.'}
            </div>
          </div>

        </div>
      </div>
      )}

      {/* Unattended cadence */}
      <div style={s.fieldRow}>
        <label style={s.label}>무인 스캔 주기</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CADENCE_PRESETS.map(mins => (
            <button
              key={mins}
              style={{ ...s.toggleChip, ...(cadence === mins ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
              onClick={() => set('scanCadenceMinutes', mins)}
            >
              {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
            </button>
          ))}
        </div>
        <span style={s.hint}>무인 자동매매 스캔 경계 주기 (최소 15분, 기본 60분)</span>
        <span style={{ ...s.hint, color: cadenceFasterThanMinTf ? '#f0b90b' : '#5e6673' }}>
          {cadenceFasterThanMinTf
            ? `주의: 현재 주기(${cadence}분)가 최소 스캔 봉(${Math.floor(minTfMinutes / 60) >= 1 && minTfMinutes % 60 === 0 ? `${minTfMinutes / 60}h` : `${minTfMinutes}m`})보다 짧아 중복 스캔이 늘 수 있습니다.`
            : '짧은 주기는 API 사용량을 늘릴 수 있습니다.'}
        </span>
      </div>

      {/* Scan schedule reference */}
      <div style={{ background: 'rgba(59,139,235,0.05)', border: '1px solid rgba(59,139,235,0.1)', borderRadius: 7, padding: '10px 12px', marginTop: -6 }}>
        <div style={{ fontSize: '0.62rem', color: '#4a7fc1', fontWeight: 700, marginBottom: 7, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>스캔 실행 예상 일정</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ALL_SCAN_TFS.filter(tf => draft.scanIntervals.includes(tf)).map(tf => {
            const tfMin = tfToMinutes(tf);
            const effectiveMin = Math.max(tfMin, cadence);
            const perDay = Math.round(1440 / effectiveMin);
            const label = effectiveMin >= 1440 ? '매일 1회' : effectiveMin >= 60 ? `${effectiveMin / 60}h마다` : `${effectiveMin}m마다`;
            const barPct = Math.min(100, (perDay / 96) * 100);
            return (
              <div key={tf} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.67rem', color: '#8a9ab5', width: 28, flexShrink: 0, fontWeight: 600 }}>{tf}</span>
                <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barPct}%`, background: isLive ? '#f6465d' : '#0ecb81', borderRadius: 3, opacity: 0.75 }} />
                </div>
                <span style={{ fontSize: '0.62rem', color: '#5d7280', width: 56, textAlign: 'right' as const, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: '0.62rem', color: '#3d5060', width: 38, textAlign: 'right' as const, flexShrink: 0 }}>{perDay}회/일</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '0.59rem', color: '#3d5060', marginTop: 8, lineHeight: 1.55 }}>
          실제 스캔은 무인 주기·TF 경계가 겹칠 때만 실행됩니다. 15m 설정이라도 주기가 1h이면 매시 정각에만 스캔합니다.
        </div>
      </div>

      {/* ── Strategy selection ──────────────────────────────────────── */}
      <div style={s.fieldRow}>
        <label style={s.label}>스캔 전략</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['breakout', 'leader-retest', 'fvg-poc-ema72'] as const).map(sid => (
            <button
              key={sid}
              style={{ ...s.toggleChip, ...((draft.strategyId ?? 'breakout') === sid ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
              onClick={() => {
                set('strategyId', sid);
                if (sid === 'leader-retest') set('minCandidateScore', 70);
                if (sid === 'fvg-poc-ema72') set('minCandidateScore', 75);
                if (sid === 'breakout') {
                  set('minCandidateScore', 90);
                  // 실험실 기본값과 동일하게 맞춤 (0 = 비활성)
                  set('maxSignalAgeSec', 0);
                  set('maxBreakoutExtensionPct', 0);
                  set('maxEntryDriftPct', 0);
                }
              }}
            >
              {sid === 'breakout' ? '기존 돌파' : sid === 'leader-retest' ? '리더-리테스트' : 'FVG POC+EMA72'}
            </button>
          ))}
        </div>
        <span style={s.hint}>
          기존 돌파: 추세선·수평·박스 돌파 감지. 리더-리테스트: 돌파 후 리테스트 구간 진입. FVG POC+EMA72: 공정가격갭 중심가 크로스 + EMA72 추세 필터.
        </span>
      </div>

      {/* Breakout options (only shown when breakout is selected) */}
      {(draft.strategyId ?? 'breakout') === 'breakout' && (
        <div style={{ background: 'rgba(59,139,235,0.05)', border: '1px solid rgba(59,139,235,0.18)', borderRadius: 7, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.72rem', color: '#3b8beb', fontWeight: 700, marginBottom: 2 }}>기존 돌파 옵션</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>스캔 방향</span>
            {(['both', 'long', 'short'] as const).map(d => (
              <button key={d}
                style={{ ...s.toggleChip, ...((draft.breakoutDirection ?? 'both') === d ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
                onClick={() => set('breakoutDirection', d)}>
                {d === 'long' ? 'LONG만' : d === 'short' ? 'SHORT만' : '양방향'}
              </button>
            ))}
          </div>
          <span style={s.hint}>
            자동매매에서 진입할 방향. 실험실의 "스캔 방향"과 동일. LONG만 권장(추세 방향).
          </span>
          {/* Breakout live entry precision (only meaningful in live mode) */}
          {isLive && (
            <div style={{ borderTop: '1px solid rgba(59,139,235,0.15)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: '0.72rem', color: '#3b8beb', fontWeight: 700, marginBottom: 2 }}>실전 진입 정밀도 (라인 대비 현재가 거리)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>라인 근처 시장가 허용폭</span>
                  <input type="number" min={0} max={5} step={0.05}
                    value={draft.breakoutMarketNearPct ?? 0.20}
                    onChange={e => set('breakoutMarketNearPct', Math.max(0, Math.min(5, parseFloat(e.target.value) || 0.20)))}
                    style={{ ...s.numberInput, width: 60 }} />
                  <span style={s.unit}>%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>라인 기준 IOC 허용폭</span>
                  <input type="number" min={0} max={5} step={0.05}
                    value={draft.breakoutLimitIocFarPct ?? 0.50}
                    onChange={e => set('breakoutLimitIocFarPct', Math.max(0, Math.min(5, parseFloat(e.target.value) || 0.50)))}
                    style={{ ...s.numberInput, width: 60 }} />
                  <span style={s.unit}>%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>트리거 후 최대 진입 봉 수</span>
                  <input type="number" min={0} max={10} step={1}
                    value={draft.breakoutMaxBarsAfterTrigger ?? 0}
                    onChange={e => set('breakoutMaxBarsAfterTrigger', Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))}
                    style={{ ...s.numberInput, width: 60 }} />
                  <span style={s.unit}>봉</span>
                </div>
              </div>
              <span style={s.hint}>
                현재가가 돌파 라인에서 ≤ 시장가폭%이면 MARKET, ≤ IOC폭%이면 지정가 IOC @ 라인가격, 초과 시 진입 스킵.
                트리거 후 최대 봉 수: 0 = 같은 봉만 진입, 1 = 다음 봉까지 허용, 2 = 그 다음 봉까지 허용.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Leader-retest options (only shown when leader-retest is selected) */}
      {(draft.strategyId ?? 'breakout') === 'leader-retest' && (
        <div style={{ background: 'rgba(59,139,235,0.05)', border: '1px solid rgba(59,139,235,0.18)', borderRadius: 7, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.72rem', color: '#3b8beb', fontWeight: 700, marginBottom: 2 }}>리테스트 감지 조건</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>돌파봉 최소</span>
              <input type="number" min={1} max={20} step={1}
                value={draft.retestMinBars ?? 1}
                onChange={e => set('retestMinBars', Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                style={{ ...s.numberInput, width: 52 }} />
              <span style={s.unit}>봉</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>최대</span>
              <input type="number" min={2} max={50} step={1}
                value={draft.retestMaxBars ?? 8}
                onChange={e => set('retestMaxBars', Math.max(2, Math.min(50, parseInt(e.target.value) || 8)))}
                style={{ ...s.numberInput, width: 52 }} />
              <span style={s.unit}>봉</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>허용폭</span>
              <input type="number" min={0.1} max={2.0} step={0.05}
                value={draft.retestToleranceAtr ?? 0.30}
                onChange={e => set('retestToleranceAtr', Math.max(0.1, Math.min(2.0, parseFloat(e.target.value) || 0.30)))}
                style={{ ...s.numberInput, width: 60 }} />
              <span style={s.unit}>× ATR</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>오버슈트</span>
              <input type="number" min={0.1} max={3.0} step={0.1}
                value={draft.retestMaxOvershootAtr ?? 1.0}
                onChange={e => set('retestMaxOvershootAtr', Math.max(0.1, Math.min(3.0, parseFloat(e.target.value) || 1.0)))}
                style={{ ...s.numberInput, width: 60 }} />
              <span style={s.unit}>× ATR</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>자동매매 방향</span>
            {(['long', 'both'] as const).map(d => (
              <button key={d}
                style={{ ...s.toggleChip, ...((draft.retestAutoDirection ?? 'long') === d ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
                onClick={() => set('retestAutoDirection', d)}>
                {d === 'long' ? '롱만' : '양방향'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>4H 상승 추세 필터</span>
            <button
              style={{ ...s.toggleChip, ...((draft.retestRequire4hTrend ?? true) ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
              onClick={() => set('retestRequire4hTrend', !(draft.retestRequire4hTrend ?? true))}>
              {(draft.retestRequire4hTrend ?? true) ? 'ON' : 'OFF'}
            </button>
          </div>
          <span style={s.hint}>
            최소/최대봉: 돌파 후 몇 봉 이내에 리테스트가 와야 하는지. 허용폭: 레벨과의 근접도(ATR 배수). 자동매매는 기본 롱만 권장.
            4H 추세 필터 ON 시 4H EMA20 &gt; EMA50인 경우에만 롱 진입.
          </span>
        </div>
      )}

      {/* FVG POC + EMA72 options */}
      {(draft.strategyId ?? 'breakout') === 'fvg-poc-ema72' && (
        <div style={{ background: 'rgba(240,185,11,0.05)', border: '1px solid rgba(240,185,11,0.20)', borderRadius: 7, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.72rem', color: '#f0b90b', fontWeight: 700, marginBottom: 2 }}>FVG POC + EMA72 조건</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>POC 조회봉수</span>
              <input type="number" min={100} max={1500} step={50}
                value={draft.fvgPocLookbackBars ?? 500}
                onChange={e => set('fvgPocLookbackBars', Math.max(100, Math.min(1500, parseInt(e.target.value) || 500)))}
                style={{ ...s.numberInput, width: 60 }} />
              <span style={s.unit}>봉</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>히스토그램 구간</span>
              <input type="number" min={10} max={200} step={5}
                value={draft.fvgPocBins ?? 40}
                onChange={e => set('fvgPocBins', Math.max(10, Math.min(200, parseInt(e.target.value) || 40)))}
                style={{ ...s.numberInput, width: 52 }} />
              <span style={s.unit}>bins</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>EMA 기간</span>
              <input type="number" min={10} max={500} step={1}
                value={draft.fvgEmaPeriod ?? 72}
                onChange={e => set('fvgEmaPeriod', Math.max(10, Math.min(500, parseInt(e.target.value) || 72)))}
                style={{ ...s.numberInput, width: 52 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>유니버스 상위</span>
              <input type="number" min={10} max={300} step={10}
                value={draft.fvgUniverseTopN ?? 100}
                onChange={e => set('fvgUniverseTopN', Math.max(10, Math.min(300, parseInt(e.target.value) || 100)))}
                style={{ ...s.numberInput, width: 52 }} />
              <span style={s.unit}>개</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.74rem', color: '#9aa4b5', whiteSpace: 'nowrap' as const }}>방향</span>
            {(['long', 'short', 'both'] as const).map(d => (
              <button key={d}
                style={{ ...s.toggleChip, ...((draft.fvgAutoDirection ?? 'both') === d ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
                onClick={() => set('fvgAutoDirection', d)}>
                {d === 'long' ? '롱만' : d === 'short' ? '숏만' : '양방향'}
              </button>
            ))}
          </div>
          <span style={s.hint}>
            POC 돌파형 전략으로, 확정봉 과열(이탈폭) 및 주문 시점 추격진입 필터가 적용됩니다.{' '}
            유니버스: 24h 거래대금 상위 N개(4h 캐시). POC 조회봉수: FVG 수집 범위. EMA 기간: 추세 필터 기준.
          </span>
        </div>
      )}

      {/* Min candidate score */}
      <div style={s.fieldRow}>
        <label style={s.label}>최소 진입 점수</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={50} max={100} step={1}
            value={draft.minCandidateScore ?? 90}
            onChange={e => set('minCandidateScore', Math.max(50, Math.min(100, parseInt(e.target.value) || 90)))}
            style={s.numberInput}
          />
          <span style={s.unit}>점</span>
        </div>
        <span style={s.hint}>
          이 점수 이상인 후보만 자동 진입합니다.{' '}
          {(draft.strategyId ?? 'breakout') === 'leader-retest'
            ? '리더-리테스트 스코어는 구조적으로 40~80점 범위 — 70점 내외 권장. 전략 전환 시 자동 조정됩니다.'
            : (draft.strategyId ?? 'breakout') === 'fvg-poc-ema72'
            ? 'FVG POC 스코어는 40~80점 범위 — 75점 내외 권장. 전략 전환 시 자동 조정됩니다.'
            : '기존 돌파 스코어는 0~100점 분포 — 기본 90점. 낮출수록 후보 증가, 높일수록 고품질 집중.'}
        </span>
      </div>

      {/* Time-stop toggle (unattended auto-trade scope) */}
      <div style={s.fieldRow}>
        <label style={s.label}>타임스탑</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ ...s.toggleChip, ...(timeStopEnabled ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
            onClick={() => set('timeStopEnabled', true)}
          >
            ON
          </button>
          <button
            style={{ ...s.toggleChip, ...(!timeStopEnabled ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
            onClick={() => set('timeStopEnabled', false)}
          >
            OFF
          </button>
        </div>
        <span style={s.hint}>
          ON: 유효시간 5분 전 음성 알림 → 만료 시 결정 모달 팝업 (15분 내 미응답 시 자동청산).
        </span>
        <span style={s.hint}>
          OFF: 시간 만료 후에도 자동청산하지 않습니다. 구조적 무효화(SL 기반) 감시는 ON/OFF 무관하게 항상 동작합니다.
        </span>
        <span style={s.hint}>
          ※ 설정은 저장 후 새로 진입하는 포지션부터 적용됩니다.
        </span>
      </div>

      {/* timeStopBars — only shown when timeStopEnabled */}
      {timeStopEnabled && (
        <div style={s.fieldRow}>
          <label style={s.label}>타임스탑 봉 수</label>
          <input
            style={{ ...s.numberInput, width: 70 }}
            type="number" min={1} max={50}
            value={draft.timeStopBars ?? 4}
            onChange={e => set('timeStopBars', Math.max(1, Math.min(50, Number(e.target.value) || 4)))}
          />
          <span style={s.hint}>진입 후 N봉이 경과하면 TP/SL 미도달 시 시장가 청산. (스캔 TF 기준)</span>
        </div>
      )}

      {/* Live entry order type — only shown for live mode */}
      {isLive && (
        <div style={s.fieldRow}>
          <label style={s.label}>실전 진입 주문 방식</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['MARKET', 'LIMIT_IOC'] as const).map(t => (
              <button
                key={t}
                style={{ ...s.toggleChip, ...((draft.liveEntryOrderType ?? 'MARKET') === t ? s.toggleChipActiveLive : {}) }}
                onClick={() => set('liveEntryOrderType', t)}
              >
                {t === 'MARKET' ? '시장가(Market)' : '지정가 IOC'}
              </button>
            ))}
          </div>
          <span style={s.hint}>
            시장가: 즉시 체결 (슬리피지 있음) · 지정가 IOC: 스캔 시점 가격으로 즉시 체결 시도, 미체결 시 자동 취소 (슬리피지 없음, 진입 실패 가능)
          </span>
        </div>
      )}

      {/* Voice alert toggle (unattended auto-trade scope) */}
      <div style={s.fieldRow}>
        <label style={s.label}>자동진입 음성 알림</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ ...s.toggleChip, ...(voiceAlertEnabled ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
            onClick={() => set('voiceAlertEnabled', true)}
          >
            ON
          </button>
          <button
            style={{ ...s.toggleChip, ...(!voiceAlertEnabled ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
            onClick={() => set('voiceAlertEnabled', false)}
          >
            OFF
          </button>
        </div>
        <span style={s.hint}>
          OFF면 자동매매(auto) 진입 시 음성 멘트는 재생하지 않고, 기본 진입음만 재생합니다.
        </span>
      </div>

      {/* TP1 partial close */}
      <div style={s.fieldRow}>
        <label style={s.label}>TP1 부분익절</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ ...s.toggleChip, ...((draft.tp1Enabled ?? false) ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
            onClick={() => set('tp1Enabled', true)}
          >
            ON
          </button>
          <button
            style={{ ...s.toggleChip, ...(!(draft.tp1Enabled ?? false) ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
            onClick={() => set('tp1Enabled', false)}
          >
            OFF
          </button>
        </div>
        <span style={s.hint}>ALT 자동매매 전용. TP 목표의 일부 구간 도달 시 일부 익절 후 SL을 진입가로 이동.</span>
        {(draft.tp1Enabled ?? false) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6, paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...s.label, width: 100 }}>TP1 위치 (R)</span>
              <input
                type="number"
                min={0.1} max={0.9} step={0.05}
                value={draft.tp1R ?? 0.30}
                onChange={e => set('tp1R', Math.max(0.1, Math.min(0.9, parseFloat(e.target.value) || 0.30)))}
                style={{ ...s.numberInput, width: 70 }}
              />
              <span style={s.unit}>× R</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...s.label, width: 100 }}>익절 비율</span>
              <input
                type="number"
                min={10} max={90} step={10}
                value={draft.tp1ClosePct ?? 50}
                onChange={e => set('tp1ClosePct', Math.max(10, Math.min(90, parseInt(e.target.value) || 50)))}
                style={{ ...s.numberInput, width: 70 }}
              />
              <span style={s.unit}>%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...s.label, width: 100 }}>진입가 SL이동</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  style={{ ...s.toggleChip, ...((draft.tp1MoveSL !== false) ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
                  onClick={() => set('tp1MoveSL', true)}
                >
                  ON
                </button>
                <button
                  style={{ ...s.toggleChip, ...((draft.tp1MoveSL === false) ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive) : {}) }}
                  onClick={() => set('tp1MoveSL', false)}
                >
                  OFF
                </button>
              </div>
            </div>
            <span style={s.hint}>TP1 = 진입가 + (TP−진입가)×{(draft.tp1R ?? 0.30).toFixed(2)} 지점에서 {draft.tp1ClosePct ?? 50}% 익절{(draft.tp1MoveSL !== false) ? ' + SL → 진입가' : ''}</span>
          </div>
        )}
      </div>

      {/* Risk gates */}
      <div style={s.fieldRow}>
        <label style={s.label}>총 포지션 한도</label>
        <input
          style={{ ...s.numberInput, width: 70 }}
          type="number" min={0} max={50}
          value={draft.maxTotalPositions ?? 0}
          onChange={e => set('maxTotalPositions', Math.max(0, Number(e.target.value) || 0))}
        />
        <span style={s.hint}>총 오픈 포지션 수가 N 이상이면 신규 진입 차단. (0 = 무제한)</span>
      </div>

      <div style={s.fieldRow}>
        <label style={s.label}>동방향 포지션 한도</label>
        <input
          style={{ ...s.numberInput, width: 70 }}
          type="number" min={0} max={20}
          value={draft.maxConcurrentCorrelated ?? 0}
          onChange={e => set('maxConcurrentCorrelated', Math.max(0, Number(e.target.value) || 0))}
        />
        <span style={s.hint}>같은 방향(LONG/SHORT) 포지션이 N 이상이면 차단. (0 = 무제한)</span>
      </div>

      <div style={s.fieldRow}>
        <label style={s.label}>손실 후 쿨다운</label>
        <input
          style={{ ...s.numberInput, width: 70 }}
          type="number" min={0} max={50}
          value={draft.cooldownBarsAfterLoss ?? 0}
          onChange={e => set('cooldownBarsAfterLoss', Math.max(0, Number(e.target.value) || 0))}
        />
        <span style={s.hint}>손실 청산 후 동일 TF에서 N봉 동안 신규 진입 차단. (0 = 없음)</span>
      </div>

      {/* Info */}
      <div style={s.infoBox}>
        <p style={{ margin: 0, color: '#5e6673', fontSize: '0.76rem', lineHeight: 1.7 }}>
          {isLive
            ? <>• 실전 자동매매 진입 시에만 적용됩니다 (모의 설정과 독립)<br />
               • 실전 진입 전 레버리지·마진 크기를 반드시 확인하세요<br />
               • 높은 레버리지는 청산 위험을 크게 높입니다 — 신중하게 설정하세요</>
            : <>• 모의 자동매매 진입 시에만 적용됩니다 (실전 설정과 독립)<br />
               • 수동 ALT추천 진입은 진입 모달에서 별도 조정 가능합니다<br />
               • 높은 레버리지는 청산 위험을 크게 높입니다 — 주의하세요</>
          }
        </p>
      </div>
    </>
  );
}

// ── Main modal ───────────────────────────────────────────────────────────────
export function AutoTradeSettingsModal({ paperSettings, liveSettings, onSave, onClose, initialTab = 'paper', labAutoPresets, onDeletePreset }: Props) {
  const [tab, setTab] = useState<'paper' | 'live'>(initialTab);
  const [paperDraft, setPaperDraft] = useState<AutoTradeSettings>({
    ...paperSettings,
    scanCadenceMinutes: normalizeCadenceMinutes(paperSettings.scanCadenceMinutes),
    timeStopEnabled: normalizeTimeStopEnabled(paperSettings.timeStopEnabled),
    voiceAlertEnabled: normalizeVoiceAlertEnabled(paperSettings.voiceAlertEnabled),
  });
  const [liveDraft,  setLiveDraft]  = useState<AutoTradeSettings>({
    ...liveSettings,
    scanCadenceMinutes: normalizeCadenceMinutes(liveSettings.scanCadenceMinutes),
    timeStopEnabled: normalizeTimeStopEnabled(liveSettings.timeStopEnabled),
    voiceAlertEnabled: normalizeVoiceAlertEnabled(liveSettings.voiceAlertEnabled),
  });

  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null);

  const setP = <K extends keyof AutoTradeSettings>(k: K, v: AutoTradeSettings[K]) =>
    setPaperDraft(prev => ({ ...prev, [k]: v }));
  const setL = <K extends keyof AutoTradeSettings>(k: K, v: AutoTradeSettings[K]) =>
    setLiveDraft(prev => ({ ...prev, [k]: v }));

  const applyPreset = (preset: LabAutoPreset) => {
    if (tab === 'paper') setPaperDraft(prev => ({ ...prev, ...preset.settings }));
    else setLiveDraft(prev => ({ ...prev, ...preset.settings }));
    setAppliedPresetId(preset.id);
    setTimeout(() => setAppliedPresetId(null), 2000);
  };

  const handleSave = () => {
    onSave(
      {
        ...paperDraft,
        scanCadenceMinutes: normalizeCadenceMinutes(paperDraft.scanCadenceMinutes),
        timeStopEnabled: normalizeTimeStopEnabled(paperDraft.timeStopEnabled),
        voiceAlertEnabled: normalizeVoiceAlertEnabled(paperDraft.voiceAlertEnabled),
      },
      {
        ...liveDraft,
        scanCadenceMinutes: normalizeCadenceMinutes(liveDraft.scanCadenceMinutes),
        timeStopEnabled: normalizeTimeStopEnabled(liveDraft.timeStopEnabled),
        voiceAlertEnabled: normalizeVoiceAlertEnabled(liveDraft.voiceAlertEnabled),
      },
    );
    onClose();
  };

  const handleReset = () => {
    if (tab === 'paper') setPaperDraft({ ...DEFAULT_AUTO_TRADE_SETTINGS });
    else setLiveDraft({ ...DEFAULT_LIVE_AUTO_TRADE_SETTINGS });
  };

  const isLive = tab === 'live';

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        {/* Header */}
        <div style={{ ...s.header, background: isLive ? 'rgba(246,70,93,0.06)' : 'rgba(14,203,129,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>⚙</span>
            <div>
              <div style={s.title}>자동매매 진입 설정</div>
              <div style={s.sub}>모의/실전 각각 독립 설정 — {isLive ? '실전' : '모의'} 탭 편집 중</div>
            </div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tab switcher */}
        <div style={s.tabBar}>
          <button
            style={{ ...s.tabBtn, ...(tab === 'paper' ? s.tabBtnActivePaper : {}) }}
            onClick={() => setTab('paper')}
          >
            📄 모의 설정
          </button>
          <button
            style={{ ...s.tabBtn, ...(tab === 'live' ? s.tabBtnActiveLive : {}) }}
            onClick={() => setTab('live')}
          >
            ⚡ 실전 설정
          </button>
        </div>

        {/* Body */}
        <div style={s.body}>
          {/* 실험실 저장 프리셋 */}
          {labAutoPresets && labAutoPresets.length > 0 && (
            <div style={{ marginBottom: 14, background: 'rgba(240,185,11,0.04)', border: '1px solid rgba(240,185,11,0.2)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.72rem', color: '#f0b90b', fontWeight: 700, marginBottom: 8, letterSpacing: '0.04em' }}>
                📥 실험실 저장 프리셋
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {labAutoPresets.map(preset => {
                  const sid = preset.strategyId;
                  const badgeColor = sid === 'fvg-poc-ema72' ? '#f0b90b' : sid === 'leader-retest' ? '#9b59b6' : '#3b8beb';
                  const badgeBg = sid === 'fvg-poc-ema72' ? 'rgba(240,185,11,0.12)' : sid === 'leader-retest' ? 'rgba(155,89,182,0.12)' : 'rgba(59,139,235,0.12)';
                  const stratLabel = sid === 'fvg-poc-ema72' ? 'FVG POC+EMA72' : sid === 'leader-retest' ? '리더-리테스트' : '기존 돌파';
                  const savedDate = new Date(preset.savedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: '0.78rem', color: '#d1d4dc', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.name}</span>
                          <span style={{ fontSize: '0.62rem', color: badgeColor, background: badgeBg, border: `1px solid ${badgeColor}44`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{stratLabel}</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', color: '#5e6673' }}>{savedDate} 저장 · {preset.settings.leverage}x · 리스크 {preset.settings.riskPct}% · 최소 {preset.settings.minCandidateScore ?? 90}점</div>
                      </div>
                      {appliedPresetId === preset.id ? (
                        <span style={{ fontSize: '0.72rem', padding: '3px 10px', border: '1px solid rgba(14,203,129,0.5)', borderRadius: 4, background: 'rgba(14,203,129,0.12)', color: '#0ecb81', flexShrink: 0, fontWeight: 700 }}>
                          ✓ 적용됨
                        </span>
                      ) : (
                        <button
                          style={{ fontSize: '0.72rem', padding: '3px 10px', border: `1px solid ${isLive ? 'rgba(246,70,93,0.4)' : 'rgba(14,203,129,0.4)'}`, borderRadius: 4, background: isLive ? 'rgba(246,70,93,0.08)' : 'rgba(14,203,129,0.08)', color: isLive ? '#f6465d' : '#0ecb81', cursor: 'pointer', flexShrink: 0 }}
                          onClick={() => applyPreset(preset)}
                        >
                          {tab === 'paper' ? '모의에 적용' : '실전에 적용'}
                        </button>
                      )}
                      {onDeletePreset && (
                        <button
                          style={{ fontSize: '0.72rem', padding: '3px 6px', border: '1px solid rgba(246,70,93,0.25)', borderRadius: 4, background: 'transparent', color: '#f6465d', cursor: 'pointer', flexShrink: 0, opacity: 0.7 }}
                          onClick={() => onDeletePreset(preset.id)}
                        >✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {tab === 'paper'
            ? <SettingsEditor draft={paperDraft} set={setP} isLive={false} />
            : <SettingsEditor draft={liveDraft}  set={setL} isLive={true}  />
          }
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button style={s.resetBtn} onClick={handleReset}>{tab === 'paper' ? '모의' : '실전'} 기본값 복원</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.cancelBtn} onClick={onClose}>취소</button>
            <button
              style={{ ...s.saveBtn, ...(isLive ? s.saveBtnLive : {}) }}
              onClick={handleSave}
            >저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 7500,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 10,
    width: 'min(480px, 96vw)', display: 'flex', flexDirection: 'column',
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid #2a2e39',
  },
  title: { color: '#d1d4dc', fontWeight: 700, fontSize: '1rem' },
  sub: { color: '#5e6673', fontSize: '0.74rem', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: '#5e6673', cursor: 'pointer',
    fontSize: '1rem', padding: '4px 8px', borderRadius: 4,
  },
  tabBar: {
    display: 'flex', borderBottom: '1px solid #2a2e39',
  },
  tabBtn: {
    flex: 1, background: 'none', border: 'none', cursor: 'pointer',
    padding: '10px 0', fontSize: '0.85rem', fontWeight: 600,
    color: '#5e6673', fontFamily: 'inherit', transition: 'all 0.15s',
  },
  tabBtnActivePaper: {
    color: '#0ecb81', borderBottom: '2px solid #0ecb81', background: 'rgba(14,203,129,0.05)',
  },
  tabBtnActiveLive: {
    color: '#f6465d', borderBottom: '2px solid #f6465d', background: 'rgba(246,70,93,0.05)',
  },
  body: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: '70vh' },
  fieldRow: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { color: '#848e9c', fontSize: '0.8rem', fontWeight: 600 },
  numberInput: {
    background: '#12151e', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#d1d4dc', fontSize: '0.92rem', padding: '6px 10px',
    width: 100, fontFamily: '"SF Mono", Consolas, monospace', outline: 'none',
  } as React.CSSProperties,
  unit: { color: '#5e6673', fontSize: '0.85rem' },
  hint: { color: '#3a4558', fontSize: '0.74rem', marginTop: 2 },
  toggleChip: {
    background: '#12151e', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#5e6673', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
    padding: '5px 12px', fontFamily: 'inherit', transition: 'all 0.15s',
  },
  toggleChipActive: {
    borderColor: 'rgba(14,203,129,0.55)', color: '#0ecb81', background: 'rgba(14,203,129,0.1)',
  },
  toggleChipActiveLive: {
    borderColor: 'rgba(246,70,93,0.55)', color: '#f6465d', background: 'rgba(246,70,93,0.1)',
  },
  infoBox: {
    background: '#12151e', borderRadius: 5, padding: '10px 14px', border: '1px solid #2a2e39',
  },
  footer: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 20px', borderTop: '1px solid #2a2e39',
  },
  resetBtn: {
    background: 'none', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#5e6673', cursor: 'pointer', fontSize: '0.8rem', padding: '6px 12px', fontFamily: 'inherit',
  },
  cancelBtn: {
    background: 'none', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#848e9c', cursor: 'pointer', fontSize: '0.85rem', padding: '7px 16px', fontFamily: 'inherit',
  },
  saveBtn: {
    background: 'rgba(14,203,129,0.1)', border: '1px solid rgba(14,203,129,0.4)',
    borderRadius: 5, color: '#0ecb81', cursor: 'pointer', fontWeight: 700,
    fontSize: '0.88rem', padding: '7px 22px', fontFamily: 'inherit',
  },
  saveBtnLive: {
    background: 'rgba(246,70,93,0.1)', border: '1px solid rgba(246,70,93,0.4)', color: '#f6465d',
  },
};
