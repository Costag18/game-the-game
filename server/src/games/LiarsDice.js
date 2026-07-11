import { BaseGame } from './BaseGame.js';
import { rollMultiple } from '../utils/Dice.js';
import { TIMERS } from '../../../shared/constants.js';

const TURN_MS = TIMERS.CARD_GAME * 1000; // 30s per bidding decision

export class LiarsDice extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'rolling', 'bidding', 'challenging', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'bidding' },
        bidding: { challenge: 'challenging', finish: 'finished' },
        challenging: { reroll: 'bidding', finish: 'finished' },
      },
    });
    this.dice = {};       // playerId -> array of die values
    this.eliminated = []; // players in elimination order (first eliminated = index 0)
    this.currentBid = null; // { quantity, faceValue }
    this.lastBidder = null;
    this.challengeResult = null; // { challenger, bidder, bid, actualCount, loser, allDice }
    this.challengeAcknowledged = new Set();
    this._turnTimer = null;
    this._turnEndsAt = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.dice = {};
    this.eliminated = [];
    this.currentBid = null;
    this.lastBidder = null;
    for (const p of this.players) {
      this.dice[p] = rollMultiple(5);
    }
    this.transition('start');
    this.setTurnPlayer(this.players[0]);
    this._startTurnTimer();
  }

  // An idle bidder must never freeze the table. On timeout: make the minimal
  // legal bid, or auto-challenge once the bid can no longer be raised sanely
  // (quantity would exceed all dice in play).
  _startTurnTimer() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    if (this.state !== 'bidding') { this._turnEndsAt = null; return; }
    this._turnEndsAt = Date.now() + TURN_MS;
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'bidding') return;
      const pid = this.currentTurnPlayer;
      if (pid) {
        if (!this.currentBid) {
          this.handleAction(pid, { type: 'bid', quantity: 1, faceValue: 2 });
        } else {
          const { quantity: cq, faceValue: cf } = this.currentBid;
          const next = cf < 6
            ? { quantity: cq, faceValue: cf + 1 }
            : { quantity: cq + 1, faceValue: 2 };
          const totalDice = this.activePlayers
            .reduce((n, p) => n + (this.dice[p] || []).length, 0);
          if (next.quantity > totalDice) {
            this.handleAction(pid, { type: 'challenge' });
          } else {
            this.handleAction(pid, { type: 'bid', ...next });
          }
        }
      }
      this._emitChange();
    }, TURN_MS);
  }

  _rollAll() {
    for (const p of this.activePlayers) {
      if (this.dice[p] && this.dice[p].length > 0) {
        this.dice[p] = rollMultiple(this.dice[p].length);
      }
    }
  }

  _countFaceValue(faceValue) {
    // 1s are wild — count as any face value
    let count = 0;
    for (const p of this.activePlayers) {
      for (const d of (this.dice[p] || [])) {
        if (d === faceValue || d === 1) count++;
      }
    }
    return count;
  }

  _isBidValid(quantity, faceValue) {
    if (faceValue < 2 || faceValue > 6) return false;
    if (quantity < 1) return false;
    if (!this.currentBid) return true; // first bid, anything goes
    const { quantity: cq, faceValue: cf } = this.currentBid;
    // Higher quantity: any face value is fine
    if (quantity > cq) return true;
    // Same quantity: face value must be strictly higher
    if (quantity === cq && faceValue > cf) return true;
    return false;
  }

  handleAction(playerId, action) {
    if (this.state === 'bidding') {
      if (playerId !== this.currentTurnPlayer) return;

      if (action.type === 'bid') {
        const { quantity, faceValue } = action;
        if (!this._isBidValid(quantity, faceValue)) return;
        this.currentBid = { quantity, faceValue };
        this.lastBidder = playerId;
        this.nextTurn();
        this._startTurnTimer();
      } else if (action.type === 'challenge') {
        if (!this.currentBid) return;
        if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
        this._turnEndsAt = null;
        this.transition('challenge');
        this._resolveChallenge(playerId);
      }
    } else if (this.state === 'challenging') {
      if (action.type === 'acknowledge') {
        this.challengeAcknowledged.add(playerId);
        this._checkChallengeAckComplete();
      }
    }
  }

  _resolveChallenge(challenger) {
    const { quantity, faceValue } = this.currentBid;
    const actualCount = this._countFaceValue(faceValue);

    let loser;
    if (actualCount >= quantity) {
      loser = challenger;
    } else {
      loser = this.lastBidder;
    }

    // Store challenge result with ALL dice revealed before modifying
    this.challengeResult = {
      challenger,
      bidder: this.lastBidder,
      bid: { ...this.currentBid },
      actualCount,
      loser,
      allDice: Object.fromEntries(
        this.activePlayers.map((p) => [p, [...(this.dice[p] || [])]])
      ),
    };
    this.challengeAcknowledged = new Set();
    this._startChallengeAckTimer();
    // Stay in 'challenging' state — wait for players to see the dice reveal
  }

  _checkChallengeAckComplete() {
    if (this.state !== 'challenging') return;
    // activePlayers already excludes eliminated AND departed players, so it is
    // exactly the set that still needs to acknowledge the reveal.
    const needAck = this.activePlayers;
    if (!needAck.every((p) => this.challengeAcknowledged.has(p))) return;
    if (this._challengeTimer) { clearTimeout(this._challengeTimer); this._challengeTimer = null; }
    this._advanceAfterChallenge();
  }

  _startChallengeAckTimer() {
    if (this._challengeTimer) clearTimeout(this._challengeTimer);
    this._challengeTimer = setTimeout(() => {
      if (this.state !== 'challenging') return;
      // Auto-ack all present, non-eliminated players
      for (const p of this.activePlayers) this.challengeAcknowledged.add(p);
      this._checkChallengeAckComplete();
      this._emitChange();
    }, 10000); // 10 second auto-advance
  }

  _advanceAfterChallenge() {
    const { loser, challenger } = this.challengeResult;

    this.dice[loser] = this.dice[loser].slice(0, -1);

    if (this.dice[loser].length === 0) {
      this.eliminated.push(loser);
      this._removeFromActive(loser);
    }

    this.currentBid = null;
    this.lastBidder = null;
    this.challengeResult = null;

    if (this.activePlayers.length <= 1) {
      this.transition('finish');
      return;
    }

    let nextPlayer;
    if (this.activePlayers.includes(loser)) {
      nextPlayer = loser;
    } else {
      nextPlayer = this.activePlayers.includes(challenger)
        ? challenger
        : this.currentTurnPlayer;
    }
    this._rollAll();
    this.transition('reroll');
    this.setTurnPlayer(nextPlayer);
    this._startTurnTimer();
  }

  removePlayer(playerId) {
    // Departure (not elimination): prune the leaver from this.players too.
    super.removePlayer(playerId);
    this.challengeAcknowledged?.delete(playerId);

    if (this.activePlayers.length <= 1 && this.state !== 'finished') {
      if (this._challengeTimer) { clearTimeout(this._challengeTimer); this._challengeTimer = null; }
      if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
      this.state = 'finished';
      return;
    }
    // If they were holding up the reveal acknowledgement, re-check now.
    if (this.state === 'challenging') {
      this._checkChallengeAckComplete();
    } else if (this.state === 'bidding') {
      // Turn may have been reassigned off the leaver — restart their clock.
      this._startTurnTimer();
    }
  }

  destroy() {
    if (this._challengeTimer) { clearTimeout(this._challengeTimer); this._challengeTimer = null; }
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
  }

  getStateForPlayer(playerId) {
    const isChallenge = this.state === 'challenging';
    const otherPlayers = this.players
      .filter((p) => p !== playerId)
      .map((p) => ({
        playerId: p,
        diceCount: (this.dice[p] || []).length,
        eliminated: this.eliminated.includes(p),
        // Reveal dice during challenge
        dice: isChallenge && this.challengeResult ? (this.challengeResult.allDice[p] || []) : null,
      }));
    return {
      myDice: this.dice[playerId] || [],
      otherPlayers,
      currentBid: this.currentBid,
      currentTurnPlayer: this.currentTurnPlayer,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'bidding',
      turnEndsAt: this.state === 'bidding' ? this._turnEndsAt : null,
      phase: this.state,
      eliminated: this.eliminated.includes(playerId),
      challengeResult: isChallenge ? this.challengeResult : null,
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    // Winner = last player standing (still in activePlayers)
    const results = [];
    let placement = 1;
    for (const p of this.activePlayers) {
      results.push({ playerId: p, placement });
      placement++;
    }
    // Eliminated in reverse order (last eliminated = higher placement)
    const reversedElim = [...this.eliminated].reverse();
    for (const p of reversedElim) {
      results.push({ playerId: p, placement });
      placement++;
    }
    return results;
  }
}
