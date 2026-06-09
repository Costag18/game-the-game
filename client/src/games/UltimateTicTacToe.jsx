import { useEffect, useRef, useState } from 'react';
import styles from './UltimateTicTacToe.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [preview, setPreview] = useState(null); // { board, cell }
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const { metaBoard = [], subBoards = [], forcedBoard, isMyTurn, over, lastMove, result } = myMatch;

  useEffect(() => { if (!isMyTurn || over) setPreview(null); }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.board},${lastMove.cell},${lastMove.mark}` : null;
    if (key && key !== prevMoveKey.current) playSound('click');
    prevMoveKey.current = key;
  }, [lastMove, playSound]);

  useEffect(() => {
    if (result && result !== prevResult.current) {
      if (result === 'win') { playSound('winRound'); shake('medium'); }
      else if (result === 'draw') shake('light');
      else if (result === 'loss') playSound('loseRound');
    }
    prevResult.current = result;
  }, [result, playSound, shake]);

  const boardPlayable = (b) => isMyTurn && !over && metaBoard[b] === '' && (forcedBoard === null || forcedBoard === b);

  function tapCell(b, c) {
    if (!boardPlayable(b) || subBoards[b][c] !== '') return;
    if (preview && preview.board === b && preview.cell === c) commit(b, c);
    else { setPreview({ board: b, cell: c }); playSound('click'); }
  }
  function commit(b, c) { onAction({ type: 'move', move: { board: b, cell: c } }); setPreview(null); }

  return (
    <div className={styles.metaGrid}>
      {Array.from({ length: 9 }, (_, b) => {
        const decided = metaBoard[b]; // '' | 'X' | 'O' | 'D'
        const playable = boardPlayable(b);
        return (
          <div key={b} className={`${styles.subBoard} ${playable ? styles.subActive : ''} ${decided ? styles.subDecided : ''}`}>
            {decided ? (
              <div className={`${styles.metaMark} ${decided === 'X' ? styles.xMark : decided === 'O' ? styles.oMark : styles.dMark}`}>
                {decided === 'D' ? '–' : decided}
              </div>
            ) : (
              <div className={styles.cells}>
                {Array.from({ length: 9 }, (_, c) => {
                  const val = subBoards[b] ? subBoards[b][c] : '';
                  const isPreview = preview && preview.board === b && preview.cell === c;
                  const last = lastMove && lastMove.board === b && lastMove.cell === c;
                  return (
                    <button
                      key={c}
                      className={`${styles.cell} ${val === 'X' ? styles.x : val === 'O' ? styles.o : ''} ${isPreview ? styles.preview : ''} ${last ? styles.last : ''}`}
                      disabled={!playable || val !== ''}
                      onClick={() => tapCell(b, c)}
                    >{val || (isPreview ? '·' : '')}</button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function UltimateTicTacToeGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Russo One', sans-serif">
      {(myMatch) => <Board myMatch={myMatch} onAction={onAction} />}
    </PairingShell>
  );
}
