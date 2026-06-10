import { BaseGame } from './BaseGame.js';

const N = 6;            // 6x6 grid
const BOX_ROWS = 2;     // 2x3 boxes
const BOX_COLS = 3;
const ROUND_MS = 150_000; // ~150s solve race
const ACK_MS = 10_000;    // reveal auto-advance

// ---- generator -------------------------------------------------------------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Backtracking fill of a full valid 6x6 sudoku solution. Returns N*N flat array. */
function generateSolution() {
  const grid = new Array(N * N).fill(0);

  const fits = (idx, v) => {
    const r = Math.floor(idx / N);
    const c = idx % N;
    for (let i = 0; i < N; i++) {
      if (grid[r * N + i] === v) return false; // row
      if (grid[i * N + c] === v) return false; // col
    }
    const br = Math.floor(r / BOX_ROWS) * BOX_ROWS;
    const bc = Math.floor(c / BOX_COLS) * BOX_COLS;
    for (let dr = 0; dr < BOX_ROWS; dr++) {
      for (let dc = 0; dc < BOX_COLS; dc++) {
        if (grid[(br + dr) * N + (bc + dc)] === v) return false; // box
      }
    }
    return true;
  };

  const fill = (idx) => {
    if (idx >= N * N) return true;
    for (const v of shuffle([1, 2, 3, 4, 5, 6])) {
      if (fits(idx, v)) {
        grid[idx] = v;
        if (fill(idx + 1)) return true;
        grid[idx] = 0;
      }
    }
    return false;
  };

  fill(0);
  return grid;
}

/**
 * Count solutions of a puzzle (capped at 2 — we only need "unique or not").
 * Used to keep blanked puzzles solvable with a single answer.
 */
function countSolutions(puzzle, cap = 2) {
  const grid = [...puzzle];
  let count = 0;

  const fits = (idx, v) => {
    const r = Math.floor(idx / N);
    const c = idx % N;
    for (let i = 0; i < N; i++) {
      if (i !== c && grid[r * N + i] === v) return false;
      if (i !== r && grid[i * N + c] === v) return false;
    }
    const br = Math.floor(r / BOX_ROWS) * BOX_ROWS;
    const bc = Math.floor(c / BOX_COLS) * BOX_COLS;
    for (let dr = 0; dr < BOX_ROWS; dr++) {
      for (let dc = 0; dc < BOX_COLS; dc++) {
        const j = (br + dr) * N + (bc + dc);
        if (j !== idx && grid[j] === v) return false;
      }
    }
    return true;
  };

  const solve = (start) => {
    let idx = start;
    while (idx < N * N && grid[idx] !== 0) idx++;
    if (idx >= N * N) { count++; return; }
    for (let v = 1; v <= 6 && count < cap; v++) {
      if (fits(idx, v)) {
        grid[idx] = v;
        solve(idx + 1);
        grid[idx] = 0;
      }
    }
  };

  solve(0);
  return count;
}

/**
 * Build a puzzle (givens) from a full solution by blanking cells while keeping a
 * unique solution. `targetBlanks` is a soft goal — we stop early if we can't keep
 * uniqueness. Returns { givens } where givens[idx] is the digit or 0 if blank.
 */
function makePuzzle(solution, targetBlanks = 18) {
  const givens = [...solution];
  const order = shuffle(Array.from({ length: N * N }, (_, i) => i));
  let blanked = 0;
  for (const idx of order) {
    if (blanked >= targetBlanks) break;
    const saved = givens[idx];
    givens[idx] = 0;
    if (countSolutions(givens, 2) === 1) {
      blanked++;
    } else {
      givens[idx] = saved; // restore — removing it broke uniqueness
    }
  }
  return givens;
}

function emptyBoard() {
  return { entries: {}, solved: false, solvedAtMs: null, correctCount: 0 };
}

/**
 * Sudoku Sixer — a 6x6 mini-sudoku solve-race. The server GENERATES one full valid
 * solution (rows/cols/2x3 boxes each hold 1..6), blanks cells to make a uniquely
 * solvable PUZZLE, and every player races to fill the same puzzle on their own grid.
 *
 * Server-authoritative anti-cheat: the full solution lives ONLY in the FSM and is
 * NEVER serialized before reveal. getStateForPlayer sends the givens + the player's
 * own entries + opponents' correct-cell COUNT only (never their grid). Every move is
 * validated server-side; a 'solved' is decided by the server comparing to its
 * solution — a client can never claim a solve it didn't make. FINISH ORDER ranks
 * solvers; the ~150s timer ends the round and non-solvers rank by correct-cell count.
 */
