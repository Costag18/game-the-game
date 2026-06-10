import { BaseGame } from './BaseGame.js';

const TOTAL_DEALS = 4;          // rounds
const DEAL_MS = 45_000;         // window to crack each deal
const REVEAL_MS = 6_000;        // reveal display before next deal
const BASE_POINTS = 1000;       // first valid 24 this deal
const STEP_POINTS = 250;        // decay per earlier solver
const MIN_POINTS = 200;         // floor for a valid (but slow) solve
const TARGET = 24;
const EPS = 1e-6;

/* ============================================================================
 * SAFE EXPRESSION EVALUATOR (server-only anti-cheat)
 *
 * Tokenize → recursive-descent parse (standard precedence, left-assoc) → eval.
 * Only number literals, + - * / and parentheses are permitted; ANY other
 * character (letters, ^, %, decimals beyond what we accept, etc.) is rejected.
 *
 * `evaluateExpression(str)` returns { value, literals } on success, or null on
 * ANY invalid input — the FSM treats null as a non-scoring miss. NEVER trust the
 * client: the server alone decides whether a submission is valid and equals 24.
 * ==========================================================================*/

// --- tokenizer ---------------------------------------------------------------
// We deliberately accept ONLY integer literals (the 24-game deals integers).
function tokenize(str) {
  if (typeof str !== 'string') return null;
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '(' || ch === ')') {
      tokens.push({ type: ch });
      i++;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (i < str.length && str[i] >= '0' && str[i] <= '9') { num += str[i]; i++; }
      tokens.push({ type: 'num', value: Number(num) });
      continue;
    }
    return null; // any other character is invalid
  }
  return tokens;
}

// --- recursive-descent parser + evaluator -----------------------------------
// Grammar:
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := number | '(' expr ')'
// (No unary minus — keeps the literal multiset honest; "3-5" is fine, "-5" isn't
//  a needed operand for the 24 game and avoids sneaking extra negatives.)
function parseExpression(tokens) {
  let pos = 0;
  const literals = [];

  function peek() { return tokens[pos]; }
  function next() { return tokens[pos++]; }

  function parseExpr() {
    let value = parseTerm();
    if (value === null) return null;
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = next().type;
      const rhs = parseTerm();
      if (rhs === null) return null;
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm() {
    let value = parseFactor();
    if (value === null) return null;
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = next().type;
      const rhs = parseFactor();
      if (rhs === null) return null;
      if (op === '*') {
        value = value * rhs;
      } else {
        if (Math.abs(rhs) < EPS) return null; // division by zero
        value = value / rhs;
      }
    }
    return value;
  }

  function parseFactor() {
    const t = peek();
    if (!t) return null;
    if (t.type === 'num') {
      next();
      literals.push(t.value);
      return t.value;
    }
    if (t.type === '(') {
      next();
      const inner = parseExpr();
      if (inner === null) return null;
      if (!peek() || peek().type !== ')') return null; // unbalanced
      next();
      return inner;
    }
    return null; // an operator or ')' where a factor was expected
  }

  const value = parseExpr();
  if (value === null) return null;
  if (pos !== tokens.length) return null; // trailing junk
  return { value, literals };
}

/** Returns { value, literals } or null on any invalid input. */
export function evaluateExpression(str) {
  const tokens = tokenize(str);
  if (!tokens || tokens.length === 0) return null;
  return parseExpression(tokens);
}

/**
 * Validate a submitted expression for a specific deal: it must be parseable,
 * use EXACTLY the four dealt numbers (multiset equality — each used once), and
 * evaluate to 24 within epsilon. Returns true/false. Pure anti-cheat gate.
 */
export function isValidSolution(str, numbers) {
  const res = evaluateExpression(str);
  if (!res) return false;
  if (Math.abs(res.value - TARGET) > EPS) return false;
  // multiset of literals must equal the multiset of dealt numbers
  if (res.literals.length !== numbers.length) return false;
  const want = [...numbers].sort((a, b) => a - b);
  const got = [...res.literals].sort((a, b) => a - b);
  for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) return false;
  return true;
}

// --- solvable-deal generation ------------------------------------------------
// Brute-force search every ordering / operator / paren-shape to (a) confirm a
// quad is solvable and (b) recover one concrete solution string for the reveal.
const OPS = ['+', '-', '*', '/'];

function applyOp(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return Math.abs(b) < EPS ? null : a / b;
    default: return null;
  }
}

// Returns an array of { value, expr } reachable from a list of {value, expr} cards.
function solveCards(cards) {
  if (cards.length === 1) return [cards[0]];
  const results = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = 0; j < cards.length; j++) {
      if (i === j) continue;
      const rest = [];
      for (let k = 0; k < cards.length; k++) if (k !== i && k !== j) rest.push(cards[k]);
      const a = cards[i];
      const b = cards[j];
      for (const op of OPS) {
        const v = applyOp(a.value, b.value, op);
        if (v === null) continue;
        const combined = { value: v, expr: `(${a.expr}${op}${b.expr})` };
        const sub = solveCards([combined, ...rest]);
        for (const s of sub) results.push(s);
      }
    }
  }
  return results;
}

/** Find one solution string for a quad, or null if unsolvable. */
export function findSolution(numbers) {
  const cards = numbers.map((n) => ({ value: n, expr: String(n) }));
  const all = solveCards(cards);
  for (const r of all) {
    if (Math.abs(r.value - TARGET) <= EPS) {
      // strip the single outermost wrapping parens for readability
      let e = r.expr;
      if (e.startsWith('(') && e.endsWith(')')) e = e.slice(1, -1);
      return e;
    }
  }
  return null;
}

