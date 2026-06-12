import { useEffect, useRef, useState } from 'react';
import styles from './Guesstimate.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const num = Number(n);
  if (Math.abs(num) >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(num);
}
function fmtFactor(f) {
  if (f == null) return '—';
  if (f < 1.05) return 'spot on';
  if (f < 10) return `${f.toFixed(1)}× off`;
  return `${Math.round(f).toLocaleString()}× off`;
}

export default function GuesstimateGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [iAcked, setIAcked] = useState(false);
  const [secs, setSecs] = useState(0);
  const prevPhase = useRef(null);
  const draftRef = useRef('');
  draftRef.current = draft; // keep the latest typed guess reachable from the countdown closure
  const autoSubmitted = useRef(false);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;
  const hasSubmitted = gameState?.hasSubmitted;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'question') { setDraft(''); autoSubmitted.current = false; }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to the active deadline
  useEffect(() => {
    if (!deadline) { setSecs(0); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecs(rem);
      // auto-submit the typed guess ~1s before the deadline so nothing is lost on timeout
      if (phase === 'question' && rem <= 1 && !autoSubmitted.current && !hasSubmitted) {
        autoSubmitted.current = true;
        const v = Number(draftRef.current);
        if (Number.isFinite(v) && v > 0) onAction({ type: 'submitGuess', value: v });
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, phase, hasSubmitted, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Crunching numbers…</p></div>;

  const {
    qNumber, total, prompt, unit, scores = {}, myId,
    submittedCount, playerCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);

  function submitGuess() {
    const v = Number(draft);
    if (!Number.isFinite(v) || v <= 0 || hasSubmitted) return;
    onAction({ type: 'submitGuess', value: v });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>GUESSTIMATE</h1>
        <span className={styles.round}>Q{qNumber} / {total}</span>
      </div>

      {phase !== 'finished' && (
        <div className={styles.promptBox}>
          <p className={styles.promptLabel}>Estimate:</p>
          <p className={styles.prompt}>{prompt}</p>
          {unit && <p className={styles.unit}>answer in {unit}</p>}
        </div>
      )}

      {phase === 'question' && (
        <div className={styles.timerRow}>
          <span className={styles.timer}>{secs}s</span>
          <span className={styles.sub}>{submittedCount}/{playerCount} locked in</span>
        </div>
      )}

      {/* QUESTION */}
      {phase === 'question' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Guess locked 🔒</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.writeBox}>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={draft}
              placeholder="Your best guess…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitGuess(); }}
              autoFocus
            />
            <button
              className={styles.primaryBtn}
              onClick={submitGuess}
              disabled={!(Number(draft) > 0)}
            >
              Lock in guess
            </button>
            <p className={styles.hint}>Closer is better — being within a factor still scores well.</p>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.answerCard}>
            <span className={styles.answerLabel}>Actual answer</span>
            <span className={styles.answerVal}>{fmt(reveal.answer)} <span className={styles.answerUnit}>{reveal.unit}</span></span>
          </div>

          <div className={styles.guessList}>
            {reveal.results.map((r) => (
              <div key={r.playerId} className={styles.guessRow}>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.guessVal}>{r.guess == null ? 'no guess' : fmt(r.guess)}</span>
                <span className={styles.factor}>{r.guess == null ? '—' : fmtFactor(r.factor)}</span>
                <span className={styles.pts}>+{r.points}</span>
              </div>
            ))}
          </div>

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
    </div>
  );
}
