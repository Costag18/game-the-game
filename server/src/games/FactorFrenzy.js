import { BaseGame } from './BaseGame.js';

const TOTAL_WINDOWS = 8;        // ~8 target windows in the 60s race
const WINDOW_MS = 9_000;        // each window lasts ~9s (eased — divisor-hunting under time is hard) (or until everyone clears the grid)
const REVEAL_MS = 2_500;        // brief reveal of which cells were divisors
const GRID_SIZE = 12;           // candidate numbers per window
const CORRECT_POINTS = 100;     // base for tapping a true divisor
const STREAK_BONUS = 25;        // extra per consecutive correct tap this window
const STREAK_CAP = 5;           // streak bonus saturates after this many
const WRONG_PENALTY = 50;       // deducted for tapping a non-divisor
const TARGET_MIN = 12;
const TARGET_MAX = 96;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function divisorsOf(target) {
  const d = [];
  for (let n = 2; n <= target; n++) if (target % n === 0) d.push(n);
  return d;
}

/**
 * Factor Frenzy — fast divisor-tapping race. ONE continuous race split into 8 TARGET
 * windows. Each window shows a TARGET (12..96) and a shared GRID of 12 candidate numbers
 * (a mix of true divisors and non-divisors). Players tap numbers simultaneously: a tap on
 * a TRUE divisor scores +points with a small consecutive-correct streak bonus; a tap on a
 * NON-divisor costs WRONG_PENALTY (clamped so the round total can't go negative on a tap).
 * Each grid cell may be tapped once per window. Window resolves on a ~7.5s timer OR once
 * every player has tapped every cell. Cumulative score over all windows ranks 1..N, ties
 * shared.
 *
 * Anti-cheat: divisibility is computed SERVER-SIDE (target % n === 0). Taps are validated
 * against the live window's grid (a tap referencing a cell index not in this window, or an
 * already-tapped cell, is ignored). getStateForPlayer NEVER sends the divisor key during
 * the window — the `isDivisor` flag per cell is exposed only in reveal/finished, and only
 * the player's own taps are echoed back live.
 */
