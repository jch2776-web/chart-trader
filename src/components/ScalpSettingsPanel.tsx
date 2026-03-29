/**
 * ScalpSettingsPanel — settings modal for the scalp auto-trade module.
 * Style matches AutoTradeSettingsModal. Completely separate from alt-auto settings.
 */

import { useState } from 'react';
import type { ScalpSettings } from '../scalp/scalpSettings';
import { DEFAULT_SCALP_SETTINGS } from '../scalp/scalpSettings';

// ── Popular futures symbols for the picker ────────────────────────────────────

const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
  'LTCUSDT', 'LINKUSDT', 'ATOMUSDT', 'NEARUSDT', 'AAVEUSDT',
  'UNIUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT',
  'PEPEUSDT', 'WIFUSDT', 'TONUSDT', 'TRUMPUSDT', 'SHIBUSDT',
];

// ── Styles (matches AutoTradeSettingsModal) ───────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 10,
    width: 'min(520px, 96vw)', display: 'flex', flexDirection: 'column',
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
    maxHeight: '92vh',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid #2a2e39', flexShrink: 0,
  },
  title: { color: '#d1d4dc', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 },
  badge: {
    background: '#f0b90b22', border: '1px solid #f0b90b55', color: '#f0b90b',
    borderRadius: 4, padding: '1px 7px', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.03em',
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#5e6673', cursor: 'pointer',
    fontSize: '1rem', padding: '4px 8px', borderRadius: 4,
  },
  modeBar: {
    display: 'flex', borderBottom: '1px solid #2a2e39', flexShrink: 0,
  },
  modeBtn: {
    flex: 1, background: 'none', border: 'none', cursor: 'pointer',
    padding: '10px 0', fontSize: '0.85rem', fontWeight: 600,
    color: '#5e6673', fontFamily: 'inherit', transition: 'all 0.15s',
  },
  modeBtnPaper: { color: '#0ecb81', borderBottom: '2px solid #0ecb81', background: 'rgba(14,203,129,0.05)' },
  modeBtnLive:  { color: '#f6465d', borderBottom: '2px solid #f6465d', background: 'rgba(246,70,93,0.05)'  },
  body: {
    padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16,
    overflowY: 'auto', flex: 1,
  },
  section: {
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  sectionTitle: {
    fontSize: '0.72rem', fontWeight: 700, color: '#5e6673',
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  fieldRow: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { color: '#848e9c', fontSize: '0.8rem', fontWeight: 600 },
  hint: { color: '#3a4558', fontSize: '0.74rem' },
  numberInput: {
    background: '#12151e', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#d1d4dc', fontSize: '0.92rem', padding: '6px 10px',
    width: 100, fontFamily: '"SF Mono", Consolas, monospace', outline: 'none',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  unit: { color: '#5e6673', fontSize: '0.85rem' },
  select: {
    background: '#12151e', border: '1px solid #2a2e39', borderRadius: 5,
    color: '#d1d4dc', fontSize: '0.85rem', padding: '6px 10px',
    outline: 'none', cursor: 'pointer',
  },
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
  divider: { height: 1, background: '#2a2e39', margin: '0 -20px' },
  footer: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 20px', borderTop: '1px solid #2a2e39', flexShrink: 0,
    background: '#1a1e28',
  },
  btnSave: {
    background: '#0ecb81', border: 'none', borderRadius: 6,
    color: '#0d1117', fontWeight: 700, fontSize: '0.88rem',
    padding: '7px 22px', cursor: 'pointer',
  },
  btnReset: {
    background: '#12151e', border: '1px solid #2a2e39', borderRadius: 6,
    color: '#848e9c', fontSize: '0.8rem', padding: '7px 14px', cursor: 'pointer',
  },
  btnCancel: {
    background: 'none', border: '1px solid #2a2e39', borderRadius: 6,
    color: '#5e6673', fontSize: '0.8rem', padding: '7px 14px', cursor: 'pointer',
  },
};

// ── Symbol picker ─────────────────────────────────────────────────────────────

function SymbolPicker({ symbols, onChange }: {
  symbols: string[];
  onChange: (s: string[]) => void;
}) {
  const [customInput, setCustomInput] = useState('');

  const toggle = (sym: string) => {
    onChange(
      symbols.includes(sym)
        ? symbols.filter(s => s !== sym)
        : [...symbols, sym],
    );
  };

  const addCustom = () => {
    const sym = customInput.trim().toUpperCase();
    if (sym && !symbols.includes(sym)) onChange([...symbols, sym]);
    setCustomInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Selected symbols */}
      {symbols.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {symbols.map(sym => (
            <span
              key={sym}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'rgba(14,203,129,0.12)', border: '1px solid rgba(14,203,129,0.4)',
                borderRadius: 4, padding: '2px 8px',
                color: '#0ecb81', fontSize: '0.78rem', fontWeight: 600,
                fontFamily: '"SF Mono", Consolas, monospace',
              }}
            >
              {sym}
              <button
                onClick={() => toggle(sym)}
                style={{ background: 'none', border: 'none', color: '#0ecb81', cursor: 'pointer', padding: '0 1px', lineHeight: 1, fontSize: '0.9rem' }}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* Popular symbols grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {POPULAR_SYMBOLS.map(sym => {
          const active = symbols.includes(sym);
          return (
            <button
              key={sym}
              onClick={() => toggle(sym)}
              style={{
                ...(active
                  ? { ...s.toggleChip, borderColor: 'rgba(14,203,129,0.55)', color: '#0ecb81', background: 'rgba(14,203,129,0.1)' }
                  : s.toggleChip),
                fontSize: '0.72rem', padding: '3px 8px',
              }}
            >
              {sym.replace('USDT', '')}
            </button>
          );
        })}
      </div>

      {/* Custom input */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          style={{ ...s.numberInput, width: '100%', maxWidth: 180, fontSize: '0.82rem' }}
          placeholder="커스텀 심볼 (예: BTCUSDT)"
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustom(); }}
        />
        <button
          onClick={addCustom}
          style={{ ...s.toggleChip, padding: '6px 14px', flexShrink: 0 }}
        >
          + 추가
        </button>
      </div>
    </div>
  );
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function NumField({ label, hint, value, onChange, min, max, step, unit }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div style={s.fieldRow}>
      <label style={s.label}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="number"
          style={s.numberInput}
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
        />
        {unit && <span style={s.unit}>{unit}</span>}
      </div>
      {hint && <div style={s.hint}>{hint}</div>}
    </div>
  );
}

function SelectField<T extends string>({ label, hint, value, options, onChange }: {
  label: string; hint?: string; value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={s.fieldRow}>
      <label style={s.label}>{label}</label>
      <select
        style={s.select}
        value={value}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <div style={s.hint}>{hint}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  settings: ScalpSettings;
  mode: 'paper' | 'live';
  onSave: (s: ScalpSettings) => void;
  onModeChange: (mode: 'paper' | 'live') => void;
  onClose: () => void;
  isActive: boolean;
  onToggleActive: (active: boolean) => void;
  /** True when the live user-data WebSocket stream is connected. */
  streamConnected?: boolean;
  /** Timestamp of last market data tick (null = no data yet). */
  lastMarketTickAt?: number | null;
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
  settings, mode, onSave, onModeChange, onClose,
  isActive, onToggleActive,
  streamConnected, lastMarketTickAt, sessionStats, activeOrderCount, onResetBreaker,
}: Props) {
  const [draft, setDraft] = useState<ScalpSettings>({ ...settings });
  const isLive = mode === 'live';

  function set<K extends keyof ScalpSettings>(key: K, value: ScalpSettings[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() { onSave(draft); onClose(); }
  function handleReset() { setDraft({ ...DEFAULT_SCALP_SETTINGS }); }

  // Data feed age indicator
  const now = Date.now();
  const tickAgeMs = isActive && lastMarketTickAt ? now - lastMarketTickAt : null;
  const dataLabel = !isActive
    ? '—'
    : tickAgeMs === null
      ? '대기 중…'
      : tickAgeMs < 1000
        ? '● 실시간'
        : tickAgeMs < 5000
          ? `${(tickAgeMs / 1000).toFixed(1)}초 전`
          : `⚠ ${(tickAgeMs / 1000).toFixed(0)}초 전 (지연)`;
  const dataColor = !isActive ? '#3a4558' : tickAgeMs === null ? '#5e6673' : tickAgeMs < 2000 ? '#0ecb81' : '#f6465d';

  return (
    <div style={s.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>

        {/* Header */}
        <div style={{ ...s.header, background: isLive ? 'rgba(246,70,93,0.06)' : 'rgba(14,203,129,0.05)' }}>
          <div style={s.title}>
            <span>⚡ 스캘핑 자동매매</span>
            <span style={s.badge}>SCALP</span>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Paper / Live mode selector */}
        <div style={s.modeBar}>
          <button
            style={{ ...s.modeBtn, ...(mode === 'paper' ? s.modeBtnPaper : {}) }}
            onClick={() => !isActive && onModeChange('paper')}
            title={isActive ? '실행 중에는 모드 변경 불가' : '페이퍼 모드 (모의)'}
          >
            📄 페이퍼 (모의)
          </button>
          <button
            style={{ ...s.modeBtn, ...(mode === 'live' ? s.modeBtnLive : {}) }}
            onClick={() => !isActive && onModeChange('live')}
            title={isActive ? '실행 중에는 모드 변경 불가' : '실전 모드 (실제 주문)'}
          >
            ⚡ 실전 (Live)
          </button>
        </div>

        <div style={s.body}>

          {/* ── Session control ─────────────────────────────────────── */}
          <div style={{
            background: isLive ? 'rgba(246,70,93,0.05)' : 'rgba(14,203,129,0.04)',
            border: `1px solid ${isLive ? 'rgba(246,70,93,0.15)' : 'rgba(14,203,129,0.12)'}`,
            borderRadius: 8, padding: '12px 14px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          }}>
            <div>
              <div style={{ fontWeight: 700, color: '#d1d4dc', fontSize: '0.88rem', marginBottom: 3 }}>
                스캘핑 세션 {isLive ? '(실전)' : '(페이퍼)'}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#5e6673', lineHeight: 1.5 }}>
                {isActive
                  ? '실행 중 — 설정 저장 후 다음 세션에 적용됩니다'
                  : '정지됨 — 저장 후 아래 버튼 또는 툴바에서 시작'}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#3a4558', marginTop: 2 }}>
                이 패널은 상세 설정 / 상태 확인용입니다. 시작/정지는 툴바 버튼에서도 가능합니다.
              </div>
            </div>
            <button
              style={{
                background: isActive ? 'rgba(246,70,93,0.15)' : isLive ? 'rgba(246,70,93,0.12)' : 'rgba(14,203,129,0.12)',
                border: `1px solid ${isActive ? '#f6465d66' : isLive ? '#f6465d44' : '#0ecb8144'}`,
                borderRadius: 6, color: isActive ? '#f6465d' : isLive ? '#f6465d' : '#0ecb81',
                fontWeight: 700, fontSize: '0.88rem', padding: '8px 18px', cursor: 'pointer', flexShrink: 0,
              }}
              onClick={() => onToggleActive(!isActive)}
            >
              {isActive ? '⏹ 정지' : '▶ 시작'}
            </button>
          </div>

          {/* ── Live session status (active only) ──────────────────── */}
          {isActive && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8, background: '#12151e', border: '1px solid #2a2e39',
              borderRadius: 8, padding: '10px 12px',
            }}>
              <StatusCell
                label="마켓 데이터"
                value={dataLabel}
                valueColor={dataColor}
              />
              <StatusCell
                label={mode === 'live' ? '유저 스트림' : '브로커'}
                value={mode === 'live'
                  ? (streamConnected ? '● 연결됨' : '○ 재연결 중')
                  : 'PAPER'}
                valueColor={mode === 'live' ? (streamConnected ? '#0ecb81' : '#f6465d') : '#0ecb81'}
              />
              <StatusCell label="활성 주문" value={String(activeOrderCount ?? 0)} />
              <StatusCell label="세션 진입" value={String(sessionStats?.sessionTrades ?? 0)} />
              <StatusCell
                label="노출 (USD)"
                value={`$${(sessionStats?.exposureUsd ?? 0).toFixed(1)}`}
                valueColor={(sessionStats?.exposureUsd ?? 0) > 0 ? '#f0b90b' : undefined}
              />
              <StatusCell
                label="연속 손실"
                value={String(sessionStats?.consecutiveLosses ?? 0)}
                valueColor={(sessionStats?.consecutiveLosses ?? 0) > 0 ? '#f6465d' : undefined}
              />
              {sessionStats?.breakerOpen && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #2a2e39' }}>
                  <span style={{ fontSize: '0.8rem', color: '#f6465d', fontWeight: 700 }}>
                    ⛔ 연속 손실 차단기 동작 중 ({sessionStats.consecutiveLosses}회)
                  </span>
                  {onResetBreaker && (
                    <button
                      onClick={onResetBreaker}
                      style={{ background: 'rgba(14,203,129,0.12)', border: '1px solid rgba(14,203,129,0.4)', borderRadius: 4, color: '#0ecb81', fontSize: '0.75rem', padding: '3px 10px', cursor: 'pointer' }}
                    >해제</button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Live mode note ─────────────────────────────────────── */}
          {isLive && !isActive && (
            <div style={{ background: 'rgba(246,70,93,0.05)', border: '1px solid rgba(246,70,93,0.15)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: '0.77rem', color: '#f6465d', fontWeight: 700, marginBottom: 3 }}>⚡ 실전 모드</div>
              <div style={{ fontSize: '0.73rem', color: '#848e9c', lineHeight: 1.5 }}>
                API 키가 설정되어 있어야 실제 주문이 발생합니다. 유저 스트림은 시작 후 자동 연결됩니다. 페이퍼 모드에서는 유저 스트림 없이도 동작합니다.
              </div>
            </div>
          )}

          <div style={s.divider} />

          {/* ── Symbols ────────────────────────────────────────────── */}
          <div style={s.section}>
            <div style={s.sectionTitle}>거래 심볼</div>
            <SymbolPicker
              symbols={draft.symbols}
              onChange={syms => set('symbols', syms)}
            />
            {draft.symbols.length === 0 && (
              <div style={{ fontSize: '0.74rem', color: '#f6465d' }}>⚠ 심볼을 하나 이상 선택해야 시작 가능합니다</div>
            )}
          </div>

          <div style={s.divider} />

          {/* ── Execution ──────────────────────────────────────────── */}
          <div style={s.section}>
            <div style={s.sectionTitle}>주문 실행</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <NumField label="레버리지" value={draft.leverage} min={1} max={125} unit="×" onChange={v => set('leverage', v)} />
              <div style={s.fieldRow}>
                <label style={s.label}>마진 방식</label>
                <select style={s.select} value={draft.marginType} onChange={e => set('marginType', e.target.value as 'ISOLATED' | 'CROSSED')}>
                  <option value="ISOLATED">ISOLATED (격리)</option>
                  <option value="CROSSED">CROSSED (교차)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <NumField label="트레이드당 최대 손실" hint="수량 × 스탑 거리 기준" value={draft.maxPerTradeRiskUsd} min={1} step={1} unit="USD" onChange={v => set('maxPerTradeRiskUsd', v)} />
              <NumField label="총 노출 한도" hint="전체 포지션 노셔널 합" value={draft.maxOpenExposureUsd} min={10} step={10} unit="USD" onChange={v => set('maxOpenExposureUsd', v)} />
            </div>
            <div style={s.fieldRow}>
              <label style={s.label}>최소주문금액 사전검증</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => set('precheckMinNotional', true)}
                  style={{
                    ...s.toggleChip,
                    ...(draft.precheckMinNotional
                      ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive)
                      : {}),
                  }}
                >
                  ON
                </button>
                <button
                  onClick={() => set('precheckMinNotional', false)}
                  style={{
                    ...s.toggleChip,
                    ...(!draft.precheckMinNotional
                      ? (isLive ? s.toggleChipActiveLive : s.toggleChipActive)
                      : {}),
                  }}
                >
                  OFF
                </button>
              </div>
              <div style={s.hint}>
                ON이면 심볼별 최소 notional 미충족 주문을 제출 전에 차단합니다.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <NumField label="진입 TTL" hint="미체결 후 재호가 대기" value={draft.entryTtlMs} min={500} step={500} unit="ms" onChange={v => set('entryTtlMs', v)} />
              <NumField label="최대 재호가 횟수" hint="소진 후 IOC 1회" value={draft.maxRepriceCount} min={0} max={5} onChange={v => set('maxRepriceCount', v)} />
            </div>
          </div>

          <div style={s.divider} />

          {/* ── Signal ─────────────────────────────────────────────── */}
          <div style={s.section}>
            <div style={s.sectionTitle}>신호 설정</div>
            <SelectField
              label="신호 모드"
              hint="momentum=매수세 추종 / revert=극단 역추세 / both=둘 다"
              value={draft.signalMode}
              options={[
                { value: 'both',     label: '둘 다 (both)' },
                { value: 'momentum', label: 'Momentum만' },
                { value: 'revert',   label: 'Revert (역추세)만' },
              ]}
              onChange={v => set('signalMode', v)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <NumField label="최소 호가 불균형" hint="|매수-매도| / 합계" value={draft.minImbalance} min={0.05} max={0.9} step={0.05} onChange={v => set('minImbalance', v)} />
              <NumField label="최소 체결 압력" hint="2초 롤링 비율 불균형" value={draft.minTradePressure} min={0.05} max={0.9} step={0.05} onChange={v => set('minTradePressure', v)} />
            </div>
          </div>

          <div style={s.divider} />

          {/* ── Risk gates ─────────────────────────────────────────── */}
          <div style={s.section}>
            <div style={s.sectionTitle}>리스크 게이트</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <NumField label="최대 스프레드" hint="초과 시 진입 차단" value={draft.maxSpreadBps} min={0.5} max={20} step={0.5} unit="bps" onChange={v => set('maxSpreadBps', v)} />
              <NumField label="최소 뎁스" hint="10bps 내 매수잔량 (0=OFF)" value={draft.minDepthUsd} min={0} step={10000} unit="USD" onChange={v => set('minDepthUsd', v)} />
              <NumField label="최대 데이터 지연" hint="Staleness 초과 시 차단" value={draft.maxLatencyMs} min={100} max={5000} step={100} unit="ms" onChange={v => set('maxLatencyMs', v)} />
              <NumField label="심볼 쿨다운" hint="거래 종료 후 재진입 대기" value={draft.symbolCooldownMs} min={1000} step={5000} unit="ms" onChange={v => set('symbolCooldownMs', v)} />
              <NumField label="연속 손실 차단" hint="N회 이상 시 신규 진입 차단" value={draft.consecutiveLossBreaker} min={1} max={20} unit="회" onChange={v => set('consecutiveLossBreaker', v)} />
              <NumField label="세션 최대 진입" hint="세션 내 누적 진입 한도" value={draft.maxDailyTrades} min={1} max={500} unit="회" onChange={v => set('maxDailyTrades', v)} />
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={s.footer}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={s.btnReset} onClick={handleReset}>초기화</button>
            <button style={s.btnCancel} onClick={onClose}>취소</button>
          </div>
          <button
            style={{ ...s.btnSave, ...(isLive ? { background: '#f6465d', color: '#fff' } : {}) }}
            onClick={handleSave}
          >
            저장{isActive ? '' : ' 후 시작 가능'}
          </button>
        </div>

      </div>
    </div>
  );
}

// ── StatusCell ────────────────────────────────────────────────────────────────

function StatusCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ textAlign: 'center' as const }}>
      <div style={{ fontSize: '0.65rem', color: '#3a4558', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' as const, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: valueColor ?? '#d1d4dc', fontFamily: '"SF Mono", Consolas, monospace' }}>
        {value}
      </div>
    </div>
  );
}

// ── Need React for CSSProperties ──────────────────────────────────────────────
import React from 'react';
