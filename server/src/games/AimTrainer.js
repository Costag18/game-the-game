import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const AIM_ROUND_MS = TIMERS.AIM * 1000; // ~25s

/**
 * Aim Trainer Duel — simultaneous, single fixed-duration round. Each player gets
 * their OWN private server-spawned target stream; hit it, the server credits a
 * hit and spawns the next. Server-authoritative (a client can only ever hit the
 * id currently alive for them). Ranks by hits, accuracy breaks ties.
 */
export class AimTrainer extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'active', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'active' },
        active: { finish: 'finished' },
      },
    });
    this.hits = {};
    this.clicks = {};
    this.current = {};
    this._seq = {};
    this.roundStartAt = null;
    this.roundEndAt = null;
    this._roundTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.hits = {};
    this.clicks = {};
    this.current = {};
    this._seq = {};
    for (const p of this.players) { this.hits[p] = 0; this.clicks[p] = 0; }
    if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
    this.transition('start'); // -> onEnterActive
  }

  onEnterActive() {
    this.roundStartAt = Date.now();
    this.roundEndAt = this.roundStartAt + AIM_ROUND_MS;
    for (const p of this.players) this._spawnTarget(p);
    this._startRoundTimer();
  }

  onEnterFinished() {
    if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
  }

  _spawnTarget(playerId) {
    this._seq[playerId] = (this._seq[playerId] || 0) + 1;
    const r = 0.04 + Math.random() * 0.06; // 0.04..0.10
    const x = r + Math.random() * (1 - 2 * r);
    const y = r + Math.random() * (1 - 2 * r);
    this.current[playerId] = { id: `${playerId.slice(0, 4)}-${this._seq[playerId]}`, x, y, r, spawnAt: Date.now() };
  }

  _startRoundTimer() {
    if (this._roundTimer) clearTimeout(this._roundTimer);
    this._roundTimer = setTimeout(() => {
      if (this.state !== 'active') return;
      this.transition('finish');
      this._emitChange();
    }, AIM_ROUND_MS);
  }

  handleAction(playerId, action) {
    if (this.state !== 'active') return;
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (type === 'shoot') {
      this.clicks[playerId] = (this.clicks[playerId] || 0) + 1;
      const cur = this.current[playerId];
      if (cur && action.targetId === cur.id) {
        this.hits[playerId] = (this.hits[playerId] || 0) + 1;
        this._spawnTarget(playerId); // immediately gives the next target
      }
      // else: stale/forged id — click counted, no hit, no respawn (anti-cheat)
    } else if (type === 'miss') {
      this.clicks[playerId] = (this.clicks[playerId] || 0) + 1;
    }
  }

  removePlayer(playerId) {
    super.removePlayer(playerId);
    delete this.hits[playerId];
    delete this.clicks[playerId];
    delete this.current[playerId];
    delete this._seq[playerId];

    if (this.players.length <= 1) {
      if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
      if (this.state !== 'finished') this.state = 'finished';
    }
  }

  destroy() {
    if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
    this._onStateChange = null;
  }

  getStateForPlayer(playerId) {
    const now = Date.now();
    return {
      phase: this.state,
      myId: playerId,
      target: this.state === 'active' ? this.current[playerId] : null,
      myHits: this.hits[playerId] || 0,
      myClicks: this.clicks[playerId] || 0,
      myAccuracy: (this.clicks[playerId] || 0) > 0 ? (this.hits[playerId] || 0) / this.clicks[playerId] : 0,
      timeLeftMs: this.roundEndAt ? Math.max(0, this.roundEndAt - now) : null,
      roundEndAt: this.roundEndAt,
      serverTime: now,
      scoreboard: this.players
        .map((p) => ({ playerId: p, hits: this.hits[p] || 0 }))
        .sort((a, b) => b.hits - a.hits),
      totalPlayers: this.players.length,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const rank = (p) => ({
      playerId: p,
      hits: this.hits[p] || 0,
      clicks: this.clicks[p] || 0,
      accuracy: (this.clicks[p] || 0) > 0 ? (this.hits[p] || 0) / this.clicks[p] : 0,
    });
    const sorted = this.players.map(rank).sort((a, b) => (b.hits - a.hits) || (b.accuracy - a.accuracy));
    let placement = 1;
    return sorted.map((s, i) => {
      if (i > 0) {
        const prev = sorted[i - 1];
        const tied = s.hits === prev.hits && s.accuracy === prev.accuracy;
        if (!tied) placement = i + 1;
      }
      return {
        playerId: s.playerId,
        placement,
        hits: s.hits,
        clicks: s.clicks,
        accuracy: Math.round(s.accuracy * 100),
        handDescription: `${s.hits} hits · ${Math.round(s.accuracy * 100)}%`,
      };
    });
  }
}
