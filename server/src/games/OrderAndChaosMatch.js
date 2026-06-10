export const SIZE = 6;
export const NEED = 5; // five-in-a-row wins for Order

/**
 * OrderAndChaosMatch — a single 1v1 Order & Chaos board (plain object, NOT a BaseGame).
 * 6x6 grid; p1 = ORDER, p2 = CHAOS. On a turn EITHER player may place EITHER symbol
 * ('X' or 'O') on any empty cell. ORDER wins the instant a line of five identical
 * symbols appears (horizontal/vertical/diagonal). CHAOS wins if the board fills with
 * no such line. There is no draw. The PairingEngine owns all timers, ranking, byes and
 * leave handling; this only owns one board. Server-authoritative: applyMove validates
 * whose turn it is and that the cell is empty, so a client can never move out of turn
 * or onto an occupied cell. Perfect-information — getView returns the full board to both.
 */
export class OrderAndChaosMatch {
  constructor(p1, p2) {
    this.p1 = p1; // ORDER / first
    this.p2 = p2; // CHAOS / second
    this.turn = p1;
    this.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null)); // null | 'X' | 'O'
    this.lastMove = null;
    this._over = false;
    this._winner = null;
    this._winningCells = null;
    this._moveCount = 0;
  }

  _emptyCells() {
    const out = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (this.board[r][c] === null) out.push({ r, c });
    return out;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    if (!move) return false;
    const r = Number(move.r);
    const c = Number(move.c);
    const symbol = move.symbol;
    if (!Number.isInteger(r) || r < 0 || r >= SIZE) return false;
    if (!Number.isInteger(c) || c < 0 || c >= SIZE) return false;
    if (symbol !== 'X' && symbol !== 'O') return false;
    if (this.board[r][c] !== null) return false;

    this.board[r][c] = symbol;
    this.lastMove = { r, c, symbol, playerId };
    this._moveCount += 1;

    const line = this._findFiveFrom(r, c, symbol);
    if (line) {
      // ORDER (p1) always wins when five-in-a-row appears, regardless of who placed it
      this._over = true;
      this._winner = this.p1;
      this._winningCells = line;
    } else if (this._moveCount >= SIZE * SIZE) {
      // board full, no line → CHAOS wins
      this._over = true;
      this._winner = this.p2;
    } else {
      this.turn = playerId === this.p1 ? this.p2 : this.p1;
    }
    return true;
  }

  // scan the four axes through the just-placed cell; return 5 same-symbol cells or null
  _findFiveFrom(row, col, sym) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const cells = [[row, col]];
      for (let s = 1; s < NEED; s++) { const r = row + dr * s, c = col + dc * s; if (this._cell(r, c) === sym) cells.push([r, c]); else break; }
      for (let s = 1; s < NEED; s++) { const r = row - dr * s, c = col - dc * s; if (this._cell(r, c) === sym) cells.unshift([r, c]); else break; }
      if (cells.length >= NEED) return cells.slice(0, NEED);
    }
    return null;
  }
  _cell(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE ? this.board[r][c] : undefined; }

  autoMove() {
    const empties = this._emptyCells();
    if (!empties.length) return null;
    const { r, c } = empties[Math.floor(Math.random() * empties.length)];
    return { r, c, symbol: Math.random() < 0.5 ? 'X' : 'O' };
  }

  getView(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    return {
      board: this.board,
      size: SIZE,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      myRole: playerId === this.p1 ? 'Order' : 'Chaos',
      oppRole: opp === this.p1 ? 'Order' : 'Chaos',
      lastMove: this.lastMove,
      over: this._over,
      winnerId: this._winner,
      draw: false,
      winningCells: this._winningCells,
    };
  }

  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return false; }
  scoreDiff(playerId) {
    if (!this._over || this._winner === null) return 0;
    return this._winner === playerId ? 1000 : -1000;
  }
  destroy() {}
}
