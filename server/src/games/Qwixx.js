import { BaseGame } from './BaseGame.js';

const TOTAL_ROUNDS = 12;
const ROUND_MS = 25_000;       // per-round mark-or-pass window
const REVEAL_MS = 50_000;      // final-results AFK-safety net — players advance via Continue/ack

// Each colored row has 11 cells. Red/Yellow ascend 2..12; Green/Blue descend 12..2.
const ASC = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DESC = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const ROWS = [
  { color: 'red', dir: 'asc', cells: ASC },
  { color: 'yellow', dir: 'asc', cells: ASC },
  { color: 'green', dir: 'desc', cells: DESC },
  { color: 'blue', dir: 'desc', cells: DESC },
];
const COLORS = ROWS.map((r) => r.color);

function rollDie() { return 1 + Math.floor(Math.random() * 6); }
function triangular(n) { return (n * (n + 1)) / 2; }

/**
 * Qwixx — simplified roll-and-write. Each round the SERVER rolls two dice and
 * announces ONLY their sum (the offered number) to everyone simultaneously. Each
 * player may mark that number on ONE of their four colored rows, but only strictly
 * to the RIGHT of their last mark in that row (ascending for red/yellow, descending
 * for green/blue), or pass. The round resolves when every present player has
 * marked-or-passed OR a 25s timer fires (timeout = pass for the missing).
 *
 * Server-authoritative anti-cheat: dice are rolled server-side; the offered number
 * is the only die info clients ever receive; every mark is validated against the
 * offered number and the row's last-marked position before it's recorded. A player's
 * board is their own (boards are public anyway — Qwixx has no hidden hand), but the
 * NEXT round's number is never revealed until the round flips, and a player can't
 * mark a number that wasn't offered.
 *
 * Scoring (after 12 rounds): each row scores triangularly by its mark count —
 * n*(n+1)/2 — summed across the four rows. Highest total wins; ties share a placement.
 */
