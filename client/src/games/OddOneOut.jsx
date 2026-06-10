import { useEffect, useRef, useState } from 'react';
import styles from './OddOneOut.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function OddOneOutGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [iAcked, setIAcked] = useState(false);
  const [secsLeft, setSecsLeft] = useState(null);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to the active deadline (question + reveal)
  useEffect(() => {
    if (!deadline) { setSecsLeft(null); return; }
    const tick = () => setSecsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, phase]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Finding the odd one…</p></div>;

  const {
    qNumber, total, items = [], myAnswer, myCorrect, locked, submittedCount, playerCount,
    scores = {}, oddIndex, rule, results, acknowledged = [], myId,
  } = gameState;

  const allPlayers = Object.keys(scores);
  const revealing = phase === 'reveal' || phase === 'finished';

  function tap(index) {
    if (locked || revealing) return;
    onAction({ type: 'tap', index });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); playSound('click'); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>ODD ONE OUT</h1>
        <span className={styles.round}>Q{qNumber} / {total}</span>
      </div>

      {phase !== 'finished' && (
        <p className={styles.tagline}>
          {phase === 'question' ? 'Tap the one that breaks the rule!' : 'Reveal'}
        </p>
      )}

      {secsLeft != null && phase !== 'finished' && (
        <div className={`${styles.timer} ${secsLeft <= 3 && phase === 'question' ? styles.timerLow : ''}`}>
          {secsLeft}s
        </div>
      )}

      {/* ITEM GRID (question + reveal) */}
      {phase !== 'finished' && (
        <div className={styles.grid}>
          {items.map((item, i) => {
            const isMine = myAnswer === i;
            const isOdd = revealing && oddIndex === i;
            const cls = [styles.card];
            if (isOdd) cls.push(styles.cardOdd);
            if (isMine && !revealing) cls.push(myCorrect ? styles.cardGood : styles.cardPicked);
            if (isMine && revealing) cls.push(myCorrect ? styles.cardGood : styles.cardBad);
            return (
              <button
                key={i}
                className={cls.join(' ')}
                disabled={locked || revealing}
                onClick={() => tap(i)}
              >
                <span className={styles.cardText}>{item}</span>
                {isMine && <span className={styles.youTag}>you</span>}
                {isOdd && <span className={styles.oddTag}>ODD ✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* QUESTION: locked/waiting */}
      {phase === 'question' && locked && (
        <div className={styles.waitBox}>
          <p className={styles.waitMsg}>
            {myCorrect ? 'Correct! 🎯' : 'Locked in — that one’s wrong.'}
          </p>
          <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
        </div>
      )}

      {/* REVEAL */}
      {revealing && (
        <div className={styles.reveal}>
          {rule && <p className={styles.rule}>The rule: {rule}</p>}
          {results && (
            <div className={styles.results}>
              {results.map((r) => (
                <div key={r.playerId} className={`${styles.resRow} ${r.correct ? styles.resGood : styles.resBad}`}>
                  <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.resVal}>
                    {r.correct ? `+${r.gained}${r.rank === 0 ? ' ⚡fastest' : ''}` : '✗ 0'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc} pts</span>
              </div>
            ))}
          </div>
          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}

      {/* FINISHED */}
      {phase === 'finished' && (
        <div className={styles.reveal}>
          <p className={styles.waitMsg}>Final standings</p>
          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc], i) => (
              <div key={pid} className={styles.scoreRow}>
                <span className={styles.rank}>{i + 1}.</span>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
