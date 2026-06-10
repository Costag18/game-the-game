import { useEffect, useRef, useState } from 'react';
import styles from './ThisOrThat.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function ThisOrThatGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'question') { setPick(null); playSound('roundStart'); }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to the active deadline
  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Loading…</p></div>;

  const {
    myId, qNumber, total, prompt, a, b, myAnswer, hasAnswered, myScore = 0, myStreak = 0,
    submittedCount, playerCount, scores = {}, acknowledged = [], reveal,
  } = gameState;

  const allIds = Object.keys(scores);
  const standings = [...allIds].sort((p, q) => (scores[q] || 0) - (scores[p] || 0));
  const myReveal = reveal && reveal.results ? reveal.results.find((r) => r.playerId === myId) : null;

  function answer(choice) {
    if (hasAnswered || phase !== 'question') return;
    setPick(choice);
    onAction({ type: 'answer', choice });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const chosen = myAnswer || pick;

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>THIS OR THAT</h1>
        <span className={styles.meta}>Round {qNumber} / {total}</span>
      </div>

      <div className={styles.statusBar}>
        <span className={styles.scoreBadge}>⭐ {myScore} pts</span>
        {myStreak >= 2 && <span className={styles.streakBadge}>🔥 {myStreak} streak</span>}
        {phase === 'question' && remaining != null && <span className={styles.clock}>{remaining}s</span>}
      </div>

      {/* QUESTION */}
      {phase === 'question' && (
        <div className={styles.qArea}>
          <p className={styles.prompt}>{prompt}</p>
          {hasAnswered ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>Locked: {chosen === 'a' ? a : b} 🔒</p>
              <p className={styles.sub}>Waiting… {submittedCount}/{playerCount} answered</p>
            </div>
          ) : (
            <div className={styles.choices}>
              <button
                className={`${styles.choiceBtn} ${styles.choiceA} ${chosen === 'a' ? styles.choiceSel : ''}`}
                onClick={() => answer('a')}
                disabled={hasAnswered}
              >
                <span className={styles.choiceTag}>A</span>
                <span className={styles.choiceText}>{a}</span>
              </button>
              <span className={styles.vs}>or</span>
              <button
                className={`${styles.choiceBtn} ${styles.choiceB} ${chosen === 'b' ? styles.choiceSel : ''}`}
                onClick={() => answer('b')}
                disabled={hasAnswered}
              >
                <span className={styles.choiceTag}>B</span>
                <span className={styles.choiceText}>{b}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <p className={styles.revPrompt}>{reveal.prompt}</p>
          <div className={styles.revChoices}>
            <div className={`${styles.revChoice} ${reveal.correct === 'a' ? styles.revRight : styles.revWrong}`}>
              <span className={styles.revTag}>A</span> {reveal.a}
              {reveal.correct === 'a' && <span className={styles.check}> ✓</span>}
            </div>
            <div className={`${styles.revChoice} ${reveal.correct === 'b' ? styles.revRight : styles.revWrong}`}>
              <span className={styles.revTag}>B</span> {reveal.b}
              {reveal.correct === 'b' && <span className={styles.check}> ✓</span>}
            </div>
          </div>

          {/* my own result for the round */}
          {myReveal && (
            myReveal.correct ? (
              <p className={styles.correctMsg}>✓ Correct! +{myReveal.gained} pts{myReveal.streak >= 2 ? ` · 🔥 ${myReveal.streak} streak` : ''}</p>
            ) : (
              <p className={styles.wrongMsg}>{myReveal.answered ? '✗ Wrong — 0 pts' : '⏱️ No answer — 0 pts'}</p>
            )
          )}

          {/* live leaderboard */}
          <div className={styles.lb}>
            <p className={styles.lbTitle}>{phase === 'finished' ? '🏆 Final Standings' : 'Standings'}</p>
            {standings.map((p, i) => {
              const r = reveal.results ? reveal.results.find((x) => x.playerId === p) : null;
              return (
                <div key={p} className={`${styles.lbRow} ${p === myId ? styles.lbMe : ''}`}>
                  <span className={styles.lbRank}>{i + 1}</span>
                  <span className={styles.lbName}>
                    <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} />
                  </span>
                  {r && r.correct && <span className={styles.gain}>+{r.gained}</span>}
                  <span className={styles.lbPts}>{scores[p] || 0}</span>
                </div>
              );
            })}
          </div>

          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.contBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allIds} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
