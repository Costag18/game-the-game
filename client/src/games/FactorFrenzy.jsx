import { useEffect, useRef, useState } from 'react';
import styles from './FactorFrenzy.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function FactorFrenzyGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [remaining, setRemaining] = useState(0);
  const prevWindow = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;
  const windowNumber = gameState?.windowNumber;

  // live countdown to the server deadline
  useEffect(() => {
    if (!deadline) { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline]);

  // little sound cue when a new target window opens
  useEffect(() => {
    if (phase === 'window' && windowNumber !== prevWindow.current) {
      prevWindow.current = windowNumber;
      playSound('cardFlip');
    }
  }, [phase, windowNumber, playSound]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Loading the factor grid…</p></div>;
  }

  const {
    target, grid = [], scores = {}, myScore = 0, myStreak = 0,
    totalWindows, reveal, myId,
  } = gameState;

  const revealing = phase === 'reveal' || phase === 'finished';

  function tap(cell) {
    if (phase !== 'window' || cell.tappedByMe) return;
    onAction({ type: 'tap', index: cell.index });
    playSound('chip');
  }

  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>FACTOR FRENZY</h1>
        {phase !== 'finished' && (
          <span className={styles.windowTag}>Round {windowNumber} / {totalWindows}</span>
        )}
      </div>

      {phase !== 'finished' && (
        <div className={styles.hud}>
          <div className={styles.targetBox}>
            <span className={styles.targetLabel}>Tap every divisor of</span>
            <span className={styles.targetNum}>{target}</span>
          </div>
          <div className={styles.statsCol}>
            <div className={styles.timer} data-low={remaining <= 2 ? 'true' : 'false'}>{remaining}s</div>
            <div className={styles.myScore}>{myScore} pts</div>
            {myStreak >= 2 && phase === 'window' && (
              <div className={styles.streak}>🔥 {myStreak} streak</div>
            )}
          </div>
        </div>
      )}

      {phase !== 'finished' && (
        <div className={styles.grid}>
          {grid.map((cell) => {
            // window: only flash my own taps; reveal: show truth on every cell
            let cls = styles.cell;
            if (revealing) {
              cls += cell.isDivisor ? ` ${styles.cellDivisor}` : ` ${styles.cellNonDivisor}`;
              if (cell.tappedByMe) cls += cell.myCorrect ? ` ${styles.tappedRight}` : ` ${styles.tappedWrong}`;
            } else if (cell.tappedByMe) {
              cls += cell.myCorrect ? ` ${styles.tappedRight}` : ` ${styles.tappedWrong}`;
            }
            return (
              <button
                key={cell.index}
                className={cls}
                onClick={() => tap(cell)}
                disabled={phase !== 'window' || cell.tappedByMe}
              >
                <span className={styles.cellVal}>{cell.value}</span>
                {cell.tappedByMe && cell.myGained != null && (
                  <span className={styles.gain}>{cell.myGained > 0 ? `+${cell.myGained}` : cell.myGained}</span>
                )}
                {revealing && cell.isDivisor && <span className={styles.checkMark}>✓</span>}
                {revealing && !cell.isDivisor && <span className={styles.xMark}>✕</span>}
              </button>
            );
          })}
        </div>
      )}

      {revealing && reveal && (
        <p className={styles.revealHint}>
          {phase === 'finished' ? 'Final scores' : 'Divisors revealed — next target incoming…'}
        </p>
      )}

      <div className={styles.scoreboard}>
        {sortedScores.map(([pid, sc], i) => (
          <div key={pid} className={`${styles.scoreRow} ${pid === myId ? styles.scoreMe : ''}`}>
            <span className={styles.rank}>{i + 1}</span>
            <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{sc}</span>
          </div>
        ))}
      </div>

      {phase === 'finished' && (
        <p className={styles.doneMsg}>🏁 Frenzy complete!</p>
      )}
    </div>
  );
}
