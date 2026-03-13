export type BinanceRequestScope = 'signed' | 'public' | 'scan' | 'enrich';

interface GovernorFetchOptions {
  weight: number;
  scope: BinanceRequestScope;
  label?: string;
}

interface GovernorSnapshot {
  usedWeight1m: number;
  inFlight: number;
  cooldownUntil: number;
  cooldownReason: 418 | 429 | null;
  scanDelayPenaltyMs: number;
  scanConcurrencyCap: number;
  activeScanTag: string | null;
  queuedScans: number;
}

type GovernorEvent =
  | { type: 'delayed'; waitMs: number; label?: string; scope: BinanceRequestScope }
  | { type: 'status'; status: 429 | 418; retryAfterMs: number; label?: string }
  | { type: 'scan-queued'; tag: string; activeTag: string }
  | { type: 'scan-skipped'; tag: string; activeTag: string }
  | { type: 'scan-start'; tag: string; waitedMs: number }
  | { type: 'scan-end'; tag: string };

type GovernorListener = (event: GovernorEvent) => void;

interface ScanQueueItem {
  tag: string;
  resolve: () => void;
}

const WEIGHT_WINDOW_MS = 60_000;
// Binance 공식 한도(2400/분)보다 보수적으로 운영
const SOFT_WEIGHT_LIMIT_PER_MIN = 1800;
const MAX_IN_FLIGHT = 8;

const weightReservations: Array<{ ts: number; weight: number }> = [];
let inFlight = 0;
let cooldownUntil = 0;
let cooldownReason: 418 | 429 | null = null;
let scanPenaltyUntil = 0;
let scanDelayPenaltyMs = 0;
let scanConcurrencyCap = 4;
let usedWeight1mHint = 0;

const listeners = new Set<GovernorListener>();

let scanBusy = false;
let activeScanTag: string | null = null;
const scanQueue: ScanQueueItem[] = [];

function emit(event: GovernorEvent) {
  for (const l of listeners) {
    try { l(event); } catch {}
  }
}