/** Generate a random solvable quad of integers 1..9 (retry until solvable). */
export function generateDeal() {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const nums = [];
    for (let k = 0; k < 4; k++) nums.push(1 + Math.floor(Math.random() * 9));
    const sol = findSolution(nums);
    if (sol) return { numbers: nums, solution: sol };
  }
  // Deterministic fallback known to make 24 (4*6=24 via 4,6,1,1 -> 4*6*1*1).
  const nums = [6, 4, 1, 1];
  return { numbers: nums, solution: findSolution(nums) || '6*4*1*1' };
}

/* ============================================================================
 * GAME — Twenty-Four (the 24 Game)
 *
 * 4 deals. Each deal shows the same 4 integers to everyone simultaneously.
 * Players race to submit an arithmetic expression using EACH number exactly once
 * that evaluates to 24. SPEED SCORING: handleAction runs serially, so the k-th
 * player (0-based) to submit a VALID 24 this deal scores max(MIN, BASE-k*STEP).
 * Invalid submissions DON'T lock you out — you may retry until you solve it or
 * the 45s timer fires. Reveal one solution at deal end. Cumulative score ranks.
 *
 * Anti-cheat: the SERVER validates every expression (safe evaluator, exactly the
 * 4 dealt numbers, ==24). The client can never claim a solve. getStateForPlayer
 * sends the dealt numbers + target (part of the puzzle) but the example solution
 * ONLY in reveal/finished.
 * ==========================================================================*/
export class TwentyFour extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'deal', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'deal' },
        deal: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'deal', finish: 'finished' },
      },
    });
    this.scores = {};
    this.deals = [];
    this.dealIndex = -1;
    this.totalDeals = TOTAL_DEALS;
    this.solves = {};          // playerId -> { expr, rank, gained } for the active deal
    this.solveCount = 0;       // arrival counter of valid solves this deal
    this.lastReject = {};      // playerId -> reason string (private feedback)
    this.revealData = null;
    this.deadline = null;
    this.acknowledged = new Set();
    this._dealTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.deals = [];
    for (let i = 0; i < this.totalDeals; i++) this.deals.push(generateDeal());
    this.dealIndex = -1;
    this.transition('start'); // -> onEnterDeal
  }

  get _deal() { return this.deals[this.dealIndex] || null; }

  // ---------- DEAL ----------
  onEnterDeal() {
    this.dealIndex++;
    this.solves = {};
    this.solveCount = 0;
    this.lastReject = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = Date.now() + DEAL_MS;
    this._clearTimers();
    this._dealTimer = setTimeout(() => {
      if (this.state !== 'deal') return;
      this._toReveal();
      this._emitChange();
    }, DEAL_MS);
  }

  _checkAllSolved() {
    if (this.state !== 'deal') return;
    if (this.players.every((p) => this.solves[p] !== undefined)) this._toReveal();
  }

  _toReveal() {
    if (this.state !== 'deal') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const deal = this._deal;
    const results = this.players.map((p) => {
      const s = this.solves[p];
      return {
        playerId: p,
        solved: s !== undefined,
        expr: s ? s.expr : null,
        rank: s ? s.rank : null,   // 0-based solve order
        gained: s ? s.gained : 0,
      };
    });
    const solvedOrder = results.filter((r) => r.solved).sort((a, b) => a.rank - b.rank);
    this.revealData = {
      numbers: deal ? [...deal.numbers] : [],
      solution: deal ? deal.solution : null,
      results,
      solvedOrder,
    };
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
    if (this.dealIndex + 1 >= this.totalDeals) this.transition('finish');
    else this.transition('next'); // -> onEnterDeal
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'deal' && type === 'submit') {
      if (this.solves[playerId] !== undefined) return; // already solved this deal
      const deal = this._deal;
      if (!deal) return;
      const expr = typeof action.expression === 'string' ? action.expression : '';
      const res = evaluateExpression(expr);
      if (!res) {
        this.lastReject[playerId] = 'bad'; // unparseable / illegal characters
        return;
      }
      // wrong numbers used?
      const want = [...deal.numbers].sort((a, b) => a - b);
      const got = [...res.literals].sort((a, b) => a - b);
      let sameNumbers = res.literals.length === deal.numbers.length;
      if (sameNumbers) {
        for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) { sameNumbers = false; break; }
      }
      if (!sameNumbers) {
        this.lastReject[playerId] = 'numbers';
        return;
      }
      if (Math.abs(res.value - TARGET) > EPS) {
        this.lastReject[playerId] = 'value';
        return;
      }
      // VALID 24 — score by arrival order
      delete this.lastReject[playerId];
      const rank = this.solveCount++;
      const gained = Math.max(MIN_POINTS, BASE_POINTS - rank * STEP_POINTS);
      this.solves[playerId] = { expr, rank, gained };
      this.scores[playerId] = (this.scores[playerId] || 0) + gained;
      this._checkAllSolved();
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
    for (const k of ['_dealTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.solves[playerId];
    delete this.lastReject[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'deal') this._checkAllSolved();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const deal = this._deal;
    const mine = this.solves[playerId] || null;
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      dealNumber: this.dealIndex + 1,
      totalDeals: this.totalDeals,
      target: TARGET,
      // the dealt numbers are part of the puzzle and shown to everyone;
      // the example `solution` is NEVER sent during the deal phase.
      numbers: deal ? [...deal.numbers] : [],
      scores: { ...this.scores },
      mySolved: mine !== null,
      myExpr: mine ? mine.expr : null,
      myGained: mine ? mine.gained : 0,
      myRank: mine ? mine.rank : null,
      myReject: this.state === 'deal' ? (this.lastReject[playerId] || null) : null,
      solvedCount: Object.keys(this.solves).length,
      playerCount: this.players.length,
      deadline: (this.state === 'deal' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      // ONLY in reveal/finished: a worked solution + per-player results
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
