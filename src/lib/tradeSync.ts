import {
  collection, addDoc, serverTimestamp, updateDoc, setDoc,
  doc, getDoc, query, orderBy, getDocs, where, arrayUnion,
  type Timestamp, type DocumentReference,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import type { LiveTradeHistoryEntry } from '../types/futures';

// ── Firestore collections ──────────────────────────────────────────────────────
export const TRADE_HISTORY_COL  = 'tradeHistory';
export const CONFIG_DOC         = 'config/leaderboard';
export const LIVE_POSITIONS_COL = 'livePositions';

// ── localStorage key helpers ───────────────────────────────────────────────────
const uploadedKey = (user: string) => `lb_uploaded_${user}`;

export function getUploadedIds(userId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(uploadedKey(userId)) ?? '[]') as string[]); }
  catch { return new Set(); }
}

export function markUploaded(userId: string, tradeId: string): void {
  const ids = getUploadedIds(userId);
  ids.add(tradeId);
  try { localStorage.setItem(uploadedKey(userId), JSON.stringify([...ids].slice(-3000))); } catch {}
}

// ── Trade upload ───────────────────────────────────────────────────────────────
export async function uploadTradeToFirestore(
  entry: LiveTradeHistoryEntry,
  userId: string,
): Promise<DocumentReference | null> {
  if (!isFirebaseConfigured()) return null;
  if (!entry.pnl && entry.pnl !== 0) return null;
  return addDoc(collection(db, TRADE_HISTORY_COL), {
    userId,
    tradeId:      entry.id,
    symbol:       entry.symbol,
    positionSide: entry.positionSide,
    pnl:          entry.pnl,
    qty:          entry.qty,
    entryPrice:   entry.entryPrice ?? null,
    exitPrice:    entry.exitPrice  ?? null,
    entryTime:    entry.entryTime  ?? null,
    exitTime:     entry.exitTime,
    closeReason:  entry.closeReason,
    leverage:     entry.leverage    ?? null,
    isAltTrade:   entry.isAltTrade  ?? false,
    marginType:   entry.marginType  ?? null,
    interval:     entry.interval    ?? null,
    uploadedAt:   serverTimestamp(),
  });
}

export interface TradeEnrichPatch {
  entryTime?:  number | null;
  pnl?:        number;
  entryPrice?: number;
  exitPrice?:  number;
  qty?:        number;
}

export async function patchTradeDoc(docId: string, patch: TradeEnrichPatch): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const fields: Record<string, unknown> = {};
  if (patch.entryTime  != null) fields.entryTime  = patch.entryTime;
  if (patch.pnl        != null) fields.pnl        = patch.pnl;
  if (patch.entryPrice != null) fields.entryPrice  = patch.entryPrice;
  if (patch.exitPrice  != null) fields.exitPrice   = patch.exitPrice;
  if (patch.qty        != null) fields.qty         = patch.qty;
  if (Object.keys(fields).length > 0) {
    await updateDoc(doc(db, TRADE_HISTORY_COL, docId), fields);
  }
}

// ── Leaderboard data fetch ─────────────────────────────────────────────────────
export interface LeaderboardTrade {
  id:           string;
  userId:       string;
  symbol:       string;
  positionSide: 'LONG' | 'SHORT';
  pnl:          number;
  qty:          number;
  entryPrice:   number | null;
  exitPrice:    number | null;
  entryTime:    number | null;
  exitTime:     number;
  closeReason:  string;
  leverage:     number | null;
  isAltTrade:   boolean;
  marginType:   'isolated' | 'cross' | null;
  interval:     string | null;
}

export interface LeaderboardUserStats {
  userId:    string;
  totalPnl:  number;
  winRate:   number;
  trades:    number;
  wins:      number;
  losses:    number;
  avgPnl:    number;
  bestTrade: number;
  worstTrade: number;
  rows:      LeaderboardTrade[];
}

function mapTrade(id: string, data: Record<string, unknown>): LeaderboardTrade {
  const ts = data.exitTime as number | Timestamp;
  const exitTime = typeof ts === 'number' ? ts : (ts as Timestamp).toMillis?.() ?? 0;
  const ets = data.entryTime as number | Timestamp | null;
  const entryTime = ets == null ? null
    : typeof ets === 'number' ? ets
    : (ets as Timestamp).toMillis?.() ?? null;
  return {
    id,
    userId:       data.userId as string,
    symbol:       data.symbol as string,
    positionSide: data.positionSide as 'LONG' | 'SHORT',
    pnl:          data.pnl as number,
    qty:          data.qty as number,
    entryPrice:   (data.entryPrice as number | null) ?? null,
    exitPrice:    (data.exitPrice  as number | null) ?? null,
    entryTime,
    exitTime,
    closeReason:  data.closeReason as string,
    leverage:     (data.leverage as number | null) ?? null,
    isAltTrade:   (data.isAltTrade as boolean) ?? false,
    marginType:   (data.marginType as 'isolated' | 'cross' | null) ?? null,
    interval:     (data.interval as string | null) ?? null,
  };
}

