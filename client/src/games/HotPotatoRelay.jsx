import { useEffect, useRef } from 'react';
import styles from './HotPotatoRelay.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

export default function HotPotatoRelayGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const prevHolder = useRef(null);
  const prevPhase = useRef(null);
  const prevBlast = useRef(null);

  const phase = gameState?.phase;
  const holder = gameState?.holder;
  const iHoldIt = gameState?.iHoldIt;
  const lastBlast = gameState?.lastBlast;

  // Tick sound when the bomb changes hands.
  useEffect(() => {
    if (holder && holder !== prevHolder.current && phase === 'live') {
      playSound('click');
    }
    prevHolder.current = holder;
  }, [holder, phase, playSound]);

  // Blast feedback.
  useEffect(() => {
    const id = lastBlast?.eliminated || null;
    if (id && id !== prevBlast.current) {
      shake('medium');
      playSound('loseRound');
    }
    prevBlast.current = id;
  }, [lastBlast, shake, playSound]);

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'gameOver') playSound('winRound');
      prevPhase.current = phase;
    }
  }, [phase, playSound]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Lighting the fuse…</p></div>;
  }

  const {
    myId, iAmSurvivor, survivorCount, totalPlayers,
    seats = [], winner, acknowledged = [],
  } = gameState;

  function pass() {
    if (!iHoldIt || phase !== 'live') return;
    onAction({ type: 'pass' });
    playSound('cardFlip');
  }
  function ack() { onAction({ type: 'acknowledge' }); }

  const iAcked = acknowledged.includes(myId);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>HOT POTATO</h1>
        <span className={styles.survivors}>{survivorCount}/{totalPlayers} left</span>
      </div>

      {/* The bomb */}
      {phase === 'live' && (
        <div className={styles.stage}>
          <div className={`${styles.bomb} ${iHoldIt ? styles.bombMine : ''}`}>
            <span className={styles.bombEmoji} role="img" aria-label="bomb">💣</span>
            <span className={styles.spark} aria-hidden="true">✨</span>
          </div>
          <p className={styles.holderLine}>
            {iHoldIt ? (
              <span className={styles.holderMe}>YOU have the bomb!</span>
            ) : (
              <>Holding it: <PlayerName playerId={holder} nicknames={nicknames} avatars={avatars} /></>
            )}
          </p>

          {iAmSurvivor ? (
            iHoldIt ? (
              <button className={styles.passBtn} onClick={pass} aria-label="Pass the bomb">
                PASS IT! 🥵
              </button>
            ) : (
              <p className={styles.waitMsg}>Don't get caught holding it…</p>
            )
          ) : (
            <p className={styles.outMsg}>💥 You're out — watch who pops next.</p>
          )}

          {lastBlast?.eliminated && (
            <p className={styles.blastLine}>
              💥 <PlayerName playerId={lastBlast.eliminated} nicknames={nicknames} avatars={avatars} /> blew up!
            </p>
          )}
        </div>
      )}

      {/* Game over */}
      {(phase === 'gameOver' || phase === 'finished') && (
        <div className={styles.stage}>
          <div className={styles.winnerCard}>
            <span className={styles.trophy} role="img" aria-label="trophy">🏆</span>
            {winner ? (
              <p className={styles.winnerName}>
                <PlayerName playerId={winner} nicknames={nicknames} avatars={avatars} /> survived!
              </p>
            ) : (
              <p className={styles.winnerName}>Game over</p>
            )}
          </div>
          {phase === 'gameOver' && iAmSurvivor && !iAcked && (
            <button className={styles.passBtn} onClick={ack}>Continue →</button>
          )}
          {phase === 'gameOver' && iAcked && <p className={styles.waitMsg}>Waiting for results…</p>}
        </div>
      )}

      {/* Seat ring scoreboard */}
      <div className={styles.ring}>
        {seats.map((s) => (
          <div
            key={s.playerId}
            className={`${styles.seat} ${!s.isSurvivor ? styles.seatOut : ''} ${s.holdsIt ? styles.seatHot : ''} ${s.isMe ? styles.seatMe : ''}`}
          >
            <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
            {s.holdsIt && <span className={styles.seatBomb} aria-label="has bomb">💣</span>}
            {!s.isSurvivor && <span className={styles.seatDead} aria-label="eliminated">💀</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
