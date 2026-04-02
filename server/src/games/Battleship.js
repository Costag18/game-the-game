import { BaseGame } from './BaseGame.js';

const GRID_SIZE = 10;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const SETUP_TIMER_MS = 60000;
const TURN_TIMER_MS = 30000;

const SHIP_TYPES = [
  { type: 'carrier', size: 5 },
  { type: 'battleship', size: 4 },
  { type: 'cruiser', size: 3 },
  { type: 'submarine', size: 3 },
  { type: 'destroyer', size: 2 },
];

function toIndex(x, y) { return y * GRID_SIZE + x; }
function toXY(index) { return { x: index % GRID_SIZE, y: Math.floor(index / GRID_SIZE) }; }

function getShipCells(x, y, size, horizontal) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    const cx = horizontal ? x + i : x;
    const cy = horizontal ? y : y + i;
    if (cx >= GRID_SIZE || cy >= GRID_SIZE) return null; // out of bounds
    cells.push(toIndex(cx, cy));
  }
  return cells;
}

function autoPlaceShips(existingGrid, shipsToPlace) {
  const grid = [...existingGrid];
  const placed = [];

  for (const ship of shipsToPlace) {
    let attempts = 0;
    while (attempts < 200) {
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(Math.random() * GRID_SIZE);
      const y = Math.floor(Math.random() * GRID_SIZE);
      const cells = getShipCells(x, y, ship.size, horizontal);
      if (cells && cells.every((c) => grid[c] === null)) {
        for (const c of cells) grid[c] = ship.type;
        placed.push({ type: ship.type, size: ship.size, cells, hits: [] });
        break;
      }
      attempts++;
    }
  }
  return { grid, ships: placed };
}

