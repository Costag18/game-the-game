import { BaseGame } from './BaseGame.js';
import { pickGrid } from '../utils/deductionBank.js';

const POINTS_CHAMELEON = 1000;
const POINTS_CREW = 500;
const REVEAL_MS = 25_000;
const CLUES_MS = 45_000;
const VOTING_MS = 40_000;
const GUESS_MS = 20_000;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Chameleon Clues — hidden-role social deduction. Everyone shares a secret word
 * on a 4x4 grid except the CHAMELEON, who only sees the theme + grid and must
 * blend in. Each player gives a one-word clue, then votes on who the chameleon
 * is; the chameleon then guesses the secret word.
 *
 * Anti-cheat (server-authoritative — the #1 rule):
 *  - The role assignment (who is the chameleon) and the secret targetIndex live
 *    ONLY in the FSM. getStateForPlayer(chameleon) returns the grid + theme but
 *    targetIndex/targetWord NULL — the chameleon NEVER receives the secret word.
 *  - getStateForPlayer(nonChameleon) returns the target word but NEVER discloses
 *    who the chameleon is until 'finished'.
 *  - Clues are private until the clue barrier completes (then PUBLIC to all).
 *  - The chameleon's secret guess is private until 'finished'.
 *  - Individual votes are secret pre-reveal (only an aggregate count exposed).
 *  - Every timer callback pairs with `_emitChange()` per the v2.7.0 broadcast
 *    contract; barriers complete when every present player acts OR on timeout.
 */
export class ChameleonClues extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'reveal', 'clues', 'voting', 'chameleonGuess', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'reveal' },
        reveal: { clues: 'clues', finish: 'finished' },
        clues: { vote: 'voting', finish: 'finished' },
        voting: { guess: 'chameleonGuess', finish: 'finished' },
        chameleonGuess: { reveal: 'finished', finish: 'finished' },
      },
    });
    this.theme = '';
    this.grid = [];           // 16 words
    this.targetIndex = -1;    // secret word cell (0-15)
    this.chameleon = null;    // secret chameleon playerId
    this.scores = {};

    this.ready = new Set();   // reveal acks
    this.clues = {};          // playerId -> one-word clue (private until clue barrier)
    this.votes = {};          // voterId -> targetPlayerId (secret pre-reveal)
    this.chameleonGuess = null; // chosen grid index (private until finished)

    this.accused = null;      // most-voted player (set at end of voting)
    this.outcome = null;      // { caught, guessedRight, chameleonWon } at finished
    this.deadline = null;

    this._revealTimer = null;
    this._cluesTimer = null;
    this._votingTimer = null;
    this._guessTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    const g = pickGrid();
    this.theme = g.theme;
    this.grid = [...g.words];
    this.targetIndex = Math.floor(Math.random() * this.grid.length);
    this.chameleon = this.players[Math.floor(Math.random() * this.players.length)];
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterReveal
  }

  // ---------- REVEAL (private role card + ready) ----------
  onEnterReveal() {
    this.ready = new Set();
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      this._toClues();
      this._emitChange();
    }, REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.ready.has(p))) this._toClues();
  }

  _toClues() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    this.transition('clues'); // -> onEnterClues
  }

  // ---------- CLUES (simultaneous one-word submit) ----------
  onEnterClues() {
    this.clues = {};
    this._clearTimers();
    this.deadline = Date.now() + CLUES_MS;
    this._cluesTimer = setTimeout(() => {
      if (this.state !== 'clues') return;
      for (const p of this.players) if (this.clues[p] === undefined) this.clues[p] = '...';
      this._toVoting();
      this._emitChange();
    }, CLUES_MS);
  }

  _checkCluesComplete() {
    if (this.state !== 'clues') return;
    if (this.players.every((p) => this.clues[p] !== undefined)) this._toVoting();
  }

  _toVoting() {
    if (this.state !== 'clues') return;
    this._clearTimers();
    this.transition('vote'); // -> onEnterVoting
  }

  // ---------- VOTING (secret vote for the chameleon, not yourself) ----------
  onEnterVoting() {
    this.votes = {};
    this._clearTimers();
    this.deadline = Date.now() + VOTING_MS;
    this._votingTimer = setTimeout(() => {
      if (this.state !== 'voting') return;
      for (const p of this.players) if (this.votes[p] === undefined) this._autoVote(p);
      this._toGuess();
      this._emitChange();
    }, VOTING_MS);
  }

  _autoVote(p) {
    const choices = this.players.filter((x) => x !== p);
    if (choices.length) this.votes[p] = choices[Math.floor(Math.random() * choices.length)];
  }

  _checkVotingComplete() {
    if (this.state !== 'voting') return;
    if (this.players.every((p) => this.votes[p] !== undefined)) this._toGuess();
  }

  _tallyAccused() {
    const tally = {};
    for (const t of Object.values(this.votes)) {
      if (this.players.includes(t)) tally[t] = (tally[t] || 0) + 1;
    }
    let max = 0;
    for (const p of Object.keys(tally)) if (tally[p] > max) max = tally[p];
    const top = Object.keys(tally).filter((p) => tally[p] === max);
    // tie (or no votes) -> not caught (no single accused)
    return { accused: max > 0 && top.length === 1 ? top[0] : null, tally };
  }

  _toGuess() {
    if (this.state !== 'voting') return;
    const { accused } = this._tallyAccused();
    this.accused = accused;
    this._clearTimers();
    this.transition('guess'); // -> onEnterChameleonGuess
  }

  // ---------- CHAMELEON GUESS (private cell pick) ----------
  onEnterChameleonGuess() {
    this.chameleonGuess = null;
    this._clearTimers();
    // If the chameleon has already left, resolve immediately with no guess.
    if (!this.players.includes(this.chameleon)) {
      this._finish();
      return;
    }
    this.deadline = Date.now() + GUESS_MS;
    this._guessTimer = setTimeout(() => {
      if (this.state !== 'chameleonGuess') return;
      this._finish();
      this._emitChange();
    }, GUESS_MS);
  }

  // ---------- FINISH / SCORE ----------
  _finish() {
    if (this.state === 'finished') return;
    this._clearTimers();

    const caught = this.accused != null && this.accused === this.chameleon;
    const guessedRight = this.chameleonGuess != null && this.chameleonGuess === this.targetIndex;
    const chameleonWon = !caught || guessedRight;

    if (chameleonWon) {
      if (this.players.includes(this.chameleon)) {
        this.scores[this.chameleon] = (this.scores[this.chameleon] || 0) + POINTS_CHAMELEON;
      }
    } else {
      for (const p of this.players) {
        if (p !== this.chameleon) this.scores[p] = (this.scores[p] || 0) + POINTS_CREW;
      }
    }

    this.outcome = { caught, guessedRight, chameleonWon };
    if (this.state === 'chameleonGuess') this.transition('reveal'); // -> finished
    else this.state = 'finished';
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'reveal' && type === 'ready') {
      this.ready.add(playerId);
      this._checkRevealComplete();
    } else if (this.state === 'clues' && type === 'submitClue') {
      if (this.clues[playerId] !== undefined) return;
      const raw = String(action.clue == null ? '' : action.clue).trim();
      if (!raw) return;                 // reject empty
      if (/\s/.test(raw)) return;       // reject multi-word
      this.clues[playerId] = raw.slice(0, 32);
      this._checkCluesComplete();
    } else if (this.state === 'voting' && type === 'castVote') {
      if (this.votes[playerId] !== undefined) return; // one vote
      const target = action.targetId;
      if (target === playerId) return;                 // not yourself
      if (!this.players.includes(target)) return;      // must be present
      this.votes[playerId] = target;
      this._checkVotingComplete();
    } else if (this.state === 'chameleonGuess' && type === 'guessCell') {
      if (playerId !== this.chameleon) return;          // only the chameleon
      if (this.chameleonGuess !== null) return;
      const idx = Number(action.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= this.grid.length) return;
      this.chameleonGuess = idx;
      this._finish();
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearTimers() {
    for (const k of ['_revealTimer', '_cluesTimer', '_votingTimer', '_guessTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    const wasChameleon = playerId === this.chameleon;
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.ready.delete(playerId);
    delete this.clues[playerId];
    delete this.votes[playerId];
    delete this.scores[playerId];
    // drop any votes that were cast FOR the leaver so a stale target can't win the tally
    for (const v of Object.keys(this.votes)) if (this.votes[v] === playerId) delete this.votes[v];

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this.outcome = this.outcome || { caught: false, guessedRight: false, chameleonWon: true };
      this._emitChange();
      return;
    }

    // If the chameleon left during play, end the round sensibly: treat them as
    // gone (the crew can't be scored against an absent chameleon) -> finish.
    if (wasChameleon && this.state !== 'finished') {
      this._clearTimers();
      this.accused = this.accused || null;
      this._finish();
      this._emitChange();
      return;
    }

    if (this.state === 'reveal') this._checkRevealComplete();
    else if (this.state === 'clues') this._checkCluesComplete();
    else if (this.state === 'voting') this._checkVotingComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const isChameleon = playerId === this.chameleon;
    const finished = this.state === 'finished';

    // Clues are PUBLIC only after the clue barrier (voting onward).
    const cluesPublic = this.state === 'voting' || this.state === 'chameleonGuess' || finished;
    const publicClues = cluesPublic
      ? this.players.map((p) => ({ playerId: p, clue: this.clues[p] != null ? this.clues[p] : '...' }))
      : null;

    return {
      phase: this.state,
      myId: playerId,
      theme: this.theme,
      grid: [...this.grid],
      players: [...this.players],
      scores: { ...this.scores },
      playerCount: this.players.length,
      deadline: this.state !== 'waiting' && !finished ? this.deadline : null,

      // ---- role card (each player sees ONLY their own secret) ----
      isChameleon,
      // the secret word/cell is revealed to non-chameleons during play, and to
      // EVERYONE at finished — but NEVER to the chameleon before finished.
      targetIndex: (!isChameleon || finished) ? this.targetIndex : null,
      targetWord: (!isChameleon || finished)
        ? (this.targetIndex >= 0 ? this.grid[this.targetIndex] : null)
        : null,

      // ---- reveal ack ----
      ready: this.state === 'reveal' ? [...this.ready] : [],

      // ---- clues ----
      myClue: this.clues[playerId] != null ? this.clues[playerId] : null,
      hasSubmittedClue: this.clues[playerId] !== undefined,
      cluesSubmitted: Object.keys(this.clues).length,
      clues: publicClues, // null until the clue barrier completes

      // ---- voting (secret) ----
      myVote: this.votes[playerId] != null ? this.votes[playerId] : null,
      hasVoted: this.votes[playerId] !== undefined,
      votedCount: Object.keys(this.votes).length,

      // ---- chameleon guess ----
      hasGuessed: this.chameleonGuess !== null,

      // ---- finished reveal: everything disclosed ----
      chameleonId: finished ? this.chameleon : null,
      accused: finished ? this.accused : null,
      chameleonGuessIndex: finished ? this.chameleonGuess : null,
      outcome: finished ? this.outcome : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      const wasChameleon = playerId === this.chameleon;
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        wasChameleon,
        handDescription: `${this.scores[playerId] || 0} pts${wasChameleon ? ' (chameleon)' : ''}`,
      };
    });
  }
}
