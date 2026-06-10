import { useEffect, useRef, useState } from 'react';
import styles from './BuzzerRoyale.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const LETTERS = ['A', 'B', 'C', 'D'];

export default function BuzzerRoyaleGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const locked = gameState?.locked;
  const deadline = gameState?.deadline;

  // reset per-phase / per-question UI
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'question') { setPick(null); }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // new question (qNumber changes) → clear the local pick
  const qNumber = gameState?.qNumber;
  useEffect(() => { setPick(null); }, [qNumber]);

  // countdown to deadline
  useEffect(() => {
    if (!deadline) { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Warming up the buzzers…</p></div>;
  }

  const {
    qNumber: qN, total, question, choices = [], scores = {}, myId,
    submittedCount, playerCount, reveal, acknowledged = [], myChoice,
  } = gameState;

  const allPlayers = Object.keys(scores);

  function lockIn(idx) {
    if (locked || phase !== 'question') return;
    setPick(idx);
    onAction({ type: 'lock', choice: idx });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const correctIdx = reveal ? reveal.answer : null;
  const buzzedCorrect = reveal ? reveal.buzzedCorrect : [];

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>BUZZER ROYALE</h1>
        <span className={styles.round}>Q{qN} / {total}</span>
      </div>

      {phase !== 'finished' && (
        <div className={styles.qCard}>
          {(phase === 'question' || phase === 'reveal') && remaining > 0 && (
            <span className={styles.timer}>{remaining}s</span>
          )}
          <p className={styles.question}>{question}</p>
        </div>
      )}

      {/* QUESTION + REVEAL share the 4-button grid */}
      {(phase === 'question' || phase === 'reveal') && (
        <div className={styles.choices}>
          {choices.map((c, idx) => {
            const isMine = (phase === 'reveal' ? myChoice : pick) === idx
              || (phase === 'question' && locked && myChoice === idx);
            const isCorrect = phase === 'reveal' && idx === correctIdx;
            const isWrongPick = phase === 'reveal' && isMine && idx !== correctIdx;
            const cls = [
              styles.choice,
              isCorrect ? styles.choiceCorrect : '',
              isWrongPick ? styles.choiceWrong : '',
              (phase === 'question' && (pick === idx || (locked && myChoice === idx))) ? styles.choiceSel : '',
            ].join(' ');
            return (
              <button
                key={idx}
                className={cls}
                disabled={phase === 'reveal' || locked}
                onClick={() => lockIn(idx)}
              >
                <span className={styles.letter}>{LETTERS[idx]}</span>
                <span className={styles.choiceText}>{c}</span>
                {isCorrect && <span className={styles.tick}>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* QUESTION status */}
      {phase === 'question' && (
        locked ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Buzzed in! 🔔</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <p className={styles.hint}>Tap your answer to buzz — fastest correct buzz wins the most!</p>
        )
      )}

      {/* REVEAL: who buzzed it */}
      {phase === 'reveal' && reveal && (
        <div className={styles.buzzList}>
          {buzzedCorrect.length === 0 ? (
            <p className={styles.sub}>Nobody buzzed the right answer!</p>
          ) : (
            buzzedCorrect.map((r) => (
              <div key={r.playerId} className={styles.buzzRow}>
                <span className={styles.buzzRank}>#{r.rank + 1}</span>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.buzzPts}>+{r.gained}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* SCOREBOARD on reveal + finished */}
      {(phase === 'reveal' || phase === 'finished') && (
        <div className={styles.scoreboard}>
          {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
            <div key={pid} className={styles.scoreRow}>
              <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
              <span className={styles.scoreVal}>{sc}</span>
            </div>
          ))}
        </div>
      )}

      {phase === 'reveal' && (
        <>
          {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
          <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </>
      )}

      {phase === 'finished' && <p className={styles.waitMsg}>Final buzz! 🏆</p>}
    </div>
  );
}
