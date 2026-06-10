export const SIZE = 9;
export const WALLS_PER_PLAYER = 10;

/**
 * QuoridorMatch — a single 1v1 game of Quoridor on a 9x9 grid (plain object, NOT a
 * BaseGame). The PairingEngine owns all timers, ranking, byes and leave handling;
 * this only owns one board. Server-authoritative: applyMove validates whose turn it
 * is, that a pawn step is to a legal adjacent/jump cell, and that a wall placement is
 * in-bounds, non-overlapping, and — CRITICALLY — does NOT seal off either pawn from
 * its goal row (verified by a fresh BFS from each pawn after the tentative wall).
 *
 * p1 starts at (0,4) and must reach row 8; p2 starts at (8,4) and must reach row 0.
 * A turn is EITHER a pawn step (with a straight jump over an adjacent opponent) OR a
 * wall placement {type:'wall', r, c, orient}. Each player has 10 walls.
 *
 * Walls live on the 8x8 lattice of "post" coordinates (r,c each 0..7). A horizontal
 * wall at (r,c) spans the gap below cells (r,c)&(r,c+1) — i.e. blocks (r,c)↔(r+1,c)
 * and (r,c+1)↔(r+1,c+1). A vertical wall at (r,c) spans the gap right of cells
 * (r,c)&(r+1,c) — i.e. blocks (r,c)↔(r,c+1) and (r+1,c)↔(r+1,c+1). Two walls clash if
 * they share a post (same r,c) regardless of orientation, or if two collinear walls of
 * the same orientation would overlap a segment (handled by the same-post rule since
 * each wall occupies exactly one post). Quoridor can never draw.
 *
 * Perfect-information game — getView returns both pawns and the wall set to both sides.
 */
