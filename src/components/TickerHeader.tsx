import React from 'react';
import type { Stats24h } from '../hooks/use24hStats';
import { formatPrice, formatVolume } from '../utils/priceFormat';

interface Props {
  ticker: string;
  stats: Stats24h | null;
  currentPrice?: number;
  priceChangePct?: number;
}

export function TickerHeader({ ticker, stats, currentPrice, priceChangePct }: Props) {
  const base = ticker.replace('USDT', '');
  const price = stats?.lastPrice ?? currentPrice ?? 0;
  const pct   = stats?.priceChangePercent ?? priceChangePct ?? 0;
  const chg   = stats?.priceChange ?? 0;
  const isUp  = pct >= 0;
  const color = isUp ? '#0ecb81' : '#f6465d';

  return (
    <div style={styles.bar}>
      {/* Pair + perp */}
      <div style={styles.pairBlock}>
        <span style={styles.pairName}>{base}/USDT</span>
        <span style={styles.perpBadge}>Perp</span>
      </div>

      {/* Live price */}
      {price > 0 && (
        <div style={styles.priceBlock}>
          <span style={{ ...styles.price, color }}>{formatPrice(price)}</span>
          <span style={{ ...styles.chg, color }}>
            {isUp ? '+' : ''}{chg.toFixed(2)}&nbsp;&nbsp;{isUp ? '+' : ''}{pct.toFixed(2)}%
          </span>
        </div>
      )}

      {/* 24h stats */}
      {stats && (
        <div style={styles.statsRow}>
          <StatCell label="Mark" value={formatPrice(stats.lastPrice)} />
          <StatCell label="24h Change" value={`${isUp ? '+' : ''}${pct.toFixed(2)}%`} color={color} />
          <StatCell label="24h High" value={formatPrice(stats.highPrice)} />
          <StatCell label="24h Low"  value={formatPrice(stats.lowPrice)} />
          <StatCell label="24h Vol(USDT)" value={formatVolume(stats.quoteVolume)} />
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={styles.cell}>
      <span style={styles.cellLabel}>{label}</span>
      <span style={{ ...styles.cellValue, ...(color ? { color } : {}) }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 52,
    background: '#1e222d',
    borderBottom: '1px solid #2a2e39',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: 20,
    flexShrink: 0,
    overflow: 'hidden',
  },
  pairBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  pairName: {
    color: '#f0f0f0',
    fontWeight: 700,
    fontSize: '1.23rem',
    letterSpacing: '0.01em',
  },
  perpBadge: {
    background: '#2a2e39',
    color: '#848e9c',
    fontSize: '0.77rem',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: '0.04em',
  },
  priceBlock: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    flexShrink: 0,
  },
  price: {
    fontSize: '1.69rem',
    fontFamily: '"SF Mono","Cascadia Code",Consolas,monospace',
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  chg: {
    fontSize: '0.92rem',
    fontFamily: '"SF Mono","Cascadia Code",Consolas,monospace',
  },
  statsRow: {
    display: 'flex',
    gap: 20,
    alignItems: 'center',
    flex: 1,
    marginLeft: 8,
    overflow: 'hidden',
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flexShrink: 0,
  },
  cellLabel: {
    color: '#5e6673',
    fontSize: '0.77rem',
    lineHeight: 1.2,
  },
  cellValue: {
    color: '#d1d4dc',
    fontSize: '0.92rem',
    fontFamily: '"SF Mono","Cascadia Code",Consolas,monospace',
    lineHeight: 1.2,
  },
};
