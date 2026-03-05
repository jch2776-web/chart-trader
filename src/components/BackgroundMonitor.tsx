import { useRef, useCallback } from 'react';
import type { Candle } from '../types/candle';
import type { Drawing, TrendlineDrawing, BoxDrawing, HlineDrawing } from '../types/drawing';
import type { TradeSettings, TelegramSettings, ActivityLog } from '../types/trade';
import { useBinanceWS } from '../hooks/useBinanceWS';
import {
  checkTrendlineBreakout,
  checkBoxBreakout,
  getBoxState,
  checkHlineBreakout,
  getHlineState,
} from '../utils/breakoutDetector';
import type { BoxState, HlineState } from '../utils/breakoutDetector';
import { formatPrice } from '../utils/priceFormat';

interface Props {
  ticker: string;
  drawings: Drawing[];
  tradeSettings: TradeSettings;
  telegramSettings: TelegramSettings;
  onAddLog: (type: ActivityLog['type'], message: string) => void;
}

/**
 * Invisible component that monitors a single ticker in the background.
 * Renders null — only runs WebSocket breakout detection logic.
 * One instance per non-viewed active ticker.
 */
export function BackgroundMonitor({
  ticker,
  drawings,
  tradeSettings,
  telegramSettings,
  onAddLog,
}: Props) {
  const triggeredRef    = useRef<Set<string>>(new Set());
  const boxStatesRef    = useRef<Record<string, BoxState>>({});
  const hlineStatesRef  = useRef<Record<string, HlineState>>({});
  const isInitializedRef = useRef(false);

  // Keep props current via refs (WS callback reads from refs)
  const drawingsRef      = useRef(drawings);
  drawingsRef.current    = drawings;
  const tradeRef         = useRef(tradeSettings);
  tradeRef.current       = tradeSettings;
  const telegramRef      = useRef(telegramSettings);
  telegramRef.current    = telegramSettings;
  const addLogRef        = useRef(onAddLog);
  addLogRef.current      = onAddLog;
  const tickerRef        = useRef(ticker);
  tickerRef.current      = ticker;

  // Reset state when ticker changes (key prop handles remount, but be safe)
  const prevTickerRef = useRef(ticker);
  if (prevTickerRef.current !== ticker) {
    prevTickerRef.current    = ticker;
    triggeredRef.current     = new Set();
    boxStatesRef.current     = {};
    hlineStatesRef.current   = {};
    isInitializedRef.current = false;
  }

  useBinanceWS(ticker, '1m', useCallback((candle: Candle) => {
    const ts = tradeRef.current;
    if (!ts.active) return;
    const drs = drawingsRef.current;
    if (drs.length === 0) return;

    const direction = ts.direction;
    const price = candle.close;
    const time  = candle.time;
    const sym   = tickerRef.current;

    // ── Silent init: first tick after attach records state, no alerts ──
    if (!isInitializedRef.current) {
      drs.filter(d => d.type === 'box' && d.active !== false).forEach(d => {
        boxStatesRef.current[(d as BoxDrawing).id] = getBoxState(d as BoxDrawing, price);
      });
      drs.filter(d => d.type === 'hline' && d.active !== false).forEach(d => {
        hlineStatesRef.current[(d as HlineDrawing).id] = getHlineState(d as HlineDrawing, price);
      });
      drs.filter(d => d.type === 'trendline' && d.active !== false).forEach(d => {
        const sig = checkTrendlineBreakout(d as TrendlineDrawing, [], direction, price, time);
        if (sig) triggeredRef.current.add(`tl-${sig.drawingId}-${sig.direction}-${candle.time}`);
      });
      isInitializedRef.current = true;
      return;
    }

    // ── Trendline breakout ─────────────────────────────────────────────
    drs.filter(d => d.type === 'trendline' && d.active !== false).forEach(d => {
      const sig = checkTrendlineBreakout(d as TrendlineDrawing, [], direction, price, time);
      if (!sig) return;
      const key = `tl-${sig.drawingId}-${sig.direction}-${candle.time}`;
      if (triggeredRef.current.has(key)) return;
      triggeredRef.current.add(key);
      fireSignal(sig.drawingId, sig.direction, sig.type, 'breakout', sig.price, candle.time, sym);
    });

    // ── Box breakout ───────────────────────────────────────────────────
    drs.filter(d => d.type === 'box' && d.active !== false).forEach(d => {
      const box = d as BoxDrawing;
      const prevState = boxStatesRef.current[box.id] ?? null;
      const sigs = checkBoxBreakout(box, direction, price, time, prevState);
      boxStatesRef.current[box.id] = getBoxState(box, price);
      sigs.forEach(sig => {
        fireSignal(sig.drawingId, sig.direction, sig.type, sig.subtype, sig.price, candle.time, sym);
      });
    });

    // ── Hline breakout ─────────────────────────────────────────────────
    drs.filter(d => d.type === 'hline' && d.active !== false).forEach(d => {
      const hline = d as HlineDrawing;
      const prevState = hlineStatesRef.current[hline.id] ?? null;
      const sigs = checkHlineBreakout(hline, direction, price, time, prevState);
      hlineStatesRef.current[hline.id] = getHlineState(hline, price);
      sigs.forEach(sig => {
        fireSignal(sig.drawingId, sig.direction, sig.type, sig.subtype, sig.price, candle.time, sym);
      });
    });

    function fireSignal(
      drawingId: string,
      dir: 'long' | 'short',
      type: 'trendline' | 'box' | 'hline',
      subtype: 'breakout' | 'entry',
      sigPrice: number,
      klineTime: number,
      sym: string,
    ) {
      const ts = tradeRef.current;
      const drawing = drawingsRef.current.find(d => d.id === drawingId);
      const drawingIdx = drawingsRef.current.findIndex(d => d.id === drawingId);
      const num = drawingIdx >= 0 ? `#${drawingIdx + 1}` : '';

      let drawingLabel = '';
      if (drawing?.type === 'trendline') {
        const tl = drawing as TrendlineDrawing;
        drawingLabel = `추세선${num} (${formatPrice(tl.p1.price)}→${formatPrice(tl.p2.price)})`;
      } else if (drawing?.type === 'box') {
        const bx = drawing as BoxDrawing;
        drawingLabel = `박스${num} (${formatPrice(bx.bottomPrice)}~${formatPrice(bx.topPrice)})`;
      } else if (drawing?.type === 'hline') {
        const hl = drawing as HlineDrawing;
        drawingLabel = `수평선${num} (${formatPrice(hl.price)})`;
      } else {
        drawingLabel = type === 'trendline' ? `추세선${num}` : type === 'box' ? `박스${num}` : `수평선${num}`;
      }

      const actionLabel = subtype === 'entry'
        ? `${dir === 'long' ? '▲' : '▼'} 박스권 진입`
        : `${dir === 'long' ? '▲ 롱' : '▼ 숏'} 돌파`;

      const logMsg = `[${sym}] ${drawingLabel} ${actionLabel} @ ${sigPrice.toFixed(2)}`;
      addLogRef.current('signal', logMsg);

      const tg = telegramRef.current;
      if (tg.enabled && tg.botToken && tg.chatId) {
        // Check time-based cooldown
        const cooldown = ts.telegramCooldownMs ?? 0;
        if (cooldown > 0 && Date.now() - klineTime > cooldown) return;
        fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tg.chatId, text: logMsg }),
        }).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  return null;
}
