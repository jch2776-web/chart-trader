import React, { useRef, useState } from 'react';
import type { Drawing } from '../../types/drawing';
import type { TradeSettings, ActivityLog, TelegramSettings } from '../../types/trade';
import type { FuturesPosition, FuturesOrder } from '../../types/futures';
import type { ConditionalOrderPair } from '../../types/conditionalOrder';
import { DrawingList } from './DrawingList';
import { TradeSettingsPanel } from './TradeSettings';
import { MonitorSettingsPanel } from './MonitorSettings';
import { ActivityLogPanel } from './ActivityLog';
import { ApiKeyPanel } from './ApiKeyPanel';

type Tab = 'drawings' | 'trade' | 'monitor' | 'log' | 'api';

interface Props {
  drawings: Drawing[];
  selectedDrawingId: string | null;
  onSelectDrawing: (id: string) => void;
  onDeleteDrawing: (id: string) => void;
  tradeSettings: TradeSettings;
  onTradeSettingsChange: (s: TradeSettings) => void;
  onActivate: () => void;
  logs: ActivityLog[];
  telegramSettings: TelegramSettings;
  onTelegramSettingsChange: (s: TelegramSettings) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onUpdateMemo: (id: string, memo: string) => void;
  onUpdateColor: (id: string, color: string) => void;
  onUpdateActive: (id: string, active: boolean) => void;
  // Binance API / account
  binanceApiKey: string;
  binanceApiSecret: string;
  onSaveApiKeys: (key: string, secret: string) => void;
  onClearApiKeys: () => void;
  futuresLoading?: boolean;
  futuresError?: string | null;
  futuresPositions?: FuturesPosition[];
  futuresOrders?: FuturesOrder[];
  width?: number;
  currentUser?: string;
  onLogout?: () => void;
  // Trade panel
  ticker?: string;
  currentPrice?: number;
  availableUsdt?: number;
  onPlaceOrder?: (side: 'BUY' | 'SELL', price: number, quantity: number, leverage: number, marginType: 'CROSSED' | 'ISOLATED', reduceOnly?: boolean) => Promise<void>;
  onCancelOrder?: (orderId: string, symbol: string) => Promise<void>;
  onLimitPriceChange?: (price: number | null) => void;
  // Conditional orders
  conditionalOrders?: ConditionalOrderPair[];
  onAddConditionalOrder?: (order: Omit<ConditionalOrderPair, 'id' | 'status' | 'createdAt'>) => void;
  onRemoveConditionalOrder?: (id: string) => void;
  onConditionalDrawingHighlight?: (id: string | null) => void;
  onConditionalPriceChange?: (prices: number[]) => void;
}

