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
  const [avatarTab, setAvatarTab] = useState('ai');

  // AI tab state
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [avatarGenerating, setAvatarGenerating] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  // Search tab state
  const [avatarSearchQuery, setAvatarSearchQuery] = useState('');
  const [avatarSearchResults, setAvatarSearchResults] = useState([]);
  const [avatarSearchLoading, setAvatarSearchLoading] = useState(false);

  const searchDebounceRef = useRef(null);

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

  // Debounced image search
  useEffect(() => {
    if (avatarTab !== 'search') return;
    clearTimeout(searchDebounceRef.current);
    if (!avatarSearchQuery.trim()) {
      setAvatarSearchResults([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setAvatarSearchLoading(true);
      try {
        const res = await fetch(`/api/image-search?q=${encodeURIComponent(avatarSearchQuery.trim())}`);
        const data = await res.json();
        setAvatarSearchResults(data.results || []);
      } catch {
        setAvatarSearchResults([]);
      }
      setAvatarSearchLoading(false);
    }, 500);
    return () => clearTimeout(searchDebounceRef.current);
  }, [avatarSearchQuery, avatarTab]);

  async function handleGenerateAvatar() {
    if (avatarGenerating || !avatarPrompt.trim() || !socket) return;
    setAvatarGenerating(true);
    setAvatarError('');
    try {
      const result = await window.puter?.ai?.txt2img?.(avatarPrompt.trim());
      let dataUrl;
      if (result instanceof Blob) {
        dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(result);
        });
      } else if (typeof result === 'string') {
        dataUrl = result.startsWith('data:') ? result : `data:image/png;base64,${result}`;
      } else {
        throw new Error('Unexpected result from Puter AI');
      }
      socket.emit(EVENTS.SET_AVATAR, { avatar: dataUrl }, (response) => {
        if (response?.success) {
          setAvatar(dataUrl);
          localStorage.setItem('gtg_avatar', dataUrl);
          setAvatarPrompt('');
        } else {
          setAvatarError(response?.error || 'Failed to save avatar');
        }
      });
    } catch (err) {
      setAvatarError(err.message || 'Generation failed');
    }
    setAvatarGenerating(false);
  }

  function handleSearchAvatar(img) {
    if (!socket) return;
    const url = img.url;
    socket.emit(EVENTS.SET_AVATAR, { avatar: url }, (response) => {
      if (response?.success) {
        setAvatar(url);
        localStorage.setItem('gtg_avatar', url);
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

        {/* Avatar section */}
        <div className={styles.avatarSection}>
          <div className={styles.avatarHeader}>
            <span className={styles.label}>Avatar</span>
            <div className={styles.avatarTabs}>
              <button
                className={`${styles.avatarTab} ${avatarTab === 'ai' ? styles.avatarTabActive : ''}`}
                onClick={() => { setAvatarTab('ai'); setAvatarError(''); }}
              >
                AI
              </button>
              <button
                className={`${styles.avatarTab} ${avatarTab === 'search' ? styles.avatarTabActive : ''}`}
                onClick={() => setAvatarTab('search')}
              >
                Search
              </button>
            </div>
          </div>

          <div className={styles.avatarPreview}>
            {avatar ? (
              <img src={avatar} alt="Avatar" className={styles.avatarImg} />
            ) : (
              <span className={styles.avatarPlaceholder}>?</span>
            )}
          </div>

          {avatarTab === 'ai' && (
            <>
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
                    disabled={!avatarPrompt.trim()}
                    title="Generate"
                  >
                    🎨
                  </button>
                )}
              </div>
              {avatarError && <span className={styles.avatarError}>{avatarError}</span>}
              <span className={styles.avatarAttrib}>Powered by Puter AI</span>
            </>
          )}

          {avatarTab === 'search' && (
            <>
              <div className={styles.avatarForm}>
                <input
                  className={styles.avatarInput}
                  type="text"
                  placeholder="Search photos..."
                  value={avatarSearchQuery}
                  onChange={(e) => setAvatarSearchQuery(e.target.value)}
                  maxLength={80}
                />
                {avatarSearchLoading && <span className={styles.avatarSpinner}>⏳</span>}
              </div>
              {avatarSearchResults.length > 0 && (
                <div className={styles.searchGrid}>
                  {avatarSearchResults.map((img) => (
                    <button
                      key={img.id}
                      className={styles.searchThumb}
                      onClick={() => handleSearchAvatar(img)}
                      title={img.alt || 'Select'}
                    >
                      <img src={img.thumb} alt={img.alt || ''} />
                    </button>
                  ))}
                </div>
              )}
              <span className={styles.avatarAttrib}>Photos by Pexels</span>
            </>
          )}
        </div>
      </div>
    </>
  );
}
