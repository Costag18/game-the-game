import { useState } from 'react';
import styles from './Poker.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const PHASE_LABELS = {
  waiting: 'Waiting',
  preflop: 'Pre-Flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
  finished: 'Game Over',
};

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

function Card({ card, hidden = false, small = false }) {
  const cls = [
    styles.card,
    hidden ? styles.cardHidden : '',
    small ? styles.cardSmall : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (hidden) {
    return <div className={cls}>🂠</div>;
  }

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <div className={`${cls} ${isRed ? styles.cardRed : styles.cardBlack}`}>
      <span className={styles.cardRank}>{getRankName(card.rank)}</span>
      <span className={styles.cardSuit}>{SUIT_SYMBOLS[card.suit]}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Poker({ gameState, onAction, playerId }) {
  const [raiseAmount, setRaiseAmount] = useState('');

  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    phase,
    myHoleCards,
    communityCards,
    pot,
    currentBet,
    myChips,
    myBet,
    isMyTurn,
    folded,
    otherPlayers,
    revealedHands,
    handNumber = 1,
    totalHands = 3,
    handResults = [],
  } = gameState;

  const iAmFolded = folded && folded.includes(playerId);
  const isActive = ['preflop', 'flop', 'turn', 'river'].includes(phase);
  const isFinished = phase === 'finished' || phase === 'showdown';

  const toCall = Math.max(0, currentBet - myBet);
  const canCheck = isMyTurn && toCall === 0;
  const canCall = isMyTurn && toCall > 0;
  const canRaise = isMyTurn && !iAmFolded;
  const minRaise = currentBet + 20;

  function handleFold() {
    onAction({ type: 'fold' });
  }
  function handleCheck() {
    onAction({ type: 'check' });
  }
  function handleCall() {
    onAction({ type: 'call' });
  }
  function handleRaise() {
    const amt = Number(raiseAmount);
    if (!amt || isNaN(amt)) return;
    onAction({ type: 'raise', amount: amt });
    setRaiseAmount('');
  }

  function getStatusText() {
    if (iAmFolded) return 'You folded.';
    if (phase === 'finished') return 'Hand complete!';
    if (phase === 'showdown') return 'Showdown!';
    if (isMyTurn) return 'Your turn — choose an action.';
    return 'Waiting for other players...';
  }

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Texas Hold'em</h1>

      {/* Phase badge + pot */}
      <div className={styles.infoBar}>
        <span className={styles.phaseBadge}>Hand {handNumber}/{totalHands}</span>
        <span className={styles.phaseBadge}>{PHASE_LABELS[phase] ?? phase}</span>
        <span className={styles.potDisplay}>Pot: {pot}</span>
      </div>

      {/* Previous hand results */}
      {handResults.length > 0 && (
        <div className={styles.handHistory}>
          {handResults.map((hr, i) => (
            <span key={i} className={styles.handHistoryItem}>
              Hand {hr.hand}: {hr.winner?.slice(0, 8) ?? '?'} — {hr.handDescription}
            </span>
          ))}
        </div>
      )}

      {/* Community cards */}
      <section className={styles.communitySection}>
        <h3 className={styles.sectionHeading}>Community Cards</h3>
        <div className={styles.cardRow}>
          {communityCards && communityCards.length > 0
            ? communityCards.map((card, i) => <Card key={i} card={card} />)
            : <span className={styles.placeholder}>No cards yet</span>}
        </div>
      </section>

      {/* Other players */}
      {otherPlayers && otherPlayers.length > 0 && (
        <section className={styles.othersSection}>
          <h3 className={styles.sectionHeading}>Other Players</h3>
          <div className={styles.otherPlayersList}>
            {otherPlayers.map((p) => (
              <div
                key={p.playerId}
                className={`${styles.otherPlayer} ${p.folded ? styles.otherPlayerFolded : ''}`}
              >
                <span className={styles.otherPlayerId}>{p.playerId}</span>

                {/* Card backs (or revealed cards in showdown) */}
                <div className={styles.otherCardRow}>
                  {revealedHands && revealedHands[p.playerId]
                    ? (revealedHands[p.playerId].cards || revealedHands[p.playerId]).map?.((card, i) => (
                        <Card key={i} card={card} small />
                      )) ?? Array.from({ length: p.cardCount }).map((_, i) => (
                        <Card key={i} hidden small />
                      ))
                    : Array.from({ length: p.cardCount }).map((_, i) => (
                        <Card key={i} hidden small />
                      ))}
                </div>
                {revealedHands && revealedHands[p.playerId]?.handDescription && (
                  <span className={styles.handLabel}>{revealedHands[p.playerId].handDescription}</span>
                )}

                <span className={styles.otherChips}>{p.chips} chips</span>
                {p.bet > 0 && <span className={styles.otherBet}>bet: {p.bet}</span>}
                {p.folded && <span className={styles.badgeFolded}>Folded</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Player's own section */}
      <section className={`${styles.playerSection} ${iAmFolded ? styles.playerSectionFolded : ''}`}>
        <h3 className={styles.sectionHeading}>Your Hand</h3>
        <div className={styles.cardRow}>
          {myHoleCards && myHoleCards.length > 0
            ? myHoleCards.map((card, i) => <Card key={i} card={card} />)
            : <span className={styles.placeholder}>No cards</span>}
        </div>

        <div className={styles.chipsRow}>
          <span className={styles.chipsLabel}>Chips: <strong>{myChips}</strong></span>
          {myBet > 0 && <span className={styles.myBetLabel}>Bet: {myBet}</span>}
        </div>

        <p className={styles.statusText}>{getStatusText()}</p>

        {/* Actions */}
        {isMyTurn && !iAmFolded && isActive && (
          <div className={styles.actionsArea}>
            <div className={styles.actionButtons}>
              <button className={styles.btnFold} onClick={handleFold}>Fold</button>
              {canCheck && (
                <button className={styles.btnCheck} onClick={handleCheck}>Check</button>
              )}
              {canCall && (
                <button className={styles.btnCall} onClick={handleCall}>
                  Call {toCall}
                </button>
              )}
            </div>
            {canRaise && (
              <div className={styles.raiseRow}>
                <input
                  type="number"
                  className={styles.raiseInput}
                  placeholder={`Min ${minRaise}`}
                  value={raiseAmount}
                  min={minRaise}
                  onChange={(e) => setRaiseAmount(e.target.value)}
                />
                <button
                  className={styles.btnRaise}
                  onClick={handleRaise}
                  disabled={!raiseAmount || Number(raiseAmount) < minRaise}
                >
                  Raise
                </button>
              </div>
            )}
          </div>
        )}

        {/* Show results when finished */}
        {isFinished && revealedHands && Object.keys(revealedHands).length > 0 && (
          <div className={styles.revealSection}>
            <h4 className={styles.revealHeading}>Showdown</h4>
            {Object.entries(revealedHands).map(([pid, data]) => {
              const cards = data?.cards || (Array.isArray(data) ? data : []);
              const desc = data?.handDescription;
              return (
                <div key={pid} className={styles.revealRow}>
                  <div className={styles.revealPlayerInfo}>
                    <span className={styles.revealPlayerId}>{pid.slice(0, 8)}</span>
                    {desc && <span className={styles.handLabel}>{desc}</span>}
                  </div>
                  <div className={styles.cardRow}>
                    {cards.map((card, i) => <Card key={i} card={card} small />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
