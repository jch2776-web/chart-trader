/**
 * NewsCard.tsx
 *
 * 레이아웃: [주요 뉴스] | [경제지표 캘린더] | [FOMC]
 * - 경제지표: CPI/PCE/GDP/NFP/PPI/ISM — 이벤트 하나당 개별 박스
 * - FOMC는 우측 전용 패널 (경제지표에서 제외)
 * - 발표 시간 KST 표시, 24시간 이내 임박 시 깜박임
 * - 뉴스: Reddit r/CryptoCurrency + r/Bitcoin, 5분 주기 갱신
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── 경제지표 캘린더 (FOMC 제외) ───────────────────────────────────────────────

interface EconEvent {
  date: string;        // YYYY-MM-DD
  timeUtc: string;     // HH:MM UTC
  label: string;
  category: string;
  approximate?: boolean;
}

// 발표 시각 기준: BLS 주요 지표 12:30 UTC (21:30 KST), ISM 14:00 UTC (23:00 KST)
// DST 기간(3월 둘째일~11월 첫째일) UTC 시각이 1시간 당겨짐 — 표기 단순화를 위해 고정값 사용
const ECON_EVENTS: EconEvent[] = [
  // ── CPI ──────────────────────────────────────────────────────────────────
  { date: '2026-04-10', timeUtc: '12:30', label: 'CPI (3월)',        category: 'CPI' },
  { date: '2026-05-12', timeUtc: '12:30', label: 'CPI (4월)',        category: 'CPI', approximate: true },
  { date: '2026-06-10', timeUtc: '12:30', label: 'CPI (5월)',        category: 'CPI', approximate: true },
  { date: '2026-07-14', timeUtc: '12:30', label: 'CPI (6월)',        category: 'CPI', approximate: true },
  { date: '2026-08-11', timeUtc: '12:30', label: 'CPI (7월)',        category: 'CPI', approximate: true },
  // ── PCE ──────────────────────────────────────────────────────────────────
  { date: '2026-04-30', timeUtc: '12:30', label: 'PCE (3월)',        category: 'PCE', approximate: true },
  { date: '2026-05-29', timeUtc: '12:30', label: 'PCE (4월)',        category: 'PCE', approximate: true },
  { date: '2026-06-26', timeUtc: '12:30', label: 'PCE (5월)',        category: 'PCE', approximate: true },
  { date: '2026-07-31', timeUtc: '12:30', label: 'PCE (6월)',        category: 'PCE', approximate: true },
  // ── GDP ──────────────────────────────────────────────────────────────────
  { date: '2026-04-29', timeUtc: '12:30', label: 'GDP 속보 (Q1)',    category: 'GDP', approximate: true },
  { date: '2026-05-28', timeUtc: '12:30', label: 'GDP 수정 (Q1)',    category: 'GDP', approximate: true },
  { date: '2026-06-25', timeUtc: '12:30', label: 'GDP 확정 (Q1)',    category: 'GDP', approximate: true },
  { date: '2026-07-29', timeUtc: '12:30', label: 'GDP 속보 (Q2)',    category: 'GDP', approximate: true },
  // ── NFP (비농업 고용) ─────────────────────────────────────────────────────
  { date: '2026-04-03', timeUtc: '12:30', label: 'NFP (3월)',        category: 'NFP' },
  { date: '2026-05-08', timeUtc: '12:30', label: 'NFP (4월)',        category: 'NFP', approximate: true },
  { date: '2026-06-05', timeUtc: '12:30', label: 'NFP (5월)',        category: 'NFP', approximate: true },
  { date: '2026-07-02', timeUtc: '12:30', label: 'NFP (6월)',        category: 'NFP', approximate: true },
  // ── PPI ──────────────────────────────────────────────────────────────────
  { date: '2026-04-11', timeUtc: '12:30', label: 'PPI (3월)',        category: 'PPI' },
  { date: '2026-05-14', timeUtc: '12:30', label: 'PPI (4월)',        category: 'PPI', approximate: true },
  { date: '2026-06-12', timeUtc: '12:30', label: 'PPI (5월)',        category: 'PPI', approximate: true },
  { date: '2026-07-16', timeUtc: '12:30', label: 'PPI (6월)',        category: 'PPI', approximate: true },
  // ── ISM ──────────────────────────────────────────────────────────────────
  { date: '2026-05-01', timeUtc: '14:00', label: 'ISM 제조업 (4월)', category: 'ISM', approximate: true },
  { date: '2026-06-01', timeUtc: '14:00', label: 'ISM 제조업 (5월)', category: 'ISM', approximate: true },
  { date: '2026-07-01', timeUtc: '14:00', label: 'ISM 제조업 (6월)', category: 'ISM', approximate: true },
];

// FOMC — 우측 전용 패널용 (경제지표 패널에서 제외)
interface FomcEvent {
  date: string;
  timeUtc: string;
  approximate?: boolean;
}
const FOMC_EVENTS: FomcEvent[] = [
  { date: '2026-04-29', timeUtc: '18:00' },  // 4/28-29 회의
  { date: '2026-06-17', timeUtc: '18:00', approximate: true },
  { date: '2026-07-29', timeUtc: '18:00', approximate: true },
  { date: '2026-09-16', timeUtc: '18:00', approximate: true },
  { date: '2026-10-28', timeUtc: '18:00', approximate: true },
  { date: '2026-12-09', timeUtc: '18:00', approximate: true },
];

const CATEGORY_META: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  CPI: { color: '#f6465d', bg: 'rgba(246,70,93,0.08)',   border: 'rgba(246,70,93,0.28)',   icon: '📈' },
  PCE: { color: '#ff7f50', bg: 'rgba(255,127,80,0.08)',  border: 'rgba(255,127,80,0.28)',  icon: '💸' },
  GDP: { color: '#0ecb81', bg: 'rgba(14,203,129,0.08)',  border: 'rgba(14,203,129,0.28)',  icon: '📊' },
  NFP: { color: '#3b8beb', bg: 'rgba(59,139,235,0.08)',  border: 'rgba(59,139,235,0.28)',  icon: '👷' },
  PPI: { color: '#9b59b2', bg: 'rgba(155,89,178,0.08)',  border: 'rgba(155,89,178,0.28)',  icon: '🏭' },
  ISM: { color: '#848e9c', bg: 'rgba(132,142,156,0.08)', border: 'rgba(132,142,156,0.28)', icon: '⚙️' },
};

interface EconEventWithMeta extends EconEvent {
  utcMs: number;
  daysLeft: number;
  hoursLeft: number;
  kstStr: string;
}

interface FomcEventWithMeta extends FomcEvent {
  utcMs: number;
  daysLeft: number;
  hoursLeft: number;
  kstStr: string;
}

function toUtcMs(date: string, timeUtc: string): number {
  return new Date(`${date}T${timeUtc}:00Z`).getTime();
}

function toKstStr(utcMs: number): string {
  const d = new Date(utcMs + 9 * 3600 * 1000);
  const mm  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd  = String(d.getUTCDate()).padStart(2, '0');
  const hh  = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min} KST`;
}

function getUpcomingEcon(count = 16): EconEventWithMeta[] {
  const now = Date.now();
  return ECON_EVENTS
    .map(e => {
      const utcMs  = toUtcMs(e.date, e.timeUtc);
      const diffMs = utcMs - now;
      return { ...e, utcMs, daysLeft: Math.ceil(diffMs / 86_400_000), hoursLeft: diffMs / 3_600_000, kstStr: toKstStr(utcMs) };
    })
    .filter(e => e.daysLeft >= -1)
    .sort((a, b) => a.utcMs - b.utcMs)
    .slice(0, count);
}

function getUpcomingFomc(count = 4): FomcEventWithMeta[] {
  const now = Date.now();
  return FOMC_EVENTS
    .map(e => {
      const utcMs  = toUtcMs(e.date, e.timeUtc);
      const diffMs = utcMs - now;
      return { ...e, utcMs, daysLeft: Math.ceil(diffMs / 86_400_000), hoursLeft: diffMs / 3_600_000, kstStr: toKstStr(utcMs) };
    })
    .filter(e => e.daysLeft >= -1)
    .slice(0, count);
}

// ── 뉴스 ─────────────────────────────────────────────────────────────────────

interface NewsItem {
  id: string;
  title: string;
  titleKo: string;
  url: string;
  source: string;
  publishedOn: number;
  badge: string;
}

const NEWS_REFRESH_MS  = 5 * 60 * 1000;
const NEWS_MAX_AGE_SEC = 24 * 60 * 60;

const REDDIT_SOURCES = [
  { sub: 'CryptoCurrency', label: 'r/Crypto'  },
  { sub: 'Bitcoin',        label: 'r/Bitcoin' },
];

interface RedditChild {
  data: {
    id: string;
    title: string;
    url: string;
    permalink: string;
    created_utc: number;
    domain: string;
    link_flair_text: string | null;
    is_self: boolean;
  };
}

async function fetchRedditNews(src: typeof REDDIT_SOURCES[0]): Promise<NewsItem[]> {
  const res = await fetch(
    `https://www.reddit.com/r/${src.sub}/new.json?limit=15`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`reddit ${src.sub} ${res.status}`);
  const json = await res.json() as { data: { children: RedditChild[] } };
  return (json.data?.children ?? [])
    .filter(c => !c.data.is_self)
    .map((c, i) => ({
      id: c.data.id || `${src.sub}-${i}`,
      title: c.data.title,
      titleKo: '',
      url: c.data.url.startsWith('http') ? c.data.url : `https://reddit.com${c.data.permalink}`,
      source: c.data.domain || src.label,
      publishedOn: Math.floor(c.data.created_utc),
      badge: inferBadge(c.data.title, c.data.link_flair_text ?? ''),
    }));
}

function inferBadge(title: string, cats: string): string {
  const h = `${title} ${cats}`;
  if (/Bitcoin|BTC/i.test(h))                                   return 'BTC';
  if (/Ethereum|ETH/i.test(h))                                  return 'ETH';
  if (/Solana|SOL/i.test(h))                                    return 'SOL';
  if (/Regulation|SEC|regulatory/i.test(h))                     return '규제';
  if (/FOMC|Federal Reserve|Fed |interest rate|macro/i.test(h)) return '거시';
  if (/DeFi/i.test(h))                                          return 'DeFi';
  if (/Binance|exchange|trading/i.test(h))                      return '거래소';
  return '뉴스';
}

async function translateToKo(text: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const data = await res.json() as Array<Array<[string]>>;
  return (data[0] ?? []).map((seg: [string]) => seg[0] ?? '').join('');
}

async function translateAll(items: NewsItem[]): Promise<NewsItem[]> {
  const results = await Promise.allSettled(items.map(item => translateToKo(item.title)));
  return items.map((item, i) => ({
    ...item,
    titleKo: results[i].status === 'fulfilled' && results[i].value.trim()
      ? results[i].value : item.title,
  }));
}

async function fetchNews(): Promise<NewsItem[]> {
  const settled = await Promise.allSettled(REDDIT_SOURCES.map(src => fetchRedditNews(src)));
  const all = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  if (all.length === 0) throw new Error('all sources failed');
  const seen = new Set<string>();
  const deduped = all
    .sort((a, b) => b.publishedOn - a.publishedOn)
    .filter(item => {
      const key = item.title.slice(0, 40).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
  return translateAll(deduped);
}

// ── 뉴스 캐러셀 훅 ────────────────────────────────────────────────────────────
// 아이템 ref 배열로 실제 높이를 측정해서 기사 하나씩 정확히 스크롤
// displayMs: 기사 표시 시간, animMs: 이동 애니메이션, restMs: 마지막 후 복귀 전 휴식

function useNewsCarousel(displayMs = 3500, animMs = 480, restMs = 2500) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs     = useRef<(HTMLElement | null)[]>([]);
  const pausedRef    = useRef(false);
  const indexRef     = useRef(0);

  // 아이템 수가 바뀔 때마다 캐러셀 재시작
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    if (itemCount === 0) return;
    let cancelled = false;
    let timerId   = 0;

    function wait(ms: number): Promise<void> {
      return new Promise(resolve => { timerId = window.setTimeout(resolve, ms); });
    }

    async function waitUnpaused() {
      while (!cancelled && pausedRef.current) await wait(80);
    }

    function scrollToItem(idx: number): Promise<void> {
      const el   = containerRef.current;
      const item = itemRefs.current[idx];
      if (!el || !item) return Promise.resolve();

      // 아이템의 컨테이너 기준 offsetTop
      const target = item.offsetTop - (el as HTMLElement).offsetTop;
      const startTop = el.scrollTop;
      const dist     = target - startTop;
      if (Math.abs(dist) < 1) return Promise.resolve();
      const t0 = performance.now();

      return new Promise<void>(resolve => {
        function frame(now: number) {
          if (cancelled) { resolve(); return; }
          const el = containerRef.current;
          if (!el) { resolve(); return; }
          const p    = Math.min((now - t0) / animMs, 1);
          const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
          el.scrollTop = startTop + dist * ease;
          if (p < 1) requestAnimationFrame(frame);
          else resolve();
        }
        requestAnimationFrame(frame);
      });
    }

    async function loop() {
      await wait(1000);
      indexRef.current = 0;

      while (!cancelled) {
        await waitUnpaused();
        if (cancelled) break;

        await scrollToItem(indexRef.current);
        if (cancelled) break;

        await waitUnpaused();
        await wait(displayMs);
        if (cancelled) break;

        const total = itemRefs.current.filter(Boolean).length;
        if (indexRef.current >= total - 1) {
          // 마지막 기사 → 휴식 후 첫 번째로
          await wait(restMs);
          if (cancelled) break;
          const el = containerRef.current;
          if (el) el.scrollTop = 0;
          indexRef.current = 0;
          await wait(400);
        } else {
          indexRef.current += 1;
        }
      }
    }

    void loop();
    return () => { cancelled = true; window.clearTimeout(timerId); };
  }, [itemCount, displayMs, animMs, restMs]);

  const registerItem = useCallback((i: number) => (el: HTMLElement | null) => {
    itemRefs.current[i] = el;
  }, []);

  const onMouseEnter = useCallback(() => { pausedRef.current = true;  }, []);
  const onMouseLeave = useCallback(() => { pausedRef.current = false; }, []);

  return { containerRef, registerItem, setItemCount, onMouseEnter, onMouseLeave };
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function timeAgo(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSec);
  if (diff < 60)    return '방금';
  if (diff < 3600)  return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

const BADGE_COLOR: Record<string, string> = {
  BTC: '#f0b90b', ETH: '#627eea', SOL: '#9945ff',
  규제: '#f6465d', 거시: '#9b59b2', DeFi: '#0ecb81',
  거래소: '#3b8beb', 뉴스: '#848e9c',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface NewsCardProps {
  maxHeight?: number;
}

export function NewsCard({ maxHeight }: NewsCardProps) {
  const [news, setNews]           = useState<NewsItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [lastFetch, setLastFetch] = useState(0);
  const [secsLeft, setSecsLeft]   = useState(NEWS_REFRESH_MS / 1000);
  const [tick, setTick]           = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true); setError(false);
      try {
        const items = await fetchNews();
        if (!mounted) return;
        setNews(items); setLastFetch(Date.now());
      } catch (e) {
        if (!mounted) return;
        console.error('[News] fetch error:', e);
        setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    const id = window.setInterval(() => void load(), NEWS_REFRESH_MS);
    return () => { mounted = false; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!lastFetch) return;
    const cadSec = NEWS_REFRESH_MS / 1000;
    const compute = () => Math.max(0, cadSec - Math.floor((Date.now() - lastFetch) / 1000));
    setSecsLeft(compute());
    const id = window.setInterval(() => setSecsLeft(compute()), 1000);
    return () => window.clearInterval(id);
  }, [lastFetch]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const econEvents = getUpcomingEcon();
  const fomcEvents = getUpcomingFomc();

  const carousel = useNewsCarousel(3500, 480, 2500);

  // 뉴스 목록이 바뀌면 캐러셀에 아이템 수 알림
  const visibleNews = news.filter(item => Date.now() / 1000 - item.publishedOn <= NEWS_MAX_AGE_SEC);
  useEffect(() => {
    carousel.setItemCount(visibleNews.length);
  }, [visibleNews.length, carousel.setItemCount]);

  return (
    <div style={{
      display: 'flex',
      flex: '1 1 320px',
      gap: 8,
      minWidth: 0,
      ...(maxHeight ? { height: maxHeight, overflow: 'hidden' } : {}),
    }}>

      {/* ── 주요 뉴스 ── */}
      <div style={{
        background: 'rgba(30,34,45,0.7)',
        border: '1px solid #2a2e39',
        borderRadius: 6,
        display: 'flex',
        flex: '1 1 180px',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
      }}>
        <div style={{ borderBottom: '1px solid #2a2e39', flexShrink: 0 }}>
          <div style={{ alignItems: 'center', display: 'flex', gap: 6, padding: '5px 9px' }}>
            <span style={{ color: '#3b8beb', fontSize: '0.72rem', fontWeight: 700 }}>📰 주요 뉴스</span>
            <span style={{ fontSize: '0.63rem', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              {loading ? (
                <span style={{ color: '#4a4f5b' }}>번역 중…</span>
              ) : error && news.length === 0 ? (
                <span style={{ color: '#848e9c' }}>오류</span>
              ) : (
                <span style={{ color: secsLeft <= 30 ? '#f0b90b' : '#4a4f5b' }}>
                  5분 주기 · {String(Math.floor(secsLeft / 60)).padStart(2, '0')}:{String(secsLeft % 60).padStart(2, '0')} 후 갱신
                </span>
              )}
            </span>
          </div>
          <div style={{ background: '#1e222d', height: 2 }}>
            <div style={{
              background: secsLeft <= 30 ? '#f0b90b' : '#3b8beb',
              height: '100%',
              transition: 'width 0.9s linear',
              width: `${Math.max(0, Math.min(100, (1 - secsLeft / (NEWS_REFRESH_MS / 1000)) * 100))}%`,
            }} />
          </div>
        </div>
        <div
          ref={carousel.containerRef}
          onMouseEnter={carousel.onMouseEnter}
          onMouseLeave={carousel.onMouseLeave}
          style={{ flex: 1, minHeight: 0, overflowY: 'hidden', padding: '5px 8px' }}
        >
          {loading && news.length === 0 && (
            <div style={{ color: '#4a4f5b', fontSize: '0.70rem', padding: '8px 0' }}>뉴스 로딩 중…</div>
          )}
          {error && news.length === 0 && (
            <div style={{ color: '#848e9c', fontSize: '0.70rem', padding: '8px 0' }}>뉴스를 불러올 수 없음</div>
          )}
          {visibleNews.map((item, i) => {
            const color = BADGE_COLOR[item.badge] ?? '#848e9c';
            return (
              <a
                key={item.id}
                ref={carousel.registerItem(i)}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ borderBottom: '1px solid rgba(42,46,57,0.5)', color: 'inherit', display: 'block', paddingBottom: 6, marginBottom: 5, textDecoration: 'none' }}
              >
                <div style={{ alignItems: 'flex-start', display: 'flex', gap: 5 }}>
                  <span style={{
                    background: `${color}22`, border: `1px solid ${color}55`,
                    borderRadius: 3, color, flexShrink: 0, fontSize: '0.62rem',
                    fontWeight: 700, marginTop: 1, padding: '0 4px',
                  }}>{item.badge}</span>
                  <span style={{
                    color: '#c4c9d4', fontSize: '0.71rem', lineHeight: 1.4,
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{item.titleKo || item.title}</span>
                </div>
                <div style={{ color: '#4a4f5b', fontSize: '0.62rem', marginTop: 2, paddingLeft: 36 }}>
                  {item.source} · {timeAgo(item.publishedOn)}
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* ── 경제지표 (이벤트별 개별 박스, FOMC 제외) ── */}
      <div style={{
        background: 'rgba(30,34,45,0.7)',
        border: '1px solid #2a2e39',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        width: 178,
      }}>
        <div style={{
          alignItems: 'center', borderBottom: '1px solid #2a2e39',
          color: '#d1d4dc', display: 'flex', flexShrink: 0,
          fontSize: '0.72rem', fontWeight: 700, gap: 5, padding: '5px 9px',
        }}>
          <span>🗓</span><span>경제지표</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {econEvents.length === 0 && (
            <div style={{ color: '#4a4f5b', fontSize: '0.70rem', padding: 4 }}>예정 없음</div>
          )}
          {econEvents.map(e => {
            const meta       = CATEGORY_META[e.category] ?? CATEGORY_META['ISM'];
            const isPast     = e.daysLeft < 0;
            const isImminent = !isPast && e.hoursLeft <= 24;
            const blink      = isImminent && tick % 2 === 0;

            let dLabel = '';
            if (isPast)               dLabel = '완료';
            else if (e.hoursLeft <= 1) dLabel = `${Math.max(0, Math.floor(e.hoursLeft * 60))}분 후`;
            else if (isImminent)       dLabel = `${Math.floor(e.hoursLeft)}시간 후`;
            else                       dLabel = `D-${e.daysLeft}`;

            const badgeColor  = isPast ? '#4a4f5b' : isImminent ? '#f6465d' : meta.color;
            const badgeBg     = isPast ? 'rgba(74,79,91,0.12)' : isImminent ? 'rgba(246,70,93,0.15)' : meta.bg;
            const badgeBorder = isPast ? '#2a2e39' : isImminent ? 'rgba(246,70,93,0.45)' : meta.border;

            return (
              <div key={`${e.date}-${e.label}`} style={{
                background: isPast ? 'rgba(20,22,30,0.4)' : meta.bg,
                border: `1px solid ${isPast ? '#1e2230' : meta.border}`,
                borderRadius: 5,
                opacity: isPast ? 0.45 : 1,
                padding: '4px 7px',
              }}>
                {/* 라벨 + D-배지 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <span style={{ fontSize: '0.67rem' }}>{meta.icon}</span>
                  <span style={{ color: isPast ? '#4a4f5b' : meta.color, fontSize: '0.67rem', fontWeight: 700, flex: 1 }}>
                    {e.label}
                    {e.approximate && <span style={{ color: '#4a4f5b', fontWeight: 400 }}> *</span>}
                  </span>
                  <span style={{
                    background: badgeBg,
                    border: `1px solid ${badgeBorder}`,
                    borderRadius: 3,
                    color: badgeColor,
                    fontSize: '0.60rem',
                    fontWeight: 700,
                    padding: '0 4px',
                    opacity: blink ? 0.15 : 1,
                    transition: 'opacity 0.25s',
                    whiteSpace: 'nowrap',
                  }}>{dLabel}</span>
                </div>
                {/* KST 시간 */}
                <div style={{ color: isImminent ? '#f6465d' : '#4a4f5b', fontSize: '0.61rem' }}>
                  {e.kstStr}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── FOMC 전용 패널 ── */}
      <div style={{
        background: 'rgba(240,185,11,0.04)',
        border: '1px solid rgba(240,185,11,0.18)',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        width: 132,
      }}>
        <div style={{
          alignItems: 'center', borderBottom: '1px solid rgba(240,185,11,0.18)',
          color: '#f0b90b', display: 'flex', flexShrink: 0,
          fontSize: '0.72rem', fontWeight: 700, gap: 5, padding: '5px 9px',
        }}>
          <span>🏦</span><span>FOMC</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 7px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {fomcEvents.length === 0 && (
            <span style={{ color: '#848e9c', fontSize: '0.70rem' }}>예정 없음</span>
          )}
          {fomcEvents.map(e => {
            const isPast     = e.daysLeft < 0;
            const isImminent = !isPast && e.hoursLeft <= 24;
            const isSoon     = !isPast && e.daysLeft <= 7;
            const blink      = isImminent && tick % 2 === 0;
            const color      = isPast ? '#4a4f5b' : isImminent ? '#f6465d' : isSoon ? '#f0b90b' : '#848e9c';

            let dLabel = '';
            if (isPast)                dLabel = '완료';
            else if (e.hoursLeft <= 1) dLabel = `${Math.max(0, Math.floor(e.hoursLeft * 60))}분 후`;
            else if (isImminent)       dLabel = `${Math.floor(e.hoursLeft)}시간 후`;
            else if (e.daysLeft === 0) dLabel = 'D-DAY';
            else                       dLabel = `D-${e.daysLeft}`;

            return (
              <div key={`fomc-${e.date}`} style={{
                background: isPast ? 'rgba(20,22,30,0.4)' : isImminent ? 'rgba(246,70,93,0.07)' : 'rgba(240,185,11,0.06)',
                border: `1px solid ${isPast ? '#1e2230' : isImminent ? 'rgba(246,70,93,0.35)' : 'rgba(240,185,11,0.22)'}`,
                borderRadius: 5,
                opacity: isPast ? 0.4 : 1,
                padding: '4px 7px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color, fontSize: '0.68rem', fontWeight: 700 }}>
                    {e.date.slice(5).replace('-', '/')} 결정일
                    {e.approximate && <span style={{ color: '#4a4f5b', fontWeight: 400 }}> *</span>}
                  </span>
                  <span style={{
                    background: isPast ? 'rgba(74,79,91,0.12)' : isImminent ? 'rgba(246,70,93,0.15)' : 'rgba(240,185,11,0.12)',
                    border: `1px solid ${isPast ? '#2a2e39' : isImminent ? 'rgba(246,70,93,0.4)' : 'rgba(240,185,11,0.35)'}`,
                    borderRadius: 3, color,
                    fontSize: '0.60rem', fontWeight: 700, padding: '0 4px',
                    opacity: blink ? 0.15 : 1, transition: 'opacity 0.25s',
                  }}>{dLabel}</span>
                </div>
                <div style={{ color: isImminent ? '#f6465d' : '#4a4f5b', fontSize: '0.61rem' }}>
                  {e.kstStr}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
