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

function getShipCells(x, y, size, horizontal) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    const cx = horizontal ? x + i : x;
    const cy = horizontal ? y : y + i;
    if (cx >= GRID_SIZE || cy >= GRID_SIZE) return null;
    cells.push(cy * GRID_SIZE + cx);
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
    this.firedAt = {};      // firedAt[shooterId][targetId] = Set of cells
    this.eliminated = new Set();
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
      this.firedAt[p] = {};
      for (const other of this.players) {
        if (other !== p) this.firedAt[p][other] = new Set();
      }
    }
    this.eliminated = new Set();
    this.setupReady = new Set();
    this.transition('start');

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
    // Pick a random alive opponent and random unfired cell
    const targets = this.players.filter((p) => p !== playerId && !this.eliminated.has(p));
    if (targets.length === 0) return;
    const targetId = targets[Math.floor(Math.random() * targets.length)];
    const fired = this.firedAt[playerId]?.[targetId] || new Set();
    const available = [];
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (!fired.has(i)) available.push(i);
    }
    if (available.length === 0) return;
    const cell = available[Math.floor(Math.random() * available.length)];
    this._processShot(playerId, targetId, cell);
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;

    if (this.state === 'setup') {
      if (action.type === 'placeShips') {
        this._handlePlaceShips(playerId, action.ships);
      }
    } else if (this.state === 'playing') {
      if (this._turnEndTime && Date.now() >= this._turnEndTime) {
        this._autoFire(this.currentTurnPlayer);
        return;
      }
      if (playerId !== this.currentTurnPlayer) return;
      if (action.type === 'fire') {
        const { cell, targetPlayer } = action;
        if (typeof cell !== 'number' || cell < 0 || cell >= TOTAL_CELLS) return;
        if (!targetPlayer || !this.players.includes(targetPlayer)) return;
        if (targetPlayer === playerId) return;
        if (this.eliminated.has(targetPlayer)) return;
        const fired = this.firedAt[playerId]?.[targetPlayer] || new Set();
        if (fired.has(cell)) return;
        this._processShot(playerId, targetPlayer, cell);
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
      if (!cells) return;
      if (cells.some((c) => grid[c] !== null)) return;
      for (const c of cells) grid[c] = shipDef.type;
      placedShips.push({ type: shipDef.type, size: shipDef.size, cells, hits: [] });
    }

    this.boards[playerId] = { grid, ships: placedShips };
    this.setupReady.add(playerId);

    if (this.players.every((p) => this.setupReady.has(p))) {
      this._startPlaying();
    }
  }

  _processShot(shooterId, targetId, cell) {
    if (!this.firedAt[shooterId]) this.firedAt[shooterId] = {};
    if (!this.firedAt[shooterId][targetId]) this.firedAt[shooterId][targetId] = new Set();
    this.firedAt[shooterId][targetId].add(cell);

    const targetBoard = this.boards[targetId];
    const isHit = targetBoard.grid[cell] !== null;

    if (isHit) {
      const ship = targetBoard.ships.find((s) => s.cells.includes(cell));
      if (ship && !ship.hits.includes(cell)) {
        ship.hits.push(cell);
      }

      // Check if this target is eliminated (all ships sunk)
      const allSunk = targetBoard.ships.every((s) => s.hits.length >= s.size);
      if (allSunk) {
        this.eliminated.add(targetId);
        // Check if game over (only 1 alive)
        const alive = this.players.filter((p) => !this.eliminated.has(p));
        if (alive.length <= 1) {
          this._clearTimers();
          this.transition('finish');
          return;
        }
      }

      // Hit = shoot again
      this._startTurnTimer();
    } else {
      // Miss = next alive player's turn
      this._advanceToNextAlive();
      this._startTurnTimer();
    }
  }

  _advanceToNextAlive() {
    const n = this.players.length;
    let idx = this.players.indexOf(this.currentTurnPlayer);
    for (let i = 1; i <= n; i++) {
      const nextIdx = (idx + i) % n;
      const next = this.players[nextIdx];
      if (!this.eliminated.has(next)) {
        this.currentTurnPlayer = next;
        this.turnIndex = nextIdx;
        return;
      }
    }
  }

  getStateForPlayer(playerId) {
    const myBoard = this.boards[playerId];
    const isFinished = this.state === 'finished';

    // My board
    const myGridView = myBoard ? myBoard.grid.map((cell, i) => {
      const wasShot = this.players.some((p) => p !== playerId && this.firedAt[p]?.[playerId]?.has(i));
      return { ship: cell, hit: wasShot };
    }) : [];

    const myShipsStatus = myBoard ? myBoard.ships.map((s) => ({
      type: s.type, size: s.size, cells: s.cells,
      hits: s.hits.length, sunk: s.hits.length >= s.size,
    })) : [];

    // Opponent boards
    const opponents = this.players.filter((p) => p !== playerId).map((oppId) => {
      const oppBoard = this.boards[oppId];
      const fired = this.firedAt[playerId]?.[oppId] || new Set();
      const shotResults = {};
      for (const cell of fired) {
        shotResults[cell] = oppBoard.grid[cell] !== null ? 'hit' : 'miss';
      }
      const sunkShips = oppBoard ? oppBoard.ships
        .filter((s) => s.hits.length >= s.size)
        .map((s) => ({ type: s.type, size: s.size, cells: s.cells }))
        : [];
      const fullGrid = isFinished ? oppBoard.grid : null;

      return {
        playerId: oppId,
        eliminated: this.eliminated.has(oppId),
        shots: shotResults,
        sunkShips,
        fullGrid,
      };
    });

    const turnTimeLeft = this.state === 'playing' && this._turnEndTime
      ? this._turnEndTime : null;

    return {
      phase: this.state,
      myGrid: myGridView,
      myShips: myShipsStatus,
      myEliminated: this.eliminated.has(playerId),
      opponents,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing' && !this.eliminated.has(playerId),
      currentTurnPlayer: this.currentTurnPlayer,
      setupReady: this.state === 'setup' ? {
        me: this.setupReady.has(playerId),
        count: this.setupReady.size,
        total: this.players.length,
      } : null,
      setupEndTime: this.state === 'setup' && this._setupStartTime
        ? this._setupStartTime + SETUP_TIMER_MS : null,
      turnEndTime: turnTimeLeft,
      shipTypes: SHIP_TYPES,
      eliminated: [...this.eliminated],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players.map((p) => {
      const board = this.boards[p];
      const shipsRemaining = board ? board.ships.filter((s) => s.hits.length < s.size).length : 0;
      return { playerId: p, shipsRemaining, eliminated: this.eliminated.has(p) };
    });

    // Sort: non-eliminated first by ships remaining, then eliminated in reverse order
    entries.sort((a, b) => {
      if (a.eliminated && !b.eliminated) return 1;
      if (!a.eliminated && b.eliminated) return -1;
      return b.shipsRemaining - a.shipsRemaining;
    });

    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && (e.eliminated !== entries[i - 1].eliminated || e.shipsRemaining < entries[i - 1].shipsRemaining)) {
        placement = i + 1;
      }
      return {
        ...e, placement,
        handDescription: e.eliminated ? 'Eliminated' : `${e.shipsRemaining} ships left`,
      };
    });
  }
}
