import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const TOTAL_ROUNDS = 3;
const WRITE_TIMER_MS = TIMERS.SCATTERGORIES * 1000; // 75_000
const ACK_TIMER_MS = 10_000;
const CATEGORIES_PER_ROUND = 10;
const LETTERS = 'ABCDEFGHIKLMNPRSTW'.split(''); // drop hard letters Q/U/V/X/Y/Z/J/O

const CATEGORY_BANK = [
  'Animal', "A boy's name", "A girl's name", 'Food', 'City', 'Country',
  'Movie or TV show', 'Something cold', 'Job or profession', 'Sport or hobby',
  'Color', 'Body part', 'Things in a kitchen', 'Famous person', 'Brand or company',
  'School subject', 'Something you wear', 'A drink', 'Cartoon character', 'Vehicle',
  'Something found at the beach', 'Board game or video game', 'Musical instrument',
  'A fruit or vegetable', 'Reason to be late', 'Things that are sticky', 'Toy',
  'A place to live', 'Something in this room', 'A type of weather',
  'Holiday or celebration', 'Things you shout', 'A fictional villain',
  'An item in your fridge', 'A flower or plant', 'A song title', 'Things at a party',
  'A piece of furniture', 'Something electronic', 'A book title',
];

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Scattergories — simultaneous. Each round: one random letter + 10 categories.
 * Players type one answer per category; an answer scores 1 point iff it is
 * non-empty, starts with the letter, AND is unique among players. 3 rounds.
 */
export class Scattergories extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'writing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'writing' },
        writing: { revealNow: 'reveal' },
        reveal: { next: 'writing', finish: 'finished' },
      },
    });
    this.round = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.letter = '';
    this.categories = [];
    this.answers = {};
    this.submitted = new Set();
    this.scores = {};
    this.roundScores = {};
    this.roundResult = null;
    this.acknowledged = new Set();
    this.roundHistory = [];
    this._writeStartTime = 0;
    this._writeTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.round = 0;
    this.scores = {};
    for (const p of this.players) this.scores[p] = 0;
    this.roundHistory = [];
    this.transition('start'); // -> writing
  }

  onEnterWriting() {
    this.round++;
    this.letter = randomFrom(LETTERS);
    this.categories = shuffle(CATEGORY_BANK).slice(0, CATEGORIES_PER_ROUND);
    this.answers = {};
    this.submitted = new Set();
    this.acknowledged = new Set();
    this.roundResult = null;
    this.roundScores = {};
    for (const p of this.players) this.roundScores[p] = 0;
    this._writeStartTime = Date.now();
    this._clearTimers();
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      this.transition('revealNow');
      this._emitChange();
    }, WRITE_TIMER_MS);
  }

  onEnterReveal() {
    if (this._writeTimer) { clearTimeout(this._writeTimer); this._writeTimer = null; }
    this._scoreRound();
    this.acknowledged = new Set();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceAfterReveal();
      this._emitChange();
    }, ACK_TIMER_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  _norm(s) { return s.trim().toLowerCase().replace(/^(the|a|an)\s+/, ''); }
  _startsOk(s) {
    const m = this._norm(s).match(/[a-z0-9]/);
    return !!m && m[0] === this.letter.toLowerCase();
  }
  _answerOf(p, c) {
    const a = this.answers[p];
    if (!a) return '';
    const v = a[c] !== undefined ? a[c] : a[String(c)];
    return typeof v === 'string' ? v : '';
  }

  _scoreRound() {
    this.roundResult = { letter: this.letter, categories: this.categories, perPlayer: {} };
    for (const p of this.players) this.roundScores[p] = 0;

    for (let c = 0; c < this.categories.length; c++) {
      const counts = {};
      for (const p of this.players) {
        const raw = this._answerOf(p, c);
        if (raw.trim() && this._startsOk(raw)) {
          const key = this._norm(raw);
          counts[key] = (counts[key] || 0) + 1;
        }
      }
      for (const p of this.players) {
        const raw = this._answerOf(p, c);
        const valid = !!raw.trim() && this._startsOk(raw);
        const unique = valid && counts[this._norm(raw)] === 1;
        if (unique) {
          this.scores[p] = (this.scores[p] || 0) + 1;
          this.roundScores[p] += 1;
        }
        if (!this.roundResult.perPlayer[p]) this.roundResult.perPlayer[p] = {};
        this.roundResult.perPlayer[p][c] = {
          text: raw,
          status: !raw.trim() ? 'empty' : !valid ? 'invalid' : unique ? 'scored' : 'dup',
        };
      }
    }
    this.roundHistory.push({ round: this.round, letter: this.letter, roundScores: { ...this.roundScores } });
  }

  _advanceAfterReveal() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.round >= this.totalRounds) this.transition('finish');
    else this.transition('next');
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    // Stale write-timer safety: if the window elapsed but we're still writing, reveal first.
    if (this.state === 'writing' && this._writeStartTime
        && Date.now() >= this._writeStartTime + WRITE_TIMER_MS) {
      this.transition('revealNow');
    }

    if (this.state === 'writing') {
      if (type === 'submit') {
        if (this.submitted.has(playerId)) return; // locks are final
        this.answers[playerId] = this._sanitize(action.answers);
        this.submitted.add(playerId);
        if (this.players.every((p) => this.submitted.has(p))) this.transition('revealNow');
      }
    } else if (this.state === 'reveal') {
      if (type === 'acknowledge') {
        this.acknowledged.add(playerId);
        if (this.players.every((p) => this.acknowledged.has(p))) this._advanceAfterReveal();
      }
    }
  }

  _sanitize(answers) {
    const out = {};
    for (let c = 0; c < this.categories.length; c++) {
      let v = answers ? (answers[c] !== undefined ? answers[c] : answers[String(c)]) : undefined;
      if (typeof v !== 'string') v = '';
      out[c] = v.trim().slice(0, 40);
    }
    return out;
  }

  removePlayer(playerId) {
    super.removePlayer(playerId);
    this.submitted.delete(playerId);
    this.acknowledged.delete(playerId);
    delete this.answers[playerId];

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'writing') {
      if (this.players.every((p) => this.submitted.has(p))) this.transition('revealNow');
    } else if (this.state === 'reveal') {
      if (this.players.every((p) => this.acknowledged.has(p))) this._advanceAfterReveal();
    }
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    if (this._writeTimer) { clearTimeout(this._writeTimer); this._writeTimer = null; }
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
  }

  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      round: this.round,
      totalRounds: this.totalRounds,
      letter: this.letter,
      categories: this.categories,
      writeEndTime: this.state === 'writing' && this._writeStartTime
        ? this._writeStartTime + WRITE_TIMER_MS : null,
      writeDurationSec: WRITE_TIMER_MS / 1000,
      myId: playerId,
      myAnswers: this.answers[playerId] || {},
      hasSubmitted: this.submitted.has(playerId),
      scores: { ...this.scores },
      submittedCount: this.submitted.size,
      totalPlayers: this.players.length,
      otherPlayers: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        hasSubmitted: this.submitted.has(p),
        score: this.scores[p] || 0,
        answers: revealing ? (this.answers[p] || {}) : null,
      })),
      roundResult: revealing ? this.roundResult : null,
      roundHistory: this.roundHistory,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) {
        placement = i + 1;
      }
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} unique answers`,
      };
    });
  }
}
