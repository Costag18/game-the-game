import { BaseGame } from './BaseGame.js';

const TOTAL_ROUNDS = 3;
const ROUND_MS = 45_000;       // per-round play window
const REVEAL_MS = 8_000;       // reveal display before next round
const LARGE_POOL = [25, 50, 75, 100];

// Closeness scoring (distance = |value - target|)
const POINTS_EXACT = 1000;
const POINTS_WITHIN_5 = 700;
const POINTS_WITHIN_10 = 500;
const FALLOFF_BASE = 300;      // beyond 10: max(0, 300 - distance)

/**
 * Target Locked — a "Countdown numbers"-style race. Each of 3 rounds deals 6 SOURCE
 * numbers (a mix of small 1..10 and a few large from {25,50,75,100}) and a random
 * 3-digit TARGET (101..999). All players race SIMULTANEOUSLY to build an arithmetic
 * expression out of the source numbers (each used AT MOST ONCE) with + - * / and
 * parentheses, where EVERY intermediate result must be a POSITIVE WHOLE number.
 *
 * Players may submit many expressions; only their BEST (closest to the target) counts.
 * Closeness scoring per round: exact=1000, within 5=700, within 10=500, else
 * max(0, 300 - distance). Cumulative score across the 3 rounds ranks 1..N (ties shared).
 *
 * ANTI-CHEAT: the SERVER re-evaluates every submission with a SAFE recursive-descent
 * evaluator (NO eval/Function) — it tokenizes, validates the multiset of literals against
 * the dealt numbers (at-most-once), enforces whole-positive intermediates, and computes
 * the value. The client is never trusted. getStateForPlayer sends the numbers + target
 * (the puzzle) but never a solution; a best achievable value is only computed for the
 * reveal phase.
 */
