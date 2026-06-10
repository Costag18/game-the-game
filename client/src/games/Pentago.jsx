import { useEffect, useRef, useState } from 'react';
import styles from './Pentago.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const SIZE = 6;
const quadOf = (r, c) => (r < 3 ? 0 : 1) * 2 + (c < 3 ? 0 : 1);
const ROT = [
  { quadrant: 0, dir: 'cw' }, { quadrant: 0, dir: 'ccw' },
  { quadrant: 1, dir: 'cw' }, { quadrant: 1, dir: 'ccw' },
  { quadrant: 2, dir: 'cw' }, { quadrant: 2, dir: 'ccw' },
  { quadrant: 3, dir: 'cw' }, { quadrant: 3, dir: 'ccw' },
];
const QUAD_LABEL = ['Top-left', 'Top-right', 'Bottom-left', 'Bottom-right'];

function Board({ myMatch, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [cell, setCell] = useState(null);       // previewed placement cell (0..35)
  const [rot, setRot] = useState(null);          // { quadrant, dir } chosen rotation
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const {
    board = [], isMyTurn, over, lastMove, winningCells, myMark, result,
  } = myMatch;

  // reset selection when it's no longer my turn / game over / a move lands
  useEffect(() => { if (!isMyTurn || over) { setCell(null); setRot(null); } }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.cell},${lastMove.quadrant},${lastMove.dir},${lastMove.playerId}` : null;
    if (key && key !== prevMoveKey.current) { playSound('cardDeal'); setCell(null); setRot(null); }
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

  const winSet = new Set(winningCells || []);
  const myId = myMatch.myId;

  function tapCell(i) {
    if (!isMyTurn || over) return;
    if (board[i] != null) return;
    setCell(i === cell ? null : i);
    if (i !== cell) playSound('click');
    setRot(null);
  }
  function pickRot(r) {
    if (!isMyTurn || over || cell == null) return;
    setRot(r);
    playSound('click');
  }
  function confirm() {
    if (cell == null || !rot) return;
    onAction({ type: 'move', move: { cell, quadrant: rot.quadrant, dir: rot.dir } });
    setCell(null); setRot(null);
  }

  const interactive = isMyTurn && !over;

  return (
    <div className={styles.boardWrap}>
      <div className={styles.grid}>
        {Array.from({ length: SIZE * SIZE }, (_, i) => {
          const r = Math.floor(i / SIZE), c = i % SIZE;
          const q = quadOf(r, c);
          const val = board[i];
          const mark = val == null ? null : (val === myId ? myMark : (myMark === 'B' ? 'W' : 'B'));
          const isPreview = cell === i;
          const inSelQuad = rot && rot.quadrant === q;
          const win = winSet.has(i);
          // visual gaps between quadrants
          const gapR = r === 2 || r === 5;
          const gapC = c === 2 || c === 5;
          return (
            <button
              key={i}
              className={`${styles.cell} ${styles['q' + q]} ${gapR ? styles.gapR : ''} ${gapC ? styles.gapC : ''} ${inSelQuad ? styles.quadActive : ''}`}
              onClick={() => tapCell(i)}
              disabled={!interactive || val != null}
              aria-label={`row ${r + 1} col ${c + 1}`}
            >
              <span
                className={`${styles.marble} ${mark === 'B' ? styles.black : mark === 'W' ? styles.white : ''} ${isPreview ? styles.preview : ''} ${isPreview && myMark === 'B' ? styles.previewBlack : ''} ${isPreview && myMark === 'W' ? styles.previewWhite : ''} ${win ? styles.win : ''}`}
              />
            </button>
          );
        })}
      </div>

      {interactive && (
        <div className={styles.controls}>
          <p className={styles.step}>
            {cell == null ? '1. Tap an empty cell to place your marble'
              : !rot ? '2. Pick a quadrant + spin direction'
                : '3. Confirm your move'}
          </p>

          <div className={styles.rotGrid}>
            {ROT.map((rr) => {
              const sel = rot && rot.quadrant === rr.quadrant && rot.dir === rr.dir;
              return (
                <button
                  key={`${rr.quadrant}-${rr.dir}`}
                  className={`${styles.rotBtn} ${sel ? styles.rotSel : ''}`}
                  disabled={cell == null}
                  onClick={() => pickRot(rr)}
                  aria-label={`rotate ${QUAD_LABEL[rr.quadrant]} ${rr.dir === 'cw' ? 'clockwise' : 'counter-clockwise'}`}
                >
                  <span className={styles.rotQuad}>{QUAD_LABEL[rr.quadrant]}</span>
                  <span className={styles.rotDir}>{rr.dir === 'cw' ? '↻ CW' : '↺ CCW'}</span>
                </button>
              );
            })}
          </div>

          <button className={styles.confirmBtn} disabled={cell == null || !rot} onClick={confirm}>
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}

export default function PentagoGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Audiowide', sans-serif">
      {(myMatch) => <Board myMatch={{ ...myMatch, myId: gameState.myId }} onAction={onAction} />}
    </PairingShell>
  );
}
