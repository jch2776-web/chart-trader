import React from 'react';

type Direction = 'long' | 'short';

interface TimeStopEvalView {
  status: 'loading' | 'done';
  summaryText: string;
  flipSuggested?: boolean;
  candidateScore?: number;
  newSl?: number;
  newTp?: number;
  tightenOk?: boolean;
}

interface TimeStopReqView {
  key: string;
  mode: 'paper' | 'live';
  symbol: string;
  direction: Direction;
  scanInterval: string;
  qty: number;
  currentTp?: number | null;
  currentSl: number;
  deadlineAt: number;
  state: 'pending' | 'closing';
  eval: TimeStopEvalView;
  actionError?: string;
}

interface Props {
  req: TimeStopReqView;
  nowMs: number;
  onCloseModal: () => void;
  onCloseNow: (reqKey: string) => void;
  onApplyTightenAndExtend: (reqKey: string, extendBars: 1 | 2, applyTp: boolean) => void;
}

function pf(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return v >= 1 ? v.toFixed(4) : v.toFixed(8);
}

function fmtRemain(ms: number): string {
  const safe = Math.max(0, ms);
  const m = Math.floor(safe / 60000);
  const s = Math.floor((safe % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function TimeStopDecisionModal({
  req,
  nowMs,
  onCloseModal,
  onCloseNow,
  onApplyTightenAndExtend,
}: Props) {
  const [extendBars, setExtendBars] = React.useState<1 | 2>(2);
  const [applyTp, setApplyTp] = React.useState(false);

  React.useEffect(() => {
    setExtendBars(2);
    setApplyTp(false);
  }, [req.key]);

  const remainMs = Math.max(0, req.deadlineAt - nowMs);
  // canExtend: eval complete + no flip signal + still pending
  // tightenOk means we can also update SL to a better value
  const canExtend = req.eval.status === 'done' && req.eval.flipSuggested !== true && req.state === 'pending';
  const canUpdateSl = canExtend && req.eval.tightenOk === true;
  const proposedSl = req.eval.newSl;
  const proposedTp = req.eval.newTp;

  return (
    <div style={S.backdrop}>
      <div style={S.card}>
        <div style={S.title}>타임스탑 도달</div>
        <div style={S.meta}>
          {req.mode === 'paper' ? '모의' : '실전'} · {req.symbol} · {req.direction.toUpperCase()} · {req.scanInterval} · 수량 {req.qty}
        </div>
        <div style={S.countdown}>자동 청산까지 {fmtRemain(remainMs)}</div>

        <div style={S.section}>
          <div style={S.sectionTitle}>재평가</div>
          <div style={S.bodyText}>
            {req.eval.status === 'loading' ? '재평가 진행 중...' : req.eval.summaryText}
          </div>
          {req.eval.candidateScore != null && (
            <div style={S.bodySub}>score: {req.eval.candidateScore}</div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>SL/TP 비교</div>
          <div style={S.row}>현재 SL: {pf(req.currentSl)}</div>
          <div style={S.row}>현재 TP: {pf(req.currentTp)}</div>
          {canExtend && (
            <>
              <div style={S.row}>제안 SL: {pf(proposedSl)}</div>
              <div style={S.row}>제안 TP: {pf(proposedTp)}</div>
            </>
          )}
        </div>

        <div style={S.section}>
          <label style={{ ...S.checkboxLabel, ...(canUpdateSl ? {} : { opacity: 0.4 }) }}>
            <input
              type="checkbox"
              checked={applyTp}
              onChange={(e) => setApplyTp(e.target.checked)}
              disabled={!canUpdateSl}
            />
            TP도 새 값으로 업데이트
          </label>
          <div style={S.extendRow}>
            <button
              style={{ ...S.segBtn, ...(extendBars === 1 ? S.segBtnActive : null) }}
              onClick={() => setExtendBars(1)}
              disabled={!canExtend}
            >
              1봉 연장
            </button>
            <button
              style={{ ...S.segBtn, ...(extendBars === 2 ? S.segBtnActive : null) }}
              onClick={() => setExtendBars(2)}
              disabled={!canExtend}
            >
              2봉 연장
            </button>
          </div>
          {canExtend && !canUpdateSl && (
            <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#9aa4b5' }}>
              ※ SL 갱신 없이 마감 시간만 연장됩니다. (SL 개선 불가 상태)
            </div>
          )}
        </div>

        <div style={S.actions}>
          <button style={S.closeNowBtn} onClick={() => onCloseNow(req.key)} disabled={req.state !== 'pending'}>
            {req.state === 'closing' ? '처리 중...' : '지금 청산'}
          </button>
          <button
            style={canExtend ? S.extendBtn : S.extendBtnDisabled}
            onClick={() => onApplyTightenAndExtend(req.key, extendBars, applyTp)}
            disabled={!canExtend || req.state !== 'pending'}
          >
            {req.state === 'closing' ? '적용 중...' : canUpdateSl ? 'SL 갱신 후 연장' : '연장'}
          </button>
          <button style={S.ghostBtn} onClick={onCloseModal}>닫기</button>
        </div>
        {req.actionError && (
          <div style={S.errorText}>{req.actionError}</div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
  },
  card: {
    width: 460,
    maxWidth: '94vw',
    background: '#111826',
    border: '1px solid #2c3a53',
    borderRadius: 10,
    padding: 16,
    color: '#d1d4dc',
    boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
  },
  title: { fontSize: '0.98rem', fontWeight: 700 },
  meta: { marginTop: 6, color: '#9aa4b5', fontSize: '0.82rem' },
  countdown: { marginTop: 10, color: '#f0b90b', fontWeight: 700, fontSize: '0.88rem' },
  section: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  sectionTitle: { fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 },
  bodyText: { fontSize: '0.82rem', color: '#c8d2e0', lineHeight: 1.45 },
  bodySub: { fontSize: '0.78rem', color: '#90a3bc', marginTop: 4 },
  row: { fontSize: '0.81rem', color: '#d1d4dc', lineHeight: 1.45 },
  checkboxLabel: {
    fontSize: '0.8rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: '#c8d2e0',
  },
  extendRow: { marginTop: 8, display: 'flex', gap: 8 },
  segBtn: {
    border: '1px solid #3d4b64',
    background: '#192336',
    color: '#c8d2e0',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: '0.78rem',
    cursor: 'pointer',
  },
  segBtnActive: {
    border: '1px solid #3b8beb',
    color: '#8ebeff',
    background: 'rgba(59,139,235,0.16)',
  },
  actions: {
    marginTop: 14,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  closeNowBtn: {
    border: '1px solid rgba(14,203,129,0.55)',
    background: 'rgba(14,203,129,0.14)',
    color: '#0ecb81',
    borderRadius: 6,
    padding: '6px 11px',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  extendBtn: {
    border: '1px solid rgba(59,139,235,0.5)',
    background: 'rgba(59,139,235,0.14)',
    color: '#8ebeff',
    borderRadius: 6,
    padding: '6px 11px',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  extendBtnDisabled: {
    border: '1px solid #3b4455',
    background: '#1a2333',
    color: '#6f7f95',
    borderRadius: 6,
    padding: '6px 11px',
    fontWeight: 700,
    cursor: 'not-allowed',
    fontSize: '0.8rem',
  },
  ghostBtn: {
    border: '1px solid #3b4455',
    background: '#1a2333',
    color: '#9aa4b5',
    borderRadius: 6,
    padding: '6px 11px',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  errorText: {
    marginTop: 8,
    color: '#f6465d',
    fontSize: '0.76rem',
    lineHeight: 1.35,
  },
};
