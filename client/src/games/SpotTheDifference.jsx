import { useState, useEffect, useRef } from 'react';
import styles from './SpotTheDifference.module.css';
import { displayName } from '../utils/displayName.js';

const GRID_COLS = 6;

function ShapeIcon({ shape, color, size, rotation }) {
  const sizeMap = { small: 20, medium: 30, large: 40 };
  const s = sizeMap[size] || 30;
  const half = s / 2;

  const transform = rotation ? `rotate(${rotation} ${half} ${half})` : undefined;

  const shapeEl = (() => {
    switch (shape) {
      case 'circle':
        return <circle cx={half} cy={half} r={half * 0.8} fill={color} />;
      case 'square':
        return <rect x={s * 0.1} y={s * 0.1} width={s * 0.8} height={s * 0.8} fill={color} />;
      case 'triangle':
        return <polygon points={`${half},${s * 0.1} ${s * 0.9},${s * 0.9} ${s * 0.1},${s * 0.9}`} fill={color} />;
      case 'diamond':
        return <polygon points={`${half},${s * 0.05} ${s * 0.95},${half} ${half},${s * 0.95} ${s * 0.05},${half}`} fill={color} />;
      case 'star': {
        const pts = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? half * 0.85 : half * 0.4;
          const angle = (Math.PI / 5) * i - Math.PI / 2;
          pts.push(`${half + r * Math.cos(angle)},${half + r * Math.sin(angle)}`);
        }
        return <polygon points={pts.join(' ')} fill={color} />;
      }
      case 'hexagon': {
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          pts.push(`${half + half * 0.85 * Math.cos(angle)},${half + half * 0.85 * Math.sin(angle)}`);
        }
        return <polygon points={pts.join(' ')} fill={color} />;
      }
      case 'cross':
        return (
          <>
            <rect x={s * 0.35} y={s * 0.1} width={s * 0.3} height={s * 0.8} rx={2} fill={color} />
            <rect x={s * 0.1} y={s * 0.35} width={s * 0.8} height={s * 0.3} rx={2} fill={color} />
          </>
        );
      case 'heart': {
        const d = `M ${half} ${s * 0.85} C ${s * 0.1} ${s * 0.55}, ${s * 0.1} ${s * 0.2}, ${half} ${s * 0.35} C ${s * 0.9} ${s * 0.2}, ${s * 0.9} ${s * 0.55}, ${half} ${s * 0.85} Z`;
        return <path d={d} fill={color} />;
      }
      default:
        return <circle cx={half} cy={half} r={half * 0.8} fill={color} />;
    }
  })();

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className={styles.shapeIcon}>
      <g transform={transform}>{shapeEl}</g>
    </svg>
  );
}

function GridCell({ cell, index, onClick, found, foundByMe, missed, wrongFlash }) {
  const cls = [
    styles.cell,
    found ? styles.cellFound : '',
    foundByMe ? styles.cellFoundByMe : '',
    missed ? styles.cellMissed : '',
    wrongFlash ? styles.cellWrong : '',
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} onClick={() => onClick(index)} disabled={found || missed}>
      <ShapeIcon shape={cell.shape} color={cell.color} size={cell.size} rotation={cell.rotation} />
      {found && <span className={styles.checkmark}>&#10003;</span>}
      {missed && <span className={styles.missedMark}>!</span>}
    </button>
  );
}

function PuzzleGrid({ label, grid, onCellClick, foundSet, foundByMeSet, missedSet, wrongFlashIdx }) {
  return (
    <div className={styles.gridWrapper}>
      <h3 className={styles.gridLabel}>{label}</h3>
      <div className={styles.grid}>
        {grid.map((cell, i) => (
          <GridCell
            key={i}
            cell={cell}
            index={i}
            onClick={onCellClick}
            found={foundSet.has(i)}
            foundByMe={foundByMeSet.has(i)}
            missed={missedSet.has(i)}
            wrongFlash={wrongFlashIdx === i}
          />
        ))}
      </div>
    </div>
  );
}