export class FactorFrenzy extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'window', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'window' },
        window: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'window', finish: 'finished' },
      },
    });
    this.scores = {};
    this.windowIndex = -1;
    this.totalWindows = TOTAL_WINDOWS;
    this.target = null;
    this.grid = [];                 // [{ value, isDivisor }]
    this.taps = {};                 // playerId -> { [cellIndex]: { correct, gained } }
    this.streaks = {};              // playerId -> current consecutive-correct streak this window
    this.revealData = null;
    this.deadline = null;           // epoch-ms for the active timer
    this.acknowledged = new Set();
    this._windowTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.windowIndex = -1;
    this.transition('start'); // -> onEnterWindow
  }

  _buildGrid() {
    // Pick a target that has at least 3 PROPER divisors in [2, target-1] so the grid is
    // always guaranteed real divisor cells (re-roll skips primes / near-primes).
    let divPoolAll = [];
    for (let tries = 0; tries < 50; tries++) {
      this.target = TARGET_MIN + Math.floor(Math.random() * (TARGET_MAX - TARGET_MIN + 1));
      divPoolAll = divisorsOf(this.target).filter((n) => n < this.target); // proper divisors >= 2
      if (divPoolAll.length >= 3) break;
    }
    if (divPoolAll.length === 0) divPoolAll = [2]; // ultimate fallback (shouldn't happen in 12..96)
    const divPool = shuffle(divPoolAll);
    // aim for ~5 true divisors on the grid (clamped to availability)
    const wantDivisors = Math.min(divPool.length, Math.max(3, Math.min(6, Math.round(GRID_SIZE * 0.42))));
    const chosenDivisors = divPool.slice(0, wantDivisors);

    // Non-divisors: numbers in [2, target] (and a little above) that don't divide the target
    const nonPool = [];
    for (let n = 2; n <= Math.min(TARGET_MAX, this.target + 8); n++) {
      if (this.target % n !== 0) nonPool.push(n);
    }
    const wantNon = GRID_SIZE - chosenDivisors.length;
    const chosenNon = shuffle(nonPool).slice(0, wantNon);

    const cells = [
      ...chosenDivisors.map((value) => ({ value, isDivisor: true })),
      ...chosenNon.map((value) => ({ value, isDivisor: false })),
    ];
    this.grid = shuffle(cells);
  }

  // ---------- WINDOW ----------
  onEnterWindow() {
    this.windowIndex++;
    this.taps = {};
    this.streaks = {};
    this.revealData = null;
    this.acknowledged = new Set();
    for (const p of this.players) { this.taps[p] = {}; this.streaks[p] = 0; }
    this._buildGrid();
    this.deadline = Date.now() + WINDOW_MS;
    this._clearTimers();
    this._windowTimer = setTimeout(() => {
      if (this.state !== 'window') return;
      this._toReveal();
      this._emitChange();
    }, WINDOW_MS);
  }

  _everyoneCleared() {
    // a player has "cleared" the window when they have tapped all GRID_SIZE cells
    return this.players.every((p) => Object.keys(this.taps[p] || {}).length >= this.grid.length);
  }

  _checkWindowComplete() {
    if (this.state !== 'window') return;
    if (this.players.length && this._everyoneCleared()) this._toReveal();
  }

  _toReveal() {
    if (this.state !== 'window') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const cells = this.grid.map((c, i) => ({ index: i, value: c.value, isDivisor: c.isDivisor }));
    const perPlayer = {};
    for (const p of this.players) {
      const t = this.taps[p] || {};
      let correct = 0;
      let wrong = 0;
      let gained = 0;
      for (const k of Object.keys(t)) {
        if (t[k].correct) correct++; else wrong++;
        gained += t[k].gained;
      }
      perPlayer[p] = { correct, wrong, gained };
    }
    this.revealData = { target: this.target, cells, perPlayer };
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
    if (this.windowIndex + 1 >= this.totalWindows) this.transition('finish');
    else this.transition('next'); // -> onEnterWindow
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.length && this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'window' && type === 'tap') {
      const idx = Number(action.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= this.grid.length) return; // not a live cell
      const mine = this.taps[playerId] || (this.taps[playerId] = {});
      if (mine[idx] !== undefined) return; // each cell tapped once per window

      const cell = this.grid[idx];
      // SERVER decides divisibility — never trust the client
      const correct = this.target % cell.value === 0;
      if (correct) {
        const streak = (this.streaks[playerId] = (this.streaks[playerId] || 0) + 1);
        const bonus = STREAK_BONUS * Math.min(streak - 1, STREAK_CAP);
        const gained = CORRECT_POINTS + bonus;
        mine[idx] = { correct: true, gained };
        this.scores[playerId] = (this.scores[playerId] || 0) + gained;
      } else {
        this.streaks[playerId] = 0; // a miss breaks the streak
        // clamp so a single tap can't push the player's score below 0
        const penalty = Math.min(WRONG_PENALTY, this.scores[playerId] || 0);
        const gained = -penalty;
        mine[idx] = { correct: false, gained };
        this.scores[playerId] = (this.scores[playerId] || 0) + gained;
      }
      this._checkWindowComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  // ---------- leave / teardown ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.taps[playerId];
    delete this.streaks[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'window') this._checkWindowComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  _clearTimers() {
    for (const k of ['_windowTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // ---------- state / results ----------
  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    const myTaps = this.taps[playerId] || {};
    // During the window, expose cell VALUES but NOT the isDivisor key. Only echo back the
    // player's own taps (correct/gained) so their feedback flashes. Reveal exposes isDivisor.
    const grid = this.grid.map((c, i) => {
      const mine = myTaps[i];
      return {
        index: i,
        value: c.value,
        tappedByMe: mine !== undefined,
        myCorrect: mine ? mine.correct : null,
        myGained: mine ? mine.gained : null,
        isDivisor: revealing ? c.isDivisor : null,
      };
    });
    return {
      phase: this.state,
      myId: playerId,
      windowNumber: this.windowIndex + 1,
      totalWindows: this.totalWindows,
      target: this.target,
      grid,
      scores: { ...this.scores },
      myScore: this.scores[playerId] || 0,
      myStreak: this.streaks[playerId] || 0,
      playerCount: this.players.length,
      deadline: (this.state === 'window' || this.state === 'reveal') ? this.deadline : null,
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
