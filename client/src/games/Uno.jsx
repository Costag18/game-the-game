import { useState } from 'react';
import styles from './Uno.module.css';
import { displayName } from '../utils/displayName.js';

const COLOR_MAP = {
  red: styles.colorRed,
  yellow: styles.colorYellow,
  green: styles.colorGreen,
  blue: styles.colorBlue,
};

const RANK_SYMBOL = {
  Skip: '⊘',
  Reverse: '↻',
};

const RANK_LETTER = {
  Skip: 'S',
  Reverse: 'R',
  DrawTwo: '+2',
  Wild: 'W',
  WildDrawFour: 'W+4',
};

function getRankDisplay(rank) {
  return RANK_LETTER[rank] ?? String(rank);
}

function getRankSymbol(rank) {
  return RANK_SYMBOL[rank] ?? null;
}

function UnoCard({ card, onClick, selected, playable }) {
  const colorClass = card.color ? COLOR_MAP[card.color] : styles.colorWild;
  return (
    <button
      className={[
        styles.card,
        colorClass,
        selected ? styles.cardSelected : '',
        playable ? styles.cardPlayable : '',
        onClick ? '' : styles.cardStatic,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      disabled={!onClick}
    >
      {getRankSymbol(card.rank) && (
        <span className={styles.cardSymbol}>{getRankSymbol(card.rank)}</span>
      )}
      <span className={styles.cardRank}>{getRankDisplay(card.rank)}</span>
    </button>
  );
}

function DiscardPile({ topCard, currentColor }) {
  const colorClass = currentColor ? COLOR_MAP[currentColor] : styles.colorWild;
  return (
    <div className={styles.discardArea}>
      <p className={styles.pileLabel}>Discard</p>
      {topCard ? (
        <div className={[styles.card, styles.cardStatic, colorClass].join(' ')}>
          {getRankSymbol(topCard.rank) && (
            <span className={styles.cardSymbol}>{getRankSymbol(topCard.rank)}</span>
          )}
          <span className={styles.cardRank}>{getRankDisplay(topCard.rank)}</span>
        </div>
      ) : (
        <div className={[styles.card, styles.cardStatic, styles.cardEmpty].join(' ')}>—</div>
      )}
      <p className={styles.colorIndicator}>Color: {currentColor ?? '?'}</p>
    </div>
  );
}

function OpponentBadge({ label, handCount }) {
  return (
    <div className={styles.opponentBadge}>
      <span className={styles.opponentName}>{label}</span>
      <span className={styles.handCountBadge}>{handCount}</span>
    </div>
  );
}

function ColorPicker({ onPick }) {
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  return (
    <div className={styles.colorPickerOverlay}>
      <div className={styles.colorPicker}>
        <p className={styles.colorPickerTitle}>Choose a color</p>
        <div className={styles.colorPickerButtons}>
          {COLORS.map((c) => (
            <button
              key={c}
              className={[styles.colorBtn, COLOR_MAP[c]].join(' ')}
              onClick={() => onPick(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function isWild(card) {
  return card.rank === 'Wild' || card.rank === 'WildDrawFour';
}

function canPlay(card, topCard, currentColor) {
  if (isWild(card)) return true;
  if (card.color === currentColor) return true;
  if (topCard && card.rank === topCard.rank) return true;
  return false;
}

export default function Uno({ gameState, onAction, nicknames }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [pickingColor, setPickingColor] = useState(false);
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
    currentColor,
    direction,
    isMyTurn,
    phase,
    otherPlayers,
    drawnCard,
    lastPlayedRank,
    canAct,
  } = gameState;

  const isFinished = phase === 'finished';

  // During consecutive play, only same-rank cards are playable
  const inConsecutivePlay = lastPlayedRank !== null && lastPlayedRank !== undefined;

  function isCardPlayable(card) {
    if (inConsecutivePlay) return card.rank === lastPlayedRank;
    return canPlay(card, topDiscard, currentColor);
  }

  function handleCardClick(index) {
    if (!isMyTurn) return;
    const card = myHand[index];
    if (!isCardPlayable(card)) return;

    if (isWild(card)) {
      setPendingCardIndex(index);
      setPickingColor(true);
    } else {
      onAction({ type: 'play', cardIndex: index });
      setSelectedIndex(null);
    }
  }

  function handleColorPick(color) {
    setPickingColor(false);
    onAction({ type: 'play', cardIndex: pendingCardIndex, chosenColor: color });
    setPendingCardIndex(null);
    setSelectedIndex(null);
  }

  function handleDraw() {
    if (!isMyTurn || drawnCard) return;
    onAction({ type: 'draw' });
    setSelectedIndex(null);
  }

  function handlePass() {
    if (!isMyTurn) return;
    onAction({ type: 'pass' });
    setSelectedIndex(null);
  }

  function handleForceAdvance() {
    if (!isMyTurn) return;
    onAction({ type: 'forceAdvance' });
    setSelectedIndex(null);
  }

  function getStatusText() {
    if (isFinished) return 'Game Over';
    if (!isMyTurn) return 'Waiting for your turn...';
    if (isMyTurn && canAct === false) return 'No moves available — pass your turn';
    if (drawnCard) return 'You drew a playable card — play it or pass';
    if (lastPlayedRank !== null && lastPlayedRank !== undefined) return `Play another ${lastPlayedRank} or pass`;
    return 'Your turn — play a card or draw';
  }

  return (
    <div className={styles.table}>
      {pickingColor && <ColorPicker onPick={handleColorPick} />}

      <h1 className={styles.title}>Uno</h1>

      {/* Opponents */}
      {otherPlayers && otherPlayers.length > 0 && (
        <section className={styles.opponentsSection}>
          {otherPlayers.map((op) => (
            <OpponentBadge
              key={op.playerId}
              label={displayName(op.playerId, nicknames)}
              handCount={op.handCount}
            />
          ))}
        </section>
      )}

      {/* Play area */}
      <section className={styles.playArea}>
        <DiscardPile topCard={topDiscard} currentColor={currentColor} />
        <div className={styles.drawPileArea}>
          <p className={styles.pileLabel}>Draw</p>
          <button
            className={[styles.card, styles.cardDraw, (isMyTurn && !drawnCard && !lastPlayedRank) ? styles.cardPlayable : ''].join(' ')}
            onClick={handleDraw}
            disabled={!isMyTurn || drawnCard || (lastPlayedRank !== null && lastPlayedRank !== undefined)}
          >
            <span className={styles.cardRank}>↓</span>
          </button>
          {isMyTurn && (drawnCard || (lastPlayedRank !== null && lastPlayedRank !== undefined)) && (
            <button className={styles.passButton} onClick={handlePass}>
              Pass
            </button>
          )}
          {isMyTurn && canAct === false && (
            <button className={styles.passButton} onClick={handleForceAdvance}>
              Pass Turn
            </button>
          )}
        </div>
        <div className={styles.directionIndicator}>
          {direction === 1 ? '→ CW' : '← CCW'}
        </div>
      </section>

      {/* Player's hand */}
      <section className={styles.handSection}>
        <p className={styles.statusText}>{getStatusText()}</p>
        <div className={styles.handRow}>
          {(myHand || []).map((card, i) => (
            <UnoCard
              key={i}
              card={card}
              selected={selectedIndex === i}
              playable={isMyTurn && isCardPlayable(card)}
              onClick={isMyTurn ? () => handleCardClick(i) : null}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
