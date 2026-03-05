import React, { useState, useEffect, useRef } from 'react';
import type { TradeSettings } from '../../types/trade';
import type { FuturesOrder, FuturesPosition } from '../../types/futures';
import type { Drawing } from '../../types/drawing';
import type { ConditionalOrderPair } from '../../types/conditionalOrder';
import { formatPrice } from '../../utils/priceFormat';
import { ConditionalOrdersSection } from './ConditionalOrdersSection';

interface Props {
  settings: TradeSettings;
  onChange: (s: TradeSettings) => void;
  ticker?: string;
  currentPrice?: number;
  availableUsdt?: number;
  openOrders?: FuturesOrder[];
  /** Positions for the current ticker — used to lock leverage/margin type when a position is open */
  positions?: FuturesPosition[];
  onPlaceOrder?: (
    side: 'BUY' | 'SELL',
    price: number,
    quantity: number,
    leverage: number,
    marginType: 'CROSSED' | 'ISOLATED',
    reduceOnly?: boolean,
  ) => Promise<void>;
  onCancelOrder?: (orderId: string, symbol: string) => Promise<void>;
  onLimitPriceChange?: (price: number | null) => void;
  drawings?: Drawing[];
  conditionalOrders?: ConditionalOrderPair[];
  onAddConditionalOrder?: (order: Omit<ConditionalOrderPair, 'id' | 'status' | 'createdAt'>) => void;
  onRemoveConditionalOrder?: (id: string) => void;
  onConditionalDrawingHighlight?: (id: string | null) => void;
  onConditionalPriceChange?: (prices: number[]) => void;
}

