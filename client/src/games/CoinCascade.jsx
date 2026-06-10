import { useEffect, useRef, useState } from 'react';
import styles from './CoinCascade.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const LANES = 5;
const KIND_EMOJI = { coin: '🪙', gem: '💎', bomb: '💣' };

export default function CoinCascadeGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [localLane, setLocalLane] = useState(2);
  const [pops, setPops] = useState([]);     // floating +/- value pops
  const lastCatchId = useRef(null);
  const popSeq = useRef(0);

  const phase = gameState?.phase;
  const serverLane = gameState?.myLane;
  const myLastCatch = gameState?.myLastCatch;

  // Reconcile local basket with server lane (server is authoritative).
  useEffect(() => {
    if (typeof serverLane === 'number') setLocalLane(serverLane);
  }, [serverLane]);

  // Spawn a floating pop + feedback when the SERVER reports a new resolved catch.
  useEffect(() => {
    if (!myLastCatch || myLastCatch.id === lastCatchId.current) return;
    lastCatchId.current = myLastCatch.id;
    const id = popSeq.current++;
    const { value, kind, lane } = myLastCatch;
    setPops((p) => [...p, { id, value, kind, lane }]);
    if (kind === 'bomb') { playSound('wrong'); shake('medium'); }
    else if (kind === 'gem') { playSound('coin'); shake('light'); }
    else { playSound('coin'); }
  }, [myLastCatch, playSound, shake]);

  function removePop(id) { setPops((p) => p.filter((x) => x.id !== id)); }

  function moveTo(lane) {
    const clamped = Math.max(0, Math.min(LANES - 1, lane));
    if (clamped === localLane) return;
    setLocalLane(clamped);
    onAction({ type: 'move', lane: clamped });
    playSound('click');
  }

  // Keyboard: arrow keys slide the basket (desktop nicety).
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowLeft') moveTo(localLane - 1);
      else if (e.key === 'ArrowRight') moveTo(localLane + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localLane]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Stacking coins…</p></div>;
  }

  const {
    objects = [], scoreboard = [], myScore = 0, myId, timeLeftMs,
  } = gameState;

  const secsLeft = timeLeftMs != null ? Math.ceil(timeLeftMs / 1000) : null;
  const lanes = Array.from({ length: LANES }, (_, i) => i);

  return (
    <div className={styles.arena}>
      <div className={styles.header}>
        <h1 className={styles.title}>Coin Cascade</h1>
        <div className={styles.statusRow}>
          <span className={styles.scorePill}>🪙 {myScore}</span>
          {phase === 'active' && secsLeft != null && (
            <span className={styles.timerPill}>{secsLeft}s</span>
          )}
          {phase === 'finished' && <span className={styles.finBadge}>Cascade over!</span>}
        </div>
      </div>

      <div className={styles.field}>
        {/* Falling objects */}
        {phase === 'active' && objects.map((o) => (
          <div
            key={o.id}
            className={`${styles.fallObj} ${styles[o.kind] || ''}`}
            style={{
              left: `${(o.lane + 0.5) * (100 / LANES)}%`,
              top: `${o.progress * 86}%`, // 86% so it lands at the catch line
            }}
          >
            <span className={styles.objEmoji}>{KIND_EMOJI[o.kind] || '❓'}</span>
          </div>
        ))}

        {/* Lane tap zones */}
        <div className={styles.lanes}>
          {lanes.map((lane) => (
            <button
              key={lane}
              type="button"
              className={`${styles.laneZone} ${lane === localLane ? styles.laneActive : ''}`}
              onPointerDown={() => moveTo(lane)}
              aria-label={`Move basket to lane ${lane + 1}`}
            />
          ))}
        </div>

        {/* The basket */}
        {phase !== 'finished' && (
          <div
            className={styles.basket}
            style={{ left: `${(localLane + 0.5) * (100 / LANES)}%` }}
          >
            <span className={styles.basketEmoji}>🧺</span>
          </div>
        )}

        {/* Catch line */}
        <div className={styles.catchLine} />

        {/* Floating +/- value pops at the basket lane */}
        {pops.map((p) => (
          <div
            key={p.id}
            className={`${styles.pop} ${p.value < 0 ? styles.popBad : styles.popGood}`}
            style={{ left: `${(p.lane + 0.5) * (100 / LANES)}%` }}
            onAnimationEnd={() => removePop(p.id)}
          >
            {p.value > 0 ? `+${p.value}` : p.value}
          </div>
        ))}
      </div>

      {/* Move controls (big touch targets for mobile) */}
      {phase === 'active' && (
        <div className={styles.controls}>
          <button type="button" className={styles.moveBtn} onPointerDown={() => moveTo(localLane - 1)} aria-label="Move left">◀</button>
          <span className={styles.controlHint}>Catch coins &amp; gems · dodge bombs</span>
          <button type="button" className={styles.moveBtn} onPointerDown={() => moveTo(localLane + 1)} aria-label="Move right">▶</button>
        </div>
      )}

      {/* Scoreboard */}
      <div className={styles.scoreboard}>
        {scoreboard.map((s, i) => (
          <div key={s.playerId} className={`${styles.scoreRow} ${s.playerId === myId ? styles.scoreMine : ''}`}>
            <span className={styles.scoreRank}>{i + 1}</span>
            <span className={styles.scoreName}>
              <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
            </span>
            <span className={styles.scoreVal}>{s.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
