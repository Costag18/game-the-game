import { BaseGame } from './BaseGame.js';

const GRID = 8;                // NxN nonogram
const FILL_MIN = 0.42;         // target fill ratio range
const FILL_MAX = 0.56;
const ROUND_MS = 120_000;      // 120s solve race
const ACK_MS = 10_000;         // reveal auto-advance

/**
 * Build run-length CLUES for a line (array of 0/1). e.g. [1,1,0,1] -> [2,1].
 * An all-empty line yields [0] so the client can render a clear "0" clue.
 */
function lineClues(line) {
  const runs = [];
  let run = 0;
  for (const v of line) {
    if (v) run++;
    else if (run > 0) { runs.push(run); run = 0; }
  }
  if (run > 0) runs.push(run);
  return runs.length ? runs : [0];
}

/**
 * Generate a random bitmap (GRID x GRID, ~FILL_MIN..FILL_MAX filled) and derive its
 * row + column clues. Guarantees at least one filled cell so the picture is non-empty.
 */
function generatePuzzle() {
  const target = FILL_MIN + Math.random() * (FILL_MAX - FILL_MIN);
  let bitmap;
  do {
    bitmap = Array.from({ length: GRID }, () =>
      Array.from({ length: GRID }, () => (Math.random() < target ? 1 : 0)),
    );
  } while (bitmap.every((row) => row.every((c) => c === 0)));

  const rowClues = bitmap.map((row) => lineClues(row));
  const colClues = [];
  for (let c = 0; c < GRID; c++) colClues.push(lineClues(bitmap.map((row) => row[c])));

  let filledCount = 0;
  for (const row of bitmap) for (const v of row) if (v) filledCount++;

  return { bitmap, rowClues, colClues, filledCount };
}

function emptyBoard() {
  // marks: 0 = blank, 1 = filled, -1 = marked-empty (a guess that a cell is NOT part of the picture)
  return {
    marks: Array.from({ length: GRID }, () => Array(GRID).fill(0)),
    solved: false,
    solvedAtMs: null,
  };
}

/**
 * Nonogram Dash — a Picross solve-race. The server generates ONE random bitmap and
 * derives the row/column clues; every player solves the SAME puzzle on their own grid
 * and races to reproduce the hidden picture. Fully server-authoritative anti-cheat:
 * the bitmap NEVER leaves the server before reveal (only the clues are sent); a "solve"
 * is verified server-side by comparing the player's FILLED cells to the bitmap — a
 * client can never claim a solve it didn't make. An opponent's grid is never serialized;
 * the leaderboard exposes only solved + percent-correct.
 *
 * Finish order = placement (1st solver is 1st). Non-solvers at the 120s timer rank by
 * correct-cell count. Timer-driven transitions all pair with `_emitChange()` per the
 * v2.7.0 broadcast contract.
 */
