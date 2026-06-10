export const SIZE = 8;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/**
 * OthelloMatch — a single 1v1 Othello/Reversi board (plain object, NOT a BaseGame).
 * The PairingEngine owns all timers, ranking, byes and leave handling; this only
 * owns one 8x8 board. Server-authoritative: applyMove validates whose turn it is and
 * that the move actually brackets (flips ≥1) opponent disc, so a client can never move
 * out of turn or into an illegal/non-flipping cell. Perfect-information game — getView
 * returns the full board to both sides. p1 = black (moves first), p2 = white. If the
 * on-turn player has no legal move their turn auto-passes; if neither side can move (or
 * the board is full) the game ends, most discs wins (equal = draw).
 */
export class OthelloMatch {
  constructor(p1, p2) {
    this.p1 = p1; // black / first
    this.p2 = p2; // white / second
    this.turn = p1;
    this.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    // standard opening: d4/e5 = p1 (black), d5/e4 = p2 (white) (0-indexed: [3][3]/[4][4]=p1, [3][4]/[4][3]=p2)
    this.board[3][3] = p1; this.board[4][4] = p1;
    this.board[3][4] = p2; this.board[4][3] = p2;
    this.lastMove = null;
    this._over = false;
    this._winner = null;
  }

  _opp(pid) { return pid === this.p1 ? this.p2 : this.p1; }
  _inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  // Discs that would flip if `pid` plays (r,c); [] means illegal (empty + no bracket).
  _flips(r, c, pid) {
    if (!this._inBounds(r, c) || this.board[r][c] !== null) return [];
    const opp = this._opp(pid);
    const out = [];
    for (const [dr, dc] of DIRS) {
      const line = [];
      let rr = r + dr, cc = c + dc;
      while (this._inBounds(rr, cc) && this.board[rr][cc] === opp) { line.push([rr, cc]); rr += dr; cc += dc; }
      if (line.length && this._inBounds(rr, cc) && this.board[rr][cc] === pid) out.push(...line);
    }
    return out;
  }

  _legalMoves(pid) {
    const out = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (this.board[r][c] !== null) continue;
      if (this._flips(r, c, pid).length) out.push({ r, c });
    }
    return out;
  }

  _counts() {
    let a = 0, b = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (this.board[r][c] === this.p1) a++;
      else if (this.board[r][c] === this.p2) b++;
    }
    return { [this.p1]: a, [this.p2]: b };
  }

  // After a move/pass, set turn to whoever can move; if neither can, finish.
  _advanceTurn(justMoved) {
    const next = this._opp(justMoved);
    if (this._legalMoves(next).length) { this.turn = next; return; }
    if (this._legalMoves(justMoved).length) { this.turn = justMoved; return; } // opponent auto-passes
    this._finish();
  }

  _finish() {
    this._over = true;
    const cnt = this._counts();
    if (cnt[this.p1] > cnt[this.p2]) this._winner = this.p1;
    else if (cnt[this.p2] > cnt[this.p1]) this._winner = this.p2;
    else this._winner = null; // draw
    this.turn = null;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    const r = move && Number(move.r);
    const c = move && Number(move.c);
    if (!Number.isInteger(r) || !Number.isInteger(c) || !this._inBounds(r, c)) return false;
    const flips = this._flips(r, c, playerId);
    if (!flips.length) return false; // must flip ≥1 — empty + no bracket rejected

    this.board[r][c] = playerId;
    for (const [fr, fc] of flips) this.board[fr][fc] = playerId;
    this.lastMove = { r, c, playerId, flipped: flips.length };
    this._advanceTurn(playerId);
    return true;
  }

  autoMove() {
    if (this._over || this.turn == null) return null;
    const legal = this._legalMoves(this.turn);
    if (!legal.length) return null;
    return legal[Math.floor(Math.random() * legal.length)];
  }

  getView(playerId) {
    const cnt = this._counts();
    const opp = this._opp(playerId);
    return {
      board: this.board,
      size: SIZE,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      myColor: playerId === this.p1 ? 'B' : 'W',
      oppColor: opp === this.p1 ? 'B' : 'W',
      legalMoves: !this._over && this.turn === playerId ? this._legalMoves(playerId) : [],
      myDiscs: cnt[playerId],
      oppDiscs: cnt[opp],
      lastMove: this.lastMove,
      over: this._over,
      winnerId: this._winner,
      draw: this._over && this._winner === null,
    };
  }

  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return this._over && this._winner === null; }
  scoreDiff(playerId) {
    const cnt = this._counts();
    const margin = cnt[playerId] - cnt[this._opp(playerId)];
    if (!this._over || this._winner === null) return margin;
    return (this._winner === playerId ? 1000 : -1000) + margin;
  }
  destroy() {}
}
