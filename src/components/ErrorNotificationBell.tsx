import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ActivityLog } from '../types/trade';

interface Props {
  errors: ActivityLog[];   // only type='error' logs
  onClear: () => void;
}

const MAX_SHOWN = 100;

export function ErrorNotificationBell({ errors, onClear }: Props) {
  const [open, setOpen]           = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef  = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Badge = errors added since last time the panel was opened
  const badge = errors.length - seenCount;

  // Close dropdown on outside click (portal — cannot use contains on toolbar wrapper)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideButton   = buttonRef.current?.contains(target) ?? false;
      const insideDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!insideButton && !insideDropdown) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(v => {
      const next = !v;
      if (next) {
        setSeenCount(errors.length); // mark all as seen on open
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

  const shown = errors.slice(-MAX_SHOWN).reverse(); // newest first

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={handleOpen}
        title={badge > 0 ? `미확인 오류 ${badge}건` : '오류 알림'}
        style={{
          position: 'relative', background: 'none',
          border: `1px solid ${badge > 0 ? '#ef535060' : '#2a2e39'}`,
          borderRadius: 4, color: badge > 0 ? '#ef5350' : '#5e6673',
          cursor: 'pointer', fontSize: '0.85rem', padding: '3px 8px',
          display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
          transition: 'border-color 0.2s, color 0.2s',
        }}
      >
        🔔
        {badge > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            background: '#ef5350', color: '#fff',
            fontSize: '0.62rem', fontWeight: 700,
            minWidth: 16, height: 16, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {/* Dropdown — rendered via portal to escape toolbar's overflowY:hidden */}
      {open && dropdownPos && createPortal(
        <div ref={dropdownRef} style={{
          position: 'fixed', top: dropdownPos.top, right: dropdownPos.right,
          width: 380, maxHeight: 420, background: '#1e222d',
          border: '1px solid #2a2e39', borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
          zIndex: 9999, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 12px', borderBottom: '1px solid #2a2e39',
            background: 'rgba(239,83,80,0.07)', flexShrink: 0,
          }}>
            <span style={{ color: '#ef5350', fontWeight: 700, fontSize: '0.85rem' }}>
              🔔 오류 알림 {errors.length > 0 ? `(${errors.length}건)` : ''}
            </span>
            {errors.length > 0 && (
              <button
                onClick={handleClear}
                style={{
                  background: 'rgba(239,83,80,0.12)', border: '1px solid rgba(239,83,80,0.35)',
                  borderRadius: 4, color: '#ef5350', cursor: 'pointer',
                  fontSize: '0.74rem', fontWeight: 600, padding: '2px 8px', fontFamily: 'inherit',
                }}
              >
                전체 삭제
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {shown.length === 0 ? (
              <div style={{ color: '#5e6673', fontSize: '0.8rem', textAlign: 'center', padding: '24px 12px' }}>
                오류 내역이 없습니다
              </div>
            ) : (
              shown.map(log => (
                <div key={log.id} style={{
                  padding: '7px 12px', borderBottom: '1px solid #1a1e2a',
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                }}>
                  <span style={{ color: '#ef5350', fontSize: '0.8rem', flexShrink: 0, marginTop: 1 }}>✕</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: '#c9d1d9', fontSize: '0.79rem', lineHeight: 1.5,
                      wordBreak: 'break-all',
                    }}>
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

          {shown.length > 0 && errors.length > MAX_SHOWN && (
            <div style={{
              padding: '6px 12px', borderTop: '1px solid #2a2e39',
              color: '#3a4558', fontSize: '0.72rem', flexShrink: 0,
              textAlign: 'center',
            }}>
              최근 {MAX_SHOWN}건만 표시 · 전체 {errors.length}건
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
