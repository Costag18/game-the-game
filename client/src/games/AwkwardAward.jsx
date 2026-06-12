import { useEffect, useRef, useState } from 'react';
import styles from './AwkwardAward.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

function Countdown({ deadline }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil(((deadline || 0) - Date.now()) / 1000)));
  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  return <span className={styles.timer}>{left}s</span>;
}

export default function AwkwardAwardGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const hasSubmitted = gameState?.hasSubmitted;
  const myVote = gameState?.myVote;
  const activeDeadline = gameState?.deadline;

  // mirror the latest local input + flags so the timeout closure can auto-submit it
  const draftRef = useRef('');
  draftRef.current = draft;
  const pickRef = useRef(null);
  pickRef.current = pick;
  const autoSubmitted = useRef(false); // one-shot per timed input phase

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'writing') { setDraft(''); autoSubmitted.current = false; }
    if (phase === 'voting') { setPick(null); autoSubmitted.current = false; }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // On timeout, auto-submit whatever's entered (~1s before the server deadline) so
  // a typed acceptance reason / selected vote isn't discarded for a house substitute.
  useEffect(() => {
    if (!activeDeadline || (phase !== 'writing' && phase !== 'voting')) return undefined;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((activeDeadline - Date.now()) / 1000));
      if (rem > 1 || autoSubmitted.current) return;
      if (phase === 'writing' && !hasSubmitted) {
        const t = draftRef.current.trim();
        if (t) { autoSubmitted.current = true; onAction({ type: 'submitReason', text: t }); }
      } else if (phase === 'voting' && !myVote && pickRef.current) {
        autoSubmitted.current = true;
        onAction({ type: 'castVote', optionId: pickRef.current });
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [activeDeadline, phase, hasSubmitted, myVote, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Polishing the trophies…</p></div>;

  const {
    roundNumber, totalRounds, trophy, scores = {}, myId,
    submittedCount, playerCount, ballot, votedCount, reveal,
    acknowledged = [], deadline,
  } = gameState;

  const allPlayers = Object.keys(scores);

  function submitReason() {
    const t = draft.trim();
    if (!t || hasSubmitted) return;
    onAction({ type: 'submitReason', text: t });
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
        <h1 className={styles.title}>AWKWARD AWARD</h1>
        <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && trophy && (
        <div className={styles.trophy}>
          <span className={styles.trophyIcon}>🏆</span>
          <span className={styles.trophyName}>{trophy}</span>
        </div>
      )}

      {/* WRITING */}
      {phase === 'writing' && (
        <>
          <p className={styles.cue}>
            Write your acceptance speech — <em>why do YOU deserve this?</em>
            {phase === 'writing' && <Countdown deadline={deadline} />}
          </p>
          {hasSubmitted ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>Speech submitted 🎤</p>
              <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
            </div>
          ) : (
            <div className={styles.writeBox}>
              <textarea
                className={styles.input}
                value={draft}
                maxLength={140}
                rows={2}
                placeholder="Because honestly, no one else even comes close…"
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <button className={styles.primaryBtn} onClick={submitReason} disabled={!draft.trim()}>
                Accept the Award
              </button>
            </div>
          )}
        </>
      )}

      {/* VOTING */}
      {phase === 'voting' && ballot && (
        <>
          <p className={styles.cue}>
            Which nominee gave the best acceptance speech?
            <Countdown deadline={deadline} />
          </p>
          {myVote ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>Vote locked in ✅</p>
              <p className={styles.sub}>Votes in… {votedCount}/{playerCount}</p>
            </div>
          ) : (
            <div className={styles.ballot}>
              {ballot.map((o) => (
                <button
                  key={o.optionId}
                  className={`${styles.card} ${pick === o.optionId ? styles.cardSel : ''} ${o.isMine ? styles.cardMine : ''}`}
                  disabled={o.isMine}
                  onClick={() => !o.isMine && setPick(o.optionId)}
                >
                  <div className={styles.cardNominee}>
                    <PlayerName playerId={o.nomineeId} nicknames={nicknames} avatars={avatars} />
                    {o.isMine && <span className={styles.mineTag}>your speech</span>}
                  </div>
                  <div className={styles.cardText}>“{o.text}”</div>
                </button>
              ))}
              <button className={styles.primaryBtn} onClick={confirmVote} disabled={!pick}>
                Cast Vote
              </button>
            </div>
          )}
        </>
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          {[...reveal.options].sort((a, b) => b.votes - a.votes).map((o) => (
            <div
              key={o.optionId}
              className={`${styles.revCard} ${o.optionId === reveal.winnerOptionId && o.votes > 0 ? styles.revWinner : ''}`}
            >
              <div className={styles.revTop}>
                <span className={styles.revNominee}>
                  <PlayerName playerId={o.nomineeId} nicknames={nicknames} avatars={avatars} />
                  {o.optionId === reveal.winnerOptionId && o.votes > 0 && <span className={styles.winTag}>🏆 WINNER</span>}
                </span>
                <span className={styles.revVotes}>{o.votes} vote{o.votes === 1 ? '' : 's'}</span>
              </div>
              <div className={styles.revText}>“{o.text}”</div>
              <div className={styles.byLine}>
                written by <PlayerName playerId={o.authorId} nicknames={nicknames} avatars={avatars} />
              </div>
              {o.voters.length > 0 && (
                <div className={styles.voters}>
                  {o.voters.map((v) => (
                    <span key={v} className={styles.voterChip}>
                      <PlayerName playerId={v} nicknames={nicknames} avatars={avatars} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>
                  {sc}{reveal.awards[pid] ? ` (+${reveal.awards[pid]})` : ''}
                </span>
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
