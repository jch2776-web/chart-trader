import { useState, useEffect, useRef, useCallback } from 'react';
import { runBreakoutScan } from '../components/AltScanner/breakoutScanner';
import type { ScanCandidate, ScanInterval } from '../components/AltScanner/breakoutScanner';
import { createLeaderRetestScan } from '../components/AltScanner/strategies/leaderRetest';
import type { RetestOptions } from '../components/AltScanner/strategies/leaderRetest';
import { createFvgPocEma72Scan } from '../components/AltScanner/strategies/fvgPocEma72';
import type { FvgPocOptions } from '../components/AltScanner/strategies/fvgPocEma72';
import type { ScanFn } from '../components/AltScanner/strategyTypes';
import { getBinanceGovernorSnapshot } from '../lib/binanceRequestGovernor';
import { subscribeBookTicker, getSpreadBps, unsubscribeBookTicker } from '../lib/binanceBookTicker';

/** Price formatter: ≥1 uses 2dp, otherwise 6dp (handles small-cap crypto). */
function fmtPrice(p: number): string {
  return p >= 1 ? p.toFixed(2) : p.toFixed(6);
}

/**
 * Discriminated union describing how position size is determined.
 * Used to generalize the absolute-loss gate across both size modes.
 */
export type SizingHint =
  | { mode: 'margin'; notionalUsd: number }   // qty = notionalUsd / entryPrice
  | { mode: 'risk';   riskAmountUsd: number }; // absLoss = riskAmountUsd (fixed)

/**
 * Estimates planned absolute loss in USD given the sizing hint and the
 * distance-based risk fraction (|entry - hardStop| / entry).
 *
 * Returns undefined when estimation is impossible (e.g. hint is absent or
 * required values are zero/invalid).
 */
function estimatePlannedAbsLossUsd(hint: SizingHint | undefined, riskFrac: number): number | undefined {
  if (hint == null) return undefined;
  if (hint.mode === 'margin') {
    if (hint.notionalUsd <= 0) return undefined;
    return riskFrac * hint.notionalUsd;
  }
  // risk mode: absolute loss is fixed (= riskAmount); riskFrac is already embedded in qty.
  if (hint.riskAmountUsd <= 0) return undefined;
  return hint.riskAmountUsd;
}

const AUTO_TRADE_KEY   = 'alt_auto_trade_active';
const DEFAULT_SCAN_INTERVALS: ScanInterval[] = ['1h', '4h', '1d'];
const DEFAULT_CADENCE_MINUTES = 60;
// Rate-limit settings for automated (unattended) scanning.
// leader-retest costs ~4 wt/symbol (klines limit=302 → wt4), plus other concurrent requests
// (price feeds, position monitor) push total above 2400/min when concurrency is too high.
// Binance Futures IP limit: 2400 weight/min = 40 weight/sec (rolling).
// concurrency=2, delayMs=450, avg HTTP=250ms → effective delay ≈ 700ms per batch
//   → throughput ≈ 2/700ms = 2.9 sym/sec × 4 wt = 11.4 wt/sec = 685 wt/min → safe with margin
const AUTO_CONCURRENCY = 2;
const AUTO_DELAY_MS    = 450;
const BETWEEN_SCAN_MS  = 500;
const SCHEDULE_CHECK_INTERVAL_MS = 1_000;

