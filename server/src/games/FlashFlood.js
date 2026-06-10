import { BaseGame } from './BaseGame.js';

// --- tuning -----------------------------------------------------------------
const START_SIZE = 3;          // round 1 is a 3x3 grid; grows +1 each round
const MAX_SIZE = 8;            // cap the grid at 8x8 (round 6)
const MAX_ROUNDS = 8;          // hard cap so the game always terminates
const LIT_FRACTION = 0.4;     // ~40% of cells lit each round
const SHOW_BASE_MS = 1600;    // base flash window...
const SHOW_PER_CELL_MS = 320; // ...plus extra time per lit cell
const RECALL_MS = 12_000;     // recall window before auto-judge
const ROUND_END_MS = 4500;    // reveal-the-pattern ack window
const ACK_MS = 10_000;        // safety auto-advance on roundEnd

function gridSizeFor(round) {
  return Math.min(START_SIZE + (round - 1), MAX_SIZE);
}

/**
 * Generate a random lit pattern over `size*size` cells (~LIT_FRACTION lit).
 * Returns a sorted array of lit cell indices (0..size*size-1). At least 2 cells,
 * never all cells (so an "everything" guess can't trivially win).
 */
function generatePattern(size) {
  const total = size * size;
  let litCount = Math.round(total * LIT_FRACTION);
  litCount = Math.max(2, Math.min(total - 1, litCount));
  const idx = Array.from({ length: total }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, litCount).sort((a, b) => a - b);
}

/** Exact-set comparison: same cells, no extras, no omissions. Inputs are index arrays. */
function exactMatch(solution, guess) {
  if (!Array.isArray(guess) || guess.length !== solution.length) return false;
  const sol = new Set(solution);
  const seen = new Set();
  for (const c of guess) {
    if (!sol.has(c)) return false;        // an extra / off-pattern tap
    if (seen.has(c)) return false;        // duplicate
    seen.add(c);
  }
  return seen.size === sol.size;
}

function emptyBoard() {
  return {
    alive: true,
    banked: 0,            // rounds successfully recalled
    eliminatedRound: null,
    lastRecallMs: 0,      // time taken on the most recent successful recall (tiebreak)
    speedSum: 0,          // cumulative recall time across banked rounds (tiebreak)
    submitted: false,     // submitted this round's recall
    submission: null,     // their tapped indices this round (for reveal)
    correctThisRound: null,
  };
}

/**
 * Flash Flood — visual pattern-memory race. Each round the server lights a random
 * PATTERN on a growing grid (3x3, 4x4, 5x5 ...). A timed SHOW phase flashes the lit
 * cells, then they HIDE and RECALL opens: every still-alive player taps the cells they
 * remember. An EXACT recall (same set, no extras) banks the round and survives; a
 * wrong/incomplete recall eliminates the player at the current depth. Continue until
 * everyone is out or the round cap. Rank by rounds banked DESC, then recall speed.
 *
 * Anti-cheat: the lit pattern lives ONLY in the FSM and is serialized to players
 * ONLY during SHOW (and at the round reveal). During RECALL it is never sent, and
 * correctness is judged server-side against the held solution.
 */
