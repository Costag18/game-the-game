import { BaseGame } from './BaseGame.js';
import { pickMostLikely } from '../utils/partyBank.js';

const TOTAL_ROUNDS = 4;
const RANK_MS = 45_000;       // time to submit a full ranking
const REVEAL_MS = 12_000;     // reveal acknowledge auto-advance

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Superlative Showdown — each round shows a "Most likely to ___" superlative and
 * every player privately submits a FULL RANKING of all players (most → least).
 * REVEAL computes Borda points: in each voter's ranking, a player at position p
 * (0 = top) earns (N-1-p) points; summed across voters this round, then accumulated
 * across all rounds. The final consensus ordering by total Borda points IS the
 * placement.
 *
 * Anti-cheat: individual rankings are PRIVATE until reveal — getStateForPlayer
 * never exposes another player's ranking, nor any tallies, before reveal. Only
 * aggregate "how many have ranked" counts leak mid-phase. A ranking is validated
 * server-side: it must be a permutation of exactly the present players.
 */
export class SuperlativeShowdown extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'ranking', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'ranking' },
        ranking: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'ranking', finish: 'finished' },
      },
    });
    this.scores = {};            // cumulative Borda points
    this.totalRounds = TOTAL_ROUNDS;
    this.roundIndex = -1;
    this.prompts = pickMostLikely(TOTAL_ROUNDS); // picked ONCE for the whole game
    this.prompt = null;
    this.rankings = {};          // playerId -> ordered [playerId] (private)
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = 0;
    this._rankTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterRanking
  }

  // ---------- RANKING ----------
  onEnterRanking() {
    this.roundIndex++;
    this.prompt = this.prompts[this.roundIndex % this.prompts.length];
    this.rankings = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + RANK_MS;
    this._rankTimer = setTimeout(() => {
      if (this.state !== 'ranking') return;
      for (const p of this.players) {
        if (this.rankings[p] === undefined) this.rankings[p] = this._autoRanking(p);
      }
      this._toReveal();
      this._emitChange();
    }, RANK_MS);
  }

  // A random full ranking of the present players (auto-fill for a no-submit).
  _autoRanking() { return shuffle(this.players); }

  // A ranking is valid iff it's a permutation of EXACTLY the present players.
  _isValidRanking(order) {
    if (!Array.isArray(order)) return false;
    if (order.length !== this.players.length) return false;
    const seen = new Set();
    for (const pid of order) {
      if (!this.players.includes(pid)) return false;
      if (seen.has(pid)) return false;
      seen.add(pid);
    }
    return seen.size === this.players.length;
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'ranking') return;
    this._clearAllTimers();
    this.transition('reveal'); // -> onEnterReveal
  }
  onEnterReveal() {
    const N = this.players.length;
    // Borda tally for THIS round.
    const roundPoints = {};
    for (const p of this.players) roundPoints[p] = 0;
    for (const voter of this.players) {
      const order = this.rankings[voter];
      if (!Array.isArray(order)) continue;
      for (let p = 0; p < order.length; p++) {
        const target = order[p];
        if (roundPoints[target] === undefined) continue; // ignore stray ids
        roundPoints[target] += (N - 1 - p);
      }
    }
    for (const p of this.players) this.scores[p] = (this.scores[p] || 0) + roundPoints[p];

    // Consensus order for THIS round (by round points desc), ties share a rank.
    const consensus = [...this.players].sort((a, b) => roundPoints[b] - roundPoints[a]);
    let rank = 1;
    const consensusRows = consensus.map((pid, i) => {
      if (i > 0 && roundPoints[pid] < roundPoints[consensus[i - 1]]) rank = i + 1;
      return { playerId: pid, rank, roundPoints: roundPoints[pid], total: this.scores[pid] };
    });

    this.revealData = {
      prompt: this.prompt,
      roundPoints,
      consensus: consensusRows,
      // Full per-voter rankings only become visible at reveal (anti-cheat).
      rankings: Object.fromEntries(this.players.map((p) => [p, this.rankings[p] || null])),
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }
  _advance() {
    if (this.state !== 'reveal') return;
    this._clearAllTimers();
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterRanking
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'ranking' && type === 'submitRanking') {
      if (this.rankings[playerId] !== undefined) return;
      if (!this._isValidRanking(action.order)) return;
      this.rankings[playerId] = [...action.order];
      this._checkRankComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkRankComplete() {
    if (this.state !== 'ranking') return;
    if (this.players.every((p) => this.rankings[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearAllTimers() {
    for (const k of ['_rankTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    delete this.rankings[playerId];
    delete this.scores[playerId];
    // A leaver's id must vanish from everyone's pending ranking, otherwise those
    // rankings are no longer valid permutations of the present players. Drop any
    // already-submitted ranking that referenced the gone player so it gets
    // auto-refilled (or scored as-is, filtered) — simplest is to clear & re-fill.
    for (const p of this.players) {
      const order = this.rankings[p];
      if (Array.isArray(order) && order.includes(playerId)) {
        this.rankings[p] = order.filter((id) => id !== playerId);
      }
    }

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'ranking') this._checkRankComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    return {
      phase: this.state,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      superlative: this.prompt || '',
      scores: { ...this.scores },
      players: [...this.players],
      myId: playerId,
      // Only MY own ranking is ever echoed back pre-reveal — never anyone else's.
      myRanking: this.rankings[playerId] != null ? [...this.rankings[playerId]] : null,
      hasSubmitted: this.rankings[playerId] !== undefined,
      submittedCount: Object.keys(this.rankings).length,
      playerCount: this.players.length,
      deadline: this.state === 'ranking' ? this.deadline : 0,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: (this.state === 'reveal' || this.state === 'finished') ? this.revealData : null,
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
        handDescription: `${this.scores[playerId] || 0} consensus pts`,
      };
    });
  }
}