export class NonogramDash extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { endRound: 'reveal' },
        reveal: { finish: 'finished' },
      },
    });
    this.bitmap = [];
    this.rowClues = [];
    this.colClues = [];
    this.filledCount = 0;
    this.boards = {};
    this.solveOrder = [];          // playerIds in the order they solved (= placement order)
    this.done = new Set();         // players who have solved (out of the race)
    this.acknowledged = new Set();
    this._roundStartMs = 0;
    this._roundTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.transition('start'); // -> onEnterPlaying
  }

  onEnterPlaying() {
    const puzzle = generatePuzzle();
    this.bitmap = puzzle.bitmap;
    this.rowClues = puzzle.rowClues;
    this.colClues = puzzle.colClues;
    this.filledCount = puzzle.filledCount;
    this.boards = {};
    for (const p of this.players) this.boards[p] = emptyBoard();
    this.solveOrder = [];
    this.done = new Set();
    this._roundStartMs = Date.now();
    this._clearTimers();
    this._roundTimer = setTimeout(() => {
      if (this.state === 'playing') { this._endRound(); this._emitChange(); }
    }, ROUND_MS);
  }

  onEnterReveal() {
    this._clearTimers();
    this.acknowledged = new Set();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._checkRevealComplete();
      this._emitChange();
    }, ACK_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'playing') {
      if (type === 'mark') {
        if (this.done.has(playerId)) return; // already solved — locked
        const board = this.boards[playerId];
        if (!board) return;
        const { row, col } = action;
        if (!Number.isInteger(row) || !Number.isInteger(col)) return;
        if (row < 0 || row >= GRID || col < 0 || col >= GRID) return;
        let next;
        if (action.state === 'filled') next = 1;
        else if (action.state === 'empty') next = -1;
        else if (action.state === 'blank') next = 0;
        else return;
        board.marks[row][col] = next;
        this._checkSolved(playerId);
      } else if (type === 'ping') {
        if (Date.now() >= this._roundStartMs + ROUND_MS) this._endRound();
      }
    } else if (this.state === 'reveal') {
      if (type === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealComplete();
      }
    }
  }

  /** A board is solved when its FILLED cells exactly match the bitmap's filled cells. */
  _checkSolved(playerId) {
    const board = this.boards[playerId];
    if (!board || board.solved) return;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const wantsFilled = this.bitmap[r][c] === 1;
        const isFilled = board.marks[r][c] === 1;
        if (wantsFilled !== isFilled) return; // not yet solved
      }
    }
    board.solved = true;
    board.solvedAtMs = Date.now();
    this.done.add(playerId);
    this.solveOrder.push(playerId);
    this._checkRoundEnd();
  }

  /** Count cells correct against the bitmap (filled matches filled, empty matches empty). */
  _correctCount(playerId) {
    const board = this.boards[playerId];
    if (!board) return 0;
    let correct = 0;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const wantsFilled = this.bitmap[r][c] === 1;
        const isFilled = board.marks[r][c] === 1;
        if (wantsFilled === isFilled) correct++;
      }
    }
    return correct;
  }

  _percentCorrect(playerId) {
    const total = GRID * GRID;
    return Math.round((this._correctCount(playerId) / total) * 100);
  }

  _checkRoundEnd() {
    if (this.state !== 'playing') return;
    if (this.players.length > 0 && this.players.every((p) => this.done.has(p))) this._endRound();
  }

  _endRound() {
    if (this.state !== 'playing') return; // guard double-call
    this._clearTimers();
    this.transition('endRound'); // -> onEnterReveal
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (!this.players.every((p) => this.acknowledged.has(p))) return;
    this._clearTimers();
    this.transition('finish');
  }

  _clearTimers() {
    if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
  }

  removePlayer(playerId) {
    super.removePlayer(playerId);
    delete this.boards[playerId];
    if (this.done) this.done.delete(playerId);
    if (this.acknowledged) this.acknowledged.delete(playerId);
    this.solveOrder = this.solveOrder.filter((p) => p !== playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'playing') {
      this._checkRoundEnd();
    } else if (this.state === 'reveal') {
      this._checkRevealComplete();
    }
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  getStateForPlayer(playerId) {
    const board = this.boards[playerId] || emptyBoard();
    const revealed = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      grid: GRID,
      rowClues: this.rowClues.map((r) => [...r]),
      colClues: this.colClues.map((c) => [...c]),
      filledCount: this.filledCount,
      roundEndMs: this.state === 'playing' ? this._roundStartMs + ROUND_MS : null,
      roundDurationSec: ROUND_MS / 1000,
      myMarks: board.marks.map((r) => [...r]),
      mySolved: board.solved,
      myDone: this.done.has(playerId),
      myCorrect: this._correctCount(playerId),
      myPercent: this._percentCorrect(playerId),
      mySolveRank: board.solved ? this.solveOrder.indexOf(playerId) + 1 : null,
      opponents: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        solved: (this.boards[p] && this.boards[p].solved) || false,
        percent: this._percentCorrect(p),
      })),
      solution: revealed ? this.bitmap.map((r) => [...r]) : null,
      results: revealed ? this.getResults() : null,
      acknowledged: [...this.acknowledged],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Solvers first, ranked by finish order; non-solvers by correct-cell count (then time-agnostic tie).
    const cmp = (a, b) => {
      if (a.solved !== b.solved) return (b.solved ? 1 : 0) - (a.solved ? 1 : 0);
      if (a.solved) return a.order - b.order;              // earlier solver ranks higher
      return b.correct - a.correct;                        // more correct cells ranks higher
    };
    const entries = this.players.map((p) => {
      const b = this.boards[p] || emptyBoard();
      const order = b.solved ? this.solveOrder.indexOf(p) : Infinity;
      return {
        playerId: p,
        solved: b.solved,
        order: order < 0 ? Infinity : order,
        correct: this._correctCount(p),
      };
    });
    entries.sort(cmp);
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && cmp(entries[i - 1], e) < 0) placement = i + 1;
      const pct = Math.round((e.correct / (GRID * GRID)) * 100);
      return {
        playerId: e.playerId,
        placement,
        solved: e.solved,
        correct: e.correct,
        handDescription: e.solved ? `Solved (#${e.order + 1})` : `${pct}% correct`,
      };
    });
  }
}
