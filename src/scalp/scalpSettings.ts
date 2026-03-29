/**
 * Settings schema and persistence for the scalp auto-trade module.
 * Stored separately from alt-auto settings (different localStorage key).
 */

export interface ScalpSettings {
  /** Master on/off switch. */
  enabled: boolean;
  /** Symbols to scan and trade. */
  symbols: string[];

  // ── Execution ──────────────────────────────────────────────────────────────
  /** Futures leverage (1–125). */
  leverage: number;
  /** Margin mode. */
  marginType: 'ISOLATED' | 'CROSSED';
  /** Maximum risk per trade in USD (stop distance × notional). */
  maxPerTradeRiskUsd: number;
  /** Maximum total open notional exposure across all scalp positions (USD). */
  maxOpenExposureUsd: number;
  /** How long entry limit orders stay open before cancel (ms). */
  entryTtlMs: number;
  /** Maximum reprice attempts before skipping. Each reprice resets TTL. */
  maxRepriceCount: number;

  // ── Signal ─────────────────────────────────────────────────────────────────
  /** Which signal types to activate. */
  signalMode: 'momentum' | 'revert' | 'both';
  /** Minimum imbalance (|bid−ask| / total) required for momentum signal. */
  minImbalance: number;
  /** Minimum trade pressure magnitude for momentum signal. */
  minTradePressure: number;

  // ── Risk gates ─────────────────────────────────────────────────────────────
  /** Block entry when spread exceeds this (bps). */
  maxSpreadBps: number;
  /** Block entry when bid-side depth within 10 bps < this (USD). */
  minDepthUsd: number;
  /** Block entry when market data is older than this (ms). */
  maxLatencyMs: number;
  /** Cooldown per symbol after any trade exit (ms). */
  symbolCooldownMs: number;
  /** Pause all entries after this many consecutive losses. */
  consecutiveLossBreaker: number;
  /** Maximum scalp entries per session. */
  maxDailyTrades: number;
}

export const DEFAULT_SCALP_SETTINGS: ScalpSettings = {
  enabled: false,
  symbols: [],
  leverage: 3,
  marginType: 'ISOLATED',
  maxPerTradeRiskUsd: 10,
  maxOpenExposureUsd: 100,
  entryTtlMs: 3_000,
  maxRepriceCount: 2,
  signalMode: 'both',
  minImbalance: 0.20,
  minTradePressure: 0.20,
  maxSpreadBps: 3,
  minDepthUsd: 50_000,
  maxLatencyMs: 500,
  symbolCooldownMs: 30_000,
  consecutiveLossBreaker: 3,
  maxDailyTrades: 50,
};

const STORAGE_KEY = 'scalp_settings_v1';

export function loadScalpSettings(): ScalpSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SCALP_SETTINGS };
    return { ...DEFAULT_SCALP_SETTINGS, ...(JSON.parse(raw) as Partial<ScalpSettings>) };
  } catch {
    return { ...DEFAULT_SCALP_SETTINGS };
  }
}

export function saveScalpSettings(settings: ScalpSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}
