import { BaseGame } from './BaseGame.js';

const LANES          = 5;          // lanes 0..4
const START_LANE     = 2;
const GAME_MS        = 30000;      // ~30s schedule horizon
const FALL_MS        = 2200;       // time an object is visible falling before it reaches the catch line
const SPAWN_GAP_MS   = 700;        // average gap between arrivals
const VISIBLE_AHEAD_MS = 2600;     // how far ahead (in arrival time) in-flight objects are exposed to clients

const VALUES = { coin: 10, gem: 25, bomb: -15 };

/**
 * Coin Cascade — real-time falling-objects lane catch. 5 lanes (0..4). At
 * startGame the SERVER pre-generates a SCHEDULE of falling objects over ~30s,
 * each { lane, kind:'coin'|'gem'|'bomb', arriveAt }. Every player has a basket
 * pinned to a lane (starts at lane 2) and sends {type:'move',lane} to slide it.
 *
 * The server arms a setTimeout at each object's arriveAt: for EVERY player, if
 * their basket lane === the object's lane it credits coin +10 / gem +25 /
 * bomb -15 (score floored at 0). It's a parallel race on ONE shared stream —
 * everyone catches from the same cascade. When the schedule is exhausted, finish.
 *
 * Server-authoritative: the basket lane is tracked server-side from move actions
 * and arrival resolution happens server-side at each object's arriveAt — a client
 * can NEVER report a catch. getStateForPlayer exposes only the in-flight objects
 * (between now and a few seconds out) with a lane + progress fraction, the
 * player's own basket lane, and scores — never a final catch claim. Every timer
 * callback pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class CoinCascade extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'active', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'active' },
        active: { finish: 'finished' },
      },
    });
    this.lanes = LANES;
    this.baskets = {};       // playerId -> lane
    this.scores = {};        // playerId -> points (floored at 0)
    this.schedule = [];      // [{ id, lane, kind, arriveAt }]
    this.lastCatch = {};     // playerId -> { id, kind, value, arriveAt } (most recent resolution, for UI pops)
    this.startAt = null;
    this.endAt = null;
    this._objectTimers = []; // arrival timers
    this._endTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.baskets = {};
    this.scores = {};
    this.lastCatch = {};
    for (const p of this.players) { this.baskets[p] = START_LANE; this.scores[p] = 0; }
    this._buildSchedule();
    this.transition('start'); // -> onEnterActive
  }

  _buildSchedule() {
    this.schedule = [];
    let seq = 0;
    // Arrival times measured from startGame; the catch line is FALL_MS after spawn,
    // so the first object lands a little after the game starts (gives players a beat).
    let t = FALL_MS * 0.5;
    while (t < GAME_MS) {
      const roll = Math.random();
      const kind = roll < 0.15 ? 'bomb' : roll < 0.40 ? 'gem' : 'coin';
      this.schedule.push({
        id: `o${seq++}`,
        lane: Math.floor(Math.random() * LANES),
        kind,
        arriveAt: Math.round(t),
      });
      // jittered gap so the cascade feels organic (0.5x..1.5x the mean gap)
      t += SPAWN_GAP_MS * (0.5 + Math.random());
    }
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterActive() {
    this.startAt = Date.now();
    this.endAt = this.startAt + GAME_MS;
    this._clearTimers();
    for (const obj of this.schedule) {
      const delay = Math.max(0, obj.arriveAt);
      const timer = setTimeout(() => this._resolveArrival(obj), delay);
      this._objectTimers.push(timer);
    }
    // Hard end a hair after the last arrival in case the schedule is empty/sparse.
    const lastArrive = this.schedule.length ? this.schedule[this.schedule.length - 1].arriveAt : 0;
    const endDelay = Math.max(GAME_MS, lastArrive + 200);
    this.endAt = this.startAt + endDelay;
    this._endTimer = setTimeout(() => {
      if (this.state !== 'active') return;
      this.transition('finish');
      this._emitChange();
    }, endDelay);
  }

  onEnterFinished() { this._clearTimers(); }

  // --- arrival resolution (server-authoritative scoring) ---------------------

  _resolveArrival(obj) {
    if (this.state !== 'active') return;
    const value = VALUES[obj.kind] || 0;
    for (const p of this.players) {
      if (this.baskets[p] === obj.lane) {
        const next = (this.scores[p] || 0) + value;
        this.scores[p] = Math.max(0, next); // floor at 0
        this.lastCatch[p] = { id: obj.id, kind: obj.kind, value, arriveAt: obj.arriveAt };
      }
    }
    obj.resolved = true;
    this._emitChange();
  }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (type === 'ping') { this._emitChange(); return; } // harmless re-broadcast nudge

    if (this.state !== 'active') return;

    if (type === 'move') {
      let lane = Number(action.lane);
      if (!Number.isFinite(lane)) return;
      lane = Math.max(0, Math.min(LANES - 1, Math.floor(lane))); // clamp 0..4, server-tracked
      this.baskets[playerId] = lane;
      // No broadcast needed per move — arrivals drive the broadcast cadence and
      // the client animates its own basket optimistically.
    }
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.baskets[playerId];
    delete this.scores[playerId];
    delete this.lastCatch[playerId];

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
    }
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    for (const t of this._objectTimers) clearTimeout(t);
    this._objectTimers = [];
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const now = Date.now();
    const elapsed = this.startAt != null ? now - this.startAt : 0;

    // In-flight: objects whose arrival is between now and VISIBLE_AHEAD_MS out
    // (i.e. currently falling toward the catch line). progress 0 = just spawned,
    // 1 = at the catch line. Resolved/past objects are not sent.
    const inFlight = this.state === 'active'
      ? this.schedule
          .filter((o) => !o.resolved && o.arriveAt > elapsed && o.arriveAt - elapsed <= VISIBLE_AHEAD_MS + 0)
          .map((o) => {
            const remaining = o.arriveAt - elapsed; // ms until it lands
            const progress = Math.max(0, Math.min(1, 1 - remaining / VISIBLE_AHEAD_MS));
            return { id: o.id, lane: o.lane, kind: o.kind, progress };
          })
      : [];

    const scoreboard = this.players
      .map((p) => ({ playerId: p, score: this.scores[p] || 0 }))
      .sort((a, b) => b.score - a.score);

    return {
      phase: this.state,
      myId: playerId,
      lanes: this.lanes,
      myLane: this.baskets[playerId] ?? START_LANE,
      myScore: this.scores[playerId] || 0,
      myLastCatch: this.lastCatch[playerId] || null,
      objects: inFlight,
      scoreboard,
      timeLeftMs: this.endAt ? Math.max(0, this.endAt - now) : null,
      serverTime: now,
      totalPlayers: this.players.length,
      // NOTE: the full schedule / future objects / arriveAt thresholds are NEVER
      // exposed — only the currently in-flight visible window above.
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players
      .map((p) => ({ playerId: p, score: this.scores[p] || 0 }))
      .sort((a, b) => b.score - a.score); // descending: most points first

    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.score < entries[i - 1].score) placement = i + 1; // ties share a placement
      return {
        playerId: e.playerId,
        placement,
        score: e.score,
        handDescription: `${e.score} coins`,
      };
    });
  }
}
