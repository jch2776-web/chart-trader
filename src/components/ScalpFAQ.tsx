import React, { useState } from 'react';

// ── Sub-components (same design language as AltScannerFAQ) ───────────────────

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 3, fontSize: '0.72rem',
      fontWeight: 700, border: `1px solid ${color}40`, background: `${color}18`, color,
    }}>{children}</span>
  );
}

function Card({ title, children, accent = '#3b8beb' }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: `1px solid ${accent}30`,
      borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: '10px 14px', marginBottom: 10,
    }}>
      {title && <div style={{ color: accent, fontSize: '0.77rem', fontWeight: 700, marginBottom: 6 }}>{title}</div>}
      {children}
    </div>
  );
}

function Formula({ children }: { children: string }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #2a2e39', borderRadius: 5, padding: '8px 14px',
      fontFamily: '"SF Mono", Consolas, monospace', fontSize: '0.82rem', color: '#f0b90b',
      margin: '8px 0', whiteSpace: 'pre-wrap' as const,
    }}>{children}</div>
  );
}

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid #1e222d', marginBottom: 2 }}>
      <button
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          color: '#d1d4dc', cursor: 'pointer', padding: '9px 0', fontSize: '0.82rem',
          fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: 'inherit',
        }}
        onClick={() => setOpen(v => !v)}
      >
        <span>Q. {q}</span>
        <span style={{ color: '#5e6673', fontSize: '0.9rem', marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ color: '#848e9c', fontSize: '0.78rem', lineHeight: 1.65, paddingBottom: 10, paddingLeft: 4 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div style={{ overflowX: 'auto' as const, marginBottom: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                textAlign: 'left', padding: '5px 10px', borderBottom: '1px solid #2a2e39',
                color: '#5e6673', fontWeight: 600, whiteSpace: 'nowrap', background: '#131722',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: '1px solid #1e222d' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: '6px 10px', color: '#b2b8c4', verticalAlign: 'top' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ color: '#848e9c', fontSize: '0.8rem', lineHeight: 1.7, marginBottom: 10, ...style }}>{children}</p>;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h3 style={{ color: '#d1d4dc', fontSize: '0.9rem', fontWeight: 700, marginBottom: 8, marginTop: 18 }}>{children}</h3>;
}

function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ paddingLeft: 18, margin: '6px 0 10px', color: '#848e9c', fontSize: '0.79rem', lineHeight: 1.75 }}>
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

interface Section { id: string; icon: string; title: string; content: React.ReactNode }

