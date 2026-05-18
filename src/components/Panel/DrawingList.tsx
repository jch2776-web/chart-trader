import React, { useState, useEffect, useRef } from 'react';
import type { Drawing, TrendlineDrawing, BoxDrawing, HlineDrawing, FibRetracementDrawing, PriceRangeDrawing, DateRangeDrawing, ParallelChannelDrawing, TextDrawing, LabelDrawing, XabcdDrawing, BrushDrawing } from '../../types/drawing';
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
  onUpdateText?: (id: string, text: string, fontSize?: number) => void;
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

function formatDur(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function FibCard({ d, selected, onSelect, onDelete, onUpdateMemo, onUpdateColor }: {
  d: FibRetracementDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateMemo: (memo: string) => void;
  onUpdateColor: (color: string) => void;
}) {
  const activeColor = d.color ?? '#e8b73a';
  const range = Math.abs(d.p2.price - d.p1.price);
  const pct = d.p1.price > 0 ? (range / d.p1.price * 100).toFixed(2) : '—';
  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>⟨⟩ 피보나치</span>
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>
      <ColorSwatches current={d.color} onChange={onUpdateColor} />
      <CoordTable rows={[
        { label: 'P1', time: d.p1.time, price: d.p1.price },
        { label: 'P2', time: d.p2.time, price: d.p2.price },
      ]} />
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>범위</span>
        <span style={styles.metaValue}>{formatPrice(range)} ({pct}%)</span>
      </div>
      <div style={styles.memoWrap} onClick={e => e.stopPropagation()}>
        <MemoTextarea memo={d.memo} onUpdateMemo={onUpdateMemo} />
      </div>
    </div>
  );
}

function PriceRangeCard({ d, selected, onSelect, onDelete, onUpdateMemo, onUpdateColor }: {
  d: PriceRangeDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateMemo: (memo: string) => void;
  onUpdateColor: (color: string) => void;
}) {
  const activeColor = d.color ?? '#22d3ee';
  const diff = d.p2.price - d.p1.price;  // signed: negative = down, positive = up
  const pct  = d.p1.price > 0 ? (diff / d.p1.price * 100) : 0;
  const sign = diff >= 0 ? '+' : '';
  const diffColor = diff >= 0 ? '#0ecb81' : '#f6465d';
  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>↕ 가격범위</span>
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>
      <ColorSwatches current={d.color} onChange={onUpdateColor} />
      <CoordTable rows={[
        { label: 'P1', time: d.p1.time, price: d.p1.price },
        { label: 'P2', time: d.p2.time, price: d.p2.price },
      ]} />
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>범위</span>
        <span style={{ ...styles.metaValue, color: diffColor }}>{sign}{formatPrice(diff)} ({sign}{pct.toFixed(2)}%)</span>
      </div>
      <div style={styles.memoWrap} onClick={e => e.stopPropagation()}>
        <MemoTextarea memo={d.memo} onUpdateMemo={onUpdateMemo} />
      </div>
    </div>
  );
}

function DateRangeCard({ d, selected, onSelect, onDelete, onUpdateMemo, onUpdateColor }: {
  d: DateRangeDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateMemo: (memo: string) => void;
  onUpdateColor: (color: string) => void;
}) {
  const activeColor = d.color ?? '#a855f7';
  const durationMs = Math.abs(d.p2.time - d.p1.time);
  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>↔ 기간범위</span>
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>
      <ColorSwatches current={d.color} onChange={onUpdateColor} />
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>시작</span>
        <span style={styles.metaValue}>{formatTs(Math.min(d.p1.time, d.p2.time))}</span>
      </div>
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>종료</span>
        <span style={styles.metaValue}>{formatTs(Math.max(d.p1.time, d.p2.time))}</span>
      </div>
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>기간</span>
        <span style={{ ...styles.metaValue, color: activeColor }}>{formatDur(durationMs)}</span>
      </div>
      <div style={styles.memoWrap} onClick={e => e.stopPropagation()}>
        <MemoTextarea memo={d.memo} onUpdateMemo={onUpdateMemo} />
      </div>
    </div>
  );
}

