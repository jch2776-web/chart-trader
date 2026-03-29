/**
 * ScalpSettingsPanel — settings modal for the scalp auto-trade module.
 * Completely separate from the alt-auto settings modal.
 */

import { useState } from 'react';
import type { ScalpSettings } from '../scalp/scalpSettings';
import { DEFAULT_SCALP_SETTINGS } from '../scalp/scalpSettings';

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9100,
  },
  modal: {
    background: '#1a2232',
    border: '1px solid #2d3a4e',
    borderRadius: 10,
    width: 560,
    maxWidth: '96vw',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    padding: 24,
    color: '#c9d1d9',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 13,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#e6edf3',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    background: '#f0b90b22',
    border: '1px solid #f0b90b55',
    color: '#f0b90b',
    borderRadius: 4,
    padding: '1px 7px',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.03em',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#6e7b8b',
    fontSize: 20,
    cursor: 'pointer',
    lineHeight: 1,
    padding: '0 4px',
  },
  section: {
    marginBottom: 20,
    background: '#1e2d42',
    border: '1px solid #2d3a4e',
    borderRadius: 8,
    padding: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#8b9db0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: 12,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  label: {
    flex: '0 0 180px',
    color: '#8b9db0',
    fontSize: 12,
  },
  input: {
    flex: 1,
    background: '#0d1117',
    border: '1px solid #2d3a4e',
    borderRadius: 5,
    color: '#e6edf3',
    padding: '5px 9px',
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
    minWidth: 0,
  },
  select: {
    flex: 1,
    background: '#0d1117',
    border: '1px solid #2d3a4e',
    borderRadius: 5,
    color: '#e6edf3',
    padding: '5px 9px',
    fontSize: 12,
    outline: 'none',
  },
  hint: {
    fontSize: 11,
    color: '#4a5a70',
    marginTop: 3,
    marginLeft: 190,
    marginBottom: 6,
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  btnSave: {
    background: '#0ecb81',
    border: 'none',
    borderRadius: 6,
    color: '#0d1117',
    fontWeight: 700,
    fontSize: 13,
    padding: '7px 20px',
    cursor: 'pointer',
  },
  btnReset: {
    background: '#1e2d42',
    border: '1px solid #2d3a4e',
    borderRadius: 6,
    color: '#8b9db0',
    fontSize: 12,
    padding: '7px 14px',
    cursor: 'pointer',
  },
  btnCancel: {
    background: 'none',
    border: '1px solid #2d3a4e',
    borderRadius: 6,
    color: '#6e7b8b',
    fontSize: 12,
    padding: '7px 14px',
    cursor: 'pointer',
  },
};

// ── Helper sub-components ─────────────────────────────────────────────────────

function NumRow({
  label, hint, value, onChange, min, max, step,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <>
      <div style={S.row}>
        <span style={S.label}>{label}</span>
        <input
          type="number"
          style={S.input}
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
        />
      </div>
      {hint && <div style={S.hint}>{hint}</div>}
    </>
  );
}

