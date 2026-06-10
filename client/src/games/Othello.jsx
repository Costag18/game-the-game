import { useEffect, useRef, useState } from 'react';
import styles from './Othello.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, myId, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [preview, setPreview] = useState(null); // "r,c"
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const {
    board = [], size = 8, isMyTurn, over, legalMoves = [], lastMove,
    myColor, oppColor, myDiscs = 0, oppDiscs = 0, result,
  } = myMatch;

  useEffect(() => { if (!isMyTurn || over) setPreview(null); }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.r},${lastMove.c},${lastMove.playerId}` : null;
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

  const legalSet = new Set(legalMoves.map((m) => `${m.r},${m.c}`));
  const lastKey = lastMove ? `${lastMove.r},${lastMove.c}` : null;
  const colorOf = (val) => (val == null ? null : (val === myId ? myColor : oppColor));

  function tapCell(r, c) {
    const key = `${r},${c}`;
    if (!isMyTurn || over || !legalSet.has(key)) return;
    if (preview === key) commit(r, c);
    else { setPreview(key); playSound('click'); }
  }
  function commit(r, c) {
    onAction({ type: 'move', move: { r, c } });
    setPreview(null);
  }

  return (
    <div className={styles.boardWrap}>
      <div className={styles.scoreBar}>
        <span className={`${styles.scorePill} ${myColor === 'B' ? styles.pillBlack : styles.pillWhite}`}>
          <span className={`${styles.dot} ${myColor === 'B' ? styles.black : styles.white}`} /> You {myDiscs}
        </span>
        <span className={`${styles.scorePill} ${oppColor === 'B' ? styles.pillBlack : styles.pillWhite}`}>
          <span className={`${styles.dot} ${oppColor === 'B' ? styles.black : styles.white}`} /> Opp {oppDiscs}
        </span>
      </div>

      <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
        {Array.from({ length: size }, (_, r) =>
          Array.from({ length: size }, (_, c) => {
            const key = `${r},${c}`;
            const val = board[r] ? board[r][c] : null;
            const color = colorOf(val);
            const isLegal = isMyTurn && !over && legalSet.has(key);
            const isPreview = preview === key;
            const isLast = lastKey === key;
            return (
              <div
                key={key}
                className={`${styles.cell} ${isLegal ? styles.cellLegal : ''}`}
                onClick={() => tapCell(r, c)}
              >
                {color && (
                  <div className={`${styles.disc} ${color === 'B' ? styles.black : styles.white} ${isLast ? styles.lastDisc : ''}`} />
                )}
                {!color && isLegal && (
                  <div className={`${styles.ghost} ${myColor === 'B' ? styles.ghostBlack : styles.ghostWhite} ${isPreview ? styles.ghostSel : ''}`} />
                )}
              </div>
            );
          })
        )}
      </div>

      {isMyTurn && !over && (
        <button
          className={styles.placeBtn}
          disabled={preview == null}
          onClick={() => { if (preview != null) { const [r, c] = preview.split(',').map(Number); commit(r, c); } }}
        >
          {preview == null ? 'Tap a highlighted square' : 'Place disc'}
        </button>
      )}
    </div>
  );
}

export default function OthelloGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Cinzel', serif">
      {(myMatch) => <Board myMatch={myMatch} myId={gameState.myId} onAction={onAction} />}
    </PairingShell>
  );
}
