import { useEffect, useRef, useState } from 'react';
import styles from './BullseyeDrop.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

// Ring colors outward (must mirror server RINGS order conceptually).
const RING_COLORS = ['#e23b3b', '#f0a02a', '#f4e04d', '#5bd16a', '#3a9bdc'];

export default function BullseyeDropGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const skewRef = useRef(0);
  const rafRef = useRef(0);
  const reticleElRef = useRef(null);
  const prevThrows = useRef(0);
  const [pops, setPops] = useState([]); // {id, points, label}

  const phase = gameState?.phase;
  const serverTime = gameState?.serverTime;
  const reticle = gameState?.reticle;
  const maxR = gameState?.maxR || 100;
  const myThrows = gameState?.myThrows || [];

  // estimate server/client clock skew from each broadcast
  useEffect(() => {
    if (serverTime) skewRef.current = serverTime - Date.now();
  }, [serverTime]);

  // local animation of the reticle (server is authoritative for SCORE; this is feel only)
  useEffect(() => {
    if (phase !== 'throwing' || !reticle) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const { cycleStart, period } = reticle;
    const loop = () => {
      const nowServer = Date.now() + skewRef.current;
      const elapsed = (((nowServer - cycleStart) % period) + period) % period;
      const half = period / 2;
      const frac = elapsed < half ? elapsed / half : 1 - (elapsed - half) / half; // 0..1..0
      const el = reticleElRef.current;
      if (el) {
        const pct = frac * 100; // % of board half-size
        el.style.width = `${pct}%`;
        el.style.height = `${pct}%`;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase, reticle?.cycleStart, reticle?.period]);

  // score-pop feedback when a new throw resolves
  useEffect(() => {
    if (myThrows.length > prevThrows.current) {
      const t = myThrows[myThrows.length - 1];
      const id = `${Date.now()}-${myThrows.length}`;
      setPops((p) => [...p, { id, points: t.points, label: t.label }]);
      if (t.label === 'BULLSEYE') { playSound('win'); shake('medium'); }
      else if (t.missed) { playSound('wrong'); }
      else { playSound('coinCollect'); shake('light'); }
      setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 900);
    }
    prevThrows.current = myThrows.length;
  }, [myThrows.length, playSound, shake]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Stepping up to the line…</p></div>;

  const { myDartsLeft = 0, myScore = 0, dartsPerPlayer = 5, scoreboard = [], rings = [] } = gameState;

  function release() {
    if (phase !== 'throwing' || myDartsLeft <= 0) return;
    onAction({ type: 'release' });
  }

  // build static ring backdrop from the server's ring table (outer -> inner so inner paints on top)
  const ringBands = [...rings]
    .map((r, i) => ({ ...r, color: RING_COLORS[i] || '#3a9bdc' }))
    .sort((a, b) => b.maxFrac - a.maxFrac);

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>BULLSEYE DROP</h1>

      <div className={styles.hud}>
        <div className={styles.hudItem}><span className={styles.hudLabel}>DARTS</span><span className={styles.hudBig}>{myDartsLeft}/{dartsPerPlayer}</span></div>
        <div className={styles.hudItem}><span className={styles.hudLabel}>SCORE</span><span className={styles.hudBig}>{myScore}</span></div>
      </div>

      <div className={styles.boardWrap}>
        <div className={styles.board}>
          {ringBands.map((r) => (
            <div
              key={r.label}
              className={styles.ring}
              style={{
                width: `${r.maxFrac * 100}%`,
                height: `${r.maxFrac * 100}%`,
                background: r.color,
                zIndex: Math.round((1 - r.maxFrac) * 10),
              }}
            >
              <span className={styles.ringPoints} style={{ zIndex: 20 }}>{r.points}</span>
            </div>
          ))}

          {phase === 'throwing' && (
            <div ref={reticleElRef} className={styles.reticle} />
          )}

          {pops.map((p) => (
            <div key={p.id} className={`${styles.pop} ${p.label === 'BULLSEYE' ? styles.popBull : ''}`}>
              {p.label === 'MISS' ? 'MISS' : `+${p.points}`}
              {p.label === 'BULLSEYE' && <span className={styles.popLabel}>BULLSEYE!</span>}
            </div>
          ))}
        </div>
      </div>

      {phase === 'throwing' && (
        <button
          type="button"
          className={styles.releaseBtn}
          onPointerDown={release}
          disabled={myDartsLeft <= 0}
        >
          {myDartsLeft > 0 ? 'RELEASE 🎯' : 'WAITING…'}
        </button>
      )}
      {phase === 'throwing' && myDartsLeft <= 0 && (
        <p className={styles.waitNote}>Out of darts — waiting for the others to finish ⏳</p>
      )}

      {phase === 'finished' && (
        <div className={styles.finishCard}>
          <p className={styles.finishTitle}>DARTS DOWN</p>
          <p className={styles.finishStat}>{myScore} points</p>
        </div>
      )}

      <div className={styles.scoreboard}>
        {scoreboard.map((s, i) => (
          <div key={s.playerId} className={`${styles.sbRow} ${s.playerId === gameState.myId ? styles.sbMe : ''}`}>
            <span className={styles.sbRank}>{i + 1}</span>
            <span className={styles.sbName}><PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} /></span>
            <span className={styles.sbDarts}>{s.dartsLeft > 0 ? `${s.dartsLeft}🎯` : '—'}</span>
            <span className={styles.sbScore}>{s.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
