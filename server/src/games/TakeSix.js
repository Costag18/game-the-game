import { BaseGame } from './BaseGame.js';

// ---- tuning ---------------------------------------------------------------
const HAND_SIZE = 10;      // 10 cards each -> 10 rounds
const ROW_COUNT = 4;       // 4 face-up rows
const ROW_LIMIT = 6;       // 6th card forces a take of the first 5
const DECK_MAX = 104;      // cards numbered 1..104
const PICK_MS = 30_000;    // per-round simultaneous pick window
const REVEAL_MS = 9_000;   // reveal/resolve ack window before auto-advance
const FINAL_MS = 12_000;   // final-board ack window

/**
 * Bullhead penalty for a card value (6 Nimmt! rules). If several apply, the
 * HIGHEST wins: 55 -> 7, multiples of 11 -> 5, multiples of 10 -> 3,
 * multiples of 5 -> 2, else 1.
 */
export function bullhead(n) {
  if (n === 55) return 7;
  if (n % 11 === 0) return 5;
  if (n % 10 === 0) return 3;
  if (n % 5 === 0) return 2;
  return 1;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rowBullheads = (row) => row.reduce((s, n) => s + bullhead(n), 0);

/**
 * Take Six (6 Nimmt!) — simultaneous card-placement race. Each round every
 * present player SECRETLY picks one card from their private 10-card hand. On
 * reveal the chosen cards resolve in ASCENDING numeric order: each goes onto the
 * row whose END card is the highest value still LOWER than it. Appending a 6th
 * card forces that player to TAKE the first 5 (their bullheads add to the
 * player's score) and the played card seeds the row. A card lower than every
 * row-end forces its player to TAKE one full row (the one with the FEWEST total
 * bullheads) and seed it with their card. After 10 rounds the LOWEST total
 * bullhead score wins.
 *
 * Anti-cheat: hands live only on the server; getStateForPlayer sends a player
 * ONLY their own hand (opponents expose just a card COUNT), and a chosen card is
 * never revealed to anyone until the simultaneous reveal. Every pick is
 * validated server-side (the card must currently be in that player's hand).
 */
export class TakeSix extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'choosing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'choosing' },
        choosing: { resolve: 'reveal', finish: 'finished' },
        reveal: { next: 'choosing', finish: 'finished' },
      },
    });
    this.totalRounds = HAND_SIZE;
    this.round = 0;
    this.hands = {};        // pid -> [cards]
    this.scores = {};       // pid -> total bullheads (lower is better)
    this.rows = [];         // ROW_COUNT arrays of card values
    this.picks = {};        // pid -> chosen card (hidden until reveal)
    this.resolution = null; // last round's resolution log (revealed)
    this.acknowledged = new Set();
    this.deadline = 0;
    this._pickTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    const deck = shuffle(Array.from({ length: DECK_MAX }, (_, i) => i + 1));
    for (const p of this.players) {
      this.scores[p] = 0;
      this.hands[p] = deck.splice(0, HAND_SIZE).sort((a, b) => a - b);
    }
    this.rows = Array.from({ length: ROW_COUNT }, () => [deck.pop()]);
    this.round = 0;
    this.transition('start'); // -> onEnterChoosing
  }

  // ---- CHOOSING -------------------------------------------------------------
  onEnterChoosing() {
    this.round++;
    this.picks = {};
    this.resolution = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + PICK_MS;
    this._pickTimer = setTimeout(() => {
      if (this.state !== 'choosing') return;
      for (const p of this.players) if (this.picks[p] === undefined) this._autoPick(p);
      this._resolveRound();
      this._emitChange();
    }, PICK_MS);
  }

  _autoPick(p) {
    const hand = this.hands[p] || [];
    if (hand.length) this.picks[p] = hand[Math.floor(Math.random() * hand.length)];
  }

  _checkChooseComplete() {
    if (this.state !== 'choosing') return;
    if (this.players.every((p) => this.picks[p] !== undefined)) this._resolveRound();
  }

  // ---- RESOLUTION -----------------------------------------------------------
  _resolveRound() {
    if (this.state !== 'choosing') return; // guard double-call
    this._clearTimers();

    // Remove chosen cards from hands. Order resolution ASCENDING by card value.
    const ordered = this.players
      .filter((p) => this.picks[p] !== undefined)
      .map((p) => ({ playerId: p, card: this.picks[p] }))
      .sort((a, b) => a.card - b.card);

    for (const { playerId, card } of ordered) {
      this.hands[playerId] = (this.hands[playerId] || []).filter((c) => c !== card);
    }

    const steps = [];
    for (const { playerId, card } of ordered) {
      // Find the row whose END card is the highest value still LOWER than `card`.
      let bestRow = -1;
      let bestEnd = -1;
      for (let r = 0; r < this.rows.length; r++) {
        const end = this.rows[r][this.rows[r].length - 1];
        if (end < card && end > bestEnd) { bestEnd = end; bestRow = r; }
      }

      if (bestRow === -1) {
        // Lower than every row-end: TAKE the row with the FEWEST total bullheads.
        let pickRow = 0;
        let pickPenalty = Infinity;
        for (let r = 0; r < this.rows.length; r++) {
          const pen = rowBullheads(this.rows[r]);
          if (pen < pickPenalty) { pickPenalty = pen; pickRow = r; }
        }
        const taken = this.rows[pickRow];
        const gained = rowBullheads(taken);
        this.scores[playerId] += gained;
        steps.push({ playerId, card, row: pickRow, action: 'tooLow', taken: [...taken], gained });
        this.rows[pickRow] = [card];
      } else if (this.rows[bestRow].length + 1 >= ROW_LIMIT) {
        // 6th card: TAKE the first 5; played card seeds the row.
        const taken = this.rows[bestRow];
        const gained = rowBullheads(taken);
        this.scores[playerId] += gained;
        steps.push({ playerId, card, row: bestRow, action: 'sixth', taken: [...taken], gained });
        this.rows[bestRow] = [card];
      } else {
        this.rows[bestRow].push(card);
        steps.push({ playerId, card, row: bestRow, action: 'append', taken: [], gained: 0 });
      }
    }

    this.resolution = { round: this.round, steps, rows: this.rows.map((r) => [...r]) };
    this.transition('resolve'); // -> onEnterReveal
  }

  // ---- REVEAL ---------------------------------------------------------------
  onEnterReveal() {
    this.acknowledged = new Set();
    const last = this.round >= this.totalRounds || this.players.some((p) => (this.hands[p] || []).length === 0);
    this._clearTimers();
    this.deadline = Date.now() + (last ? FINAL_MS : REVEAL_MS);
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, last ? FINAL_MS : REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    const handsEmpty = this.players.length === 0 || this.players.some((p) => (this.hands[p] || []).length === 0);
    if (this.round >= this.totalRounds || handsEmpty) this.transition('finish');
    else this.transition('next'); // -> onEnterChoosing
  }

  onEnterFinished() { this._clearTimers(); this.deadline = 0; }

  // ---- ACTIONS --------------------------------------------------------------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'choosing' && type === 'playCard') {
      if (this.picks[playerId] !== undefined) return;       // one pick per round
      const card = Number(action.card);
      if (!(this.hands[playerId] || []).includes(card)) return; // must own the card
      this.picks[playerId] = card;
      this._checkChooseComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    } else if (type === 'ping') {
      // client fallback if a local timer expired but the server hasn't advanced
      if (this.state === 'choosing' && Date.now() >= this.deadline) {
        for (const p of this.players) if (this.picks[p] === undefined) this._autoPick(p);
        this._resolveRound();
      } else if (this.state === 'reveal' && Date.now() >= this.deadline) {
        for (const p of this.players) this.acknowledged.add(p);
        this._advance();
      }
    }
  }

  // ---- LEAVE / TEARDOWN -----------------------------------------------------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.hands[playerId];
    delete this.picks[playerId];
    delete this.scores[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') { this.state = 'finished'; this.deadline = 0; }
      return;
    }
    if (this.state === 'choosing') this._checkChooseComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  _clearTimers() {
    for (const k of ['_pickTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // ---- STATE / RESULTS ------------------------------------------------------
  getStateForPlayer(playerId) {
    const myHand = (this.hands[playerId] || []).map((n) => ({ value: n, bullhead: bullhead(n) }));
    return {
      phase: this.state,
      myId: playerId,
      round: this.round,
      totalRounds: this.totalRounds,
      deadline: this.deadline || 0,
      rows: this.rows.map((row) => ({
        cards: row.map((n) => ({ value: n, bullhead: bullhead(n) })),
        penalty: rowBullheads(row),
        end: row[row.length - 1],
      })),
      myHand,
      hasPicked: this.picks[playerId] !== undefined,
      // own pick is fine to echo back to its owner; opponents only get counts
      myPick: this.picks[playerId] !== undefined ? this.picks[playerId] : null,
      pickedCount: Object.keys(this.picks).length,
      players: this.players.map((p) => ({
        playerId: p,
        score: this.scores[p] || 0,
        cardsLeft: (this.hands[p] || []).length,
        hasPicked: this.picks[p] !== undefined, // boolean only — never the card
      })),
      scores: { ...this.scores },
      // resolution (with everyone's revealed card) ONLY exposed at/after reveal
      resolution: (this.state === 'reveal' || this.state === 'finished') ? this.resolution : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Lowest bullhead total wins -> sort ASCENDING; ties share a placement.
    const sorted = [...this.players].sort((a, b) => (this.scores[a] || 0) - (this.scores[b] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) > (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} bullheads`,
      };
    });
  }
}
