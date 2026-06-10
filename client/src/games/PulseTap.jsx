import { useEffect, useRef, useState } from 'react';
import styles from './PulseTap.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

// How far ahead (ms) a beat is visible sweeping toward the hit line.
const LOOKAHEAD_MS = 1800;
const HIT_ZONE = 0.5; // hit line at 50% of the track (left -> right sweep)

export default function PulseTapGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [iAcked, setIAcked] = useState(false);
  const [flash, setFlash] = useState(null); // {grade, points, combo, key}
  const [, forceTick] = useState(0);
  const prevPhase = useRef(null);
  const lastJudgeKey = useRef(null);
  const rafRef = useRef(0);
  // server-time offset: serverTime - localTime, so we can place beats on a local clock
  const clockOffset = useRef(0);

  const phase = gameState?.phase;

  // keep a local animation clock ticking during play
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'countdown') return undefined;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      forceTick((t) => (t + 1) % 1000000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(rafRef.current); };
  }, [phase]);

  // sync the server-time offset whenever a fresh state arrives
  useEffect(() => {
    if (gameState?.serverTime != null) {
      clockOffset.current = gameState.serverTime - Date.now();
    }
  }, [gameState?.serverTime]);

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'countdown') { setFlash(null); }
    if (phase === 'summary') { setIAcked(false); playSound?.('winRound'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // react to a new server judgement (Perfect/Good/Miss flash + sound + shake)
  useEffect(() => {
    const j = gameState?.lastJudgement;
    if (!j) return;
    const key = `${gameState.round}:${j.beatIndex}:${j.grade}:${j.offset}`;
    if (key === lastJudgeKey.current) return;
    lastJudgeKey.current = key;
    setFlash({ ...j, key });
    if (j.grade === 'perfect') { playSound?.('coinCollect'); shake('light'); }
    else if (j.grade === 'good') { playSound?.('cardFlip'); }
    else { playSound?.('wrong'); }
    const id = setTimeout(() => setFlash((f) => (f && f.key === key ? null : f)), 520);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.lastJudgement]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Feeling the beat…</p></div>;
  }

  const {
    round, totalRounds, beats = [], myScore = 0, myCombo = 0, myMaxCombo = 0,
    myRoundScore = 0, scoreboard = [], countdownMs = 0, myId, acknowledged = [],
  } = gameState;

  const nowServer = Date.now() + clockOffset.current;

  function tap() {
    if (phase !== 'playing') return;
    onAction({ type: 'tap' });
    playSound?.('click');
  }
  function ack() {
    if (iAcked) return;
    setIAcked(true);
    onAction({ type: 'acknowledge' });
    playSound?.('click');
  }

  // Position visible beats on the track. A beat at server-time `atMs` maps to a
  // horizontal position: it crosses the hit line exactly when nowServer === atMs.
  const visibleBeats = beats
    .map((b) => {
      const delta = b.atMs - nowServer; // ms until it should be hit (negative = passed)
      // pos: 0 at left entry (delta = LOOKAHEAD_MS) -> HIT_ZONE at the line (delta = 0)
      const pos = HIT_ZONE - (delta / LOOKAHEAD_MS) * HIT_ZONE;
      return { ...b, delta, pos };
    })
    .filter((b) => b.pos >= -0.05 && b.pos <= 1.05 && !b.consumed);

  const countdownSec = Math.ceil(countdownMs / 1000);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>PULSE TAP</h1>
        <span className={styles.round}>Round {round} / {totalRounds}</span>
      </div>

      {(phase === 'countdown' || phase === 'playing') && (
        <>
          <div className={styles.hud}>
            <div className={styles.hudCell}>
              <span className={styles.hudLabel}>Score</span>
              <span className={styles.hudVal}>{myScore}</span>
            </div>
            <div className={`${styles.hudCell} ${myCombo >= 2 ? styles.comboHot : ''}`}>
              <span className={styles.hudLabel}>Combo</span>
              <span className={styles.hudVal}>{myCombo > 0 ? `x${myCombo}` : '—'}</span>
            </div>
            <div className={styles.hudCell}>
              <span className={styles.hudLabel}>Best</span>
              <span className={styles.hudVal}>x{myMaxCombo}</span>
            </div>
          </div>

          <div className={styles.track}>
            <div className={styles.hitLine} style={{ left: `${HIT_ZONE * 100}%` }} />
            <div className={styles.hitGlow} style={{ left: `${HIT_ZONE * 100}%` }} />
            {visibleBeats.map((b) => {
              const close = Math.abs(b.delta) <= 280;
              return (
                <div
                  key={b.index}
                  className={`${styles.beat} ${close ? styles.beatClose : ''}`}
                  style={{ left: `${b.pos * 100}%` }}
                />
              );
            })}
            {phase === 'countdown' && (
              <div className={styles.countdown}>{countdownSec > 0 ? countdownSec : 'GO!'}</div>
            )}
            {flash && (
              <div className={`${styles.flash} ${styles['flash_' + flash.grade]}`} key={flash.key}>
                <span className={styles.flashGrade}>{flash.grade.toUpperCase()}</span>
                {flash.points > 0 && (
                  <span className={styles.flashPts}>+{flash.points}{flash.combo > 1 ? ` ·x${flash.combo}` : ''}</span>
                )}
              </div>
            )}
          </div>

          <button
            className={styles.tapZone}
            onPointerDown={(e) => { e.preventDefault(); tap(); }}
            disabled={phase !== 'playing'}
          >
            {phase === 'playing' ? 'TAP' : 'GET READY'}
          </button>
        </>
      )}

      {phase === 'summary' && (
        <div className={styles.summary}>
          <h2 className={styles.summaryTitle}>Round {round} done</h2>
          <p className={styles.summarySub}>You scored {myRoundScore} this round</p>
          <div className={styles.board}>
            {scoreboard.map((row, i) => (
              <div key={row.playerId} className={`${styles.boardRow} ${row.playerId === myId ? styles.boardMe : ''}`}>
                <span className={styles.boardRank}>{i + 1}</span>
                <PlayerName playerId={row.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.boardScore}>
                  {row.score}
                  {row.roundScore != null && <span className={styles.boardDelta}> (+{row.roundScore})</span>}
                </span>
              </div>
            ))}
          </div>
          {!iAcked
            ? <button className={styles.primaryBtn} onClick={ack}>Continue →</button>
            : <p className={styles.waitMsg}>Waiting… {acknowledged.length}/{scoreboard.length}</p>}
        </div>
      )}

      {phase === 'finished' && (
        <div className={styles.summary}>
          <h2 className={styles.summaryTitle}>Final Beat</h2>
          <div className={styles.board}>
            {scoreboard.map((row, i) => (
              <div key={row.playerId} className={`${styles.boardRow} ${row.playerId === myId ? styles.boardMe : ''}`}>
                <span className={styles.boardRank}>{i + 1}</span>
                <PlayerName playerId={row.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.boardScore}>{row.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(phase === 'countdown' || phase === 'playing') && (
        <div className={styles.miniBoard}>
          {scoreboard.map((row, i) => (
            <span key={row.playerId} className={`${styles.miniCard} ${row.playerId === myId ? styles.miniMe : ''}`}>
              <span className={styles.miniRank}>{i + 1}</span>
              <PlayerName playerId={row.playerId} nicknames={nicknames} avatars={avatars} size={16} />
              <span className={styles.miniScore}>{row.score}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
