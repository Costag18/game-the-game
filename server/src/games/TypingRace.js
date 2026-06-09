import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

// Scroll-themed transcription passages (~120–170 chars; long enough that not
// everyone finishes within 90s, so both finish-order AND partial progress matter).
const TYPING_PASSAGES = [
  'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the season of light.',
  'All that is gold does not glitter, not all those who wander are lost; the old that is strong does not wither, deep roots are not reached by the frost.',
  'In the beginning the Universe was created. This had made many people very angry and has been widely regarded as a bad move by nearly everyone.',
  'A wizard is never late, nor is he early, he arrives precisely when he means to. The same cannot be said for the rest of us racing to the finish.',
  'Fortune favors the bold, but the scroll favors the steady hand; type each word with care, for a single wrong letter halts your weary march.',
  'The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly, and the scribe records every careless keystroke made.',
  'Not all those who type are fast, and not all those who are fast type true; accuracy is the road, and speed is merely the cart upon it.',
  'Beware the typo, my friend, the letter that bites and the space that claws; keep your eyes upon the scroll and your fingers will find the way.',
];

/**
 * Typing Race — simultaneous single sprint. Players transcribe the same passage;
 * the server validates every submission against the passage PREFIX and is the sole
 * authority on progress/finish. Ranks by finish order, then correct-char progress.
 */
export class TypingRace extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'racing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'racing' },
        racing: { cutoff: 'finished' },
      },
    });
    this.passage = '';
    this.passageLen = 0;
    this.progress = {};
    this.finished = {};
    this.finishMs = {};
    this.lastInputMs = {};
    this.mismatches = {};
    this.left = new Set();
    this.raceStartMs = 0;
    this.cutoffAt = 0;
    this.endMs = null;
    this._cutoffTimer = null;
    this._finalized = false;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.passage = TYPING_PASSAGES[Math.floor(Math.random() * TYPING_PASSAGES.length)];
    this.passageLen = this.passage.length;
    for (const p of this.players) {
      this.progress[p] = 0;
      this.finished[p] = false;
      this.finishMs[p] = null;
      this.lastInputMs[p] = 0;
      this.mismatches[p] = 0;
    }
    this.transition('start'); // -> racing
  }

  onEnterRacing() {
    this.raceStartMs = Date.now();
    this.cutoffAt = this.raceStartMs + TIMERS.TYPING * 1000;
    this._clearTimers();
    this._cutoffTimer = setTimeout(() => {
      if (this.state !== 'racing') return;
      this._finishRace();
      this._emitChange();
    }, TIMERS.TYPING * 1000);
  }

  onEnterFinished() {
    if (this._finalized) return;
    this._finalized = true;
    this._clearTimers();
    this.endMs = Date.now();
  }

  _finishRace() {
    if (this.state !== 'racing') return; // idempotency guard
    this.transition('cutoff'); // -> finished
  }

  _correctPrefixLen(text) {
    const max = Math.min(text.length, this.passageLen);
    let i = 0;
    while (i < max && text.charCodeAt(i) === this.passage.charCodeAt(i)) i++;
    return i;
  }

  _allActiveFinished() {
    const active = this.players.filter((p) => !this.left.has(p));
    if (active.length === 0) return true;
    return active.every((p) => this.finished[p] === true);
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    if (this.state !== 'racing') return;
    const type = action && action.type;

    if (type === 'typed') {
      if (this.finished[playerId] || this.left.has(playerId)) return;
      const text = action.text;
      if (typeof text !== 'string') return;
      const clamped = text.length > this.passageLen ? text.slice(0, this.passageLen) : text;
      const n = this._correctPrefixLen(clamped);
      this.progress[playerId] = n;
      this.lastInputMs[playerId] = Date.now();
      if (clamped.length > n) this.mismatches[playerId] = (this.mismatches[playerId] || 0) + 1;
      if (n === this.passageLen) {
        this.finished[playerId] = true;
        this.finishMs[playerId] = Date.now() - this.raceStartMs;
        if (this._allActiveFinished()) this._finishRace();
      }
    } else if (type === 'ping') {
      if (Date.now() >= this.cutoffAt) this._finishRace();
    }
    // `progress` (bare count) is intentionally unsupported (unvalidated) — ignored.
  }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players
    this.left.add(playerId);
    if (this.state === 'racing') {
      if (this.players.length === 0) { this._finishRace(); return; }
      if (this._allActiveFinished()) this._finishRace();
    }
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    if (this._cutoffTimer) { clearTimeout(this._cutoffTimer); this._cutoffTimer = null; }
  }

  _wpm(p, fallbackElapsedMs) {
    const chars = this.progress[p] || 0;
    const ms = this.finished[p] && this.finishMs[p] != null ? this.finishMs[p] : fallbackElapsedMs;
    if (!ms || ms <= 0) return 0;
    return Math.round((chars / 5) / (ms / 60000));
  }

  getStateForPlayer(playerId) {
    const now = Date.now();
    const elapsedMs = this.state === 'finished'
      ? ((this.endMs || now) - this.raceStartMs)
      : (this.state === 'racing' ? now - this.raceStartMs : 0);
    return {
      phase: this.state,
      passage: this.passage,
      passageLen: this.passageLen,
      cutoffAt: this.cutoffAt,
      durationSec: TIMERS.TYPING,
      raceStartMs: this.raceStartMs,
      myId: playerId,
      myProgress: this.progress[playerId] || 0,
      myFinished: !!this.finished[playerId],
      myFinishMs: this.finishMs[playerId] != null ? this.finishMs[playerId] : null,
      myWpm: this._wpm(playerId, elapsedMs),
      racers: this.players.map((p) => ({
        playerId: p,
        progress: this.progress[p] || 0,
        pct: this.passageLen ? Math.round(100 * (this.progress[p] || 0) / this.passageLen) : 0,
        finished: !!this.finished[p],
        finishMs: this.finishMs[p] != null ? this.finishMs[p] : null,
        wpm: this._wpm(p, elapsedMs),
        left: this.left.has(p),
      })),
      standings: this.state === 'finished' ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const elapsed = (this.endMs != null ? this.endMs : Date.now()) - this.raceStartMs;
    const entries = this.players.map((p) => ({
      playerId: p,
      finished: !!this.finished[p],
      correctChars: this.progress[p] || 0,
      finishMs: this.finishMs[p] != null ? this.finishMs[p] : null,
      lastInputMs: this.lastInputMs[p] || Infinity,
      wpm: this._wpm(p, elapsed),
    }));

    entries.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishMs - b.finishMs;
      if (b.correctChars !== a.correctChars) return b.correctChars - a.correctChars;
      return a.lastInputMs - b.lastInputMs;
    });

    const sameRank = (x, y) =>
      x.finished === y.finished &&
      x.correctChars === y.correctChars &&
      x.finishMs === y.finishMs;

    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && !sameRank(e, entries[i - 1])) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        finished: e.finished,
        correctChars: e.correctChars,
        wpm: e.wpm,
        handDescription: e.finished
          ? `Finished — ${e.wpm} WPM`
          : `${e.correctChars}/${this.passageLen} chars`,
      };
    });
  }
}
