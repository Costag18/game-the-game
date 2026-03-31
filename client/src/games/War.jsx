import styles from './War.module.css';

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
    myDeckSize,
    opponentDeckSize,
    myFlippedCard,
    opponentFlippedCard,
    flipCount,
    hasFlipped,
  } = gameState;

  const isFinished = phase === 'finished';
  const isWar = phase === 'war';
  const canFlip = !hasFlipped && !isFinished;

  function getStatusText() {
    if (isFinished) {
      if (myDeckSize > opponentDeckSize) return 'You win!';
      if (opponentDeckSize > myDeckSize) return 'Opponent wins!';
      return "It's a draw!";
    }
    if (isWar) {
      if (hasFlipped) return 'War! Waiting for opponent...';
      return 'War! Flip your battle card!';
    }
    if (hasFlipped) return 'Card flipped! Waiting for opponent...';
    return 'Flip your card!';
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
        <DeckPile count={opponentDeckSize} label="Opponent" />

        {/* Center battle zone */}
        <div className={styles.battleZone}>
          <div className={styles.flippedPair}>
            <div className={styles.flippedSlot}>
              <span className={styles.slotLabel}>Opponent</span>
              {opponentFlippedCard ? (
                <Card card={opponentFlippedCard} size="large" />
              ) : (
                <div className={styles.emptySlot} />
              )}
            </div>
            <div className={styles.versus}>VS</div>
            <div className={styles.flippedSlot}>
              <span className={styles.slotLabel}>You</span>
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
        <DeckPile count={myDeckSize} label="You" />
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
    </div>
  );
}