export class FlashFlood extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'show', 'recall', 'roundEnd', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'show' },
        show: { recall: 'recall' },
        recall: { endRound: 'roundEnd' },
        roundEnd: { nextRound: 'show', finish: 'finished' },
      },
    });
    this.round = 0;
    this.size = START_SIZE;
    this.pattern = [];          // server-only solution (lit cell indices)
    this.boards = {};
    this.acknowledged = new Set();
    this._showStartMs = 0;
    this._showMs = 0;
    this._recallStartMs = 0;
    this._showTimer = null;
    this._recallTimer = null;
    this._ackTimer = null;
    for (const p of players) this.boards[p] = emptyBoard();
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.round = 0;
    for (const p of this.players) this.boards[p] = emptyBoard();
    this.transition('start'); // -> onEnterShow
  }

  // --- helpers ---------------------------------------------------------------

  _alivePlayers() { return this.players.filter((p) => this.boards[p] && this.boards[p].alive); }

  // --- FSM hooks -------------------------------------------------------------

  onEnterShow() {
    this.round++;
    this.size = gridSizeFor(this.round);
    this.pattern = generatePattern(this.size);
    this.acknowledged = new Set();
    for (const p of this.players) {
      const b = this.boards[p];
      if (!b) continue;
      b.submitted = false;
      b.submission = null;
      b.correctThisRound = null;
    }
    this._showStartMs = Date.now();
    this._showMs = SHOW_BASE_MS + this.pattern.length * SHOW_PER_CELL_MS;
    this._clearTimers();
    this._showTimer = setTimeout(() => {
      if (this.state !== 'show') return;
      this._toRecall();
      this._emitChange();
    }, this._showMs);
  }

  _toRecall() {
    if (this.state !== 'show') return;
    this._clearTimers();
    this.transition('recall'); // -> onEnterRecall
  }

  onEnterRecall() {
    this._recallStartMs = Date.now();
    this._clearTimers();
    this._recallTimer = setTimeout(() => {
      if (this.state !== 'recall') return;
      this._endRound();
      this._emitChange();
    }, RECALL_MS);
  }

  onEnterRoundEnd() {
    this._clearTimers();
    this.acknowledged = new Set();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'roundEnd') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceFromRoundEnd();
      this._emitChange();
    }, ACK_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'show') {
      if (type === 'ping') {
        if (this._showStartMs && Date.now() >= this._showStartMs + this._showMs) this._toRecall();
      }
      return;
    }

    if (this.state === 'recall') {
      if (type === 'recall' || type === 'submit') {
        const b = this.boards[playerId];
        if (!b || !b.alive || b.submitted) return;
        const cells = Array.isArray(action.cells) ? action.cells : [];
        const total = this.size * this.size;
        // sanitize: integer indices in-range, de-duplicated, capped
        const clean = [];
        const seen = new Set();
        for (const c of cells) {
          const n = Number(c);
          if (!Number.isInteger(n) || n < 0 || n >= total) continue;
          if (seen.has(n)) continue;
          seen.add(n);
          clean.push(n);
          if (clean.length >= total) break;
        }
        b.submitted = true;
        b.submission = clean.slice().sort((a, z) => a - z);
        const correct = exactMatch(this.pattern, b.submission);
        b.correctThisRound = correct;
        if (correct) {
          const dt = Math.max(0, Date.now() - this._recallStartMs);
          b.banked++;
          b.lastRecallMs = dt;
          b.speedSum += dt;
        } else {
          b.alive = false;
          b.eliminatedRound = this.round;
        }
        this._checkRecallComplete();
      } else if (type === 'ping') {
        if (this._recallStartMs && Date.now() >= this._recallStartMs + RECALL_MS) this._endRound();
      }
      return;
    }

    if (this.state === 'roundEnd') {
      if (type === 'acknowledge' || type === 'recall') {
        this.acknowledged.add(playerId);
        this._checkRoundEndComplete();
      }
    }
  }

  _checkRecallComplete() {
    if (this.state !== 'recall') return;
    const alive = this._alivePlayers();
    // every still-alive player has submitted this round
    if (alive.length === 0 || alive.every((p) => this.boards[p].submitted)) this._endRound();
  }

  _endRound() {
    if (this.state !== 'recall') return; // guard double-call
    this._clearTimers();
    // any alive player who never submitted this round is judged as a miss -> out
    for (const p of this.players) {
      const b = this.boards[p];
      if (b && b.alive && !b.submitted) {
        b.submitted = true;
        b.submission = [];
        b.correctThisRound = false;
        b.alive = false;
        b.eliminatedRound = this.round;
      }
    }
    this.transition('endRound'); // -> onEnterRoundEnd
  }

  _advanceFromRoundEnd() {
    if (this.state !== 'roundEnd') return;
    this._clearTimers();
    const stillAlive = this._alivePlayers();
    // End when nobody (or a lone survivor) is left to race, or at the round cap.
    if (stillAlive.length <= 1 || this.round >= MAX_ROUNDS) {
      this.transition('finish');
    } else {
      this.transition('nextRound'); // -> onEnterShow
    }
  }

  _checkRoundEndComplete() {
    if (this.state !== 'roundEnd') return;
    if (this.players.length > 0 && this.players.every((p) => this.acknowledged.has(p))) {
      this._advanceFromRoundEnd();
    }
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.boards[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'recall') {
      this._checkRecallComplete();
    } else if (this.state === 'roundEnd') {
      this._checkRoundEndComplete();
    }
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  _clearTimers() {
    for (const k of ['_showTimer', '_recallTimer', '_ackTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const b = this.boards[playerId] || emptyBoard();
    const showing = this.state === 'show';
    const revealing = this.state === 'roundEnd' || this.state === 'finished';
    const total = this.size * this.size;

    return {
      phase: this.state,
      myId: playerId,
      round: this.round,
      maxRounds: MAX_ROUNDS,
      gridSize: this.size,
      cellCount: total,
      litCount: this.pattern.length,
      // SHOW: the lit pattern is sent so the client can flash it.
      // RECALL: NEVER sent (null). roundEnd/finished: revealed for the recap.
      pattern: showing || revealing ? [...this.pattern] : null,
      showEndMs: showing ? this._showStartMs + this._showMs : null,
      recallEndMs: this.state === 'recall' ? this._recallStartMs + RECALL_MS : null,
      // my own progress
      myAlive: b.alive,
      myBanked: b.banked,
      myEliminatedRound: b.eliminatedRound,
      mySubmitted: b.submitted,
      mySubmission: revealing ? (b.submission || []) : null,
      myCorrectThisRound: revealing ? b.correctThisRound : null,
      // opponents: counts only (never their private recall view mid-round)
      opponents: this.players.filter((p) => p !== playerId).map((p) => {
        const ob = this.boards[p] || emptyBoard();
        return {
          playerId: p,
          alive: ob.alive,
          banked: ob.banked,
          submitted: this.state === 'recall' ? ob.submitted : false,
          correctThisRound: revealing ? ob.correctThisRound : null,
        };
      }),
      aliveCount: this._alivePlayers().length,
      acknowledged: this.state === 'roundEnd' ? [...this.acknowledged] : [],
      results: this.state === 'finished' ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // banked DESC, then faster cumulative recall (speedSum ASC), then last recall ASC
    const cmp = (a, b) => {
      if (a.banked !== b.banked) return b.banked - a.banked;
      if (a.speedSum !== b.speedSum) return a.speedSum - b.speedSum;
      return a.lastRecallMs - b.lastRecallMs;
    };
    const entries = this.players.map((p) => {
      const bd = this.boards[p] || emptyBoard();
      return {
        playerId: p,
        banked: bd.banked,
        speedSum: bd.speedSum,
        lastRecallMs: bd.lastRecallMs,
        eliminatedRound: bd.eliminatedRound,
        alive: bd.alive,
      };
    });
    entries.sort(cmp);
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && cmp(entries[i - 1], e) < 0) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        banked: e.banked,
        handDescription: e.banked === 1 ? '1 round banked' : `${e.banked} rounds banked`,
      };
    });
  }
}
