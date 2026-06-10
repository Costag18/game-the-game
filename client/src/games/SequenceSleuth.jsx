import { useEffect, useRef, useState } from 'react';
import styles from './SequenceSleuth.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function SequenceSleuthGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [iAcked, setIAcked] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const prevPhase = useRef(null);
  const prevSeq = useRef(null);

  const phase = gameState?.phase;
  const seqNo = gameState?.sequenceNumber;
  const hasLocked = gameState?.hasLocked;
  const nextRevealMs = gameState?.nextRevealMs;

  // reset draft on new sequence / phase
  useEffect(() => {
    if (phase !== prevPhase.current || seqNo !== prevSeq.current) {
      if (phase === 'playing') setDraft('');
      if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
      prevPhase.current = phase;
      prevSeq.current = seqNo;
    }
  }, [phase, seqNo, playSound]);

  // live countdown to the next reveal
  useEffect(() => {
    if (phase !== 'playing' || !nextRevealMs) { setCountdown(null); return; }
    const tick = () => setCountdown(Math.max(0, Math.ceil((nextRevealMs - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, nextRevealMs, seqNo]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Reading the sequence…</p></div>;

  const {
    totalSequences, revealedTerms = [], revealedCount, potentialPoints,
    scores = {}, opponents = [], myLock, resolve, acknowledged = [], myId, results,
  } = gameState;

  const allPlayers = Object.keys(scores);

  function lockGuess() {
    if (hasLocked || phase !== 'playing') return;
    const v = parseInt(draft, 10);
    if (!Number.isFinite(v) || String(v) !== draft.trim()) return;
    onAction({ type: 'guess', value: v });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const validDraft = draft.trim() !== '' && /^-?\d+$/.test(draft.trim());

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>SEQUENCE SLEUTH</h1>
        <span className={styles.round}>#{seqNo} / {totalSequences}</span>
      </div>

      {/* PLAYING */}
      {phase === 'playing' && (
        <>
          <div className={styles.seqStrip}>
            {revealedTerms.map((t, i) => (
              <div key={i} className={styles.term}>{t}</div>
            ))}
            <div className={styles.termNext}>?</div>
          </div>

          <div className={styles.metaRow}>
            <span className={styles.shown}>{revealedCount} terms shown</span>
            {countdown != null && <span className={styles.timer}>next term in {countdown}s</span>}
            <span className={styles.worth}>guess now = {potentialPoints} pts</span>
          </div>

          {hasLocked ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>Locked: {myLock?.value} 🔒</p>
              <p className={styles.sub}>Waiting for the next term to reveal…</p>
            </div>
          ) : (
            <div className={styles.lockBox}>
              <p className={styles.prompt}>What is the NEXT number?</p>
              <input
                className={styles.input}
                type="number"
                inputMode="numeric"
                value={draft}
                placeholder="your guess…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') lockGuess(); }}
                autoFocus
              />
              <button className={styles.primaryBtn} onClick={lockGuess} disabled={!validDraft}>
                Lock my guess
              </button>
              <p className={styles.hint}>Sooner = more points. A wrong guess scores 0 for this sequence.</p>
            </div>
          )}

          <div className={styles.oppRow}>
            {opponents.map((o) => (
              <span key={o.playerId} className={`${styles.oppChip} ${o.hasLocked ? styles.oppLocked : ''}`}>
                <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
                {o.hasLocked ? ' 🔒' : ' …'}
              </span>
            ))}
          </div>
        </>
      )}

      {/* REVEAL */}
      {phase === 'reveal' && resolve && (
        <div className={styles.reveal}>
          <div className={styles.seqStrip}>
            {resolve.revealedTerms.map((t, i) => (
              <div key={i} className={styles.term}>{t}</div>
            ))}
            <div className={styles.termAnswer}>{resolve.answer}</div>
          </div>
          <p className={styles.ruleLabel}>Rule: {resolve.ruleLabel}</p>

          <div className={styles.lockList}>
            {allPlayers.map((pid) => {
              const lk = resolve.locks?.[pid];
              return (
                <div key={pid} className={`${styles.lockRow} ${lk?.correct ? styles.lockHit : lk ? styles.lockMiss : ''}`}>
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.lockResult}>
                    {!lk ? 'no guess'
                      : lk.correct ? `${lk.value} ✓ +${lk.points}`
                      : `${lk.value} ✗ +0`}
                  </span>
                </div>
              );
            })}
          </div>

          <Scoreboard scores={scores} nicknames={nicknames} avatars={avatars} />

          {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
          <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {/* FINISHED */}
      {phase === 'finished' && (
        <div className={styles.reveal}>
          <p className={styles.finalTitle}>Final standings</p>
          <div className={styles.lockList}>
            {(results || []).map((r) => (
              <div key={r.playerId} className={styles.lockRow}>
                <span className={styles.place}>{r.placement}.</span>
                <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.lockResult}>{r.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Scoreboard({ scores, nicknames, avatars }) {
  return (
    <div className={styles.scoreboard}>
      {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
        <div key={pid} className={styles.scoreRow}>
          <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
          <span className={styles.scoreVal}>{sc}</span>
        </div>
      ))}
    </div>
  );
}
