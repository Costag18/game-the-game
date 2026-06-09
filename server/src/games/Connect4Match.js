export const COLS = 7;
export const ROWS = 6;

/**
 * Connect4Match — a single 1v1 Connect Four board (plain object, NOT a BaseGame).
 * The PairingEngine owns all timers, ranking, byes and leave handling; this only
 * owns one board. Server-authoritative: applyMove validates whose turn it is and
 * that the column is legal, so a client can never move out of turn or into a full
 * column. Perfect-information game — getView returns the full board to both sides.
 */
export class Connect4Match {
  constructor(p1, p2) {
    this.p1 = p1; // red / first
    this.p2 = p2; // yellow / second
    this.turn = p1;
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.lastMove = null;
    this._over = false;
    this._winner = null;
    this._winningCells = null;
    this._moveCount = 0;
  }

  _lowestEmptyRow(col) {
    for (let r = 0; r < ROWS; r++) if (this.board[r][col] === null) return r;
    return -1;
  }
  _legalCols() {
    const out = [];
    for (let c = 0; c < COLS; c++) if (this.board[ROWS - 1][c] === null) out.push(c);
    return out;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    const col = move && Number(move.col);
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return false;
    const row = this._lowestEmptyRow(col);
    if (row === -1) return false;

    this.board[row][col] = playerId;
    this.lastMove = { col, row, playerId };
    this._moveCount += 1;

    const line = this._findWinFrom(row, col, playerId);
    if (line) { this._over = true; this._winner = playerId; this._winningCells = line; }
    else if (this._moveCount >= ROWS * COLS) { this._over = true; this._winner = null; }
    else { this.turn = playerId === this.p1 ? this.p2 : this.p1; }
    return true;
  }

  // four-direction scan through the just-placed disc; returns the 4 winning cells or null
  _findWinFrom(row, col, pid) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const cells = [[row, col]];
      for (let s = 1; s < 4; s++) { const r = row + dr * s, c = col + dc * s; if (this._cell(r, c) === pid) cells.push([r, c]); else break; }
      for (let s = 1; s < 4; s++) { const r = row - dr * s, c = col - dc * s; if (this._cell(r, c) === pid) cells.unshift([r, c]); else break; }
      if (cells.length >= 4) return cells.slice(0, 4);
    }
    return null;
  }
  _cell(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS ? this.board[r][c] : undefined; }

  autoMove() {
    const legal = this._legalCols();
    if (!legal.length) return null;
    return { col: legal[Math.floor(Math.random() * legal.length)] };
  }

  getView(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    return {
      board: this.board,
      cols: COLS, rows: ROWS,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      myColor: playerId === this.p1 ? 'R' : 'Y',
      oppColor: opp === this.p1 ? 'R' : 'Y',
      lastMove: this.lastMove,
      over: this._over,
      winnerId: this._winner,
      draw: this._over && this._winner === null,
      winningCells: this._winningCells,
      legalCols: this._legalCols(),
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