function SelectRow<T extends string>({
  label, hint, value, options, onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <>
      <div style={S.row}>
        <span style={S.label}>{label}</span>
        <select
          style={S.select}
          value={value}
          onChange={e => onChange(e.target.value as T)}
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {hint && <div style={S.hint}>{hint}</div>}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  settings: ScalpSettings;
  onSave: (s: ScalpSettings) => void;
  onClose: () => void;
  isActive: boolean;
  onToggleActive: (active: boolean) => void;
  /** True when the live user-data WebSocket stream is connected. */
  streamConnected?: boolean;
  /** Summary stats from the running session (shown when active). */
  sessionStats?: {
    sessionTrades: number;
    consecutiveLosses: number;
    breakerOpen: boolean;
    exposureUsd: number;
  };
  activeOrderCount?: number;
  onResetBreaker?: () => void;
}

export function ScalpSettingsPanel({
  settings, onSave, onClose, isActive, onToggleActive,
  streamConnected, sessionStats, activeOrderCount, onResetBreaker,
}: Props) {
  const [draft, setDraft] = useState<ScalpSettings>({ ...settings });

  function set<K extends keyof ScalpSettings>(key: K, value: ScalpSettings[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  function handleReset() {
    setDraft({ ...DEFAULT_SCALP_SETTINGS });
  }

  const symbolsText = draft.symbols.join(', ');

  return (
    <div style={S.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modal}>

        {/* Header */}
        <div style={S.header}>
          <div style={S.title}>
            <span>⚡ 스캘핑 자동매매 설정</span>
            <span style={S.badge}>SCALP</span>
          </div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Start/Stop toggle */}
        <div style={{ ...S.section, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, color: '#e6edf3', marginBottom: 3 }}>
              스캘핑 세션
            </div>
            <div style={{ fontSize: 11, color: '#4a5a70' }}>
              {isActive
                ? '실행 중 — 설정 저장 후 다음 세션에 적용됩니다'
                : '정지됨 — 저장 후 시작 버튼으로 세션을 시작하세요'}
            </div>
          </div>
          <button
            style={{
              background: isActive ? '#f6465d22' : '#0ecb8122',
              border: `1px solid ${isActive ? '#f6465d66' : '#0ecb8166'}`,
              borderRadius: 6,
              color: isActive ? '#f6465d' : '#0ecb81',
              fontWeight: 700,
              fontSize: 13,
              padding: '8px 18px',
              cursor: 'pointer',
            }}
            onClick={() => onToggleActive(!isActive)}
          >
            {isActive ? '⏹ 정지' : '▶ 시작'}
          </button>
        </div>

        {/* Live session status (shown only when active) */}
        {isActive && (
          <div style={{ ...S.section, padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
            <div style={{ textAlign: 'center' as const }}>
              <div style={{ fontSize: 10, color: '#4a5a70', marginBottom: 2 }}>유저 스트림</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: streamConnected ? '#0ecb81' : '#f6465d' }}>
                {streamConnected ? '● 연결됨' : '○ 끊김'}
              </div>
            </div>
            <div style={{ textAlign: 'center' as const }}>
              <div style={{ fontSize: 10, color: '#4a5a70', marginBottom: 2 }}>활성 주문</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>{activeOrderCount ?? 0}</div>
            </div>
            <div style={{ textAlign: 'center' as const }}>
              <div style={{ fontSize: 10, color: '#4a5a70', marginBottom: 2 }}>세션 진입</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>{sessionStats?.sessionTrades ?? 0}</div>
            </div>
            <div style={{ textAlign: 'center' as const }}>
              <div style={{ fontSize: 10, color: '#4a5a70', marginBottom: 2 }}>노출 (USD)</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: (sessionStats?.exposureUsd ?? 0) > 0 ? '#f0b90b' : '#e6edf3' }}>
                ${(sessionStats?.exposureUsd ?? 0).toFixed(1)}
              </div>
            </div>
            {sessionStats?.breakerOpen && (
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 12, color: '#f6465d', fontWeight: 700 }}>
                  ⛔ 연속 손실 차단기 동작 중 ({sessionStats.consecutiveLosses}회)
                </span>
                {onResetBreaker && (
                  <button
                    style={{ background: '#0ecb8122', border: '1px solid #0ecb8166', borderRadius: 4, color: '#0ecb81', fontSize: 11, padding: '3px 10px', cursor: 'pointer' }}
                    onClick={onResetBreaker}
                  >
                    해제
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Symbols */}
        <div style={S.section}>
          <div style={S.sectionTitle}>거래 심볼</div>
          <div style={{ ...S.row, alignItems: 'flex-start' }}>
            <span style={{ ...S.label, paddingTop: 5 }}>심볼 목록</span>
            <textarea
              style={{
                ...S.input,
                height: 60,
                resize: 'vertical',
                fontFamily: 'monospace',
                lineHeight: 1.5,
              }}
              value={symbolsText}
              placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
              onChange={e => {
                const syms = e.target.value
                  .split(/[,\n]+/)
                  .map(s => s.trim().toUpperCase())
                  .filter(Boolean);
                set('symbols', syms);
              }}
            />
          </div>
          <div style={S.hint}>쉼표 또는 줄바꿈으로 구분. 선물(USDT) 페어만 유효.</div>
        </div>

        {/* Execution */}
        <div style={S.section}>
          <div style={S.sectionTitle}>주문 실행</div>
          <NumRow label="레버리지 (배)" value={draft.leverage} min={1} max={125} onChange={v => set('leverage', v)} />
          <SelectRow
            label="마진 방식"
            value={draft.marginType}
            options={[
              { value: 'ISOLATED', label: 'ISOLATED (격리)' },
              { value: 'CROSSED',  label: 'CROSSED (교차)'  },
            ]}
            onChange={v => set('marginType', v)}
          />
          <NumRow
            label="트레이드당 최대 손실 (USD)"
            hint="손실 허용액 = 수량 × 스탑 거리. 실제 손실 한도."
            value={draft.maxPerTradeRiskUsd}
            min={1}
            step={1}
            onChange={v => set('maxPerTradeRiskUsd', v)}
          />
          <NumRow
            label="총 노출 한도 (USD)"
            hint="모든 스캘핑 포지션 노셔널 합산 한도."
            value={draft.maxOpenExposureUsd}
            min={10}
            step={10}
            onChange={v => set('maxOpenExposureUsd', v)}
          />
          <NumRow
            label="진입주문 TTL (ms)"
            hint="지정가 미체결 후 재호가 대기 시간."
            value={draft.entryTtlMs}
            min={500}
            step={500}
            onChange={v => set('entryTtlMs', v)}
          />
          <NumRow
            label="최대 재호가 횟수"
            hint="재호가 소진 후 IOC 한 번 시도, 실패 시 해당 후보 건너뜀."
            value={draft.maxRepriceCount}
            min={0}
            max={5}
            onChange={v => set('maxRepriceCount', v)}
          />
        </div>

        {/* Signal */}
        <div style={S.section}>
          <div style={S.sectionTitle}>신호 설정</div>
          <SelectRow
            label="신호 모드"
            hint="momentum=매수세 추종, revert=극단 흐름 역추세, both=둘 다."
            value={draft.signalMode}
            options={[
              { value: 'both',     label: '둘 다 (both)'           },
              { value: 'momentum', label: 'Micro-Momentum만'       },
              { value: 'revert',   label: 'Micro-Revert (역추세)만' },
            ]}
            onChange={v => set('signalMode', v)}
          />
          <NumRow
            label="최소 호가 불균형"
            hint="|매수잔량 - 매도잔량| / 합계. 0.20 = 20% 이상 쏠림."
            value={draft.minImbalance}
            min={0.05}
            max={0.9}
            step={0.05}
            onChange={v => set('minImbalance', v)}
          />
          <NumRow
            label="최소 체결 압력"
            hint="2초 롤링 체결 매수/매도 비율 불균형. 0.20 = 20% 이상."
            value={draft.minTradePressure}
            min={0.05}
            max={0.9}
            step={0.05}
            onChange={v => set('minTradePressure', v)}
          />
        </div>

        {/* Risk gates */}
        <div style={S.section}>
          <div style={S.sectionTitle}>리스크 게이트</div>
          <NumRow
            label="최대 스프레드 (bps)"
            hint="bid-ask 스프레드가 이 값 초과 시 진입 차단."
            value={draft.maxSpreadBps}
            min={0.5}
            max={20}
            step={0.5}
            onChange={v => set('maxSpreadBps', v)}
          />
          <NumRow
            label="최소 뎁스 (USD)"
            hint="중간가 기준 10bps 내 매수 잔량. 0 = 비활성화."
            value={draft.minDepthUsd}
            min={0}
            step={10000}
            onChange={v => set('minDepthUsd', v)}
          />
          <NumRow
            label="최대 데이터 지연 (ms)"
            hint="마켓 데이터 staleness 초과 시 차단."
            value={draft.maxLatencyMs}
            min={100}
            max={5000}
            step={100}
            onChange={v => set('maxLatencyMs', v)}
          />
          <NumRow
            label="심볼 쿨다운 (ms)"
            hint="거래 종료 후 동일 심볼 재진입 대기 시간."
            value={draft.symbolCooldownMs}
            min={1000}
            step={5000}
            onChange={v => set('symbolCooldownMs', v)}
          />
          <NumRow
            label="연속 손실 차단 (회)"
            hint="연속 손실이 이 횟수 이상이면 모든 신규 진입 차단."
            value={draft.consecutiveLossBreaker}
            min={1}
            max={20}
            onChange={v => set('consecutiveLossBreaker', v)}
          />
          <NumRow
            label="세션 최대 거래 수"
            hint="세션 내 누적 진입 횟수 한도."
            value={draft.maxDailyTrades}
            min={1}
            max={500}
            onChange={v => set('maxDailyTrades', v)}
          />
        </div>

        {/* Actions */}
        <div style={S.actions}>
          <button style={S.btnReset} onClick={handleReset}>초기화</button>
          <button style={S.btnCancel} onClick={onClose}>취소</button>
          <button style={S.btnSave} onClick={handleSave}>저장</button>
        </div>
      </div>
    </div>
  );
}
