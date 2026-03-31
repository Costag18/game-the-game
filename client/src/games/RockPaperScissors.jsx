import { useState } from 'react';
import styles from './RockPaperScissors.module.css';
import { displayName } from '../utils/displayName.js';

const CHOICE_EMOJI = {
  rock: '✊',
  paper: '✋',
  scissors: '✌️',
};

const CHOICE_LABEL = {
  rock: 'Rock',
  paper: 'Paper',
  scissors: 'Scissors',
};

function ChoiceDisplay({ choice, label, hidden = false }) {
  return (
    <div className={styles.choiceDisplay}>
      <div className={`${styles.choiceIcon} ${hidden ? styles.choiceHidden : ''}`}>
        {hidden ? '?' : (CHOICE_EMOJI[choice] ?? '?')}
      </div>
      <span className={styles.choiceLabel}>{label}</span>
    </div>
  );
}

export default function RockPaperScissors({ gameState, onAction, nicknames }) {
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
    phase,
    roundNumber,
    scores,
    myId,
    opponentId,
    myChoice,
    opponentChoice,
    lastRoundResult,
    hasChosen,
  } = gameState;

  const isReveal = phase === 'reveal' || phase === 'finished';
  const isFinished = phase === 'finished';

  // Reset ack when round advances
  if (roundNumber !== lastAckedRound && phase === 'round') {
    setAcked(false);
    setLastAckedRound(roundNumber);
  }

  const myName = displayName(myId, nicknames);
  const oppName = displayName(opponentId, nicknames);

  function getRoundResultText() {
    if (!lastRoundResult) return '';
    if (lastRoundResult.tie) return "It's a tie!";
    const winnerName = displayName(lastRoundResult.winner, nicknames);
    return `${winnerName} wins this round!`;
  }

  function getStatusText() {
    if (isFinished) {
      const myScore = scores[myId] || 0;
      const oppScore = scores[opponentId] || 0;
      if (myScore > oppScore) return `${myName} wins the match!`;
      if (oppScore > myScore) return `${oppName} wins the match!`;
      return "It's a draw!";
    }
    if (isReveal) return getRoundResultText();
    if (hasChosen) return `Waiting for ${oppName}...`;
    return 'Choose your move!';
  }

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>Rock Paper Scissors</h1>

      {/* Round info */}
      <div className={styles.roundInfo}>
        <span className={styles.roundLabel}>Round {roundNumber}</span>
        <span className={styles.roundLabel}>Best of 5</span>
      </div>

      {/* Scoreboard */}
      <div className={styles.scoreboard}>
        {[myId, opponentId].filter(Boolean).map((pid) => (
          <div key={pid} className={styles.scoreCard}>
            <span className={styles.playerName}>{displayName(pid, nicknames)}</span>
            <span className={styles.scoreValue}>{scores[pid] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Reveal area */}
      {isReveal && (
        <div className={styles.revealArea}>
          <ChoiceDisplay choice={myChoice} label={myName} hidden={false} />
          <span className={styles.vs}>VS</span>
          <ChoiceDisplay choice={opponentChoice} label={oppName} hidden={false} />
        </div>
      )}

      {/* Status message */}
      <p className={`${styles.statusText} ${isFinished ? styles.statusFinished : ''}`}>
        {getStatusText()}
      </p>

      {/* Continue button after reveal (not finished) */}
      {phase === 'reveal' && !acked && (
        <button
          className={styles.btnContinue}
          onClick={() => { setAcked(true); onAction({ type: 'acknowledge' }); }}
        >
          Continue
        </button>
      )}
      {phase === 'reveal' && acked && (
        <p className={styles.waitingText}>Waiting for other player...</p>
      )}

      {/* Action buttons — only shown when in round phase and not yet chosen */}
      {phase === 'round' && !hasChosen && (
        <div className={styles.choiceButtons}>
          {['rock', 'paper', 'scissors'].map((choice) => (
            <button
              key={choice}
              className={styles.choiceBtn}
              onClick={() => onAction({ type: 'choose', choice })}
            >
              <span className={styles.btnEmoji}>{CHOICE_EMOJI[choice]}</span>
              <span className={styles.btnLabel}>{CHOICE_LABEL[choice]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Waiting indicator after choosing */}
      {phase === 'round' && hasChosen && myChoice && (
        <div className={styles.waitingArea}>
          <div className={styles.myChoicePreview}>
            <span>{CHOICE_EMOJI[myChoice]}</span>
            <span className={styles.chosenLabel}>You chose {CHOICE_LABEL[myChoice]}</span>
          </div>
          <p className={styles.waitingText}>Waiting for {oppName}...</p>
        </div>
      )}
    </div>
  );
}
