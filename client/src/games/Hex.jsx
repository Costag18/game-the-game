import { useEffect, useRef, useState } from 'react';
import styles from './Hex.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, myId, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [preview, setPreview] = useState(null); // "r,c"
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const { board = [], size = 11, isMyTurn, over, lastMove, winningCells, myColor, oppColor, myEdges, result } = myMatch;

  useEffect(() => { if (!isMyTurn || over) setPreview(null); }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.r},${lastMove.c},${lastMove.playerId}` : null;
    if (key && key !== prevMoveKey.current) playSound('click');
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
  const colorOf = (val) => (val == null ? null : (val === myId ? myColor : oppColor));

  function tapCell(r, c) {
    if (!isMyTurn || over) return;
    if (board[r] && board[r][c] != null) return; // occupied
    const k = `${r},${c}`;
    if (preview === k) commit(r, c);
    else { setPreview(k); playSound('click'); }
  }
  function commit(r, c) {
    onAction({ type: 'move', move: { r, c } });
    setPreview(null);
  }

  const lastKey = lastMove ? `${lastMove.r},${lastMove.c}` : null;

  return (
    <div className={styles.boardWrap}>
      <div className={styles.legend}>
        <span><i className={`${styles.swatch} ${myColor === 'V' ? styles.violet : styles.orange}`} /> You — {myEdges === 'topBottom' ? 'Top ↕ Bottom' : 'Left ↔ Right'}</span>
        <span><i className={`${styles.swatch} ${oppColor === 'V' ? styles.violet : styles.orange}`} /> Foe — {myEdges === 'topBottom' ? 'Left ↔ Right' : 'Top ↕ Bottom'}</span>
      </div>

      <div className={styles.frame}>
        {/* colored edge bars: violet (V/p1) = top+bottom, orange (O/p2) = left+right */}
        <div className={`${styles.edge} ${styles.edgeTop} ${styles.violet}`} />
        <div className={`${styles.edge} ${styles.edgeBottom} ${styles.violet}`} />
        <div className={`${styles.edge} ${styles.edgeLeft} ${styles.orange}`} />
        <div className={`${styles.edge} ${styles.edgeRight} ${styles.orange}`} />

        <div className={styles.rhombus}>
          {Array.from({ length: size }, (_, r) => (
            <div key={r} className={styles.row} style={{ marginLeft: `calc(${r} * var(--hex-shift, 0.62rem))` }}>
              {Array.from({ length: size }, (_, c) => {
                const val = board[r] ? board[r][c] : null;
                const color = colorOf(val);
                const k = `${r},${c}`;
                const isPreview = preview === k;
                const isWin = winSet.has(k);
                const isLast = lastKey === k;
                const ghostClass = isPreview ? (myColor === 'V' ? styles.ghostViolet : styles.ghostOrange) : '';
                return (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.cell} ${color === 'V' ? styles.violet : color === 'O' ? styles.orange : ''} ${ghostClass} ${isWin ? styles.win : ''} ${isLast ? styles.last : ''}`}
                    disabled={!isMyTurn || over || val != null}
                    onClick={() => tapCell(r, c)}
                    aria-label={`row ${r + 1} column ${c + 1}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {isMyTurn && !over && (
        <button
          className={styles.placeBtn}
          disabled={preview == null}
          onClick={() => { if (preview != null) { const [r, c] = preview.split(',').map(Number); commit(r, c); } }}
        >
          {preview == null ? 'Tap a cell' : 'Place stone'}
        </button>
      )}
    </div>
  );
}

export default function HexGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Orbitron', sans-serif">
      {(myMatch) => <Board myMatch={myMatch} myId={gameState.myId} onAction={onAction} />}
    </PairingShell>
  );
}
