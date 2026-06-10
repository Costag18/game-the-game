import { useEffect, useRef, useState } from 'react';
import styles from './OrderAndChaos.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  // selected = { r, c } currently being previewed (first tap); symbol toggles X/O
  const [selected, setSelected] = useState(null);
  const [symbol, setSymbol] = useState('X');
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const { board = [], size = 6, isMyTurn, over, lastMove, winningCells, myRole, oppRole, result } = myMatch;

  useEffect(() => { if (!isMyTurn || over) setSelected(null); }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.r},${lastMove.c},${lastMove.symbol}` : null;
    if (key && key !== prevMoveKey.current) playSound('cardDeal');
    prevMoveKey.current = key;
  }, [lastMove, playSound]);

  useEffect(() => {
    if (result && result !== prevResult.current) {
      if (result === 'win') { playSound('winRound'); shake('medium'); }
      else if (result === 'loss') { playSound('loseRound'); }
    }
    prevResult.current = result;
  }, [result, playSound, shake]);

  const winSet = new Set((winningCells || []).map(([r, c]) => `${r},${c}`));
  const cellVal = (r, c) => (board[r] ? board[r][c] : null);

  function tapCell(r, c) {
    if (!isMyTurn || over) return;
    if (cellVal(r, c) != null) return; // occupied
    if (selected && selected.r === r && selected.c === c) {
      commit(r, c, symbol); // second tap on same cell commits
    } else {
      setSelected({ r, c });
      playSound('click');
    }
  }
  function commit(r, c, sym) {
    onAction({ type: 'move', move: { r, c, symbol: sym } });
    setSelected(null);
  }
  function toggleSymbol(s) {
    setSymbol(s);
    playSound('click');
  }

  return (
    <div className={styles.boardWrap}>
      <div className={styles.roles}>
        <span className={`${styles.roleTag} ${myRole === 'Order' ? styles.order : styles.chaos}`}>You: {myRole}</span>
        <span className={`${styles.roleTag} ${oppRole === 'Order' ? styles.order : styles.chaos}`}>Foe: {oppRole}</span>
      </div>

      {myRole === 'Order'
        ? <p className={styles.goal}>Make 5 in a row of the same symbol</p>
        : <p className={styles.goal}>Fill the board with NO 5 in a row</p>}

      <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
        {Array.from({ length: size }, (_, r) =>
          Array.from({ length: size }, (_, c) => {
            const val = cellVal(r, c);
            const isSel = selected && selected.r === r && selected.c === c;
            const win = winSet.has(`${r},${c}`);
            return (
              <button
                key={`${r},${c}`}
                className={`${styles.cell} ${isSel ? styles.selected : ''} ${win ? styles.win : ''}`}
                disabled={!isMyTurn || over || val != null}
                onClick={() => tapCell(r, c)}
                aria-label={`cell ${r + 1},${c + 1}${val ? ` ${val}` : ' empty'}`}
              >
                <span className={`${styles.mark} ${val === 'X' ? styles.markX : val === 'O' ? styles.markO : ''}`}>
                  {val || (isSel ? symbol : '')}
                </span>
              </button>
            );
          })
        )}
      </div>

      {isMyTurn && !over && (
        <div className={styles.controls}>
          <div className={styles.toggleRow}>
            <button
              className={`${styles.toggleBtn} ${symbol === 'X' ? styles.toggleX : ''}`}
              onClick={() => toggleSymbol('X')}
            >X</button>
            <button
              className={`${styles.toggleBtn} ${symbol === 'O' ? styles.toggleO : ''}`}
              onClick={() => toggleSymbol('O')}
            >O</button>
          </div>
          <button
            className={styles.placeBtn}
            disabled={!selected}
            onClick={() => selected && commit(selected.r, selected.c, symbol)}
          >
            {selected ? `Place ${symbol}` : 'Pick a cell'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function OrderAndChaosGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Audiowide', sans-serif">
      {(myMatch) => <Board myMatch={myMatch} onAction={onAction} />}
    </PairingShell>
  );
}
