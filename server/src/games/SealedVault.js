import { BaseGame } from './BaseGame.js';

const STARTING_BANKROLL = 100;
const TOTAL_ROUNDS = 5;
const LOT_MIN = 20;
const LOT_MAX = 80;
const BID_MS = 25_000; // sealed-bid auction window
const REVEAL_MS = 10_000; // ack auto-advance after a lot reveals

const LOT_NAMES = [
  'a Sealed Crate', 'a Dusty Strongbox', 'an Unmarked Vault', 'a Locked Chest',
  'a Mystery Lockbox', 'a Cracked Safe', 'a Velvet Pouch', 'a Rusted Coffer',
  'a Glass Display Case', 'an Ancient Urn',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Sealed Vault — sealed-bid (first-price) auction.
 *
 * Five lots, each with a HIDDEN value (random 20..80). Every player has a PRIVATE
 * bankroll (starts 100) and SIMULTANEOUSLY submits one sealed bid (0..their bankroll)
 * per lot. The lot resolves when ALL active players have bid OR a 25s timer fires
 * (timeout = a 0 bid). The HIGHEST bidder wins: their bid is deducted from their
 * bankroll and the lot's value is added to their wonValue (highest-bid tie → lowest
 * seat / first to submit wins). Only THEN are everyone's bids + the value revealed.
 * After 5 lots, players rank by total wonValue DESC, ties broken by remaining bankroll.
 *
 * Server-authoritative anti-cheat:
 *  - The server owns ALL money. Every bid is validated against the BIDDER's own
 *    bankroll server-side; an over-bankroll (or negative) bid is rejected outright,
 *    so a client can never spend money it doesn't have or claim an unearned win.
 *  - Sealed bids live ONLY in the FSM and are NEVER in getStateForPlayer before the
 *    reveal — a player sees their own bid, opponents' are hidden until the lot resolves.
 *  - The hidden lot value lives ONLY in the FSM and is revealed only in 'reveal'/'finished'.
 */
