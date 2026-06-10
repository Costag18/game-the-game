import { useEffect, useRef, useState } from 'react';
import styles from './DotsAndBoxes.module.css';
import PairingShell from './PairingShell.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';

function Board({ myMatch, myId, onAction }) {
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [preview, setPreview] = useState(null); // { orient, r, c }
  const prevMoveKey = useRef(null);
  const prevResult = useRef(null);

  const {
    hEdges = [], vEdges = [], boxOwners = [], boxes = 5, dots = 6,
    isMyTurn, over, legalEdges = [], lastMove, myBoxes = 0, oppBoxes = 0, result,
  } = myMatch;

  useEffect(() => { if (!isMyTurn || over) setPreview(null); }, [isMyTurn, over]);

  useEffect(() => {
    const key = lastMove ? `${lastMove.orient},${lastMove.r},${lastMove.c},${lastMove.playerId}` : null;
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

  const isLegal = (orient, r, c) => legalEdges.some((e) => e.orient === orient && e.r === r && e.c === c);
  const edgeTaken = (orient, r, c) => (orient === 'h' ? hEdges[r]?.[c] : vEdges[r]?.[c]) != null;
  const edgeOwner = (orient, r, c) => (orient === 'h' ? hEdges[r]?.[c] : vEdges[r]?.[c]) ?? null;
  const isPreview = (orient, r, c) => preview && preview.orient === orient && preview.r === r && preview.c === c;
  const isLast = (orient, r, c) => lastMove && lastMove.orient === orient && lastMove.r === r && lastMove.c === c;

  function tapEdge(orient, r, c) {
    if (!isMyTurn || over) return;
    if (edgeTaken(orient, r, c) || !isLegal(orient, r, c)) return;
    if (isPreview(orient, r, c)) commit(orient, r, c);
    else { setPreview({ orient, r, c }); playSound('click'); }
  }
  function commit(orient, r, c) {
    onAction({ type: 'move', move: { orient, r, c } });
    setPreview(null);
  }

  const ownerClass = (owner) => (owner == null ? '' : owner === myId ? styles.mine : styles.theirs);

  // Build the lattice row by row. Logical layout:
  //   dotRow r:   dot  hEdge(r,0)  dot  hEdge(r,1) ... dot          (for r in 0..dots-1)
  //   gapRow r:   vEdge(r,0) box(r,0) vEdge(r,1) box(r,1) ... vEdge(r,boxes)  (for r in 0..boxes-1)
  const rowsOut = [];
  for (let r = 0; r < dots; r++) {
    // dot row
    const dotCells = [];
    for (let c = 0; c < boxes; c++) {
      dotCells.push(<div key={`dot-${r}-${c}`} className={styles.dot} />);
      const taken = edgeTaken('h', r, c);
      const owner = edgeOwner('h', r, c);
      dotCells.push(
        <button
          key={`h-${r}-${c}`}
          type="button"
          className={`${styles.hEdge} ${taken ? styles.filled : ''} ${ownerClass(owner)} ${isPreview('h', r, c) ? styles.preview : ''} ${isLast('h', r, c) ? styles.last : ''}`}
          disabled={!isMyTurn || over || taken}
          onClick={() => tapEdge('h', r, c)}
          aria-label={`horizontal edge row ${r} col ${c}`}
        />
      );
    }
    dotCells.push(<div key={`dot-${r}-${boxes}`} className={styles.dot} />);
    rowsOut.push(<div key={`dotrow-${r}`} className={styles.dotRow}>{dotCells}</div>);

    if (r < boxes) {
      const gapCells = [];
      for (let c = 0; c <= boxes; c++) {
        const taken = edgeTaken('v', r, c);
        const owner = edgeOwner('v', r, c);
        gapCells.push(
          <button
            key={`v-${r}-${c}`}
            type="button"
            className={`${styles.vEdge} ${taken ? styles.filled : ''} ${ownerClass(owner)} ${isPreview('v', r, c) ? styles.preview : ''} ${isLast('v', r, c) ? styles.last : ''}`}
            disabled={!isMyTurn || over || taken}
            onClick={() => tapEdge('v', r, c)}
            aria-label={`vertical edge row ${r} col ${c}`}
          />
        );
        if (c < boxes) {
          const boxOwner = boxOwners[r]?.[c] ?? null;
          gapCells.push(
            <div key={`box-${r}-${c}`} className={`${styles.box} ${ownerClass(boxOwner)} ${boxOwner != null ? styles.boxClaimed : ''}`}>
              {boxOwner != null ? (boxOwner === myId ? 'You' : 'Opp') : ''}
            </div>
          );
        }
      }
      rowsOut.push(<div key={`gaprow-${r}`} className={styles.gapRow}>{gapCells}</div>);
    }
  }

  return (
    <div className={styles.boardWrap}>
      <div className={styles.scoreBar}>
        <span className={`${styles.scoreChip} ${styles.mine}`}>You {myBoxes}</span>
        <span className={`${styles.scoreChip} ${styles.theirs}`}>Opp {oppBoxes}</span>
      </div>

      <div className={styles.grid}>{rowsOut}</div>

      {isMyTurn && !over && (
        <button className={styles.confirmBtn} disabled={!preview} onClick={() => preview && commit(preview.orient, preview.r, preview.c)}>
          {preview ? 'Draw line' : 'Tap a line, then confirm'}
        </button>
      )}
    </div>
  );
}

export default function DotsAndBoxesGame({ gameState, onAction, nicknames, avatars }) {
  if (!gameState) return null;
  return (
    <PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars} onAction={onAction} titleFont="'Fredoka', sans-serif">
      {(myMatch) => <Board myMatch={myMatch} myId={gameState.myId} onAction={onAction} />}
    </PairingShell>
  );
}
