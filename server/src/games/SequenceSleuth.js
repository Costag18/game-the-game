import { BaseGame } from './BaseGame.js';

const TOTAL_SEQUENCES = 5;
const START_SHOWN = 2;          // terms visible when a sequence opens
const REVEAL_MS = 4000;         // delay between auto-revealing the next term
const ACK_MS = 10_000;          // reveal/finished ack auto-advance
const MAX_REVEALABLE = 6;       // most terms ever shown before the "next" (answer) term resolves
const TERM_COUNT = MAX_REVEALABLE + 1; // we generate one extra: the not-yet-shown "next" term

/**
 * Sequence Sleuth — guess-the-next-number race over 5 sequences. The server picks
 * a hidden integer RULE per sequence (arithmetic / geometric / squares / fibonacci-like
 * / alternating) and the full term list, then reveals terms ONE AT A TIME on a timer
 * (2 shown, +1 every few seconds). A player may lock {type:'guess', value} = their
 * prediction of the NEXT not-yet-revealed term at any time. Locking EARLIER (fewer
 * terms shown) scores MORE: points = max(100, 600 - revealedCount*100) on a correct
 * guess; a wrong guess locks you out of that sequence (0). When the next term is
 * revealed the sequence resolves; cumulative score ranks 1..N, ties shared.
 *
 * Anti-cheat: the rule + future terms live ONLY in the FSM. getStateForPlayer sends
 * only the revealed terms so far, the player's own lock status, and scores — never the
 * rule, the answer, or future terms. The guess is validated server-side against the
 * true next term, so a client can never claim a solve it didn't make.
 *
 * Timer-driven (auto-reveal + resolve fire from setTimeout), so every timer callback
 * pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class SequenceSleuth extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { resolve: 'reveal' },
        reveal: { next: 'playing', finish: 'finished' },
      },
    });
    this.totalSequences = TOTAL_SEQUENCES;
    this.seqIndex = -1;
    this.scores = {};
    this.terms = [];          // full true term list (length TERM_COUNT); terms[shown] is the answer
    this.ruleLabel = '';
    this.shown = START_SHOWN; // how many terms are currently revealed
    this.locks = {};          // playerId -> { value, revealedAt, correct, points }
    this.lastResolve = null;  // snapshot of the just-resolved sequence for the reveal screen
    this.acknowledged = new Set();
    this._revealTimer = null;
    this._ackTimer = null;
    this._revealStartMs = 0;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterPlaying
  }

  // ---------- sequence generation ----------

  _genSequence() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const kind = pick(['arithmetic', 'geometric', 'squares', 'fibonacci', 'alternating']);
    const terms = [];
    let label = '';

    if (kind === 'arithmetic') {
      const a = rnd(1, 9);
      const d = pick([2, 3, 4, 5, 6, 7, -2, -3]);
      for (let n = 0; n < TERM_COUNT; n++) terms.push(a + d * n);
      label = 'Arithmetic';
    } else if (kind === 'geometric') {
      const a = rnd(1, 4);
      const r = pick([2, 3]);
      for (let n = 0; n < TERM_COUNT; n++) terms.push(a * Math.pow(r, n));
      label = 'Geometric';
    } else if (kind === 'squares') {
      const start = rnd(1, 4);
      for (let n = 0; n < TERM_COUNT; n++) { const k = start + n; terms.push(k * k); }
      label = 'Perfect squares';
    } else if (kind === 'fibonacci') {
      let x = rnd(1, 4);
      let y = rnd(1, 5);
      terms.push(x, y);
      while (terms.length < TERM_COUNT) { const z = x + y; terms.push(z); x = y; y = z; }
      label = 'Fibonacci-like';
    } else { // alternating: two interleaved arithmetic progressions
      const a0 = rnd(1, 6), d0 = pick([2, 3, 4, 5]);
      const b0 = rnd(2, 9), d1 = pick([2, 3, 4, 5]);
      for (let n = 0; n < TERM_COUNT; n++) {
        const half = Math.floor(n / 2);
        terms.push(n % 2 === 0 ? a0 + d0 * half : b0 + d1 * half);
      }
      label = 'Alternating';
    }
    return { terms, label };
  }

  // ---------- FSM hooks ----------

  onEnterPlaying() {
    this.seqIndex++;
    const { terms, label } = this._genSequence();
    this.terms = terms;
    this.ruleLabel = label;
    this.shown = START_SHOWN;
    this.locks = {};
    this.lastResolve = null;
    this._clearTimers();
    this._scheduleReveal();
  }

  _scheduleReveal() {
    this._clearTimers();
    this._revealStartMs = Date.now();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'playing') return;
      this._revealNextTerm();
      this._emitChange();
    }, REVEAL_MS);
  }

  // Reveal one more term. If that term is the "next" (answer) term, the sequence resolves.
  _revealNextTerm() {
    if (this.state !== 'playing') return;
    // The answer term sits at index `shown`. Revealing it resolves the round.
    this._resolveSequence();
  }

  _resolveSequence() {
    if (this.state !== 'playing') return; // guard double-call
    this._clearTimers();
    const answer = this.terms[this.shown]; // the not-yet-revealed next term
    // Score anyone who locked but hasn't been scored (correct lockers already scored at lock time;
    // here we only finalize the snapshot — points were assigned when the lock was placed).
    this.lastResolve = {
      seqIndex: this.seqIndex,
      revealedTerms: this.terms.slice(0, this.shown),
      answer,
      ruleLabel: this.ruleLabel,
      locks: Object.fromEntries(
        Object.entries(this.locks).map(([p, l]) => [p, { value: l.value, correct: l.correct, points: l.points, revealedAt: l.revealedAt }])
      ),
    };
    this.acknowledged = new Set();
    this.transition('resolve'); // -> onEnterReveal
  }

  onEnterReveal() {
    this._clearTimers();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, ACK_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.seqIndex + 1 >= this.totalSequences) this.transition('finish');
    else this.transition('next'); // -> onEnterPlaying
  }

  // ---------- actions ----------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'playing') {
      if (type === 'guess') {
        if (this.locks[playerId] !== undefined) return; // one lock per sequence
        const value = action.value;
        if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return;
        const answer = this.terms[this.shown];
        const correct = value === answer;
        const points = correct ? Math.max(100, 600 - this.shown * 100) : 0;
        this.locks[playerId] = { value, revealedAt: this.shown, correct, points };
        if (correct) this.scores[playerId] = (this.scores[playerId] || 0) + points;
        this._checkAllLocked();
      } else if (type === 'ping') {
        if (this._revealStartMs && Date.now() >= this._revealStartMs + REVEAL_MS) this._revealNextTerm();
      }
    } else if (this.state === 'reveal') {
      if (type === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealComplete();
      }
    }
  }

  // If every player has locked, reveal one more term right away (advance the reveal),
  // resolving the sequence once we hit the answer term. We never auto-resolve before
  // the answer is reached unless the whole reveal window is exhausted.
  _checkAllLocked() {
    if (this.state !== 'playing') return;
    if (this.players.length === 0) return;
    if (this.players.every((p) => this.locks[p] !== undefined)) {
      // Everyone has committed — resolve immediately rather than waiting out the timer.
      this._resolveSequence();
    }
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.length > 0 && this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearTimers() {
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
  }

  // ---------- leave / teardown ----------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.scores[playerId];
    delete this.locks[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'playing') this._checkAllLocked();
    else if (this.state === 'reveal') this._checkRevealComplete();
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- state / results ----------

  getStateForPlayer(playerId) {
    const revealing = this.state === 'reveal';
    const finished = this.state === 'finished';
    const mine = this.locks[playerId] || null;
    return {
      phase: this.state,
      myId: playerId,
      sequenceNumber: this.seqIndex + 1,
      totalSequences: this.totalSequences,
      revealedTerms: this.state === 'playing' ? this.terms.slice(0, this.shown) : [],
      revealedCount: this.shown,
      nextRevealMs: this.state === 'playing' ? this._revealStartMs + REVEAL_MS : null,
      revealIntervalSec: REVEAL_MS / 1000,
      myLock: mine ? { value: mine.value, revealedAt: mine.revealedAt, correct: revealing || finished ? mine.correct : null, points: revealing || finished ? mine.points : null } : null,
      hasLocked: mine !== null,
      potentialPoints: this.state === 'playing' ? Math.max(100, 600 - this.shown * 100) : null,
      scores: { ...this.scores },
      opponents: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        hasLocked: this.locks[p] !== undefined,
      })),
      resolve: revealing ? this.lastResolve : null,
      acknowledged: revealing ? [...this.acknowledged] : [],
      results: finished ? this.getResults() : null,
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
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
