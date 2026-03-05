import React from 'react';
import type { ActivityLog } from '../../types/trade';

interface Props {
  logs: ActivityLog[];
}

const LOG_COLORS: Record<ActivityLog['type'], string> = {
  info:   '#d1d4dc',
  signal: '#e8b73a',
  order:  '#22d991',
  error:  '#f0425c',
};

const ARCH_DIAGRAM = `
시스템 아키텍처
═══════════════════════════
 Binance WS Stream
   └─ 실시간 캔들 수신 (매 tick)
       └─ BreakoutEngine
           ├─ 추세선 돌파 판정
           │   └─ line_price = p1.price
           │      + slope × (now - p1.time)
           │   └─ 즉시 감지 (봉 확정 불필요)
           │   └─ 같은 봉 내 중복 방지
           └─ 박스 돌파 판정 (상태머신)
               ├─ below → inside : 박스권 진입
               ├─ inside → above : 상단 돌파
               └─ inside → below : 하단 돌파

알림 방향 설정
  ├─ 롱: 위 방향 돌파만 감지
  ├─ 숏: 아래 방향 돌파만 감지
  └─ 양방향: 양쪽 모두 감지

돌파 감지 시
  ├─ [알림만] → 차트 플래시 + 로그 + 텔레그램
  └─ [자동매매] → POST /fapi/v1/order
      ├─ 레버리지 설정
      └─ MARKET 주문 실행
═══════════════════════════
`.trim();

export function ActivityLogPanel({ logs }: Props) {
  return (
    <div style={styles.container}>
      <pre style={styles.arch}>{ARCH_DIAGRAM}</pre>
      <div style={styles.logHeader}>활동 로그</div>
      <div style={styles.logList}>
        {logs.length === 0 && (
          <div style={styles.empty}>로그 없음. 모니터링을 시작하세요.</div>
        )}
        {[...logs].reverse().map(log => (
          <div key={log.id} style={styles.logItem}>
            <span style={{ color: '#4a5568', fontSize: '0.77rem', marginRight: 6, fontFamily: 'monospace', flexShrink: 0 }}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span style={{ color: LOG_COLORS[log.type], fontSize: '0.85rem' }}>
              {log.type === 'signal' ? '⚡ ' : log.type === 'order' ? '✓ ' : log.type === 'error' ? '✕ ' : '· '}
              {log.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
  },
  arch: {
    margin: 0,
    padding: '10px 10px',
    color: '#4a6080',
    fontSize: '0.77rem',
    fontFamily: '"SF Mono", Consolas, monospace',
    lineHeight: 1.6,
    borderBottom: '1px solid #1a2030',
    whiteSpace: 'pre',
    overflowX: 'auto',
  },
  logHeader: {
    fontSize: '0.77rem',
    color: '#4a5568',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 600,
    padding: '8px 10px 4px',
    borderBottom: '1px solid #1a2030',
  },
  logList: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  },
  logItem: {
    padding: '4px 10px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 2,
    borderBottom: '1px solid rgba(26,32,48,0.5)',
  },
  empty: {
    color: '#4a5568',
    fontSize: '0.85rem',
    padding: '16px 10px',
    textAlign: 'center',
  },
};
