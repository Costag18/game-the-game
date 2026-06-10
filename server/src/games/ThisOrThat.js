import { BaseGame } from './BaseGame.js';
import { pickThisOrThat } from '../utils/triviaBank.js';

const TOTAL_QUESTIONS = 8;
const ANSWER_MS = 12_000;  // window to lock A or B each question
const REVEAL_MS = 6_000;   // reveal auto-advance to next question / finish

/**
 * This or That — binary survival trivia. Each question shows a prompt + two
 * options (A / B); every STILL-ALIVE player taps one. On reveal, players who
 * picked the WRONG side are ELIMINATED (their elimination round is recorded);
 * correct players survive. Continues until ≤1 remain or questions run out.
 *
 * Ranking is REVERSE-ELIMINATION (like Spoons): survivors rank above earlier
 * eliminees, players eliminated in the SAME round share a placement, and the
 * last survivor(s) rank 1.
 *
 * Anti-cheat (server-authoritative): the correct side lives only on the server.
 * getStateForPlayer sends { prompt, a, b } during the question phase but NEVER
 * the `correct` key — it is exposed only in reveal/finished. State advances are
 * timer-driven, so every timer callback pairs with `_emitChange()` per the
 * v2.7.0 broadcast contract.
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
    this.questions = [];
    this.qIndex = -1;
    this.totalQuestions = TOTAL_QUESTIONS;
    this.survivors = [...players];
    this.eliminationRound = {};   // playerId -> round they went out (1-based)
    this.answers = {};            // playerId -> 'a' | 'b' (this question only)
    this.lastReveal = null;       // { correct, a, b, survived:[], eliminated:[] }
    this.acknowledged = new Set();
    this.deadline = null;       // epoch-ms for the active phase timer
    this._answerTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.questions = pickThisOrThat(this.totalQuestions);
    this.totalQuestions = this.questions.length;
    this.eliminationRound = {};
    this.survivors = [...this.players];
    this.transition('start'); // -> onEnterQuestion
  }

  // ---------- QUESTION ----------
  onEnterQuestion() {
    this.qIndex++;
    this.answers = {};
    this.lastReveal = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + ANSWER_MS;
    this._answerTimer = setTimeout(() => {
      if (this.state !== 'question') return;
      this._toReveal();
      this._emitChange();
    }, ANSWER_MS);
  }

  get currentQuestion() {
    return this.questions[this.qIndex] || null;
  }

  _checkAnswerComplete() {
    if (this.state !== 'question') return;
    if (this.survivors.every((p) => this.answers[p] !== undefined)) this._toReveal();
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'question') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  onEnterReveal() {
    const q = this.currentQuestion;
    const correct = q ? q.correct : null;
    const round = this.qIndex + 1;
    const survived = [];
    const eliminated = [];
    // Snapshot survivors before we mutate the set. A no-answer (timeout / never
    // submitted) counts as WRONG and eliminates the player this round.
    for (const p of [...this.survivors]) {
      if (this.answers[p] === correct) {
        survived.push(p);
      } else {
        eliminated.push(p);
        if (this.eliminationRound[p] === undefined) this.eliminationRound[p] = round;
      }
    }
    // Guard: never wipe out EVERYONE on a single question. If all alive players
    // answered wrong (or didn't answer), nobody is eliminated this round — the
    // game just moves on so we always have at least one survivor.
    if (survived.length === 0 && eliminated.length > 0) {
      for (const p of eliminated) delete this.eliminationRound[p];
      survived.push(...eliminated);
      eliminated.length = 0;
    }
    for (const p of eliminated) this.survivors = this.survivors.filter((s) => s !== p);
    for (const p of eliminated) this._removeFromActive(p); // out of rotation, stays in this.players

    this.lastReveal = {
      correct,
      a: q ? q.a : null,
      b: q ? q.b : null,
      prompt: q ? q.prompt : '',
      round,
      survived: [...survived],
      eliminated: [...eliminated],
      answers: { ...this.answers },
    };
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.survivors) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.survivors.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.survivors.length <= 1 || this.qIndex + 1 >= this.totalQuestions) {
      this.transition('finish');
    } else {
      this.transition('next'); // -> onEnterQuestion
    }
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'question' && type === 'answer') {
      if (!this.survivors.includes(playerId)) return; // eliminated players watch
      if (this.answers[playerId] !== undefined) return; // one lock per question
      if (action.choice !== 'a' && action.choice !== 'b') return;
      this.answers[playerId] = action.choice;
      this._checkAnswerComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      if (!this.survivors.includes(playerId)) return;
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
    const wasSurvivor = this.survivors.includes(playerId);
    super.removePlayer(playerId); // prunes this.players + activePlayers rotation
    delete this.answers[playerId];
    this.acknowledged.delete(playerId);
    delete this.eliminationRound[playerId];
    if (wasSurvivor) this.survivors = this.survivors.filter((p) => p !== playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'question') this._checkAnswerComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const q = this.currentQuestion;
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
      iAmAlive: this.survivors.includes(playerId),
      myAnswer: this.answers[playerId] != null ? this.answers[playerId] : null,
      hasAnswered: this.answers[playerId] !== undefined,
      submittedCount: this.survivors.filter((p) => this.answers[p] !== undefined).length,
      survivorsCount: this.survivors.length,
      playerCount: this.players.length,
      eliminatedRound: this.eliminationRound[playerId] != null ? this.eliminationRound[playerId] : null,
      deadline: (this.state === 'question' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      survivorIds: this.state === 'reveal' ? [...this.survivors] : [],
      reveal: revealing ? this.lastReveal : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Reverse-elimination ranking: later survival = better placement. Survivors
    // (never eliminated) rank top; among eliminees, a LATER elimination round is
    // better. Players sharing an elimination round (and all survivors together)
    // share a placement — dense placements over all N.
    const depth = (p) => (this.eliminationRound[p] != null ? this.eliminationRound[p] : Infinity);
    const sorted = [...this.players].sort((a, b) => depth(b) - depth(a));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && depth(playerId) < depth(sorted[i - 1])) placement = i + 1;
      const elimRound = this.eliminationRound[playerId] != null ? this.eliminationRound[playerId] : null;
      const survived = elimRound === null;
      return {
        playerId,
        placement,
        eliminatedRound: elimRound,
        survivedToEnd: survived,
        handDescription: survived ? 'Survived 🏆' : `Out Q${elimRound}`,
      };
    });
  }
}
