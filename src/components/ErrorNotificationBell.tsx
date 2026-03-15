import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ActivityLog } from '../types/trade';

interface Props {
  logs: ActivityLog[];
  onClear: () => void;
}

const MAX_SHOWN = 100;

const TYPE_ICON: Record<ActivityLog['type'], string> = {
  error:  '✕',
  signal: '⚡',
  order:  '✓',
  info:   '·',
};
const TYPE_COLOR: Record<ActivityLog['type'], string> = {
  error:  '#ef5350',
  signal: '#e8b73a',
  order:  '#22d991',
  info:   '#848e9c',
};

export function ErrorNotificationBell({ logs, onClear }: Props) {
  const [open, setOpen]           = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef   = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const badge = logs.length - seenCount;
  const hasError = logs.some(l => l.type === 'error');

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!(buttonRef.current?.contains(target) ?? false) && !(dropdownRef.current?.contains(target) ?? false)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(v => {
      const next = !v;
      if (next) {
        setSeenCount(logs.length);
        if (buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect();
          setDropdownPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
        }
      }
      return next;
    });
  };

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClear();
    setSeenCount(0);
    setOpen(false);
  }, [onClear]);

  const borderColor = badge > 0 ? (hasError ? '#ef535060' : '#e8b73a60') : '#2a2e39';
  const iconColor   = badge > 0 ? (hasError ? '#ef5350' : '#e8b73a') : '#5e6673';
  const badgeBg     = hasError ? '#ef5350' : '#e8b73a';

  const shown = logs.slice(-MAX_SHOWN).reverse();

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        title={badge > 0 ? `미확인 알림 ${badge}건` : '알림'}
        style={{
          position: 'relative', background: 'none',
          border: `1px solid ${borderColor}`,
          borderRadius: 4, color: iconColor,
          cursor: 'pointer', fontSize: '0.85rem', padding: '3px 8px',
          display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
          transition: 'border-color 0.2s, color 0.2s',
        }}
      >
        🔔
        {badge > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            background: badgeBg, color: '#fff',
            fontSize: '0.62rem', fontWeight: 700,
            minWidth: 16, height: 16, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && dropdownPos && createPortal(
        <div ref={dropdownRef} style={{
          position: 'fixed', top: dropdownPos.top, right: dropdownPos.right,
          width: 420, maxHeight: 480, background: '#1e222d',
          border: '1px solid #2a2e39', borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
          zIndex: 9999, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 12px', borderBottom: '1px solid #2a2e39',
            background: 'rgba(30,34,45,0.95)', flexShrink: 0,
          }}>
            <span style={{ color: '#d1d4dc', fontWeight: 700, fontSize: '0.85rem' }}>
              🔔 알림 {logs.length > 0 ? `(${logs.length}건)` : ''}
            </span>
            {logs.length > 0 && (
              <button
                onClick={handleClear}
                style={{
                  background: 'rgba(132,142,156,0.1)', border: '1px solid rgba(132,142,156,0.3)',
                  borderRadius: 4, color: '#848e9c', cursor: 'pointer',
                  fontSize: '0.74rem', fontWeight: 600, padding: '2px 8px', fontFamily: 'inherit',
                }}
              >
                전체 삭제
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {shown.length === 0 ? (
              <div style={{ color: '#5e6673', fontSize: '0.8rem', textAlign: 'center', padding: '24px 12px' }}>
                알림 내역이 없습니다
              </div>
            ) : (
              shown.map(log => (
                <div key={log.id} style={{
                  padding: '7px 12px', borderBottom: '1px solid #1a1e2a',
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                }}>
                  <span style={{ color: TYPE_COLOR[log.type], fontSize: '0.8rem', flexShrink: 0, marginTop: 1 }}>
                    {TYPE_ICON[log.type]}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: TYPE_COLOR[log.type], fontSize: '0.79rem', lineHeight: 1.5, wordBreak: 'break-all' }}>
                      {log.message}
                    </div>
                    <div style={{ color: '#3a4558', fontSize: '0.71rem', marginTop: 2 }}>
                      {new Date(log.timestamp).toLocaleTimeString('ko-KR')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {shown.length > 0 && logs.length > MAX_SHOWN && (
            <div style={{
              padding: '6px 12px', borderTop: '1px solid #2a2e39',
              color: '#3a4558', fontSize: '0.72rem', flexShrink: 0, textAlign: 'center',
            }}>
              최근 {MAX_SHOWN}건만 표시 · 전체 {logs.length}건
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
