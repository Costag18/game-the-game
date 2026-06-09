import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const TURN_MS = TIMERS.CARD_GAME * 1000; // 30s

const SUITS = ['♠', '♥', '♦', '♣'];
// low → high: 3..10, J,Q,K,A,2  (2 is highest)
const LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const RANK_VALUES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let i = 0; i < LABELS.length; i++) {
      deck.push({ rankValue: RANK_VALUES[i], label: LABELS[i], suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const TITLES_FOR = (n) => {
  const t = new Array(n).fill('Citizen');
  if (n >= 1) t[0] = 'President';
  if (n >= 2) t[n - 1] = 'Scumlord';
  if (n >= 4) t[1] = 'Vice President';
  return t;
};

/**
 * President (Scumlord) — turn-based shedding card game. Fully server-authoritative:
 * every hand is private (getStateForPlayer never serializes another player's cards;
 * opponents expose only handCount + status). Ranking is finish order. The v2.7.0
 * removal contract is honored: _removeFromActive = finished (still scored),
 * removePlayer = left (pruned from results).
 */
export class President extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { finish: 'finished' },
      },
    });
    this.hands = {};
    this.seating = [];
    this.pile = [];
    this.trickCount = 0;
    this.trickTopRank = 0;
    this.trickLeader = null;
    this.passedThisTrick = new Set();
    this.finishOrder = [];
    this.lastAction = null;
    this._turnTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.hands = {};
    this.seating = [...this.players];
    this.pile = [];
    this.trickCount = 0;
    this.trickTopRank = 0;
    this.passedThisTrick = new Set();
    this.finishOrder = [];
    this.lastAction = null;
    const deck = buildDeck();
    this.players.forEach((p) => { this.hands[p] = []; });
    deck.forEach((c, i) => { this.hands[this.players[i % this.players.length]].push(c); });
    this.players.forEach((p) => this.hands[p].sort((a, b) => a.rankValue - b.rankValue));
    this.transition('start');
    this.trickLeader = this.players[0];
    this.setTurnPlayer(this.players[0]);
    this._startTurnTimer();
  }

  onEnterFinished() { if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; } }

  // ---- seat helpers (use immutable seating so removals don't corrupt order) ----
  _nextEligibleAfter(pid) {
    const seats = this.seating;
    const start = seats.indexOf(pid);
    for (let step = 1; step <= seats.length; step++) {
      const cand = seats[(start + step + seats.length) % seats.length];
      if (this.activePlayers.includes(cand) && !this.passedThisTrick.has(cand)) return cand;
    }
    return null;
  }
  _nextActiveAfter(pid) {
    const seats = this.seating;
    const start = seats.indexOf(pid);
    for (let step = 1; step <= seats.length; step++) {
      const cand = seats[(start + step + seats.length) % seats.length];
      if (this.activePlayers.includes(cand)) return cand;
    }
    return this.activePlayers[0] || null;
  }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return;
    const type = action && action.type;
    if (type === 'play') this._handlePlay(playerId, action);
    else if (type === 'pass') this._handlePass(playerId);
    else if (type === 'ping') { this._onTurnTimeout(); this._emitChange(); }
  }

  _handlePlay(playerId, action) {
    const hand = this.hands[playerId];
    if (!hand) return;
    const idxs = action.cardIndexes;
    if (!Array.isArray(idxs) || idxs.length === 0) return;
    if (new Set(idxs).size !== idxs.length) return;                 // distinct
    if (idxs.some((i) => !Number.isInteger(i) || i < 0 || i >= hand.length)) return;
    const group = idxs.map((i) => hand[i]);
    const rv = group[0].rankValue;
    if (group.some((c) => c.rankValue !== rv)) return;              // same rank
    // count rule
    if (this.trickCount === 0) { /* open lead — any 1..4 */ if (group.length > 4) return; }
    else if (group.length !== this.trickCount) return;
    // rank rule
    if (this.trickTopRank !== 0 && rv <= this.trickTopRank) return;

    // apply
    const removeSet = new Set(idxs);
    this.hands[playerId] = hand.filter((_, i) => !removeSet.has(i));
    this.pile.push({ playerId, cards: group, rankValue: rv, count: group.length });
    this.trickCount = group.length;
    this.trickTopRank = rv;
    this.trickLeader = playerId;
    this.lastAction = { type: this.pile.length === 1 ? 'lead' : 'play', playerId, cards: group };

    if (this.hands[playerId].length === 0) this._finishPlayer(playerId);
    if (this.state === 'playing') {
      this._advanceTurn(playerId);
      this._startTurnTimer();
    }
  }

  _handlePass(playerId) {
    if (this.trickCount === 0) return; // forced lead — cannot pass
    this.passedThisTrick.add(playerId);
    this.lastAction = { type: 'pass', playerId };
    this._advanceTurn(playerId);
    this._startTurnTimer();
  }

  _advanceTurn(fromPlayer) {
    const eligible = this.activePlayers.filter((p) => !this.passedThisTrick.has(p));
    if (eligible.length <= 1) { this._clearTrick(fromPlayer); return; }
    const next = this._nextEligibleAfter(fromPlayer);
    if (next) this.setTurnPlayer(next);
    else this._clearTrick(fromPlayer);
  }

  _clearTrick(leadRef) {
    this.pile = [];
    this.trickCount = 0;
    this.trickTopRank = 0;
    this.passedThisTrick.clear();
    let lead = this.trickLeader;
    if (!lead || !this.activePlayers.includes(lead)) {
      lead = this._nextActiveAfter(leadRef != null ? leadRef : (this.trickLeader || this.currentTurnPlayer));
    }
    this.trickLeader = lead;
    if (lead) this.setTurnPlayer(lead);
    this.lastAction = { type: 'clear' };
  }

  _finishPlayer(playerId) {
    this.finishOrder.push(playerId);
    this._removeFromActive(playerId);
    this.passedThisTrick.delete(playerId);
    if (this.activePlayers.length <= 1) this._finalizeRound();
  }

  _finalizeRound() {
    for (const p of this.activePlayers) if (!this.finishOrder.includes(p)) this.finishOrder.push(p);
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    if (this.state === 'playing') this.transition('finish');
  }

  _onTurnTimeout() {
    if (this.state !== 'playing') return;
    const pid = this.currentTurnPlayer;
    if (!pid) return;
    const hand = this.hands[pid];
    if (this.trickCount === 0) {
      if (hand && hand.length) {
        let lowIdx = 0;
        for (let i = 1; i < hand.length; i++) if (hand[i].rankValue < hand[lowIdx].rankValue) lowIdx = i;
        this._handlePlay(pid, { type: 'play', cardIndexes: [lowIdx] });
        return;
      }
    }
    this._handlePass(pid);
  }

  _startTurnTimer() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    if (this.state !== 'playing') return;
    this._turnTimer = setTimeout(() => { this._onTurnTimeout(); this._emitChange(); }, TURN_MS);
  }

  removePlayer(playerId) {
    const wasCurrent = this.currentTurnPlayer === playerId;
    const wasLeader = this.trickLeader === playerId;
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.hands[playerId];
    this.passedThisTrick.delete(playerId);
    this.finishOrder = this.finishOrder.filter((p) => p !== playerId);

    if (this.state !== 'playing') { return; }

    if (this.activePlayers.length <= 1) { this._finalizeRound(); return; }

    if (wasLeader) {
      this._clearTrick(playerId); // leader gone → clear, lead to next active after their seat
    } else if (wasCurrent) {
      const next = this._nextEligibleAfter(playerId);
      if (next) this.setTurnPlayer(next);
      else this._clearTrick(playerId);
    } else {
      const eligible = this.activePlayers.filter((p) => !this.passedThisTrick.has(p));
      if (eligible.length <= 1) this._clearTrick(this.trickLeader);
    }
    this._startTurnTimer();
  }

  destroy() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    this._onStateChange = null;
  }

  getStateForPlayer(playerId) {
    const isMyTurn = this.currentTurnPlayer === playerId && this.state === 'playing';
    return {
      phase: this.state,
      myId: playerId,
      myHand: this.hands[playerId] || [],
      myFinished: this.finishOrder.includes(playerId),
      isMyTurn,
      currentTurnPlayer: this.currentTurnPlayer,
      trickCount: this.trickCount,
      trickTopRank: this.trickTopRank,
      pile: this.pile.map((p) => ({ playerId: p.playerId, cards: p.cards, count: p.count })),
      lastAction: this.lastAction,
      passedPlayers: [...this.passedThisTrick],
      finishOrder: [...this.finishOrder],
      canPass: isMyTurn && this.trickCount !== 0,
      canLeadOnly: isMyTurn && this.trickCount === 0,
      players: this.players.map((p) => ({
        playerId: p,
        handCount: (this.hands[p] || []).length,
        finished: this.finishOrder.includes(p),
        passed: this.passedThisTrick.has(p),
        isLeader: this.trickLeader === p,
      })),
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const order = [...this.finishOrder];
    for (const p of this.players) if (!order.includes(p)) order.push(p); // safety net
    const titles = TITLES_FOR(order.length);
    return order.map((p, i) => ({
      playerId: p,
      placement: i + 1,
      rankTitle: titles[i],
      handDescription: titles[i],
    }));
  }
}
