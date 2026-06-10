import { BaseGame } from './BaseGame.js';

const FUSE_MIN_MS = 6000;   // server-random fuse 6..14s
const FUSE_MAX_MS = 14000;
const ACK_MS      = 10000;  // gameOver auto-advance (parity with house games)

/**
 * Hot Potato Relay — real-time pass-the-bomb elimination (Spoons-shaped).
 *
 * Server-authoritative anti-cheat: the fuse duration is chosen on the SERVER with
 * Math.random and a setTimeout (the test clock controls both), and is NEVER sent to
 * any client — the entire tension is not knowing when it blows. When the fuse fires,
 * whoever HOLDS the token at that instant (server state, not a client claim) is
 * eliminated; if >1 survivor remains a fresh hidden fuse arms and the token continues
 * from the next survivor in the seat ring. A {type:'pass'} from a NON-holder is
 * ignored. Ranking is REVERSE-ELIMINATION: last survivor 1st, then later-out = better;
 * same-tick co-eliminations (simultaneous leaves) share a placement.
 */
export class HotPotatoRelay extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'live', 'gameOver', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting:  { start: 'live' },
        live:     { over: 'gameOver', finish: 'finished' },
        gameOver: { done: 'finished' },
      },
    });
    this.survivors = [...players];
    // eliminationOrder is an array of "tiers"; each tier is an array of playerIds
    // eliminated at the same tick (co-eliminations) so they can share a placement.
    this.eliminationTiers = [];
    this.holder = null;
    this.passCount = 0;        // number of passes since this fuse armed (telemetry only)
    this.fuseId = 0;           // increments each arm so a stale timer can't double-fire
    this.lastBlast = null;     // { eliminated, holderWas } for the most recent pop
    this.acknowledged = new Set();
    this._fuseTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    // Random starting holder.
    this.holder = this.survivors[Math.floor(Math.random() * this.survivors.length)];
    this.transition('start'); // -> onEnterLive
  }

  // ---------- LIVE ----------
  onEnterLive() {
    this.lastBlast = null;
    this._armFuse();
    this._emitChange();
  }

  _armFuse() {
    this._clearTimer('_fuseTimer');
    this.passCount = 0;
    const myFuse = ++this.fuseId;
    const ms = FUSE_MIN_MS + Math.floor(Math.random() * (FUSE_MAX_MS - FUSE_MIN_MS));
    this._fuseTimer = setTimeout(() => {
      if (this.state !== 'live' || myFuse !== this.fuseId) return;
      this._explode();
      this._emitChange();
    }, ms);
  }

  _nextSurvivor(pid) {
    const i = this.survivors.indexOf(pid);
    if (i < 0) return this.survivors[0] || null;
    return this.survivors[(i + 1) % this.survivors.length];
  }

  // Whoever holds the bomb when the fuse fires is out.
  _explode() {
    if (this.state !== 'live') return;
    const victim = this.holder;
    this._clearTimer('_fuseTimer');
    this._eliminate([victim]);
    this.lastBlast = { eliminated: victim, holderWas: victim };

    if (this.survivors.length <= 1) {
      this._toGameOver();
      return;
    }
    // Token continues from the next survivor after the victim (seat ring order),
    // and a fresh HIDDEN fuse arms.
    this.holder = this._nextSurvivor(victim);
    this._armFuse();
  }

  // Eliminate a tier of players (1+ at the same tick) — they SHARE a placement.
  _eliminate(pids) {
    const tier = [];
    for (const pid of pids) {
      if (pid == null) continue;
      if (this.survivors.includes(pid)) {
        this.survivors = this.survivors.filter((p) => p !== pid);
        this._removeFromActive(pid); // out of rotation, STAYS in this.players for scoring
        tier.push(pid);
      }
    }
    if (tier.length) this.eliminationTiers.push(tier);
  }

  // ---------- GAME OVER ----------
  _toGameOver() {
    if (this.state !== 'live') return;
    this._clearTimer('_fuseTimer');
    this.holder = null;
    this.transition('over'); // -> onEnterGameOver
  }
  onEnterGameOver() {
    this.acknowledged = new Set();
    this._clearTimer('_ackTimer');
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'gameOver') return;
      for (const p of this.survivors) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, ACK_MS);
  }
  _checkGameOverComplete() {
    if (this.state !== 'gameOver') return;
    if (!this.survivors.every((p) => this.acknowledged.has(p))) return;
    this._advance();
  }
  _advance() {
    if (this.state !== 'gameOver') return;
    this._clearTimer('_ackTimer');
    this.transition('done'); // -> onEnterFinished
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    const type = action && action.type;
    if (type === 'pass') {
      this._handlePass(playerId);
    } else if (type === 'acknowledge') {
      if (this.state !== 'gameOver') return;
      if (!this.survivors.includes(playerId)) return;
      this.acknowledged.add(playerId);
      this._checkGameOverComplete();
      this._emitChange();
    } else if (type === 'ping') {
      this._emitChange(); // harmless re-broadcast nudge
    }
  }

  _handlePass(playerId) {
    if (this.state !== 'live') return;
    if (playerId !== this.holder) return;        // only the holder can pass — non-holder ignored
    if (this.survivors.length <= 1) return;
    this.holder = this._nextSurvivor(playerId);  // token moves to next survivor; fuse keeps ticking
    this.passCount++;
    this._emitChange();
  }

  // ---------- TIMERS ----------
  _clearTimer(name) { if (this[name]) { clearTimeout(this[name]); this[name] = null; } }
  _clearTimers() { this._clearTimer('_fuseTimer'); this._clearTimer('_ackTimer'); }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    const wasSurvivor = this.survivors.includes(playerId);
    const wasHolder = this.holder === playerId;
    super.removePlayer(playerId); // prunes this.players + activePlayers rotation
    this.acknowledged.delete(playerId);
    // Prune the leaver from every elimination tier so results never include a ghost.
    this.eliminationTiers = this.eliminationTiers
      .map((tier) => tier.filter((p) => p !== playerId))
      .filter((tier) => tier.length > 0);

    if (!wasSurvivor) { this._emitChange(); return; }

    // The leaver simply drops out of the ring (they are NOT scored as an
    // elimination — they're pruned from results entirely).
    const nextHolder = wasHolder ? this._nextSurvivor(playerId) : this.holder;
    this.survivors = this.survivors.filter((p) => p !== playerId);

    if (this.survivors.length <= 1) {
      this._clearTimers();
      this.holder = null;
      if (this.state !== 'finished') this.state = 'finished';
      this._emitChange();
      return;
    }

    if (this.state === 'live') {
      // Hand the fuse off the leaver so the bomb keeps ticking on a present player.
      if (wasHolder) this.holder = (nextHolder && nextHolder !== playerId) ? nextHolder : this.survivors[0];
    } else if (this.state === 'gameOver') {
      this._checkGameOverComplete();
    }
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const phase = this.state;
    return {
      phase,
      myId: playerId,
      iAmSurvivor: this.survivors.includes(playerId),
      iHoldIt: this.holder === playerId,
      holder: this.holder,                       // who holds the bomb now (visible)
      survivorCount: this.survivors.length,
      totalPlayers: this.players.length,
      // Seat ring: who is in, who is out, who currently holds — NO fuse info.
      seats: this.players.map((p) => ({
        playerId: p,
        isMe: p === playerId,
        isSurvivor: this.survivors.includes(p),
        holdsIt: this.holder === p,
      })),
      lastBlast: (phase === 'live' || phase === 'gameOver' || phase === 'finished') ? this.lastBlast : null,
      acknowledged: phase === 'gameOver' ? [...this.acknowledged] : [],
      winner: (phase === 'gameOver' || phase === 'finished') ? (this.survivors[0] || null) : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Reverse-elimination: winner first, then later-eliminated tiers rank better
    // than earlier ones. Each tier shares a placement.
    const winner = this.survivors[0] || null;
    const ranked = []; // array of tiers, best first
    if (winner != null) ranked.push([winner]);
    for (let i = this.eliminationTiers.length - 1; i >= 0; i--) {
      const tier = this.eliminationTiers[i].filter((p) => this.players.includes(p));
      if (tier.length) ranked.push(tier);
    }
    // Any player somehow unranked (shouldn't happen) lands last.
    const seen = new Set(ranked.flat());
    const leftover = this.players.filter((p) => !seen.has(p));
    if (leftover.length) ranked.push(leftover);

    const out = [];
    let placement = 1;
    for (const tier of ranked) {
      for (const pid of tier) {
        out.push({
          playerId: pid,
          placement,
          survivedToEnd: pid === winner,
          handDescription: pid === winner ? 'Last one standing 💣' : `Blew up (place ${placement})`,
        });
      }
      placement += tier.length; // tie members share `placement`; next tier skips ahead
    }
    return out;
  }
}
