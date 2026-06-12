import { useEffect, useRef, useState } from 'react';
import styles from './QuiplashClash.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function QuiplashClashGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [drafts, setDrafts] = useState({});   // duelId -> text being typed
  const [pick, setPick] = useState(null);     // selected optionId for the current duel
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);
  const prevDuel = useRef(null);
  // mirror the latest local input so the countdown closure can auto-submit on timeout
  const draftsRef = useRef({});
  draftsRef.current = drafts;
  const pickRef = useRef(null);
  pickRef.current = pick;
  const writeAutoSubmitted = useRef(false);   // guards the one-shot write auto-submit
  const voteAutoSubmitted = useRef(false);     // guards the per-duel vote auto-submit
  // current game state reachable from the countdown closure (which only depends on deadline)
  const stateRef = useRef(gameState);
  stateRef.current = gameState;

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;
  const duelIndex = gameState?.duel?.index ?? null;

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'writing') { setDrafts({}); writeAutoSubmitted.current = false; }
      if (phase === 'voting') { setPick(null); playSound('roundStart'); }
      if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
      prevPhase.current = phase;
    }
  }, [phase, playSound]);

  // a new duel comes up → clear the previous selection
  useEffect(() => {
    if (phase === 'voting' && duelIndex !== prevDuel.current) {
      setPick(null);
      voteAutoSubmitted.current = false; // fresh duel → allow one auto-submit again
      prevDuel.current = duelIndex;
    }
  }, [phase, duelIndex]);

  // countdown to the active deadline (also auto-submits typed/selected input on timeout)
  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(rem);
      // ~1s before the server deadline, send whatever's entered so nothing is discarded
      if (rem <= 1) {
        const gs = stateRef.current;
        if (gs?.phase === 'writing' && !writeAutoSubmitted.current) {
          writeAutoSubmitted.current = true;
          // lock every owed prompt that has non-empty text typed
          for (const mp of (gs.myPrompts || [])) {
            if (mp.myAnswer != null) continue; // already locked
            const t = (draftsRef.current[mp.duelId] || '').trim();
            if (t) onAction({ type: 'submitAnswer', duelId: mp.duelId, text: t });
          }
        } else if (gs?.phase === 'voting' && !voteAutoSubmitted.current) {
          const d = gs.duel;
          // only voters with a current selection and no vote yet need auto-submitting
          if (d && !d.iAmAuthor && !d.myVote && pickRef.current) {
            voteAutoSubmitted.current = true;
            onAction({ type: 'castVote', optionId: pickRef.current });
          }
        }
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Warming up the wits…</p></div>;

  const {
    myId, scores = {}, playerCount, myPrompts, submittedCount, duel, acknowledged = [], reveal,
  } = gameState;

  const allPlayers = Object.keys(scores);

  function submitAnswer(duelId) {
    const t = (drafts[duelId] || '').trim();
    if (!t) return;
    onAction({ type: 'submitAnswer', duelId, text: t });
    playSound('click');
  }
  function confirmVote() {
    if (!pick || (duel && duel.myVote)) return;
    onAction({ type: 'castVote', optionId: pick });
    playSound('voteCast');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>QUIPLASH CLASH</h1>
        {phase === 'voting' && duel && <span className={styles.meta}>Duel {duel.index} / {duel.total}</span>}
        {phase === 'writing' && <span className={styles.meta}>Write your lines</span>}
      </div>

      {remaining != null && (phase === 'writing' || phase === 'voting') && (
        <div className={styles.clock}>{remaining}s</div>
      )}

      {/* WRITING — answer each of your assigned prompts */}
      {phase === 'writing' && myPrompts && (
        <div className={styles.writeArea}>
          {myPrompts.map((mp) => (
            <div key={mp.duelId} className={styles.promptCard}>
              <p className={styles.prompt}>{mp.prompt}</p>
              {mp.myAnswer != null ? (
                <div className={styles.lockedAnswer}>“{mp.myAnswer}” <span className={styles.lockTag}>locked 🔒</span></div>
              ) : (
                <div className={styles.writeRow}>
                  <input
                    className={styles.input}
                    value={drafts[mp.duelId] || ''}
                    maxLength={120}
                    placeholder="Your funniest answer…"
                    onChange={(e) => setDrafts((d) => ({ ...d, [mp.duelId]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitAnswer(mp.duelId); }}
                  />
                  <button
                    className={styles.primaryBtn}
                    onClick={() => submitAnswer(mp.duelId)}
                    disabled={!(drafts[mp.duelId] || '').trim()}
                  >Lock</button>
                </div>
              )}
            </div>
          ))}
          <p className={styles.sub}>Players done writing: {submittedCount}/{playerCount}</p>
        </div>
      )}

      {/* VOTING — judge the current duel (unless you're one of its authors) */}
      {phase === 'voting' && duel && (
        duel.iAmAuthor ? (
          <div className={styles.waitBox}>
            <p className={styles.prompt}>{duel.prompt}</p>
            <p className={styles.waitMsg}>This is your duel — sit tight 🤐</p>
            <p className={styles.sub}>Votes in… {duel.votedCount}/{duel.voterCount}</p>
          </div>
        ) : duel.myVote ? (
          <div className={styles.waitBox}>
            <p className={styles.prompt}>{duel.prompt}</p>
            <p className={styles.waitMsg}>Vote locked in ✅</p>
            <p className={styles.sub}>Votes in… {duel.votedCount}/{duel.voterCount}</p>
          </div>
        ) : (
          <div className={styles.voteArea}>
            <p className={styles.prompt}>{duel.prompt}</p>
            <p className={styles.voteHint}>Which is funnier?</p>
            <div className={styles.duelOptions}>
              {duel.options.map((o) => (
                <button
                  key={o.optionId}
                  className={`${styles.duelOption} ${styles['side_' + o.side]} ${pick === o.optionId ? styles.optionSel : ''}`}
                  onClick={() => setPick(o.optionId)}
                >
                  {o.text}
                </button>
              ))}
            </div>
            <button className={styles.primaryBtn} onClick={confirmVote} disabled={!pick}>Lock in vote</button>
          </div>
        )
      )}

      {/* REVEAL — authors, vote counts, points per duel */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          {reveal.duels.map((d) => (
            <div key={d.id} className={styles.revDuel}>
              <p className={styles.revPrompt}>{d.prompt}</p>
              <div className={styles.revAnswers}>
                {d.answers.map((ans) => (
                  <div
                    key={ans.authorId}
                    className={`${styles.revAnswer} ${d.winner === ans.authorId ? styles.revWinner : ''}`}
                  >
                    <div className={styles.revText}>“{ans.text}”</div>
                    <div className={styles.revFoot}>
                      <PlayerName playerId={ans.authorId} nicknames={nicknames} avatars={avatars} />
                      <span className={styles.revStat}>{ans.votes} vote{ans.votes === 1 ? '' : 's'} · +{ans.gained}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

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
