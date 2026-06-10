export const SIZE = 11;

/**
 * HexMatch — a single 1v1 game of Hex on an 11x11 rhombus (plain object, NOT a
 * BaseGame). The PairingEngine owns all timers, ranking, byes and leave handling;
 * this only owns one board. Server-authoritative: applyMove validates whose turn
 * it is and that the target cell is empty, so a client can never move out of turn
 * or onto an occupied cell.
 *
 * p1 owns the TOP and BOTTOM edges (rows 0 and SIZE-1); p2 owns the LEFT and RIGHT
 * edges (cols 0 and SIZE-1). A player wins the instant a connected chain of their
 * stones links their two target edges. Hex can NEVER draw — exactly one player has
 * a winning chain once the board fills, so there is no draw bookkeeping.
 *
 * Perfect-information game — getView returns the full board to both sides.
 *
 * Hex adjacency (6 neighbours) for cell (r,c):
 *   (r-1,c) (r-1,c+1) (r,c-1) (r,c+1) (r+1,c-1) (r+1,c)
 */
const NEIGHBORS = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0]];

export class HexMatch {
  constructor(p1, p2) {
    this.p1 = p1; // top/bottom, moves first
    this.p2 = p2; // left/right
    this.turn = p1;
    this.size = SIZE;
    this.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    this.lastMove = null;
    this._over = false;
    this._winner = null;
    this._winningCells = null;
    this._moveCount = 0;
  }

  _inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  _emptyCells() {
    const out = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (this.board[r][c] === null) out.push({ r, c });
    return out;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    const r = move && Number(move.r);
    const c = move && Number(move.c);
    if (!Number.isInteger(r) || !Number.isInteger(c) || !this._inBounds(r, c)) return false;
    if (this.board[r][c] !== null) return false;

    this.board[r][c] = playerId;
    this.lastMove = { r, c, playerId };
    this._moveCount += 1;

    const chain = this._findWinningChain(playerId);
    if (chain) { this._over = true; this._winner = playerId; this._winningCells = chain; }
    else { this.turn = playerId === this.p1 ? this.p2 : this.p1; }
    return true;
  }

  // BFS over the mover's stones from their starting edge; if the opposite edge is
  // reached the player has a connecting chain. Returns the connected cells (for
  // highlighting) or null. p1 connects rows 0↔SIZE-1; p2 connects cols 0↔SIZE-1.
  _findWinningChain(pid) {
    const isP1 = pid === this.p1;
    const seen = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    const queue = [];
    const parent = {};
    const key = (r, c) => `${r},${c}`;

    for (let i = 0; i < SIZE; i++) {
      const r = isP1 ? 0 : i;
      const c = isP1 ? i : 0;
      if (this.board[r][c] === pid) { seen[r][c] = true; queue.push([r, c]); parent[key(r, c)] = null; }
    }

    let endCell = null;
    while (queue.length) {
      const [r, c] = queue.shift();
      const atFarEdge = isP1 ? r === SIZE - 1 : c === SIZE - 1;
      if (atFarEdge) { endCell = [r, c]; break; }
      for (const [dr, dc] of NEIGHBORS) {
        const nr = r + dr, nc = c + dc;
        if (this._inBounds(nr, nc) && !seen[nr][nc] && this.board[nr][nc] === pid) {
          seen[nr][nc] = true; parent[key(nr, nc)] = [r, c]; queue.push([nr, nc]);
        }
      }
    }
    if (!endCell) return null;

    const path = [];
    let cur = endCell;
    while (cur) { path.push(cur); cur = parent[key(cur[0], cur[1])]; }
    return path.reverse();
  }

  autoMove() {
    const empty = this._emptyCells();
    if (!empty.length) return null;
    const pick = empty[Math.floor(Math.random() * empty.length)];
    return { r: pick.r, c: pick.c };
  }

  getView(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    return {
      board: this.board,
      size: SIZE,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      myColor: playerId === this.p1 ? 'V' : 'O', // V = violet (p1), O = orange (p2)
      oppColor: opp === this.p1 ? 'V' : 'O',
      myEdges: playerId === this.p1 ? 'topBottom' : 'leftRight',
      p1Id: this.p1,
      p2Id: this.p2,
      lastMove: this.lastMove,
      over: this._over,
      winnerId: this._winner,
      draw: false,
      winningCells: this._winningCells,
    };
  }

  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return false; } // Hex can never draw
  scoreDiff(playerId) {
    if (!this._over || this._winner === null) return 0;
    return this._winner === playerId ? 1000 : -1000;
  }
  destroy() {}
}
