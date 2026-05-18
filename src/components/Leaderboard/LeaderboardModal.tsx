import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchLeaderboard,
  fetchAllLivePositions,
  verifyLeaderboardCode,

  type LeaderboardTrade,
  type LeaderboardUserStats,
  type LivePositionEntry,
} from '../../lib/tradeSync';
import { isAdmin, grantLeaderboardAccess } from '../../hooks/useAuth';
import { isFirebaseConfigured } from '../../lib/firebase';
import { LeaderboardStats } from './LeaderboardStats';
import { LeaderboardAccessPanel } from './LeaderboardAccessPanel';

// ── CSS keyframe animations ────────────────────────────────────────────────────
const LEADERBOARD_CSS = `
  @keyframes lb-glare {
    0%   { transform: translateX(-180%) skewX(-15deg); opacity: 0; }
    8%   { opacity: 1; }
    55%  { opacity: 1; }
    75%  { transform: translateX(230%) skewX(-15deg); opacity: 0; }
    100% { transform: translateX(230%) skewX(-15deg); opacity: 0; }
  }
  @keyframes lb-gold-glow {
    0%, 100% { box-shadow: 0 4px 24px rgba(240,185,11,0.30), 0 0 55px rgba(240,185,11,0.13), inset 0 0 20px rgba(240,185,11,0.04); }
    50%       { box-shadow: 0 8px 44px rgba(240,185,11,0.52), 0 0 90px rgba(240,185,11,0.24), 0 0 130px rgba(240,185,11,0.09), inset 0 0 30px rgba(240,185,11,0.08); }
  }
  @keyframes lb-silver-glow {
    0%, 100% { box-shadow: 0 4px 18px rgba(192,200,212,0.20), 0 0 38px rgba(192,200,212,0.09); }
    50%       { box-shadow: 0 6px 30px rgba(192,200,212,0.36), 0 0 60px rgba(192,200,212,0.17); }
  }
  @keyframes lb-bronze-glow {
    0%, 100% { box-shadow: 0 4px 18px rgba(205,127,50,0.20), 0 0 38px rgba(205,127,50,0.09); }
    50%       { box-shadow: 0 6px 30px rgba(205,127,50,0.36), 0 0 60px rgba(205,127,50,0.17); }
  }
  @keyframes lb-medal-float {
    0%, 100% { transform: translateY(0px) scale(1); }
    50%       { transform: translateY(-5px) scale(1.1); }
  }
  @keyframes lb-star-twinkle {
    0%, 100% { opacity: 0.15; transform: scale(0.65) rotate(0deg); }
    50%       { opacity: 1;    transform: scale(1.35) rotate(18deg); }
  }
  .lb-gold   { animation: lb-gold-glow   2.8s ease-in-out infinite; }
  .lb-silver { animation: lb-silver-glow 3.2s ease-in-out infinite; }
  .lb-bronze { animation: lb-bronze-glow 3.8s ease-in-out infinite; }
`;

