import { useState, useRef, useEffect } from 'react';
import { useSound } from '../context/SoundContext.jsx';
import { useTheme, THEMES } from '../context/ThemeContext.jsx';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './SettingsGear.module.css';

const SKIP_SCREENS = ['gameVote', 'wagerPhase', 'playing', 'roundResults'];

export default function SettingsGear({ screen }) {
  const { muted, toggleMute, playSound } = useSound();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const gearRef = useRef(null);
  const panelRef = useRef(null);

  const { socket } = useSocketContext();

  // Unanimous skip-to-lobby vote
  const [skipVotedCount, setSkipVotedCount] = useState(0);
  const [skipTotal, setSkipTotal] = useState(0);
  const [iVotedSkip, setIVotedSkip] = useState(false);
  const showSkip = SKIP_SCREENS.includes(screen);

  useEffect(() => {
    if (!socket) return;
    function onSkipUpdate(d) {
      const voted = d?.voted || [];
      setSkipVotedCount(voted.length);
      setSkipTotal(d?.total || 0);
      setIVotedSkip(voted.includes(socket.id));
    }
    function onReturn() { setSkipVotedCount(0); setSkipTotal(0); setIVotedSkip(false); }
    socket.on(EVENTS.SKIP_UPDATE, onSkipUpdate);
    socket.on(EVENTS.RETURN_TO_LOBBY, onReturn);
    return () => { socket.off(EVENTS.SKIP_UPDATE, onSkipUpdate); socket.off(EVENTS.RETURN_TO_LOBBY, onReturn); };
  }, [socket]);

  // reset my vote view whenever we leave the active-game screens (server clears votes per game)
  useEffect(() => {
    if (!SKIP_SCREENS.includes(screen)) { setSkipVotedCount(0); setSkipTotal(0); setIVotedSkip(false); }
  }, [screen]);

  function toggleSkipVote() {
    if (!socket) return;
    socket.emit(EVENTS.SKIP_VOTE, { vote: !iVotedSkip });
    setIVotedSkip((v) => !v); // optimistic; server confirms via SKIP_UPDATE
    playSound('click');
  }
  const [avatar, setAvatar] = useState(() => localStorage.getItem('gtg_avatar') || '');
  const [avatarTab, setAvatarTab] = useState('search');

  // AI tab state
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [avatarGenerating, setAvatarGenerating] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  // Search tab state
  const [avatarSearchQuery, setAvatarSearchQuery] = useState('');
  const [avatarSearchResults, setAvatarSearchResults] = useState([]);
  const [avatarSearchLoading, setAvatarSearchLoading] = useState(false);

  const searchDebounceRef = useRef(null);

  // Restore saved avatar on connect — send to server so it's available in lobbies/tournaments
  useEffect(() => {
    if (!socket) return;
    const saved = localStorage.getItem('gtg_avatar');
    if (saved) {
      socket.emit(EVENTS.SET_AVATAR, { avatar: saved }, () => {});
    }
  }, [socket]);

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

  function handleGenerateAvatar() {
    if (avatarGenerating || !avatarPrompt.trim() || !socket) return;
    setAvatarGenerating(true);
    setAvatarError('');
    socket.emit(EVENTS.SET_AVATAR, { prompt: avatarPrompt.trim() }, (response) => {
      setAvatarGenerating(false);
      if (response?.error) {
        setAvatarError(response.error);
      } else if (response?.avatar) {
        setAvatar(response.avatar);
        localStorage.setItem('gtg_avatar', response.avatar);
        setAvatarPrompt('');
      }
    });
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
        {/* Unanimous skip-to-lobby (only during an active game) */}
        {showSkip && (
          <div className={styles.section}>
            <span className={styles.label}>Skip game</span>
            <button
              className={`${styles.skipBtn} ${iVotedSkip ? styles.skipVoted : ''}`}
              onClick={toggleSkipVote}
              title="Everyone must agree to return to the lobby"
            >
              {iVotedSkip ? '✓ Voted to skip' : 'Vote to skip → Lobby'}
            </button>
            {skipTotal > 0 && (
              <span className={styles.skipCount}>
                {skipVotedCount}/{skipTotal} voted{skipVotedCount < skipTotal ? ' · all must agree' : ''}
              </span>
            )}
          </div>
        )}

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
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
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
              <span className={styles.avatarAttrib}>Powered by Pollinations AI</span>
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
