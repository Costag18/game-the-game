import { useEffect, useRef, useState } from 'react';
import styles from './LightsOut.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const GRID = 5;
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// cells (self + orthogonal in-bounds neighbours) a press at `cell` would toggle
function affectedCells(cell) {
  const r = Math.floor(cell / GRID), c = cell % GRID;
  const out = [cell];
  for (const [dr, dc] of NEIGHBORS) {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID) out.push(nr * GRID + nc);
  }
  return out;
}

function Board({ myMatch, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [preview, setPreview] = useState(null);
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const { board = [], isMyTurn, over, litCount = 0, movesLeft = 0, lastMove, result } = myMatch;

  useEffect(() => { if (!isMyTurn || over) setPreview(null); }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.cell},${lastMove.playerId}` : null;
    if (key && key !== prevMoveKey.current) playSound('click');
    prevMoveKey.current = key;
  }, [lastMove, playSound]);

  useEffect(() => {
    if (result && result !== prevResult.current) {
      if (result === 'win') { playSound('winRound'); shake('medium'); }
      else if (result === 'draw') { shake('light'); }
      else if (result === 'loss') { playSound('loseRound'); }
    }
    prevResult.current = result;
  }, [result, playSound, shake]);

  const previewSet = preview != null ? new Set(affectedCells(preview)) : new Set();

  function tapCell(cell) {
    if (!isMyTurn || over) return;
    if (preview === cell) commit(cell);
    else { setPreview(cell); playSound('click'); }
  }
  function commit(cell) {
    onAction({ type: 'move', move: { cell } });
    setPreview(null);
  }

  return (
    <div className={styles.boardWrap}>
      <div className={styles.counters}>
        <span className={styles.lights}>{litCount} {litCount === 1 ? 'light' : 'lights'} left</span>
        <span className={styles.moves}>{movesLeft} moves left</span>
      </div>

      <div className={styles.grid}>
        {Array.from({ length: GRID * GRID }, (_, cell) => {
          const lit = !!board[cell];
          const inPreview = previewSet.has(cell);
          return (
            <button
              key={cell}
              className={`${styles.cell} ${lit ? styles.on : styles.off} ${inPreview ? styles.preview : ''}`}
              disabled={!isMyTurn || over}
              onClick={() => tapCell(cell)}
              aria-label={`cell ${cell + 1} ${lit ? 'on' : 'off'}`}
            />
          );
        })}
      </div>

      {isMyTurn && !over && (
        <button className={styles.pressBtn} disabled={preview == null} onClick={() => preview != null && commit(preview)}>
          {preview == null ? 'Tap a cell' : 'Press'}
        </button>
      )}
      {isMyTurn && !over && (
        <p className={styles.hint}>Clear every light to win. Tap to preview, tap again or Press to confirm.</p>
      )}
    </div>
  );
}

export default function LightsOutGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell
      gameState={gameState}
      nicknames={nicknames}
      avatars={avatars}
      onAction={onAction}
      titleFont="'Orbitron', sans-serif"
    >
      {(myMatch) => <Board myMatch={myMatch} onAction={onAction} />}
    </PairingShell>
  );
}
