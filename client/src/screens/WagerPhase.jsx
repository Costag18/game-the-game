import { useState } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { GAMES } from '../../../shared/gameList.js';
import styles from './WagerPhase.module.css';

export default function WagerPhase({ tournamentState, voteResult, onSubmitWager }) {
  const { socket } = useSocketContext();
  const [wagerLocked, setWagerLocked] = useState(false);

  const myId = socket?.id;
  const myScore = tournamentState?.scores?.[myId] ?? 0;
  const maxWager = Math.floor(myScore * 0.5);

  const [wager, setWager] = useState(0);

  const gameId = voteResult?.selectedGame ?? voteResult?.gameId;
  const game = gameId ? GAMES[gameId] : null;

  function handleLockIn() {
    if (wagerLocked) return;
    setWagerLocked(true);
    onSubmitWager(wager);
  }

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <h2 className={styles.title}>Place Your Wager</h2>

        {game && (
          <div className={styles.gameInfo}>
            <span className={styles.gameLabel}>Selected Game</span>
            <span className={styles.gameName}>{game.name}</span>
            <p className={styles.gameDesc}>{game.description}</p>
          </div>
        )}

        <div className={styles.scoreRow}>
          <span className={styles.scoreLabel}>Your Points</span>
          <span className={styles.scoreValue}>{myScore.toLocaleString()}</span>
        </div>

        {!wagerLocked ? (
          <>
            <div className={styles.sliderSection}>
              <div className={styles.sliderHeader}>
                <span className={styles.sliderLabel}>Wager Amount</span>
                <span className={styles.wagerAmount}>{wager.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min={0}
                max={maxWager}
                value={wager}
                onChange={(e) => setWager(Number(e.target.value))}
                className={styles.slider}
                disabled={maxWager === 0}
              />
              <div className={styles.sliderBounds}>
                <span>0</span>
                <span>{maxWager.toLocaleString()} (50%)</span>
              </div>
            </div>

            <button
              className={styles.btnLockIn}
              onClick={handleLockIn}
            >
              Lock In Wager
            </button>
          </>
        ) : (
          <p className={styles.locked}>Wager locked! Waiting for others...</p>
        )}
      </div>
    </div>
  );
}