export async function fetchLeaderboard(
  sinceMs?: number,
): Promise<LeaderboardUserStats[]> {
  if (!isFirebaseConfigured()) return [];

  const col = collection(db, TRADE_HISTORY_COL);
  const constraints = sinceMs
    ? [orderBy('exitTime', 'desc'), where('exitTime', '>=', sinceMs)]
    : [orderBy('exitTime', 'desc')];

  const snap = await getDocs(query(col, ...constraints));
  const rawTrades = snap.docs.map(d => ({ doc: d, trade: mapTrade(d.id, d.data() as Record<string, unknown>), data: d.data() as Record<string, unknown> }));

  // Deduplicate: prefer tradeId field if present, else fallback to composite key.
  // Keeps the earliest-uploaded document (first seen wins).
  const dedupSeen = new Set<string>();
  const trades: LeaderboardTrade[] = [];
  for (const { trade, data } of rawTrades) {
    const tradeId = data.tradeId as string | undefined;
    const key = tradeId
      ? `${trade.userId}::${tradeId}`
      : `${trade.userId}::${trade.symbol}::${trade.positionSide}::${trade.exitTime}::${trade.pnl}`;
    if (dedupSeen.has(key)) continue;
    dedupSeen.add(key);
    trades.push(trade);
  }

  const byUser = new Map<string, LeaderboardTrade[]>();
  for (const t of trades) {
    if (!byUser.has(t.userId)) byUser.set(t.userId, []);
    byUser.get(t.userId)!.push(t);
  }

  const stats: LeaderboardUserStats[] = [];
  for (const [userId, rows] of byUser) {
    const wins   = rows.filter(r => r.pnl > 0).length;
    const losses = rows.filter(r => r.pnl < 0).length;
    const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
    const pnls = rows.map(r => r.pnl);
    stats.push({
      userId,
      totalPnl,
      winRate:    rows.length > 0 ? wins / rows.length : 0,
      trades:     rows.length,
      wins,
      losses,
      avgPnl:     rows.length > 0 ? totalPnl / rows.length : 0,
      bestTrade:  pnls.length > 0 ? Math.max(...pnls) : 0,
      worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
      rows:       rows.sort((a, b) => b.exitTime - a.exitTime),
    });
  }

  return stats.sort((a, b) => b.totalPnl - a.totalPnl);
}

// ── Access code verification ───────────────────────────────────────────────────
export async function verifyLeaderboardCode(code: string): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const snap = await getDoc(doc(db, 'config', 'leaderboard'));
    if (!snap.exists()) return false;
    return snap.data().accessCode === code.trim();
  } catch { return false; }
}

// ── Per-user leaderboard access management ────────────────────────────────────

export async function fetchLeaderboardAccessMap(): Promise<Record<string, boolean>> {
  if (!isFirebaseConfigured()) return {};
  try {
    const snap = await getDoc(doc(db, 'config', 'leaderboardAccess'));
    return snap.exists() ? (snap.data() as Record<string, boolean>) : {};
  } catch { return {}; }
}

export async function setUserLeaderboardAccess(userId: string, granted: boolean): Promise<void> {
  if (!isFirebaseConfigured()) return;
  await setDoc(doc(db, 'config', 'leaderboardAccess'), { [userId]: granted }, { merge: true });
}

export async function checkMyLeaderboardAccess(userId: string): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const snap = await getDoc(doc(db, 'config', 'leaderboardAccess'));
    return snap.exists() && snap.data()[userId] === true;
  } catch { return false; }
}

// ── Registered users registry ─────────────────────────────────────────────────
export async function registerUserInFirestore(userId: string): Promise<void> {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await setDoc(
      doc(db, 'config', 'registeredUsers'),
      { users: arrayUnion(userId) },
      { merge: true },
    );
  } catch {}
}

export async function registerUsersInFirestore(userIds: string[]): Promise<void> {
  if (!isFirebaseConfigured() || userIds.length === 0) return;
  try {
    await setDoc(
      doc(db, 'config', 'registeredUsers'),
      { users: arrayUnion(...userIds) },
      { merge: true },
    );
  } catch {}
}

export async function fetchRegisteredUsers(): Promise<string[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDoc(doc(db, 'config', 'registeredUsers'));
    if (!snap.exists()) return [];
    return (snap.data().users as string[]) ?? [];
  } catch { return []; }
}

export async function fetchAllKnownUsers(): Promise<string[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    // auto_trade_leader_locks has one doc per user — most reliable source
    const [lockSnap, regSnap] = await Promise.all([
      getDocs(collection(db, 'auto_trade_leader_locks')),
      getDoc(doc(db, 'config', 'registeredUsers')),
    ]);
    const fromLocks = lockSnap.docs.map(d => decodeURIComponent(d.id));
    const fromReg   = regSnap.exists() ? ((regSnap.data().users as string[]) ?? []) : [];
    return [...new Set([...fromLocks, ...fromReg])];
  } catch { return []; }
}

// ── Real-time open positions ──────────────────────────────────────────────────

export interface LivePositionEntry {
  symbol:           string;
  positionSide:     'LONG' | 'SHORT';
  qty:              number;
  entryPrice:       number;
  markPrice:        number;
  unrealizedPnl:    number;
  leverage:         number;
  liquidationPrice: number | null;
  marginType:       'isolated' | 'cross' | null;
  entryTime:        number | null;
  isAltTrade:       boolean;
  tp:               number | null;
  sl:               number | null;
  validUntil:       number | null;
}

export async function publishLivePositions(
  userId: string,
  positions: LivePositionEntry[],
): Promise<void> {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await setDoc(doc(db, LIVE_POSITIONS_COL, encodeURIComponent(userId)), {
      userId,
      positions,
      updatedAt: serverTimestamp(),
    });
  } catch {}
}

export async function fetchAllLivePositions(): Promise<Record<string, LivePositionEntry[]>> {
  if (!isFirebaseConfigured()) return {};
  try {
    const snap = await getDocs(collection(db, LIVE_POSITIONS_COL));
    const result: Record<string, LivePositionEntry[]> = {};
    for (const d of snap.docs) {
      const data = d.data() as { userId: string; positions: LivePositionEntry[] };
      if (data.userId && Array.isArray(data.positions)) {
        result[data.userId] = data.positions;
      }
    }
    return result;
  } catch { return {}; }
}
