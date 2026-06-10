import { useEffect, useRef, useState } from 'react';
import styles from './SudokuSixer.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

const N = 6;

export default function SudokuSixerGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [sel, setSel] = useState(null);      // selected cell idx
  const [iAcked, setIAcked] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'playing') setSel(null);
    if (phase === 'reveal') { setIAcked(false); playSound?.('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // countdown to server deadline
  const roundEndMs = gameState?.roundEndMs;
  useEffect(() => {
    if (phase !== 'playing' || !roundEndMs) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((roundEndMs - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [phase, roundEndMs]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Generating the grid…</p></div>;
  }

  const {
    givens = [], myEntries = {}, myCorrectCount = 0, mySolved, myDone,
    boxRows = 2, boxCols = 3, opponents = [], myId,
    solution = null, results = null, acknowledged = [],
  } = gameState;

  const revealing = phase === 'reveal' || phase === 'finished';
  const totalCells = N * N;
  const allPlayers = [myId, ...opponents.map((o) => o.playerId)].filter(Boolean);

  function isGiven(idx) { return givens[idx] !== 0 && givens[idx] != null; }
  function valueAt(idx) {
    if (isGiven(idx)) return givens[idx];
    return myEntries[idx] != null ? myEntries[idx] : null;
  }

  function pickCell(idx) {
    if (revealing || myDone) return;
    if (isGiven(idx)) return;
    setSel(idx === sel ? null : idx);
    playSound?.('click');
  }
  function place(value) {
    if (sel == null || revealing || myDone) return;
    onAction({ type: 'place', row: Math.floor(sel / N), col: sel % N, value });
    playSound?.('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  // thick borders between 2x3 boxes
  function cellBorders(r, c) {
    return {
      borderTopWidth: r % boxRows === 0 ? 3 : 1,
      borderLeftWidth: c % boxCols === 0 ? 3 : 1,
      borderRightWidth: c === N - 1 ? 3 : 1,
      borderBottomWidth: r === N - 1 ? 3 : 1,
    };
  }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>Sudoku Sixer</h1>
        {phase === 'playing' && secondsLeft != null && (
          <span className={`${styles.timer} ${secondsLeft <= 15 ? styles.timerLow : ''}`}>{secondsLeft}s</span>
        )}
      </div>

      {phase === 'playing' && (
        <p className={styles.sub}>
          {mySolved ? 'Solved! Waiting for the round to end…'
            : `Fill every row, column & box with 1–6 · ${myCorrectCount}/${totalCells} correct`}
        </p>
      )}

      {/* GRID */}
      <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
        {Array.from({ length: totalCells }, (_, idx) => {
          const r = Math.floor(idx / N), c = idx % N;
          const given = isGiven(idx);
          const v = valueAt(idx);
          const isSel = idx === sel;
          let cls = styles.cell;
          if (given) cls += ` ${styles.given}`;
          if (isSel) cls += ` ${styles.selected}`;
          if (revealing && solution) {
            if (!given) cls += v === solution[idx] ? ` ${styles.correct}` : ` ${styles.wrong}`;
          }
          return (
            <button
              key={idx}
              className={cls}
              style={cellBorders(r, c)}
              onClick={() => pickCell(idx)}
              disabled={given || revealing || myDone}
            >
              {revealing && solution && !given ? solution[idx] : (v != null ? v : '')}
            </button>
          );
        })}
      </div>

      {/* NUMBER PAD */}
      {phase === 'playing' && !myDone && (
        <div className={styles.pad}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button key={n} className={styles.padBtn} onClick={() => place(n)} disabled={sel == null}>{n}</button>
          ))}
          <button className={`${styles.padBtn} ${styles.eraseBtn}`} onClick={() => place(0)} disabled={sel == null}>✕</button>
        </div>
      )}

      {/* OPPONENT PROGRESS */}
      {phase === 'playing' && opponents.length > 0 && (
        <div className={styles.oppBox}>
          {opponents.map((o) => (
            <div key={o.playerId} className={styles.oppRow}>
              <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
              <div className={styles.bar}>
                <div className={styles.barFill} style={{ width: `${Math.round((o.correctCount / totalCells) * 100)}%` }} />
              </div>
              <span className={styles.oppPct}>{o.solved ? '✓' : `${o.correctCount}/${totalCells}`}</span>
            </div>
          ))}
        </div>
      )}

      {mySolved && phase === 'playing' && (
        <div className={styles.solvedBanner}>🏆 You solved it!</div>
      )}

      {/* REVEAL / STANDINGS */}
      {revealing && results && (
        <div className={styles.standings}>
          <h2 className={styles.standTitle}>{phase === 'finished' ? 'Final Standings' : 'Round Over'}</h2>
          {results.map((r) => (
            <div key={r.playerId} className={`${styles.standRow} ${r.playerId === myId ? styles.standMe : ''}`}>
              <span className={styles.place}>#{r.placement}</span>
              <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.standVal}>{r.handDescription}</span>
            </div>
          ))}
          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
