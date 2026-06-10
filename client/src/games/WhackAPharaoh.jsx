import { useEffect, useRef, useState } from 'react';
import styles from './WhackAPharaoh.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

let _floatSeq = 0;

export default function WhackAPharaohGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const skewRef = useRef(0);
  const prevScore = useRef(0);
  const [secsLeft, setSecsLeft] = useState(null);
  const [floats, setFloats] = useState([]); // floating +100/-60 per cell

  const phase = gameState?.phase;
  const roundEndAt = gameState?.roundEndAt;
  const serverTime = gameState?.serverTime;
  const myScore = gameState?.myScore || 0;

  // estimate server-client clock skew from each broadcast
  useEffect(() => {
    if (serverTime) skewRef.current = serverTime - Date.now();
  }, [serverTime]);

  // smooth local countdown (server only re-broadcasts on spawns/whacks + the buzzer)
  useEffect(() => {
    if (phase !== 'active' || !roundEndAt) { setSecsLeft(null); return; }
    const tick = () => setSecsLeft(Math.max(0, Math.ceil((roundEndAt - (Date.now() + skewRef.current)) / 1000)));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [phase, roundEndAt]);

  // score-change feedback
  useEffect(() => {
    if (myScore > prevScore.current) { playSound('coinCollect'); }
    prevScore.current = myScore;
  }, [myScore, playSound]);

  function addFloat(cell, text, good) {
    const id = ++_floatSeq;
    setFloats((f) => [...f, { id, cell, text, good }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 850);
  }

  function whack(cell, occ) {
    if (phase !== 'active' || !occ || occ.whacked) return;
    onAction({ type: 'whack', cell });
    if (occ.kind === 'pharaoh') {
      addFloat(cell, `+${gameState.pharaohPoints ?? 100}`, true);
      shake('light');
    } else {
      addFloat(cell, `${gameState.mummyPoints ?? -60}`, false);
      shake('medium');
    }
  }

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Opening the tomb…</p></div>;

  const { cells = [], myHits = { pharaohs: 0, mummies: 0 }, scoreboard = [] } = gameState;

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>WHACK-A-PHARAOH</h1>

      <div className={styles.hud}>
        <div className={styles.hudItem}><span className={styles.hudLabel}>TIME</span><span className={styles.hudBig}>{secsLeft != null ? `${secsLeft}s` : '—'}</span></div>
        <div className={styles.hudItem}><span className={styles.hudLabel}>SCORE</span><span className={styles.hudBig}>{myScore}</span></div>
        <div className={styles.hudItem}><span className={styles.hudLabel}>🪙 / 💀</span><span className={styles.hudBig}>{myHits.pharaohs}/{myHits.mummies}</span></div>
      </div>

      {phase === 'active' && (
        <div className={styles.grid}>
          {Array.from({ length: 9 }).map((_, cell) => {
            const occ = cells[cell] || null;
            const float = floats.find((f) => f.cell === cell);
            return (
              <button
                key={cell}
                type="button"
                className={styles.cell}
                onPointerDown={(e) => { e.preventDefault(); whack(cell, occ); }}
                aria-label={`hole ${cell + 1}`}
              >
                <span className={styles.hole}>
                  {occ && (
                    <span
                      className={`${styles.pop} ${occ.kind === 'mummy' ? styles.mummy : styles.pharaoh} ${occ.whacked ? styles.bonked : ''}`}
                    >
                      {occ.kind === 'mummy' ? '🧟' : '𓂀'}
                    </span>
                  )}
                </span>
                {float && (
                  <span className={`${styles.float} ${float.good ? styles.floatGood : styles.floatBad}`}>{float.text}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {phase === 'waiting' && <div className={styles.center}><p className={styles.getReady}>Grab your mallet…</p></div>}

      {phase === 'finished' && (
        <div className={styles.center}>
          <p className={styles.timeUp}>TIME!</p>
          <p className={styles.finalStat}>{myScore} pts · {myHits.pharaohs} pharaohs whacked</p>
        </div>
      )}

      <div className={styles.legend}>
        <span><span className={styles.legGood}>𓂀</span> Pharaoh +{gameState.pharaohPoints ?? 100}</span>
        <span><span className={styles.legBad}>🧟</span> Mummy {gameState.mummyPoints ?? -60}</span>
      </div>

      <div className={styles.scoreboard}>
        {scoreboard.map((s, i) => (
          <div key={s.playerId} className={`${styles.sbRow} ${s.playerId === gameState.myId ? styles.sbMe : ''}`}>
            <span className={styles.sbRank}>{i + 1}</span>
            <span className={styles.sbName}><PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} /></span>
            <span className={styles.sbScore}>{s.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
