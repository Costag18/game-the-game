import { useEffect, useRef, useState } from 'react';
import styles from './VoteProphet.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function VoteProphetGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [pref, setPref] = useState(null);          // my real preference ('a' | 'b')
  const [prediction, setPrediction] = useState(null); // my crowd guess ('a' | 'b')
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const hasSubmitted = gameState?.hasSubmitted;
  const deadline = gameState?.deadline || 0;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'predicting') { setPref(null); setPrediction(null); }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // live countdown to the server deadline
  useEffect(() => {
    if (phase !== 'predicting' || !deadline) { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, deadline]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Reading the room…</p></div>;

  const {
    roundNumber, totalRounds, promptText, sideA, sideB, scores = {}, myId,
    submittedCount, playerCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);

  function lockIn() {
    if (!pref || !prediction || hasSubmitted) return;
    onAction({ type: 'lockIn', pref, prediction });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const sideLabel = (side) => (side === 'a' ? sideA : sideB);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>VOTE PROPHET</h1>
        <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && <p className={styles.prompt}>{promptText}</p>}

      {/* PREDICTING */}
      {phase === 'predicting' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Locked in 🔮</p>
            <p className={styles.sub}>Waiting for prophets… {submittedCount}/{playerCount}</p>
            {remaining > 0 && <p className={styles.timer}>{remaining}s</p>}
          </div>
        ) : (
          <div className={styles.predictBox}>
            <div className={styles.section}>
              <p className={styles.label}>Your real pick</p>
              <div className={styles.sides}>
                {['a', 'b'].map((side) => (
                  <button
                    key={side}
                    className={`${styles.sideBtn} ${pref === side ? styles.sidePref : ''}`}
                    onClick={() => { setPref(side); playSound('click'); }}
                  >
                    {sideLabel(side)}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.section}>
              <p className={styles.label}>What will the GROUP mostly pick?</p>
              <div className={styles.sides}>
                {['a', 'b'].map((side) => (
                  <button
                    key={side}
                    className={`${styles.sideBtn} ${prediction === side ? styles.sidePredict : ''}`}
                    onClick={() => { setPrediction(side); playSound('click'); }}
                  >
                    {sideLabel(side)}
                  </button>
                ))}
              </div>
            </div>

            <button className={styles.primaryBtn} onClick={lockIn} disabled={!pref || !prediction}>
              Lock in
            </button>
            {remaining > 0 && <p className={styles.timer}>{remaining}s left</p>}
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.splitWrap}>
            <div className={`${styles.splitSide} ${reveal.pluralitySide === 'a' ? styles.splitWin : ''}`}>
              <span className={styles.splitName}>{reveal.sideA}</span>
              <span className={styles.splitCount}>{reveal.countA}</span>
            </div>
            <div className={`${styles.splitSide} ${reveal.pluralitySide === 'b' ? styles.splitWin : ''}`}>
              <span className={styles.splitName}>{reveal.sideB}</span>
              <span className={styles.splitCount}>{reveal.countB}</span>
            </div>
          </div>
          <p className={styles.verdict}>
            {reveal.tie
              ? "It's a dead tie — every prophet scores!"
              : `The crowd chose "${reveal.pluralitySide === 'a' ? reveal.sideA : reveal.sideB}"`}
          </p>

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => {
              const aw = reveal.awards[pid];
              return (
                <div key={pid} className={`${styles.scoreRow} ${aw?.correct ? styles.rowRight : ''}`}>
                  <span className={styles.who}>
                    <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                    {aw && (
                      <span className={`${styles.predTag} ${aw.correct ? styles.predRight : styles.predWrong}`}>
                        {aw.correct ? 'predicted right ✓' : 'predicted wrong ✗'}
                      </span>
                    )}
                  </span>
                  <span className={styles.scoreVal}>{sc}{aw?.gained ? ` (+${aw.gained})` : ''}</span>
                </div>
              );
            })}
          </div>

          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