export default function SpotTheDifference({ gameState, onAction, nicknames }) {
  const [wrongFlash, setWrongFlash] = useState(null);
  const [acked, setAcked] = useState(false);
  const flashTimer = useRef(null);

  const [showContinue, setShowContinue] = useState(false);

  // Reset ack when phase changes
  const prevPhase = useRef(null);
  useEffect(() => {
    if (gameState?.phase !== prevPhase.current) {
      setAcked(false);
      setShowContinue(false);
      prevPhase.current = gameState?.phase;

      // Delay showing Continue button so players can see missed differences
      if (gameState?.phase === 'roundEnd') {
        const t = setTimeout(() => setShowContinue(true), 3000);
        return () => clearTimeout(t);
      }
    }
  }, [gameState?.phase]);

  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const {
    phase,
    round,
    totalRounds,
    originalGrid,
    modifiedGrid,
    totalDifferences,
    foundCount,
    foundDifferences,
    myScore,
    myRoundScore,
    myWrongGuesses,
    roundEndTime,
    roundDurationSec,
    otherPlayers,
    missedDifferences,
  } = gameState;

  const isFinished = phase === 'finished';
  const isPlaying = phase === 'playing';
  const isRoundEnd = phase === 'roundEnd';

  // Local countdown timer
  const [timeLeft, setTimeLeft] = useState(roundDurationSec || 0);
  const hasPinged = useRef(false);
  useEffect(() => {
    if (!isPlaying || !roundEndTime) { setTimeLeft(0); hasPinged.current = false; return; }
    hasPinged.current = false;
    function tick() {
      const remaining = Math.max(0, Math.ceil((roundEndTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      // If timer hit 0 and server hasn't transitioned yet, send a ping to nudge it
      if (remaining <= 0 && !hasPinged.current) {
        hasPinged.current = true;
        onAction({ type: 'ping' });
      }
    }
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [isPlaying, roundEndTime, onAction]);

  // Build found/missed sets
  const foundSet = new Set(foundDifferences.map((d) => d.index));
  const foundByMeSet = new Set(
    foundDifferences.filter((d) => !otherPlayers.some((p) => p.playerId === d.foundBy)).map((d) => d.index)
  );
  const missedSet = new Set(missedDifferences || []);

  function handleCellClick(index) {
    if (!isPlaying) return;
    if (foundSet.has(index)) return;

    onAction({ type: 'click', index });

    // Optimistic wrong flash (server will confirm)
    if (!foundSet.has(index)) {
      setWrongFlash(index);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setWrongFlash(null), 500);
    }
  }

  function handleAcknowledge() {
    setAcked(true);
    onAction({ type: 'acknowledge' });
  }

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Spot the Difference</h1>

      {/* Header */}
      <div className={styles.header}>
        <span className={styles.roundInfo}>Round {round}/{totalRounds}</span>
        {isPlaying && <span className={styles.timer}>{timeLeft}s</span>}
        <span className={styles.progress}>Found: {foundCount}/{totalDifferences}</span>
      </div>

      {/* Score bar */}
      <div className={styles.scoreBar}>
        <span className={styles.myScore}>Score: {myScore}</span>
        <span className={styles.roundScore}>
          Round: <span className={myRoundScore >= 0 ? styles.positive : styles.negative}>
            {myRoundScore >= 0 ? `+${myRoundScore}` : myRoundScore}
          </span>
        </span>
        {myWrongGuesses > 0 && (
          <span className={styles.wrongCount}>{myWrongGuesses} wrong</span>
        )}
      </div>

      {/* Puzzles */}
      {(isPlaying || isRoundEnd || isFinished) && originalGrid && modifiedGrid && (
        <div className={styles.puzzleArea}>
          <PuzzleGrid
            label="Original"
            grid={originalGrid}
            onCellClick={handleCellClick}
            foundSet={foundSet}
            foundByMeSet={foundByMeSet}
            missedSet={missedSet}
            wrongFlashIdx={wrongFlash}
          />
          <PuzzleGrid
            label="Modified"
            grid={modifiedGrid}
            onCellClick={handleCellClick}
            foundSet={foundSet}
            foundByMeSet={foundByMeSet}
            missedSet={missedSet}
            wrongFlashIdx={wrongFlash}
          />
        </div>
      )}

      {/* Other players */}
      {otherPlayers && otherPlayers.length > 0 && (
        <div className={styles.otherPlayers}>
          {otherPlayers.map((p) => (
            <div key={p.playerId} className={styles.otherPlayer}>
              <span className={styles.otherName}>{displayName(p.playerId, nicknames)}</span>
              <span className={styles.otherScore}>{p.score} pts</span>
              <span className={styles.otherFound}>{p.found} found</span>
            </div>
          ))}
        </div>
      )}

      {/* Round end */}
      {isRoundEnd && (
        <div className={styles.roundEndBox}>
          <h2 className={styles.roundEndTitle}>Round {round} Complete!</h2>
          <p className={styles.roundEndInfo}>
            Found {foundCount} of {totalDifferences} differences
          </p>
          {!acked ? (
            showContinue ? (
              <button className={styles.btnContinue} onClick={handleAcknowledge}>
                Continue
              </button>
            ) : (
              <p className={styles.waitingSmall}>Reviewing missed differences...</p>
            )
          ) : (
            <p className={styles.waitingSmall}>Waiting for others...</p>
          )}
        </div>
      )}

      {/* Final results */}
      {isFinished && (
        <div className={styles.roundEndBox}>
          <h2 className={styles.roundEndTitle}>Game Over!</h2>
          <p className={styles.roundEndInfo}>Final Score: {myScore}</p>
        </div>
      )}
    </div>
  );
}
