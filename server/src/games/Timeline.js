import { BaseGame } from './BaseGame.js';
import { pickEvents } from '../utils/triviaBank.js';

const TOTAL_ROUNDS  = 6;
const GUESS_MS      = 30_000;  // window to lock a year guess
const REVEAL_MS     = 6_000;   // reveal auto-advance
const YEAR_MIN      = -4000;   // bank spans deep antiquity (the wheel ~3500 BC) to today —
const YEAR_MAX      = 2100;    // the slider must REACH every event or exact guesses can't score
const POINTS_PER_YR = 20;      // points lost per year of distance
const MAX_POINTS    = 1000;    // perfect guess

function clampYear(y) {
  const n = Math.round(Number(y));
  if (!Number.isFinite(n)) return YEAR_MIN;
  return Math.max(YEAR_MIN, Math.min(YEAR_MAX, n));
}

/**
 * Timeline — place the year. Each round shows a historical event; every player
 * privately submits a YEAR (1400–2025) via a slider. Score = max(0, 1000 -
 * |guess - true| * 20), so within ~50 years still scores. Cumulative over 6
 * events ranks 1..N.
 *
 * Anti-cheat: the true year lives ONLY on the server. getStateForPlayer sends
 * the event text but NEVER the year (nor any per-player guess) until the reveal
 * phase. Guess phase is simultaneous; once every present player has locked OR
 * the guess timer fires, the round reveals, scores, and auto-advances.
 *
 * Timer-driven transitions pair with `_emitChange()` per the v2.7.0 broadcast
 * contract so the room re-broadcasts and re-checks `isComplete()`.
 */
export class Timeline extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'guessing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting:  { start: 'guessing' },
        guessing: { reveal: 'reveal', finish: 'finished' },
        reveal:   { next: 'guessing', finish: 'finished' },
      },
    });
    this.scores = {};
    this.questions = [];
    this.qIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.event = null;          // { event, year } — year is server-only
    this.guesses = {};          // playerId -> year (this round)
    this.revealData = null;     // { trueYear, results:[{playerId, guess, distance, points}] }
    this.acknowledged = new Set();
    this.deadline = null;       // epoch-ms for the active timer
    this._guessTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.questions = pickEvents(this.totalRounds);
    // fallback: if the bank somehow returns fewer than needed, pad by reusing.
    while (this.questions.length < this.totalRounds && this.questions.length > 0) {
      this.questions.push(this.questions[this.questions.length % this.questions.length]);
    }
    this.qIndex = -1;
    this.transition('start'); // -> onEnterGuessing
  }

  // ---------- GUESSING ----------
  onEnterGuessing() {
    this.qIndex++;
    this.event = this.questions[this.qIndex % this.questions.length];
    this.guesses = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + GUESS_MS;
    this._guessTimer = setTimeout(() => {
      if (this.state !== 'guessing') return;
      this._toReveal();
      this._emitChange();
    }, GUESS_MS);
  }

  _toReveal() {
    if (this.state !== 'guessing') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const trueYear = this.event.year;
    const results = [];
    for (const p of this.players) {
      const has = this.guesses[p] !== undefined;
      const guess = has ? this.guesses[p] : null;
      const distance = has ? Math.abs(guess - trueYear) : null;
      const points = has ? Math.max(0, MAX_POINTS - distance * POINTS_PER_YR) : 0;
      this.scores[p] = (this.scores[p] || 0) + points;
      results.push({ playerId: p, guess, distance, points, missed: !has });
    }
    results.sort((a, b) => b.points - a.points);
    this.revealData = { trueYear, results };
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.qIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterGuessing
  }

  onEnterFinished() { this._clearTimers(); this.deadline = null; }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'guessing' && type === 'submitYear') {
      if (this.guesses[playerId] !== undefined) return; // one lock per round
      this.guesses[playerId] = clampYear(action.year);
      this._checkGuessComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkGuessComplete() {
    if (this.state !== 'guessing') return;
    if (this.players.every((p) => this.guesses[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearTimers() {
    for (const k of ['_guessTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.guesses[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this.deadline = null;
      this._emitChange();
      return;
    }
    if (this.state === 'guessing') this._checkGuessComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      qNumber: this.qIndex + 1,
      total: this.totalRounds,
      eventText: this.event ? this.event.event : '',
      yearMin: YEAR_MIN,
      yearMax: YEAR_MAX,
      // NEVER expose the true year before reveal
      trueYear: revealing && this.revealData ? this.revealData.trueYear : null,
      myGuess: this.guesses[playerId] != null ? this.guesses[playerId] : null,
      locked: this.guesses[playerId] !== undefined,
      submittedCount: Object.keys(this.guesses).length,
      playerCount: this.players.length,
      scores: { ...this.scores },
      deadline: this.deadline,
      results: revealing && this.revealData ? this.revealData.results : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
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
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