export class Battleship extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'setup', 'playing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'setup' },
        setup: { allReady: 'playing' },
        playing: { finish: 'finished' },
      },
    });

    this.boards = {};
    this.shots = {};      // playerId -> Set of cell indices they've been shot at
    this.firedAt = {};    // playerId -> Set of cell indices they've fired at opponent
    this.setupReady = new Set();
    this._setupTimer = null;
    this._turnTimer = null;
    this._turnEndTime = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  _clearTimers() {
    if (this._setupTimer) { clearTimeout(this._setupTimer); this._setupTimer = null; }
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
  }

  startGame() {
    for (const p of this.players) {
      this.boards[p] = { grid: new Array(TOTAL_CELLS).fill(null), ships: [] };
      this.shots[p] = new Set();
      this.firedAt[p] = new Set();
    }
    this.setupReady = new Set();
    this.transition('start');

    // Setup timer — auto-place remaining ships after 60s
    this._setupTimer = setTimeout(() => {
      if (this.state !== 'setup') return;
      for (const p of this.players) {
        if (!this.setupReady.has(p)) {
          this._autoCompleteSetup(p);
          this.setupReady.add(p);
        }
      }
      this._startPlaying();
      this._emitChange();
    }, SETUP_TIMER_MS);

    this._setupStartTime = Date.now();
  }

  _autoCompleteSetup(playerId) {
    const board = this.boards[playerId];
    const placedTypes = new Set(board.ships.map((s) => s.type));
    const remaining = SHIP_TYPES.filter((s) => !placedTypes.has(s.type));
    const { grid, ships } = autoPlaceShips(board.grid, remaining);
    board.grid = grid;
    board.ships.push(...ships);
  }

  _startPlaying() {
    if (this.state !== 'setup') return;
    this._clearTimers();
    this.transition('allReady');
    this.setTurnPlayer(this.players[0]);
    this._startTurnTimer();
  }

  _startTurnTimer() {
    if (this._turnTimer) clearTimeout(this._turnTimer);
    this._turnEndTime = Date.now() + TURN_TIMER_MS;
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'playing') return;
      this._autoFire(this.currentTurnPlayer);
      this._emitChange();
    }, TURN_TIMER_MS);
  }

  _autoFire(playerId) {
    const opponentId = this.players.find((p) => p !== playerId);
    // Find a cell that hasn't been fired at yet
    const available = [];
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (!this.firedAt[playerId].has(i)) available.push(i);
    }
    if (available.length === 0) return;
    const cell = available[Math.floor(Math.random() * available.length)];
    this._processShot(playerId, cell);
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;

    if (this.state === 'setup') {
      if (action.type === 'placeShips') {
        this._handlePlaceShips(playerId, action.ships);
      }
    } else if (this.state === 'playing') {
      // Safety: auto-fire if turn timer should have expired
      if (this._turnEndTime && Date.now() >= this._turnEndTime) {
        this._autoFire(this.currentTurnPlayer);
        return;
      }
      if (playerId !== this.currentTurnPlayer) return;
      if (action.type === 'fire') {
        const cell = action.cell;
        if (typeof cell !== 'number' || cell < 0 || cell >= TOTAL_CELLS) return;
        if (this.firedAt[playerId].has(cell)) return; // already fired here
        this._processShot(playerId, cell);
      }
    }
  }

  _handlePlaceShips(playerId, ships) {
    if (this.setupReady.has(playerId)) return;
    if (!Array.isArray(ships) || ships.length !== SHIP_TYPES.length) return;

    const grid = new Array(TOTAL_CELLS).fill(null);
    const placedShips = [];

    for (let i = 0; i < SHIP_TYPES.length; i++) {
      const shipDef = SHIP_TYPES[i];
      const placement = ships[i];
      if (!placement || typeof placement.x !== 'number' || typeof placement.y !== 'number') return;

      const horizontal = !!placement.horizontal;
      const cells = getShipCells(placement.x, placement.y, shipDef.size, horizontal);
      if (!cells) return; // out of bounds
      if (cells.some((c) => grid[c] !== null)) return; // overlap

      for (const c of cells) grid[c] = shipDef.type;
      placedShips.push({ type: shipDef.type, size: shipDef.size, cells, hits: [] });
    }

    this.boards[playerId] = { grid, ships: placedShips };
    this.setupReady.add(playerId);

    if (this.players.every((p) => this.setupReady.has(p))) {
      this._startPlaying();
    }
  }

  _processShot(shooterId, cell) {
    const targetId = this.players.find((p) => p !== shooterId);
    this.firedAt[shooterId].add(cell);
    this.shots[targetId].add(cell);

    const targetBoard = this.boards[targetId];
    const isHit = targetBoard.grid[cell] !== null;

    if (isHit) {
      // Find which ship was hit
      const ship = targetBoard.ships.find((s) => s.cells.includes(cell));
      if (ship && !ship.hits.includes(cell)) {
        ship.hits.push(cell);
      }

      // Check if all ships sunk
      const allSunk = targetBoard.ships.every((s) => s.hits.length >= s.size);
      if (allSunk) {
        this._clearTimers();
        this.transition('finish');
        return;
      }

      // Hit = shoot again (restart turn timer)
      this._startTurnTimer();
    } else {
      // Miss = next player's turn
      this.nextTurn();
      this._startTurnTimer();
    }
  }

  getStateForPlayer(playerId) {
    const opponentId = this.players.find((p) => p !== playerId);
    const myBoard = this.boards[playerId];
    const oppBoard = this.boards[opponentId];
    const isFinished = this.state === 'finished';

    // My board: show everything
    const myGridView = myBoard ? myBoard.grid.map((cell, i) => ({
      ship: cell,
      hit: this.shots[playerId]?.has(i) || false,
    })) : [];

    const myShipsStatus = myBoard ? myBoard.ships.map((s) => ({
      type: s.type, size: s.size, cells: s.cells,
      hits: s.hits.length, sunk: s.hits.length >= s.size,
    })) : [];

    // Opponent board: only show my shots and results, plus sunk ship outlines
    const oppShotResults = {};
    if (this.firedAt[playerId]) {
      for (const cell of this.firedAt[playerId]) {
        oppShotResults[cell] = oppBoard.grid[cell] !== null ? 'hit' : 'miss';
      }
    }

    const oppSunkShips = oppBoard ? oppBoard.ships
      .filter((s) => s.hits.length >= s.size)
      .map((s) => ({ type: s.type, size: s.size, cells: s.cells }))
      : [];

    // On finished, reveal opponent's full board
    const oppFullGrid = isFinished && oppBoard ? oppBoard.grid : null;

    const turnTimeLeft = this.state === 'playing' && this._turnEndTime
      ? this._turnEndTime : null;

    return {
      phase: this.state,
      myGrid: myGridView,
      myShips: myShipsStatus,
      opponentShots: oppShotResults,
      opponentSunkShips: oppSunkShips,
      opponentFullGrid: oppFullGrid,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      currentTurnPlayer: this.currentTurnPlayer,
      setupReady: this.state === 'setup' ? {
        me: this.setupReady.has(playerId),
        opponent: this.setupReady.has(opponentId),
      } : null,
      setupEndTime: this.state === 'setup' && this._setupStartTime
        ? this._setupStartTime + SETUP_TIMER_MS : null,
      turnEndTime: turnTimeLeft,
      shipTypes: SHIP_TYPES,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players.map((p) => {
      const board = this.boards[p];
      const shipsRemaining = board ? board.ships.filter((s) => s.hits.length < s.size).length : 0;
      const totalHits = board ? board.ships.reduce((sum, s) => sum + s.hits.length, 0) : 0;
      return { playerId: p, shipsRemaining, totalHits };
    });

    entries.sort((a, b) => b.shipsRemaining - a.shipsRemaining);

    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.shipsRemaining < entries[i - 1].shipsRemaining) {
        placement = i + 1;
      }
      return {
        ...e, placement,
        handDescription: `${e.shipsRemaining} ships left`,
      };
    });
  }
}
