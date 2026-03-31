import { BaseGame } from './BaseGame.js';

export class MemoryMatch extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { finish: 'finished' },
      },
    });
    this.board = [];
    this.pairs = {}; // playerId -> count
    this.flippedThisTurn = []; // indices of cards flipped this turn (max 2)
  }

  startGame() {
    // Create 24-card board: 12 pairs (values 1-12)
    const cards = [];
    for (let v = 1; v <= 12; v++) {
      cards.push({ value: v, faceUp: false, matched: false });
      cards.push({ value: v, faceUp: false, matched: false });
    }
    // Shuffle
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    this.board = cards;
    this.pairs = {};
    for (const p of this.players) this.pairs[p] = 0;
    this.flippedThisTurn = [];
    this.transition('start');
    this.setTurnPlayer(this.players[0]);
  }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return;
    if (action.type !== 'flip') return;

    const position = action.position;
    if (position < 0 || position >= this.board.length) return;

    const card = this.board[position];
    // Can't flip already-matched or already face-up card, or same position twice
    if (card.matched || card.faceUp) return;
    if (this.flippedThisTurn.includes(position)) return;
    // Only allow 2 flips per turn
    if (this.flippedThisTurn.length >= 2) return;

    card.faceUp = true;
    this.flippedThisTurn.push(position);

    if (this.flippedThisTurn.length === 2) {
      const [i1, i2] = this.flippedThisTurn;
      const c1 = this.board[i1];
      const c2 = this.board[i2];

      if (c1.value === c2.value) {
        // Match!
        c1.matched = true;
        c2.matched = true;
        this.pairs[playerId] = (this.pairs[playerId] || 0) + 1;
        this.flippedThisTurn = [];
        // Same player goes again (don't advance turn)
        if (this.isComplete()) {
          this.transition('finish');
        }
      } else {
        // No match — flip back and move to next player
        c1.faceUp = false;
        c2.faceUp = false;
        this.flippedThisTurn = [];
        this.nextTurn();
      }
    }
  }

  getStateForPlayer(playerId) {
    const boardView = this.board.map((card) => ({
      faceUp: card.faceUp,
      matched: card.matched,
      value: (card.faceUp || card.matched) ? card.value : null,
    }));
    return {
      board: boardView,
      pairs: { ...this.pairs },
      currentTurnPlayer: this.currentTurnPlayer,
      isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
      phase: this.state,
      flippedThisTurn: [...this.flippedThisTurn],
    };
  }

  isComplete() {
    return this.board.length > 0 && this.board.every((c) => c.matched);
  }

  getResults() {
    const entries = this.players.map((p) => ({
      playerId: p,
      pairsCollected: this.pairs[p] || 0,
    }));
    entries.sort((a, b) => b.pairsCollected - a.pairsCollected);
    return entries.map((e, i) => ({ ...e, placement: i + 1 }));
  }
}
