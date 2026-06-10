import { BaseGame } from './BaseGame.js';

const ROUND_MS = 25_000;        // total length of the pop-up schedule
const FIRST_SPAWN_MS = 700;     // delay before the first pop-up
const LAST_SPAWN_MS = 23_500;   // no new pop-ups after this point
const LIFE_MIN_MS = 800;        // a target lives 0.8–1.4s
const LIFE_MAX_MS = 1400;
const GAP_MIN_MS = 380;         // gap between scheduled spawns
const GAP_MAX_MS = 820;
const PHARAOH_POINTS = 100;
const MUMMY_POINTS = -60;
const GRID = 9;                 // 3x3

/**
 * Whack-a-Pharaoh — real-time whack-a-mole on a shared 3x3 grid. At startGame the
 * SERVER pre-generates the entire pop-up SCHEDULE (cell, kind, spawnAt, despawnAt)
 * and arms a setTimeout for each spawn/despawn that toggles the live occupant of a
 * cell and broadcasts via _emitChange().
 *
 * Server-authoritative anti-cheat:
 *   - The FUTURE schedule is NEVER sent — getStateForPlayer exposes only the cells
 *     that are CURRENTLY live (+ kind), plus per-player whacked ids + scores.
 *   - A {type:'whack', cell} is VALID only if a target is live in that cell at
 *     server time AND this player hasn't already whacked THIS occupant instance.
 *     A tap on an empty/expired cell (or a re-tap of the same occupant) scores 0.
 *   - Pharaoh -> +100, mummy -> -60, each score floored at 0. Every player races
 *     the SAME shared pop-ups independently. Ranking by score DESC, ties shared.
 */
