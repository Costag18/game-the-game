import { useState } from 'react';
import styles from './Hangman.module.css';
import PlayerName from '../components/PlayerName.jsx';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

// SVG hangman stages (0–6 wrong guesses)
function HangmanFigure({ wrongCount }) {
  return (
    <svg
      className={styles.hangmanSvg}
      viewBox="0 0 120 150"
      width="120"
      height="150"
      aria-label={`Hangman: ${wrongCount} wrong guesses`}
    >
      {/* Gallows */}
      <line x1="10" y1="145" x2="110" y2="145" stroke="#a5d6a7" strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="145" x2="30" y2="10" stroke="#a5d6a7" strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="10" x2="75" y2="10" stroke="#a5d6a7" strokeWidth="3" strokeLinecap="round" />
      <line x1="75" y1="10" x2="75" y2="28" stroke="#a5d6a7" strokeWidth="2" strokeLinecap="round" />

      {/* Head */}
      {wrongCount >= 1 && (
        <circle cx="75" cy="38" r="10" stroke="#ef9a9a" strokeWidth="2.5" fill="none" />
      )}
      {/* Body */}
      {wrongCount >= 2 && (
        <line x1="75" y1="48" x2="75" y2="90" stroke="#ef9a9a" strokeWidth="2.5" strokeLinecap="round" />
      )}
      {/* Left arm */}
      {wrongCount >= 3 && (
        <line x1="75" y1="58" x2="55" y2="75" stroke="#ef9a9a" strokeWidth="2.5" strokeLinecap="round" />
      )}
      {/* Right arm */}
      {wrongCount >= 4 && (
        <line x1="75" y1="58" x2="95" y2="75" stroke="#ef9a9a" strokeWidth="2.5" strokeLinecap="round" />
      )}
      {/* Left leg */}
      {wrongCount >= 5 && (
        <line x1="75" y1="90" x2="55" y2="115" stroke="#ef9a9a" strokeWidth="2.5" strokeLinecap="round" />
      )}
      {/* Right leg */}
      {wrongCount >= 6 && (
        <line x1="75" y1="90" x2="95" y2="115" stroke="#ef9a9a" strokeWidth="2.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

export default function Hangman({ gameState, onAction, currentPlayerId, nicknames, avatars }) {
  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    displayWord,
    word,
    wordGuessed,
    wordGuessWinner,
    guessedLetters,
    playerStates,
    currentTurnPlayer,
    isMyTurn,
    myWrongCount,
    isEliminated,
    phase,
    round,
    totalRounds,
    scores,
    showingWord,
  } = gameState;

  const isFinished = phase === 'finished';
  const guessedSet = new Set(guessedLetters || []);

  const [wordGuess, setWordGuess] = useState('');

  function handleGuess(letter) {
    if (!isMyTurn || isEliminated) return;
    if (guessedSet.has(letter)) return;
    onAction({ type: 'guess', letter });
  }

  function handleGuessWord() {
    if (isEliminated || !wordGuess.trim()) return;
    onAction({ type: 'guessWord', word: wordGuess.trim() });
    setWordGuess('');
  }

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Hangman</h1>
      {round && totalRounds && (
        <p className={styles.roundInfo}>Word {round} of {totalRounds}</p>
      )}

      {/* Status */}
      <div className={styles.statusBar}>
        {isFinished ? (
          <span className={styles.statusFinished}>
            {wordGuessed
              ? (wordGuessWinner
                ? <><PlayerName playerId={wordGuessWinner} nicknames={nicknames} avatars={avatars} /> guessed the word!</>
                : 'Word solved!')
              : 'Nobody guessed the word!'}
          </span>
        ) : isEliminated ? (
          <span className={styles.statusEliminated}>You have been eliminated!</span>
        ) : isMyTurn ? (
          <span className={styles.statusMyTurn}>Your turn — guess a letter!</span>
        ) : (
          <span className={styles.statusWaiting}>Waiting for <PlayerName playerId={currentTurnPlayer} nicknames={nicknames} avatars={avatars} />...</span>
        )}
      </div>

      <div className={styles.gameArea}>
        {/* Left: Gallows */}
        <div className={styles.gallowsArea}>
          <HangmanFigure wrongCount={myWrongCount} />
          <p className={styles.wrongCount}>{myWrongCount} / 6 wrong</p>
        </div>

        {/* Center: Word display */}
        <div className={styles.wordArea}>
          {(isFinished || showingWord) && word ? (
            <div className={styles.revealSection}>
              <p className={styles.revealLabel}>The word was:</p>
              <p className={styles.revealedWord}>{word.toUpperCase()}</p>
              {showingWord && !isFinished && (
                <p className={styles.revealLabel}>
                  {wordGuessed
                    ? (wordGuessWinner ? 'Guessed correctly!' : 'Word solved!')
                    : 'Nobody guessed it!'}
                  {' '}Next word in a moment...
                </p>
              )}
            </div>
          ) : (
            <div className={styles.wordDisplay}>
              {(displayWord || []).map((char, i) => (
                <span key={i} className={styles.letterSlot}>
                  {char !== '_' ? char.toUpperCase() : ''}
                </span>
              ))}
            </div>
          )}
          <p className={styles.letterCount}>
            {(displayWord || []).filter((c) => c !== '_').length} /{' '}
            {(displayWord || []).length} letters revealed
          </p>
        </div>
      </div>

      {/* Keyboard */}
      {!isFinished && !showingWord && (
        <div className={styles.keyboard}>
          {ALPHABET.map((letter) => {
            const used = guessedSet.has(letter);
            const isCorrect = used && (displayWord || []).some((c) => c === letter);
            const isWrong = used && !(displayWord || []).some((c) => c === letter);
            return (
              <button
                key={letter}
                className={`${styles.keyBtn} ${isCorrect ? styles.keyCorrect : ''} ${isWrong ? styles.keyWrong : ''} ${used ? styles.keyUsed : ''}`}
                onClick={() => handleGuess(letter)}
                disabled={used || !isMyTurn || isEliminated}
              >
                {letter.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}

      {/* Guess the whole word — available to any non-eliminated player at any time */}
      {!isFinished && !isEliminated && !showingWord && (
        <div className={styles.guessWordSection}>
          <span className={styles.guessWordLabel}>Guess the word:</span>
          <div className={styles.guessWordRow}>
            <input
              type="text"
              className={styles.guessWordInput}
              value={wordGuess}
              onChange={(e) => setWordGuess(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGuessWord()}
              placeholder="Type your guess..."
              maxLength={20}
            />
            <button
              className={styles.guessWordBtn}
              onClick={handleGuessWord}
              disabled={!wordGuess.trim()}
            >
              Guess
            </button>
          </div>
          <p className={styles.guessWordWarning}>Correct = instant win. Wrong = eliminated!</p>
        </div>
      )}

      {/* Players */}
      <section className={styles.playersSection}>
        <h2 className={styles.sectionTitle}>Players</h2>
        <div className={styles.playersList}>
          {(playerStates || []).map((ps) => (
            <div
              key={ps.playerId}
              className={`${styles.playerRow} ${currentTurnPlayer === ps.playerId ? styles.playerActive : ''} ${ps.eliminated ? styles.playerEliminated : ''}`}
            >
              <span className={styles.playerName}><PlayerName playerId={ps.playerId} nicknames={nicknames} avatars={avatars} /></span>
              <div className={styles.playerGallows}>
                <HangmanFigure wrongCount={ps.wrongCount} />
              </div>
              <span className={styles.playerWrong}>{ps.wrongCount}/6</span>
              {ps.eliminated && <span className={styles.eliminatedBadge}>Eliminated</span>}
              {currentTurnPlayer === ps.playerId && !ps.eliminated && (
                <span className={styles.turnBadge}>Their turn</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Guessed letters */}
      {guessedLetters && guessedLetters.length > 0 && (
        <section className={styles.guessedSection}>
          <h2 className={styles.sectionTitle}>Guessed letters</h2>
          <div className={styles.guessedLetters}>
            {guessedLetters.sort().map((letter) => {
              const correct = (displayWord || []).some((c) => c === letter);
              return (
                <span key={letter} className={`${styles.guessedLetter} ${correct ? styles.guessedCorrect : styles.guessedWrong}`}>
                  {letter.toUpperCase()}
                </span>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
