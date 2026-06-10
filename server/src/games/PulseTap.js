import { BaseGame } from './BaseGame.js';

const TOTAL_ROUNDS = 3;
const COUNTDOWN_MS = 2500;   // lead-in before the first beat each round
const GRACE_MS = 900;        // grace after the last beat before the round ends
const SUMMARY_MS = 4000;     // round-summary auto-advance
const PERFECT_MS = 120;      // |offset| <= this -> Perfect
const GOOD_MS = 280;         // |offset| <= this -> Good
const PERFECT_PTS = 100;
const GOOD_PTS = 50;
const COMBO_STEP = 0.10;     // +10% per combo step
const MAX_COMBO_MULT = 3.0;  // multiplier cap

// Beat schedule per round: count of beats and the interval between them.
// Tightens each round (faster interval, more beats).
const ROUND_CONFIG = [
  { beats: 12, interval: 700 },
  { beats: 14, interval: 600 },
  { beats: 16, interval: 500 },
];

/**
 * Pulse Tap — server-authoritative rhythm tapping, 3 rounds. The SERVER owns the
 * beat schedule (target times), the clock, and all grading. A client only ever
 * sends {type:'tap'}; the server grades that tap against the nearest UNCONSUMED
 * beat for that player using the server clock at action-arrival time:
 *   |offset| <= 120ms -> Perfect (+100), <= 280ms -> Good (+50), else Miss (0, combo breaks).
 * Consecutive non-Miss hits build a combo multiplier (+10%/step, capped). Each beat
 * is consumable once per player. A client can never claim a grade it didn't earn —
 * the schedule is visible (the approaching beats ARE the game) but grading is purely
 * server-side from the schedule + the arrival timestamp.
 *
 * Every timer (countdown, round-end grace, summary) pairs with _emitChange() per the
 * v2.7.0 broadcast contract; _clearTimers() tracks/clears all of them; destroy() calls it.
 */
