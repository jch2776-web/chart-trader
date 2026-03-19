import React, { useState } from 'react';
import type { StrategyLab } from '../../hooks/useStrategyLab';
import type { LabExperimentConfig, LabExperiment } from '../../hooks/useLabExperiment';
import { LAB_MAX_SLOTS } from '../../hooks/useStrategyLab';
import type { ScanInterval } from '../AltScanner/breakoutScanner';

interface Props {
  lab: StrategyLab;
}

function pf(v: number): string {
  return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}

function fmtTime(ms: number | null): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

const INTERVALS: ScanInterval[] = ['15m', '1h', '4h', '1d'];

// ── Add Experiment Form ──────────────────────────────────────────────────────
function AddExperimentForm({ onAdd, onCancel }: {
  onAdd: (cfg: Omit<LabExperimentConfig, 'id'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('실험 1');
  const [strategyId, setStrategyId] = useState<'breakout' | 'leader-retest'>('breakout');
  const [direction, setDirection] = useState<'long' | 'short' | 'both'>('both');
  const [intervals, setIntervals] = useState<ScanInterval[]>(['1h']);
  const [minScore, setMinScore] = useState(90);
  const [leverage, setLeverage] = useState(10);
  const [riskPct, setRiskPct] = useState(2);
  const [cadence, setCadence] = useState(60);
  const [maxPos, setMaxPos] = useState(5);
  const [initBalance, setInitBalance] = useState(10000);

  const toggleInterval = (iv: ScanInterval) => {
    setIntervals(prev =>
      prev.includes(iv) ? prev.filter(x => x !== iv) : [...prev, iv],
    );
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (intervals.length === 0) return;
    onAdd({
      name: name.trim(),
      enabled: true,
      strategyId,
      scanIntervals: intervals,
      direction,
      minScore,
      leverage,
      riskPct,
      cadenceMinutes: cadence,
      maxPositions: maxPos,
      initialBalance: initBalance,
    });
  };

  return (
    <div style={S.form}>
      <div style={S.formTitle}>새 실험 추가</div>
      <div style={S.formGrid}>
        <label style={S.formLabel}>이름</label>
        <input style={S.input} value={name} onChange={e => setName(e.target.value)} />

        <label style={S.formLabel}>전략</label>
        <select style={S.input} value={strategyId} onChange={e => setStrategyId(e.target.value as 'breakout' | 'leader-retest')}>
          <option value="breakout">돌파 (Breakout)</option>
          <option value="leader-retest">리더 리테스트</option>
        </select>

        <label style={S.formLabel}>방향</label>
        <select style={S.input} value={direction} onChange={e => setDirection(e.target.value as 'long' | 'short' | 'both')}>
          <option value="both">양방향</option>
          <option value="long">LONG만</option>
          <option value="short">SHORT만</option>
        </select>

        <label style={S.formLabel}>타임프레임</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {INTERVALS.map(iv => (
            <button
              key={iv}
              style={{ ...S.segBtn, ...(intervals.includes(iv) ? S.segBtnOn : {}) }}
              onClick={() => toggleInterval(iv)}
            >{iv}</button>
          ))}
        </div>

        <label style={S.formLabel}>최소점수</label>
        <input style={S.input} type="number" min={0} max={120} value={minScore}
          onChange={e => setMinScore(Number(e.target.value))} />

        <label style={S.formLabel}>레버리지</label>
        <input style={S.input} type="number" min={1} max={125} value={leverage}
          onChange={e => setLeverage(Number(e.target.value))} />

        <label style={S.formLabel}>리스크 %</label>
        <input style={S.input} type="number" min={0.1} max={100} step={0.1} value={riskPct}
          onChange={e => setRiskPct(Number(e.target.value))} />

        <label style={S.formLabel}>스캔주기(분)</label>
        <input style={S.input} type="number" min={15} value={cadence}
          onChange={e => setCadence(Number(e.target.value))} />

        <label style={S.formLabel}>최대포지션</label>
        <input style={S.input} type="number" min={0} value={maxPos}
          onChange={e => setMaxPos(Number(e.target.value))} />

        <label style={S.formLabel}>초기잔고(USDT)</label>
        <input style={S.input} type="number" min={100} value={initBalance}
          onChange={e => setInitBalance(Number(e.target.value))} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button style={S.ghostBtn} onClick={onCancel}>취소</button>
        <button style={S.primaryBtn} onClick={handleSubmit}>추가</button>
      </div>
    </div>
  );
}

// ── Single Experiment Card ───────────────────────────────────────────────────
function ExperimentCard({
  exp,
  onToggle,
  onRemove,
  onResetBalance,
  onClearHistory,
}: {
  exp: LabExperiment;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onResetBalance: () => void;
  onClearHistory: () => void;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const cfg = exp.config!;
  const s = exp.stats;
  const pnlColor = s.totalPnl >= 0 ? '#0ecb81' : '#f6465d';
  const strategyLabel = cfg.strategyId === 'leader-retest' ? '리테스트' : '돌파';

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{
            ...S.dot,
            background: cfg.enabled ? '#0ecb81' : '#6f7f95',
          }} />
          <span style={S.cardName}>{cfg.name}</span>
          <span style={S.badge}>{strategyLabel}</span>
          {exp.scanning && <span style={{ ...S.badge, color: '#f0b90b', borderColor: 'rgba(240,185,11,0.3)' }}>스캔중</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            style={{ ...S.tinyBtn, ...(cfg.enabled ? S.tinyBtnOff : S.tinyBtnOn) }}
            onClick={() => onToggle(!cfg.enabled)}
          >
            {cfg.enabled ? '중지' : '시작'}
          </button>
          <button style={S.tinyBtnDanger} onClick={onRemove}>삭제</button>
        </div>
      </div>

      <div style={S.statsRow}>
        <div style={S.stat}>
          <div style={S.statLabel}>잔고</div>
          <div style={S.statValue}>{s.balance.toFixed(0)} USDT</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>수익률</div>
          <div style={{ ...S.statValue, color: pnlColor }}>{s.pnlPct.toFixed(2)}%</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>순이익</div>
          <div style={{ ...S.statValue, color: pnlColor }}>{pf(s.totalPnl)}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>승률</div>
          <div style={S.statValue}>{s.winRate.toFixed(1)}%</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>거래수</div>
          <div style={S.statValue}>{s.historyCount}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>포지션</div>
          <div style={S.statValue}>{s.positionCount}</div>
        </div>
      </div>

      <div style={S.cardMeta}>
        <span>{cfg.scanIntervals.join('·')} · {cfg.direction === 'both' ? '양방향' : cfg.direction.toUpperCase()} · 레버{cfg.leverage}x · 리스크{cfg.riskPct}% · {cfg.minScore}점+</span>
        {exp.nextRunTime && <span>다음: {fmtTime(exp.nextRunTime)}</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button style={S.ghostBtn} onClick={() => setShowLogs(v => !v)}>
          {showLogs ? '로그 숨기기' : `로그 (${exp.logs.length})`}
        </button>
        <button style={S.ghostBtn} onClick={onResetBalance}>잔고초기화</button>
        <button style={S.ghostBtn} onClick={onClearHistory}>히스토리삭제</button>
      </div>

      {showLogs && (
        <div style={S.logBox}>
          {exp.logs.length === 0
            ? <div style={{ color: '#6f7f95' }}>로그 없음</div>
            : exp.logs.map((l, i) => (
              <div key={i} style={{ lineHeight: 1.5 }}>{l}</div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── Comparison Summary Table ─────────────────────────────────────────────────
function ComparisonTable({ experiments }: { experiments: LabExperiment[] }) {
  const active = experiments.filter(e => e.config !== null);
  if (active.length < 2) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={S.sectionTitle}>비교 요약</div>
      <table style={S.table}>
        <thead>
          <tr>
            {['이름', '전략', '잔고', '수익률', '순이익', '승률', '거래수'].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map(exp => {
            const cfg = exp.config!;
            const s = exp.stats;
            const pnlColor = s.totalPnl >= 0 ? '#0ecb81' : '#f6465d';
            return (
              <tr key={exp.slotIndex}>
                <td style={S.td}>{cfg.name}</td>
                <td style={S.td}>{cfg.strategyId === 'leader-retest' ? '리테스트' : '돌파'}</td>
                <td style={S.td}>{s.balance.toFixed(0)}</td>
                <td style={{ ...S.td, color: pnlColor }}>{s.pnlPct.toFixed(2)}%</td>
                <td style={{ ...S.td, color: pnlColor }}>{pf(s.totalPnl)}</td>
                <td style={S.td}>{s.winRate.toFixed(1)}%</td>
                <td style={S.td}>{s.historyCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────
export function StrategyLabPanel({ lab }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);

  const activeExperiments = lab.experiments.filter(e => e.config !== null);

  const handleAdd = (cfg: Omit<LabExperimentConfig, 'id'>) => {
    lab.addExperiment(cfg);
    setShowAddForm(false);
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.title}>전략 실험실</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={S.metaText}>{lab.activeCount}/{LAB_MAX_SLOTS} 슬롯 사용</span>
          {lab.canAdd && !showAddForm && (
            <button style={S.primaryBtn} onClick={() => setShowAddForm(true)}>+ 실험 추가</button>
          )}
        </div>
      </div>

      {showAddForm && (
        <AddExperimentForm
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {activeExperiments.length === 0 && !showAddForm && (
        <div style={S.empty}>
          실험이 없습니다. '+ 실험 추가' 버튼으로 전략을 테스트해보세요.<br />
          각 실험은 독립된 모의 잔고와 히스토리를 가집니다.
        </div>
      )}

      {lab.experiments.map(exp => {
        if (!exp.config) return null;
        return (
          <ExperimentCard
            key={exp.slotIndex}
            exp={exp}
            onToggle={(enabled) => lab.updateExperiment(exp.slotIndex, { enabled })}
            onRemove={() => lab.removeExperiment(exp.slotIndex)}
            onResetBalance={() => exp.paper.resetBalance(exp.config!.initialBalance)}
            onClearHistory={() => exp.paper.clearHistory()}
          />
        );
      })}

      <ComparisonTable experiments={lab.experiments} />
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  root: {
    padding: '10px 12px',
    color: '#d1d4dc',
    fontSize: '0.82rem',
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontSize: '0.88rem',
    fontWeight: 700,
    color: '#e0e6f0',
  },
  metaText: {
    fontSize: '0.76rem',
    color: '#6f7f95',
  },
  sectionTitle: {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: '#9aa4b5',
    marginBottom: 6,
  },
  empty: {
    color: '#6f7f95',
    fontSize: '0.8rem',
    lineHeight: 1.6,
    padding: '20px 0',
    textAlign: 'center',
  },
  card: {
    background: '#111826',
    border: '1px solid #2c3a53',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 8,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  cardName: {
    fontWeight: 700,
    fontSize: '0.84rem',
    color: '#e0e6f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  badge: {
    fontSize: '0.7rem',
    padding: '1px 5px',
    borderRadius: 4,
    border: '1px solid rgba(59,139,235,0.35)',
    color: '#3b8beb',
    flexShrink: 0,
  },
  statsRow: {
    display: 'flex',
    gap: 0,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  stat: {
    flex: '1 0 60px',
    padding: '4px 6px',
  },
  statLabel: {
    fontSize: '0.68rem',
    color: '#6f7f95',
    marginBottom: 2,
  },
  statValue: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#d1d4dc',
  },
  cardMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.72rem',
    color: '#6f7f95',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 4,
  },
  logBox: {
    marginTop: 8,
    background: '#0d1520',
    border: '1px solid #1e2d45',
    borderRadius: 6,
    padding: '6px 8px',
    maxHeight: 120,
    overflowY: 'auto',
    fontSize: '0.71rem',
    color: '#90a3bc',
    fontFamily: 'monospace',
  },
  form: {
    background: '#111826',
    border: '1px solid #2c3a53',
    borderRadius: 8,
    padding: '12px 14px',
    marginBottom: 10,
  },
  formTitle: {
    fontWeight: 700,
    fontSize: '0.84rem',
    marginBottom: 10,
    color: '#e0e6f0',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '6px 10px',
    alignItems: 'center',
  },
  formLabel: {
    fontSize: '0.78rem',
    color: '#9aa4b5',
    whiteSpace: 'nowrap',
  },
  input: {
    background: '#192336',
    border: '1px solid #3d4b64',
    borderRadius: 5,
    color: '#d1d4dc',
    fontSize: '0.8rem',
    padding: '4px 7px',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '0.78rem',
  },
  th: {
    textAlign: 'left' as const,
    padding: '4px 8px',
    borderBottom: '1px solid #2c3a53',
    color: '#6f7f95',
    fontWeight: 600,
  },
  td: {
    padding: '4px 8px',
    borderBottom: '1px solid #1e2d45',
    color: '#d1d4dc',
  },
  primaryBtn: {
    background: 'rgba(59,139,235,0.18)',
    border: '1px solid rgba(59,139,235,0.45)',
    color: '#8ebeff',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: '0.78rem',
    cursor: 'pointer',
    fontWeight: 600,
  },
  ghostBtn: {
    background: '#192336',
    border: '1px solid #3d4b64',
    color: '#9aa4b5',
    borderRadius: 5,
    padding: '4px 8px',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  tinyBtn: {
    borderRadius: 4,
    padding: '3px 7px',
    fontSize: '0.72rem',
    cursor: 'pointer',
  },
  tinyBtnOn: {
    background: 'rgba(14,203,129,0.12)',
    border: '1px solid rgba(14,203,129,0.35)',
    color: '#0ecb81',
  },
  tinyBtnOff: {
    background: 'rgba(246,70,93,0.08)',
    border: '1px solid rgba(246,70,93,0.3)',
    color: '#f6465d',
  },
  tinyBtnDanger: {
    background: 'transparent',
    border: '1px solid #3d4b64',
    color: '#6f7f95',
    borderRadius: 4,
    padding: '3px 7px',
    fontSize: '0.72rem',
    cursor: 'pointer',
  },
  segBtn: {
    border: '1px solid #3d4b64',
    background: '#192336',
    color: '#9aa4b5',
    borderRadius: 4,
    padding: '3px 7px',
    fontSize: '0.74rem',
    cursor: 'pointer',
  },
  segBtnOn: {
    border: '1px solid rgba(59,139,235,0.5)',
    color: '#8ebeff',
    background: 'rgba(59,139,235,0.14)',
  },
};
