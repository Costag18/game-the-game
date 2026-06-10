import { BaseGame } from './BaseGame.js';
import { pickRankSets, shuffle } from '../utils/triviaBank.js';

const TOTAL_ROUNDS = 4;
const ANSWER_MS = 40_000;
const REVEAL_MS = 6_000;
const MAX_POINTS = 1000;

/**
 * Rank It — put them in order. Each round shows a category and its items SHUFFLED;
 * every player privately submits their own ordering. Scoring is by adjacency
 * accuracy: count of correctly-ordered adjacent PAIRS vs the true order, scaled to
 * 1000 points (`round(1000 * correctPairs / (items.length - 1))`). Cumulative score
 * ranks players 1..N.
 *
 * Server-authoritative anti-cheat: the correct `ordered` array lives ONLY on the
 * server. getStateForPlayer sends the category + the SHUFFLED items but never the
 * true order until the reveal phase. Submissions are validated as a permutation of
 * the shuffled items so a client can't smuggle the answer in.
 *
 * Timer-driven transitions all pair with `_emitChange()` per the v2.7.0 broadcast
 * contract so the room re-broadcasts state and re-checks isComplete().
 */
export class RankIt extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'ranking', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'ranking' },
        ranking: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'ranking', finish: 'finished' },
      },
    });
    this.scores = {};
    this.roundIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.rounds = pickRankSets(TOTAL_ROUNDS); // [{ category, ordered:[...] }]
    this.category = '';
    this.ordered = [];        // server-only correct order for the active round
    this.shuffledItems = [];  // what clients see/reorder
    this.answers = {};        // playerId -> their submitted ordering (array)
    this.deadline = 0;
    this.revealData = null;
    this.acknowledged = new Set();
    this._answerTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterRanking
  }

  // ---------- RANKING ----------
  onEnterRanking() {
    this.roundIndex++;
    const set = this.rounds[this.roundIndex % this.rounds.length];
    this.category = set.category;
    this.ordered = [...set.ordered];
    this.shuffledItems = this._shuffleDistinct(set.ordered);
    this.answers = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + ANSWER_MS;
    this._answerTimer = setTimeout(() => {
      if (this.state !== 'ranking') return;
      // anyone who didn't submit gets credited their shuffled (un-reordered) guess
      for (const p of this.players) {
        if (this.answers[p] === undefined) this.answers[p] = [...this.shuffledItems];
      }
      this._toReveal();
      this._emitChange();
    }, ANSWER_MS);
  }

  // shuffle but avoid handing players the already-correct order on a small set
  _shuffleDistinct(ordered) {
    if (ordered.length < 2) return [...ordered];
    let s = shuffle(ordered);
    let guard = 0;
    while (this._sameOrder(s, ordered) && guard++ < 8) s = shuffle(ordered);
    return s;
  }
  _sameOrder(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

  // count correctly-ordered adjacent pairs of `arr` against the true order
  _scoreOrdering(arr) {
    const pos = {};
    this.ordered.forEach((item, i) => { pos[item] = i; });
    let correct = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      const a = pos[arr[i]];
      const b = pos[arr[i + 1]];
      if (a !== undefined && b !== undefined && b === a + 1) correct++;
    }
    const denom = Math.max(1, this.ordered.length - 1);
    return { correct, points: Math.round((MAX_POINTS * correct) / denom) };
  }

  _isPermutation(arr) {
    if (!Array.isArray(arr) || arr.length !== this.shuffledItems.length) return false;
    const want = [...this.shuffledItems].sort();
    const got = [...arr].map(String).sort();
    return want.every((x, i) => x === got[i]);
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'ranking') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }
  onEnterReveal() {
    const awards = {};
    for (const p of this.players) {
      const arr = this.answers[p] || [...this.shuffledItems];
      const { correct, points } = this._scoreOrdering(arr);
      this.scores[p] = (this.scores[p] || 0) + points;
      awards[p] = { ordering: arr, correctPairs: correct, gained: points };
    }
    this.revealData = {
      category: this.category,
      correctOrder: [...this.ordered],
      maxPairs: Math.max(1, this.ordered.length - 1),
      awards,
    };
    this.acknowledged = new Set();
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
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterRanking
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'ranking' && type === 'submitOrder') {
      if (this.answers[playerId] !== undefined) return;
      if (!this._isPermutation(action.order)) return;
      this.answers[playerId] = action.order.map(String);
      this._checkRankComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkRankComplete() {
    if (this.state !== 'ranking') return;
    if (this.players.every((p) => this.answers[p] !== undefined)) this._toReveal();
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
    delete this.answers[playerId];
    delete this.scores[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'ranking') this._checkRankComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      category: this.category,
      items: [...this.shuffledItems], // shuffled — NEVER the correct order pre-reveal
      myOrder: this.answers[playerId] ? [...this.answers[playerId]] : null,
      locked: this.answers[playerId] !== undefined,
      submittedCount: Object.keys(this.answers).length,
      playerCount: this.players.length,
      deadline: this.state === 'ranking' ? this.deadline : null,
      scores: { ...this.scores },
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: revealing ? this.revealData : null, // correct order ONLY here
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
