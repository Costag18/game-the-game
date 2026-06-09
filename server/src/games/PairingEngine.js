import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

/**
 * PairingEngine — reusable Swiss-style 1v1 tournament layer. Wraps N players in K
 * mini-rounds of simultaneous 1v1 matches (odd count → a bye = free win), re-pairs
 * by record between mini-rounds, and produces a full N-player ranking by
 * (wins → head-to-head → score differential). Consuming games (Connect 4, UTTT)
 * subclass this and only implement a tiny MatchEngine (one board); they never deal
 * with N-player ranking, byes, the barrier, timers, or leave handling.
 *
 * Server-authoritative: every move is routed only to that player's own match and
 * validated by the MatchEngine (whose turn, legal cell); a player can never act in
 * another pairing, move out of turn, or be credited a win they didn't earn.
 */
export class PairingEngine extends BaseGame {
  constructor(players, opts = {}) {
    super(players, {
      states: ['waiting', 'match', 'miniRoundSummary', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'match' },
        match: { summary: 'miniRoundSummary' },
        miniRoundSummary: { next: 'match', finish: 'finished' },
      },
    });
    if (typeof opts.matchFactory !== 'function') throw new Error('PairingEngine requires opts.matchFactory');
    this.matchFactory = opts.matchFactory;
    this._miniRoundsOpt = opts.miniRounds != null ? opts.miniRounds : 'auto';
    this.matchTimerSec = opts.matchTimerSec || TIMERS.CARD_GAME;
    this.matchHardCapSec = opts.matchHardCapSec || 90;
    this.title = opts.title || '1v1';

    this.totalMiniRounds = 0;
    this.miniRound = 0;
    this.wins = {};
    this.byes = {};
    this.diff = {};
    this.h2h = {};
    this._met = new Set();
    this.matches = [];
    this.playerMatch = {};
    this.acknowledged = new Set();
    this.lastMiniRound = null;
    this._matchTimers = {};
    this._hardCapTimers = {};
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  _resolveK(n) {
    if (this._miniRoundsOpt !== 'auto') return this._miniRoundsOpt;
    return Math.min(5, Math.max(3, Math.ceil(Math.log2(Math.max(2, n)))));
  }

  startGame() {
    for (const p of this.players) { this.wins[p] = 0; this.byes[p] = 0; this.diff[p] = 0; }
    this.totalMiniRounds = this._resolveK(this.players.length);
    this.transition('start'); // -> match
    this._buildMiniRound();
    this._armAllMatchTimers();
  }

  // ---------- pairing ----------
  _pairKey(a, b) { return [a, b].sort().join('|'); }
  _hasMet(a, b) { return this._met.has(this._pairKey(a, b)); }
  _recordH2H(a, b, winner) { this.h2h[this._pairKey(a, b)] = winner; }
  _h2hCompare(a, b) { const w = this.h2h[this._pairKey(a, b)]; return w === a ? -1 : (w === b ? 1 : 0); }

  _buildMiniRound() {
    this.miniRound++;
    let pool = [...this.players].sort((a, b) => (this.wins[b] - this.wins[a]) || (this.diff[b] - this.diff[a]) || (Math.random() - 0.5));
    this.matches = [];
    this.playerMatch = {};
    if (pool.length % 2 === 1) {
      let byeP = pool[0];
      for (const p of pool) {
        if (this.byes[p] < this.byes[byeP] || (this.byes[p] === this.byes[byeP] && this.wins[p] < this.wins[byeP])) byeP = p;
      }
      pool = pool.filter((p) => p !== byeP);
      this.byes[byeP]++; this.wins[byeP]++;
      this.matches.push({ p1: byeP, p2: null, isBye: true, over: true, winnerId: byeP, draw: false, engine: null, turnEndsAt: null });
      this.playerMatch[byeP] = this.matches.length - 1;
    }
    while (pool.length >= 2) {
      const p1 = pool.shift();
      let idx = pool.findIndex((c) => !this._hasMet(p1, c));
      if (idx === -1) idx = 0;
      const p2 = pool.splice(idx, 1)[0];
      this._pushMatch(p1, p2);
    }
  }

  _pushMatch(a, b) {
    const [first, second] = Math.random() < 0.5 ? [a, b] : [b, a];
    const engine = this.matchFactory(first, second);
    const mi = this.matches.length;
    this.matches.push({ p1: first, p2: second, engine, isBye: false, over: false, winnerId: null, draw: false, turnEndsAt: null });
    this.playerMatch[first] = mi;
    this.playerMatch[second] = mi;
    this._met.add(this._pairKey(a, b));
  }

