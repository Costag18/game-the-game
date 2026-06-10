import { BaseGame } from './BaseGame.js';
import { pickThisOrThat } from '../utils/triviaBank.js';

const TOTAL_QUESTIONS = 10;     // multi-round: everyone plays all rounds (no elimination)
const ANSWER_MS = 12_000;       // window to lock A or B each round
const REVEAL_MS = 5_000;        // reveal display before the next round / finish
const BASE_POINTS = 1000;       // first correct answer of the round
const STEP_POINTS = 80;         // speed decay per earlier correct answer
const MIN_POINTS = 500;         // floor for a correct (but slow) answer
const STREAK_BONUS = 100;       // extra points per consecutive-correct beyond the first

/**
 * This or That — binary trivia across MULTIPLE ROUNDS. Each round shows a prompt + two
 * options (A / B); EVERY player taps one (nobody is eliminated — everyone plays all
 * rounds). Scoring rewards being right AND fast: handleAction runs serially on the
 * server, so the k-th player (0-based) to lock the CORRECT side scores
 * max(MIN, BASE - k*STEP), plus a growing streak bonus for consecutive correct answers.
 * A wrong/missing answer scores 0 and breaks the streak. After TOTAL_QUESTIONS rounds the
 * cumulative score ranks the field (ties share a placement).
 *
 * Anti-cheat (server-authoritative): the correct side lives only on the server.
 * getStateForPlayer sends { prompt, a, b } during the question phase but NEVER the
 * `correct` key — it is exposed only in reveal/finished. The fact bank randomises which
 * side (A/B) a fact sits on each round, so there is no "always pick A" exploit. State
 * advances are timer-driven, so every timer callback pairs with `_emitChange()`.
 */
export class ThisOrThat extends BaseGame {
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
    this.scores = {};             // playerId -> cumulative points
    this.streaks = {};            // playerId -> current consecutive-correct run
    this.bestStreak = {};         // playerId -> best run this game (flavour)
    this.questions = [];
    this.qIndex = -1;
    this.totalQuestions = TOTAL_QUESTIONS;
    this.answers = {};            // playerId -> { choice, correct, rank, gained } (this round)
    this.correctCount = 0;        // arrival counter of correct answers this round
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = null;         // epoch-ms for the active phase timer
    this._answerTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.scores[p] = 0; this.streaks[p] = 0; this.bestStreak[p] = 0; }
    this.questions = pickThisOrThat(this.totalQuestions);
    this.totalQuestions = this.questions.length;
    this.qIndex = -1;
    this.transition('start'); // -> onEnterQuestion
  }

  get currentQuestion() { return this.questions[this.qIndex] || null; }

  // ---------- QUESTION ----------
  onEnterQuestion() {
    this.qIndex++;
    this.answers = {};
    this.correctCount = 0;
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + ANSWER_MS;
    this._answerTimer = setTimeout(() => {
      if (this.state !== 'question') return;
      this._toReveal();
      this._emitChange();
    }, ANSWER_MS);
  }

  _checkAllAnswered() {
    if (this.state !== 'question') return;
    if (this.players.every((p) => this.answers[p] !== undefined)) this._toReveal();
  }

  _toReveal() {
    if (this.state !== 'question') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const q = this.currentQuestion;
    const correct = q ? q.correct : null;
    // A no-answer counts as wrong and breaks the streak.
    for (const p of this.players) {
      if (this.answers[p] === undefined) this.streaks[p] = 0;
    }
    const results = this.players.map((p) => {
      const ans = this.answers[p];
      return {
        playerId: p,
        choice: ans ? ans.choice : null,
        correct: !!(ans && ans.correct),
        answered: ans !== undefined,
        rank: ans && ans.correct ? ans.rank : null, // 0-based correct-buzz order
        gained: ans && ans.correct ? ans.gained : 0,
        streak: this.streaks[p] || 0,
      };
    });
    const fastest = results.filter((r) => r.correct).sort((a, b) => a.rank - b.rank);
    this.revealData = {
      correct,
      a: q ? q.a : null,
      b: q ? q.b : null,
      prompt: q ? q.prompt : '',
      round: this.qIndex + 1,
      results,
      fastest,
      scores: { ...this.scores },
    };
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

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.qIndex + 1 >= this.totalQuestions) this.transition('finish');
    else this.transition('next'); // -> onEnterQuestion
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'question' && type === 'answer') {
      if (this.answers[playerId] !== undefined) return; // one lock per round
      if (action.choice !== 'a' && action.choice !== 'b') return;
      const q = this.currentQuestion;
      const isCorrect = !!(q && action.choice === q.correct);
      if (isCorrect) {
        const rank = this.correctCount++;
        const streak = (this.streaks[playerId] || 0) + 1;
        this.streaks[playerId] = streak;
        if (streak > (this.bestStreak[playerId] || 0)) this.bestStreak[playerId] = streak;
        const speed = Math.max(MIN_POINTS, BASE_POINTS - rank * STEP_POINTS);
        const bonus = (streak - 1) * STREAK_BONUS;
        const gained = speed + bonus;
        this.answers[playerId] = { choice: action.choice, correct: true, rank, gained };
        this.scores[playerId] = (this.scores[playerId] || 0) + gained;
      } else {
        this.streaks[playerId] = 0;
        this.answers[playerId] = { choice: action.choice, correct: false, rank: null, gained: 0 };
      }
      this._checkAllAnswered();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearTimers() {
    for (const k of ['_answerTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers rotation
    delete this.answers[playerId];
    delete this.scores[playerId];
    delete this.streaks[playerId];
    delete this.bestStreak[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'question') this._checkAllAnswered();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const q = this.currentQuestion;
    const mine = this.answers[playerId] || null;
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      qNumber: this.qIndex + 1,
      total: this.totalQuestions,
      // prompt + options ONLY — the correct side is withheld until reveal.
      prompt: q ? q.prompt : '',
      a: q ? q.a : null,
      b: q ? q.b : null,
      scores: { ...this.scores },
      myScore: this.scores[playerId] || 0,
      myStreak: this.streaks[playerId] || 0,
      myAnswer: mine ? mine.choice : null,
      myCorrect: revealing && mine ? mine.correct : null,
      hasAnswered: mine !== undefined,
      submittedCount: Object.keys(this.answers).length,
      playerCount: this.players.length,
      deadline: (this.state === 'question' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: revealing ? this.revealData : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Rank by cumulative score (highest first); equal scores share a placement.
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        bestStreak: this.bestStreak[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
