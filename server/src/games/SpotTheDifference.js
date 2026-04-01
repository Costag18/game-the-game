import { BaseGame } from './BaseGame.js';

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'hexagon', 'cross', 'heart'];
const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#6d4c41'];
const SIZES = ['small', 'medium', 'large'];
const ROTATIONS = [0, 90, 180, 270];
const GRID_SIZE = 36; // 6x6
const TOTAL_ROUNDS = 3;
const ROUND_TIMER_MS = 45000;
const COOLDOWN_MS = 1000;
const DIFFERENCES_PER_ROUND = [5, 7, 9];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomFromExcluding(arr, exclude) {
  const filtered = arr.filter((v) => v !== exclude);
  return filtered.length > 0 ? randomFrom(filtered) : randomFrom(arr);
}

function generateGrid() {
  const grid = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    grid.push({
      shape: randomFrom(SHAPES),
      color: randomFrom(COLORS),
      size: randomFrom(SIZES),
      rotation: randomFrom(ROTATIONS),
    });
  }
  return grid;
}

function deepCloneGrid(grid) {
  return grid.map((cell) => ({ ...cell }));
}

function injectDifferences(original, count) {
  const modified = deepCloneGrid(original);
  const indices = [];
  const available = Array.from({ length: GRID_SIZE }, (_, i) => i);

  // Shuffle and pick N unique indices
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  const picked = available.slice(0, count);

  // Shapes where rotation is invisible (symmetric at all angles)
  const SYMMETRIC_SHAPES = new Set(['circle', 'square', 'cross']);

  for (const idx of picked) {
    const cell = modified[idx];

    // Build valid mutation types for this cell
    const mutations = [0, 1, 2]; // color, shape, size — always valid
    if (!SYMMETRIC_SHAPES.has(cell.shape)) {
      mutations.push(3); // rotation — only for non-symmetric shapes
    }
    const mutationType = mutations[Math.floor(Math.random() * mutations.length)];

    switch (mutationType) {
      case 0: // color swap
        cell.color = randomFromExcluding(COLORS, cell.color);
        break;
      case 1: // shape swap
        cell.shape = randomFromExcluding(SHAPES, cell.shape);
        break;
      case 2: // size change
        cell.size = randomFromExcluding(SIZES, cell.size);
        break;
      case 3: // rotation change
        cell.rotation = randomFromExcluding(ROTATIONS, cell.rotation);
        break;
    }

    indices.push(idx);
  }

  return { modified, differenceIndices: new Set(indices) };
}

