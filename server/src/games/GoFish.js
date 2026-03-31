import { BaseGame } from './BaseGame.js';
import { Deck } from '../utils/Deck.js';

export class GoFish extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { finish: 'finished' },
      },
    });
    this.deck = new Deck();
    this.hands = {};
    this.completedSets = {}; // playerId -> count of completed sets
    this.lastAction = null; // for client state reporting
  }

  startGame() {
    this.deck.reset();
    this.hands = {};
    this.completedSets = {};
    this.lastAction = null;

    const dealCount = this.players.length >= 4 ? 5 : 7;
    for (const p of this.players) {
      this.hands[p] = this.deck.dealMultiple(dealCount);
      this.completedSets[p] = 0;
    }

    // Check for immediate sets after deal
    for (const p of this.players) {
      this._checkAndRemoveSets(p);
    }

    this.transition('start');
    this.setTurnPlayer(this.players[0]);
    this._autoDrawIfEmpty(this.players[0]);
    this._checkGameEnd();
  }

  _autoDrawIfEmpty(playerId) {
    // If player has no cards but deck has cards, auto-draw one
    if ((this.hands[playerId] || []).length === 0 && this.deck.remaining() > 0) {
      const card = this.deck.deal();
      if (card) {
        this.hands[playerId].push(card);
        this._checkAndRemoveSets(playerId);
        this.lastAction = { type: 'autoDraw', playerId };
      }
    }
  }

  _checkAndRemoveSets(playerId) {
    const hand = this.hands[playerId];
    if (!hand) return;
    // Count cards by rank
    const rankCounts = {};
    for (const card of hand) {
      rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
    }
    // Remove sets of 4
    for (const [rankStr, count] of Object.entries(rankCounts)) {
      if (count === 4) {
        const rank = Number(rankStr);
        this.hands[playerId] = this.hands[playerId].filter((c) => c.rank !== rank);
        this.completedSets[playerId] = (this.completedSets[playerId] || 0) + 1;
      }
    }
  }

  _totalCompletedSets() {
    return Object.values(this.completedSets).reduce((a, b) => a + b, 0);
  }

  _checkGameEnd() {
    if (this.state !== 'playing') return;
    // Game ends when all 13 sets claimed or deck empty and no player can ask (all hands empty)
    if (this._totalCompletedSets() >= 13) {
      this.transition('finish');
      return;
    }
    const deckEmpty = this.deck.remaining() === 0;
    if (deckEmpty) {
      const anyHasCards = this.players.some((p) => (this.hands[p] || []).length > 0);
      if (!anyHasCards) {
        this.transition('finish');
      }
    }
  }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return;

    if (action.type === 'ask') {
      const { targetPlayer, rank } = action;

      // Validate: player must hold at least one card of that rank
      const myHand = this.hands[playerId] || [];
      const hasRank = myHand.some((c) => c.rank === rank);
      if (!hasRank) return;

      // Validate target is a different valid player
      if (!this.players.includes(targetPlayer) || targetPlayer === playerId) return;

      const targetHand = this.hands[targetPlayer] || [];
      const matchingCards = targetHand.filter((c) => c.rank === rank);

      if (matchingCards.length > 0) {
        // Transfer all matching cards
        this.hands[targetPlayer] = targetHand.filter((c) => c.rank !== rank);
        this.hands[playerId] = [...myHand, ...matchingCards];
        this._checkAndRemoveSets(playerId);
        this.lastAction = { type: 'transfer', playerId, targetPlayer, rank, count: matchingCards.length };
        this._autoDrawIfEmpty(playerId);
        this._checkGameEnd();
        // Go again (don't advance turn)
      } else {
        // Go Fish
        this.lastAction = { type: 'goFish', playerId, rank };
        const drawn = this.deck.deal();
        if (drawn) {
          this.hands[playerId] = [...this.hands[playerId], drawn];
          if (drawn.rank === rank) {
            // Lucky draw — go again
            this._checkAndRemoveSets(playerId);
            this.lastAction = { type: 'luckyFish', playerId, rank };
            this._checkGameEnd();
          } else {
            this._checkAndRemoveSets(playerId);
            this._checkGameEnd();
            if (this.state === 'playing') {
              this._advanceTurn();
            }
          }
        } else {
          // Deck empty, no draw
          this._checkGameEnd();
          if (this.state === 'playing') {
            this._advanceTurn();
          }
        }
      }
    }
  }

  _advanceTurn() {
    // Skip players with empty hands if deck is also empty
    const deckEmpty = this.deck.remaining() === 0;
    const activePlayers = deckEmpty
      ? this.players.filter((p) => (this.hands[p] || []).length > 0)
      : this.players;

    if (activePlayers.length === 0) {
      this._checkGameEnd();
      return;
    }

    // Find next player in rotation
    const currentIndex = this.players.indexOf(this.currentTurnPlayer);
    let nextIndex = (currentIndex + 1) % this.players.length;
    let checked = 0;
    while (checked < this.players.length) {
      const candidate = this.players[nextIndex];
      if (!deckEmpty || (this.hands[candidate] || []).length > 0) {
        this.setTurnPlayer(candidate);
        this._autoDrawIfEmpty(candidate);
        return;
      }
      nextIndex = (nextIndex + 1) % this.players.length;
      checked++;
    }
    // No valid next player
    this._checkGameEnd();
  }

  getStateForPlayer(playerId) {
    const otherPlayers = this.players
      .filter((p) => p !== playerId)
      .map((p) => ({
        playerId: p,
        cardCount: (this.hands[p] || []).length,
        completedSets: this.completedSets[p] || 0,
      }));

    return {
      myHand: this.hands[playerId] || [],
      myCompletedSets: this.completedSets[playerId] || 0,
      otherPlayers,
      currentTurnPlayer: this.currentTurnPlayer,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      deckRemaining: this.deck.remaining(),
      phase: this.state,
      lastAction: this.lastAction,
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const scores = this.players.map((p) => ({
      playerId: p,
      completedSets: this.completedSets[p] || 0,
    }));
    scores.sort((a, b) => b.completedSets - a.completedSets);
    return scores.map((s, i) => ({
      playerId: s.playerId,
      placement: i + 1,
      completedSets: s.completedSets,
    }));
  }
}
