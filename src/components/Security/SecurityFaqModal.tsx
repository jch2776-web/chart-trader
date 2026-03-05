import React, { useState, useCallback } from 'react';

interface FaqItem {
  id: string;
  category: 'api' | 'auth' | 'sl' | 'data' | 'usage';
  q: string;
  a: React.ReactNode;
  risk?: 'high' | 'medium' | 'info';
}

const CATEGORY_LABELS: Record<FaqItem['category'], string> = {
  api:   'API 키',
  auth:  '로그인/인증',
  sl:    '손절 모니터링',
  data:  '데이터 보관',
  usage: '이용 환경',
};

const RISK_COLORS: Record<string, string> = {
  high:   '#ef5350',
  medium: '#f0b90b',
  info:   '#4a90d9',
};

const ITEMS: FaqItem[] = [
  // ── API 키 ───────────────────────────────────────────────────────────────
  {
    id: 'api-storage',
    category: 'api',
    risk: 'info',
    q: 'API 키는 어디에 저장되나요? 외부로 유출될 수 있나요?',
    a: (
      <>
        API 키와 시크릿은 <strong>사용자 브라우저의 localStorage에만</strong> 저장됩니다.
        이 서비스의 서버나 제3자 시스템으로 전송되지 않습니다.<br /><br />
        바이낸스 API에 요청 시 필요한 서명(HMAC-SHA256)도 브라우저 내에서 직접 계산되며,
        시크릿 키 자체는 바이낸스 서버로 전송되지 않습니다.
        요청은 <code>브라우저 → 바이낸스 API</code> 경로로 직접 이루어집니다.
      </>
    ),
  },
  {
    id: 'api-permissions',
    category: 'api',
    risk: 'high',
    q: 'API 키에 어떤 권한을 설정해야 안전한가요?',
    a: (
      <>
        <strong style={{ color: '#ef5350' }}>출금(Withdrawal) 권한은 절대 부여하지 마세요.</strong><br /><br />
        필요한 권한은 <strong>선물 거래(Futures Trading)</strong> 권한 하나입니다.
        현물 거래를 사용하지 않는다면 현물 거래 권한도 불필요합니다.<br /><br />
        추가로 <strong>IP 화이트리스트</strong>를 설정하면 API 키가 유출되더라도
        등록된 IP에서만 사용 가능해 피해를 최소화할 수 있습니다.
      </>
    ),
  },
  {
    id: 'api-assets',
    category: 'api',
    risk: 'info',
    q: '이 서비스가 내 자산에 마음대로 접근하거나 출금할 수 있나요?',
    a: (
      <>
        아니요. 이 서비스는 부여된 API 권한 범위 내에서만 동작합니다.
        권장대로 선물 거래 권한만 부여하면 <strong>출금, 현물 이체, 계좌 설정 변경이 불가능</strong>합니다.<br /><br />
        주문 실행은 트리거 조건이 발생한 경우에만 이루어지며,
        실행 모드를 <strong>'알림만'</strong>으로 설정하면 주문 자체가 실행되지 않습니다.
      </>
    ),
  },

  // ── 로그인/인증 ────────────────────────────────────────────────────────────
  {
    id: 'auth-security',
    category: 'auth',
    risk: 'medium',
    q: '로그인 비밀번호는 암호화되어 저장되나요?',
    a: (
      <>
        이 서비스의 로그인은 <strong>단일 디바이스 개인화</strong>를 위한 간이 인증입니다.
        비밀번호는 <code>btoa()</code>(Base64) 인코딩으로 저장되며,
        <strong style={{ color: '#f0b90b' }}> 암호학적으로 안전한 해시가 아닙니다.</strong><br /><br />
        이 인증은 "나의 설정을 분리"하는 용도입니다.
        중요한 계정 정보 보호가 목적이 아니므로,
        <strong> 타인과 공유하는 기기에서는 사용하지 마세요.</strong>
        API 키 보안은 브라우저 localStorage 접근 제한에 의존합니다.
      </>
    ),
  },
  {
    id: 'auth-root',
    category: 'auth',
    risk: 'info',
    q: '관리자(root) 계정이 있다고 들었는데, 보안 문제가 없나요?',
    a: (
      <>
        관리자 계정은 유저 게시판의 공지 글 고정 기능에만 사용됩니다.
        API 키나 트레이딩 설정과는 완전히 분리되어 있습니다.<br /><br />
        모든 계정의 데이터는 <code>u:계정명:키</code> 형식으로 localStorage에 네임스페이스 분리되어 저장됩니다.
      </>
    ),
  },

  // ── 클라이언트 SL ──────────────────────────────────────────────────────────
  {
    id: 'sl-limitation',
    category: 'sl',
    risk: 'high',
    q: '클라이언트 SL(앱 내부 손절)은 언제 작동하지 않나요?',
    a: (
      <>
        클라이언트 SL은 <strong>이 앱(브라우저 탭)이 열려 있는 동안에만</strong> 감시합니다.
        다음 상황에서는 손절이 실행되지 않습니다:<br /><br />
        <ul style={{ margin: '4px 0 0 16px', padding: 0, lineHeight: 1.8 }}>
          <li>브라우저 탭 또는 창을 닫은 경우</li>
          <li>PC를 절전/종료한 경우</li>
          <li>인터넷 연결이 끊긴 경우</li>
          <li>바이낸스 API 또는 네트워크 오류 발생 시</li>
        </ul>
        <br />
        <strong style={{ color: '#ef5350' }}>
          중요한 포지션은 반드시 바이낸스 앱/웹에서 직접 손절가를 설정하세요.
        </strong>
      </>
    ),
  },
  {
    id: 'sl-vs-exchange',
    category: 'sl',
    risk: 'info',
    q: '클라이언트 SL과 바이낸스 거래소 SL의 차이는 무엇인가요?',
    a: (
      <>
        <strong>바이낸스 거래소 SL</strong>은 거래소 서버에 주문이 등록되어
        브라우저를 닫아도 24시간 작동합니다.<br /><br />
        <strong>클라이언트 SL</strong>은 이 앱이 실시간 가격을 감시하다가
        손절 조건 도달 시 API로 시장가 주문을 전송하는 방식입니다.
        브라우저 종료 시 모니터링이 중단됩니다.<br /><br />
        클라이언트 SL은 거래소 SL 설정이 불편한 상황에서 보조 수단으로만 활용하세요.
      </>
    ),
  },

  // ── 데이터 보관 ────────────────────────────────────────────────────────────
  {
    id: 'data-source',
    category: 'data',
    risk: 'info',
    q: '가격, 차트 데이터는 어디서 가져오나요? 중간 서버가 있나요?',
    a: (
      <>
        모든 가격·차트 데이터는 <strong>바이낸스(Binance) 공개 API</strong>에서
        브라우저가 직접 가져옵니다. 중간 서버(프록시)가 없습니다.<br /><br />
        데이터 흐름:<br />
        <code>브라우저 ↔ fapi.binance.com (REST / WebSocket)</code><br /><br />
        따라서 바이낸스 서비스 장애 또는 API 정책 변경 시 일부 기능이 동작하지 않을 수 있습니다.
      </>
    ),
  },
  {
    id: 'data-telegram',
    category: 'data',
    risk: 'medium',
    q: '텔레그램 봇 토큰이 유출될 수 있나요?',
    a: (
      <>
        텔레그램 봇 토큰과 채팅 ID는 <strong>브라우저 localStorage에 저장</strong>됩니다.
        이 서비스의 서버로 전송되지 않으며,
        알림 발송 시 <code>브라우저 → api.telegram.org</code>로 직접 요청됩니다.<br /><br />
        단, 타인과 기기를 공유하는 경우 localStorage에 접근할 수 있으므로
        <strong> 개인 전용 기기에서만 사용</strong>하세요.
        토큰 유출이 의심되면 텔레그램 @BotFather에서 즉시 재발급하세요.
      </>
    ),
  },
  {
    id: 'data-userboard',
    category: 'data',
    risk: 'info',
    q: '유저 게시판에 쓴 글은 어디에 저장되며 누구나 볼 수 있나요?',
    a: (
      <>
        유저 게시판 글은 <strong>Firebase Firestore</strong>에 저장됩니다.
        게시물은 서비스 이용자 모두에게 공개됩니다.<br /><br />
        <strong style={{ color: '#f0b90b' }}>
          개인정보, API 키, 비밀번호, 금융 계좌 정보 등 민감한 내용을 절대 게시하지 마세요.
        </strong><br /><br />
        게시물 삭제는 작성 시 설정한 비밀번호로 가능합니다.
        비밀번호를 분실하면 삭제가 불가능하므로 주의하세요.
      </>
    ),
  },

  // ── 이용 환경 ──────────────────────────────────────────────────────────────
  {
    id: 'usage-shared-pc',
    category: 'usage',
    risk: 'high',
    q: '카페, 도서관 등 공용 PC에서 사용해도 되나요?',
    a: (
      <>
        <strong style={{ color: '#ef5350' }}>강력히 권장하지 않습니다.</strong><br /><br />
        API 키, 비밀번호, 텔레그램 토큰이 모두 localStorage에 저장되므로,
        사용 후 반드시 다음을 모두 수행하세요:<br /><br />
        <ol style={{ margin: '4px 0 0 16px', padding: 0, lineHeight: 1.9 }}>
          <li>API 키 패널에서 <strong>초기화</strong> 버튼 클릭</li>
          <li><strong>로그아웃</strong> 후 로그인 화면 확인</li>
          <li>브라우저 <strong>방문 기록 및 사이트 데이터 삭제</strong></li>
        </ol>
        <br />
        또는 처음부터 <strong>시크릿(비공개) 모드</strong>에서 사용하면 브라우저 종료 시 데이터가 자동 삭제됩니다.
      </>
    ),
  },
  {
    id: 'usage-no-server',
    category: 'usage',
    risk: 'info',
    q: '이 서비스에 별도 서버가 있나요? 내 데이터가 수집되나요?',
    a: (
      <>
        이 서비스는 <strong>백엔드 서버가 없는 순수 클라이언트 앱</strong>입니다.
        설정, API 키, 차트 도형 등 모든 데이터는 <strong>내 브라우저 localStorage에만</strong> 저장됩니다.<br /><br />
        단, 유저 게시판 기능은 Firebase Firestore를 사용하며,
        게시물 내용이 Google Firebase 서버에 저장됩니다.
        게시판을 사용하지 않으면 외부 서버와의 데이터 공유는 없습니다.
      </>
    ),
  },
  {
    id: 'usage-browser-extension',
    category: 'usage',
    risk: 'medium',
    q: '브라우저 확장 프로그램이 API 키를 훔쳐갈 수 있나요?',
    a: (
      <>
        이론적으로 <strong>악성 브라우저 확장 프로그램은 localStorage에 접근 가능</strong>합니다.
        신뢰할 수 없는 확장 프로그램이 설치된 환경에서는 API 키가 노출될 수 있습니다.<br /><br />
        보안 강화 방법:<br />
        <ul style={{ margin: '4px 0 0 16px', padding: 0, lineHeight: 1.8 }}>
          <li>불필요하거나 검증되지 않은 확장 프로그램 제거</li>
          <li>바이낸스에서 API 키에 <strong>IP 화이트리스트</strong> 적용</li>
          <li>출금 권한 미부여 상태 유지</li>
        </ul>
      </>
    ),
  },
];

