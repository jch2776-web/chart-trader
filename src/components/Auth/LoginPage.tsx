import React, { useState, useEffect, useRef, useCallback } from 'react';
import { login, register } from '../../hooks/useAuth';

// ── reCAPTCHA v2 ─────────────────────────────────────────────────────────────
// Replace with your real site key from https://www.google.com/recaptcha/admin
const RECAPTCHA_SITE_KEY = '6LfRWossAAAAAAMrPteTgRbmi53_4mvGj7xKll2l';

declare global {
  interface Window {
    grecaptcha: {
      render: (container: HTMLElement, params: object) => number;
      reset: (widgetId?: number) => void;
      getResponse: (widgetId?: number) => string;
    };
    _onRecaptchaLoad: () => void;
  }
}

export function LoginPage() {
  const [mode, setMode]         = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [captchaDone, setCaptchaDone] = useState(false);

  const captchaContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef         = useRef<number | null>(null);
  const scriptLoadedRef     = useRef(false);

  const renderWidget = useCallback(() => {
    if (!captchaContainerRef.current || widgetIdRef.current !== null) return;
    if (typeof window.grecaptcha?.render !== 'function') return;
    widgetIdRef.current = window.grecaptcha.render(captchaContainerRef.current, {
      sitekey: RECAPTCHA_SITE_KEY,
      theme: 'dark',
      callback: () => setCaptchaDone(true),
      'expired-callback': () => setCaptchaDone(false),
      'error-callback': () => setCaptchaDone(false),
    });
  }, []);

  useEffect(() => {
    // If reCAPTCHA already loaded (e.g. hot-reload), render immediately
    if (typeof window.grecaptcha?.render === 'function') {
      renderWidget();
      return;
    }
    // Otherwise load the script once
    if (!scriptLoadedRef.current && !document.querySelector('script[data-recaptcha]')) {
      scriptLoadedRef.current = true;
      window._onRecaptchaLoad = renderWidget;
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?onload=_onRecaptchaLoad&render=explicit&hl=ko`;
      script.setAttribute('data-recaptcha', '1');
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else {
      // Script tag already exists but grecaptcha not yet ready — wait
      const poll = setInterval(() => {
        if (typeof window.grecaptcha?.render === 'function') {
          clearInterval(poll);
          renderWidget();
        }
      }, 200);
      return () => clearInterval(poll);
    }
  }, [renderWidget]);

  // Reset captcha when mode changes
  useEffect(() => {
    setCaptchaDone(false);
    if (widgetIdRef.current !== null && typeof window.grecaptcha?.reset === 'function') {
      window.grecaptcha.reset(widgetIdRef.current);
    }
  }, [mode]);

  const handleSubmit = () => {
    setError(null);
    if (!captchaDone) {
      setError('보안 확인을 완료해주세요.');
      return;
    }
    const err = mode === 'login'
      ? login(username, password)
      : register(username, password);
    if (err) {
      setError(err);
      // Reset captcha on failure so user must redo it
      setCaptchaDone(false);
      if (widgetIdRef.current !== null && typeof window.grecaptcha?.reset === 'function') {
        window.grecaptcha.reset(widgetIdRef.current);
      }
      return;
    }
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
        <div style={styles.subtitle}>자동화된 트레이딩 도구</div>

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

        {/* reCAPTCHA */}
        <div style={styles.captchaWrap}>
          <div ref={captchaContainerRef} />
        </div>

        {/* Error */}
        {error && <div style={styles.errorMsg}>{error}</div>}

        {/* Submit */}
        <button
          style={{ ...styles.submitBtn, ...(!captchaDone ? styles.submitBtnDisabled : {}) }}
          onClick={handleSubmit}
          disabled={!captchaDone}
        >
          {mode === 'login' ? '로그인' : '계정 만들기'}
        </button>

        {/* Notice */}
        <div style={styles.notice}>
          ⚠ 본 사이트는 Binance 거래소와 무관한 독립 트레이딩 도구입니다. 거래의 모든 책임은 이용자 본인에게 있으며, 본 사이트는 참고 목적으로만 사용하십시오.<br /><br />
          계정 정보 및 모든 설정은 이 기기의 브라우저 localStorage에만 저장됩니다. 공용 PC에서는 사용 후 반드시 로그아웃하세요.
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
  captchaWrap: {
    display: 'flex',
    justifyContent: 'center',
    minHeight: 78,
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
  submitBtnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  notice: {
    background: 'rgba(240,185,11,0.06)',
    border: '1px solid rgba(240,185,11,0.18)',
    borderRadius: 4,
    color: '#7a6b2e',
    fontSize: '0.72rem',
    lineHeight: 1.65,
    padding: '8px 10px',
    marginTop: 2,
  },
};
