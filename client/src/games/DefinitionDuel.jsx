import { useEffect, useRef, useState } from 'react';
import styles from './DefinitionDuel.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

function useCountdown(deadline) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!deadline) { setLeft(0); return undefined; }
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);
  return left;
}

export default function DefinitionDuelGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const [rejected, setRejected] = useState(false);
  const submittedAt = useRef(0);
  const prevPhase = useRef(null);
  const draftRef = useRef('');
  draftRef.current = draft; // latest typed definition, reachable from the timeout effect
  const pickRef = useRef(null);
  pickRef.current = pick;   // latest chosen ballot option, reachable from the timeout effect
  const autoSubmitted = useRef(false); // one auto-submit per timed step

  const phase = gameState?.phase;
  const hasSubmitted = gameState?.hasSubmitted;
  const myVote = gameState?.myVote;
  const secondsLeft = useCountdown(gameState?.deadline);

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'writing') { setDraft(''); setRejected(false); setPick(null); submittedAt.current = 0; autoSubmitted.current = false; }
    if (phase === 'voting') { setPick(null); autoSubmitted.current = false; }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // timeout safety net: auto-submit whatever's entered ~1s before each step's deadline
  // (writing → send typed definition; voting → send the chosen option) so it isn't discarded
  useEffect(() => {
    if (secondsLeft > 1 || autoSubmitted.current) return;
    if (phase === 'writing' && !hasSubmitted) {
      const t = draftRef.current.trim();
      if (t) { autoSubmitted.current = true; submittedAt.current = Date.now(); onAction({ type: 'submitFake', text: t }); }
    } else if (phase === 'voting' && !myVote && pickRef.current) {
      autoSubmitted.current = true;
      onAction({ type: 'castVote', optionId: pickRef.current });
    }
  }, [secondsLeft, phase, hasSubmitted, myVote, onAction]);

  // if a submit didn't register within ~1.6s, it was rejected (matches truth / dup)
  useEffect(() => {
    if (hasSubmitted) { setRejected(false); return undefined; }
    if (!submittedAt.current) return undefined;
    const id = setTimeout(() => { if (!hasSubmitted) setRejected(true); }, 1600);
    return () => clearTimeout(id);
  }, [hasSubmitted, draft]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Sharpening the dictionary…</p></div>;

  const {
    roundNumber, totalRounds, word, scores = {}, myId, submittedCount, playerCount,
    ballot, votedCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);
  const showTimer = (phase === 'writing' && !hasSubmitted) || (phase === 'voting' && !myVote);

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
        <h1 className={styles.title}>Definition Duel</h1>
        <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && phase !== 'reveal' && (
        <div className={styles.wordCard}>
          <span className={styles.wordLabel}>Define the word</span>
          <span className={styles.word}>{word}</span>
          {showTimer && <span className={styles.timer}>{secondsLeft}s</span>}
        </div>
      )}

      {/* WRITING */}
      {phase === 'writing' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Your definition is in 📖</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.writeBox}>
            <p className={styles.hint}>Bluff a definition convincing enough to fool everyone.</p>
            <textarea
              className={styles.input}
              value={draft}
              maxLength={140}
              rows={2}
              placeholder="Write a plausible-sounding definition…"
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <button className={styles.primaryBtn} onClick={submitFake} disabled={!draft.trim()}>Submit Definition</button>
            {rejected && <p className={styles.reject}>Too close to the real definition (or already taken) — try another.</p>}
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
            <p className={styles.hint}>Which one is the REAL definition?</p>
            {ballot.map((o) => (
              <button
                key={o.optionId}
                type="button"
                className={`${styles.option} ${pick === o.optionId ? styles.optionSel : ''} ${o.isMine ? styles.optionMine : ''}`}
                disabled={o.isMine}
                onClick={() => !o.isMine && setPick(o.optionId)}
              >
                {o.text}{o.isMine && <span className={styles.mineTag}> (your bluff)</span>}
              </button>
            ))}
            <button className={styles.primaryBtn} onClick={confirmVote} disabled={!pick}>Lock in vote</button>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.revealWord}>
            <span className={styles.wordLabel}>The word was</span>
            <span className={styles.word}>{reveal.word}</span>
          </div>
          {reveal.options.map((o) => (
            <div key={o.optionId} className={`${styles.revOption} ${o.kind === 'truth' ? styles.revTruth : ''}`}>
              <div className={styles.revTop}>
                <span className={styles.revText}>{o.text}</span>
                {o.kind === 'truth'
                  ? <span className={styles.truthTag}>REAL ✓</span>
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
