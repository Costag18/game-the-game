import styles from './MemoryMatch.module.css';
import { displayName } from '../utils/displayName.js';

function MemoryCard({ card, position, isMyTurn, onFlip }) {
  if (card.matched) {
    return (
      <div className={`${styles.card} ${styles.cardMatched}`}>
        {card.value}
      </div>
    );
  }
  if (card.faceUp) {
    return (
      <div className={`${styles.card} ${styles.cardFaceUp}`}>
        {card.value}
      </div>
    );
  }
  // Face-down
  const canFlip = isMyTurn;
  return (
    <div
      className={`${styles.card} ${styles.cardBack} ${canFlip ? styles.canFlip : styles.noFlip}`}
      onClick={canFlip ? () => onFlip(position) : undefined}
    >
      ?
    </div>
  );
}

export default function MemoryMatch({ gameState, onAction, playerId, nicknames }) {
  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const { board, pairs, currentTurnPlayer, isMyTurn, phase } = gameState;
  const isFinished = phase === 'finished';

  function handleFlip(position) {
    onAction({ type: 'flip', position });
  }

  function getStatusText() {
    if (isFinished) return 'Game Over!';
    if (isMyTurn) return 'Your turn — flip a card!';
    return `Waiting for ${displayName(currentTurnPlayer, nicknames)}'s turn...`;
  }

  const matchedCount = board ? board.filter((c) => c.matched).length / 2 : 0;

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Memory Match</h1>

      <p className={styles.statusText}>{getStatusText()}</p>

      {/* Scoreboard */}
      {pairs && (
        <section className={styles.scoreboard}>
          <h3 className={styles.scoreboardTitle}>Pairs Collected</h3>
          <ul className={styles.scoreList}>
            {Object.entries(pairs).map(([pid, count]) => (
              <li
                key={pid}
                className={`${styles.scoreItem} ${pid === currentTurnPlayer ? styles.activePlayer : ''}`}
              >
                {displayName(pid, nicknames)}: {count} pair{count !== 1 ? 's' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Board */}
      {board && (
        <section className={styles.boardSection}>
          <div className={styles.grid}>
            {board.map((card, i) => (
              <MemoryCard
                key={i}
                card={card}
                position={i}
                isMyTurn={isMyTurn}
                onFlip={handleFlip}
              />
            ))}
          </div>
        </section>
      )}

      {/* Results */}
      {isFinished && (
        <section className={styles.resultsSection}>
          <h2 className={styles.resultsTitle}>Final Results</h2>
          <ul className={styles.resultsList}>
            {Object.entries(pairs || {})
              .sort((a, b) => b[1] - a[1])
              .map(([pid, count], i) => (
                <li key={pid} className={styles.resultItem}>
                  <span className={styles.placement}>#{i + 1}</span>
                  <span className={styles.resultPlayerId}>{displayName(pid, nicknames)}</span>
                  <span className={styles.resultPairs}>{count} pairs</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
