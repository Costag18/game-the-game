import { BaseGame } from './BaseGame.js';
import { pickMostLikely } from '../utils/partyBank.js';

const TOTAL_ROUNDS = 5;
const POINTS_PER_VOTE = 100;
const VOTE_MS = 25_000;   // window to secretly vote for one player each round
const REVEAL_MS = 8_000;  // reveal auto-advance to next round / finish

/**
 * Most Likely To — vote-only party game. Each round shows "Who is most likely to
 * ___?" and EVERY present player secretly votes for ONE player (voting for
 * yourself IS allowed). On reveal the per-player tally is disclosed; a player
 * earns +100 for every vote they RECEIVED that round, cumulative across 5 rounds.
 * Nobody is eliminated.
 *
 * Anti-cheat (server-authoritative): individual votes are SECRET — who voted for
 * whom never crosses the wire (getStateForPlayer exposes only my own vote + an
 * aggregate "voted count") until reveal, when only the per-player tallies (not
 * the voter identities) are disclosed. State advances are timer-driven, so every
 * timer callback pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class MostLikelyTo extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'voting', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'voting' },
        voting: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'voting', finish: 'finished' },
      },
    });
    this.prompts = [];
    this.roundIndex = -1;
    this.totalRounds = TOTAL_ROUNDS;
    this.scores = {};          // playerId -> cumulative votes received (×100)
    this.votes = {};           // voterId -> targetId (this round only)
    this.lastReveal = null;    // { prompt, tally:{pid:count}, winners:[], round }
    this.acknowledged = new Set();
    this.deadline = null;      // epoch-ms for the active phase timer
    this._voteTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.prompts = pickMostLikely(this.totalRounds);
    this.totalRounds = this.prompts.length;
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterVoting
  }

  get currentPrompt() {
    return this.prompts[this.roundIndex] != null ? this.prompts[this.roundIndex] : null;
  }

  // ---------- VOTING ----------
  onEnterVoting() {
    this.roundIndex++;
    this.votes = {};
    this.lastReveal = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + VOTE_MS;
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'voting') return;
      // timeout: auto-vote for a random valid target so the barrier completes
      for (const p of this.players) if (this.votes[p] === undefined) this._autoVote(p);
      this._toReveal();
      this._emitChange();
    }, VOTE_MS);
  }

  _autoVote(p) {
    // any present player is a valid target (self-vote allowed)
    if (this.players.length) this.votes[p] = this.players[Math.floor(Math.random() * this.players.length)];
  }

  _checkVoteComplete() {
    if (this.state !== 'voting') return;
    if (this.players.every((p) => this.votes[p] !== undefined)) this._toReveal();
  }

  // ---------- REVEAL ----------
  _toReveal() {
    if (this.state !== 'voting') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  onEnterReveal() {
    const tally = {};
    for (const p of this.players) tally[p] = 0;
    // count only votes whose target is still a present player
    for (const target of Object.values(this.votes)) {
      if (tally[target] !== undefined) tally[target] += 1;
    }
    let max = 0;
    for (const p of this.players) if (tally[p] > max) max = tally[p];
    const winners = max > 0 ? this.players.filter((p) => tally[p] === max) : [];
    for (const p of this.players) this.scores[p] = (this.scores[p] || 0) + tally[p] * POINTS_PER_VOTE;

    this.lastReveal = {
      prompt: this.currentPrompt,
      round: this.roundIndex + 1,
      tally: { ...tally },
      winners: [...winners],
      pointsPerVote: POINTS_PER_VOTE,
    };
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterVoting
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'voting' && type === 'castVote') {
      if (this.votes[playerId] !== undefined) return; // one vote per round
      const target = action.targetId;
      if (!this.players.includes(target)) return; // must be a present player (self allowed)
      this.votes[playerId] = target;
      this._checkVoteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearTimers() {
    for (const k of ['_voteTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers rotation
    delete this.votes[playerId];  // drop their pending obligation
    this.acknowledged.delete(playerId);
    delete this.scores[playerId]; // stop scoring the leaver

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'voting') this._checkVoteComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      prompt: this.currentPrompt,
      // roster the client renders as the vote grid (present players only)
      players: [...this.players],
      scores: { ...this.scores },
      // only MY OWN vote is ever exposed pre-reveal — never who others picked
      myVote: this.votes[playerId] != null ? this.votes[playerId] : null,
      hasVoted: this.votes[playerId] !== undefined,
      votedCount: Object.keys(this.votes).length,
      playerCount: this.players.length,
      deadline: (this.state === 'voting' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      // per-player tally + winners disclosed ONLY at reveal/finished (no voter ids)
      reveal: revealing ? this.lastReveal : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Rank all present players by cumulative votes received DESC. Ties share a
    // placement (dense over the sorted list). Every player appears exactly once.
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      const votesReceived = Math.round((this.scores[playerId] || 0) / POINTS_PER_VOTE);
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        votesReceived,
        handDescription: `${votesReceived} vote${votesReceived === 1 ? '' : 's'} received`,
      };
    });
  }
}