export class PulseTap extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'countdown', 'playing', 'summary', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'countdown' },
        countdown: { go: 'playing' },
        playing: { endRound: 'summary' },
        summary: { nextRound: 'countdown', finish: 'finished' },
      },
    });
    this.round = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.scores = {};            // cumulative across rounds
    this.combos = {};            // current combo step per player
    this.maxCombos = {};         // best combo step ever reached
    this.lastJudge = {};         // last {grade, points, offset} per player
    this.consumed = {};          // playerId -> Set of consumed beat indices (this round)
    this.roundScores = {};       // playerId -> points earned this round
    this.acknowledged = new Set();
    this.schedule = [];          // absolute beat times (ms) for the current round
    this.roundStartAt = null;    // server time of the first beat
    this.lastBeatAt = null;
    this._countdownTimer = null;
    this._endTimer = null;
    this._summaryTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.round = 0;
    for (const p of this.players) {
      this.scores[p] = 0;
      this.combos[p] = 0;
      this.maxCombos[p] = 0;
      this.lastJudge[p] = null;
    }
    this.transition('start'); // -> onEnterCountdown
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterCountdown() {
    this.round++;
    const cfg = ROUND_CONFIG[(this.round - 1) % ROUND_CONFIG.length];
    this.acknowledged = new Set();
    this.consumed = {};
    this.roundScores = {};
    for (const p of this.players) {
      this.combos[p] = 0;
      this.lastJudge[p] = null;
      this.consumed[p] = new Set();
      this.roundScores[p] = 0;
    }
    // Build the beat schedule (absolute server times) up front so it's testable
    // and grading is deterministic from the schedule + arrival clock.
    this.roundStartAt = Date.now() + COUNTDOWN_MS;
    this.schedule = [];
    for (let i = 0; i < cfg.beats; i++) {
      this.schedule.push(this.roundStartAt + i * cfg.interval);
    }
    this.lastBeatAt = this.schedule[this.schedule.length - 1];
    this._clearTimers();
    this._countdownTimer = setTimeout(() => {
      if (this.state !== 'countdown') return;
      this.transition('go'); // -> onEnterPlaying
      this._emitChange();
    }, COUNTDOWN_MS);
  }

  onEnterPlaying() {
    // Round ends a grace period after the last beat.
    const untilEnd = Math.max(0, (this.lastBeatAt - Date.now()) + GRACE_MS);
    this._endTimer = setTimeout(() => {
      if (this.state !== 'playing') return;
      this._endRound();
      this._emitChange();
    }, untilEnd);
  }

  onEnterSummary() {
    this._clearTimers();
    this._summaryTimer = setTimeout(() => {
      if (this.state !== 'summary') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceFromSummary();
      this._emitChange();
    }, SUMMARY_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'playing') {
      if (type === 'tap') {
        this._gradeTap(playerId);
      } else if (type === 'ping') {
        // harmless nudge; if the round should already be over, end it
        if (Date.now() >= this.lastBeatAt + GRACE_MS) this._endRound();
      }
    } else if (this.state === 'summary') {
      if (type === 'acknowledge' || type === 'tap') {
        this.acknowledged.add(playerId);
        if (this.players.every((p) => this.acknowledged.has(p))) this._advanceFromSummary();
      }
    } else if (type === 'ping' && this.state === 'countdown') {
      if (Date.now() >= this.roundStartAt - COUNTDOWN_MS + COUNTDOWN_MS) {
        // no-op: countdown timer owns this; ping is just a re-broadcast nudge
      }
    }
  }

  /**
   * Grade ONE tap from `playerId` using the server clock NOW vs the schedule.
   * Finds the nearest UNCONSUMED beat for that player; grades by absolute offset.
   */
  _gradeTap(playerId) {
    const now = Date.now();
    const consumed = this.consumed[playerId] || (this.consumed[playerId] = new Set());

    // nearest unconsumed beat by absolute distance
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.schedule.length; i++) {
      if (consumed.has(i)) continue;
      const dist = Math.abs(now - this.schedule[i]);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    if (bestIdx === -1) {
      // no beats left to grade against — a stray tap breaks combo, scores nothing
      this.combos[playerId] = 0;
      this.lastJudge[playerId] = { grade: 'miss', points: 0, offset: null, beatIndex: null };
      return;
    }

    const offset = now - this.schedule[bestIdx]; // signed: + = late, - = early
    const absOff = Math.abs(offset);

    if (absOff > GOOD_MS) {
      // too far from any beat: a Miss. Consume nothing (the beat may still be
      // hit by a better-timed tap) — but the combo breaks.
      this.combos[playerId] = 0;
      this.lastJudge[playerId] = { grade: 'miss', points: 0, offset, beatIndex: null };
      return;
    }

    // Perfect or Good — consume this beat and award combo-scaled points.
    consumed.add(bestIdx);
    const grade = absOff <= PERFECT_MS ? 'perfect' : 'good';
    const base = grade === 'perfect' ? PERFECT_PTS : GOOD_PTS;
    const newCombo = (this.combos[playerId] || 0) + 1;
    this.combos[playerId] = newCombo;
    if (newCombo > (this.maxCombos[playerId] || 0)) this.maxCombos[playerId] = newCombo;
    const mult = Math.min(1 + (newCombo - 1) * COMBO_STEP, MAX_COMBO_MULT);
    const points = Math.round(base * mult);
    this.scores[playerId] = (this.scores[playerId] || 0) + points;
    this.roundScores[playerId] = (this.roundScores[playerId] || 0) + points;
    this.lastJudge[playerId] = { grade, points, offset, beatIndex: bestIdx, combo: newCombo };
  }

  _endRound() {
    if (this.state !== 'playing') return; // guard double-call
    this._clearTimers();
    this.transition('endRound'); // -> onEnterSummary
  }

  _advanceFromSummary() {
    if (this.state !== 'summary') return;
    this._clearTimers();
    if (this.round >= this.totalRounds) this.transition('finish');
    else this.transition('nextRound'); // -> onEnterCountdown
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.scores[playerId];
    delete this.combos[playerId];
    delete this.maxCombos[playerId];
    delete this.lastJudge[playerId];
    delete this.consumed[playerId];
    delete this.roundScores[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'summary') {
      if (this.players.every((p) => this.acknowledged.has(p))) this._advanceFromSummary();
    }
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    for (const k of ['_countdownTimer', '_endTimer', '_summaryTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const now = Date.now();
    const revealing = this.state === 'summary' || this.state === 'finished';
    // The beat schedule IS visible (the approaching beats are the game). We send
    // it relative to the player's server time so the client can animate the sweep.
    const beats = this.schedule.map((t, i) => ({
      index: i,
      atMs: t,
      consumed: (this.consumed[playerId] && this.consumed[playerId].has(i)) || false,
    }));
    return {
      phase: this.state,
      myId: playerId,
      round: this.round,
      totalRounds: this.totalRounds,
      serverTime: now,
      roundStartAt: this.roundStartAt,
      beats: this.state === 'countdown' || this.state === 'playing' ? beats : [],
      countdownMs: this.state === 'countdown' ? Math.max(0, this.roundStartAt - now) : 0,
      myScore: this.scores[playerId] || 0,
      myRoundScore: this.roundScores[playerId] || 0,
      myCombo: this.combos[playerId] || 0,
      myMaxCombo: this.maxCombos[playerId] || 0,
      lastJudgement: this.lastJudge[playerId] || null,
      scoreboard: this.players
        .map((p) => ({
          playerId: p,
          score: this.scores[p] || 0,
          combo: this.combos[p] || 0,
          roundScore: revealing ? (this.roundScores[p] || 0) : null,
        }))
        .sort((a, b) => b.score - a.score),
      acknowledged: revealing ? [...(this.acknowledged || [])] : [],
      totalPlayers: this.players.length,
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
        maxCombo: this.maxCombos[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} pts · x${this.maxCombos[playerId] || 0} combo`,
      };
    });
  }
}
