import { BaseGame } from './BaseGame.js';
import { Deck } from '../utils/Deck.js';

const MAX_FLIPS = 26;

export class War extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'flipping', 'war', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'flipping' },
        flipping: { war: 'war', finish: 'finished', continue: 'flipping' },
        war: { resolve: 'flipping', finish: 'finished' },
      },
    });
    this.deck = new Deck();
    this.playerDecks = {};
    this.flippedCards = {};
    this.warPiles = {};     // cards accumulated during a war (face-down + face-up)
    this.flipCount = 0;
    this.pendingFlips = {};  // tracks who has flipped this round
    this.warFlips = {};      // tracks who has flipped their face-up war card
  }

  startGame() {
    this.deck = new Deck();
    this.playerDecks = {};
    this.flippedCards = {};
    this.warPiles = {};
    this.flipCount = 0;
    this.pendingFlips = {};
    this.warFlips = {};

    // Split deck 26/26
    const [p1, p2] = this.players;
    this.playerDecks[p1] = [];
    this.playerDecks[p2] = [];
    for (let i = 0; i < 26; i++) {
      this.playerDecks[p1].push(this.deck.deal());
      this.playerDecks[p2].push(this.deck.deal());
    }

    this.transition('start');
    this._resetRound();
  }

  _resetRound() {
    this.flippedCards = {};
    this.pendingFlips = {};
    for (const p of this.players) this.pendingFlips[p] = false;
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;

    if (this.state === 'flipping' && action.type === 'flip') {
      this._handleFlip(playerId);
    } else if (this.state === 'war' && action.type === 'flip') {
      this._handleWarFlip(playerId);
    }
  }

  _handleFlip(playerId) {
    if (this.pendingFlips[playerId]) return; // already flipped this round
    if (this.playerDecks[playerId].length === 0) return;

    const card = this.playerDecks[playerId].shift();
    this.flippedCards[playerId] = card;
    this.pendingFlips[playerId] = true;

    const allFlipped = this.players.every((p) => this.pendingFlips[p]);
    if (allFlipped) {
      this.flipCount += 1;
      this._resolveFlip();
    }
  }

  _resolveFlip() {
    const [p1, p2] = this.players;
    const c1 = this.flippedCards[p1];
    const c2 = this.flippedCards[p2];

    if (c1.rank === c2.rank) {
      // War — check if either player has enough cards
      const canWar = this.players.every(
        (p) => this.playerDecks[p].length >= 1
      );

      // Accumulate the flipped cards into the war pile
      this.warPiles[p1] = [c1];
      this.warPiles[p2] = [c2];

      if (!canWar) {
        // Not enough cards for war — split the pot or end game
        this._endGame();
        return;
      }

      this.transition('war');
      this._setupWarFlips();
    } else {
      const winner = c1.rank > c2.rank ? p1 : p2;
      const loser = winner === p1 ? p2 : p1;
      this.playerDecks[winner].push(c1, c2);

      if (this._checkEndCondition()) return;

      this.transition('continue');
      this._resetRound();
    }
  }

  _setupWarFlips() {
    // Each player puts up to 3 face-down cards + 1 face-up card
    // We handle this in one "flip" action that takes 4 cards (or fewer if not enough)
    this.warFlips = {};
    for (const p of this.players) this.warFlips[p] = false;
  }

  _handleWarFlip(playerId) {
    if (this.warFlips[playerId]) return; // already done war flip

    const deck = this.playerDecks[playerId];
    // Take up to 3 face-down cards and 1 face-up card
    const faceDown = [];
    for (let i = 0; i < 3 && deck.length > 1; i++) {
      faceDown.push(deck.shift());
    }
    const faceUp = deck.length > 0 ? deck.shift() : null;

    this.warPiles[playerId].push(...faceDown);
    if (faceUp) {
      this.warPiles[playerId].push(faceUp);
      this.flippedCards[playerId] = faceUp; // the face-up card is the one that competes
    }
    this.warFlips[playerId] = true;

    const allDone = this.players.every((p) => this.warFlips[p]);
    if (allDone) {
      this._resolveWar();
    }
  }

  _resolveWar() {
    const [p1, p2] = this.players;
    const c1 = this.flippedCards[p1];
    const c2 = this.flippedCards[p2];

    // Collect all war pile cards
    const pot = [...(this.warPiles[p1] || []), ...(this.warPiles[p2] || [])];
    this.warPiles = {};

    if (!c1 || !c2) {
      // Someone ran out during war — give all to the other or just end
      this._endGame();
      return;
    }

    if (c1.rank === c2.rank) {
      // Another tie — recurse into war again if possible
      const canWar = this.players.every(
        (p) => this.playerDecks[p].length >= 1
      );
      this.warPiles[p1] = [c1];
      this.warPiles[p2] = [c2];
      // Add the rest of pot (excluding the competing face-up cards) to war piles
      // Actually: pot already includes everything, so just set it
      // Re-set piles to entire pot split
      const [firstHalf, secondHalf] = [pot.slice(0, Math.floor(pot.length / 2)), pot.slice(Math.floor(pot.length / 2))];
      this.warPiles[p1] = firstHalf;
      this.warPiles[p2] = secondHalf;

      if (!canWar) {
        this._endGame();
        return;
      }
      this._setupWarFlips();
      // remain in war state
    } else {
      const winner = c1.rank > c2.rank ? p1 : p2;
      for (const card of pot) {
        this.playerDecks[winner].push(card);
      }

      if (this._checkEndCondition()) return;

      this.transition('resolve');
      this._resetRound();
    }
  }

  _checkEndCondition() {
    const [p1, p2] = this.players;
    const p1Empty = this.playerDecks[p1].length === 0;
    const p2Empty = this.playerDecks[p2].length === 0;

    if (p1Empty || p2Empty || this.flipCount >= MAX_FLIPS) {
      this._endGame();
      return true;
    }
    return false;
  }

  _endGame() {
    this.transition('finish');
  }

  getStateForPlayer(playerId) {
    const opponentId = this.players.find((p) => p !== playerId);
    return {
      phase: this.state,
      myDeckSize: (this.playerDecks[playerId] || []).length,
      opponentDeckSize: (this.playerDecks[opponentId] || []).length,
      myFlippedCard: this.flippedCards[playerId] ?? null,
      opponentFlippedCard: this.flippedCards[opponentId] ?? null,
      flipCount: this.flipCount,
      hasFlipped: this.state === 'flipping'
        ? !!(this.pendingFlips[playerId])
        : !!(this.warFlips[playerId]),
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const sorted = [...this.players].sort(
      (a, b) =>
        (this.playerDecks[b] || []).length -
        (this.playerDecks[a] || []).length
    );
    return sorted.map((playerId, i) => ({
      playerId,
      placement: i + 1,
      cardCount: (this.playerDecks[playerId] || []).length,
    }));
  }
}
