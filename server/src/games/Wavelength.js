import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const CLUE_MS = TIMERS.WAVELENGTH_CLUE * 1000;  // 45s
const GUESS_MS = TIMERS.WAVELENGTH_GUESS * 1000; // 30s
const REVEAL_MS = 10_000;

const SPECTRUMS = [
  { left: 'Cold', right: 'Hot' }, { left: 'Underrated', right: 'Overrated' },
  { left: 'Round', right: 'Pointy' }, { left: 'Useless', right: 'Useful' },
  { left: 'Common', right: 'Rare' }, { left: 'Forbidden', right: 'Encouraged' },
  { left: 'Cheap', right: 'Expensive' }, { left: 'Quiet', right: 'Loud' },
  { left: 'Weird', right: 'Normal' }, { left: 'Scary', right: 'Comforting' },
  { left: 'Old', right: 'New' }, { left: 'Boring', right: 'Exciting' },
  { left: 'Ugly', right: 'Beautiful' }, { left: 'Soft', right: 'Hard' },
  { left: 'Dirty', right: 'Clean' }, { left: 'Tiny', right: 'Huge' },
  { left: 'Slow', right: 'Fast' }, { left: 'Mainstream', right: 'Hipster' },
  { left: 'Evil', right: 'Good' }, { left: 'Casual', right: 'Formal' },
  { left: 'Fragile', right: 'Tough' }, { left: 'Healthy', right: 'Unhealthy' },
  { left: 'Temporary', right: 'Permanent' }, { left: 'Simple', right: 'Complex' },
  { left: 'Disgusting', right: 'Delicious' }, { left: 'Wet', right: 'Dry' },
  { left: 'Lazy', right: 'Hardworking' }, { left: 'Calm', right: 'Chaotic' },
  { left: 'Cute', right: 'Intimidating' }, { left: 'Fake', right: 'Authentic' },
  { left: 'Risky', right: 'Safe' }, { left: 'Silly', right: 'Serious' },
  { left: 'Modern', right: 'Vintage' }, { left: 'Bitter', right: 'Sweet' },
  { left: 'Underdog', right: 'Favorite' }, { left: 'Practical', right: 'Magical' },
  { left: 'Embarrassing', right: 'Impressive' }, { left: 'Indoor', right: 'Outdoor' },
  { left: 'Forgettable', right: 'Iconic' }, { left: 'Loner', right: 'Social' },
];

/**
 * Wavelength — turn-based spectrum clue game. Each sub-round one player (the
 * psychic) sees a hidden target band on a spectrum and gives a short clue; the
 * others slide 0–100 to guess. Closer = more points; the psychic scores from how
 * well the guessers did. Every player is psychic once.
 */
