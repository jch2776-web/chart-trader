import React, { useState, useEffect, useRef } from 'react';
import type { Drawing, BoxDrawing, HlineDrawing } from '../../types/drawing';
import type { ConditionalOrderPair, TriggerCondition } from '../../types/conditionalOrder';
import { TRIGGER_LABELS } from '../../types/conditionalOrder';
import type { FuturesPosition } from '../../types/futures';
import { formatPrice } from '../../utils/priceFormat';

interface Props {
  drawings: Drawing[];
  ticker?: string;
  currentPrice?: number;
  availableUsdt?: number;
  conditionalOrders: ConditionalOrderPair[];
  /** Positions for the current ticker — used to lock leverage/margin type */
  positions?: FuturesPosition[];
  onAdd: (order: Omit<ConditionalOrderPair, 'id' | 'status' | 'createdAt'>) => void;
  onRemove: (id: string) => void;
  onDrawingHighlight?: (id: string | null) => void;
  /** Called whenever the form's entry/exit prices change (for chart overlay). Pass [] to clear. */
  onConditionalPriceChange?: (prices: number[]) => void;
}

function getDrawingLabel(d: Drawing, index: number): string {
  const num = `#${index + 1}`;
  if (d.type === 'trendline') return `추세선${num}`;
  if (d.type === 'box') {
    const bx = d as BoxDrawing;
    return `박스${num} (${formatPrice(bx.bottomPrice)}~${formatPrice(bx.topPrice)})`;
  }
  if (d.type === 'hline') return `수평선${num} (${formatPrice((d as HlineDrawing).price)})`;
  return `도형${num}`;
}

const STATUS_LABELS: Record<ConditionalOrderPair['status'], string> = {
  active: '대기',
  triggered: '실행됨',
  failed: '실패',
  cancelled: '취소됨',
};
const STATUS_COLORS: Record<ConditionalOrderPair['status'], string> = {
  active: '#f0b90b',
  triggered: '#0ecb81',
  failed: '#f6465d',
  cancelled: '#5e6673',
};

const LEVERAGE_MARKS = [1, 25, 50, 75, 100, 125];
const MARGIN_MARKS   = [25, 50, 75, 100];
const QUICK_PCTS     = [-25, -20, -15, -10, -5, 5, 10, 15, 20, 25];

