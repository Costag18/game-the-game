import { BaseGame } from './BaseGame.js';
import { pickOpinions } from '../utils/partyBank.js';

const POINTS_CORRECT = 500;
const TOTAL_ROUNDS = 5;
const SUBMIT_MS = 30_000;
const REVEAL_MS = 10_000;

/**
 * Vote Prophet — predict the crowd.
 *
 * Each round shows an opinion prompt with two sides (a / b). In ONE phase every
 * player simultaneously submits BOTH (1) their REAL preference and (2) their
 * PREDICTION of which side the GROUP plurality will pick. At reveal we compute the
 * actual plurality from the real preferences and award +500 to every player whose
 * PREDICTION matched it (on a tie in the plurality, EITHER prediction counts).
 *
 * Server-authoritative anti-cheat: real preferences and predictions are PRIVATE
 * until reveal — getStateForPlayer never leaks another player's choice (or even
 * who has submitted-what) before reveal; only aggregate counts are exposed. Scores
 * are cumulative across 5 rounds.
 */
export class VoteProphet extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'predicting', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'predicting' },
        predicting: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'predicting', finish: 'finished' },
      },
    });
    this.scores = {};
    this.correctCounts = {};
    this.roundIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.prompts = [];
    this.prompt = null;
    this.prefs = {};       // playerId -> 'a' | 'b' (real preference, secret)
    this.predictions = {}; // playerId -> 'a' | 'b' (group-plurality guess, secret)
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = 0;
    this._submitTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.scores[p] = 0; this.correctCounts[p] = 0; }
    // Pick all prompts ONCE for the whole game.
    this.prompts = pickOpinions(this.totalRounds);
    this.transition('start'); // -> onEnterPredicting
  }

  // ---------- PREDICTING ----------
  onEnterPredicting() {
    this.roundIndex++;
    this.prompt = this.prompts[this.roundIndex % this.prompts.length];
    this.prefs = {};
    this.predictions = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + SUBMIT_MS;
    this._submitTimer = setTimeout(() => {
      if (this.state !== 'predicting') return;
      // Auto-fill anyone who never locked in (random both, so the barrier completes).
      for (const p of this.players) {
        if (!this._hasSubmitted(p)) {
          if (this.prefs[p] === undefined) this.prefs[p] = Math.random() < 0.5 ? 'a' : 'b';
          if (this.predictions[p] === undefined) this.predictions[p] = Math.random() < 0.5 ? 'a' : 'b';
        }
      }
      this._toReveal();
      this._emitChange();
    }, SUBMIT_MS);
  }

  _hasSubmitted(p) {
    return this.prefs[p] !== undefined && this.predictions[p] !== undefined;
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'predicting') return;
    this._clearAllTimers();
    this.transition('reveal'); // -> onEnterReveal
  }
  onEnterReveal() {
    // Actual group split from REAL preferences.
    let countA = 0;
    let countB = 0;
    for (const p of this.players) {
      if (this.prefs[p] === 'a') countA++;
      else if (this.prefs[p] === 'b') countB++;
    }
    // Plurality winner. On a tie, EITHER prediction counts as correct.
    let pluralitySide = null; // null => tie => both correct
    if (countA > countB) pluralitySide = 'a';
    else if (countB > countA) pluralitySide = 'b';

    const awards = {};
    for (const p of this.players) {
      const predicted = this.predictions[p];
      const correct = pluralitySide === null ? true : predicted === pluralitySide;
      const gained = correct ? POINTS_CORRECT : 0;
      if (correct) this.correctCounts[p] = (this.correctCounts[p] || 0) + 1;
      this.scores[p] = (this.scores[p] || 0) + gained;
      awards[p] = { pref: predicted ? this.prefs[p] : null, predicted, correct, gained };
    }
    this.revealData = {
      countA,
      countB,
      pluralitySide, // null on tie
      tie: pluralitySide === null,
      sideA: this.prompt.a,
      sideB: this.prompt.b,
      awards,
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }
  _advance() {
    if (this.state !== 'reveal') return;
    this._clearAllTimers();
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterPredicting
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'predicting' && type === 'lockIn') {
      if (this._hasSubmitted(playerId)) return; // locked once, can't change
      const pref = action.pref === 'a' || action.pref === 'b' ? action.pref : null;
      const prediction = action.prediction === 'a' || action.prediction === 'b' ? action.prediction : null;
      if (!pref || !prediction) return;
      this.prefs[playerId] = pref;
      this.predictions[playerId] = prediction;
      this._checkSubmitComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkSubmitComplete() {
    if (this.state !== 'predicting') return;
    if (this.players.every((p) => this._hasSubmitted(p))) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearAllTimers() {
    for (const k of ['_submitTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.prefs[playerId];
    delete this.predictions[playerId];
    delete this.scores[playerId];
    delete this.correctCounts[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'predicting') this._checkSubmitComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    return {
      phase: this.state,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      promptText: this.prompt ? this.prompt.prompt : '',
      sideA: this.prompt ? this.prompt.a : '',
      sideB: this.prompt ? this.prompt.b : '',
      scores: { ...this.scores },
      myId: playerId,
      // Only the player's OWN secret choices are ever sent back to them.
      myPref: this.prefs[playerId] != null ? this.prefs[playerId] : null,
      myPrediction: this.predictions[playerId] != null ? this.predictions[playerId] : null,
      hasSubmitted: this._hasSubmitted(playerId),
      submittedCount: this.players.filter((p) => this._hasSubmitted(p)).length,
      playerCount: this.players.length,
      deadline: this.state === 'predicting' ? this.deadline : 0,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: (this.state === 'reveal' || this.state === 'finished') ? this.revealData : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        correctCount: this.correctCounts[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
