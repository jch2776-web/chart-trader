import React, { useState } from 'react';
import type { StrategyLab } from '../../hooks/useStrategyLab';
import type { LabExperimentConfig, LabExperiment } from '../../hooks/useLabExperiment';
import { LAB_MAX_SLOTS } from '../../hooks/useStrategyLab';
import type { ScanInterval } from '../AltScanner/breakoutScanner';
import type { PaperHistoryEntry } from '../../types/paperTrading';

interface Props { lab: StrategyLab; }

// ── Formatters ────────────────────────────────────────────────────────────────
function pf(v: number) { return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2); }
function fmtTime(ms: number | null) {
  if (!ms) return '-';
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
function fmtHoldTime(ms: number) {
  if (ms <= 0) return '-';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const INTERVALS: ScanInterval[] = ['15m', '1h', '4h', '1d'];

// ── Presets ───────────────────────────────────────────────────────────────────
interface Preset {
  label: string;
  tone: 'safe' | 'balanced' | 'aggressive';
  desc: string;
  patch: Partial<Omit<LabExperimentConfig, 'id' | 'name' | 'enabled' | 'strategyId' | 'scanIntervals' | 'initialBalance'>>;
}

const PRESETS: Record<'breakout' | 'leader-retest', Preset[]> = {
  'breakout': [
    {
      label: '보수적',
      tone: 'safe',
      desc: 'LONG·점수95·쿨다운2·동방향1',
      patch: { direction: 'long', minScore: 95, leverage: 10, riskPct: 1.5, cadenceMinutes: 60, maxPositions: 3, cooldownBarsAfterLoss: 2, maxConcurrentCorrelatedPositions: 1 },
    },
    {
      label: '균형형',
      tone: 'balanced',
      desc: '양방향·점수90·쿨다운1·동방향2',
      patch: { direction: 'both', minScore: 90, leverage: 10, riskPct: 2, cadenceMinutes: 60, maxPositions: 5, cooldownBarsAfterLoss: 1, maxConcurrentCorrelatedPositions: 2 },
    },
    {
      label: '공격적',
      tone: 'aggressive',
      desc: '양방향·점수80·쿨다운없음·레버20',
      patch: { direction: 'both', minScore: 80, leverage: 20, riskPct: 3, cadenceMinutes: 60, maxPositions: 8, cooldownBarsAfterLoss: undefined, maxConcurrentCorrelatedPositions: undefined },
    },
  ],
  'leader-retest': [
    {
      label: '보수적',
      tone: 'safe',
      desc: 'LONG·4H추세ON·쿨다운2·bars1~6·tol0.25',
      patch: { direction: 'long', minScore: 85, leverage: 10, riskPct: 1.5, cadenceMinutes: 60, maxPositions: 3, require4hTrend: true, cooldownBarsAfterLoss: 2, maxConcurrentCorrelatedPositions: 1, retestAutoDirection: 'long', retestMinBars: 1, retestMaxBars: 6, retestToleranceAtr: 0.25, retestMaxOvershootAtr: 0.8 },
    },
    {
      label: '균형형',
      tone: 'balanced',
      desc: 'LONG·4H추세ON·쿨다운1·bars1~8·tol0.30',
      patch: { direction: 'long', minScore: 80, leverage: 10, riskPct: 2, cadenceMinutes: 60, maxPositions: 5, require4hTrend: true, cooldownBarsAfterLoss: 1, maxConcurrentCorrelatedPositions: 2, retestAutoDirection: 'long', retestMinBars: 1, retestMaxBars: 8, retestToleranceAtr: 0.30, retestMaxOvershootAtr: 1.0 },
    },
    {
      label: '공격적',
      tone: 'aggressive',
      desc: '양방향·4H추세OFF·bars1~10·tol0.40',
      patch: { direction: 'both', minScore: 70, leverage: 15, riskPct: 3, cadenceMinutes: 60, maxPositions: 8, require4hTrend: false, cooldownBarsAfterLoss: undefined, maxConcurrentCorrelatedPositions: undefined, retestAutoDirection: 'both', retestMinBars: 1, retestMaxBars: 10, retestToleranceAtr: 0.40, retestMaxOvershootAtr: 1.5 },
    },
  ],
};

const TONE_COLORS = {
  safe:       { bg: 'rgba(14,203,129,0.08)',  border: 'rgba(14,203,129,0.3)',  text: '#0ecb81' },
  balanced:   { bg: 'rgba(59,139,235,0.08)',  border: 'rgba(59,139,235,0.3)',  text: '#3b8beb' },
  aggressive: { bg: 'rgba(240,185,11,0.08)',  border: 'rgba(240,185,11,0.3)',  text: '#f0b90b' },
};

// ── Warning detection ─────────────────────────────────────────────────────────
function detectWarnings(
  strategyId: 'breakout' | 'leader-retest',
  direction: string,
  leverage: number,
  riskPct: number,
  require4hTrend: boolean,
  cooldown: number,
  maxConcurrent: number,
  maxPos: number,
): string[] {
  const warns: string[] = [];
  if (leverage >= 20 && riskPct >= 4)
    warns.push('⚠ 레버리지와 리스크 %가 동시에 높아 청산 속도가 빠를 수 있습니다.');
  if (!require4hTrend && direction === 'long' && strategyId === 'leader-retest')
    warns.push('⚠ 4H 추세 필터 OFF + LONG only: 하락장에서 연속 손실 위험이 높습니다.');
  if (maxPos > 6 && (maxConcurrent === 0 || maxConcurrent > 4))
    warns.push('⚠ 동방향 한도 없이 포지션이 많으면 같은 방향에 과집중될 수 있습니다.');
  if (cooldown === 0 && maxPos > 5)
    warns.push('⚠ 쿨다운 없음 + 최대포지션 많음: 연속 손실 국면에서 빠르게 잔고가 줄 수 있습니다.');
  return warns;
}

// ── Helper text ────────────────────────────────────────────────────────────────
function Helper({ text }: { text: string }) {
  return <div style={{ fontSize: '0.69rem', color: '#5a7ba8', marginTop: 2, lineHeight: 1.4 }}>{text}</div>;
}

// ── Tuning guide ──────────────────────────────────────────────────────────────
function TuningGuide() {
  return (
    <div style={{ background: 'rgba(59,139,235,0.07)', border: '1px solid rgba(59,139,235,0.18)', borderRadius: 6, padding: '8px 10px', marginBottom: 10, fontSize: '0.75rem', color: '#8aa8cc', lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, color: '#a0bfdf', marginBottom: 4 }}>튜닝 우선순위 가이드</div>
      <div>① <b>방향·추세</b> — LONG/SHORT/양방향, 4H 추세 필터로 시장 국면 정렬</div>
      <div>② <b>진입 품질</b> — 최소점수 올려 신호 수↓ 품질↑, 리테스트 파라미터 좁히기</div>
      <div>③ <b>과매매 방지</b> — 손실 쿨다운 + 동방향 한도로 연속 손실 억제</div>
      <div>④ <b>리스크 크기</b> — 레버리지·리스크%는 마지막에 조정 (③ 먼저)</div>
    </div>
  );
}

// ── Preset cards ──────────────────────────────────────────────────────────────
function PresetCards({ strategy, onApply }: {
  strategy: 'breakout' | 'leader-retest';
  onApply: (patch: Preset['patch']) => void;
}) {
  const presets = PRESETS[strategy];
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: '0.72rem', color: '#6f8aac', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        프리셋으로 시작
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {presets.map(p => {
          const c = TONE_COLORS[p.tone];
          return (
            <button key={p.label} onClick={() => onApply(p.patch)} style={{
              flex: 1, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6,
              padding: '7px 6px', cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: c.text, marginBottom: 3 }}>{p.label}</div>
              <div style={{ fontSize: '0.67rem', color: '#7a9ab8', lineHeight: 1.4 }}>{p.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────
function SectionHead({ title }: { title: string }) {
  return (
    <div style={{
      gridColumn: '1 / -1', marginTop: 8, paddingTop: 8,
      borderTop: '1px solid rgba(255,255,255,0.07)',
      fontSize: '0.71rem', fontWeight: 700, color: '#6f8aac',
      textTransform: 'uppercase' as const, letterSpacing: '0.06em',
    }}>{title}</div>
  );
}

// ── Add / Edit form ───────────────────────────────────────────────────────────
interface FormState {
  name: string;
  strategyId: 'breakout' | 'leader-retest';
  direction: 'long' | 'short' | 'both';
  intervals: ScanInterval[];
  initBalance: number;
  minScore: number;
  leverage: number;
  riskPct: number;
  cadence: number;
  maxPos: number;
  retestMinBars: number;
  retestMaxBars: number;
  retestToleranceAtr: number;
  retestMaxOvershootAtr: number;
  retestAutoDirection: 'long' | 'both';
  require4hTrend: boolean;
  cooldownBarsAfterLoss: number;
  maxConcurrentCorrelated: number;
}

const DEFAULT_FORM: FormState = {
  name: '실험 1', strategyId: 'breakout', direction: 'both',
  intervals: ['1h'], initBalance: 10000,
  minScore: 90, leverage: 10, riskPct: 2, cadence: 60, maxPos: 5,
  retestMinBars: 1, retestMaxBars: 8, retestToleranceAtr: 0.30, retestMaxOvershootAtr: 1.0, retestAutoDirection: 'long',
  require4hTrend: true, cooldownBarsAfterLoss: 0, maxConcurrentCorrelated: 0,
};

function formToConfig(f: FormState): Omit<LabExperimentConfig, 'id'> {
  const cfg: Omit<LabExperimentConfig, 'id'> = {
    name: f.name.trim() || '실험',
    enabled: true,
    strategyId: f.strategyId,
    scanIntervals: f.intervals,
    direction: f.direction,
    minScore: f.minScore,
    leverage: f.leverage,
    riskPct: f.riskPct,
    cadenceMinutes: f.cadence,
    maxPositions: f.maxPos,
    initialBalance: f.initBalance,
    require4hTrend: f.require4hTrend,
    cooldownBarsAfterLoss: f.cooldownBarsAfterLoss > 0 ? f.cooldownBarsAfterLoss : undefined,
    maxConcurrentCorrelatedPositions: f.maxConcurrentCorrelated > 0 ? f.maxConcurrentCorrelated : undefined,
  };
  if (f.strategyId === 'leader-retest') {
    cfg.retestMinBars = f.retestMinBars;
    cfg.retestMaxBars = f.retestMaxBars;
    cfg.retestToleranceAtr = f.retestToleranceAtr;
    cfg.retestMaxOvershootAtr = f.retestMaxOvershootAtr;
    cfg.retestAutoDirection = f.retestAutoDirection;
  }
  return cfg;
}

function configToForm(cfg: LabExperimentConfig): FormState {
  return {
    name: cfg.name,
    strategyId: cfg.strategyId,
    direction: cfg.direction,
    intervals: cfg.scanIntervals,
    initBalance: cfg.initialBalance,
    minScore: cfg.minScore,
    leverage: cfg.leverage,
    riskPct: cfg.riskPct,
    cadence: cfg.cadenceMinutes,
    maxPos: cfg.maxPositions,
    retestMinBars: cfg.retestMinBars ?? 1,
    retestMaxBars: cfg.retestMaxBars ?? 8,
    retestToleranceAtr: cfg.retestToleranceAtr ?? 0.30,
    retestMaxOvershootAtr: cfg.retestMaxOvershootAtr ?? 1.0,
    retestAutoDirection: cfg.retestAutoDirection ?? 'long',
    require4hTrend: cfg.require4hTrend ?? true,
    cooldownBarsAfterLoss: cfg.cooldownBarsAfterLoss ?? 0,
    maxConcurrentCorrelated: cfg.maxConcurrentCorrelatedPositions ?? 0,
  };
}

function AddExperimentForm({ onAdd, onCancel, initialForm }: {
  onAdd: (cfg: Omit<LabExperimentConfig, 'id'>) => void;
  onCancel: () => void;
  initialForm?: Partial<FormState>;
}) {
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM, ...initialForm });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(p => ({ ...p, [k]: v }));

  const applyPreset = (patch: Preset['patch']) => {
    setForm(p => ({
      ...p,
      ...(patch.direction !== undefined ? { direction: patch.direction } : {}),
      ...(patch.minScore !== undefined ? { minScore: patch.minScore } : {}),
      ...(patch.leverage !== undefined ? { leverage: patch.leverage } : {}),
      ...(patch.riskPct !== undefined ? { riskPct: patch.riskPct } : {}),
      ...(patch.cadenceMinutes !== undefined ? { cadence: patch.cadenceMinutes } : {}),
      ...(patch.maxPositions !== undefined ? { maxPos: patch.maxPositions } : {}),
      require4hTrend: patch.require4hTrend ?? p.require4hTrend,
      cooldownBarsAfterLoss: patch.cooldownBarsAfterLoss ?? 0,
      maxConcurrentCorrelated: patch.maxConcurrentCorrelatedPositions ?? 0,
      retestAutoDirection: patch.retestAutoDirection ?? p.retestAutoDirection,
      retestMinBars: patch.retestMinBars ?? p.retestMinBars,
      retestMaxBars: patch.retestMaxBars ?? p.retestMaxBars,
      retestToleranceAtr: patch.retestToleranceAtr ?? p.retestToleranceAtr,
      retestMaxOvershootAtr: patch.retestMaxOvershootAtr ?? p.retestMaxOvershootAtr,
    }));
  };

  const warnings = detectWarnings(
    form.strategyId, form.direction, form.leverage, form.riskPct,
    form.require4hTrend, form.cooldownBarsAfterLoss, form.maxConcurrentCorrelated, form.maxPos,
  );

  const toggleInterval = (iv: ScanInterval) =>
    set('intervals', form.intervals.includes(iv) ? form.intervals.filter(x => x !== iv) : [...form.intervals, iv]);

  return (
    <div style={S.form}>
      <div style={S.formTitle}>새 실험 추가</div>

      <TuningGuide />
      <PresetCards strategy={form.strategyId} onApply={applyPreset} />

      <div style={S.formGrid}>
        {/* ── Step 1: Basic ── */}
        <SectionHead title="기본 설정" />

        <label style={S.formLabel}>이름</label>
        <input style={S.input} value={form.name} onChange={e => set('name', e.target.value)} />

        <label style={S.formLabel}>전략</label>
        <select style={S.input} value={form.strategyId}
          onChange={e => { set('strategyId', e.target.value as 'breakout' | 'leader-retest'); }}>
          <option value="breakout">돌파 (Breakout)</option>
          <option value="leader-retest">리더 리테스트</option>
        </select>

        <label style={S.formLabel}>방향</label>
        <select style={S.input} value={form.direction} onChange={e => set('direction', e.target.value as 'long' | 'short' | 'both')}>
          <option value="both">양방향</option>
          <option value="long">LONG만</option>
          <option value="short">SHORT만</option>
        </select>

        <label style={S.formLabel}>타임프레임</label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {INTERVALS.map(iv => (
            <button key={iv} style={{ ...S.segBtn, ...(form.intervals.includes(iv) ? S.segBtnOn : {}) }}
              onClick={() => toggleInterval(iv)}>{iv}</button>
          ))}
        </div>

        <label style={S.formLabel}>초기잔고(USDT)</label>
        <input style={S.input} type="number" min={100} value={form.initBalance}
          onChange={e => set('initBalance', Number(e.target.value))} />
      </div>

      {/* ── Step 2: Advanced (collapsible) ── */}
      <button
        style={{ ...S.ghostBtn, width: '100%', marginTop: 8, textAlign: 'center', display: 'block' }}
        onClick={() => setShowAdvanced(v => !v)}
      >
        {showAdvanced ? '▲ 고급 설정 접기' : '▼ 고급 설정 펼치기'}
      </button>

      {showAdvanced && (
        <div style={S.formGrid}>
          <SectionHead title="진입 품질" />

          <label style={S.formLabel}>최소점수</label>
          <div>
            <input style={S.input} type="number" min={0} max={120} value={form.minScore}
              onChange={e => set('minScore', Number(e.target.value))} />
            <Helper text="높을수록 거래 수↓ · 품질 기대↑ (기본 90)" />
          </div>

          <label style={S.formLabel}>스캔주기(분)</label>
          <input style={S.input} type="number" min={15} value={form.cadence}
            onChange={e => set('cadence', Number(e.target.value))} />

          <label style={S.formLabel}>최대포지션</label>
          <input style={S.input} type="number" min={0} value={form.maxPos}
            onChange={e => set('maxPos', Number(e.target.value))} />

          <SectionHead title="리스크 설정" />

          <label style={S.formLabel}>레버리지</label>
          <div>
            <input style={S.input} type="number" min={1} max={125} value={form.leverage}
              onChange={e => set('leverage', Number(e.target.value))} />
            <Helper text="높을수록 손익 폭↑ · 청산 위험↑ (기본 10)" />
          </div>

          <label style={S.formLabel}>리스크 %</label>
          <div>
            <input style={S.input} type="number" min={0.1} max={100} step={0.1} value={form.riskPct}
              onChange={e => set('riskPct', Number(e.target.value))} />
            <Helper text="잔고의 몇 %를 손절 시 손실로 설정 (기본 2%)" />
          </div>

          {form.strategyId === 'leader-retest' && <>
            <SectionHead title="리테스트 파라미터" />

            <label style={S.formLabel}>방향 스캔</label>
            <select style={S.input} value={form.retestAutoDirection}
              onChange={e => set('retestAutoDirection', e.target.value as 'long' | 'both')}>
              <option value="long">LONG만</option>
              <option value="both">양방향</option>
            </select>

            <label style={S.formLabel}>최소 봉 수</label>
            <div>
              <input style={S.input} type="number" min={1} max={20} value={form.retestMinBars}
                onChange={e => set('retestMinBars', Number(e.target.value))} />
              <Helper text="돌파 후 최소 이 봉 이후 리테스트여야 유효" />
            </div>

            <label style={S.formLabel}>최대 봉 수</label>
            <div>
              <input style={S.input} type="number" min={1} max={30} value={form.retestMaxBars}
                onChange={e => set('retestMaxBars', Number(e.target.value))} />
              <Helper text="이 봉 이후 리테스트는 신호가 너무 오래됨으로 제외" />
            </div>

            <label style={S.formLabel}>허용 오차(ATR)</label>
            <div>
              <input style={S.input} type="number" min={0.05} max={2} step={0.05} value={form.retestToleranceAtr}
                onChange={e => set('retestToleranceAtr', Number(e.target.value))} />
              <Helper text="낮을수록 더 엄격한 리테스트 조건 (기본 0.30)" />
            </div>

            <label style={S.formLabel}>최대 오버슈팅(ATR)</label>
            <div>
              <input style={S.input} type="number" min={0.1} max={5} step={0.1} value={form.retestMaxOvershootAtr}
                onChange={e => set('retestMaxOvershootAtr', Number(e.target.value))} />
              <Helper text="높을수록 레벨 대비 늦은 진입도 허용 (기본 1.0)" />
            </div>
          </>}

          <SectionHead title="진입 필터 (No-trade gate)" />

          <label style={S.formLabel}>4H 추세 필터</label>
          <div>
            <label style={S.checkLabel}>
              <input type="checkbox" checked={form.require4hTrend}
                onChange={e => set('require4hTrend', e.target.checked)} />
              <span>LONG 진입 시 4H EMA20 {'>'} EMA50 필요
                {form.strategyId === 'breakout' && <span style={{ color: '#5a7ba8' }}> (리테스트 전용)</span>}
              </span>
            </label>
          </div>

          <label style={S.formLabel}>손실 쿨다운</label>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input style={{ ...S.input, width: 60 }} type="number" min={0} max={20}
                value={form.cooldownBarsAfterLoss}
                onChange={e => set('cooldownBarsAfterLoss', Number(e.target.value))} />
              <span style={{ fontSize: '0.75rem', color: '#6f7f95' }}>주기 (0=비활성)</span>
            </div>
            <Helper text="손실 후 해당 스캔 주기 수 동안 재진입 억제" />
          </div>

          <label style={S.formLabel}>동방향 한도</label>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input style={{ ...S.input, width: 60 }} type="number" min={0} max={20}
                value={form.maxConcurrentCorrelated}
                onChange={e => set('maxConcurrentCorrelated', Number(e.target.value))} />
              <span style={{ fontSize: '0.75rem', color: '#6f7f95' }}>개 (0=비활성)</span>
            </div>
            <Helper text="같은 방향 동시 포지션 상한 · 한쪽 쏠림 방지" />
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ marginTop: 8, background: 'rgba(240,185,11,0.06)', border: '1px solid rgba(240,185,11,0.25)', borderRadius: 6, padding: '7px 10px' }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: '0.73rem', color: '#c8a640', lineHeight: 1.5 }}>{w}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button style={S.ghostBtn} onClick={onCancel}>취소</button>
        <button style={S.primaryBtn} onClick={() => {
          if (!form.name.trim() || form.intervals.length === 0) return;
          onAdd(formToConfig(form));
        }}>추가</button>
      </div>
    </div>
  );
}

// ── Mini equity chart ─────────────────────────────────────────────────────────
function MiniEquityChart({ history, initialBalance, slotIndex }: {
  history: PaperHistoryEntry[];
  initialBalance: number;
  slotIndex: number;
}) {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => a.exitTime - b.exitTime);
  const points: number[] = [initialBalance];
  let bal = initialBalance;
  for (const h of sorted) {
    bal += h.pnl;
    points.push(Math.max(0, bal));
  }
  const W = 300; const H = 46; const PAD = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const toX = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const toY = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);
  const polyPoints = points.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const lastBal = points[points.length - 1];
  const isProfit = lastBal >= initialBalance;
  const color = isProfit ? '#0ecb81' : '#f6465d';
  const gradId = `slg-${slotIndex}`;
  const areaPath = [
    `M ${toX(0).toFixed(1)},${H}`,
    ...points.map((v, i) => `L ${toX(i).toFixed(1)},${toY(v).toFixed(1)}`),
    `L ${toX(points.length - 1).toFixed(1)},${H} Z`,
  ].join(' ');
  const baseY = toY(initialBalance).toFixed(1);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ display: 'block', marginTop: 6, marginBottom: 2, height: H }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1={PAD} y1={baseY} x2={W - PAD} y2={baseY}
        stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,3" />
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline points={polyPoints} fill="none" stroke={color}
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Stat cell ─────────────────────────────────────────────────────────────────
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={{ ...S.statValue, ...(color ? { color } : {}) }}>{value}</div>
    </div>
  );
}

// ── Operation summary ─────────────────────────────────────────────────────────
function OperationSummary({ cfg, expanded, onToggle }: {
  cfg: LabExperimentConfig;
  expanded: boolean;
  onToggle: () => void;
}) {
  const entryGates: string[] = [];
  if (cfg.require4hTrend) entryGates.push('4H EMA20>50 필요');
  if (cfg.cooldownBarsAfterLoss) entryGates.push(`손실후 ${cfg.cooldownBarsAfterLoss}주기 휴식`);
  if (cfg.maxConcurrentCorrelatedPositions) entryGates.push(`동방향 ≤${cfg.maxConcurrentCorrelatedPositions}개`);
  if (cfg.maxPositions > 0) entryGates.push(`총 ≤${cfg.maxPositions}포지션`);

  const dirLabel = cfg.direction === 'both' ? '양방향' : cfg.direction.toUpperCase();
  const intervalsLabel = cfg.scanIntervals.join('·');

  return (
    <div style={{ marginTop: 6, background: 'rgba(255,255,255,0.025)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      {/* always-visible one-liner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', cursor: 'pointer' }}
        onClick={onToggle}>
        <div style={{ fontSize: '0.72rem', color: '#6a8ab0', lineHeight: 1.5 }}>
          <span style={{ color: '#0ecb81', fontWeight: 600 }}>▲ 진입</span>
          {' '}매{cfg.cadenceMinutes}분 경계 · {intervalsLabel}봉 마감 · 점수{cfg.minScore}+ → 즉시 {dirLabel} 시장가
          {'  '}
          <span style={{ color: '#f6465d', fontWeight: 600 }}>▼ 청산</span>
          {' '}TP·SL·청산가 자동
        </div>
        <span style={{ fontSize: '0.68rem', color: '#4a6080', marginLeft: 6, flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* expanded details */}
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '7px 10px', fontSize: '0.71rem', color: '#6a8ab0', lineHeight: 1.7 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div>
              <div style={{ color: '#0ecb81', fontWeight: 700, marginBottom: 2 }}>▲ 진입 조건</div>
              <div>· 매 {cfg.cadenceMinutes}분 경계 시각 도달 시 스캔</div>
              <div>· {intervalsLabel} 봉 마감 시간과 일치할 때만 유효</div>
              <div>· 점수 {cfg.minScore}+ 후보 → <b>즉시 시장가</b> 진입</div>
              <div>· 이미 같은 심볼 보유 시 스킵</div>
              {entryGates.length > 0 && (
                <>
                  <div style={{ color: '#8aa4c4', fontWeight: 600, marginTop: 4, marginBottom: 1 }}>진입 차단 조건</div>
                  {entryGates.map((g, i) => <div key={i}>· {g}</div>)}
                </>
              )}
            </div>
            <div>
              <div style={{ color: '#f6465d', fontWeight: 700, marginBottom: 2 }}>▼ 청산 조건</div>
              <div>· TP 가격 도달 → 자동 익절</div>
              <div>· SL 가격 도달 → 자동 손절</div>
              <div>· 청산가 도달 → 강제청산</div>
              <div style={{ color: '#8a6030', marginTop: 4 }}>
                ⚠ 타임스탑 없음 — TP/SL 미도달 시 무기한 보유
              </div>
            </div>
          </div>
          <div style={{ marginTop: 6, padding: '4px 6px', background: 'rgba(59,139,235,0.06)', borderRadius: 4, color: '#5a7ba8' }}>
            ℹ 실험실 스캔은 실전·모의 자동매매와 완전히 독립된 별도 레저를 사용합니다. 단, Binance API 요청을 공유하므로 여러 실험이 동시에 돌면 메인 스캔이 지연될 수 있습니다.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Gate label ────────────────────────────────────────────────────────────────
function gateLabel(cfg: LabExperimentConfig): string {
  const g: string[] = [];
  if (cfg.require4hTrend) g.push('4H추세');
  if (cfg.cooldownBarsAfterLoss) g.push(`쿨다운×${cfg.cooldownBarsAfterLoss}`);
  if (cfg.maxConcurrentCorrelatedPositions) g.push(`동방향≤${cfg.maxConcurrentCorrelatedPositions}`);
  return g.length > 0 ? g.join(' · ') : '없음';
}

// ── Experiment card ───────────────────────────────────────────────────────────
function ExperimentCard({ exp, onToggle, onRemove, onResetBalance, onClearHistory, onClone }: {
  exp: LabExperiment;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onResetBalance: () => void;
  onClearHistory: () => void;
  onClone: () => void;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const cfg = exp.config!;
  const s = exp.stats;
  const pnlColor = s.totalPnl >= 0 ? '#0ecb81' : '#f6465d';
  const isRetest = cfg.strategyId === 'leader-retest';

  const cardWarnings = detectWarnings(
    cfg.strategyId, cfg.direction, cfg.leverage, cfg.riskPct,
    cfg.require4hTrend ?? true, cfg.cooldownBarsAfterLoss ?? 0,
    cfg.maxConcurrentCorrelatedPositions ?? 0, cfg.maxPositions,
  );

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
          <div style={{ ...S.dot, background: cfg.enabled ? '#0ecb81' : '#6f7f95' }} />
          <span style={S.cardName}>{cfg.name}</span>
          <span style={{ ...S.badge, color: isRetest ? '#c47cf7' : '#3b8beb', borderColor: isRetest ? 'rgba(196,124,247,0.35)' : 'rgba(59,139,235,0.35)' }}>
            {isRetest ? '리테스트' : '돌파'}
          </span>
          {exp.scanning && <span style={{ ...S.badge, color: '#f0b90b', borderColor: 'rgba(240,185,11,0.3)' }}>스캔중</span>}
          {cardWarnings.length > 0 && <span style={{ ...S.badge, color: '#c8a640', borderColor: 'rgba(200,166,64,0.3)' }}>주의</span>}
        </div>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          <button style={{ ...S.tinyBtn, ...(cfg.enabled ? S.tinyBtnOff : S.tinyBtnOn) }}
            onClick={() => onToggle(!cfg.enabled)}>
            {cfg.enabled ? '중지' : '시작'}
          </button>
          <button style={S.tinyBtnDanger} onClick={onRemove}>삭제</button>
        </div>
      </div>

      <div style={S.statsRow}>
        <Stat label="잔고" value={`${s.balance.toFixed(0)} U`} />
        <Stat label="수익률" value={`${s.pnlPct.toFixed(2)}%`} color={pnlColor} />
        <Stat label="순이익" value={pf(s.totalPnl)} color={pnlColor} />
        <Stat label="승률" value={`${s.winRate.toFixed(1)}%`} />
        <Stat label="거래수" value={String(s.historyCount)} />
        <Stat label="포지션" value={String(s.positionCount)} />
      </div>

      {s.historyCount > 0 && (
        <div style={{ ...S.statsRow, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 4, marginTop: 2 }}>
          <Stat label="TP도달" value={`${s.tpRate.toFixed(0)}%`} color="#0ecb81" />
          <Stat label="손절" value={`${s.slRate.toFixed(0)}%`} color="#f6465d" />
          <Stat label="타임스탑" value={`${s.expiredRate.toFixed(0)}%`} color="#f0b90b" />
          <Stat label="평균보유" value={fmtHoldTime(s.avgHoldMs)} />
          <Stat label="연속손실" value={String(s.maxConsecLoss)} color={s.maxConsecLoss >= 3 ? '#f6465d' : undefined} />
        </div>
      )}

      <MiniEquityChart
        history={exp.paper.history}
        initialBalance={cfg.initialBalance}
        slotIndex={exp.slotIndex}
      />

      <div style={S.cardMeta}>
        <span>{cfg.scanIntervals.join('·')} · {cfg.direction === 'both' ? '양방향' : cfg.direction.toUpperCase()} · 레버{cfg.leverage}x · 리스크{cfg.riskPct}% · {cfg.minScore}점+</span>
        {exp.nextRunTime && <span>다음: {fmtTime(exp.nextRunTime)}</span>}
      </div>
      <div style={{ ...S.cardMeta, marginTop: 2 }}>
        <span style={{ color: '#5a7ba8' }}>gate: {gateLabel(cfg)}</span>
        {isRetest && (
          <span style={{ color: '#5a7ba8' }}>
            bars {cfg.retestMinBars ?? 1}–{cfg.retestMaxBars ?? 8} · tol {cfg.retestToleranceAtr ?? 0.30}×ATR
          </span>
        )}
      </div>

      <OperationSummary cfg={cfg} expanded={showOps} onToggle={() => setShowOps(v => !v)} />

      {cardWarnings.length > 0 && (
        <div style={{ marginTop: 4, fontSize: '0.7rem', color: '#9a7a30', lineHeight: 1.5 }}>
          {cardWarnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
        <button style={S.ghostBtn} onClick={onClone}>복제</button>
        <button style={S.ghostBtn} onClick={() => setShowLogs(v => !v)}>
          {showLogs ? '로그숨기기' : `로그(${exp.logs.length})`}
        </button>
        <button style={S.ghostBtn} onClick={onResetBalance}>잔고초기화</button>
        <button style={S.ghostBtn} onClick={onClearHistory}>히스토리삭제</button>
      </div>

      {showLogs && (
        <div style={S.logBox}>
          {exp.logs.length === 0
            ? <div style={{ color: '#6f7f95' }}>로그 없음</div>
            : exp.logs.map((l, i) => <div key={i} style={{ lineHeight: 1.5 }}>{l}</div>)
          }
        </div>
      )}
    </div>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────
function ComparisonTable({ experiments }: { experiments: LabExperiment[] }) {
  const active = experiments.filter(e => e.config !== null);
  if (active.length < 2) return null;
  const headers = ['이름', '전략', '잔고', '수익률', '순이익', '승률', '거래', 'TP%', '손절%', '타임스탑%', '평균보유', '연속손실'];
  return (
    <div style={{ marginTop: 14 }}>
      <div style={S.sectionTitle}>비교 요약</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr>{headers.map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {active.map(exp => {
              const cfg = exp.config!;
              const s = exp.stats;
              const pc = s.totalPnl >= 0 ? '#0ecb81' : '#f6465d';
              return (
                <tr key={exp.slotIndex}>
                  <td style={S.td}>{cfg.name}</td>
                  <td style={S.td}>{cfg.strategyId === 'leader-retest' ? '리테스트' : '돌파'}</td>
                  <td style={S.td}>{s.balance.toFixed(0)}</td>
                  <td style={{ ...S.td, color: pc }}>{s.pnlPct.toFixed(2)}%</td>
                  <td style={{ ...S.td, color: pc }}>{pf(s.totalPnl)}</td>
                  <td style={S.td}>{s.winRate.toFixed(1)}%</td>
                  <td style={S.td}>{s.historyCount}</td>
                  <td style={{ ...S.td, color: '#0ecb81' }}>{s.tpRate.toFixed(0)}%</td>
                  <td style={{ ...S.td, color: '#f6465d' }}>{s.slRate.toFixed(0)}%</td>
                  <td style={{ ...S.td, color: '#f0b90b' }}>{s.expiredRate.toFixed(0)}%</td>
                  <td style={S.td}>{fmtHoldTime(s.avgHoldMs)}</td>
                  <td style={{ ...S.td, color: s.maxConsecLoss >= 3 ? '#f6465d' : undefined }}>{s.maxConsecLoss}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function StrategyLabPanel({ lab }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [cloneBase, setCloneBase] = useState<Partial<FormState> | undefined>(undefined);

  const handleAdd = (cfg: Omit<LabExperimentConfig, 'id'>) => {
    lab.addExperiment(cfg);
    setShowAddForm(false);
    setCloneBase(undefined);
  };

  const handleClone = (exp: LabExperiment) => {
    if (!exp.config || !lab.canAdd) return;
    const base = configToForm(exp.config);
    base.name = `${exp.config.name} copy`;
    setCloneBase(base);
    setShowAddForm(true);
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.title}>전략 실험실</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={S.metaText}>{lab.activeCount}/{LAB_MAX_SLOTS} 슬롯 사용</span>
          {lab.canAdd && !showAddForm && (
            <button style={S.primaryBtn} onClick={() => { setCloneBase(undefined); setShowAddForm(true); }}>
              + 실험 추가
            </button>
          )}
        </div>
      </div>

      {showAddForm && (
        <AddExperimentForm
          onAdd={handleAdd}
          onCancel={() => { setShowAddForm(false); setCloneBase(undefined); }}
          initialForm={cloneBase}
        />
      )}

      {lab.activeCount === 0 && !showAddForm && (
        <div style={S.empty}>
          실험이 없습니다.<br />
          '+ 실험 추가' → 프리셋 선택 → 한두 가지 파라미터만 바꿔 A/B 비교해보세요.
        </div>
      )}

      {lab.experiments.map(exp => {
        if (!exp.config) return null;
        return (
          <ExperimentCard
            key={exp.slotIndex}
            exp={exp}
            onToggle={(enabled) => lab.updateExperiment(exp.slotIndex, { enabled })}
            onRemove={() => {
            exp.paper.reset(exp.config!.initialBalance);
            lab.removeExperiment(exp.slotIndex);
          }}
            onResetBalance={() => exp.paper.resetBalance(exp.config!.initialBalance)}
            onClearHistory={() => exp.paper.clearHistory()}
            onClone={() => handleClone(exp)}
          />
        );
      })}

      <ComparisonTable experiments={lab.experiments} />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  root: { padding: '10px 12px', color: '#d1d4dc', fontSize: '0.82rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: '0.88rem', fontWeight: 700, color: '#e0e6f0' },
  metaText: { fontSize: '0.76rem', color: '#6f7f95' },
  sectionTitle: { fontSize: '0.78rem', fontWeight: 700, color: '#9aa4b5', marginBottom: 6 },
  empty: { color: '#6f7f95', fontSize: '0.8rem', lineHeight: 1.8, padding: '20px 0', textAlign: 'center' },
  card: { background: '#111826', border: '1px solid #2c3a53', borderRadius: 8, padding: '10px 12px', marginBottom: 8 },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  cardName: { fontWeight: 700, fontSize: '0.84rem', color: '#e0e6f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  badge: { fontSize: '0.7rem', padding: '1px 5px', borderRadius: 4, border: '1px solid', flexShrink: 0 },
  statsRow: { display: 'flex', gap: 0, marginBottom: 4, flexWrap: 'wrap' },
  stat: { flex: '1 0 55px', padding: '3px 5px' },
  statLabel: { fontSize: '0.67rem', color: '#6f7f95', marginBottom: 1 },
  statValue: { fontSize: '0.79rem', fontWeight: 600, color: '#d1d4dc' },
  cardMeta: { display: 'flex', justifyContent: 'space-between', fontSize: '0.71rem', color: '#6f7f95', flexWrap: 'wrap', gap: 4 },
  logBox: { marginTop: 8, background: '#0d1520', border: '1px solid #1e2d45', borderRadius: 6, padding: '6px 8px', maxHeight: 120, overflowY: 'auto', fontSize: '0.71rem', color: '#90a3bc', fontFamily: 'monospace' },
  form: { background: '#111826', border: '1px solid #2c3a53', borderRadius: 8, padding: '12px 14px', marginBottom: 10 },
  formTitle: { fontWeight: 700, fontSize: '0.84rem', marginBottom: 8, color: '#e0e6f0' },
  formGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 10px', alignItems: 'start' },
  formLabel: { fontSize: '0.78rem', color: '#9aa4b5', whiteSpace: 'nowrap', paddingTop: 5 },
  checkLabel: { fontSize: '0.78rem', color: '#c8d2e0', display: 'flex', alignItems: 'center', gap: 6 },
  input: { background: '#192336', border: '1px solid #3d4b64', borderRadius: 5, color: '#d1d4dc', fontSize: '0.8rem', padding: '4px 7px', width: '100%', boxSizing: 'border-box' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.75rem' },
  th: { textAlign: 'left' as const, padding: '4px 7px', borderBottom: '1px solid #2c3a53', color: '#6f7f95', fontWeight: 600, whiteSpace: 'nowrap' as const },
  td: { padding: '4px 7px', borderBottom: '1px solid #1e2d45', color: '#d1d4dc', whiteSpace: 'nowrap' as const },
  primaryBtn: { background: 'rgba(59,139,235,0.18)', border: '1px solid rgba(59,139,235,0.45)', color: '#8ebeff', borderRadius: 6, padding: '5px 10px', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600 },
  ghostBtn: { background: '#192336', border: '1px solid #3d4b64', color: '#9aa4b5', borderRadius: 5, padding: '4px 8px', fontSize: '0.75rem', cursor: 'pointer' },
  tinyBtn: { borderRadius: 4, padding: '3px 7px', fontSize: '0.72rem', cursor: 'pointer' },
  tinyBtnOn: { background: 'rgba(14,203,129,0.12)', border: '1px solid rgba(14,203,129,0.35)', color: '#0ecb81' },
  tinyBtnOff: { background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.3)', color: '#f6465d' },
  tinyBtnDanger: { background: 'transparent', border: '1px solid #3d4b64', color: '#6f7f95', borderRadius: 4, padding: '3px 7px', fontSize: '0.72rem', cursor: 'pointer' },
  segBtn: { border: '1px solid #3d4b64', background: '#192336', color: '#9aa4b5', borderRadius: 4, padding: '3px 7px', fontSize: '0.74rem', cursor: 'pointer' },
  segBtnOn: { border: '1px solid rgba(59,139,235,0.5)', color: '#8ebeff', background: 'rgba(59,139,235,0.14)' },
};
