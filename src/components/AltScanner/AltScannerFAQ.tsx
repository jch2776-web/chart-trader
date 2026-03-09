import React, { useState } from 'react';

// ── Types ───────────────────────────────────────────────────────────────────
interface Section {
  id: string;
  icon: string;
  title: string;
  content: React.ReactNode;
}

// ── Sub-components ──────────────────────────────────────────────────────────
function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 3, fontSize: '0.72rem',
      fontWeight: 700, border: `1px solid ${color}40`, background: `${color}18`, color,
    }}>{children}</span>
  );
}

function InfoRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
      <span style={{ color: '#5e6673', fontSize: '0.74rem', minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#d1d4dc', fontSize: '0.8rem', fontWeight: 600 }}>{value}</span>
      {sub && <span style={{ color: '#5e6673', fontSize: '0.72rem' }}>{sub}</span>}
    </div>
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

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: '#848e9c', fontSize: '0.8rem', lineHeight: 1.7, marginBottom: 10 }}>{children}</p>;
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

// ── FAQ Sections ────────────────────────────────────────────────────────────
const SECTIONS: Section[] = [
  {
    id: 'overview',
    icon: '🔭',
    title: '스캐너 개요',
    content: (
      <>
        <P>
          ALT추천 스캐너는 바이낸스 선물 시장에서 <strong style={{ color: '#f0b90b' }}>가격 돌파 직전의 코인</strong>을
          자동으로 탐지하여 진입 타이밍을 제안하는 시스템입니다. 수백 개의 심볼을 일괄 스캔하고,
          SR(지지/저항), HVN(고거래량 존), 거래량 조건을 복합적으로 분석합니다.
        </P>
        <Card title="스캐너 처리 흐름" accent="#3b8beb">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' }}>
            {['심볼 목록 수신', '→', '캔들 데이터 fetch (202개)', '→', '돌파 감지', '→', 'SR/HVN 분석', '→', 'SL/TP 계산', '→', '스코어 산정', '→', '결과 표시'].map((s, i) => (
              s === '→'
                ? <span key={i} style={{ color: '#2a2e39' }}>▶</span>
                : <span key={i} style={{ background: '#1a1e2a', border: '1px solid #2a2e39', borderRadius: 4, padding: '2px 8px', fontSize: '0.74rem', color: '#b2b8c4' }}>{s}</span>
            ))}
          </div>
        </Card>
        <H2>지원 스캔 인터벌</H2>
        <Table
          headers={['인터벌', 'TTL (유효 봉)', '자동 스캔 주기', '권장 용도']}
          rows={[
            ['15m', '8봉 (2시간)', '15분마다', '단타 · 스캘핑'],
            ['1h', '8봉 (8시간)', '1시간마다', '데이 트레이딩'],
            ['4h', '6봉 (24시간)', '4시간마다', '스윙 트레이딩'],
            ['1d', '5봉 (5일)', '24시간마다', '포지션 트레이딩'],
          ]}
        />
        <H2>스캔 방향</H2>
        <Ul items={[
          <><Badge color="#0ecb81">롱</Badge> — 상승 돌파 신호 (지지선 위 안착, 저항선 돌파)</>,
          <><Badge color="#f6465d">숏</Badge> — 하락 이탈 신호 (저항선 아래 하락, 지지선 붕괴)</>,
          <><Badge color="#f0b90b">양방향</Badge> — 롱·숏 모두 탐지 (먼저 감지된 방향 채택)</>,
        ]} />
      </>
    ),
  },
  {
    id: 'signals',
    icon: '📡',
    title: '신호 유형 (3종)',
    content: (
      <>
        <P>스캐너는 세 가지 패턴을 순서대로 감지하며, 하나라도 일치하면 해당 신호를 반환합니다.</P>

        <Card title="① 추세선 돌파 (Trendline Breakout)" accent="#f0b90b">
          <P>최근 캔들에서 고점/저점을 연결한 추세선을 그리고, 종가가 그 선을 돌파했을 때 신호를 생성합니다.</P>
          <Ul items={[
            '롱: 하락 추세선 상향 돌파 (저점 연결선)',
            '숏: 상승 추세선 하향 이탈 (고점 연결선)',
            '추세선 기울기가 유의미해야 하며 최소 3개 터치 포인트 필요',
            '다음 봉 종가 확정 조건부 진입 지원 (close_above / close_below)',
          ]} />
          <Formula>{`롱 조건: prev_close <= trendline(t-1)  AND  last_close > trendline(t)
숏 조건: prev_close >= trendline(t-1)  AND  last_close < trendline(t)`}</Formula>
        </Card>

        <Card title="② 수평선 돌파 (Horizontal Level Breakout)" accent="#3b8beb">
          <P>과거 고점/저점 중 다중 터치된 수평 레벨을 찾아, 종가 돌파를 감지합니다.</P>
          <Ul items={[
            'ATR 기준으로 근접 레벨 병합 (중복 제거)',
            '터치 횟수가 많을수록 강한 레벨로 판단',
            '돌파 즉시 지정가 진입 방식 (intrabar trigger)',
            'HVN(고거래량 존)과 중첩된 레벨 우선 선택',
          ]} />
        </Card>

        <Card title="③ 박스권 돌파 (Box Range Breakout)" accent="#9b59b6">
          <P>일정 기간 박스권(횡보)을 형성한 구간을 감지하고, 상단/하단 이탈 시 신호를 생성합니다.</P>
          <Ul items={[
            '최근 N개 봉의 고가/저가 범위로 박스 정의',
            '볼린저밴드 폭(BB Width)이 좁을수록 신호 신뢰도 높음',
            '박스 상단 돌파 → 롱 / 박스 하단 이탈 → 숏',
          ]} />
        </Card>
      </>
    ),
  },
  {
    id: 'entry',
    icon: '🎯',
    title: '진입 조건 상세',
    content: (
      <>
        <P>신호 감지 후 실제 진입이 유효하려면 <strong style={{ color: '#f0b90b' }}>거래량 조건</strong>을 동시에 충족해야 합니다.</P>

        <Card title="거래량 조건" accent="#0ecb81">
          <Formula>{`볼륨 조건 1: last_candle.volume >= SMA20(volume) × volFactor
볼륨 조건 2: last_candle.volume >= prev_candle.volume`}</Formula>
          <Table
            headers={['인터벌', 'volFactor (거래량 배수)']}
            rows={[
              ['15m', '1.5배'],
              ['1h', '1.3배'],
              ['4h', '1.2배'],
              ['1d', '1.1배'],
            ]}
          />
          <P>두 조건 모두 충족 시 <Badge color="#0ecb81">TRIGGERED</Badge>, 돌파만 발생(거래량 미충족) 시 <Badge color="#f0b90b">PENDING</Badge>.</P>
        </Card>

        <H2>PENDING vs TRIGGERED 차이</H2>
        <Table
          headers={['구분', 'PENDING', 'TRIGGERED']}
          rows={[
            ['의미', '가격 돌파 O · 거래량 미달', '가격 돌파 O · 거래량 충족'],
            ['신뢰도', '보통', '높음'],
            ['모의 진입', '다음 봉 종가 조건부 진입', '즉시 지정가 진입'],
            ['실전 진입', '지정가 접수 (봉마감 미확인)', '즉시 지정가 접수'],
            ['상태 전이', 'PENDING → TRIGGERED 가능', '이미 확인됨'],
          ]}
        />

        <Card title="조건부 진입 (Trendline PENDING 전용)" accent="#f0b90b">
          <P>추세선 PENDING 신호는 다음 봉이 완전히 마감될 때까지 기다렸다가 진입합니다.</P>
          <Ul items={[
            '롱: 다음 봉 종가 ≥ triggerPriceAtNextClose 이면 자동 체결',
            '숏: 다음 봉 종가 ≤ triggerPriceAtNextClose 이면 자동 체결',
            '체결가 = 실제 종가 (슬리피지 0, 봉마감 확인 후)',
            '글로벌 WebSocket이 k.x === true (봉 마감)를 감지해 자동 처리',
            '모달이 닫혀있어도 App.tsx WS 모니터가 계속 감시',
          ]} />
        </Card>
      </>
    ),
  },
  {
    id: 'qty',
    icon: '📐',
    title: '수량 계산 로직',
    content: (
      <>
        <P>수량 계산에는 두 가지 모드가 있습니다. 모의 설정 패널에서 <strong style={{ color: '#f0b90b' }}>수량 기준</strong>을 선택할 수 있습니다.</P>

        <Card title="리스크% 모드 (기본)" accent="#0ecb81">
          <P>잔고 대비 허용 손실 금액을 기준으로 수량을 역산합니다. SL까지의 거리가 좁을수록 수량이 늘어납니다.</P>
          <Formula>{`riskAmount = balance × (riskPct / 100)

[SL 설정 있을 때]
qty = riskAmount / |entryPrice - slPrice|

[SL 거리 = 0 일 때 fallback]
qty = (riskAmount × leverage) / entryPrice`}</Formula>
          <InfoRow label="예시 (1h 롱)" value="잔고 $10,000 × 2% = $200 리스크" />
          <InfoRow label="SL 거리" value="$0.50" />
          <InfoRow label="수량 결과" value="$200 / $0.50 = 400개" />
        </Card>

        <Card title="마진 모드" accent="#3b8beb">
          <P>투입할 마진 금액을 직접 지정합니다. 레버리지를 곱해 수량을 결정합니다.</P>
          <Formula>{`qty = marginUsdt × leverage / entryPrice`}</Formula>
          <InfoRow label="예시 (10x 레버리지)" value="$100 마진 × 10 = $1,000 포지션" />
          <InfoRow label="진입가" value="$50,000" />
          <InfoRow label="수량 결과" value="$1,000 / $50,000 = 0.02 BTC" />
          <p style={{ color: '#f0b90b', fontSize: '0.8rem', lineHeight: 1.7, marginTop: 6, marginBottom: 10 }}>
            ※ 조건부 진입(PENDING)의 경우 triggerPriceAtNextClose를 기준가로 사용하여 수량 계산 (더 정확한 리스크 추정)
          </p>
        </Card>

        <H2>SL 이탈 진입 방지</H2>
        <P>진입 버튼 클릭 시 현재 마크 가격이 이미 SL을 넘었으면 진입을 거부합니다 (신호 무효화 방지).</P>
      </>
    ),
  },
  {
    id: 'tpsl',
    icon: '🛡',
    title: 'TP/SL 계산 로직',
    content: (
      <>
        <H2>손절 (SL) 계산</H2>
        <P>SL은 구조적 지지/저항 존을 기준으로 ATR 버퍼를 추가해 설정됩니다.</P>
        <Card title="롱 SL 계산" accent="#f6465d">
          <Formula>{`지지 존 발견 시:
  SL = 지지 존 하단 - ATR × 0.5

지지 존 없을 때 (ATR fallback):
  SL = entryPrice - ATR × 1.5`}</Formula>
        </Card>
        <Card title="숏 SL 계산" accent="#f6465d">
          <Formula>{`저항 존 발견 시:
  SL = 저항 존 상단 + ATR × 0.5

저항 존 없을 때 (ATR fallback):
  SL = entryPrice + ATR × 1.5`}</Formula>
        </Card>

        <H2>목표가 (TP) 계산</H2>
        <Card title="TP2 (최종 목표) — RR 2.0 기반" accent="#0ecb81">
          <Formula>{`R = |entryPrice - SL|

롱 TP2 = entryPrice + R × 2.0
숏 TP2 = entryPrice - R × 2.0`}</Formula>
        </Card>
        <Card title="TP1 (1차 목표) — 다음 SR 레벨 기반" accent="rgba(14,203,129,0.65)">
          <P>TP2 방향의 첫 번째 강한 SR 레벨을 TP1로 설정합니다 (없으면 TP1 생략).</P>
          <Ul items={[
            '롱: entryPrice ~ TP2 구간의 가장 가까운 저항 레벨',
            '숏: TP2 ~ entryPrice 구간의 가장 가까운 지지 레벨',
            'TP1 통과 후 포지션 일부 청산 권장 (부분 실현)',
          ]} />
        </Card>

        <H2>ATR (Average True Range)</H2>
        <P>14봉 평균 진폭으로 변동성을 측정합니다. 변동성이 클수록 SL 폭이 넓어져 포지션 크기가 줄어듭니다.</P>
        <Formula>{`TR = max(high-low, |high-prevClose|, |low-prevClose|)
ATR(14) = SMA14(TR)`}</Formula>

        <H2>격리 마진 청산가 vs SL</H2>
        <P>
          격리(ISOLATED) 마진에서는 레버리지가 높을수록 청산가가 진입가에 가까워집니다.
          ATR 기반 SL이 청산가보다 더 멀리 있으면 SL 이전에 청산이 먼저 발생합니다.
        </P>
        <Formula>{`LONG 청산가 = entryPrice × (1 - 1/leverage + 0.005)
SHORT 청산가 = entryPrice × (1 + 1/leverage - 0.005)
(0.005 = 유지증거금율 0.5%)

예시 — LONG 진입가 $100:
  3x  → 청산가 ≈ $67.2  (∆ -32.8%)  [SL 문제 없음]
  10x → 청산가 ≈ $90.5  (∆  -9.5%)  [ATR SL 보통 안전]
  20x → 청산가 ≈ $95.5  (∆  -4.5%)  [ATR SL 5%이면 위험!]
  50x → 청산가 ≈ $98.5  (∆  -1.5%)  [ATR SL 거의 모두 위험]`}</Formula>
        <Card title="자동 경고" accent="#f6465d">
          <P>
            모의/실전 설정에서 격리 마진을 선택한 경우, SL이 예상 청산가보다 먼저 도달되면
            진입 패널에 <Badge color="#f6465d">⚠️ 청산가 경고</Badge>가 표시됩니다.
            레버리지를 낮추거나 교차 마진으로 전환하세요.
          </P>
        </Card>
      </>
    ),
  },
  {
    id: 'status',
    icon: '🔄',
    title: '신호 상태 (Status)',
    content: (
      <>
        <P>각 신호는 시간과 가격에 따라 4가지 상태 중 하나를 가집니다.</P>
        <Table
          headers={['상태', '색상', '의미', '전이 조건']}
          rows={[
            [<Badge color="#3b8beb">PENDING</Badge>, '파랑', '가격 돌파 확인, 거래량 미달', '거래량 충족 → TRIGGERED'],
            [<Badge color="#0ecb81">TRIGGERED</Badge>, '초록', '가격+거래량 모두 충족', '시간 경과 → EXPIRED'],
            [<Badge color="#f6465d">INVALID</Badge>, '빨강', '핵심 지지/저항 이탈', '복구 불가'],
            [<Badge color="#848e9c">EXPIRED</Badge>, '회색', 'TTL 만료', '복구 불가'],
          ]}
        />

        <H2>TTL (신호 유효 기간)</H2>
        <Table
          headers={['인터벌', 'TTL 봉 수', 'TTL 시간']}
          rows={[
            ['15m', '8봉', '2시간'],
            ['1h', '8봉', '8시간'],
            ['4h', '6봉', '24시간'],
            ['1d', '5봉', '5일'],
          ]}
        />

        <Card title="INVALID 판정 기준" accent="#f6465d">
          <Ul items={[
            '롱: 현재 마크가가 핵심 지지 존 하단 이탈',
            '숏: 현재 마크가가 핵심 저항 존 상단 돌파',
            '가격이 SL 아래(롱) 또는 위(숏)로 이동',
            '자동 스캔 시 재검증(revalidate)으로 실시간 업데이트',
          ]} />
        </Card>

        <H2>실시간 재검증 (Revalidation)</H2>
        <P>
          WS 마크 가격 업데이트 시 각 신호를 재검증합니다. PENDING 신호의 경우 거래량이 충족되면
          TRIGGERED로 업그레이드되고, 핵심 레벨이 이탈하면 INVALID로 다운그레이드됩니다.
        </P>
      </>
    ),
  },
  {
    id: 'score',
    icon: '⭐',
    title: '신호 스코어',
    content: (
      <>
        <P>
          스코어(0~100점)는 신호의 종합적인 신뢰도를 나타냅니다. 높을수록 강한 진입 근거를 의미하며,
          결과 목록에서 높은 스코어 순으로 정렬됩니다.
        </P>

        <Card title="스코어 구성 요소" accent="#f0b90b">
          <Table
            headers={['항목', '최대 점수', '산정 기준']}
            rows={[
              ['거래량 비율', '35점', 'SMA20 대비 배수 (1x=0, 3x=35점)'],
              ['BB Width (변동성)', '30점', '좁을수록 고점 (횡보 후 돌파 신뢰도)'],
              ['ATR 비율', '25점', '적당한 변동성 (너무 작거나 크면 감점)'],
              ['스코어 보정', '±10점', 'TRIGGERED 가산, 오래된 신호 감점'],
            ]}
          />
        </Card>

        <H2>종합 의견 (★★★★★)</H2>
        <Table
          headers={['별점', '의견', '기준']}
          rows={[
            ['★★★★★', '매우 강력한 진입 신호', '스코어 80점 이상 + TRIGGERED'],
            ['★★★★☆', '강한 신호, 적극 고려', '스코어 65~79점'],
            ['★★★☆☆', '보통 신호, 신중 접근', '스코어 50~64점'],
            ['★★☆☆☆', '약한 신호, 관망 권장', '스코어 35~49점'],
            ['★☆☆☆☆', '주의 필요', '스코어 35점 미만'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'srHvn',
    icon: '📊',
    title: 'SR / HVN 분석',
    content: (
      <>
        <H2>SR 레벨 (Support & Resistance)</H2>
        <P>
          500개 캔들의 고점/저점 군집을 분석하여 의미있는 지지/저항 레벨을 추출합니다.
          터치 횟수, 시간적 가까움, 가격적 관련성을 종합해 스코어를 산정합니다.
        </P>
        <Card title="SR 레벨 스코어 산정" accent="#3b8beb">
          <Ul items={[
            '터치 횟수: 많을수록 강한 레벨 (×10점)',
            '최근성: 최근 터치일수록 높은 가중치',
            '현재가 근접: 진입가에 가까운 레벨 우선',
            'Horizon 분류: ST(단기 20봉), MT(중기 100봉), LT(장기 500봉)',
          ]} />
        </Card>

        <H2>HVN (High Volume Nodes)</H2>
        <P>
          거래량 분포 분석(Volume Profile)으로 특정 가격대에서 대량 거래가 이루어진 구간을 찾습니다.
          HVN 구간은 강한 지지/저항으로 작용하는 경향이 있습니다.
        </P>
        <Card title="HVN 계산 방식" accent="#9b59b6">
          <Ul items={[
            '300개 봉의 가격 범위를 100개 버킷으로 분할',
            '각 버킷의 거래량 합계 산출',
            '상위 5% 버킷 = HVN 존',
            '차트에 골드/노란색 밴드로 표시',
          ]} />
        </Card>

        <H2>레벨 표시 모드</H2>
        <Table
          headers={['모드', '표시 내용']}
          rows={[
            ['핵심 (core)', 'TOP 2 SR 레벨만 표시 (가장 강한 지지+저항)'],
            ['전체 (all)', '모든 SR + HVN 전체 표시'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'autoScan',
    icon: '⚡',
    title: '자동 스캔 (모달 내)',
    content: (
      <>
        <P>
          자동 스캔은 ALT추천 모달이 열려있는 동안 봉 마감 직후(+3초 지연) 전체 심볼을 자동으로 재스캔합니다.
          수동 스캔 없이도 항상 최신 신호 목록을 유지할 수 있습니다.
        </P>

        <Card title="자동 스캔 타이밍" accent="#0ecb81">
          <Ul items={[
            '15m 스캔: 매 시각 :00, :15, :30, :45 + 3초 후',
            '1h 스캔: 매 시각 :00 + 3초 후',
            '4h 스캔: 매 4시간 정각 + 3초 후',
            '1d 스캔: 매일 UTC 00:00 + 3초 후',
            '3초 지연: 거래소 데이터 확정 대기',
          ]} />
        </Card>

        <H2>자동 TP/SL 갱신</H2>
        <P>
          자동 스캔 완료 후, 해당 신호로 이미 진입한 <strong style={{ color: '#f0b90b' }}>모의 포지션</strong> 및
          <strong style={{ color: '#f0b90b' }}> 예약 주문</strong>의 TP/SL을 자동으로 최신 값으로 업데이트합니다.
        </P>
        <Ul items={[
          '동일 심볼 + 동일 방향의 altMeta 포지션/주문 매칭',
          'tpPrice, slPrice가 자동으로 갱신됨',
          '실전 포지션은 자동 갱신 미지원 (수동 조정 필요)',
        ]} />

        <H2>API 속도 제한</H2>
        <P>
          스캔 요청이 과도하면 바이낸스 API 일시 차단이 발생할 수 있습니다. 아래 기준을 지킵니다.
        </P>
        <Table
          headers={['모드', '동시 요청', '요청 간격', '예상 Weight/분']}
          rows={[
            ['수동/자동 스캔 (기본)', '3', '350ms', '~2,100'],
            ['자동매매 스캔', '4', '450ms', '~2,400'],
            ['바이낸스 한도', '—', '—', '2,400'],
          ]}
        />

        <H2>스캔 중단 조건</H2>
        <Ul items={[
          '수동 스캔 진행 중 자동 스캔 건너뜀',
          '모달이 닫혀있으면 자동 스캔 미동작 (모달 열려있을 때만 활성)',
          '중단 버튼으로 진행 중인 스캔 즉시 중단 가능',
        ]} />
      </>
    ),
  },
  {
    id: 'autoTrade',
    icon: '🤖',
    title: '자동매매 (무인)',
    content: (
      <>
        <P>
          자동매매는 ALT추천 모달 없이도 <strong style={{ color: '#f0b90b' }}>매 정각마다</strong> 백그라운드에서 전체 심볼을 스캔하여
          조건에 맞는 심볼에 자동으로 모의 진입합니다.
          툴바의 <Badge color="#f0b90b">자동매매</Badge> 토글로 활성화합니다.
        </P>

        <Card title="자동매매 동작 방식" accent="#f0b90b">
          <Ul items={[
            '매 정각(시간 기준) 자동으로 3개 타임프레임 순차 스캔',
            '1H 스캔 → 2초 대기 → 4H 스캔 → 2초 대기 → 1D 스캔',
            '스코어 90점 이상 심볼만 대상',
            '타임프레임별 상위 2개 심볼에 진입 (자동매매 모드에 따라 모의 또는 실전)',
            '동일 심볼+방향은 한 번의 실행에서 중복 진입하지 않음',
            'localStorage에 활성 상태 저장 (새로고침 후에도 유지)',
          ]} />
        </Card>

        <Card title="자동매매 스캔 속도 제한" accent="#848e9c">
          <P>심볼당 7 weight 소비 (klines limit=202 → 2wt, limit=502 → 5wt). 최대 안전 처리량에 맞춰 설정합니다.</P>
          <Formula>{`동시 요청: 4개
요청 간격: 450ms (+ 평균 HTTP 250ms = 실효 700ms/배치)
예상 처리: ~5.7 sym/초 × 7wt = ~40 weight/초 = ~2,400 weight/분
바이낸스 한도: 2,400 weight/분 (한도 상한에 맞춤)`}</Formula>
        </Card>

        <H2>즉시 실행</H2>
        <P>
          자동매매가 활성화된 상태에서 <strong style={{ color: '#f0b90b' }}>▶ 즉시실행</strong> 버튼을 누르면
          다음 정각을 기다리지 않고 즉시 스캔을 시작합니다.
          즉시 실행은 다음 정각 스케줄에는 영향을 주지 않습니다.
        </P>

        <H2>로그 확인</H2>
        <Ul items={[
          '모든 자동매매 활동은 앱 하단 활동 로그에 기록됨',
          '스캔 시작/완료, 진입 심볼, 오류 등이 [자동매매] 태그로 표시',
          '진입된 포지션은 모의 거래 히스토리에서 확인 가능',
        ]} />

        <Card title="주의 사항" accent="#f6465d">
          <Ul items={[
            '스캔 중 앱을 새로고침하면 진행 중인 스캔이 중단됨',
            '장시간 실행 시 다수의 포지션이 누적될 수 있음 (거래 히스토리 확인 권장)',
            '3x 레버리지 기준 청산가는 약 ±30% — ATR 기반 SL이 청산가보다 충분히 안쪽에 위치함',
            '수동 스캔과 동시 실행 중이면 합산 weight가 한도를 초과할 수 있음 — 자동매매 활성 중 대용량 수동 스캔을 피해주세요',
          ]} />
        </Card>
      </>
    ),
  },
  {
    id: 'paper',
    icon: '📄',
    title: '모의 거래 연동',
    content: (
      <>
        <P>
          ALT추천 신호로 진입한 모의 포지션/주문에는 <Badge color="#f0b90b">ALT추천</Badge> 배지가 표시되고,
          <code style={{ background: '#131722', borderRadius: 3, padding: '1px 4px', fontSize: '0.78rem', color: '#3b8beb' }}>altMeta</code>가 포지션에 저장됩니다.
        </P>

        <Card title="altMeta 저장 정보" accent="#f0b90b">
          <Table
            headers={['필드', '내용']}
            rows={[
              ['source', '"altscanner" — ALT추천 출처 식별자'],
              ['candidateId', '심볼_방향_스캔시간 (고유 ID)'],
              ['scanInterval', '스캔 인터벌 (15m/1h/4h/1d)'],
              ['validUntilTime', '신호 만료 시각 (TTL 기준)'],
              ['slPrice', '진입 시 SL (AltPositionMonitor 참조)'],
              ['drawingsSnapshot', '진입 시 도형 스냅샷'],
            ]}
          />
        </Card>

        <Card title="포지션 격리 & 마진 공유" accent="#3b8beb">
          <P>ALT추천 진입 포지션과 사용자가 매매탭에서 직접 진입한 포지션은 서로 독립적으로 동작합니다.</P>
          <Ul items={[
            '각 포지션은 고유한 tpPrice / slPrice를 가지므로 TP/SL이 서로 영향을 주지 않음',
            'altMeta 유무로 출처를 구분 (ALT추천 = altMeta 있음, 수동 진입 = altMeta 없음)',
            '잔고(balance)는 공유 — 두 방식의 마진 투입이 정확히 차감되어 진입 가능 마진 계산에 반영됨',
            'ALT추천 포지션의 AltPositionMonitor는 실전 모드에서도 독립적으로 동작 (isPaperMode와 무관)',
          ]} />
        </Card>

        <H2>예약 주문 (Pending Orders)</H2>
        <Ul items={[
          '지정가 주문: 마크 가격이 limitPrice 도달 시 체결',
          '조건부 주문: 다음 봉 종가 기준 close_above / close_below 체결',
          '예약 주문 탭에서 예상마진, 진입 방식, ALT 배지 확인 가능',
          '자동 스캔 시 pending 주문의 TP/SL 자동 갱신',
          '모의 가격 피드(5초 REST 폴링)는 포지션뿐 아니라 예약 주문 심볼도 포함 — 화면에 없어도 지정가/조건부 주문이 정상 체결됨',
        ]} />

        <H2>차트 스냅샷 보기</H2>
        <P>
          진입 후 ALT배지를 클릭하면 진입 당시의 도형과 차트를 그대로 복원한 스냅샷 모달이 열립니다.
          신호의 유효성을 사후에 확인하는 데 활용합니다.
        </P>
      </>
    ),
  },
  {
    id: 'live',
    icon: '⚡',
    title: '실전 거래 연동',
    content: (
      <>
        <P>
          실전 진입 버튼은 바이낸스 선물 API를 통해 지정가 주문을 즉시 접수합니다.
          TP/SL 등록, 포지션 자동 모니터링까지 세 단계로 동작합니다.
        </P>

        <Card title="① 실전 진입 로직" accent="#0ecb81">
          <Ul items={[
            '진입 방향 결정: direction → BUY(롱) / SELL(숏)',
            'PENDING 추세선 신호: triggerPriceAtNextClose로 지정가 접수 (봉마감 미확인 주의)',
            'TRIGGERED 신호: entryPrice로 즉시 지정가 접수',
            '수량 계산: 모의와 동일한 마진 기준 (실전 설정 패널에서 지정)',
          ]} />
        </Card>

        <Card title="② TP/SL 지연 등록 (pendingLiveTPSLMap)" accent="#f0b90b">
          <P>
            진입 주문 직후에는 포지션이 아직 체결되지 않아 TP/SL을 즉시 등록할 수 없습니다.
            대신 내부 대기 목록(pendingLiveTPSLMap)에 TP/SL 의도를 저장하고,
            포지션이 실제로 열린 것이 확인되면 자동으로 등록합니다.
          </P>
          <Ul items={[
            '진입 주문 성공 → TP/SL 의도를 localStorage에 저장 (최대 15분 유지)',
            'futuresAllPositions 갱신마다 해당 심볼·방향의 실제 포지션 확인',
            '포지션 확인되면 실제 체결 수량(positionAmt)으로 TP/SL 주문 자동 접수',
            '15분 이내 포지션 미확인 시 만료 — 활동 로그에 경고 기록 후 수동 설정 필요',
            '중복 접수 방지: inFlight 가드로 동일 심볼 TP/SL이 한 번만 호출됨',
          ]} />
        </Card>

        <Card title="③ 자동 청산 모니터링 (LiveAltPositionMonitor)" accent="#3b8beb">
          <P>
            모의 거래의 AltPositionMonitor와 동일하게, 실전 포지션도 scanInterval 봉 마감마다
            두 가지 조건을 자동으로 검사합니다.
          </P>
          <Table
            headers={['조건', '동작']}
            rows={[
              ['now > validUntilTime (타임스탑)', 'MARKET reduceOnly 전량 청산 + liveAltMetaMap에서 제거'],
              ['종가가 slPrice를 손실 방향으로 돌파 (구조적 무효화)', 'MARKET reduceOnly 전량 청산 + liveAltMetaMap에서 제거'],
            ]}
          />
          <Ul items={[
            '포지션이 실제로 열려 있을 때만 모니터링 컴포넌트가 마운트됨',
            '동일 봉 마감 신호가 두 번 오더라도 한 번만 청산 (firedRef 가드)',
            '청산 성공/실패 모두 활동 로그에 기록',
          ]} />
        </Card>

        <Card title="주의 사항" accent="#f6465d">
          <Ul items={[
            'PENDING 추세선 신호의 실전 진입은 봉마감을 기다리지 않음 — 봉 중간에 지정가 접수',
            '시장 변동성에 따라 지정가가 체결되지 않으면 TP/SL 대기가 15분 후 만료됨',
            '레버리지는 실전 설정에서 별도로 지정 (모의 설정과 독립)',
            '앱을 새로고침하면 pendingLiveTPSLMap이 localStorage에서 복원되어 계속 대기',
          ]} />
        </Card>
      </>
    ),
  },
  {
    id: 'chartView',
    icon: '📈',
    title: '차트 뷰 기능',
    content: (
      <>
        <H2>독립 차트 봉 전환</H2>
        <P>
          스캔 인터벌과 별개로 차트 뷰의 봉 단위를 5m / 15m / 30m / 1h / 4h / 1d로 변경할 수 있습니다.
          스캔 인터벌과 다른 봉을 선택하면 REST API로 해당 봉 데이터를 별도 fetch합니다.
        </P>
        <Card title="제약 사항" accent="#848e9c">
          <Ul items={[
            '스캔 인터벌과 다른 봉 선택 시 도형(SR선, 추세선 등)은 숨겨짐',
            '도형은 스캔 인터벌 봉 기준으로 그려지므로 다른 봉에서는 참조 불가',
            '스캔 봉으로 돌아오면 도형이 다시 표시됨',
          ]} />
        </Card>

        <H2>차트 조작법</H2>
        <Table
          headers={['동작', '효과']}
          rows={[
            ['마우스 좌우 드래그', '차트 시간 이동 (수평 이동)'],
            ['마우스 상하 드래그', '가격 범위 이동 (수직 이동)'],
            ['스크롤 (기본)', '시간 확대/축소 (X축 줌)'],
            ['Shift + 스크롤', '가격 범위 확대/축소 (Y축 줌)'],
            ['우측 가격 축 위에서 스크롤', '가격 범위 자동 Y축 줌'],
            ['더블 클릭', 'Y축 자동 맞춤 초기화'],
          ]}
        />

        <H2>레전드 바 (Legend)</H2>
        <Ul items={[
          '① 진입가 — 황색 실선',
          '② TP2 최종 목표 — 초록 실선',
          '③ TP1 1차 목표 — 연한 초록 점선',
          '④ SL 손절선 — 빨강 실선',
          '핵심 지지 레벨 — 초록 파선',
          '핵심 저항 레벨 — 빨강 파선',
          'HVN 매물대 — 골드 밴드',
        ]} />
      </>
    ),
  },
  {
    id: 'risk',
    icon: '⚠️',
    title: '위험 관리 지침',
    content: (
      <>
        <Card title="권장 리스크 관리" accent="#f0b90b">
          <Ul items={[
            '단일 진입 리스크: 잔고의 1~2% 이하 권장',
            '동시 오픈 포지션: 최대 3~5개 권장',
            '총 노출 리스크: 잔고의 10% 이하 유지',
            'RR 2.0 이상인 신호만 선별 (스캐너 기본 목표)',
            '레버리지 10x 이하 권장 (변동성 대응)',
          ]} />
        </Card>

        <H2>신호 신뢰도 높이는 법</H2>
        <Ul items={[
          <><Badge color="#0ecb81">TRIGGERED</Badge> 신호 우선 선택 (거래량 확인됨)</>,
          '스코어 70점 이상 신호 선택',
          'SR 터치 횟수 3회 이상인 레벨의 돌파',
          'HVN과 중첩된 SR 레벨은 더 강한 지지/저항',
          '상위 봉(4h, 1d)의 추세 방향과 일치하는 신호',
          '거래량 급증과 함께 발생한 돌파',
        ]} />

        <H2>신호 무시 권장 상황</H2>
        <Ul items={[
          <><Badge color="#f6465d">INVALID</Badge> / <Badge color="#848e9c">EXPIRED</Badge> 상태</>,
          '스코어 40점 미만',
          '핵심 경제 지표 발표 30분 전후',
          '비트코인이 강한 방향성 없이 횡보 중',
          '거래량이 매우 낮은 소형 알트코인',
        ]} />
      </>
    ),
  },
  {
    id: 'faq',
    icon: '❓',
    title: 'Q&A',
    content: (
      <>
        <Q q="스캔 결과가 모달을 닫았다 열면 사라지나요?">
          <p>인터벌별로 캐시되므로 한 번 스캔한 결과는 모달을 닫고 다시 열어도 유지됩니다. 앱을 새로고침하면 초기화됩니다.</p>
        </Q>
        <Q q="PENDING과 TRIGGERED 중 어떤 신호가 더 신뢰할 만한가요?">
          <p>TRIGGERED가 거래량 조건까지 충족했으므로 더 신뢰도가 높습니다. 단, 시장 상황에 따라 PENDING 신호도 유효할 수 있습니다. 스코어와 RR을 함께 참조하세요.</p>
        </Q>
        <Q q="조건부 진입이 체결되지 않는 경우는?">
          <p>다음 봉 종가가 triggerPriceAtNextClose 조건을 충족하지 못하면 체결되지 않고 예약 주문 상태로 유지됩니다. TTL 내에 조건 충족 시 자동 체결됩니다.</p>
        </Q>
        <Q q="자동 스캔과 수동 스캔의 차이는?">
          <p>자동 스캔은 봉 마감 직후 자동으로 실행되어 결과를 갱신합니다. 수동 스캔은 언제든 원하는 시점에 실행할 수 있습니다. 두 스캔 모두 동일한 로직을 사용합니다.</p>
        </Q>
        <Q q="스캔 인터벌을 바꾸면 이전 결과가 사라지나요?">
          <p>인터벌별 캐시가 유지되므로 이전 인터벌로 돌아가면 기존 스캔 결과가 복원됩니다. 캐시는 자동 스캔 시 해당 인터벌 결과로 갱신됩니다.</p>
        </Q>
        <Q q="모의 거래 마진을 직접 설정할 수 있나요?">
          <p>네, 모의 설정 패널에서 '수량 기준'을 '마진'으로 전환하면 투입할 USDT 마진을 직접 지정할 수 있습니다. 프리셋($50/$100/$200/$500) 또는 직접 입력이 가능합니다.</p>
        </Q>
        <Q q="실전 진입에서 TP/SL이 자동으로 설정되나요?">
          <p>네, 자동으로 등록됩니다. 단, 진입 주문 직후가 아닌 <strong>포지션이 실제로 체결된 것이 확인된 후</strong> 등록됩니다. 진입 즉시 내부 대기 목록(pendingLiveTPSLMap)에 TP/SL 의도가 저장되고, futuresAllPositions에서 해당 포지션이 열린 것이 감지되면 실제 체결 수량으로 TP/SL 주문이 자동 접수됩니다. 대기 시간은 최대 15분이며, 이 시간 안에 포지션이 확인되지 않으면 활동 로그에 경고가 기록되고 수동 설정이 필요합니다.</p>
        </Q>
        <Q q="실전 포지션도 타임스탑이나 SL 이탈 시 자동 청산되나요?">
          <p>네. ALT추천으로 진입된 실전 포지션은 LiveAltPositionMonitor가 scanInterval 봉 마감마다 두 가지 조건을 감시합니다. ① 신호 유효 시간(validUntilTime) 초과 시 타임스탑, ② 종가가 slPrice를 손실 방향으로 돌파 시 구조적 무효화. 두 경우 모두 MARKET reduceOnly 주문으로 전량 청산 후 활동 로그에 기록됩니다. 단, 앱이 실행 중일 때만 동작하므로 브라우저 종료 시 모니터링이 중단됩니다.</p>
        </Q>
        <Q q="여러 인터벌의 신호가 동시에 있을 때 어떻게 선택하나요?">
          <p>상위 봉(4h, 1d)과 하위 봉(15m, 1h)이 동일 방향일 때 신뢰도가 높습니다. 상위 봉의 TRIGGERED 신호와 하위 봉의 TRIGGERED 신호가 일치하면 강한 진입 근거가 됩니다.</p>
        </Q>
        <Q q="스코어가 높아도 진입하면 안 되는 경우는?">
          <p>① 신호 상태가 INVALID 또는 EXPIRED, ② 비트코인이 강한 하락 중 (알트는 더 큰 낙폭), ③ 경제 지표 발표 직전, ④ 유동성이 낮은 시간대(주말 새벽), ⑤ 이미 SL 이탈한 경우입니다.</p>
        </Q>
        <Q q="triggerPriceAtNextClose가 SL보다 낮을 수 있나요?">
          <p>추세선 기울기가 가파를 경우 발생할 수 있습니다. 이 경우 진입 시점의 실제 체결가가 SL보다 낮아 즉시 손절이 발생할 수 있으므로 차트에서 위치 관계를 반드시 확인하세요.</p>
        </Q>
        <Q q="자동매매 활성화 시 바이낸스 API 차단이 발생할 수 있나요?">
          <p>자동매매는 동시 요청 4개, 요청 간격 450ms로 분당 최대 약 2,400 weight를 사용합니다. 바이낸스 한도(2,400 weight/분) 상한에 맞춘 최대 안전 속도입니다. 단, 수동 스캔과 동시에 실행 중이라면 합산 부하가 한도를 초과할 수 있으므로 자동매매 활성 중에는 대용량 수동 스캔을 피해주세요.</p>
        </Q>
        <Q q="ALT추천 자동매매 포지션과 수동 매매 포지션은 서로 영향을 주나요?">
          <p>아니요, 완전히 독립적으로 동작합니다. 각 포지션은 고유한 TP/SL을 가지며, ALT추천 포지션은 <code>altMeta</code>로 식별됩니다. 단, 잔고는 공유되므로 두 방식의 마진 투입이 모두 차감되어 진입 가능 마진에 정확히 반영됩니다. 즉, ALT추천 포지션이 마진을 사용하면 그만큼 수동 진입 가능 금액도 줄어들고, 포지션 종료 시 해당 마진(±손익)이 잔고로 반환됩니다.</p>
        </Q>
        <Q q="격리 마진에서 SL이 청산가보다 먼저 도달될 수 있나요?">
          <p>레버리지가 높을수록 청산가가 진입가에 가까워집니다. 20x에서 청산가는 약 4.5% 손실 지점, 50x에서는 약 1.5% 손실 지점입니다. ATR 기반 SL이 이보다 더 멀리 설정되면 SL 전에 청산이 먼저 발생합니다. 진입 패널에서 레버리지를 설정하면 청산가 경고(⚠️)가 자동으로 표시됩니다. 레버리지 10x 이하 또는 교차 마진 사용을 권장합니다.</p>
        </Q>
        <Q q="자동매매로 진입한 포지션은 어디서 확인하나요?">
          <p>하단 패널의 '예약 주문' 탭(진입 대기 중) 및 '포지션' 탭(체결 후)에서 확인할 수 있습니다. 거래가 완료되면 '모의 히스토리' 탭에 기록됩니다. ALT추천 아이콘 배지가 표시된 항목이 자동매매로 진입된 포지션입니다.</p>
        </Q>
        <Q q="모의 거래 히스토리를 Excel로 내보낼 수 있나요?">
          <p>네, 하단 패널 '모의 히스토리' 탭에서 날짜 범위를 선택 후 Excel 내보내기 버튼을 클릭하면 색상 서식이 적용된 .xls 파일이 다운로드됩니다. 수익은 녹색, 손실은 빨간색으로 표시됩니다.</p>
        </Q>
      </>
    ),
  },
  {
    id: 'glossary',
    icon: '📖',
    title: '용어 사전',
    content: (
      <>
        <Table
          headers={['용어', '설명']}
          rows={[
            ['ATR', 'Average True Range — 14봉 평균 진폭. 변동성 측정 지표'],
            ['SR', 'Support & Resistance — 지지/저항 레벨'],
            ['HVN', 'High Volume Node — 대량 거래가 이루어진 가격 존'],
            ['RR', 'Risk-to-Reward Ratio — 손익비. RR 2.0 = SL 거리의 2배가 TP'],
            ['TTL', 'Time To Live — 신호 유효 시간. 초과 시 EXPIRED'],
            ['PENDING', '가격 돌파 O, 거래량 미달인 대기 신호'],
            ['TRIGGERED', '가격+거래량 모두 충족된 활성 신호'],
            ['INVALID', '핵심 레벨 이탈로 무효화된 신호'],
            ['EXPIRED', 'TTL 초과로 만료된 신호'],
            ['close_above', '다음 봉 종가 ≥ 기준가 조건부 진입 트리거'],
            ['close_below', '다음 봉 종가 ≤ 기준가 조건부 진입 트리거'],
            ['altMeta', 'ALT추천 진입 포지션에 저장되는 메타 정보'],
            ['triggerPriceAtNextClose', '다음 봉 마감 시점의 추세선 투영 가격'],
            ['SMA20', '20봉 단순 이동평균 (거래량 비교 기준)'],
            ['BB Width', '볼린저밴드 폭 — 좁을수록 횡보 중 (돌파 준비)'],
            ['volFactor', '거래량 유효성 판단 배수 (인터벌별 상이)'],
            ['TP1', '1차 목표가 — 첫 번째 강한 SR 레벨'],
            ['TP2', '최종 목표가 — RR 2.0 기준'],
            ['distanceNowPct', '현재가와 트리거 레벨 간 거리 (%)'],
            ['MMR', 'Maintenance Margin Rate — 유지증거금율 (Binance Futures: 0.5%)'],
            ['청산가 (Liq.Price)', '격리 마진에서 증거금이 소진되는 가격. 레버리지가 높을수록 진입가에 근접'],
            ['자동매매', '매 정각 백그라운드 스캔 후 90점+ 상위 2개 심볼에 자동 진입하는 기능. 포지션은 모의/실전 중 하나로만 처리됨'],
            ['Weight', 'Binance API 요청 비용 단위. 분당 2400 초과 시 일시 차단'],
          ]}
        />
      </>
    ),
  },
];

// ── Main FAQ Component ──────────────────────────────────────────────────────
export function AltScannerFAQ({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState('overview');
  const active = SECTIONS.find(s => s.id === activeId) ?? SECTIONS[0];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        display: 'flex', width: 'min(1100px, 97vw)', height: 'min(820px, 97vh)',
        background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 10, overflow: 'hidden',
      }}>
        {/* Sidebar */}
        <div style={{
          width: 200, flexShrink: 0, borderRight: '1px solid #2a2e39',
          display: 'flex', flexDirection: 'column', background: '#181c27',
        }}>
          {/* Sidebar header */}
          <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #2a2e39' }}>
            <div style={{ color: '#f0b90b', fontWeight: 700, fontSize: '0.9rem' }}>📋 ALT 매수 로직</div>
            <div style={{ color: '#5e6673', fontSize: '0.7rem', marginTop: 2 }}>완전 해설 가이드</div>
          </div>
          {/* Nav items */}
          <div style={{ flex: 1, overflowY: 'auto' as const, padding: '6px 0' }}>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                style={{
                  width: '100%', textAlign: 'left', background: activeId === s.id
                    ? 'rgba(240,185,11,0.10)' : 'none',
                  border: 'none',
                  borderLeft: `3px solid ${activeId === s.id ? '#f0b90b' : 'transparent'}`,
                  color: activeId === s.id ? '#f0b90b' : '#848e9c',
                  cursor: 'pointer', padding: '7px 12px', fontSize: '0.78rem',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7,
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontSize: '0.85rem' }}>{s.icon}</span>
                <span>{s.title}</span>
              </button>
            ))}
          </div>
          {/* Sidebar footer */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid #2a2e39' }}>
            <button
              onClick={onClose}
              style={{
                width: '100%', background: 'rgba(246,70,93,0.12)', border: '1px solid rgba(246,70,93,0.4)',
                borderRadius: 5, color: '#f6465d', cursor: 'pointer', padding: '6px 0',
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
              }}
            >닫기 ✕</button>
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Content header */}
          <div style={{
            padding: '14px 20px 12px', borderBottom: '1px solid #2a2e39',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.2rem' }}>{active.icon}</span>
              <div>
                <div style={{ color: '#d1d4dc', fontWeight: 700, fontSize: '1rem' }}>{active.title}</div>
                <div style={{ color: '#5e6673', fontSize: '0.7rem', marginTop: 1 }}>
                  {SECTIONS.findIndex(s => s.id === activeId) + 1} / {SECTIONS.length}
                </div>
              </div>
            </div>
            {/* Prev / Next */}
            <div style={{ display: 'flex', gap: 6 }}>
              {(() => {
                const idx = SECTIONS.findIndex(s => s.id === activeId);
                return (
                  <>
                    <button
                      disabled={idx === 0}
                      onClick={() => setActiveId(SECTIONS[idx - 1].id)}
                      style={{
                        background: 'none', border: '1px solid #2a2e39', borderRadius: 4,
                        color: idx === 0 ? '#2a2e39' : '#848e9c', cursor: idx === 0 ? 'default' : 'pointer',
                        padding: '3px 10px', fontSize: '0.78rem', fontFamily: 'inherit',
                      }}
                    >◀ 이전</button>
                    <button
                      disabled={idx === SECTIONS.length - 1}
                      onClick={() => setActiveId(SECTIONS[idx + 1].id)}
                      style={{
                        background: 'none', border: '1px solid #2a2e39', borderRadius: 4,
                        color: idx === SECTIONS.length - 1 ? '#2a2e39' : '#848e9c',
                        cursor: idx === SECTIONS.length - 1 ? 'default' : 'pointer',
                        padding: '3px 10px', fontSize: '0.78rem', fontFamily: 'inherit',
                      }}
                    >다음 ▶</button>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: 'auto' as const, padding: '18px 24px 24px' }}>
            {active.content}
          </div>
        </div>
      </div>
    </div>
  );
}
