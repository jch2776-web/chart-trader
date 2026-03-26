import { useEffect, useRef, useState, useCallback } from 'react';
import { usePaperTrading } from './usePaperTrading';
import { runBreakoutScan } from '../components/AltScanner/breakoutScanner';
import { createLeaderRetestScan } from '../components/AltScanner/strategies/leaderRetest';
import { createFvgPocEma72Scan } from '../components/AltScanner/strategies/fvgPocEma72';
import type { ScanInterval, ScanCandidate } from '../components/AltScanner/breakoutScanner';
import { getBinanceGovernorSnapshot } from '../lib/binanceRequestGovernor';
import type { AltMeta } from '../types/paperTrading';

const LAB_CONCURRENCY = 3;
const LAB_DELAY_MS = 300;
const SCHEDULE_CHECK_INTERVAL_MS = 5_000;
const TIMESTOP_CHECK_INTERVAL_MS = 30_000;

export interface LabExperimentConfig {
  id: string;
  name: string;
  enabled: boolean;
  strategyId: 'breakout' | 'leader-retest' | 'fvg-poc-ema72';
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

  // ── Leader-retest specific ──────────────────────────────────────────────
  retestMinBars?: number;
  retestMaxBars?: number;
  retestToleranceAtr?: number;
  retestMaxOvershootAtr?: number;
  retestAutoDirection?: 'long' | 'both';

  // ── Breakout-specific experiment filters ────────────────────────────────
  /** Direction override for breakout scan (independent from general direction) */
  breakoutDirection?: 'long' | 'short' | 'both';
  /**
   * Max seconds since the cadence boundary before discarding stale signal processing.
   * If the scan takes longer than this, remaining entry decisions are skipped.
   * null / 0 = disabled.
   */
  maxSignalAgeSec?: number | null;
  /**
   * Max breakout extension = |entryPrice − slPrice| / entryPrice × 100.
   * Filters out late/over-extended entries. null / 0 = disabled.
   */
  maxBreakoutExtensionPct?: number | null;
  /**
   * Max allowed drift between the scan's entryPrice and the current mark price.
   * Prevents chasing when price has already run. null / 0 = disabled.
   */
  maxEntryDriftPct?: number | null;

  // ── No-trade gates ──────────────────────────────────────────────────────
  require4hTrend?: boolean;
  cooldownBarsAfterLoss?: number;
  maxConcurrentCorrelatedPositions?: number;

  // ── FVG POC + EMA72 specific ────────────────────────────────────────────
  fvgPocLookbackBars?: number;
  fvgPocBins?: number;
  fvgEmaPeriod?: number;
  fvgUniverseTopN?: number;
  fvgDirection?: 'long' | 'short' | 'both';

  // ── Lab-only time-stop ──────────────────────────────────────────────────
  /** Enable lab-only time-stop (never affects main paper/live ledger) */
  labTimeStopEnabled?: boolean;
  /**
   * Close the position after this many scan-interval bars if TP/SL not hit.
   * Uses the position's altMeta.scanInterval as the bar duration reference.
   */
  labTimeStopBars?: number;
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
  const [markPricesState, setMarkPricesState] = useState<Record<string, number>>({});

  const scanningRef = useRef(false);
  const lastRunSlotRef = useRef(-1);
  const configRef = useRef(config);
  const symbolsRef = useRef(symbols);
  const paperRef = useRef(paper);
  const markPricesRef = useRef<Record<string, number>>({});

