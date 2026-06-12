import { useEffect, useRef, useState } from 'react';
import styles from './Fibbage.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function Fibbage({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const submittedAt = useRef(0);
  const prevPhase = useRef(null);
  // keep latest typed fib / selected vote reachable from the countdown closure
  const draftRef = useRef('');
  const pickRef = useRef(null);
  draftRef.current = draft;
  pickRef.current = pick;
  const writeAutoSubmitted = useRef(false);
  const voteAutoSubmitted = useRef(false);

  const phase = gameState?.phase;
  const hasSubmitted = gameState?.hasSubmitted;
  const myVote = gameState?.myVote;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'writing') { setDraft(''); setRejected(false); submittedAt.current = 0; writeAutoSubmitted.current = false; }
    if (phase === 'voting') { setPick(null); voteAutoSubmitted.current = false; }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // if a submit didn't register within ~1.6s, it was rejected (truth/dup)
  useEffect(() => {
    if (hasSubmitted) { setRejected(false); return; }
    if (!submittedAt.current) return;
    const id = setTimeout(() => { if (!hasSubmitted) setRejected(true); }, 1600);
    return () => clearTimeout(id);
  }, [hasSubmitted, draft]);

  // Countdown + auto-submit the typed fib / selected vote ~1s before the server
  // deadline so a player's input beats the house substitute (decoy fake / random vote).
  const writeEndTime = gameState?.writeEndTime;
  const voteEndTime = gameState?.voteEndTime;
  useEffect(() => {
    const writeActive = phase === 'writing' && !hasSubmitted && writeEndTime;
    const voteActive = phase === 'voting' && !myVote && voteEndTime;
    if (!writeActive && !voteActive) { setRemaining(null); return; }
    const endTime = writeActive ? writeEndTime : voteEndTime;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRemaining(rem);
      if (rem <= 1) {
        if (writeActive && !writeAutoSubmitted.current) {
          writeAutoSubmitted.current = true;
          const t = draftRef.current.trim();
          if (t) { submittedAt.current = Date.now(); onAction({ type: 'submitFake', text: t }); }
        } else if (voteActive && !voteAutoSubmitted.current) {
          voteAutoSubmitted.current = true;
          if (pickRef.current) onAction({ type: 'castVote', optionId: pickRef.current });
        }
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, hasSubmitted, myVote, writeEndTime, voteEndTime, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Thinking up lies…</p></div>;

  const {
    promptNumber, totalRounds, promptText, scores = {}, myId, submittedCount, playerCount,
    ballot, votedCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);

  function submitFake() {
    const t = draft.trim();
    if (!t || hasSubmitted) return;
    submittedAt.current = Date.now();
    setRejected(false);
    onAction({ type: 'submitFake', text: t });
    playSound('click');
  }
  function confirmVote() {
    if (!pick || myVote) return;
    onAction({ type: 'castVote', optionId: pick });
    playSound('voteCast');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>FIBBAGE</h1>
        <span className={styles.round}>Q{promptNumber} / {totalRounds}</span>
        {remaining != null && (
          <span className={`${styles.timer} ${remaining <= 10 ? styles.timerLow : ''}`}>{remaining}s</span>
        )}
      </div>

      {phase !== 'finished' && <p className={styles.prompt}>{promptText.replace('____', '_____')}</p>}

      {/* WRITING */}
      {phase === 'writing' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Your fib is in 🤫</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.writeBox}>
            <input
              className={styles.input}
              value={draft}
              maxLength={80}
              placeholder="Type a convincing lie…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitFake(); }}
              autoFocus
            />
            <button className={styles.primaryBtn} onClick={submitFake} disabled={!draft.trim()}>Submit Fib</button>
            {rejected && <p className={styles.reject}>Too close to the truth (or already taken) — try another.</p>}
          </div>
        )
      )}

      {/* VOTING */}
      {phase === 'voting' && ballot && (
        myVote ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Vote locked in ✅</p>
            <p className={styles.sub}>Votes in… {votedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.ballot}>
            {ballot.map((o) => (
              <button
                key={o.optionId}
                className={`${styles.option} ${pick === o.optionId ? styles.optionSel : ''} ${o.isMine ? styles.optionMine : ''}`}
                disabled={o.isMine}
                onClick={() => !o.isMine && setPick(o.optionId)}
              >
                {o.text}{o.isMine && <span className={styles.mineTag}> (your fib)</span>}
              </button>
            ))}
            <button className={styles.primaryBtn} onClick={confirmVote} disabled={!pick}>Lock in vote</button>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          {reveal.options.map((o) => (
            <div key={o.optionId} className={`${styles.revOption} ${o.kind === 'truth' ? styles.revTruth : ''}`}>
              <div className={styles.revTop}>
                <span className={styles.revText}>{o.text}</span>
                {o.kind === 'truth'
                  ? <span className={styles.truthTag}>TRUTH ✓</span>
                  : <span className={styles.byTag}>by <PlayerName playerId={o.authorId} nicknames={nicknames} avatars={avatars} /></span>}
              </div>
              {o.voters.length > 0 && (
                <div className={styles.voters}>
                  {o.voters.map((v) => <span key={v} className={styles.voterChip}><PlayerName playerId={v} nicknames={nicknames} avatars={avatars} /></span>)}
                </div>
              )}
            </div>
          ))}
          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc}{reveal.awards[pid]?.gained ? ` (+${reveal.awards[pid].gained})` : ''}</span>
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
