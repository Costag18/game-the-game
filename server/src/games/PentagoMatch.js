export const SIZE = 6;       // 6x6 board, cells 0..35 row-major
export const QUAD = 3;       // each quadrant is 3x3
// quadrant top-left origins: q0 top-left, q1 top-right, q2 bottom-left, q3 bottom-right
const QUAD_ORIGIN = [[0, 0], [0, 3], [3, 0], [3, 3]];

/**
 * PentagoMatch — a single 1v1 Pentago board (plain object, NOT a BaseGame). The
 * PairingEngine owns all timers, ranking, byes and leave handling; this only owns
 * one 6x6 board split into four 3x3 quadrants. Server-authoritative: applyMove
 * validates whose turn it is, that the placement cell is empty, and that the
 * quadrant/direction are legal, so a client can never move out of turn or onto an
 * occupied cell. p1 = black (moves first), p2 = white.
 *
 * A full turn is BOTH actions: (1) PLACE a marble on an empty cell, then (2) ROTATE
 * one quadrant 90° clockwise or counter-clockwise. After the rotation, scan the
 * whole board for FIVE-in-a-row (horizontal/vertical/either diagonal): if the mover
 * has 5 → mover wins; if ONLY the opponent has 5 (created by the rotation) → opponent
 * wins; if BOTH → draw. Board full with no 5 → draw.
 *
 * Perfect-information game — getView returns the full board to both sides.
 */
export class PentagoMatch {
  constructor(p1, p2) {
    this.p1 = p1; // black / first
    this.p2 = p2; // white / second
    this.turn = p1;
    this.board = Array(SIZE * SIZE).fill(null); // 36 cells, row-major
    this.lastMove = null;
    this._over = false;
    this._winner = null;
    this._winningCells = null;
    this._moveCount = 0;
  }

  _opp(pid) { return pid === this.p1 ? this.p2 : this.p1; }
  _idx(r, c) { return r * SIZE + c; }

  _emptyCells() {
    const out = [];
    for (let i = 0; i < this.board.length; i++) if (this.board[i] === null) out.push(i);
    return out;
  }

  // Rotate one 3x3 quadrant in place, 90° cw or ccw.
  _rotateQuadrant(q, dir) {
    const [or, oc] = QUAD_ORIGIN[q];
    const src = [];
    for (let r = 0; r < QUAD; r++) for (let c = 0; c < QUAD; c++) src.push(this.board[this._idx(or + r, oc + c)]);
    // src is row-major within the 3x3 quadrant
    for (let r = 0; r < QUAD; r++) {
      for (let c = 0; c < QUAD; c++) {
        // cw: dst(r,c) = src(QUAD-1-c, r); ccw: dst(r,c) = src(c, QUAD-1-r)
        const sr = dir === 'cw' ? QUAD - 1 - c : c;
        const sc = dir === 'cw' ? r : QUAD - 1 - r;
        this.board[this._idx(or + r, oc + c)] = src[sr * QUAD + sc];
      }
    }
  }

  // Scan the whole 6x6 board for any 5-in-a-row of `pid`. Returns the 5 winning
  // cells (as indices) or null. Checks horizontal, vertical, and both diagonals.
  _findFive(pid) {
    const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[this._idx(r, c)] !== pid) continue;
        for (const [dr, dc] of DIRS) {
          const cells = [this._idx(r, c)];
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && this.board[this._idx(rr, cc)] === pid) {
            cells.push(this._idx(rr, cc));
            if (cells.length >= 5) return cells.slice(0, 5);
            rr += dr; cc += dc;
          }
        }
      }
    }
    return null;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    const cell = move && Number(move.cell);
    const quadrant = move && Number(move.quadrant);
    const dir = move && move.dir;
    if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) return false;
    if (this.board[cell] !== null) return false;
    if (!Number.isInteger(quadrant) || quadrant < 0 || quadrant >= 4) return false;
    if (dir !== 'cw' && dir !== 'ccw') return false;

    // (1) place
    this.board[cell] = playerId;
    // (2) rotate
    this._rotateQuadrant(quadrant, dir);
    this.lastMove = { cell, quadrant, dir, playerId };
    this._moveCount += 1;

    // scan after rotation: mover priority, then opponent (rotation can complete opp line)
    const opp = this._opp(playerId);
    const mine = this._findFive(playerId);
    const theirs = this._findFive(opp);
    if (mine && theirs) { this._over = true; this._winner = null; this._winningCells = mine.concat(theirs); }
    else if (mine) { this._over = true; this._winner = playerId; this._winningCells = mine; }
    else if (theirs) { this._over = true; this._winner = opp; this._winningCells = theirs; }
    else if (this._emptyCells().length === 0) { this._over = true; this._winner = null; }
    else { this.turn = opp; }
    return true;
  }

  autoMove() {
    if (this._over) return null;
    const empty = this._emptyCells();
    if (!empty.length) return null;
    const cell = empty[Math.floor(Math.random() * empty.length)];
    const quadrant = Math.floor(Math.random() * 4);
    const dir = Math.random() < 0.5 ? 'cw' : 'ccw';
    return { cell, quadrant, dir };
  }

  getView(playerId) {
    return {
      board: this.board,
      size: SIZE,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      myMark: playerId === this.p1 ? 'B' : 'W',
      oppMark: playerId === this.p1 ? 'W' : 'B',
      p1Id: this.p1,
      p2Id: this.p2,
      lastMove: this.lastMove,
      over: this._over,
      winnerId: this._winner,
      draw: this._over && this._winner === null,
      winningCells: this._winningCells,
    };
  }

  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return this._over && this._winner === null; }
  scoreDiff(playerId) {
    if (!this._over || this._winner === null) return 0;
    return this._winner === playerId ? 1000 : -1000;
  }
  destroy() {}
}
