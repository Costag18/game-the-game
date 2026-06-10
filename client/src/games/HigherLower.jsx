import { useEffect, useRef, useState } from 'react';
import styles from './HigherLower.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function HigherLowerGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [pick, setPick] = useState(null);   // 'higher' | 'lower' chosen this step (local)
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);
  const prevStep = useRef(null);

  const phase = gameState?.phase;
  const step = gameState?.step;
  const hasCalled = gameState?.hasCalled;

  // reset local pick at the start of each new step; play a cue on phase change
  useEffect(() => {
    if (step !== prevStep.current) { setPick(null); prevStep.current = step; }
    if (phase !== prevPhase.current) {
      if (phase === 'question') playSound('roundStart');
      if (phase === 'reveal') {
        const mine = gameState?.reveal?.outcomes?.[gameState?.myId];
        if (mine?.result === 'correct') playSound('correct');
        else if (mine?.result === 'wrong') playSound('wrong');
        else playSound('voteCast');
        setIAcked(false);
      }
      prevPhase.current = phase;
    }
  }, [phase, step, playSound, gameState]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Shuffling the deck of facts…</p></div>;

  const {
    myId, anchorLabel, anchorValue, anchorUnit, nextLabel,
    amAlive, myStreak, myCall, aliveCount, calledCount, streaks = {}, reveal,
    acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(streaks);

  function call(direction) {
    if (!amAlive || hasCalled || phase !== 'question') return;
    setPick(direction);
    onAction({ type: 'call', direction });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const lockedCall = myCall || pick;

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>HIGHER or LOWER</h1>
        <span className={styles.step}>
          {amAlive ? <>🔥 Streak {myStreak}</> : <>💀 Out · banked {myStreak}</>}
        </span>
      </div>

      {/* ANCHOR card — always visible */}
      <div className={styles.anchorCard}>
        <span className={styles.cardLabel}>{anchorLabel}</span>
        <span className={styles.anchorValue}>{formatNum(anchorValue)}<span className={styles.unit}>{anchorUnit}</span></span>
        <span className={styles.cardTag}>CURRENT</span>
      </div>

      <div className={styles.vs}>vs</div>

      {/* NEXT card — value hidden until reveal */}
      <div className={`${styles.nextCard} ${phase === 'reveal' && reveal ? revealClass(reveal, styles) : ''}`}>
        <span className={styles.cardLabel}>{nextLabel}</span>
        {phase === 'reveal' && reveal ? (
          <span className={styles.nextValue}>{formatNum(reveal.nextValue)}<span className={styles.unit}>{reveal.unit}</span></span>
        ) : (
          <span className={styles.mystery}>? ? ?</span>
        )}
        <span className={styles.cardTag}>NEXT</span>
      </div>

      {/* QUESTION controls */}
      {phase === 'question' && (
        amAlive ? (
          hasCalled ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>You called <b>{(myCall || pick || '').toUpperCase()}</b> {lockedCall === 'higher' ? '⬆️' : '⬇️'}</p>
              <p className={styles.sub}>Waiting for others… {calledCount}/{aliveCount}</p>
            </div>
          ) : (
            <div className={styles.callRow}>
              <button
                className={`${styles.callBtn} ${styles.higher} ${pick === 'higher' ? styles.picked : ''}`}
                onClick={() => call('higher')}
              >
                <span className={styles.arrow}>⬆️</span> HIGHER
              </button>
              <button
                className={`${styles.callBtn} ${styles.lower} ${pick === 'lower' ? styles.picked : ''}`}
                onClick={() => call('lower')}
              >
                <span className={styles.arrow}>⬇️</span> LOWER
              </button>
            </div>
          )
        ) : (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>You're out 💀</p>
            <p className={styles.sub}>Watching the survivors… {aliveCount} still alive</p>
          </div>
        )
      )}

      {/* REVEAL */}
      {phase === 'reveal' && reveal && (
        <div className={styles.revealBox}>
          <p className={styles.revealHeadline}>
            {reveal.correctCall === 'push'
              ? 'PUSH — equal values, nobody is out!'
              : `It was ${reveal.correctCall.toUpperCase()} ${reveal.correctCall === 'higher' ? '⬆️' : '⬇️'}`}
          </p>
          {reveal.outcomes[myId] && reveal.correctCall !== 'push' && (
            <p className={`${styles.myOutcome} ${reveal.outcomes[myId].result === 'correct' ? styles.good : styles.bad}`}>
              {reveal.outcomes[myId].result === 'correct' ? '✅ You survive!' : '❌ Eliminated!'}
            </p>
          )}
          <div className={styles.outcomeList}>
            {Object.entries(reveal.outcomes)
              .sort((a, b) => (b[1].streak || 0) - (a[1].streak || 0))
              .map(([pid, o]) => (
                <div key={pid} className={`${styles.outcomeRow} ${o.result === 'wrong' ? styles.rowOut : ''}`}>
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.outcomeTag}>
                    {o.call ? (o.call === 'higher' ? '⬆️' : '⬇️') : '—'}{' '}
                    {o.result === 'correct' ? '✓' : o.result === 'push' ? '↔' : '✗'} · {o.streak}🔥
                  </span>
                </div>
              ))}
          </div>
          {!iAcked && <button className={styles.continueBtn} onClick={ack}>Continue →</button>}
          <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {/* FINISHED */}
      {phase === 'finished' && (
        <div className={styles.finishedBox}>
          <p className={styles.finishedMsg}>Final streaks</p>
          <div className={styles.scoreboard}>
            {Object.entries(streaks).sort((a, b) => b[1] - a[1]).map(([pid, s]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{s} 🔥</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatNum(n) {
  if (n == null) return '—';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function revealClass(reveal, styles) {
  if (reveal.correctCall === 'higher') return styles.wasHigher;
  if (reveal.correctCall === 'lower') return styles.wasLower;
  return styles.wasPush;
}
