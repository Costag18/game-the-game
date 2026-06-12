import { useEffect, useRef, useState } from 'react';
import styles from './TokenTussle.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const FRONTS = 5;

function Countdown({ deadline }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  return <span className={styles.timer}>{left}s</span>;
}

export default function TokenTussleGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [alloc, setAlloc] = useState(() => new Array(FRONTS).fill(0));
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);
  const allocRef = useRef(alloc);
  const autoSubmitted = useRef(false);
  allocRef.current = alloc; // keep the latest allocation reachable from the countdown closure

  const phase = gameState?.phase;
  const hasSubmitted = gameState?.hasSubmitted;
  const deadline = gameState?.deadline;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'deploy') { setAlloc(new Array(FRONTS).fill(0)); autoSubmitted.current = false; }
    if (phase === 'reveal') { setIAcked(false); playSound('coinCollect'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // auto-deploy the player's CURRENT allocation ~1s before the deadline so their
  // chosen split is committed (never discarded for the server's even-split default).
  useEffect(() => {
    if (phase !== 'deploy' || !deadline) return undefined;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (rem <= 1 && !autoSubmitted.current && !hasSubmitted) {
        autoSubmitted.current = true;
        onAction({ type: 'deploy', tokens: allocRef.current });
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, deadline, hasSubmitted, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Mustering forces…</p></div>;

  const {
    roundNumber, totalRounds, fronts = [], scores = {}, myId, tokensPerRound = 20,
    submittedCount, playerCount, reveal, acknowledged = [],
  } = gameState;

  const used = alloc.reduce((a, b) => a + b, 0);
  const remaining = tokensPerRound - used;
  const allPlayers = Object.keys(scores);

  function bump(i, delta) {
    setAlloc((prev) => {
      const next = [...prev];
      const v = next[i] + delta;
      if (v < 0) return prev;
      if (delta > 0 && remaining <= 0) return prev;
      next[i] = v;
      return next;
    });
    playSound('click');
  }
  function clearAll() { setAlloc(new Array(FRONTS).fill(0)); playSound('click'); }
  function deploy() {
    if (hasSubmitted) return;
    onAction({ type: 'deploy', tokens: alloc });
    playSound('coinCollect');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const winnerSet = (f) => new Set((reveal?.fronts?.[f]?.winners) || []);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>TOKEN TUSSLE</h1>
        <span className={styles.round}>
          Round {roundNumber} / {totalRounds}
          {deadline && <> · <Countdown deadline={deadline} /></>}
        </span>
      </div>

      {/* DEPLOY */}
      {phase === 'deploy' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Forces committed 🪖</p>
            <p className={styles.sub}>Waiting for commanders… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.deployBox}>
            <p className={styles.instructions}>
              Deploy your <strong>{tokensPerRound}</strong> tokens across the 5 fronts.
              Win a front by committing the most — ties split the prize.
            </p>
            <div className={styles.bankRow}>
              <span className={styles.bankLabel}>Tokens left</span>
              <span className={`${styles.bankCount} ${remaining === 0 ? styles.bankZero : ''}`}>{remaining}</span>
            </div>
            <div className={styles.fronts}>
              {fronts.map((f) => (
                <div key={f.front} className={styles.front}>
                  <div className={styles.frontHead}>
                    <span className={styles.frontName}>Front {f.front + 1}</span>
                    <span className={styles.prize}>{f.prize} pts</span>
                  </div>
                  <div className={styles.allocCtrls}>
                    <button
                      className={styles.stepBtn}
                      onClick={() => bump(f.front, -1)}
                      disabled={alloc[f.front] <= 0}
                      aria-label={`Remove token from front ${f.front + 1}`}
                    >–</button>
                    <span className={styles.allocVal}>{alloc[f.front]}</span>
                    <button
                      className={styles.stepBtn}
                      onClick={() => bump(f.front, 1)}
                      disabled={remaining <= 0}
                      aria-label={`Add token to front ${f.front + 1}`}
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.actions}>
              <button className={styles.ghostBtn} onClick={clearAll} disabled={used === 0}>Clear</button>
              <button className={styles.primaryBtn} onClick={deploy}>Deploy ({used})</button>
            </div>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <div className={styles.battleGrid}>
            <div className={`${styles.gridRow} ${styles.gridHead}`}>
              <span className={styles.cmdCol}>Front →</span>
              {fronts.map((f) => (
                <span key={f.front} className={styles.frontCol}>
                  <span className={styles.frontColName}>F{f.front + 1}</span>
                  <span className={styles.frontColPrize}>{f.prize}</span>
                </span>
              ))}
            </div>
            {(reveal.allocations || []).map((row) => (
              <div key={row.playerId} className={styles.gridRow}>
                <span className={styles.cmdCol}>
                  <PlayerName playerId={row.playerId} nicknames={nicknames} avatars={avatars} />
                </span>
                {row.tokens.map((t, f) => (
                  <span
                    key={f}
                    className={`${styles.cell} ${winnerSet(f).has(row.playerId) ? styles.cellWin : ''}`}
                  >
                    {t}{winnerSet(f).has(row.playerId) && <span className={styles.crown}>♛</span>}
                  </span>
                ))}
              </div>
            ))}
          </div>

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>
                  {sc}{reveal.gained?.[pid] ? ` (+${reveal.gained[pid]})` : ''}
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
