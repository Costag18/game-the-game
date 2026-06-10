import { BaseGame } from './BaseGame.js';
import { pickOddOneOut } from '../utils/triviaBank.js';

const TOTAL_ROUNDS  = 6;
const ANSWER_MS     = 15_000;  // window to tap an item each round
const REVEAL_MS     = 6_000;   // reveal -> next question auto-advance
const BASE_POINTS   = 800;     // first correct tapper
const STEP_POINTS   = 100;     // decay per earlier correct tapper
const MIN_POINTS    = 200;     // floor for a correct tap

/**
 * Odd One Out — simultaneous spot-the-odd-item speed game. Each round shows 4
 * items; every player taps the one they think breaks the hidden rule.
 *
 * SPEED SCORING: handleAction runs serially on the server, so the k-th player
 * (0-based) to tap the CORRECT odd item scores max(MIN, BASE - k*STEP). A wrong
 * tap scores 0 and locks that player out of the round. No client timestamps.
 *
 * Anti-cheat: oddIndex + rule live ONLY on the server. getStateForPlayer sends
 * { items } but NEVER the oddIndex/rule until the reveal phase. State advances
 * are timer-driven (answer timeout / reveal timeout), so every timer callback
 * pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class OddOneOut extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'question', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting:  { start: 'question' },
        question: { reveal: 'reveal', finish: 'finished' },
        reveal:   { next: 'question', finish: 'finished' },
      },
    });
    this.scores = {};
    this.questions = [];
    this.qIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.round = null;          // { items, oddIndex, rule }
    this.answers = {};          // playerId -> { index, correct, rank, gained }
    this.correctCount = 0;      // arrival counter of correct taps this round
    this.deadline = null;       // epoch-ms for active timer
    this.acknowledged = new Set();
    this._answerTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.questions = pickOddOneOut(this.totalRounds);
    this.transition('start'); // -> onEnterQuestion
  }

  // ---------- QUESTION ----------
  onEnterQuestion() {
    this.qIndex++;
    this.round = this.questions[this.qIndex % this.questions.length];
    this.answers = {};
    this.correctCount = 0;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + ANSWER_MS;
    this._answerTimer = setTimeout(() => {
      if (this.state !== 'question') return;
      this._toReveal();
      this._emitChange();
    }, ANSWER_MS);
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'question') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }
  onEnterReveal() {
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
    else this.transition('next'); // -> onEnterQuestion
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'question' && type === 'tap') {
      if (this.answers[playerId] !== undefined) return; // one tap per round
      const idx = Number(action.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= this.round.items.length) return;
      const correct = idx === this.round.oddIndex;
      if (correct) {
        const rank = this.correctCount++;
        const gained = Math.max(MIN_POINTS, BASE_POINTS - rank * STEP_POINTS);
        this.scores[playerId] = (this.scores[playerId] || 0) + gained;
        this.answers[playerId] = { index: idx, correct: true, rank, gained };
      } else {
        this.answers[playerId] = { index: idx, correct: false, rank: null, gained: 0 };
      }
      this._checkAllAnswered();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkAllAnswered() {
    if (this.state !== 'question') return;
    if (this.players.every((p) => this.answers[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  // ---------- leave / teardown ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.answers[playerId];
    delete this.scores[playerId];
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

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    for (const k of ['_answerTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // ---------- state / results ----------
  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    const mine = this.answers[playerId] || null;
    return {
      phase: this.state,
      myId: playerId,
      qNumber: this.qIndex + 1,
      total: this.totalRounds,
      items: this.round ? [...this.round.items] : [],
      myAnswer: mine ? mine.index : null,
      myCorrect: mine ? mine.correct : null,
      myGained: mine ? mine.gained : 0,
      locked: mine !== null,
      submittedCount: Object.keys(this.answers).length,
      playerCount: this.players.length,
      scores: { ...this.scores },
      deadline: this.deadline,
      // answer key ONLY in reveal/finished
      oddIndex: revealing && this.round ? this.round.oddIndex : null,
      rule: revealing && this.round ? this.round.rule : null,
      results: revealing
        ? this.players.map((p) => ({
            playerId: p,
            index: this.answers[p] ? this.answers[p].index : null,
            correct: !!(this.answers[p] && this.answers[p].correct),
            rank: this.answers[p] ? this.answers[p].rank : null,
            gained: this.answers[p] ? this.answers[p].gained : 0,
          }))
        : null,
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
