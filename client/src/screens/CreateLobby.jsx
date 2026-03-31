import { useState } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import { LOBBY } from '../../../shared/constants.js';
import styles from './CreateLobby.module.css';

export default function CreateLobby({ onNavigate, onJoinLobby }) {
  const { socket } = useSocketContext();

  const [roomName, setRoomName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [isPrivate, setIsPrivate] = useState(false);
  const [winCondition, setWinCondition] = useState(LOBBY.WIN_CONDITIONS.FIXED_ROUNDS);
  const [target, setTarget] = useState(LOBBY.ROUND_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const targetOptions =
    winCondition === LOBBY.WIN_CONDITIONS.FIXED_ROUNDS
      ? LOBBY.ROUND_OPTIONS
      : LOBBY.THRESHOLD_OPTIONS;

  function handleWinConditionChange(e) {
    const val = e.target.value;
    setWinCondition(val);
    setTarget(
      val === LOBBY.WIN_CONDITIONS.FIXED_ROUNDS
        ? LOBBY.ROUND_OPTIONS[0]
        : LOBBY.THRESHOLD_OPTIONS[0]
    );
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!roomName.trim()) return;
    setError('');
    setLoading(true);

    const payload = {
      name: roomName.trim(),
      maxPlayers: Number(maxPlayers),
      isPrivate,
      winCondition,
      winTarget: Number(target),
    };

    socket.emit(EVENTS.CREATE_LOBBY, payload, (res) => {
      setLoading(false);
      if (res && res.error) {
        setError(res.error);
      } else {
        onJoinLobby(res?.lobby ?? res);
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
          <h2 className={styles.title}>Create Lobby</h2>
          <span />
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="roomName">Room Name</label>
            <input
              id="roomName"
              className={styles.input}
              type="text"
              placeholder="Enter room name…"
              value={roomName}
              maxLength={40}
              onChange={(e) => setRoomName(e.target.value)}
              required
            />
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="maxPlayers">Max Players</label>
              <select
                id="maxPlayers"
                className={styles.select}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(e.target.value)}
              >
                {Array.from({ length: LOBBY.MAX_PLAYERS - LOBBY.MIN_PLAYERS + 1 }, (_, i) => i + LOBBY.MIN_PLAYERS).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <div className={styles.fieldCheckbox}>
              <label className={styles.label} htmlFor="isPrivate">Private Room</label>
              <input
                id="isPrivate"
                className={styles.checkbox}
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="winCondition">Win Condition</label>
              <select
                id="winCondition"
                className={styles.select}
                value={winCondition}
                onChange={handleWinConditionChange}
              >
                <option value={LOBBY.WIN_CONDITIONS.FIXED_ROUNDS}>Fixed Rounds</option>
                <option value={LOBBY.WIN_CONDITIONS.POINT_THRESHOLD}>Point Threshold</option>
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="target">
                {winCondition === LOBBY.WIN_CONDITIONS.FIXED_ROUNDS ? 'Rounds' : 'Target Points'}
              </label>
              <select
                id="target"
                className={styles.select}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {targetOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button
            type="submit"
            className={styles.btnCreate}
            disabled={loading || !roomName.trim()}
          >
            {loading ? 'Creating…' : 'Create Lobby'}
          </button>
        </form>
      </div>
    </div>
  );
}
