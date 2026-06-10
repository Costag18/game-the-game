import { useEffect, useRef, useState } from 'react';
import styles from './Quoridor.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

const SIZE = 9;

function Board({ myMatch, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  // selected: { kind:'pawn', r, c } | { kind:'wall', r, c, orient } | null
  const [sel, setSel] = useState(null);
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const {
    myId, opponentId, myPawn, oppPawn, walls = [], legalPawnMoves = [],
    myWallsLeft = 0, oppWallsLeft = 0, myGoalRow, isMyTurn, over, lastMove, result,
  } = myMatch;

  useEffect(() => { if (!isMyTurn || over) setSel(null); }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.type}:${lastMove.r},${lastMove.c},${lastMove.orient || ''},${lastMove.playerId}` : null;
    if (key && key !== prevMoveKey.current) playSound(lastMove.type === 'wall' ? 'click' : 'cardDeal');
    prevMoveKey.current = key;
  }, [lastMove, playSound]);

  useEffect(() => {
    if (result && result !== prevResult.current) {
      if (result === 'win') { playSound('winRound'); shake('medium'); }
      else if (result === 'loss') { playSound('loseRound'); }
    }
    prevResult.current = result;
  }, [result, playSound, shake]);

  const wallKey = (w) => `${w.orient}:${w.r},${w.c}`;
  const wallSet = new Set(walls.map(wallKey));
  const legalSet = new Set(legalPawnMoves.map((m) => `${m.r},${m.c}`));

  function tapCell(r, c) {
    if (!isMyTurn || over) return;
    if (!legalSet.has(`${r},${c}`)) return;
    if (sel && sel.kind === 'pawn' && sel.r === r && sel.c === c) {
      onAction({ type: 'move', move: { type: 'move', r, c } });
      setSel(null);
    } else {
      setSel({ kind: 'pawn', r, c });
      playSound('click');
    }
  }

  function tapWall(r, c, orient) {
    if (!isMyTurn || over || myWallsLeft <= 0) return;
    if (wallSet.has(`${orient}:${r},${c}`)) return;
    if (sel && sel.kind === 'wall' && sel.r === r && sel.c === c && sel.orient === orient) {
      onAction({ type: 'move', move: { type: 'wall', r, c, orient } });
      setSel(null);
    } else {
      setSel({ kind: 'wall', r, c, orient });
      playSound('click');
    }
  }

  function confirm() {
    if (!sel) return;
    if (sel.kind === 'pawn') onAction({ type: 'move', move: { type: 'move', r: sel.r, c: sel.c } });
    else onAction({ type: 'move', move: { type: 'wall', r: sel.r, c: sel.c, orient: sel.orient } });
    setSel(null);
  }

  // Build the visual grid: 9 cell rows interleaved with gutters.
  // We render an absolutely-positioned overlay grid sized to the board.
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const isMe = myPawn && myPawn.r === r && myPawn.c === c;
      const isOpp = oppPawn && oppPawn.r === r && oppPawn.c === c;
      const isLegal = legalSet.has(`${r},${c}`);
      const isGhost = sel && sel.kind === 'pawn' && sel.r === r && sel.c === c;
      const isGoal = r === myGoalRow;
      cells.push(
        <div
          key={`cell-${r}-${c}`}
          className={`${styles.cell} ${isGoal ? styles.goalCell : ''} ${isLegal ? styles.legal : ''} ${isGhost ? styles.ghostCell : ''}`}
          style={{ gridRow: r * 2 + 1, gridColumn: c * 2 + 1 }}
          onClick={() => tapCell(r, c)}
        >
          {isMe && <div className={`${styles.pawn} ${styles.pawnMe}`} />}
          {isOpp && <div className={`${styles.pawn} ${styles.pawnOpp}`} />}
        </div>
      );
    }
  }

  // Wall gutters: posts (r,c) with r,c in 0..7. Each post hosts an h-target and a
  // v-target. We render gutter slots between cells; tapping picks orientation.
  const gutters = [];
  const canWall = isMyTurn && !over && myWallsLeft > 0;
  for (let r = 0; r < SIZE - 1; r++) {
    for (let c = 0; c < SIZE - 1; c++) {
      const hPlaced = wallSet.has(`h:${r},${c}`);
      const vPlaced = wallSet.has(`v:${r},${c}`);
      const hSel = sel && sel.kind === 'wall' && sel.orient === 'h' && sel.r === r && sel.c === c;
      const vSel = sel && sel.kind === 'wall' && sel.orient === 'v' && sel.r === r && sel.c === c;
      // horizontal target: occupies the gutter row below cell (r,c), spanning cols c..c+1
      gutters.push(
        <div
          key={`h-${r}-${c}`}
          className={`${styles.hSlot} ${hPlaced ? styles.wallOn : ''} ${hSel ? styles.wallSel : ''} ${canWall && !hPlaced ? styles.slotLive : ''}`}
          style={{ gridRow: r * 2 + 2, gridColumn: `${c * 2 + 1} / span 3` }}
          onClick={() => tapWall(r, c, 'h')}
          aria-label={`horizontal wall ${r},${c}`}
        />
      );
      // vertical target: occupies the gutter col right of cell (r,c), spanning rows r..r+1
      gutters.push(
        <div
          key={`v-${r}-${c}`}
          className={`${styles.vSlot} ${vPlaced ? styles.wallOn : ''} ${vSel ? styles.wallSel : ''} ${canWall && !vPlaced ? styles.slotLive : ''}`}
          style={{ gridColumn: c * 2 + 2, gridRow: `${r * 2 + 1} / span 3` }}
          onClick={() => tapWall(r, c, 'v')}
          aria-label={`vertical wall ${r},${c}`}
        />
      );
    }
  }

  // grid template: 9 cells + 8 gutters in each axis. cell = 2fr, gutter = 0.55fr.
  const track = [];
  for (let i = 0; i < SIZE; i++) { track.push('2fr'); if (i < SIZE - 1) track.push('0.55fr'); }
  const template = track.join(' ');

  return (
    <div className={styles.boardWrap}>
      <div className={styles.wallCounts}>
        <span className={styles.countMe}>You: {myWallsLeft} wall{myWallsLeft === 1 ? '' : 's'}</span>
        <span className={styles.countOpp}>Opp: {oppWallsLeft} wall{oppWallsLeft === 1 ? '' : 's'}</span>
      </div>

      <div
        className={styles.grid}
        style={{ gridTemplateColumns: template, gridTemplateRows: template }}
      >
        {cells}
        {gutters}
      </div>

      <p className={styles.hint}>
        {!isMyTurn || over
          ? ' '
          : sel
            ? (sel.kind === 'pawn' ? 'Tap your highlighted square again to move' : 'Tap the wall slot again to place')
            : 'Tap a green square to move, or a slot to place a wall'}
      </p>

      {isMyTurn && !over && (
        <button className={styles.confirmBtn} disabled={!sel} onClick={confirm}>
          {sel && sel.kind === 'wall' ? 'Place wall' : 'Move'}
        </button>
      )}
    </div>
  );
}

export default function QuoridorGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell
      gameState={gameState}
      nicknames={nicknames}
      avatars={avatars}
      onAction={onAction}
      titleFont="'Russo One', sans-serif"
    >
      {(myMatch) => <Board myMatch={myMatch} onAction={onAction} />}
    </PairingShell>
  );
}