export class SealedVault extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'bidding', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'bidding' },
        bidding: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'bidding', finish: 'finished' },
      },
    });
    this.bankroll = {};
    this.wonValue = {};
    this.wins = {};
    this.roundIndex = -1; // incremented to 0 on first lot
    this.totalRounds = TOTAL_ROUNDS;
    // hidden lot data lives only here
    this.lotValue = null;
    this.lotName = '';
    this.bids = {}; // sealed: playerId -> amount, never leaked pre-reveal
    this.bidSeq = {}; // submission order, for first-to-submit tie-break
    this._seqCounter = 0;
    this.deadline = 0; // ms epoch the bidding window closes (for client countdown)
    this.revealData = null;
    this.acknowledged = new Set();
    this._names = shuffle(LOT_NAMES);
    this._bidTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) {
      this.bankroll[p] = STARTING_BANKROLL;
      this.wonValue[p] = 0;
      this.wins[p] = 0;
    }
    this.transition('start'); // -> onEnterBidding
  }

  // ---------- BIDDING ----------
  onEnterBidding() {
    this.roundIndex++;
    this.lotValue = LOT_MIN + Math.floor(Math.random() * (LOT_MAX - LOT_MIN + 1)); // 20..80
    this.lotName = this._names[this.roundIndex % this._names.length];
    this.bids = {};
    this.bidSeq = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + BID_MS;
    this._bidTimer = setTimeout(() => {
      if (this.state !== 'bidding') return;
      // timeout: anyone who hasn't bid is treated as bidding 0
      for (const p of this.activePlayers) {
        if (this.bids[p] === undefined) { this.bids[p] = 0; this.bidSeq[p] = ++this._seqCounter; }
      }
      this._resolveLot();
      this._emitChange();
    }, BID_MS);
  }

  _checkAllBid() {
    if (this.state !== 'bidding') return;
    if (this.activePlayers.length === 0) { this._resolveLot(); return; }
    if (this.activePlayers.every((p) => this.bids[p] !== undefined)) this._resolveLot();
  }

  _resolveLot() {
    if (this.state !== 'bidding') return;
    this._clearTimers();
    // determine winner: highest bid; tie → lowest seat (this.players order),
    // then earliest submission seq as a final guard.
    let winner = null;
    let best = -1;
    for (const p of this.players) {
      const amt = this.bids[p];
      if (amt === undefined) continue; // inactive/left this lot
      if (amt > best) { best = amt; winner = p; }
      // strictly-greater keeps the lowest-seat player on an exact tie
    }
    let paid = 0;
    if (winner && best > 0) {
      paid = best;
      this.bankroll[winner] = (this.bankroll[winner] || 0) - paid;
      this.wonValue[winner] = (this.wonValue[winner] || 0) + this.lotValue;
      this.wins[winner] = (this.wins[winner] || 0) + 1;
    } else if (winner && best === 0) {
      // everyone bid 0: lowest seat still "wins" the lot for free
      this.wonValue[winner] = (this.wonValue[winner] || 0) + this.lotValue;
      this.wins[winner] = (this.wins[winner] || 0) + 1;
    }
    this.revealData = {
      lotName: this.lotName,
      lotValue: this.lotValue,
      winnerId: winner,
      winningBid: best < 0 ? 0 : best,
      paid,
      bids: this.players
        .filter((p) => this.bids[p] !== undefined)
        .map((p) => ({ playerId: p, amount: this.bids[p], isWinner: p === winner })),
      roundNumber: this.roundIndex + 1,
    };
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    this.acknowledged = new Set();
    this._clearTimers();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.activePlayers) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.activePlayers.length === 0) { this._advance(); return; }
    if (this.activePlayers.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterBidding
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'bidding' && type === 'bid') {
      if (!this.activePlayers.includes(playerId)) return;
      if (this.bids[playerId] !== undefined) return; // already sealed; no changing it
      const amt = Number(action.amount);
      if (!Number.isFinite(amt)) return;
      const bid = Math.floor(amt);
      // SERVER validation: 0..bankroll only. Over-bankroll / negative → rejected.
      if (bid < 0 || bid > (this.bankroll[playerId] || 0)) return;
      this.bids[playerId] = bid;
      this.bidSeq[playerId] = ++this._seqCounter;
      this._checkAllBid();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  // ---------- TIMERS ----------
  _clearTimers() {
    if (this._bidTimer) { clearTimeout(this._bidTimer); this._bidTimer = null; }
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    // a leaver auto-resolves: their pending sealed bid (if any) is dropped so it
    // cannot win, and barriers no longer wait on them.
    delete this.bids[playerId];
    delete this.bidSeq[playerId];

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'bidding') this._checkAllBid();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const phase = this.state;
    const revealing = phase === 'reveal' || phase === 'finished';
    return {
      phase,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      myId: playerId,
      // lot value ONLY at reveal — hidden during bidding
      lotName: this.lotName,
      lotValueRange: { min: LOT_MIN, max: LOT_MAX },
      myBankroll: this.bankroll[playerId] != null ? this.bankroll[playerId] : 0,
      myBid: this.bids[playerId] != null ? this.bids[playerId] : null,
      hasBid: this.bids[playerId] !== undefined,
      iAmActive: this.activePlayers.includes(playerId),
      deadline: phase === 'bidding' ? this.deadline : null,
      // opponents: PUBLIC info only — bankroll/wonValue/hasBid, NEVER their sealed bid
      players: this.players.map((p) => ({
        playerId: p,
        bankroll: this.bankroll[p] || 0,
        wonValue: this.wonValue[p] || 0,
        wins: this.wins[p] || 0,
        hasBid: phase === 'bidding' ? this.bids[p] !== undefined : false,
        active: this.activePlayers.includes(p),
      })),
      bidCount: phase === 'bidding' ? Object.keys(this.bids).length : 0,
      activeCount: this.activePlayers.length,
      acknowledged: phase === 'reveal' ? [...this.acknowledged] : [],
      reveal: revealing ? this.revealData : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => {
      const dv = (this.wonValue[b] || 0) - (this.wonValue[a] || 0);
      if (dv !== 0) return dv;
      return (this.bankroll[b] || 0) - (this.bankroll[a] || 0);
    });
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0) {
        const prev = sorted[i - 1];
        const sameValue = (this.wonValue[playerId] || 0) === (this.wonValue[prev] || 0);
        const sameBank = (this.bankroll[playerId] || 0) === (this.bankroll[prev] || 0);
        if (!(sameValue && sameBank)) placement = i + 1;
      }
      return {
        playerId,
        placement,
        score: this.wonValue[playerId] || 0,
        wonValue: this.wonValue[playerId] || 0,
        bankroll: this.bankroll[playerId] || 0,
        wins: this.wins[playerId] || 0,
        handDescription: `${this.wonValue[playerId] || 0} loot · ${this.bankroll[playerId] || 0} left`,
      };
    });
  }
}
