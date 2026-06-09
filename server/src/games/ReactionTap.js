import { BaseGame } from './BaseGame.js';

const TOTAL_ROUNDS   = 5;
const ARM_MIN_MS     = 1500;
const ARM_MAX_MS     = 5000;   // server delay 1.5–5s before GO
const GO_CUTOFF_MS   = 3000;   // window to tap after GO; non-tappers maxed
const ACK_TIMEOUT_MS = 10000;  // roundEnd auto-advance
const FOUL_MS        = 3000;   // penalty for tapping before GO (jump-the-gun)
const MISS_MS        = 3000;   // penalty for not tapping within cutoff
const MAX_MS         = 3000;   // any single-round score is clamped to this max

/**
 * Reaction Tap — simultaneous reflex game. Players wait on a red screen; after a
 * server-chosen random delay the screen flips to green and the first tap records a
 * reaction time. Lowest cumulative reaction time across 5 rounds wins.
 *
 * State advances are timer-driven (the GO signal fires from setTimeout), so every
 * timer callback pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class ReactionTap extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'arming', 'go', 'roundEnd', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting:  { start: 'arming' },
        arming:   { fire: 'go' },
        go:       { endRound: 'roundEnd' },
        roundEnd: { nextRound: 'arming', finish: 'finished' },
      },
    });
    this.round = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.goTime = null;
    this.armDelayMs = 0;
    this.results = {};
    this.totals = {};
    this.roundHistory = [];
    this.acknowledged = new Set();
    this._armTimer = null;
    this._cutoffTimer = null;
    this._ackTimer = null;
    this._armStart = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.round = 0;
    this.results = {};
    this.totals = {};
    this.roundHistory = [];
    this.acknowledged = new Set();
    for (const p of this.players) this.totals[p] = 0;
    this.transition('start'); // -> onEnterArming
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterArming() {
    this.round++;
    this.results = {};
    this.acknowledged = new Set();
    this.goTime = null;
    this.armDelayMs = ARM_MIN_MS + Math.floor(Math.random() * (ARM_MAX_MS - ARM_MIN_MS));
    this._armStart = Date.now();
    this._clearTimers();
    this._armTimer = setTimeout(() => {
      if (this.state !== 'arming') return;
      this.transition('fire');   // -> onEnterGo
      this._emitChange();
    }, this.armDelayMs);
  }

  onEnterGo() {
    this.goTime = Date.now();
    if (this._armTimer) { clearTimeout(this._armTimer); this._armTimer = null; }
    this._cutoffTimer = setTimeout(() => {
      if (this.state !== 'go') return;
      this._endRound();
      this._emitChange();
    }, GO_CUTOFF_MS);
  }

  onEnterRoundEnd() {
    if (this._armTimer) { clearTimeout(this._armTimer); this._armTimer = null; }
    if (this._cutoffTimer) { clearTimeout(this._cutoffTimer); this._cutoffTimer = null; }
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'roundEnd') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceFromRoundEnd();
      this._emitChange();
    }, ACK_TIMEOUT_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'arming') {
      if (type === 'tap') {
        if (this.results[playerId] !== undefined) return; // one foul per round
        this.results[playerId] = { ms: FOUL_MS, foul: true, missed: false };
      } else if (type === 'ping') {
        if (this._armStart != null && Date.now() >= this._armStart + this.armDelayMs) {
          this.transition('fire');
        }
      }
    } else if (this.state === 'go') {
      if (type === 'tap') {
        if (this.results[playerId] !== undefined) return; // one tap per round
        const ms = Math.min(Date.now() - this.goTime, MAX_MS);
        this.results[playerId] = { ms, foul: false, missed: false };
        this._maybeEndRoundEarly();
      } else if (type === 'ping') {
        if (Date.now() >= this.goTime + GO_CUTOFF_MS) this._endRound();
      }
    } else if (this.state === 'roundEnd') {
      if (type === 'acknowledge' || type === 'tap') {
        this.acknowledged.add(playerId);
        if (this.players.every((p) => this.acknowledged.has(p))) this._advanceFromRoundEnd();
      }
    }
  }

  _maybeEndRoundEarly() {
    if (this.state !== 'go') return;
    if (this.players.every((p) => this.results[p] !== undefined)) this._endRound();
  }

  _endRound() {
    if (this.state !== 'go') return; // guard double-call
    this._clearTimers();
    for (const p of this.players) {
      if (this.results[p] === undefined) {
        this.results[p] = { ms: MISS_MS, foul: false, missed: true };
      }
      this.totals[p] = (this.totals[p] || 0) + this.results[p].ms;
    }
    this.roundHistory.push({ round: this.round, results: { ...this.results } });
    this.transition('endRound'); // -> onEnterRoundEnd
  }

  _advanceFromRoundEnd() {
    if (this.state !== 'roundEnd') return;
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
    if (this.round >= this.totalRounds) this.transition('finish');
    else this.transition('nextRound');
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.results[playerId];
    delete this.totals[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'go') {
      this._maybeEndRoundEarly();
    } else if (this.state === 'roundEnd') {
      if (this.players.every((p) => this.acknowledged.has(p))) this._advanceFromRoundEnd();
    }
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    for (const k of ['_armTimer', '_cutoffTimer', '_ackTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const revealing = this.state === 'roundEnd' || this.state === 'finished';
    const mine = this.results[playerId] || null;
    return {
      phase: this.state,
      round: this.round,
      totalRounds: this.totalRounds,
      goSignaled: this.state === 'go',
      goCutoffSec: GO_CUTOFF_MS / 1000,
      myResult: mine,
      hasActed: mine !== null,
      myTotalMs: this.totals[playerId] || 0,
      otherPlayers: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        hasActed: this.results[p] !== undefined,
        ms: revealing ? (this.results[p] ? this.results[p].ms : null) : null,
        foul: revealing ? !!(this.results[p] && this.results[p].foul) : false,
        missed: revealing ? !!(this.results[p] && this.results[p].missed) : false,
        totalMs: this.totals[p] || 0,
      })),
      roundResults: revealing
        ? this.players.map((p) => ({
            playerId: p,
            ms: this.results[p] ? this.results[p].ms : MAX_MS,
            foul: !!(this.results[p] && this.results[p].foul),
            missed: !!(this.results[p] && this.results[p].missed),
          })).sort((a, b) => a.ms - b.ms)
        : null,
      totals: { ...this.totals },
      acknowledged: [...(this.acknowledged || [])],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players.map((p) => ({
      playerId: p,
      totalMs: this.totals[p] || 0,
      fouls: this.roundHistory.filter((r) => r.results[p] && r.results[p].foul).length,
    }));
    entries.sort((a, b) => a.totalMs - b.totalMs); // ascending: fastest first
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.totalMs > entries[i - 1].totalMs) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        totalMs: e.totalMs,
        handDescription: `${(e.totalMs / 1000).toFixed(2)}s total`,
      };
    });
  }
}