  // ---------- timers ----------
  _armAllMatchTimers() {
    for (let mi = 0; mi < this.matches.length; mi++) {
      const m = this.matches[mi];
      if (m.isBye || m.over) continue;
      this._armTurnTimer(mi);
      this._armHardCap(mi);
    }
  }
  _armTurnTimer(mi) {
    const m = this.matches[mi];
    if (!m || m.over || m.isBye || !m.engine) return;
    if (this._matchTimers[mi]) clearTimeout(this._matchTimers[mi]);
    m.turnEndsAt = Date.now() + this.matchTimerSec * 1000;
    this._matchTimers[mi] = setTimeout(() => {
      if (this.state !== 'match' || m.over || !m.engine) return;
      // If the match offers an auto-move (e.g. Connect 4 drops a random legal column),
      // keep the match alive instead of forfeiting on a single slow turn.
      if (typeof m.engine.autoMove === 'function') {
        const auto = m.engine.autoMove();
        if (auto) {
          const turnPlayer = m.engine.getView(m.p1).turn;
          m.engine.applyMove(turnPlayer, auto);
          if (m.engine.isOver()) this._resolveMatch(mi);
          else this._armTurnTimer(mi);
          this._emitChange();
          return;
        }
      }
      const loser = m.engine.getView(m.p1).turn;
      this._forfeitMatch(mi, loser);
      this._emitChange();
    }, this.matchTimerSec * 1000);
  }
  _armHardCap(mi) {
    const m = this.matches[mi];
    if (!m || m.over || m.isBye || !m.engine) return;
    if (this._hardCapTimers[mi]) clearTimeout(this._hardCapTimers[mi]);
    this._hardCapTimers[mi] = setTimeout(() => {
      if (this.state !== 'match' || m.over || !m.engine) return;
      const loser = m.engine.getView(m.p1).turn;
      this._forfeitMatch(mi, loser);
      this._emitChange();
    }, this.matchHardCapSec * 1000);
  }
  _rearmTurnTimer(mi) { this._armTurnTimer(mi); }
  _clearMatchTimers(mi) {
    if (this._matchTimers[mi]) { clearTimeout(this._matchTimers[mi]); delete this._matchTimers[mi]; }
    if (this._hardCapTimers[mi]) { clearTimeout(this._hardCapTimers[mi]); delete this._hardCapTimers[mi]; }
  }
  _clearAllMatchTimers() {
    for (const k of Object.keys(this._matchTimers)) { clearTimeout(this._matchTimers[k]); }
    for (const k of Object.keys(this._hardCapTimers)) { clearTimeout(this._hardCapTimers[k]); }
    this._matchTimers = {};
    this._hardCapTimers = {};
  }
  _startAckTimer() {
    this._clearAckTimer();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'miniRoundSummary') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._checkSummaryComplete();
      this._emitChange();
    }, 10_000);
  }
  _clearAckTimer() { if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; } }

  // ---------- match resolution + barrier ----------
  _forfeitMatch(mi, loserId) {
    const m = this.matches[mi];
    if (!m || m.over) return;
    const winner = m.p1 === loserId ? m.p2 : m.p1;
    if (winner) { this.wins[winner]++; m.winnerId = winner; this._recordH2H(m.p1, m.p2, winner); }
    if (m.engine) { this.diff[m.p1] += m.engine.scoreDiff ? m.engine.scoreDiff(m.p1) : 0; this.diff[m.p2] += m.engine.scoreDiff ? m.engine.scoreDiff(m.p2) : 0; }
    m.over = true;
    this._clearMatchTimers(mi);
    if (this._allMatchesOver()) this._enterSummary();
  }

  _resolveMatch(mi) {
    const m = this.matches[mi];
    if (m.over) return;
    m.over = true;
    this._clearMatchTimers(mi);
    if (!m.isBye && m.engine) {
      const w = m.engine.winner();
      if (w) { this.wins[w]++; m.winnerId = w; this._recordH2H(m.p1, m.p2, w); }
      else { m.draw = true; this.wins[m.p1] += 0.5; this.wins[m.p2] += 0.5; }
      this.diff[m.p1] += m.engine.scoreDiff ? m.engine.scoreDiff(m.p1) : 0;
      this.diff[m.p2] += m.engine.scoreDiff ? m.engine.scoreDiff(m.p2) : 0;
    }
    if (this._allMatchesOver()) this._enterSummary();
  }

  _allMatchesOver() { return this.matches.every((m) => m.over); }

  _enterSummary() {
    if (this.state !== 'match') return;
    this.transition('summary');
    this.lastMiniRound = {
      pairings: this.matches.map((m) => ({ p1: m.p1, p2: m.p2, winnerId: m.winnerId != null ? m.winnerId : null, isBye: !!m.isBye, draw: !!m.draw })),
    };
    this.acknowledged = new Set();
    this._clearAllMatchTimers();
    for (const m of this.matches) { if (m.engine) { if (m.engine.destroy) m.engine.destroy(); m.engine = null; } }
    this._startAckTimer();
  }

  _checkSummaryComplete() {
    if (this.state !== 'miniRoundSummary') return;
    if (!this.players.every((p) => this.acknowledged.has(p))) return;
    this._clearAckTimer();
    if (this.miniRound >= this.totalMiniRounds) {
      this.transition('finish');
    } else {
      this.transition('next');
      this._buildMiniRound();
      this._armAllMatchTimers();
    }
  }

  // ---------- actions ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'match' && type === 'move') {
      const mi = this.playerMatch[playerId];
      if (mi === undefined) return;
      const m = this.matches[mi];
      if (!m || m.over || !m.engine) return;
      const accepted = m.engine.applyMove(playerId, action.move);
      if (!accepted) return;
      this._rearmTurnTimer(mi);
      if (m.engine.isOver()) this._resolveMatch(mi);
    } else if (this.state === 'miniRoundSummary' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkSummaryComplete();
    }
  }

  // ---------- leave ----------
  removePlayer(playerId) {
    super.removePlayer(playerId);
    const mi = this.playerMatch[playerId];
    if (mi !== undefined) {
      const m = this.matches[mi];
      if (m && !m.over && !m.isBye) {
        const opp = m.p1 === playerId ? m.p2 : m.p1;
        if (opp) { this.wins[opp]++; m.winnerId = opp; this._recordH2H(m.p1, m.p2, opp); }
        m.over = true;
        this._clearMatchTimers(mi);
      } else if (m && m.isBye) {
        m.over = true;
      }
    }
    delete this.playerMatch[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearAllMatchTimers();
      this._clearAckTimer();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'match' && this._allMatchesOver()) this._enterSummary();
    else if (this.state === 'miniRoundSummary') this._checkSummaryComplete();
  }

  destroy() {
    this._clearAllMatchTimers();
    this._clearAckTimer();
    for (const m of this.matches) if (m.engine && m.engine.destroy) m.engine.destroy();
    this._onStateChange = null;
  }

  // ---------- views ----------
  _standings() {
    return this.players
      .map((p) => ({ playerId: p, wins: this.wins[p] || 0, byes: this.byes[p] || 0, scoreDiff: this.diff[p] || 0 }))
      .sort((a, b) => (b.wins - a.wins) || (b.scoreDiff - a.scoreDiff))
      .map((e, i) => ({ ...e, rank: i + 1, eliminated: false, displayWins: e.wins }));
  }

  getStateForPlayer(playerId) {
    const mi = this.playerMatch[playerId];
    let myMatch = null;
    if (this.state === 'match' && mi !== undefined) {
      const m = this.matches[mi];
      if (m.isBye) {
        myMatch = { opponentId: null, isBye: true, over: true, result: 'win', board: null, turn: null, isMyTurn: false, turnEndsAt: null };
      } else {
        const view = m.engine ? m.engine.getView(playerId) : {};
        const opp = m.p1 === playerId ? m.p2 : m.p1;
        let result = null;
        if (m.over) result = m.draw ? 'draw' : (m.winnerId === playerId ? 'win' : 'loss');
        myMatch = {
          ...view,
          opponentId: opp,
          isBye: false,
          over: m.over,
          result,
          isMyTurn: !m.over && view.turn === playerId,
          turnEndsAt: m.over ? null : (m.turnEndsAt || null),
        };
      }
    }
    const waitingOn = [];
    for (const m of this.matches) if (!m.over) { if (m.p1) waitingOn.push(m.p1); if (m.p2) waitingOn.push(m.p2); }
    return {
      phase: this.state,
      title: this.title,
      miniRound: this.miniRound,
      totalMiniRounds: this.totalMiniRounds,
      myId: playerId,
      myMatch,
      standings: this._standings(),
      waitingOn,
      myMiniRoundDone: this.state === 'match' && (mi === undefined || this.matches[mi].over),
      acknowledged: this.state === 'miniRoundSummary' ? [...this.acknowledged] : [],
      lastMiniRound: this.state === 'miniRoundSummary' ? this.lastMiniRound : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players.map((p) => ({ playerId: p, wins: this.wins[p] || 0, byes: this.byes[p] || 0, scoreDiff: this.diff[p] || 0 }));
    entries.sort((a, b) => (b.wins - a.wins) || this._h2hCompare(a.playerId, b.playerId) || (b.scoreDiff - a.scoreDiff));
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && (e.wins < entries[i - 1].wins || (e.wins === entries[i - 1].wins && e.scoreDiff < entries[i - 1].scoreDiff))) placement = i + 1;
      return { ...e, placement, handDescription: `${e.wins} win${e.wins === 1 ? '' : 's'}` };
    });
  }
}