function ChannelCard({ d, selected, onSelect, onDelete, onUpdateMemo, onUpdateColor, onUpdateActive }: {
  d: ParallelChannelDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateMemo: (memo: string) => void;
  onUpdateColor: (color: string) => void;
  onUpdateActive: (active: boolean) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const activeColor = d.color ?? '#22d3ee';
  const isMonitored = d.active !== false;
  const json = JSON.stringify({ type: d.type, ticker: d.ticker, p1: d.p1, p2: d.p2, p3: d.p3, slope: d.slope, offset: d.offset }, null, 2);

  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>⫿ 평행채널</span>
        <MonitorToggle active={isMonitored} onToggle={() => onUpdateActive(!isMonitored)} />
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>

      <ColorSwatches current={d.color} onChange={onUpdateColor} />

      <CoordTable rows={[
        { label: 'P1', time: d.p1.time, price: d.p1.price },
        { label: 'P2', time: d.p2.time, price: d.p2.price },
        { label: 'P3', time: d.p3.time, price: d.p3.price },
      ]} />

      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>기울기</span>
        <span style={styles.metaValue}>{d.slope.toExponential(4)}</span>
      </div>
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>채널폭</span>
        <span style={styles.metaValue}>{formatPrice(Math.abs(d.offset))}</span>
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

function TextEditArea({ text, fontSize, onChange }: {
  text: string; fontSize?: number;
  onChange: (text: string, fontSize?: number) => void;
}) {
  const [localText, setLocalText] = useState(text);
  const [localSize, setLocalSize] = useState(fontSize ?? 13);
  const isComposingRef = useRef(false);

  useEffect(() => { if (!isComposingRef.current) setLocalText(text); }, [text]);
  useEffect(() => { setLocalSize(fontSize ?? 13); }, [fontSize]);

  return (
    <div onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={styles.metaLabel}>크기</span>
        <input
          type="number"
          min={8}
          max={72}
          step={1}
          value={localSize}
          style={{ ...styles.fontSizeInput }}
          onChange={e => {
            const sz = Math.max(8, Math.min(72, Number(e.target.value) || 13));
            setLocalSize(sz);
            onChange(localText, sz);
          }}
          onBlur={e => {
            const sz = Math.max(8, Math.min(72, Number(e.target.value) || 13));
            setLocalSize(sz);
            onChange(localText, sz);
          }}
        />
        <span style={{ ...styles.metaLabel, flexShrink: 0 }}>px</span>
      </div>
      <textarea
        style={styles.memoInput}
        placeholder="텍스트 입력..."
        value={localText}
        rows={2}
        onChange={e => {
          const val = e.target.value;
          setLocalText(val);
          if (!isComposingRef.current) onChange(val, localSize);
        }}
        onCompositionStart={() => { isComposingRef.current = true; }}
        onCompositionEnd={e => {
          isComposingRef.current = false;
          const val = (e.target as HTMLTextAreaElement).value;
          setLocalText(val);
          onChange(val, localSize);
        }}
      />
    </div>
  );
}

function TextCard({ d, selected, onSelect, onDelete, onUpdateColor, onUpdateText }: {
  d: TextDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateColor: (color: string) => void;
  onUpdateText?: (text: string, fontSize?: number) => void;
}) {
  const activeColor = d.color ?? '#d1d4dc';
  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>T 텍스트</span>
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>
      <ColorSwatches current={d.color} onChange={onUpdateColor} />
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>위치</span>
        <span style={styles.metaValue}>{formatTs(d.p.time)}</span>
      </div>
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>가격</span>
        <span style={styles.metaValue}>{formatPrice(d.p.price)}</span>
      </div>
      <div style={styles.memoWrap} onClick={e => e.stopPropagation()}>
        <TextEditArea text={d.text} fontSize={d.fontSize} onChange={(t, sz) => onUpdateText?.(t, sz)} />
      </div>
    </div>
  );
}

function LabelCard({ d, selected, onSelect, onDelete, onUpdateColor, onUpdateText }: {
  d: LabelDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateColor: (color: string) => void;
  onUpdateText?: (text: string, fontSize?: number) => void;
}) {
  const activeColor = d.color ?? '#e8b73a';
  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>▭ 레이블</span>
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>
      <ColorSwatches current={d.color} onChange={onUpdateColor} />
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>상단</span>
        <span style={{ ...styles.metaValue, color: '#0ecb81' }}>{formatPrice(d.topPrice)}</span>
      </div>
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>하단</span>
        <span style={{ ...styles.metaValue, color: '#f6465d' }}>{formatPrice(d.bottomPrice)}</span>
      </div>
      <div style={styles.memoWrap} onClick={e => e.stopPropagation()}>
        <TextEditArea text={d.text} fontSize={d.fontSize} onChange={(t, sz) => onUpdateText?.(t, sz)} />
      </div>
    </div>
  );
}

