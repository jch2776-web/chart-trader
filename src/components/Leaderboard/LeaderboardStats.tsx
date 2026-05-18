import React, { useState, useMemo } from 'react';
import type { LeaderboardTrade } from '../../lib/tradeSync';

// ── PnL 누적 라인 차트 ─────────────────────────────────────────────────────────
type PnlPeriod = '1d' | '3d' | '7d' | '30d' | '90d' | 'all';
const PNL_PERIODS: { key: PnlPeriod; label: string; days: number | null }[] = [
  { key: '1d',  label: '1일',  days: 1  },
  { key: '3d',  label: '3일',  days: 3  },
  { key: '7d',  label: '7일',  days: 7  },
  { key: '30d', label: '30일', days: 30 },
  { key: '90d', label: '90일', days: 90 },
  { key: 'all', label: '전체', days: null },
];

function PnlCurve({ trades }: { trades: LeaderboardTrade[] }) {
  const [period, setPeriod] = useState<PnlPeriod>('all');
  const W = 480; const H = 90; const PAD = { l: 48, r: 12, t: 10, b: 20 };
  const inner = { w: W - PAD.l - PAD.r, h: H - PAD.t - PAD.b };

  const sorted = useMemo(() => {
    const allSorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
    const cfg = PNL_PERIODS.find(p => p.key === period);
    if (!cfg || cfg.days === null) return allSorted;
    const since = Date.now() - cfg.days * 86_400_000;
    return allSorted.filter(t => t.exitTime >= since);
  }, [trades, period]);

  const points = useMemo(() => {
    let cum = 0;
    return [{ x: 0, y: 0 }, ...sorted.map((t, i) => {
      cum += t.pnl;
      return { x: i + 1, y: cum };
    })];
  }, [sorted]);

  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  const rangeY = maxY - minY || 1;
  const maxX   = points.length - 1;

  const toSvg = (p: { x: number; y: number }) => ({
    x: PAD.l + (maxX > 0 ? p.x / maxX : 0) * inner.w,
    y: PAD.t + (1 - (p.y - minY) / rangeY) * inner.h,
  });

  const pts   = points.map(toSvg);
  const zero  = PAD.t + (1 - (0 - minY) / rangeY) * inner.h;
  const clampedZero = Math.max(PAD.t, Math.min(PAD.t + inner.h, zero));
  const finalPnl   = points[points.length - 1].y;
  const finalColor = finalPnl >= 0 ? '#0ecb81' : '#f6465d';

  const yLabels = [maxY, (maxY + minY) / 2, minY].map((v, i) => ({
    y: PAD.t + (i / 2) * inner.h,
    label: (v >= 0 ? '+' : '') + v.toFixed(1),
  }));

  const fmtShort = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <span style={labelStyle}>누적 PnL 추이</span>
        <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
          {PNL_PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                background: period === p.key ? '#2a2e39' : 'none',
                border: `1px solid ${period === p.key ? '#5e6673' : '#2a2e39'}`,
                borderRadius: 3,
                color: period === p.key ? '#d1d4dc' : '#5e6673',
                cursor: 'pointer',
                fontSize: 9,
                fontWeight: period === p.key ? 700 : 400,
                padding: '1px 5px',
                fontFamily: 'inherit',
              }}
            >{p.label}</button>
          ))}
        </div>
      </div>
      {points.length < 2 ? (
        <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5e6673', fontSize: 11 }}>
          해당 기간 거래 없음
        </div>
      ) : (
        <svg width={W} height={H} style={{ display: 'block' }}>
          <line x1={PAD.l} y1={clampedZero} x2={PAD.l + inner.w} y2={clampedZero}
            stroke="#2a2e39" strokeWidth={1} strokeDasharray="3,3" />
          {[0, 0.5, 1].map(t => (
            <line key={t} x1={PAD.l} x2={PAD.l + inner.w}
              y1={PAD.t + t * inner.h} y2={PAD.t + t * inner.h}
              stroke="#1e222d" strokeWidth={1} />
          ))}
          <path d={pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none" stroke={finalColor} strokeWidth={1.8} strokeLinejoin="round" />
          <path
            d={`${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L${pts[pts.length-1].x.toFixed(1)},${clampedZero} L${pts[0].x.toFixed(1)},${clampedZero} Z`}
            fill={finalColor} opacity={0.07}
          />
          <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r={3} fill={finalColor} />
          {yLabels.map((l, i) => (
            <text key={i} x={PAD.l - 4} y={l.y + 3} textAnchor="end" fill="#5e6673" fontSize={9}>{l.label}</text>
          ))}
          {sorted.length > 0 && <>
            <text x={PAD.l} y={H - 4} textAnchor="start" fill="#5e6673" fontSize={9}>{fmtShort(sorted[0].exitTime)}</text>
            <text x={PAD.l + inner.w} y={H - 4} textAnchor="end" fill="#5e6673" fontSize={9}>{fmtShort(sorted[sorted.length-1].exitTime)}</text>
          </>}
        </svg>
      )}
    </div>
  );
}

