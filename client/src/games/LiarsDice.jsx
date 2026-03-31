import { useState } from 'react';
import styles from './LiarsDice.module.css';

// Dot positions for each die face value (3x3 grid, cells 0-8 top-left to bottom-right)
const DOT_POSITIONS = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ value }) {
  const active = DOT_POSITIONS[value] || [];
  return (
    <div className={styles.die}>
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className={`${styles.dot} ${active.includes(i) ? '' : styles.dotHidden}`}
        />
      ))}
    </div>
  );
}

export default function LiarsDice({ gameState, onAction, playerId }) {
  const [bidQuantity, setBidQuantity] = useState(1);
  const [bidFaceValue, setBidFaceValue] = useState(2);

  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    myDice,
    otherPlayers,
    currentBid,
    currentTurnPlayer,
    isMyTurn,
    phase,
    eliminated,
  } = gameState;

  const isFinished = phase === 'finished';

  function getStatusText() {
    if (isFinished) return 'Game Over!';
    if (eliminated) return 'You have been eliminated.';
    if (isMyTurn) return 'Your turn — bid or challenge!';
    return `Waiting for ${currentTurnPlayer}'s turn...`;
  }

  function handleBid() {
    onAction({ type: 'bid', quantity: bidQuantity, faceValue: bidFaceValue });
  }

  function handleChallenge() {
    onAction({ type: 'challenge' });
  }

  const canChallenge = isMyTurn && currentBid !== null;
  const totalDice = (myDice ? myDice.length : 0) +
    (otherPlayers ? otherPlayers.reduce((s, p) => s + p.diceCount, 0) : 0);
  const maxQuantity = Math.max(totalDice, 1);

  // Build quantity options starting from current bid quantity (or 1 for first bid)
  const minQuantity = currentBid ? currentBid.quantity : 1;
  const quantityOptions = Array.from({ length: maxQuantity }, (_, i) => i + 1)
    .filter((q) => q >= minQuantity);

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Liar's Dice</h1>

      <p className={styles.statusText}>{getStatusText()}</p>

      {/* Your dice */}
      {!eliminated && myDice && myDice.length > 0 && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>Your Dice ({myDice.length})</h3>
          <div className={styles.diceRow}>
            {myDice.map((val, i) => (
              <Die key={i} value={val} />
            ))}
          </div>
        </section>
      )}

      {/* Other players */}
      {otherPlayers && otherPlayers.length > 0 && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>Other Players</h3>
          <div className={styles.playersList}>
            {otherPlayers.map((p) => (
              <div
                key={p.playerId}
                className={`${styles.playerRow} ${p.eliminated ? styles.eliminated : ''} ${p.playerId === currentTurnPlayer ? styles.activeTurn : ''}`}
              >
                <span className={styles.playerName}>{p.playerId}</span>
                <span className={styles.diceCount}>
                  {p.eliminated ? '0' : p.diceCount} dice
                </span>
                {p.eliminated && (
                  <span className={styles.badgeEliminated}>Eliminated</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Current bid */}
      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>Current Bid</h3>
        {currentBid ? (
          <p className={styles.bidDisplay}>
            {currentBid.quantity} &times; {currentBid.faceValue}s
          </p>
        ) : (
          <p className={styles.bidNone}>No bid yet — make the first bid!</p>
        )}
      </section>

      {/* Actions */}
      {isMyTurn && !isFinished && !eliminated && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>Your Action</h3>
          <div className={styles.bidControls}>
            <label className={styles.selectLabel}>
              Quantity
              <select
                className={styles.select}
                value={bidQuantity}
                onChange={(e) => setBidQuantity(Number(e.target.value))}
              >
                {quantityOptions.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </label>
            <label className={styles.selectLabel}>
              Face Value
              <select
                className={styles.select}
                value={bidFaceValue}
                onChange={(e) => setBidFaceValue(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <button className={styles.btnBid} onClick={handleBid}>
              Bid
            </button>
            <button
              className={styles.btnChallenge}
              onClick={handleChallenge}
              disabled={!canChallenge}
            >
              Challenge
            </button>
          </div>
        </section>
      )}

      {/* Results */}
      {isFinished && (
        <section className={styles.panel}>
          <h2 className={styles.resultsTitle}>Final Results</h2>
          <ul className={styles.resultsList}>
            {[
              ...(gameState.results || []),
            ].map((r, i) => (
              <li key={r.playerId} className={styles.resultItem}>
                <span className={styles.placement}>#{r.placement}</span>
                <span className={styles.resultPlayerId}>{r.playerId}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