function XabcdCard({ d, selected, onSelect, onDelete, onUpdateColor }: {
  d: XabcdDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateColor: (color: string) => void;
}) {
  const activeColor = d.color ?? '#e8b73a';
  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>⛛ XABCD</span>
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>
      <ColorSwatches current={d.color} onChange={onUpdateColor} />
      {([['X', d.px], ['A', d.pa], ['B', d.pb], ['C', d.pc], ['D', d.pd]] as [string, import('../../types/drawing').Point][]).map(([label, pt]) => (
        <div key={label} style={styles.metaRow}>
          <span style={{ ...styles.metaLabel, fontWeight: 700, color: activeColor }}>{label}</span>
          <span style={styles.metaValue}>{formatPrice(pt.price)}</span>
        </div>
      ))}
    </div>
  );
}

function BrushCard({ d, selected, onSelect, onDelete, onUpdateColor }: {
  d: BrushDrawing; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onUpdateColor: (color: string) => void;
}) {
  const activeColor = d.color ?? '#c084fc';
  const lw = d.lineWidth ?? 8;
  return (
    <div style={{ ...styles.card, ...(selected ? { ...styles.cardSelected, borderColor: activeColor } : {}) }} onClick={onSelect}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.badge, background: `${activeColor}22`, color: activeColor }}>✏ 브러쉬</span>
        <button style={styles.delBtn} onClick={e => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>
      <ColorSwatches current={d.color} onChange={onUpdateColor} />
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>두께</span>
        <span style={styles.metaValue}>{lw}px</span>
      </div>
      <div style={styles.metaRow}>
        <span style={styles.metaLabel}>포인트</span>
        <span style={styles.metaValue}>{d.points.length}개</span>
      </div>
    </div>
  );
}

export function DrawingList({ drawings, selectedId, onSelect, onDelete, onUpdateMemo, onUpdateColor, onUpdateActive, onUpdateText }: Props) {
  return (
    <div style={styles.container}>
      {drawings.length === 0 && (
        <div style={styles.empty}>
          <p style={{ margin: '0 0 6px' }}>그려진 도형 없음</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#2a3548' }}>
            툴바에서 추세선, 평행채널 또는 박스를<br />선택하고 차트에 그려보세요
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
        if (d.type === 'trendline')  return <TrendlineCard  {...commonProps} d={d} />;
        if (d.type === 'box')        return <BoxCard        {...commonProps} d={d as BoxDrawing} />;
        if (d.type === 'hline')      return <HlineCard      {...commonProps} d={d as HlineDrawing} />;
        if (d.type === 'fib')        return <FibCard        {...{ ...commonProps, onUpdateActive: undefined }} d={d as FibRetracementDrawing} />;
        if (d.type === 'pricerange') return <PriceRangeCard {...{ ...commonProps, onUpdateActive: undefined }} d={d as PriceRangeDrawing} />;
        if (d.type === 'daterange')  return <DateRangeCard  {...{ ...commonProps, onUpdateActive: undefined }} d={d as DateRangeDrawing} />;
        if (d.type === 'channel')    return <ChannelCard    {...commonProps} d={d as ParallelChannelDrawing} />;
        if (d.type === 'text')       return <TextCard key={d.id} selected={selectedId === d.id} onSelect={() => onSelect(d.id)} onDelete={() => onDelete(d.id)} onUpdateColor={(c) => onUpdateColor(d.id, c)} onUpdateText={(t, sz) => onUpdateText?.(d.id, t, sz)} d={d as TextDrawing} />;
        if (d.type === 'label')      return <LabelCard key={d.id} selected={selectedId === d.id} onSelect={() => onSelect(d.id)} onDelete={() => onDelete(d.id)} onUpdateColor={(c) => onUpdateColor(d.id, c)} onUpdateText={(t, sz) => onUpdateText?.(d.id, t, sz)} d={d as LabelDrawing} />;
        if (d.type === 'xabcd')      return <XabcdCard key={d.id} selected={selectedId === d.id} onSelect={() => onSelect(d.id)} onDelete={() => onDelete(d.id)} onUpdateColor={(c) => onUpdateColor(d.id, c)} d={d as XabcdDrawing} />;
        if (d.type === 'brush')      return <BrushCard key={d.id} selected={selectedId === d.id} onSelect={() => onSelect(d.id)} onDelete={() => onDelete(d.id)} onUpdateColor={(c) => onUpdateColor(d.id, c)} d={d as BrushDrawing} />;
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
  fontSizeInput: {
    background: '#080b12',
    border: '1px solid #1a2030',
    borderRadius: 3,
    color: '#d1d4dc',
    fontSize: '0.85rem',
    padding: '2px 4px',
    fontFamily: '"SF Mono", Consolas, monospace',
    width: 48,
    outline: 'none',
    textAlign: 'right' as const,
  } as React.CSSProperties,
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