export class WhackAPharaoh extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'active', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'active' },
        active: { finish: 'finished' },
      },
    });
    this.scores = {};
    this.whacked = {};        // playerId -> Set of occupant ids already whacked
    this.hits = {};           // playerId -> { pharaohs, mummies }
    this.live = {};           // cell index -> { occId, kind, spawnAt, despawnAt } | undefined
    this.schedule = [];       // full pre-generated plan (server-only)
    this.roundStartAt = null;
    this.roundEndAt = null;
    this._timers = [];        // every armed spawn/despawn/round timer
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.scores = {};
    this.whacked = {};
    this.hits = {};
    this.live = {};
    for (const p of this.players) {
      this.scores[p] = 0;
      this.whacked[p] = new Set();
      this.hits[p] = { pharaohs: 0, mummies: 0 };
    }
    this.schedule = this._buildSchedule();
    this.transition('start'); // -> onEnterActive
  }

  // Pre-generate the whole 25s plan up front (server-only). Targets may overlap
  // across different cells, but never two live in the SAME cell at once.
  _buildSchedule() {
    const cellFreeUntil = new Array(GRID).fill(0);
    const sched = [];
    let occSeq = 0;
    let t = FIRST_SPAWN_MS;
    while (t <= LAST_SPAWN_MS) {
      // pick a cell that's free at time t (try a few, else skip this beat)
      let cell = -1;
      for (let tries = 0; tries < 6; tries++) {
        const c = Math.floor(Math.random() * GRID);
        if (cellFreeUntil[c] <= t) { cell = c; break; }
      }
      if (cell >= 0) {
        const life = LIFE_MIN_MS + Math.floor(Math.random() * (LIFE_MAX_MS - LIFE_MIN_MS));
        const despawnAt = Math.min(t + life, ROUND_MS);
        // ~28% are mummies (whack at your peril)
        const kind = Math.random() < 0.28 ? 'mummy' : 'pharaoh';
        sched.push({ occId: `o${occSeq++}`, cell, kind, spawnAt: t, despawnAt });
        cellFreeUntil[cell] = despawnAt + 60; // tiny buffer so a cell doesn't double-pop
      }
      t += GAP_MIN_MS + Math.floor(Math.random() * (GAP_MAX_MS - GAP_MIN_MS));
    }
    return sched;
  }

  onEnterActive() {
    this.roundStartAt = Date.now();
    this.roundEndAt = this.roundStartAt + ROUND_MS;
    this._clearTimers();

    for (const entry of this.schedule) {
      this._arm(entry.spawnAt, () => {
        if (this.state !== 'active') return;
        this.live[entry.cell] = {
          occId: entry.occId, kind: entry.kind,
          spawnAt: this.roundStartAt + entry.spawnAt,
          despawnAt: this.roundStartAt + entry.despawnAt,
        };
        this._emitChange();
      });
      this._arm(entry.despawnAt, () => {
        if (this.state !== 'active') return;
        const cur = this.live[entry.cell];
        if (cur && cur.occId === entry.occId) delete this.live[entry.cell];
        this._emitChange();
      });
    }

    // schedule exhausted → finish
    this._arm(ROUND_MS, () => {
      if (this.state !== 'active') return;
      this.live = {};
      this.transition('finish');
      this._emitChange();
    });
  }

  onEnterFinished() { this._clearTimers(); }

  _arm(offsetMs, fn) {
    const id = setTimeout(fn, offsetMs);
    this._timers.push(id);
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (type === 'ping') { this._emitChange(); return; }
    if (this.state !== 'active') return;
    if (type !== 'whack') return;

    const cell = action.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell >= GRID) return;

    const occ = this.live[cell];
    if (!occ) return; // empty/expired cell — nothing to whack, scores nothing

    const set = this.whacked[playerId];
    if (set.has(occ.occId)) return; // already whacked THIS occupant — no double dip

    set.add(occ.occId);
    if (occ.kind === 'pharaoh') {
      this.scores[playerId] += PHARAOH_POINTS;
      this.hits[playerId].pharaohs++;
    } else {
      this.scores[playerId] += MUMMY_POINTS;
      this.hits[playerId].mummies++;
    }
    if (this.scores[playerId] < 0) this.scores[playerId] = 0; // floor at 0
    this._emitChange();
  }

  // ---------- LEAVE / TEARDOWN ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.scores[playerId];
    delete this.whacked[playerId];
    delete this.hits[playerId];

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') { this.live = {}; this.state = 'finished'; }
      this._emitChange();
    }
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers = [];
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const now = Date.now();
    // ONLY currently-live cells leak out (the future schedule never does).
    const cells = new Array(GRID).fill(null);
    if (this.state === 'active') {
      for (const [cellStr, occ] of Object.entries(this.live)) {
        if (!occ) continue;
        const cell = Number(cellStr);
        cells[cell] = {
          occId: occ.occId,
          kind: occ.kind,
          whacked: this.whacked[playerId] ? this.whacked[playerId].has(occ.occId) : false,
          despawnAt: occ.despawnAt,
        };
      }
    }
    return {
      phase: this.state,
      myId: playerId,
      cells,
      myScore: this.scores[playerId] || 0,
      myHits: this.hits[playerId] || { pharaohs: 0, mummies: 0 },
      pharaohPoints: PHARAOH_POINTS,
      mummyPoints: MUMMY_POINTS,
      timeLeftMs: this.roundEndAt ? Math.max(0, this.roundEndAt - now) : null,
      roundEndAt: this.roundEndAt,
      serverTime: now,
      scoreboard: this.players
        .map((p) => ({ playerId: p, score: this.scores[p] || 0 }))
        .sort((a, b) => b.score - a.score),
      totalPlayers: this.players.length,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = this.players
      .map((p) => ({
        playerId: p,
        score: this.scores[p] || 0,
        pharaohs: this.hits[p] ? this.hits[p].pharaohs : 0,
        mummies: this.hits[p] ? this.hits[p].mummies : 0,
      }))
      .sort((a, b) => b.score - a.score);
    let placement = 1;
    return sorted.map((s, i) => {
      if (i > 0 && s.score < sorted[i - 1].score) placement = i + 1;
      return {
        playerId: s.playerId,
        placement,
        score: s.score,
        pharaohs: s.pharaohs,
        mummies: s.mummies,
        handDescription: `${s.score} pts · ${s.pharaohs}🪙${s.mummies > 0 ? ` ${s.mummies}💀` : ''}`,
      };
    });
  }
}
