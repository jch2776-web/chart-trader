import React, { useState } from 'react';

export type ScanTF = '15m' | '1h' | '4h' | '1d';
export const ALL_SCAN_TFS: ScanTF[] = ['15m', '1h', '4h', '1d'];

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
};

interface Props {
  paperSettings: AutoTradeSettings;
  liveSettings: AutoTradeSettings;
  onSave: (paper: AutoTradeSettings, live: AutoTradeSettings) => void;
  onClose: () => void;
  initialTab?: 'paper' | 'live';
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

      {/* Chase-entry prevention */}
      <div style={s.fieldRow}>
        <label style={s.label}>추격 진입 방지</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#9aa4b5', marginBottom: 3 }}>신호 유효 시간(초)</div>
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
          <div>
            <div style={{ fontSize: '0.72rem', color: '#9aa4b5', marginBottom: 3 }}>최대 진입 이탈폭(%)</div>
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
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: '0.72rem', color: '#9aa4b5', marginBottom: 3 }}>돌파선 대비 최대 확정봉 이탈폭(%)</div>
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
        <span style={s.hint}>정각 스캔 후 현재가가 너무 멀리 이탈한 경우 추격 진입을 방지합니다. 0 = 비활성화</span>
        <span style={s.hint}>돌파선 이탈폭: 확정봉 종가가 트리거(돌파선) 기준을 너무 멀리 벗어난 경우 자동진입을 차단합니다. 0 = 비활성화</span>
      </div>

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
export function AutoTradeSettingsModal({ paperSettings, liveSettings, onSave, onClose, initialTab = 'paper' }: Props) {
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

  const setP = <K extends keyof AutoTradeSettings>(k: K, v: AutoTradeSettings[K]) =>
    setPaperDraft(prev => ({ ...prev, [k]: v }));
  const setL = <K extends keyof AutoTradeSettings>(k: K, v: AutoTradeSettings[K]) =>
    setLiveDraft(prev => ({ ...prev, [k]: v }));

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