export class TargetLocked extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'round', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'round' },
        round: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'round', finish: 'finished' },
      },
    });
    this.scores = {};
    this.totalRounds = TOTAL_ROUNDS;
    this.roundIndex = -1;
    this.numbers = [];           // the 6 source numbers this round
    this.target = 0;
    this.best = {};              // playerId -> { expr, value, distance, gained } (best so far this round)
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = null;        // epoch-ms for the active timer (stable countdown)
    this._roundTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.roundIndex = -1;
    this.transition('start'); // -> onEnterRound
  }

  // ---------- round setup ----------
  _dealNumbers() {
    // 2 large (from {25,50,75,100}, may repeat) + 4 small (1..10)
    const nums = [];
    const largeCount = 2;
    for (let i = 0; i < largeCount; i++) {
      nums.push(LARGE_POOL[Math.floor(Math.random() * LARGE_POOL.length)]);
    }
    for (let i = nums.length; i < 6; i++) {
      nums.push(1 + Math.floor(Math.random() * 10));
    }
    // shuffle so larges aren't always first
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    return nums;
  }

  onEnterRound() {
    this.roundIndex++;
    this.numbers = this._dealNumbers();
    this.target = 101 + Math.floor(Math.random() * (999 - 101 + 1)); // 101..999
    this.best = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = Date.now() + ROUND_MS;
    this._clearTimers();
    this._roundTimer = setTimeout(() => {
      if (this.state !== 'round') return;
      this._toReveal();
      this._emitChange();
    }, ROUND_MS);
  }

  _toReveal() {
    if (this.state !== 'round') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  onEnterReveal() {
    // best achievable value the server can find (for the reveal's "best possible" hint)
    const bestPossible = this._solveBest();
    // bank each player's best-of-round points into their cumulative score
    for (const p of this.players) {
      const b = this.best[p];
      if (b) this.scores[p] = (this.scores[p] || 0) + b.gained;
    }
    const results = this.players.map((p) => {
      const b = this.best[p] || null;
      return {
        playerId: p,
        expr: b ? b.expr : null,
        value: b ? b.value : null,
        distance: b ? b.distance : null,
        gained: b ? b.gained : 0,
      };
    });
    this.revealData = { target: this.target, numbers: [...this.numbers], bestPossible, results };
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
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterRound
  }

  // ---------- scoring ----------
  static scoreDistance(distance) {
    if (distance === 0) return POINTS_EXACT;
    if (distance <= 5) return POINTS_WITHIN_5;
    if (distance <= 10) return POINTS_WITHIN_10;
    return Math.max(0, FALLOFF_BASE - distance);
  }

  // ---------- safe expression evaluation (NO eval / Function) ----------
  // Tokenize → parse with precedence → evaluate, enforcing whole-positive intermediates.
  // Returns { value, expr } on success, or null on any invalid input.
  _evaluateExpression(raw) {
    if (typeof raw !== 'string') return null;
    const tokens = this._tokenize(raw);
    if (!tokens) return null;
    if (!tokens.some((t) => t.type === 'num')) return null;

    // validate multiset of literals against the dealt numbers (at most once each)
    const allowed = {};
    for (const n of this.numbers) allowed[n] = (allowed[n] || 0) + 1;
    const used = {};
    for (const t of tokens) {
      if (t.type === 'num') {
        used[t.value] = (used[t.value] || 0) + 1;
        if (!allowed[t.value] || used[t.value] > allowed[t.value]) return null;
      }
    }

    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    // The evaluator enforces: every division must be exact (no remainder) and every
    // intermediate result must be a positive whole number. A violation throws BAD.
    const BAD = Symbol('bad');

    function parseExpr() {
      let left = parseTerm();
      if (left === BAD) return BAD;
      while (peek() && (peek().type === 'op') && (peek().value === '+' || peek().value === '-')) {
        const op = next().value;
        const right = parseTerm();
        if (right === BAD) return BAD;
        left = op === '+' ? left + right : left - right;
        if (!Number.isInteger(left) || left <= 0) return BAD;
      }
      return left;
    }

    function parseTerm() {
      let left = parseFactor();
      if (left === BAD) return BAD;
      while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
        const op = next().value;
        const right = parseFactor();
        if (right === BAD) return BAD;
        if (op === '*') {
          left = left * right;
        } else {
          if (right === 0) return BAD;
          if (left % right !== 0) return BAD; // no fractional intermediates
          left = left / right;
        }
        if (!Number.isInteger(left) || left <= 0) return BAD;
      }
      return left;
    }

    function parseFactor() {
      const t = peek();
      if (!t) return BAD;
      if (t.type === 'lparen') {
        next();
        const v = parseExpr();
        if (v === BAD) return BAD;
        const close = peek();
        if (!close || close.type !== 'rparen') return BAD;
        next();
        return v;
      }
      if (t.type === 'num') {
        next();
        if (!Number.isInteger(t.value) || t.value <= 0) return BAD;
        return t.value;
      }
      return BAD; // a leading operator / stray token
    }

    const value = parseExpr();
    if (value === BAD) return null;
    if (pos !== tokens.length) return null; // trailing garbage
    if (!Number.isInteger(value) || value <= 0) return null;
    return { value, expr: raw.trim() };
  }

  // Tokenizer: only digits, + - * / and parentheses are allowed. Anything else → null.
  _tokenize(raw) {
    const tokens = [];
    const s = String(raw);
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c >= '0' && c <= '9') {
        let num = 0;
        let digits = 0;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') {
          num = num * 10 + (s.charCodeAt(i) - 48);
          digits++;
          i++;
          if (digits > 6) return null; // absurdly long literal
        }
        tokens.push({ type: 'num', value: num });
        continue;
      }
      if (c === '+' || c === '-' || c === '*' || c === '/') { tokens.push({ type: 'op', value: c }); i++; continue; }
      if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
      if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
      return null; // any other character (letters, ^, %, ., etc.) → invalid
    }
    return tokens;
  }

  // Brute-force the closest reachable value to the target (for the reveal hint only).
  // Explores combine-two-then-recurse over the multiset of dealt numbers. Bounded by 6
  // numbers so the search is small; only positive-whole intermediates are kept.
  _solveBest() {
    let bestVal = null;
    let bestDist = Infinity;
    let bestExpr = null;
    const target = this.target;

    const consider = (val, expr) => {
      if (!Number.isInteger(val) || val <= 0) return;
      const d = Math.abs(val - target);
      if (d < bestDist) { bestDist = d; bestVal = val; bestExpr = expr; }
    };

    // state: array of { val, expr }
    const start = this.numbers.map((n) => ({ val: n, expr: String(n) }));
    const recurse = (items) => {
      for (const it of items) consider(it.val, it.expr);
      if (bestDist === 0) return;
      if (items.length < 2) return;
      for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const a = items[i];
          const b = items[j];
          const rest = items.filter((_, k) => k !== i && k !== j);
          const combos = [];
          combos.push({ val: a.val + b.val, expr: `(${a.expr}+${b.expr})` });
          if (a.val - b.val > 0) combos.push({ val: a.val - b.val, expr: `(${a.expr}-${b.expr})` });
          combos.push({ val: a.val * b.val, expr: `(${a.expr}*${b.expr})` });
          if (b.val !== 0 && a.val % b.val === 0) combos.push({ val: a.val / b.val, expr: `(${a.expr}/${b.expr})` });
          for (const c of combos) {
            if (!Number.isInteger(c.val) || c.val <= 0) continue;
            recurse([c, ...rest]);
            if (bestDist === 0) return;
          }
        }
      }
    };
    recurse(start);
    return bestVal == null ? null : { value: bestVal, expr: bestExpr, distance: bestDist };
  }

  // ---------- actions ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'round' && type === 'submit') {
      const evaluated = this._evaluateExpression(action.expr);
      if (!evaluated) return; // invalid submission is a non-scoring miss
      const distance = Math.abs(evaluated.value - this.target);
      const gained = TargetLocked.scoreDistance(distance);
      const prev = this.best[playerId];
      // keep only the best (closest) per player
      if (!prev || distance < prev.distance) {
        this.best[playerId] = { expr: evaluated.expr, value: evaluated.value, distance, gained };
      }
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
    for (const k of ['_roundTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.best[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    const mine = this.best[playerId] || null;
    return {
      phase: this.state,
      myId: playerId,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      // the puzzle — numbers + target are shown; no solution is ever sent during play
      numbers: [...this.numbers],
      target: this.target,
      scores: { ...this.scores },
      myBest: mine ? { expr: mine.expr, value: mine.value, distance: mine.distance, gained: mine.gained } : null,
      submittedCount: Object.keys(this.best).length,
      playerCount: this.players.length,
      deadline: (this.state === 'round' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: revealing ? this.revealData : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // cumulative best-per-round points (banked at each reveal)
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
