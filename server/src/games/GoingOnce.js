import { BaseGame } from './BaseGame.js';

// Local timer constants — this game is not allowed to edit shared/constants.js.
const GOING_ONCE_MS = 6_000;   // "going once / twice / SOLD" countdown — RESETS on every raise
const LOT_REVEAL_MS = 10_000;  // between-lot pause showing who won + payment
const ACK_MS = 10_000;         // final scoreboard auto-advance

const TOTAL_LOTS = 6;
const START_BANKROLL = 100;
const INCREMENT = 5;
const LOT_MIN = 5;
const LOT_MAX = 40;

/**
 * Going Once — live English (ascending) auction.
 *
 * Server-authoritative money: every player starts with an equal bankroll; the
 * SERVER validates each {type:'raise'} against the bidder's bankroll
 * (currentPrice + increment <= bankroll) before accepting it, deducts the
 * winning bid only on resolution, and credits the lot's value to wonValue. A
 * client can never bid more than it holds, become high bidder for free, or claim
 * an unearned win.
 *
 * Hidden info: the lot's point VALUE is public (face-up card, by spec), but the
 * win/payment is server-only. The "going once" deadline is broadcast as an
 * absolute `deadline` (Date.now()+ms) that RESETS on every raise; when it
 * expires with no new raise the high bidder wins. After 6 lots, rank by total
 * wonValue DESC (ties → remaining bankroll DESC, then a shared placement).
 */
export class GoingOnce extends BaseGame {
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
    this.wonValue = {};
    this.wonLots = {};       // pid -> [{ value, paid }]
    this.lots = this._buildLots();
    this.lotIndex = -1;
    this.currentValue = null;
    this.currentPrice = 0;
    this.highBidder = null;
    this.deadline = null;      // absolute ms for the going-once countdown
    this.lastSummary = null;   // { lotIndex, value, winner, paid }
    this.acknowledged = new Set();
    this._goingTimer = null;
    this._revealTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  _buildLots() {
    const lots = [];
    for (let i = 0; i < TOTAL_LOTS; i++) {
      lots.push(LOT_MIN + Math.floor(Math.random() * (LOT_MAX - LOT_MIN + 1)));
    }
    return lots;
  }

  startGame() {
    for (const p of this.players) { this.bankroll[p] = START_BANKROLL; this.wonValue[p] = 0; this.wonLots[p] = []; }
    this.transition('start'); // -> onEnterAuction
  }

  // ---------- AUCTION ----------
  onEnterAuction() {
    this.lotIndex++;
    this.currentValue = this.lots[this.lotIndex];
    this.currentPrice = 0;
    this.highBidder = null;
    this._armGoingTimer();
    this._emitChange();
  }

  _minRaiseTarget() { return this.currentPrice + INCREMENT; }
  _canAfford(pid) { return (this.bankroll[pid] || 0) >= this._minRaiseTarget(); }

  _armGoingTimer() {
    this._clearTimer('_goingTimer');
    if (this.state !== 'auction') return;
    this.deadline = Date.now() + GOING_ONCE_MS;
    this._goingTimer = setTimeout(() => {
      if (this.state !== 'auction') return;
      this._sellLot();
      this._emitChange();
    }, GOING_ONCE_MS);
  }

  _handleRaise(playerId) {
    if (this.state !== 'auction') return;
    if (playerId === this.highBidder) return; // can't outbid yourself
    if (!this._canAfford(playerId)) return;    // SERVER validates against bankroll
    this.currentPrice = this._minRaiseTarget();
    this.highBidder = playerId;
    this._armGoingTimer(); // RESET the going-once countdown on every raise
    this._emitChange();
  }

  // ---------- SELL / REVEAL ----------
  _sellLot() {
    if (this.state !== 'auction') return;
    this._clearTimer('_goingTimer');
    this.deadline = null;
    const winner = this.highBidder;
    const value = this.currentValue;
    const paid = winner ? this.currentPrice : 0;
    if (winner) {
      // Deduct the winning bid; credit the lot value. Server-authoritative payment.
      this.bankroll[winner] = (this.bankroll[winner] || 0) - paid;
      this.wonValue[winner] = (this.wonValue[winner] || 0) + value;
      this.wonLots[winner].push({ value, paid });
    }
    this.lastSummary = { lotIndex: this.lotIndex, value, winner, paid };
    this.transition('sold'); // -> onEnterLotReveal
  }

