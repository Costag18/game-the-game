import { BaseGame } from './BaseGame.js';

// --- SET deck ---------------------------------------------------------------
// 4 attributes, each with 3 values → 81 unique cards.
const ATTRS = ['shape', 'color', 'count', 'fill'];
const VALUES = {
  shape: ['circle', 'square', 'triangle'],
  color: ['r', 'g', 'b'],
  count: [1, 2, 3],
  fill: ['solid', 'striped', 'empty'],
};

const TABLEAU_SIZE = 12;        // cards shown at once
const ROUND_MS = 120_000;       // ~120s overall race
const ACK_MS = 10_000;          // reveal auto-advance
const PENALTY_MS = 2500;        // lockout after a bad claim

function buildDeck() {
  const deck = [];
  let id = 0;
  for (const shape of VALUES.shape) {
    for (const color of VALUES.color) {
      for (const count of VALUES.count) {
        for (const fill of VALUES.fill) {
          deck.push({ id: `c${id++}`, shape, color, count, fill });
        }
      }
    }
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A trio is a valid SET iff, for every attribute, the three values are all-same OR all-different. */
function isSet(c0, c1, c2) {
  if (!c0 || !c1 || !c2) return false;
  if (c0.id === c1.id || c0.id === c2.id || c1.id === c2.id) return false;
  for (const attr of ATTRS) {
    const a = c0[attr], b = c1[attr], c = c2[attr];
    const allSame = a === b && b === c;
    const allDiff = a !== b && b !== c && a !== c;
    if (!allSame && !allDiff) return false;
  }
  return true;
}

/** Does the given list of cards contain at least one SET? */
function hasAnySet(cards) {
  const n = cards.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        if (isSet(cards[i], cards[j], cards[k])) return true;
  return false;
}

/**
 * Pair Hunt — real-time SET race. The server holds a shuffled 81-card deck and a
 * public 12-card tableau; players race to claim valid SETs. Every claim is validated
 * server-side against the LIVE tableau (you can't claim a card already removed), so a
 * client can never fake a solve. There is no hidden information — the tableau is public
 * and only set-counts are shared — but the SET rule is enforced authoritatively, and a
 * bad claim costs a brief lockout. Most valid SETs wins; ties share a placement.
 */
export class PairHunt extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { endRound: 'reveal' },
        reveal: { finish: 'finished' },
      },
    });
    this.deck = [];
    this.tableau = [];        // current face-up cards (objects)
    this.counts = {};         // playerId -> valid SETs claimed
    this.attempts = {};       // playerId -> total claim attempts
    this.lockUntil = {};      // playerId -> ms timestamp until which claims are rejected
    this.lastClaim = {};      // playerId -> { ok, cardIds, at } for client flash
    this.acknowledged = new Set();
    this._roundStartMs = 0;
    this._roundTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.transition('start'); // -> onEnterPlaying
  }

  onEnterPlaying() {
    this.deck = shuffle(buildDeck());
    this.tableau = this.deck.splice(0, TABLEAU_SIZE);
    // Guarantee the opening tableau is solvable (deal more if no SET present).
    this._ensureSolvableTableau();
    this.counts = {};
    this.attempts = {};
    this.lockUntil = {};
    this.lastClaim = {};
    for (const p of this.players) { this.counts[p] = 0; this.attempts[p] = 0; }
    this._roundStartMs = Date.now();
    this._clearTimers();
    this._roundTimer = setTimeout(() => {
      if (this.state === 'playing') { this._endRound(); this._emitChange(); }
    }, ROUND_MS);
  }

  onEnterReveal() {
    this._clearTimers();
    this.acknowledged = new Set();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._checkRevealComplete();
      this._emitChange();
    }, ACK_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  // --- tableau maintenance ---------------------------------------------------

  /**
   * After a claim removes 3 cards, refill from the deck. The board is kept at
   * TABLEAU_SIZE while the deck has cards; if no SET is present it deals extra
   * cards (3 at a time, SET convention) until one exists or the deck runs dry.
   */
  _refillTableau() {
    while (this.tableau.length < TABLEAU_SIZE && this.deck.length > 0) {
      this.tableau.push(this.deck.shift());
    }
    this._ensureSolvableTableau();
  }

  _ensureSolvableTableau() {
    while (this.deck.length > 0 && !hasAnySet(this.tableau)) {
      // Deal 3 extra cards (standard SET escape hatch) until a SET appears.
      for (let i = 0; i < 3 && this.deck.length > 0; i++) this.tableau.push(this.deck.shift());
    }
  }

  /** The race is over when the deck is exhausted AND no SET remains in the tableau. */
  _boardExhausted() {
    return this.deck.length === 0 && !hasAnySet(this.tableau);
  }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'playing') {
      if (type === 'claim') {
        this._handleClaim(playerId, action.cardIds);
      } else if (type === 'ping') {
        if (Date.now() >= this._roundStartMs + ROUND_MS || this._boardExhausted()) this._endRound();
      }
    } else if (this.state === 'reveal') {
      if (type === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealComplete();
      }
    }
  }

  _handleClaim(playerId, cardIds) {
    if (this.state !== 'playing') return;
    if ((this.lockUntil[playerId] || 0) > Date.now()) return; // still locked out
    if (!Array.isArray(cardIds) || cardIds.length !== 3) return;
    if (new Set(cardIds).size !== 3) return; // must be 3 distinct ids

    this.attempts[playerId] = (this.attempts[playerId] || 0) + 1;

    // All three must currently be on the LIVE tableau (anti-cheat: can't claim removed cards).
    const cards = cardIds.map((id) => this.tableau.find((c) => c.id === id));
    const onBoard = cards.every((c) => c);

    if (onBoard && isSet(cards[0], cards[1], cards[2])) {
      this.counts[playerId] = (this.counts[playerId] || 0) + 1;
      this.lastClaim[playerId] = { ok: true, cardIds: [...cardIds], at: Date.now() };
      // Remove the claimed cards and refill.
      const claimed = new Set(cardIds);
      this.tableau = this.tableau.filter((c) => !claimed.has(c.id));
      this._refillTableau();
      if (this._boardExhausted()) this._endRound();
    } else {
      // Invalid (not on board or not a SET): penalty lockout, no point change.
      this.lockUntil[playerId] = Date.now() + PENALTY_MS;
      this.lastClaim[playerId] = { ok: false, cardIds: [...cardIds], at: Date.now() };
    }
  }

  _endRound() {
    if (this.state !== 'playing') return; // guard double-call
    this._clearTimers();
    this.transition('endRound'); // -> onEnterReveal
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (!this.players.every((p) => this.acknowledged.has(p))) return;
    this._clearTimers();
    this.transition('finish');
  }

  _clearTimers() {
    if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.counts[playerId];
    delete this.attempts[playerId];
    delete this.lockUntil[playerId];
    delete this.lastClaim[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'reveal') {
      this._checkRevealComplete();
    }
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const revealed = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      // The tableau is PUBLIC (no hidden info) — but the SET solution is never sent.
      tableau: this.tableau.map((c) => ({ id: c.id, shape: c.shape, color: c.color, count: c.count, fill: c.fill })),
      deckRemaining: this.deck.length,
      roundEndMs: this.state === 'playing' ? this._roundStartMs + ROUND_MS : null,
      roundDurationSec: ROUND_MS / 1000,
      myCount: this.counts[playerId] || 0,
      myAttempts: this.attempts[playerId] || 0,
      myLockUntilMs: (this.lockUntil[playerId] || 0) > Date.now() ? this.lockUntil[playerId] : null,
      lastClaim: this.lastClaim[playerId] || null,
      scoreboard: this.players.map((p) => ({
        playerId: p,
        count: this.counts[p] || 0,
      })).sort((a, b) => b.count - a.count),
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      results: revealed ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const cmp = (a, b) => {
      if (a.count !== b.count) return b.count - a.count;     // most SETs first
      return a.attempts - b.attempts;                         // fewer wasted claims breaks near-ties
    };
    const entries = this.players.map((p) => ({
      playerId: p,
      count: this.counts[p] || 0,
      attempts: this.attempts[p] || 0,
    }));
    entries.sort(cmp);
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && cmp(entries[i - 1], e) < 0) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        count: e.count,
        attempts: e.attempts,
        handDescription: `${e.count} SET${e.count === 1 ? '' : 's'}`,
      };
    });
  }
}
