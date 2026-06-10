import { BaseGame } from './BaseGame.js';
import { pickMultipleChoice } from '../utils/triviaBank.js';

const TOTAL_QUESTIONS = 8;
const ANSWER_MS = 12_000;        // window to lock a choice
const REVEAL_MS = 6_000;         // reveal display before next question
const BASE_POINTS = 1000;        // first correct buzz
const STEP_POINTS = 150;         // decay per earlier correct buzz
const MIN_POINTS = 200;          // floor for a correct (but slow) buzz

/**
 * Buzzer Royale — multiple-choice buzzer trivia. Each question shows 4 choices to
 * everyone simultaneously; a player LOCKS one choice index. Speed scoring: handleAction
 * runs serially on the server, so the k-th player (0-based) to lock the CORRECT choice
 * scores max(MIN, BASE - k*STEP); a WRONG lock scores 0 and locks that player out of the
 * question. Reveal after all answered or a ~12s timer; ~6s reveal; cumulative score ranks.
 *
 * Anti-cheat: the answer index lives ONLY on the server. getStateForPlayer sends
 * { q, choices } during the question phase but NEVER the answer; the correct index + the
 * per-player correctness are exposed only in reveal/finished.
 */
export class BuzzerRoyale extends BaseGame {
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
    this.qIndex = -1;
    this.totalQuestions = TOTAL_QUESTIONS;
    this.locks = {};            // playerId -> { choice, correct, rank } for the active question
    this.correctCount = 0;      // arrival counter of correct locks this question
    this.revealData = null;
    this.deadline = null;       // epoch-ms for the active timer (stable countdown)
    this.acknowledged = new Set();
    this._answerTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.questions = pickMultipleChoice(this.totalQuestions);
    this.qIndex = -1;
    this.transition('start'); // -> onEnterQuestion
  }

  get _q() { return this.questions[this.qIndex] || null; }

  // ---------- QUESTION ----------
  onEnterQuestion() {
    this.qIndex++;
    this.locks = {};
    this.correctCount = 0;
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = Date.now() + ANSWER_MS;
    this._clearTimers();
    this._answerTimer = setTimeout(() => {
      if (this.state !== 'question') return;
      this._toReveal();
      this._emitChange();
    }, ANSWER_MS);
  }

  _checkAllLocked() {
    if (this.state !== 'question') return;
    if (this.players.every((p) => this.locks[p] !== undefined)) this._toReveal();
  }

  _toReveal() {
    if (this.state !== 'question') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const q = this._q;
    const answer = q ? q.answer : -1;
    const results = this.players.map((p) => {
      const lock = this.locks[p];
      const gained = lock && lock.correct ? lock.gained : 0;
      return {
        playerId: p,
        choice: lock ? lock.choice : null,
        correct: !!(lock && lock.correct),
        locked: lock !== undefined,
        rank: lock && lock.correct ? lock.rank : null, // 0-based buzz order among correct
        gained,
      };
    });
    // who buzzed the right answer, fastest-first
    const buzzedCorrect = results
      .filter((r) => r.correct)
      .sort((a, b) => a.rank - b.rank);
    this.revealData = { answer, results, buzzedCorrect };
    this.acknowledged = new Set();
    this.deadline = Date.now() + REVEAL_MS;
    this._clearTimers();
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
    if (this.qIndex + 1 >= this.totalQuestions) this.transition('finish');
    else this.transition('next'); // -> onEnterQuestion
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'question' && type === 'lock') {
      if (this.locks[playerId] !== undefined) return; // one lock per question
      const choice = Number(action.choice);
      const q = this._q;
      if (!q || !Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) return;
      const correct = choice === q.answer;
      if (correct) {
        const rank = this.correctCount++;
        const gained = Math.max(MIN_POINTS, BASE_POINTS - rank * STEP_POINTS);
        this.locks[playerId] = { choice, correct: true, rank, gained };
        this.scores[playerId] = (this.scores[playerId] || 0) + gained;
      } else {
        this.locks[playerId] = { choice, correct: false, rank: null, gained: 0 };
      }
      this._checkAllLocked();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearTimers() {
    for (const k of ['_answerTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.locks[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'question') this._checkAllLocked();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const q = this._q;
    const mine = this.locks[playerId] || null;
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      qNumber: this.qIndex + 1,
      total: this.totalQuestions,
      // question content WITHOUT the answer key
      question: q ? q.q : '',
      choices: q ? [...q.choices] : [],
      scores: { ...this.scores },
      myChoice: mine ? mine.choice : null,
      myCorrect: revealing && mine ? mine.correct : null,
      locked: mine !== undefined,
      submittedCount: Object.keys(this.locks).length,
      playerCount: this.players.length,
      deadline: (this.state === 'question' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      // ONLY in reveal/finished: the correct index + per-player results
      reveal: revealing ? this.revealData : null,
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
