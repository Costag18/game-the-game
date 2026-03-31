const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export class Deck {
  constructor() {
    this.reset();
  }

  reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({ suit, rank });
      }
    }
    this.shuffle();
  }

  shuffle() {
    // Fisher-Yates
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  deal() {
    return this.cards.length > 0 ? this.cards.pop() : null;
  }

  dealMultiple(count) {
    const hand = [];
    for (let i = 0; i < count; i++) {
      const card = this.deal();
      if (card) hand.push(card);
    }
    return hand;
  }

  remaining() {
    return this.cards.length;
  }
}
