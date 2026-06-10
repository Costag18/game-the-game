export const ROUNDS = 6;
export const MIN_PRICE = 1;
export const MAX_PRICE = 20;

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const clampPrice = (v) => Math.max(MIN_PRICE, Math.min(MAX_PRICE, v));

/**
 * LiarsMarketMatch — a single 1v1 hidden-value bluffing duel (plain object, NOT a
 * BaseGame). The PairingEngine owns all timers, ranking, byes and leave handling;
 * this only owns one duel. Server-authoritative: applyMove validates whose turn it
 * is, the step, and legality, so a client can never act out of turn, announce a bad
 * price, or respond before a price is on the table.
 *
 * HIDDEN INFORMATION: each player is dealt a SECRET true value (1..20) known only to
 * them. getView NEVER leaks the opponent's true value until the duel is over. Across
 * 6 rounds the ANNOUNCER (alternates each round, p1 first) declares a price for one
 * share of their stock (possibly a bluff); the RESPONDER then buys or passes. On a
 * buy the responder pays the price and receives the announcer's TRUE value
 * (responder profit += trueValue - price; announcer profit += price). Higher net
 * profit after 6 rounds wins (equal = draw).
 */
export class LiarsMarketMatch {
  constructor(p1, p2) {
    this.p1 = p1; // announces first (round 1)
    this.p2 = p2;
    this.trueValue = { [p1]: randInt(MIN_PRICE, MAX_PRICE), [p2]: randInt(MIN_PRICE, MAX_PRICE) };
    this.profit = { [p1]: 0, [p2]: 0 };
    this.round = 1;           // 1..ROUNDS
    this.step = 'announce';   // 'announce' | 'respond'
    this.announcer = p1;      // alternates each round, p1 first
    this.responder = p2;
    this.price = null;        // current announced price (null until announced)
    this.turn = this.announcer; // whoever must act now
    this.history = [];        // [{ round, announcer, responder, price, bought }]
    this._over = false;
    this._winner = null;
  }

  _opp(pid) { return pid === this.p1 ? this.p2 : this.p1; }

  applyMove(playerId, move) {
    if (this._over) return false;
    if (playerId !== this.turn) return false;
    const type = move && move.type;

    if (this.step === 'announce') {
      if (type !== 'announce') return false;
      const price = move && Number(move.price);
      if (!Number.isInteger(price) || price < MIN_PRICE || price > MAX_PRICE) return false;
      this.price = price;
      this.step = 'respond';
      this.turn = this.responder;
      return true;
    }

    // respond step
    if (type !== 'respond') return false;
    const buy = move.buy === true;
    if (buy) {
      this.profit[this.responder] += this.trueValue[this.announcer] - this.price;
      this.profit[this.announcer] += this.price;
    }
    this.history.push({ round: this.round, announcer: this.announcer, responder: this.responder, price: this.price, bought: buy });
    this._nextRound();
    return true;
  }

  _nextRound() {
    if (this.round >= ROUNDS) { this._finish(); return; }
    this.round += 1;
    // swap announcer role each round
    const newAnnouncer = this._opp(this.announcer);
    this.announcer = newAnnouncer;
    this.responder = this._opp(newAnnouncer);
    this.step = 'announce';
    this.price = null;
    this.turn = this.announcer;
  }

  _finish() {
    this._over = true;
    this.price = null;
    this.turn = null;
    if (this.profit[this.p1] > this.profit[this.p2]) this._winner = this.p1;
    else if (this.profit[this.p2] > this.profit[this.p1]) this._winner = this.p2;
    else this._winner = null; // draw
  }

  autoMove() {
    if (this._over || this.turn == null) return null;
    if (this.step === 'announce') {
      // announce a random price near your own value (bluff a little)
      return { type: 'announce', price: clampPrice(this.trueValue[this.turn] + randInt(-3, 3)) };
    }
    return { type: 'respond', buy: Math.random() < 0.5 };
  }

  getView(playerId) {
    const opp = this._opp(playerId);
    return {
      round: this.round,
      totalRounds: ROUNDS,
      step: this.step,
      minPrice: MIN_PRICE,
      maxPrice: MAX_PRICE,
      turn: this.turn,
      isMyTurn: !this._over && this.turn === playerId,
      announcerId: this.announcer,
      responderId: this.responder,
      iAnnounce: this.announcer === playerId,
      iRespond: this.responder === playerId,
      price: this.price, // current announced price (visible to responder + announcer)
      myValue: this.trueValue[playerId], // OWN secret value
      // opponent's true value is hidden until the duel is over (anti-cheat)
      oppValue: this._over ? this.trueValue[opp] : null,
      myProfit: this.profit[playerId],
      oppProfit: this.profit[opp],
      history: this.history,
      over: this._over,
      winnerId: this._winner,
      draw: this._over && this._winner === null,
    };
  }

  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return this._over && this._winner === null; }
  scoreDiff(playerId) {
    const margin = this.profit[playerId] - this.profit[this._opp(playerId)];
    if (!this._over || this._winner === null) return margin;
    return (this._winner === playerId ? 1000 : -1000) + margin;
  }
  destroy() {}
}
