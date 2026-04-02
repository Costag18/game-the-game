import { BaseGame } from './BaseGame.js';
import { Deck } from '../utils/Deck.js';

const HANDS_PER_GAME = 5;

export class Blackjack extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'dealerTurn', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { allDone: 'dealerTurn' },
        dealerTurn: { resolve: 'reveal' },
        reveal: { nextHand: 'playing', finish: 'finished' },
      },
    });
    this.deck = new Deck();
    this.hands = {};
    this.dealerHand = [];
    this.busted = [];
    this.stood = [];
    this.handNumber = 0;
    this.wins = {}; // playerId -> win count across hands
    this.handResults = []; // history of each hand
    this.acknowledged = new Set();
  }

  startGame() {
    this.handNumber = 0;
    this.wins = {};
    this.handResults = [];
    for (const p of this.players) this.wins[p] = 0;
    this.transition('start');
    this._startHand();
  }

  _startHand() {
    this.handNumber++;
    this.deck.reset();
    this.hands = {};
    this.dealerHand = [];
    this.busted = [];
    this.stood = [];
    this.acknowledged = new Set();

    for (const p of this.players) this.hands[p] = this.deck.dealMultiple(2);
    this.dealerHand = this.deck.dealMultiple(2);
    this.setTurnPlayer(this.players[0]);
  }

  handleAction(playerId, action) {
    if (this.state === 'playing') {
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
    } else if (this.state === 'reveal') {
      if (action.type === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealComplete();
      }
    } else if (this.state === 'finished') {
      // Ignore actions after game ends
      return;
    }
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (!this.players.every((p) => this.acknowledged.has(p))) return;
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
    this._advanceAfterReveal();
  }

  _startRevealTimer() {
    if (this._revealTimer) clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._checkRevealComplete();
    }, 10000);
  }

  advanceToNextPlayer() {
    const remaining = this.activePlayers.filter(
      (p) => !this.busted.includes(p) && !this.stood.includes(p)
    );
    if (remaining.length === 0) {
      this.transition('allDone');
      this.dealerPlay();
      this._recordHandResult();
      this.transition('resolve');
      this.acknowledged = new Set();
      this._startRevealTimer();
    } else {
      let next = this.nextTurn();
      while (this.busted.includes(next) || this.stood.includes(next)) {
        next = this.nextTurn();
      }
    }
  }

  _recordHandResult() {
    const dealerTotal = this.calculateHandValue(this.dealerHand);
    const dealerBusted = dealerTotal > 21;
    const dealerBlackjack = this.dealerHand.length === 2 && dealerTotal === 21;

    // Each player independently vs dealer
    const playerResults = this.players.map((p) => {
      const hand = this.hands[p] || [];
      const total = this.calculateHandValue(hand);
      const busted = this.busted.includes(p);
      const isBlackjack = hand.length === 2 && total === 21;

      let result, points;
      if (busted) {
        result = 'bust'; points = 0;
      } else if (isBlackjack && !dealerBlackjack) {
        result = 'blackjack'; points = 3; // blackjack pays more
      } else if (dealerBusted) {
        result = 'win'; points = 2;
      } else if (total > dealerTotal) {
        result = 'win'; points = 2;
      } else if (total === dealerTotal) {
        result = 'push'; points = 1;
      } else {
        result = 'lose'; points = 0;
      }

      this.wins[p] = (this.wins[p] || 0) + points;
      return { playerId: p, handTotal: total, busted, result, points, isBlackjack };
    });

    this.handResults.push({
      hand: this.handNumber,
      dealerTotal,
      dealerBusted,
      dealerBlackjack,
      players: playerResults,
    });
  }

  _advanceAfterReveal() {
    if (this.handNumber >= HANDS_PER_GAME) {
      this.transition('finish');
    } else {
      this.transition('nextHand');
      this._startHand();
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
    const isRevealOrFinished = this.state === 'reveal' || this.state === 'finished';
    return {
      myHand: this.hands[playerId] || [],
      myTotal: this.calculateHandValue(this.hands[playerId] || []),
      dealerShowing: isRevealOrFinished ? this.dealerHand : [this.dealerHand[0]],
      dealerTotal: isRevealOrFinished ? this.calculateHandValue(this.dealerHand) : null,
      otherPlayers: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        cards: this.hands[p] || [],
        cardCount: (this.hands[p] || []).length,
        total: this.calculateHandValue(this.hands[p] || []),
        busted: this.busted.includes(p),
        stood: this.stood.includes(p),
      })),
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      busted: this.busted.includes(playerId),
      stood: this.stood.includes(playerId),
      phase: this.state,
      handNumber: this.handNumber,
      totalHands: HANDS_PER_GAME,
      wins: { ...this.wins },
      handResults: this.handResults,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const scored = this.players.map((p) => ({
      playerId: p,
      score: this.wins[p] || 0,
      handTotal: this.calculateHandValue(this.hands[p] || []),
    }));
    scored.sort((a, b) => b.score - a.score || b.handTotal - a.handTotal);
    let placement = 1;
    return scored.map((s, i) => {
      if (i > 0 && s.score < scored[i - 1].score) {
        placement = i + 1;
      }
      return {
        playerId: s.playerId,
        placement,
        handTotal: s.handTotal,
        wins: s.score,
        handDescription: `${s.score} pts`,
      };
    });
  }
}
