import React from 'react';
import type { Drawing } from '../../types/drawing';
import type { TradeSettings, TelegramSettings, ActivityLog } from '../../types/trade';
import type { TickerInfo } from '../../hooks/useTickers';
import { MonitorPanel } from './MonitorPanel';

interface Props {
  panels: string[];
  tickers: TickerInfo[];
  drawingsByTicker: Record<string, Drawing[]>;
  settingsByTicker: Record<string, TradeSettings>;
  telegramSettings: TelegramSettings;
  onAddLog: (type: ActivityLog['type'], message: string) => void;
  onPanelChange: (index: number, ticker: string) => void;
  onAddPanel: () => void;
  onRemovePanel: (index: number) => void;
}

export function MultiChartView({
  panels,
  tickers,
  drawingsByTicker,
  settingsByTicker,
  telegramSettings,
  onAddLog,
  onPanelChange,
  onAddPanel,
  onRemovePanel,
}: Props) {
  const count = panels.length;

  // Grid columns: 1 panel → 1 col, 2 → 2 cols, 3-4 → 2 cols (wraps to 2 rows)
  const cols = count === 1 ? 1 : 2;

  return (
    <div style={styles.wrapper}>
      <div
        style={{
          ...styles.grid,
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
        }}
      >
        {panels.map((ticker, idx) => (
          <MonitorPanel
            key={idx}
            panelId={idx}
            ticker={ticker}
            onTickerChange={(t) => onPanelChange(idx, t)}
            onRemove={() => onRemovePanel(idx)}
            canRemove={count > 1}
            tickers={tickers}
            drawingsByTicker={drawingsByTicker}
            settingsByTicker={settingsByTicker}
            telegramSettings={telegramSettings}
            onAddLog={onAddLog}
          />
        ))}
      </div>

      {count < 4 && (
        <div style={styles.addRow}>
          <button style={styles.addBtn} onClick={onAddPanel}>
            + 패널 추가
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  grid: {
    display: 'grid',
    flex: 1,
    minHeight: 0,
    gap: 0,
  },
  addRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 0',
    background: '#131722',
    borderTop: '1px solid #2a2e39',
    flexShrink: 0,
  },
  addBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    padding: '4px 16px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
  },
};