export class Qwixx extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'round', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'round' },
        round: { next: 'round', reveal: 'reveal', finish: 'finished' },
        reveal: { finish: 'finished' },
      },
    });
    this.round = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.dice = [0, 0];
    this.offered = 0;
    this.deadline = 0;
    // boards[pid][color] = array of marked numbers (in the order taken)
    this.boards = {};
    // acted[pid] = true once they've marked OR passed this round
    this.acted = {};
    this.lastAction = {};   // pid -> 'mark' | 'pass' | null (for UI this round)
    this.history = [];      // [{ round, dice, offered }]
    this.acknowledged = new Set(); // pids who pressed Continue on the final reveal
    this._roundTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.round = 0;
    this.boards = {};
    for (const p of this.players) {
      this.boards[p] = {};
      for (const c of COLORS) this.boards[p][c] = [];
    }
    this.transition('start'); // -> onEnterRound
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterRound() {
    this.round++;
    this.dice = [rollDie(), rollDie()];
    this.offered = this.dice[0] + this.dice[1];
    this.acted = {};
    this.lastAction = {};
    for (const p of this.players) { this.acted[p] = false; this.lastAction[p] = null; }
    this.history.push({ round: this.round, dice: [...this.dice], offered: this.offered });
    this.deadline = Date.now() + ROUND_MS;
    this._clearTimers();
    this._roundTimer = setTimeout(() => {
      if (this.state !== 'round') return;
      for (const p of this.players) if (!this.acted[p]) { this.acted[p] = true; this.lastAction[p] = 'pass'; }
      this._resolveRound();
      this._emitChange();
    }, ROUND_MS);
  }

  onEnterReveal() {
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this.transition('finish');
      this._emitChange();
    }, REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) {
      this._clearTimers();
      this.transition('finish');
    }
  }

  onEnterFinished() { this._clearTimers(); }

  // --- rules helpers ---------------------------------------------------------

  _rowDef(color) { return ROWS.find((r) => r.color === color); }

  /** Index in the row's cell array where this color's next legal mark must sit (strictly right of last). */
  _isLegalMark(playerId, color, number) {
    const def = this._rowDef(color);
    if (!def) return false;
    if (number !== this.offered) return false;            // must be THE offered number
    const idx = def.cells.indexOf(number);
    if (idx < 0) return false;                              // 2..12 only
    const marks = this.boards[playerId]?.[color] || [];
    if (marks.length === 0) return true;                   // first mark anywhere
    const lastIdx = def.cells.indexOf(marks[marks.length - 1]);
    return idx > lastIdx;                                  // strictly to the right
  }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const aType = action && action.type;

    if (this.state === 'reveal') {
      if (aType === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealComplete();
      }
      return;
    }

    if (this.state !== 'round') return;
    if (this.acted[playerId]) return;                      // one action per round
    const type = action && action.type;

    if (type === 'mark') {
      const color = action.color;
      const number = Number(action.number);
      if (!this._isLegalMark(playerId, color, number)) return; // reject illegal/out-of-offer
      this.boards[playerId][color].push(number);
      this.acted[playerId] = true;
      this.lastAction[playerId] = 'mark';
      this._maybeResolveRound();
    } else if (type === 'pass') {
      this.acted[playerId] = true;
      this.lastAction[playerId] = 'pass';
      this._maybeResolveRound();
    }
    // unknown action types ignored
  }

  _maybeResolveRound() {
    if (this.state !== 'round') return;
    if (this.players.every((p) => this.acted[p])) this._resolveRound();
  }

  _resolveRound() {
    if (this.state !== 'round') return;                    // guard double-call
    this._clearTimers();
    if (this.round >= this.totalRounds) this.transition('reveal');
    else this.transition('next'); // -> onEnterRound (new roll)
  }

  // --- scoring ---------------------------------------------------------------

  _rowScore(playerId, color) { return triangular((this.boards[playerId]?.[color] || []).length); }

  _totalScore(playerId) {
    if (!this.boards[playerId]) return 0;
    return COLORS.reduce((sum, c) => sum + this._rowScore(playerId, c), 0);
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.acted[playerId];
    delete this.lastAction[playerId];
    delete this.boards[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'round') this._maybeResolveRound();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    for (const k of ['_roundTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // --- state / results -------------------------------------------------------

  _publicBoard(pid) {
    const b = {};
    for (const c of COLORS) {
      const marks = this.boards[pid]?.[c] || [];
      const def = this._rowDef(c);
      const lastIdx = marks.length ? def.cells.indexOf(marks[marks.length - 1]) : -1;
      b[c] = { marks: [...marks], lastIndex: lastIdx, count: marks.length, score: triangular(marks.length) };
    }
    return b;
  }

  /** Which cells in each row would be a LEGAL mark of the offered number right now (for this pid). */
  _legalForPlayer(pid) {
    if (this.state !== 'round' || this.acted[pid]) return {};
    const out = {};
    for (const c of COLORS) {
      out[c] = this._isLegalMark(pid, c, this.offered) ? this.offered : null;
    }
    return out;
  }

  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      round: this.round,
      totalRounds: this.totalRounds,
      // dice values are shown to everyone AS the announced roll (the sum is the offer)
      dice: this.state === 'round' ? [...this.dice] : null,
      offered: this.state === 'round' ? this.offered : null,
      // only the per-round window drives a visible countdown; the long reveal timer is a
      // no-countdown AFK-safety net (players advance via Continue/ack)
      deadline: this.state === 'round' ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      rows: ROWS.map((r) => ({ color: r.color, dir: r.dir, cells: r.cells })),
      myBoard: this._publicBoard(playerId),
      myScore: this._totalScore(playerId),
      legalMarks: this._legalForPlayer(playerId), // { color: offeredNumber | null }
      hasActed: !!this.acted[playerId],
      myLastAction: this.lastAction[playerId] || null,
      actedCount: this.players.filter((p) => this.acted[p]).length,
      playerCount: this.players.length,
      players: this.players.map((p) => ({
        playerId: p,
        score: this._totalScore(p),
        hasActed: !!this.acted[p],
        // opponent boards are public in Qwixx, but only marks (no hidden info to hide)
        board: revealing || true ? this._publicBoard(p) : null,
      })),
      scoreboard: [...this.players]
        .map((p) => ({ playerId: p, score: this._totalScore(p) }))
        .sort((a, b) => b.score - a.score),
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players.map((p) => ({
      playerId: p,
      score: this._totalScore(p),
      breakdown: COLORS.map((c) => ({ color: c, count: (this.boards[p]?.[c] || []).length, score: this._rowScore(p, c) })),
    }));
    entries.sort((a, b) => b.score - a.score); // descending: highest total wins
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.score < entries[i - 1].score) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        score: e.score,
        handDescription: `${e.score} pts`,
      };
    });
  }
}
