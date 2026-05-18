import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchLeaderboardAccessMap,
  setUserLeaderboardAccess,
  fetchAllKnownUsers,
  registerUsersInFirestore,
} from '../../lib/tradeSync';
import { getAllLocalUsers } from '../../hooks/useAuth';
import { isFirebaseConfigured } from '../../lib/firebase';

interface Props {
  currentUser: string;
}

export function LeaderboardAccessPanel({ currentUser }: Props) {
  const [accessMap, setAccessMap]   = useState<Record<string, boolean>>({});
  const [userIds, setUserIds]       = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [toggling, setToggling]     = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isFirebaseConfigured()) { setError('Firebase 미설정'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const localUsers = getAllLocalUsers();
      void registerUsersInFirestore(localUsers);

      const [map, firestoreUsers] = await Promise.all([
        fetchLeaderboardAccessMap(),
        fetchAllKnownUsers(),
      ]);
      setAccessMap(map);

      // Merge all sources: localStorage + auto_trade_leader_locks + registeredUsers
      const merged = [...new Set([...localUsers, ...firestoreUsers])];
      const others = merged.filter(u => u !== currentUser).sort();
      setUserIds([currentUser, ...others]);
    } catch {
      setError('불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (userId: string, current: boolean) => {
    if (userId === currentUser) return; // admin always has access
    setToggling(userId);
    try {
      await setUserLeaderboardAccess(userId, !current);
      setAccessMap(prev => ({ ...prev, [userId]: !current }));
    } catch {
      setError('저장 실패');
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <div style={s.center}>불러오는 중...</div>;
  if (error)   return <div style={{ ...s.center, color: '#f6465d' }}>{error}</div>;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.title}>사용자 접근 관리</span>
        <button style={s.refreshBtn} onClick={load} title="새로고침">↺</button>
      </div>
      <div style={s.list}>
        {userIds.map(uid => {
          const isAdmin  = uid === currentUser;
          const granted  = isAdmin || accessMap[uid] === true;
          const busy     = toggling === uid;
          return (
            <div key={uid} style={s.row}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: isAdmin ? '#f0b90b' : '#d1d4dc', fontWeight: 600, fontSize: 13 }}>
                  {uid}
                  {isAdmin && <span style={{ color: '#5e6673', fontWeight: 400, fontSize: 11 }}> (관리자)</span>}
                </span>
                <span style={{ color: granted ? '#0ecb81' : '#5e6673', fontSize: 11 }}>
                  {isAdmin ? '항상 허용' : granted ? '접근 허용됨' : '접근 없음'}
                </span>
              </div>
              <button
                style={{
                  ...s.toggleBtn,
                  ...(granted ? s.toggleOn : s.toggleOff),
                  opacity: busy || isAdmin ? 0.5 : 1,
                  cursor: busy || isAdmin ? 'default' : 'pointer',
                }}
                onClick={() => !busy && !isAdmin && toggle(uid, granted)}
                disabled={busy || isAdmin}
              >
                {busy ? '...' : granted ? 'ON' : 'OFF'}
              </button>
            </div>
          );
        })}
        {userIds.length === 0 && (
          <div style={s.center}>거래 기록이 있는 사용자가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    background: '#141720',
    borderBottom: '1px solid #2a2e39',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px',
    borderBottom: '1px solid #2a2e39',
  },
  title: {
    color: '#d1d4dc', fontWeight: 700, fontSize: 13,
  },
  refreshBtn: {
    background: 'none', border: '1px solid #2a2e39', borderRadius: 4,
    color: '#5e6673', cursor: 'pointer', fontSize: 14, padding: '2px 8px',
    fontFamily: 'inherit',
  },
  list: {
    maxHeight: 320,
    overflowY: 'auto',
    padding: '4px 0',
  },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  toggleBtn: {
    border: 'none', borderRadius: 20,
    fontWeight: 700, fontSize: 12,
    padding: '5px 16px',
    fontFamily: 'inherit',
    transition: 'background 0.15s',
    minWidth: 52,
  },
  toggleOn: {
    background: '#0ecb81', color: '#0a1f15',
  },
  toggleOff: {
    background: '#2a2e39', color: '#5e6673',
  },
  center: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 80, color: '#5e6673', fontSize: 13,
  },
};
