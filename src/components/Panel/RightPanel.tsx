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

type Tab = 'drawings' | 'trade' | 'monitor' | 'log' | 'api' | 'scalp';

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
  onUpdateText?: (id: string, text: string, fontSize?: number) => void;
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
  // Scalp auto-trade logs (recent entries, shown in dedicated tab)
  scalpLogs?: Array<{ id: number; ts: number; msg: string; level: string }>;
  scalpIsActive?: boolean;
}

export function RightPanel({
  drawings, selectedDrawingId, onSelectDrawing, onDeleteDrawing,
  tradeSettings, onTradeSettingsChange, onActivate, logs,
  telegramSettings, onTelegramSettingsChange,
  onExport, onImport, onUpdateMemo, onUpdateColor, onUpdateActive, onUpdateText,
  binanceApiKey, binanceApiSecret, onSaveApiKeys, onClearApiKeys,
  futuresLoading, futuresError, futuresPositions, futuresOrders,
  width, currentUser, onLogout,
  ticker, currentPrice, availableUsdt, onPlaceOrder, onCancelOrder, onLimitPriceChange,
  conditionalOrders, onAddConditionalOrder, onRemoveConditionalOrder,
  onConditionalDrawingHighlight, onConditionalPriceChange,
  scalpLogs, scalpIsActive,
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
        <TabBtn active={tab === 'scalp'} onClick={() => setTab('scalp')}>
          {scalpIsActive ? '⚡스캘핑' : '스캘핑'}
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
          <>
            <DrawingList
              drawings={drawings}
              selectedId={selectedDrawingId}
              onSelect={onSelectDrawing}
              onDelete={onDeleteDrawing}
              onUpdateMemo={onUpdateMemo}
              onUpdateColor={onUpdateColor}
              onUpdateActive={onUpdateActive}
              onUpdateText={onUpdateText}
            />
          </>
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
        {tab === 'scalp' && <ScalpLogPanel logs={scalpLogs ?? []} isActive={scalpIsActive ?? false} />}
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

// ── Scalp log panel ───────────────────────────────────────────────────────────

function ScalpLogPanel({
  logs,
  isActive,
}: {
  logs: Array<{ id: number; ts: number; msg: string; level: string }>;
  isActive: boolean;
}) {
  const recent = logs.slice(0, 10);
  const levelColor = (level: string): string => {
    if (level === 'error') return '#f6465d';
    if (level === 'warn')  return '#f0b90b';
    if (level === 'success') return '#0ecb81';
    return '#848e9c';
  };
  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('ko-KR', { hour12: false });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Status bar */}
      <div style={{
        padding: '6px 10px',
        borderBottom: '1px solid #2a2e39',
        fontSize: '0.72rem',
        color: isActive ? '#0ecb81' : '#5e6673',
        fontWeight: 600,
        flexShrink: 0,
      }}>
        {isActive ? '● 스캘핑 실행 중' : '○ 스캘핑 정지됨'}
      </div>

      {/* Log list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {recent.length === 0 ? (
          <div style={{ padding: '20px 12px', color: '#3a4455', fontSize: '0.8rem', textAlign: 'center' }}>
            스캘핑 로그 없음
          </div>
        ) : (
          recent.map(entry => (
            <div key={entry.id} style={{
              padding: '3px 10px',
              borderBottom: '1px solid #1e2330',
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: '0.65rem', color: '#3a4a60', flexShrink: 0, marginTop: 1, fontFamily: 'monospace' }}>
                {formatTime(entry.ts)}
              </span>
              <span style={{ fontSize: '0.75rem', color: levelColor(entry.level), lineHeight: 1.4, wordBreak: 'break-word' }}>
                {entry.msg}
              </span>
            </div>
          ))
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
    flexWrap: 'wrap',
    gap: 4,
    padding: '6px 8px',
    borderBottom: '1px solid #2a2e39',
    flexShrink: 0,
  },
  toolBtn: {
    flex: '1 1 88px',
    minWidth: 88,
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
  presetCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '10px 10px 8px',
    borderBottom: '1px solid #2a2e39',
    background: '#181c27',
    flexShrink: 0,
  },
  presetTitle: {
    color: '#848e9c',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  presetBtn: {
    width: '100%',
    background: 'linear-gradient(135deg, #1f4f78 0%, #12324d 100%)',
    border: '1px solid rgba(56,189,248,0.35)',
    borderRadius: 6,
    color: '#e6f6ff',
    cursor: 'pointer',
    fontSize: '0.86rem',
    fontWeight: 700,
    padding: '8px 10px',
    fontFamily: 'inherit',
    textAlign: 'left',
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
