import { useState, useRef, useEffect } from 'react';
import { useSound } from '../context/SoundContext.jsx';
import { useTheme, THEMES } from '../context/ThemeContext.jsx';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './SettingsGear.module.css';

export default function SettingsGear() {
  const { muted, toggleMute, playSound } = useSound();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const gearRef = useRef(null);
  const panelRef = useRef(null);

  const { socket } = useSocketContext();
  const [avatar, setAvatar] = useState(() => localStorage.getItem('gtg_avatar') || '');
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [avatarGenerating, setAvatarGenerating] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarCooldown, setAvatarCooldown] = useState(0);
  const cooldownRef = useRef(null);

  // Listen for avatar updates (from other sessions or reconnects)
  useEffect(() => {
    if (!socket) return;
    function onAvatarUpdate(data) {
      if (data.playerId === socket.id && data.avatar) {
        setAvatar(data.avatar);
        localStorage.setItem('gtg_avatar', data.avatar);
      }
    }
    socket.on(EVENTS.AVATAR_UPDATE, onAvatarUpdate);
    return () => socket.off(EVENTS.AVATAR_UPDATE, onAvatarUpdate);
  }, [socket]);

  // Cooldown timer
  useEffect(() => {
    if (avatarCooldown <= 0) { clearInterval(cooldownRef.current); return; }
    cooldownRef.current = setInterval(() => {
      setAvatarCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [avatarCooldown > 0]);

  function handleGenerateAvatar() {
    if (avatarGenerating || avatarCooldown > 0 || !avatarPrompt.trim() || !socket) return;
    setAvatarGenerating(true);
    setAvatarError('');
    setAvatarCooldown(30);
    socket.emit(EVENTS.SET_AVATAR, { prompt: avatarPrompt.trim() }, (response) => {
      setAvatarGenerating(false);
      if (response?.error) {
        setAvatarError(response.error);
        setAvatarCooldown(0);
      } else if (response?.avatar) {
        setAvatar(response.avatar);
        localStorage.setItem('gtg_avatar', response.avatar);
        setAvatarPrompt('');
      }
    });
  }

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

        {/* Avatar generation */}
        <div className={styles.avatarSection}>
          <span className={styles.label}>Profile Photo</span>
          <div className={styles.avatarPreview}>
            {avatar ? (
              <img src={avatar} alt="Avatar" className={styles.avatarImg} />
            ) : (
              <span className={styles.avatarPlaceholder}>?</span>
            )}
          </div>
          <div className={styles.avatarForm}>
            <input
              className={styles.avatarInput}
              type="text"
              placeholder="Describe your avatar..."
              value={avatarPrompt}
              onChange={(e) => setAvatarPrompt(e.target.value.slice(0, 100))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateAvatar(); }}
              maxLength={100}
              disabled={avatarGenerating}
            />
            {avatarGenerating ? (
              <span className={styles.avatarSpinner}>⏳</span>
            ) : (
              <button
                className={styles.avatarGenBtn}
                onClick={handleGenerateAvatar}
                disabled={!avatarPrompt.trim() || avatarCooldown > 0}
                title={avatarCooldown > 0 ? `Wait ${avatarCooldown}s` : 'Generate'}
              >
                {avatarCooldown > 0 ? avatarCooldown : '🎨'}
              </button>
            )}
          </div>
          {avatarError && <span className={styles.avatarError}>{avatarError}</span>}
        </div>
      </div>
    </>
  );
}