export interface AutoTradeLog {
  id: number;
  time: number;
  msg: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

export type ScanLifecycleEvent =
  | { type: 'interval_start'; interval: ScanInterval; symbolCount: number; boundaryTime: number; mode: 'scheduled' | 'manual' }
  | { type: 'interval_done';  interval: ScanInterval; total: number; qualified: number; triggeredCount?: number; entered: number }
  | { type: 'scan_done';      totalEntered: number; intervals: ScanInterval[]; mode: 'scheduled' | 'manual' };

let logSeq = 0;

function normalizeCadenceMinutes(v?: number): number {
  if (!Number.isFinite(v)) return DEFAULT_CADENCE_MINUTES;
  return Math.max(15, Math.round(v!));
}

function intervalToMinutes(iv: ScanInterval): number {
  if (iv === '15m') return 15;
  if (iv === '1h') return 60;
  if (iv === '4h') return 240;
  return 1440;
}

function intervalToMs(iv: ScanInterval): number {
  return intervalToMinutes(iv) * 60_000;
}

function sortIntervalsByPriority(intervals: ScanInterval[]): ScanInterval[] {
  return [...intervals].sort((a, b) => intervalToMinutes(a) - intervalToMinutes(b));
}

function getSlotMs(cadenceMinutes: number): number {
  return normalizeCadenceMinutes(cadenceMinutes) * 60_000;
}

function getCurrentSlot(ts: number, cadenceMinutes: number): number {
  return Math.floor(ts / getSlotMs(cadenceMinutes));
}

function getSlotStart(ts: number, cadenceMinutes: number): number {
  const slotMs = getSlotMs(cadenceMinutes);
  return Math.floor(ts / slotMs) * slotMs;
}

function getNextBoundary(ts: number, cadenceMinutes: number): number {
  const slotMs = getSlotMs(cadenceMinutes);
  return Math.floor(ts / slotMs) * slotMs + slotMs;
}

function getDueIntervals(boundaryTime: number, selected: ScanInterval[]): ScanInterval[] {
  const ordered = sortIntervalsByPriority(selected);
  return ordered.filter((iv) => boundaryTime % intervalToMs(iv) === 0);
}

export function useAltAutoTrade({
  symbols,
  onEnterTrade,
  onLog,
  onScanEvent,
  enterLabel = '진입',
  scanIntervals,
  cadenceMinutes,
  maxAutoPositionsPerScan,
  strategyId,
  retestOptions,
  retestAutoDirection,
  fvgOptions,
  breakoutDirection,
  minCandidateScore,
  breakoutMaxBarsAfterTrigger,
  maxSpreadBps,
  maxRiskPct,
  maxAbsLossUsd,
  sizingHint,
}: {
  symbols: string[];
  onEnterTrade: (candidate: ScanCandidate) => void;
  onLog?: (msg: string, type: AutoTradeLog['type']) => void;
  onScanEvent?: (event: ScanLifecycleEvent) => void;
  enterLabel?: string;
  scanIntervals?: ScanInterval[];
  cadenceMinutes?: number;
  maxAutoPositionsPerScan?: number;
  /** Strategy to use for scanning. Default 'breakout' preserves legacy behavior. */
  strategyId?: string;
  /** Retest options — only used when strategyId === 'leader-retest' */
  retestOptions?: RetestOptions;
  /** Scan direction override for leader-retest auto-trade (default 'long') */
  retestAutoDirection?: 'long' | 'both';
  /** FVG POC options — only used when strategyId === 'fvg-poc-ema72' */
  fvgOptions?: FvgPocOptions;
  /** Scan direction override for breakout auto-trade (default 'both') */
  breakoutDirection?: 'long' | 'short' | 'both';
  /** Minimum candidate score to qualify for auto-entry (default 90) */
  minCandidateScore?: number;
  /** Breakout only: 0 = same bar only, 1 = next bar too, N = N bars later allowed (default 0) */
  breakoutMaxBarsAfterTrigger?: number;
  /**
   * Leader-retest Gate 3: block entry when ScanCandidate.spreadBps exceeds this value.
   * Only fires when spreadBps is populated (real-time order-book data available).
   * Default 4 bps. Set to 0 to disable.
   */
  maxSpreadBps?: number;
  /**
   * Leader-retest Gate 4: block entry when wick-stop distance exceeds this fraction of idealEntry.
   * riskPct = |idealEntry − hardStop| / idealEntry.
   * Default 0.025 (2.5 %). Set to 0 to disable.
   */
  maxRiskPct?: number;
  /**
   * Leader-retest Gate 5: block entry when estimated absolute loss exceeds this USD amount.
   * Works for both 'margin' and 'risk' size modes via SizingHint.
   * Only active when maxAbsLossUsd > 0 AND sizingHint is provided.
   */
  maxAbsLossUsd?: number;
  /**
   * Sizing hint used for Gate 5 absolute-loss estimation.
   * Pass { mode:'margin', notionalUsd: marginUsdt×leverage } or
   *      { mode:'risk',   riskAmountUsd: balance×riskPct/100 }.
   * Omit to disable Gate 5.
   */
  sizingHint?: SizingHint;
}) {
  const [isActive, setIsActiveState] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTO_TRADE_KEY) === 'true'; } catch { return false; }
  });
  const [scanning,    setScanning]    = useState(false);
  const [logs,        setLogs]        = useState<AutoTradeLog[]>([]);
  const [lastRunTime, setLastRunTime] = useState<number | null>(null);
  const [nextRunTime, setNextRunTime] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<{ interval: string; done: number; total: number } | null>(null);

  // Refs so callbacks always see fresh values without stale closures
  const isActiveRef               = useRef(isActive);
  const symbolsRef                = useRef(symbols);
  const onEnterRef                = useRef(onEnterTrade);
  const onLogRef                  = useRef(onLog);
  const onScanEventRef            = useRef(onScanEvent);
  const enterLabelRef             = useRef(enterLabel);
  const scanIntervalsRef          = useRef(scanIntervals ?? DEFAULT_SCAN_INTERVALS);
  const cadenceRef                = useRef(normalizeCadenceMinutes(cadenceMinutes));
  const maxAutoPositionsRef       = useRef(maxAutoPositionsPerScan ?? 0); // 0 = unlimited
  const scanningRef               = useRef(false);
  const lastRunSlotRef            = useRef<number>(-1);
  const strategyIdRef             = useRef(strategyId ?? 'breakout');
  const retestOptionsRef          = useRef(retestOptions);
  const retestAutoDirectionRef    = useRef<'long' | 'both'>(retestAutoDirection ?? 'long');
  const fvgOptionsRef             = useRef(fvgOptions);
  const breakoutDirectionRef      = useRef<'long' | 'short' | 'both'>(breakoutDirection ?? 'both');
  const scoreThresholdRef         = useRef(minCandidateScore ?? (strategyId === 'leader-retest' ? 70 : strategyId === 'fvg-poc-ema72' ? 75 : 90));
  const maxBarsAfterTriggerRef    = useRef(breakoutMaxBarsAfterTrigger ?? 0);
  const maxSpreadBpsRef           = useRef(maxSpreadBps ?? 4);
  const maxRiskPctRef             = useRef(maxRiskPct ?? 0.025);
  const maxAbsLossUsdRef          = useRef(maxAbsLossUsd ?? 0);
  const sizingHintRef             = useRef(sizingHint);
  /** Tracks symbols currently subscribed via bookTicker — enables targeted cleanup. */
  const subscribedBookTickersRef  = useRef(new Set<string>());
  isActiveRef.current             = isActive;
  symbolsRef.current              = symbols;
  onEnterRef.current              = onEnterTrade;
  onLogRef.current                = onLog;
  onScanEventRef.current          = onScanEvent;
  enterLabelRef.current           = enterLabel;
  scanIntervalsRef.current        = scanIntervals && scanIntervals.length > 0 ? scanIntervals : DEFAULT_SCAN_INTERVALS;
  cadenceRef.current              = normalizeCadenceMinutes(cadenceMinutes);
  maxAutoPositionsRef.current     = maxAutoPositionsPerScan ?? 0;
  strategyIdRef.current           = strategyId ?? 'breakout';
  retestOptionsRef.current        = retestOptions;
  retestAutoDirectionRef.current  = retestAutoDirection ?? 'long';
  fvgOptionsRef.current           = fvgOptions;
  breakoutDirectionRef.current    = breakoutDirection ?? 'both';
  scoreThresholdRef.current       = minCandidateScore ?? (strategyId === 'leader-retest' ? 70 : strategyId === 'fvg-poc-ema72' ? 75 : 90);
  maxBarsAfterTriggerRef.current  = breakoutMaxBarsAfterTrigger ?? 0;
  maxSpreadBpsRef.current         = maxSpreadBps ?? 4;
  maxRiskPctRef.current           = maxRiskPct ?? 0.025;
  maxAbsLossUsdRef.current        = maxAbsLossUsd ?? 0;
  sizingHintRef.current           = sizingHint;

  const addLog = useCallback((msg: string, type: AutoTradeLog['type'] = 'info') => {
    setLogs(prev => [{ id: ++logSeq, time: Date.now(), msg, type }, ...prev].slice(0, 200));
    onLogRef.current?.(msg, type);
  }, []);

  const setActive = useCallback((active: boolean) => {
    try { localStorage.setItem(AUTO_TRADE_KEY, active ? 'true' : 'false'); } catch { /* ignore persistence errors */ }
    setIsActiveState(active);
    if (active) {
      const now = Date.now();
      const cadence = cadenceRef.current;
      // Enabling should not fire immediately in the current slot.
      lastRunSlotRef.current = getCurrentSlot(now, cadence);
      const next = getNextBoundary(now, cadence);
      setNextRunTime(next);
      addLog(`⏰ 자동매매 스케줄 활성화 — ${cadence}분 경계 실행 (다음: ${new Date(next).toLocaleString('ko-KR')})`, 'success');
    } else {
      setNextRunTime(null);
      addLog('⏹ 자동매매 스케줄 비활성화', 'success');
    }
  }, [addLog]);

  // ── Core scan routine ────────────────────────────────────────────────────────
  const runScans = useCallback(async (
    mode: 'scheduled' | 'manual' = 'scheduled',
    boundaryTimeArg?: number,
  ) => {
    if (scanningRef.current) return;
    const governor = getBinanceGovernorSnapshot();
    if (governor.cooldownUntil > Date.now()) {
      const remainSec = Math.ceil((governor.cooldownUntil - Date.now()) / 1000);
      addLog(`⛔ 바이낸스 쿨다운 중(${remainSec}s) — 자동 스캔 연기`, 'warn');
      setNextRunTime(governor.cooldownUntil);
      return;
    }
    const syms = symbolsRef.current;
    if (syms.length === 0) { addLog('심볼 목록이 비어있습니다', 'warn'); return; }

    scanningRef.current = true;
    setScanning(true);
    setScanProgress(null);
    const startTime = Date.now();
    const cadence = cadenceRef.current;
    try {
    const boundaryTime = boundaryTimeArg ?? getSlotStart(startTime, cadence);
    const boundaryLagSec = Math.max(0, Math.round((startTime - boundaryTime) / 1000));
    setLastRunTime(startTime);
    const activeIntervals = scanIntervalsRef.current;
    const dueIntervals = mode === 'scheduled'
      ? getDueIntervals(boundaryTime, activeIntervals)
      : sortIntervalsByPriority(activeIntervals);
    const skippedIntervals = mode === 'scheduled'
      ? sortIntervalsByPriority(activeIntervals).filter(iv => !dueIntervals.includes(iv))
      : [];
    const numTf = dueIntervals.length;
    if (mode === 'scheduled' && skippedIntervals.length > 0) {
      addLog(`🕒 ${new Date(boundaryTime).toLocaleTimeString('ko-KR')} 경계 — ${skippedIntervals.join(',')} 비경계라 생략`);
    }
    if (numTf === 0) {
      addLog(`🕒 ${new Date(boundaryTime).toLocaleTimeString('ko-KR')} 경계 — 실행 대상 타임프레임 없음`, 'info');
      setNextRunTime(getNextBoundary(Date.now(), cadenceRef.current));
      scanningRef.current = false;
      setScanning(false);
      return;
    }
    // Estimated time: AUTO_DELAY_MS + ~250ms HTTP per symbol, per TF, with wait between TFs
    const estSecPerTf = Math.ceil(syms.length * (AUTO_DELAY_MS + 250) / AUTO_CONCURRENCY / 1000);
    const estTotalSec = estSecPerTf * numTf + (BETWEEN_SCAN_MS / 1000) * Math.max(0, numTf - 1);
    const minTf = Math.min(...activeIntervals.map(intervalToMinutes));
    if (cadence < minTf) {
      addLog(`⚠ 스캔 주기(${cadence}분)가 최소 스캔 봉(${minTf}분)보다 짧습니다. 중복 스캔 가능성이 높아집니다.`, 'warn');
    }
    if (mode === 'scheduled') {
      addLog(`🚀 정각 스캔 시작 — 경계 ${new Date(boundaryTime).toLocaleTimeString('ko-KR')} · 지연 ${boundaryLagSec}s · ${syms.length}개 심볼 × ${numTf}개(${dueIntervals.join(',')})`, 'success');
    } else {
      addLog(`🚀 수동 스캔 시작 — ${syms.length}개 심볼 × ${numTf}개 타임프레임(${dueIntervals.join(',')}) (예상 약 ${estTotalSec}초)`, 'success');
    }

    let totalEntered = 0;
    let firstCandidateReadyAt: number | null = null;
    // Deduplicate across timeframes: each symbol+direction is entered at most once per run
    const enteredThisRun = new Set<string>();

    for (let i = 0; i < dueIntervals.length; i++) {
      const interval = dueIntervals[i];

      if (i > 0) {
        addLog(`⏳ ${BETWEEN_SCAN_MS / 1000}초 대기 후 ${interval} 스캔 시작...`);
        await new Promise<void>(r => setTimeout(r, BETWEEN_SCAN_MS));
      }

      addLog(`📡 [${interval}] 스캔 시작 (${syms.length}개 심볼)`);
      onScanEventRef.current?.({ type: 'interval_start', interval, symbolCount: syms.length, boundaryTime, mode });
      const candidates: ScanCandidate[] = [];
      const abortCtrl = new AbortController();
      setScanProgress({ interval, done: 0, total: syms.length });

      // Resolve scan function based on strategy selection
      const activeScanFn: ScanFn = strategyIdRef.current === 'leader-retest'
        ? createLeaderRetestScan(retestOptionsRef.current)
        : strategyIdRef.current === 'fvg-poc-ema72'
        ? createFvgPocEma72Scan(fvgOptionsRef.current)
        : runBreakoutScan;
      const scanDirection = strategyIdRef.current === 'leader-retest'
        ? retestAutoDirectionRef.current
        : strategyIdRef.current === 'fvg-poc-ema72'
        ? (fvgOptionsRef.current?.fvgDirection ?? 'both')
        : breakoutDirectionRef.current;
      try {
        await activeScanFn(
          syms,
          interval,
          scanDirection,
          (done, total) => {
            setScanProgress({ interval, done, total });
            if (done === total || done % 50 === 0) {
              addLog(`[${interval}] 진행 ${done}/${total}`);
            }
          },
          (c) => { candidates.push(c); },
          abortCtrl.signal,
          {
            concurrency: AUTO_CONCURRENCY,
            delayMs: AUTO_DELAY_MS,
            scanTag: `${mode === 'scheduled' ? 'auto-trade' : 'auto-manual'}:${interval}`,
            busyPolicy: 'queue',
            onStatus: (message, level) => {
              addLog(`[${interval}] ${message}`, level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'info'));
            },
          },
        );
      } catch (e) {
        addLog(`[${interval}] 스캔 오류: ${e instanceof Error ? e.message : String(e)}`, 'error');
        continue;
      }

      const scoreThreshold = scoreThresholdRef.current;
      const isLeaderRetest = strategyIdRef.current === 'leader-retest';

      // For leader-retest: pre-filter INVALID (late/failed-auction) before sorting.
      // INVALID candidates have already missed the entry zone — entering them would be chasing.
      const qualified = candidates
        .filter(c => {
          if (c.score < scoreThreshold) return false;
          if (isLeaderRetest && c.status === 'INVALID') return false;
          return true;
        })
        .sort((a, b) => b.score - a.score);

      const invalidCount = isLeaderRetest
        ? candidates.filter(c => c.score >= scoreThreshold && c.status === 'INVALID').length
        : 0;
      // triggeredCount: qualified candidates already in the entry zone (TRIGGERED status).
      // For non-leader-retest strategies all qualified are treated as triggered.
      const triggeredCount = isLeaderRetest
        ? qualified.filter(c => c.status === 'TRIGGERED').length
        : qualified.length;
      addLog(
        `[${interval}] 완료 — 전체 ${candidates.length}개 · ${scoreThreshold}점+ ${qualified.length + invalidCount}개` +
        (invalidCount > 0 ? ` (LATE/INVALID ${invalidCount}개 제외)` : '') +
        (isLeaderRetest ? ` · 진입존 ${triggeredCount}개` : ` · 진입대상 ${qualified.length}개`),
        triggeredCount > 0 ? 'success' : (candidates.length > 0 ? 'warn' : 'info'),
      );
      // interval_done fires AFTER the per-candidate loop so `entered` reflects actual calls.
      // Declared here, emitted below.
      let actualEnteredCount = 0;

      const maxPositions = maxAutoPositionsRef.current;
      for (const c of qualified) {
        if (maxPositions > 0 && totalEntered >= maxPositions) {
          addLog(`⛔ [${interval}] 최대 진입 수(${maxPositions}) 도달 — ${c.symbol} 건너뜀`, 'warn');
          continue;
        }
        const key = `${c.symbol}_${c.direction}`;
        if (enteredThisRun.has(key)) {
          addLog(`⏭ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — 이미 이번 실행에서 진입됨 (중복 건너뜀)`, 'info');
          continue;
        }
        // ── Breakout-specific pre-entry gates ───────────────────────────────
        if (strategyIdRef.current === 'breakout') {
          // Gate 1: require TRIGGERED status — PENDING candidates have not confirmed the breakout level yet
          if (c.status !== 'TRIGGERED') {
            addLog(`⏭ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — breakout 상태 ${c.status ?? 'undefined'} → 진입 스킵 (TRIGGERED만 허용)`, 'warn');
            continue;
          }
          // Gate 2: skip if too many bars have elapsed since trigger
          // Use bar-index arithmetic to avoid float boundary errors:
          //   0 = same bar only, 1 = one bar later allowed, N = N bars later allowed
          const triggerTime = c.triggeredAt ?? c.asOfCloseTime;
          const ivMs = intervalToMs(interval);
          const triggerBarIdx = Math.floor(triggerTime / ivMs);
          const nowBarIdx     = Math.floor(Date.now() / ivMs);
          const barsElapsed   = nowBarIdx - triggerBarIdx;
          const maxBars       = maxBarsAfterTriggerRef.current;
          if (barsElapsed > maxBars) {
            addLog(
              `⏭ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — late-after-trigger: ` +
              `triggeredAt=${new Date(triggerTime).toLocaleTimeString('ko-KR')} ` +
              `barsElapsed=${barsElapsed} > maxBars=${maxBars} → 진입 스킵`,
              'warn',
            );
            continue;
          }
        }
        // ────────────────────────────────────────────────────────────────────

        // ── Leader-retest pre-entry gates ────────────────────────────────────
        if (isLeaderRetest) {
          // Gate 1: only TRIGGERED (price inside entry zone) may proceed.
          // INVALID = price past lateAbove → chasing; PENDING = not yet in zone.
          if (c.status === 'INVALID') {
            // Defensive: should already be pre-filtered above, but guard explicitly.
            addLog(`⛔ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — LATE/INVALID (lateAbove 초과) → 추격 진입 금지`, 'warn');
            continue;
          }
          if (c.status !== 'TRIGGERED') {
            addLog(`⏭ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — 상태 ${c.status ?? '?'} (TRIGGERED 아님) → 진입 대기`, 'info');
            continue;
          }
          // Gate 2: cancelAfterBars — discard order blueprint if scan is stale.
          // Uses bar-index arithmetic (same pattern as breakout gate).
          if (c.orderPlan != null) {
            const ivMs = intervalToMs(interval);
            const asOfBar    = Math.floor(c.asOfCloseTime / ivMs);
            const nowBar     = Math.floor(Date.now() / ivMs);
            const barsElapsed = nowBar - asOfBar;
            if (barsElapsed > c.orderPlan.cancelAfterBars) {
              addLog(
                `⏭ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — ` +
                `cancelAfterBars(${c.orderPlan.cancelAfterBars}) 초과 ` +
                `(${barsElapsed}봉 경과) → 주문 청사진 폐기`,
                'warn',
              );
              continue;
            }
          }
          // Gate 3: spread — subscribe to live bookTicker then read freshest value.
          // subscribeBookTicker is idempotent; gate is skipped (not blocked) when data unavailable.
          subscribeBookTicker(c.symbol);
          subscribedBookTickersRef.current.add(c.symbol);
          const spreadBpsNow = c.spreadBps ?? getSpreadBps(c.symbol);
          if (spreadBpsNow != null && maxSpreadBpsRef.current > 0) {
            if (spreadBpsNow > maxSpreadBpsRef.current) {
              addLog(
                `⛔ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — ` +
                `spread ${spreadBpsNow.toFixed(1)} bps > max ${maxSpreadBpsRef.current} bps → 진입 차단`,
                'warn',
              );
              continue;
            }
          }
          // Gate 4: distance-based risk gate using wick-based hardStop.
          // riskPct = |idealEntry − hardStop| / idealEntry.
          let riskFracForGate5: number | null = null;
          if (c.orderPlan != null && maxRiskPctRef.current > 0) {
            const idealEntry = c.orderPlan.idealEntry;
            if (idealEntry > 0) {
              const riskPct = Math.abs(idealEntry - c.orderPlan.hardStop) / idealEntry;
              riskFracForGate5 = riskPct;
              if (riskPct > maxRiskPctRef.current) {
                addLog(
                  `⛔ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — ` +
                  `risk ${(riskPct * 100).toFixed(2)}% > max ${(maxRiskPctRef.current * 100).toFixed(1)}% → 진입 차단`,
                  'warn',
                );
                continue;
              }
            }
          } else if (c.orderPlan != null) {
            // Gate 4 disabled (maxRiskPct=0) but we still compute riskFrac for Gate 5.
            const idealEntry = c.orderPlan.idealEntry;
            if (idealEntry > 0) {
              riskFracForGate5 = Math.abs(idealEntry - c.orderPlan.hardStop) / idealEntry;
            }
          }
          // Gate 5: absolute loss gate — independent of Gate 4.
          // Works for both 'margin' (riskFrac × notional) and 'risk' (fixed riskAmount) modes.
          const maxAbsLoss = maxAbsLossUsdRef.current;
          if (maxAbsLoss > 0) {
            const hint = sizingHintRef.current;
            if (hint == null) {
              // sizingHint not provided — cannot estimate; skip gate with a warning.
              addLog(
                `⚠ [${interval}] ${c.symbol} — Gate 5 비활성: sizingHint 없음 (절대손실 추정 불가)`,
                'warn',
              );
            } else {
              // For margin mode we need riskFrac; derive it from orderPlan if available.
              const frac = riskFracForGate5 ?? (
                c.orderPlan != null && c.orderPlan.idealEntry > 0
                  ? Math.abs(c.orderPlan.idealEntry - c.orderPlan.hardStop) / c.orderPlan.idealEntry
                  : 0
              );
              const absLossUsd = estimatePlannedAbsLossUsd(hint, frac);
              if (absLossUsd != null && absLossUsd > maxAbsLoss) {
                addLog(
                  `⛔ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — ` +
                  `절대손실 $${absLossUsd.toFixed(2)} > 상한 $${maxAbsLoss.toFixed(2)} → 진입 차단`,
                  'warn',
                );
                continue;
              }
            }
          }
        }
        // ────────────────────────────────────────────────────────────────────

        // ── Candidate log — rich detail for leader-retest, compact for others ──
        if (isLeaderRetest && c.orderPlan != null) {
          const op = c.orderPlan;
          const bd = c.scoreBreakdown;
          const scoresStr = bd
            ? `L${(bd.leaderScore   * 100).toFixed(0)}` +
              ` P${(bd.pullbackScore * 100).toFixed(0)}` +
              ` Lo${(bd.locationScore * 100).toFixed(0)}`
            : '분석없음';
          const riskPct = c.entryPrice > 0
            ? ((Math.abs(c.entryPrice - op.hardStop) / c.entryPrice) * 100).toFixed(2)
            : '?';
          addLog(
            `🔍 [${interval}] 후보 → ${c.symbol} ${c.direction.toUpperCase()} ` +
            `총${c.score}pts (${scoresStr}) | ` +
            `진입존 ${fmtPrice(op.entryZoneLow)}~${fmtPrice(op.entryZoneHigh)} ` +
            `HardStop ${fmtPrice(op.hardStop)} (리스크 ${riskPct}%) ` +
            `TP1 ${fmtPrice(op.tp1)} | ` +
            `상태 ${c.status} runner:${op.runnerMode}`,
            'info',
          );
        } else {
          // Generic log for breakout / fvg-poc-ema72
          addLog(
            `🔍 [${interval}] 후보 전달: ${c.symbol} ${c.direction.toUpperCase()} ` +
            `점수${c.score} 진입${c.entryPrice.toFixed(4)} SL${c.slPrice.toFixed(4)} TP${c.tpPrice.toFixed(4)}`,
            'info',
          );
        }
        actualEnteredCount++;
        onEnterRef.current({ ...c, scanMode: mode, scanStartTime: startTime });
        enteredThisRun.add(key);
        totalEntered++;
        if (firstCandidateReadyAt == null) {
          firstCandidateReadyAt = Date.now();
          const firstLagSec = Math.max(0, Math.round((firstCandidateReadyAt - boundaryTime) / 1000));
          addLog(`⚡ [${interval}] 첫 후보 전달 — 경계 대비 ${firstLagSec}s`, 'info');
        }
      }
      // Emit interval_done AFTER the per-candidate loop so `entered` is the actual call count.
      onScanEventRef.current?.({
        type: 'interval_done',
        interval,
        total: candidates.length,
        qualified: qualified.length,
        triggeredCount,
        entered: actualEnteredCount,
      });
    }

    // ── BookTicker cleanup: unsubscribe symbols no longer in the scan list ──
    // Only runs for leader-retest; subscribedBookTickersRef is empty for other strategies.
    if (isLeaderRetest) {
      const currentSymbols = new Set(syms);
      for (const sym of subscribedBookTickersRef.current) {
        if (!currentSymbols.has(sym)) {
          unsubscribeBookTicker(sym);
          subscribedBookTickersRef.current.delete(sym);
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const firstReadyText = firstCandidateReadyAt != null
      ? `${Math.max(0, Math.round((firstCandidateReadyAt - startTime) / 1000))}s`
      : '없음';
    addLog(
      `🏁 자동 스캔 완료 (${elapsed}초) — 첫 후보 ${firstReadyText} · 후보 ${totalEntered}개 진입필터 전달`,
      'success',
    );
    onScanEventRef.current?.({ type: 'scan_done', totalEntered, intervals: dueIntervals, mode });

    const now = Date.now();
    setNextRunTime(getNextBoundary(now, cadenceRef.current));
    } catch (e) {
      addLog(`⚠ 스캔 중 예외 발생: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      scanningRef.current = false;
      setScanning(false);
      setScanProgress(null);
    }
  }, [addLog]);

  // Keep runScans accessible via ref so the timer doesn't re-subscribe
  const runScansRef = useRef(runScans);
  runScansRef.current = runScans;

  // ── Cadence scheduler timer ─────────────────────────────────────────────────
  useEffect(() => {
    const now = Date.now();
    const cadence = cadenceRef.current;
    setNextRunTime(getNextBoundary(now, cadence));
    if (isActiveRef.current) {
      // On cadence change while active, re-align to the current slot boundary.
      lastRunSlotRef.current = getCurrentSlot(now, cadence);
    }

    const timer = setInterval(() => {
      if (!isActiveRef.current || scanningRef.current) return;
      const now = Date.now();
      const cadenceNow = cadenceRef.current;
      const slot = getCurrentSlot(now, cadenceNow);
      const next = getNextBoundary(now, cadenceNow);
      setNextRunTime(prev => (prev === next ? prev : next));
      if (slot !== lastRunSlotRef.current) {
        lastRunSlotRef.current = slot;
        const boundary = getSlotStart(now, cadenceNow);
        runScansRef.current('scheduled', boundary);
      }
    }, SCHEDULE_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [cadenceMinutes]);

  // ── BookTicker WS lifecycle: unsubscribe all on strategy change or unmount ───
  useEffect(() => {
    // When strategy changes away from leader-retest, tear down all WS connections
    // that were opened for spread-gate checking.
    if (strategyIdRef.current !== 'leader-retest') {
      for (const sym of subscribedBookTickersRef.current) {
        unsubscribeBookTicker(sym);
      }
      subscribedBookTickersRef.current.clear();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyId]);

  useEffect(() => {
    // Unmount cleanup: release all open bookTicker WS connections.
    return () => {
      for (const sym of subscribedBookTickersRef.current) {
        unsubscribeBookTicker(sym);
      }
      subscribedBookTickersRef.current.clear();
    };
  }, []);

  // ── Manual trigger ───────────────────────────────────────────────────────────
  const triggerNow = useCallback(() => {
    if (scanningRef.current) {
      addLog('이미 자동 스캔이 실행 중입니다', 'warn');
      return;
    }
    const governor = getBinanceGovernorSnapshot();
    if (governor.cooldownUntil > Date.now()) {
      const remainSec = Math.ceil((governor.cooldownUntil - Date.now()) / 1000);
      addLog(`바이낸스 쿨다운 중(${remainSec}s) — 지금 스캔 불가`, 'warn');
      return;
    }
    // Mark the current slot as handled so the scheduler doesn't immediately re-trigger
    // after the manual scan completes. The NEXT boundary slot will still be different,
    // so scheduled scans at the next cadence boundary will still fire normally.
    lastRunSlotRef.current = getCurrentSlot(Date.now(), cadenceRef.current);
    runScansRef.current('manual', Date.now());
  }, [addLog]);

  return { isActive, setActive, scanning, logs, lastRunTime, nextRunTime, triggerNow, scanProgress };
}