const SECTIONS: Section[] = [
  {
    id: 'overview',
    icon: '⚡',
    title: '스캘핑 개요',
    content: (
      <>
        <P>
          스캘핑 자동매매는 <strong style={{ color: '#f0b90b' }}>호가창 미시구조(microstructure)</strong>를 실시간으로
          분석해 초단기 진입 신호를 포착하고, 메이커 지정가 주문으로 자동 진입·익절·손절하는 시스템입니다.
          ALT추천(봉 마감 기반 스윙)과 완전히 독립적으로 동작합니다.
        </P>
        <Card title="처리 흐름" accent="#f0b90b">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' }}>
            {['WebSocket 시장 데이터', '→', '신호 평가', '→', '리스크 게이트', '→', 'GTX 지정가 진입', '→', 'TP/SL 부착', '→', '체결 감시', '→', '히스토리 기록'].map((s, i) =>
              s === '→'
                ? <span key={i} style={{ color: '#2a2e39' }}>▶</span>
                : <span key={i} style={{ background: '#1a1e2a', border: '1px solid #2a2e39', borderRadius: 4, padding: '2px 8px', fontSize: '0.74rem', color: '#b2b8c4' }}>{s}</span>
            )}
          </div>
        </Card>
        <H2>ALT추천과의 차이점</H2>
        <Table
          headers={['항목', 'ALT추천 (스윙)', '스캘핑']}
          rows={[
            ['진입 타이밍', '봉 마감 후 분석', '밀리초 단위 실시간'],
            ['주문 유형', 'MARKET (즉시 체결)', 'LIMIT GTX (메이커)'],
            ['보유 시간', '분~일', '수초~수분'],
            ['신호 기반', '추세선·SR 돌파', '호가 불균형·체결 압력'],
            ['설정 위치', '자동설정(⚙)', '스캘핑설정(⚙)'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'signals',
    icon: '📡',
    title: '신호 유형 (2종)',
    content: (
      <>
        <P>두 신호는 <strong style={{ color: '#d1d4dc' }}>호가 불균형(bookImbalance)</strong>과 <strong style={{ color: '#d1d4dc' }}>체결 압력(tradePressure)</strong>을 기반으로 합니다.</P>

        <Card title="① 마이크로 모멘텀 (micro-momentum)" accent="#0ecb81">
          <P>호가 불균형과 체결 압력이 <strong style={{ color: '#0ecb81' }}>같은 방향</strong>으로 동시에 기준치를 초과할 때 진입합니다.</P>
          <Formula>{`롱 진입: bookImbalance > +minImbalance  AND  tradePressure > +minTradePressure
숏 진입: bookImbalance < -minImbalance  AND  tradePressure < -minTradePressure

bookImbalance = (bidDepth - askDepth) / (bidDepth + askDepth)
tradePressure = (buyVolume - sellVolume) / (buyVolume + sellVolume)  [최근 N틱]`}</Formula>
          <Ul items={[
            '두 지표가 같은 방향에서 모두 미달이면 신호 미발생',
            '기본 minImbalance = 0.20 (스캘핑설정에서 조정 가능)',
            '기본 minTradePressure = 0.20 (스캘핑설정에서 조정 가능)',
            'TTL: 3초 — 3초 안에 체결되지 않으면 신호 폐기',
          ]} />
        </Card>

        <Card title="② 마이크로 반전 (micro-revert)" accent="#f6465d">
          <P>체결 압력이 <strong style={{ color: '#f0b90b' }}>극단적</strong>이면서 호가 불균형이 <strong style={{ color: '#f6465d' }}>반대 방향</strong>으로 전환될 때 페이드(역추세) 진입합니다.</P>
          <Formula>{`조건 (숏 예시 — 매수 압력 페이드):
  tradePressure > +0.55  (극단적 매수세)
  AND  bookImbalance < 0  (호가는 이미 매도 우위)

→ 과도한 매수 체결 후 반전을 노린 숏 진입`}</Formula>
          <Ul items={[
            '반전 신호는 압력 임계치가 더 높음 (고정값 0.55)',
            'TTL: 2초 — 모멘텀 신호보다 짧음',
            '스캘핑설정 > signalMode: "momentum" / "revert" / "both" 선택 가능',
          ]} />
        </Card>

        <H2>신호 점수(score)</H2>
        <P>각 신호는 0–1 점수를 가지며 <strong style={{ color: '#d1d4dc' }}>0.25 미만은 자동 필터링</strong>됩니다.</P>
        <Formula>{`모멘텀 score = 0.45 × f(imbalance) + 0.45 × f(pressure) + 스프레드보너스(0~0.10)
반전  score = 0.50 × f(pressure) + 0.40 × f(imbalance) + 스프레드보너스(0~0.10)`}</Formula>
      </>
    ),
  },
  {
    id: 'entry',
    icon: '📥',
    title: '진입 주문 (GTX)',
    content: (
      <>
        <P>
          스캘핑은 <strong style={{ color: '#f0b90b' }}>GTX (Post-Only Maker)</strong> 지정가 주문으로 진입합니다.
          메이커 수수료(-0.02%)를 받기 위한 구조로, 체결 순간 이미 비용이 낮아집니다.
        </P>

        <Card title="GTX 진입 가격 결정" accent="#3b8beb">
          <Formula>{`롱 진입가 = mid - halfSpread × 0.30  (최우선 매수호가 큐에 합류)
숏 진입가 = mid + halfSpread × 0.30  (최우선 매도호가 큐에 합류)

halfSpread = (ask - bid) / 2`}</Formula>
          <Ul items={[
            'GTX = 호가를 넘어가면 주문 즉시 거절(-5022) — 시장가처럼 체결되지 않음',
            '→ 신호 발생 시 이미 가격이 많이 움직였다면 체결 실패 가능성 높음',
            '모멘텀 신호에서 체결률이 낮은 이유가 이 때문',
          ]} />
        </Card>

        <Card title="미체결 시 리프라이스 (Reprice)" accent="#f0b90b">
          <P>주문이 TTL(기본 3초) 안에 체결되지 않으면 <strong style={{ color: '#f0b90b' }}>현재 최우선 호가로 가격 수정</strong>을 시도합니다.</P>
          <Table
            headers={['설정', '기본값', '의미']}
            rows={[
              ['entryTtlMs', '3,000 ms', '주문 당 TTL — 이 시간 내 미체결 시 리프라이스'],
              ['maxRepriceCount', '2회', '최대 리프라이스 횟수. 모두 소진 시 주문 취소'],
            ]}
          />
          <Ul items={[
            '리프라이스마다 TTL이 초기화됨 (최대 대기 = TTL × (1 + maxReprice))',
            '리프라이스 2회 설정 시 최대 9초(3+3+3) 대기',
            '모든 재시도 후에도 미체결이면 해당 신호 완전 포기',
          ]} />
        </Card>

        <H2>부분 체결 처리</H2>
        <Ul items={[
          '부분 체결 후 취소된 경우 → 체결된 수량으로 TP/SL 즉시 부착 (포지션 보호 우선)',
          '체결량이 0인 완전 미체결 취소 → 심볼 락 해제 후 다음 신호 대기',
          '체결 이벤트 누락 시 포지션 스냅샷 API로 45초 이내 자동 복구',
        ]} />
      </>
    ),
  },
  {
    id: 'tpsl',
    icon: '🎯',
    title: 'TP / SL 구조',
    content: (
      <>
        <P>
          진입 체결 직후 <strong style={{ color: '#0ecb81' }}>TP (LIMIT GTC, Reduce-Only)</strong>와
          <strong style={{ color: '#f6465d' }}> SL (STOP_MARKET)</strong>을 동시에 부착합니다.
          어느 한쪽이 체결되면 나머지는 자동 취소됩니다.
        </P>

        <Card title="TP/SL 가격 계산" accent="#0ecb81">
          <Formula>{`스프레드 = ask - bid
halfSpread = 스프레드 / 2
stopDist = max(halfSpread × 3.0,  진입가 × 0.001)  [최소 10 bps]

SL  = 진입가 - stopDist  (롱)  |  진입가 + stopDist  (숏)
TP  = max(stopDist×1.5,  수수료커버+최소ROI)

수수료 포함 최소 이동폭:
  roundTripFee = 진입가 × 16/10000  (레버리지 무관 절대금액)
  minNetMove   = 진입가 × 40/10000 / leverage
  → TP = 진입가 + max(stopDist×1.5, roundTripFee + 4bps + minNetMove)  (롱)`}</Formula>
          <Ul items={[
            'TP는 수수료·슬리피지를 고려한 순익 보장 구조',
            'leverage가 높을수록 minNetMove가 작아져 TP가 SL에 더 가까워질 수 있음',
            'SL은 STOP_MARKET — 슬리피지 있을 수 있음 (특히 저유동성 심볼)',
          ]} />
        </Card>

        <Card title="보호주문 누락 시 자동 복구" accent="#f0b90b">
          <Ul items={[
            'TP 또는 SL 주문이 없으면 15초마다 재부착 시도',
            '보호주문이 3개 이상 감지되면 오래된 것 자동 정리',
            'SL 주문 실패 시 클라이언트사이드 SL 폴백 (mark price 감시 → MARKET 청산)',
          ]} />
        </Card>

        <H2>익절·손절 히스토리 기록</H2>
        <Ul items={[
          '진입 체결 시 계획 TP/SL 가격이 히스토리에 저장됨',
          'TP 체결 → 종료 이유 "익절" / SL 체결 → "손절"',
          '수동 청산 또는 앱 재시작 후 인식된 청산 → "수동"',
        ]} />
      </>
    ),
  },
  {
    id: 'risk',
    icon: '🛡️',
    title: '리스크 게이트 & 차단기',
    content: (
      <>
        <P>모든 진입 신호는 아래 <strong style={{ color: '#f0b90b' }}>8단계 게이트</strong>를 순서대로 통과해야 합니다. 하나라도 실패하면 해당 심볼 진입이 차단됩니다.</P>

        <Table
          headers={['순서', '게이트', '기본값', '설명']}
          rows={[
            ['1', '연속 손절 차단기', '3회', '연속 손실이 N회에 달하면 수동 해제 전까지 모든 진입 정지'],
            ['2', '일일 최대 거래 수', '50회', '세션 당 스캘핑 진입 총 횟수 한도'],
            ['3', '최대 노출 한도', '$100', '현재 열린 포지션 합산 명목가치 상한'],
            ['4', '심볼 쿨다운', '30s', '거래 종료 후 동일 심볼 재진입 방지 대기 시간'],
            ['5', '스프레드 게이트', '3 bps', '현재 스프레드가 기준 초과 시 차단'],
            ['6', '뎁스 게이트', '$50,000', '10bps 내 호가 잔량 USD가 기준 미달 시 차단'],
            ['7', '지연 게이트', '500 ms', '시장 데이터 신선도 — 이 시간 초과 시 차단'],
            ['8', '신호 점수', '0.25', '점수 0.25 미만 신호 자동 필터'],
          ]}
        />

        <Card title="연속 손절 차단기 (Circuit Breaker)" accent="#f6465d">
          <P>
            <strong style={{ color: '#f6465d' }}>연속으로 N회 손실</strong>이 발생하면 차단기가 작동하여 모든 스캘핑 진입이 중단됩니다.
            툴바 스캘핑 칩의 빨간 <Badge color="#f6465d">차단기</Badge> 표시를 클릭하면 해제 팝업이 열립니다.
          </P>
          <Formula>{`기본 consecutiveLossBreaker = 3회

익절 체결 → 연속 손실 카운터 초기화 (0으로 리셋)
손절 체결 → 카운터 +1 → 3회 도달 시 차단기 발동
수동 청산 → 카운터 유지 (TP/SL 체결만 카운트)`}</Formula>
          <Ul items={[
            '차단기 발동 = 스캘핑 세션 중단이 아님 (isActive는 유지)',
            '스캘핑설정 > 연속 손절 차단기 값을 높이면 덜 민감하게 동작',
            '값을 999 등 높은 수치로 설정하면 사실상 비활성화',
          ]} />
        </Card>

        <Card title="심볼 락 (Symbol Lock)" accent="#3b8beb">
          <P>진입 주문 제출 시점부터 포지션이 완전히 청산될 때까지 동일 심볼에 대해 추가 진입이 차단됩니다.</P>
          <Ul items={[
            '락은 단일 포지션 원칙 보장 (심볼당 최대 1개 포지션)',
            '주문 취소 후에도 25초간 락 유지 (늦은 체결 이벤트 대비)',
            '25초 내 실제 포지션이 없음이 확인되면 즉시 락 해제',
          ]} />
        </Card>
      </>
    ),
  },
  {
    id: 'settings',
    icon: '⚙',
    title: '설정 가이드',
    content: (
      <>
        <P>스캘핑설정(⚙) 버튼에서 아래 항목을 조정합니다. 변경은 다음 신호부터 즉시 적용됩니다.</P>

        <H2>실행 설정</H2>
        <Table
          headers={['항목', '기본값', '권장 범위', '설명']}
          rows={[
            ['leverage', '3x', '2–5x', '레버리지. 높을수록 청산가 근접 위험'],
            ['marginType', 'ISOLATED', '—', 'ISOLATED 권장 (손실 격리)'],
            ['maxPerTradeRiskUsd', '$10', '$5–$50', '거래당 최대 리스크 USD (stopDist × notional)'],
            ['maxOpenExposureUsd', '$100', '$50–$500', '동시 열린 포지션 합산 상한'],
            ['entryTtlMs', '3,000 ms', '1,500–5,000', 'GTX 주문 TTL — 짧을수록 빠른 취소·재시도'],
            ['maxRepriceCount', '2회', '0–3', '리프라이스 횟수. 0이면 TTL 후 즉시 포기'],
          ]}
        />

        <H2>신호 설정</H2>
        <Table
          headers={['항목', '기본값', '설명']}
          rows={[
            ['signalMode', 'both', '"momentum" / "revert" / "both" — 사용할 신호 유형'],
            ['minImbalance', '0.20', '호가 불균형 최소 기준. 높일수록 신호 감소'],
            ['minTradePressure', '0.20', '체결 압력 최소 기준. 높일수록 신호 감소'],
          ]}
        />

        <H2>리스크 게이트 설정</H2>
        <Table
          headers={['항목', '기본값', '설명']}
          rows={[
            ['maxSpreadBps', '3 bps', '스프레드 상한. 낮출수록 거래 빈도 감소'],
            ['minDepthUsd', '$50,000', '호가 잔량 하한. 높일수록 고유동성 심볼만 허용'],
            ['maxLatencyMs', '500 ms', '데이터 지연 상한'],
            ['symbolCooldownMs', '30,000 ms', '거래 후 재진입 대기. 낮추면 빠른 재진입'],
            ['consecutiveLossBreaker', '3회', '차단기 발동 연속 손실 횟수'],
            ['maxDailyTrades', '50회', '세션당 최대 진입 횟수'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'troubleshoot',
    icon: '🔧',
    title: '문제 해결',
    content: (
      <>
        <Q q="14분 이상 거래가 없어요">
          <strong style={{ color: '#d1d4dc' }}>차단기 확인</strong> — 툴바 스캘핑 칩에 빨간 "차단기" 표시가 있으면 수동 해제 필요.
          해제 후에도 거래가 없다면 아래를 확인하세요.
          <ul style={{ paddingLeft: 16, marginTop: 6 }}>
            <li>활동 로그에서 "[스캘핑] 쿨다운" / "스프레드" / "뎁스" 메시지 확인</li>
            <li>설정한 심볼들의 스프레드가 maxSpreadBps(기본 3 bps)를 초과하는지 확인</li>
            <li>minImbalance / minTradePressure 값을 낮춰 신호 발생 빈도 높이기</li>
            <li>maxDailyTrades(기본 50) 도달 여부 확인</li>
          </ul>
        </Q>

        <Q q="GTX 주문이 계속 거절(-5022)돼요">
          신호 발생 시 이미 가격이 움직여 지정가가 호가를 넘어간 상태입니다.
          <ul style={{ paddingLeft: 16, marginTop: 6 }}>
            <li>entryTtlMs를 낮추면 리프라이스를 더 빨리 시도 (기본 3,000ms → 1,500ms)</li>
            <li>minImbalance / minTradePressure를 높여 더 강한 신호에만 진입 (가격 이동이 덜한 시점)</li>
            <li>유동성이 낮은 심볼(뎁스 부족)은 심볼 목록에서 제거</li>
          </ul>
        </Q>

        <Q q="TP/SL이 붙지 않아요">
          체결 직후 TP/SL 부착을 시도하며, 실패 시 <strong style={{ color: '#d1d4dc' }}>15초마다 자동 재시도</strong>합니다.
          활동 로그에서 "보호주문 복구 시도" 메시지를 확인하세요.
          반복 실패 시:
          <ul style={{ paddingLeft: 16, marginTop: 6 }}>
            <li>API 키 권한에 "주문 생성" 포함 여부 확인</li>
            <li>포지션 심볼의 레버리지/마진 타입 확인 (진입 전 자동 설정되나 권한 부족 시 실패)</li>
          </ul>
        </Q>

        <Q q="포지션 종료 이유가 '수동'으로 표시돼요">
          세 가지 경우입니다:
          <ul style={{ paddingLeft: 16, marginTop: 6 }}>
            <li><strong>실제 수동 청산</strong>: 바이낸스 앱·웹에서 직접 청산 시 항상 "수동"</li>
            <li><strong>클라이언트사이드 SL 발동</strong>: STOP_MARKET 주문 등록 실패 후 앱이 직접 감시하다 청산한 경우</li>
            <li><strong>포지션 스냅샷 청산 감지</strong>: TP/SL 체결 이벤트를 받지 못하고 사후 스냅샷으로 청산을 인식한 경우</li>
          </ul>
        </Q>

        <Q q="스캘핑이 켜져있는데 시장 데이터가 없어요">
          활동 로그에서 "[스캘핑] 스트림 연결 끊김" 메시지 확인 후 스캘핑을 끄고 다시 켜세요.
          WebSocket 연결은 네트워크 불안정 시 자동 재연결을 시도하지만, 30초 이상 끊기면 수동 재시작이 안전합니다.
        </Q>

        <Q q="실전 모드인데 주문이 안 들어가요">
          <ul style={{ paddingLeft: 16, marginTop: 6 }}>
            <li>API 키가 등록되어 있는지 확인 (우측 패널 &gt; 계좌 탭)</li>
            <li>스캘핑설정에서 모드가 "실전"으로 선택되어 있는지 확인</li>
            <li>API 키에 선물 거래 권한이 있는지 확인</li>
            <li>바이낸스 IP 허용 목록에 현재 IP가 포함되어 있는지 확인</li>
          </ul>
        </Q>
      </>
    ),
  },
];

// ── Main component ────────────────────────────────────────────────────────────

export function ScalpFAQ({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const active = SECTIONS.find(s => s.id === activeId) ?? SECTIONS[0];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9100,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 10,
        width: '92vw', maxWidth: 860, height: '88vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '14px 20px',
          borderBottom: '1px solid #2a2e39', flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#d1d4dc', fontWeight: 700, fontSize: '1rem' }}>⚡ 스캘핑 자동매매 FAQ</div>
            <div style={{ color: '#5e6673', fontSize: '0.74rem', marginTop: 2 }}>
              마이크로구조 기반 초단타 자동매매 시스템 완전 해설
            </div>
          </div>
          <button
            style={{
              background: 'none', border: 'none', color: '#5e6673', cursor: 'pointer',
              fontSize: '1.2rem', padding: '4px 8px', borderRadius: 4,
            }}
            onClick={onClose}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{
            width: 160, flexShrink: 0, borderRight: '1px solid #1a1e2b',
            overflowY: 'auto' as const, padding: '8px 0', background: '#181c27',
          }}>
            {SECTIONS.map(sec => (
              <button
                key={sec.id}
                onClick={() => setActiveId(sec.id)}
                style={{
                  width: '100%', textAlign: 'left', background: activeId === sec.id ? 'rgba(240,185,11,0.10)' : 'none',
                  border: 'none', borderLeft: `3px solid ${activeId === sec.id ? '#f0b90b' : 'transparent'}`,
                  color: activeId === sec.id ? '#f0b90b' : '#848e9c',
                  cursor: 'pointer', padding: '8px 12px', fontSize: '0.78rem', fontWeight: 600,
                  fontFamily: 'inherit', lineHeight: 1.4,
                  transition: 'color 0.1s, background 0.1s',
                }}
              >
                <span style={{ marginRight: 6 }}>{sec.icon}</span>{sec.title}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto' as const, padding: '20px 24px' }}>
            <h2 style={{ color: '#d1d4dc', fontSize: '1rem', fontWeight: 700, marginBottom: 14, marginTop: 0 }}>
              {active.icon} {active.title}
            </h2>
            {active.content}
          </div>
        </div>
      </div>
    </div>
  );
}
