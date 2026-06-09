import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const IDLE_MS = TIMERS.SPOONS_IDLE * 1000; // 25s
const GRAB_MS = TIMERS.SPOONS_GRAB * 1000; // 4s
const ACK_MS = 10_000;
const HAND_SIZE = 4;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];

function buildRoundDeck(numRanks) {
  const deck = [];
  const ranks = RANKS.slice(0, numRanks);
  for (const rank of ranks) for (const suit of SUITS) deck.push({ rank, suit, id: `${rank}${suit}` });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Spoons — real-time grab-race shedding game with internal elimination rounds.
 * Server-authoritative: every hand lives only on the server (getStateForPlayer
 * sends counts for opponents, never their cards), 4-of-a-kind is detected
 * server-side, and the grab race is resolved by SERVER ARRIVAL ORDER (a monotonic
 * `seq`), never client timestamps — so a fast network or a forged "I grabbed at
 * time T" can't steal a spoon. Reverse-elimination order is the ranking.
 */
export class Spoons extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'passing', 'grab', 'roundEnd', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'passing' },
        passing: { grabOpen: 'grab', finish: 'finished' },
        grab: { resolveGrab: 'roundEnd', finish: 'finished' },
        roundEnd: { next: 'passing', finish: 'finished' },
      },
    });
    this.survivors = [...players];
    this.eliminationOrder = [];
    this.roundNumber = 0;
    this.hands = {};
    this.incoming = {};
    this.drawPile = [];
    this.dealerId = null;
    this.passSeq = 0;
    this.grabbers = {};
    this.spoonsRemaining = 0;
    this.grabTriggeredBy = null;
    this.fourOfAKindRank = null;
    this.acknowledged = new Set();
    this.lastRoundSummary = null;
    this.roundActive = false;
    this._idleTimer = null;
    this._grabTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.roundNumber = 1;
    this.transition('start'); // -> onEnterPassing
  }

  // ---------- PASSING ----------
  onEnterPassing() {
    const s = this.survivors.length;
    const deck = buildRoundDeck(s + 1); // 4*(s+1) cards → 4 each + 4 spare
    this.hands = {};
    this.incoming = {};
    for (const p of this.survivors) { this.hands[p] = deck.splice(0, HAND_SIZE); this.incoming[p] = []; }
    this.drawPile = deck; // remaining 4 seed the flow
    this.dealerId = this.survivors[0];
    this.grabbers = {};
    this.grabTriggeredBy = null;
    this.fourOfAKindRank = null;
    this.roundActive = true;
    this._resetIdleTimer();
    this._emitChange();
  }

  _nextSeat(pid) {
    const i = this.survivors.indexOf(pid);
    return this.survivors[(i + 1) % this.survivors.length];
  }
  _canTake(pid) {
    return (this.incoming[pid] && this.incoming[pid].length > 0) ||
      (pid === this.dealerId && this.drawPile.length > 0);
  }
  _pickup(pid) {
    if (this.incoming[pid] && this.incoming[pid].length > 0) return this.incoming[pid].shift();
    if (pid === this.dealerId && this.drawPile.length > 0) return this.drawPile.shift();
    return null;
  }
  _isFourOfAKind(hand) {
    return hand.length === HAND_SIZE && hand.every((c) => c.rank === hand[0].rank);
  }

  // ---------- GRAB ----------
  _openGrab(pid, rank) {
    if (this.state !== 'passing') return;
    this.grabTriggeredBy = pid;
    this.fourOfAKindRank = rank;
    this.grabbers = {};
    this._clearTimer('_idleTimer');
    this.transition('grabOpen'); // -> onEnterGrab
    this._emitChange();
  }
  onEnterGrab() {
    this.spoonsRemaining = this.survivors.length - 1;
    this._clearTimer('_grabTimer');
    this._grabTimer = setTimeout(() => {
      if (this.state !== 'grab') return;
      this._resolveGrab();
      this._emitChange();
    }, GRAB_MS);
  }

  _resolveGrab() {
    if (this.state !== 'grab') return;
    // Auto-grab any non-grabber (timeout path) with the highest seqs, in seat order,
    // so the slowest / non-grabber is deterministically last.
    for (const p of this.survivors) {
      if (!this.grabbers[p]) this.grabbers[p] = { ts: 0, seq: ++this.passSeq, auto: true };
    }
    const ordered = [...this.survivors].sort((a, b) => this.grabbers[a].seq - this.grabbers[b].seq);
    const loser = ordered[ordered.length - 1]; // highest seq = no spoon
    this._eliminate(loser);
    this.lastRoundSummary = {
      eliminated: loser,
      grabTriggeredBy: this.grabTriggeredBy,
      fourOfAKindRank: this.fourOfAKindRank,
      grabOrder: ordered.filter((p) => !this.grabbers[p].auto),
      roundNumber: this.roundNumber,
    };
    this._clearTimer('_grabTimer');
    this.transition('resolveGrab'); // -> onEnterRoundEnd
  }

  _eliminate(pid) {
    if (!this.eliminationOrder.includes(pid)) this.eliminationOrder.push(pid);
    this.survivors = this.survivors.filter((p) => p !== pid);
    this._removeFromActive(pid); // out of rotation, STAYS in this.players for scoring
  }

  // ---------- ROUND END ----------
  onEnterRoundEnd() {
    this.acknowledged = new Set();
    this.roundActive = false;
    this._clearTimer('_ackTimer');
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'roundEnd') return;
      for (const p of this.survivors) this.acknowledged.add(p);
      this._advanceAfterRound();
      this._emitChange();
    }, ACK_MS);
  }
  _checkRoundEndComplete() {
    if (this.state !== 'roundEnd') return;
    if (!this.survivors.every((p) => this.acknowledged.has(p))) return;
    this._advanceAfterRound();
  }
  _advanceAfterRound() {
    if (this.state !== 'roundEnd') return;
    this._clearTimer('_ackTimer');
    if (this.survivors.length <= 1) {
      this.transition('finish');
    } else {
      this.roundNumber++;
      this.transition('next'); // -> onEnterPassing (re-deal)
    }
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.survivors.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'passing' && type === 'takeAndDiscard') {
      this._handleTakeAndDiscard(playerId, action);
    } else if (this.state === 'grab' && type === 'grab') {
      this._handleGrab(playerId);
    } else if (this.state === 'roundEnd' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRoundEndComplete();
    } else if (type === 'ping') {
      this._handlePing();
    }
  }

  _handleTakeAndDiscard(playerId, action) {
    if (!this.roundActive) return;
    if (!this._canTake(playerId)) return;
    const card = this._pickup(playerId);
    if (!card) return;
    const hand = this.hands[playerId];
    hand.push(card); // now 5
    let idx = action.cardIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= hand.length) idx = hand.length - 1; // discard the picked card
    const discard = hand.splice(idx, 1)[0];
    this.passSeq++;

    if (this._isFourOfAKind(hand)) {
      this._openGrab(playerId, hand[0].rank); // round freezes; discard is dropped
      return;
    }
    this.incoming[this._nextSeat(playerId)].push(discard);
    this._resetIdleTimer();
    this._emitChange();
  }

  _handleGrab(playerId) {
    if (this.grabbers[playerId]) return;
    this.grabbers[playerId] = { ts: Date.now(), seq: ++this.passSeq };
    // resolve as soon as everyone-but-one has grabbed (the last is the loser)
    if (Object.keys(this.grabbers).length >= this.survivors.length - 1) {
      this._resolveGrab();
    }
    this._emitChange();
  }

  _handlePing() {
    if (this.state === 'grab' && this._grabTimer === null) { /* already resolved */ return; }
    // idempotent: nothing to force here that the timers don't already cover
  }

  // ---------- TIMERS ----------
  _resetIdleTimer() {
    this._clearTimer('_idleTimer');
    if (this.state !== 'passing') return;
    this._idleTimer = setTimeout(() => {
      if (this.state !== 'passing') return;
      this._forceFlow();
      this._resetIdleTimer();
      this._emitChange();
    }, IDLE_MS);
  }
  // Force progress so a frozen ring can't deadlock: the first player who can take
  // picks up and immediately forwards that same card (never completes a 4-of-a-kind).
  _forceFlow() {
    const actor = this.survivors.find((p) => this._canTake(p));
    if (!actor) return;
    const card = this._pickup(actor);
    if (!card) return;
    this.incoming[this._nextSeat(actor)].push(card);
    this.passSeq++;
  }
  _clearTimer(name) { if (this[name]) { clearTimeout(this[name]); this[name] = null; } }
  _clearTimers() { this._clearTimer('_idleTimer'); this._clearTimer('_grabTimer'); this._clearTimer('_ackTimer'); }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    const wasSurvivor = this.survivors.includes(playerId);
    super.removePlayer(playerId); // prunes this.players + activePlayers rotation
    if (!wasSurvivor) return;
    this.survivors = this.survivors.filter((p) => p !== playerId);
    if (this.incoming[playerId]) { this.drawPile.push(...this.incoming[playerId]); delete this.incoming[playerId]; }
    delete this.hands[playerId];
    delete this.grabbers[playerId];

    if (this.survivors.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      this._emitChange();
      return;
    }

    if (this.state === 'passing') {
      if (this.dealerId === playerId) this.dealerId = this.survivors[0];
      this._resetIdleTimer();
    } else if (this.state === 'grab') {
      // one fewer racer: re-evaluate. If at most one remaining survivor hasn't
      // grabbed, resolve now (that one is the loser). Leaver is pruned from results.
      this.spoonsRemaining = this.survivors.length - 1;
      if (Object.keys(this.grabbers).length >= this.survivors.length - 1) this._resolveGrab();
    } else if (this.state === 'roundEnd') {
      this.acknowledged.add(playerId);
      this._checkRoundEndComplete();
    }
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const phase = this.state;
    const incHead = this.incoming[playerId] && this.incoming[playerId][0];
    return {
      phase,
      roundNumber: this.roundNumber,
      totalRounds: this.players.length - 1,
      myId: playerId,
      iAmSurvivor: this.survivors.includes(playerId),
      myHand: this.hands[playerId] || [],
      myIncomingCount: (this.incoming[playerId] || []).length,
      myNextCard: phase === 'passing' && incHead ? incHead : null,
      canTake: phase === 'passing' && this._canTake(playerId),
      isDealer: this.dealerId === playerId,
      drawPileCount: this.drawPile.length,
      seats: this.survivors.map((p) => ({
        playerId: p,
        isMe: p === playerId,
        handCount: (this.hands[p] || []).length,
        incomingCount: (this.incoming[p] || []).length,
        hasGrabbed: phase !== 'passing' ? !!this.grabbers[p] : false,
      })),
      spoonsRemaining: phase === 'grab' ? this.spoonsRemaining : null,
      grabTriggeredBy: phase === 'grab' || phase === 'roundEnd' ? this.grabTriggeredBy : null,
      iHaveGrabbed: !!this.grabbers[playerId],
      acknowledged: phase === 'roundEnd' ? [...this.acknowledged] : [],
      lastRoundSummary: phase === 'roundEnd' || phase === 'finished' ? this.lastRoundSummary : null,
      eliminationOrder: phase === 'finished' ? [...this.eliminationOrder] : undefined,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const winner = this.survivors[0];
    const base = [...this.eliminationOrder];
    if (winner && !base.includes(winner)) base.push(winner);
    let ranked = base.filter((p) => this.players.includes(p)); // leavers pruned from roster
    for (const p of this.players) if (!ranked.includes(p)) ranked.unshift(p);
    ranked = ranked.reverse(); // winner first
    return ranked.map((pid, i) => ({
      playerId: pid,
      placement: i + 1,
      survivedToEnd: pid === winner,
      eliminatedRound: this.eliminationOrder.includes(pid) ? this.eliminationOrder.indexOf(pid) + 1 : null,
      handDescription: pid === winner ? 'Last one standing 🥄' : `Out round ${this.eliminationOrder.indexOf(pid) + 1}`,
    }));
  }
}
