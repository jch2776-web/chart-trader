import { useState, useEffect, useRef, useCallback } from 'react';
import { runBreakoutScan } from '../components/AltScanner/breakoutScanner';
import type { ScanCandidate, ScanInterval } from '../components/AltScanner/breakoutScanner';
import { getBinanceGovernorSnapshot } from '../lib/binanceRequestGovernor';

const AUTO_TRADE_KEY   = 'alt_auto_trade_active';
const SCORE_THRESHOLD  = 90;
const TOP_N_PER_TF     = 2;
const DEFAULT_SCAN_INTERVALS: ScanInterval[] = ['1h', '4h', '1d'];
const DEFAULT_CADENCE_MINUTES = 60;
const BETWEEN_SCAN_MS  = 2000;

// Rate-limit settings for automated (unattended) scanning.
// Each symbol costs 7 weight (limit=202 → wt2, limit=502 → wt5).
// Binance Futures IP limit: 2400 weight/min = 40 weight/sec (rolling).
// concurrency=4, delayMs=450, avg HTTP=250ms → effective delay ≈ 700ms per batch
//   → throughput ≈ 4/700ms = 5.7 sym/sec × 7 wt = 40 wt/sec = 2400 wt/min (at safe max)
const AUTO_CONCURRENCY = 4;
const AUTO_DELAY_MS    = 450;
const SCHEDULE_CHECK_INTERVAL_MS = 10_000;

export interface AutoTradeLog {
  id: number;
  time: number;
  msg: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

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

function getSlotMs(cadenceMinutes: number): number {
  return normalizeCadenceMinutes(cadenceMinutes) * 60_000;
}

function getCurrentSlot(ts: number, cadenceMinutes: number): number {
  return Math.floor(ts / getSlotMs(cadenceMinutes));
}

function getNextBoundary(ts: number, cadenceMinutes: number): number {
  const slotMs = getSlotMs(cadenceMinutes);
  return Math.floor(ts / slotMs) * slotMs + slotMs;
}

export function useAltAutoTrade({
  symbols,
  onEnterTrade,
  onLog,
  enterLabel = '진입',
  scanIntervals,
  cadenceMinutes,
}: {
  symbols: string[];
  onEnterTrade: (candidate: ScanCandidate) => void;
  onLog?: (msg: string, type: AutoTradeLog['type']) => void;
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

  // Refs so callbacks always see fresh values without stale closures
  const isActiveRef        = useRef(isActive);
  const symbolsRef         = useRef(symbols);
  const onEnterRef         = useRef(onEnterTrade);
  const onLogRef           = useRef(onLog);
  const enterLabelRef      = useRef(enterLabel);
  const scanIntervalsRef   = useRef(scanIntervals ?? DEFAULT_SCAN_INTERVALS);
  const cadenceRef         = useRef(normalizeCadenceMinutes(cadenceMinutes));
  const scanningRef        = useRef(false);
  const lastRunSlotRef     = useRef<number>(-1);
  isActiveRef.current      = isActive;
  symbolsRef.current       = symbols;
  onEnterRef.current       = onEnterTrade;
  onLogRef.current         = onLog;
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
  const runScans = useCallback(async () => {
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
    const startTime = Date.now();
    setLastRunTime(startTime);
    const activeIntervals = scanIntervalsRef.current;
    const cadence = cadenceRef.current;
    const numTf = activeIntervals.length;
    // Estimated time: AUTO_DELAY_MS + ~250ms HTTP per symbol, per TF, with wait between TFs
    const estSecPerTf = Math.ceil(syms.length * (AUTO_DELAY_MS + 250) / AUTO_CONCURRENCY / 1000);
    const estTotalSec = estSecPerTf * numTf + (BETWEEN_SCAN_MS / 1000) * Math.max(0, numTf - 1);
    const minTf = Math.min(...activeIntervals.map(intervalToMinutes));
    if (cadence < minTf) {
      addLog(`⚠ 스캔 주기(${cadence}분)가 최소 스캔 봉(${minTf}분)보다 짧습니다. 중복 스캔 가능성이 높아집니다.`, 'warn');
    }
    addLog(`🚀 자동 스캔 시작 — 주기 ${cadence}분 · ${syms.length}개 심볼 × ${numTf}개 타임프레임(${activeIntervals.join(',')}) (예상 소요 약 ${estTotalSec}초, 속도제한: 동시${AUTO_CONCURRENCY}개·간격${AUTO_DELAY_MS}ms)`);

    let totalEntered = 0;
    // Deduplicate across timeframes: each symbol+direction is entered at most once per run
    const enteredThisRun = new Set<string>();

    for (let i = 0; i < activeIntervals.length; i++) {
      const interval = activeIntervals[i];

      if (i > 0) {
        addLog(`⏳ ${BETWEEN_SCAN_MS / 1000}초 대기 후 ${interval} 스캔 시작...`);
        await new Promise<void>(r => setTimeout(r, BETWEEN_SCAN_MS));
      }

      addLog(`📡 [${interval}] 스캔 시작 (${syms.length}개 심볼)`);
      const candidates: ScanCandidate[] = [];
      const abortCtrl = new AbortController();

      try {
        await runBreakoutScan(
          syms,
          interval,
          'both',
          (done, total) => {
            if (done === total || done % 50 === 0) {
              addLog(`[${interval}] 진행 ${done}/${total}`);
            }
          },
          (c) => { candidates.push(c); },
          abortCtrl.signal,
          {
            concurrency: AUTO_CONCURRENCY,
            delayMs: AUTO_DELAY_MS,
            scanTag: `auto-trade:${interval}`,
            busyPolicy: 'skip',
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
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    addLog(`🏁 자동 스캔 완료 (${elapsed}초) — 총 ${totalEntered}개 ${enterLabelRef.current}`, totalEntered > 0 ? 'success' : 'info');

    const now = Date.now();
    setNextRunTime(getNextBoundary(now, cadenceRef.current));

    scanningRef.current = false;
    setScanning(false);
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
        runScansRef.current();
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
    runScansRef.current();
  }, [addLog]);

  return { isActive, setActive, scanning, logs, lastRunTime, nextRunTime, triggerNow };
}
