import { useState, useEffect, useRef } from 'react';
import styles from './Battleship.module.css';
import { displayName } from '../utils/displayName.js';

const GRID_SIZE = 10;
const COLS = 'ABCDEFGHIJ'.split('');

function CellLabel({ x, y }) {
  return `${COLS[x]}${y + 1}`;
}

// --- Setup Grid: place ships ---
function SetupGrid({ shipTypes, onConfirm }) {
  const [grid, setGrid] = useState(new Array(100).fill(null));
  const [ships, setShips] = useState([]);
  const [currentShipIdx, setCurrentShipIdx] = useState(0);
  const [horizontal, setHorizontal] = useState(true);
  const [previewCells, setPreviewCells] = useState(null); // { x, y, cells } — tap to preview
  const [hoverCells, setHoverCells] = useState([]);

  const currentShip = shipTypes[currentShipIdx] || null;
  const allPlaced = ships.length === shipTypes.length;

  function getShipCells(x, y, size, horiz) {
    const cells = [];
    for (let i = 0; i < size; i++) {
      const cx = horiz ? x + i : x;
      const cy = horiz ? y : y + i;
      if (cx >= GRID_SIZE || cy >= GRID_SIZE) return null;
      cells.push(cy * GRID_SIZE + cx);
    }
    return cells;
  }

  function handleHover(x, y) {
    if (!currentShip || previewCells) { setHoverCells([]); return; }
    const cells = getShipCells(x, y, currentShip.size, horizontal);
    if (cells && cells.every((c) => grid[c] === null)) {
      setHoverCells(cells);
    } else {
      setHoverCells([]);
    }
  }

  function handleCellTap(x, y) {
    if (!currentShip || allPlaced) return;
    const cells = getShipCells(x, y, currentShip.size, horizontal);
    if (!cells || cells.some((c) => grid[c] !== null)) return;
    // Set preview — user must confirm with Place button
    setPreviewCells({ x, y, cells, horizontal });
    setHoverCells([]);
  }

  function handlePlaceConfirm() {
    if (!previewCells || !currentShip) return;
    const newGrid = [...grid];
    for (const c of previewCells.cells) newGrid[c] = currentShip.type;
    setGrid(newGrid);
    setShips([...ships, { ...currentShip, x: previewCells.x, y: previewCells.y, horizontal: previewCells.horizontal, cells: previewCells.cells }]);
    setCurrentShipIdx(currentShipIdx + 1);
    setPreviewCells(null);
    setHoverCells([]);
  }

  function handleRotate() {
    const newH = !horizontal;
    setHorizontal(newH);
    // Update preview if one exists
    if (previewCells && currentShip) {
      const cells = getShipCells(previewCells.x, previewCells.y, currentShip.size, newH);
      if (cells && cells.every((c) => grid[c] === null)) {
        setPreviewCells({ x: previewCells.x, y: previewCells.y, cells, horizontal: newH });
      } else {
        setPreviewCells(null);
      }
    }
  }

  function handleSubmitAll() {
    if (!allPlaced) return;
    const placements = ships.map((s) => ({ x: s.x, y: s.y, horizontal: s.horizontal }));
    onConfirm(placements);
  }

  function handleReset() {
    setGrid(new Array(100).fill(null));
    setShips([]);
    setCurrentShipIdx(0);
    setPreviewCells(null);
    setHoverCells([]);
  }

  const hoverSet = new Set(hoverCells);
  const previewSet = new Set(previewCells?.cells || []);

  return (
    <div className={styles.setupArea}>
      <div className={styles.setupInfo}>
        {currentShip ? (
          <p className={styles.setupPrompt}>
            Place your <strong>{currentShip.type}</strong> ({currentShip.size} cells)
            {previewCells ? ' — tap Place to confirm' : ' — tap a cell'}
          </p>
        ) : (
          <p className={styles.setupPrompt}>All ships placed! Tap Ready to start.</p>
        )}
        <div className={styles.setupButtons}>
          <button className={styles.btnRotate} onClick={handleRotate}>
            Rotate ({horizontal ? '→' : '↓'})
          </button>
          {previewCells && (
            <button className={styles.btnConfirm} onClick={handlePlaceConfirm}>
              Place Ship
            </button>
          )}
          <button className={styles.btnReset} onClick={handleReset}>Reset</button>
          {allPlaced && (
            <button className={styles.btnConfirm} onClick={handleSubmitAll}>Ready!</button>
          )}
        </div>
      </div>
      <div className={styles.gridContainer}>
        <div className={styles.colHeaders}>
          <div className={styles.cornerCell} />
          {COLS.map((c) => <div key={c} className={styles.headerCell}>{c}</div>)}
        </div>
        {Array.from({ length: GRID_SIZE }, (_, y) => (
          <div key={y} className={styles.gridRow}>
            <div className={styles.rowHeader}>{y + 1}</div>
            {Array.from({ length: GRID_SIZE }, (_, x) => {
              const idx = y * GRID_SIZE + x;
              const hasShip = grid[idx] !== null;
              const isHover = hoverSet.has(idx);
              const isPreview = previewSet.has(idx);
              return (
                <div
                  key={x}
                  className={[
                    styles.cell,
                    hasShip ? styles.cellShip : '',
                    isHover ? styles.cellHover : '',
                    isPreview ? styles.cellPreview : '',
                  ].filter(Boolean).join(' ')}
                  onMouseEnter={() => handleHover(x, y)}
                  onMouseLeave={() => setHoverCells([])}
                  onClick={() => handleCellTap(x, y)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Battle Grid: show hits/misses ---
function BattleGrid({ label, cells, sunkShips, onClick, clickable, fullReveal }) {
  const sunkCells = new Set();
  if (sunkShips) {
    for (const ship of sunkShips) {
      for (const c of ship.cells) sunkCells.add(c);
    }
  }

  return (
    <div className={styles.battleGridWrapper}>
      <h3 className={styles.gridLabel}>{label}</h3>
      <div className={styles.gridContainer}>
        <div className={styles.colHeaders}>
          <div className={styles.cornerCell} />
          {COLS.map((c) => <div key={c} className={styles.headerCell}>{c}</div>)}
        </div>
        {Array.from({ length: GRID_SIZE }, (_, y) => (
          <div key={y} className={styles.gridRow}>
            <div className={styles.rowHeader}>{y + 1}</div>
            {Array.from({ length: GRID_SIZE }, (_, x) => {
              const idx = y * GRID_SIZE + x;
              let cellClass = styles.cell;

              if (typeof cells === 'object' && !Array.isArray(cells)) {
                // Opponent view: cells is shot results { idx: 'hit'|'miss' }
                // Keys may be strings after JSON serialization
                const shotResult = cells[idx] || cells[String(idx)];
                if (shotResult === 'hit') cellClass += ' ' + styles.cellHit;
                else if (shotResult === 'miss') cellClass += ' ' + styles.cellMiss;
                if (sunkCells.has(idx)) cellClass += ' ' + styles.cellSunk;
                if (fullReveal && (fullReveal[idx] || fullReveal[String(idx)])) cellClass += ' ' + styles.cellShipReveal;
              } else if (Array.isArray(cells)) {
                // My board view: cells is array of {ship, hit}
                const c = cells[idx];
                if (c?.ship) cellClass += ' ' + styles.cellShip;
                if (c?.hit && c?.ship) cellClass += ' ' + styles.cellHit;
                else if (c?.hit && !c?.ship) cellClass += ' ' + styles.cellMiss;
              }

              return (
                <div
                  key={x}
                  className={cellClass}
                  onClick={clickable ? () => onClick(idx) : undefined}
                  style={clickable ? { cursor: 'pointer' } : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Battleship({ gameState, onAction, nicknames }) {
  const [timeLeft, setTimeLeft] = useState(0);

  if (!gameState) {
    return (
      <div className={styles.table}>
        <p className={styles.waiting}>Waiting for game to start...</p>
      </div>
    );
  }

  const [selectedTarget, setSelectedTarget] = useState(null);

  const {
    phase, myGrid, myShips, opponents = [], myEliminated,
    isMyTurn, currentTurnPlayer, setupReady,
    setupEndTime, turnEndTime, shipTypes, eliminated = [],
  } = gameState;

  const isSetup = phase === 'setup';
  const isPlaying = phase === 'playing';
  const isFinished = phase === 'finished';

  // Timer countdown
  useEffect(() => {
    const endTime = isSetup ? setupEndTime : turnEndTime;
    if (!endTime) { setTimeLeft(0); return; }
    function tick() {
      setTimeLeft(Math.max(0, Math.ceil((endTime - Date.now()) / 1000)));
    }
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [isSetup, setupEndTime, turnEndTime, isMyTurn]);

  // Ping server if timer hits 0
  const hasPinged = useRef(false);
  useEffect(() => {
    if (timeLeft <= 0 && isPlaying && isMyTurn && !hasPinged.current) {
      hasPinged.current = true;
      onAction({ type: 'ping' });
    }
    if (timeLeft > 0) hasPinged.current = false;
  }, [timeLeft, isPlaying, isMyTurn]);

  function handleConfirmSetup(placements) {
    onAction({ type: 'placeShips', ships: placements });
  }

  // Auto-select first alive opponent
  const aliveOpponents = opponents.filter((o) => !o.eliminated);
  const target = selectedTarget && aliveOpponents.find((o) => o.playerId === selectedTarget)
    ? selectedTarget
    : aliveOpponents[0]?.playerId;
  const targetOpp = opponents.find((o) => o.playerId === target);

  function handleFire(cellIndex) {
    if (!isMyTurn || !target) return;
    const shots = targetOpp?.shots || {};
    if (shots[cellIndex] || shots[String(cellIndex)]) return;
    onAction({ type: 'fire', cell: cellIndex, targetPlayer: target });
  }

  function getStatusText() {
    if (isFinished) return 'Game Over!';
    if (myEliminated) return 'You have been eliminated!';
    if (isSetup) {
      if (setupReady?.me) return `Waiting for others... (${setupReady.count}/${setupReady.total} ready)`;
      return `Place your ships! (${timeLeft}s)`;
    }
    if (isMyTurn) return `Your turn — fire! (${timeLeft}s)`;
    return `Waiting for ${displayName(currentTurnPlayer, nicknames)}...`;
  }

  const oppRevealGrid = isFinished && targetOpp?.fullGrid
    ? targetOpp.fullGrid.reduce((acc, ship, i) => { if (ship) acc[i] = ship; return acc; }, {})
    : null;

  return (
    <div className={styles.table}>
      <h1 className={styles.title}>Battleship</h1>
      <p className={styles.statusText}>{getStatusText()}</p>

      {/* Ship status */}
      {(isPlaying || isFinished) && myShips && (
        <div className={styles.shipStatus}>
          <span className={styles.shipStatusLabel}>Your Fleet:</span>
          {myShips.map((s) => (
            <span key={s.type} className={`${styles.shipBadge} ${s.sunk ? styles.shipSunk : ''}`}>
              <span className={styles.shipName}>{s.type}</span>
              <span className={styles.shipHealth}>
                {Array.from({ length: s.size }, (_, i) => (
                  <span key={i} className={i < s.hits ? styles.shipSegHit : styles.shipSegOk} />
                ))}
              </span>
              {s.sunk && <span className={styles.shipSunkLabel}>SUNK</span>}
            </span>
          ))}
        </div>
      )}

      {/* Setup Phase */}
      {isSetup && !setupReady?.me && shipTypes && (
        <SetupGrid shipTypes={shipTypes} onConfirm={handleConfirmSetup} />
      )}

      {isSetup && setupReady?.me && (
        <p className={styles.waiting}>Ships placed! Waiting for opponent...</p>
      )}

      {/* Playing / Finished Phase */}
      {(isPlaying || isFinished) && (
        <>
          {/* Target selector tabs (if more than 1 opponent) */}
          {opponents.length > 1 && (
            <div className={styles.targetTabs}>
              {opponents.map((opp) => (
                <button
                  key={opp.playerId}
                  className={`${styles.targetTab} ${opp.playerId === target ? styles.targetTabActive : ''} ${opp.eliminated ? styles.targetTabElim : ''}`}
                  onClick={() => setSelectedTarget(opp.playerId)}
                >
                  {displayName(opp.playerId, nicknames)}
                  {opp.eliminated && ' ☠'}
                </button>
              ))}
            </div>
          )}

          <div className={styles.battleArea}>
            <BattleGrid
              label="Your Board"
              cells={myGrid}
              clickable={false}
            />
            {targetOpp && (
              <div className={styles.oppBoardArea}>
                <BattleGrid
                  label={`${displayName(target, nicknames)}'s Board${targetOpp.eliminated ? ' (Eliminated)' : ''}`}
                  cells={targetOpp.shots}
                  sunkShips={targetOpp.sunkShips}
                  onClick={handleFire}
                  clickable={isMyTurn && !targetOpp.eliminated}
                  fullReveal={oppRevealGrid}
                />
                {targetOpp.sunkShips && targetOpp.sunkShips.length > 0 && (
                  <div className={styles.sunkList}>
                    <span className={styles.sunkListLabel}>Sunk:</span>
                    {targetOpp.sunkShips.map((s) => (
                      <span key={s.type} className={styles.sunkShipTag}>{s.type}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
