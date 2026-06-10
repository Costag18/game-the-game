import { useEffect, useRef, useState } from 'react';
import styles from './FlashFlood.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function FlashFloodGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [picked, setPicked] = useState(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [iAcked, setIAcked] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const prevPhase = useRef(null);
  const pingRef = useRef(null);

  const phase = gameState?.phase;
  const gridSize = gameState?.gridSize || 3;
  const cellCount = gameState?.cellCount || gridSize * gridSize;

  // reset transient state on phase change
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'show') { setPicked(new Set()); setSubmitted(false); playSound?.('cardFlip'); }
    if (phase === 'recall') { setPicked(new Set()); setSubmitted(false); }
    if (phase === 'roundEnd') { setIAcked(false); playSound?.('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // live countdown to the server deadline for the active phase
  useEffect(() => {
    const deadline = phase === 'show' ? gameState?.showEndMs
      : phase === 'recall' ? gameState?.recallEndMs : null;
    if (!deadline) { setCountdown(0); return; }
    const tick = () => setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, gameState?.showEndMs, gameState?.recallEndMs]);

  // if our local deadline passes and the server hasn't transitioned, ping it
  useEffect(() => {
    const deadline = phase === 'show' ? gameState?.showEndMs
      : phase === 'recall' ? gameState?.recallEndMs : null;
    if (!deadline) return;
    if (pingRef.current) clearTimeout(pingRef.current);
    const ms = deadline - Date.now() + 400;
    pingRef.current = setTimeout(() => onAction({ type: 'ping' }), Math.max(0, ms));
    return () => { if (pingRef.current) clearTimeout(pingRef.current); };
  }, [phase, gameState?.showEndMs, gameState?.recallEndMs, onAction]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Watching the waters rise…</p></div>;
  }

  const {
    round, maxRounds, litCount, pattern, myAlive, myBanked, mySubmitted,
    mySubmission, myCorrectThisRound, opponents = [], aliveCount,
    acknowledged = [], myId, results,
  } = gameState;

  const litSet = new Set(pattern || []);
  const submissionSet = new Set(mySubmission || []);

  function toggleCell(i) {
    if (phase !== 'recall' || !myAlive || mySubmitted || submitted) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
    playSound?.('chipPlace');
  }

  function submitRecall() {
    if (phase !== 'recall' || !myAlive || mySubmitted || submitted) return;
    setSubmitted(true);
    onAction({ type: 'recall', cells: [...picked] });
    playSound?.('click');
  }

  function ack() {
    if (iAcked) return;
    setIAcked(true);
    onAction({ type: 'acknowledge' });
  }

  // build cell classes per phase
  function cellClass(i) {
    const cls = [styles.cell];
    if (phase === 'show') {
      if (litSet.has(i)) cls.push(styles.lit);
    } else if (phase === 'recall') {
      if (picked.has(i)) cls.push(styles.picked);
    } else if (phase === 'roundEnd' || phase === 'finished') {
      const wasLit = litSet.has(i);
      const tapped = submissionSet.has(i);
      if (wasLit && tapped) cls.push(styles.hit);          // correctly remembered
      else if (wasLit && !tapped) cls.push(styles.missed); // forgot a lit cell
      else if (!wasLit && tapped) cls.push(styles.wrong);  // tapped an empty cell
    }
    return cls.join(' ');
  }

  const cells = Array.from({ length: cellCount }, (_, i) => i);
  const tappable = phase === 'recall' && myAlive && !mySubmitted && !submitted;

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>FLASH FLOOD</h1>
        <span className={styles.round}>Round {round}{maxRounds ? ` / ${maxRounds}` : ''}</span>
      </div>

      <div className={styles.statusBar}>
        <span className={styles.stat}>Depth banked: <b>{myBanked}</b></span>
        <span className={styles.stat}>{gridSize}×{gridSize} · {litCount} lit</span>
        <span className={styles.stat}>{aliveCount} afloat</span>
      </div>

      {/* phase banner */}
      {phase === 'show' && (
        <p className={styles.banner}>MEMORIZE the pattern! {countdown > 0 ? `${countdown}s` : ''}</p>
      )}
      {phase === 'recall' && myAlive && !mySubmitted && !submitted && (
        <p className={styles.bannerRecall}>RECALL — tap every lit cell. {countdown > 0 ? `${countdown}s` : ''}</p>
      )}
      {phase === 'recall' && (mySubmitted || submitted) && (
        <p className={styles.banner}>Locked in 🔒 — waiting for the others…</p>
      )}
      {phase === 'recall' && !myAlive && (
        <p className={styles.bannerOut}>You went under in round {gameState.myEliminatedRound}. Watching…</p>
      )}

      {/* the grid */}
      {phase !== 'finished' && (
        <div
          className={`${styles.grid} ${phase === 'show' ? styles.gridShow : ''}`}
          style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}
        >
          {cells.map((i) => (
            <button
              key={i}
              className={cellClass(i)}
              onClick={() => toggleCell(i)}
              disabled={!tappable}
              aria-label={`cell ${i}`}
            />
          ))}
        </div>
      )}

      {phase === 'recall' && tappable && (
        <button className={styles.primaryBtn} onClick={submitRecall} disabled={picked.size === 0}>
          Lock in ({picked.size})
        </button>
      )}

      {/* roundEnd recap */}
      {phase === 'roundEnd' && (
        <div className={styles.recap}>
          <p className={myCorrectThisRound ? styles.recapGood : styles.recapBad}>
            {!myAlive && myCorrectThisRound === false
              ? 'Wrong recall — eliminated.'
              : myCorrectThisRound
                ? 'Perfect recall! You bank this round.'
                : 'Watching from the sidelines.'}
          </p>
          {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
          <AckStatus
            players={Object.keys({ ...Object.fromEntries(opponents.map((o) => [o.playerId, 1])), [myId]: 1 })}
            acknowledged={acknowledged}
            me={myId}
            iActed={iAcked}
            nicknames={nicknames}
            avatars={avatars}
          />
        </div>
      )}

      {/* opponents tracker */}
      {phase !== 'finished' && opponents.length > 0 && (
        <div className={styles.players}>
          {opponents.map((o) => (
            <div key={o.playerId} className={`${styles.playerChip} ${o.alive ? '' : styles.chipOut}`}>
              <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.chipMeta}>
                {o.alive
                  ? (phase === 'recall' && o.submitted ? '🔒' : `${o.banked}`)
                  : '💧'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* finished standings */}
      {phase === 'finished' && results && (
        <div className={styles.standings}>
          <h2 className={styles.standTitle}>Final Depths</h2>
          {results.map((r) => (
            <div key={r.playerId} className={`${styles.standRow} ${r.placement === 1 ? styles.standWin : ''}`}>
              <span className={styles.place}>{r.placement}</span>
              <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.standMeta}>{r.banked} banked</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
