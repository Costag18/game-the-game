import { BaseGame } from './BaseGame.js';

// ---- tunables ----------------------------------------------------------------
const START_BANKROLL = 100;
const TOTAL_LOTS = 6;
const VALUE_MIN = 20;
const VALUE_MAX = 80;
const START_PRICE = 90;
const FLOOR_PRICE = 5;
const PRICE_STEP = 5;
const TICK_MS = 1_500;      // price drops one step every 1.5s
const SOLD_REVEAL_MS = 4_000; // reveal each sold/passed lot before the next
const ACK_MS = 10_000;      // final scoreboard auto-advance

const LOT_NAMES = [
  '🏺 Mystery Vase', '💎 Sealed Gem', '🖼️ Lost Painting', '🗝️ Antique Key',
  '📦 Estate Crate', '⌚ Pocket Watch', '🪙 Old Coin Hoard', '🎻 Dusty Violin',
];

function randValue() {
  return VALUE_MIN + Math.floor(Math.random() * (VALUE_MAX - VALUE_MIN + 1));
}

/**
 * Dutch Drop — descending (Dutch) auction. Server-authoritative money + hidden
 * values:
 *  - Each player starts with an equal bankroll. The SERVER tracks every dollar:
 *    a buy deducts the CURRENT asking price from the buyer's bankroll, so a
 *    client can never spend more than it has nor claim an unearned profit.
 *  - Each lot has a HIDDEN true value (20..80) that lives ONLY in the FSM. It is
 *    NEVER in getStateForPlayer before the lot is sold/passed — only the reveal
 *    payload (after resolution) carries it. profit = value - price paid.
 *  - The price ticks DOWN on a server timer. The FIRST {type:'buy'} that can
 *    afford the current price wins the lot — decided by SERVER ARRIVAL ORDER
 *    (handleAction is serial), never a client timestamp. If the price hits the
 *    floor with no buyer, the lot passes (nobody profits).
 *  - After 6 lots, rank by total profit DESC; ties share a placement.
 */
