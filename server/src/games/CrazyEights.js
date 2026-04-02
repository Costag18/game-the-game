import { BaseGame } from './BaseGame.js';

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function buildStandardDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ suit, rank });
    }
  }
  return cards;
}

function shuffleDeck(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardPoints(card) {
  if (card.rank === 8) return 50;
  if (card.rank >= 11) return 10; // J, Q, K
  if (card.rank === 1) return 1;  // Ace
  return card.rank;
}

function isEight(card) {
  return card.rank === 8;
}

function canPlay(card, topCard, activeSuit) {
  if (isEight(card)) return true;
  if (card.suit === activeSuit) return true;
  if (card.rank === topCard.rank) return true;
  return false;
}

export class CrazyEights extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { finish: 'finished' },
      },
    });

    this.drawPile = [];
    this.discardPile = [];
    this.hands = {};
    this.activeSuit = null; // can differ from top card suit when an 8 was played
  }

  startGame() {
    this.drawPile = shuffleDeck(buildStandardDeck());
    this.discardPile = [];
    this.hands = {};
    this.activeSuit = null;

    // Deal 5 per player (7 if only 2 players)
    const dealCount = this.players.length === 2 ? 7 : 5;
    for (const p of this.players) {
      this.hands[p] = [];
      for (let i = 0; i < dealCount; i++) {
        const card = this.drawPile.pop();
        if (card) this.hands[p].push(card);
      }
    }

    // Flip starting card — re-draw if it's an 8
    let startCard = this.drawPile.pop();
    while (startCard && startCard.rank === 8) {
      this.drawPile.unshift(startCard);
      startCard = this.drawPile.pop();
    }
    this.discardPile.push(startCard);
    this.activeSuit = startCard.suit;

    this.transition('start');
    this.setTurnPlayer(this.players[0]);
  }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return;

    if (action.type === 'play') {
      this._handlePlay(playerId, action.cardIndex, action.chosenSuit);
    } else if (action.type === 'draw') {
      this._handleDraw(playerId);
    }
  }

  _handlePlay(playerId, cardIndex, chosenSuit) {
    const hand = this.hands[playerId];
    if (cardIndex < 0 || cardIndex >= hand.length) return;

    const card = hand[cardIndex];
    const topCard = this.discardPile[this.discardPile.length - 1];

    if (!canPlay(card, topCard, this.activeSuit)) return;

    // Remove from hand
    hand.splice(cardIndex, 1);
    this.discardPile.push(card);

    // Update active suit
    if (isEight(card)) {
      this.activeSuit = chosenSuit && SUITS.includes(chosenSuit)
        ? chosenSuit
        : SUITS[0];
    } else {
      this.activeSuit = card.suit;
    }

    // Check win
    if (hand.length === 0) {
      this.transition('finish');
      return;
    }

    this._advanceTurn();
  }

  _handleDraw(playerId) {
    // Draw ONE card from the pile
    if (this.drawPile.length === 0) {
      this._reshuffleDiscardIntoDraw();
    }
    if (this.drawPile.length > 0) {
      const card = this.drawPile.pop();
      this.hands[playerId].push(card);
    }
    // Turn ends after drawing — player can play the drawn card on their next turn
    this._advanceTurn();
  }

  _reshuffleDiscardIntoDraw() {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop();
    this.drawPile = shuffleDeck(this.discardPile);
    this.discardPile = [top];
  }

  _advanceTurn() {
    this.nextTurn();
  }

  getStateForPlayer(playerId) {
    const topCard = this.discardPile[this.discardPile.length - 1] || null;
    return {
      myHand: this.hands[playerId] || [],
      topDiscard: topCard,
      activeSuit: this.activeSuit,
      drawPileSize: this.drawPile.length,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      phase: this.state,
      otherPlayers: this.players
        .filter((p) => p !== playerId)
        .map((p) => ({
          playerId: p,
          handCount: (this.hands[p] || []).length,
        })),
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const scored = this.players.map((p) => {
      const hand = this.hands[p] || [];
      const points = hand.reduce((sum, c) => sum + cardPoints(c), 0);
      return { playerId: p, remainingCards: hand.length, points };
    });

    // Sort: 0 cards first (winner), then ascending by points
    scored.sort((a, b) => {
      if (a.remainingCards === 0 && b.remainingCards !== 0) return -1;
      if (b.remainingCards === 0 && a.remainingCards !== 0) return 1;
      return a.points - b.points;
    });

    let placement = 1;
    return scored.map((s, i) => {
      if (i > 0) {
        const prev = scored[i - 1];
        const tied = s.remainingCards === prev.remainingCards && s.points === prev.points;
        if (!tied) placement = i + 1;
      }
      return { playerId: s.playerId, placement, remainingCards: s.remainingCards, points: s.points };
    });
  }
}
