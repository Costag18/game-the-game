import { useState, useEffect, useRef } from 'react';
import styles from './GoFish.module.css';
import { displayName } from '../utils/displayName.js';
import PlayerName from '../components/PlayerName.jsx';

const RANK_NAMES = {
  1: 'A', 11: 'J', 12: 'Q', 13: 'K',
};

function getRankName(rank) {
  return RANK_NAMES[rank] ?? String(rank);
}

function getRankLabel(rank) {
  return RANK_NAMES[rank] ?? String(rank);
}

function CardMini({ rank, suit, dealIndex }) {
  const isRed = suit === 'hearts' || suit === 'diamonds';
  const suitSymbols = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
  return (
    <span
      className={`${styles.cardMini} ${isRed ? styles.cardRed : styles.cardBlack} ${dealIndex != null ? styles.cardDeal : ''}`}
      style={dealIndex != null ? { animationDelay: `${dealIndex * 60}ms` } : undefined}
    >
      {getRankName(rank)}{suitSymbols[suit]}
    </span>
  );
}

export default function GoFish({ gameState, onAction, currentPlayerId, nicknames, avatars }) {
  const [selectedTarget, setSelectedTarget] = useState('');
  const [selectedRank, setSelectedRank] = useState('');
  const prevHandCount = useRef(0);

  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    myHand,
    myCompletedSets,
    otherPlayers,
    currentTurnPlayer,
    isMyTurn,
    deckRemaining,
    phase,
    lastAction,
  } = gameState;

  const isFinished = phase === 'finished';

  const goFishHandCount = (myHand || []).length;
  const goFishAnimFrom = prevHandCount.current;
  useEffect(() => { prevHandCount.current = goFishHandCount; }, [goFishHandCount]);

  // Get unique ranks in my hand for the ask dropdown
  const myRanks = [...new Set((myHand || []).map((c) => c.rank))].sort((a, b) => a - b);

  function handleAsk() {
    if (!selectedTarget || !selectedRank) return;
    onAction({ type: 'ask', targetPlayer: selectedTarget, rank: Number(selectedRank) });
    setSelectedRank('');
  }

  function getLastActionText() {
    if (!lastAction) return null;
    const { type, playerId: actionPlayerId, targetPlayer, rank, count } = lastAction;
    const rankName = getRankLabel(rank);
    const actorName = displayName(actionPlayerId, nicknames);
    const targetName = displayName(targetPlayer, nicknames);
    if (type === 'transfer') {
      return `${actorName} asked ${targetName} for ${rankName}s and got ${count} card${count !== 1 ? 's' : ''}!`;
    }
    if (type === 'goFish') {
      return `${actorName} asked for ${rankName}s — Go Fish!`;
    }
    if (type === 'luckyFish') {
      return `${actorName} asked for ${rankName}s — Go Fish! Drew the right card — go again!`;
    }
    return null;
  }

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Go Fish</h1>

      {/* Status bar */}
      <div className={styles.statusBar}>
        <span className={styles.deckCount}>Deck: {deckRemaining} cards</span>
        {isFinished ? (
          <span className={styles.statusFinished}>Game Over</span>
        ) : isMyTurn ? (
          <span className={styles.statusMyTurn}>Your turn!</span>
        ) : (
          <span className={styles.statusWaiting}>
            Waiting for <PlayerName playerId={currentTurnPlayer} nicknames={nicknames} avatars={avatars} />...
          </span>
        )}
      </div>

      {/* Last action */}
      {lastAction && (
        <div className={styles.lastAction}>{getLastActionText()}</div>
      )}

      {/* Opponents */}
      <section className={styles.opponentsSection}>
        <h2 className={styles.sectionTitle}>Opponents</h2>
        <div className={styles.opponentsList}>
          {(otherPlayers || []).map((p) => (
            <div
              key={p.playerId}
              className={`${styles.opponent} ${currentTurnPlayer === p.playerId ? styles.opponentActive : ''}`}
            >
              <span className={styles.opponentName}><PlayerName playerId={p.playerId} nicknames={nicknames} avatars={avatars} /></span>
              <span className={styles.opponentCards}>{p.cardCount} cards</span>
              <span className={styles.opponentSets}>
                {p.completedSets} {p.completedSets === 1 ? 'set' : 'sets'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* My sets */}
      <section className={styles.mySection}>
        <div className={styles.mySetsRow}>
          <span className={styles.mySetsLabel}>Your completed sets:</span>
          <span className={styles.mySetsCount}>{myCompletedSets}</span>
        </div>

        {/* My hand */}
        <h2 className={styles.sectionTitle}>Your Hand ({(myHand || []).length} cards)</h2>
        <div className={styles.handRow}>
          {(myHand || []).length === 0 ? (
            <span className={styles.emptyHand}>No cards</span>
          ) : (
            [...(myHand || [])].sort((a, b) => a.rank - b.rank).map((card, i) => (
              <CardMini key={i} rank={card.rank} suit={card.suit} dealIndex={i >= goFishAnimFrom ? i - goFishAnimFrom : undefined} />
            ))
          )}
        </div>

        {/* Ask controls */}
        {isMyTurn && !isFinished && (myHand || []).length > 0 && (
          <div className={styles.askControls}>
            <h3 className={styles.askTitle}>Ask a player:</h3>
            <div className={styles.askRow}>
              <select
                className={styles.select}
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value)}
              >
                <option value="">Select player</option>
                {(otherPlayers || []).map((p) => (
                  <option key={p.playerId} value={p.playerId}>{displayName(p.playerId, nicknames)}</option>
                ))}
              </select>
              <span className={styles.forText}>for</span>
              <select
                className={styles.select}
                value={selectedRank}
                onChange={(e) => setSelectedRank(e.target.value)}
              >
                <option value="">Select rank</option>
                {myRanks.map((rank) => (
                  <option key={rank} value={rank}>{getRankLabel(rank)}s</option>
                ))}
              </select>
              <button
                className={styles.btnAsk}
                onClick={handleAsk}
                disabled={!selectedTarget || !selectedRank}
              >
                Ask
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Results */}
      {isFinished && (
        <section className={styles.resultsSection}>
          <h2 className={styles.sectionTitle}>Results</h2>
          <div className={styles.resultsList}>
            <div className={styles.resultRow}>
              <span className={styles.resultName}>You</span>
              <span className={styles.resultSets}>{myCompletedSets} sets</span>
            </div>
            {(otherPlayers || []).map((p) => (
              <div key={p.playerId} className={styles.resultRow}>
                <span className={styles.resultName}><PlayerName playerId={p.playerId} nicknames={nicknames} avatars={avatars} /></span>
                <span className={styles.resultSets}>{p.completedSets} sets</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