function nowMs() {
  return Date.now();
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function pruneReservations(now: number) {
  while (weightReservations.length > 0 && now - weightReservations[0].ts > WEIGHT_WINDOW_MS) {
    weightReservations.shift();
  }
}

function currentUsedWeight(now: number): number {
  pruneReservations(now);
  let sum = 0;
  for (const x of weightReservations) sum += x.weight;
  return sum;
}

function parseRetryAfterMs(res: Response): number {
  const raw = res.headers.get('Retry-After');
  if (!raw) return 0;
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.max(1000, Math.round(sec * 1000));
}

function applyRateLimitStatus(status: 429 | 418, retryAfterMs: number, label?: string) {
  const now = nowMs();
  const fallback = status === 418 ? 180_000 : 20_000;
  const duration = Math.max(retryAfterMs, fallback);
  cooldownUntil = Math.max(cooldownUntil, now + duration);
  cooldownReason = status;

  if (status === 429) {
    scanDelayPenaltyMs = Math.min(1200, Math.max(scanDelayPenaltyMs + 150, 250));
    scanConcurrencyCap = Math.max(1, Math.min(scanConcurrencyCap, 2));
    scanPenaltyUntil = Math.max(scanPenaltyUntil, now + 4 * 60_000);
  } else {
    scanDelayPenaltyMs = Math.max(scanDelayPenaltyMs, 900);
    scanConcurrencyCap = 1;
    scanPenaltyUntil = Math.max(scanPenaltyUntil, now + 8 * 60_000);
  }

  emit({ type: 'status', status, retryAfterMs: duration, label });
}

function decayPenalties(now: number) {
  if (scanPenaltyUntil > 0 && now >= scanPenaltyUntil) {
    scanPenaltyUntil = 0;
    scanDelayPenaltyMs = 0;
    scanConcurrencyCap = 4;
    cooldownReason = now >= cooldownUntil ? null : cooldownReason;
    return;
  }
  if (scanPenaltyUntil > now) {
    const remain = scanPenaltyUntil - now;
    if (remain < 120_000 && scanDelayPenaltyMs > 0) {
      scanDelayPenaltyMs = Math.max(100, Math.floor(scanDelayPenaltyMs * 0.9));
      scanConcurrencyCap = Math.max(1, Math.min(4, scanConcurrencyCap + 1));
    }
  }
}

async function acquireBudget(weight: number, scope: BinanceRequestScope, label?: string) {
  const start = nowMs();
  while (true) {
    const now = nowMs();
    decayPenalties(now);

    if (cooldownUntil > now) {
      await sleep(Math.min(1000, cooldownUntil - now));
      continue;
    }

    const used = currentUsedWeight(now);
    const projected = used + weight;
    if (projected > SOFT_WEIGHT_LIMIT_PER_MIN) {
      const earliest = weightReservations[0]?.ts ?? now;
      const waitMs = Math.max(120, (earliest + WEIGHT_WINDOW_MS) - now + 25);
      await sleep(waitMs);
      continue;
    }

    if (inFlight >= MAX_IN_FLIGHT) {
      await sleep(100);
      continue;
    }

    weightReservations.push({ ts: now, weight });
    inFlight += 1;
    const waited = now - start;
    if (waited >= 250) {
      emit({ type: 'delayed', waitMs: waited, label, scope });
    }
    return;
  }
}

function releaseBudget() {
  inFlight = Math.max(0, inFlight - 1);
}

export async function governedBinanceFetch(input: string, init: RequestInit | undefined, opts: GovernorFetchOptions): Promise<Response> {
  const weight = Math.max(1, Math.round(opts.weight || 1));
  await acquireBudget(weight, opts.scope, opts.label);
  try {
    const res = await fetch(input, init);

    const usedHeader = res.headers.get('x-mbx-used-weight-1m') || res.headers.get('X-MBX-USED-WEIGHT-1M');
    const usedParsed = Number(usedHeader);
    if (Number.isFinite(usedParsed) && usedParsed >= 0) {
      usedWeight1mHint = usedParsed;
    }

    if (res.status === 429 || res.status === 418) {
      applyRateLimitStatus(res.status, parseRetryAfterMs(res), opts.label);
    }
    return res;
  } finally {
    releaseBudget();
  }
}

export function getBinanceGovernorSnapshot(): GovernorSnapshot {
  const now = nowMs();
  decayPenalties(now);
  return {
    usedWeight1m: Math.max(currentUsedWeight(now), usedWeight1mHint),
    inFlight,
    cooldownUntil,
    cooldownReason,
    scanDelayPenaltyMs,
    scanConcurrencyCap: Math.max(1, scanConcurrencyCap),
    activeScanTag,
    queuedScans: scanQueue.length,
  };
}

export function onBinanceGovernorEvent(listener: GovernorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface AcquireScanOptions {
  tag: string;
  policy?: 'queue' | 'skip';
}

export interface AcquiredScanSlot {
  waitedMs: number;
  release: () => void;
}

export async function acquireScanSlot(options: AcquireScanOptions): Promise<AcquiredScanSlot | null> {
  const policy = options.policy ?? 'queue';
  const tag = options.tag;
  if (!scanBusy) {
    scanBusy = true;
    activeScanTag = tag;
    emit({ type: 'scan-start', tag, waitedMs: 0 });
    return {
      waitedMs: 0,
      release: () => {
        if (!scanBusy || activeScanTag !== tag) return;
        const next = scanQueue.shift();
        if (next) {
          activeScanTag = next.tag;
          next.resolve();
        } else {
          scanBusy = false;
          activeScanTag = null;
        }
        emit({ type: 'scan-end', tag });
      },
    };
  }

  const currentTag = activeScanTag ?? 'unknown';
  if (policy === 'skip') {
    emit({ type: 'scan-skipped', tag, activeTag: currentTag });
    return null;
  }

  emit({ type: 'scan-queued', tag, activeTag: currentTag });
  const queuedAt = nowMs();
  await new Promise<void>(resolve => {
    scanQueue.push({ tag, resolve });
  });
  const waitedMs = Math.max(0, nowMs() - queuedAt);
  emit({ type: 'scan-start', tag, waitedMs });
  return {
    waitedMs,
    release: () => {
      if (!scanBusy || activeScanTag !== tag) return;
      const next = scanQueue.shift();
      if (next) {
        activeScanTag = next.tag;
        next.resolve();
      } else {
        scanBusy = false;
        activeScanTag = null;
      }
      emit({ type: 'scan-end', tag });
    },
  };
}

export function computeKlineWeight(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 1;
  if (limit >= 1000) return 10;
  if (limit >= 500) return 5;
  if (limit >= 100) return 2;
  return 1;
}
