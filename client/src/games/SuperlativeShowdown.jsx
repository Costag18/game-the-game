import { useEffect, useRef, useState } from 'react';
import styles from './SuperlativeShowdown.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

function useCountdown(deadline) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!deadline) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline]);
  return left;
}

export default function SuperlativeShowdownGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [order, setOrder] = useState([]);   // local working ranking (array of playerIds)
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);
  const prevRound = useRef(null);

  const phase = gameState?.phase;
  const hasSubmitted = gameState?.hasSubmitted;
  const deadline = gameState?.deadline || 0;
  const secsLeft = useCountdown(phase === 'ranking' && !hasSubmitted ? deadline : 0);

  // Seed / reseed the local ranking when a new ranking round starts.
  useEffect(() => {
    const roundChanged = gameState?.roundNumber !== prevRound.current;
    if (phase === 'ranking' && (phase !== prevPhase.current || roundChanged) && gameState?.players) {
      const seed = [...gameState.players];
      // light shuffle so people don't all leave it alphabetical
      for (let i = seed.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seed[i], seed[j]] = [seed[j], seed[i]]; }
      setOrder(seed);
    }
    if (phase === 'reveal' && phase !== prevPhase.current) { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
    prevRound.current = gameState?.roundNumber;
  }, [phase, gameState?.roundNumber, gameState?.players, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Sizing everyone up…</p></div>;

  const {
    roundNumber, totalRounds, superlative, scores = {}, myId,
    submittedCount, playerCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);

  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
    playSound('click');
  }
  function submit() {
    if (hasSubmitted || order.length !== playerCount) return;
    onAction({ type: 'submitRanking', order });
    playSound('voteCast');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>SUPERLATIVE SHOWDOWN</h1>
        <span className={styles.round}>Round {roundNumber} / {totalRounds}</span>
      </div>

      {phase !== 'finished' && (
        <p className={styles.prompt}>
          <span className={styles.most}>Most likely to</span>
          <span className={styles.superlative}>{superlative}</span>
        </p>
      )}

      {/* RANKING */}
      {phase === 'ranking' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Ranking locked in ✅</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.rankBox}>
            <p className={styles.hint}>Order everyone from MOST likely (top) to least.</p>
            <ol className={styles.list}>
              {order.map((pid, idx) => (
                <li key={pid} className={styles.rankItem}>
                  <span className={styles.posNum}>{idx + 1}</span>
                  <span className={styles.who}>
                    <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  </span>
                  <span className={styles.arrows}>
                    <button
                      className={styles.arrowBtn}
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      aria-label="Move up"
                    >▲</button>
                    <button
                      className={styles.arrowBtn}
                      onClick={() => move(idx, 1)}
                      disabled={idx === order.length - 1}
                      aria-label="Move down"
                    >▼</button>
                  </span>
                </li>
              ))}
            </ol>
            <button className={styles.primaryBtn} onClick={submit} disabled={order.length !== playerCount}>
              Lock in ranking
            </button>
            <p className={styles.timer}>{secsLeft > 0 ? `${secsLeft}s left` : 'Time’s almost up…'}</p>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <p className={styles.consensusLabel}>The group’s verdict</p>
          <div className={styles.consensus}>
            {reveal.consensus.map((row) => (
              <div key={row.playerId} className={`${styles.consRow} ${row.rank === 1 ? styles.consTop : ''}`}>
                <span className={styles.consRank}>#{row.rank}</span>
                <span className={styles.consWho}>
                  <PlayerName playerId={row.playerId} nicknames={nicknames} avatars={avatars} />
                </span>
                <span className={styles.consPts}>+{row.roundPoints}</span>
              </div>
            ))}
          </div>

          <div className={styles.scoreboard}>
            <p className={styles.consensusLabel}>Running totals</p>
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
          {phase === 'finished' && <p className={styles.finishMsg}>Final consensus is in! 🏆</p>}
        </div>
      )}
    </div>
  );
}
