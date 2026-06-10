import { useEffect, useRef, useState } from 'react';
import styles from './Gomoku.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, myId, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [preview, setPreview] = useState(null); // { row, col }
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const { board = [], size = 15, isMyTurn, over, lastMove, winningCells, myColor, result } = myMatch;

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
  const colorOf = (val) => (val == null ? null : (val === myId ? myColor : (myColor === 'B' ? 'W' : 'B')));

  function tapPoint(r, c) {
    if (!isMyTurn || over) return;
    if (board[r] && board[r][c] != null) return; // occupied
    if (preview && preview.row === r && preview.col === c) commit(r, c);
    else { setPreview({ row: r, col: c }); playSound('click'); }
  }
  function commit(r, c) {
    onAction({ type: 'move', move: { row: r, col: c } });
    setPreview(null);
  }

  return (
    <div className={styles.boardWrap}>
      <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
        {Array.from({ length: size }, (_, r) =>
          Array.from({ length: size }, (_, c) => {
            const val = board[r] ? board[r][c] : null;
            const color = colorOf(val);
            const isPreview = preview && preview.row === r && preview.col === c && isMyTurn && !over;
            const isLast = lastMove && lastMove.row === r && lastMove.col === c;
            const win = winSet.has(`${r},${c}`);
            return (
              <button
                key={`${r},${c}`}
                className={styles.point}
                disabled={!isMyTurn || over || val != null}
                onClick={() => tapPoint(r, c)}
                aria-label={`row ${r + 1} column ${c + 1}`}
              >
                <span className={styles.lineH} />
                <span className={styles.lineV} />
                {color && (
                  <span className={`${styles.stone} ${color === 'B' ? styles.black : styles.white} ${win ? styles.win : ''} ${isLast ? styles.last : ''}`} />
                )}
                {!color && isPreview && (
                  <span className={`${styles.stone} ${styles.ghost} ${myColor === 'B' ? styles.black : styles.white}`} />
                )}
              </button>
            );
          })
        )}
      </div>

      {isMyTurn && !over && (
        <button className={styles.placeBtn} disabled={!preview} onClick={() => preview && commit(preview.row, preview.col)}>
          {preview ? 'Place stone' : 'Tap a point'}
        </button>
      )}
    </div>
  );
}

export default function GomokuGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Russo One', sans-serif">
      {(myMatch) => <Board myMatch={myMatch} myId={gameState.myId} onAction={onAction} />}
    </PairingShell>
  );
}
