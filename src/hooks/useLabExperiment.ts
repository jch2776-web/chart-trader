import { useEffect, useRef, useState, useCallback } from 'react';
import { usePaperTrading } from './usePaperTrading';
import { runBreakoutScan } from '../components/AltScanner/breakoutScanner';
import { createLeaderRetestScan } from '../components/AltScanner/strategies/leaderRetest';
import type { RetestOptions } from '../components/AltScanner/strategies/leaderRetest';
import type { ScanInterval, ScanCandidate } from '../components/AltScanner/breakoutScanner';
import { getBinanceGovernorSnapshot } from '../lib/binanceRequestGovernor';
import type { AltMeta } from '../types/paperTrading';

const LAB_CONCURRENCY = 3;
const LAB_DELAY_MS = 300;
const SCHEDULE_CHECK_INTERVAL_MS = 5_000;

export interface LabExperimentConfig {
  id: string;
  name: string;
  enabled: boolean;
  strategyId: 'breakout' | 'leader-retest';
  retestOptions?: RetestOptions;
  scanIntervals: ScanInterval[];
  direction: 'long' | 'short' | 'both';
  minScore: number;
  leverage: number;
  /** % of current balance to risk per trade (e.g. 2 = 2%) */
  riskPct: number;
  cadenceMinutes: number;
  /** 0 = unlimited */
  maxPositions: number;
  initialBalance: number;
}

function intervalToMs(iv: ScanInterval): number {
  const m = iv === '15m' ? 15 : iv === '1h' ? 60 : iv === '4h' ? 240 : 1440;
  return m * 60_000;
}

function normalizeCadence(v: number): number {
  return Math.max(15, Math.round(v));
}

function getCurrentSlot(ts: number, cadenceMs: number): number {
  return Math.floor(ts / cadenceMs);
}

function getNextBoundary(ts: number, cadenceMs: number): number {
  return Math.floor(ts / cadenceMs) * cadenceMs + cadenceMs;
}

function getDueIntervals(boundaryTime: number, intervals: ScanInterval[]): ScanInterval[] {
  return intervals.filter(iv => boundaryTime % intervalToMs(iv) === 0);
}

