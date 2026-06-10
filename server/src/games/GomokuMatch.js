export const SIZE = 15;
export const NEED = 5;

/**
 * GomokuMatch — a single 1v1 Gomoku (Five in a Row) board (plain object, NOT a
 * BaseGame). The PairingEngine owns all timers, ranking, byes and leave handling;
 * this only owns one 15x15 board. Server-authoritative: applyMove validates whose
 * turn it is and that the target intersection is empty, so a client can never move
 * out of turn or onto an occupied point. Perfect-information game — getView returns
 * the full board to both sides. p1 = black (first), p2 = white.
 */
export class GomokuMatch {
  constructor(p1, p2) {
    this.p1 = p1; // black / first
    this.p2 = p2; // white / second
    this.turn = p1;
    this.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    this.lastMove = null;
    this._over = false;
    this._winner = null;
    this._winningCells = null;
    this._moveCount = 0;
  }

  _empties() {
    const out = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (this.board[r][c] === null) out.push([r, c]);
    return out;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    const row = move && Number(move.row);
    const col = move && Number(move.col);
    if (!Number.isInteger(row) || row < 0 || row >= SIZE) return false;
    if (!Number.isInteger(col) || col < 0 || col >= SIZE) return false;
    if (this.board[row][col] !== null) return false;

    this.board[row][col] = playerId;
    this.lastMove = { row, col, playerId };
    this._moveCount += 1;

    const line = this._findWinFrom(row, col, playerId);
    if (line) { this._over = true; this._winner = playerId; this._winningCells = line; }
    else if (this._moveCount >= SIZE * SIZE) { this._over = true; this._winner = null; }
    else { this.turn = playerId === this.p1 ? this.p2 : this.p1; }
    return true;
  }

  // four-direction O(1) scan through the just-placed stone; returns the >=5 winning cells or null
  _findWinFrom(row, col, pid) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const cells = [[row, col]];
      for (let s = 1; s < SIZE; s++) { const r = row + dr * s, c = col + dc * s; if (this._cell(r, c) === pid) cells.push([r, c]); else break; }
      for (let s = 1; s < SIZE; s++) { const r = row - dr * s, c = col - dc * s; if (this._cell(r, c) === pid) cells.unshift([r, c]); else break; }
      if (cells.length >= NEED) return cells;
    }
    return null;
  }
  _cell(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE ? this.board[r][c] : undefined; }

  autoMove() {
    const empties = this._empties();
    if (!empties.length) return null;
    const [row, col] = empties[Math.floor(Math.random() * empties.length)];
    return { row, col };
  }

  getView(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    return {
      board: this.board,
      size: SIZE,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      myColor: playerId === this.p1 ? 'B' : 'W',
      oppColor: opp === this.p1 ? 'B' : 'W',
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
