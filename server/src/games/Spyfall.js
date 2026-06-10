import { BaseGame } from './BaseGame.js';
import { pickLocation, SPYFALL_LOCATIONS, shuffle } from '../utils/deductionBank.js';

const POINTS_SPY = 1000;
const POINTS_GROUP = 500;

const REVEAL_MS = 30_000;     // role-card ack window
const VOTING_MS = 90_000;     // discussion + secret vote window
const SPY_GUESS_MS = 25_000;  // spy picks a location
const FINISHED_REVEAL_MS = 15_000; // results auto-advance (orchestration also acks)

/**
 * Spyfall — hidden-role social deduction. One SPY hides among players who all
 * share a secret location; everyone but the spy also holds a distinct role.
 *
 * Anti-cheat (server-authoritative — the #1 rule):
 *  - The secret assignment (who is the spy, the location, each role) lives ONLY
 *    in this FSM. getStateForPlayer(pid) returns ONLY pid's own card:
 *      • the SPY gets location:null + isSpy:true + the full public locationOptions
 *        list — the real location is NEVER in the spy's payload.
 *      • a NON-spy gets the location + their own role, isSpy:false, and NEVER the
 *        spy's id nor anyone else's role.
 *  - Secret votes are private: only my own vote + an aggregate votedCount cross
 *    the wire mid-phase; the per-target tally and who-voted-for-whom appear only
 *    at the 'finished' reveal.
 *  - The list of all possible locations is public to EVERYONE (standard Spyfall).
 *  - Every timer callback pairs with `_emitChange()` per the v2.7.0 broadcast
 *    contract; barriers complete when all present players act OR the timer fires.
 */