export class SudokuSixer extends BaseGame {
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
    this.solution = [];        // server-only full answer (length 36)
    this.givens = [];          // puzzle clues sent to clients (0 = blank)
    this.boards = {};          // per-player entries + progress
    this.done = new Set();     // players who solved (finish order tracked by solvedAtMs)
    this.solveOrder = [];      // playerIds in the order they solved
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
    this.solution = generateSolution();
    this.givens = makePuzzle(this.solution);
    this._roundStartMs = Date.now();
    this.boards = {};
    for (const p of this.players) this.boards[p] = emptyBoard();
    this.done = new Set();
    this.solveOrder = [];
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

  // ---- helpers --------------------------------------------------------------

  _isGiven(idx) { return this.givens[idx] !== 0; }

  /** Recompute a board's correct-cell count + solved flag against the solution. */
  _recompute(playerId) {
    const board = this.boards[playerId];
    if (!board) return;
    let correct = 0;
    for (let idx = 0; idx < N * N; idx++) {
      const val = this._isGiven(idx) ? this.givens[idx] : board.entries[idx];
      if (val === this.solution[idx]) correct++;
    }
    board.correctCount = correct;
    if (correct === N * N && !board.solved) {
      board.solved = true;
      board.solvedAtMs = Date.now();
      this.done.add(playerId);
      this.solveOrder.push(playerId);
    }
  }

  // ---- actions --------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'playing') {
      if (type === 'place') {
        if (this.done.has(playerId)) return;
        const board = this.boards[playerId];
        if (!board) return;
        const row = Number(action.row);
        const col = Number(action.col);
        if (!Number.isInteger(row) || !Number.isInteger(col)) return;
        if (row < 0 || row >= N || col < 0 || col >= N) return;
        const idx = row * N + col;
        if (this._isGiven(idx)) return; // cannot overwrite a given

        const value = action.value;
        if (value === 0 || value === null) {
          delete board.entries[idx]; // clear the cell
        } else {
          if (!Number.isInteger(value) || value < 1 || value > N) return;
          board.entries[idx] = value;
        }
        this._recompute(playerId);
        this._checkRoundEnd();
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

  _checkRoundEnd() {
    if (this.state !== 'playing') return;
    // end early once everyone present has solved
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

  // ---- leave / teardown -----------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.boards[playerId];
    if (this.done) this.done.delete(playerId);
    if (this.solveOrder) this.solveOrder = this.solveOrder.filter((p) => p !== playerId);
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'playing') {
      if (this.players.every((p) => this.done.has(p))) this._endRound();
    } else if (this.state === 'reveal') {
      this._checkRevealComplete();
    }
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---- state / results ------------------------------------------------------

  getStateForPlayer(playerId) {
    const board = this.boards[playerId] || emptyBoard();
    const revealed = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      size: N,
      boxRows: BOX_ROWS,
      boxCols: BOX_COLS,
      givens: [...this.givens],                 // puzzle clues (safe — not the solution)
      myEntries: { ...board.entries },          // my own fills
      myCorrectCount: board.correctCount,
      mySolved: board.solved,
      myDone: this.done.has(playerId),
      filledCells: N * N,
      roundEndMs: this.state === 'playing' ? this._roundStartMs + ROUND_MS : null,
      roundDurationSec: ROUND_MS / 1000,
      opponents: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        solved: (this.boards[p] && this.boards[p].solved) || false,
        correctCount: (this.boards[p] && this.boards[p].correctCount) || 0,
      })),
      solution: revealed ? [...this.solution] : null, // ONLY at reveal
      results: revealed ? this.getResults() : null,
      acknowledged: [...this.acknowledged],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const solveRank = {};
    this.solveOrder.forEach((p, i) => { solveRank[p] = i; });

    const cmp = (a, b) => {
      if (a.solved !== b.solved) return (b.solved ? 1 : 0) - (a.solved ? 1 : 0);
      if (a.solved) return a.solveRank - b.solveRank; // earlier solver first
      if (a.correctCount !== b.correctCount) return b.correctCount - a.correctCount;
      return 0; // equal progress -> tie
    };

    const entries = this.players.map((p) => {
      const b = this.boards[p] || emptyBoard();
      return {
        playerId: p,
        solved: b.solved,
        correctCount: b.correctCount,
        solvedAtMs: b.solvedAtMs,
        solveRank: solveRank[p] != null ? solveRank[p] : Infinity,
      };
    });
    entries.sort(cmp);

    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && cmp(entries[i - 1], e) < 0) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        solved: e.solved,
        correctCount: e.correctCount,
        handDescription: e.solved
          ? `Solved (#${e.solveRank + 1})`
          : `${e.correctCount}/${N * N} cells`,
      };
    });
  }
}
