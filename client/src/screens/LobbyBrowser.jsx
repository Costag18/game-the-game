import { useState, useEffect, useCallback } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './LobbyBrowser.module.css';

export default function LobbyBrowser({ onNavigate, onJoinLobby }) {
  const { socket, connected } = useSocketContext();
  const [lobbies, setLobbies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [error, setError] = useState('');
  const [roomCode, setRoomCode] = useState('');

  const fetchLobbies = useCallback(() => {
    if (!socket || !connected) return;
    setLoading(true);
    socket.emit(EVENTS.LIST_LOBBIES, (res) => {
      setLoading(false);
      if (res && res.error) {
        setError(res.error);
      } else {
        setLobbies(res?.lobbies ?? res ?? []);
      }
    });
  }, [socket, connected]);

  useEffect(() => {
    fetchLobbies();
    const interval = setInterval(fetchLobbies, 3000);
    return () => clearInterval(interval);
  }, [fetchLobbies]);

  function handleJoinByCode() {
    if (!roomCode.trim()) return;
    setError('');
    socket.emit(EVENTS.JOIN_BY_CODE, roomCode.trim().toUpperCase(), (res) => {
      if (res?.success) {
        onJoinLobby(res.lobby);
      } else {
        setError(res?.error || 'Failed to join');
      }
    });
  }

  function handleJoin(lobby) {
    setError('');
    setJoiningId(lobby.id);
    socket.emit(EVENTS.JOIN_LOBBY, { lobbyId: lobby.id }, (res) => {
      setJoiningId(null);
      if (res && res.error) {
        setError(res.error);
      } else {
        onJoinLobby(res?.lobby ?? lobby);
      }
    });
  }

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <button className={styles.btnBack} onClick={() => onNavigate('menu')}>
            ← Back
          </button>
          <h2 className={styles.title}>Public Lobbies</h2>
          <button className={styles.btnRefresh} onClick={fetchLobbies} disabled={loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.codeSection}>
          <span className={styles.codeLabel}>Join Private Room</span>
          <div className={styles.codeRow}>
            <input
              type="text"
              className={styles.codeInput}
              placeholder="Enter room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
            />
            <button
              className={styles.btnJoinCode}
              onClick={handleJoinByCode}
              disabled={!roomCode.trim()}
            >
              Join
            </button>
          </div>
        </div>

        <div className={styles.list}>
          {lobbies.length === 0 ? (
            <div className={styles.empty}>
              <p>No public lobbies available.</p>
              <p className={styles.emptyHint}>Create one or check back soon!</p>
            </div>
          ) : (
            lobbies.map((lobby) => (
              <div key={lobby.id} className={styles.lobbyRow}>
                <div className={styles.lobbyInfo}>
                  <span className={styles.lobbyName}>{lobby.name}</span>
                  <span className={styles.lobbyMeta}>
                    {lobby.playerCount ?? lobby.players?.length ?? 0} / {lobby.maxPlayers} players
                  </span>
                </div>
                <button
                  className={styles.btnJoin}
                  disabled={joiningId === lobby.id}
                  onClick={() => handleJoin(lobby)}
                >
                  {joiningId === lobby.id ? 'Joining…' : 'Join'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
