import { BaseGame } from './BaseGame.js';
import { Deck } from '../utils/Deck.js';

export class Blackjack extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'dealerTurn', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { allDone: 'dealerTurn' },
        dealerTurn: { resolve: 'finished' },
      },
    });
    this.deck = new Deck();
    this.hands = {};
    this.dealerHand = [];
    this.busted = [];
    this.stood = [];
  }

  startGame() {
    this.deck.reset();
    this.hands = {};
    this.dealerHand = [];
    this.busted = [];
    this.stood = [];
    for (const p of this.players) this.hands[p] = this.deck.dealMultiple(2);
    this.dealerHand = this.deck.dealMultiple(2);
    this.transition('start');
    this.setTurnPlayer(this.players[0]);
  }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return;
    if (action.type === 'hit') {
      const card = this.deck.deal();
      if (card) this.hands[playerId].push(card);
      if (this.calculateHandValue(this.hands[playerId]) > 21) {
        this.busted.push(playerId);
        this.advanceToNextPlayer();
      }
    } else if (action.type === 'stand') {
      this.stood.push(playerId);
      this.advanceToNextPlayer();
    }
  }

  advanceToNextPlayer() {
    const remaining = this.activePlayers.filter(
      (p) => !this.busted.includes(p) && !this.stood.includes(p)
    );
    if (remaining.length === 0) {
      this.transition('allDone');
      this.dealerPlay();
      this.transition('resolve');
    } else {
      let next = this.nextTurn();
      while (this.busted.includes(next) || this.stood.includes(next)) {
        next = this.nextTurn();
      }
    }
  }

  dealerPlay() {
    while (this.calculateHandValue(this.dealerHand) < 17) {
      const card = this.deck.deal();
      if (card) this.dealerHand.push(card);
    }
  }

  calculateHandValue(hand) {
    let total = 0, aces = 0;
    for (const card of hand) {
      if (card.rank === 1) { aces++; total += 11; }
      else if (card.rank >= 10) total += 10;
      else total += card.rank;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  getStateForPlayer(playerId) {
    return {
      myHand: this.hands[playerId] || [],
      myTotal: this.calculateHandValue(this.hands[playerId] || []),
      dealerShowing: this.state === 'finished' ? this.dealerHand : [this.dealerHand[0]],
      dealerTotal: this.state === 'finished' ? this.calculateHandValue(this.dealerHand) : null,
      otherPlayers: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        cardCount: (this.hands[p] || []).length,
        busted: this.busted.includes(p),
        stood: this.stood.includes(p),
      })),
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      busted: this.busted.includes(playerId),
      stood: this.stood.includes(playerId),
      phase: this.state,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const dealerTotal = this.calculateHandValue(this.dealerHand);
    const dealerBusted = dealerTotal > 21;
    const playerScores = this.players.map((p) => {
      const total = this.calculateHandValue(this.hands[p]);
      const busted = this.busted.includes(p);
      let score;
      if (busted) score = 0;
      else if (dealerBusted) score = total;
      else score = total > dealerTotal ? total : (total === dealerTotal ? total : 0);
      return { playerId: p, handTotal: total, busted, score };
    });
    playerScores.sort((a, b) => b.score - a.score || b.handTotal - a.handTotal);
    return playerScores.map((ps, i) => ({
      playerId: ps.playerId, placement: i + 1, handTotal: ps.handTotal, busted: ps.busted,
    }));
  }
}
