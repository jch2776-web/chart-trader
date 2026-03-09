import { useState, useCallback } from 'react';

const STORAGE_KEY = 'trade_sound_settings_v1';

export interface SoundConfig {
  buyEnabled:  boolean;
  sellEnabled: boolean;
  buyDataUrl:  string | null;  // base64 data URL for custom audio file
  sellDataUrl: string | null;
  volume:      number;         // 0.0 – 1.0
}

const DEFAULT_CONFIG: SoundConfig = {
  buyEnabled:  true,
  sellEnabled: true,
  buyDataUrl:  null,
  sellDataUrl: null,
  volume:      0.7,
};

function loadConfig(): SoundConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(cfg: SoundConfig) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}

// Synthesise a short beep via Web Audio API (no file needed)
function playBeep(freq: number, durationSec: number, volume: number) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume * 0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationSec);
    setTimeout(() => ctx.close(), (durationSec + 0.2) * 1000);
  } catch { /* blocked before user gesture — silently ignore */ }
}

function playDataUrl(dataUrl: string, volume: number) {
  try {
    const audio = new Audio(dataUrl);
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.play().catch(() => {});
  } catch {}
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

  // Always read fresh from storage so stale closures don't matter
  const playBuy = useCallback(() => {
    const cfg = loadConfig();
    if (!cfg.buyEnabled) return;
    if (cfg.buyDataUrl) playDataUrl(cfg.buyDataUrl, cfg.volume);
    else                playBeep(880, 0.18, cfg.volume); // high A5 — bright
  }, []);

  const playSell = useCallback(() => {
    const cfg = loadConfig();
    if (!cfg.sellEnabled) return;
    if (cfg.sellDataUrl) playDataUrl(cfg.sellDataUrl, cfg.volume);
    else                 playBeep(440, 0.22, cfg.volume); // A4 — warm
  }, []);

  return { config, updateConfig, playBuy, playSell };
}
