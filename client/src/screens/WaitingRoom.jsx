import { useState, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import { LOBBY } from '../../../shared/constants.js';
import Chat from '../components/Chat.jsx';
import PlayerName from '../components/PlayerName.jsx';
import styles from './WaitingRoom.module.css';

export default function WaitingRoom({ lobby: initialLobby, avatars, onNavigate }) {
  const { socket } = useSocketContext();
  const [lobby, setLobby] = useState(initialLobby);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!socket) return;

    function onLobbyState(data) {
      setLobby((prev) => ({ ...prev, ...data }));
    }

    socket.on(EVENTS.LOBBY_STATE, onLobbyState);
    return () => socket.off(EVENTS.LOBBY_STATE, onLobbyState);
  }, [socket]);

  const players = lobby.players ?? [];
  const hostId = lobby.hostId ?? lobby.host;
  const myId = socket?.id;
  const isHost = myId === hostId;
  const canStart = isHost && players.length >= 1;

  const winTarget = lobby.winTarget ?? lobby.target;
  const winConditionLabel =
    lobby.winCondition === LOBBY.WIN_CONDITIONS.FIXED_ROUNDS
      ? `${winTarget} Rounds`
      : `${winTarget?.toLocaleString()} Points`;

  function handleLeave() {
    socket.emit(EVENTS.LEAVE_LOBBY, {}, () => {
      onNavigate('menu');
    });
    onNavigate('menu');
  }

  function handleStart() {
    setError('');
    setStarting(true);
    socket.emit(EVENTS.START_TOURNAMENT, {}, (res) => {
      setStarting(false);
      if (res && res.error) {
        setError(res.error);
      }
    });
  }

  return (
    <div className={styles.container}>
      <div className={styles.main}>
        {/* Left: lobby info + players */}
        <div className={styles.leftPane}>
          <div className={styles.lobbyHeader}>
            <h2 className={styles.lobbyName}>{lobby.name}</h2>
            {lobby.isPrivate && isHost && lobby.code && (
              <div className={styles.codeBox}>
                <span className={styles.codeLabel}>Room Code</span>
                <span className={styles.code}>{lobby.code}</span>
              </div>
            )}
            <div className={styles.settings}>
              <span className={styles.settingItem}>
                Win: <strong>{winConditionLabel}</strong>
              </span>
              <span className={styles.settingItem}>
                Max: <strong>{lobby.maxPlayers} players</strong>
              </span>
              {lobby.isPrivate && (
                <span className={styles.badge}>Private</span>
              )}
            </div>
          </div>

          <div className={styles.playerSection}>
            <h3 className={styles.sectionTitle}>
              Players ({players.length}/{lobby.maxPlayers})
            </h3>
            <ul className={styles.playerList}>
              {players.map((p) => {
                const pid = typeof p === 'string' ? p : (p.id ?? p.socketId);
                return (
                  <li key={pid} className={styles.playerRow}>
                    <span className={styles.playerName}>
                      <PlayerName playerId={pid} nicknames={lobby.nicknames || {}} avatars={avatars} />
                    </span>
                    {pid === hostId && (
                      <span className={styles.hostBadge}>HOST</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button className={styles.btnLeave} onClick={handleLeave}>
              Leave
            </button>
            {isHost && (
              <button
                className={styles.btnStart}
                disabled={!canStart || starting}
                onClick={handleStart}
                title={!canStart ? `Need at least ${LOBBY.MIN_PLAYERS} players` : ''}
              >
                {starting ? 'Starting…' : 'Start Tournament'}
              </button>
            )}
          </div>
        </div>

        {/* Right: Chat */}
        <div className={styles.chatPane}>
          <Chat />
        </div>
      </div>
    </div>
  );
}