export function ConditionalOrdersSection({
  drawings, ticker, currentPrice = 0, availableUsdt = 0,
  conditionalOrders, positions = [], onAdd, onRemove, onDrawingHighlight,
  onConditionalPriceChange,
}: Props) {
  const tickerDrawings = drawings.filter(d => d.ticker === ticker);
  const tickerOrders   = conditionalOrders.filter(co => co.ticker === ticker && (co.status === 'active' || co.status === 'failed'));
  const activeCount    = tickerOrders.filter(co => co.status === 'active').length;

  // Active position lock (same logic as TradeSettings)
  const activePos     = positions.find(p => Math.abs(p.positionAmt) > 0) ?? null;
  const posLeverage   = activePos ? activePos.leverage : null;
  const posMarginType = activePos
    ? (activePos.marginType === 'cross' ? 'CROSSED' : 'ISOLATED') as 'CROSSED' | 'ISOLATED'
    : null;
  const isLocked = activePos !== null;

  const [expanded,             setExpanded]             = useState(false);
  const [drawingId,            setDrawingId]            = useState('');
  const [triggerCondition,     setTriggerCondition]     = useState<TriggerCondition>('break_up');
  const [entrySide,            setEntrySide]            = useState<'BUY' | 'SELL'>('BUY');
  const [leverage,             setLeverage]             = useState(10);
  const [marginPct,            setMarginPct]            = useState(10);
  const [marginType,           setMarginType]           = useState<'CROSSED' | 'ISOLATED'>('CROSSED');
  const [entryPrice,           setEntryPrice]           = useState('');
  const [exitEnabled,          setExitEnabled]          = useState(false);
  const [exitPrice,            setExitPrice]            = useState('');
  const [exitQtyPct,           setExitQtyPct]           = useState(100);
  const [formError,            setFormError]            = useState<string | null>(null);
  const [showConditionalPrice, setShowConditionalPrice] = useState(false);

  const onDrawingHighlightRef = useRef(onDrawingHighlight);
  onDrawingHighlightRef.current = onDrawingHighlight;

  const onConditionalPriceChangeRef = useRef(onConditionalPriceChange);
  onConditionalPriceChangeRef.current = onConditionalPriceChange;

  // Available trigger conditions depend on drawing type
  const selectedDrawing = tickerDrawings.find(d => d.id === drawingId);
  const isBox = selectedDrawing?.type === 'box';
  const availableConditions: TriggerCondition[] = isBox
    ? ['break_up', 'break_down', 'enter_up', 'enter_down']
    : ['break_up', 'break_down'];

  // Seed drawing selector
  useEffect(() => {
    if (tickerDrawings.length > 0 && !tickerDrawings.find(d => d.id === drawingId)) {
      const firstId = tickerDrawings[0].id;
      setDrawingId(firstId);
      if (expanded) onDrawingHighlightRef.current?.(firstId);
    }
  }, [tickerDrawings, drawingId, expanded]);

  // Reset trigger condition when drawing type changes (enter_ conditions only for box)
  useEffect(() => {
    if (!isBox && (triggerCondition === 'enter_up' || triggerCondition === 'enter_down')) {
      setTriggerCondition('break_up');
    }
  }, [isBox, triggerCondition]);

  // Seed entry price once per ticker
  useEffect(() => {
    if (currentPrice > 0) setEntryPrice(String(currentPrice));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  // Clear highlight when collapsed
  useEffect(() => {
    if (!expanded) onDrawingHighlightRef.current?.(null);
    else if (drawingId) onDrawingHighlightRef.current?.(drawingId);
  }, [expanded, drawingId]);

  // Sync leverage & marginType from active position
  useEffect(() => {
    if (posLeverage !== null)   setLeverage(posLeverage);
    if (posMarginType !== null) setMarginType(posMarginType);
  }, [posLeverage, posMarginType]);

  // Reset show-on-chart flag on ticker change
  useEffect(() => { setShowConditionalPrice(false); }, [ticker]);

  const entryParsed = parseFloat(entryPrice) || 0;
  const exitParsed  = parseFloat(exitPrice) || 0;
  const entryUsdt   = availableUsdt * marginPct / 100;
  const entryQty    = entryParsed > 0 ? Math.floor((entryUsdt * leverage / entryParsed) * 1000) / 1000 : 0;

  const entryPct = currentPrice > 0 && entryParsed > 0
    ? ((entryParsed / currentPrice) - 1) * 100 : 0;
  const exitPct = currentPrice > 0 && exitParsed > 0
    ? ((exitParsed / currentPrice) - 1) * 100 : 0;

  // Emit form prices to chart overlay whenever prices or visibility change
  // (must be AFTER entryParsed/exitParsed declarations to avoid TDZ error)
  useEffect(() => {
    if (!expanded || !showConditionalPrice) {
      onConditionalPriceChangeRef.current?.([]);
      return () => { onConditionalPriceChangeRef.current?.([]); };
    }
    const prices: number[] = [];
    if (entryParsed > 0) prices.push(entryParsed);
    if (exitEnabled && exitParsed > 0) prices.push(exitParsed);
    onConditionalPriceChangeRef.current?.(prices);
    return () => { onConditionalPriceChangeRef.current?.([]); };
  }, [expanded, showConditionalPrice, entryParsed, exitParsed, exitEnabled]);

  const setPriceByPct = (pct: number, setter: (v: string) => void) => {
    if (currentPrice <= 0) return;
    setter(String(parseFloat((currentPrice * (1 + pct / 100)).toPrecision(8))));
  };

  const handleAdd = () => {
    setFormError(null);
    if (!drawingId) { setFormError('도형을 선택하세요'); return; }
    if (!entryParsed || entryParsed <= 0) { setFormError('유효한 진입 가격을 입력하세요'); return; }
    if (entryQty <= 0) { setFormError('주문 수량이 0입니다. 잔고와 마진 설정을 확인하세요'); return; }
    if (exitEnabled && (!exitParsed || exitParsed <= 0)) { setFormError('유효한 청산 가격을 입력하세요'); return; }

    const drawing    = tickerDrawings.find(d => d.id === drawingId);
    const drawingIdx = tickerDrawings.findIndex(d => d.id === drawingId);
    const label      = drawing ? getDrawingLabel(drawing, drawingIdx) : '도형';

    onAdd({
      ticker: ticker ?? '',
      drawingId,
      drawingLabel: label,
      triggerCondition,
      entrySide,
      entryPrice: entryParsed,
      entryMarginPct: marginPct,
      entryLeverage: leverage,
      entryMarginType: marginType,
      exitEnabled,
      exitPrice: exitEnabled ? exitParsed : 0,
      exitQtyPct,
    });

    setEntryPrice(String(currentPrice || ''));
    setExitPrice('');
    setExitEnabled(false);
    setExpanded(false);
  };

  return (
    <div style={s.container}>
      {/* ── Header ── */}
      <div style={s.header} onClick={() => setExpanded(v => !v)}>
        <span style={s.headerTitle}>조건부 주문</span>
        {activeCount > 0 && (
          <span style={s.activeBadge}>{activeCount}개 대기중</span>
        )}
        <span style={s.chevron}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* ── Form ── */}
      {expanded && (
        <div style={s.form}>
          {tickerDrawings.length === 0 ? (
            <div style={s.emptyNote}>현재 티커에 도형이 없습니다. 먼저 도형을 그려주세요.</div>
          ) : (
            <>
              {/* Position lock notice */}
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

              {/* Drawing selector */}
              <div style={s.sliderSection}>
                <div style={s.sliderHeader}>
                  <span style={s.rowLabel}>트리거 도형</span>
                </div>
                <select
                  style={s.select}
                  value={drawingId}
                  onChange={e => {
                    setDrawingId(e.target.value);
                    onDrawingHighlightRef.current?.(e.target.value);
                  }}
                >
                  {tickerDrawings.map((d, i) => (
                    <option key={d.id} value={d.id}>{getDrawingLabel(d, i)}</option>
                  ))}
                </select>
              </div>

              {/* Trigger condition */}
              <div style={s.sliderSection}>
                <div style={s.sliderHeader}>
                  <span style={s.rowLabel}>트리거 조건</span>
                </div>
                <div style={s.conditionGrid}>
                  {availableConditions.map(cond => (
                    <button
                      key={cond}
                      style={{
                        ...s.conditionBtn,
                        ...(triggerCondition === cond ? s.conditionBtnActive : {}),
                      }}
                      onClick={() => setTriggerCondition(cond)}
                    >
                      {TRIGGER_LABELS[cond]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Entry side */}
              <div style={s.sliderSection}>
                <span style={s.rowLabel}>진입 방향</span>
                <div style={s.toggleRow}>
                  <button
                    style={{ ...s.sideBtn, ...(entrySide === 'BUY' ? s.sideBtnLong : {}) }}
                    onClick={() => setEntrySide('BUY')}
                  >▲ BUY (롱)</button>
                  <button
                    style={{ ...s.sideBtn, ...(entrySide === 'SELL' ? s.sideBtnShort : {}) }}
                    onClick={() => setEntrySide('SELL')}
                  >▼ SELL (숏)</button>
                </div>
              </div>

              {/* Leverage — identical to TradeSettings */}
              <div style={{ ...s.sliderSection, ...(isLocked ? { opacity: 0.45, pointerEvents: 'none' } : {}) }}>
                <div style={s.sliderHeader}>
                  <span style={s.rowLabel}>레버리지</span>
                  <div style={s.inlineWrap}>
                    <input
                      style={s.inlineNum}
                      type="number" min={1} max={125} step={1}
                      value={leverage}
                      readOnly={isLocked}
                      onChange={e => !isLocked && setLeverage(Math.max(1, Math.min(125, Number(e.target.value) || 1)))}
                    />
                    <span style={s.inlineUnit}>×</span>
                  </div>
                </div>
                <input
                  type="range" min={1} max={125} step={1}
                  value={leverage}
                  disabled={isLocked}
                  onChange={e => setLeverage(Number(e.target.value))}
                  style={s.slider}
                />
                <div style={{ position: 'relative', height: 16, marginTop: 2 }}>
                  {LEVERAGE_MARKS.map(v => {
                    const pct = (v - 1) / 124 * 100;
                    return (
                      <span
                        key={v}
                        style={{ ...s.tick, position: 'absolute', left: `${pct}%`, transform: pct < 4 ? 'none' : pct > 96 ? 'translateX(-100%)' : 'translateX(-50%)' }}
                        onClick={() => setLeverage(v)}
                      >{v}×</span>
                    );
                  })}
                </div>
              </div>

              {/* Margin % — identical to TradeSettings */}
              <div style={s.sliderSection}>
                <div style={s.sliderHeader}>
                  <span style={s.rowLabel}>투입 마진</span>
                  <div style={s.inlineWrap}>
                    <input
                      style={s.inlineNum}
                      type="number" min={1} max={100} step={1}
                      value={marginPct}
                      onChange={e => setMarginPct(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                    />
                    <span style={s.inlineUnit}>%</span>
                  </div>
                </div>
                <input
                  type="range" min={1} max={100} step={1}
                  value={marginPct}
                  onChange={e => setMarginPct(Number(e.target.value))}
                  style={s.slider}
                />
                <div style={{ position: 'relative', height: 16, marginTop: 2 }}>
                  {MARGIN_MARKS.map(v => {
                    const pct = (v - 1) / 99 * 100;
                    return (
                      <span
                        key={v}
                        style={{ ...s.tick, position: 'absolute', left: `${pct}%`, transform: pct < 4 ? 'none' : pct > 96 ? 'translateX(-100%)' : 'translateX(-50%)' }}
                        onClick={() => setMarginPct(v)}
                      >{v}%</span>
                    );
                  })}
                </div>
                {availableUsdt > 0 && (
                  <div style={s.usdtHint}>
                    ≈ {entryUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT
                    {entryUsdt > availableUsdt && (
                      <span style={s.warnInline}> ⚠ 가용 마진 초과</span>
                    )}
                  </div>
                )}
              </div>

              {/* Margin type */}
              <div style={s.sliderSection}>
                <div style={s.sliderHeader}>
                  <span style={s.rowLabel}>마진 타입</span>
                  <div style={{ ...s.toggleRow, ...(isLocked ? { opacity: 0.45, pointerEvents: 'none' } : {}) }}>
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
              </div>

              {/* Entry price — like TradeSettings priceSection */}
              <div style={s.sliderSection}>
                <div style={s.sliderHeader}>
                  <span style={s.rowLabel}>진입 가격</span>
                  <label style={s.chartToggleLabel}>
                    <input
                      type="checkbox"
                      checked={showConditionalPrice}
                      onChange={e => setShowConditionalPrice(e.target.checked)}
                      style={{ accentColor: '#22d3ee', width: 11, height: 11, cursor: 'pointer' }}
                    />
                    <span style={s.chartToggleText}>차트</span>
                  </label>
                  <span style={s.rowLabelSub}>USDT</span>
                </div>
                <input
                  style={s.priceInput}
                  type="number" min={0} step="any"
                  value={entryPrice}
                  onChange={e => setEntryPrice(e.target.value)}
                  placeholder="0.00"
                />
                {currentPrice > 0 && (
                  <>
                    <div style={s.pctRow}>
                      <span style={s.pctLabel}>현재가 대비</span>
                      <span style={{
                        ...s.pctBadge,
                        color: entryPct >= 0 ? '#0ecb81' : '#f6465d',
                        background: entryPct >= 0 ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)',
                      }}>
                        {entryPct >= 0 ? '+' : ''}{entryPct.toFixed(2)}%
                      </span>
                    </div>
                    <input
                      type="range" min={-100} max={100} step={0.1}
                      value={Math.max(-100, Math.min(100, entryPct))}
                      onChange={e => setPriceByPct(Number(e.target.value), setEntryPrice)}
                      style={{ ...s.slider, accentColor: entryPct >= 0 ? '#0ecb81' : '#f6465d' }}
                    />
                    <div style={s.quickBtns}>
                      {QUICK_PCTS.map(p => (
                        <button
                          key={p}
                          style={p < 0 ? s.quickBtnNeg : s.quickBtnPos}
                          onClick={() => setPriceByPct(p, setEntryPrice)}
                        >
                          {p > 0 ? '+' : ''}{p}%
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {entryQty > 0 && (
                  <div style={s.qtyPreview}>
                    예상 수량: ≈ <b>{entryQty.toFixed(3)}</b>
                    &ensp;·&ensp;포지션 ≈ {(entryQty * entryParsed).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT
                  </div>
                )}
              </div>

              {/* Exit order toggle */}
              <label style={s.checkRow}>
                <input
                  type="checkbox"
                  checked={exitEnabled}
                  onChange={e => setExitEnabled(e.target.checked)}
                  style={{ accentColor: '#f0b90b' }}
                />
                <span style={s.checkLabel}>청산 주문도 함께 등록 (쌍주문)</span>
              </label>

              {exitEnabled && (
                <>
                  {/* Exit price — same pattern */}
                  <div style={s.sliderSection}>
                    <div style={s.sliderHeader}>
                      <span style={s.rowLabel}>청산 가격</span>
                      <span style={s.rowLabelSub}>USDT</span>
                    </div>
                    <input
                      style={s.priceInput}
                      type="number" min={0} step="any"
                      value={exitPrice}
                      onChange={e => setExitPrice(e.target.value)}
                      placeholder="0.00"
                    />
                    {currentPrice > 0 && (
                      <>
                        <div style={s.pctRow}>
                          <span style={s.pctLabel}>현재가 대비</span>
                          <span style={{
                            ...s.pctBadge,
                            color: exitPct >= 0 ? '#0ecb81' : '#f6465d',
                            background: exitPct >= 0 ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)',
                          }}>
                            {exitPct >= 0 ? '+' : ''}{exitPct.toFixed(2)}%
                          </span>
                        </div>
                        <input
                          type="range" min={-100} max={100} step={0.1}
                          value={Math.max(-100, Math.min(100, exitPct))}
                          onChange={e => setPriceByPct(Number(e.target.value), setExitPrice)}
                          style={{ ...s.slider, accentColor: exitPct >= 0 ? '#0ecb81' : '#f6465d' }}
                        />
                        <div style={s.quickBtns}>
                          {QUICK_PCTS.map(p => (
                            <button
                              key={p}
                              style={p < 0 ? s.quickBtnNeg : s.quickBtnPos}
                              onClick={() => setPriceByPct(p, setExitPrice)}
                            >
                              {p > 0 ? '+' : ''}{p}%
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Exit qty % */}
                  <div style={s.sliderSection}>
                    <div style={s.sliderHeader}>
                      <span style={s.rowLabel}>청산 수량</span>
                      <div style={s.inlineWrap}>
                        <input
                          style={s.inlineNum}
                          type="number" min={1} max={100} step={1}
                          value={exitQtyPct}
                          onChange={e => setExitQtyPct(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                        />
                        <span style={s.inlineUnit}>%</span>
                      </div>
                    </div>
                    <input
                      type="range" min={1} max={100} step={1}
                      value={exitQtyPct}
                      onChange={e => setExitQtyPct(Number(e.target.value))}
                      style={s.slider}
                    />
                    <div style={{ position: 'relative', height: 16, marginTop: 2 }}>
                      {[25, 50, 75, 100].map(v => {
                        const pct = (v - 1) / 99 * 100;
                        return (
                          <span
                            key={v}
                            style={{ ...s.tick, position: 'absolute', left: `${pct}%`, transform: pct < 4 ? 'none' : pct > 96 ? 'translateX(-100%)' : 'translateX(-50%)' }}
                            onClick={() => setExitQtyPct(v)}
                          >{v}%</span>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {formError && <div style={s.formError}>{formError}</div>}

              <button style={s.addBtn} onClick={handleAdd}>+ 조건부 주문 추가</button>
            </>
          )}
        </div>
      )}

      {/* ── Orders list ── */}
      {tickerOrders.length > 0 && (
        <div style={s.ordersList}>
          {tickerOrders.map(co => {
            const entrySideColor = co.entrySide === 'BUY' ? '#0ecb81' : '#f6465d';
            const exitSideColor  = co.entrySide === 'BUY' ? '#f6465d' : '#0ecb81';
            const statusColor    = STATUS_COLORS[co.status];
            return (
              <div key={co.id} style={s.orderCard}>
                {/* Card header: drawing label + status + cancel */}
                <div style={s.cardHeader}>
                  <span style={s.drawingLabel}>{co.drawingLabel}</span>
                  <span style={{ ...s.statusBadge, color: statusColor, borderColor: statusColor + '44', background: statusColor + '11' }}>
                    {STATUS_LABELS[co.status]}
                  </span>
                  {co.status === 'active' && (
                    <button style={s.cancelBtn} onClick={() => onRemove(co.id)}>취소</button>
                  )}
                </div>
                {/* Trigger condition badge */}
                <div style={s.triggerCondRow}>
                  <span style={s.triggerCondLabel}>조건</span>
                  <span style={s.triggerCondBadge}>
                    {TRIGGER_LABELS[co.triggerCondition] ?? co.triggerCondition}
                  </span>
                </div>

                {co.exitEnabled ? (
                  /* ── Paired entry+exit with bracket connector ── */
                  <div style={s.pairWrap}>
                    <div style={s.pairLine} />
                    <div style={s.pairRows}>
                      {/* Entry sub-row */}
                      <div style={{ ...s.pairRow, borderColor: entrySideColor + '33' }}>
                        <div style={s.bracketDot} />
                        <span style={{ ...s.sideBadge, background: entrySideColor + '22', color: entrySideColor }}>
                          {co.entrySide}
                        </span>
                        <span style={s.priceText}>
                          {co.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </span>
                        <span style={s.detailText}>{co.entryLeverage}× · {co.entryMarginPct}%</span>
                      </div>
                      {/* Exit sub-row */}
                      <div style={{ ...s.pairRow, borderColor: exitSideColor + '33' }}>
                        <div style={s.bracketDot} />
                        <span style={{ ...s.sideBadge, background: exitSideColor + '22', color: exitSideColor }}>
                          {co.entrySide === 'BUY' ? 'SELL' : 'BUY'}
                        </span>
                        <span style={s.priceText}>
                          {co.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </span>
                        <span style={s.detailText}>qty {co.exitQtyPct}%</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Single entry row ── */
                  <div style={s.singleRow}>
                    <span style={{ ...s.sideBadge, background: entrySideColor + '22', color: entrySideColor }}>
                      {co.entrySide}
                    </span>
                    <span style={s.priceText}>
                      {co.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                    <span style={s.detailText}>{co.entryLeverage}× · {co.entryMarginPct}%</span>
                  </div>
                )}

                {co.status === 'failed' && co.errorMsg && (
                  <div style={s.errorMsg}>{co.errorMsg}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    borderTop: '1px solid #1a2030',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 10px', cursor: 'pointer', userSelect: 'none',
  },
  headerTitle: {
    color: '#8892a4', fontSize: '0.75rem', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase' as const, flex: 1,
  },
  activeBadge: {
    background: 'rgba(240,185,11,0.12)', border: '1px solid rgba(240,185,11,0.3)',
    borderRadius: 10, color: '#f0b90b', fontSize: '0.68rem', fontWeight: 700, padding: '1px 7px',
  },
  chevron: { color: '#5a6478', fontSize: '0.68rem' },

  // form
  form: { padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: 10 },
  emptyNote: { color: '#6b7a90', fontSize: '0.77rem', lineHeight: 1.5, padding: '4px 0' },

  // position lock banner (same as TradeSettings)
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

  // shared layout (mirrors TradeSettings)
  sliderSection: { display: 'flex', flexDirection: 'column', gap: 5 },
  sliderHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: '#8892a4', fontSize: '0.77rem', fontWeight: 600, letterSpacing: '0.04em' },
  rowLabelSub: { color: '#5a6478', fontSize: '0.72rem' },
  inlineWrap: { display: 'flex', alignItems: 'center', gap: 3 },
  inlineNum: {
    width: 52, background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 4, color: '#f0b90b', fontSize: '0.88rem', fontWeight: 700,
    padding: '2px 6px', textAlign: 'right' as const,
    fontFamily: '"SF Mono", Consolas, monospace', outline: 'none',
  },
  inlineUnit: { color: '#f0b90b', fontSize: '0.82rem', fontWeight: 700 },
  slider: { width: '100%', accentColor: '#f0b90b', cursor: 'pointer', height: 4 },
  ticks: { position: 'relative', height: 16, marginTop: 2 },
  tick: {
    color: '#5a6478', fontSize: '0.68rem', cursor: 'pointer',
    fontFamily: '"SF Mono", Consolas, monospace', transition: 'color 0.1s',
  },
  usdtHint: {
    color: '#848e9c', fontSize: '0.72rem',
    fontFamily: '"SF Mono", Consolas, monospace', textAlign: 'right' as const, marginTop: -2,
  },
  warnInline: { color: '#b8960f', fontWeight: 700 },

  // chart show/hide toggle (checkbox + label)
  chartToggleLabel: { display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' },
  chartToggleText: { color: '#5a6478', fontSize: '0.68rem' },

  // price section (mirrors TradeSettings)
  priceInput: {
    width: '100%', background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 5, color: '#d1d4dc', fontSize: '0.95rem',
    padding: '8px 10px', outline: 'none', fontFamily: '"SF Mono", Consolas, monospace',
    boxSizing: 'border-box' as const,
  },
  pctRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  pctLabel: { color: '#5a6478', fontSize: '0.72rem', fontWeight: 600 },
  pctBadge: {
    fontSize: '0.82rem', fontWeight: 700, fontFamily: '"SF Mono", Consolas, monospace',
    borderRadius: 3, padding: '1px 7px',
  },
  quickBtns: { display: 'flex', flexWrap: 'wrap' as const, gap: 3, marginTop: 2 },
  quickBtnNeg: {
    flex: '1 0 17%',
    background: 'rgba(246,70,93,0.07)', border: '1px solid rgba(246,70,93,0.2)',
    borderRadius: 3, color: '#f6465d', cursor: 'pointer',
    fontSize: '0.68rem', fontWeight: 700, padding: '4px 0',
    fontFamily: '"SF Mono", Consolas, monospace', textAlign: 'center' as const,
  },
  quickBtnPos: {
    flex: '1 0 17%',
    background: 'rgba(14,203,129,0.07)', border: '1px solid rgba(14,203,129,0.2)',
    borderRadius: 3, color: '#0ecb81', cursor: 'pointer',
    fontSize: '0.68rem', fontWeight: 700, padding: '4px 0',
    fontFamily: '"SF Mono", Consolas, monospace', textAlign: 'center' as const,
  },
  qtyPreview: {
    color: '#6b7a90', fontSize: '0.74rem', fontFamily: '"SF Mono", Consolas, monospace', lineHeight: 1.5,
  },

  // toggles
  toggleRow: { display: 'flex', gap: 4 },
  sideBtn: {
    flex: 1, background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 4, color: '#8892a4', cursor: 'pointer', fontSize: '0.82rem',
    fontWeight: 600, padding: '6px 0', fontFamily: 'inherit', transition: 'all 0.1s',
  },
  sideBtnLong: { background: 'rgba(14,203,129,0.12)', borderColor: '#0ecb81', color: '#0ecb81' },
  sideBtnShort: { background: 'rgba(246,70,93,0.12)', borderColor: '#f6465d', color: '#f6465d' },
  marginTypeBtn: {
    flex: 1, background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 4, color: '#8892a4', cursor: 'pointer', fontSize: '0.78rem',
    fontWeight: 600, padding: '4px 0', fontFamily: 'inherit', transition: 'all 0.1s',
  },
  select: {
    width: '100%', background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 4, color: '#d1d4dc', fontSize: '0.85rem',
    padding: '6px 8px', outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
  },

  // trigger condition selector
  conditionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 },
  conditionBtn: {
    background: '#0d1520', border: '1px solid #2a3550',
    borderRadius: 4, color: '#8892a4', cursor: 'pointer', fontSize: '0.78rem',
    fontWeight: 600, padding: '6px 4px', fontFamily: 'inherit',
    transition: 'all 0.1s', textAlign: 'center' as const,
  },
  conditionBtnActive: {
    background: 'rgba(240,185,11,0.12)', borderColor: '#f0b90b', color: '#f0b90b',
  },

  // trigger condition badge in card
  triggerCondRow: {
    display: 'flex', alignItems: 'center', gap: 5, marginTop: -1,
  },
  triggerCondLabel: {
    color: '#5a6478', fontSize: '0.68rem', fontWeight: 600,
  },
  triggerCondBadge: {
    background: 'rgba(240,185,11,0.08)', border: '1px solid rgba(240,185,11,0.2)',
    borderRadius: 3, color: '#b8960f', fontSize: '0.68rem', fontWeight: 700,
    padding: '1px 6px',
  },
  checkRow: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' },
  checkLabel: { color: '#8892a4', fontSize: '0.77rem' },

  formError: {
    background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.25)',
    borderRadius: 4, color: '#f6465d', fontSize: '0.74rem', padding: '5px 8px',
  },
  addBtn: {
    background: 'rgba(240,185,11,0.08)', border: '1px solid rgba(240,185,11,0.3)',
    borderRadius: 5, color: '#f0b90b', cursor: 'pointer', fontSize: '0.82rem',
    fontWeight: 700, padding: '9px', fontFamily: 'inherit', textAlign: 'center' as const,
  },

  // orders list
  ordersList: {
    display: 'flex', flexDirection: 'column', gap: 5,
    padding: '0 10px 10px', maxHeight: 320, overflowY: 'auto',
  },
  orderCard: {
    background: '#0d1520', border: '1px solid #1e2940',
    borderRadius: 6, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 5,
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 5 },
  drawingLabel: {
    color: '#8892a4', fontSize: '0.72rem', fontWeight: 600,
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  statusBadge: {
    borderRadius: 3, border: '1px solid', fontSize: '0.65rem', fontWeight: 700,
    padding: '1px 5px', flexShrink: 0,
  },
  cancelBtn: {
    background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.3)',
    borderRadius: 3, color: '#f6465d', cursor: 'pointer', fontSize: '0.68rem',
    fontWeight: 700, padding: '1px 7px', fontFamily: 'inherit', flexShrink: 0,
  },

  // paired entry+exit visual
  pairWrap: { display: 'flex', gap: 6, alignItems: 'stretch' },
  pairLine: {
    width: 2, borderRadius: 1,
    background: 'linear-gradient(to bottom, #0ecb81, #f6465d)',
    flexShrink: 0,
  },
  pairRows: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  pairRow: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: '#131c2b', borderRadius: 4, padding: '4px 6px',
    border: '1px solid',
  },
  bracketDot: {
    width: 5, height: 5, borderRadius: '50%',
    background: '#2a3550', flexShrink: 0,
  },

  // single entry row (no exit)
  singleRow: { display: 'flex', alignItems: 'center', gap: 6 },

  sideBadge: {
    borderRadius: 3, fontSize: '0.65rem', fontWeight: 700,
    padding: '1px 5px', flexShrink: 0,
  },
  priceText: {
    color: '#c0c8d8', fontSize: '0.77rem',
    fontFamily: '"SF Mono", Consolas, monospace', flex: 1,
  },
  detailText: {
    color: '#6b7a90', fontSize: '0.70rem',
    fontFamily: '"SF Mono", Consolas, monospace', flexShrink: 0,
  },
  errorMsg: { color: '#f6465d', fontSize: '0.68rem', wordBreak: 'break-all' as const },
};
