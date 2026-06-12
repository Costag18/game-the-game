import { BaseGame } from './BaseGame.js';
import { pickNumericFacts } from '../utils/triviaBank.js';

const TOTAL_ROUNDS = 5;
const GUESS_MS = 25_000;       // window to lock a guess each round
const REVEAL_MS = 50_000;      // reveal SAFETY auto-advance (no visible countdown) — Continue gates normally
// Closest-without-going-over payout ladder (by rank among non-over guesses).
const PAYOUTS = [1000, 700, 500];
const PAYOUT_REST = 200;       // 4th-closest and beyond (still under) all get this
const PAYOUT_OVER = 0;         // any guess exceeding the true answer is capped at 0

/**
 * Price Is Wrong — closest-without-going-over. Each round shows a numeric prompt +
 * unit (from the shared triviaBank); every player privately submits one numeric
 * guess. After reveal, guesses that do NOT exceed the true answer are ranked by
 * closeness: 1000 / 700 / 500 / 200 (rest); anyone OVER scores 0. Cumulative over
 * 5 rounds ranks 1..N.
 *
 * Anti-cheat: the true answer lives ONLY on the server and is never present in
 * getStateForPlayer before the reveal phase; each player's guess is private (not
 * shown to others) until reveal. Timer-driven transitions pair with _emitChange()
 * per the v2.7.0 broadcast contract.
 */
export class PriceIsWrong extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'guessing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'guessing' },
        guessing: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'guessing', finish: 'finished' },
      },
    });
    this.scores = {};
    this.questions = [];
    this.round = 0;            // 1-based, set in onEnterGuessing
    this.totalRounds = TOTAL_ROUNDS;
    this.fact = null;          // current { prompt, answer, unit } (answer is server-only)
    this.guesses = {};         // playerId -> number (this round)
    this.revealData = null;
    this.acknowledged = new Set();
    this._deadline = 0;
    this._guessTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    // Pick ALL questions for the game once; pad from the bank if it's short.
    let qs = pickNumericFacts(this.totalRounds);
    while (qs.length < this.totalRounds) qs = qs.concat(pickNumericFacts(this.totalRounds - qs.length));
    this.questions = qs.slice(0, this.totalRounds);
    this.round = 0;
    this.transition('start'); // -> onEnterGuessing
  }

  // ---------- GUESSING ----------
  onEnterGuessing() {
    this.round++;
    this.fact = this.questions[(this.round - 1) % this.questions.length];
    this.guesses = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this._deadline = Date.now() + GUESS_MS;
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
    const answer = this.fact.answer;
    // Players who submitted a valid (under-or-equal) guess, ranked by closeness.
    const under = this.players
      .filter((p) => this.guesses[p] !== undefined && this.guesses[p] <= answer)
      .map((p) => ({ playerId: p, guess: this.guesses[p], diff: answer - this.guesses[p] }))
      .sort((a, b) => a.diff - b.diff); // smallest gap (closest) first

    const awards = {};
    for (const p of this.players) awards[p] = { guess: this.guesses[p] != null ? this.guesses[p] : null, over: false, gained: 0, rank: null };

    // Walk the closeness ladder; equally-close guesses SHARE a rank and the better
    // (higher) payout of their tied group, then the next distinct diff drops to the
    // ladder position after the whole group.
    let i = 0;
    while (i < under.length) {
      let j = i;
      while (j + 1 < under.length && under[j + 1].diff === under[i].diff) j++;
      const gained = i < PAYOUTS.length ? PAYOUTS[i] : PAYOUT_REST;
      for (let k = i; k <= j; k++) {
        const u = under[k];
        this.scores[u.playerId] = (this.scores[u.playerId] || 0) + gained;
        awards[u.playerId] = { guess: u.guess, over: false, gained, rank: i + 1 };
      }
      i = j + 1;
    }
    for (const p of this.players) {
      if (this.guesses[p] !== undefined && this.guesses[p] > answer) {
        awards[p] = { guess: this.guesses[p], over: true, gained: PAYOUT_OVER, rank: null };
      }
    }

    // Reveal-only board: everyone's guess sorted (under guesses ascending by diff,
    // then the over-guessers, then no-shows last).
    const board = this.players.map((p) => {
      const a = awards[p];
      const submitted = this.guesses[p] !== undefined;
      return {
        playerId: p,
        guess: submitted ? this.guesses[p] : null,
        diff: submitted && !a.over ? answer - this.guesses[p] : null,
        over: a.over,
        submitted,
        gained: a.gained,
        rank: a.rank,
      };
    }).sort((x, y) => {
      const rank = (e) => (e.over ? 2 : !e.submitted ? 3 : 1);
      if (rank(x) !== rank(y)) return rank(x) - rank(y);
      if (rank(x) === 1) return x.diff - y.diff; // closest first among unders
      return 0;
    });

    this.revealData = { answer, unit: this.fact.unit, prompt: this.fact.prompt, board, awards };
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
    if (this.round >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterGuessing
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'guessing' && type === 'submitGuess') {
      if (this.guesses[playerId] !== undefined) return; // one guess per round
      const n = Number(action.guess);
      if (!Number.isFinite(n) || n < 0) return;
      this.guesses[playerId] = n;
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
    delete this.scores[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
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
      round: this.round,
      totalRounds: this.totalRounds,
      // prompt + unit are safe pre-reveal; the answer is NEVER included here before reveal.
      prompt: this.fact ? this.fact.prompt : '',
      unit: this.fact ? this.fact.unit : '',
      scores: { ...this.scores },
      myId: playerId,
      myGuess: this.guesses[playerId] != null ? this.guesses[playerId] : null,
      hasSubmitted: this.guesses[playerId] !== undefined,
      submittedCount: Object.keys(this.guesses).length,
      playerCount: this.players.length,
      deadline: this.state === 'guessing' ? this._deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
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
