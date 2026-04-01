import { BaseGame } from './BaseGame.js';

const BEATS = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

export class RockPaperScissors extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'round', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'round' },
        round: { reveal: 'reveal' },
        reveal: { next: 'round', finish: 'finished' },
      },
    });
    this.scores = {};
    this.roundNumber = 0;
    this.choices = {};
    this.lastRoundResult = null;

    for (const p of players) this.scores[p] = 0;
  }

  startGame() {
    this.scores = {};
    for (const p of this.players) this.scores[p] = 0;
    this.roundNumber = 0;
    this.choices = {};
    this.lastRoundResult = null;
    this.transition('start');
    this._beginRound();
  }

  _beginRound() {
    this.roundNumber += 1;
    this.choices = {};
    this.lastRoundResult = null;
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;

    if (this.state === 'round') {
      if (action.type !== 'choose') return;
      if (!['rock', 'paper', 'scissors'].includes(action.choice)) return;
      if (this.choices[playerId] !== undefined) return;

      this.choices[playerId] = action.choice;

      const allChosen = this.players.every((p) => this.choices[p] !== undefined);
      if (allChosen) {
        this.transition('reveal');
        this._resolveRound();
        this.acknowledged = new Set();
        this._startRevealTimer();
      }
    } else if (this.state === 'reveal') {
      if (action.type === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealComplete();
      }
    }
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (!this.players.every((p) => this.acknowledged.has(p))) return;
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
    const [p1, p2] = this.players;
    if (this.scores[p1] >= 3 || this.scores[p2] >= 3) {
      this.transition('finish');
    } else {
      this.transition('next');
      this._beginRound();
    }
  }

  _startRevealTimer() {
    if (this._revealTimer) clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      // Auto-ack all players who haven't acknowledged
      for (const p of this.players) this.acknowledged.add(p);
      this._checkRevealComplete();
    }, 10000); // 10 second auto-advance
  }

  _resolveRound() {
    const [p1, p2] = this.players;
    const c1 = this.choices[p1];
    const c2 = this.choices[p2];

    let winner = null;
    if (c1 === c2) {
      // tie — no point
      this.lastRoundResult = { winner: null, tie: true };
    } else if (BEATS[c1] === c2) {
      winner = p1;
    } else {
      winner = p2;
    }

    if (winner) {
      this.scores[winner] += 1;
      this.lastRoundResult = { winner, tie: false };
    } else {
      this.lastRoundResult = { winner: null, tie: true };
    }
    // Stay in 'reveal' — wait for both players to acknowledge
  }

  // Called externally to advance to the next round after reveal
  advanceToNextRound() {
    if (this.state !== 'reveal') return;
    this.transition('next');
    this._beginRound();
  }

  getStateForPlayer(playerId) {
    const isReveal = this.state === 'reveal' || this.state === 'finished';
    const opponentId = this.players.find((p) => p !== playerId);

    return {
      phase: this.state,
      roundNumber: this.roundNumber,
      scores: { ...this.scores },
      myId: playerId,
      opponentId,
      myChoice: this.choices[playerId] ?? null,
      opponentChoice: isReveal ? (this.choices[opponentId] ?? null) : null,
      lastRoundResult: isReveal ? this.lastRoundResult : null,
      hasChosen: this.choices[playerId] !== undefined,
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    const sorted = [...this.players].sort(
      (a, b) => this.scores[b] - this.scores[a]
    );
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && this.scores[playerId] < this.scores[sorted[i - 1]]) {
        placement = i + 1;
      }
      return { playerId, placement, score: this.scores[playerId] };
    });
  }
}
