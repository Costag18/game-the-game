import { useEffect, useRef, useState } from 'react';
import styles from './MostLikelyTo.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function MostLikelyToGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'voting') { setPick(null); playSound('roundStart'); }
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to the active deadline
  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Gathering the jury…</p></div>;

  const {
    myId, roundNumber, totalRounds, prompt, players = [], scores = {},
    myVote, hasVoted, votedCount, playerCount, acknowledged = [], reveal,
  } = gameState;

  function vote(targetId) {
    if (hasVoted || phase !== 'voting') return;
    setPick(targetId);
    onAction({ type: 'castVote', targetId });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const chosen = myVote || pick;

  // reveal helpers: ordered tally + bar scaling
  const tallyEntries = reveal
    ? Object.entries(reveal.tally).sort((x, y) => y[1] - x[1])
    : [];
  const maxVotes = tallyEntries.length ? Math.max(1, tallyEntries[0][1]) : 1;

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>MOST LIKELY TO</h1>
        <span className={styles.meta}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase === 'voting' && remaining != null && (
        <div className={styles.statusBar}><span className={styles.clock}>{remaining}s</span></div>
      )}

      {/* VOTING */}
      {phase === 'voting' && (
        <div className={styles.qArea}>
          <p className={styles.prompt}>
            <span className={styles.promptLead}>Who is most likely to</span>
            <span className={styles.promptBody}>{prompt}?</span>
          </p>

          {hasVoted ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>
                Voted for <PlayerName playerId={chosen} nicknames={nicknames} avatars={avatars} /> 🔒
              </p>
              <p className={styles.sub}>Waiting… {votedCount}/{playerCount} voted</p>
            </div>
          ) : (
            <>
              <p className={styles.hint}>Tap the player you think fits best (you can pick yourself!)</p>
              <div className={styles.grid}>
                {players.map((pid) => (
                  <button
                    key={pid}
                    className={`${styles.voteBtn} ${chosen === pid ? styles.voteSel : ''} ${pid === myId ? styles.voteMe : ''}`}
                    onClick={() => vote(pid)}
                    disabled={hasVoted}
                  >
                    <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} size={26} />
                    {pid === myId && <span className={styles.youTag}>you</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <p className={styles.revPrompt}>Most likely to {reveal.prompt}…</p>

          {reveal.winners.length > 0 ? (
            <div className={styles.winnerBox}>
              <span className={styles.crown}>👑</span>
              <span className={styles.winnerNames}>
                {reveal.winners.map((p, i) => (
                  <span key={p}>
                    <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} size={24} />
                    {i < reveal.winners.length - 1 ? ' & ' : ''}
                  </span>
                ))}
              </span>
            </div>
          ) : (
            <p className={styles.noVotes}>Nobody got a single vote 🤷</p>
          )}

          <div className={styles.tally}>
            {tallyEntries.map(([pid, count]) => {
              const isWinner = reveal.winners.includes(pid);
              return (
                <div key={pid} className={`${styles.tallyRow} ${isWinner ? styles.tallyWin : ''}`}>
                  <span className={styles.tallyName}>
                    <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  </span>
                  <div className={styles.barTrack}>
                    <div
                      className={styles.barFill}
                      style={{ width: `${(count / maxVotes) * 100}%` }}
                    />
                  </div>
                  <span className={styles.tallyCount}>{count}</span>
                </div>
              );
            })}
          </div>

          <div className={styles.scoreboard}>
            <p className={styles.boardTitle}>Total votes received</p>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{Math.round(sc / 100)}</span>
              </div>
            ))}
          </div>

          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.contBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={players} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