export class DutchDrop extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'auction', 'lotReveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'auction' },
        auction: { sold: 'lotReveal', finish: 'finished' },
        lotReveal: { next: 'auction', finish: 'finished' },
      },
    });
    this.bankroll = {};
    this.profit = {};
    this.lotsWon = {};
    this.totalLots = TOTAL_LOTS;
    this.lotIndex = -1;             // 0-based index of the current/last lot
    this.lotName = null;
    this.currentValue = null;       // HIDDEN true value — server-only
    this.currentPrice = START_PRICE;
    this.deadline = null;           // when the next tick fires (for client countdown)
    this.lastLot = null;            // reveal payload for the just-resolved lot
    this.history = [];              // [{ lotIndex, name, value, price, winner, passed }]
    this.acknowledged = new Set();
    this._tickTimer = null;
    this._revealTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.bankroll[p] = START_BANKROLL; this.profit[p] = 0; this.lotsWon[p] = 0; }
    this.transition('start'); // -> onEnterAuction
  }

  // ---------- AUCTION ----------
  onEnterAuction() {
    this.lotIndex++;
    this.lotName = LOT_NAMES[this.lotIndex % LOT_NAMES.length];
    this.currentValue = randValue();   // hidden
    this.currentPrice = START_PRICE;
    this.lastLot = null;
    this._clearTimer('_tickTimer');
    this._armTick();
  }

  _armTick() {
    this._clearTimer('_tickTimer');
    this.deadline = Date.now() + TICK_MS;
    this._tickTimer = setTimeout(() => {
      if (this.state !== 'auction') return;
      this._tickDown();
      this._emitChange();
    }, TICK_MS);
  }

  _tickDown() {
    if (this.state !== 'auction') return;
    if (this.currentPrice <= FLOOR_PRICE) {
      // floor reached with no buyer → lot passes
      this._resolveLot(null);
      return;
    }
    this.currentPrice = Math.max(FLOOR_PRICE, this.currentPrice - PRICE_STEP);
    if (this.currentPrice <= FLOOR_PRICE) {
      // landed exactly on the floor; give one last tick window at the floor price
      this._armTick();
      return;
    }
    this._armTick();
  }

  // winner === null → passed (no buyer). Otherwise winner bought at currentPrice.
  _resolveLot(winner) {
    if (this.state !== 'auction') return;
    this._clearTimer('_tickTimer');
    this.deadline = null;
    const price = this.currentPrice;
    const value = this.currentValue;
    let profit = 0;
    if (winner) {
      this.bankroll[winner] -= price;
      profit = value - price;
      this.profit[winner] = (this.profit[winner] || 0) + profit;
      this.lotsWon[winner] = (this.lotsWon[winner] || 0) + 1;
    }
    const entry = {
      lotIndex: this.lotIndex,
      name: this.lotName,
      value,
      price,
      winner: winner || null,
      profit,
      passed: !winner,
    };
    this.history.push(entry);
    this.lastLot = entry;
    this.currentValue = null; // value is now public via lastLot; clear the hidden slot
    this.transition('sold');  // -> onEnterLotReveal
  }

  // ---------- LOT REVEAL ----------
  onEnterLotReveal() {
    this.acknowledged = new Set();
    this._clearTimer('_revealTimer');
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'lotReveal') return;
      this._advanceAfterLot();
      this._emitChange();
    }, SOLD_REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'lotReveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advanceAfterLot();
  }

  _advanceAfterLot() {
    if (this.state !== 'lotReveal') return;
    this._clearTimer('_revealTimer');
    if (this.lotIndex + 1 >= this.totalLots) {
      this.transition('finish'); // -> onEnterFinished
    } else {
      this.transition('next');   // -> onEnterAuction
    }
  }

  onEnterFinished() {
    this._clearTimers();
    this.deadline = null;
    // final scoreboard ack window (purely cosmetic; results already final)
    this.acknowledged = new Set();
    this._ackTimer = setTimeout(() => { this._emitChange(); }, ACK_MS);
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'auction' && type === 'buy') {
      this._handleBuy(playerId);
    } else if ((this.state === 'lotReveal' || this.state === 'finished') && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    } else if (type === 'ping') {
      // client fallback if its local tick clock drifts; server timers are authoritative
    }
  }

  // FIRST affordable buy wins — resolved by serial arrival order in handleAction.
  _handleBuy(playerId) {
    if (this.state !== 'auction') return;
    // SERVER validates affordability against the bidder's OWN bankroll.
    if ((this.bankroll[playerId] || 0) < this.currentPrice) return; // can't afford → ignored
    this._resolveLot(playerId);
    this._emitChange();
  }

  // ---------- TIMERS ----------
  _clearTimer(name) { if (this[name]) { clearTimeout(this[name]); this[name] = null; } }
  _clearTimers() { this._clearTimer('_tickTimer'); this._clearTimer('_revealTimer'); this._clearTimer('_ackTimer'); }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    delete this.bankroll[playerId];
    delete this.profit[playerId];
    delete this.lotsWon[playerId];
    // scrub a leaver from any resolved history so results never reference them
    for (const h of this.history) if (h.winner === playerId) { h.winner = null; }
    if (this.lastLot && this.lastLot.winner === playerId) this.lastLot.winner = null;

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this.deadline = null;
      this._emitChange();
      return;
    }
    // re-check the active barrier so the leaver can't deadlock it
    if (this.state === 'lotReveal' || this.state === 'finished') this._checkRevealComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const phase = this.state;
    return {
      phase,
      lotNumber: this.lotIndex + 1,
      totalLots: this.totalLots,
      lotName: this.lotName,
      // HIDDEN-INFO: the true value is sent ONLY for resolved lots (lastLot), never
      // for the live lot. During 'auction' currentValue is null in the payload.
      currentPrice: phase === 'auction' ? this.currentPrice : null,
      floorPrice: FLOOR_PRICE,
      startPrice: START_PRICE,
      deadline: phase === 'auction' ? this.deadline : null,
      myId: playerId,
      myBankroll: this.bankroll[playerId] != null ? this.bankroll[playerId] : 0,
      myProfit: this.profit[playerId] != null ? this.profit[playerId] : 0,
      canAfford: phase === 'auction' ? (this.bankroll[playerId] || 0) >= this.currentPrice : false,
      players: this.players.map((p) => ({
        playerId: p,
        bankroll: this.bankroll[p] || 0,
        profit: this.profit[p] || 0,
        lotsWon: this.lotsWon[p] || 0,
      })),
      lastLot: (phase === 'lotReveal' || phase === 'finished') ? this.lastLot : null,
      acknowledged: (phase === 'lotReveal' || phase === 'finished') ? [...this.acknowledged] : [],
      history: phase === 'finished' ? this.history.map((h) => ({ ...h })) : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.profit[b] || 0) - (this.profit[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.profit[playerId] || 0) < (this.profit[sorted[i - 1]] || 0)) placement = i + 1;
      return {
        playerId,
        placement,
        score: this.profit[playerId] || 0,
        profit: this.profit[playerId] || 0,
        lotsWon: this.lotsWon[playerId] || 0,
        handDescription: `${this.profit[playerId] || 0} profit · ${this.lotsWon[playerId] || 0} lots`,
      };
    });
  }
}
