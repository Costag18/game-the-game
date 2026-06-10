import { BaseGame } from './BaseGame.js';

const TOTAL_ROUNDS = 3;
const FRONTS = 5;
const TOKENS = 20;
const BID_MS = 30_000;      // simultaneous deploy window
const REVEAL_MS = 10_000;   // per-round reveal ack window

// Front i is worth (i+1)*10 points (10, 20, 30, 40, 50).
function frontPrizes() {
  return Array.from({ length: FRONTS }, (_, i) => (i + 1) * 10);
}

/**
 * Token Tussle — Colonel Blotto over 3 rounds. Each round every player
 * SIMULTANEOUSLY and PRIVATELY deploys exactly up to 20 tokens across 5 fronts.
 * The server owns ALL allocations: it validates each deployment against the
 * 20-token bankroll (non-negative ints, sum ≤ 20 — clamped server-side) and the
 * distribution lives ONLY in the FSM. No player's allocation is ever sent to
 * anyone (including the prizes-already-known fronts are public, the tokens are
 * not) until the round RESOLVES. For each front the player committing the MOST
 * tokens wins its prize; a tie splits the prize evenly among the top bidders.
 * After 3 rounds, rank by total score DESC, ties share a placement.
 */
export class TokenTussle extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'deploy', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'deploy' },
        deploy: { resolve: 'reveal', finish: 'finished' },
        reveal: { next: 'deploy', finish: 'finished' },
      },
    });
    this.totalRounds = TOTAL_ROUNDS;
    this.roundNumber = 0;
    this.scores = {};
    this.fronts = frontPrizes();
    this.allocations = {};   // pid -> int[5] (PRIVATE until reveal)
    this.submitted = {};     // pid -> true once locked in
    this.revealData = null;  // built at resolve; safe to expose
    this.acknowledged = new Set();
    this.deadline = null;    // epoch-ms for the active timer (stable countdown)
    this._deployTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterDeploy
  }

  // ---------- DEPLOY ----------
  onEnterDeploy() {
    this.roundNumber++;
    this.fronts = frontPrizes();
    this.allocations = {};
    this.submitted = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + BID_MS;
    this._deployTimer = setTimeout(() => {
      if (this.state !== 'deploy') return;
      // Timeout default: an even split of all 20 tokens across the 5 fronts.
      for (const p of this.players) {
        if (!this.submitted[p]) {
          this.allocations[p] = this._evenSplit();
          this.submitted[p] = true;
        }
      }
      this._resolve();
      this._emitChange();
    }, BID_MS);
  }

  _evenSplit() {
    const base = Math.floor(TOKENS / FRONTS); // 4
    const alloc = Array.from({ length: FRONTS }, () => base);
    let rem = TOKENS - base * FRONTS;          // 0 here, but stays correct if consts change
    for (let i = 0; rem > 0; i = (i + 1) % FRONTS, rem--) alloc[i]++;
    return alloc;
  }

  // Validate + clamp a raw client distribution into 5 non-negative ints summing ≤ 20.
  _sanitize(raw) {
    if (!Array.isArray(raw)) return null;
    const alloc = new Array(FRONTS).fill(0);
    let sum = 0;
    for (let i = 0; i < FRONTS; i++) {
      let v = Math.floor(Number(raw[i]));
      if (!Number.isFinite(v) || v < 0) v = 0;
      // clamp this front so the running total never exceeds the bankroll
      const room = TOKENS - sum;
      if (v > room) v = room;
      alloc[i] = v;
      sum += v;
    }
    return alloc; // sum is guaranteed ≤ 20 (over-bankroll bids are clamped, never rejected outright)
  }

  // ---------- RESOLVE ----------
  _resolve() {
    if (this.state !== 'deploy') return;
    this._clearTimers();
    // Fill any still-missing allocation (e.g. a leaver edge) with an even split.
    for (const p of this.players) {
      if (!this.allocations[p]) { this.allocations[p] = this._evenSplit(); this.submitted[p] = true; }
    }

    const frontResults = [];
    const gainedThisRound = {};
    for (const p of this.players) gainedThisRound[p] = 0;

    for (let f = 0; f < FRONTS; f++) {
      const prize = this.fronts[f];
      let topTokens = -1;
      for (const p of this.players) {
        const t = this.allocations[p][f];
        if (t > topTokens) topTokens = t;
      }
      // Top bidders share the prize. A front where everyone played 0 tokens is
      // contested at 0 → split among ALL (still awards; "most" of nothing = everyone ties).
      const winners = this.players.filter((p) => this.allocations[p][f] === topTokens);
      const share = winners.length ? prize / winners.length : 0;
      for (const p of winners) gainedThisRound[p] += share;
      frontResults.push({ front: f, prize, topTokens, winners: [...winners], share });
    }

    for (const p of this.players) this.scores[p] = (this.scores[p] || 0) + gainedThisRound[p];

    this.revealData = {
      roundNumber: this.roundNumber,
      fronts: this.fronts.map((prize, f) => ({
        front: f,
        prize,
        topTokens: frontResults[f].topTokens,
        winners: frontResults[f].winners,
        share: frontResults[f].share,
      })),
      // distributions are SAFE to expose now that the round is resolved
      allocations: this.players.map((p) => ({ playerId: p, tokens: [...this.allocations[p]] })),
      gained: { ...gainedThisRound },
    };

    this.acknowledged = new Set();
    this.transition('resolve'); // -> onEnterReveal
  }

  onEnterReveal() {
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.roundNumber >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterDeploy
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'deploy' && type === 'deploy') {
      if (this.submitted[playerId]) return; // locked in — one submission per round
      const alloc = this._sanitize(action.tokens);
      if (!alloc) return;
      this.allocations[playerId] = alloc;
      this.submitted[playerId] = true;
      this._checkDeployComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkDeployComplete() {
    if (this.state !== 'deploy') return;
    if (this.players.every((p) => this.submitted[p])) { this._resolve(); }
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearTimers() {
    for (const k of ['_deployTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.allocations[playerId];
    delete this.submitted[playerId];
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    // Re-check the active barrier so the leaver isn't waited on.
    if (this.state === 'deploy') this._checkDeployComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const isReveal = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      myId: playerId,
      tokensPerRound: TOKENS,
      fronts: this.fronts.map((prize, f) => ({ front: f, prize })),
      scores: { ...this.scores },
      // YOUR OWN allocation/lock state only — opponents' tokens stay hidden.
      myTokens: this.allocations[playerId] ? [...this.allocations[playerId]] : null,
      hasSubmitted: !!this.submitted[playerId],
      submittedCount: this.players.filter((p) => this.submitted[p]).length,
      playerCount: this.players.length,
      deadline: (this.state === 'deploy' || this.state === 'reveal') ? this.deadline : null,
      // reveal payload (all distributions) is ONLY present once resolved
      reveal: isReveal ? this.revealData : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
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
        handDescription: `${this.scores[playerId] || 0} pts captured`,
      };
    });
  }
}
