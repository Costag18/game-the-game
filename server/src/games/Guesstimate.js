import { BaseGame } from './BaseGame.js';
import { pickNumericFacts } from '../utils/triviaBank.js';

const TOTAL_ROUNDS = 5;
const ANSWER_MS = 30_000;     // time to submit a guess each round
const REVEAL_MS = 45_000;     // reveal auto-advance SAFETY net — players advance via Continue; this only guards an AFK table
const MAX_POINTS = 1000;      // a perfect (exact) guess

/**
 * Guesstimate — order-of-magnitude estimation. Each round shows a numeric prompt
 * (e.g. "Height of the Eiffel Tower"); every player privately submits ONE positive
 * number. Scoring is LOG-relative so being within a factor is well-rewarded and
 * order-of-magnitude misses are punished only gently:
 *   r = max(guess, answer) / min(guess, answer)   (guess must be > 0)
 *   points = round(1000 / (1 + log10(r)))          clamped to [0, 1000]
 * An exact guess gives r=1 → log10(1)=0 → 1000. A 10x miss → r=10 → 500. A 100x
 * miss → ~333. Cumulative points across 5 rounds rank players 1..N.
 *
 * Anti-cheat: the true answer is server-only and NEVER appears in
 * getStateForPlayer before the reveal phase. The answer phase is simultaneous —
 * each present player locks exactly one guess, then the round reveals when ALL
 * have submitted OR the answer timer fires. Timer-driven transitions pair with
 * `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class Guesstimate extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'question', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'question' },
        question: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'question', finish: 'finished' },
      },
    });
    this.scores = {};
    this.questions = [];
    this.totalRounds = TOTAL_ROUNDS;
    this.qIndex = -1;
    this.fact = null;
    this.guesses = {};       // playerId -> positive number (locked)
    this.revealData = null;  // { answer, unit, results:[{playerId, guess, factor, points}] }
    this.acknowledged = new Set();
    this._deadline = 0;
    this._answerTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.questions = pickNumericFacts(this.totalRounds);
    this.totalRounds = Math.min(this.totalRounds, this.questions.length);
    this.transition('start'); // -> onEnterQuestion
  }

  // ---------- scoring ----------
  _scoreGuess(guess, answer) {
    const g = Number(guess);
    if (!Number.isFinite(g) || g <= 0) return 0;
    const a = Number(answer);
    if (!Number.isFinite(a) || a <= 0) return 0;
    const r = Math.max(g, a) / Math.min(g, a);
    const pts = Math.round(MAX_POINTS / (1 + Math.log10(r)));
    return Math.max(0, Math.min(MAX_POINTS, pts));
  }
  _factorOff(guess, answer) {
    const g = Number(guess);
    const a = Number(answer);
    if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(a) || a <= 0) return null;
    return Math.max(g, a) / Math.min(g, a);
  }

  // ---------- QUESTION ----------
  onEnterQuestion() {
    this.qIndex++;
    this.fact = this.questions[this.qIndex % this.questions.length];
    this.guesses = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this._deadline = Date.now() + ANSWER_MS;
    this._answerTimer = setTimeout(() => {
      if (this.state !== 'question') return;
      this._toReveal();
      this._emitChange();
    }, ANSWER_MS);
  }

  _toReveal() {
    if (this.state !== 'question') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const answer = this.fact.answer;
    const results = this.players.map((p) => {
      const guess = this.guesses[p];
      const hasGuess = guess !== undefined && guess !== null;
      const points = hasGuess ? this._scoreGuess(guess, answer) : 0;
      this.scores[p] = (this.scores[p] || 0) + points;
      return {
        playerId: p,
        guess: hasGuess ? guess : null,
        factor: hasGuess ? this._factorOff(guess, answer) : null,
        points,
      };
    });
    results.sort((a, b) => b.points - a.points);
    this.revealData = { answer, unit: this.fact.unit, prompt: this.fact.prompt, results };
    this.acknowledged = new Set();
    this._clearTimers();
    this._deadline = Date.now() + REVEAL_MS;
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
    else this.transition('next'); // -> onEnterQuestion
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'question' && type === 'submitGuess') {
      if (this.guesses[playerId] !== undefined) return; // one guess per round
      const g = Number(action.value);
      if (!Number.isFinite(g) || g <= 0) return;        // must be a positive number
      this.guesses[playerId] = g;
      this._checkQuestionComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkQuestionComplete() {
    if (this.state !== 'question') return;
    if (this.players.every((p) => this.guesses[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  // ---------- leave / teardown ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.guesses[playerId];
    this.acknowledged.delete(playerId);
    if (this.revealData) this.revealData.results = this.revealData.results.filter((r) => r.playerId !== playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'question') this._checkQuestionComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  _clearTimers() {
    for (const k of ['_answerTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // ---------- state ----------
  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      qNumber: this.qIndex + 1,
      total: this.totalRounds,
      prompt: this.fact ? this.fact.prompt : '',
      unit: this.fact ? this.fact.unit : '',
      scores: { ...this.scores },
      myGuess: this.guesses[playerId] != null ? this.guesses[playerId] : null,
      hasSubmitted: this.guesses[playerId] !== undefined,
      submittedCount: Object.keys(this.guesses).length,
      playerCount: this.players.length,
      deadline: this._deadline,
      // answer key + per-player results ONLY after reveal
      reveal: revealing ? this.revealData : null,
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
