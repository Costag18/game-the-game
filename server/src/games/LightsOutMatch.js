export const GRID = 5;            // 5x5 = 25 cells
export const CELLS = GRID * GRID; // 25
export const MAX_MOVES = 30;      // hard cap → guarantees termination

/**
 * LightsOutMatch — a single 1v1 game of Lights Out on a SHARED 5x5 grid (plain
 * object, NOT a BaseGame). The PairingEngine owns all timers, ranking, byes and
 * leave handling; this only owns one board. Server-authoritative: applyMove
 * validates whose turn it is and that the cell index is in range, so a client can
 * never move out of turn or press an out-of-range cell.
 *
 * Each cell is on (true) / off (false). Pressing a cell toggles it AND its four
 * orthogonal neighbours. The starting board is guaranteed SOLVABLE: we begin
 * all-off and apply a random set of presses (a sum of presses is always solvable,
 * since pressing the same cells again returns to all-off). p1 moves first; turns
 * alternate. The MOVER who makes the board ALL-OFF WINS instantly. To guarantee the
 * game terminates, there is a hard cap of MAX_MOVES total presses — if the cap is
 * reached with any light still on, the game is a DRAW.
 *
 * Perfect-information game (shared board) — getView returns the full board to both
 * sides; there is no hidden info to leak.
 */
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export class LightsOutMatch {
  constructor(p1, p2) {
    this.p1 = p1; // moves first
    this.p2 = p2;
    this.turn = p1;
    this.board = new Array(CELLS).fill(false);
    this.lastMove = null;
    this._moveCount = 0;
    this._over = false;
    this._winner = null;
    this._generateSolvable();
  }

  // Apply a random non-empty set of presses to an all-off board → guaranteed solvable
  // (and guaranteed at least one light is on, so the game can't start already won).
  _generateSolvable() {
    let lit = 0;
    let guard = 0;
    while (lit === 0 && guard++ < 20) {
      this.board = new Array(CELLS).fill(false);
      const presses = 3 + Math.floor(Math.random() * 7); // 3..9 random presses
      for (let i = 0; i < presses; i++) this._toggle(Math.floor(Math.random() * CELLS));
      lit = this._litCount();
    }
  }

  _rc(cell) { return [Math.floor(cell / GRID), cell % GRID]; }
  _idx(r, c) { return r * GRID + c; }
  _inBounds(r, c) { return r >= 0 && r < GRID && c >= 0 && c < GRID; }

  // Toggle a cell + its orthogonal neighbours.
  _toggle(cell) {
    const [r, c] = this._rc(cell);
    this.board[cell] = !this.board[cell];
    for (const [dr, dc] of NEIGHBORS) {
      const nr = r + dr, nc = c + dc;
      if (this._inBounds(nr, nc)) {
        const ni = this._idx(nr, nc);
        this.board[ni] = !this.board[ni];
      }
    }
  }

  _litCount() {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (this.board[i]) n++;
    return n;
  }
  _allOff() { return this._litCount() === 0; }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    const cell = move && Number(move.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;

    this._toggle(cell);
    this.lastMove = { cell, playerId };
    this._moveCount += 1;

    if (this._allOff()) {
      this._over = true; this._winner = playerId; this.turn = null;
    } else if (this._moveCount >= MAX_MOVES) {
      this._over = true; this._winner = null; this.turn = null; // cap → draw
    } else {
      this.turn = playerId === this.p1 ? this.p2 : this.p1;
    }
    return true;
  }

  autoMove() {
    if (this._over) return null;
    return { cell: Math.floor(Math.random() * CELLS) };
  }

  getView(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    return {
      board: this.board.slice(),
      grid: GRID,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      litCount: this._litCount(),
      movesLeft: Math.max(0, MAX_MOVES - this._moveCount),
      lastMove: this.lastMove,
      opponentId: opp,
      over: this._over,
      winnerId: this._winner,
      draw: this._over && this._winner === null,
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
