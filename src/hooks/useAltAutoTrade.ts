import { useState, useEffect, useRef, useCallback } from 'react';
import { runBreakoutScan } from '../components/AltScanner/breakoutScanner';
import type { ScanCandidate, ScanInterval } from '../components/AltScanner/breakoutScanner';

const AUTO_TRADE_KEY   = 'alt_auto_trade_active';
const SCORE_THRESHOLD  = 90;
const TOP_N_PER_TF     = 2;
const SCAN_INTERVALS: ScanInterval[] = ['1h', '4h', '1d'];
const BETWEEN_SCAN_MS  = 2000;

// Rate-limit settings for automated (unattended) scanning.
// Each symbol costs 7 weight (limit=202 → wt2, limit=502 → wt5).
// Binance Futures IP limit: 2400 weight/min = 40 weight/sec (rolling).
// concurrency=4, delayMs=450, avg HTTP=250ms → effective delay ≈ 700ms per batch
//   → throughput ≈ 4/700ms = 5.7 sym/sec × 7 wt = 40 wt/sec = 2400 wt/min (at safe max)
const AUTO_CONCURRENCY = 4;
const AUTO_DELAY_MS    = 450;

export interface AutoTradeLog {
  id: number;
  time: number;
  msg: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

let logSeq = 0;

export function useAltAutoTrade({
  symbols,
  onEnterTrade,
  onLog,
  enterLabel = '진입',
}: {
  symbols: string[];
  onEnterTrade: (candidate: ScanCandidate) => void;
  onLog?: (msg: string, type: AutoTradeLog['type']) => void;
  enterLabel?: string;
}) {
  const [isActive, setIsActiveState] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTO_TRADE_KEY) === 'true'; } catch { return false; }
  });
  const [scanning,    setScanning]    = useState(false);
  const [logs,        setLogs]        = useState<AutoTradeLog[]>([]);
  const [lastRunTime, setLastRunTime] = useState<number | null>(null);
  const [nextRunTime, setNextRunTime] = useState<number | null>(null);

  // Refs so callbacks always see fresh values without stale closures
  const isActiveRef     = useRef(isActive);
  const symbolsRef      = useRef(symbols);
  const onEnterRef      = useRef(onEnterTrade);
  const onLogRef        = useRef(onLog);
  const enterLabelRef   = useRef(enterLabel);
  const scanningRef     = useRef(false);
  const lastRunHourRef  = useRef<number>(-1); // epoch-hours of last completed run
  isActiveRef.current   = isActive;
  symbolsRef.current    = symbols;
  onEnterRef.current    = onEnterTrade;
  onLogRef.current      = onLog;
  enterLabelRef.current = enterLabel;

  const addLog = useCallback((msg: string, type: AutoTradeLog['type'] = 'info') => {
    setLogs(prev => [{ id: ++logSeq, time: Date.now(), msg, type }, ...prev].slice(0, 200));
    onLogRef.current?.(msg, type);
  }, []);

  const setActive = useCallback((active: boolean) => {
    try { localStorage.setItem(AUTO_TRADE_KEY, active ? 'true' : 'false'); } catch {}
    setIsActiveState(active);
    if (active) {
      const now       = Date.now();
      const msInHour  = now % 3600000;
      setNextRunTime(now - msInHour + 3600000);
    }
  }, []);

  // ── Core scan routine ────────────────────────────────────────────────────────
  const runScans = useCallback(async () => {
    if (scanningRef.current) return;
    const syms = symbolsRef.current;
    if (syms.length === 0) { addLog('심볼 목록이 비어있습니다', 'warn'); return; }

    scanningRef.current = true;
    setScanning(true);
    const startTime = Date.now();
    setLastRunTime(startTime);
    // Estimated time: AUTO_DELAY_MS + ~250ms HTTP per symbol, 3 TF, 5s between
    const estSecPerTf = Math.ceil(syms.length * (AUTO_DELAY_MS + 250) / AUTO_CONCURRENCY / 1000);
    const estTotalSec = estSecPerTf * 3 + (BETWEEN_SCAN_MS / 1000) * 2;
    addLog(`🚀 자동 스캔 시작 — ${syms.length}개 심볼 × 3개 타임프레임 (예상 소요 약 ${estTotalSec}초, 속도제한: 동시${AUTO_CONCURRENCY}개·간격${AUTO_DELAY_MS}ms)`);

    let totalEntered = 0;
    // Deduplicate across timeframes: each symbol+direction is entered at most once per run
    const enteredThisRun = new Set<string>();

    for (let i = 0; i < SCAN_INTERVALS.length; i++) {
      const interval = SCAN_INTERVALS[i];

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
          { concurrency: AUTO_CONCURRENCY, delayMs: AUTO_DELAY_MS },
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

    // Schedule next run: next top of hour
    const now       = Date.now();
    const msInHour  = now % 3600000;
    setNextRunTime(now - msInHour + 3600000);

    scanningRef.current = false;
    setScanning(false);
  }, [addLog]);

  // Keep runScans accessible via ref so the timer doesn't re-subscribe
  const runScansRef = useRef(runScans);
  runScansRef.current = runScans;

  // ── Hourly timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // Set initial next-run time
    const now      = Date.now();
    const msInHour = now % 3600000;
    setNextRunTime(now - msInHour + 3600000);

    const CHECK_INTERVAL_MS = 10_000; // check every 10 seconds

    const timer = setInterval(() => {
      if (!isActiveRef.current || scanningRef.current) return;
      const now        = Date.now();
      const epochHour  = Math.floor(now / 3600000);
      const msInHour   = now % 3600000;

      // Fire only in the first 30 seconds of each hour, and not the same hour twice
      if (msInHour < 30_000 && epochHour !== lastRunHourRef.current) {
        lastRunHourRef.current = epochHour;
        runScansRef.current();
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []); // runs once — all values read via refs

  // ── Manual trigger ───────────────────────────────────────────────────────────
  const triggerNow = useCallback(() => {
    if (scanningRef.current) return;
    // Don't update lastRunHourRef so the next scheduled run still fires
    runScansRef.current();
  }, []);

  return { isActive, setActive, scanning, logs, lastRunTime, nextRunTime, triggerNow };
}
