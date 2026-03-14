import { useState, useEffect, useRef, useCallback } from 'react';
import { runBreakoutScan } from '../components/AltScanner/breakoutScanner';
import type { ScanCandidate, ScanInterval } from '../components/AltScanner/breakoutScanner';
import { getBinanceGovernorSnapshot } from '../lib/binanceRequestGovernor';

const AUTO_TRADE_KEY   = 'alt_auto_trade_active';
const SCORE_THRESHOLD  = 90;
const TOP_N_PER_TF     = 2;
const DEFAULT_SCAN_INTERVALS: ScanInterval[] = ['1h', '4h', '1d'];
const DEFAULT_CADENCE_MINUTES = 60;
// Rate-limit settings for automated (unattended) scanning.
// Each symbol costs 7 weight (limit=202 → wt2, limit=502 → wt5).
// Binance Futures IP limit: 2400 weight/min = 40 weight/sec (rolling).
// concurrency=5, delayMs=200, avg HTTP=250ms → effective delay ≈ 450ms per batch
//   → throughput ≈ 5/450ms = 11 sym/sec × 7 wt = 77 wt/sec → governor throttles to 1800/min
// (governor soft limit = 1800/min handles throttling automatically)
const AUTO_CONCURRENCY = 5;
const AUTO_DELAY_MS    = 200;
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
  | { type: 'interval_done';  interval: ScanInterval; total: number; qualified: number; entered: number }
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
}: {
  symbols: string[];
  onEnterTrade: (candidate: ScanCandidate) => void;
  onLog?: (msg: string, type: AutoTradeLog['type']) => void;
  onScanEvent?: (event: ScanLifecycleEvent) => void;
  enterLabel?: string;
  scanIntervals?: ScanInterval[];
  cadenceMinutes?: number;
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
  const isActiveRef        = useRef(isActive);
  const symbolsRef         = useRef(symbols);
  const onEnterRef         = useRef(onEnterTrade);
  const onLogRef           = useRef(onLog);
  const onScanEventRef     = useRef(onScanEvent);
  const enterLabelRef      = useRef(enterLabel);
  const scanIntervalsRef   = useRef(scanIntervals ?? DEFAULT_SCAN_INTERVALS);
  const cadenceRef         = useRef(normalizeCadenceMinutes(cadenceMinutes));
  const scanningRef        = useRef(false);
  const lastRunSlotRef     = useRef<number>(-1);
  isActiveRef.current      = isActive;
  symbolsRef.current       = symbols;
  onEnterRef.current       = onEnterTrade;
  onLogRef.current         = onLog;
  onScanEventRef.current   = onScanEvent;
  enterLabelRef.current    = enterLabel;
  scanIntervalsRef.current = scanIntervals && scanIntervals.length > 0 ? scanIntervals : DEFAULT_SCAN_INTERVALS;
  cadenceRef.current       = normalizeCadenceMinutes(cadenceMinutes);

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
      addLog(`⏰ 자동매매 스케줄 활성화 — ${cadence}분 경계 실행 (다음: ${new Date(next).toLocaleString('ko-KR')})`);
    } else {
      setNextRunTime(null);
      addLog('⏹ 자동매매 스케줄 비활성화');
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
      addLog(`🚀 정각 스캔 시작 — 경계 ${new Date(boundaryTime).toLocaleTimeString('ko-KR')} · 지연 ${boundaryLagSec}s · ${syms.length}개 심볼 × ${numTf}개(${dueIntervals.join(',')})`);
    } else {
      addLog(`🚀 수동 스캔 시작 — ${syms.length}개 심볼 × ${numTf}개 타임프레임(${dueIntervals.join(',')}) (예상 약 ${estTotalSec}초)`);
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

      try {
        await runBreakoutScan(
          syms,
          interval,
          'both',
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
            busyPolicy: mode === 'scheduled' ? 'skip' : 'queue',
            onStatus: (message, level) => {
              addLog(`[${interval}] ${message}`, level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'info'));
            },
          },
        );
      } catch (e) {
        addLog(`[${interval}] 스캔 오류: ${e instanceof Error ? e.message : String(e)}`, 'error');
        continue;
      }

      const qualified = candidates
        .filter(c => c.score >= SCORE_THRESHOLD)
        .sort((a, b) => b.score - a.score);
      const top = qualified.slice(0, TOP_N_PER_TF);

      addLog(
        `[${interval}] 완료 — 전체 ${candidates.length}개 · ${SCORE_THRESHOLD}점+ ${qualified.length}개 · 진입대상 ${top.length}개`,
        top.length > 0 ? 'success' : 'info',
      );
      onScanEventRef.current?.({ type: 'interval_done', interval, total: candidates.length, qualified: qualified.length, entered: top.length });

      for (const c of top) {
        const key = `${c.symbol}_${c.direction}`;
        if (enteredThisRun.has(key)) {
          addLog(`⏭ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — 이미 이번 실행에서 진입됨 (중복 건너뜀)`, 'info');
          continue;
        }
        addLog(
          `✅ [${interval}] ${enterLabelRef.current}: ${c.symbol} ${c.direction.toUpperCase()} 점수${c.score} 진입${c.entryPrice.toFixed(4)} SL${c.slPrice.toFixed(4)} TP${c.tpPrice.toFixed(4)}`,
          'success',
        );
        onEnterRef.current(c);
        enteredThisRun.add(key);
        totalEntered++;
        if (firstCandidateReadyAt == null) {
          firstCandidateReadyAt = Date.now();
          const firstLagSec = Math.max(0, Math.round((firstCandidateReadyAt - boundaryTime) / 1000));
          addLog(`⚡ [${interval}] 첫 후보 반영 완료 — 경계 대비 ${firstLagSec}s`, 'success');
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const firstReadyText = firstCandidateReadyAt != null
      ? `${Math.max(0, Math.round((firstCandidateReadyAt - startTime) / 1000))}s`
      : '없음';
    addLog(
      `🏁 자동 스캔 완료 (${elapsed}초) — 첫 후보 ${firstReadyText} · 총 ${totalEntered}개 ${enterLabelRef.current}`,
      totalEntered > 0 ? 'success' : 'info',
    );
    onScanEventRef.current?.({ type: 'scan_done', totalEntered, intervals: dueIntervals, mode });

    const now = Date.now();
    setNextRunTime(getNextBoundary(now, cadenceRef.current));

    scanningRef.current = false;
    setScanning(false);
    setScanProgress(null);
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
    // Do not update scheduled slot marker so the next cadence boundary still runs.
    runScansRef.current('manual', Date.now());
  }, [addLog]);

  return { isActive, setActive, scanning, logs, lastRunTime, nextRunTime, triggerNow, scanProgress };
}