export function useLabExperiment(
  slotIndex: number,
  storageKey: string,
  config: LabExperimentConfig | null,
  symbols: string[],
) {
  const paper = usePaperTrading(storageKey);
  const [scanning, setScanning] = useState(false);
  const [lastRunTime, setLastRunTime] = useState<number | null>(null);
  const [nextRunTime, setNextRunTime] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const scanningRef = useRef(false);
  const lastRunSlotRef = useRef(-1);
  const configRef = useRef(config);
  const symbolsRef = useRef(symbols);
  const paperRef = useRef(paper);

  configRef.current = config;
  symbolsRef.current = symbols;
  paperRef.current = paper;

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [`${new Date().toLocaleTimeString('ko-KR')} ${msg}`, ...prev].slice(0, 200));
  }, []);

  const runScan = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg || !cfg.enabled || scanningRef.current) return;
    const syms = symbolsRef.current;
    if (syms.length === 0) return;

    const governor = getBinanceGovernorSnapshot();
    if (governor.cooldownUntil > Date.now()) return;

    if (cfg.maxPositions > 0 && paperRef.current.positions.length >= cfg.maxPositions) {
      addLog(`⛔ 최대 포지션 수(${cfg.maxPositions}) 도달 — 스캔 건너뜀`);
      return;
    }

    scanningRef.current = true;
    setScanning(true);
    setLastRunTime(Date.now());

    const cadenceMs = normalizeCadence(cfg.cadenceMinutes) * 60_000;
    const boundaryTime = Math.floor(Date.now() / cadenceMs) * cadenceMs;
    const dueIntervals = getDueIntervals(boundaryTime, cfg.scanIntervals);

    if (dueIntervals.length === 0) {
      scanningRef.current = false;
      setScanning(false);
      return;
    }

    addLog(`🚀 스캔 시작 (${dueIntervals.join(',')}) ${syms.length}개 심볼`);

    const activeScanFn = cfg.strategyId === 'leader-retest'
      ? createLeaderRetestScan(cfg.retestOptions)
      : runBreakoutScan;

    const entered = new Set<string>();

    for (const interval of dueIntervals) {
      const candidates: ScanCandidate[] = [];
      try {
        await activeScanFn(
          syms,
          interval,
          cfg.direction,
          () => {},
          (c) => { candidates.push(c); },
          undefined,
          {
            concurrency: LAB_CONCURRENCY,
            delayMs: LAB_DELAY_MS,
            scanTag: `lab:${cfg.id}:${interval}`,
            busyPolicy: 'queue',
          },
        );
      } catch (e) {
        addLog(`[${interval}] 오류: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      const qualified = candidates
        .filter(c => c.score >= cfg.minScore)
        .sort((a, b) => b.score - a.score);

      addLog(`[${interval}] ${candidates.length}개 스캔 · ${qualified.length}개 ${cfg.minScore}점+`);

      for (const c of qualified) {
        const key = `${c.symbol}_${c.direction}`;
        if (entered.has(key)) continue;

        const curPositions = paperRef.current.positions;
        if (cfg.maxPositions > 0 && curPositions.length >= cfg.maxPositions) break;
        // Skip if already holding same symbol+direction
        if (curPositions.some(p => p.symbol === c.symbol && p.positionSide === c.direction.toUpperCase() as 'LONG' | 'SHORT')) continue;

        // Risk-based position sizing: risk riskPct% of balance at SL
        const balance = paperRef.current.balance;
        const riskAmt = balance * (cfg.riskPct / 100);
        const riskPerUnit = Math.abs(c.entryPrice - c.slPrice);
        if (riskPerUnit <= 0) continue;
        let qty = riskAmt / riskPerUnit;
        // Cap so margin (qty * price / leverage) doesn't exceed available balance
        const maxQtyByBalance = (balance * cfg.leverage) / c.entryPrice;
        qty = Math.min(qty, maxQtyByBalance * 0.95);
        qty = parseFloat(qty.toFixed(6));
        if (qty <= 0) continue;

        const altMeta: AltMeta = {
          source: 'altscanner',
          candidateId: `lab-${cfg.id}-${c.symbol}-${Date.now()}`,
          symbol: c.symbol,
          direction: c.direction,
          candidateScore: c.score,
          plannedEntry: c.entryPrice,
          plannedTP: c.tpPrice,
          plannedSL: c.slPrice,
          scanInterval: c.interval,
          validUntilTime: c.validUntilTime,
          slPrice: c.slPrice,
          drawingsSnapshot: [],
          entrySource: 'auto',
          strategyId: cfg.strategyId,
        };

        const side: 'LONG' | 'SHORT' = c.direction === 'long' ? 'LONG' : 'SHORT';
        paperRef.current.openPosition(
          c.symbol, side, qty, c.entryPrice, cfg.leverage, 'isolated',
          c.tpPrice, c.slPrice, altMeta,
        );

        entered.add(key);
        addLog(`✅ [${interval}] ${c.symbol} ${c.direction.toUpperCase()} 점수${c.score} qty${qty.toFixed(4)}`);
      }
    }

    addLog(`🏁 스캔 완료`);
    scanningRef.current = false;
    setScanning(false);
  }, [addLog]);

  const runScanRef = useRef(runScan);
  runScanRef.current = runScan;

  // Cadence scheduler
  useEffect(() => {
    if (!config?.enabled) {
      setNextRunTime(null);
      return;
    }
    const cadenceMs = normalizeCadence(config.cadenceMinutes) * 60_000;
    lastRunSlotRef.current = getCurrentSlot(Date.now(), cadenceMs);
    setNextRunTime(getNextBoundary(Date.now(), cadenceMs));

    const timer = setInterval(() => {
      const cfg = configRef.current;
      if (!cfg?.enabled || scanningRef.current) return;
      const now = Date.now();
      const cMs = normalizeCadence(cfg.cadenceMinutes) * 60_000;
      const slot = getCurrentSlot(now, cMs);
      setNextRunTime(getNextBoundary(now, cMs));
      if (slot !== lastRunSlotRef.current) {
        lastRunSlotRef.current = slot;
        runScanRef.current();
      }
    }, SCHEDULE_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [config?.enabled, config?.cadenceMinutes]);

  // Computed stats
  const history = paper.history;
  const wins = history.filter(h => h.pnl > 0).length;
  const winRate = history.length > 0 ? (wins / history.length) * 100 : 0;
  const totalPnl = history.reduce((sum, h) => sum + h.pnl, 0);
  const pnlPct = paper.initialBalance > 0
    ? ((paper.balance - paper.initialBalance) / paper.initialBalance) * 100
    : 0;

  return {
    slotIndex,
    config,
    paper,
    scanning,
    lastRunTime,
    nextRunTime,
    logs,
    stats: {
      balance: paper.balance,
      initialBalance: paper.initialBalance,
      positionCount: paper.positions.length,
      historyCount: history.length,
      winCount: wins,
      winRate,
      totalPnl,
      pnlPct,
    },
  };
}

export type LabExperiment = ReturnType<typeof useLabExperiment>;
