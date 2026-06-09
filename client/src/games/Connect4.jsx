import { useEffect, useRef, useState } from 'react';
import styles from './Connect4.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, myId, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [preview, setPreview] = useState(null);
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const { board = [], rows = 6, cols = 7, isMyTurn, over, legalCols = [], lastMove, winningCells, myColor, oppColor, result } = myMatch;

  useEffect(() => { if (!isMyTurn || over) setPreview(null); }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.row},${lastMove.col},${lastMove.playerId}` : null;
    if (key && key !== prevMoveKey.current) playSound('cardDeal');
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

  const winSet = new Set((winningCells || []).map(([r, c]) => `${r},${c}`));
  const colorOf = (val) => (val == null ? null : (val === myId ? myColor : oppColor));
  const lowestEmpty = (c) => { for (let r = 0; r < rows; r++) if (board[r] && board[r][c] == null) return r; return -1; };

  function tapCol(c) {
    if (!isMyTurn || over || !legalCols.includes(c)) return;
    if (preview === c) commit(c);
    else { setPreview(c); playSound('click'); }
  }
  function commit(c) {
    onAction({ type: 'move', move: { col: c } });
    setPreview(null);
  }

  return (
    <div className={styles.boardWrap}>
      <div className={styles.colStrip}>
        {Array.from({ length: cols }, (_, c) => (
          <button
            key={c}
            className={`${styles.colBtn} ${preview === c ? styles.colBtnSel : ''}`}
            disabled={!isMyTurn || over || !legalCols.includes(c)}
            onClick={() => tapCol(c)}
            aria-label={`column ${c + 1}`}
          >▼</button>
        ))}
      </div>

      <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: rows }, (_, ri) => rows - 1 - ri).flatMap((r) =>
          Array.from({ length: cols }, (_, c) => {
            const val = board[r] ? board[r][c] : null;
            const color = colorOf(val);
            const isGhost = preview === c && lowestEmpty(c) === r && isMyTurn && !over;
            const win = winSet.has(`${r},${c}`);
            return (
              <div key={`${r},${c}`} className={styles.cell} onClick={() => tapCol(c)}>
                <div className={`${styles.disc} ${color === 'R' ? styles.red : color === 'Y' ? styles.yellow : ''} ${isGhost ? styles.ghost : ''} ${win ? styles.win : ''} ${isGhost && myColor === 'R' ? styles.ghostRed : ''} ${isGhost && myColor === 'Y' ? styles.ghostYellow : ''}`} />
              </div>
            );
          })
        )}
      </div>

      {isMyTurn && !over && (
        <button className={styles.dropBtn} disabled={preview == null} onClick={() => preview != null && commit(preview)}>
          Drop
        </button>
      )}
    </div>
  );
}

export default function Connect4Game({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction}>
      {(myMatch) => <Board myMatch={myMatch} myId={gameState.myId} onAction={onAction} />}
    </PairingShell>
  );
}