// ── Coin logo ──────────────────────────────────────────────────────────────────
function CoinLogo({ symbol, size = 14 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const base = symbol.replace(/USDT$|BUSD$|USDC$|USD$/, '').toLowerCase();
  if (failed) return null;
  return (
    <img
      src={`https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${base}.svg`}
      alt={base}
      width={size}
      height={size}
      style={{ borderRadius: '50%', flexShrink: 0, verticalAlign: 'middle', display: 'inline-block' }}
      onError={() => setFailed(true)}
    />
  );
}

// ── Podium hero ───────────────────────────────────────────────────────────────
function PodiumHero({ stats }: { stats: LeaderboardUserStats[] }) {
  if (stats.length === 0) return null;

  const medals   = ['🥇', '🥈', '🥉'];
  const rankNums = ['01', '02', '03'];

  const colors = [
    {
      cardClass:  'lb-gold',
      primary:    '#f0b90b',
      border:     '1.5px solid rgba(240,185,11,0.72)',
      bg:         'linear-gradient(155deg, rgba(240,185,11,0.12) 0%, rgba(26,30,43,0.97) 52%, rgba(10,12,20,0.99) 100%)',
      topBar:     'linear-gradient(90deg, transparent 0%, #f0b90b 50%, transparent 100%)',
      glareColor: 'rgba(255,248,210,0.30)',
      glareDelay: '0s',
    },
    {
      cardClass:  'lb-silver',
      primary:    '#c0c8d4',
      border:     '1px solid rgba(192,200,212,0.44)',
      bg:         'linear-gradient(155deg, rgba(192,200,212,0.08) 0%, rgba(24,28,39,0.97) 100%)',
      topBar:     'linear-gradient(90deg, transparent 0%, rgba(192,200,212,0.85) 50%, transparent 100%)',
      glareColor: 'rgba(230,240,255,0.22)',
      glareDelay: '1.5s',
    },
    {
      cardClass:  'lb-bronze',
      primary:    '#cd7f32',
      border:     '1px solid rgba(205,127,50,0.44)',
      bg:         'linear-gradient(155deg, rgba(205,127,50,0.08) 0%, rgba(24,28,39,0.97) 100%)',
      topBar:     'linear-gradient(90deg, transparent 0%, rgba(205,127,50,0.85) 50%, transparent 100%)',
      glareColor: 'rgba(255,235,200,0.22)',
      glareDelay: '3s',
    },
  ] as const;

  // Screen order: 2nd | 1st | 3rd
  const displayOrder = [1, 0, 2];

  return (
    <div style={{
      padding: '18px 16px 14px',
      borderBottom: '1px solid #2a2e39',
      background: 'linear-gradient(180deg, rgba(5,7,14,0.92) 0%, rgba(16,20,32,0.55) 100%)',
    }}>
      {/* Section title */}
      <div style={{
        textAlign: 'center',
        marginBottom: 14,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.24em',
        color: '#4e5566',
        textTransform: 'uppercase',
      }}>
        <span style={{ color: '#f0b90b', marginRight: 10, fontSize: 13 }}>✦</span>
        Top 3 Traders
        <span style={{ color: '#f0b90b', marginLeft: 10, fontSize: 13 }}>✦</span>
      </div>

      {/* Podium cards */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', justifyContent: 'center' }}>
        {displayOrder.map(rankIdx => {
          if (rankIdx >= stats.length) return null;
          const user    = stats[rankIdx];
          const c       = colors[rankIdx];
          const isFirst = rankIdx === 0;
          const cardH   = isFirst ? 198 : rankIdx === 1 ? 163 : 150;

          return (
            <div
              key={rankIdx}
              className={c.cardClass}
              style={{
                position: 'relative',
                flex: isFirst ? '0 0 36%' : '0 0 26%',
                minHeight: cardH,
                background: c.bg,
                border: c.border,
                borderRadius: isFirst ? 14 : 10,
                padding: isFirst ? '16px 14px 14px' : '12px 10px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: isFirst ? 4 : 2,
              }}
            >
              {/* Top accent line */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                height: isFirst ? 3 : 2,
                background: c.topBar,
                borderRadius: 'inherit',
              }} />

              {/* Glare sweep */}
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit', pointerEvents: 'none' }}>
                <div style={{
                  position: 'absolute',
                  top: '-50%',
                  width: '30%',
                  height: '200%',
                  background: `linear-gradient(90deg, transparent 0%, ${c.glareColor} 50%, transparent 100%)`,
                  transform: 'skewX(-15deg)',
                  animation: `lb-glare 4.5s ${c.glareDelay} ease-in-out infinite`,
                }} />
              </div>

              {/* Corner sparkles — 1st only */}
              {isFirst && (
                <>
                  <span style={{ position: 'absolute', top: 10, left: 11, fontSize: 9, color: '#f0b90b', animation: 'lb-star-twinkle 1.6s 0.2s ease-in-out infinite', pointerEvents: 'none' }}>✦</span>
                  <span style={{ position: 'absolute', top: 15, right: 12, fontSize: 8, color: '#f0b90bcc', animation: 'lb-star-twinkle 2.1s 0.8s ease-in-out infinite', pointerEvents: 'none' }}>✧</span>
                  <span style={{ position: 'absolute', bottom: 15, left: 12, fontSize: 7, color: '#f0b90b88', animation: 'lb-star-twinkle 1.9s 1.1s ease-in-out infinite', pointerEvents: 'none' }}>✦</span>
                  <span style={{ position: 'absolute', bottom: 19, right: 11, fontSize: 8, color: '#f0b90b99', animation: 'lb-star-twinkle 1.4s 0.5s ease-in-out infinite', pointerEvents: 'none' }}>✧</span>
                </>
              )}

              {/* Rank watermark */}
              <div style={{
                position: 'absolute',
                top: isFirst ? 11 : 8, left: isFirst ? 12 : 10,
                fontSize: isFirst ? 28 : 20, fontWeight: 900,
                color: c.primary, opacity: 0.16,
                lineHeight: 1, fontFamily: 'monospace',
                userSelect: 'none', pointerEvents: 'none',
              }}>
                {rankNums[rankIdx]}
              </div>

              {/* Medal */}
              <div style={{
                fontSize: isFirst ? 40 : 30,
                marginTop: isFirst ? 14 : 10,
                lineHeight: 1,
                animation: `lb-medal-float ${2.6 + rankIdx * 0.25}s ${rankIdx * 0.35}s ease-in-out infinite`,
              }}>
                {medals[rankIdx]}
              </div>

              {/* Username */}
              <div style={{
                fontSize: isFirst ? 14 : 11,
                fontWeight: 700,
                color: isFirst ? '#ece6d0' : '#b0b8c6',
                marginTop: isFirst ? 6 : 4,
                textAlign: 'center',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                padding: '0 4px',
              }}>
                {user.userId}
              </div>

              {/* PnL */}
              <div style={{
                fontSize: isFirst ? 15 : 12,
                fontWeight: 700,
                color: user.totalPnl >= 0 ? '#0ecb81' : '#f6465d',
                marginTop: isFirst ? 4 : 2,
                textAlign: 'center',
              }}>
                {(user.totalPnl >= 0 ? '+' : '') + user.totalPnl.toFixed(2)}
                <span style={{ fontSize: isFirst ? 9 : 8, marginLeft: 2, opacity: 0.6 }}>USDT</span>
              </div>

              {/* Win rate + trade count */}
              <div style={{
                fontSize: isFirst ? 10 : 9,
                color: '#4a5166',
                marginTop: isFirst ? 3 : 1,
                textAlign: 'center',
              }}>
                승률 <span style={{ color: user.winRate >= 0.5 ? '#0ecb8188' : '#f6465d88' }}>{(user.winRate * 100).toFixed(0)}%</span>
                <span style={{ margin: '0 5px', opacity: 0.3 }}>·</span>
                {user.rows.length}건
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Period = 'all' | '30d' | '7d';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(pnl: number): string {
  return (pnl >= 0 ? '+' : '') + pnl.toFixed(2);
}

function pnlColor(pnl: number): string {
  return pnl > 0 ? '#0ecb81' : pnl < 0 ? '#f6465d' : '#848e9c';
}

function fmtDate(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(entryMs: number | null, exitMs: number): string {
  if (entryMs == null) return '—';
  const ms = exitMs - entryMs;
  if (ms <= 0) return '0분';
  const days = Math.floor(ms / 86400000);
  const hrs  = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}일 ${hrs}시간`;
  if (hrs  > 0) return `${hrs}시간 ${mins}분`;
  return `${mins}분`;
}

function periodMs(period: Period): number | undefined {
  if (period === '7d')  return Date.now() - 7  * 86400_000;
  if (period === '30d') return Date.now() - 30 * 86400_000;
  return undefined;
}

// ── Code entry modal ──────────────────────────────────────────────────────────
interface CodeModalProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function LeaderboardCodeModal({ onSuccess, onCancel }: CodeModalProps) {
  const [code, setCode]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    const ok = await verifyLeaderboardCode(code);
    setLoading(false);
    if (ok) {
      grantLeaderboardAccess();
      onSuccess();
    } else {
      setError('코드가 일치하지 않습니다.');
      setCode('');
    }
  };

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={{ ...styles.card, width: 320 }}>
        <div style={styles.cardHeader}>
          <span style={{ color: '#f0b90b', fontWeight: 700 }}>접근 코드 입력</span>
          <button style={styles.closeBtn} onClick={onCancel}>✕</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            autoFocus
            style={styles.codeInput}
            type="text"
            placeholder="초대 코드 입력"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
          {error && <div style={{ color: '#f6465d', fontSize: 12 }}>{error}</div>}
          <button
            style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? '확인 중...' : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main leaderboard modal ────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
  currentUser: string;
}

function calcMargin(t: LeaderboardTrade): string {
  if (t.entryPrice == null || !t.leverage) return '—';
  return (t.qty * t.entryPrice / t.leverage).toFixed(2);
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span style={{ fontSize: 16 }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize: 15 }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize: 14 }}>🥉</span>;
  return <span style={{ color: '#5e6673', fontSize: 11 }}>{rank}위</span>;
}

export function LeaderboardModal({ onClose, currentUser }: Props) {
  const admin                         = isAdmin();
  const [tab, setTab]                 = useState<'board' | 'access'>('board');
  const [period, setPeriod]           = useState<Period>('all');
  const [stats, setStats]             = useState<LeaderboardUserStats[] | null>(null);
  const [livePositions, setLivePositions] = useState<Record<string, LivePositionEntry[]>>({});
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<'all' | 'long' | 'short'>('all');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!isFirebaseConfigured()) { setError('Firebase가 설정되지 않았습니다.'); return; }
    setLoading(true);
    setError(null);
    try {
      const [leaderboard, livePosMap] = await Promise.all([
        fetchLeaderboard(periodMs(period)),
        fetchAllLivePositions(),
      ]);
      setStats(leaderboard);
      setLivePositions(livePosMap);
    } catch (e) {
      setError('데이터를 불러오지 못했습니다: ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const toggleUser = (userId: string) =>
    setExpandedUsers(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });

  const filterTrades = (rows: LeaderboardTrade[]) =>
    tradeFilter === 'all' ? rows
      : rows.filter(r => r.positionSide === (tradeFilter === 'long' ? 'LONG' : 'SHORT'));

  const totalTrades = stats?.reduce((s, u) => s + filterTrades(u.rows).length, 0) ?? 0;

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <style>{LEADERBOARD_CSS}</style>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.cardHeader}>
          <span style={{ color: '#f0b90b', fontWeight: 700, fontSize: 15 }}>
            🏆 리더보드 {admin && <span style={{ color: '#5e6673', fontSize: 11, fontWeight: 400 }}>(관리자)</span>}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {tab === 'board' && (['all', '30d', '7d'] as Period[]).map(p => (
              <button
                key={p}
                style={{ ...styles.filterBtn, ...(period === p ? styles.filterBtnActive : {}) }}
                onClick={() => setPeriod(p)}
              >
                {p === 'all' ? '전체' : p}
              </button>
            ))}
            {tab === 'board' && <button style={styles.refreshBtn} onClick={load} title="새로고침">↺</button>}
            <button style={styles.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tab bar — admin only */}
        {admin && (
          <div style={{ display: 'flex', borderBottom: '1px solid #2a2e39' }}>
            {([['board', '📊 리더보드'], ['access', '👥 접근 관리']] as const).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  background: 'none',
                  border: 'none',
                  borderBottom: tab === t ? '2px solid #f0b90b' : '2px solid transparent',
                  color: tab === t ? '#f0b90b' : '#848e9c',
                  fontWeight: tab === t ? 700 : 400,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'color 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Direction filter — board tab only */}
        {tab === 'board' && <div style={{ display: 'flex', gap: 4, padding: '6px 16px', borderBottom: '1px solid #2a2e39' }}>
          {(['all', 'long', 'short'] as const).map(f => (
            <button
              key={f}
              style={{ ...styles.filterBtn, ...(tradeFilter === f ? styles.filterBtnActive : {}) }}
              onClick={() => setTradeFilter(f)}
            >
              {f === 'all' ? '전체' : f === 'long' ? '롱' : '숏'}
            </button>
          ))}
        </div>}

        {/* Access management tab */}
        {tab === 'access' && admin && (
          <div style={styles.body}>
            <LeaderboardAccessPanel currentUser={currentUser} />
          </div>
        )}

        {/* Board tab body */}
        {tab === 'board' && <div style={styles.body}>
          {loading && <div style={styles.center}>불러오는 중...</div>}
          {error   && <div style={{ ...styles.center, color: '#f6465d' }}>{error}</div>}
          {!loading && !error && stats && stats.length === 0 && (
            <div style={styles.center}>거래 기록이 없습니다.</div>
          )}
          {!loading && !error && stats && stats.length > 0 && (
            <>
              {/* ── Podium hero ── */}
              <PodiumHero stats={stats} />

              {/* ── Rankings table ── */}
              <table style={styles.table}>
                <thead>
                  <tr style={styles.theadRow}>
                    <th style={styles.th}></th>
                    <th style={styles.th}>사용자</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>누적 PnL</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>승률</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>거래수</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>평균 PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((row, idx) => {
                    const isSelf     = row.userId === currentUser;
                    const isExpanded = expandedUsers.has(row.userId);
                    const tradeRows  = filterTrades(row.rows);
                    const filtTotal  = tradeRows.reduce((s, r) => s + r.pnl, 0);
                    const filtWins   = tradeRows.filter(r => r.pnl > 0).length;
                    const filtWinRate = tradeRows.length > 0 ? filtWins / tradeRows.length : 0;
                    const filtAvg    = tradeRows.length > 0 ? filtTotal / tradeRows.length : 0;
                    const userLiveAll = livePositions[row.userId] ?? [];
                    const liveUnrealizedPnl = userLiveAll.reduce((s, p) => s + p.unrealizedPnl, 0);
                    return (
                      <React.Fragment key={row.userId}>
                        {/* User summary row */}
                        <tr
                          style={{
                            ...styles.tbodyRow,
                            background: isSelf ? 'rgba(240,185,11,0.06)' : undefined,
                            cursor: 'pointer',
                          }}
                          onClick={() => toggleUser(row.userId)}
                        >
                          <td style={{ ...styles.td, textAlign: 'center', width: 36 }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 20,
                              color: isExpanded ? '#f0b90b' : '#848e9c',
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              transition: 'transform 0.18s, color 0.18s',
                            }}>▶</span>
                          </td>
                          <td style={{ ...styles.td, fontWeight: 700 }}>
                            <span style={{ marginRight: 6 }}>
                              <RankBadge rank={idx + 1} />
                            </span>
                            <span style={{ color: isSelf ? '#f0b90b' : '#d1d4dc' }}>
                              {row.userId}
                            </span>
                            {isSelf && <span style={{ color: '#5e6673', fontWeight: 400 }}> (나)</span>}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: pnlColor(filtTotal) }}>
                            {fmt(filtTotal)} USDT
                            {userLiveAll.length > 0 && (
                              <span style={{ color: pnlColor(liveUnrealizedPnl), fontSize: 10, marginLeft: 4, opacity: 0.8 }}>
                                ({liveUnrealizedPnl >= 0 ? '+' : ''}{liveUnrealizedPnl.toFixed(2)})
                              </span>
                            )}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'right', color: filtWinRate >= 0.5 ? '#0ecb81' : '#f6465d' }}>
                            {(filtWinRate * 100).toFixed(0)}%
                          </td>
                          <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                            {tradeRows.length}건
                            {userLiveAll.length > 0 && (
                              <span style={styles.liveBadge}>{userLiveAll.length} LIVE</span>
                            )}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'right', color: pnlColor(filtAvg) }}>
                            {fmt(filtAvg)}
                          </td>
                        </tr>

                        {/* Expanded: live positions + stats + closed trades */}
                        {isExpanded && (() => {
                          const userLive = (livePositions[row.userId] ?? []).filter(p =>
                            tradeFilter === 'all' ? true : p.positionSide === (tradeFilter === 'long' ? 'LONG' : 'SHORT'),
                          );
                          return (
                            <tr>
                              <td colSpan={6} style={{ padding: 0 }}>
                                {/* ── Real-time open positions section ── */}
                                {userLive.length > 0 && (
                                  <div style={{ background: 'rgba(14,203,129,0.04)', borderBottom: '1px solid #2a2e39' }}>
                                    <div style={styles.sectionHeader}>
                                      <span style={styles.liveDot} />
                                      실시간 포지션 ({userLive.length}개)
                                    </div>
                                    <div style={{ overflowX: 'auto' }}>
                                      <table style={{ ...styles.table, marginTop: 0 }}>
                                        <thead>
                                          <tr style={styles.theadRow}>
                                            <th style={styles.th}>심볼</th>
                                            <th style={styles.th}>방향</th>
                                            <th style={styles.th}>구분</th>
                                            <th style={styles.th}>마진</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>배율</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>수량</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>진입가</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>현재가</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>강제청산가</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>투입마진</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>미실현손익</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>TP</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>SL</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>유효시각</th>
                                            <th style={{ ...styles.th, textAlign: 'right' }}>진입시간</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {userLive.map((p, i) => {
                                            const margin = p.entryPrice && p.leverage
                                              ? (p.qty * p.entryPrice / p.leverage).toFixed(2)
                                              : '—';
                                            const priceDp = (v: number | null) => {
                                              if (v == null) return '—';
                                              return v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6);
                                            };
                                            return (
                                              <tr key={i} style={styles.tbodyRow}>
                                                <td style={{ ...styles.td, color: '#d1d4dc', fontWeight: 600 }}>
                                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    <CoinLogo symbol={p.symbol} size={13} />
                                                    {p.symbol.replace(/USDT$/, '')}
                                                  </span>
                                                </td>
                                                <td style={{ ...styles.td, color: p.positionSide === 'LONG' ? '#0ecb81' : '#f6465d', fontWeight: 700 }}>
                                                  {p.positionSide === 'LONG' ? '롱' : '숏'}
                                                </td>
                                                <td style={{ ...styles.td, color: p.isAltTrade ? '#b8a0ff' : '#848e9c' }}>
                                                  {p.isAltTrade ? '자동' : '수동'}
                                                </td>
                                                <td style={{ ...styles.td, color: '#848e9c' }}>
                                                  {p.marginType === 'isolated' ? '격리' : p.marginType === 'cross' ? '크로스' : '—'}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                                  {p.leverage ? `${p.leverage}x` : '—'}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                                  {p.qty}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                                  {priceDp(p.entryPrice)}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#d1d4dc' }}>
                                                  {priceDp(p.markPrice)}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#f6465d' }}>
                                                  {priceDp(p.liquidationPrice)}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                                  {margin} USDT
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: pnlColor(p.unrealizedPnl) }}>
                                                  {fmt(p.unrealizedPnl)} USDT
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#0ecb81' }}>
                                                  {priceDp(p.tp)}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#f6465d' }}>
                                                  {priceDp(p.sl)}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#5e6673' }}>
                                                  {p.validUntil ? fmtDate(p.validUntil) : '—'}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: 'right', color: '#5e6673' }}>
                                                  {fmtDate(p.entryTime)}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}

                                {/* ── Stats + closed trades ── */}
                                <LeaderboardStats trades={tradeRows} />
                                <div style={styles.expandedWrap}>
                                  <table style={{ ...styles.table, marginTop: 0 }}>
                                    <thead>
                                      <tr style={styles.theadRow}>
                                        <th style={styles.th}>심볼</th>
                                        <th style={styles.th}>방향</th>
                                        <th style={styles.th}>구분</th>
                                        <th style={styles.th}>마진</th>
                                        <th style={{ ...styles.th, textAlign: 'right' }}>배율</th>
                                        <th style={{ ...styles.th, textAlign: 'right' }}>투입마진</th>
                                        <th style={{ ...styles.th, textAlign: 'right' }}>PnL</th>
                                        <th style={{ ...styles.th, textAlign: 'right' }}>진입가</th>
                                        <th style={{ ...styles.th, textAlign: 'right' }}>청산가</th>
                                        <th style={{ ...styles.th, textAlign: 'right' }}>진입시각</th>
                                        <th style={{ ...styles.th, textAlign: 'right' }}>청산시각</th>
                                        <th style={{ ...styles.th, textAlign: 'right' }}>보유기간</th>
                                        <th style={styles.th}>사유</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {tradeRows.length === 0 && (
                                        <tr>
                                          <td colSpan={13} style={{ ...styles.td, textAlign: 'center', color: '#5e6673' }}>
                                            해당 방향 거래 없음
                                          </td>
                                        </tr>
                                      )}
                                      {tradeRows.map(t => (
                                        <tr key={t.id} style={styles.tbodyRow}>
                                          <td style={{ ...styles.td, color: '#d1d4dc', fontWeight: 600 }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                              <CoinLogo symbol={t.symbol} size={13} />
                                              {t.symbol.replace(/USDT$/, '')}
                                            </span>
                                          </td>
                                          <td style={{ ...styles.td, color: t.positionSide === 'LONG' ? '#0ecb81' : '#f6465d' }}>
                                            {t.positionSide === 'LONG' ? '롱' : '숏'}
                                          </td>
                                          <td style={{ ...styles.td, color: t.isAltTrade ? '#b8a0ff' : '#848e9c' }}>
                                            {t.isAltTrade ? '자동' : '수동'}
                                          </td>
                                          <td style={{ ...styles.td, color: '#848e9c' }}>
                                            {t.marginType === 'isolated' ? '격리' : t.marginType === 'cross' ? '크로스' : '—'}
                                          </td>
                                          <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                            {t.leverage != null ? `${t.leverage}x` : '—'}
                                          </td>
                                          <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                            {calcMargin(t)} USDT
                                          </td>
                                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: pnlColor(t.pnl) }}>
                                            {fmt(t.pnl)} USDT
                                          </td>
                                          <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                            {t.entryPrice?.toFixed(4) ?? '—'}
                                          </td>
                                          <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                            {t.exitPrice?.toFixed(4) ?? '—'}
                                          </td>
                                          <td style={{ ...styles.td, textAlign: 'right', color: '#5e6673' }}>
                                            {fmtDate(t.entryTime)}
                                          </td>
                                          <td style={{ ...styles.td, textAlign: 'right', color: '#5e6673' }}>
                                            {fmtDate(t.exitTime)}
                                          </td>
                                          <td style={{ ...styles.td, textAlign: 'right', color: '#848e9c' }}>
                                            {fmtDuration(t.entryTime, t.exitTime)}
                                          </td>
                                          <td style={{ ...styles.td, color: '#5e6673', fontSize: 10 }}>
                                            {t.closeReason}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>}

        {/* Footer — board tab only */}
        {tab === 'board' && !loading && stats && stats.length > 0 && (
          <div style={styles.footer}>
            총 {totalTrades}건 거래 · {stats.length}명 참여
            {Object.values(livePositions).some(arr => arr.length > 0) && (
              <span style={{ color: '#0ecb81', marginLeft: 8 }}>
                · {Object.values(livePositions).reduce((s, arr) => s + arr.length, 0)}개 실시간 포지션
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 8000,
  },
  card: {
    background: '#1e222d',
    border: '1px solid #2a2e39',
    borderRadius: 10,
    width: 1100,
    maxWidth: '95vw',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #2a2e39',
    background: '#181c27',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 0,
  },
  footer: {
    padding: '6px 16px',
    borderTop: '1px solid #2a2e39',
    fontSize: 11,
    color: '#5e6673',
    textAlign: 'right',
  },
  center: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 120, color: '#5e6673', fontSize: 13,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  theadRow: {
    background: '#181c27',
    borderBottom: '1px solid #2a2e39',
  },
  tbodyRow: {
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    transition: 'background 0.1s',
  },
  th: {
    padding: '7px 12px',
    color: '#5e6673',
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: '0.03em',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '7px 12px',
    color: '#b2b8c4',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  expandedWrap: {
    background: 'rgba(0,0,0,0.22)',
    borderTop: '1px solid #2a2e39',
    borderBottom: '1px solid #2a2e39',
    overflowX: 'auto',
  },
  filterBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: 11,
    padding: '3px 9px',
    fontFamily: 'inherit',
  },
  filterBtnActive: {
    background: '#f0b90b22',
    borderColor: '#f0b90b',
    color: '#f0b90b',
    fontWeight: 700,
  },
  refreshBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: 14,
    padding: '2px 8px',
    fontFamily: 'inherit',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: 14,
    padding: '2px 6px',
    fontFamily: 'inherit',
  },
  codeInput: {
    background: '#0d1520',
    border: '1px solid #2a2e39',
    borderRadius: 5,
    color: '#d1d4dc',
    fontSize: '0.9rem',
    padding: '9px 10px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    letterSpacing: '0.1em',
  },
  btn: {
    background: '#f0b90b',
    border: 'none',
    borderRadius: 5,
    color: '#1a1200',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 700,
    padding: '10px',
    fontFamily: 'inherit',
  },
  liveBadge: {
    display: 'inline-block',
    marginLeft: 5,
    background: '#0ecb8122',
    border: '1px solid #0ecb8155',
    borderRadius: 3,
    color: '#0ecb81',
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 4px',
    letterSpacing: '0.04em',
    verticalAlign: 'middle',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    color: '#0ecb81',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
    borderBottom: '1px solid rgba(14,203,129,0.15)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#0ecb81',
    boxShadow: '0 0 4px #0ecb81',
    animation: 'pulse 1.4s infinite',
    flexShrink: 0,
  },
};
