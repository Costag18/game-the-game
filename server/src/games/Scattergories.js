import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const TOTAL_ROUNDS = 3;
const WRITE_TIMER_MS = TIMERS.SCATTERGORIES * 1000; // 75_000
// The reveal advances when everyone taps Continue; this is just a generous safety net so a
// lingering player can't deadlock the room (no visible countdown — read the answers in peace).
const ACK_TIMER_MS = 60_000;
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
    this.reports = {};        // { [targetPlayer]: { [categoryIndex]: Set<reporterId> } }
    this.challenged = {};     // { [targetPlayer]: Set<categoryIndex> } voted-out answers
    this._priorScores = {};   // cumulative scores before the current round (for re-scoring)
    this._roundScored = false;
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
    this._priorScores = { ...this.scores };  // snapshot cumulative from prior rounds
    this.reports = {};
    this.challenged = {};
    this._roundScored = false;
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

  _isChallengedOut(p, c) {
    return !!(this.challenged[p] && this.challenged[p].has(c));
  }

  // Idempotent / re-runnable: recomputes the round from current answers + challenges.
  // Called on reveal entry and again whenever a unanimous report removes an answer.
  _scoreRound() {
    this.roundResult = { letter: this.letter, categories: this.categories, perPlayer: {} };
    for (const p of this.players) this.roundScores[p] = 0;

    for (let c = 0; c < this.categories.length; c++) {
      const counts = {};
      for (const p of this.players) {
        const raw = this._answerOf(p, c);
        if (!this._isChallengedOut(p, c) && raw.trim() && this._startsOk(raw)) {
          counts[this._norm(raw)] = (counts[this._norm(raw)] || 0) + 1;
        }
      }
      for (const p of this.players) {
        const raw = this._answerOf(p, c);
        const challengedOut = this._isChallengedOut(p, c);
        const valid = !challengedOut && !!raw.trim() && this._startsOk(raw);
        const unique = valid && counts[this._norm(raw)] === 1;
        if (unique) this.roundScores[p] += 1;
        if (!this.roundResult.perPlayer[p]) this.roundResult.perPlayer[p] = {};
        this.roundResult.perPlayer[p][c] = {
          text: raw,
          status: challengedOut ? 'challenged'
            : !raw.trim() ? 'empty'
            : !this._startsOk(raw) ? 'invalid'
            : unique ? 'scored' : 'dup',
        };
      }
    }
    // cumulative = prior rounds + this round (recompute-safe)
    for (const p of this.players) this.scores[p] = (this._priorScores[p] || 0) + this.roundScores[p];

    const entry = { round: this.round, letter: this.letter, roundScores: { ...this.roundScores } };
    if (!this._roundScored) { this.roundHistory.push(entry); this._roundScored = true; }
    else this.roundHistory[this.roundHistory.length - 1] = entry;
  }

  // Re-evaluate pending reports: an answer is voted out when EVERY other present
  // player has reported it. Re-scores if any new challenge lands.
  _reevaluateChallenges() {
    if (this.state !== 'reveal') return;
    let changed = false;
    for (const target of this.players) {
      const byCat = this.reports[target];
      if (!byCat) continue;
      const others = this.players.filter((p) => p !== target);
      if (others.length === 0) continue;
      for (const cKey of Object.keys(byCat)) {
        const c = Number(cKey);
        const set = byCat[cKey];
        const unanimous = others.every((o) => set.has(o));
        const already = this._isChallengedOut(target, c);
        if (unanimous && !already) {
          if (!this.challenged[target]) this.challenged[target] = new Set();
          this.challenged[target].add(c);
          changed = true;
        }
      }
    }
    if (changed) this._scoreRound();
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
      } else if (type === 'report') {
        this._handleReport(playerId, action);
      }
    }
  }

  _handleReport(reporter, action) {
    const target = action && action.targetPlayer;
    const c = Number(action && action.categoryIndex);
    if (!this.players.includes(target) || target === reporter) return;
    if (!(c >= 0 && c < this.categories.length)) return;
    if (this._isChallengedOut(target, c)) return;        // already voted out
    if (!this._answerOf(target, c).trim()) return;        // nothing to report
    if (!this.reports[target]) this.reports[target] = {};
    if (!this.reports[target][c]) this.reports[target][c] = new Set();
    const set = this.reports[target][c];
    if (set.has(reporter)) set.delete(reporter); else set.add(reporter); // toggle
    this._reevaluateChallenges();
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
      this._reevaluateChallenges(); // fewer "others" may now make a pending report unanimous
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
      reportsView: revealing ? this._reportsView(playerId) : null,
      acknowledged: [...this.acknowledged],
      roundHistory: this.roundHistory,
    };
  }

  _reportsView(viewer) {
    const out = {};
    for (const target of this.players) {
      const byCat = this.reports[target];
      if (!byCat) continue;
      for (const cKey of Object.keys(byCat)) {
        const set = byCat[cKey];
        if (!set || set.size === 0) continue;
        if (!out[target]) out[target] = {};
        out[target][cKey] = {
          count: set.size,
          mine: set.has(viewer),
          challenged: this._isChallengedOut(target, Number(cKey)),
        };
      }
    }
    return out;
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
