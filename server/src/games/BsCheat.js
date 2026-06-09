import { BaseGame } from './BaseGame.js';
import { Deck } from '../utils/Deck.js';
import { TIMERS } from '../../../shared/constants.js';

const CHALLENGE_MS = TIMERS.BS_CHALLENGE * 1000; // 4s
const TURN_MS = TIMERS.CARD_GAME * 1000;         // 30s
const REVEAL_MS = 10_000;

/**
 * BS (Cheat) — turn-based bluff. Cards go face down on a shared pile; the claimed
 * rank rotates A→2→…→K each turn. Place 1–4 cards claiming the current rank; any
 * other player may call BS during a short window. On a call the cards are revealed:
 * if the claim was a lie the claimant scoops the pile, else the challenger does.
 * Empty your hand to escape; finish order ranks everyone.
 */
export class BsCheat extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'challengeWindow', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { place: 'challengeWindow', finish: 'finished' },
        challengeWindow: { challenge: 'reveal', pass: 'playing', finish: 'finished' },
        reveal: { next: 'playing', finish: 'finished' },
      },
    });
    this.deck = new Deck();
    this.hands = {};
    this.pile = [];
    this.requiredRank = 1;
    this.finishOrder = [];
    this.pendingPlay = null;
    this.revealResult = null;
    this.acknowledged = new Set();
    this.lastPlayerId = null;
    this._challenger = null;
    this._turnArmedFor = null;
    this._challengeTimer = null;
    this._revealTimer = null;
    this._turnTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.deck.reset();
    for (const p of this.players) this.hands[p] = [];
    let card;
    let i = 0;
    while ((card = this.deck.deal()) !== null) {
      this.hands[this.players[i % this.players.length]].push(card);
      i++;
    }
    this.pile = [];
    this.requiredRank = 1;
    this.finishOrder = [];
    this.setTurnPlayer(this.players[0]);
    this.transition('start'); // -> onEnterPlaying
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterPlaying() {
    this.pendingPlay = null;
    this.revealResult = null;
    this._challenger = null;
    this._armTurnTimer();
  }

  onEnterChallengeWindow() {
    if (this._challengeTimer) clearTimeout(this._challengeTimer);
    this._challengeTimer = setTimeout(() => {
      if (this.state !== 'challengeWindow') return;
      this._resolveNoChallenge();
      this._emitChange();
    }, CHALLENGE_MS);
  }

  onEnterReveal() {
    this._resolveChallenge(this._challenger);
    this.acknowledged = new Set();
    if (this._revealTimer) clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.activePlayers) this.acknowledged.add(p);
      this._advanceAfterReveal();
      this._emitChange();
    }, REVEAL_MS);
  }

  onEnterFinished() { this._clearAllTimers(); }

  // --- turn timer ------------------------------------------------------------

  _armTurnTimer() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    this._turnArmedFor = this.currentTurnPlayer;
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'playing' || this.currentTurnPlayer !== this._turnArmedFor) return;
      this._autoPlay();
      this._emitChange();
    }, TURN_MS);
  }

  _autoPlay() {
    const hand = this.hands[this.currentTurnPlayer] || [];
    if (hand.length === 0) return;
    let minIdx = 0;
    for (let k = 1; k < hand.length; k++) if (hand[k].rank < hand[minIdx].rank) minIdx = k;
    this._doPlace(this.currentTurnPlayer, [minIdx]);
  }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'playing') {
      if (type === 'place' && playerId === this.currentTurnPlayer) {
        this._doPlace(playerId, action.cards);
      }
    } else if (this.state === 'challengeWindow') {
      if (type === 'callBS' && this.pendingPlay
          && playerId !== this.pendingPlay.playerId
          && this.activePlayers.includes(playerId)) {
        if (this._challengeTimer) { clearTimeout(this._challengeTimer); this._challengeTimer = null; }
        this._challenger = playerId;
        this.transition('challenge'); // -> onEnterReveal
      } else if (type === 'ping') {
        if (Date.now() >= 0 && !this._challengeTimer) this._resolveNoChallenge();
      }
    } else if (this.state === 'reveal') {
      if (type === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealAckComplete();
      }
    }
  }

  _doPlace(playerId, cards) {
    const hand = this.hands[playerId];
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > 4) return;
    const idxs = [...new Set(cards)];
    if (idxs.length !== cards.length) return; // duplicate indices
    if (idxs.some((i) => !Number.isInteger(i) || i < 0 || i >= hand.length)) return;
    if (hand.length < idxs.length) return;

    const removed = [];
    for (const i of [...idxs].sort((a, b) => b - a)) removed.push(hand.splice(i, 1)[0]);
    removed.reverse();
    this.pile.push(...removed);
    this.pendingPlay = {
      playerId, cards: removed, claimedRank: this.requiredRank, claimedCount: removed.length,
    };
    this.lastPlayerId = playerId;
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    this.transition('place'); // -> onEnterChallengeWindow
  }

  _resolveNoChallenge() {
    if (this.state !== 'challengeWindow') return;
    if (this._challengeTimer) { clearTimeout(this._challengeTimer); this._challengeTimer = null; }
    if (this.pendingPlay) this._finishIfEmpty(this.pendingPlay.playerId);
    this._afterResolution();
  }

  _resolveChallenge(challenger) {
    const pp = this.pendingPlay;
    const lied = pp.cards.some((c) => c.rank !== pp.claimedRank);
    const takerId = lied ? pp.playerId : challenger;
    this.revealResult = {
      liar: lied,
      playerId: pp.playerId,
      challenger,
      claimedRank: pp.claimedRank,
      revealedCards: [...pp.cards],
      takerId,
      pileSize: this.pile.length,
    };
    this.hands[takerId] = (this.hands[takerId] || []).concat(this.pile);
    this.pile = [];
  }

  _checkRevealAckComplete() {
    if (this.state !== 'reveal') return;
    if (!this.activePlayers.every((p) => this.acknowledged.has(p))) return;
    this._advanceAfterReveal();
  }

  _advanceAfterReveal() {
    if (this.state !== 'reveal') return;
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
    for (const p of [...this.activePlayers]) this._finishIfEmpty(p);
    this._afterResolution();
  }

  _finishIfEmpty(p) {
    if (!this.players.includes(p)) return;       // a leaver is never "finished"
    if (this.finishOrder.includes(p)) return;
    if ((this.hands[p] || []).length === 0) {
      this.finishOrder.push(p);
      this._removeFromActive(p);
    }
  }

  // After any resolution: finish the game or advance to the next playing turn.
  _afterResolution() {
    if (this.activePlayers.length <= 1) {
      this._clearAllTimers();
      this.state = 'finished';
      return;
    }
    this.requiredRank = (this.requiredRank % 13) + 1;
    this._advanceTurnFrom(this.lastPlayerId);
    if (this.state === 'challengeWindow') this.transition('pass');
    else if (this.state === 'reveal') this.transition('next');
  }

  _advanceTurnFrom(anchorId) {
    const seats = this.players;
    if (seats.length === 0) return;
    let idx = seats.indexOf(anchorId);
    if (idx === -1) idx = this.turnIndex % seats.length;
    for (let step = 1; step <= seats.length; step++) {
      const cand = seats[(idx + step) % seats.length];
      if (this.activePlayers.includes(cand)) { this.setTurnPlayer(cand); return; }
    }
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    const wasCurrent = this.currentTurnPlayer === playerId;
    const wasClaimant = this.pendingPlay && this.pendingPlay.playerId === playerId;

    if (wasCurrent && this.state === 'playing' && this.players.length > 1) {
      this.requiredRank = (this.requiredRank % 13) + 1; // their skipped claim still rotates the cycle
      this._advanceTurnFrom(playerId);
    }

    super.removePlayer(playerId);
    delete this.hands[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.activePlayers.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      return;
    }

    if (this.state === 'challengeWindow') {
      if (wasClaimant) {
        if (this._challengeTimer) { clearTimeout(this._challengeTimer); this._challengeTimer = null; }
        this._resolveNoChallenge();
        this._emitChange();
      }
    } else if (this.state === 'reveal') {
      this._checkRevealAckComplete();
    } else if (this.state === 'playing' && wasCurrent) {
      this._armTurnTimer();
      this._emitChange();
    }
  }

  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  _clearAllTimers() {
    for (const t of ['_challengeTimer', '_revealTimer', '_turnTimer']) {
      if (this[t]) { clearTimeout(this[t]); this[t] = null; }
    }
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    return {
      phase: this.state,
      myHand: this.hands[playerId] || [],
      requiredRank: this.requiredRank,
      pileCount: this.pile.length,
      currentTurnPlayer: this.currentTurnPlayer,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      lastPlayerId: this.lastPlayerId,
      pendingPlay: this.state === 'challengeWindow' && this.pendingPlay ? {
        playerId: this.pendingPlay.playerId,
        claimedRank: this.pendingPlay.claimedRank,
        claimedCount: this.pendingPlay.claimedCount,
      } : null,
      canCallBS: this.state === 'challengeWindow'
        && !!this.pendingPlay
        && this.pendingPlay.playerId !== playerId
        && this.activePlayers.includes(playerId),
      revealResult: this.state === 'reveal' ? this.revealResult : null,
      myId: playerId,
      acknowledged: [...this.acknowledged],
      finished: this.finishOrder.includes(playerId),
      finishOrder: [...this.finishOrder],
      otherPlayers: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        handCount: (this.hands[p] || []).length,
        finished: this.finishOrder.includes(p),
      })),
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const results = [];
    let placement = 1;
    for (const p of this.finishOrder) {
      results.push({ playerId: p, placement, cardsRemaining: 0, handDescription: `Escaped #${placement}` });
      placement++;
    }
    const remaining = this.players
      .filter((p) => !this.finishOrder.includes(p))
      .map((p) => ({ playerId: p, cardsRemaining: (this.hands[p] || []).length }))
      .sort((a, b) => a.cardsRemaining - b.cardsRemaining);
    for (let i = 0; i < remaining.length; i++) {
      if (i > 0 && remaining[i].cardsRemaining !== remaining[i - 1].cardsRemaining) {
        placement = results.length + 1;
      }
      results.push({
        playerId: remaining[i].playerId,
        placement,
        cardsRemaining: remaining[i].cardsRemaining,
        handDescription: `${remaining[i].cardsRemaining} cards left`,
      });
    }
    return results;
  }
}
