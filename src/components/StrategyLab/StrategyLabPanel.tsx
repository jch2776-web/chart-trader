import React, { useState, useEffect } from 'react';
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
function fmtShortBalance(v: number) {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(0);
}
const INTERVAL_MS: Record<string, number> = {
  '15m': 15 * 60_000, '30m': 30 * 60_000,
  '1h': 60 * 60_000, '4h': 4 * 60 * 60_000, '1d': 24 * 60 * 60_000,
};

const INTERVALS: ScanInterval[] = ['15m', '1h', '4h', '1d'];

// ── Presets ───────────────────────────────────────────────────────────────────
interface Preset {
  label: string;
  tone: 'safe' | 'balanced' | 'aggressive';
  desc: string;
  patch: Partial<Omit<LabExperimentConfig, 'id' | 'name' | 'enabled' | 'strategyId' | 'scanIntervals' | 'initialBalance'>>;
}

const PRESETS: Record<'breakout' | 'leader-retest' | 'fvg-poc-ema72', Preset[]> = {
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
  'fvg-poc-ema72': [
    {
      label: '보수적',
      tone: 'safe',
      desc: 'LONG·유니버스100·POC500봉·EMA72',
      patch: { direction: 'long', minScore: 60, leverage: 10, riskPct: 1.5, cadenceMinutes: 60, maxPositions: 3, cooldownBarsAfterLoss: 2, maxConcurrentCorrelatedPositions: 1 },
    },
    {
      label: '균형형',
      tone: 'balanced',
      desc: '양방향·유니버스100·POC500봉·EMA72',
      patch: { direction: 'both', minScore: 55, leverage: 10, riskPct: 2, cadenceMinutes: 60, maxPositions: 5, cooldownBarsAfterLoss: 1, maxConcurrentCorrelatedPositions: 2 },
    },
    {
      label: '공격적',
      tone: 'aggressive',
      desc: '양방향·유니버스200·쿨다운없음·레버20',
      patch: { direction: 'both', minScore: 45, leverage: 20, riskPct: 3, cadenceMinutes: 60, maxPositions: 8, cooldownBarsAfterLoss: undefined, maxConcurrentCorrelatedPositions: undefined },
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
  strategyId: 'breakout' | 'leader-retest' | 'fvg-poc-ema72',
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
  strategy: 'breakout' | 'leader-retest' | 'fvg-poc-ema72';
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
  strategyId: 'breakout' | 'leader-retest' | 'fvg-poc-ema72';
  direction: 'long' | 'short' | 'both';
  intervals: ScanInterval[];
  initBalance: number;
  minScore: number;
  leverage: number;
  riskPct: number;
  cadence: number;
  maxPos: number;
  // Leader-retest
  retestMinBars: number;
  retestMaxBars: number;
  retestToleranceAtr: number;
  retestMaxOvershootAtr: number;
  retestAutoDirection: 'long' | 'both';
  // No-trade gates
  require4hTrend: boolean;
  cooldownBarsAfterLoss: number;
  maxConcurrentCorrelated: number;
  // Breakout-specific
  breakoutDirection: 'long' | 'short' | 'both';
  maxSignalAgeSec: number;        // 0 = disabled
  maxBreakoutExtensionPct: number; // 0 = disabled
  maxEntryDriftPct: number;       // 0 = disabled
  // FVG POC + EMA72
  fvgPocLookbackBars: number;
  fvgPocBins: number;
  fvgEmaPeriod: number;
  fvgUniverseTopN: number;
  fvgDirection: 'long' | 'short' | 'both';
  // Lab-only time-stop
  labTimeStopEnabled: boolean;
  labTimeStopBars: number;
}

const DEFAULT_FORM: FormState = {
  name: '실험 1', strategyId: 'breakout', direction: 'both',
  intervals: ['1h'], initBalance: 10000,
  minScore: 90, leverage: 10, riskPct: 2, cadence: 60, maxPos: 5,
  retestMinBars: 1, retestMaxBars: 8, retestToleranceAtr: 0.30, retestMaxOvershootAtr: 1.0, retestAutoDirection: 'long',
  require4hTrend: true, cooldownBarsAfterLoss: 0, maxConcurrentCorrelated: 0,
  breakoutDirection: 'both', maxSignalAgeSec: 0, maxBreakoutExtensionPct: 0, maxEntryDriftPct: 0,
  fvgPocLookbackBars: 500, fvgPocBins: 40, fvgEmaPeriod: 72, fvgUniverseTopN: 100, fvgDirection: 'both',
  labTimeStopEnabled: false, labTimeStopBars: 4,
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
    labTimeStopEnabled: f.labTimeStopEnabled,
    labTimeStopBars: f.labTimeStopBars > 0 ? f.labTimeStopBars : 4,
  };
  if (f.strategyId === 'leader-retest') {
    cfg.retestMinBars = f.retestMinBars;
    cfg.retestMaxBars = f.retestMaxBars;
    cfg.retestToleranceAtr = f.retestToleranceAtr;
    cfg.retestMaxOvershootAtr = f.retestMaxOvershootAtr;
    cfg.retestAutoDirection = f.retestAutoDirection;
  } else if (f.strategyId === 'fvg-poc-ema72') {
    cfg.fvgPocLookbackBars = f.fvgPocLookbackBars;
    cfg.fvgPocBins = f.fvgPocBins;
    cfg.fvgEmaPeriod = f.fvgEmaPeriod;
    cfg.fvgUniverseTopN = f.fvgUniverseTopN;
    cfg.fvgDirection = f.fvgDirection;
  } else {
    cfg.breakoutDirection = f.breakoutDirection;
    cfg.maxSignalAgeSec = f.maxSignalAgeSec > 0 ? f.maxSignalAgeSec : null;
    cfg.maxBreakoutExtensionPct = f.maxBreakoutExtensionPct > 0 ? f.maxBreakoutExtensionPct : null;
    cfg.maxEntryDriftPct = f.maxEntryDriftPct > 0 ? f.maxEntryDriftPct : null;
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
    breakoutDirection: cfg.breakoutDirection ?? 'both',
    maxSignalAgeSec: cfg.maxSignalAgeSec ?? 0,
    maxBreakoutExtensionPct: cfg.maxBreakoutExtensionPct ?? 0,
    maxEntryDriftPct: cfg.maxEntryDriftPct ?? 0,
    fvgPocLookbackBars: cfg.fvgPocLookbackBars ?? 500,
    fvgPocBins: cfg.fvgPocBins ?? 40,
    fvgEmaPeriod: cfg.fvgEmaPeriod ?? 72,
    fvgUniverseTopN: cfg.fvgUniverseTopN ?? 100,
    fvgDirection: cfg.fvgDirection ?? 'both',
    labTimeStopEnabled: cfg.labTimeStopEnabled ?? false,
    labTimeStopBars: cfg.labTimeStopBars ?? 4,
  };
}

/** Shows an orange dot next to a form field when its value differs from the clone source */
function DiffDot({ cur, base }: { cur: unknown; base: unknown }) {
  if (base === undefined || JSON.stringify(cur) === JSON.stringify(base)) return null;
  return <span style={{ color: '#f0b90b', fontSize: '0.65rem', marginLeft: 3, verticalAlign: 'middle' }} title="기준과 다름">●</span>;
}

function AddExperimentForm({ onAdd, onCancel, initialForm, diffBase }: {
  onAdd: (cfg: Omit<LabExperimentConfig, 'id'>) => void;
  onCancel: () => void;
  initialForm?: Partial<FormState>;
  /** When set, show diff dots next to changed fields */
  diffBase?: FormState;
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

  const isCloneMode = diffBase !== undefined;

  return (
    <div style={S.form}>
      <div style={{ ...S.formTitle, display: 'flex', alignItems: 'center', gap: 8 }}>
        {isCloneMode
          ? <><span>실험 복제</span><span style={{ fontSize: '0.72rem', color: '#f0b90b', fontWeight: 400 }}>● 표시 = 기준과 다른 필드</span></>
          : '새 실험 추가'}
      </div>

      <TuningGuide />
      <PresetCards strategy={form.strategyId} onApply={applyPreset} />

      <div style={S.formGrid}>
        {/* ── Step 1: Basic ── */}
        <SectionHead title="기본 설정" />

        <label style={S.formLabel}>이름</label>
        <input style={S.input} value={form.name} onChange={e => set('name', e.target.value)} />

        <label style={S.formLabel}>전략</label>
        <select style={S.input} value={form.strategyId}
          onChange={e => { set('strategyId', e.target.value as 'breakout' | 'leader-retest' | 'fvg-poc-ema72'); }}>
          <option value="breakout">돌파 (Breakout)</option>
          <option value="leader-retest">리더 리테스트</option>
          <option value="fvg-poc-ema72">FVG POC + EMA72</option>
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

          {form.strategyId === 'breakout' && <>
            <SectionHead title="브레이크아웃 필터 (실험용)" />

            <label style={S.formLabel}>스캔 방향<DiffDot cur={form.breakoutDirection} base={diffBase?.breakoutDirection} /></label>
            <select style={S.input} value={form.breakoutDirection}
              onChange={e => set('breakoutDirection', e.target.value as 'long' | 'short' | 'both')}>
              <option value="both">양방향</option>
              <option value="long">LONG만</option>
              <option value="short">SHORT만</option>
            </select>

            <label style={S.formLabel}>신호 유효시간(초)<DiffDot cur={form.maxSignalAgeSec} base={diffBase?.maxSignalAgeSec} /></label>
            <div>
              <input style={S.input} type="number" min={0} step={30} value={form.maxSignalAgeSec}
                onChange={e => set('maxSignalAgeSec', Number(e.target.value))} />
              <Helper text="스캔 지연이 N초 초과 시 해당 봉 진입 스킵. 0=비활성 (권장: 120~300)" />
            </div>

            <label style={S.formLabel}>이탈폭 한도(%)<DiffDot cur={form.maxBreakoutExtensionPct} base={diffBase?.maxBreakoutExtensionPct} /></label>
            <div>
              <input style={S.input} type="number" min={0} max={20} step={0.1} value={form.maxBreakoutExtensionPct}
                onChange={e => set('maxBreakoutExtensionPct', Number(e.target.value))} />
              <Helper text="|진입가-SL| / 진입가 × 100 초과 시 스킵. 0=비활성 (권장: 2~5%)" />
            </div>

            <label style={S.formLabel}>추격진입 한도(%)<DiffDot cur={form.maxEntryDriftPct} base={diffBase?.maxEntryDriftPct} /></label>
            <div>
              <input style={S.input} type="number" min={0} max={10} step={0.1} value={form.maxEntryDriftPct}
                onChange={e => set('maxEntryDriftPct', Number(e.target.value))} />
              <Helper text="현재 mark가 계획 진입가 대비 N% 이상 이탈 시 스킵. 0=비활성 (권장: 0.5~1.5%)" />
            </div>
          </>}

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

          {form.strategyId === 'fvg-poc-ema72' && <>
            <SectionHead title="FVG POC + EMA72 파라미터" />

            <label style={S.formLabel}>방향 스캔</label>
            <select style={S.input} value={form.fvgDirection}
              onChange={e => set('fvgDirection', e.target.value as 'long' | 'short' | 'both')}>
              <option value="both">양방향</option>
              <option value="long">LONG만</option>
              <option value="short">SHORT만</option>
            </select>

            <label style={S.formLabel}>POC 조회봉수</label>
            <div>
              <input style={S.input} type="number" min={100} max={1500} step={50} value={form.fvgPocLookbackBars}
                onChange={e => set('fvgPocLookbackBars', Number(e.target.value))} />
              <Helper text="FVG 수집 범위 (봉). 클수록 안정적인 POC, 느린 갱신 (기본 500)" />
            </div>

            <label style={S.formLabel}>히스토그램 구간</label>
            <div>
              <input style={S.input} type="number" min={10} max={200} step={5} value={form.fvgPocBins}
                onChange={e => set('fvgPocBins', Number(e.target.value))} />
              <Helper text="POC 히스토그램 bins 수. 많을수록 세밀한 POC (기본 40)" />
            </div>

            <label style={S.formLabel}>EMA 기간</label>
            <div>
              <input style={S.input} type="number" min={10} max={500} step={1} value={form.fvgEmaPeriod}
                onChange={e => set('fvgEmaPeriod', Number(e.target.value))} />
              <Helper text="추세 필터용 EMA 기간. LONG: close > EMA, SHORT: close < EMA (기본 72)" />
            </div>

            <label style={S.formLabel}>유니버스 상위</label>
            <div>
              <input style={S.input} type="number" min={10} max={300} step={10} value={form.fvgUniverseTopN}
                onChange={e => set('fvgUniverseTopN', Number(e.target.value))} />
              <Helper text="전일 거래대금 상위 N개 심볼만 스캔 (4h 캐시). 0이면 전체 (기본 100)" />
            </div>
          </>}

          <SectionHead title="진입 필터 (No-trade gate)" />

          <label style={S.formLabel}>4H 추세 필터</label>
          <div>
            <label style={S.checkLabel}>
              <input type="checkbox" checked={form.require4hTrend}
                onChange={e => set('require4hTrend', e.target.checked)} />
              <span>LONG 진입 시 4H EMA20 {'>'} EMA50 필요
                {(form.strategyId === 'breakout' || form.strategyId === 'fvg-poc-ema72') && <span style={{ color: '#5a7ba8' }}> (리테스트 전용)</span>}
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

          <label style={S.formLabel}>동방향 한도<DiffDot cur={form.maxConcurrentCorrelated} base={diffBase?.maxConcurrentCorrelated} /></label>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input style={{ ...S.input, width: 60 }} type="number" min={0} max={20}
                value={form.maxConcurrentCorrelated}
                onChange={e => set('maxConcurrentCorrelated', Number(e.target.value))} />
              <span style={{ fontSize: '0.75rem', color: '#6f7f95' }}>개 (0=비활성)</span>
            </div>
            <Helper text="같은 방향 동시 포지션 상한 · 한쪽 쏠림 방지" />
          </div>

          <SectionHead title="타임스탑 (lab only)" />

          <label style={S.formLabel}>타임스탑 ON<DiffDot cur={form.labTimeStopEnabled} base={diffBase?.labTimeStopEnabled} /></label>
          <div>
            <label style={S.checkLabel}>
              <input type="checkbox" checked={form.labTimeStopEnabled}
                onChange={e => set('labTimeStopEnabled', e.target.checked)} />
              <span>TP/SL 미도달 시 N봉 후 시장가 청산 (실전·모의 무관)</span>
            </label>
          </div>

          {form.labTimeStopEnabled && <>
            <label style={S.formLabel}>타임스탑 봉 수<DiffDot cur={form.labTimeStopBars} base={diffBase?.labTimeStopBars} /></label>
            <div>
              <input style={{ ...S.input, width: 70 }} type="number" min={1} max={50}
                value={form.labTimeStopBars}
                onChange={e => set('labTimeStopBars', Number(e.target.value))} />
              <Helper text="진입 후 N개 봉(스캔 인터벌 기준) 내 미청산 시 강제 종료" />
            </div>
          </>}
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
  for (const h of sorted) { bal += h.pnl; points.push(Math.max(0, bal)); }

  const lastBal = points[points.length - 1];
  const totalPnl = lastBal - initialBalance;
  const pnlPct = ((totalPnl / initialBalance) * 100).toFixed(2);
  const isProfit = lastBal >= initialBalance;
  const color = isProfit ? '#0ecb81' : '#f6465d';
  const gradId = `slg-${slotIndex}`;
  const CH = 52; // chart SVG height (pure curves, no text)

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  // SVG uses viewBox 0 0 100 CH with preserveAspectRatio="none"
  // X: 0..100 (percentage), Y: 0..CH
  const toX = (i: number) => (i / (points.length - 1)) * 100;
  const toY = (v: number) => CH - ((v - min) / range) * CH;

  const polyPoints = points.map((v, i) => `${toX(i).toFixed(2)},${toY(v).toFixed(2)}`).join(' ');
  const areaPath = [
    `M 0,${CH}`,
    ...points.map((v, i) => `L ${toX(i).toFixed(2)},${toY(v).toFixed(2)}`),
    `L 100,${CH} Z`,
  ].join(' ');
  const baseY = (toY(initialBalance) / CH * 100).toFixed(1); // % from top
  const maxTopPct = (toY(max) / CH * 100).toFixed(1);
  const minTopPct = (toY(min) / CH * 100).toFixed(1);
  const baseTopPct = parseFloat(baseY);
  const showBase = Math.abs(parseFloat(maxTopPct) - baseTopPct) > 12 && Math.abs(parseFloat(minTopPct) - baseTopPct) > 12;

  const firstDate = new Date(sorted[0].exitTime).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
  const lastDate = new Date(sorted[sorted.length - 1].exitTime).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
  const lblStyle: React.CSSProperties = { fontSize: '0.62rem', color: '#4a5e78', lineHeight: 1 };

  return (
    <div style={{ marginTop: 6, marginBottom: 4 }}>
      {/* Legend row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.67rem', marginBottom: 3 }}>
        <span style={{ color: '#5a7ba8' }}>자산 곡선 · {sorted.length}거래</span>
        <span style={{ color, fontWeight: 700 }}>{pf(totalPnl)} ({totalPnl >= 0 ? '+' : ''}{pnlPct}%)</span>
      </div>

      {/* Chart + Y labels */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
        {/* Y axis labels (HTML, not SVG → no stretching) */}
        <div style={{ position: 'relative', width: 32, flexShrink: 0 }}>
          <span style={{ ...lblStyle, position: 'absolute', top: `${maxTopPct}%`, right: 0, transform: 'translateY(-50%)' }}>{fmtShortBalance(max)}</span>
          {showBase && <span style={{ ...lblStyle, position: 'absolute', top: `${baseTopPct}%`, right: 0, transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.2)' }}>{fmtShortBalance(initialBalance)}</span>}
          <span style={{ ...lblStyle, position: 'absolute', top: `${minTopPct}%`, right: 0, transform: 'translateY(-50%)' }}>{fmtShortBalance(min)}</span>
        </div>

        {/* SVG: only curves, no text → stretches cleanly */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <svg width="100%" height={CH} viewBox={`0 0 100 ${CH}`} preserveAspectRatio="none"
            style={{ display: 'block', borderLeft: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {/* Baseline dashed */}
            <line x1="0" y1={toY(initialBalance).toFixed(2)} x2="100" y2={toY(initialBalance).toFixed(2)}
              stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
            <path d={areaPath} fill={`url(#${gradId})`} />
            <polyline points={polyPoints} fill="none" stroke={color} strokeWidth="1.2"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx={toX(points.length - 1).toFixed(2)} cy={toY(lastBal).toFixed(2)} r="1.5" fill={color} vectorEffect="non-scaling-stroke" />
          </svg>

          {/* X axis labels (HTML) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={lblStyle}>{firstDate}</span>
            <span style={lblStyle}>{sorted.length}거래</span>
            <span style={lblStyle}>{lastDate}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat cell (grid-based) ─────────────────────────────────────────────────────
function StatCell({ label, value, color, large }: { label: string; value: string; color?: string; large?: boolean }) {
  return (
    <div style={{ padding: '5px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: '0.62rem', color: '#5a7ba8', marginBottom: 2, letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: large ? '0.88rem' : '0.78rem', fontWeight: 700, color: color ?? '#d0d8e4', letterSpacing: large ? '-0.02em' : undefined }}>{value}</div>
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
              {cfg.labTimeStopEnabled && cfg.labTimeStopBars && cfg.labTimeStopBars > 0
                ? <div style={{ color: '#b0b070', marginTop: 4 }}>⏱ 타임스탑 {cfg.labTimeStopBars}봉 — TP/SL 미도달 시 시장가 청산</div>
                : <div style={{ color: '#8a6030', marginTop: 4 }}>⚠ 타임스탑 없음 — TP/SL 미도달 시 무기한 보유</div>
              }
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

// ── Experiment card ───────────────────────────────────────────────────────────
function ExperimentCard({ exp, onToggle, onRemove, onResetBalance, onClearHistory, onClone, baseline, isBaseline, onSetBaseline, isBest }: {
  exp: LabExperiment;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onResetBalance: () => void;
  onClearHistory: () => void;
  onClone: () => void;
  baseline: LabExperiment | null;
  isBaseline: boolean;
  onSetBaseline: () => void;
  isBest: boolean;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const [hovered, setHovered] = useState(false);
  const cfg = exp.config!;
  const s = exp.stats;
  const pnlColor = s.totalPnl >= 0 ? '#0ecb81' : '#f6465d';
  const isRetest = cfg.strategyId === 'leader-retest';
  const configDiffs = baseline && !isBaseline ? getConfigDiffs(cfg, baseline.config!) : [];
  const diagnosis = baseline && !isBaseline ? getDiagnosis(exp, baseline) : '';
  const accentColor = isRetest ? '#c47cf7' : '#3b8beb';
  const accentRgb = isRetest ? '196,124,247' : '59,139,235';

  const cardWarnings = detectWarnings(
    cfg.strategyId, cfg.direction, cfg.leverage, cfg.riskPct,
    cfg.require4hTrend ?? true, cfg.cooldownBarsAfterLoss ?? 0,
    cfg.maxConcurrentCorrelatedPositions ?? 0, cfg.maxPositions,
  );

  const cardStyle: React.CSSProperties = {
    ...S.card,
    background: `linear-gradient(145deg, #0d1520 0%, #101825 60%, rgba(${accentRgb},0.04) 100%)`,
    borderColor: isBest ? '#0ecb81' : hovered ? `rgba(${accentRgb},0.45)` : cfg.enabled ? `rgba(${accentRgb},0.25)` : '#1e2d45',
    boxShadow: isBest
      ? undefined  // animation handles the shadow
      : hovered
        ? `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(${accentRgb},0.2), inset 0 1px 0 rgba(${accentRgb},0.08)`
        : cfg.enabled
          ? `0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(${accentRgb},0.05)`
          : '0 1px 6px rgba(0,0,0,0.2)',
    animation: isBest ? 'labBestGlow 2s ease-in-out infinite' : undefined,
    transform: hovered ? 'translateY(-1px)' : 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.15s',
  };

  return (
    <div style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>

      {/* Header */}
      <div style={S.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
          <div style={{
            ...S.dot,
            background: cfg.enabled ? '#0ecb81' : '#6f7f95',
            boxShadow: cfg.enabled ? '0 0 6px #0ecb81' : 'none',
            animation: exp.scanning ? 'labScanDotPulse 1s ease-in-out infinite' : 'none',
          }} />
          <span style={S.cardName}>{cfg.name}</span>
          <span style={{ ...S.badge, color: accentColor, borderColor: `rgba(${accentRgb},0.35)`, background: `rgba(${accentRgb},0.08)` }}>
            {isRetest ? '리테스트' : '돌파'}
          </span>
          {isBaseline && <span style={{ ...S.badge, color: '#f0b90b', borderColor: 'rgba(240,185,11,0.4)', background: 'rgba(240,185,11,0.08)' }}>★ 기준</span>}
          {exp.scanning && <span className="lab-scanning-badge" style={{ ...S.badge, color: '#f0b90b', borderColor: 'rgba(240,185,11,0.3)', background: 'rgba(240,185,11,0.08)' }}>스캔중</span>}
          {cardWarnings.length > 0 && <span style={{ ...S.badge, color: '#c8a640', borderColor: 'rgba(200,166,64,0.3)' }}>주의</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button style={{ ...S.tinyBtn, ...(cfg.enabled ? S.tinyBtnOff : S.tinyBtnOn) }}
            onClick={() => onToggle(!cfg.enabled)}>
            {cfg.enabled ? '중지' : '시작'}
          </button>
          <button style={S.tinyBtnDanger} onClick={onRemove}>삭제</button>
        </div>
      </div>

      {/* Primary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, marginBottom: s.positionCount > 0 ? 0 : 6, background: 'rgba(255,255,255,0.03)', borderRadius: s.positionCount > 0 ? '6px 6px 0 0' : 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', borderBottom: s.positionCount > 0 ? 'none' : undefined }}>
        <StatCell label="총자산" value={`${Number(s.balance.toFixed(0)).toLocaleString()} USDT`} />
        <StatCell label="수익률" value={`${s.pnlPct.toFixed(2)}%`} color={pnlColor} large />
        <StatCell label="실현손익" value={pf(s.totalPnl)} color={s.totalPnl >= 0 ? '#0ecb81' : '#f6465d'} />
        <StatCell label="승률" value={`${s.winRate.toFixed(1)}%`} />
        <StatCell label="거래수" value={String(s.historyCount)} />
        <StatCell label="포지션" value={String(s.positionCount)} color={s.positionCount > 0 ? accentColor : undefined} />
      </div>

      {/* Balance breakdown row (only when positions open) */}
      {s.positionCount > 0 && (() => {
        const uPnlColor = s.unrealizedPnl >= 0 ? '#0ecb81' : '#f6465d';
        const hasUPnl = s.unrealizedPnl !== 0;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, marginBottom: 6, background: 'rgba(255,255,255,0.015)', borderRadius: '0 0 6px 6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <StatCell label="마진잔고" value={`${Number(s.availableBalance.toFixed(0)).toLocaleString()}`} />
            <StatCell label="미실현PnL" value={hasUPnl ? pf(s.unrealizedPnl) : '대기중'} color={hasUPnl ? uPnlColor : '#6f7f95'} />
            <StatCell label="투입마진합계" value={`${Number((s.balance - s.availableBalance - s.unrealizedPnl).toFixed(0)).toLocaleString()}`} />
          </div>
        );
      })()}

      {/* Secondary stats */}
      {s.historyCount > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, marginBottom: 6, background: 'rgba(255,255,255,0.02)', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.04)' }}>
          <StatCell label="TP" value={`${s.tpRate.toFixed(0)}%`} color="#0ecb81" />
          <StatCell label="SL" value={`${s.slRate.toFixed(0)}%`} color="#f6465d" />
          <StatCell label="타임스탑" value={`${s.expiredRate.toFixed(0)}%`} color="#f0b90b" />
          <StatCell label="평균보유" value={fmtHoldTime(s.avgHoldMs)} />
          <StatCell label="연속손실" value={String(s.maxConsecLoss)} color={s.maxConsecLoss >= 3 ? '#f6465d' : undefined} />
        </div>
      )}

      {/* Equity chart */}
      <MiniEquityChart history={exp.paper.history} initialBalance={cfg.initialBalance} slotIndex={exp.slotIndex} />

      {/* Open positions */}
      {exp.paper.positions.length > 0 && (
        <div style={{ marginTop: 6, marginBottom: 4, background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden' }}>
          <div style={{ fontSize: '0.67rem', color: '#6f7f95', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            보유 포지션 ({exp.paper.positions.length})
          </div>
          {exp.paper.positions.map((pos, idx) => {
            const mark = exp.markPrices[pos.symbol] ?? 0;
            const qty = Math.abs(pos.positionAmt);
            const rawPnl = mark > 0
              ? (pos.positionSide === 'LONG' ? mark - pos.entryPrice : pos.entryPrice - mark) * qty - pos.entryPrice * qty * 0.0004 - mark * qty * 0.0004
              : null;
            const posColor = pos.positionSide === 'LONG' ? '#0ecb81' : '#f6465d';
            const pnlCol = rawPnl == null ? '#848e9c' : rawPnl >= 0 ? '#0ecb81' : '#f6465d';
            const pnlStr = rawPnl == null ? '—' : (rawPnl >= 0 ? '+' : '') + rawPnl.toFixed(2);
            const entryT = new Date(pos.entryTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            const margin = pos.isolatedMargin;

            // Time-stop remaining (only show if explicitly enabled)
            let tsLabel: string | null = null;
            if (cfg.labTimeStopEnabled === true && cfg.labTimeStopBars != null && cfg.labTimeStopBars > 0) {
              const scanIv = (pos.altMeta?.scanInterval ?? cfg.scanIntervals[0]) as string;
              const ivMs = INTERVAL_MS[scanIv] ?? 3_600_000;
              const maxHoldMs = cfg.labTimeStopBars * ivMs;
              const elapsed = Date.now() - pos.entryTime;
              const remaining = maxHoldMs - elapsed;
              if (remaining <= 0) {
                tsLabel = '⏱ 초과';
              } else {
                const rh = Math.floor(remaining / 3_600_000);
                const rm = Math.floor((remaining % 3_600_000) / 60_000);
                tsLabel = `⏱ ${rh > 0 ? `${rh}h ` : ''}${rm}m 남음`;
              }
            }

            return (
              <div key={pos.id} className="lab-pos-row" style={{
                padding: '5px 8px',
                borderBottom: idx < exp.paper.positions.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                borderLeft: `2px solid ${posColor}`,
                background: rawPnl != null && rawPnl > 0 ? 'rgba(14,203,129,0.03)' : rawPnl != null && rawPnl < 0 ? 'rgba(246,70,93,0.03)' : 'transparent',
              }}>
                {/* Row 1: side / symbol / leverage / entry price / unrealized pnl */}
                <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto auto auto', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: '0.68rem', fontWeight: 800, color: posColor }}>{pos.positionSide === 'LONG' ? 'L' : 'S'}</span>
                  <span style={{ fontSize: '0.76rem', color: '#d0d8e4', fontWeight: 700 }}>{pos.symbol.replace('USDT', '')}</span>
                  <span style={{ fontSize: '0.67rem', color: '#5a7ba8' }}>{pos.leverage}x</span>
                  <span style={{ fontSize: '0.67rem', color: '#6f7f95' }}>{pos.entryPrice < 1 ? pos.entryPrice.toFixed(6) : pos.entryPrice.toFixed(2)}</span>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: pnlCol, minWidth: 56, textAlign: 'right' }}>{pnlStr}</span>
                </div>
                {/* Row 2: entry time / invested margin / ROI / timestop */}
                <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.65rem', color: '#4a5e78' }}>진입 {entryT}</span>
                  <span style={{ fontSize: '0.65rem', color: '#4a5e78' }}>투입 {margin.toFixed(1)} USDT</span>
                  {rawPnl != null && margin > 0 && (
                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: rawPnl >= 0 ? '#0ecb81' : '#f6465d' }}>
                      ROI {rawPnl >= 0 ? '+' : ''}{(rawPnl / margin * 100).toFixed(1)}%
                    </span>
                  )}
                  {tsLabel && (
                    <span style={{ fontSize: '0.65rem', color: tsLabel.includes('초과') ? '#f6465d' : '#f0b90b', fontWeight: 600 }}>{tsLabel}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Meta */}
      <div style={{ ...S.cardMeta, marginTop: 4, padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <span>{cfg.scanIntervals.join('·')} · {cfg.direction === 'both' ? '양방향' : cfg.direction.toUpperCase()} · {cfg.leverage}x · 리스크{cfg.riskPct}% · {cfg.minScore}점+</span>
        <span style={{ color: '#4a5e78' }}>
          {exp.lastRunTime ? `최근: ${fmtTime(exp.lastRunTime)}` : ''}
          {exp.nextRunTime ? ` · 다음: ${fmtTime(exp.nextRunTime)}` : ''}
        </span>
      </div>

      {/* Diff badges & diagnosis */}
      {configDiffs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
          {configDiffs.map((d, i) => (
            <span key={i} style={{ background: 'rgba(240,185,11,0.1)', border: '1px solid rgba(240,185,11,0.3)', borderRadius: 4, fontSize: '0.67rem', color: '#d4a820', padding: '1px 5px' }}>{d}</span>
          ))}
        </div>
      )}
      {diagnosis && <div style={{ marginTop: 3, fontSize: '0.7rem', color: '#6a9ab0', fontStyle: 'italic' }}>↳ {diagnosis}</div>}

      <OperationSummary cfg={cfg} expanded={showOps} onToggle={() => setShowOps(v => !v)} />

      {cardWarnings.length > 0 && (
        <div style={{ marginTop: 4, fontSize: '0.69rem', color: '#9a7a30', lineHeight: 1.5 }}>
          {cardWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        <button style={{ ...S.ghostBtn, ...(isBaseline ? { color: '#f0b90b', borderColor: 'rgba(240,185,11,0.4)', background: 'rgba(240,185,11,0.06)' } : {}) }}
          onClick={onSetBaseline}>{isBaseline ? '★ 기준' : '기준 설정'}</button>
        <button style={S.ghostBtn} onClick={onClone}>복제</button>
        <button style={{ ...S.ghostBtn, ...(showLogs && exp.logs.length > 0 ? { color: accentColor, borderColor: `rgba(${accentRgb},0.4)` } : {}) }}
          onClick={() => setShowLogs(v => !v)}>
          로그{exp.logs.length > 0 ? `(${exp.logs.length})` : ''}
        </button>
        <button style={S.ghostBtn} onClick={onResetBalance}>잔고초기화</button>
        <button style={S.ghostBtn} onClick={onClearHistory}>히스토리삭제</button>
      </div>

      {showLogs && (
        <div style={S.logBox}>
          {exp.logs.length === 0
            ? <div style={{ color: '#6f7f95' }}>없음</div>
            : exp.logs.map((l, i) => (
              <div key={i} style={{ lineHeight: 1.6, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 2, marginBottom: 2, color: l.includes('진입') ? '#a0c4ff' : l.includes('종료') ? (l.includes('+') ? '#0ecb81' : '#f6465d') : '#90a3bc' }}>{l}</div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────
function Δ({ val, base, higherBetter = true, fmt = (v: number) => v.toFixed(2) }: {
  val: number; base: number | undefined; higherBetter?: boolean; fmt?: (v: number) => string;
}) {
  if (base === undefined) return null;
  const d = val - base;
  if (Math.abs(d) < 0.005) return null;
  const good = higherBetter ? d > 0 : d < 0;
  const sign = d > 0 ? '+' : '';
  return <span style={{ color: good ? '#0ecb81' : '#f6465d', fontSize: '0.67rem', marginLeft: 3 }}>{sign}{fmt(d)}</span>;
}

function ComparisonTable({ experiments, baselineSlot }: { experiments: LabExperiment[]; baselineSlot: number | null }) {
  const active = experiments.filter(e => e.config !== null);
  if (active.length < 2) return null;
  const baseline = baselineSlot !== null ? active.find(e => e.slotIndex === baselineSlot) : null;
  const bs = baseline?.stats;
  const headers = ['이름', '전략', '수익률', '순이익', '승률', '거래', 'TP%', '손절%', '타임스탑%', '평균보유', '연속손실'];
  return (
    <div style={{ marginTop: 14 }}>
      <div style={S.sectionTitle}>
        비교 요약
        {baseline && <span style={{ fontSize: '0.71rem', color: '#f0b90b', fontWeight: 400, marginLeft: 6 }}>Δ = 기준({baseline.config!.name}) 대비</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr>{headers.map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {active.map(exp => {
              const cfg = exp.config!;
              const s = exp.stats;
              const pc = s.totalPnl >= 0 ? '#0ecb81' : '#f6465d';
              const isBl = exp.slotIndex === baselineSlot;
              return (
                <tr key={exp.slotIndex} style={isBl ? { background: 'rgba(240,185,11,0.04)' } : undefined}>
                  <td style={S.td}>{isBl ? '★ ' : ''}{cfg.name}</td>
                  <td style={S.td}>{cfg.strategyId === 'leader-retest' ? '리테스트' : cfg.strategyId === 'fvg-poc-ema72' ? 'FVG POC' : '돌파'}</td>
                  <td style={{ ...S.td, color: pc }}>{s.pnlPct.toFixed(2)}%<Δ val={s.pnlPct} base={bs?.pnlPct} /></td>
                  <td style={{ ...S.td, color: pc }}>{pf(s.totalPnl)}<Δ val={s.totalPnl} base={bs?.totalPnl} fmt={v => v.toFixed(0)} /></td>
                  <td style={S.td}>{s.winRate.toFixed(1)}%<Δ val={s.winRate} base={bs?.winRate} /></td>
                  <td style={S.td}>{s.historyCount}<Δ val={s.historyCount} base={bs?.historyCount} fmt={v => v.toFixed(0)} /></td>
                  <td style={{ ...S.td, color: '#0ecb81' }}>{s.tpRate.toFixed(0)}%<Δ val={s.tpRate} base={bs?.tpRate} fmt={v => v.toFixed(0)} /></td>
                  <td style={{ ...S.td, color: '#f6465d' }}>{s.slRate.toFixed(0)}%<Δ val={s.slRate} base={bs?.slRate} higherBetter={false} fmt={v => v.toFixed(0)} /></td>
                  <td style={{ ...S.td, color: '#f0b90b' }}>{s.expiredRate.toFixed(0)}%<Δ val={s.expiredRate} base={bs?.expiredRate} fmt={v => v.toFixed(0)} /></td>
                  <td style={S.td}>{fmtHoldTime(s.avgHoldMs)}</td>
                  <td style={{ ...S.td, color: s.maxConsecLoss >= 3 ? '#f6465d' : undefined }}>{s.maxConsecLoss}<Δ val={s.maxConsecLoss} base={bs?.maxConsecLoss} higherBetter={false} fmt={v => v.toFixed(0)} /></td>
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
// ── Config diff helpers ────────────────────────────────────────────────────────
function getConfigDiffs(cfg: LabExperimentConfig, baseline: LabExperimentConfig): string[] {
  const d: string[] = [];
  if (cfg.direction !== baseline.direction) d.push(`방향:${cfg.direction === 'both' ? '양방향' : cfg.direction.toUpperCase()}`);
  if (cfg.minScore !== baseline.minScore) d.push(`점수:${cfg.minScore}`);
  if (cfg.leverage !== baseline.leverage) d.push(`레버:${cfg.leverage}x`);
  if (cfg.riskPct !== baseline.riskPct) d.push(`리스크:${cfg.riskPct}%`);
  if (cfg.require4hTrend !== baseline.require4hTrend) d.push(`4H추세:${cfg.require4hTrend ? 'ON' : 'OFF'}`);
  if ((cfg.cooldownBarsAfterLoss ?? 0) !== (baseline.cooldownBarsAfterLoss ?? 0)) d.push(`쿨다운:${cfg.cooldownBarsAfterLoss ?? 0}`);
  if ((cfg.maxConcurrentCorrelatedPositions ?? 0) !== (baseline.maxConcurrentCorrelatedPositions ?? 0)) d.push(`동방향≤${cfg.maxConcurrentCorrelatedPositions ?? '∞'}`);
  if (!!cfg.labTimeStopEnabled !== !!baseline.labTimeStopEnabled || (cfg.labTimeStopEnabled && cfg.labTimeStopBars !== baseline.labTimeStopBars))
    d.push(`타임스탑:${cfg.labTimeStopEnabled ? `${cfg.labTimeStopBars}봉` : 'OFF'}`);
  if (cfg.strategyId === 'breakout') {
    if ((cfg.maxBreakoutExtensionPct ?? 0) !== (baseline.maxBreakoutExtensionPct ?? 0)) d.push(`이탈폭≤${cfg.maxBreakoutExtensionPct ?? '∞'}%`);
    if ((cfg.maxEntryDriftPct ?? 0) !== (baseline.maxEntryDriftPct ?? 0)) d.push(`추격≤${cfg.maxEntryDriftPct ?? '∞'}%`);
    if ((cfg.breakoutDirection ?? 'both') !== (baseline.breakoutDirection ?? 'both')) d.push(`방향:${cfg.breakoutDirection ?? 'both'}`);
  }
  return d;
}

function getDiagnosis(exp: LabExperiment, baseline: LabExperiment): string {
  if (exp.stats.historyCount === 0 || baseline.stats.historyCount === 0) return '';
  const s = exp.stats; const b = baseline.stats;
  const parts: string[] = [];
  if (s.historyCount < b.historyCount * 0.7) parts.push('거래 수 감소');
  else if (s.historyCount > b.historyCount * 1.3) parts.push('거래 수 증가');
  if (s.slRate < b.slRate - 5) parts.push('손절 비율 개선');
  if (s.tpRate > b.tpRate + 5) parts.push('TP 도달률 향상');
  if (s.expiredRate > b.expiredRate + 10) parts.push('타임스탑 증가');
  if (s.avgHoldMs < b.avgHoldMs * 0.75) parts.push('평균 보유시간 감소');
  if (s.maxConsecLoss < b.maxConsecLoss - 1) parts.push('연속손실 감소');
  if (s.pnlPct > b.pnlPct + 2) parts.push('수익률 향상');
  else if (s.pnlPct < b.pnlPct - 2) parts.push('수익률 하락');
  return parts.length > 0 ? parts.join(' · ') : '기준 대비 유의미한 차이 없음';
}

export function StrategyLabPanel({ lab }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [cloneBase, setCloneBase] = useState<Partial<FormState> | undefined>(undefined);
  const [cloneDiffBase, setCloneDiffBase] = useState<FormState | undefined>(undefined);
  const [baselineSlot, setBaselineSlot] = useState<number | null>(null);

  const handleAdd = (cfg: Omit<LabExperimentConfig, 'id'>) => {
    lab.addExperiment(cfg);
    setShowAddForm(false);
    setCloneBase(undefined);
    setCloneDiffBase(undefined);
  };

  const handleClone = (exp: LabExperiment) => {
    if (!exp.config || !lab.canAdd) return;
    const base = configToForm(exp.config);
    const sourceForm = { ...base };
    base.name = `${exp.config.name} copy`;
    setCloneBase(base);
    setCloneDiffBase(sourceForm);
    setShowAddForm(true);
  };

  const baselineExp = baselineSlot !== null
    ? lab.experiments.find(e => e.slotIndex === baselineSlot && e.config !== null) ?? null
    : null;

  // Inject CSS animations once
  useEffect(() => {
    const id = 'lab-styles';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = `
      @keyframes labScanDotPulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 6px #0ecb81; }
        50% { opacity: 0.5; box-shadow: 0 0 2px #0ecb81; }
      }
      @keyframes labScanBadge {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .lab-scanning-badge { animation: labScanBadge 1s ease-in-out infinite; }
      @keyframes labPosIn {
        from { opacity: 0; transform: translateX(-6px); }
        to   { opacity: 1; transform: translateX(0); }
      }
      .lab-pos-row { animation: labPosIn 0.25s ease-out; }
      @keyframes labBestGlow {
        0%, 100% { box-shadow: 0 0 8px 2px rgba(14,203,129,0.35), 0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(14,203,129,0.08); }
        50%       { box-shadow: 0 0 20px 6px rgba(14,203,129,0.6),  0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(14,203,129,0.15); }
      }
    `;
    document.head.appendChild(el);
  }, []);

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
          onCancel={() => { setShowAddForm(false); setCloneBase(undefined); setCloneDiffBase(undefined); }}
          initialForm={cloneBase}
          diffBase={cloneDiffBase}
        />
      )}

      {lab.activeCount === 0 && !showAddForm && (
        <div style={S.empty}>
          실험이 없습니다.<br />
          '+ 실험 추가' → 프리셋 선택 → 한두 가지 파라미터만 바꿔 A/B 비교해보세요.
        </div>
      )}

      {/* Find best-performing slot (highest pnlPct > 0) */}
      {(() => {
        const activeExps = lab.experiments.filter(e => e.config !== null);
        let bestSlot: number | null = null;
        let bestPct = 0;
        for (const e of activeExps) {
          if (e.stats.pnlPct > bestPct) { bestPct = e.stats.pnlPct; bestSlot = e.slotIndex; }
        }

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, alignItems: 'start' }}>
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
                    if (baselineSlot === exp.slotIndex) setBaselineSlot(null);
                  }}
                  onResetBalance={() => exp.paper.resetBalance(exp.config!.initialBalance)}
                  onClearHistory={() => exp.paper.clearHistory()}
                  onClone={() => handleClone(exp)}
                  baseline={baselineExp}
                  isBaseline={exp.slotIndex === baselineSlot}
                  onSetBaseline={() => setBaselineSlot(prev => prev === exp.slotIndex ? null : exp.slotIndex)}
                  isBest={exp.slotIndex === bestSlot}
                />
              );
            })}
          </div>
        );
      })()}

      <ComparisonTable experiments={lab.experiments} baselineSlot={baselineSlot} />
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
  card: { background: '#0d1520', border: '1px solid #1e2d45', borderRadius: 10, padding: '12px 14px', cursor: 'default' },
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
