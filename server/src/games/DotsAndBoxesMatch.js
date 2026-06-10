export const BOXES = 5;        // 5x5 boxes
export const DOTS = BOXES + 1;  // 6x6 dots
export const TOTAL_BOXES = BOXES * BOXES; // 25 (odd → no draw)

/**
 * DotsAndBoxesMatch — a single 1v1 Dots & Boxes board (plain object, NOT a BaseGame).
 * The PairingEngine owns all timers, ranking, byes and leave handling; this only owns
 * one board. Server-authoritative: applyMove validates whose turn it is and that the
 * edge is unclaimed, so a client can never move out of turn or re-claim an edge.
 * Perfect-information game — getView returns the full board to both sides.
 *
 * Board: horizontal edges hEdges[DOTS][BOXES] (rows of dots × box columns),
 * vertical edges vEdges[BOXES][DOTS], box owners boxes[BOXES][BOXES] (playerId|null).
 * Completing a box's 4th edge claims it for the mover AND grants ANOTHER turn (do NOT
 * flip turn when a box was completed this move). Game ends when all 25 boxes are owned;
 * most boxes wins (odd total → never a draw).
 */
export class DotsAndBoxesMatch {
  constructor(p1, p2) {
    this.p1 = p1; // first
    this.p2 = p2; // second
    this.turn = p1;
    this.hEdges = Array.from({ length: DOTS }, () => Array(BOXES).fill(null));   // [r 0..DOTS-1][c 0..BOXES-1]
    this.vEdges = Array.from({ length: BOXES }, () => Array(DOTS).fill(null));   // [r 0..BOXES-1][c 0..DOTS-1]
    this.boxes = Array.from({ length: BOXES }, () => Array(BOXES).fill(null));   // [r][c] owner
    this.score = { [p1]: 0, [p2]: 0 };
    this.lastMove = null;
    this._claimed = 0;
    this._over = false;
    this._winner = null;
  }

  _edgeTaken(orient, r, c) {
    if (orient === 'h') return this.hEdges[r][c] !== null;
    return this.vEdges[r][c] !== null;
  }
  _edgeInRange(orient, r, c) {
    if (orient === 'h') return r >= 0 && r < DOTS && c >= 0 && c < BOXES;
    if (orient === 'v') return r >= 0 && r < BOXES && c >= 0 && c < DOTS;
    return false;
  }
  // does a box have all 4 of its edges? (only meaningful for in-range box coords)
  _boxComplete(r, c) {
    if (r < 0 || r >= BOXES || c < 0 || c >= BOXES) return false;
    return (
      this.hEdges[r][c] !== null &&       // top
      this.hEdges[r + 1][c] !== null &&   // bottom
      this.vEdges[r][c] !== null &&       // left
      this.vEdges[r][c + 1] !== null      // right
    );
  }

  _legalEdges() {
    const out = [];
    for (let r = 0; r < DOTS; r++) for (let c = 0; c < BOXES; c++) if (this.hEdges[r][c] === null) out.push({ orient: 'h', r, c });
    for (let r = 0; r < BOXES; r++) for (let c = 0; c < DOTS; c++) if (this.vEdges[r][c] === null) out.push({ orient: 'v', r, c });
    return out;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    if (!move) return false;
    const orient = move.orient;
    const r = Number(move.r);
    const c = Number(move.c);
    if (orient !== 'h' && orient !== 'v') return false;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    if (!this._edgeInRange(orient, r, c)) return false;
    if (this._edgeTaken(orient, r, c)) return false;

    // place the edge
    if (orient === 'h') this.hEdges[r][c] = playerId; else this.vEdges[r][c] = playerId;
    this.lastMove = { orient, r, c, playerId };

    // a horizontal edge at (r,c) can complete the box above (r-1,c) and below (r,c);
    // a vertical edge at (r,c) can complete the box left (r,c-1) and right (r,c).
    let completedAny = false;
    const candidates = orient === 'h'
      ? [[r - 1, c], [r, c]]
      : [[r, c - 1], [r, c]];
    for (const [br, bc] of candidates) {
      if (br < 0 || br >= BOXES || bc < 0 || bc >= BOXES) continue;
      if (this.boxes[br][bc] === null && this._boxComplete(br, bc)) {
        this.boxes[br][bc] = playerId;
        this.score[playerId] = (this.score[playerId] || 0) + 1;
        this._claimed += 1;
        completedAny = true;
      }
    }

    if (this._claimed >= TOTAL_BOXES) {
      this._over = true;
      const s1 = this.score[this.p1] || 0;
      const s2 = this.score[this.p2] || 0;
      this._winner = s1 > s2 ? this.p1 : (s2 > s1 ? this.p2 : null); // odd total → never null in practice
    } else if (!completedAny) {
      this.turn = playerId === this.p1 ? this.p2 : this.p1; // only flip if no box claimed
    }
    return true;
  }

  autoMove() {
    const legal = this._legalEdges();
    if (!legal.length) return null;
    return legal[Math.floor(Math.random() * legal.length)];
  }

  getView(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    return {
      hEdges: this.hEdges,
      vEdges: this.vEdges,
      boxOwners: this.boxes,
      boxes: BOXES, dots: DOTS,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      myBoxes: this.score[playerId] || 0,
      oppBoxes: this.score[opp] || 0,
      lastMove: this.lastMove,
      over: this._over,
      winnerId: this._winner,
      draw: this._over && this._winner === null,
      legalEdges: this._legalEdges(),
    };
  }

  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return this._over && this._winner === null; }
  scoreDiff(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    const margin = (this.score[playerId] || 0) - (this.score[opp] || 0);
    if (!this._over || this._winner === null) return margin; // box-margin term breaks near-results
    return (this._winner === playerId ? 1000 : -1000) + margin;
  }
  destroy() {}
}
