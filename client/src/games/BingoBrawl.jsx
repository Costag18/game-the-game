import { useEffect, useRef } from 'react';
import styles from './BingoBrawl.module.css';
import PlayerName from '../components/PlayerName.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

export default function BingoBrawl({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const prevBingo = useRef(false);

  const callDeadline = gameState?.callDeadline;
  // nudge the server to call the next number if its timer elapsed but no update arrived
  useEffect(() => {
    if (!callDeadline) return;
    const id = setInterval(() => { if (Date.now() >= callDeadline) onAction({ type: 'ping' }); }, 1000);
    return () => clearInterval(id);
  }, [callDeadline, onAction]);

  useEffect(() => {
    if (gameState?.hasBingo && !prevBingo.current) { playSound('winRound'); shake('heavy'); }
    prevBingo.current = gameState?.hasBingo;
  }, [gameState?.hasBingo, playSound, shake]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Printing cards…</p></div>;
  const { phase, myCard = [], hasBingo, myRank, canCallBingo, calledNumbers = [], lastCalled, callCount, maxCalls, opponents = [], standings, myId } = gameState;

  function daub(cell) { if (cell.called && !cell.daubed && !cell.free) { onAction({ type: 'daub', index: cell.index }); playSound('click'); } }

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>BINGO BRAWL</h1>
      <div className={styles.caller}>
        <span className={styles.lastCalled}>{lastCalled != null ? lastCalled : '—'}</span>
        <span className={styles.callMeta}>{callCount}/{maxCalls} called</span>
      </div>

      <div className={styles.cardWrap}>
        <div className={styles.bingoHeader}>{['B', 'I', 'N', 'G', 'O'].map((l) => <span key={l}>{l}</span>)}</div>
        <div className={styles.card}>
          {myCard.map((cell) => (
            <button
              key={cell.index}
              className={`${styles.cell} ${cell.free ? styles.free : ''} ${cell.daubed ? styles.daubed : ''} ${cell.called && !cell.daubed && !cell.free ? styles.callable : ''}`}
              disabled={!cell.called || cell.daubed || cell.free}
              onClick={() => daub(cell)}
            >{cell.free ? '★' : cell.value}</button>
          ))}
        </div>
      </div>

      {phase === 'playing' && (
        hasBingo ? <p className={styles.gotBingo}>BINGO! You finished #{myRank} 🎉</p>
          : <button className={styles.bingoBtn} onClick={() => { onAction({ type: 'bingo' }); playSound('winRound'); }} disabled={!canCallBingo}>BINGO!</button>
      )}

      <div className={styles.opponents}>
        {opponents.map((o) => (
          <div key={o.playerId} className={styles.opp}>
            <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.oppMeta}>{o.hasBingo ? `🏁 #${o.rank}` : `${o.daubCount} daubs`}</span>
          </div>
        ))}
      </div>

      {phase === 'finished' && standings && (
        <div className={styles.results}>
          {standings.map((s) => (
            <div key={s.playerId} className={styles.resRow}>
              <span className={styles.rPlace}>{s.placement}</span>
              <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.oppMeta}>{s.hasBingo ? 'BINGO' : `${s.daubCount} daubs`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