export class SpotTheDifference extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'roundEnd', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { endRound: 'roundEnd' },
        roundEnd: { nextRound: 'playing', finish: 'finished' },
      },
    });

    this.round = 0;
    this.originalGrid = [];
    this.modifiedGrid = [];
    this.differenceIndices = new Set();
    this.foundDifferences = new Map(); // index -> { foundBy, order }
    this.scores = {};
    this.roundScores = {};
    this.wrongGuesses = {};
    this.totalWrongGuesses = {};
    this.lastClickTime = {};
    this.acknowledged = new Set();
    this.roundHistory = [];
    this._roundTimer = null;
    this._ackTimer = null;
  }

  /** Set a callback to be called when state changes from a timer (not from handleAction). */
  setOnStateChange(callback) {
    this._onStateChange = callback;
  }

  _emitChange() {
    if (typeof this._onStateChange === 'function') {
      this._onStateChange();
    }
  }

  startGame() {
    for (const p of this.players) {
      this.scores[p] = 0;
      this.totalWrongGuesses[p] = 0;
    }
    this.transition('start');
    this._startRound();
  }

  _startRound() {
    this.round++;
    const diffCount = DIFFERENCES_PER_ROUND[Math.min(this.round - 1, DIFFERENCES_PER_ROUND.length - 1)];

    this.originalGrid = generateGrid();
    const { modified, differenceIndices } = injectDifferences(this.originalGrid, diffCount);
    this.modifiedGrid = modified;
    this.differenceIndices = differenceIndices;
    this.foundDifferences = new Map();
    this.acknowledged = new Set();
    this.roundScores = {};
    this.wrongGuesses = {};
    this.lastClickTime = {};

    for (const p of this.players) {
      this.roundScores[p] = 0;
      this.wrongGuesses[p] = 0;
    }

    // Start round timer
    this._clearTimers();
    this._roundTimer = setTimeout(() => {
      if (this.state === 'playing') {
        this._endRound();
        this._emitChange();
      }
    }, ROUND_TIMER_MS);

    this._roundStartTime = Date.now();
  }

  _endRound() {
    if (this.state !== 'playing') return; // guard against double-call
    this._clearTimers();

    this.roundHistory.push({
      round: this.round,
      totalDifferences: this.differenceIndices.size,
      found: this.foundDifferences.size,
      playerScores: { ...this.roundScores },
    });

    this.transition('endRound');
    this.acknowledged = new Set();

    // Auto-advance after 10 seconds if not all acknowledged
    this._ackTimer = setTimeout(() => {
      if (this.state === 'roundEnd') {
        for (const p of this.players) this.acknowledged.add(p);
        this._advanceAfterRoundEnd();
        this._emitChange();
      }
    }, 10000);
  }

  _advanceAfterRoundEnd() {
    if (this.state !== 'roundEnd') return; // guard against double-call
    this._clearTimers();
    if (this.round >= TOTAL_ROUNDS) {
      this.transition('finish');
    } else {
      this.transition('nextRound');
      this._startRound();
    }
  }

  _clearTimers() {
    if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;

    if (this.state === 'playing') {
      // Safety: if timer should have expired but hasn't transitioned, force it
      if (this._roundStartTime && Date.now() >= this._roundStartTime + ROUND_TIMER_MS) {
        this._endRound();
        // Don't return — fall through so the state broadcast happens in index.js
      } else if (action.type === 'click') {
        this._handleClick(playerId, action.index);
      }
      // ping and other unknown actions are ignored but still trigger state broadcast
    } else if (this.state === 'roundEnd') {
      if (action.type === 'acknowledge') {
        this.acknowledged.add(playerId);
        if (this.players.every((p) => this.acknowledged.has(p))) {
          this._advanceAfterRoundEnd();
        }
      }
    }
  }

  _handleClick(playerId, index) {
    if (typeof index !== 'number' || index < 0 || index >= GRID_SIZE) return;

    // Cooldown check
    const now = Date.now();
    if (now - (this.lastClickTime[playerId] || 0) < COOLDOWN_MS) return;

    // Already found this difference
    if (this.foundDifferences.has(index)) return;

    if (this.differenceIndices.has(index)) {
      // Correct — first finder gets credit
      this.foundDifferences.set(index, {
        foundBy: playerId,
        order: this.foundDifferences.size + 1,
      });
      this.scores[playerId] = (this.scores[playerId] || 0) + 150;
      this.roundScores[playerId] = (this.roundScores[playerId] || 0) + 150;

      // Check if all differences found
      if (this.foundDifferences.size >= this.differenceIndices.size) {
        this._endRound();
      }
    } else {
      // Wrong click
      this.lastClickTime[playerId] = now;
      this.scores[playerId] = (this.scores[playerId] || 0) - 25;
      this.roundScores[playerId] = (this.roundScores[playerId] || 0) - 25;
      this.wrongGuesses[playerId] = (this.wrongGuesses[playerId] || 0) + 1;
      this.totalWrongGuesses[playerId] = (this.totalWrongGuesses[playerId] || 0) + 1;
    }
  }

  getStateForPlayer(playerId) {
    const roundEndTime = this.state === 'playing' && this._roundStartTime
      ? this._roundStartTime + ROUND_TIMER_MS
      : null;

    return {
      phase: this.state,
      round: this.round,
      totalRounds: TOTAL_ROUNDS,
      originalGrid: this.originalGrid,
      modifiedGrid: this.modifiedGrid,
      totalDifferences: this.differenceIndices.size,
      foundCount: this.foundDifferences.size,
      foundDifferences: Array.from(this.foundDifferences.entries()).map(([idx, info]) => ({
        index: idx,
        foundBy: info.foundBy,
        order: info.order,
      })),
      myScore: this.scores[playerId] || 0,
      myRoundScore: this.roundScores[playerId] || 0,
      myWrongGuesses: this.wrongGuesses[playerId] || 0,
      roundEndTime,
      roundDurationSec: ROUND_TIMER_MS / 1000,
      otherPlayers: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        score: this.scores[p] || 0,
        found: Array.from(this.foundDifferences.values()).filter((d) => d.foundBy === p).length,
      })),
      roundHistory: this.roundHistory,
      // Reveal missed differences when round ends or game is finished
      missedDifferences: (this.state === 'roundEnd' || this.state === 'finished')
        ? [...this.differenceIndices].filter((idx) => !this.foundDifferences.has(idx))
        : [],
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const entries = this.players.map((p) => ({
      playerId: p,
      score: this.scores[p] || 0,
      totalFound: Array.from(this.foundDifferences.values()).filter((d) => d.foundBy === p).length,
    }));

    entries.sort((a, b) => b.score - a.score || b.totalFound - a.totalFound);

    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && (e.score < entries[i - 1].score)) {
        placement = i + 1;
      }
      return { ...e, placement };
    });
  }
}
