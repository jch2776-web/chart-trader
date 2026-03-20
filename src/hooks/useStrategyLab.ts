import { useState, useCallback } from 'react';
import { useLabExperiment } from './useLabExperiment';
import type { LabExperimentConfig } from './useLabExperiment';

export const LAB_MAX_SLOTS = 4;

const DEFAULT_CONFIG: Omit<LabExperimentConfig, 'id' | 'name'> = {
  enabled: false,
  strategyId: 'breakout',
  scanIntervals: ['1h'],
  direction: 'both',
  minScore: 90,
  leverage: 10,
  riskPct: 2,
  cadenceMinutes: 60,
  maxPositions: 5,
  initialBalance: 10000,
};

function loadSlotConfigs(prefix: string): (LabExperimentConfig | null)[] {
  try {
    const raw = localStorage.getItem(`${prefix}:slots`);
    if (!raw) return Array(LAB_MAX_SLOTS).fill(null);
    const parsed = JSON.parse(raw) as (LabExperimentConfig | null)[];
    while (parsed.length < LAB_MAX_SLOTS) parsed.push(null);
    return parsed.slice(0, LAB_MAX_SLOTS);
  } catch {
    return Array(LAB_MAX_SLOTS).fill(null);
  }
}

function saveSlotConfigs(prefix: string, configs: (LabExperimentConfig | null)[]) {
  try {
    localStorage.setItem(`${prefix}:slots`, JSON.stringify(configs));
  } catch {}
}

export function useStrategyLab(storageKeyPrefix: string, symbols: string[]) {
  const [configs, setConfigs] = useState<(LabExperimentConfig | null)[]>(
    () => loadSlotConfigs(storageKeyPrefix),
  );

  // Fixed 4 slots — hook call count must be constant
  const slot0 = useLabExperiment(0, `${storageKeyPrefix}:exp0:state`, configs[0], symbols);
  const slot1 = useLabExperiment(1, `${storageKeyPrefix}:exp1:state`, configs[1], symbols);
  const slot2 = useLabExperiment(2, `${storageKeyPrefix}:exp2:state`, configs[2], symbols);
  const slot3 = useLabExperiment(3, `${storageKeyPrefix}:exp3:state`, configs[3], symbols);

  const experiments = [slot0, slot1, slot2, slot3];

  const persistAndSet = useCallback((next: (LabExperimentConfig | null)[]) => {
    saveSlotConfigs(storageKeyPrefix, next);
    setConfigs(next);
  }, [storageKeyPrefix]);

  const addExperiment = useCallback((
    cfg: Omit<LabExperimentConfig, 'id'> & Partial<Pick<LabExperimentConfig, 'id'>>,
  ) => {
    setConfigs(prev => {
      const emptySlot = prev.findIndex(c => c === null);
      if (emptySlot === -1) return prev;
      const id = cfg.id ?? `exp${emptySlot}`;
      const next = [...prev];
      next[emptySlot] = { ...DEFAULT_CONFIG, ...cfg, id };
      saveSlotConfigs(storageKeyPrefix, next);
      return next;
    });
  }, [storageKeyPrefix]);

  const removeExperiment = useCallback((slotIndex: number) => {
    setConfigs(prev => {
      const next = [...prev];
      next[slotIndex] = null;
      saveSlotConfigs(storageKeyPrefix, next);
      return next;
    });
  }, [storageKeyPrefix]);

  const updateExperiment = useCallback((slotIndex: number, updates: Partial<LabExperimentConfig>) => {
    setConfigs(prev => {
      const current = prev[slotIndex];
      if (!current) return prev;
      const next = [...prev];
      next[slotIndex] = { ...current, ...updates };
      saveSlotConfigs(storageKeyPrefix, next);
      return next;
    });
  }, [storageKeyPrefix]);

  // Forward mark prices to all active experiment paper engines + drift/time-stop refs
  const checkPrices = useCallback((markPrices: Record<string, number>) => {
    slot0.paper.checkPrices(markPrices); slot0.setMarkPrices(markPrices);
    slot1.paper.checkPrices(markPrices); slot1.setMarkPrices(markPrices);
    slot2.paper.checkPrices(markPrices); slot2.setMarkPrices(markPrices);
    slot3.paper.checkPrices(markPrices); slot3.setMarkPrices(markPrices);
  }, [slot0.paper, slot0.setMarkPrices, slot1.paper, slot1.setMarkPrices,
      slot2.paper, slot2.setMarkPrices, slot3.paper, slot3.setMarkPrices]);

  const canAdd = configs.some(c => c === null);
  const activeCount = configs.filter(Boolean).length;

  // All unique symbols currently held as positions or orders across all lab ledgers.
  // Used by App.tsx to extend the REST price-fetch target list so lab-only symbols
  // receive mark price updates and trigger TP/SL/liquidation correctly.
  const labSymbols = [...new Set([
    slot0.paper.positions.map(p => p.symbol),
    slot0.paper.orders.map(o => o.symbol),
    slot1.paper.positions.map(p => p.symbol),
    slot1.paper.orders.map(o => o.symbol),
    slot2.paper.positions.map(p => p.symbol),
    slot2.paper.orders.map(o => o.symbol),
    slot3.paper.positions.map(p => p.symbol),
    slot3.paper.orders.map(o => o.symbol),
  ].flat())];

  return {
    experiments,
    configs,
    addExperiment,
    removeExperiment,
    updateExperiment,
    persistAndSet,
    checkPrices,
    labSymbols,
    canAdd,
    activeCount,
    maxSlots: LAB_MAX_SLOTS,
  };
}

export type StrategyLab = ReturnType<typeof useStrategyLab>;
