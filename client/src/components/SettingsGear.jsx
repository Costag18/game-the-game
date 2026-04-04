import { useState, useRef, useEffect } from 'react';
import { useSound } from '../context/SoundContext.jsx';
import { useTheme, THEMES } from '../context/ThemeContext.jsx';
import styles from './SettingsGear.module.css';

export default function SettingsGear() {
  const { muted, toggleMute, playSound } = useSound();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const gearRef = useRef(null);
  const panelRef = useRef(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (gearRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  function handleToggle() {
    setOpen((o) => !o);
    playSound('menuOpen');
  }

  function handleTheme(id) {
    setTheme(id);
    playSound('click');
  }

  const currentName = THEMES.find((t) => t.id === theme)?.name || 'Classic';

  return (
    <>
      <button
        ref={gearRef}
        className={`${styles.gearBtn} ${open ? styles.gearOpen : ''}`}
        onClick={handleToggle}
        title="Settings"
      >
        ⚙️
      </button>

      <div
        ref={panelRef}
        className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
      >
        {/* Sound toggle */}
        <div className={styles.section}>
          <span className={styles.label}>Sound</span>
          <button
            className={`${styles.muteToggle} ${muted ? styles.muted : ''}`}
            onClick={toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>

        {/* Theme selection */}
        <div className={styles.section}>
          <span className={styles.label}>Theme</span>
          <div className={styles.swatches}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`${styles.swatch} ${theme === t.id ? styles.swatchActive : ''}`}
                style={{ backgroundColor: t.swatch }}
                onClick={() => handleTheme(t.id)}
                title={t.name}
              />
            ))}
          </div>
          <span className={styles.themeName}>{currentName}</span>
        </div>
      </div>
    </>
  );
}
