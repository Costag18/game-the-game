import { useEffect, useRef, useState } from 'react';
import styles from './GroupMind.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

function useCountdown(deadline) {
  const [secs, setSecs] = useState(null);
  useEffect(() => {
    if (!deadline) { setSecs(null); return; }
    const tick = () => setSecs(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);
  return secs;
}

export default function GroupMindGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);
  const draftRef = useRef('');
  draftRef.current = draft; // keep the latest draft reachable from the countdown closure
  const autoSubmitted = useRef(false);

  const phase = gameState?.phase;
  const hasSubmitted = gameState?.hasSubmitted;
  const deadline = gameState?.deadline;
  const secs = useCountdown(deadline);

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'writing') { setDraft(''); autoSubmitted.current = false; }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // auto-submit whatever's typed ~1s before the writing deadline so input isn't lost on timeout
  useEffect(() => {
    if (phase !== 'writing' || !deadline) return;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (rem <= 1 && !autoSubmitted.current && !hasSubmitted) {
        const t = draftRef.current.trim();
        if (t) { autoSubmitted.current = true; onAction({ type: 'submitAnswer', text: t }); }
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, deadline, hasSubmitted, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Reading the room…</p></div>;

  const {
    roundNumber, totalRounds, category, scores = {}, myId,
    myAnswer, submittedCount, playerCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);

  function submitAnswer() {
    const t = draft.trim();
    if (!t || hasSubmitted) return;
    onAction({ type: 'submitAnswer', text: t });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>GROUP MIND</h1>
        <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && (
        <p className={styles.prompt}>
          {category}
          {secs != null && <span className={styles.timer}> · {secs}s</span>}
        </p>
      )}

      {phase === 'writing' && <p className={styles.hint}>Match the others — think like the group!</p>}

      {/* WRITING */}
      {phase === 'writing' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Locked in: “{myAnswer}” 🔒</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.writeBox}>
            <input
              className={styles.input}
              value={draft}
              maxLength={40}
              placeholder="Your one short answer…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitAnswer(); }}
              autoFocus
            />
            <button className={styles.primaryBtn} onClick={submitAnswer} disabled={!draft.trim()}>Lock it in</button>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.groups}>
            {reveal.groups.map((grp, i) => (
              <div key={i} className={`${styles.group} ${grp.matchCount > 1 ? styles.groupMatch : ''}`}>
                <div className={styles.groupTop}>
                  <span className={styles.groupLabel}>{grp.label}</span>
                  <span className={styles.groupMeta}>
                    <span className={styles.countBadge}>×{grp.matchCount}</span>
                    {grp.points > 0 && <span className={styles.pts}>+{grp.points} each</span>}
                  </span>
                </div>
                <div className={styles.members}>
                  {grp.members.map((pid) => (
                    <span key={pid} className={styles.memberChip}>
                      <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>
                  {sc}{reveal.awards[pid]?.gained ? ` (+${reveal.awards[pid].gained})` : ''}
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
