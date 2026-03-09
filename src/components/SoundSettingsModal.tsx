import React, { useRef, useCallback } from 'react';
import type { SoundConfig } from '../hooks/useSoundPlayer';

interface Props {
  config: SoundConfig;
  onUpdate: (patch: Partial<SoundConfig>) => void;
  onPlayEntry: () => void;
  onPlayTp:    () => void;
  onPlaySl:    () => void;
  onClose: () => void;
}

const MAX_FILE_MB = 2;

function FileUploadRow({
  label, dataUrl, enabled, onToggle, onUpload, onClear, onPreview,
}: {
  label:    string;
  dataUrl:  string | null;
  enabled:  boolean;
  onToggle: () => void;
  onUpload: (dataUrl: string) => void;
  onClear:  () => void;
  onPreview:() => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      alert(`파일 크기는 ${MAX_FILE_MB}MB 이하여야 합니다.`);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => { onUpload(ev.target?.result as string); };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [onUpload]);

  return (
    <div style={s.row}>
      <button
        onClick={onToggle}
        title={enabled ? '사운드 끄기' : '사운드 켜기'}
        style={{ ...s.toggleBtn, background: enabled ? '#0ecb81' : '#3a4455' }}
      >
        <span style={{
          display: 'block', width: 9, height: 9, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 2, left: enabled ? 15 : 2, transition: 'left 0.15s',
        }} />
      </button>

      <span style={s.rowLabel}>{label}</span>

      <span style={{ ...s.filename, color: dataUrl ? '#f0b90b' : '#5e6673' }}>
        {dataUrl ? '(커스텀 파일)' : '기본 비프음'}
      </span>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button style={s.smBtn} onClick={onPreview} title="미리듣기">▶</button>
        <button style={s.smBtn} onClick={() => inputRef.current?.click()} title="파일 업로드">📁</button>
        {dataUrl && (
          <button style={{ ...s.smBtn, color: '#f6465d' }} onClick={onClear} title="기본으로 초기화">✕</button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </div>
  );
}

export function SoundSettingsModal({ config, onUpdate, onPlayEntry, onPlayTp, onPlaySl, onClose }: Props) {
  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.3rem' }}>🔊</span>
            <div>
              <div style={s.title}>매매음 설정</div>
              <div style={s.sub}>진입·익절·손절 시 재생할 사운드를 설정합니다</div>
            </div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          <FileUploadRow
            label="매수음 — 포지션 진입 시"
            dataUrl={config.entryDataUrl}
            enabled={config.entryEnabled}
            onToggle={() => onUpdate({ entryEnabled: !config.entryEnabled })}
            onUpload={(dataUrl) => onUpdate({ entryDataUrl: dataUrl })}
            onClear={() => onUpdate({ entryDataUrl: null })}
            onPreview={onPlayEntry}
          />
          <FileUploadRow
            label="익절음 — 수익 청산 시"
            dataUrl={config.tpDataUrl}
            enabled={config.tpEnabled}
            onToggle={() => onUpdate({ tpEnabled: !config.tpEnabled })}
            onUpload={(dataUrl) => onUpdate({ tpDataUrl: dataUrl })}
            onClear={() => onUpdate({ tpDataUrl: null })}
            onPreview={onPlayTp}
          />
          <FileUploadRow
            label="손절음 — 손실 청산 시"
            dataUrl={config.slDataUrl}
            enabled={config.slEnabled}
            onToggle={() => onUpdate({ slEnabled: !config.slEnabled })}
            onUpload={(dataUrl) => onUpdate({ slDataUrl: dataUrl })}
            onClear={() => onUpdate({ slDataUrl: null })}
            onPreview={onPlaySl}
          />

          {/* Volume */}
          <div style={{ ...s.row, gap: 10, marginTop: 4 }}>
            <span style={s.rowLabel}>볼륨</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={config.volume}
              onChange={e => onUpdate({ volume: parseFloat(e.target.value) })}
              style={{ flex: 1, cursor: 'pointer', accentColor: '#f0b90b' }}
            />
            <span style={{ color: '#d1d4dc', fontSize: '0.82rem', minWidth: 36, textAlign: 'right' }}>
              {Math.round(config.volume * 100)}%
            </span>
          </div>

          <div style={s.info}>
            <p style={{ margin: 0, color: '#5e6673', fontSize: '0.76rem', lineHeight: 1.6 }}>
              • 파일 미업로드 시 기본 비프음 재생 (진입: 고음, 익절: 상승음, 손절: 저음)<br />
              • 지원 형식: MP3, WAV, OGG, M4A, AAC (최대 {MAX_FILE_MB}MB)<br />
              • 파일은 브라우저 localStorage에 저장됩니다 (서버 전송 없음)
            </p>
          </div>
        </div>

        <div style={s.footer}>
          <button style={s.doneBtn} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 7500,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 10,
    width: 'min(500px, 96vw)', display: 'flex', flexDirection: 'column',
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid #2a2e39',
    background: 'rgba(240,185,11,0.05)',
  },
  title: { color: '#d1d4dc', fontWeight: 700, fontSize: '1rem' },
  sub:   { color: '#5e6673', fontSize: '0.74rem', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: '#5e6673', cursor: 'pointer',
    fontSize: '1rem', padding: '4px 8px', borderRadius: 4,
  },
  body: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#12151e', borderRadius: 6, padding: '10px 12px',
    border: '1px solid #2a2e39',
  },
  toggleBtn: {
    width: 26, height: 13, borderRadius: 7, border: 'none', cursor: 'pointer',
    position: 'relative', flexShrink: 0, transition: 'background 0.2s',
  },
  rowLabel: { color: '#d1d4dc', fontSize: '0.82rem', fontWeight: 600, flex: 1, whiteSpace: 'nowrap' },
  filename: { fontSize: '0.75rem', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  smBtn: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid #2a2e39', borderRadius: 4,
    color: '#848e9c', cursor: 'pointer', fontSize: '0.82rem', padding: '3px 7px',
    fontFamily: 'inherit', lineHeight: 1,
  },
  info: { background: '#12151e', borderRadius: 5, padding: '8px 12px', border: '1px solid #2a2e39' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', padding: '12px 20px',
    borderTop: '1px solid #2a2e39',
  },
  doneBtn: {
    background: 'rgba(240,185,11,0.1)', border: '1px solid rgba(240,185,11,0.4)',
    borderRadius: 5, color: '#f0b90b', cursor: 'pointer', fontWeight: 600,
    fontSize: '0.88rem', padding: '7px 22px', fontFamily: 'inherit',
  },
};
