import { BaseGame } from './BaseGame.js';
import { rollMultiple } from '../utils/Dice.js';

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
  }

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
      } else if (action.type === 'challenge') {
        if (!this.currentBid) return;
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
    const needAck = this.players.filter((p) => !this.eliminated.includes(p));
    if (!needAck.every((p) => this.challengeAcknowledged.has(p))) return;
    if (this._challengeTimer) { clearTimeout(this._challengeTimer); this._challengeTimer = null; }
    this._advanceAfterChallenge();
  }

  _startChallengeAckTimer() {
    if (this._challengeTimer) clearTimeout(this._challengeTimer);
    this._challengeTimer = setTimeout(() => {
      if (this.state !== 'challenging') return;
      // Auto-ack all non-eliminated players
      for (const p of this.players) {
        if (!this.eliminated.includes(p)) this.challengeAcknowledged.add(p);
      }
      this._checkChallengeAckComplete();
    }, 10000); // 10 second auto-advance
  }

  _advanceAfterChallenge() {
    const { loser, challenger } = this.challengeResult;

    this.dice[loser] = this.dice[loser].slice(0, -1);

    if (this.dice[loser].length === 0) {
      this.eliminated.push(loser);
      this.removePlayer(loser);
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