const STEP_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export class QuoridorMatch {
  constructor(p1, p2) {
    this.p1 = p1; // top, starts row 0, goal row 8, moves first
    this.p2 = p2; // bottom, starts row 8, goal row 0
    this.turn = p1;
    this.pawns = { [p1]: { r: 0, c: 4 }, [p2]: { r: 8, c: 4 } };
    this.goalRow = { [p1]: SIZE - 1, [p2]: 0 };
    this.wallsLeft = { [p1]: WALLS_PER_PLAYER, [p2]: WALLS_PER_PLAYER };
    this.walls = []; // [{ r, c, orient: 'h'|'v' }]
    this.lastMove = null;
    this._over = false;
    this._winner = null;
  }

  _opp(pid) { return pid === this.p1 ? this.p2 : this.p1; }
  _inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  // Is movement between two ORTHOGONALLY-adjacent cells blocked by any wall?
  _blocked(r1, c1, r2, c2) {
    for (const w of this.walls) {
      if (w.orient === 'h') {
        // blocks vertical movement across row boundary w.r/w.r+1 at cols w.c and w.c+1
        if (c1 === c2 && (c1 === w.c || c1 === w.c + 1)) {
          const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
          if (lo === w.r && hi === w.r + 1) return true;
        }
      } else { // 'v'
        // blocks horizontal movement across col boundary w.c/w.c+1 at rows w.r and w.r+1
        if (r1 === r2 && (r1 === w.r || r1 === w.r + 1)) {
          const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
          if (lo === w.c && hi === w.c + 1) return true;
        }
      }
    }
    return false;
  }

  // Legal pawn destination cells for `pid` from its current square (incl. jumps).
  _legalPawnMoves(pid) {
    const me = this.pawns[pid];
    const opp = this.pawns[this._opp(pid)];
    const out = [];
    for (const [dr, dc] of STEP_DIRS) {
      const nr = me.r + dr, nc = me.c + dc;
      if (!this._inBounds(nr, nc)) continue;
      if (this._blocked(me.r, me.c, nr, nc)) continue;
      if (opp.r === nr && opp.c === nc) {
        // opponent is adjacent — try a straight jump over them
        const jr = nr + dr, jc = nc + dc;
        if (this._inBounds(jr, jc) && !this._blocked(nr, nc, jr, jc)) {
          out.push({ r: jr, c: jc });
        } else {
          // straight jump blocked (wall behind or edge) → diagonal side-steps
          for (const [sr, sc] of STEP_DIRS) {
            if (sr === dr && sc === dc) continue; // not back into our approach line
            if (sr === -dr && sc === -dc) continue; // not back to where we came from
            const dr2 = nr + sr, dc2 = nc + sc;
            if (this._inBounds(dr2, dc2) && !this._blocked(nr, nc, dr2, dc2)) out.push({ r: dr2, c: dc2 });
          }
        }
      } else {
        out.push({ r: nr, c: nc });
      }
    }
    // de-dupe (a side-step could be reachable two ways in theory)
    const seen = new Set();
    return out.filter((m) => { const k = `${m.r},${m.c}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // BFS: can `pid`'s pawn reach its goal row given the current wall set? (returns bool)
  _hasPathToGoal(pid) {
    const start = this.pawns[pid];
    const goal = this.goalRow[pid];
    const seen = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    const queue = [[start.r, start.c]];
    seen[start.r][start.c] = true;
    while (queue.length) {
      const [r, c] = queue.shift();
      if (r === goal) return true;
      for (const [dr, dc] of STEP_DIRS) {
        const nr = r + dr, nc = c + dc;
        if (this._inBounds(nr, nc) && !seen[nr][nc] && !this._blocked(r, c, nr, nc)) {
          seen[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
    }
    return false;
  }

  // BFS distance (in steps) from a pawn to its goal row, ignoring the opponent pawn
  // (used only for scoreDiff margin + autoMove heuristic). Infinity if unreachable.
  _distToGoal(pid) {
    const start = this.pawns[pid];
    const goal = this.goalRow[pid];
    const dist = Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));
    const queue = [[start.r, start.c]];
    dist[start.r][start.c] = 0;
    while (queue.length) {
      const [r, c] = queue.shift();
      if (r === goal) return dist[r][c];
      for (const [dr, dc] of STEP_DIRS) {
        const nr = r + dr, nc = c + dc;
        if (this._inBounds(nr, nc) && dist[nr][nc] === -1 && !this._blocked(r, c, nr, nc)) {
          dist[nr][nc] = dist[r][c] + 1;
          queue.push([nr, nc]);
        }
      }
    }
    return Infinity;
  }

  _wallClash(r, c) {
    // each wall occupies one post (r,c); a new wall may not reuse an occupied post.
    return this.walls.some((w) => w.r === r && w.c === c);
  }

  // Would a wall of `orient` at post (r,c) directly cross/overlap an existing one?
  _wallOverlap(r, c, orient) {
    if (this._wallClash(r, c)) return true; // same post → always conflicts (cross or duplicate)
    for (const w of this.walls) {
      if (w.orient !== orient) continue;
      if (orient === 'h' && w.r === r && Math.abs(w.c - c) === 1) return true; // collinear horiz overlap
      if (orient === 'v' && w.c === c && Math.abs(w.r - r) === 1) return true; // collinear vert overlap
    }
    return false;
  }

  _isLegalWall(pid, r, c, orient) {
    if (this.wallsLeft[pid] <= 0) return false;
    if (orient !== 'h' && orient !== 'v') return false;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    if (r < 0 || r >= SIZE - 1 || c < 0 || c >= SIZE - 1) return false; // posts are 0..7
    if (this._wallOverlap(r, c, orient)) return false;
    // tentatively place, verify BOTH pawns still have a path to goal, then roll back
    this.walls.push({ r, c, orient });
    const ok = this._hasPathToGoal(this.p1) && this._hasPathToGoal(this.p2);
    this.walls.pop();
    return ok;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    if (!move || typeof move !== 'object') return false;

    if (move.type === 'wall') {
      const r = Number(move.r), c = Number(move.c), orient = move.orient;
      if (!this._isLegalWall(playerId, r, c, orient)) return false;
      this.walls.push({ r, c, orient });
      this.wallsLeft[playerId] -= 1;
      this.lastMove = { type: 'wall', r, c, orient, playerId };
      this.turn = this._opp(playerId);
      return true;
    }

    if (move.type === 'move') {
      const r = Number(move.r), c = Number(move.c);
      if (!Number.isInteger(r) || !Number.isInteger(c) || !this._inBounds(r, c)) return false;
      const legal = this._legalPawnMoves(playerId);
      if (!legal.some((m) => m.r === r && m.c === c)) return false;
      this.pawns[playerId] = { r, c };
      this.lastMove = { type: 'move', r, c, playerId };
      if (r === this.goalRow[playerId]) {
        this._over = true;
        this._winner = playerId;
        this.turn = null;
      } else {
        this.turn = this._opp(playerId);
      }
      return true;
    }

    return false;
  }

  autoMove() {
    if (this._over || this.turn == null) return null;
    const pid = this.turn;
    const legal = this._legalPawnMoves(pid);
    if (legal.length) {
      // prefer a step that reduces BFS distance to the goal
      const goal = this.goalRow[pid];
      let best = null, bestDist = Infinity;
      for (const m of legal) {
        const save = this.pawns[pid];
        this.pawns[pid] = { r: m.r, c: m.c };
        const d = m.r === goal ? -1 : this._distToGoal(pid);
        this.pawns[pid] = save;
        if (d < bestDist) { bestDist = d; best = m; }
      }
      const pick = best || legal[Math.floor(Math.random() * legal.length)];
      return { type: 'move', r: pick.r, c: pick.c };
    }
    return null; // a pawn can always move in Quoridor, so this is effectively unreachable
  }

  getView(playerId) {
    const opp = this._opp(playerId);
    return {
      size: SIZE,
      pawns: this.pawns,
      myId: playerId,
      opponentId: opp,
      myPawn: this.pawns[playerId],
      oppPawn: this.pawns[opp],
      goalRow: this.goalRow,
      myGoalRow: this.goalRow[playerId],
      oppGoalRow: this.goalRow[opp],
      walls: this.walls,
      wallsLeft: this.wallsLeft,
      myWallsLeft: this.wallsLeft[playerId],
      oppWallsLeft: this.wallsLeft[opp],
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      legalPawnMoves: !this._over && this.turn === playerId ? this._legalPawnMoves(playerId) : [],
      p1Id: this.p1,
      p2Id: this.p2,
      lastMove: this.lastMove,
      over: this._over,
      winnerId: this._winner,
      draw: false,
    };
  }

  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return false; } // Quoridor can never draw
  scoreDiff(playerId) {
    const opp = this._opp(playerId);
    // small margin term: how much closer I am to my goal than the opponent is to theirs
    const myD = this._distToGoal(playerId);
    const oppD = this._distToGoal(opp);
    const margin = Number.isFinite(myD) && Number.isFinite(oppD) ? (oppD - myD) : 0;
    if (!this._over || this._winner == null) return margin;
    return (this._winner === playerId ? 1000 : -1000) + margin;
  }
  destroy() {}
}
