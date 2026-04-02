import { useState, useEffect } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import CasinoSidebar from '../components/CasinoSidebar.jsx';
import styles from './CasinoMode.module.css';

export default function CasinoMode({ onBack }) {
  const { socket } = useSocketContext();
  const [score, setScore] = useState(null);

  useEffect(() => {
    if (!socket) return;

    socket.emit(EVENTS.CASINO_JOIN);

    function onCasinoState(data) { setScore(data.score); }
    function onTournamentState(data) {
      const myScore = data.scores?.[socket.id];
      if (myScore != null) setScore(myScore);
    }

    socket.on(EVENTS.CASINO_STATE, onCasinoState);
    socket.on(EVENTS.TOURNAMENT_STATE, onTournamentState);

    return () => {
      socket.off(EVENTS.CASINO_STATE, onCasinoState);
      socket.off(EVENTS.TOURNAMENT_STATE, onTournamentState);
    };
  }, [socket]);

  if (score === null) {
    return (
      <div className={styles.container}>
        <p className={styles.loading}>Loading casino...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>&larr; Back</button>
        <h1 className={styles.title}>Free Play Casino</h1>
        <div className={styles.scoreBox}>
          <span className={styles.scoreLabel}>Balance</span>
          <span className={styles.scoreValue}>{score.toLocaleString()}</span>
        </div>
      </div>
      <CasinoSidebar socket={socket} myScore={score} />
    </div>
  );
}