// ── 자동/수동 비율 원그래프 ───────────────────────────────────────────────────
function AutoManualPie({ trades }: { trades: LeaderboardTrade[] }) {
  const auto   = trades.filter(t => t.isAltTrade).length;
  const manual = trades.length - auto;
  const total  = trades.length || 1;

  const R = 38; const CX = 50; const CY = 50;

  // SVG arc helper
  const arc = (pct: number, startPct: number, color: string) => {
    if (pct <= 0) return null;
    if (pct >= 1) {
      return <circle cx={CX} cy={CY} r={R} fill={color} />;
    }
    const startAngle = startPct * 2 * Math.PI - Math.PI / 2;
    const endAngle   = (startPct + pct) * 2 * Math.PI - Math.PI / 2;
    const x1 = CX + R * Math.cos(startAngle);
    const y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle);
    const y2 = CY + R * Math.sin(endAngle);
    const large = pct > 0.5 ? 1 : 0;
    return (
      <path
        d={`M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`}
        fill={color}
      />
    );
  };

  const autoPct   = auto / total;
  const manualPct = manual / total;

  return (
    <div>
      <div style={labelStyle}>자동/수동 비율</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width={100} height={100} style={{ flexShrink: 0 }}>
          {arc(autoPct, 0, '#b8a0ff')}
          {arc(manualPct, autoPct, '#f0b90b')}
          {/* inner circle for donut */}
          <circle cx={CX} cy={CY} r={R * 0.55} fill="#141720" />
          <text x={CX} y={CY + 4} textAnchor="middle" fill="#d1d4dc" fontSize={11} fontWeight="700">
            {trades.length}건
          </text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#b8a0ff', flexShrink: 0 }} />
            <span style={{ color: '#848e9c', fontSize: 11 }}>자동</span>
            <span style={{ color: '#b8a0ff', fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
              {(autoPct * 100).toFixed(0)}%
            </span>
            <span style={{ color: '#5e6673', fontSize: 10 }}>({auto}건)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f0b90b', flexShrink: 0 }} />
            <span style={{ color: '#848e9c', fontSize: 11 }}>수동</span>
            <span style={{ color: '#f0b90b', fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
              {(manualPct * 100).toFixed(0)}%
            </span>
            <span style={{ color: '#5e6673', fontSize: 10 }}>({manual}건)</span>
          </div>
          <div style={{ borderTop: '1px solid #2a2e39', paddingTop: 4, marginTop: 2 }}>
            {(['자동', '수동'] as const).map((kind, i) => {
              const rows = i === 0 ? trades.filter(t => t.isAltTrade) : trades.filter(t => !t.isAltTrade);
              const pnl  = rows.reduce((s, r) => s + r.pnl, 0);
              const wins = rows.filter(r => r.pnl > 0).length;
              return (
                <div key={kind} style={{ color: '#5e6673', fontSize: 10, marginBottom: 2 }}>
                  {kind} 승률 {rows.length > 0 ? ((wins/rows.length)*100).toFixed(0) : 0}%
                  {' · '}
                  <span style={{ color: pnl >= 0 ? '#0ecb81' : '#f6465d' }}>
                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 롱/숏 비율 원그래프 ───────────────────────────────────────────────────────
function LongShortPie({ trades }: { trades: LeaderboardTrade[] }) {
  const longs  = trades.filter(t => t.positionSide === 'LONG').length;
  const shorts = trades.filter(t => t.positionSide === 'SHORT').length;
  const total  = trades.length || 1;

  const R = 38; const CX = 50; const CY = 50;

  const arc = (pct: number, startPct: number, color: string) => {
    if (pct <= 0) return null;
    if (pct >= 1) return <circle cx={CX} cy={CY} r={R} fill={color} />;
    const a1 = startPct * 2 * Math.PI - Math.PI / 2;
    const a2 = (startPct + pct) * 2 * Math.PI - Math.PI / 2;
    const x1 = CX + R * Math.cos(a1); const y1 = CY + R * Math.sin(a1);
    const x2 = CX + R * Math.cos(a2); const y2 = CY + R * Math.sin(a2);
    return (
      <path
        d={`M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${pct > 0.5 ? 1 : 0},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`}
        fill={color}
      />
    );
  };

  const lPct = longs / total;
  const sPct = shorts / total;

  return (
    <div>
      <div style={labelStyle}>롱/숏 비율</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width={100} height={100} style={{ flexShrink: 0 }}>
          {arc(lPct, 0, '#0ecb81')}
          {arc(sPct, lPct, '#f6465d')}
          <circle cx={CX} cy={CY} r={R * 0.55} fill="#141720" />
          <text x={CX} y={CY + 4} textAnchor="middle" fill="#d1d4dc" fontSize={11} fontWeight="700">
            {trades.length}건
          </text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(['LONG', 'SHORT'] as const).map((side, i) => {
            const rows  = trades.filter(t => t.positionSide === side);
            const pct   = i === 0 ? lPct : sPct;
            const color = side === 'LONG' ? '#0ecb81' : '#f6465d';
            return (
              <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ color: '#848e9c', fontSize: 11 }}>{side === 'LONG' ? '롱' : '숏'}</span>
                <span style={{ color, fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
                  {(pct * 100).toFixed(0)}%
                </span>
                <span style={{ color: '#5e6673', fontSize: 10 }}>({rows.length}건)</span>
              </div>
            );
          })}
          <div style={{ borderTop: '1px solid #2a2e39', paddingTop: 4, marginTop: 2 }}>
            {(['LONG', 'SHORT'] as const).map(side => {
              const rows = trades.filter(t => t.positionSide === side);
              const wins = rows.filter(r => r.pnl > 0).length;
              const pnl  = rows.reduce((s, r) => s + r.pnl, 0);
              return (
                <div key={side} style={{ color: '#5e6673', fontSize: 10, marginBottom: 2 }}>
                  {side === 'LONG' ? '롱' : '숏'} 승률 {rows.length > 0 ? ((wins/rows.length)*100).toFixed(0) : 0}%
                  {' · '}
                  <span style={{ color: pnl >= 0 ? '#0ecb81' : '#f6465d' }}>
                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 레버리지 분포 ─────────────────────────────────────────────────────────────
function LeverageDist({ trades }: { trades: LeaderboardTrade[] }) {
  const buckets = [
    { label: '1x',     min: 1,  max: 1  },
    { label: '2x',     min: 2,  max: 2  },
    { label: '3-5x',   min: 3,  max: 5  },
    { label: '6-10x',  min: 6,  max: 10 },
    { label: '11-20x', min: 11, max: 20 },
    { label: '21x+',   min: 21, max: Infinity },
  ];

  const rows = buckets.map(b => {
    const matched = trades.filter(t => { const lv = t.leverage ?? 1; return lv >= b.min && lv <= b.max; });
    const pnl = matched.reduce((s, r) => s + r.pnl, 0);
    return { ...b, count: matched.length, pnl };
  }).filter(r => r.count > 0);

  if (rows.length === 0) return null;
  const maxCount = Math.max(...rows.map(r => r.count));

  return (
    <div>
      <div style={labelStyle}>레버리지 분포</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 40, color: '#848e9c', fontSize: 10, textAlign: 'right', flexShrink: 0 }}>{r.label}</div>
            <div style={{ flex: 1, background: '#0d1117', borderRadius: 3, height: 14, overflow: 'hidden' }}>
              <div style={{
                width: `${(r.count / maxCount) * 100}%`, height: '100%', borderRadius: 3,
                background: r.pnl >= 0 ? 'rgba(14,203,129,0.55)' : 'rgba(246,70,93,0.55)',
                transition: 'width 0.3s',
              }} />
            </div>
            <div style={{ width: 28, color: '#5e6673', fontSize: 10, textAlign: 'right', flexShrink: 0 }}>{r.count}건</div>
            <div style={{ width: 56, color: r.pnl >= 0 ? '#0ecb81' : '#f6465d', fontSize: 10, textAlign: 'right', flexShrink: 0 }}>
              {r.pnl >= 0 ? '+' : ''}{r.pnl.toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 티커별 거래 통계 (접힘 기본) ──────────────────────────────────────────────
function TickerTable({ trades }: { trades: LeaderboardTrade[] }) {
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const map = new Map<string, LeaderboardTrade[]>();
    for (const t of trades) {
      const sym = t.symbol.replace('USDT', '');
      if (!map.has(sym)) map.set(sym, []);
      map.get(sym)!.push(t);
    }
    return [...map.entries()].map(([sym, ts]) => {
      const pnl    = ts.reduce((s, r) => s + r.pnl, 0);
      const wins   = ts.filter(r => r.pnl > 0).length;
      const avgLev = ts.reduce((s, r) => s + (r.leverage ?? 0), 0) / ts.length;
      return { sym, count: ts.length, pnl, wins, avgLev };
    }).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  if (rows.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 0, marginBottom: open ? 8 : 0, fontFamily: 'inherit',
        }}
      >
        <span style={{ ...labelStyle, marginBottom: 0 }}>티커별 통계</span>
        <span style={{ color: '#5e6673', fontSize: 10 }}>({rows.length}종목)</span>
        <span style={{ color: '#5e6673', fontSize: 11, marginLeft: 2 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2e39' }}>
              {['티커', '거래수', '누적 PnL', '승률', '평균 PnL', '평균 배율'].map(h => (
                <th key={h} style={{ padding: '4px 8px', color: '#5e6673', fontWeight: 600,
                  textAlign: h === '티커' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const winRate = r.count > 0 ? r.wins / r.count : 0;
              const avgPnl  = r.count > 0 ? r.pnl / r.count : 0;
              return (
                <tr key={r.sym} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '4px 8px', color: '#d1d4dc', fontWeight: 600 }}>{r.sym}</td>
                  <td style={{ padding: '4px 8px', color: '#848e9c', textAlign: 'right' }}>{r.count}건</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700,
                    color: r.pnl >= 0 ? '#0ecb81' : '#f6465d' }}>
                    {r.pnl >= 0 ? '+' : ''}{r.pnl.toFixed(2)} USDT
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right',
                    color: winRate >= 0.5 ? '#0ecb81' : '#f6465d' }}>
                    {(winRate * 100).toFixed(0)}%
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right',
                    color: avgPnl >= 0 ? '#0ecb81' : '#f6465d' }}>
                    {avgPnl >= 0 ? '+' : ''}{avgPnl.toFixed(2)}
                  </td>
                  <td style={{ padding: '4px 8px', color: '#848e9c', textAlign: 'right' }}>
                    {r.avgLev.toFixed(0)}x
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── 공통 레이블 스타일 ─────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  color: '#5e6673', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  marginBottom: 6,
};

// ── 메인 통계 패널 ────────────────────────────────────────────────────────────
export function LeaderboardStats({ trades }: { trades: LeaderboardTrade[] }) {
  if (trades.length === 0) return null;
  return (
    <div style={{
      background: '#141720',
      borderBottom: '1px solid #2a2e39',
      padding: '14px 16px',
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr',
      gap: 20,
    }}>
      {/* PnL 곡선 */}
      <PnlCurve trades={trades} />
      {/* 자동/수동 원그래프 */}
      <AutoManualPie trades={trades} />
      {/* 롱/숏 */}
      <LongShortPie trades={trades} />
      {/* 레버리지 분포 — 전체 너비 */}
      <div style={{ gridColumn: '1 / -1' }}>
        <LeverageDist trades={trades} />
      </div>
      {/* 티커별 통계 — 전체 너비, 기본 접힘 */}
      <div style={{ gridColumn: '1 / -1' }}>
        <TickerTable trades={trades} />
      </div>
    </div>
  );
}
