import { BaseGame } from './BaseGame.js';

const COLORS = ['red', 'yellow', 'green', 'blue'];
const NUMBER_RANKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ACTION_RANKS = ['Skip', 'Reverse', 'DrawTwo'];
const WILD_RANKS = ['Wild', 'WildDrawFour'];

function buildUnoDeck() {
  const cards = [];

  for (const color of COLORS) {
    // One 0 per color
    cards.push({ color, rank: 0 });

    // Two of each 1-9 per color
    for (let n = 1; n <= 9; n++) {
      cards.push({ color, rank: n });
      cards.push({ color, rank: n });
    }

    // Two of each action card per color
    for (const action of ACTION_RANKS) {
      cards.push({ color, rank: action });
      cards.push({ color, rank: action });
    }
  }

  // Four Wild and four Wild Draw Four (no color)
  for (let i = 0; i < 4; i++) {
    cards.push({ color: null, rank: 'Wild' });
    cards.push({ color: null, rank: 'WildDrawFour' });
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
  if (typeof card.rank === 'number') return card.rank;
  if (card.rank === 'Wild' || card.rank === 'WildDrawFour') return 50;
  return 20; // Skip, Reverse, DrawTwo
}

function isWild(card) {
  return card.rank === 'Wild' || card.rank === 'WildDrawFour';
}

function canPlay(card, topCard, currentColor) {
  if (isWild(card)) return true;
  if (card.color === currentColor) return true;
  if (card.rank === topCard.rank) return true;
  return false;
}

export class Uno extends BaseGame {
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
    this.currentColor = null;
    this.direction = 1; // 1 = clockwise, -1 = counter-clockwise
    this.skipNext = false;
    this.pendingDrawCount = 0; // for DrawTwo / WildDrawFour accumulation
  }

  startGame() {
    this.drawPile = shuffleDeck(buildUnoDeck());
    this.discardPile = [];
    this.hands = {};
    this.currentColor = null;
    this.direction = 1;
    this.skipNext = false;
    this.pendingDrawCount = 0;

    // Deal 7 cards to each player
    for (const p of this.players) {
      this.hands[p] = [];
      for (let i = 0; i < 7; i++) {
        const card = this.drawPile.pop();
        if (card) this.hands[p].push(card);
      }
    }

    // Flip starting card — must be a non-wild number card for simplicity
    let startCard = this.drawPile.pop();
    while (isWild(startCard)) {
      this.drawPile.unshift(startCard); // put wild back at bottom
      startCard = this.drawPile.pop();
    }
    this.discardPile.push(startCard);
    this.currentColor = startCard.color;

    // Apply action if start card has an effect
    this.transition('start');
    this.setTurnPlayer(this.players[0]);

    // If first card is an action, apply it before first turn
    this._applyStartCardEffect(startCard);
  }

  _applyStartCardEffect(card) {
    if (card.rank === 'Skip') {
      this._advanceTurn();
    } else if (card.rank === 'Reverse') {
      this.direction = -1;
      if (this.players.length === 2) {
        // In 2-player, reverse acts like a skip
        this._advanceTurn();
      }
    } else if (card.rank === 'DrawTwo') {
      this.pendingDrawCount = 2;
    }
  }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return;

    if (action.type === 'play') {
      this._handlePlay(playerId, action.cardIndex, action.chosenColor);
    } else if (action.type === 'draw') {
      this._handleDraw(playerId);
    }
  }

  _handlePlay(playerId, cardIndex, chosenColor) {
    const hand = this.hands[playerId];
    if (cardIndex < 0 || cardIndex >= hand.length) return;

    const card = hand[cardIndex];
    const topCard = this.discardPile[this.discardPile.length - 1];

    if (!canPlay(card, topCard, this.currentColor)) return;

    // Remove from hand
    hand.splice(cardIndex, 1);
    this.discardPile.push(card);

    // Set color
    if (isWild(card)) {
      this.currentColor = chosenColor && COLORS.includes(chosenColor)
        ? chosenColor
        : COLORS[0];
    } else {
      this.currentColor = card.color;
    }

    // Check win
    if (hand.length === 0) {
      this.transition('finish');
      return;
    }

    // Apply card effects then advance turn
    this._applyCardEffect(card);
  }

  _applyCardEffect(card) {
    if (card.rank === 'Skip') {
      this._advanceTurn(); // skip next player
      this._advanceTurn(); // land on the player after
    } else if (card.rank === 'Reverse') {
      this.direction *= -1;
      if (this.players.length === 2) {
        // In 2-player, Reverse acts like a Skip
        this._advanceTurn();
        this._advanceTurn();
      } else {
        this._advanceTurn();
      }
    } else if (card.rank === 'DrawTwo') {
      // Next player draws 2 and is skipped
      this._advanceTurn();
      const nextPlayer = this.currentTurnPlayer;
      this._dealCards(nextPlayer, 2);
      this._advanceTurn();
    } else if (card.rank === 'WildDrawFour') {
      // Next player draws 4 and is skipped
      this._advanceTurn();
      const nextPlayer = this.currentTurnPlayer;
      this._dealCards(nextPlayer, 4);
      this._advanceTurn();
    } else {
      this._advanceTurn();
    }
  }

  _handleDraw(playerId) {
    const card = this.drawPile.pop();
    if (card) {
      this.hands[playerId].push(card);
    } else {
      // Reshuffle discard pile (keep top card)
      this._reshuffleDiscardIntoDraw();
      const newCard = this.drawPile.pop();
      if (newCard) this.hands[playerId].push(newCard);
    }
    this._advanceTurn();
  }

  _dealCards(playerId, count) {
    for (let i = 0; i < count; i++) {
      if (this.drawPile.length === 0) this._reshuffleDiscardIntoDraw();
      const card = this.drawPile.pop();
      if (card) this.hands[playerId].push(card);
    }
  }

  _reshuffleDiscardIntoDraw() {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop();
    this.drawPile = shuffleDeck(this.discardPile);
    this.discardPile = [top];
  }

  _advanceTurn() {
    const n = this.players.length;
    let idx = this.players.indexOf(this.currentTurnPlayer);
    idx = ((idx + this.direction) % n + n) % n;
    this.currentTurnPlayer = this.players[idx];
    this.turnIndex = idx;
  }

  getStateForPlayer(playerId) {
    const topCard = this.discardPile[this.discardPile.length - 1] || null;
    return {
      myHand: this.hands[playerId] || [],
      topDiscard: topCard,
      currentColor: this.currentColor,
      direction: this.direction,
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
    // Winner is whoever has 0 cards (or fewest if game ended otherwise)
    const scored = this.players.map((p) => {
      const hand = this.hands[p] || [];
      const points = hand.reduce((sum, c) => sum + cardPoints(c), 0);
      return { playerId: p, remainingCards: hand.length, points };
    });

    // Sort: 0 cards first, then by points ascending
    scored.sort((a, b) => {
      if (a.remainingCards === 0 && b.remainingCards !== 0) return -1;
      if (b.remainingCards === 0 && a.remainingCards !== 0) return 1;
      return a.points - b.points;
    });

    return scored.map((s, i) => ({
      playerId: s.playerId,
      placement: i + 1,
      remainingCards: s.remainingCards,
      points: s.points,
    }));
  }
}
