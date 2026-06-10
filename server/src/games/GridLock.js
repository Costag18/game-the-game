import { BaseGame } from './BaseGame.js';

const N = 4;                 // 4x4 board
const SIZE = N * N;          // 16 cells (0..14 are tiles 1..15, BLANK is the hole)
const BLANK = 0;             // the empty slot value
const SCRAMBLE_MOVES = 80;   // legal random slides from solved => guaranteed solvable
const ROUND_MS = 120_000;    // ~120s overall race timer
const ACK_MS = 10_000;       // reveal auto-advance

// The solved board: [1,2,3,...,15,0]
function solvedBoard() {
  const b = [];
  for (let i = 1; i < SIZE; i++) b.push(i);
  b.push(BLANK);
  return b;
}

function isSolved(board) {
  for (let i = 0; i < SIZE - 1; i++) if (board[i] !== i + 1) return false;
  return board[SIZE - 1] === BLANK;
}

// Count tiles NOT in their solved position (the blank doesn't count).
function tilesOutOfPlace(board) {
  let out = 0;
  for (let i = 0; i < SIZE; i++) {
    const v = board[i];
    if (v === BLANK) continue;
    if (v !== i + 1) out++;
  }
  return out;
}
function tilesCorrect(board) {
  return (SIZE - 1) - tilesOutOfPlace(board);
}

// Indices orthogonally adjacent to `idx` on the 4x4 grid.
function neighbors(idx) {
  const r = Math.floor(idx / N);
  const c = idx % N;
  const out = [];
  if (r > 0) out.push(idx - N);
  if (r < N - 1) out.push(idx + N);
  if (c > 0) out.push(idx - 1);
  if (c < N - 1) out.push(idx + 1);
  return out;
}

// Produce a solvable scramble by applying random legal blank-swaps to a solved
// board. Sliding a tile is just swapping it with an adjacent blank, so any
// sequence of these keeps the board solvable. Guards against ending solved.
function makeScramble() {
  const board = solvedBoard();
  let blank = SIZE - 1;
  let prev = -1;
  for (let i = 0; i < SCRAMBLE_MOVES; i++) {
    const opts = neighbors(blank).filter((n) => n !== prev);
    const pick = opts[Math.floor(Math.random() * opts.length)];
    board[blank] = board[pick];
    board[pick] = BLANK;
    prev = blank;
    blank = pick;
  }
  if (isSolved(board)) {
    // astronomically unlikely; nudge with one more legal slide
    const opts = neighbors(blank);
    const pick = opts[0];
    board[blank] = board[pick];
    board[pick] = BLANK;
  }
  return board;
}

function emptyBoardState(scramble) {
  return {
    board: [...scramble],
    moves: 0,
    solved: false,
    solvedAtMs: null,
    solveOrder: null,
  };
}

/**
 * Grid Lock — a 15-puzzle (4x4 sliding tiles) race. The server generates ONE
 * shared solvable scramble and hands every player their own private copy. A move
 * {type:'slide', tile} slides a tile orthogonally adjacent to the blank into the
 * blank; the server validates adjacency and applies it to ITS copy of that
 * player's board, so a client can never fake a solve. A board is solved when the
 * tiles read 1..15 then the blank. Finish order of solvers = placement; when the
 * game ends (all solved OR the ~120s timer) the remaining players are ranked by
 * fewest tiles out of place. Ties share a placement.
 *
 * Timer-driven (the overall round timer fires from setTimeout), so every timer
 * callback pairs with `_emitChange()` per the v2.7.0 broadcast contract. The
 * scramble is sent to everyone (it's the shared puzzle), but a player only ever
 * sees their OWN board — opponents expose solved status + tilesCorrect only.
 */
export class GridLock extends BaseGame {
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
    this.scramble = [];
    this.boards = {};
    this.done = new Set();        // players who can no longer act (solved)
    this.acknowledged = new Set();
    this._solveCounter = 0;       // increments per solver -> finish order
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
    this.scramble = makeScramble();
    this._roundStartMs = Date.now();
    this.boards = {};
    for (const p of this.players) this.boards[p] = emptyBoardState(this.scramble);
    this.done = new Set();
    this._solveCounter = 0;
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
      if (type === 'slide') {
        if (this.done.has(playerId)) return;
        const board = this.boards[playerId];
        if (!board) return;
        const tile = action.tile;
        if (!Number.isInteger(tile) || tile < 1 || tile > SIZE - 1) return; // tile value 1..15
        const tileIdx = board.board.indexOf(tile);
        const blankIdx = board.board.indexOf(BLANK);
        if (tileIdx < 0 || blankIdx < 0) return;
        // The tile must be orthogonally adjacent to the blank to slide in.
        if (!neighbors(blankIdx).includes(tileIdx)) return;
        // Apply the slide on the SERVER's copy.
        board.board[blankIdx] = tile;
        board.board[tileIdx] = BLANK;
        board.moves++;
        if (isSolved(board.board)) {
          board.solved = true;
          board.solvedAtMs = Date.now();
          board.solveOrder = ++this._solveCounter;
          this.done.add(playerId);
          this._checkRoundEnd();
        }
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
    // Round ends once every present player has solved.
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

  getStateForPlayer(playerId) {
    const board = this.boards[playerId] || emptyBoardState(this.scramble);
    const revealed = this.state === 'reveal' || this.state === 'finished';
    const blankIdx = board.board.indexOf(BLANK);
    return {
      phase: this.state,
      myId: playerId,
      gridSize: N,
      scramble: [...this.scramble],         // shared puzzle (everyone starts here)
      myBoard: [...board.board],            // my OWN board only
      myBlankIndex: blankIdx,
      myMoves: board.moves,
      mySolved: board.solved,
      myDone: this.done.has(playerId),
      myTilesCorrect: tilesCorrect(board.board),
      totalTiles: SIZE - 1,
      roundEndMs: this.state === 'playing' ? this._roundStartMs + ROUND_MS : null,
      roundDurationSec: ROUND_MS / 1000,
      opponents: this.players.filter((p) => p !== playerId).map((p) => {
        const b = this.boards[p] || emptyBoardState(this.scramble);
        return {
          playerId: p,
          solved: b.solved,
          moves: b.moves,
          tilesCorrect: tilesCorrect(b.board),
        };
      }),
      results: revealed ? this.getResults() : null,
      acknowledged: [...this.acknowledged],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const cmp = (a, b) => {
      if (a.solved !== b.solved) return (b.solved ? 1 : 0) - (a.solved ? 1 : 0);
      if (a.solved) {
        // earlier solver (lower solveOrder) ranks first
        return (a.solveOrder || 0) - (b.solveOrder || 0);
      }
      // non-solvers: fewer tiles out of place first, then fewer moves
      if (a.tilesOut !== b.tilesOut) return a.tilesOut - b.tilesOut;
      return a.moves - b.moves;
    };
    const entries = this.players.map((p) => {
      const b = this.boards[p] || emptyBoardState(this.scramble);
      return {
        playerId: p,
        solved: b.solved,
        solveOrder: b.solveOrder,
        moves: b.moves,
        tilesOut: tilesOutOfPlace(b.board),
        tilesCorrect: tilesCorrect(b.board),
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
        moves: e.moves,
        tilesCorrect: e.tilesCorrect,
        handDescription: e.solved
          ? `Solved in ${e.moves} moves`
          : `${e.tilesCorrect}/${SIZE - 1} tiles placed`,
      };
    });
  }
}
