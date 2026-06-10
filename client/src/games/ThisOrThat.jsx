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
    myId, qNumber, total, prompt, a, b, iAmAlive, myAnswer, hasAnswered,
    submittedCount, survivorsCount, eliminatedRound, acknowledged = [], survivorIds = [], reveal,
  } = gameState;

  function answer(choice) {
    if (!iAmAlive || hasAnswered || phase !== 'question') return;
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
        <span className={styles.meta}>Q{qNumber} / {total}</span>
      </div>

      <div className={styles.statusBar}>
        <span className={styles.survivors}>🛡️ {survivorsCount} alive</span>
        {phase === 'question' && remaining != null && <span className={styles.clock}>{remaining}s</span>}
      </div>

      {/* eliminated spectator banner */}
      {!iAmAlive && phase !== 'finished' && (
        <div className={styles.outBanner}>
          You're out{eliminatedRound ? ` (Q${eliminatedRound})` : ''} — watching 👀
        </div>
      )}

      {/* QUESTION */}
      {phase === 'question' && (
        <div className={styles.qArea}>
          <p className={styles.prompt}>{prompt}</p>
          {iAmAlive ? (
            hasAnswered ? (
              <div className={styles.waitBox}>
                <p className={styles.waitMsg}>Locked: {chosen === 'a' ? a : b} 🔒</p>
                <p className={styles.sub}>Waiting… {submittedCount}/{survivorsCount} answered</p>
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
            )
          ) : (
            <p className={styles.spectate}>Survivors are answering… {submittedCount}/{survivorsCount}</p>
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

          {reveal.eliminated.length > 0 ? (
            <div className={styles.elimBox}>
              <p className={styles.elimTitle}>Eliminated this round:</p>
              <div className={styles.chips}>
                {reveal.eliminated.map((p) => (
                  <span key={p} className={`${styles.chip} ${styles.chipOut}`}>
                    <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} />
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className={styles.allSafe}>Everyone survived! 🎉</p>
          )}

          <div className={styles.survBox}>
            <p className={styles.survTitle}>Survivors ({reveal.survived.length}):</p>
            <div className={styles.chips}>
              {reveal.survived.map((p) => (
                <span key={p} className={`${styles.chip} ${styles.chipAlive}`}>
                  <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} />
                </span>
              ))}
            </div>
          </div>

          {phase === 'reveal' && iAmAlive && (
            <>
              {!iAcked && <button className={styles.contBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={survivorIds} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
          {phase === 'reveal' && !iAmAlive && <p className={styles.sub}>Waiting for survivors to continue…</p>}
        </div>
      )}
    </div>
  );
}
