/**
 * NimHeistMatch — a single 1v1 game of Misère Nim (plain object, NOT a BaseGame).
 * The PairingEngine owns all timers, ranking, byes and leave handling; this only
 * owns one board (the piles). Server-authoritative: applyMove validates whose turn
 * it is and that the take is legal, so a client can never move out of turn or take
 * an illegal count. Perfect-information game — getView returns the full pile state
 * to both sides.
 *
 * MISÈRE rule: the player who removes the LAST token overall LOSES. So when all
 * piles become empty after a move, the mover loses and the opponent wins. No draws.
 */
export class NimHeistMatch {
  constructor(p1, p2) {
    this.p1 = p1; // moves first
    this.p2 = p2;
    this.turn = p1;
    this.piles = [3, 5, 7];
    this.lastMove = null;
    this._over = false;
    this._winner = null;
  }

  _totalTokens() {
    return this.piles.reduce((s, n) => s + n, 0);
  }
  _nonEmptyPiles() {
    const out = [];
    for (let i = 0; i < this.piles.length; i++) if (this.piles[i] > 0) out.push(i);
    return out;
  }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    const pile = move && Number(move.pile);
    const count = move && Number(move.count);
    if (!Number.isInteger(pile) || pile < 0 || pile >= this.piles.length) return false;
    if (!Number.isInteger(count) || count < 1 || count > this.piles[pile]) return false;

    this.piles[pile] -= count;
    this.lastMove = { pile, count, playerId };

    if (this._totalTokens() === 0) {
      // mover took the last token → mover LOSES (misère)
      this._over = true;
      this._winner = playerId === this.p1 ? this.p2 : this.p1;
    } else {
      this.turn = playerId === this.p1 ? this.p2 : this.p1;
    }
    return true;
  }

  autoMove() {
    const live = this._nonEmptyPiles();
    if (!live.length) return null;
    const pile = live[Math.floor(Math.random() * live.length)];
    const count = 1 + Math.floor(Math.random() * this.piles[pile]);
    return { pile, count };
  }

  getView(playerId) {
    const opp = playerId === this.p1 ? this.p2 : this.p1;
    return {
      piles: [...this.piles],
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      totalTokens: this._totalTokens(),
      opponentId: opp,
      lastMove: this.lastMove,
      over: this._over,
      winnerId: this._winner,
      draw: false,
    };
  }

  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return false; }
  scoreDiff(playerId) {
    if (!this._over) return 0;
    return this._winner === playerId ? 1000 : -1000;
  }
  destroy() {}
}
