import { useEffect, useRef, useState } from 'react';
import styles from './Qwixx.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const COLOR_HEX = { red: '#e53935', yellow: '#fdd835', green: '#43a047', blue: '#1e88e5' };

export default function Qwixx({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  // reset the local "acknowledged" flag when the reveal phase (re)starts
  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'reveal') setIAcked(false);
      prevPhase.current = phase;
    }
  }, [phase]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Rolling…</p></div>;

  const { round, totalRounds, dice, offered, rows = [], myBoard = {}, legalMarks = {}, hasActed, scoreboard = [], myScore, results, acknowledged = [], myId, players = [] } = gameState;

  function mark(color) {
    if (legalMarks[color] == null || hasActed) return;
    onAction({ type: 'mark', color, number: offered });
    playSound('correct');
  }
  function ack() {
    if (iAcked) return;
    setIAcked(true);
    onAction({ type: 'acknowledge' });
    playSound('click');
  }

  return (
    <div className={styles.arena}>
      <h1 className={styles.title}>Qwixx</h1>
      <p className={styles.meta}>Round {round}/{totalRounds}{offered != null && phase === 'round' ? ` · rolled ${offered}` : ''}</p>

      <div className={styles.board}>
        {rows.map((r) => {
          const board = myBoard[r.color] || { marks: [], lastIndex: -1 };
          const markedSet = new Set(board.marks);
          const legalNum = legalMarks[r.color];
          return (
            <div key={r.color} className={styles.row} style={{ background: `${COLOR_HEX[r.color]}22`, borderColor: COLOR_HEX[r.color] }}>
              <div className={styles.cells}>
                {r.cells.map((n, idx) => {
                  const isMarked = markedSet.has(n);
                  const isLegalHere = phase === 'round' && !hasActed && legalNum === n && idx > board.lastIndex;
                  return (
                    <button
                      key={idx}
                      className={`${styles.cell} ${isMarked ? styles.cellMarked : ''} ${isLegalHere ? styles.cellLegal : ''}`}
                      style={isMarked ? { background: COLOR_HEX[r.color], color: '#fff' } : undefined}
                      disabled={!isLegalHere}
                      onClick={() => mark(r.color)}
                    >{n}</button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {phase === 'round' && (
        <div className={styles.actions}>
          {hasActed ? <p className={styles.acted}>Marked ✓ — waiting for others…</p>
            : <button className={styles.passBtn} onClick={() => { onAction({ type: 'pass' }); playSound('click'); }}>Pass this roll</button>}
        </div>
      )}

      {phase === 'reveal' && (
        <div className={styles.actions}>
          <p className={styles.acted}>Final scores are in!</p>
          {!iAcked && <button className={styles.passBtn} onClick={ack}>Continue →</button>}
          <AckStatus
            players={players.map((p) => p.playerId)}
            acknowledged={acknowledged}
            me={myId}
            iActed={iAcked}
            nicknames={nicknames}
            avatars={avatars}
          />
        </div>
      )}

      <div className={styles.scoreboard}>
        {(results || scoreboard).map((s) => (
          <div key={s.playerId} className={styles.scoreRow}>
            <PlayerName playerId={s.playerId} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{s.score} pts{results ? ` · #${s.placement}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
