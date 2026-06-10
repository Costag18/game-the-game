import { BaseGame } from './BaseGame.js';

const POINTS_CATCH = 500;  // a guesser who correctly fingers the lie
const POINTS_FOOL = 250;   // the storyteller, per guesser they fooled
const WRITE_MS = 45_000;   // storyteller writes 3 statements + flags the lie
const GUESS_MS = 30_000;   // everyone else guesses which is the lie
const REVEAL_MS = 12_000;  // disclose the lie + scores, auto-advance

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Two Truths and a Lie — rotating storyteller, one round per player
 * (numSteps = players.length). Each round one player is the STORYTELLER: they
 * write THREE statements about themselves and privately flag WHICH one is the
 * lie (the other two are truths). The three are shown SHUFFLED to everyone
 * else, who each privately GUESS which is the lie.
 *
 * Scoring: each guesser +500 for catching the lie; the storyteller +250 per
 * guesser they FOOLED (who guessed wrong). Cumulative across all rounds.
 *
 * Server-authoritative anti-cheat: which statement is the lie lives only in the
 * FSM (`this.lieIndex`) — the shuffled `statements` sent to guessers carry NO
 * lie flag and NO original index, and the lie's position is never sent to a
 * guesser until reveal. Guesses are private (only an aggregate count leaks
 * mid-phase). The storyteller does NOT guess their own round.
 */
