import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';
import { CanvasSession } from '../utils/CanvasSession.js';
import { pickWord } from '../utils/wordBank.js';
import { isCorrectGuess, isCloseGuess } from '../utils/guessMatch.js';

const TURN_MS = TIMERS.SKRIBBL_TURN * 1000; // 70s
const REVEAL_MS = 8000;

/**
 * Skribbl — draw-and-guess. Each player draws once; everyone else races to guess
 * the word in a chat box. Server-authoritative anti-cheat: the secret word lives
 * ONLY in the FSM and is sent to the drawer alone (guessers get a masked length
 * hint, never the letters); guess matching runs server-side via guessMatch; the
 * drawer cannot guess; wrong guesses are never echoed to the room, so a guess can't
 * leak the word. Pixels flow on the separate CanvasSession relay, not through here.
 */
export class Skribbl extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'drawing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'drawing' },
        drawing: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'drawing', finish: 'finished' },
      },
    });
    this.canvas = new CanvasSession();
    this.scores = {};
    this.secretWord = null;
    this.drawerId = null;
    this.solved = new Set();
    this.usedWords = [];
    this._queue = [];
    this._totalTurns = players.length;
    this._turnNum = 0;
    this.drawPhase = 0;
    this._turnStartAt = 0;
    this._revealStartAt = 0;
    this._lastGuess = {}; // playerId -> 'wrong' | 'close' (private feedback)
    this._turnTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this._queue = [...this.players];
    for (let i = this._queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this._queue[i], this._queue[j]] = [this._queue[j], this._queue[i]]; }
    this._totalTurns = this.players.length;
    this.transition('start');
    this._setupTurn();
  }

  _setupTurn() {
    this.drawerId = this._queue.shift();
    this._turnNum++;
    const w = pickWord({ exclude: this.usedWords });
    this.secretWord = w ? w.word : 'mystery';
    this.usedWords.push(this.secretWord);
    this.solved = new Set();
    this._lastGuess = {};
    this.drawPhase++;
    this.canvas.reset();
    this.canvas.setDrawer(this.drawerId);
    this._turnStartAt = Date.now();
    this._clearTimers();
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'drawing') return;
      this._endTurn();
      this._emitChange();
    }, TURN_MS);
  }

  _guessPoints() { return Math.max(100, 350 - this.solved.size * 50); }
  _activeGuessers() { return Math.max(0, this.players.length - 1); }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'drawing' && type === 'guess') {
      if (playerId === this.drawerId) return; // the drawer cannot guess
      if (this.solved.has(playerId)) return;
      const text = String(action.text || '');
      const { correct } = isCorrectGuess(text, this.secretWord);
      if (correct) {
        this.scores[playerId] = (this.scores[playerId] || 0) + this._guessPoints();
        this.scores[this.drawerId] = (this.scores[this.drawerId] || 0) + 50;
        this.solved.add(playerId);
        delete this._lastGuess[playerId];
        if (this.solved.size >= this._activeGuessers()) this._endTurn();
      } else {
        this._lastGuess[playerId] = isCloseGuess(text, this.secretWord) ? 'close' : 'wrong';
      }
    }
  }

  _endTurn() {
    if (this.state !== 'drawing') return;
    this._clearTimers();
    this.canvas.setDrawer(null);
    this._revealStartAt = Date.now();
    this.transition('reveal');
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      this._advanceAfterReveal();
      this._emitChange();
    }, REVEAL_MS);
  }

  _advanceAfterReveal() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this._queue.length === 0) { this.transition('finish'); return; }
    this.transition('next');
    this._setupTurn();
  }

  _clearTimers() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
  }
  destroy() { this._clearTimers(); if (this.canvas) this.canvas.destroy(); this._onStateChange = null; }

  removePlayer(playerId) {
    const wasDrawer = this.drawerId === playerId && this.state === 'drawing';
    super.removePlayer(playerId);
    this.solved.delete(playerId);
    this._queue = this._queue.filter((p) => p !== playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.canvas) this.canvas.setDrawer(null);
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (wasDrawer) {
      this._endTurn(); // drawer abandoned the word → reveal + advance
    } else if (this.state === 'drawing') {
      if (this.solved.size >= this._activeGuessers()) this._endTurn();
    }
    this._emitChange();
  }

  _masked() { return this.secretWord ? this.secretWord.replace(/[A-Za-z0-9]/g, '_') : ''; }

  getStateForPlayer(playerId) {
    const revealed = this.state === 'reveal' || this.state === 'finished';
    const isDrawer = this.drawerId === playerId;
    return {
      phase: this.state,
      turnNumber: this._turnNum,
      totalTurns: this._totalTurns,
      drawerId: this.drawerId,
      isDrawer,
      word: isDrawer || revealed ? this.secretWord : null,
      maskedWord: this._masked(),
      wordLength: this.secretWord ? this.secretWord.length : 0,
      solved: [...this.solved],
      iSolved: this.solved.has(playerId),
      myGuessFeedback: this._lastGuess[playerId] || null,
      scores: { ...this.scores },
      drawPhase: this.drawPhase,
      turnEndsAt: this.state === 'drawing' ? this._turnStartAt + TURN_MS : null,
      revealEndsAt: this.state === 'reveal' ? this._revealStartAt + REVEAL_MS : null,
      myId: playerId,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return { playerId, placement, score: this.scores[playerId] || 0, handDescription: `${this.scores[playerId] || 0} pts` };
    });
  }
}
