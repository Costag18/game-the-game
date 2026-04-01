import { useState } from 'react';
import styles from './LiarsDice.module.css';
import { displayName } from '../utils/displayName.js';

// Dot positions for each die face value (3x3 grid, cells 0-8 top-left to bottom-right)
const DOT_POSITIONS = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, highlight }) {
  const active = DOT_POSITIONS[value] || [];
  return (
    <div className={`${styles.die} ${highlight ? styles.dieHighlight : ''}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className={`${styles.dot} ${active.includes(i) ? '' : styles.dotHidden}`}
        />
      ))}
    </div>
  );
}

export default function LiarsDice({ gameState, onAction, playerId, nicknames }) {
  const [bidQuantity, setBidQuantity] = useState(1);
  const [bidFaceValue, setBidFaceValue] = useState(2);
  const [acked, setAcked] = useState(false);
  const [lastAckedPhase, setLastAckedPhase] = useState(null);

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
    challengeResult,
  } = gameState;

  const isFinished = phase === 'finished';
  const isChallenging = phase === 'challenging';

  // Reset ack when we leave challenging phase
  if (phase !== 'challenging' && lastAckedPhase === 'challenging') {
    setAcked(false);
  }
  if (phase !== lastAckedPhase) {
    setLastAckedPhase(phase);
  }

  function getStatusText() {
    if (isChallenging && challengeResult) {
      const loserName = displayName(challengeResult.loser, nicknames);
      return `Challenge! ${loserName} loses a die.`;
    }
    if (isFinished) return 'Game Over!';
    if (eliminated) return 'You have been eliminated.';
    if (isMyTurn) return 'Your turn — bid or challenge!';
    return `Waiting for ${displayName(currentTurnPlayer, nicknames)}'s turn...`;
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
              <Die key={i} value={val} highlight={val === 1} />
            ))}
          </div>
          {myDice.some((d) => d === 1) && (
            <p className={styles.wildNote}>1s are wild — they count as any face value!</p>
          )}
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
                <span className={styles.playerName}>{displayName(p.playerId, nicknames)}</span>
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

      {/* Challenge reveal */}
      {isChallenging && challengeResult && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>Challenge!</h3>
          <p className={styles.challengeInfo}>
            Bid: {challengeResult.bid.quantity} &times; {challengeResult.bid.faceValue}s
            &mdash; Actual count: <strong>{challengeResult.actualCount}</strong>
          </p>
          <p className={styles.challengeInfo}>
            {displayName(challengeResult.challenger, nicknames)} challenged {displayName(challengeResult.bidder, nicknames)}
            &mdash; <strong>{displayName(challengeResult.loser, nicknames)}</strong> loses a die!
          </p>
          <p className={styles.wildNote}>1s are wild and count as any face value</p>
          <div className={styles.revealGrid}>
            {Object.entries(challengeResult.allDice).map(([pid, dice]) => (
              <div key={pid} className={styles.revealPlayer}>
                <span className={styles.revealName}>{displayName(pid, nicknames)}</span>
                <div className={styles.diceRow}>
                  {dice.map((val, i) => (
                    <Die key={i} value={val} highlight={val === challengeResult.bid.faceValue || val === 1} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {!acked ? (
            <button className={styles.btnContinue} onClick={() => {
              setAcked(true);
              onAction({ type: 'acknowledge' });
            }}>
              Continue
            </button>
          ) : (
            <p className={styles.waitingSmall}>Waiting for others...</p>
          )}
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
                <span className={styles.resultPlayerId}>{displayName(r.playerId, nicknames)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