// ── Accordion item ─────────────────────────────────────────────────────────────

function FaqAccordion({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);

  const riskColor = item.risk ? RISK_COLORS[item.risk] : undefined;

  return (
    <div style={{ ...s.faqItem, borderColor: open ? (riskColor ?? '#3a3e4a') : '#2a2e39' }}>
      <button style={s.faqQuestion} onClick={() => setOpen(v => !v)}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
          {item.risk && (
            <span style={{ ...s.riskDot, background: riskColor, flexShrink: 0, marginTop: 3 }} />
          )}
          <span style={{ flex: 1, textAlign: 'left', lineHeight: 1.5 }}>{item.q}</span>
        </div>
        <span style={{ ...s.chevron, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </button>
      {open && (
        <div style={s.faqAnswer}>
          {item.a}
        </div>
      )}
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

const CATEGORIES = Array.from(new Set(ITEMS.map(i => i.category))) as FaqItem['category'][];

export function SecurityFaqModal({ onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<FaqItem['category'] | 'all'>('all');

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const visible = activeCategory === 'all'
    ? ITEMS
    : ITEMS.filter(i => i.category === activeCategory);

  const riskCounts = {
    high:   ITEMS.filter(i => i.risk === 'high').length,
    medium: ITEMS.filter(i => i.risk === 'medium').length,
  };

  return (
    <div style={s.overlay} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div style={s.modal}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={s.headerIcon}>🔒</span>
            <div>
              <div style={s.headerTitle}>보안 FAQ</div>
              <div style={s.headerSub}>신규 사용자를 위한 보안 안내</div>
            </div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Risk legend */}
        <div style={s.legend}>
          <span style={s.legendItem}>
            <span style={{ ...s.riskDot, background: RISK_COLORS.high }} />
            반드시 숙지 ({riskCounts.high}건)
          </span>
          <span style={s.legendItem}>
            <span style={{ ...s.riskDot, background: RISK_COLORS.medium }} />
            주의 사항 ({riskCounts.medium}건)
          </span>
          <span style={s.legendItem}>
            <span style={{ ...s.riskDot, background: RISK_COLORS.info }} />
            일반 안내
          </span>
        </div>

        {/* Category tabs */}
        <div style={s.categoryBar}>
          {(['all', ...CATEGORIES] as const).map(cat => (
            <button
              key={cat}
              style={{ ...s.catBtn, ...(activeCategory === cat ? s.catBtnActive : {}) }}
              onClick={() => setActiveCategory(cat)}
            >
              {cat === 'all' ? `전체 (${ITEMS.length})` : CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* FAQ list */}
        <div style={s.scrollArea}>
          {visible.map(item => (
            <FaqAccordion key={item.id} item={item} />
          ))}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <span style={s.footerNote}>
            보안 관련 문의나 취약점 발견 시 관리자에게 알려주세요.
            API 키 이상 거래 발견 시 즉시 바이낸스에서 키를 삭제하세요.
          </span>
          <button style={s.closeFullBtn} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    zIndex: 8000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    background: '#1e222d',
    border: '1px solid #2a2e39',
    borderRadius: 10,
    boxShadow: '0 16px 60px rgba(0,0,0,0.65)',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '90vh',
    maxWidth: '96vw',
    overflow: 'hidden',
    width: 680,
  },
  header: {
    alignItems: 'center',
    background: 'rgba(59,139,235,0.07)',
    borderBottom: '1px solid rgba(59,139,235,0.2)',
    display: 'flex',
    flexShrink: 0,
    justifyContent: 'space-between',
    padding: '14px 20px',
  },
  headerIcon: {
    fontSize: '1.6rem',
  },
  headerTitle: {
    color: '#c9d1d9',
    fontSize: '1.05rem',
    fontWeight: 700,
  },
  headerSub: {
    color: '#5e6673',
    fontSize: '0.78rem',
    marginTop: 2,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: '4px 8px',
    borderRadius: 4,
    lineHeight: 1,
  },
  legend: {
    display: 'flex',
    gap: 16,
    padding: '8px 20px',
    borderBottom: '1px solid #2a2e39',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#5e6673',
    fontSize: '0.76rem',
  },
  riskDot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  categoryBar: {
    display: 'flex',
    gap: 4,
    padding: '8px 16px',
    borderBottom: '1px solid #2a2e39',
    flexShrink: 0,
    overflowX: 'auto',
  },
  catBtn: {
    background: 'none',
    border: '1px solid #2a2e39',
    borderRadius: 4,
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.76rem',
    fontWeight: 600,
    padding: '3px 10px',
    transition: 'all 0.12s',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  catBtnActive: {
    background: 'rgba(59,139,235,0.1)',
    borderColor: '#3b8beb',
    color: '#3b8beb',
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  faqItem: {
    background: '#12151e',
    border: '1px solid #2a2e39',
    borderRadius: 6,
    overflow: 'hidden',
    transition: 'border-color 0.15s',
  },
  faqQuestion: {
    alignItems: 'flex-start',
    background: 'none',
    border: 'none',
    color: '#c9d1d9',
    cursor: 'pointer',
    display: 'flex',
    fontSize: '0.86rem',
    fontWeight: 600,
    gap: 8,
    justifyContent: 'space-between',
    padding: '12px 14px',
    textAlign: 'left',
    width: '100%',
    fontFamily: 'inherit',
    lineHeight: 1.5,
  },
  chevron: {
    color: '#5e6673',
    flexShrink: 0,
    fontSize: '0.9rem',
    marginLeft: 4,
    transition: 'transform 0.2s',
    marginTop: 1,
  },
  faqAnswer: {
    borderTop: '1px solid #1e2233',
    color: '#848e9c',
    fontSize: '0.82rem',
    lineHeight: 1.75,
    padding: '12px 14px 14px',
  },
  footer: {
    borderTop: '1px solid #2a2e39',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: 12,
    padding: '12px 20px',
    justifyContent: 'space-between',
  },
  footerNote: {
    color: '#3a4558',
    fontSize: '0.74rem',
    lineHeight: 1.5,
    flex: 1,
  },
  closeFullBtn: {
    background: 'rgba(59,139,235,0.1)',
    border: '1px solid rgba(59,139,235,0.3)',
    borderRadius: 5,
    color: '#3b8beb',
    cursor: 'pointer',
    fontSize: '0.88rem',
    fontWeight: 600,
    padding: '7px 20px',
    flexShrink: 0,
    fontFamily: 'inherit',
  },
};