  onEnterLotReveal() {
    this.acknowledged = new Set();
    this._clearTimer('_revealTimer');
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'lotReveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceAfterLot();
      this._emitChange();
    }, LOT_REVEAL_MS);
  }
  _checkLotRevealComplete() {
    if (this.state !== 'lotReveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advanceAfterLot();
  }
  _advanceAfterLot() {
    if (this.state !== 'lotReveal') return;
    this._clearTimer('_revealTimer');
    if (this.lotIndex + 1 >= TOTAL_LOTS) this._finish();
    else this.transition('next'); // -> onEnterAuction
  }

  _finish() {
    if (this.state === 'finished') return;
    this._clearTimers();
    this.deadline = null;
    this.acknowledged = new Set();
    this.transition('finish');
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'finished') return;
      this._emitChange();
    }, ACK_MS);
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'auction' && type === 'raise') {
      this._handleRaise(playerId);
    } else if (this.state === 'lotReveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkLotRevealComplete();
      this._emitChange();
    } else if (type === 'ping') {
      // client safety net: if a local timer expired but the server hasn't, nudge.
      if (this.state === 'auction' && this.deadline != null && Date.now() >= this.deadline) {
        this._sellLot();
        this._emitChange();
      }
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearTimer(name) { if (this[name]) { clearTimeout(this[name]); this[name] = null; } }
  _clearTimers() { this._clearTimer('_goingTimer'); this._clearTimer('_revealTimer'); this._clearTimer('_ackTimer'); }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    const wasHigh = this.highBidder === playerId;
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      // Resolve any live lot to the lone remaining player if they're the high
      // bidder, then finish. Either way: no barrier left to wait on.
      if (this.state === 'auction' && wasHigh) this.highBidder = null;
      if (this.state !== 'finished') this._finish();
      this._emitChange();
      return;
    }

    if (this.state === 'auction') {
      if (wasHigh) {
        // The high bidder vanished mid-auction: their bid never landed (no money
        // changes hands until sale), so drop them and reset the countdown so the
        // remaining players can keep bidding instead of deadlocking on a ghost.
        this.highBidder = null;
        this._armGoingTimer();
      }
    } else if (this.state === 'lotReveal') {
      this._checkLotRevealComplete();
    }
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const phase = this.state;
    return {
      phase,
      lotNumber: this.lotIndex + 1,
      totalLots: TOTAL_LOTS,
      increment: INCREMENT,
      myId: playerId,
      // The lot value is PUBLIC by spec (face-up card). Win/payment is server-only.
      lotValue: phase === 'waiting' ? null : this.currentValue,
      currentPrice: this.currentPrice,
      highBidder: phase === 'auction' ? this.highBidder : null,
      iAmHighBidder: this.highBidder === playerId,
      deadline: phase === 'auction' ? this.deadline : null,
      myBankroll: this.bankroll[playerId] || 0,
      // What it would cost ME to take the lead right now.
      nextBid: this._minRaiseTarget(),
      canAfford: phase === 'auction' && this._canAfford(playerId),
      players: this.players.map((p) => ({
        playerId: p,
        isMe: p === playerId,
        bankroll: this.bankroll[p] || 0,
        wonValue: this.wonValue[p] || 0,
        isHighBidder: phase === 'auction' && this.highBidder === p,
      })),
      lastSummary: phase === 'lotReveal' || phase === 'finished' ? this.lastSummary : null,
      acknowledged: phase === 'lotReveal' ? [...this.acknowledged] : [],
      results: phase === 'finished' ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => {
      const dv = (this.wonValue[b] || 0) - (this.wonValue[a] || 0);
      if (dv !== 0) return dv;
      return (this.bankroll[b] || 0) - (this.bankroll[a] || 0); // tiebreak: remaining cash
    });
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0) {
        const prev = sorted[i - 1];
        const sameValue = (this.wonValue[playerId] || 0) === (this.wonValue[prev] || 0);
        const sameCash = (this.bankroll[playerId] || 0) === (this.bankroll[prev] || 0);
        if (!(sameValue && sameCash)) placement = i + 1;
      }
      return {
        playerId,
        placement,
        score: this.wonValue[playerId] || 0,
        wonValue: this.wonValue[playerId] || 0,
        bankroll: this.bankroll[playerId] || 0,
        lotsWon: (this.wonLots[playerId] || []).length,
        handDescription: `${this.wonValue[playerId] || 0} pts won · ${this.bankroll[playerId] || 0} left`,
      };
    });
  }
}
