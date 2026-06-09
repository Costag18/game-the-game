import { useEffect, useRef, useState } from 'react';
import styles from './AimTrainer.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

export default function AimTrainer({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const skewRef = useRef(0);
  const prevHits = useRef(0);
  const [secsLeft, setSecsLeft] = useState(null);

  const phase = gameState?.phase;
  const roundEndAt = gameState?.roundEndAt;
  const serverTime = gameState?.serverTime;
  const myHits = gameState?.myHits || 0;

  // keep an estimate of server-client clock skew from each broadcast
  useEffect(() => {
    if (serverTime) skewRef.current = serverTime - Date.now();
  }, [serverTime]);

  // smooth local countdown (server only re-broadcasts on actions + the final buzzer)
  useEffect(() => {
    if (phase !== 'active' || !roundEndAt) { setSecsLeft(null); return; }
    const tick = () => setSecsLeft(Math.max(0, Math.ceil((roundEndAt - (Date.now() + skewRef.current)) / 1000)));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [phase, roundEndAt]);

  // hit feedback
  useEffect(() => {
    if (myHits > prevHits.current) { playSound('coinCollect'); }
    prevHits.current = myHits;
  }, [myHits, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Calibrating…</p></div>;

  const { target, myClicks = 0, myAccuracy = 0, scoreboard = [] } = gameState;
  const accPct = Math.round(myAccuracy * 100);

  function shootTarget(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!target) return;
    onAction({ type: 'shoot', targetId: target.id, clientHitTime: Date.now() });
    shake('light');
  }
  function missField() {
    if (phase === 'active') onAction({ type: 'miss' });
  }

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>AIM TRAINER</h1>

      <div className={styles.hud}>
        <div className={styles.hudItem}><span className={styles.hudLabel}>TIME</span><span className={styles.hudBig}>{secsLeft != null ? `${secsLeft}s` : '—'}</span></div>
        <div className={styles.hudItem}><span className={styles.hudLabel}>HITS</span><span className={styles.hudBig}>{myHits}</span></div>
        <div className={styles.hudItem}><span className={styles.hudLabel}>ACC</span><span className={styles.hudBig}>{accPct}%</span></div>
      </div>

      {phase === 'active' && (
        <div className={styles.playfield} onPointerDown={missField}>
          {target && (
            <button
              type="button"
              className={styles.target}
              style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%`, width: `${target.r * 200}%` }}
              onPointerDown={shootTarget}
              aria-label="target"
            />
          )}
        </div>
      )}

      {phase === 'waiting' && <div className={styles.center}><p className={styles.getReady}>Get ready…</p></div>}

      {phase === 'finished' && (
        <div className={styles.center}>
          <p className={styles.timeUp}>TIME!</p>
          <p className={styles.finalStat}>{myHits} hits · {accPct}% accuracy</p>
        </div>
      )}

      <div className={styles.scoreboard}>
        {scoreboard.map((s, i) => (
          <div key={s.playerId} className={styles.sbRow}>
            <span className={styles.sbRank}>{i + 1}</span>
            <span className={styles.sbName}><PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} /></span>
            <span className={styles.sbHits}>{s.hits}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
