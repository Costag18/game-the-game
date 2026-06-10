import { BaseGame } from './BaseGame.js';

const TOTAL_TURNS = 13;
const TURN_MS = 40_000;       // auto-assign best remaining category on timeout
const MAX_ROLLS = 3;          // initial roll + 2 re-rolls
const NUM_DICE = 5;

// The 13 scorecard categories, in display order.
const CATEGORIES = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance',
];
const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];

function rollDie() { return Math.floor(Math.random() * 6) + 1; }

/** Count of each face value 1..6 for a 5-die hand. counts[face] = n. */
function faceCounts(dice) {
  const c = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const d of dice) c[d]++;
  return c;
}

function sumDice(dice) { return dice.reduce((a, b) => a + b, 0); }

function hasStraight(dice, len) {
  const set = new Set(dice);
  let run = 0;
  for (let f = 1; f <= 6; f++) {
    if (set.has(f)) { run++; if (run >= len) return true; } else { run = 0; }
  }
  return false;
}

/**
 * Pure scoring: the value `dice` would earn if assigned to `category`.
 * Server-authoritative — clients never compute their own score.
 */
export function scoreCategory(category, dice) {
  const c = faceCounts(dice);
  const total = sumDice(dice);
  switch (category) {
    case 'ones': return c[1] * 1;
    case 'twos': return c[2] * 2;
    case 'threes': return c[3] * 3;
    case 'fours': return c[4] * 4;
    case 'fives': return c[5] * 5;
    case 'sixes': return c[6] * 6;
    case 'threeKind': return Object.values(c).some((n) => n >= 3) ? total : 0;
    case 'fourKind': return Object.values(c).some((n) => n >= 4) ? total : 0;
    case 'fullHouse': {
      const vals = Object.values(c);
      return vals.includes(3) && vals.includes(2) ? 25 : 0;
    }
    case 'smallStraight': return hasStraight(dice, 4) ? 30 : 0;
    case 'largeStraight': return hasStraight(dice, 5) ? 40 : 0;
    case 'yahtzee': return Object.values(c).some((n) => n === 5) ? 50 : 0;
    case 'chance': return total;
    default: return 0;
  }
}

/**
 * Yahtzee — lockstep simultaneous dice game. 13 turns. Each turn every player
 * independently rolls 5 dice, may re-roll a kept subset up to twice (3 rolls
 * total), then assigns the hand to ONE unused category. The turn resolves when
 * ALL present players have assigned (or a 40s timer auto-assigns the best
 * remaining category for stragglers). Highest grand total after 13 turns wins.
 *
 * Anti-cheat: all dice RNG and scoring live on the server; a player's dice are
 * private until they assign — getStateForPlayer sends ONLY the requester's own
 * dice/rolls/scorecard, and opponents expose just whether they've assigned this
 * turn (not their faces, not their pending preview scores). Re-rolls are
 * validated (only kept indices survive; rolls-left enforced) and assignments are
 * validated (category exists, is unused, and the player has rolled this turn).
 */
