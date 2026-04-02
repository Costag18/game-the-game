import { useState } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './MainMenu.module.css';
import logoImg from '../assets/images/logo.png';

export default function MainMenu({ onNavigate }) {
  const { socket, connected } = useSocketContext();
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');

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
      </div>
    </div>
  );
}
