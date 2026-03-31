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
    myChoice,
    opponentChoice,
    lastRoundResult,
    hasChosen,
  } = gameState;

  const isReveal = phase === 'reveal' || phase === 'finished';
  const isFinished = phase === 'finished';

  const playerIds = Object.keys(scores);
  const myId = playerIds[0]; // first key is "me" from server perspective
  const opponentId = playerIds[1];

  function getRoundResultText() {
    if (!lastRoundResult) return '';
    if (lastRoundResult.tie) return "It's a tie!";
    if (lastRoundResult.winner === myId) return 'You win this round!';
    return 'Opponent wins this round!';
  }

  function getStatusText() {
    if (isFinished) {
      const myScore = scores[myId] || 0;
      const oppScore = scores[opponentId] || 0;
      if (myScore > oppScore) return 'You win the match!';
      if (oppScore > myScore) return 'Opponent wins the match!';
      return "It's a draw!";
    }
    if (isReveal) return getRoundResultText();
    if (hasChosen) return 'Waiting for opponent...';
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
        {playerIds.map((pid) => (
          <div key={pid} className={styles.scoreCard}>
            <span className={styles.playerName}>{displayName(pid, nicknames)}</span>
            <span className={styles.scoreValue}>{scores[pid] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Reveal area */}
      {isReveal && (
        <div className={styles.revealArea}>
          <ChoiceDisplay
            choice={myChoice}
            label="You"
            hidden={false}
          />
          <span className={styles.vs}>VS</span>
          <ChoiceDisplay
            choice={opponentChoice}
            label="Opponent"
            hidden={false}
          />
        </div>
      )}

      {/* Status message */}
      <p className={`${styles.statusText} ${isFinished ? styles.statusFinished : ''}`}>
        {getStatusText()}
      </p>

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
          <p className={styles.waitingText}>Waiting for opponent...</p>
        </div>
      )}
    </div>
  );
}
