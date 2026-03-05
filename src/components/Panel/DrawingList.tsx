import React, { useState, useEffect, useRef } from 'react';
import type { Drawing, TrendlineDrawing, BoxDrawing, HlineDrawing } from '../../types/drawing';
import { DRAWING_COLORS } from '../../types/drawing';
import { formatPrice } from '../../utils/priceFormat';

interface Props {
  drawings: Drawing[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateMemo: (id: string, memo: string) => void;
  onUpdateColor: (id: string, color: string) => void;
  onUpdateActive: (id: string, active: boolean) => void;
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

function CoordTable({ rows }: { rows: { label: string; time?: number; price: number }[] }) {
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}></th>
          <th style={styles.th}>시간</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>가격</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label}>
            <td style={styles.tdLabel}>{row.label}</td>
            <td style={styles.tdTime}>{row.time ? formatTs(row.time) : '—'}</td>
            <td style={styles.tdPrice}>{formatPrice(row.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MemoTextarea({ memo, onUpdateMemo }: { memo?: string; onUpdateMemo: (v: string) => void }) {
  const [localMemo, setLocalMemo] = useState(memo ?? '');
  const isComposingRef = useRef(false);

  // sync from parent only when not composing (e.g. external reset)
  useEffect(() => {
    if (!isComposingRef.current) {
      setLocalMemo(memo ?? '');
    }
  }, [memo]);

  return (
    <textarea
      style={styles.memoInput}
      placeholder="메모 입력..."
      value={localMemo}
      rows={2}
      onClick={e => e.stopPropagation()}
      onChange={e => {
        const val = e.target.value;
        setLocalMemo(val);
        if (!isComposingRef.current) onUpdateMemo(val);
      }}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={e => {
        isComposingRef.current = false;
        const val = (e.target as HTMLTextAreaElement).value;
        setLocalMemo(val);
        onUpdateMemo(val);
      }}
    />
  );
}

function MonitorToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      style={{
        ...styles.monitorBtn,
        color:       active ? '#0ecb81' : '#4a5568',
        borderColor: active ? '#0ecb8144' : '#1a2030',
        background:  active ? 'rgba(14,203,129,0.08)' : 'none',
      }}
      title={active ? '감시 활성 — 클릭하여 비활성화' : '감시 비활성 — 클릭하여 활성화'}
      onClick={e => { e.stopPropagation(); onToggle(); }}
    >
      {active ? '● 감시' : '○ 감시'}
    </button>
  );
}

function ColorSwatches({ current, onChange }: { current?: string; onChange: (c: string) => void }) {
  return (
    <div style={styles.colorRow} onClick={e => e.stopPropagation()}>
      {DRAWING_COLORS.map(c => (
        <button
          key={c}
          title={c}
          style={{
            ...styles.colorDot,
            background: c,
            boxShadow: (current ?? DRAWING_COLORS[0]) === c
              ? `0 0 0 2px #0d1520, 0 0 0 3px ${c}`
              : 'none',
            transform: (current ?? DRAWING_COLORS[0]) === c ? 'scale(1.3)' : 'scale(1)',
          }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function TrendlineCard({ d, selected, onSelect, onDelete, onUpdateMemo, onUpdateColor, onUpdateActive }: {
  d: TrendlineDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateMemo: (memo: string) => void;
  onUpdateColor: (color: string) => void;
  onUpdateActive: (active: boolean) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const activeColor = d.color ?? '#3b8beb';
  const isMonitored = d.active !== false;
  const json = JSON.stringify({ type: d.type, ticker: d.ticker, p1: d.p1, p2: d.p2, slope: d.slope }, null, 2);

  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>╱ 추세선</span>
        <MonitorToggle active={isMonitored} onToggle={() => onUpdateActive(!isMonitored)} />
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>

      <ColorSwatches current={d.color} onChange={onUpdateColor} />

      <CoordTable rows={[
        { label: 'P1', time: d.p1.time, price: d.p1.price },
        { label: 'P2', time: d.p2.time, price: d.p2.price },
      ]} />

      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>기울기</span>
        <span style={styles.metaValue}>{d.slope.toExponential(4)}</span>
      </div>

      <div style={styles.memoWrap} onClick={e => e.stopPropagation()}>
        <MemoTextarea memo={d.memo} onUpdateMemo={onUpdateMemo} />
      </div>

      <button style={styles.jsonBtn} onClick={e => { e.stopPropagation(); setShowJson(v => !v); }}>
        {showJson ? '▲ JSON 숨기기' : '▼ JSON 보기'}
      </button>
      {showJson && <pre style={styles.jsonBlock}>{json}</pre>}
    </div>
  );
}

function BoxCard({ d, selected, onSelect, onDelete, onUpdateMemo, onUpdateColor, onUpdateActive }: {
  d: BoxDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateMemo: (memo: string) => void;
  onUpdateColor: (color: string) => void;
  onUpdateActive: (active: boolean) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const activeColor = d.color ?? '#e8b73a';
  const isMonitored = d.active !== false;
  const json = JSON.stringify({ type: d.type, ticker: d.ticker, corners: d.corners, topPrice: d.topPrice, bottomPrice: d.bottomPrice }, null, 2);

  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>□ 박스</span>
        <MonitorToggle active={isMonitored} onToggle={() => onUpdateActive(!isMonitored)} />
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>

      <ColorSwatches current={d.color} onChange={onUpdateColor} />

      <CoordTable rows={[
        { label: 'P1', time: d.p1.time, price: d.p1.price },
        { label: 'P2', time: d.p2.time, price: d.p2.price },
      ]} />

      <div style={styles.separator} />

      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>상단</span>
        <span style={{ ...styles.metaValue, color: '#0ecb81' }}>{formatPrice(d.topPrice)}</span>
      </div>
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>하단</span>
        <span style={{ ...styles.metaValue, color: '#f6465d' }}>{formatPrice(d.bottomPrice)}</span>
      </div>
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>범위</span>
        <span style={styles.metaValue}>{formatPrice(d.topPrice - d.bottomPrice)}</span>
      </div>

      <div style={styles.memoWrap} onClick={e => e.stopPropagation()}>
        <MemoTextarea memo={d.memo} onUpdateMemo={onUpdateMemo} />
      </div>

      <button style={styles.jsonBtn} onClick={e => { e.stopPropagation(); setShowJson(v => !v); }}>
        {showJson ? '▲ JSON 숨기기' : '▼ JSON 보기'}
      </button>
      {showJson && <pre style={styles.jsonBlock}>{json}</pre>}
    </div>
  );
}

function HlineCard({ d, selected, onSelect, onDelete, onUpdateMemo, onUpdateColor, onUpdateActive }: {
  d: HlineDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateMemo: (memo: string) => void;
  onUpdateColor: (color: string) => void;
  onUpdateActive: (active: boolean) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const activeColor = d.color ?? '#0ecb81';
  const isMonitored = d.active !== false;
  const json = JSON.stringify({ type: d.type, ticker: d.ticker, price: d.price }, null, 2);

  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>— 수평선</span>
        <MonitorToggle active={isMonitored} onToggle={() => onUpdateActive(!isMonitored)} />
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>

      <ColorSwatches current={d.color} onChange={onUpdateColor} />

      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>가격</span>
        <span style={{ ...styles.metaValue, color: activeColor }}>{formatPrice(d.price)}</span>
      </div>

      <div style={styles.memoWrap} onClick={e => e.stopPropagation()}>
        <MemoTextarea memo={d.memo} onUpdateMemo={onUpdateMemo} />
      </div>

      <button style={styles.jsonBtn} onClick={e => { e.stopPropagation(); setShowJson(v => !v); }}>
        {showJson ? '▲ JSON 숨기기' : '▼ JSON 보기'}
      </button>
      {showJson && <pre style={styles.jsonBlock}>{json}</pre>}
    </div>
  );
}

export function DrawingList({ drawings, selectedId, onSelect, onDelete, onUpdateMemo, onUpdateColor, onUpdateActive }: Props) {
  return (
    <div style={styles.container}>
      {drawings.length === 0 && (
        <div style={styles.empty}>
          <p style={{ margin: '0 0 6px' }}>그려진 도형 없음</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#2a3548' }}>
            툴바에서 추세선 또는 박스를<br />선택하고 차트에 그려보세요
          </p>
        </div>
      )}
      {drawings.map(d => {
        const commonProps = {
          key: d.id,
          selected: selectedId === d.id,
          onSelect: () => onSelect(d.id),
          onDelete: () => onDelete(d.id),
          onUpdateMemo: (memo: string) => onUpdateMemo(d.id, memo),
          onUpdateColor: (color: string) => onUpdateColor(d.id, color),
          onUpdateActive: (active: boolean) => onUpdateActive(d.id, active),
        };
        if (d.type === 'trendline') return <TrendlineCard {...commonProps} d={d} />;
        if (d.type === 'box')       return <BoxCard       {...commonProps} d={d as BoxDrawing} />;
        if (d.type === 'hline')     return <HlineCard     {...commonProps} d={d as HlineDrawing} />;
        return null;
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 8,
    overflowY: 'auto',
    flex: 1,
  },
  empty: {
    color: '#4a5568',
    fontSize: '0.92rem',
    textAlign: 'center',
    padding: '32px 16px',
    lineHeight: 1.6,
  },
  card: {
    background: '#0d1520',
    border: '1px solid #1a2030',
    borderRadius: 6,
    padding: '10px 10px 8px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  cardSelected: {
    borderColor: '#3b8beb',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badge: {
    fontSize: '0.77rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    padding: '2px 7px',
    borderRadius: 3,
  },
  delBtn: {
    background: 'none',
    border: 'none',
    color: '#4a5568',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: '0 2px',
    lineHeight: 1,
    transition: 'color 0.1s',
  },
  // ── Coordinate table ──────────────────────────────────────────────
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: 8,
  } as React.CSSProperties,
  th: {
    color: '#3a4558',
    fontSize: '0.77rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '2px 4px 4px',
    textAlign: 'left',
    borderBottom: '1px solid #1a2030',
  } as React.CSSProperties,
  tdLabel: {
    color: '#848e9c',
    fontSize: '0.85rem',
    fontWeight: 700,
    padding: '4px 4px',
    width: 24,
    fontFamily: '"SF Mono", Consolas, monospace',
  } as React.CSSProperties,
  tdTime: {
    color: '#4a5568',
    fontSize: '0.77rem',
    padding: '4px 4px',
    fontFamily: '"SF Mono", Consolas, monospace',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  tdPrice: {
    color: '#d1d4dc',
    fontSize: '0.85rem',
    padding: '4px 4px',
    fontFamily: '"SF Mono", Consolas, monospace',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  // ── Meta rows ─────────────────────────────────────────────────────
  separator: {
    height: 1,
    background: '#1a2030',
    margin: '6px 0',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '2px 4px',
    marginBottom: 2,
  },
  metaLabel: {
    color: '#3a4558',
    fontSize: '0.77rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  metaValue: {
    color: '#848e9c',
    fontSize: '0.85rem',
    fontFamily: '"SF Mono", Consolas, monospace',
  },
  colorRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    marginBottom: 8,
    padding: '0 2px',
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    transition: 'transform 0.1s, box-shadow 0.1s',
  } as React.CSSProperties,
  memoWrap: {
    marginTop: 8,
    marginBottom: 2,
  },
  memoInput: {
    width: '100%',
    background: '#080b12',
    border: '1px solid #1a2030',
    borderRadius: 4,
    color: '#d1d4dc',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    padding: '5px 7px',
    resize: 'vertical' as const,
    outline: 'none',
    boxSizing: 'border-box' as const,
    lineHeight: 1.5,
  },
  monitorBtn: {
    background: 'none',
    border: '1px solid #1a2030',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: '0.72rem',
    fontWeight: 700,
    padding: '2px 7px',
    lineHeight: 1,
    transition: 'all 0.15s',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  } as React.CSSProperties,
  jsonBtn: {
    background: 'none',
    border: '1px solid #1a2030',
    borderRadius: 3,
    color: '#3a4558',
    cursor: 'pointer',
    fontSize: '0.77rem',
    padding: '3px 8px',
    width: '100%',
    textAlign: 'left',
    marginTop: 6,
    transition: 'color 0.1s, border-color 0.1s',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  jsonBlock: {
    marginTop: 8,
    padding: 8,
    background: '#080b12',
    border: '1px solid #1a2030',
    borderRadius: 4,
    color: '#6abde8',
    fontSize: '0.77rem',
    fontFamily: '"SF Mono", "Cascadia Code", Consolas, monospace',
    overflowX: 'auto',
    whiteSpace: 'pre',
    lineHeight: 1.5,
  } as React.CSSProperties,
};
