import { BaseGame } from './BaseGame.js';
import { shuffledQuantities } from '../utils/triviaBank.js';

const ANSWER_MS = 15_000;  // window to call HIGHER/LOWER each step
const REVEAL_MS = 6_000;   // reveal hold before the next step / finish

/**
 * Higher or Lower — survival streak game. The server shuffles a sequence of
 * quantities ({label, value, unit}); the first is the starting ANCHOR (shown
 * with its value). Each step reveals the NEXT item's LABEL ONLY and every
 * still-alive player simultaneously calls HIGHER or LOWER (is the next value
 * higher/lower than the anchor?). On reveal, correct callers survive and their
 * streak grows; wrong callers are eliminated (their streak is banked). Equal
 * consecutive values are a non-elimination PUSH (skip). The next item becomes
 * the new anchor; continue until everyone is out or the sequence ends.
 *
 * Anti-cheat: the next item's VALUE is server-only — getStateForPlayer never
 * sends it (nor whether the truth is higher/lower) until the reveal phase.
 *
 * Timer-driven advances pair with `_emitChange()` per the v2.7.0 contract.
 */
export class HigherLower extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'question', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'question' },
        question: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'question', finish: 'finished' },
      },
    });
    this.sequence = [];
    this.anchorIndex = 0;     // index in sequence of the current anchor
    this.stepNumber = 0;      // 1-based count of comparison steps shown
    this.streaks = {};        // playerId -> current/banked streak length
    this.alive = new Set();   // players still in the run
    this.calls = {};          // playerId -> 'higher' | 'lower' for the active step
    this.revealData = null;
    this.acknowledged = new Set();
    this._answerTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.sequence = shuffledQuantities();
    this.anchorIndex = 0;
    this.stepNumber = 0;
    for (const p of this.players) this.streaks[p] = 0;
    this.alive = new Set(this.players);
    this.transition('start'); // -> onEnterQuestion
  }

  get anchor() { return this.sequence[this.anchorIndex] || null; }
  get nextItem() { return this.sequence[this.anchorIndex + 1] || null; }

  // ---------- QUESTION ----------
  onEnterQuestion() {
    this.stepNumber++;
    this.calls = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this._answerTimer = setTimeout(() => {
      if (this.state !== 'question') return;
      this._toReveal();
      this._emitChange();
    }, ANSWER_MS);
  }

  _toReveal() {
    if (this.state !== 'question') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const anchor = this.anchor;
    const next = this.nextItem;
    const correctCall = next.value > anchor.value ? 'higher'
      : next.value < anchor.value ? 'lower' : 'push';
    const outcomes = {};
    const eliminatedNow = [];
    for (const p of this.alive) {
      const call = this.calls[p];          // undefined = no call (timed out / never answered)
      let result;
      if (correctCall === 'push') {
        result = 'push';                   // equal values: nobody is eliminated
      } else if (call === correctCall) {
        result = 'correct';
        this.streaks[p] = (this.streaks[p] || 0) + 1;
      } else {
        result = 'wrong';                  // wrong call OR no call -> eliminated, streak banked
        eliminatedNow.push(p);
      }
      outcomes[p] = { call: call || null, result, streak: this.streaks[p] || 0 };
    }
    for (const p of eliminatedNow) {
      this.alive.delete(p);
      this._removeFromActive(p);           // out of the run, still scored on streak
    }

    this.revealData = {
      anchorLabel: anchor.label,
      anchorValue: anchor.value,
      nextLabel: next.label,
      nextValue: next.value,
      unit: next.unit,
      correctCall,
      outcomes,
      eliminated: eliminatedNow,
    };
    this.acknowledged = new Set();
    this._clearTimers();
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
    this.anchorIndex++; // the revealed item becomes the new anchor
    // End the run when nobody is left alive or the sequence is exhausted.
    if (this.alive.size === 0 || this.anchorIndex + 1 >= this.sequence.length) {
      this.transition('finish');
    } else {
      this.transition('next'); // -> onEnterQuestion
    }
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'question' && type === 'call') {
      if (!this.alive.has(playerId)) return;          // eliminated players can't call
      if (this.calls[playerId] !== undefined) return; // one locked call per step
      const dir = action.direction;
      if (dir !== 'higher' && dir !== 'lower') return;
      this.calls[playerId] = dir;
      this._checkAllCalled();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkAllCalled() {
    if (this.state !== 'question') return;
    for (const p of this.alive) if (this.calls[p] === undefined) return;
    this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearTimers() {
    for (const k of ['_answerTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.alive.delete(playerId);
    delete this.calls[playerId];
    this.acknowledged.delete(playerId);
    // keep streaks[playerId] out of results via the prune above

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'question') this._checkAllCalled();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  // ---------- STATE (anti-cheat: never leak the next value pre-reveal) ----------
  getStateForPlayer(playerId) {
    const anchor = this.anchor;
    const next = this.nextItem;
    const revealing = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      step: this.stepNumber,
      anchorLabel: anchor ? anchor.label : '',
      anchorValue: anchor ? anchor.value : null,
      anchorUnit: anchor ? anchor.unit : '',
      nextLabel: next ? next.label : '',
      nextUnit: next ? next.unit : '',
      amAlive: this.alive.has(playerId),
      myStreak: this.streaks[playerId] || 0,
      myCall: this.calls[playerId] != null ? this.calls[playerId] : null,
      hasCalled: this.calls[playerId] !== undefined,
      aliveCount: this.alive.size,
      calledCount: [...this.alive].filter((p) => this.calls[p] !== undefined).length,
      streaks: { ...this.streaks },
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: revealing ? this.revealData : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.streaks[b] || 0) - (this.streaks[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.streaks[playerId] || 0) < (this.streaks[sorted[i - 1]] || 0)) placement = i + 1;
      const s = this.streaks[playerId] || 0;
      return {
        playerId,
        placement,
        score: s,
        streak: s,
        handDescription: `${s} streak`,
      };
    });
  }
}
