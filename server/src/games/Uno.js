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
    this.drawnCard = null; // card just drawn (can be played immediately)
    this.lastPlayedRank = null; // track for consecutive same-rank plays
  }

  startGame() {
    this.drawPile = shuffleDeck(buildUnoDeck());
    this.discardPile = [];
    this.hands = {};
    this.currentColor = null;
    this.direction = 1;
    this.skipNext = false;
    this.pendingDrawCount = 0;
    this.drawnCard = null;
    this.lastPlayedRank = null;

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
    } else if (action.type === 'pass') {
      // Pass after drawing or after consecutive play option
      this.drawnCard = null;
      this.lastPlayedRank = null;
      this._advanceTurn();
    } else if (action.type === 'forceAdvance') {
      // Deadlock recovery — force advance if stuck
      this.drawnCard = null;
      this.lastPlayedRank = null;
      this._advanceTurn();
    }
  }

  _handlePlay(playerId, cardIndex, chosenColor) {
    const hand = this.hands[playerId];
    if (cardIndex < 0 || cardIndex >= hand.length) return;

    const card = hand[cardIndex];
    const topCard = this.discardPile[this.discardPile.length - 1];

    // During consecutive play, only allow cards matching lastPlayedRank
    if (this.lastPlayedRank != null) {
      if (card.rank !== this.lastPlayedRank) return;
    } else if (!canPlay(card, topCard, this.currentColor)) {
      return;
    }

    // Remove from hand
    hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    this.drawnCard = null; // clear drawn card state after playing

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
      this.lastPlayedRank = null;
      this.transition('finish');
      return;
    }

    // Wild, WildDrawFour, DrawTwo, Skip, Reverse — always end turn immediately
    if (typeof card.rank !== 'number') {
      this.lastPlayedRank = null;
      this._applyCardEffect(card);
      return;
    }

    // Number cards: allow consecutive plays of the same rank
    const hasAnother = hand.some((c) => c.rank === card.rank);
    if (hasAnother) {
      this.lastPlayedRank = card.rank;
      // Don't advance turn — player can play another of the same rank or pass
      return;
    }

    this.lastPlayedRank = null;
    this._advanceTurn();
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
    if (this.drawnCard) return; // already drew this turn

    let card = this.drawPile.pop();
    if (!card) {
      this._reshuffleDiscardIntoDraw();
      card = this.drawPile.pop();
    }

    if (card) {
      this.hands[playerId].push(card);
      const topCard = this.discardPile[this.discardPile.length - 1];
      if (canPlay(card, topCard, this.currentColor)) {
        // Player can choose to play this card or pass
        this.drawnCard = card;
        return; // don't advance — wait for play or pass
      }
    }

    // Can't play drawn card, auto-advance
    this.drawnCard = null;
    this.lastPlayedRank = null;
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
    if (idx === -1) idx = 0; // safety: recover if currentTurnPlayer is invalid
    idx = ((idx + this.direction) % n + n) % n;
    this.currentTurnPlayer = this.players[idx];
    this.turnIndex = idx;
    this.drawnCard = null; // clear draw state for new turn
    this.lastPlayedRank = null;
  }

  getStateForPlayer(playerId) {
    const topCard = this.discardPile[this.discardPile.length - 1] || null;
    const isMyTurn = this.currentTurnPlayer === playerId && this.state === 'playing';

    const hand = this.hands[playerId] || [];
    let playerCanAct = true;
    if (isMyTurn) {
      const hasPlayableCard = hand.some((c) => canPlay(c, topCard, this.currentColor));
      const canDraw = !this.drawnCard;
      const inConsecutivePlay = this.lastPlayedRank != null;
      const hasDrawnPlayable = !!this.drawnCard;
      playerCanAct = hasPlayableCard || canDraw || inConsecutivePlay || hasDrawnPlayable;
    }

    return {
      myHand: hand,
      topDiscard: topCard,
      currentColor: this.currentColor,
      direction: this.direction,
      drawPileSize: this.drawPile.length,
      isMyTurn,
      phase: this.state,
      drawnCard: isMyTurn && this.drawnCard ? true : false,
      lastPlayedRank: isMyTurn ? this.lastPlayedRank : null,
      canAct: isMyTurn ? playerCanAct : undefined,
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
