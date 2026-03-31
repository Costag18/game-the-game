import { useState } from 'react';
import styles from './War.module.css';
import { displayName } from '../utils/displayName.js';

const RANK_NAMES = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
};

const SUIT_SYMBOLS = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

function getRankName(rank) {
  return RANK_NAMES[rank] ?? String(rank);
}

function Card({ card, hidden = false, size = 'normal' }) {
  if (hidden || !card) {
    return (
      <div className={`${styles.card} ${styles.cardHidden} ${size === 'large' ? styles.cardLarge : ''}`}>
        ?
      </div>
    );
  }
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <div className={`${styles.card} ${isRed ? styles.cardRed : styles.cardBlack} ${size === 'large' ? styles.cardLarge : ''}`}>
      <span className={styles.cardRank}>{getRankName(card.rank)}</span>
      <span className={styles.cardSuit}>{SUIT_SYMBOLS[card.suit]}</span>
    </div>
  );
}

function DeckPile({ count, label }) {
  return (
    <div className={styles.deckPile}>
      <div className={styles.deckStack}>
        {count > 0 ? (
          <div className={`${styles.card} ${styles.cardHidden} ${styles.cardLarge}`}>
            {count}
          </div>
        ) : (
          <div className={`${styles.card} ${styles.cardEmpty} ${styles.cardLarge}`}>
            Empty
          </div>
        )}
      </div>
      <span className={styles.deckLabel}>{label}</span>
      <span className={styles.deckCount}>{count} cards</span>
    </div>
  );
}

export default function War({ gameState, onAction, nicknames }) {
  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    phase,
    myId,
    opponentId,
    myDeckSize,
    opponentDeckSize,
    myFlippedCard,
    opponentFlippedCard,
    flipCount,
    hasFlipped,
    pendingReveal,
    lastWinner,
  } = gameState;

  const [acked, setAcked] = useState(false);
  const [lastAckedFlip, setLastAckedFlip] = useState(0);

  // Reset ack when flip count changes (new round started)
  if (flipCount !== lastAckedFlip && !pendingReveal) {
    if (acked) setAcked(false);
    if (lastAckedFlip !== flipCount) setLastAckedFlip(flipCount);
  }

  const myName = displayName(myId, nicknames);
  const oppName = displayName(opponentId, nicknames);
  const isFinished = phase === 'finished';
  const isWar = phase === 'war';
  const canFlip = !hasFlipped && !isFinished && !pendingReveal;

  function getStatusText() {
    if (isFinished) {
      if (myDeckSize > opponentDeckSize) return `${myName} wins!`;
      if (opponentDeckSize > myDeckSize) return `${oppName} wins!`;
      return "It's a draw!";
    }
    if (pendingReveal && lastWinner) {
      const winnerName = displayName(lastWinner, nicknames);
      return `${winnerName} wins this flip!`;
    }
    if (isWar) {
      if (hasFlipped) return `War! Waiting for ${oppName}...`;
      return 'War! Flip your battle card!';
    }
    if (hasFlipped) return `Waiting for ${oppName}...`;
    return 'Flip your card!';
  }

  function handleAcknowledge() {
    setAcked(true);
    onAction({ type: 'acknowledge' });
  }

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>War</h1>

      {isWar && (
        <div className={styles.warBanner}>WAR!</div>
      )}

      {/* Game area */}
      <div className={styles.gameArea}>
        {/* Opponent side */}
        <DeckPile count={opponentDeckSize} label={oppName} />

        {/* Center battle zone */}
        <div className={styles.battleZone}>
          <div className={styles.flippedPair}>
            <div className={styles.flippedSlot}>
              <span className={styles.slotLabel}>{oppName}</span>
              {opponentFlippedCard ? (
                <Card card={opponentFlippedCard} size="large" />
              ) : (
                <div className={styles.emptySlot} />
              )}
            </div>
            <div className={styles.versus}>VS</div>
            <div className={styles.flippedSlot}>
              <span className={styles.slotLabel}>{myName}</span>
              {myFlippedCard ? (
                <Card card={myFlippedCard} size="large" />
              ) : (
                <div className={styles.emptySlot} />
              )}
            </div>
          </div>

          <div className={styles.flipCounter}>
            Flip {flipCount} / 26
          </div>
        </div>

        {/* My side */}
        <DeckPile count={myDeckSize} label={myName} />
      </div>

      {/* Status */}
      <p className={`${styles.statusText} ${isFinished ? styles.statusFinished : ''} ${isWar ? styles.statusWar : ''}`}>
        {getStatusText()}
      </p>

      {/* Flip button */}
      {canFlip && (
        <button
          className={`${styles.flipBtn} ${isWar ? styles.flipBtnWar : ''}`}
          onClick={() => onAction({ type: 'flip' })}
        >
          {isWar ? 'Battle!' : 'Flip Card'}
        </button>
      )}

      {/* Continue after reveal */}
      {pendingReveal && !acked && (
        <button className={styles.continueBtn} onClick={handleAcknowledge}>
          Continue
        </button>
      )}
      {pendingReveal && acked && (
        <p className={styles.waitingSmall}>Waiting for other player...</p>
      )}
    </div>
  );
}
