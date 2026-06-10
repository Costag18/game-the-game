import { useEffect, useRef, useState } from 'react';
import styles from './PriceIsWrong.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function PriceIsWrongGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [iAcked, setIAcked] = useState(false);
  const [secs, setSecs] = useState(null);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'guessing') setDraft('');
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to the active guess deadline
  useEffect(() => {
    if (phase !== 'guessing' || !deadline) { setSecs(null); return; }
    const tick = () => setSecs(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, deadline]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Loading the showcase…</p></div>;

  const {
    round, totalRounds, prompt, unit, scores = {}, myId,
    hasSubmitted, submittedCount, playerCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);

  function submitGuess() {
    const t = draft.trim();
    if (t === '' || hasSubmitted) return;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return;
    onAction({ type: 'submitGuess', guess: n });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>Price Is Wrong</h1>
        <span className={styles.round}>Round {round} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && (
        <div className={styles.promptCard}>
          <p className={styles.promptLabel}>Closest without going over wins</p>
          <p className={styles.prompt}>{prompt}</p>
          <p className={styles.unit}>Answer in <strong>{unit}</strong></p>
        </div>
      )}

      {/* GUESSING */}
      {phase === 'guessing' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Guess locked in 🔒</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
            {secs != null && <p className={styles.timer}>{secs}s left</p>}
          </div>
        ) : (
          <div className={styles.writeBox}>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              value={draft}
              placeholder="Your guess…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitGuess(); }}
              autoFocus
            />
            <button className={styles.primaryBtn} onClick={submitGuess} disabled={draft.trim() === ''}>Lock in guess</button>
            {secs != null && <p className={styles.timer}>{secs}s left</p>}
            <p className={styles.hint}>Don't go over — anything above the real answer scores 0.</p>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.answerCard}>
            <span className={styles.answerLabel}>The real answer</span>
            <span className={styles.answerVal}>{reveal.answer} <span className={styles.answerUnit}>{reveal.unit}</span></span>
          </div>

          <div className={styles.board}>
            {reveal.board.map((row) => (
              <div
                key={row.playerId}
                className={`${styles.boardRow} ${row.over ? styles.over : ''} ${row.rank === 1 ? styles.closest : ''}`}
              >
                <PlayerName playerId={row.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.guessVal}>
                  {row.submitted ? row.guess : '—'}
                  {row.over && <span className={styles.overTag}> OVER ✗</span>}
                  {row.rank === 1 && <span className={styles.closestTag}> CLOSEST ✓</span>}
                </span>
                <span className={styles.gained}>{row.gained ? `+${row.gained}` : '0'}</span>
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
        </div>
      )}
    </div>
  );
}
