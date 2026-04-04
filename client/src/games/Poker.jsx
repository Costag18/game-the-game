import { useState, useEffect, useRef } from 'react';
import styles from './Poker.module.css';
import { displayName } from '../utils/displayName.js';
import { useScreenShake } from '../hooks/useScreenShake.js';
import { useSound } from '../context/SoundContext.jsx';

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

function Card({ card, hidden = false, small = false, dealIndex }) {
  const cls = [
    styles.card,
    hidden ? styles.cardHidden : '',
    small ? styles.cardSmall : '',
    dealIndex != null ? styles.cardDeal : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (hidden) {
    return <div className={cls} style={dealIndex != null ? { animationDelay: `${dealIndex * 120}ms` } : undefined}>🂠</div>;
  }

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <div className={`${cls} ${isRed ? styles.cardRed : styles.cardBlack}`} style={dealIndex != null ? { animationDelay: `${dealIndex * 120}ms` } : undefined}>
      <span className={styles.cardRank}>{getRankName(card.rank)}</span>
      <span className={styles.cardSuit}>{SUIT_SYMBOLS[card.suit]}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Poker({ gameState, onAction, playerId, nicknames }) {
  const shake = useScreenShake();
  const { playSound } = useSound();
  const [raiseAmount, setRaiseAmount] = useState('');
  const prevCommunityCount = useRef(0);
  const prevHoleCount = useRef(0);

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
    lastHandWinner,
    handNumber = 1,
    totalHands = 3,
    handResults = [],
  } = gameState;

  const iAmFolded = folded && folded.includes(playerId);
  const isActive = ['preflop', 'flop', 'turn', 'river'].includes(phase);

  // Track card counts for deal animation
  const communityCount = (communityCards || []).length;
  const holeCount = (myHoleCards || []).length;
  const communityAnimFrom = prevCommunityCount.current;
  const holeAnimFrom = prevHoleCount.current;
  useEffect(() => { prevCommunityCount.current = communityCount; }, [communityCount]);
  useEffect(() => { prevHoleCount.current = holeCount; }, [holeCount]);

  // Shake on showdown reveal
  useEffect(() => {
    if (phase === 'reveal' && lastHandWinner) shake('medium');
  }, [phase, lastHandWinner]);
  const isReveal = phase === 'reveal';
  const isFinished = phase === 'finished' || phase === 'showdown' || phase === 'reveal';

  const toCall = Math.max(0, currentBet - myBet);
  const canCheck = isMyTurn && toCall === 0;
  const canCall = isMyTurn && toCall > 0;
  const canRaise = isMyTurn && !iAmFolded && myChips > 0;
  const canAllIn = isMyTurn && !iAmFolded && myChips > 0;
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
  function handleAllIn() {
    onAction({ type: 'allin' });
    shake('heavy');
    playSound('coinFlip');
  }

  function getStatusText() {
    if (phase === 'reveal' && lastHandWinner) {
      return `${displayName(lastHandWinner, nicknames)} wins the hand!`;
    }
    if (iAmFolded) return 'You folded.';
    if (phase === 'finished') return 'Game Over!';
    if (phase === 'showdown') return 'Showdown!';
    if (isMyTurn) return 'Your turn — choose an action.';
    return 'Waiting for other players...';
  }

  const [showHands, setShowHands] = useState(false);

  return (
    <div className={styles.tableOuter}>
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
              Hand {hr.hand}: {hr.winner ? displayName(hr.winner, nicknames) : '?'} — {hr.handDescription}
            </span>
          ))}
        </div>
      )}

      {/* Community cards */}
      <section className={styles.communitySection}>
        <h3 className={styles.sectionHeading}>Community Cards</h3>
        <div className={styles.cardRow}>
          {communityCards && communityCards.length > 0
            ? communityCards.map((card, i) => <Card key={i} card={card} dealIndex={i >= communityAnimFrom ? i - communityAnimFrom : undefined} />)
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
                <span className={styles.otherPlayerId}>{displayName(p.playerId, nicknames)}</span>

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
            ? myHoleCards.map((card, i) => <Card key={i} card={card} dealIndex={i >= holeAnimFrom ? i - holeAnimFrom : undefined} />)
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
                {canAllIn && (
                  <button className={styles.btnAllIn} onClick={handleAllIn}>
                    All In ({myChips})
                  </button>
                )}
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
              const isWinner = pid === lastHandWinner;
              return (
                <div key={pid} className={`${styles.revealRow} ${isWinner ? styles.revealRowWinner : ''}`}>
                  <div className={styles.revealPlayerInfo}>
                    <span className={styles.revealPlayerId}>
                      {isWinner && '🏆 '}{displayName(pid, nicknames)}
                    </span>
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

    {/* Hand rankings at bottom */}
    <div className={styles.handRankingsBar}>
      <button className={styles.handRankingsToggle} onClick={() => setShowHands(!showHands)}>
        {showHands ? 'Hide Hand Rankings ▲' : '♠ ♥ Hand Rankings ♦ ♣'}
      </button>
      {showHands && (
        <div className={styles.handRankingsGrid}>
          {[
            { rank: 1, name: 'Royal Flush', ex: 'A K Q J 10', suit: '♠', color: 'black', desc: 'Same suit' },
            { rank: 2, name: 'Straight Flush', ex: '9 8 7 6 5', suit: '♥', color: 'red', desc: 'Same suit, in order' },
            { rank: 3, name: 'Four of a Kind', ex: 'K K K K', suit: '♠♦♥♣', color: 'mixed', desc: '4 matching' },
            { rank: 4, name: 'Full House', ex: 'J J J 8 8', suit: '', color: 'mixed', desc: '3 + pair' },
            { rank: 5, name: 'Flush', ex: 'A J 8 6 2', suit: '♦', color: 'red', desc: 'All same suit' },
            { rank: 6, name: 'Straight', ex: '10 9 8 7 6', suit: '', color: 'mixed', desc: '5 in order' },
            { rank: 7, name: 'Three of a Kind', ex: '7 7 7', suit: '♠♥♦', color: 'mixed', desc: '3 matching' },
            { rank: 8, name: 'Two Pair', ex: 'A A 9 9', suit: '', color: 'mixed', desc: '2 pairs' },
            { rank: 9, name: 'One Pair', ex: 'Q Q', suit: '♥♠', color: 'mixed', desc: '2 matching' },
            { rank: 10, name: 'High Card', ex: 'A', suit: '♠', color: 'black', desc: 'Highest wins' },
          ].map((h) => (
            <div key={h.rank} className={styles.handRankCard}>
              <div className={styles.handRankHeader}>
                <span className={styles.handRankNum}>{h.rank}</span>
                <span className={styles.handRankName}>{h.name}</span>
              </div>
              <div className={styles.handRankExample}>
                <span className={styles.handRankEx}>{h.ex}</span>
                {h.suit && (
                  <span className={`${styles.handRankSuit} ${h.color === 'red' ? styles.suitRed : ''}`}>
                    {h.suit}
                  </span>
                )}
              </div>
              <span className={styles.handRankDesc}>{h.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