// ── Leverage preset steps ─────────────────────────────────────────────────────
const LEV_STEPS = [1, 3, 5, 10, 15, 20, 30, 50];
function leverageToIdx(lev: number): number {
  let best = 0, bestDiff = Math.abs(LEV_STEPS[0] - lev);
  for (let i = 1; i < LEV_STEPS.length; i++) {
    const d = Math.abs(LEV_STEPS[i] - lev);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

// ── Horizontal bar meter ──────────────────────────────────────────────────────
interface TickDef { pct: number; label: string; major: boolean; }

function HBarMeter({ label, displayValue, accentColor = '#f0b90b', disabled = false,
  sliderMin, sliderMax, sliderStep, sliderValue, ticks, biDir = false,
  wheelSnapSteps, onSliderChange,
}: {
  label: string; displayValue: string; accentColor?: string; disabled?: boolean;
  sliderMin: number; sliderMax: number; sliderStep: number; sliderValue: number;
  ticks: TickDef[]; biDir?: boolean; wheelSnapSteps?: number[];
  onSliderChange: (v: number) => void;
}) {
  const norm       = (sliderValue - sliderMin) / (sliderMax - sliderMin);
  const centerNorm = (0 - sliderMin) / (sliderMax - sliderMin);
  const fillLeft   = biDir ? Math.min(norm, centerNorm) * 100 : 0;
  const fillWidth  = biDir ? Math.abs(norm - centerNorm) * 100 : norm * 100;

  // ── Non-passive wheel listener to allow preventDefault ───────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef({ sliderValue, sliderMin, sliderMax, sliderStep, wheelSnapSteps, onSliderChange, disabled });
  useEffect(() => { latestRef.current = { sliderValue, sliderMin, sliderMax, sliderStep, wheelSnapSteps, onSliderChange, disabled }; });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const { disabled, sliderValue, sliderStep, sliderMin, sliderMax, wheelSnapSteps, onSliderChange } = latestRef.current;
      if (disabled) return;
      e.preventDefault();
      const up = e.deltaY < 0;
      if (wheelSnapSteps && wheelSnapSteps.length > 0) {
        const next = up
          ? wheelSnapSteps.find(v => v > sliderValue)
          : [...wheelSnapSteps].reverse().find(v => v < sliderValue);
        if (next !== undefined) onSliderChange(next);
      } else {
        const dir = up ? 1 : -1;
        const next = Math.round((sliderValue + dir * sliderStep) * 1000) / 1000;
        onSliderChange(Math.max(sliderMin, Math.min(sliderMax, next)));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div ref={containerRef} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
      opacity: disabled ? 0.38 : 1, pointerEvents: disabled ? 'none' : 'auto',
    }}>
      {/* Label */}
      <span style={{
        width: 54, fontSize: '0.75rem', color: '#8892a4',
        fontWeight: 600, letterSpacing: '0.03em', flexShrink: 0,
      }}>{label}</span>

      {/* Track + ticks */}
      <div style={{ flex: 1 }}>
        {/* Slider track area */}
        <div style={{ position: 'relative', height: 20 }}>
          {/* Track background */}
          <div style={{
            position: 'absolute', top: '50%', left: 0, right: 0,
            height: 3, transform: 'translateY(-50%)',
            background: '#1a2535', borderRadius: 2,
          }} />
          {/* Fill */}
          <div style={{
            position: 'absolute', top: '50%',
            left: `${fillLeft}%`, width: `${fillWidth}%`,
            height: 3, transform: 'translateY(-50%)',
            background: accentColor, borderRadius: 2,
            boxShadow: `0 0 5px ${accentColor}55`,
            pointerEvents: 'none',
          }} />
          {/* Center divider for biDir */}
          {biDir && (
            <div style={{
              position: 'absolute', top: '50%',
              left: `${centerNorm * 100}%`,
              width: 1, height: 10,
              transform: 'translate(-50%, -50%)',
              background: '#4a5568', pointerEvents: 'none',
            }} />
          )}
          {/* Visible thumb */}
          <div style={{
            position: 'absolute', top: '50%',
            left: `${norm * 100}%`,
            width: 11, height: 11, borderRadius: '50%',
            background: accentColor,
            boxShadow: `0 0 7px ${accentColor}99`,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }} />
          {/* Transparent native input on top */}
          <input
            type="range" min={sliderMin} max={sliderMax} step={sliderStep}
            value={sliderValue} disabled={disabled}
            onChange={e => onSliderChange(Number(e.target.value))}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              opacity: 0, cursor: disabled ? 'not-allowed' : 'pointer',
              margin: 0, padding: 0,
            }}
          />
        </div>
        {/* Tick marks */}
        <div style={{ position: 'relative', height: 16 }}>
          {ticks.map((tk, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${tk.pct}%`,
              transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <div style={{ width: 1, height: tk.major ? 4 : 3, background: '#2d3a4e' }} />
              <span style={{
                fontSize: '0.6rem', color: '#3d4e62',
                whiteSpace: 'nowrap', lineHeight: 1,
              }}>{tk.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Value display */}
      <span style={{
        width: 52, textAlign: 'right', fontSize: '0.88rem', fontWeight: 700,
        color: accentColor, fontFamily: '"SF Mono",Consolas,monospace', flexShrink: 0,
      }}>{displayValue}</span>
    </div>
  );
}


export function TradeSettingsPanel({
  settings, onChange,
  ticker, currentPrice = 0, availableUsdt = 0,
  openOrders = [], onPlaceOrder, onCancelOrder, onLimitPriceChange,
  drawings, conditionalOrders, onAddConditionalOrder, onRemoveConditionalOrder,
  onConditionalDrawingHighlight, onConditionalPriceChange, positions = [],
}: Props) {
  const hasApi = !!onPlaceOrder;

  // Active position for this ticker (non-zero positionAmt)
  const activePos = positions.find(p => Math.abs(p.positionAmt) > 0) ?? null;
  // When a position is open, leverage & marginType are locked to exchange values
  const posLeverage    = activePos ? activePos.leverage : null;
  const posMarginType  = activePos
    ? (activePos.marginType === 'cross' ? 'CROSSED' : 'ISOLATED') as 'CROSSED' | 'ISOLATED'
    : null;
  const isLocked = activePos !== null;

  const [marginType,     setMarginType]     = useState<'CROSSED' | 'ISOLATED'>('CROSSED');
  const [leverage,       setLeverage]       = useState<number>(settings.leverage ?? 10);
  const [marginPct,      setMarginPct]      = useState<number>(settings.marginPct ?? 10);
  const [limitPrice,     setLimitPrice]     = useState<string>('');
  const [showLimitPrice, setShowLimitPrice] = useState(true);
  const showLimitPriceRef = useRef(true);
  showLimitPriceRef.current = showLimitPrice;

  const [orderLoading,  setOrderLoading]  = useState(false);
  const [orderError,    setOrderError]    = useState<string | null>(null);
  const [orderSuccess,  setOrderSuccess]  = useState<'BUY' | 'SELL' | null>(null);
  const [cancelingId,   setCancelingId]   = useState<string | null>(null);

  // Close position state
  const [closePrice,   setClosePrice]   = useState('');
  const [closeQtyPct,  setCloseQtyPct]  = useState(100);
  const [closeLoading, setCloseLoading] = useState(false);
  const [closeError,   setCloseError]   = useState<string | null>(null);
  const [closeSuccess, setCloseSuccess] = useState(false);

  // USDT direct input (bidirectional with marginPct)
  const [usdtInput,   setUsdtInput]   = useState('');
  const [usdtFocused, setUsdtFocused] = useState(false);

  // Sync USDT input from % when not actively editing it
  useEffect(() => {
    if (!usdtFocused && availableUsdt > 0) {
      setUsdtInput((availableUsdt * marginPct / 100).toFixed(2));
    }
  }, [marginPct, availableUsdt, usdtFocused]);

  const handleUsdtInputChange = (val: string) => {
    setUsdtInput(val);
    const v = parseFloat(val);
    if (!isNaN(v) && v >= 0 && availableUsdt > 0) {
      const newPct = Math.min(100, Math.max(1, (v / availableUsdt) * 100));
      handleMarginPctChange(Math.round(newPct * 10) / 10);
    }
  };

  const onLimitPriceChangeRef = useRef(onLimitPriceChange);
  onLimitPriceChangeRef.current = onLimitPriceChange;
  const seededTickerRef = useRef<string>('');

  // Seed price once per ticker (not on every WS tick); also reset show-on-chart to true
  useEffect(() => {
    if (currentPrice > 0 && seededTickerRef.current !== (ticker ?? '')) {
      seededTickerRef.current = ticker ?? '';
      setLimitPrice(String(currentPrice));
      setClosePrice(String(currentPrice));
      setShowLimitPrice(true);
      showLimitPriceRef.current = true;
      onLimitPriceChangeRef.current?.(currentPrice);
    }
  }, [currentPrice, ticker]);

  // Sync leverage from global settings (only when not locked by a position)
  useEffect(() => {
    if (!isLocked) setLeverage(settings.leverage ?? 10);
  }, [settings.leverage, isLocked]);

  // When a position opens/changes, lock leverage & marginType to the exchange values
  useEffect(() => {
    if (posLeverage !== null)   setLeverage(posLeverage);
    if (posMarginType !== null) setMarginType(posMarginType);
  }, [posLeverage, posMarginType]);

  const priceParsed = parseFloat(limitPrice) || 0;
  const usdtAmount  = availableUsdt * (marginPct / 100);
  // Divide by (1 + leverage * FEE_RATE) so that margin + taker-fee fits exactly within usdtAmount.
  // Without this, high marginPct (e.g. 100%) causes totalCost > balance and openPosition silently fails.
  const TAKER_FEE   = 0.0004;
  const orderQty    = priceParsed > 0 ? (usdtAmount * leverage) / (priceParsed * (1 + leverage * TAKER_FEE)) : 0;
  const baseAsset   = ticker?.replace('USDT', '') ?? '';

  // Close position derived values
  const isLong           = activePos ? activePos.positionAmt > 0 : true;
  const posAmt           = activePos ? Math.abs(activePos.positionAmt) : 0;
  const closePriceParsed = parseFloat(closePrice) || 0;
  const closeQty         = posAmt > 0 ? parseFloat((posAmt * closeQtyPct / 100).toPrecision(6)) : 0;

  // Computed % offset from current price
  const pricePct = currentPrice > 0 && priceParsed > 0
    ? ((priceParsed / currentPrice) - 1) * 100
    : 0;

  // Price bar: clamped to 0.5% steps
  const clampedPricePct = Math.round(Math.max(-50, Math.min(50, pricePct)) * 2) / 2;
  const priceDialColor = pricePct > 0.5 ? '#0ecb81' : pricePct < -0.5 ? '#f6465d' : '#f0b90b';

  const setPriceByPct = (pct: number) => {
    if (currentPrice <= 0) return;
    const newPrice = parseFloat((currentPrice * (1 + pct / 100)).toPrecision(8));
    setLimitPrice(String(newPrice));
    if (showLimitPriceRef.current) onLimitPriceChangeRef.current?.(newPrice);
  };

  const handleLeverageChange = (v: number) => {
    setLeverage(v);
    onChange({ ...settings, leverage: v });
  };

  const handleMarginPctChange = (v: number) => {
    setMarginPct(v);
    onChange({ ...settings, marginPct: v });
  };

  const submitOrder = async (side: 'BUY' | 'SELL') => {
    if (!onPlaceOrder || orderLoading) return;
    setOrderError(null);
    if (!priceParsed || priceParsed <= 0) { setOrderError('유효한 주문 가격을 입력하세요'); return; }
    if (orderQty <= 0)                    { setOrderError('주문 수량이 0입니다. 잔고와 마진 설정을 확인하세요'); return; }

    // Round to 3 decimal places (works for most BTC/ETH tier pairs)
    const qty = Math.floor(orderQty * 1000) / 1000;
    if (qty <= 0) { setOrderError('수량이 너무 작습니다. 마진 또는 레버리지를 높이세요'); return; }

    setOrderLoading(true);
    try {
      await onPlaceOrder(side, priceParsed, qty, leverage, marginType);
      setOrderSuccess(side);
      setTimeout(() => setOrderSuccess(null), 2000);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : '주문 실패');
    } finally {
      setOrderLoading(false);
    }
  };

  const cancelOrder = async (orderId: string, symbol: string) => {
    if (!onCancelOrder || cancelingId === orderId) return;
    setCancelingId(orderId);
    try {
      await onCancelOrder(orderId, symbol);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : '취소 실패');
    } finally {
      setCancelingId(null);
    }
  };

  const submitCloseOrder = async () => {
    if (!onPlaceOrder || closeLoading || !activePos) return;
    setCloseError(null);
    if (!closePriceParsed || closePriceParsed <= 0) { setCloseError('유효한 청산 가격을 입력하세요'); return; }
    if (closeQty <= 0) { setCloseError('청산 수량이 0입니다'); return; }
    const closeSide: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';
    setCloseLoading(true);
    try {
      await onPlaceOrder(closeSide, closePriceParsed, closeQty, leverage, marginType, true);
      setCloseSuccess(true);
      setTimeout(() => setCloseSuccess(false), 2000);
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : '청산 실패');
    } finally {
      setCloseLoading(false);
    }
  };

  return (
    <div style={s.container}>

      {/* ── Available balance ── */}
      <div style={s.balanceCard}>
        <span style={s.balanceLabel}>가용 마진</span>
        <span style={s.balanceValue}>
          {hasApi && availableUsdt > 0
            ? availableUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—'} USDT
        </span>
      </div>

      {!hasApi && (
        <div style={s.noApiNote}>
          계좌 탭에서 API 키를 연결하면 실제 주문이 가능합니다.
        </div>
      )}

      {/* ── Position lock notice ── */}
      {isLocked && (
        <div style={s.posLockBanner}>
          <span style={s.posLockIcon}>🔒</span>
          <span>
            포지션 보유 중 — {posMarginType === 'CROSSED' ? '교차' : '격리'} {posLeverage}×
            <br />
            <span style={s.posLockSub}>
              레버리지·마진 타입은 포지션 청산 전까지 변경 불가합니다
            </span>
          </span>
        </div>
      )}

      {/* ── Margin type ── */}
      <div style={s.row}>
        <span style={s.rowLabel}>마진 타입</span>
        <div style={{ ...s.marginTypeBtns, ...(isLocked ? { opacity: 0.45, pointerEvents: 'none' } : {}) }}>
          {(['CROSSED', 'ISOLATED'] as const).map(mt => (
            <button
              key={mt}
              style={{
                ...s.marginTypeBtn,
                ...(marginType === mt ? (mt === 'CROSSED'
                  ? { background: 'rgba(74,144,217,0.15)', borderColor: '#4a90d9', color: '#4a90d9' }
                  : { background: 'rgba(240,185,11,0.12)', borderColor: '#f0b90b', color: '#f0b90b' })
                  : {}),
              }}
              onClick={() => !isLocked && setMarginType(mt)}
            >
              {mt === 'CROSSED' ? '교차' : '격리'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Bar meters: Leverage | Margin % | Price % ── */}
      <div style={s.barsCol}>
        {/* Leverage */}
        <HBarMeter
          label="레버리지"
          displayValue={`${leverage}×`}
          accentColor="#f0b90b"
          disabled={isLocked}
          sliderMin={0} sliderMax={7} sliderStep={1}
          sliderValue={leverageToIdx(leverage)}
          ticks={LEV_STEPS.map((lev, i) => ({
            pct: (i / 7) * 100, label: `${lev}×`, major: true,
          }))}
          onSliderChange={idx => handleLeverageChange(LEV_STEPS[idx])}
        />
        {/* Margin % */}
        <HBarMeter
          label="투입마진"
          displayValue={`${marginPct}%`}
          accentColor="#4a90d9"
          sliderMin={1} sliderMax={100} sliderStep={1}
          sliderValue={marginPct}
          wheelSnapSteps={[1, 25, 50, 75, 100]}
          ticks={[1, 25, 50, 75, 100].map(v => ({
            pct: ((v - 1) / 99) * 100, label: `${v}%`, major: true,
          }))}
          onSliderChange={handleMarginPctChange}
        />
        {/* Price % */}
        {currentPrice > 0 && (
          <HBarMeter
            label="주문가격"
            displayValue={`${clampedPricePct >= 0 ? '+' : ''}${clampedPricePct.toFixed(1)}%`}
            accentColor={priceDialColor}
            sliderMin={-50} sliderMax={50} sliderStep={0.5}
            sliderValue={clampedPricePct}
            biDir
            ticks={[-50, -25, 0, 25, 50].map(v => ({
              pct: ((v + 50) / 100) * 100,
              label: v === 0 ? '0' : (v > 0 ? `+${v}` : `${v}`) + '%',
              major: true,
            }))}
            onSliderChange={v => setPriceByPct(v)}
          />
        )}
      </div>

      {/* ── USDT direct input ── */}
      {availableUsdt > 0 && (
        <div style={s.priceSection}>
          <div style={s.sliderHeader}>
            <span style={s.rowLabel}>마진 직접 입력</span>
            <span style={s.rowLabelSub}>USDT</span>
          </div>
          <input
            style={{
              ...s.priceInput,
              ...(usdtFocused ? { borderColor: '#4a90d9' } : {}),
              ...(usdtAmount > availableUsdt ? { borderColor: 'rgba(240,185,11,0.5)' } : {}),
            }}
            type="number" value={usdtInput} min={0} step="any" placeholder="0.00"
            onFocus={() => setUsdtFocused(true)} onBlur={() => setUsdtFocused(false)}
            onChange={e => handleUsdtInputChange(e.target.value)}
          />
          {usdtAmount > availableUsdt && (
            <div style={s.validationWarn}>
              ⚠ 가용 마진({availableUsdt.toFixed(2)} USDT)을 초과합니다
            </div>
          )}
        </div>
      )}

      {/* ── Limit price input ── */}
      <div style={s.priceSection}>
        <div style={s.sliderHeader}>
          <span style={s.rowLabel}>주문 가격</span>
          <label style={s.chartToggleLabel}>
            <input
              type="checkbox"
              checked={showLimitPrice}
              onChange={e => {
                const show = e.target.checked;
                setShowLimitPrice(show);
                showLimitPriceRef.current = show;
                onLimitPriceChangeRef.current?.(show ? (priceParsed > 0 ? priceParsed : null) : null);
              }}
              style={{ accentColor: '#f0b90b', width: 11, height: 11, cursor: 'pointer' }}
            />
            <span style={s.chartToggleText}>차트</span>
          </label>
          <span style={s.rowLabelSub}>USDT</span>
        </div>
        <input
          style={s.priceInput}
          type="number"
          value={limitPrice}
          onChange={e => {
            setLimitPrice(e.target.value);
            if (showLimitPriceRef.current) {
              const p = parseFloat(e.target.value);
              onLimitPriceChangeRef.current?.(p > 0 ? p : null);
            }
          }}
          placeholder="0.00"
          min={0}
          step="any"
        />
        {currentPrice > 0 && (
          <div style={s.pctRow}>
            <span style={s.pctLabel}>현재가 대비</span>
            <span style={{
              ...s.pctBadge,
              color: pricePct >= 0 ? '#0ecb81' : '#f6465d',
              background: pricePct >= 0 ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)',
            }}>
              {pricePct >= 0 ? '+' : ''}{pricePct.toFixed(2)}%
            </span>
          </div>
        )}
        {orderQty > 0 && (
          <div style={s.qtyPreview}>
            수량: ≈ <b>{(Math.floor(orderQty * 1000) / 1000).toFixed(3)}</b> {baseAsset}
            &ensp;·&ensp;포지션 ≈ {(orderQty * priceParsed).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT
          </div>
        )}
      </div>

      {/* ── Quick pct buttons (unified card) ── */}
      {currentPrice > 0 && (
        <div style={s.unifiedCard}>
          <div style={s.quickBtnsRow}>
            {[-30, -25, -20, -15, -10, -5, -3, -2, -1].map(p => (
              <button key={p} style={s.quickBtnNeg} onClick={() => setPriceByPct(p)}>
                {p}%
              </button>
            ))}
          </div>
          <div style={s.quickBtnsRow}>
            <button style={s.quickBtnCur} onClick={() => setPriceByPct(0)}>
              현재가
            </button>
            {[1, 2, 3, 5, 10, 15, 20, 25, 30].map(p => (
              <button key={p} style={s.quickBtnPos} onClick={() => setPriceByPct(p)}>
                +{p}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {orderError && <div style={s.orderError}>{orderError}</div>}

      {/* ── Long / Short buttons ── */}
      <div style={s.sideRow}>
        <button
          style={{
            ...s.longBtn,
            opacity: (orderLoading || !hasApi) ? 0.55 : 1,
            ...(orderSuccess === 'BUY' ? { boxShadow: '0 0 20px rgba(14,203,129,0.5)' } : {}),
          }}
          onClick={() => submitOrder('BUY')}
          disabled={orderLoading || !hasApi}
        >
          {orderSuccess === 'BUY' ? '✓ 완료' : orderLoading ? '...' : '▲ LONG\n매수'}
        </button>
        <button
          style={{
            ...s.shortBtn,
            opacity: (orderLoading || !hasApi) ? 0.55 : 1,
            ...(orderSuccess === 'SELL' ? { boxShadow: '0 0 20px rgba(246,70,93,0.5)' } : {}),
          }}
          onClick={() => submitOrder('SELL')}
          disabled={orderLoading || !hasApi}
        >
          {orderSuccess === 'SELL' ? '✓ 완료' : orderLoading ? '...' : '▼ SHORT\n매도'}
        </button>
      </div>

      {/* ── Close position section ── */}
      {activePos && hasApi && (
        <div style={s.closeSection}>
          <div style={s.closeTitle}>
            포지션 청산
            <span style={{ ...s.posBadge, ...(isLong ? s.posBadgeLong : s.posBadgeShort) }}>
              {isLong ? '▲ LONG' : '▼ SHORT'}
            </span>
          </div>

          {/* Position info */}
          <div style={s.posInfoRow}>
            <span style={s.posInfoItem}>
              {posAmt} {baseAsset}&ensp;·&ensp;{activePos.leverage}×
            </span>
            <span style={s.posInfoItem}>
              진입가 <b>{formatPrice(activePos.entryPrice)}</b>
            </span>
            <span style={{
              ...s.posInfoPnl,
              color: activePos.unrealizedProfit >= 0 ? '#0ecb81' : '#f6465d',
            }}>
              미실현 {activePos.unrealizedProfit >= 0 ? '+' : ''}{activePos.unrealizedProfit.toFixed(2)} USDT
            </span>
          </div>

          {/* Close qty % */}
          <div style={s.closeQtyRow}>
            <span style={s.closeLabel}>청산 수량</span>
            <div style={s.inlineInputWrap}>
              <input
                style={s.inlineNumInput}
                type="number" min={1} max={100} step={1}
                value={closeQtyPct}
                onChange={e => setCloseQtyPct(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              />
              <span style={s.inlineUnit}>%</span>
            </div>
          </div>
          <input
            type="range" min={1} max={100} step={1}
            value={closeQtyPct}
            onChange={e => setCloseQtyPct(Number(e.target.value))}
            style={{ ...s.slider, accentColor: isLong ? '#f6465d' : '#0ecb81' }}
          />
          {closeQty > 0 && (
            <div style={s.qtyPreview}>≈ {closeQty} {baseAsset}</div>
          )}

          {/* Close price */}
          <div style={s.sliderHeader}>
            <span style={s.closeLabel}>청산 가격</span>
            <span style={s.rowLabelSub}>USDT</span>
          </div>
          <input
            style={s.priceInput}
            type="number"
            value={closePrice}
            onChange={e => setClosePrice(e.target.value)}
            placeholder="0.00"
            min={0}
            step="any"
          />

          {/* Error */}
          {closeError && <div style={s.orderError}>{closeError}</div>}

          {/* Close button */}
          <button
            style={{
              ...s.closeBtn,
              background: isLong
                ? 'linear-gradient(135deg, #f6465d, #c0253a)'
                : 'linear-gradient(135deg, #0ecb81, #0a9e64)',
              opacity: closeLoading ? 0.55 : 1,
              ...(closeSuccess ? { boxShadow: '0 0 20px rgba(240,185,11,0.4)' } : {}),
            }}
            onClick={submitCloseOrder}
            disabled={closeLoading}
          >
            {closeSuccess ? '✓ 청산 주문 완료' : closeLoading ? '...' : `${isLong ? '▼ SELL' : '▲ BUY'} 청산하기`}
          </button>
        </div>
      )}

      {/* ── Open orders for this ticker ── */}
      {openOrders.length > 0 && (
        <div style={s.ordersSection}>
          <div style={s.ordersTitle}>미체결 주문 ({openOrders.length})</div>
          {openOrders.map(o => {
            const isBuy  = o.side === 'BUY';
            const color  = isBuy ? '#0ecb81' : '#f6465d';
            const effPrice = o.price > 0 ? o.price : o.stopPrice;
            const canceling = cancelingId === o.orderId;
            return (
              <div key={o.orderId} style={s.orderCard}>
                {/* Row 1 */}
                <div style={s.orderCardTop}>
                  <span style={{ ...s.sideBadge, background: `${color}22`, color }}>
                    {o.side}
                  </span>
                  <span style={s.orderType}>{o.type}</span>
                  <span style={s.orderPrice}>{formatPrice(effPrice)}</span>
                  <button
                    style={{ ...s.cancelBtn, opacity: canceling ? 0.5 : 1 }}
                    onClick={() => cancelOrder(o.orderId, o.symbol)}
                    disabled={canceling}
                    title="주문 취소"
                  >
                    {canceling ? '...' : '취소'}
                  </button>
                </div>
                {/* Row 2 */}
                <div style={s.orderCardBot}>
                  <span style={s.orderQty}>{o.origQty} {o.symbol.replace('USDT', '')}</span>
                  <span style={s.orderStatus}>{o.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Conditional orders section ── */}
      {(drawings?.length ?? 0) > 0 && onAddConditionalOrder && (
        <ConditionalOrdersSection
          drawings={drawings ?? []}
          ticker={ticker}
          currentPrice={currentPrice}
          availableUsdt={availableUsdt}
          conditionalOrders={conditionalOrders ?? []}
          positions={positions}
          onAdd={onAddConditionalOrder}
          onRemove={onRemoveConditionalOrder ?? (() => {})}
          onDrawingHighlight={onConditionalDrawingHighlight}
          onConditionalPriceChange={onConditionalPriceChange}
        />
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    padding: '10px 10px 16px',
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },

  // balance
  balanceCard: {
    background: '#0d1520',
    border: '1px solid #1a2030',
    borderRadius: 6,
    padding: '9px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLabel: { color: '#5e6673', fontSize: '0.77rem', fontWeight: 600 },
  balanceValue: { color: '#d1d4dc', fontSize: '0.95rem', fontWeight: 700, fontFamily: '"SF Mono", Consolas, monospace' },

  noApiNote: {
    background: 'rgba(240,185,11,0.07)',
    border: '1px solid rgba(240,185,11,0.2)',
    borderRadius: 5,
    color: '#b8960f',
    fontSize: '0.77rem',
    lineHeight: 1.5,
    padding: '7px 10px',
  },

  // position lock banner
  posLockBanner: {
    background: 'rgba(74,144,217,0.08)',
    border: '1px solid rgba(74,144,217,0.3)',
    borderRadius: 5,
    color: '#7ab3e0',
    fontSize: '0.77rem',
    lineHeight: 1.6,
    padding: '7px 10px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 7,
  },
  posLockIcon: { fontSize: '0.85rem', flexShrink: 0, marginTop: 1 },
  posLockSub: { color: '#5a7fa0', fontSize: '0.72rem' },

  // row
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowLabel: { color: '#8892a4', fontSize: '0.77rem', fontWeight: 600, letterSpacing: '0.04em' },
  rowLabelSub: { color: '#5a6478', fontSize: '0.72rem' },

  // margin type
  marginTypeBtns: { display: 'flex', gap: 5 },
  marginTypeBtn: {
    background: '#0d1520', border: '1px solid #1a2030', borderRadius: 4,
    color: '#5e6673', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
    padding: '4px 14px', fontFamily: 'inherit', transition: 'all 0.1s',
  },

  // bar meters
  barsCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },

  // sliders (still used by price % adjuster and close qty)
  sliderSection: { display: 'flex', flexDirection: 'column', gap: 5 },
  sliderHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sliderVal:     { color: '#f0b90b', fontSize: '0.88rem', fontWeight: 700, fontFamily: '"SF Mono", Consolas, monospace' },
  slider: {
    width: '100%',
    accentColor: '#f0b90b',
    cursor: 'pointer',
    height: 4,
  },
  sliderTicks: { position: 'relative', height: 16, marginTop: 2 },
  tick: {
    color: '#5a6478', fontSize: '0.68rem', cursor: 'pointer',
    fontFamily: '"SF Mono", Consolas, monospace',
    transition: 'color 0.1s',
  },
  usdtAmount: {
    color: '#848e9c', fontSize: '0.77rem',
    fontFamily: '"SF Mono", Consolas, monospace', textAlign: 'right' as const,
    marginTop: -2,
  },

  // USDT direct input
  usdtInputRow: {
    display: 'flex', alignItems: 'center', gap: 5,
  },
  usdtInputLabel: {
    color: '#5a6478', fontSize: '0.72rem', fontWeight: 600, flexShrink: 0,
  },
  usdtDirectInput: {
    flex: 1, minWidth: 0,
    background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 5, color: '#d1d4dc', fontSize: '0.95rem',
    padding: '7px 10px', outline: 'none',
    fontFamily: '"SF Mono", Consolas, monospace',
    transition: 'border-color 0.15s',
  },
  usdtInputUnit: {
    color: '#5a6478', fontSize: '0.72rem', flexShrink: 0,
  },

  // inline number inputs (leverage / margin %)
  inlineInputWrap: { display: 'flex', alignItems: 'center', gap: 3 },
  inlineNumInput: {
    width: 52, background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 4, color: '#f0b90b', fontSize: '0.88rem', fontWeight: 700,
    padding: '2px 6px', textAlign: 'right' as const,
    fontFamily: '"SF Mono", Consolas, monospace', outline: 'none',
  },
  inlineUnit: { color: '#f0b90b', fontSize: '0.82rem', fontWeight: 700 },

  // validation warning
  validationWarn: {
    background: 'rgba(240,185,11,0.08)', border: '1px solid rgba(240,185,11,0.25)',
    borderRadius: 4, color: '#b8960f', fontSize: '0.74rem',
    lineHeight: 1.5, padding: '5px 9px',
  },

  // chart show/hide toggle (checkbox + label)
  chartToggleLabel: { display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' },
  chartToggleText: { color: '#5a6478', fontSize: '0.68rem' },

  // price
  priceSection: { display: 'flex', flexDirection: 'column', gap: 5 },
  priceInput: {
    width: '100%', boxSizing: 'border-box' as const,
    background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 5, color: '#d1d4dc', fontSize: '0.95rem',
    padding: '7px 10px', outline: 'none',
    fontFamily: '"SF Mono", Consolas, monospace',
    transition: 'border-color 0.15s',
  },
  pctRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 2,
  },
  pctLabel: { color: '#3a4558', fontSize: '0.72rem', fontWeight: 600 },
  pctBadge: {
    fontSize: '0.82rem', fontWeight: 700,
    fontFamily: '"SF Mono", Consolas, monospace',
    borderRadius: 3, padding: '1px 7px',
  },
  pctSliderLabels: {
    display: 'flex', justifyContent: 'space-between', marginTop: -2,
  },
  // unified card container (USDT input + quick buttons)
  unifiedCard: {
    background: '#0d1520', border: '1px solid #1a2030', borderRadius: 6,
    padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
  },

  quickBtnsRow: {
    display: 'flex', gap: 3,
  },
  quickBtnNeg: {
    flex: 1,
    background: '#0d1520', border: '1px solid rgba(246,70,93,0.28)',
    borderRadius: 4, color: '#f6465d', cursor: 'pointer',
    fontSize: '0.68rem', fontWeight: 600, padding: '6px 0',
    fontFamily: '"SF Mono", Consolas, monospace', transition: 'all 0.1s',
    textAlign: 'center' as const, whiteSpace: 'nowrap' as const,
  },
  quickBtnCur: {
    flex: 2,
    background: 'rgba(240,185,11,0.1)', border: '1px solid rgba(240,185,11,0.4)',
    borderRadius: 4, color: '#f0b90b', cursor: 'pointer',
    fontSize: '0.68rem', fontWeight: 700, padding: '6px 0',
    fontFamily: 'inherit', transition: 'all 0.1s',
    textAlign: 'center' as const, whiteSpace: 'nowrap' as const,
  },
  quickBtnPos: {
    flex: 1,
    background: '#0d1520', border: '1px solid rgba(14,203,129,0.28)',
    borderRadius: 4, color: '#0ecb81', cursor: 'pointer',
    fontSize: '0.68rem', fontWeight: 600, padding: '6px 0',
    fontFamily: '"SF Mono", Consolas, monospace', transition: 'all 0.1s',
    textAlign: 'center' as const, whiteSpace: 'nowrap' as const,
  },
  qtyPreview: {
    color: '#6b7a90', fontSize: '0.75rem', lineHeight: 1.5,
    fontFamily: '"SF Mono", Consolas, monospace',
  },

  // error
  orderError: {
    background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.25)',
    borderRadius: 4, color: '#f6465d', fontSize: '0.77rem',
    padding: '6px 10px', lineHeight: 1.5, wordBreak: 'break-all' as const,
  },

  // action buttons
  sideRow: { display: 'flex', gap: 6 },
  longBtn: {
    flex: 1, background: 'linear-gradient(135deg, #0ecb81, #0a9e64)',
    border: 'none', borderRadius: 6, color: '#fff',
    cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem',
    padding: '14px 6px', fontFamily: 'inherit',
    letterSpacing: '0.02em', whiteSpace: 'pre-line' as const,
    textAlign: 'center' as const, transition: 'all 0.15s',
    lineHeight: 1.35,
  },
  shortBtn: {
    flex: 1, background: 'linear-gradient(135deg, #f6465d, #c0253a)',
    border: 'none', borderRadius: 6, color: '#fff',
    cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem',
    padding: '14px 6px', fontFamily: 'inherit',
    letterSpacing: '0.02em', whiteSpace: 'pre-line' as const,
    textAlign: 'center' as const, transition: 'all 0.15s',
    lineHeight: 1.35,
  },

  // orders
  ordersSection: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
  ordersTitle: {
    color: '#5e6673', fontSize: '0.72rem', fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
    paddingBottom: 2, borderBottom: '1px solid #1a2030',
  },
  orderCard: {
    background: '#0d1520', border: '1px solid #1a2030', borderRadius: 5,
    padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 4,
  },
  orderCardTop: { display: 'flex', alignItems: 'center', gap: 6 },
  orderCardBot: { display: 'flex', alignItems: 'center', gap: 8 },
  sideBadge: {
    borderRadius: 3, fontSize: '0.69rem', fontWeight: 700,
    padding: '1px 5px', flexShrink: 0,
  },
  orderType: {
    color: '#848e9c', fontSize: '0.72rem', fontWeight: 700,
    fontFamily: '"SF Mono", Consolas, monospace', flexShrink: 0,
  },
  orderPrice: {
    color: '#d1d4dc', fontSize: '0.77rem',
    fontFamily: '"SF Mono", Consolas, monospace', flex: 1,
  },
  cancelBtn: {
    background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.3)',
    borderRadius: 3, color: '#f6465d', cursor: 'pointer', fontSize: '0.72rem',
    fontWeight: 700, padding: '2px 8px', fontFamily: 'inherit',
    flexShrink: 0, transition: 'all 0.1s',
  },
  orderQty: {
    color: '#5e6673', fontSize: '0.72rem',
    fontFamily: '"SF Mono", Consolas, monospace',
  },
  orderStatus: {
    color: '#3a4558', fontSize: '0.68rem', fontFamily: '"SF Mono", Consolas, monospace',
  },

  // close position section
  closeSection: {
    background: 'rgba(246,70,93,0.04)',
    border: '1px solid rgba(246,70,93,0.2)',
    borderRadius: 6,
    padding: '10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  closeTitle: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    color: '#8892a4', fontSize: '0.77rem', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase' as const,
  },
  posBadge: {
    fontSize: '0.72rem', fontWeight: 700, borderRadius: 3, padding: '2px 6px',
  },
  posBadgeLong: { background: 'rgba(14,203,129,0.15)', color: '#0ecb81' },
  posBadgeShort: { background: 'rgba(246,70,93,0.15)', color: '#f6465d' },
  posInfoRow: {
    display: 'flex', flexWrap: 'wrap' as const, gap: 6, fontSize: '0.74rem',
    lineHeight: 1.6,
  },
  posInfoItem: { color: '#5e6673' },
  posInfoPnl: {
    fontSize: '0.74rem', fontWeight: 700,
    fontFamily: '"SF Mono", Consolas, monospace',
  },
  closeQtyRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  closeLabel: { color: '#8892a4', fontSize: '0.74rem', fontWeight: 600 },
  closeBtn: {
    width: '100%', border: 'none', borderRadius: 6, color: '#fff',
    cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem',
    padding: '11px', fontFamily: 'inherit',
    letterSpacing: '0.02em', transition: 'all 0.15s',
  },
};