export class Wavelength extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'clue', 'guessing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'clue' },
        clue: { clueSubmitted: 'guessing', finish: 'finished' },
        guessing: { allGuessed: 'reveal', finish: 'finished' },
        reveal: { next: 'clue', finish: 'finished' },
      },
    });
    this._psychicQueue = [];
    this.subRound = 0;
    this.roundsPerGame = 0;
    this.psychicId = null;
    this.spectrum = { left: '', right: '' };
    this.targetCenter = 50;
    this.targetWidth = 7;
    this.clueText = null;
    this.guesses = {};
    this.totalPoints = {};
    this.lastReveal = null;
    this.acknowledged = new Set();
    this.roundHistory = [];
    this.usedSpectra = new Set();
    this._clueTimer = null;
    this._guessTimer = null;
    this._revealTimer = null;
    this._clueStartTime = 0;
    this._guessStartTime = 0;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this._psychicQueue = this._shuffle(this.players);
    this.roundsPerGame = this._psychicQueue.length;
    this.subRound = 0;
    for (const p of this.players) this.totalPoints[p] = 0;
    this.roundHistory = [];
    this.usedSpectra = new Set();
    this.transition('start'); // -> onEnterClue
  }

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterClue() {
    this.subRound++;
    this.psychicId = this._psychicQueue.shift() || null;
    this._rollSpectrum();
    this.clueText = null;
    this.guesses = {};
    this.acknowledged = new Set();
    this._clearTimers();
    this._clueStartTime = Date.now();
    this._clueTimer = setTimeout(() => {
      if (this.state !== 'clue') return;
      this.clueText = '(no clue)';
      this.transition('clueSubmitted');
      this._emitChange();
    }, CLUE_MS);
  }

  onEnterGuessing() {
    this._guessStartTime = Date.now();
    this._clearTimers();
    this._guessTimer = setTimeout(() => {
      if (this.state !== 'guessing') return;
      for (const p of this.players) {
        if (p !== this.psychicId && this.guesses[p] === undefined) this.guesses[p] = 50;
      }
      this.transition('allGuessed');
      this._emitChange();
    }, GUESS_MS);
  }

  onEnterReveal() {
    this._clearTimers();
    const exp = this.players.filter((p) => p !== this.psychicId);
    const guessPoints = {};
    let sum = 0;
    for (const p of exp) {
      const pts = this._guesserPoints(this.guesses[p]);
      guessPoints[p] = pts;
      this.totalPoints[p] = (this.totalPoints[p] || 0) + pts;
      sum += pts;
    }
    const psychicPoints = exp.length > 0 ? Math.min(4, Math.round(sum / exp.length)) : 0;
    if (this.psychicId && this.players.includes(this.psychicId)) {
      this.totalPoints[this.psychicId] = (this.totalPoints[this.psychicId] || 0) + psychicPoints;
    }
    this.lastReveal = {
      spectrum: this.spectrum,
      targetCenter: this.targetCenter,
      targetWidth: this.targetWidth,
      clueText: this.clueText,
      psychicId: this.psychicId,
      guesses: { ...this.guesses },
      guessPoints,
      psychicPoints,
    };
    this.roundHistory.push(this.lastReveal);
    this.acknowledged = new Set();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceAfterReveal();
      this._emitChange();
    }, REVEAL_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  _guesserPoints(v) {
    if (typeof v !== 'number') return 0;
    const d = Math.abs(v - this.targetCenter);
    const W = this.targetWidth;
    if (d <= W) return 4;
    if (d <= 2 * W) return 3;
    if (d <= 3 * W) return 2;
    return 0;
  }

  _rollSpectrum() {
    let pick;
    let tries = 0;
    do {
      pick = SPECTRUMS[Math.floor(Math.random() * SPECTRUMS.length)];
      tries++;
    } while (this.usedSpectra.has(pick.left) && tries < 60);
    this.usedSpectra.add(pick.left);
    this.spectrum = pick;
    this.targetWidth = 6 + Math.floor(Math.random() * 3);  // 6,7,8
    this.targetCenter = 8 + Math.floor(Math.random() * 85); // 8..92
  }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'clue') {
      if (type === 'submitClue' && playerId === this.psychicId && this.clueText === null) {
        let clue = typeof action.clue === 'string' ? action.clue.trim() : '';
        if (!clue) return;
        if (/^\d{1,3}$/.test(clue)) return; // anti-cheat: bare number
        this.clueText = clue.slice(0, 40);
        this.transition('clueSubmitted');
      }
    } else if (this.state === 'guessing') {
      if (type === 'guess' && playerId !== this.psychicId && this.guesses[playerId] === undefined) {
        let v = Math.round(Number(action.value));
        if (!Number.isFinite(v)) return;
        v = Math.max(0, Math.min(100, v));
        this.guesses[playerId] = v;
        const exp = this.players.filter((p) => p !== this.psychicId);
        if (exp.every((p) => this.guesses[p] !== undefined)) this.transition('allGuessed');
      } else if (type === 'ping') {
        if (this._guessStartTime && Date.now() >= this._guessStartTime + GUESS_MS) {
          for (const p of this.players) {
            if (p !== this.psychicId && this.guesses[p] === undefined) this.guesses[p] = 50;
          }
          this.transition('allGuessed');
        }
      }
    } else if (this.state === 'reveal') {
      if (type === 'acknowledge') {
        this.acknowledged.add(playerId);
        if (this.players.every((p) => this.acknowledged.has(p))) this._advanceAfterReveal();
      }
    }
  }

  _advanceAfterReveal() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this._psychicQueue.length === 0) this.transition('finish');
    else this.transition('next'); // -> onEnterClue
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(id) {
    super.removePlayer(id);
    this._psychicQueue = this._psychicQueue.filter((p) => p !== id);
    delete this.guesses[id];
    delete this.totalPoints[id];
    if (this.acknowledged) this.acknowledged.delete(id);

    if (this.players.length <= 1) { this._forceFinish(); return; }

    if (this.state === 'clue' && id === this.psychicId) {
      this._skipSubRound();
    } else if (this.state === 'guessing') {
      if (id === this.psychicId) {
        this._endGuessingEarly();
      } else {
        const exp = this.players.filter((p) => p !== this.psychicId);
        if (exp.every((p) => this.guesses[p] !== undefined)) this.transition('allGuessed');
      }
    } else if (this.state === 'reveal') {
      if (this.players.every((p) => this.acknowledged.has(p))) this._advanceAfterReveal();
    }
  }

  _skipSubRound() {
    if (this._clueTimer) { clearTimeout(this._clueTimer); this._clueTimer = null; }
    if (this._psychicQueue.length === 0) { this._forceFinish(); return; }
    this.onEnterClue(); // re-enter the clue phase with the next psychic
  }

  _endGuessingEarly() {
    for (const p of this.players) {
      if (p !== this.psychicId && this.guesses[p] === undefined) this.guesses[p] = 50;
    }
    this.transition('allGuessed'); // -> onEnterReveal (departed psychic scores 0)
  }

  _forceFinish() {
    this._clearTimers();
    if (this.state !== 'finished') this.state = 'finished';
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  _clearTimers() {
    for (const t of ['_clueTimer', '_guessTimer', '_revealTimer']) {
      if (this[t]) { clearTimeout(this[t]); this[t] = null; }
    }
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(pid) {
    const isReveal = this.state === 'reveal' || this.state === 'finished';
    const amPsychic = pid === this.psychicId;
    return {
      phase: this.state,
      subRound: this.subRound,
      roundsPerGame: this.roundsPerGame,
      psychicId: this.psychicId,
      amPsychic,
      spectrum: this.spectrum,
      clueText: this.clueText,
      targetCenter: (amPsychic || isReveal) ? this.targetCenter : null,
      targetWidth: (amPsychic || isReveal) ? this.targetWidth : null,
      myGuess: this.guesses[pid] != null ? this.guesses[pid] : null,
      guesses: isReveal ? { ...this.guesses } : null,
      guessedIds: Object.keys(this.guesses),
      totalPoints: { ...this.totalPoints },
      lastReveal: isReveal ? this.lastReveal : null,
      acknowledged: [...this.acknowledged],
      clueEndTime: this.state === 'clue' && this._clueStartTime ? this._clueStartTime + CLUE_MS : null,
      guessEndTime: this.state === 'guessing' && this._guessStartTime ? this._guessStartTime + GUESS_MS : null,
      myId: pid,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.totalPoints[b] || 0) - (this.totalPoints[a] || 0));
    let placement = 1;
    return sorted.map((pid, i) => {
      if (i > 0 && (this.totalPoints[pid] || 0) < (this.totalPoints[sorted[i - 1]] || 0)) placement = i + 1;
      return {
        playerId: pid,
        placement,
        score: this.totalPoints[pid] || 0,
        handDescription: `${this.totalPoints[pid] || 0} pts`,
      };
    });
  }
}