export class Spyfall extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'reveal', 'voting', 'spyGuess', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'reveal' },
        reveal: { vote: 'voting', finish: 'finished' },
        voting: { guess: 'spyGuess', finish: 'finished' },
        spyGuess: { score: 'finished', finish: 'finished' },
      },
    });
    this.scores = {};
    this.location = null;        // secret — never sent to the spy
    this.roles = {};             // playerId -> role string (non-spies only)
    this.spyId = null;           // secret — never sent to non-spies pre-reveal
    this.locationOptions = SPYFALL_LOCATIONS.map((l) => l.location); // public

    this.ready = new Set();      // reveal acks
    this.votes = {};             // voterId -> suspectId (secret until finished)
    this.deadline = null;        // epoch-ms for the active phase timer

    this.accusedId = null;       // most-voted (or null on tie / no votes)
    this.spyCaught = false;
    this.spyGuess = null;        // location name the spy submitted (or null)
    this.spyGuessedRight = false;
    this.spyWins = false;
    this.outcome = null;         // populated at finished for the reveal screen

    this._revealTimer = null;
    this._voteTimer = null;
    this._guessTimer = null;
    this._finishTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this._assignRoles();
    this.transition('start'); // -> onEnterReveal
  }

  _assignRoles() {
    const picked = pickLocation();
    this.location = picked.location;
    const roster = shuffle(this.players);
    this.spyId = roster[0];                 // exactly one spy
    const roleDeck = shuffle(picked.roles); // distinct roles, cycled if short
    let ri = 0;
    this.roles = {};
    for (const p of roster) {
      if (p === this.spyId) continue;
      this.roles[p] = roleDeck[ri % roleDeck.length];
      ri++;
    }
  }

  // ---------- REVEAL (private role cards + Ready) ----------
  onEnterReveal() {
    this.ready = new Set();
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      this._toVoting();
      this._emitChange();
    }, REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.ready.has(p))) this._toVoting();
  }

  _toVoting() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    this.transition('vote'); // -> onEnterVoting
  }

  // ---------- VOTING (discussion + secret vote for one suspect) ----------
  onEnterVoting() {
    this.votes = {};
    this._clearTimers();
    this.deadline = Date.now() + VOTING_MS;
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'voting') return;
      // timeout: players who never voted simply abstain (no auto-vote)
      this._toSpyGuess();
      this._emitChange();
    }, VOTING_MS);
  }

  _checkVoteComplete() {
    if (this.state !== 'voting') return;
    if (this.players.every((p) => this.votes[p] !== undefined)) this._toSpyGuess();
  }

  _tallyAccused() {
    const tally = {};
    for (const target of Object.values(this.votes)) {
      if (this.players.includes(target)) tally[target] = (tally[target] || 0) + 1;
    }
    let max = 0;
    for (const t of Object.keys(tally)) if (tally[t] > max) max = tally[t];
    const top = Object.keys(tally).filter((t) => tally[t] === max);
    // most-voted; a tie (or no votes) => no one caught
    this.accusedId = (max > 0 && top.length === 1) ? top[0] : null;
    this.spyCaught = this.accusedId === this.spyId;
    return tally;
  }

  // ---------- SPY GUESS ----------
  _toSpyGuess() {
    if (this.state !== 'voting') return;
    this._tallyAccused();
    this._clearTimers();
    // if the spy already left, there's nothing to guess — score immediately
    if (!this.players.includes(this.spyId)) { this.transition('score'); return; }
    this.transition('guess'); // -> onEnterSpyGuess
  }

  onEnterSpyGuess() {
    this._clearTimers();
    this.deadline = Date.now() + SPY_GUESS_MS;
    this._guessTimer = setTimeout(() => {
      if (this.state !== 'spyGuess') return;
      this._resolve(); // no guess submitted => wrong
      this._emitChange();
    }, SPY_GUESS_MS);
  }

  _resolve() {
    if (this.state !== 'spyGuess') return;
    this._clearTimers();
    this.transition('score'); // -> onEnterFinished
  }

  // ---------- FINISHED / SCORE ----------
  onEnterFinished() {
    this._clearTimers();
    // Guard against double-scoring if we somehow re-enter.
    if (this.outcome) { this.deadline = null; return; }

    this.spyGuessedRight = this.spyGuess != null
      && String(this.spyGuess).toLowerCase() === String(this.location || '').toLowerCase();
    // Spy wins if NOT caught OR guessed the location right.
    this.spyWins = (!this.spyCaught) || this.spyGuessedRight;

    const spyPresent = this.players.includes(this.spyId);
    if (this.spyWins && spyPresent) {
      this.scores[this.spyId] = (this.scores[this.spyId] || 0) + POINTS_SPY;
    } else if (!this.spyWins) {
      // group wins: every NON-spy present scores
      for (const p of this.players) {
        if (p === this.spyId) continue;
        this.scores[p] = (this.scores[p] || 0) + POINTS_GROUP;
      }
    }

    this.outcome = {
      location: this.location,
      spyId: this.spyId,
      roles: { ...this.roles },
      accusedId: this.accusedId,
      spyCaught: this.spyCaught,
      spyGuess: this.spyGuess,
      spyGuessedRight: this.spyGuessedRight,
      spyWins: this.spyWins,
      votes: { ...this.votes },
      scores: { ...this.scores },
    };

    this.deadline = Date.now() + FINISHED_REVEAL_MS;
    this._finishTimer = setTimeout(() => {
      this._clearTimers();
      this._emitChange();
    }, FINISHED_REVEAL_MS);
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'reveal' && type === 'ready') {
      this.ready.add(playerId);
      this._checkRevealComplete();
    } else if (this.state === 'voting' && type === 'castVote') {
      if (this.votes[playerId] !== undefined) return; // one vote per round
      const target = action.suspectId;
      if (target === playerId) return;                // cannot vote yourself
      if (!this.players.includes(target)) return;     // must be a present player
      this.votes[playerId] = target;
      this._checkVoteComplete();
    } else if (this.state === 'spyGuess' && type === 'guessLocation') {
      if (playerId !== this.spyId) return;            // only the spy may guess
      const loc = action.location;
      if (!this.locationOptions.includes(loc)) return;
      this.spyGuess = loc;
      this._resolve();
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearTimers() {
    for (const k of ['_revealTimer', '_voteTimer', '_guessTimer', '_finishTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    const wasSpy = playerId === this.spyId;
    super.removePlayer(playerId); // prunes this.players + activePlayers rotation
    this.ready.delete(playerId);
    delete this.votes[playerId];   // drop their pending obligation
    delete this.scores[playerId];  // stop scoring the leaver
    delete this.roles[playerId];

    if (this.state === 'finished') { this._emitChange(); return; }

    if (this.players.length <= 1) {
      this._clearTimers();
      // collapse: resolve sensibly so we never deadlock. If the spy is gone,
      // the group has effectively caught them; otherwise just end.
      if (wasSpy) this.spyCaught = true;
      this.state = 'finished';
      this.onEnterFinished();
      this._emitChange();
      return;
    }

    if (wasSpy && (this.state === 'reveal' || this.state === 'voting' || this.state === 'spyGuess')) {
      // the spy bailed — treat as caught and end the round immediately
      this._clearTimers();
      this.spyCaught = true;
      this.spyId = null;
      this.state = 'finished';
      this.onEnterFinished();
      this._emitChange();
      return;
    }

    // re-check the active barrier off the leaver
    if (this.state === 'reveal') this._checkRevealComplete();
    else if (this.state === 'voting') this._checkVoteComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const finished = this.state === 'finished';
    const isSpy = playerId === this.spyId;
    return {
      phase: this.state,
      myId: playerId,
      players: [...this.players],
      scores: { ...this.scores },
      playerCount: this.players.length,
      deadline: this.deadline,

      // ---- PRIVATE ROLE CARD (only this player's own secret) ----
      isSpy,
      // the spy NEVER receives the real location; non-spies do
      location: isSpy ? null : this.location,
      myRole: isSpy ? null : (this.roles[playerId] || null),
      // public to everyone — the master list of possible locations
      locationOptions: this.locationOptions,

      // ---- REVEAL barrier ----
      ready: this.state === 'reveal' ? [...this.ready] : [],
      iReady: this.ready.has(playerId),

      // ---- VOTING (only my own vote + aggregate count cross the wire) ----
      myVote: this.votes[playerId] != null ? this.votes[playerId] : null,
      hasVoted: this.votes[playerId] !== undefined,
      votedCount: Object.keys(this.votes).length,

      // ---- SPY GUESS ----
      iAmGuessing: this.state === 'spyGuess' && isSpy,
      spyGuessSubmitted: this.spyGuess != null,

      // ---- FINISHED: full disclosure ----
      outcome: finished ? this.outcome : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Rank all present players by points DESC; ties share a placement (dense over
    // the sorted list). Every present player appears exactly once. Hidden-role
    // scoring naturally produces ties (the whole group shares 500) — that's fine.
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      const sc = this.scores[playerId] || 0;
      const role = playerId === this.spyId ? 'Spy' : (this.roles[playerId] || 'Agent');
      return {
        playerId,
        placement,
        score: sc,
        wasSpy: playerId === this.spyId,
        handDescription: `${role} — ${sc} pts`,
      };
    });
  }
}
