import { useEffect, useRef, useState } from 'react';
import styles from './BalloonBrinkmanship.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

export default function BalloonBrinkmanshipGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);
  const prevStatus = useRef('pumping');
  const prevAir = useRef(0);

  const phase = gameState?.phase;
  const myStatus = gameState?.myStatus;
  const myAir = gameState?.myAir || 0;

  // reset ack on entering a new roundEnd
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'inflating') { setIAcked(false); }
    prevPhase.current = phase;
  }, [phase]);

  // sound + shake feedback when MY balloon pops or I bank
  useEffect(() => {
    if (myStatus === prevStatus.current) return;
    if (myStatus === 'popped') { playSound('loseRound'); shake('medium'); }
    else if (myStatus === 'banked') { playSound('coin'); }
    prevStatus.current = myStatus;
  }, [myStatus, playSound, shake]);

  // tick sound on each pump
  useEffect(() => {
    if (myAir > prevAir.current && myStatus === 'pumping') playSound('click');
    prevAir.current = myAir;
  }, [myAir, myStatus, playSound]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Inflating…</p></div>;
  }

  const {
    round, totalRounds, myScore = 0, myPumpCount = 0,
    thresholdMin = 60, thresholdMax = 100,
    otherPlayers = [], reveal, scores = {}, acknowledged = [], myId,
  } = gameState;

  const locked = myStatus !== 'pumping';
  // Balloon visual scale: grow toward the upper threshold, never quite filling so
  // it always feels like "one more might pop". Pure cosmetic — server is truth.
  const fillPct = Math.min(100, (myAir / thresholdMax) * 100);
  const balloonScale = 0.5 + Math.min(1.15, myAir / thresholdMax) * 1.0;
  // nervous meter: how deep into the danger band (>=min) the air is
  const danger = myAir <= thresholdMin
    ? 0
    : Math.min(100, ((myAir - thresholdMin) / (thresholdMax - thresholdMin)) * 100);

  function pump() {
    if (locked || phase !== 'inflating') return;
    onAction({ type: 'pump' });
  }
  function bank() {
    if (locked || phase !== 'inflating') return;
    onAction({ type: 'bank' });
  }
  function ack() {
    if (iAcked) return;
    setIAcked(true);
    onAction({ type: 'acknowledge' });
    playSound('click');
  }

  const balloonClass = `${styles.balloon} ${myStatus === 'popped' ? styles.popped : ''} ${myStatus === 'banked' ? styles.banked : ''}`;
  const statusLabel = { pumping: 'PUMPING', banked: 'BANKED ✅', popped: 'POPPED 💥' }[myStatus] || '';

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>BALLOON BRINKMANSHIP</h1>
        <span className={styles.round}>Round {round} / {totalRounds}</span>
      </div>

      {phase === 'inflating' && (
        <div className={styles.playArea}>
          <div className={styles.balloonStage}>
            <div className={balloonClass} style={{ transform: `scale(${balloonScale})` }} aria-hidden>
              <span className={styles.airNum}>{myAir}</span>
            </div>
          </div>

          <div className={styles.nervousWrap}>
            <span className={styles.nervousLabel}>Nerve meter</span>
            <div className={styles.nervousTrack}>
              <div className={styles.nervousFill} style={{ width: `${Math.max(fillPct, danger)}%` }} />
              <div className={styles.dangerZone} />
            </div>
            <span className={styles.nervousHint}>
              {locked ? statusLabel : danger > 0 ? 'Getting risky…' : 'Safe… for now'}
            </span>
          </div>

          <div className={styles.controls}>
            <button className={styles.pumpBtn} onClick={pump} disabled={locked}>
              PUMP <span className={styles.pumpSub}>+air</span>
            </button>
            <button className={styles.bankBtn} onClick={bank} disabled={locked}>
              BANK <span className={styles.bankSub}>{myAir} air</span>
            </button>
          </div>

          <div className={styles.statusRow}>
            <span className={styles.scorePill}>Score: {myScore}</span>
            <span className={styles.pumpPill}>Pumps: {myPumpCount}</span>
            <span className={styles.statusPill}>{statusLabel}</span>
          </div>

          <div className={styles.others}>
            {otherPlayers.map((o) => (
              <div key={o.playerId} className={`${styles.otherChip} ${styles['st_' + o.status]}`}>
                <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} size={18} />
                <span className={styles.otherStatus}>
                  {o.status === 'pumping' ? '⏳' : o.status === 'banked' ? '✅' : '💥'}
                </span>
                <span className={styles.otherScore}>{o.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(phase === 'roundEnd' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          <h2 className={styles.revealTitle}>
            {phase === 'finished' ? 'Final Standings' : `Round ${reveal.round} — thresholds revealed`}
          </h2>
          <div className={styles.revealList}>
            {[...reveal.outcomes].sort((a, b) => b.score - a.score).map((o) => (
              <div key={o.playerId} className={`${styles.revealRow} ${styles['st_' + o.status]}`}>
                <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} size={20} />
                <span className={styles.revealStatus}>
                  {o.status === 'popped'
                    ? <>💥 POP at {o.air} (limit {o.threshold})</>
                    : <>✅ banked {o.banked} (limit {o.threshold})</>}
                </span>
                <span className={styles.revealScore}>{o.score}</span>
              </div>
            ))}
          </div>

          {phase === 'roundEnd' && (
            <div className={styles.ackBox}>
              {!iAcked
                ? <button className={styles.contBtn} onClick={ack}>Continue →</button>
                : <p className={styles.waitMsg}>Waiting for others… {acknowledged.length}</p>}
            </div>
          )}

          {phase === 'finished' && (
            <div className={styles.finalBoard}>
              {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc], i) => (
                <div key={pid} className={`${styles.finalRow} ${pid === myId ? styles.finalMine : ''}`}>
                  <span className={styles.finalPlace}>#{i + 1}</span>
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} size={20} />
                  <span className={styles.finalScore}>{sc}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
