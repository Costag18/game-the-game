import { useState } from 'react';
import styles from './RockPaperScissors.module.css';
import { displayName } from '../utils/displayName.js';
import PlayerName from '../components/PlayerName.jsx';

const CHOICE_EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
const CHOICE_LABEL = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };

export default function RockPaperScissors({ gameState, onAction, nicknames, avatars }) {
  const [acked, setAcked] = useState(false);
  const [lastAckedRound, setLastAckedRound] = useState(0);

  if (!gameState) {
    return (
      <div className={styles.arena}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    phase, roundNumber, totalRounds, scores, myId,
    myChoice, hasChosen, otherPlayers = [], lastRoundResult,
  } = gameState;

  const isReveal = phase === 'reveal' || phase === 'finished';
  const isFinished = phase === 'finished';

  if (roundNumber !== lastAckedRound && phase === 'round') {
    setAcked(false);
    setLastAckedRound(roundNumber);
  }

  const allPlayers = [{ playerId: myId, score: scores[myId] || 0 }, ...otherPlayers.map((p) => ({ playerId: p.playerId, score: p.score }))];
  const waitingCount = otherPlayers.filter((p) => !p.hasChosen).length;

  function getStatusText() {
    if (isFinished) return 'Game Over!';
    if (isReveal && lastRoundResult) {
      if (lastRoundResult.tie) return "It's a tie! No points.";
      const winnerNames = lastRoundResult.winners.map((w) => displayName(w, nicknames)).join(', ');
      return `${winnerNames} wins with ${CHOICE_LABEL[lastRoundResult.winningChoice]}!`;
    }
    if (hasChosen) return `Waiting for ${waitingCount} player${waitingCount !== 1 ? 's' : ''}...`;
    return 'Choose your move!';
  }

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>Rock Paper Scissors</h1>

      <div className={styles.roundInfo}>
        <span className={styles.roundLabel}>Round {roundNumber}/{totalRounds}</span>
      </div>

      {/* Scoreboard */}
      <div className={styles.scoreboard}>
        {allPlayers.map((p) => (
          <div key={p.playerId} className={styles.scoreCard}>
            <span className={styles.playerName}><PlayerName playerId={p.playerId} nicknames={nicknames} avatars={avatars} /></span>
            <span className={styles.scoreValue}>{p.score}</span>
          </div>
        ))}
      </div>

      {/* Reveal area */}
      {isReveal && lastRoundResult && (
        <div className={styles.revealGrid}>
          {Object.entries(lastRoundResult.choices).map(([pid, choice]) => {
            const isWinner = lastRoundResult.winners?.includes(pid);
            return (
              <div key={pid} className={`${styles.revealCard} ${isWinner ? styles.revealWinner : ''}`}>
                <span className={styles.revealEmoji}>{CHOICE_EMOJI[choice]}</span>
                <span className={styles.revealName}><PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} /></span>
                {isWinner && <span className={styles.revealBadge}>Winner!</span>}
              </div>
            );
          })}
        </div>
      )}

      <p className={`${styles.statusText} ${isFinished ? styles.statusFinished : ''}`}>
        {getStatusText()}
      </p>

      {phase === 'reveal' && !acked && (
        <button className={styles.btnContinue} onClick={() => { setAcked(true); onAction({ type: 'acknowledge' }); }}>
          Continue
        </button>
      )}
      {phase === 'reveal' && acked && (
        <p className={styles.waitingText}>Waiting for others...</p>
      )}

      {/* Choice buttons */}
      {phase === 'round' && !hasChosen && (
        <div className={styles.choiceButtons}>
          {['rock', 'paper', 'scissors'].map((choice) => (
            <button key={choice} className={styles.choiceBtn} onClick={() => onAction({ type: 'choose', choice })}>
              <span className={styles.btnEmoji}>{CHOICE_EMOJI[choice]}</span>
              <span className={styles.btnLabel}>{CHOICE_LABEL[choice]}</span>
            </button>
          ))}
        </div>
      )}

      {phase === 'round' && hasChosen && myChoice && (
        <div className={styles.waitingArea}>
          <div className={styles.myChoicePreview}>
            <span>{CHOICE_EMOJI[myChoice]}</span>
            <span className={styles.chosenLabel}>You chose {CHOICE_LABEL[myChoice]}</span>
          </div>
          <p className={styles.waitingText}>Waiting for {waitingCount} player{waitingCount !== 1 ? 's' : ''}...</p>
        </div>
      )}
    </div>
  );
}
