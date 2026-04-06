import { useState } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import { VERSION } from '../../../shared/version.js';
import styles from './MainMenu.module.css';
const logoImg = '/logo.png';

export default function MainMenu({ onNavigate }) {
  const { socket, connected } = useSocketContext();
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [suggestStatus, setSuggestStatus] = useState(''); // '', 'sending', 'sent', 'error'
  const [suggestError, setSuggestError] = useState('');

  const canProceed = connected && nickname.trim().length > 0;

  function emitNickname(callback) {
    setError('');
    socket.emit(EVENTS.SET_NICKNAME, { nickname: nickname.trim() }, (res) => {
      if (res && res.error) {
        setError(res.error);
      } else {
        callback();
      }
    });
  }

  function handlePlay() {
    emitNickname(() => onNavigate('lobbyBrowser'));
  }

  function handleCreate() {
    emitNickname(() => onNavigate('createLobby'));
  }

  function handleSuggestSubmit() {
    const text = suggestion.trim();
    if (!text || !connected || suggestStatus === 'sending') return;
    setSuggestStatus('sending');
    setSuggestError('');
    socket.emit(EVENTS.SUGGESTION_SUBMIT, { text }, (res) => {
      if (res?.error) {
        setSuggestStatus('error');
        setSuggestError(res.error);
      } else {
        setSuggestStatus('sent');
        setSuggestion('');
        setTimeout(() => {
          setSuggestStatus('');
          setSuggestOpen(false);
        }, 2500);
      }
    });
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <img src={logoImg} alt="Game The Game" className={styles.logo} />
        <p className={styles.subtitle}>The ultimate card &amp; casino tournament</p>

        <div className={styles.statusRow}>
          <span className={connected ? styles.dotOnline : styles.dotOffline} />
          <span className={styles.statusText}>
            {connected ? 'Connected' : 'Connecting…'}
          </span>
        </div>

        <div className={styles.inputGroup}>
          <label className={styles.label} htmlFor="nickname">
            Your Nickname
          </label>
          <input
            id="nickname"
            className={styles.input}
            type="text"
            placeholder="Enter nickname…"
            value={nickname}
            maxLength={24}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canProceed) handlePlay(); }}
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.buttonGroup}>
          <button
            className={styles.btnPrimary}
            disabled={!canProceed}
            onClick={handlePlay}
          >
            Play
          </button>
          <button
            className={styles.btnSecondary}
            disabled={!canProceed}
            onClick={handleCreate}
          >
            Create Lobby
          </button>
          <button
            className={styles.btnCasino}
            disabled={!connected}
            onClick={() => onNavigate('casino')}
          >
            Free Play Casino
          </button>
        </div>

        <div className={styles.donationSection}>
          <div className={styles.donationDivider} />
          <p className={styles.donationText}>
            Help keep my apps ad-free!
          </p>
          <div className={styles.donationButtons}>
            <a
              href="https://buymeacoffee.com/costag18?new=1"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.btnDonate}
            >
              <span className={styles.donateIcon}>☕</span> Buy Me a Coffee
            </a>
            <a
              href="https://patreon.com/costag18?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.btnDonateAlt}
            >
              <span className={styles.donateIcon}>🎨</span> Patreon
            </a>
          </div>
          <p className={styles.donationFootnote}>
            Every dollar helps cover hosting &amp; development
          </p>
        </div>

        <div className={styles.suggestSection}>
          <div className={styles.donationDivider} />
          <button
            className={styles.suggestToggle}
            onClick={() => { setSuggestOpen(!suggestOpen); setSuggestStatus(''); setSuggestError(''); }}
          >
            {suggestOpen ? '✕ Close' : '💡 Suggest a new game or feature'}
          </button>
          {suggestOpen && (
            <div className={styles.suggestForm}>
              {suggestStatus === 'sent' ? (
                <p className={styles.suggestThanks}>Thanks for your suggestion!</p>
              ) : (
                <>
                  <textarea
                    className={styles.suggestInput}
                    placeholder="What game or feature would you like to see?"
                    value={suggestion}
                    maxLength={500}
                    rows={3}
                    onChange={(e) => setSuggestion(e.target.value)}
                  />
                  <div className={styles.suggestActions}>
                    <span className={styles.suggestCharCount}>{suggestion.length}/500</span>
                    <button
                      className={styles.suggestSubmit}
                      disabled={!suggestion.trim() || !connected || suggestStatus === 'sending'}
                      onClick={handleSuggestSubmit}
                    >
                      {suggestStatus === 'sending' ? 'Sending…' : 'Submit'}
                    </button>
                  </div>
                  {suggestError && <p className={styles.suggestError}>{suggestError}</p>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <span className={styles.version}>v{VERSION}</span>
    </div>
  );
}