  configRef.current = config;
  symbolsRef.current = symbols;
  paperRef.current = paper;

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [`${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} ${msg}`, ...prev].slice(0, 200));
  }, []);

  // Clear logs when a new experiment is created (config transitions from null → non-null)
  const prevConfigNullRef = useRef<boolean>(config === null);
  useEffect(() => {
    const wasNull = prevConfigNullRef.current;
    const isNull = config === null;
    if (wasNull && !isNull) setLogs([]);
    prevConfigNullRef.current = isNull;
  }, [config]);

  // Log entry events when new positions open (all new ones per render cycle)
  // Initialize with [] so positions already loaded from storage on mount are also logged
  const prevPositionsRef = useRef<typeof paper.positions>([]);
  useEffect(() => {
    const prev = prevPositionsRef.current;
    const curr = paper.positions;
    const newPositions = curr.filter(p => !prev.some(pp => pp.id === p.id));
    for (const newPos of newPositions) {
      const t = new Date(newPos.entryTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      addLog(`➤ 진입 ${newPos.symbol} / ${newPos.positionSide} / ${newPos.leverage}x / ${t}`);
    }
    prevPositionsRef.current = curr;
  }, [paper.positions, addLog]);

  // Log exit events when trades close (all new ones per render cycle)
  const prevHistoryRef = useRef(paper.history);
  useEffect(() => {
    const prev = prevHistoryRef.current;
    const curr = paper.history;
    if (curr.length > prev.length) {
      const newEntries = curr.filter(h => !prev.some(ph => ph.id === h.id));
      const reasonMap: Record<string, string> = { tp: 'TP', sl: 'SL', liq: '강청', expired: '타임스탑', manual: '수동' };
      for (const h of newEntries) {
        const entryT = new Date(h.entryTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const exitT = new Date(h.exitTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const pnlStr = (h.pnl >= 0 ? '+' : '') + h.pnl.toFixed(2);
        addLog(`◀ 종료 ${h.symbol} / ${h.positionSide} / ${h.leverage}x / ${entryT}→${exitT} / PnL ${pnlStr} (${reasonMap[h.closeReason] ?? h.closeReason})`);
      }
    }
    prevHistoryRef.current = curr;
  }, [paper.history, addLog]);

  /** Keeps mark prices available for drift filter and time-stop checks. */
  const setMarkPrices = useCallback((prices: Record<string, number>) => {
    markPricesRef.current = prices;
  }, []);

  // Refresh displayed mark prices every 3s so position cards show live unrealized PnL
  useEffect(() => {
    const timer = setInterval(() => {
      if (Object.keys(markPricesRef.current).length > 0) {
        setMarkPricesState({ ...markPricesRef.current });
      }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const runScan = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg || !cfg.enabled || scanningRef.current) return;
    const syms = symbolsRef.current;
    if (syms.length === 0) return;

    const governor = getBinanceGovernorSnapshot();
    if (governor.cooldownUntil > Date.now()) return;

    if (cfg.maxPositions > 0 && paperRef.current.positions.length >= cfg.maxPositions) {
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

    const activeScanFn = cfg.strategyId === 'leader-retest'
      ? createLeaderRetestScan({
          minBars: cfg.retestMinBars,
          maxBars: cfg.retestMaxBars,
          toleranceAtr: cfg.retestToleranceAtr,
          maxOvershootAtr: cfg.retestMaxOvershootAtr,
          require4hTrend: cfg.require4hTrend,
        })
      : cfg.strategyId === 'fvg-poc-ema72'
      ? createFvgPocEma72Scan({
          fvgPocLookbackBars: cfg.fvgPocLookbackBars,
          fvgPocBins: cfg.fvgPocBins,
          fvgEmaPeriod: cfg.fvgEmaPeriod,
          fvgUniverseTopN: cfg.fvgUniverseTopN,
          fvgDirection: cfg.fvgDirection,
        })
      : runBreakoutScan;

    // Direction override per strategy
    const scanDirection = cfg.strategyId === 'leader-retest'
      ? (cfg.retestAutoDirection ?? cfg.direction as 'long' | 'both')
      : cfg.strategyId === 'fvg-poc-ema72'
      ? (cfg.fvgDirection ?? cfg.direction)
      : (cfg.breakoutDirection ?? cfg.direction);

    const entered = new Set<string>();

    for (const interval of dueIntervals) {
      // ── Breakout / FVG: max signal age guard ──────────────────────────────
      // Applied to breakout-type strategies (breakout, fvg-poc-ema72).
      // leader-retest is a pull-back entry — signal age concept does not apply.
      if ((cfg.strategyId === 'breakout' || cfg.strategyId === 'fvg-poc-ema72') && cfg.maxSignalAgeSec != null && cfg.maxSignalAgeSec > 0) {
        const elapsedSec = (Date.now() - boundaryTime) / 1000;
        if (elapsedSec > cfg.maxSignalAgeSec) {
          continue;
        }
      }

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
            busyPolicy: 'queue',
          },
        );
      } catch (e) {
        addLog(`⚠ 스캔 오류 [${interval}]: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      const qualified = candidates
        .filter(c => c.score >= cfg.minScore)
        .sort((a, b) => b.score - a.score);

      for (const c of qualified) {
        const key = `${c.symbol}_${c.direction}`;
        if (entered.has(key)) continue;

        const curPositions = paperRef.current.positions;
        if (cfg.maxPositions > 0 && curPositions.length >= cfg.maxPositions) break;
        if (curPositions.some(p =>
          p.symbol === c.symbol &&
          p.positionSide === (c.direction === 'long' ? 'LONG' : 'SHORT'),
        )) continue;

        // ── Gate 2: maxConcurrentCorrelatedPositions ───────────────────────
        if (cfg.maxConcurrentCorrelatedPositions && cfg.maxConcurrentCorrelatedPositions > 0) {
          const sideStr = c.direction === 'long' ? 'LONG' : 'SHORT';
          const sameDir = curPositions.filter(p => p.positionSide === sideStr).length;
          if (sameDir >= cfg.maxConcurrentCorrelatedPositions) {
            continue;
          }
        }

        // ── Breakout candidate filters (entry-to-SL based) ────────────────
        if (cfg.strategyId === 'breakout') {
          if (cfg.maxBreakoutExtensionPct != null && cfg.maxBreakoutExtensionPct > 0) {
            const extPct = Math.abs(c.entryPrice - c.slPrice) / c.entryPrice * 100;
            if (extPct > cfg.maxBreakoutExtensionPct) {
              continue;
            }
          }
          if (cfg.maxEntryDriftPct != null && cfg.maxEntryDriftPct > 0) {
            const mark = markPricesRef.current[c.symbol];
            if (mark && mark > 0) {
              const driftPct = Math.abs(mark - c.entryPrice) / c.entryPrice * 100;
              if (driftPct > cfg.maxEntryDriftPct) {
                continue;
              }
            }
          }
        }

        // ── FVG POC-based candidate filters ───────────────────────────────
        // Extension: how far the confirmed bar closed beyond the rolling POC.
        // Drift: directional check (only block if chasing, not fading).
        if (cfg.strategyId === 'fvg-poc-ema72') {
          if (cfg.maxBreakoutExtensionPct != null && cfg.maxBreakoutExtensionPct > 0) {
            // Prefer pre-computed POC-based extension; fall back to triggerSpec.fixedPrice (= poc)
            const extPct = c.fvgBreakoutExtensionPct != null
              ? c.fvgBreakoutExtensionPct
              : c.direction === 'long'
                ? (c.entryPrice - c.triggerSpec.fixedPrice) / c.triggerSpec.fixedPrice * 100
                : (c.triggerSpec.fixedPrice - c.entryPrice) / c.triggerSpec.fixedPrice * 100;
            if (extPct > cfg.maxBreakoutExtensionPct) {
              continue;
            }
          }
          if (cfg.maxEntryDriftPct != null && cfg.maxEntryDriftPct > 0) {
            const mark = markPricesRef.current[c.symbol];
            if (mark && mark > 0) {
              const rawDrift = (mark - c.entryPrice) / c.entryPrice * 100;
              const isChasing = c.direction === 'long' ? rawDrift > 0 : rawDrift < 0;
              if (isChasing && Math.abs(rawDrift) > cfg.maxEntryDriftPct) {
                continue;
              }
            }
          }
        }

        // Risk-based position sizing
        const balance = paperRef.current.balance;
        const riskAmt = balance * (cfg.riskPct / 100);
        const riskPerUnit = Math.abs(c.entryPrice - c.slPrice);
        if (riskPerUnit <= 0) {
          continue;
        }
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

        // Guard: skip if current mark price has already breached the SL.
        // The main paper ledger uses limit orders (no fill below entry), but the lab
        // opens positions directly at the scan price — so we replicate the SL-breach
        // rejection that the main system would apply.
        const currentMark = markPricesRef.current[c.symbol] ?? 0;
        if (currentMark > 0) {
          const isLong = c.direction === 'long';
          if (isLong && currentMark <= c.slPrice) {
            addLog(`⚠ ${c.symbol} SL 이탈 — 현재가 ${currentMark.toFixed(4)} ≤ SL ${c.slPrice.toFixed(4)} — 진입 건너뜀`);
            continue;
          }
          if (!isLong && currentMark >= c.slPrice) {
            addLog(`⚠ ${c.symbol} SL 이탈 — 현재가 ${currentMark.toFixed(4)} ≥ SL ${c.slPrice.toFixed(4)} — 진입 건너뜀`);
            continue;
          }
        }

        const side: 'LONG' | 'SHORT' = c.direction === 'long' ? 'LONG' : 'SHORT';
        paperRef.current.openPosition(
          c.symbol, side, qty, c.entryPrice, cfg.leverage, 'isolated',
          c.tpPrice, c.slPrice, altMeta,
        );

        entered.add(key);
      }
    }
    scanningRef.current = false;
    setScanning(false);
  }, [addLog]);

  const runScanRef = useRef(runScan);
  runScanRef.current = runScan;

  // ── Cadence scheduler ─────────────────────────────────────────────────────
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
        // Stagger scans by slotIndex * 12s to avoid all experiments hitting the Binance governor simultaneously
        const staggerMs = slotIndex * 12_000;
        if (staggerMs > 0) {
          setTimeout(() => runScanRef.current(), staggerMs);
        } else {
          runScanRef.current();
        }
      }
    }, SCHEDULE_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [config?.enabled, config?.cadenceMinutes]);

  // ── Lab-only time-stop ────────────────────────────────────────────────────
  // Runs on a 30s polling loop; completely isolated from main paper/live ledger.
  useEffect(() => {
    const timer = setInterval(() => {
      const cfg = configRef.current;
      if (!cfg?.labTimeStopEnabled || !cfg.labTimeStopBars || cfg.labTimeStopBars <= 0) return;
      const positions = paperRef.current.positions;
      const closedThisTick = new Set<string>();
      for (const pos of positions) {
        if (closedThisTick.has(pos.id) || !pos.altMeta) continue;
        const scanIv = (pos.altMeta.scanInterval ?? cfg.scanIntervals[0]) as ScanInterval;
        const maxHoldMs = cfg.labTimeStopBars * intervalToMs(scanIv);
        if (Date.now() - pos.entryTime < maxHoldMs) continue;
        const mark = markPricesRef.current[pos.symbol];
        if (!mark || mark <= 0) continue;
        paperRef.current.closePosition(pos.id, mark, 'expired');
        closedThisTick.add(pos.id);
      }
    }, TIMESTOP_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // ── Computed stats ────────────────────────────────────────────────────────
  const history = paper.history;
  const wins = history.filter(h => h.pnl > 0).length;
  const winRate = history.length > 0 ? (wins / history.length) * 100 : 0;
  const totalPnl = history.reduce((sum, h) => sum + h.pnl, 0);

  // Unrealized PnL from open positions using latest mark prices
  // - totalEquity uses (gross - exitFee) because balance already deducted entryFee
  // - display uses (gross - entryFee - exitFee) so that:
  //     초기잔고 + 실현손익 + 미실현PnL == 총자산  (no hidden gap)
  const FEE_RATE = 0.0004;
  const openMarginSum = paper.positions.reduce((sum, pos) => sum + pos.isolatedMargin, 0);
  let unrealizedGrossMinusExit = 0;
  let unrealizedPnl = 0;
  for (const pos of paper.positions) {
    const mark = markPricesState[pos.symbol] ?? 0;
    if (!mark) continue;
    const qty = Math.abs(pos.positionAmt);
    const rawPnl = (pos.positionSide === 'LONG' ? mark - pos.entryPrice : pos.entryPrice - mark) * qty;
    const entryFee = pos.entryPrice * qty * FEE_RATE;
    const exitFee  = mark * qty * FEE_RATE;
    unrealizedGrossMinusExit += rawPnl - exitFee;
    unrealizedPnl            += rawPnl - entryFee - exitFee;
  }

  // Total equity = available cash + locked margins + gross unrealized (exit fee only)
  // This equals the liquidation value: what you'd receive if closing all positions at mark now.
  const totalEquity = paper.balance + openMarginSum + unrealizedGrossMinusExit;
  const pnlPct = paper.initialBalance > 0
    ? ((totalEquity - paper.initialBalance) / paper.initialBalance) * 100
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
    setMarkPrices,
    markPrices: markPricesState,
    stats: {
      balance: totalEquity,
      availableBalance: paper.balance,
      initialBalance: paper.initialBalance,
      positionCount: paper.positions.length,
      historyCount: history.length,
      winCount: wins,
      winRate,
      totalPnl,
      unrealizedPnl,
      pnlPct,
      ...extended,
    },
  };
}

export type LabExperiment = ReturnType<typeof useLabExperiment>;
