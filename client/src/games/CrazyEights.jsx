import { useState } from 'react';
import styles from './CrazyEights.module.css';

const SUIT_SYMBOLS = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

const RANK_NAMES = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
};

function getRankName(rank) {
  return RANK_NAMES[rank] ?? String(rank);
}

function isRedSuit(suit) {
  return suit === 'hearts' || suit === 'diamonds';
}

function isEight(card) {
  return card.rank === 8;
}

function canPlay(card, topCard, activeSuit) {
  if (isEight(card)) return true;
  if (card.suit === activeSuit) return true;
  if (topCard && card.rank === topCard.rank) return true;
  return false;
}

function PlayingCard({ card, onClick, playable }) {
  const red = isRedSuit(card.suit);
  return (
    <button
      className={[
        styles.card,
        red ? styles.cardRed : styles.cardBlack,
        playable ? styles.cardPlayable : '',
        onClick ? '' : styles.cardStatic,
        isEight(card) ? styles.cardWild : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className={styles.cardCorner}>
        {getRankName(card.rank)}
        <br />
        {SUIT_SYMBOLS[card.suit]}
      </span>
      <span className={styles.cardCenter}>{SUIT_SYMBOLS[card.suit]}</span>
    </button>
  );
}

function SuitPicker({ onPick }) {
  const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  return (
    <div className={styles.suitPickerOverlay}>
      <div className={styles.suitPicker}>
        <p className={styles.suitPickerTitle}>Choose a suit</p>
        <div className={styles.suitPickerButtons}>
          {SUITS.map((s) => (
            <button
              key={s}
              className={[
                styles.suitBtn,
                isRedSuit(s) ? styles.suitRed : styles.suitBlack,
              ].join(' ')}
              onClick={() => onPick(s)}
            >
              {SUIT_SYMBOLS[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CrazyEights({ gameState, onAction }) {
  const [pickingSuit, setPickingSuit] = useState(false);
  const [pendingCardIndex, setPendingCardIndex] = useState(null);

  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    myHand,
    topDiscard,
    activeSuit,
    isMyTurn,
    phase,
    otherPlayers,
  } = gameState;

  const isFinished = phase === 'finished';

  function handleCardClick(index) {
    if (!isMyTurn) return;
    const card = myHand[index];
    if (!canPlay(card, topDiscard, activeSuit)) return;

    if (isEight(card)) {
      setPendingCardIndex(index);
      setPickingSuit(true);
    } else {
      onAction({ type: 'play', cardIndex: index });
    }
  }

  function handleSuitPick(suit) {
    setPickingSuit(false);
    onAction({ type: 'play', cardIndex: pendingCardIndex, chosenSuit: suit });
    setPendingCardIndex(null);
  }

  function handleDraw() {
    if (!isMyTurn) return;
    onAction({ type: 'draw' });
  }

  function getStatusText() {
    if (isFinished) return 'Game Over';
    if (isMyTurn) return 'Your turn — play a card or draw';
    return 'Waiting for your turn...';
  }

  return (
    <div className={styles.table}>
      {pickingSuit && <SuitPicker onPick={handleSuitPick} />}

      <h1 className={styles.title}>Crazy Eights</h1>

      {/* Opponents */}
      {otherPlayers && otherPlayers.length > 0 && (
        <section className={styles.opponentsSection}>
          {otherPlayers.map((op) => (
            <div key={op.playerId} className={styles.opponentBadge}>
              <span className={styles.opponentName}>{op.playerId}</span>
              <span className={styles.handCountBadge}>{op.handCount}</span>
            </div>
          ))}
        </section>
      )}

      {/* Play area */}
      <section className={styles.playArea}>
        {/* Discard pile */}
        <div className={styles.pileContainer}>
          <p className={styles.pileLabel}>Discard</p>
          {topDiscard ? (
            <PlayingCard card={topDiscard} playable={false} onClick={null} />
          ) : (
            <div className={[styles.card, styles.cardStatic, styles.cardEmpty].join(' ')}>—</div>
          )}
          {activeSuit && (
            <p className={styles.suitIndicator}>
              Active suit: {SUIT_SYMBOLS[activeSuit]}
              <span className={isRedSuit(activeSuit) ? styles.suitRed : styles.suitBlack}>
                {' '}{activeSuit}
              </span>
            </p>
          )}
        </div>

        {/* Draw pile */}
        <div className={styles.pileContainer}>
          <p className={styles.pileLabel}>Draw</p>
          <button
            className={[styles.card, styles.cardBack, isMyTurn ? styles.cardPlayable : ''].join(' ')}
            onClick={handleDraw}
            disabled={!isMyTurn}
          >
            <span className={styles.cardBackPattern}>♠</span>
          </button>
        </div>
      </section>

      {/* Player's hand */}
      <section className={styles.handSection}>
        <p className={styles.statusText}>{getStatusText()}</p>
        <div className={styles.handRow}>
          {(myHand || []).map((card, i) => (
            <PlayingCard
              key={i}
              card={card}
              playable={isMyTurn && canPlay(card, topDiscard, activeSuit)}
              onClick={isMyTurn ? () => handleCardClick(i) : null}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
