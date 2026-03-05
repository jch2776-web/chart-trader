import React, { useState } from 'react';
import { login, register } from '../../hooks/useAuth';

export function LoginPage() {
  const [mode, setMode]       = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    const err = mode === 'login'
      ? login(username, password)
      : register(username, password);
    if (err) { setError(err); return; }
    window.location.reload();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoRow}>
          <span style={styles.logoMark}>◈</span>
          <span style={styles.logoText}>Chart Trader</span>
        </div>
        <div style={styles.subtitle}>개인화된 바이낸스 선물 차트</div>

        {/* Tabs */}
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => { setMode('login'); setError(null); }}
          >
            로그인
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'register' ? styles.tabActive : {}) }}
            onClick={() => { setMode('register'); setError(null); }}
          >
            계정 만들기
          </button>
        </div>

        {/* Username */}
        <div style={styles.field}>
          <label style={styles.label}>아이디</label>
          <input
            style={styles.input}
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={handleKey}
            placeholder="아이디 입력"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Password */}
        <div style={styles.field}>
          <label style={styles.label}>비밀번호{mode === 'register' ? ' (4자 이상)' : ''}</label>
          <div style={{ position: 'relative' }}>
            <input
              style={{ ...styles.input, paddingRight: 36 }}
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKey}
              placeholder="비밀번호 입력"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            <button
              style={styles.eyeBtn}
              onClick={() => setShowPw(v => !v)}
              type="button"
              title={showPw ? '숨기기' : '표시'}
            >
              {showPw ? '○' : '●'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && <div style={styles.errorMsg}>{error}</div>}

        {/* Submit */}
        <button style={styles.submitBtn} onClick={handleSubmit}>
          {mode === 'login' ? '로그인' : '계정 만들기'}
        </button>

        {/* Notice */}
        <div style={styles.notice}>
          ⚠ 계정 정보 및 모든 설정은 이 기기의 브라우저 localStorage에만 저장됩니다.
          공용 PC에서는 사용 후 반드시 로그아웃하세요.
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: '#0d1117',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  card: {
    background: '#1e222d',
    border: '1px solid #2a2e39',
    borderRadius: 10,
    padding: '32px 28px 24px',
    width: 340,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 2,
  },
  logoMark: {
    color: '#f0b90b',
    fontSize: '1.6rem',
    lineHeight: 1,
  },
  logoText: {
    color: '#d1d4dc',
    fontSize: '1.3rem',
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  subtitle: {
    color: '#5e6673',
    fontSize: '0.8rem',
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 4,
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #2a2e39',
    marginBottom: 4,
  },
  tab: {
    flex: 1,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.88rem',
    fontWeight: 500,
    padding: '8px 4px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
  },
  tabActive: {
    borderBottom: '2px solid #f0b90b',
    color: '#d1d4dc',
    fontWeight: 700,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  label: {
    color: '#5e6673',
    fontSize: '0.77rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  input: {
    width: '100%',
    background: '#0d1520',
    border: '1px solid #2a2e39',
    borderRadius: 5,
    color: '#d1d4dc',
    fontSize: '0.9rem',
    padding: '9px 10px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  },
  eyeBtn: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#5e6673',
    cursor: 'pointer',
    fontSize: '0.7rem',
    padding: '2px 4px',
    lineHeight: 1,
  },
  errorMsg: {
    background: 'rgba(246,70,93,0.08)',
    border: '1px solid rgba(246,70,93,0.2)',
    borderRadius: 4,
    color: '#f6465d',
    fontSize: '0.8rem',
    padding: '7px 10px',
  },
  submitBtn: {
    background: '#f0b90b',
    border: 'none',
    borderRadius: 5,
    color: '#1a1200',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: 700,
    padding: '11px',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
    marginTop: 2,
  },
  notice: {
    background: 'rgba(240,185,11,0.06)',
    border: '1px solid rgba(240,185,11,0.18)',
    borderRadius: 4,
    color: '#7a6b2e',
    fontSize: '0.72rem',
    lineHeight: 1.6,
    padding: '8px 10px',
    marginTop: 2,
  },
};
