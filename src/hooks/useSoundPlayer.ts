import { useState, useCallback } from 'react';

const STORAGE_KEY = 'trade_sound_settings_v2';

export interface SoundConfig {
  entryEnabled: boolean;  // 매수음 — position opened
  tpEnabled:    boolean;  // 익절음 — TP hit
  slEnabled:    boolean;  // 손절음 — SL / liq hit
  entryDataUrl: string | null;
  tpDataUrl:    string | null;
  slDataUrl:    string | null;
  volume:       number;   // 0.0 – 1.0
}

interface SpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  interrupt?: boolean;
}

const DEFAULT_CONFIG: SoundConfig = {
  entryEnabled: true,
  tpEnabled:    true,
  slEnabled:    true,
  entryDataUrl: null,
  tpDataUrl:    null,
  slDataUrl:    null,
  volume:       0.7,
};

function loadConfig(): SoundConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    // Migrate from v1 (buy/sell keys)
    const old = localStorage.getItem('trade_sound_settings_v1');
    if (old) {
      const v1 = JSON.parse(old) as Record<string, unknown>;
      return {
        ...DEFAULT_CONFIG,
        entryEnabled: (v1.buyEnabled as boolean) ?? true,
        entryDataUrl: (v1.buyDataUrl as string | null) ?? null,
        volume:       (v1.volume as number) ?? 0.7,
      };
    }
    return DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(cfg: SoundConfig) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}

function playBeep(freq: number, durationSec: number, volume: number, freq2?: number) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const play = (f: number, start: number, dur: number) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(volume * 0.4, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    play(freq, 0, durationSec);
    if (freq2 != null) play(freq2, durationSec * 0.6, durationSec); // ascending second note
    setTimeout(() => ctx.close(), (durationSec * 2 + 0.2) * 1000);
  } catch { /* blocked before user gesture */ }
}

function playDataUrl(dataUrl: string, volume: number) {
  try {
    const audio = new Audio(dataUrl);
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.play().catch(() => {});
  } catch {}
}

function pickKoreanVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const ko = voices.filter(v => (v.lang || '').toLowerCase().startsWith('ko'));
  if (ko.length === 0) return null;
  const preferred = [
    'Google 한국의',
    'Google Korean',
    'Microsoft Heami',
    'Yuna',
    'Nari',
    'Sora',
  ];
  for (const key of preferred) {
    const found = ko.find(v => (v.name || '').includes(key));
    if (found) return found;
  }
  return ko.find(v => v.default) ?? ko.find(v => v.localService) ?? ko[0] ?? null;
}

export function useSoundPlayer() {
  const [config, setConfigState] = useState<SoundConfig>(loadConfig);

  const updateConfig = useCallback((patch: Partial<SoundConfig>) => {
    setConfigState(prev => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  }, []);

  const playEntry = useCallback(() => {
    const cfg = loadConfig();
    if (!cfg.entryEnabled) return;
    if (cfg.entryDataUrl) playDataUrl(cfg.entryDataUrl, cfg.volume);
    else                  playBeep(880, 0.15, cfg.volume); // bright A5
  }, []);

  const playTp = useCallback(() => {
    const cfg = loadConfig();
    if (!cfg.tpEnabled) return;
    if (cfg.tpDataUrl) playDataUrl(cfg.tpDataUrl, cfg.volume);
    else               playBeep(880, 0.12, cfg.volume, 1100); // ascending — cheerful
  }, []);

  const playSl = useCallback(() => {
    const cfg = loadConfig();
    if (!cfg.slEnabled) return;
    if (cfg.slDataUrl) playDataUrl(cfg.slDataUrl, cfg.volume);
    else               playBeep(330, 0.25, cfg.volume); // low — somber
  }, []);

  const speak = useCallback((text: string, opts?: SpeakOptions) => {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
      const cfg = loadConfig();
      if (!cfg.entryEnabled && !cfg.tpEnabled && !cfg.slEnabled) return;
      const synth = window.speechSynthesis;
      if (opts?.interrupt) synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = opts?.lang ?? 'ko-KR';
      utter.rate = Math.min(1.2, Math.max(0.85, opts?.rate ?? 1.0));
      utter.pitch = Math.min(1.2, Math.max(0.8, opts?.pitch ?? 1.0));
      utter.volume = Math.min(1, Math.max(0, cfg.volume));
      const voice = pickKoreanVoice(synth.getVoices());
      if (voice) utter.voice = voice;
      synth.speak(utter);
    } catch {}
  }, []);

  return { config, updateConfig, playEntry, playTp, playSl, speak };
}
