import { useEffect, useRef, useState } from 'react';
import styles from './TwoTruths.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function TwoTruthsGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [drafts, setDrafts] = useState(['', '', '']);
  const [lieIdx, setLieIdx] = useState(null);
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;
  const hasSubmitted = gameState?.hasSubmitted;
  const myGuess = gameState?.myGuess;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'writing') { setDrafts(['', '', '']); setLieIdx(null); playSound('roundStart'); }
    if (phase === 'guessing') { setPick(null); playSound('voteCast'); }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to the active phase deadline
  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Cooking up some lies…</p></div>;

  const {
    myId, roundNumber, totalRounds, storyteller, iAmStoryteller, scores = {},
    statements, guesserCount, guessedCount, acknowledged = [], reveal, playerCount,
  } = gameState;

  const allPlayers = Object.keys(scores);
  const canSubmit = drafts.every((d) => d.trim()) && lieIdx != null;

  function setDraft(i, val) {
    setDrafts((d) => d.map((x, j) => (j === i ? val : x)));
  }
  function submitStatements() {
    if (!canSubmit || hasSubmitted) return;
    onAction({ type: 'submitStatements', statements: drafts.map((d) => d.trim()), lieIndex: lieIdx });
    playSound('click');
  }
  function confirmGuess() {
    if (!pick || myGuess) return;
    onAction({ type: 'guess', optionId: pick });
    playSound('voteCast');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>TWO TRUTHS &amp; A LIE</h1>
        <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && storyteller && (
        <p className={styles.teller}>
          Storyteller:{' '}
          <PlayerName playerId={storyteller} nicknames={nicknames} avatars={avatars} />
          {phase === 'guessing' && remaining != null && <span className={styles.clock}> · {remaining}s</span>}
          {phase === 'writing' && remaining != null && <span className={styles.clock}> · {remaining}s</span>}
        </p>
      )}

      {/* WRITING */}
      {phase === 'writing' && (
        iAmStoryteller ? (
          hasSubmitted ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>Statements locked in 🔒</p>
              <p className={styles.sub}>Everyone is guessing your lie…</p>
            </div>
          ) : (
            <div className={styles.writeBox}>
              <p className={styles.instr}>Write 3 statements about yourself — two true, one a lie. Tap the toggle to mark which one is the lie.</p>
              {drafts.map((d, i) => (
                <div key={i} className={styles.stmtRow}>
                  <input
                    className={styles.input}
                    value={d}
                    maxLength={140}
                    placeholder={`Statement ${i + 1}…`}
                    onChange={(e) => setDraft(i, e.target.value)}
                  />
                  <button
                    type="button"
                    className={`${styles.lieToggle} ${lieIdx === i ? styles.lieToggleOn : ''}`}
                    onClick={() => setLieIdx(i)}
                    aria-pressed={lieIdx === i}
                  >
                    {lieIdx === i ? 'LIE 🤥' : 'mark lie'}
                  </button>
                </div>
              ))}
              <button className={styles.primaryBtn} onClick={submitStatements} disabled={!canSubmit}>Submit</button>
            </div>
          )
        ) : (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>
              <PlayerName playerId={storyteller} nicknames={nicknames} avatars={avatars} /> is writing…
            </p>
            <p className={styles.sub}>Get ready to spot the lie 🔍</p>
          </div>
        )
      )}

      {/* GUESSING */}
      {phase === 'guessing' && statements && (
        iAmStoryteller ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Players are guessing your lie 🤫</p>
            <p className={styles.sub}>Guesses in… {guessedCount}/{guesserCount}</p>
          </div>
        ) : myGuess ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Guess locked in ✅</p>
            <p className={styles.sub}>Guesses in… {guessedCount}/{guesserCount}</p>
          </div>
        ) : (
          <div className={styles.guessBox}>
            <p className={styles.instr}>Which one is the lie?</p>
            {statements.map((s, i) => (
              <button
                key={s.optionId}
                className={`${styles.option} ${pick === s.optionId ? styles.optionSel : ''}`}
                onClick={() => setPick(s.optionId)}
              >
                <span className={styles.optNum}>{i + 1}</span>
                <span className={styles.optText}>{s.text}</span>
              </button>
            ))}
            <button className={styles.primaryBtn} onClick={confirmGuess} disabled={!pick}>Lock in guess</button>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          {reveal.skipped ? (
            <p className={styles.skipped}>
              <PlayerName playerId={reveal.storyteller} nicknames={nicknames} avatars={avatars} /> didn’t answer in time — round skipped.
            </p>
          ) : (
            <>
              {reveal.statements.map((s, i) => (
                <div key={s.optionId} className={`${styles.revOption} ${s.isLie ? styles.revLie : styles.revTrue}`}>
                  <div className={styles.revTop}>
                    <span className={styles.revText}><span className={styles.optNum}>{i + 1}</span> {s.text}</span>
                    <span className={s.isLie ? styles.lieTag : styles.trueTag}>{s.isLie ? 'THE LIE 🤥' : 'TRUE ✓'}</span>
                  </div>
                  {s.guessers.length > 0 && (
                    <div className={styles.voters}>
                      {s.guessers.map((v) => (
                        <span key={v} className={styles.voterChip}>
                          <PlayerName playerId={v} nicknames={nicknames} avatars={avatars} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <p className={styles.tally}>
                Caught the lie: {reveal.caughtBy.length} · Fooled: {reveal.fooled.length}
              </p>
            </>
          )}

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc}{reveal.awards?.[pid]?.gained ? ` (+${reveal.awards[pid].gained})` : ''}</span>
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
