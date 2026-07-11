import { BaseGame } from './BaseGame.js';

const TURN_TIMER_MS = 30000;

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
    this.pendingFlipBack = false; // true when 2 non-matching cards are shown
    this._turnTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

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
    this._startTurnTimer();
  }

  _clearTurnTimer() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
  }

  /**
   * Server-authoritative turn timeout. Without this a current player who freezes
   * (but doesn't disconnect) hangs the round forever for everyone else.
   */
  _startTurnTimer() {
    this._clearTurnTimer();
    if (this.state !== 'playing') return;
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'playing') return;
      this._autoPassTurn();
      this._emitChange();
    }, TURN_TIMER_MS);
  }

  _autoPassTurn() {
    // Flip any in-progress unmatched cards face-down, clear transient state, pass.
    for (const idx of this.flippedThisTurn) {
      if (this.board[idx] && !this.board[idx].matched) this.board[idx].faceUp = false;
    }
    this.flippedThisTurn = [];
    this.pendingFlipBack = false;
    if (this.activePlayers.length > 0) this.nextTurn();
    this._startTurnTimer();
  }

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return;

    // Acknowledge: flip back mismatched cards and advance turn
    if (action.type === 'acknowledge' && this.pendingFlipBack) {
      const [i1, i2] = this.flippedThisTurn;
      this.board[i1].faceUp = false;
      this.board[i2].faceUp = false;
      this.flippedThisTurn = [];
      this.pendingFlipBack = false;
      this.nextTurn();
      this._startTurnTimer();
      return;
    }

    if (action.type !== 'flip') return;
    if (this.pendingFlipBack) return; // must acknowledge first

    const position = action.position;
    if (position < 0 || position >= this.board.length) return;

    const card = this.board[position];
    if (card.matched || card.faceUp) return;
    if (this.flippedThisTurn.includes(position)) return;
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
        this.pendingFlipBack = false;
        if (this.isComplete()) {
          this.transition('finish');
        }
      } else {
        // No match — keep cards face-up, wait for acknowledge
        this.pendingFlipBack = true;
      }
    }

    // Refresh / stop the turn timer depending on whether play continues.
    if (this.state === 'playing') this._startTurnTimer();
    else this._clearTurnTimer();
  }

  removePlayer(playerId) {
    const wasCurrent = this.currentTurnPlayer === playerId;
    if (wasCurrent) {
      // Wind back the leaver's in-progress flips so the next player starts clean
      // (prevents their leftover face-up card matching against the next player's flip).
      for (const idx of this.flippedThisTurn) {
        if (this.board[idx] && !this.board[idx].matched) this.board[idx].faceUp = false;
      }
      this.flippedThisTurn = [];
      this.pendingFlipBack = false;
    }
    super.removePlayer(playerId); // prune roster + reassign turn
    if (this.state === 'playing') {
      if (this.isComplete() || this.players.length <= 1) {
        this.transition('finish');
        this._clearTurnTimer();
      } else {
        this._startTurnTimer();
      }
    }
  }

  destroy() {
    this._clearTurnTimer();
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
      pendingFlipBack: this.pendingFlipBack,
    };
  }

  isComplete() {
    if (this.state === 'finished') return true;
    return this.board.length > 0 && this.board.every((c) => c.matched);
  }

  getResults() {
    const entries = this.players.map((p) => ({
      playerId: p,
      pairsCollected: this.pairs[p] || 0,
    }));
    entries.sort((a, b) => b.pairsCollected - a.pairsCollected);
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.pairsCollected < entries[i - 1].pairsCollected) {
        placement = i + 1;
      }
      return { ...e, placement };
    });
  }
}
