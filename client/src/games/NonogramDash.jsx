import { useEffect, useRef, useState } from 'react';
import styles from './NonogramDash.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function NonogramDashGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [mode, setMode] = useState('fill'); // 'fill' | 'empty'
  const [iAcked, setIAcked] = useState(false);
  const [secsLeft, setSecsLeft] = useState(null);
  const prevPhase = useRef(null);
  const prevSolved = useRef(false);

  const phase = gameState?.phase;
  const roundEndMs = gameState?.roundEndMs;

  // reset per-phase
  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'reveal') { setIAcked(false); playSound('roundWin'); }
    if (phase === 'playing') { setMode('fill'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  // celebrate own solve
  useEffect(() => {
    const solved = !!gameState?.mySolved;
    if (solved && !prevSolved.current) playSound('cardDeal');
    prevSolved.current = solved;
  }, [gameState?.mySolved, playSound]);

  // countdown to the server deadline
  useEffect(() => {
    if (phase !== 'playing' || !roundEndMs) { setSecsLeft(null); return; }
    const tick = () => {
      const s = Math.max(0, Math.ceil((roundEndMs - Date.now()) / 1000));
      setSecsLeft(s);
      if (s <= 0) onAction({ type: 'ping' });
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [phase, roundEndMs, onAction]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Drawing the puzzle…</p></div>;
  }

  const {
    grid = 8, rowClues = [], colClues = [], myMarks = [], mySolved, myDone,
    myPercent = 0, myCorrect = 0, filledCount = 0, opponents = [], myId,
    solution, results, acknowledged = [],
  } = gameState;

  const allPlayers = [myId, ...opponents.map((o) => o.playerId)].filter(Boolean);
  const maxColRun = Math.max(1, ...colClues.map((c) => c.length));
  const maxRowRun = Math.max(1, ...rowClues.map((r) => r.length));

  function tapCell(r, c) {
    if (mySolved || myDone || phase !== 'playing') return;
    const cur = myMarks[r]?.[c] ?? 0;
    let next;
    if (mode === 'fill') next = cur === 1 ? 'blank' : 'filled';
    else next = cur === -1 ? 'blank' : 'empty';
    onAction({ type: 'mark', row: r, col: c, state: next });
    playSound('click');
  }

  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const revealing = phase === 'reveal' || phase === 'finished';

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>NONOGRAM DASH</h1>
        {phase === 'playing' && (
          <span className={`${styles.timer} ${secsLeft != null && secsLeft <= 15 ? styles.timerLow : ''}`}>
            {secsLeft != null ? `${secsLeft}s` : ''}
          </span>
        )}
      </div>

      {phase === 'playing' && (
        <p className={styles.sub}>
          Fill the {filledCount} hidden cells using the clues. {myCorrect}/{grid * grid} correct ({myPercent}%).
        </p>
      )}

      {mySolved && phase === 'playing' && (
        <div className={styles.solvedBanner}>✅ Solved! Waiting for the rest…</div>
      )}

      {/* PUZZLE GRID with clue strips */}
      {!revealing && (
        <>
          <div
            className={styles.board}
            style={{
              gridTemplateColumns: `${maxRowRun * 1.1}em repeat(${grid}, 1fr)`,
            }}
          >
            {/* top-left corner spacer */}
            <div className={styles.corner} />
            {/* column clues */}
            {colClues.map((clue, c) => (
              <div key={`col-${c}`} className={styles.colClue} style={{ minHeight: `${maxColRun * 1.1}em` }}>
                {clue.map((n, i) => <span key={i}>{n}</span>)}
              </div>
            ))}
            {/* rows: row-clue + cells */}
            {Array.from({ length: grid }).map((_, r) => (
              <Row key={`row-${r}`} r={r} grid={grid} rowClue={rowClues[r] || [0]} marks={myMarks[r] || []} onTap={tapCell} styles={styles} locked={mySolved || myDone} />
            ))}
          </div>

          <div className={styles.modeRow}>
            <button
              className={`${styles.modeBtn} ${mode === 'fill' ? styles.modeOn : ''}`}
              onClick={() => setMode('fill')}
            >■ Fill</button>
            <button
              className={`${styles.modeBtn} ${mode === 'empty' ? styles.modeOn : ''}`}
              onClick={() => setMode('empty')}
            >✕ Mark empty</button>
          </div>
        </>
      )}

      {/* OPPONENT PROGRESS */}
      {phase === 'playing' && opponents.length > 0 && (
        <div className={styles.oppList}>
          {opponents.map((o) => (
            <div key={o.playerId} className={styles.oppRow}>
              <PlayerName playerId={o.playerId} nicknames={nicknames} avatars={avatars} />
              <div className={styles.bar}>
                <div className={styles.barFill} style={{ width: `${o.solved ? 100 : o.percent}%` }} />
              </div>
              <span className={styles.oppPct}>{o.solved ? '✅' : `${o.percent}%`}</span>
            </div>
          ))}
        </div>
      )}

      {/* REVEAL / STANDINGS */}
      {revealing && (
        <div className={styles.reveal}>
          <h2 className={styles.revealTitle}>The picture</h2>
          {Array.isArray(solution) && (
            <div className={styles.solution} style={{ gridTemplateColumns: `repeat(${grid}, 1fr)` }}>
              {solution.flatMap((row, r) =>
                row.map((v, c) => (
                  <div key={`${r}-${c}`} className={`${styles.solCell} ${v ? styles.solOn : ''}`} />
                )),
              )}
            </div>
          )}
          <div className={styles.scoreboard}>
            {(results || []).map((e) => (
              <div key={e.playerId} className={`${styles.scoreRow} ${e.playerId === myId ? styles.meRow : ''}`}>
                <span className={styles.place}>#{e.placement}</span>
                <PlayerName playerId={e.playerId} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{e.handDescription}</span>
              </div>
            ))}
          </div>
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

function Row({ r, grid, rowClue, marks, onTap, styles, locked }) {
  return (
    <>
      <div className={styles.rowClue}>
        {rowClue.map((n, i) => <span key={i}>{n}</span>)}
      </div>
      {Array.from({ length: grid }).map((_, c) => {
        const m = marks[c] ?? 0;
        const cls = m === 1 ? styles.cellFilled : m === -1 ? styles.cellEmpty : '';
        return (
          <button
            key={c}
            className={`${styles.cell} ${cls} ${locked ? styles.cellLocked : ''}`}
            onClick={() => onTap(r, c)}
            aria-label={`row ${r + 1} col ${c + 1}`}
          >
            {m === -1 ? '✕' : ''}
          </button>
        );
      })}
    </>
  );
}
