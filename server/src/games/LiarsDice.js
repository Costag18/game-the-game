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
    if (this.state !== 'bidding') return;
    if (playerId !== this.currentTurnPlayer) return;

    if (action.type === 'bid') {
      const { quantity, faceValue } = action;
      if (!this._isBidValid(quantity, faceValue)) return;
      this.currentBid = { quantity, faceValue };
      this.lastBidder = playerId;
      this.nextTurn();
    } else if (action.type === 'challenge') {
      if (!this.currentBid) return; // can't challenge if no bid has been made
      this.transition('challenge');
      this._resolveChallenge(playerId);
    }
  }

  _resolveChallenge(challenger) {
    const { quantity, faceValue } = this.currentBid;
    const actualCount = this._countFaceValue(faceValue);
    // If actual count >= bid quantity, bid was correct or conservative -> challenger loses a die
    // If actual count < bid quantity, bid was too high -> bidder loses a die
    let loser;
    if (actualCount >= quantity) {
      loser = challenger;
    } else {
      loser = this.lastBidder;
    }

    this.dice[loser] = this.dice[loser].slice(0, -1);

    // Check if loser is eliminated
    if (this.dice[loser].length === 0) {
      this.eliminated.push(loser);
      this.removePlayer(loser);
    }

    // Reset bid
    this.currentBid = null;
    this.lastBidder = null;

    // Check if game is over
    if (this.activePlayers.length <= 1) {
      this.transition('finish');
      return;
    }

    // Re-roll and start new bidding round
    // The loser starts next round (if not eliminated), else the challenger
    let nextPlayer;
    if (this.activePlayers.includes(loser)) {
      nextPlayer = loser;
    } else {
      // loser was eliminated — challenger starts (if still active), else current turn
      nextPlayer = this.activePlayers.includes(challenger)
        ? challenger
        : this.currentTurnPlayer;
    }
    this._rollAll();
    this.transition('reroll');
    this.setTurnPlayer(nextPlayer);
  }

  getStateForPlayer(playerId) {
    const otherPlayers = this.players
      .filter((p) => p !== playerId)
      .map((p) => ({
        playerId: p,
        diceCount: (this.dice[p] || []).length,
        eliminated: this.eliminated.includes(p),
      }));
    return {
      myDice: this.dice[playerId] || [],
      otherPlayers,
      currentBid: this.currentBid,
      currentTurnPlayer: this.currentTurnPlayer,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'bidding',
      phase: this.state,
      eliminated: this.eliminated.includes(playerId),
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