export function RightPanel({
  drawings, selectedDrawingId, onSelectDrawing, onDeleteDrawing,
  tradeSettings, onTradeSettingsChange, onActivate, logs,
  telegramSettings, onTelegramSettingsChange,
  onExport, onImport, onUpdateMemo, onUpdateColor, onUpdateActive,
  binanceApiKey, binanceApiSecret, onSaveApiKeys, onClearApiKeys,
  futuresLoading, futuresError, futuresPositions, futuresOrders,
  width, currentUser, onLogout,
  ticker, currentPrice, availableUsdt, onPlaceOrder, onCancelOrder, onLimitPriceChange,
  conditionalOrders, onAddConditionalOrder, onRemoveConditionalOrder,
  onConditionalDrawingHighlight, onConditionalPriceChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('drawings');
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ ...styles.container, width: width ?? 280 }}>
      {/* User info bar */}
      {currentUser && (
        <div style={styles.userBar}>
          <span style={styles.userName}>👤 {currentUser}</span>
          <button style={styles.logoutBtn} onClick={onLogout} title="로그아웃">
            로그아웃
          </button>
        </div>
      )}
      <div style={styles.tabs}>
        <TabBtn active={tab === 'drawings'} onClick={() => setTab('drawings')}>
          도형{drawings.length > 0 ? `(${drawings.length})` : ''}
        </TabBtn>
        <TabBtn active={tab === 'trade'} onClick={() => setTab('trade')}>매매</TabBtn>
        <TabBtn active={tab === 'monitor'} onClick={() => setTab('monitor')}>모니터링</TabBtn>
        <TabBtn active={tab === 'log'} onClick={() => setTab('log')}>로그</TabBtn>
        <TabBtn active={tab === 'api'} onClick={() => setTab('api')}>
          계좌{(futuresPositions?.length ?? 0) > 0 ? `(${futuresPositions!.length})` : ''}
        </TabBtn>
      </div>

      {/* Export / Import toolbar — shown in drawings tab */}
      {tab === 'drawings' && (
        <div style={styles.toolbar}>
          <button style={styles.toolBtn} onClick={onExport} title="도형 내보내기 (JSON)">
            ↑ 내보내기
          </button>
          <button
            style={styles.toolBtn}
            onClick={() => fileInputRef.current?.click()}
            title="도형 가져오기 (JSON)"
          >
            ↓ 가져오기
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) { onImport(f); e.target.value = ''; }
            }}
          />
        </div>
      )}

      <div style={styles.content}>
        {tab === 'drawings' && (
          <DrawingList
            drawings={drawings}
            selectedId={selectedDrawingId}
            onSelect={onSelectDrawing}
            onDelete={onDeleteDrawing}
            onUpdateMemo={onUpdateMemo}
            onUpdateColor={onUpdateColor}
            onUpdateActive={onUpdateActive}
          />
        )}
        {tab === 'trade' && (
          <TradeSettingsPanel
            settings={tradeSettings}
            onChange={onTradeSettingsChange}
            ticker={ticker}
            currentPrice={currentPrice}
            availableUsdt={availableUsdt}
            openOrders={futuresOrders?.filter(o => !ticker || o.symbol === ticker)}
            positions={futuresPositions?.filter(p => !ticker || p.symbol === ticker)}
            onPlaceOrder={onPlaceOrder}
            onCancelOrder={onCancelOrder}
            onLimitPriceChange={onLimitPriceChange}
            drawings={drawings}
            conditionalOrders={conditionalOrders}
            onAddConditionalOrder={onAddConditionalOrder}
            onRemoveConditionalOrder={onRemoveConditionalOrder}
            onConditionalDrawingHighlight={onConditionalDrawingHighlight}
            onConditionalPriceChange={onConditionalPriceChange}
          />
        )}
        {tab === 'monitor' && (
          <MonitorSettingsPanel
            settings={tradeSettings}
            onChange={onTradeSettingsChange}
            onActivate={onActivate}
            telegramSettings={telegramSettings}
            onTelegramSettingsChange={onTelegramSettingsChange}
          />
        )}
        {tab === 'log' && <ActivityLogPanel logs={logs} />}
        {tab === 'api' && (
          <ApiKeyPanel
            apiKey={binanceApiKey}
            apiSecret={binanceApiSecret}
            onSave={onSaveApiKeys}
            onClear={onClearApiKeys}
            loading={futuresLoading}
            error={futuresError}
            positions={futuresPositions}
            orders={futuresOrders}
            onCancelOrder={onCancelOrder}
          />
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      style={{
        flex: 1,
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${active ? '#f0b90b' : 'transparent'}`,
        color: active ? '#d1d4dc' : '#5e6673',
        cursor: 'pointer',
        fontSize: '0.74rem',
        fontWeight: active ? 600 : 400,
        padding: '9px 2px',
        transition: 'all 0.1s',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 280,
    background: '#1e222d',
    borderLeft: '1px solid #2a2e39',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #2a2e39',
    background: '#1e222d',
  },
  toolbar: {
    display: 'flex',
    gap: 4,
    padding: '6px 8px',
    borderBottom: '1px solid #2a2e39',
    flexShrink: 0,
  },
  toolBtn: {
    flex: 1,
    background: '#0d1520',
    border: '1px solid #1a2030',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    padding: '5px 6px',
    fontFamily: 'inherit',
    transition: 'all 0.1s',
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  userBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 10px',
    borderBottom: '1px solid #2a2e39',
    background: '#181c27',
    flexShrink: 0,
  },
  userName: {
    color: '#848e9c',
    fontSize: '0.77rem',
    fontWeight: 600,
  },
  logoutBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 3,
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.72rem',
    padding: '2px 8px',
    fontFamily: 'inherit',
    transition: 'all 0.1s',
  },
};
