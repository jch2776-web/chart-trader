import React, { useState } from 'react';
import type { TradeSettings, TradeDirection, TelegramSettings } from '../../types/trade';

interface Props {
  settings: TradeSettings;
  onChange: (s: TradeSettings) => void;
  onActivate: () => void;
  telegramSettings: TelegramSettings;
  onTelegramSettingsChange: (s: TelegramSettings) => void;
}

export function MonitorSettingsPanel({
  settings, onChange, onActivate, telegramSettings, onTelegramSettingsChange,
}: Props) {
  const set = <K extends keyof TradeSettings>(key: K, val: TradeSettings[K]) =>
    onChange({ ...settings, [key]: val });
  const setTg = <K extends keyof TelegramSettings>(key: K, val: TelegramSettings[K]) =>
    onTelegramSettingsChange({ ...telegramSettings, [key]: val });

  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');

  async function sendTestMessage() {
    if (!telegramSettings.botToken || !telegramSettings.chatId) return;
    setTestStatus('sending');
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${telegramSettings.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramSettings.chatId,
            text: '✅ Chart Trader 텔레그램 알림 연결 테스트 성공!',
          }),
        },
      );
      setTestStatus(res.ok ? 'ok' : 'err');
    } catch {
      setTestStatus('err');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  }

  return (
    <div style={styles.container}>

      {/* Direction */}
      <Section label="현재가격에서 모니터링 방향">
        <div style={styles.btnGroup3}>
          {(['long', 'short', 'both'] as TradeDirection[]).map(dir => (
            <button
              key={dir}
              style={{ ...styles.btn3, ...(settings.direction === dir ? dirStyle(dir) : {}) }}
              onClick={() => set('direction', dir)}
            >
              {dir === 'long' ? '▲ 롱' : dir === 'short' ? '▼ 숏' : '⇅ 양방향'}
            </button>
          ))}
        </div>
      </Section>

      {/* Activate button */}
      <button
        style={{
          ...styles.activateBtn,
          ...(settings.active
            ? { background: 'linear-gradient(135deg, #f0425c, #c0253a)', boxShadow: '0 0 16px rgba(240,66,92,0.3)' }
            : {}),
        }}
        onClick={onActivate}
      >
        {settings.active ? '⏹ 모니터링 중지' : '▶ 모니터링 시작'}
      </button>

      {settings.active && (
        <div style={styles.activeIndicator}>
          <span style={styles.dot} />
          돌파 감지 활성화됨
        </div>
      )}

      {/* ── Telegram ── */}
      <div style={styles.divider} />
      <Section label="텔레그램 알림">

        {/* Enable toggle */}
        <div style={styles.toggleRow}>
          <span style={styles.toggleLabel}>알림 활성화</span>
          <button
            style={{
              ...styles.toggleBtn,
              ...(telegramSettings.enabled
                ? { borderColor: '#0ecb81', color: '#0ecb81', background: 'rgba(14,203,129,0.1)' }
                : {}),
            }}
            onClick={() => setTg('enabled', !telegramSettings.enabled)}
          >
            {telegramSettings.enabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Mute when viewing */}
        <div style={styles.toggleRow}>
          <span style={styles.toggleLabel}>보는 중 텔레그램 끄기</span>
          <button
            style={{
              ...styles.toggleBtn,
              ...(settings.muteWhenViewing
                ? { borderColor: '#f0b90b', color: '#f0b90b', background: 'rgba(240,185,11,0.1)' }
                : {}),
            }}
            onClick={() => set('muteWhenViewing', !settings.muteWhenViewing)}
          >
            {settings.muteWhenViewing ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Cooldown */}
        <div style={styles.inputRow}>
          <label style={styles.inputLabel}>알람 차단 시간 (돌파 후 경과)</label>
          <select
            style={styles.select}
            value={settings.telegramCooldownMs ?? 0}
            onChange={e => set('telegramCooldownMs', Number(e.target.value))}
          >
            <option value={0}>무제한</option>
            <option value={300000}>5분</option>
            <option value={900000}>15분</option>
            <option value={3600000}>1시간</option>
            <option value={14400000}>4시간</option>
          </select>
        </div>

        {/* Bot Token */}
        <div style={styles.inputRow}>
          <label style={styles.inputLabel}>Bot Token</label>
          <input
            style={styles.textInput}
            type="password"
            placeholder="123456:ABC-DEF..."
            value={telegramSettings.botToken}
            onChange={e => setTg('botToken', e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Chat ID */}
        <div style={styles.inputRow}>
          <label style={styles.inputLabel}>Chat ID</label>
          <input
            style={styles.textInput}
            type="text"
            placeholder="-100123456789"
            value={telegramSettings.chatId}
            onChange={e => setTg('chatId', e.target.value)}
          />
        </div>

        {/* Test */}
        <button
          style={{
            ...styles.testBtn,
            ...(testStatus === 'ok'  ? { borderColor: '#0ecb81', color: '#0ecb81' } : {}),
            ...(testStatus === 'err' ? { borderColor: '#f0425c', color: '#f0425c' } : {}),
            opacity: (!telegramSettings.botToken || !telegramSettings.chatId) ? 0.4 : 1,
          }}
          disabled={testStatus === 'sending' || !telegramSettings.botToken || !telegramSettings.chatId}
          onClick={sendTestMessage}
        >
          {testStatus === 'sending' ? '전송 중...'
            : testStatus === 'ok'   ? '✓ 성공'
            : testStatus === 'err'  ? '✗ 실패'
            : '테스트 전송'}
        </button>

        <div style={styles.tgHint}>
          @BotFather에서 봇 생성 → Token 발급<br />
          @userinfobot으로 Chat ID 확인
        </div>
      </Section>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: '0.85rem', color: '#4a5568', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function dirStyle(dir: TradeDirection): React.CSSProperties {
  return {
    borderColor: dir === 'long' ? '#22d991' : dir === 'short' ? '#f0425c' : '#3b8beb',
    color:       dir === 'long' ? '#22d991' : dir === 'short' ? '#f0425c' : '#3b8beb',
    background:  dir === 'long'  ? 'rgba(34,217,145,0.1)'
                : dir === 'short' ? 'rgba(240,66,92,0.1)'
                : 'rgba(59,139,235,0.1)',
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container:      { padding: '12px 10px', overflowY: 'auto', flex: 1 },
  btnGroup3:      { display: 'flex', gap: 4 },
  btn3: {
    flex: 1, background: '#0d1520', border: '1px solid #1a2030', borderRadius: 4,
    color: '#6a7888', cursor: 'pointer', fontSize: '0.85rem', padding: '6px 4px',
    transition: 'all 0.1s', textAlign: 'center' as const,
  },
  activateBtn: {
    width: '100%', padding: '10px',
    background: 'linear-gradient(135deg, #22d991, #16a066)',
    border: 'none', borderRadius: 6, color: '#080b12', fontWeight: 700,
    fontSize: '1rem', cursor: 'pointer', letterSpacing: '0.03em',
    boxShadow: '0 0 16px rgba(34,217,145,0.25)', transition: 'all 0.15s',
  },
  activeIndicator: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '0.85rem', color: '#22d991' },
  dot: { width: 6, height: 6, borderRadius: '50%', background: '#22d991', animation: 'pulse 1.5s infinite', display: 'inline-block' },
  divider: { height: 1, background: '#2a2e39', margin: '12px 0 16px' },
  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  toggleLabel: { fontSize: '0.92rem', color: '#848e9c' },
  toggleBtn: {
    background: '#0d1520', border: '1px solid #1a2030', borderRadius: 4,
    color: '#6a7888', cursor: 'pointer', fontSize: '0.85rem', padding: '3px 10px',
    fontWeight: 700, fontFamily: '"SF Mono", Consolas, monospace', transition: 'all 0.1s',
  },
  inputRow:   { marginBottom: 8 },
  inputLabel: { display: 'block', fontSize: '0.77rem', color: '#5e6673', marginBottom: 3, fontWeight: 600 },
  textInput: {
    width: '100%', background: '#0d1520', border: '1px solid #1a2030', borderRadius: 4,
    color: '#d1d4dc', fontSize: '0.85rem', padding: '5px 8px', outline: 'none',
    boxSizing: 'border-box' as const, fontFamily: '"SF Mono", Consolas, monospace',
  },
  select: {
    width: '100%', background: '#0d1520', border: '1px solid #1a2030', borderRadius: 4,
    color: '#d1d4dc', fontSize: '0.85rem', padding: '5px 8px', outline: 'none',
    boxSizing: 'border-box' as const, cursor: 'pointer', fontFamily: '"SF Mono", Consolas, monospace',
  },
  testBtn: {
    width: '100%', background: 'none', border: '1px solid #2a2e39', borderRadius: 4,
    color: '#848e9c', cursor: 'pointer', fontSize: '0.85rem', padding: '6px',
    transition: 'all 0.1s', fontFamily: 'inherit', marginBottom: 8,
  },
  tgHint: { fontSize: '0.77rem', color: '#4a5568', lineHeight: 1.6 },
};
