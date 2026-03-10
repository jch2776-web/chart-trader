import { useState, useEffect, useRef, useCallback } from 'react';
import type { FuturesPosition, FuturesOrder, LiveHistoryEntry, FuturesUserTrade } from '../types/futures';

const BASE = 'https://fapi.binance.com';

// ── Client-side SL (앱 감시 손절) ─────────────────────────────────────────────
const CLIENT_SL_KEY = 'chart_trader_client_sl';

export interface ClientSL {
  price: number;
  closeSide: 'BUY' | 'SELL';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
}
export type ClientSlMap = Record<string, ClientSL>; // key: `${symbol}_${positionSide}`

export interface PlacedTPSLOrderRef {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  kind: 'TP' | 'SL';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
}

export interface PlaceTPSLOptions {
  onPlacedOrders?: (orders: PlacedTPSLOrderRef[]) => void;
}

function loadClientSlMap(): ClientSlMap {
  try { return JSON.parse(localStorage.getItem(CLIENT_SL_KEY) ?? '{}'); } catch { return {}; }
}
function saveClientSlMap(m: ClientSlMap) {
  try { localStorage.setItem(CLIENT_SL_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

// ── Pure-JS SHA-256 + HMAC-SHA256 ────────────────────────────────────────────
// Works in any context (HTTP, IP addresses) — no crypto.subtle required.
const SHA256_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

function rotr32(x: number, n: number): number { return (x >>> n) | (x << (32 - n)); }

function sha256(data: Uint8Array): Uint8Array<ArrayBuffer> {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const len = data.length;
  const bitLen = len * 8;
  // Padding
  const padLen = ((len + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  const w = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i-15], 7) ^ rotr32(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = rotr32(w[i-2], 17) ^ rotr32(w[i-2], 19)  ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1  = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch  = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0  = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v, i) => ov.setUint32(i*4, v, false));
  return out;
}

function hmacSha256(secretStr: string, messageStr: string): string {
  const enc = new TextEncoder();
  let key = enc.encode(secretStr);
  if (key.length > 64) key = sha256(key);
  const msg = enc.encode(messageStr);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = (key[i] ?? 0) ^ 0x36; opad[i] = (key[i] ?? 0) ^ 0x5c; }
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipad);
  inner.set(msg, 64);
  const outer = new Uint8Array(96);
  outer.set(opad);
  outer.set(sha256(inner), 64);
  return Array.from(sha256(outer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSigned<T>(
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string | number> = {},
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
): Promise<T> {
  const query = new URLSearchParams(
    Object.fromEntries(
      [...Object.entries(params).map(([k, v]) => [k, String(v)]),
       ['timestamp', String(Date.now())]],
    ),
  );
  const sig = hmacSha256(apiSecret, query.toString());
  query.set('signature', sig);
  const res = await fetch(`${BASE}${path}?${query}`, {
    method,
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `Binance API ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.code !== undefined) msg = `[${json.code}] ${json.msg ?? msg}`;
      else if (json.msg) msg = json.msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const text = await res.text();
  // orderId/algoId는 JS Number 범위(2^53-1)를 초과할 수 있어 문자열로 보존
  const safeText = text
    .replace(/"orderId"\s*:\s*(\d+)/g, '"orderId":"$1"')
    .replace(/"algoId"\s*:\s*(\d+)/g, '"algoId":"$1"');
  return JSON.parse(safeText) as T;
}

// ── Position mode check (cached 5 min) ───────────────────────────────────────
const _positionModeCache: Record<string, { isDual: boolean; expiry: number }> = {};

/**
 * Returns true if the Binance Futures account is in Hedge Mode (dualSidePosition=true),
 * false for One-way Mode. Result is cached for 5 minutes per API key.
 */
export async function getPositionMode(apiKey: string, apiSecret: string): Promise<boolean> {
  const cacheKey = apiKey.slice(-8);
  const cached = _positionModeCache[cacheKey];
  if (cached && Date.now() < cached.expiry) return cached.isDual;
  const res = await fetchSigned<{ dualSidePosition: boolean }>(
    '/fapi/v1/positionSide/dual', apiKey, apiSecret,
  );
  _positionModeCache[cacheKey] = { isDual: res.dualSidePosition, expiry: Date.now() + 5 * 60 * 1000 };
  return res.dualSidePosition;
}

// ── Symbol precision info (cached, no auth required) ─────────────────────────
const _infoCache: Record<string, { tickSize: number; stepSize: number }> = {};

/** Returns null if the symbol info cannot be reliably fetched.
 *  Failures are NOT cached so the next call will retry. */
async function fetchSymbolInfo(symbol: string): Promise<{ tickSize: number; stepSize: number } | null> {
  if (_infoCache[symbol]) return _infoCache[symbol];
  try {
    const res = await fetch(`${BASE}/fapi/v1/exchangeInfo?symbol=${symbol}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // Use find() to guarantee exact symbol match (API may return multiple contracts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sym = (data.symbols as any[])?.find((s: any) => s.symbol === symbol);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pf = sym?.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ls = sym?.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
    const tickSize = parseFloat(pf?.tickSize ?? '0');
    const stepSize = parseFloat(ls?.stepSize ?? '0');
    if (tickSize <= 0 || stepSize <= 0) return null;   // invalid — don't cache
    const info = { tickSize, stepSize };
    _infoCache[symbol] = info;
    return info;
  } catch {
    return null;   // network/parse failure — don't cache, caller will throw a user-friendly error
  }
}

/** Floor a value to the nearest step and return as a decimal string (no trailing noise).
 *  Uses string-based decimal counting (more reliable than Math.log10 for floating-point steps). */
function floorToStep(value: number, step: number): string {
  if (step <= 0) return String(value);
  // step.toFixed(10) gives a canonical decimal string free of scientific notation
  const stepStr = step.toFixed(10).replace(/\.?0+$/, '');
  const dotIdx = stepStr.indexOf('.');
  const decimals = dotIdx >= 0 ? stepStr.length - dotIdx - 1 : 0;
  const factor = Math.pow(10, decimals);
  // +1e-9 guards against floating-point underflow (e.g. 24.5718 * 1000 → 24571.7999…)
  return (Math.floor(value * factor + 1e-9) / factor).toFixed(decimals);
}

// ── Entry time from trade history ─────────────────────────────────────────────
// Walks userTrades (oldest→newest) backwards to find when the current net
// position was established.  Handles both One-way (BOTH) and Hedge mode.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findEntryTime(trades: any[], positionAmt: number, positionSide: string): number | undefined {
  // In hedge mode filter by positionSide; in one-way mode use all trades
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relevant: any[] = positionSide === 'BOTH'
    ? trades
    : trades.filter(t => t.positionSide === positionSide);

  // Opening side: BUY opens LONG, SELL opens SHORT
  const openSide = positionAmt > 0 ? 'BUY' : 'SELL';
  const closeSide = positionAmt > 0 ? 'SELL' : 'BUY';

  // Walk newest → oldest, accumulating how much of the current position
  // each opening trade contributed.  Closing trades "un-reduce" the target.
  let remaining = Math.abs(positionAmt);
  let entryTime: number | undefined;

  for (let i = relevant.length - 1; i >= 0 && remaining > 1e-10; i--) {
    const t = relevant[i];
    const qty = parseFloat(t.qty);
    if (t.side === openSide) {
      remaining -= qty;
      entryTime = t.time as number;   // keep updating → ends up at oldest opening trade
    } else if (t.side === closeSide) {
      remaining += qty;               // position was larger before this close
    }
  }
  return entryTime;
}
// ─────────────────────────────────────────────────────────────────────────────

export function useBinanceFutures(apiKey: string, apiSecret: string, ticker: string) {
  const [positions, setPositions]         = useState<FuturesPosition[]>([]);
  const [orders, setOrders]               = useState<FuturesOrder[]>([]);
  const [allPositions, setAllPositions]   = useState<FuturesPosition[]>([]);
  const [allOrders, setAllOrders]         = useState<FuturesOrder[]>([]);
  const [balance, setBalance]             = useState<number>(0);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  // Client-side SL 상태 (localStorage 연동)
  const [clientSlMap, setClientSlMapState] = useState<ClientSlMap>(loadClientSlMap);
  const clientSlMapRef     = useRef<ClientSlMap>(clientSlMap);
  const clientSlTriggering = useRef(new Set<string>()); // 현재 실행 중인 SL 키
  clientSlMapRef.current   = clientSlMap;

  const setClientSL = useCallback((
    symbol: string,
    positionSide: 'LONG' | 'SHORT' | 'BOTH',
    slPrice: number,
    closeSide: 'BUY' | 'SELL',
  ) => {
    const key  = `${symbol}_${positionSide}`;
    const next = { ...clientSlMapRef.current, [key]: { price: slPrice, closeSide, positionSide } };
    saveClientSlMap(next);
    setClientSlMapState(next);
  }, []);

  const removeClientSL = useCallback((symbol: string, positionSide: 'LONG' | 'SHORT' | 'BOTH') => {
    const key  = `${symbol}_${positionSide}`;
    const next = { ...clientSlMapRef.current };
    delete next[key];
    saveClientSlMap(next);
    setClientSlMapState(next);
  }, []);

  // Refs to avoid stale closures in the interval callback
  const apiKeyRef       = useRef(apiKey);
  const apiSecretRef    = useRef(apiSecret);
  const tickerRef       = useRef(ticker);
  const firstFetchDone  = useRef(false);
  apiKeyRef.current    = apiKey;
  apiSecretRef.current = apiSecret;
  tickerRef.current    = ticker;

  const fetchData = useCallback(async () => {
    if (!apiKeyRef.current || !apiSecretRef.current) return;
    const isFirst = !firstFetchDone.current;
    try {
      // Only show loading spinner on the very first fetch to avoid layout flicker
      if (isFirst) setLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [posRes, ordRes, algoOrdRes, tradeRes, balRes, allPosRes, allOrdRes, allAlgoOrdRes] = (await Promise.all([
        fetchSigned('/fapi/v2/positionRisk', apiKeyRef.current, apiSecretRef.current, { symbol: tickerRef.current }),
        fetchSigned('/fapi/v1/openOrders',   apiKeyRef.current, apiSecretRef.current, { symbol: tickerRef.current }),
        // 조건부(Algo) 주문은 별도 엔드포인트에서 조회 (현재 심볼)
        fetchSigned('/fapi/v1/openAlgoOrders', apiKeyRef.current, apiSecretRef.current, { symbol: tickerRef.current }),
        // 최근 500건 거래 내역으로 실제 진입 시각 계산
        fetchSigned('/fapi/v1/userTrades',   apiKeyRef.current, apiSecretRef.current, { symbol: tickerRef.current, limit: 500 }),
        // USDT 가용 잔고
        fetchSigned('/fapi/v2/balance',      apiKeyRef.current, apiSecretRef.current),
        // 전체 포지션 (심볼 필터 없이)
        fetchSigned('/fapi/v2/positionRisk', apiKeyRef.current, apiSecretRef.current),
        // 전체 미체결 주문 (심볼 필터 없이)
        fetchSigned('/fapi/v1/openOrders',   apiKeyRef.current, apiSecretRef.current),
        // 전체 심볼 Algo 주문 (심볼 필터 없이) — TP/SL이 다른 심볼에 걸려있을 때도 표시
        fetchSigned('/fapi/v1/openAlgoOrders', apiKeyRef.current, apiSecretRef.current).catch(() => []),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ])) as any[];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: FuturesPosition[] = posRes
        .filter((p: any) => parseFloat(p.positionAmt) !== 0)
        .map((p: any) => {
          const positionAmt = parseFloat(p.positionAmt);
          const positionSide = p.positionSide as 'LONG' | 'SHORT' | 'BOTH';
          return {
            symbol:           p.symbol,
            positionSide,
            positionAmt,
            entryPrice:       parseFloat(p.entryPrice),
            markPrice:        parseFloat(p.markPrice),
            unrealizedProfit: parseFloat(p.unRealizedProfit ?? p.unrealizedProfit ?? '0'),
            leverage:         parseFloat(p.leverage),
            liquidationPrice: parseFloat(p.liquidationPrice),
            marginType:       p.marginType as 'isolated' | 'cross',
            updateTime:       typeof p.updateTime === 'number' ? p.updateTime : undefined,
            entryTime:        findEntryTime(tradeRes, positionAmt, positionSide),
          };
        });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedOrders: FuturesOrder[] = ordRes.map((o: any) => ({
        symbol:    o.symbol,
        orderId:   o.orderId,
        side:      o.side as 'BUY' | 'SELL',
        type:      o.type,
        price:     parseFloat(o.price),
        origQty:   parseFloat(o.origQty),
        stopPrice: parseFloat(o.stopPrice),
        status:    o.status,
        time:      typeof o.time === 'number' ? o.time : undefined,
        positionSide: (o.positionSide as 'LONG' | 'SHORT' | 'BOTH' | undefined) ?? undefined,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedAlgoOrders: FuturesOrder[] = algoOrdRes.map((o: any) => ({
        symbol:    o.symbol,
        orderId:   String(o.algoId),
        side:      o.side as 'BUY' | 'SELL',
        type:      o.orderType ?? o.type,
        price:     parseFloat(o.price ?? '0'),
        origQty:   parseFloat(o.totalQty ?? o.origQty ?? o.quantity ?? '0'),
        stopPrice: parseFloat(o.triggerPrice ?? o.stopPrice ?? '0'),
        status:    o.algoStatus ?? o.status ?? 'NEW',
        algoType:  o.algoType ?? 'CONDITIONAL',
        isAlgo:    true,
        time:      typeof o.createTime === 'number'
          ? o.createTime
          : (typeof o.bookTime === 'number' ? o.bookTime : (typeof o.time === 'number' ? o.time : undefined)),
        positionSide: (o.positionSide as 'LONG' | 'SHORT' | 'BOTH' | undefined) ?? undefined,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usdtBal = (balRes as any[]).find((b: any) => b.asset === 'USDT');
      setBalance(usdtBal ? parseFloat(usdtBal.availableBalance ?? '0') : 0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedAllPositions: FuturesPosition[] = allPosRes
        .filter((p: any) => parseFloat(p.positionAmt) !== 0)
        .map((p: any) => ({
          symbol:           p.symbol,
          positionSide:     p.positionSide as 'LONG' | 'SHORT' | 'BOTH',
          positionAmt:      parseFloat(p.positionAmt),
          entryPrice:       parseFloat(p.entryPrice),
          markPrice:        parseFloat(p.markPrice),
          unrealizedProfit: parseFloat(p.unRealizedProfit ?? p.unrealizedProfit ?? '0'),
          leverage:         parseFloat(p.leverage),
          liquidationPrice: parseFloat(p.liquidationPrice),
          marginType:       p.marginType as 'isolated' | 'cross',
          updateTime:       typeof p.updateTime === 'number' ? p.updateTime : undefined,
        }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedAllOrders: FuturesOrder[] = allOrdRes.map((o: any) => ({
        symbol:    o.symbol,
        orderId:   o.orderId,
        side:      o.side as 'BUY' | 'SELL',
        type:      o.type,
        price:     parseFloat(o.price),
        origQty:   parseFloat(o.origQty),
        stopPrice: parseFloat(o.stopPrice),
        status:    o.status,
        time:      typeof o.time === 'number' ? o.time : undefined,
        positionSide: (o.positionSide as 'LONG' | 'SHORT' | 'BOTH' | undefined) ?? undefined,
      }));
      // 전체 심볼 Algo 주문 — symbol 파라미터 없이 조회하면 모든 심볼 반환
      // 응답이 배열이 아닌 경우(계정 미지원 등) 빈 배열로 폴백
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allAlgoRaw: any[] = Array.isArray(allAlgoOrdRes) ? allAlgoOrdRes : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedAllAlgoOrders: FuturesOrder[] = allAlgoRaw.map((o: any) => ({
        symbol:    o.symbol,
        orderId:   String(o.algoId),
        side:      o.side as 'BUY' | 'SELL',
        type:      o.orderType ?? o.type,
        price:     parseFloat(o.price ?? '0'),
        origQty:   parseFloat(o.totalQty ?? o.origQty ?? o.quantity ?? '0'),
        stopPrice: parseFloat(o.triggerPrice ?? o.stopPrice ?? '0'),
        status:    o.algoStatus ?? o.status ?? 'NEW',
        algoType:  o.algoType ?? 'CONDITIONAL',
        isAlgo:    true,
        time:      typeof o.createTime === 'number'
          ? o.createTime
          : (typeof o.bookTime === 'number' ? o.bookTime : (typeof o.time === 'number' ? o.time : undefined)),
        positionSide: (o.positionSide as 'LONG' | 'SHORT' | 'BOTH' | undefined) ?? undefined,
      }));

      setPositions(mapped);
      setOrders([...mappedOrders, ...mappedAlgoOrders]);
      setAllPositions(mappedAllPositions);
      // allOrders에는 전심볼 일반 주문 + 전심볼 Algo 주문을 함께 노출 (중복 제거: algoId 기준)
      const algoIdSet = new Set(mappedAllAlgoOrders.map(o => o.orderId));
      const filteredAlgoPerTicker = mappedAlgoOrders.filter(o => !algoIdSet.has(o.orderId));
      setAllOrders([...mappedAllOrders, ...mappedAllAlgoOrders, ...filteredAlgoPerTicker]);
      setError(null);
      firstFetchDone.current = true;

      // ── Client-side SL 감시 ──────────────────────────────────────────────────
      // 1) 포지션이 없어진 심볼의 SL 자동 제거
      // 2) markPrice가 SL 조건을 충족하면 MARKET 청산 주문 실행
      const slMap = clientSlMapRef.current;
      const activePosKeys = new Set(mappedAllPositions.map(p => `${p.symbol}_${p.positionSide}`));
      for (const key of Object.keys(slMap)) {
        if (!activePosKeys.has(key)) {
          // 포지션이 없어짐 → SL 자동 삭제
          const next = { ...clientSlMapRef.current };
          delete next[key];
          saveClientSlMap(next);
          setClientSlMapState(next);
          clientSlTriggering.current.delete(key);
        }
      }
      for (const pos of mappedAllPositions) {
        const key = `${pos.symbol}_${pos.positionSide}`;
        const sl  = clientSlMapRef.current[key];
        if (!sl || clientSlTriggering.current.has(key)) continue;
        const isLong    = pos.positionAmt > 0;
        const triggered = isLong ? pos.markPrice <= sl.price : pos.markPrice >= sl.price;
        if (!triggered) continue;

        // SL 트리거됨 → MARKET 청산
        clientSlTriggering.current.add(key);
        const snapKey     = key;
        const snapSymbol  = pos.symbol;
        const snapPosSide = pos.positionSide;
        const snapClose   = sl.closeSide;
        const snapQty     = Math.abs(pos.positionAmt);
        fetchSymbolInfo(snapSymbol).then(info => {
          if (!info) throw new Error('no info');
          const qtyStr  = floorToStep(snapQty, info.stepSize);
          const isHedge = snapPosSide !== 'BOTH';
          return fetchSigned('/fapi/v1/order', apiKeyRef.current, apiSecretRef.current, {
            symbol:     snapSymbol,
            side:       snapClose,
            type:       'MARKET',
            quantity:   qtyStr,
            recvWindow: 10000,
            ...(isHedge ? { positionSide: snapPosSide } : { reduceOnly: 'true' }),
          }, 'POST');
        }).then(() => {
          const next = { ...clientSlMapRef.current };
          delete next[snapKey];
          saveClientSlMap(next);
          setClientSlMapState(next);
          clientSlTriggering.current.delete(snapKey);
        }).catch(() => {
          clientSlTriggering.current.delete(snapKey); // 다음 tick에 재시도
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      if (isFirst) setLoading(false);
    }
  }, []);

  useEffect(() => {
    firstFetchDone.current = false;
    if (!apiKey || !apiSecret) {
      setPositions([]);
      setOrders([]);
      setError(null);
      return;
    }
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [apiKey, apiSecret, ticker, fetchData]);

  // ── Place a LIMIT order ──────────────────────────────────────────────────────
  const placeOrder = useCallback(async (
    side: 'BUY' | 'SELL',
    price: number,
    quantity: number,
    leverage: number,
    marginType: 'CROSSED' | 'ISOLATED',
    reduceOnly = false,
    symbolOverride?: string,
    timeInForce: 'GTC' | 'IOC' | 'FOK' = 'GTC',
  ): Promise<void> => {
    const key = apiKeyRef.current;
    const secret = apiSecretRef.current;
    const sym = symbolOverride ?? tickerRef.current;
    if (!key || !secret) throw new Error('API 키가 설정되지 않았습니다');

    if (!reduceOnly) {
      // 1. Set leverage (best-effort — Binance rejects if a position already exists
      //    and the requested leverage is lower than the current position's leverage)
      try {
        await fetchSigned('/fapi/v1/leverage', key, secret, { symbol: sym, leverage, recvWindow: 10000 }, 'POST');
      } catch { /* proceed with the exchange's current leverage setting */ }

      // 2. Set margin type (best-effort — Binance rejects changes while a position is open,
      //    error -4046 "No need to change", -4048 "Cannot change with open position", etc.)
      try {
        await fetchSigned('/fapi/v1/marginType', key, secret, { symbol: sym, marginType, recvWindow: 10000 }, 'POST');
      } catch { /* proceed with the exchange's current margin type */ }
    }

    // 3. Fetch precision info and round price/quantity to valid steps
    const info = await fetchSymbolInfo(sym);
    if (!info) throw new Error(`${sym} 호가 단위를 조회할 수 없습니다. 잠시 후 다시 시도하세요.`);

    const qtyStr = floorToStep(quantity, info.stepSize);
    if (parseFloat(qtyStr) <= 0) {
      throw new Error('주문 수량이 최소 단위 미만입니다. 마진 또는 레버리지를 높이세요.');
    }

    // Round price to tickSize, but if result is 0 (price < tickSize) use raw significant figures
    // instead of blocking the order — the exchange will return the authoritative precision error.
    let priceStr = floorToStep(price, info.tickSize);
    if (parseFloat(priceStr) <= 0) {
      // tickSize may be stale/misconfigured for this symbol; send with 8 sig-figs and let Binance decide
      const rawDecimals = Math.min(8, (String(price).split('.')[1] ?? '').length);
      priceStr = price.toFixed(rawDecimals);
    }

    // 4. Place order
    await fetchSigned('/fapi/v1/order', key, secret, {
      symbol: sym, side,
      type: 'LIMIT', timeInForce,
      quantity: qtyStr,
      price: priceStr,
      ...(reduceOnly ? { reduceOnly: 'true' } : {}),
      recvWindow: 10000,
    }, 'POST');

    // 4. Refresh — short delay so the exchange has time to register the order
    await new Promise(resolve => setTimeout(resolve, 600));
    await fetchData();
  }, [fetchData]);

  // ── Cancel an order ──────────────────────────────────────────────────────────
  const cancelOrder = useCallback(async (orderId: string, symbol?: string): Promise<void> => {
    const key = apiKeyRef.current;
    const secret = apiSecretRef.current;
    const sym = symbol ?? tickerRef.current;
    if (!key || !secret) throw new Error('API 키가 설정되지 않았습니다');
    try {
      await fetchSigned('/fapi/v1/order', key, secret, { symbol: sym, orderId, recvWindow: 10000 }, 'DELETE');
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      const unknownOrder = msg.includes('-2011') || msg.includes('unknown order');
      if (!unknownOrder) throw e;
      // 일반 주문이 아니면 Algo 주문 취소로 재시도
      await fetchSigned('/fapi/v1/algoOrder', key, secret, {
        symbol: sym,
        algoId: orderId,
        algoType: 'CONDITIONAL',
        recvWindow: 10000,
      }, 'DELETE');
    }
    await new Promise(resolve => setTimeout(resolve, 400));
    await fetchData();
  }, [fetchData]);

  // ── Close position with MARKET order (reduceOnly) ────────────────────────────
  const closeMarket = useCallback(async (
    symbol: string,
    closeSide: 'BUY' | 'SELL',
    qty: number,
    positionSide: 'LONG' | 'SHORT' | 'BOTH' = 'BOTH',
  ): Promise<void> => {
    const key = apiKeyRef.current;
    const secret = apiSecretRef.current;
    if (!key || !secret) throw new Error('API 키가 설정되지 않았습니다');
    const info = await fetchSymbolInfo(symbol);
    if (!info) throw new Error(`${symbol} 호가 단위를 조회할 수 없습니다`);
    const qtyStr = floorToStep(qty, info.stepSize);
    const isHedge = positionSide !== 'BOTH';
    await fetchSigned('/fapi/v1/order', key, secret, {
      symbol, side: closeSide, type: 'MARKET', quantity: qtyStr, recvWindow: 10000,
      ...(isHedge ? { positionSide } : { reduceOnly: 'true' }),
    }, 'POST');
    await new Promise(r => setTimeout(r, 600));
    await fetchData();
  }, [fetchData]);

  // ── Place TP/SL orders ────────────────────────────────────────────────────────
  const placeTPSL = useCallback(async (
    symbol: string,
    closeSide: 'BUY' | 'SELL',
    qty: number,
    tpPrice?: number,
    slPrice?: number,
    positionSide: 'LONG' | 'SHORT' | 'BOTH' = 'BOTH',
    options?: PlaceTPSLOptions,
  ): Promise<void> => {
    const key = apiKeyRef.current;
    const secret = apiSecretRef.current;
    if (!key || !secret) throw new Error('API 키가 설정되지 않았습니다');
    const info = await fetchSymbolInfo(symbol);
    if (!info) throw new Error(`${symbol} 호가 단위를 조회할 수 없습니다`);
    const qtyStr = floorToStep(qty, info.stepSize);

    // Hedge Mode(positionSide=LONG/SHORT)에서는 reduceOnly 대신 positionSide 사용
    const isHedge = positionSide !== 'BOTH';
    const closingParams = {
      symbol,
      side: closeSide,
      quantity: qtyStr,
      recvWindow: 10000,
      ...(isHedge ? { positionSide } : { reduceOnly: 'true' }),
    };
    const placedRefs: PlacedTPSLOrderRef[] = [];
    const pushPlaced = (raw: unknown, kind: 'TP' | 'SL') => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj: any = raw as any;
      const idRaw = obj?.orderId ?? obj?.algoId;
      if (idRaw == null) return;
      placedRefs.push({
        orderId: String(idRaw),
        symbol,
        side: closeSide,
        kind,
        positionSide,
      });
    };

    // -4120 "STOP_ORDER_SWITCH_ALGO" 에러 판별
    const isSwitchToAlgoErr = (e: unknown) => {
      const msg = e instanceof Error ? e.message : '';
      return msg.includes('-4120') || msg.includes('STOP_ORDER_SWITCH_ALGO');
    };

    // 기존 /fapi/v1/order 조건부 주문 시도:
    // 성공 시 true, -4120 전환 에러 시 false, 그 외 에러는 throw
    const tryOrder = async (params: Record<string, string | number>): Promise<unknown | null> => {
      try {
        return await fetchSigned('/fapi/v1/order', key, secret, params, 'POST');
      } catch (e) {
        if (!isSwitchToAlgoErr(e)) throw e;
        return null;
      }
    };

    // ── 익절가(TP) 주문 ────────────────────────────────────────────────────────
    // 조건부 주문 실패 시 → 일반 LIMIT 주문으로 fallback
    // (LONG TP: 현재가 위에 resting SELL, SHORT TP: 현재가 아래에 resting BUY → TP와 동일 효과)
    const placeTP = async (priceStr: string): Promise<void> => {
      const direct1 = await tryOrder({ ...closingParams, type: 'TAKE_PROFIT_MARKET', stopPrice: priceStr });
      if (direct1) { pushPlaced(direct1, 'TP'); return; }
      const direct2 = await tryOrder({ ...closingParams, type: 'TAKE_PROFIT', stopPrice: priceStr, price: priceStr, timeInForce: 'GTC' });
      if (direct2) { pushPlaced(direct2, 'TP'); return; }
      const direct3 = await tryOrder({ ...closingParams, type: 'TAKE_PROFIT_MARKET', stopPrice: priceStr, workingType: 'MARK_PRICE' });
      if (direct3) { pushPlaced(direct3, 'TP'); return; }
      // 신규 정책(-4120) 계정: Algo 조건부 주문으로 재시도
      try {
        const algo = await fetchSigned('/fapi/v1/algoOrder', key, secret, {
          ...closingParams,
          algoType: 'CONDITIONAL',
          type: 'TAKE_PROFIT_MARKET',
          triggerPrice: priceStr,
        }, 'POST');
        pushPlaced(algo, 'TP');
      } catch {
        // 최후 수단: 일반 LIMIT 주문 (익절가에 GTC 청산 주문)
        const limit = await fetchSigned('/fapi/v1/order', key, secret, {
          ...closingParams, type: 'LIMIT', price: priceStr, timeInForce: 'GTC',
        }, 'POST');
        pushPlaced(limit, 'TP');
      }
    };

    // ── 손절가(SL) 주문 ────────────────────────────────────────────────────────
    // 조건부 주문 실패 시: Algo 주문 재시도 → 마지막으로 앱 감시 SL fallback
    const placeSL = async (priceStr: string): Promise<void> => {
      const direct1 = await tryOrder({ ...closingParams, type: 'STOP_MARKET', stopPrice: priceStr });
      if (direct1) { pushPlaced(direct1, 'SL'); return; }
      const direct2 = await tryOrder({ ...closingParams, type: 'STOP', stopPrice: priceStr, price: priceStr, timeInForce: 'GTC' });
      if (direct2) { pushPlaced(direct2, 'SL'); return; }
      const direct3 = await tryOrder({ ...closingParams, type: 'STOP_MARKET', stopPrice: priceStr, workingType: 'MARK_PRICE' });
      if (direct3) { pushPlaced(direct3, 'SL'); return; }
      try {
        const algo = await fetchSigned('/fapi/v1/algoOrder', key, secret, {
          ...closingParams,
          algoType: 'CONDITIONAL',
          type: 'STOP_MARKET',
          triggerPrice: priceStr,
        }, 'POST');
        pushPlaced(algo, 'SL');
      } catch {
        // Algo 주문도 실패하면 앱 감시 SL로 저장
        setClientSL(symbol, positionSide, parseFloat(priceStr), closeSide);
      }
    };

    const promises: Promise<void>[] = [];
    if (tpPrice && tpPrice > 0) promises.push(placeTP(floorToStep(tpPrice, info.tickSize)));
    if (slPrice && slPrice > 0) {
      promises.push(placeSL(floorToStep(slPrice, info.tickSize)));
    } else {
      // SL 입력이 비어있으면 기존 앱 감시 SL 제거
      removeClientSL(symbol, positionSide);
    }
    await Promise.all(promises);
    options?.onPlacedOrders?.(placedRefs);
    await new Promise(resolve => setTimeout(resolve, 600));
    await fetchData();
  }, [fetchData]);

  const fetchUserTrades = useCallback(async (
    symbol: string,
    startTime?: number,
    endTime?: number,
    limit = 1000,
  ): Promise<FuturesUserTrade[]> => {
    const key = apiKeyRef.current;
    const secret = apiSecretRef.current;
    if (!key || !secret) throw new Error('API 키가 설정되지 않았습니다');
    const params: Record<string, string | number> = { symbol, limit: Math.min(Math.max(limit, 1), 1000) };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchSigned<any[]>('/fapi/v1/userTrades', key, secret, params);
    return rows.map((t) => ({
      id: String(t.id ?? t.tradeId ?? ''),
      symbol: t.symbol,
      side: t.side as 'BUY' | 'SELL',
      price: parseFloat(t.price ?? '0'),
      qty: parseFloat(t.qty ?? '0'),
      quoteQty: parseFloat(t.quoteQty ?? '0'),
      commission: parseFloat(t.commission ?? '0'),
      commissionAsset: String(t.commissionAsset ?? ''),
      realizedPnl: parseFloat(t.realizedPnl ?? '0'),
      time: Number(t.time ?? 0),
      positionSide: (t.positionSide as 'LONG' | 'SHORT' | 'BOTH' | undefined) ?? 'BOTH',
    }));
  }, []);

  const fetchIncomeHistory = useCallback(async (startTime?: number, endTime?: number): Promise<LiveHistoryEntry[]> => {
    const key = apiKeyRef.current;
    const secret = apiSecretRef.current;
    if (!key || !secret) throw new Error('API 키가 설정되지 않았습니다');
    const params: Record<string, string | number> = { incomeType: 'REALIZED_PNL', limit: 1000 };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await fetchSigned<any[]>('/fapi/v1/income', key, secret, params);
    return res.map(r => ({
      tranId:  String(r.tranId),
      symbol:  r.symbol,
      income:  parseFloat(r.income),
      asset:   r.asset,
      time:    r.time as number,
      tradeId: String(r.tradeId ?? ''),
      info:    r.info ?? '',
    }));
  }, []);

  return { positions, orders, allPositions, allOrders, balance, loading, error, refetch: fetchData, placeOrder, cancelOrder, placeTPSL, closeMarket, clientSlMap, removeClientSL, fetchIncomeHistory, fetchUserTrades };
}
