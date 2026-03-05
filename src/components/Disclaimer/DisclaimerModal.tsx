import React, { useState, useCallback } from 'react';

const STORAGE_KEY = 'disclaimer-agreed-v1';

export function hasAgreedDisclaimer(): boolean {
  try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
}

interface CheckItem {
  id: string;
  title: string;
  body: string;
}

const ITEMS: CheckItem[] = [
  {
    id: 'risk',
    title: '투자 위험 고지',
    body: '선물/레버리지 거래는 원금 손실을 초과하는 손실이 발생할 수 있으며, 투자 원금의 전액 손실 가능성이 있습니다. 고위험 파생상품 거래 특성을 충분히 이해하고, 감당할 수 있는 범위 내에서 투자하시기 바랍니다. 이에 따른 모든 손실 책임은 이용자 본인에게 있습니다.',
  },
  {
    id: 'advice',
    title: '비투자자문 면책',
    body: '본 서비스는 투자 정보 제공을 목적으로 하며, 투자 권유 또는 금융 조언을 제공하지 않습니다. 모든 차트 분석, 알림, 게시물 등은 참고용으로만 활용하시고, 모든 투자 결정은 이용자 본인의 판단과 책임 하에 이루어져야 합니다.',
  },
  {
    id: 'system',
    title: '시스템 면책 (자동매매·알림·손절 모니터링)',
    body: '자동 알림, 클라이언트 SL(앱 내부 손절 모니터링), 기술적 분석 도구는 참고 목적으로만 제공됩니다. 주문 실패, 시스템 오류, 네트워크 장애, 브라우저 종료 등으로 인해 손절 주문이 실행되지 않을 수 있으며, 이로 인한 손실에 대해 본 서비스는 어떠한 책임도 지지 않습니다.',
  },
  {
    id: 'api',
    title: '외부 API 의존성 면책 (Binance)',
    body: '본 서비스는 바이낸스(Binance) API를 사용하며, 바이낸스의 서비스 장애, API 정책 변경, 거래소 규정 변경으로 인한 불이익에 대해 책임을 지지 않습니다. 바이낸스 약관 및 이용 정책 준수 여부는 이용자 본인의 책임입니다.',
  },
  {
    id: 'legal',
    title: '규제 및 법적 준수 의무',
    body: '암호화폐 파생상품(선물) 거래는 대한민국을 포함한 일부 국가에서 법적 규제 대상일 수 있습니다. 이용자는 본인이 거주하는 국가/지역의 관련 법령을 스스로 확인하고 준수할 책임이 있으며, 법적으로 허용된 지역에서만 이용하시기 바랍니다. 법령 위반으로 인한 불이익은 이용자 본인의 책임입니다.',
  },
];

interface Props {
  onAgree: () => void;
}

export function DisclaimerModal({ onAgree }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const allChecked = ITEMS.every(item => checked[item.id]);

  const toggleAll = useCallback((val: boolean) => {
    const next: Record<string, boolean> = {};
    ITEMS.forEach(item => { next[item.id] = val; });
    setChecked(next);
  }, []);

  const toggle = useCallback((id: string) => {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleAgree = useCallback(() => {
    if (!allChecked) return;
    try { localStorage.setItem(STORAGE_KEY, Date.now().toString()); } catch {}
    onAgree();
  }, [allChecked, onAgree]);

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.headerIcon}>⚠</span>
          <span style={s.headerTitle}>서비스 이용 전 반드시 확인하세요</span>
        </div>

        {/* Subtitle */}
        <div style={s.subtitle}>
          본 서비스를 이용하기 전에 아래 내용을 충분히 읽고 동의하셔야 합니다.<br />
          각 항목을 확인하고 체크박스에 동의하신 후 시작할 수 있습니다.
        </div>

        {/* Scroll area */}
        <div style={s.scrollArea}>
          {/* Select all */}
          <label style={{ ...s.checkRow, borderBottom: '1px solid #2a2e39', marginBottom: 8, paddingBottom: 10 }}>
            <input
              type="checkbox"
              checked={allChecked}
              onChange={e => toggleAll(e.target.checked)}
              style={s.checkbox}
            />
            <span style={{ ...s.checkTitle, color: '#f6c90e' }}>전체 동의</span>
          </label>

          {ITEMS.map(item => (
            <label key={item.id} style={s.checkRow} onClick={() => toggle(item.id)}>
              <input
                type="checkbox"
                checked={!!checked[item.id]}
                onChange={() => toggle(item.id)}
                style={s.checkbox}
                onClick={e => e.stopPropagation()}
              />
              <div style={{ flex: 1 }}>
                <div style={s.checkTitle}>{item.title}</div>
                <div style={s.checkBody}>{item.body}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <div style={s.footerNote}>
            동의하지 않으실 경우 본 서비스를 이용하실 수 없습니다.
          </div>
          <button
            onClick={handleAgree}
            disabled={!allChecked}
            style={{ ...s.agreeBtn, opacity: allChecked ? 1 : 0.4, cursor: allChecked ? 'pointer' : 'not-allowed' }}
          >
            동의하고 시작하기
          </button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    zIndex: 9000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    background: '#1e222d',
    border: '1px solid #2a2e39',
    borderRadius: 10,
    boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '88vh',
    maxWidth: '96vw',
    overflow: 'hidden',
    width: 640,
  },
  header: {
    alignItems: 'center',
    background: 'rgba(239,83,80,0.12)',
    borderBottom: '1px solid rgba(239,83,80,0.3)',
    display: 'flex',
    flexShrink: 0,
    gap: 10,
    padding: '14px 20px',
  },
  headerIcon: {
    color: '#ef5350',
    fontSize: '1.3rem',
  },
  headerTitle: {
    color: '#ef9a9a',
    fontSize: '1rem',
    fontWeight: 700,
  },
  subtitle: {
    borderBottom: '1px solid #2a2e39',
    color: '#848e9c',
    flexShrink: 0,
    fontSize: '0.85rem',
    lineHeight: 1.6,
    padding: '12px 20px',
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  checkRow: {
    alignItems: 'flex-start',
    background: '#12151e',
    border: '1px solid #2a2e39',
    borderRadius: 6,
    cursor: 'pointer',
    display: 'flex',
    gap: 12,
    padding: '12px 14px',
    transition: 'border-color 0.15s',
  },
  checkbox: {
    accentColor: '#2962ff',
    cursor: 'pointer',
    flexShrink: 0,
    height: 16,
    marginTop: 2,
    width: 16,
  },
  checkTitle: {
    color: '#c9d1d9',
    fontSize: '0.88rem',
    fontWeight: 600,
    marginBottom: 5,
  },
  checkBody: {
    color: '#6a7280',
    fontSize: '0.8rem',
    lineHeight: 1.6,
  },
  footer: {
    borderTop: '1px solid #2a2e39',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: 10,
    padding: '14px 20px',
  },
  footerNote: {
    color: '#4a5060',
    fontSize: '0.78rem',
    textAlign: 'center',
  },
  agreeBtn: {
    background: '#2962ff',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: '0.95rem',
    fontWeight: 700,
    padding: '11px 0',
    transition: 'opacity 0.15s',
    width: '100%',
  },
};
