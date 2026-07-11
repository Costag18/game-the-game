import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const CHOICE_MS = TIMERS.RPS * 1000;
const CHOICE_OPTIONS = ['rock', 'paper', 'scissors'];

const BEATS = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

const TOTAL_ROUNDS = 5;

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
    this.totalRounds = TOTAL_ROUNDS;

    for (const p of players) this.scores[p] = 0;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

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
    this._startChoiceTimer();
  }

  // The choosing phase must not wait forever on an idle player: at the
  // deadline, fill in a random throw for anyone who hasn't chosen and resolve.
  _startChoiceTimer() {
    if (this._choiceTimer) { clearTimeout(this._choiceTimer); this._choiceTimer = null; }
    this._choiceEndsAt = Date.now() + CHOICE_MS;
    this._choiceTimer = setTimeout(() => {
      if (this.state !== 'round') return;
      for (const p of this.players) {
        if (this.choices[p] === undefined) {
          this.choices[p] = CHOICE_OPTIONS[Math.floor(Math.random() * CHOICE_OPTIONS.length)];
        }
      }
      this.transition('reveal');
      this._resolveRound();
      this.acknowledged = new Set();
      this._startRevealTimer();
      this._emitChange();
    }, CHOICE_MS);
  }

  _clearChoiceTimer() {
    if (this._choiceTimer) { clearTimeout(this._choiceTimer); this._choiceTimer = null; }
    this._choiceEndsAt = null;
  }

  removePlayer(playerId) {
    super.removePlayer(playerId);
    this.players = this.players.filter((p) => p !== playerId);
    delete this.scores[playerId];
    delete this.choices[playerId];

    if (this.players.length <= 1) {
      if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
      this._clearChoiceTimer();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }

    // If we were waiting for this player's choice, check if all remaining have chosen
    if (this.state === 'round') {
      const allChosen = this.players.every((p) => this.choices[p] !== undefined);
      if (allChosen) {
        this._clearChoiceTimer();
        this.transition('reveal');
        this._resolveRound();
        this.acknowledged = new Set();
        this._startRevealTimer();
      }
    } else if (this.state === 'reveal') {
      this.acknowledged.add(playerId); // auto-ack
      this._checkRevealComplete();
    }
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
        this._clearChoiceTimer();
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

    if (this.roundNumber >= this.totalRounds) {
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
      for (const p of this.players) this.acknowledged.add(p);
      this._checkRevealComplete();
      this._emitChange();
    }, 10000);
  }

  destroy() {
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
    this._clearChoiceTimer();
  }

  _resolveRound() {
    // Count unique choices
    const uniqueChoices = new Set(Object.values(this.choices));

    // All same or all three present = tie (no points)
    if (uniqueChoices.size === 1 || uniqueChoices.size === 3) {
      this.lastRoundResult = {
        choices: { ...this.choices },
        winners: [],
        tie: true,
      };
      return;
    }

    // Exactly 2 choices: one beats the other
    const [choiceA, choiceB] = [...uniqueChoices];
    const winningChoice = BEATS[choiceA] === choiceB ? choiceA : choiceB;

    const winners = [];
    for (const [pid, choice] of Object.entries(this.choices)) {
      if (choice === winningChoice) {
        this.scores[pid] += 1;
        winners.push(pid);
      }
    }

    this.lastRoundResult = {
      choices: { ...this.choices },
      winners,
      winningChoice,
      tie: false,
    };
  }

  getStateForPlayer(playerId) {
    const isReveal = this.state === 'reveal' || this.state === 'finished';

    // Build other players' info
    const otherPlayers = this.players.filter((p) => p !== playerId).map((p) => ({
      playerId: p,
      choice: isReveal ? (this.choices[p] ?? null) : null,
      hasChosen: this.choices[p] !== undefined,
      score: this.scores[p] || 0,
    }));

    return {
      phase: this.state,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      scores: { ...this.scores },
      myId: playerId,
      myChoice: this.choices[playerId] ?? null,
      hasChosen: this.choices[playerId] !== undefined,
      choiceEndsAt: this.state === 'round' ? this._choiceEndsAt : null,
      otherPlayers,
      lastRoundResult: isReveal ? this.lastRoundResult : null,
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
      return {
        playerId,
        placement,
        score: this.scores[playerId],
        handDescription: `${this.scores[playerId]} wins`,
      };
    });
  }
}
