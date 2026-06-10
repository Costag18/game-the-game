import { useEffect, useRef, useState } from 'react';
import styles from './TargetLocked.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function TargetLockedGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [expr, setExpr] = useState('');
  const [iAcked, setIAcked] = useState(false);
  const [now, setNow] = useState(Date.now());
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;

  // local countdown tick
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'round') setExpr('');
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Dealing numbers…</p></div>;

  const {
    roundNumber, totalRounds, numbers = [], target, scores = {}, myId,
    myBest, submittedCount, playerCount, acknowledged = [], reveal,
  } = gameState;

  const allPlayers = Object.keys(scores);
  const secsLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  function append(token) {
    setExpr((e) => e + token);
    playSound('click');
  }
  function backspace() { setExpr((e) => e.slice(0, -1)); }
  function clearExpr() { setExpr(''); }
  function submit() {
    const t = expr.trim();
    if (!t) return;
    onAction({ type: 'submit', expr: t });
    playSound('coin');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>TARGET LOCKED</h1>
        <span className={styles.round}>R{roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && (
        <div className={styles.targetBox}>
          <span className={styles.targetLabel}>TARGET</span>
          <span className={styles.targetVal}>{target}</span>
        </div>
      )}

      {secsLeft != null && phase !== 'finished' && (
        <div className={`${styles.clock} ${secsLeft <= 10 ? styles.clockLow : ''}`}>{secsLeft}s</div>
      )}

      {/* ROUND */}
      {phase === 'round' && (
        <>
          <div className={styles.tiles}>
            {numbers.map((n, i) => (
              <button key={i} className={styles.tile} onClick={() => append(String(n))}>{n}</button>
            ))}
          </div>

          <div className={styles.ops}>
            {['(', ')', '+', '-', '*', '/'].map((op) => (
              <button key={op} className={styles.opBtn} onClick={() => append(op)}>{op}</button>
            ))}
          </div>

          <input
            className={styles.exprInput}
            value={expr}
            placeholder="Build your expression…"
            onChange={(e) => setExpr(e.target.value)}
            inputMode="text"
          />

          <div className={styles.exprRow}>
            <button className={styles.smallBtn} onClick={backspace} disabled={!expr}>⌫</button>
            <button className={styles.smallBtn} onClick={clearExpr} disabled={!expr}>Clear</button>
            <button className={styles.primaryBtn} onClick={submit} disabled={!expr.trim()}>Lock it in</button>
          </div>

          {myBest ? (
            <p className={styles.bestLine}>
              Your best: <b>{myBest.value}</b> (off by {myBest.distance}) → +{myBest.gained}
              <span className={styles.bestExpr}> {myBest.expr}</span>
            </p>
          ) : (
            <p className={styles.hint}>Use each number at most once. Every step must be a positive whole number.</p>
          )}
          <p className={styles.sub}>Players with an answer: {submittedCount}/{playerCount}</p>
        </>
      )}

      {/* REVEAL / FINISHED */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.bestPossible}>
            {reveal.bestPossible ? (
              <>Best possible: <b>{reveal.bestPossible.value}</b>
                {reveal.bestPossible.distance === 0 ? ' (exact!)' : ` (off by ${reveal.bestPossible.distance})`}
                <span className={styles.bestExpr}> {reveal.bestPossible.expr}</span>
              </>
            ) : 'No solution found.'}
          </div>

          <div className={styles.results}>
            {reveal.results
              .slice()
              .sort((a, b) => (b.gained || 0) - (a.gained || 0))
              .map((r) => (
                <div key={r.playerId} className={`${styles.resRow} ${r.distance === 0 ? styles.resExact : ''}`}>
                  <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.resMid}>
                    {r.value != null ? <span className={styles.resVal}>{r.value}{r.distance === 0 ? ' ✓' : ` (off ${r.distance})`}</span> : <span className={styles.resMiss}>no answer</span>}
                  </span>
                  <span className={styles.resGain}>+{r.gained || 0}</span>
                </div>
              ))}
          </div>

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc}</span>
              </div>
            ))}
          </div>

          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
          {phase === 'finished' && <p className={styles.waitMsg}>Final scores locked in 🔒</p>}
        </div>
      )}
    </div>
  );
}
