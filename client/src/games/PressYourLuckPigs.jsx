import { useEffect, useRef, useState } from 'react';
import styles from './PressYourLuckPigs.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

export default function PressYourLuckPigs({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [iAcked, setIAcked] = useState(false);
  const prevBust = useRef(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  useEffect(() => { if (phase !== prevPhase.current) { if (phase === 'gameOver') setIAcked(false); prevPhase.current = phase; } }, [phase]);
  useEffect(() => {
    if (gameState?.busted && !prevBust.current) { playSound('loseRound'); shake('medium'); }
    prevBust.current = gameState?.busted;
  }, [gameState?.busted, playSound, shake]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Loading…</p></div>;
  const { isMyTurn, currentTurnPlayer, turnPot, lastRoll, busted, bustPlayer, round, maxRounds, target, scores = {}, players = [], results, myId } = gameState;

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>Press Your Luck Pigs</h1>
      <p className={styles.meta}>Round {round}/{maxRounds} · first to {target}</p>

      <div className={styles.scores}>
        {players.map((p) => (
          <div key={p} className={`${styles.scoreChip} ${p === currentTurnPlayer ? styles.scoreTurn : ''}`}>
            <PlayerName playerId={p} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{scores[p] || 0}</span>
          </div>
        ))}
      </div>

      {(phase === 'turn' || phase === 'bust') && (
        <div className={styles.table}>
          {busted ? (
            <div className={styles.bust}>💥 BUST! <PlayerName playerId={bustPlayer} nicknames={nicknames} avatars={avatars} /> rolled a 1</div>
          ) : (
            <>
              <div className={styles.die}>{lastRoll || '—'}</div>
              <p className={styles.pot}>Turn pot: <strong>{turnPot}</strong></p>
              {isMyTurn ? (
                <div className={styles.actions}>
                  <button className={styles.rollBtn} onClick={() => { onAction({ type: 'roll' }); playSound('cardDeal'); }}>🎲 Roll</button>
                  <button className={styles.bankBtn} onClick={() => { onAction({ type: 'bank' }); playSound('coinCollect'); }} disabled={turnPot === 0}>🏦 Bank {turnPot}</button>
                </div>
              ) : (
                <p className={styles.waiting}><PlayerName playerId={currentTurnPlayer} nicknames={nicknames} avatars={avatars} /> is pushing their luck…</p>
              )}
            </>
          )}
        </div>
      )}

      {(phase === 'gameOver' || phase === 'finished') && results && (
        <div className={styles.results}>
          <h2 className={styles.resTitle}>Final scores</h2>
          {results.map((r) => (
            <div key={r.playerId} className={styles.resRow}>
              <span className={styles.rPlace}>{r.placement}</span>
              <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.scoreVal}>{r.score}</span>
            </div>
          ))}
          {phase === 'gameOver' && !iAcked && <button className={styles.bankBtn} onClick={() => { setIAcked(true); onAction({ type: 'acknowledge' }); }}>Continue →</button>}
        </div>
      )}
    </div>
  );
}
