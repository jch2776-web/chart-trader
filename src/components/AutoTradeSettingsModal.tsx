import React, { useState } from 'react';

export interface AutoTradeSettings {
  sizeMode: 'margin' | 'risk';
  marginUsdt: number;
  riskPct: number;
  leverage: number;
  marginType: 'ISOLATED' | 'CROSSED';
}

export const DEFAULT_AUTO_TRADE_SETTINGS: AutoTradeSettings = {
  sizeMode: 'margin',
  marginUsdt: 100,
  riskPct: 2,
  leverage: 3,
  marginType: 'ISOLATED',
};

interface Props {
  settings: AutoTradeSettings;
  onSave: (s: AutoTradeSettings) => void;
  onClose: () => void;
}

export function AutoTradeSettingsModal({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AutoTradeSettings>({ ...settings });

  const set = <K extends keyof AutoTradeSettings>(k: K, v: AutoTradeSettings[K]) =>
    setDraft(prev => ({ ...prev, [k]: v }));

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  const handleReset = () => setDraft({ ...DEFAULT_AUTO_TRADE_SETTINGS });

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>⚙</span>
            <div>
              <div style={s.title}>자동매매 진입 설정</div>
              <div style={s.sub}>ALT추천 자동매매 진입 시 사용할 기본 파라미터</div>
            </div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={s.body}>
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
                  style={{ ...s.toggleChip, ...(draft.marginType === m ? s.toggleChipActive : {}) }}
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
                style={{ ...s.toggleChip, ...(draft.sizeMode === 'margin' ? s.toggleChipActive : {}) }}
                onClick={() => set('sizeMode', 'margin')}
              >
                고정 마진 (USDT)
              </button>
              <button
                style={{ ...s.toggleChip, ...(draft.sizeMode === 'risk' ? s.toggleChipActive : {}) }}
                onClick={() => set('sizeMode', 'risk')}
              >
                잔고 비율 (%)
              </button>
            </div>
          </div>

          {/* Margin USDT (shown only when sizeMode=margin) */}
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

          {/* Risk pct (shown only when sizeMode=risk) */}
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

          {/* Info box */}
          <div style={s.infoBox}>
            <p style={{ margin: 0, color: '#5e6673', fontSize: '0.76rem', lineHeight: 1.7 }}>
              • 이 설정은 ALT추천 자동매매(모의/실전 공통)에 적용됩니다<br />
              • 수동 ALT추천 진입은 진입 모달에서 별도 조정 가능합니다<br />
              • 높은 레버리지는 청산 위험을 크게 높입니다 — 주의하세요
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button style={s.resetBtn} onClick={handleReset}>기본값 복원</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.cancelBtn} onClick={onClose}>취소</button>
            <button style={s.saveBtn} onClick={handleSave}>저장</button>
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
    width: 'min(460px, 96vw)', display: 'flex', flexDirection: 'column',
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid #2a2e39',
    background: 'rgba(14,203,129,0.05)',
  },
  title: { color: '#d1d4dc', fontWeight: 700, fontSize: '1rem' },
  sub: { color: '#5e6673', fontSize: '0.74rem', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: '#5e6673', cursor: 'pointer',
    fontSize: '1rem', padding: '4px 8px', borderRadius: 4,
  },
  body: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 },
  fieldRow: {
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  label: { color: '#848e9c', fontSize: '0.8rem', fontWeight: 600 },
  numberInput: {
    background: '#12151e', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#d1d4dc', fontSize: '0.92rem', padding: '6px 10px',
    width: 100, fontFamily: '"SF Mono", Consolas, monospace',
    outline: 'none',
  } as React.CSSProperties,
  unit: { color: '#5e6673', fontSize: '0.85rem' },
  hint: { color: '#3a4558', fontSize: '0.74rem', marginTop: 2 },
  toggleChip: {
    background: '#12151e', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#5e6673', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
    padding: '5px 12px', fontFamily: 'inherit', transition: 'all 0.15s',
  },
  toggleChipActive: {
    borderColor: 'rgba(14,203,129,0.55)', color: '#0ecb81',
    background: 'rgba(14,203,129,0.1)',
  },
  infoBox: {
    background: '#12151e', borderRadius: 5, padding: '10px 14px',
    border: '1px solid #2a2e39',
  },
  footer: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 20px', borderTop: '1px solid #2a2e39',
  },
  resetBtn: {
    background: 'none', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#5e6673', cursor: 'pointer', fontSize: '0.8rem',
    padding: '6px 12px', fontFamily: 'inherit',
  },
  cancelBtn: {
    background: 'none', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#848e9c', cursor: 'pointer', fontSize: '0.85rem',
    padding: '7px 16px', fontFamily: 'inherit',
  },
  saveBtn: {
    background: 'rgba(14,203,129,0.1)', border: '1px solid rgba(14,203,129,0.4)',
    borderRadius: 5, color: '#0ecb81', cursor: 'pointer', fontWeight: 700,
    fontSize: '0.88rem', padding: '7px 22px', fontFamily: 'inherit',
  },
};
