import { BaseGame } from './BaseGame.js';

const DARTS_PER_PLAYER = 5;
const MAX_R = 100;             // logical max radius of the reticle (server units)
const BASE_PERIOD_MS = 2000;   // full in→out→in oscillation period for dart #1
const PERIOD_STEP_MS = 280;    // each thrown dart shortens the next reticle's period
const MIN_PERIOD_MS = 700;     // floor so it never becomes impossibly fast
const THROW_WINDOW_MS = 20000; // a player has ~20s to throw all 5; remainder auto-miss
const ACK_TIMEOUT_MS = 10000;  // finished-reveal auto-advance (defensive)

// Ring score table — outer-edge fraction of MAX_R -> points. First match wins.
// bullseye (<10%) +100, then 75 / 50 / 25 / 5 outward.
const RINGS = [
  { maxFrac: 0.10, points: 100, label: 'BULLSEYE' },
  { maxFrac: 0.30, points: 75,  label: 'INNER' },
  { maxFrac: 0.55, points: 50,  label: 'MID' },
  { maxFrac: 0.80, points: 25,  label: 'OUTER' },
  { maxFrac: 1.01, points: 5,   label: 'EDGE' },
];

/**
 * Bullseye Drop — timing-precision darts, SIMULTANEOUS, 5 darts each.
 *
 * The server defines a reticle whose radius oscillates 0..MAX_R via a triangle
 * wave with a per-player period that SHORTENS after every throw (faster = harder).
 * A player sends {type:'release'} while they have darts left; the server reads the
 * reticle radius at the release's SERVER time (handleAction runs serially) and
 * scores by ring. The client is told only the animation PARAMETERS (period, maxR,
 * cycleStart) so it can render the same sweep locally for feel — but the SCORE is
 * always recomputed server-side, so a client can never claim a hit it didn't earn.
 *
 * Anti-cheat: there is no hidden info to leak (the reticle is visible by design),
 * but the score is NEVER trusted from the client. Every timer (per-player throw
 * window, finished ack) pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class BullseyeDrop extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'throwing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting:  { start: 'throwing' },
        throwing: { finish: 'finished' },
      },
    });
    this.scores = {};          // playerId -> cumulative points
    this.dartsLeft = {};       // playerId -> darts remaining
    this.throws = {};          // playerId -> [{dart, radius, points, label, missed}]
    this.cycleStart = {};      // playerId -> server time the CURRENT reticle cycle began
    this.period = {};          // playerId -> current oscillation period (ms)
    this.acknowledged = new Set();
    this._windowTimers = {};   // playerId -> per-player throw-window timer id
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.scores = {};
    this.dartsLeft = {};
    this.throws = {};
    this.cycleStart = {};
    this.period = {};
    this.acknowledged = new Set();
    for (const p of this.players) {
      this.scores[p] = 0;
      this.dartsLeft[p] = DARTS_PER_PLAYER;
      this.throws[p] = [];
      this.period[p] = BASE_PERIOD_MS;
    }
    this.transition('start'); // -> onEnterThrowing
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterThrowing() {
    const now = Date.now();
    for (const p of this.players) {
      this.cycleStart[p] = now;
      // each player gets their own ~20s window to throw all darts
      this._armWindow(p, now);
    }
  }

  onEnterFinished() {
    this._clearWindowTimers();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'finished') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._emitChange();
    }, ACK_TIMEOUT_MS);
  }

  // --- timing math -----------------------------------------------------------

  /**
   * Triangle-wave radius for a player at a given absolute server time.
   * Goes 0 -> MAX_R -> 0 over `period`, deterministic from this.cycleStart[p].
   */
  _radiusAt(playerId, atMs) {
    const period = this.period[playerId] || BASE_PERIOD_MS;
    const start = this.cycleStart[playerId] != null ? this.cycleStart[playerId] : atMs;
    const elapsed = ((atMs - start) % period + period) % period; // 0..period
    const half = period / 2;
    const frac = elapsed < half ? (elapsed / half) : (1 - (elapsed - half) / half); // 0..1..0
    return frac * MAX_R;
  }

  _scoreRing(radius) {
    const frac = radius / MAX_R;
    for (const ring of RINGS) {
      if (frac < ring.maxFrac) return ring;
    }
    return RINGS[RINGS.length - 1];
  }

  _armWindow(playerId, fromMs) {
    if (this._windowTimers[playerId]) clearTimeout(this._windowTimers[playerId]);
    this._windowTimers[playerId] = setTimeout(() => {
      delete this._windowTimers[playerId];
      if (this.state !== 'throwing') return;
      if (!this.players.includes(playerId)) return;
      this._autoMiss(playerId);
      this._maybeFinish();
      this._emitChange();
    }, THROW_WINDOW_MS - (Date.now() - fromMs));
  }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (type === 'ping') return; // harmless re-broadcast nudge

    if (this.state === 'throwing' && type === 'release') {
      if ((this.dartsLeft[playerId] || 0) <= 0) return; // no darts left — ignore
      const now = Date.now();
      const radius = this._radiusAt(playerId, now);
      const ring = this._scoreRing(radius);
      this.scores[playerId] = (this.scores[playerId] || 0) + ring.points;
      this.dartsLeft[playerId] -= 1;
      const dartNo = DARTS_PER_PLAYER - this.dartsLeft[playerId];
      this.throws[playerId].push({
        dart: dartNo,
        radius: Math.round(radius * 10) / 10,
        points: ring.points,
        label: ring.label,
        missed: false,
      });
      // speed up this player's NEXT reticle and restart their cycle cleanly
      this.period[playerId] = Math.max(MIN_PERIOD_MS, (this.period[playerId] || BASE_PERIOD_MS) - PERIOD_STEP_MS);
      this.cycleStart[playerId] = now;
      if (this.dartsLeft[playerId] <= 0 && this._windowTimers[playerId]) {
        clearTimeout(this._windowTimers[playerId]);
        delete this._windowTimers[playerId];
      }
      this._maybeFinish();
      return;
    }

    if (this.state === 'finished' && (type === 'acknowledge' || type === 'release')) {
      this.acknowledged.add(playerId);
    }
  }

  _autoMiss(playerId) {
    while ((this.dartsLeft[playerId] || 0) > 0) {
      this.dartsLeft[playerId] -= 1;
      const dartNo = DARTS_PER_PLAYER - this.dartsLeft[playerId];
      this.throws[playerId].push({ dart: dartNo, radius: null, points: 0, label: 'MISS', missed: true });
    }
  }

  _maybeFinish() {
    if (this.state !== 'throwing') return;
    const allDone = this.players.every((p) => (this.dartsLeft[p] || 0) <= 0);
    if (allDone) {
      this._clearWindowTimers();
      this.transition('finish'); // -> onEnterFinished
    }
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    if (this._windowTimers[playerId]) { clearTimeout(this._windowTimers[playerId]); delete this._windowTimers[playerId]; }
    delete this.scores[playerId];
    delete this.dartsLeft[playerId];
    delete this.throws[playerId];
    delete this.cycleStart[playerId];
    delete this.period[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearWindowTimers();
      if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'throwing') {
      this._maybeFinish(); // the leaver no longer blocks the "everyone done" barrier
    }
  }

  destroy() {
    this._clearWindowTimers();
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
    this._onStateChange = null;
  }

  _clearWindowTimers() {
    for (const id of Object.keys(this._windowTimers)) {
      clearTimeout(this._windowTimers[id]);
    }
    this._windowTimers = {};
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const now = Date.now();
    const scoreboard = this.players
      .map((p) => ({ playerId: p, score: this.scores[p] || 0, dartsLeft: this.dartsLeft[p] || 0 }))
      .sort((a, b) => b.score - a.score);

    return {
      phase: this.state,
      myId: playerId,
      maxR: MAX_R,
      rings: RINGS.map((r) => ({ maxFrac: r.maxFrac, points: r.points, label: r.label })),
      // animation params so the client can render the SAME sweep locally:
      reticle: this.state === 'throwing'
        ? { cycleStart: this.cycleStart[playerId] || now, period: this.period[playerId] || BASE_PERIOD_MS }
        : null,
      serverTime: now,
      dartsPerPlayer: DARTS_PER_PLAYER,
      myDartsLeft: this.dartsLeft[playerId] || 0,
      myScore: this.scores[playerId] || 0,
      myThrows: this.throws[playerId] || [],
      scoreboard,
      acknowledged: [...(this.acknowledged || [])],
      totalPlayers: this.players.length,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players.map((p) => ({
      playerId: p,
      score: this.scores[p] || 0,
      bullseyes: (this.throws[p] || []).filter((t) => t.label === 'BULLSEYE').length,
    }));
    entries.sort((a, b) => b.score - a.score); // highest total first
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.score < entries[i - 1].score) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        score: e.score,
        bullseyes: e.bullseyes,
        handDescription: `${e.score} pts · ${e.bullseyes} bullseye${e.bullseyes === 1 ? '' : 's'}`,
      };
    });
  }
}
