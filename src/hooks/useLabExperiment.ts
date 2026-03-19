import { useEffect, useRef, useState, useCallback } from 'react';
import { usePaperTrading } from './usePaperTrading';
import { runBreakoutScan } from '../components/AltScanner/breakoutScanner';
import { createLeaderRetestScan } from '../components/AltScanner/strategies/leaderRetest';
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

  // ── Leader-retest specific parameters ─────────────────────────────────
  retestMinBars?: number;
  retestMaxBars?: number;
  retestToleranceAtr?: number;
  retestMaxOvershootAtr?: number;
  /** Direction override for leader-retest scan (default 'long') */
  retestAutoDirection?: 'long' | 'both';

  // ── No-trade gates ─────────────────────────────────────────────────────
  /**
   * Require 4H EMA20 > EMA50 before allowing LONG entries.
   * Applied for leader-retest (passed to scan fn).
   * Not enforced for breakout (breakout scan doesn't check 4H trend).
   */
  require4hTrend?: boolean;
  /**
   * After any losing trade, skip entries for this many cadence cycles.
   * e.g. cooldownBarsAfterLoss=2 + cadence=60min → 2h cooldown.
   */
  cooldownBarsAfterLoss?: number;
  /**
   * Maximum number of open positions in the same direction (LONG or SHORT)
   * at any one entry decision. 0 = no limit.
   */
  maxConcurrentCorrelatedPositions?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

/** Compute stats from history entries for the comparison table. */
function computeExtendedStats(history: ReturnType<typeof usePaperTrading>['history']) {
  if (history.length === 0) {
    return { tpRate: 0, slRate: 0, expiredRate: 0, avgHoldMs: 0, maxConsecLoss: 0 };
  }
  let tpCount = 0, slCount = 0, expiredCount = 0, totalHoldMs = 0;
  let curStreak = 0, maxConsecLoss = 0;
  for (const h of history) {
    if (h.closeReason === 'tp') tpCount++;
    else if (h.closeReason === 'sl' || h.closeReason === 'liq') slCount++;
    else if (h.closeReason === 'expired') expiredCount++;
    totalHoldMs += h.exitTime - h.entryTime;
    if (h.pnl < 0) {
      curStreak++;
      if (curStreak > maxConsecLoss) maxConsecLoss = curStreak;
    } else {
      curStreak = 0;
    }
  }
  const n = history.length;
  return {
    tpRate: (tpCount / n) * 100,
    slRate: (slCount / n) * 100,
    expiredRate: (expiredCount / n) * 100,
    avgHoldMs: totalHoldMs / n,
    maxConsecLoss,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────

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

    // ── Gate 1: cooldownBarsAfterLoss ──────────────────────────────────────
    if (cfg.cooldownBarsAfterLoss && cfg.cooldownBarsAfterLoss > 0) {
      const recentLoss = [...paperRef.current.history]
        .sort((a, b) => b.exitTime - a.exitTime)
        .find(h => h.pnl < 0);
      if (recentLoss) {
        const cadenceMs = normalizeCadence(cfg.cadenceMinutes) * 60_000;
        const cooldownUntil = recentLoss.exitTime + cfg.cooldownBarsAfterLoss * cadenceMs;
        if (Date.now() < cooldownUntil) {
          const remMin = Math.ceil((cooldownUntil - Date.now()) / 60_000);
          addLog(`⏳ 손실 후 쿨다운 중 (${remMin}분 남음) — 스캔 건너뜀`);
          return;
        }
      }
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

    // Build scan function with strategy-specific params injected
    const activeScanFn = cfg.strategyId === 'leader-retest'
      ? createLeaderRetestScan({
          minBars: cfg.retestMinBars,
          maxBars: cfg.retestMaxBars,
          toleranceAtr: cfg.retestToleranceAtr,
          maxOvershootAtr: cfg.retestMaxOvershootAtr,
          // Gate: require4hTrend is passed to the scan fn (leader-retest handles it natively)
          require4hTrend: cfg.require4hTrend,
        })
      : runBreakoutScan;

    const scanDirection = cfg.strategyId === 'leader-retest'
      ? (cfg.retestAutoDirection ?? cfg.direction as 'long' | 'both')
      : cfg.direction;

    const entered = new Set<string>();

    for (const interval of dueIntervals) {
      const candidates: ScanCandidate[] = [];
      try {
        await activeScanFn(
          syms,
          interval,
          scanDirection,
          () => {},
          (c) => { candidates.push(c); },
          undefined,
          {
            concurrency: LAB_CONCURRENCY,
            delayMs: LAB_DELAY_MS,
            scanTag: `lab:${cfg.id}:${interval}`,
            // 'skip' prevents lab scans from queuing up and blocking the main
            // auto-trade scheduled scan (which uses busyPolicy:'skip' and gets
            // dropped when the governor is occupied).
            busyPolicy: 'skip',
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
        if (curPositions.some(p =>
          p.symbol === c.symbol &&
          p.positionSide === (c.direction === 'long' ? 'LONG' : 'SHORT'),
        )) continue;

        // ── Gate 2: maxConcurrentCorrelatedPositions ───────────────────────
        if (cfg.maxConcurrentCorrelatedPositions && cfg.maxConcurrentCorrelatedPositions > 0) {
          const sideStr = c.direction === 'long' ? 'LONG' : 'SHORT';
          const sameDir = curPositions.filter(p => p.positionSide === sideStr).length;
          if (sameDir >= cfg.maxConcurrentCorrelatedPositions) {
            addLog(`🚫 [${interval}] ${c.symbol} ${c.direction.toUpperCase()} — 동방향 포지션 한도(${cfg.maxConcurrentCorrelatedPositions}) 도달`);
            continue;
          }
        }

        // Risk-based position sizing
        const balance = paperRef.current.balance;
        const riskAmt = balance * (cfg.riskPct / 100);
        const riskPerUnit = Math.abs(c.entryPrice - c.slPrice);
        if (riskPerUnit <= 0) continue;
        let qty = riskAmt / riskPerUnit;
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
  const extended = computeExtendedStats(history);

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
      ...extended,
    },
  };
}

export type LabExperiment = ReturnType<typeof useLabExperiment>;