export class TwoTruths extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'writing', 'guessing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'writing' },
        writing: { guess: 'guessing', skip: 'reveal', finish: 'finished' },
        guessing: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'writing', finish: 'finished' },
      },
    });
    this.scores = {};
    this.catchCounts = {};      // playerId -> total lies they caught across rounds
    this.fooledCounts = {};     // playerId -> total guessers they fooled (as storyteller)
    this.order = [];            // storyteller rotation
    this.roundIndex = -1;       // 0-based index into this.order
    this.totalRounds = players.length;
    this.storyteller = null;
    this.statements = [];       // [{ optionId, text }] shuffled, lie hidden
    this.lieOptionId = null;    // secret — which optionId is the lie
    this.guesses = {};          // guesserId -> optionId
    this.revealData = null;
    this.acknowledged = new Set();
    this.deadline = null;       // epoch-ms for the active phase timer
    this._writeTimer = null;
    this._guessTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.scores[p] = 0; this.catchCounts[p] = 0; this.fooledCounts[p] = 0; }
    this.order = shuffle(this.players);
    this.totalRounds = this.order.length;
    this.transition('start'); // -> onEnterWriting
  }

  // who is the storyteller this round (may be gone — caller checks)
  get _currentStoryteller() { return this.order[this.roundIndex] || null; }
  // everyone except the storyteller — the guessers
  get _guessers() { return this.players.filter((p) => p !== this.storyteller); }

  // ---------- WRITING ----------
  onEnterWriting() {
    this.roundIndex++;
    // Skip past any storyteller who has since left; finish if we run out.
    while (this.roundIndex < this.order.length && !this.players.includes(this.order[this.roundIndex])) {
      this.roundIndex++;
    }
    if (this.roundIndex >= this.order.length) { this._clearAllTimers(); this.transition('finish'); return; }

    this.storyteller = this._currentStoryteller;
    this.statements = [];
    this.lieOptionId = null;
    this.guesses = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + WRITE_MS;
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      // storyteller never submitted -> skip scoring this round entirely
      this._toReveal({ skipped: true });
      this._emitChange();
    }, WRITE_MS);
  }

  _hasStatements() { return this.statements.length === 3 && this.lieOptionId != null; }

  _toGuessing() {
    if (this.state !== 'writing') return;
    this._clearAllTimers();
    this.transition('guess'); // -> onEnterGuessing
  }

  // ---------- GUESSING ----------
  onEnterGuessing() {
    this.guesses = {};
    this.acknowledged = new Set();
    this._clearAllTimers();
    this.deadline = Date.now() + GUESS_MS;
    this._guessTimer = setTimeout(() => {
      if (this.state !== 'guessing') return;
      // non-guessers auto-miss: they simply never get recorded (counts as wrong)
      this._toReveal({ skipped: false });
      this._emitChange();
    }, GUESS_MS);
  }

  _checkGuessComplete() {
    if (this.state !== 'guessing') return;
    const guessers = this._guessers;
    if (guessers.length === 0) { this._toReveal({ skipped: false }); return; }
    if (guessers.every((p) => this.guesses[p] !== undefined)) this._toReveal({ skipped: false });
  }

  // ---------- REVEAL ----------
  _toReveal({ skipped }) {
    if (this.state === 'reveal' || this.state === 'finished') return;
    this._clearAllTimers();
    this._pendingSkip = !!skipped;
    // 'writing' -> reveal uses 'skip'; 'guessing' -> reveal uses 'reveal'
    this.transition(this.state === 'writing' ? 'skip' : 'reveal'); // -> onEnterReveal
  }

  onEnterReveal() {
    const skipped = !!this._pendingSkip;
    this._pendingSkip = false;
    const guessers = this._guessers;
    const awards = {};
    let fooled = 0;
    const catchers = [];
    const foolers = [];

    if (!skipped && this.storyteller && this.players.includes(this.storyteller)) {
      for (const p of guessers) {
        const caught = this.guesses[p] === this.lieOptionId;
        let gained = 0;
        if (caught) {
          gained = POINTS_CATCH;
          this.catchCounts[p] = (this.catchCounts[p] || 0) + 1;
          catchers.push(p);
        } else {
          fooled++;
          foolers.push(p);
        }
        this.scores[p] = (this.scores[p] || 0) + gained;
        awards[p] = { caught, gained };
      }
      const storyGain = POINTS_FOOL * fooled;
      this.fooledCounts[this.storyteller] = (this.fooledCounts[this.storyteller] || 0) + fooled;
      this.scores[this.storyteller] = (this.scores[this.storyteller] || 0) + storyGain;
      awards[this.storyteller] = { storyteller: true, fooled, gained: storyGain };
    }

    this.revealData = {
      storyteller: this.storyteller,
      skipped,
      // safe to disclose the lie + every player's guess now
      statements: this.statements.map((s) => ({
        optionId: s.optionId,
        text: s.text,
        isLie: s.optionId === this.lieOptionId,
        guessers: skipped ? [] : guessers.filter((p) => this.guesses[p] === s.optionId),
      })),
      lieOptionId: skipped ? null : this.lieOptionId,
      caughtBy: catchers,
      fooled: foolers,
      awards,
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
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
    this._clearAllTimers();
    // any more storytellers left to go?
    let next = this.roundIndex + 1;
    while (next < this.order.length && !this.players.includes(this.order[next])) next++;
    if (next >= this.order.length) this.transition('finish');
    else this.transition('next'); // -> onEnterWriting (increments roundIndex itself)
  }

  onEnterFinished() { this._clearAllTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'writing' && type === 'submitStatements') {
      if (playerId !== this.storyteller) return;          // only the storyteller writes
      if (this._hasStatements()) return;                  // one submission
      const raw = Array.isArray(action.statements) ? action.statements : [];
      const texts = raw.map((t) => String(t == null ? '' : t).trim().slice(0, 140));
      if (texts.length !== 3 || texts.some((t) => !t)) return; // need 3 non-empty
      const lie = Number(action.lieIndex);
      if (!Number.isInteger(lie) || lie < 0 || lie > 2) return; // must flag one of the 3
      // assign ids, mark the lie, THEN shuffle so position carries no signal
      const tagged = texts.map((text, i) => ({ optionId: `opt_${i}`, text, _lie: i === lie }));
      const shuffled = shuffle(tagged);
      this.statements = shuffled.map((s) => ({ optionId: s.optionId, text: s.text }));
      this.lieOptionId = shuffled.find((s) => s._lie).optionId;
      this._toGuessing();
    } else if (this.state === 'guessing' && type === 'guess') {
      if (playerId === this.storyteller) return;          // storyteller doesn't guess
      if (this.guesses[playerId] !== undefined) return;   // one guess
      const opt = this.statements.find((s) => s.optionId === action.optionId);
      if (!opt) return;
      this.guesses[playerId] = action.optionId;
      this._checkGuessComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearAllTimers() {
    for (const k of ['_writeTimer', '_guessTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    const wasStoryteller = playerId === this.storyteller;
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.guesses[playerId];
    this.acknowledged.delete(playerId);
    // keep their cumulative scores out of future rounds; do NOT re-award

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      this.deadline = null;
      this._emitChange();
      return;
    }

    if (this.state === 'writing') {
      // storyteller gone before submitting -> skip this round (no one to score)
      if (wasStoryteller) this._toReveal({ skipped: true });
    } else if (this.state === 'guessing') {
      // storyteller gone mid-guessing -> their round is voided (skip scoring)
      if (wasStoryteller) this._toReveal({ skipped: true });
      else this._checkGuessComplete();
    } else if (this.state === 'reveal') {
      this._checkRevealComplete();
    }
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const isStoryteller = playerId === this.storyteller;
    const revealing = this.state === 'reveal' || this.state === 'finished';
    const guessers = this._guessers;
    return {
      phase: this.state,
      myId: playerId,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      storyteller: this.storyteller,
      iAmStoryteller: isStoryteller,
      scores: { ...this.scores },
      playerCount: this.players.length,
      guesserCount: guessers.length,
      // WRITING: storyteller sees nothing extra; others wait
      hasSubmitted: this._hasStatements(),
      // GUESSING: the 3 shuffled statements WITHOUT any lie flag — the lie's
      // position is NEVER sent to a guesser. The storyteller sees them too (to
      // watch), but they cannot guess.
      statements: (this.state === 'guessing' || revealing)
        ? this.statements.map((s) => ({ optionId: s.optionId, text: s.text }))
        : null,
      myGuess: this.guesses[playerId] != null ? this.guesses[playerId] : null,
      guessedCount: guessers.filter((p) => this.guesses[p] !== undefined).length,
      deadline: (this.state === 'writing' || this.state === 'guessing' || this.state === 'reveal') ? this.deadline : null,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: revealing ? this.revealData : null,
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
        catchCount: this.catchCounts[playerId] || 0,
        fooledCount: this.fooledCounts[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