export class Yahtzee extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'turn', 'turnEnd', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'turn' },
        turn: { endTurn: 'turnEnd', finish: 'finished' },
        turnEnd: { nextTurn: 'turn', finish: 'finished' },
      },
    });
    this.turn = 0;
    this.totalTurns = TOTAL_TURNS;
    // per-player persistent scorecard: { category: number | undefined }
    this.cards = {};
    // per-turn working state
    this.dice = {};        // pid -> number[5]
    this.rollsLeft = {};   // pid -> rolls remaining (re-rolls)
    this.hasRolled = {};   // pid -> bool (rolled at least once this turn)
    this.assigned = {};    // pid -> { category, score } once locked this turn
    this.turnSummary = null;
    this._turnTimer = null;
    this._deadline = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.cards[p] = {};
    this.turn = 0;
    this.transition('start'); // -> onEnterTurn
  }

  // ---------- TURN ----------
  onEnterTurn() {
    this.turn++;
    this.dice = {};
    this.rollsLeft = {};
    this.hasRolled = {};
    this.assigned = {};
    this.turnSummary = null;
    for (const p of this.players) {
      this.dice[p] = [0, 0, 0, 0, 0];
      this.rollsLeft[p] = MAX_ROLLS;
      this.hasRolled[p] = false;
    }
    this._clearTimers();
    this._deadline = Date.now() + TURN_MS;
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'turn') return;
      for (const p of this.players) if (this.assigned[p] === undefined) this._autoAssign(p);
      this._endTurn();
      this._emitChange();
    }, TURN_MS);
  }

  _unusedCategories(pid) {
    const card = this.cards[pid] || {};
    return CATEGORIES.filter((c) => card[c] === undefined);
  }

  /** Best remaining category for a hand (auto-assign on timeout / leave). */
  _autoAssign(pid) {
    if (this.assigned[pid] !== undefined) return;
    const unused = this._unusedCategories(pid);
    if (!unused.length) return;
    const dice = this.hasRolled[pid] ? this.dice[pid] : [0, 0, 0, 0, 0];
    // pick the highest-scoring unused category; ties broken by CATEGORIES order
    let best = unused[0];
    let bestScore = -1;
    for (const cat of unused) {
      const s = this.hasRolled[pid] ? scoreCategory(cat, dice) : 0;
      if (s > bestScore) { bestScore = s; best = cat; }
    }
    const score = this.hasRolled[pid] ? scoreCategory(best, dice) : 0;
    this.cards[pid][best] = score;
    this.assigned[pid] = { category: best, score, auto: true };
  }

  _endTurn() {
    if (this.state !== 'turn') return; // guard double-call
    this._clearTimers();
    this.turnSummary = {};
    for (const p of this.players) {
      this.turnSummary[p] = this.assigned[p]
        ? { category: this.assigned[p].category, score: this.assigned[p].score }
        : { category: null, score: 0 };
    }
    this.transition('endTurn'); // -> onEnterTurnEnd
  }

  onEnterTurnEnd() {
    this._clearTimers();
    // brief auto-advance so a stuck client can't freeze the lockstep
    this._deadline = Date.now() + 4000;
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'turnEnd') return;
      this._advance();
      this._emitChange();
    }, 4000);
  }

  _advance() {
    if (this.state !== 'turnEnd') return;
    this._clearTimers();
    if (this.turn >= this.totalTurns) this.transition('finish');
    else this.transition('nextTurn'); // -> onEnterTurn
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    if (this.state !== 'turn') return;
    const type = action && action.type;
    if (this.assigned[playerId] !== undefined) return; // already locked this turn

    if (type === 'roll') {
      if (this.rollsLeft[playerId] <= 0) return; // out of rolls
      const keepRaw = Array.isArray(action.keep) ? action.keep : [];
      // only valid die indices may be kept, and only if the player has rolled before
      const keep = new Set(
        this.hasRolled[playerId]
          ? keepRaw.filter((i) => Number.isInteger(i) && i >= 0 && i < NUM_DICE)
          : []
      );
      const next = this.dice[playerId].slice();
      for (let i = 0; i < NUM_DICE; i++) {
        if (!keep.has(i)) next[i] = rollDie();
      }
      this.dice[playerId] = next;
      this.hasRolled[playerId] = true;
      this.rollsLeft[playerId] -= 1;
    } else if (type === 'assign') {
      if (!this.hasRolled[playerId]) return; // must roll before assigning
      const cat = action.category;
      if (!CATEGORIES.includes(cat)) return;
      if (this.cards[playerId][cat] !== undefined) return; // category already used
      const score = scoreCategory(cat, this.dice[playerId]);
      this.cards[playerId][cat] = score;
      this.assigned[playerId] = { category: cat, score, auto: false };
      this._checkTurnComplete();
    }
  }

  _checkTurnComplete() {
    if (this.state !== 'turn') return;
    if (this.players.every((p) => this.assigned[p] !== undefined)) this._endTurn();
  }

  // ---------- SCORING ----------
  _upperSubtotal(pid) {
    const card = this.cards[pid] || {};
    return UPPER.reduce((a, c) => a + (card[c] || 0), 0);
  }
  _bonus(pid) {
    return this._upperSubtotal(pid) >= 63 ? 35 : 0;
  }
  _grandTotal(pid) {
    const card = this.cards[pid] || {};
    const base = CATEGORIES.reduce((a, c) => a + (card[c] || 0), 0);
    return base + this._bonus(pid);
  }

  // ---------- LEAVE / TEARDOWN ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.dice[playerId];
    delete this.rollsLeft[playerId];
    delete this.hasRolled[playerId];
    delete this.assigned[playerId];

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'turn') this._checkTurnComplete();
    else if (this.state === 'turnEnd') this._advance();
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
  }

  // ---------- STATE ----------
  getStateForPlayer(playerId) {
    const myCard = this.cards[playerId] || {};
    const rolled = !!this.hasRolled[playerId];
    const myDice = this.dice[playerId] || [0, 0, 0, 0, 0];
    const locked = this.assigned[playerId] !== undefined;

    // preview score for each still-unused category given my current dice
    const previews = {};
    if (this.state === 'turn' && rolled && !locked) {
      for (const cat of CATEGORIES) {
        if (myCard[cat] === undefined) previews[cat] = scoreCategory(cat, myDice);
      }
    }

    const scoreboard = this.players.map((p) => ({
      playerId: p,
      total: this._grandTotal(p),
      upperSubtotal: this._upperSubtotal(p),
      bonus: this._bonus(p),
      hasAssigned: this.assigned[p] !== undefined,
    })).sort((a, b) => b.total - a.total);

    return {
      phase: this.state,
      myId: playerId,
      turn: this.turn,
      totalTurns: this.totalTurns,
      deadline: this._deadline,
      maxRolls: MAX_ROLLS,
      categories: CATEGORIES,
      // my private working hand
      myDice: this.state === 'turn' ? myDice : myDice,
      hasRolled: rolled,
      rollsLeft: this.rollsLeft[playerId] != null ? this.rollsLeft[playerId] : 0,
      myCard: { ...myCard },
      myAssigned: locked ? this.assigned[playerId] : null,
      previews,
      myTotal: this._grandTotal(playerId),
      myUpperSubtotal: this._upperSubtotal(playerId),
      myBonus: this._bonus(playerId),
      // opponents: COUNTS / progress only, never their dice
      opponents: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        hasAssigned: this.assigned[p] !== undefined,
        total: this._grandTotal(p),
      })),
      assignedCount: this.players.filter((p) => this.assigned[p] !== undefined).length,
      playerCount: this.players.length,
      scoreboard,
      turnSummary: (this.state === 'turnEnd') ? this.turnSummary : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players.map((p) => ({ playerId: p, total: this._grandTotal(p) }));
    entries.sort((a, b) => b.total - a.total); // descending: highest total wins
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.total < entries[i - 1].total) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        score: e.total,
        handDescription: `${e.total} pts`,
      };
    });
  }
}
