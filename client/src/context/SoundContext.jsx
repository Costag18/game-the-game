import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import sounds from '../audio/SoundEngine.js';

const SoundContext = createContext(null);

const MUTE_KEY = 'gtg_muted';

export function SoundProvider({ children }) {
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) === '1'; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }
    catch { /* ignore */ }
  }, [muted]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const playSound = useCallback((name) => {
    if (muted) return;
    const fn = sounds[name];
    if (fn) {
      try { fn(); }
      catch { /* AudioContext may not be available */ }
    }
  }, [muted]);

  return (
    <SoundContext.Provider value={{ muted, toggleMute, playSound }}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSound() {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error('useSound must be inside SoundProvider');
  return ctx;
}
