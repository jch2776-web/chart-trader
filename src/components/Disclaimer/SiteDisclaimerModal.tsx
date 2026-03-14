import React from 'react';

interface Props {
  onConfirm: () => void;
}

export function SiteDisclaimerModal({ onConfirm }: Props) {
  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.header}>
          <span style={s.headerIcon}>⚠</span>
          <span style={s.headerTitle}>이용 전 필수 고지사항</span>
        </div>

        <div style={s.body}>
          <div style={s.noticeBox}>
            <div style={s.noticeTitle}>본 사이트는 Binance 거래소가 아닙니다</div>
            <div style={s.noticeText}>
              이 사이트(<strong style={{ color: '#c9d1d9' }}>The Chart Trader</strong>)는 Binance 거래소(binance.com)와
              무관한 <strong style={{ color: '#c9d1d9' }}>독립적인 제3자 트레이딩 도구</strong>입니다.
              Binance 또는 그 계열사와 어떠한 공식적 제휴·협력·인증 관계가 없습니다.
            </div>
          </div>

          <div style={s.itemList}>
            <div style={s.item}>
              <span style={s.bullet}>•</span>
              <span>
                본 사이트는 Binance 공개 API를 활용한 참고용 도구이며,
                <strong style={{ color: '#f0b90b' }}> 투자 권유 또는 금융 조언을 제공하지 않습니다.</strong>
              </span>
            </div>
            <div style={s.item}>
              <span style={s.bullet}>•</span>
              <span>
                모든 거래(진입·청산·손절 등)의 결정과 그에 따른
                <strong style={{ color: '#ef5350' }}> 손익 및 법적 책임은 전적으로 이용자 본인에게 있습니다.</strong>
              </span>
            </div>
            <div style={s.item}>
              <span style={s.bullet}>•</span>
              <span>
                시스템 오류, 네트워크 장애, API 제한 등으로 인한 거래 미실행·손실에 대해
                본 사이트는 어떠한 책임도 지지 않습니다.
              </span>
            </div>
            <div style={s.item}>
              <span style={s.bullet}>•</span>
              <span>
                본 사이트의 모든 기능(자동매매·알림·분석·차트 등)은
                <strong style={{ color: '#c9d1d9' }}> 참고 목적으로만</strong> 사용하시기 바랍니다.
              </span>
            </div>
          </div>

          <div style={s.disclaimer}>
            위 내용을 충분히 이해하였으며, 모든 거래 책임이 본인에게 있음에 동의합니다.
          </div>
        </div>

        <div style={s.footer}>
          <button style={s.confirmBtn} onClick={onConfirm}>
            확인하고 계속하기
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
    background: 'rgba(0,0,0,0.88)',
    zIndex: 9500,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    background: '#1e222d',
    border: '1px solid #2a2e39',
    borderRadius: 10,
    boxShadow: '0 16px 60px rgba(0,0,0,0.75)',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '90vh',
    maxWidth: '96vw',
    overflow: 'hidden',
    width: 560,
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
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  noticeBox: {
    background: 'rgba(239,83,80,0.07)',
    border: '1px solid rgba(239,83,80,0.3)',
    borderRadius: 7,
    padding: '12px 14px',
  },
  noticeTitle: {
    color: '#ef9a9a',
    fontSize: '0.95rem',
    fontWeight: 700,
    marginBottom: 6,
  },
  noticeText: {
    color: '#848e9c',
    fontSize: '0.84rem',
    lineHeight: 1.65,
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 9,
  },
  item: {
    display: 'flex',
    gap: 8,
    color: '#848e9c',
    fontSize: '0.83rem',
    lineHeight: 1.6,
    alignItems: 'flex-start',
  },
  bullet: {
    color: '#f0b90b',
    flexShrink: 0,
    fontSize: '0.9rem',
    marginTop: 1,
  },
  disclaimer: {
    background: 'rgba(240,185,11,0.06)',
    border: '1px solid rgba(240,185,11,0.2)',
    borderRadius: 5,
    color: '#8a7930',
    fontSize: '0.78rem',
    lineHeight: 1.6,
    padding: '9px 12px',
    textAlign: 'center',
  },
  footer: {
    borderTop: '1px solid #2a2e39',
    flexShrink: 0,
    padding: '14px 20px',
  },
  confirmBtn: {
    background: '#ef5350',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.95rem',
    fontWeight: 700,
    padding: '11px 0',
    transition: 'opacity 0.15s',
    width: '100%',
  },
};
