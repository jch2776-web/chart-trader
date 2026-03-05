import React, { useState } from 'react';
import type { FuturesPosition, FuturesOrder } from '../../types/futures';
import { formatPrice } from '../../utils/priceFormat';

interface Props {
  apiKey: string;
  apiSecret: string;
  onSave: (key: string, secret: string) => void;
  onClear: () => void;
  loading?: boolean;
  error?: string | null;
  positions?: FuturesPosition[];
  orders?: FuturesOrder[];
  onCancelOrder?: (orderId: string, symbol: string) => Promise<void>;
}

function orderTypeLabel(type: string): string {
  switch (type) {
    case 'LIMIT':                  return 'LIMIT';
    case 'MARKET':                 return 'MARKET';
    case 'STOP':                   return 'STOP';
    case 'STOP_MARKET':            return 'STOP';
    case 'TAKE_PROFIT':            return 'TP';
    case 'TAKE_PROFIT_MARKET':     return 'TP';
    case 'TRAILING_STOP_MARKET':   return 'TRAIL';
    default:                       return type.slice(0, 6);
  }
}

export function ApiKeyPanel({
  apiKey, apiSecret, onSave, onClear,
  loading, error, positions = [], orders = [], onCancelOrder,
}: Props) {
  const [localKey, setLocalKey]       = useState(apiKey);
  const [localSecret, setLocalSecret] = useState(apiSecret);
  const [showSecret, setShowSecret]   = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const hasKeys = !!(apiKey && apiSecret);

  return (
    <div style={styles.container}>

      {/* Security warning */}
      <div style={styles.warning}>
        ⚠ API 키는 브라우저 localStorage에 저장됩니다.<br />
        선물 거래를 위해 <b>선물 거래</b> 권한이 필요합니다.<br />
        <b>출금 권한은 절대 부여하지 마세요.</b>
      </div>

      {/* API Key */}
      <div style={styles.field}>
        <label style={styles.label}>API Key</label>
        <input
          style={styles.input}
          type="text"
          placeholder="API Key 입력..."
          value={localKey}
          onChange={e => setLocalKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* API Secret */}
      <div style={styles.field}>
        <label style={styles.label}>API Secret</label>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...styles.input, paddingRight: 34 }}
            type={showSecret ? 'text' : 'password'}
            placeholder="API Secret 입력..."
            value={localSecret}
            onChange={e => setLocalSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            style={styles.eyeBtn}
            onClick={() => setShowSecret(v => !v)}
            type="button"
            title={showSecret ? '숨기기' : '표시'}
          >
            {showSecret ? '○' : '●'}
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div style={styles.btnRow}>
        <button
          style={{ ...styles.btn, ...styles.btnPrimary, opacity: (!localKey || !localSecret) ? 0.5 : 1 }}
          onClick={() => onSave(localKey.trim(), localSecret.trim())}
          disabled={!localKey || !localSecret}
        >
          저장 &amp; 연결
        </button>
        {hasKeys && (
          <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={() => { onClear(); setLocalKey(''); setLocalSecret(''); }}>
            초기화
          </button>
        )}
      </div>

      {/* Status */}
      {loading && <div style={styles.statusText}>조회 중...</div>}
      {error && <div style={styles.errorMsg}>{error}</div>}

      {/* Positions summary */}
      {hasKeys && !loading && positions.length === 0 && orders.length === 0 && !error && (
        <div style={styles.emptyMsg}>오픈 포지션 없음</div>
      )}

      {positions.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>포지션 ({positions.length})</div>
          {positions.map(p => {
            const isLong  = p.positionAmt > 0;
            const side    = p.positionSide === 'BOTH' ? (isLong ? 'LONG' : 'SHORT') : p.positionSide;
            const color   = isLong ? '#0ecb81' : '#f6465d';
            // ROI% = unrealizedProfit / initialMargin * 100
            // initialMargin = entryPrice * |positionAmt| / leverage
            const initialMargin = p.entryPrice > 0 && p.leverage > 0
              ? Math.abs(p.positionAmt) * p.entryPrice / p.leverage
              : 0;
            const roiPct  = initialMargin > 0
              ? (p.unrealizedProfit / initialMargin * 100)
              : 0;
            const roiSign = roiPct >= 0 ? '+' : '';
            const pnlSign = p.unrealizedProfit >= 0 ? '+' : '';
            const pnlColor = p.unrealizedProfit >= 0 ? '#0ecb81' : '#f6465d';
            // entryTime: 실제 체결시각(userTrades 기반), 없으면 updateTime 으로 폴백
            const timeMs = p.entryTime ?? p.updateTime;
            const updateStr = timeMs
              ? (() => {
                  const d = new Date(timeMs);
                  const pad = (n: number) => String(n).padStart(2, '0');
                  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                })()
              : null;
            const elapsedStr = timeMs
              ? (() => {
                  const ms = Date.now() - timeMs;
                  const totalMins = Math.max(0, Math.floor(ms / 60000));
                  const days  = Math.floor(totalMins / 1440);
                  const hours = Math.floor((totalMins % 1440) / 60);
                  const mins  = totalMins % 60;
                  if (days > 0)  return `${days}일 ${hours}시간 ${mins}분`;
                  if (hours > 0) return `${hours}시간 ${mins}분`;
                  return `${mins}분`;
                })()
              : null;
            return (
              <div key={`${p.symbol}-${p.positionSide}`} style={styles.posCard}>
                {/* Row 1: side badge + symbol + leverage + margin type */}
                <div style={styles.posRow}>
                  <span style={{ ...styles.sideBadge, background: `${color}22`, color }}>{side}</span>
                  <span style={styles.posSymbol}>{p.symbol}</span>
                  <span style={styles.posLev}>{p.leverage}x</span>
                  <span style={{ ...styles.marginBadge,
                    background: p.marginType === 'isolated' ? 'rgba(240,185,11,0.12)' : 'rgba(74,144,217,0.12)',
                    color: p.marginType === 'isolated' ? '#e0a800' : '#4a90d9',
                  }}>
                    {p.marginType === 'isolated' ? '격리' : '교차'}
                  </span>
                </div>
                {/* Row 2: ROI % | 미실현 손익 — labeled 2-column grid */}
                <div style={styles.pnlGrid}>
                  <div style={styles.pnlCell}>
                    <span style={styles.pnlLabel}>ROI</span>
                    <span style={{ ...styles.pnlValue, color: pnlColor }}>
                      {roiSign}{roiPct.toFixed(2)}%
                    </span>
                  </div>
                  <div style={styles.pnlDivider} />
                  <div style={styles.pnlCell}>
                    <span style={styles.pnlLabel}>미실현 손익</span>
                    <span style={{ ...styles.pnlValue, color: pnlColor }}>
                      {pnlSign}{p.unrealizedProfit.toFixed(2)} USDT
                    </span>
                  </div>
                </div>
                {/* Row 3: entry price / liquidation price */}
                <div style={styles.posDetail}>
                  <span style={styles.detailLabel}>진입가격</span>
                  <span style={styles.detailVal}>{formatPrice(p.entryPrice)}</span>
                  <span style={styles.detailLabel}>청산가격</span>
                  <span style={{ ...styles.detailVal, color: '#f59e42' }}>{formatPrice(p.liquidationPrice)}</span>
                </div>
                {/* Row 4: initial margin / position size */}
                <div style={styles.posDetail}>
                  <span style={styles.detailLabel}>진입마진</span>
                  <span style={{ ...styles.detailVal, color: '#848e9c' }}>
                    {initialMargin > 0 ? formatPrice(initialMargin) + ' USDT' : '-'}
                  </span>
                  <span style={styles.detailLabel}>사이즈</span>
                  <span style={{ ...styles.detailVal, color: '#848e9c' }}>
                    {formatPrice(Math.abs(p.positionAmt) * p.markPrice)} USDT
                  </span>
                </div>
                {/* Row 5: qty (comma-formatted) + elapsed time */}
                <div style={styles.posDetail}>
                  <span style={styles.detailLabel}>수량</span>
                  <span style={styles.detailVal}>
                    {Math.abs(p.positionAmt).toLocaleString('en-US', { maximumFractionDigits: 8 })}
                  </span>
                  {elapsedStr && (<>
                    <span style={styles.detailLabel}>진입경과</span>
                    <span style={{ ...styles.detailVal, color: '#848e9c' }}>{elapsedStr}</span>
                  </>)}
                </div>
                {/* Row 6: entry timestamp */}
                {updateStr && (
                  <div style={styles.posDetail}>
                    <span style={styles.detailLabel}>진입시간</span>
                    <span style={{ ...styles.detailVal, color: '#5e6673' }}>{updateStr}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Orders summary */}
      {orders.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>미체결 주문 ({orders.length})</div>
          {orders.map(o => {
            const isBuy  = o.side === 'BUY';
            const color  = isBuy ? '#0ecb81' : '#f6465d';
            const effPrice = o.price > 0 ? o.price : o.stopPrice;
            const canceling = cancelingId === o.orderId;
            return (
              <div key={o.orderId} style={styles.orderCard}>
                <div style={styles.orderRow}>
                  <span style={{ ...styles.sideBadge, background: `${color}22`, color, fontSize: '0.69rem' }}>
                    {o.side}
                  </span>
                  <span style={styles.orderType}>{orderTypeLabel(o.type)}</span>
                  <span style={styles.orderPrice}>{formatPrice(effPrice)}</span>
                  {onCancelOrder && (
                    <button
                      style={{ ...styles.cancelBtn, opacity: canceling ? 0.5 : 1 }}
                      disabled={canceling}
                      onClick={async () => {
                        setCancelingId(o.orderId);
                        try { await onCancelOrder(o.orderId, o.symbol); }
                        finally { setCancelingId(null); }
                      }}
                      title="주문 취소"
                    >
                      {canceling ? '...' : '취소'}
                    </button>
                  )}
                </div>
                <div style={styles.orderBot}>
                  <span style={styles.orderQty}>{o.origQty} {o.symbol.replace('USDT', '')}</span>
                  <span style={styles.orderSym}>{o.symbol}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '10px 10px 16px',
    overflowY: 'auto',
    flex: 1,
  },
  warning: {
    background: 'rgba(240,185,11,0.07)',
    border: '1px solid rgba(240,185,11,0.25)',
    borderRadius: 5,
    color: '#b8960f',
    fontSize: '0.77rem',
    lineHeight: 1.6,
    padding: '8px 10px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    color: '#5e6673',
    fontSize: '0.77rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  input: {
    width: '100%',
    background: '#0d1520',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#d1d4dc',
    fontSize: '0.82rem',
    padding: '6px 8px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: '"SF Mono", Consolas, monospace',
  },
  eyeBtn: {
    position: 'absolute' as const,
    right: 6,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.7rem',
    padding: '2px 4px',
    lineHeight: 1,
  },
  btnRow: {
    display: 'flex',
    gap: 6,
  },
  btn: {
    flex: 1,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 600,
    padding: '7px 8px',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  btnPrimary: {
    background: '#3b8beb',
    color: '#ffffff',
  },
  btnDanger: {
    background: 'rgba(246,70,93,0.12)',
    color: '#f6465d',
    flex: '0 0 auto',
    fontSize: '0.77rem',
  },
  statusText: {
    color: '#5e6673',
    fontSize: '0.82rem',
    textAlign: 'center' as const,
    padding: '4px 0',
  },
  errorMsg: {
    background: 'rgba(246,70,93,0.08)',
    border: '1px solid rgba(246,70,93,0.2)',
    borderRadius: 4,
    color: '#f6465d',
    fontSize: '0.77rem',
    padding: '6px 8px',
    wordBreak: 'break-all' as const,
  },
  emptyMsg: {
    color: '#3a4558',
    fontSize: '0.82rem',
    textAlign: 'center' as const,
    padding: '12px 0',
  },
  section: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  sectionTitle: {
    color: '#5e6673',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    paddingBottom: 2,
    borderBottom: '1px solid #1a2030',
  },
  posCard: {
    background: '#0d1520',
    border: '1px solid #1a2030',
    borderRadius: 5,
    padding: '7px 8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  posRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  sideBadge: {
    borderRadius: 3,
    fontSize: '0.72rem',
    fontWeight: 700,
    padding: '1px 5px',
    flexShrink: 0,
  },
  posSymbol: {
    color: '#d1d4dc',
    fontSize: '0.82rem',
    fontWeight: 600,
    fontFamily: '"SF Mono", Consolas, monospace',
    flex: 1,
  },
  posLev: {
    color: '#848e9c',
    fontSize: '0.77rem',
    fontFamily: '"SF Mono", Consolas, monospace',
  },
  marginBadge: {
    borderRadius: 3,
    fontSize: '0.66rem',
    fontWeight: 700,
    padding: '1px 4px',
    flexShrink: 0,
  },
  pnlGrid: {
    display: 'flex',
    alignItems: 'stretch',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 4,
    border: '1px solid #1a2030',
    margin: '2px 0',
  },
  pnlCell: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '5px 4px 4px',
    gap: 2,
  },
  pnlDivider: {
    width: 1,
    background: '#1a2030',
    flexShrink: 0,
  },
  pnlLabel: {
    color: '#3a4558',
    fontSize: '0.66rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  pnlValue: {
    fontSize: '0.95rem',
    fontWeight: 700,
    fontFamily: '"SF Mono", Consolas, monospace',
  },
  posDetail: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  detailLabel: {
    color: '#3a4558',
    fontSize: '0.72rem',
    fontWeight: 600,
  },
  detailVal: {
    color: '#848e9c',
    fontSize: '0.77rem',
    fontFamily: '"SF Mono", Consolas, monospace',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  orderCard: {
    background: '#0d1520',
    border: '1px solid #1a2030',
    borderRadius: 4,
    padding: '5px 8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  orderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  orderBot: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  orderType: {
    color: '#848e9c',
    fontSize: '0.72rem',
    fontWeight: 700,
    fontFamily: '"SF Mono", Consolas, monospace',
    flexShrink: 0,
  },
  orderPrice: {
    color: '#d1d4dc',
    fontSize: '0.77rem',
    fontFamily: '"SF Mono", Consolas, monospace',
    flex: 1,
  },
  orderQty: {
    color: '#5e6673',
    fontSize: '0.72rem',
    fontFamily: '"SF Mono", Consolas, monospace',
  },
  orderSym: {
    color: '#3a4558',
    fontSize: '0.68rem',
    fontFamily: '"SF Mono", Consolas, monospace',
  },
  cancelBtn: {
    background: 'rgba(246,70,93,0.08)',
    border: '1px solid rgba(246,70,93,0.3)',
    borderRadius: 3,
    color: '#f6465d',
    cursor: 'pointer',
    fontSize: '0.69rem',
    fontWeight: 700,
    padding: '1px 7px',
    fontFamily: 'inherit',
    flexShrink: 0,
    transition: 'all 0.1s',
  },
};
