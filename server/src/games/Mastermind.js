import { BaseGame } from './BaseGame.js';
import { TIMERS } from '../../../shared/constants.js';

const COLORS = ['R', 'O', 'Y', 'G', 'B', 'P'];
const CODE_LENGTH = 4;
const MAX_GUESSES = 10;
const ROUND_MS = TIMERS.MASTERMIND * 1000; // 120_000
const ACK_MS = 10_000;

function scoreGuess(secret, guess) {
  let black = 0;
  const sRem = [];
  const gRem = [];
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (guess[i] === secret[i]) black++;
    else { sRem.push(secret[i]); gRem.push(guess[i]); }
  }
  let white = 0;
  const pool = {};
  for (const c of sRem) pool[c] = (pool[c] || 0) + 1;
  for (const c of gRem) if (pool[c] > 0) { white++; pool[c]--; }
  return { black, white };
}

function emptyBoard() {
  return { guesses: [], solved: false, solvedAtMs: null, guessCount: 0, bestBlack: 0, bestWhite: 0 };
}

/**
 * Mastermind — simultaneous deduction race. ONE shared hidden code; every player
 * guesses independently against it and races to crack it. Fully server-authoritative:
 * the code never leaves the server until reveal, and an opponent's board (pegs/feedback)
 * is never serialized to anyone — the leaderboard shows only solved + guessCount.
 */
export class Mastermind extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { endRound: 'reveal' },
        reveal: { finish: 'finished' },
      },
    });
    this.secretCode = [];
    this.boards = {};
    this.done = new Set();
    this.acknowledged = new Set();
    this._roundStartMs = 0;
    this._roundTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.transition('start'); // -> onEnterPlaying
  }

  onEnterPlaying() {
    this.secretCode = Array.from({ length: CODE_LENGTH }, () => COLORS[Math.floor(Math.random() * COLORS.length)]);
    this._roundStartMs = Date.now();
    this.boards = {};
    for (const p of this.players) this.boards[p] = emptyBoard();
    this.done = new Set();
    this._clearTimers();
    this._roundTimer = setTimeout(() => {
      if (this.state === 'playing') { this._endRound(); this._emitChange(); }
    }, ROUND_MS);
  }

  onEnterReveal() {
    this._clearTimers();
    this.acknowledged = new Set();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._checkRevealComplete();
      this._emitChange();
    }, ACK_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'playing') {
      if (type === 'guess') {
        if (this.done.has(playerId)) return;
        const pegs = action.pegs;
        if (!Array.isArray(pegs) || pegs.length !== CODE_LENGTH) return;
        if (!pegs.every((c) => COLORS.includes(c))) return;
        const board = this.boards[playerId];
        if (!board || board.guessCount >= MAX_GUESSES) return;

        const { black, white } = scoreGuess(this.secretCode, pegs);
        board.guesses.push({ pegs: [...pegs], black, white });
        board.guessCount++;
        if (black > board.bestBlack || (black === board.bestBlack && white > board.bestWhite)) {
          board.bestBlack = black;
          board.bestWhite = white;
        }
        if (black === CODE_LENGTH) {
          board.solved = true;
          board.solvedAtMs = Date.now();
          this.done.add(playerId);
        } else if (board.guessCount >= MAX_GUESSES) {
          this.done.add(playerId);
        }
        this._checkRoundEnd();
      } else if (type === 'ping') {
        if (Date.now() >= this._roundStartMs + ROUND_MS) this._endRound();
      }
    } else if (this.state === 'reveal') {
      if (type === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealComplete();
      }
    }
  }

  _checkRoundEnd() {
    if (this.state !== 'playing') return;
    if (this.players.length > 0 && this.players.every((p) => this.done.has(p))) this._endRound();
  }

  _endRound() {
    if (this.state !== 'playing') return; // guard double-call
    this._clearTimers();
    this.transition('endRound'); // -> onEnterReveal
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (!this.players.every((p) => this.acknowledged.has(p))) return;
    this._clearTimers();
    this.transition('finish');
  }

  _clearTimers() {
    if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
  }

  removePlayer(playerId) {
    super.removePlayer(playerId);
    delete this.boards[playerId];
    if (this.done) this.done.delete(playerId);
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'playing') {
      if (this.players.every((p) => this.done.has(p))) this._endRound();
    } else if (this.state === 'reveal') {
      this._checkRevealComplete();
    }
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  getStateForPlayer(playerId) {
    const board = this.boards[playerId] || emptyBoard();
    const revealed = this.state === 'reveal' || this.state === 'finished';
    return {
      phase: this.state,
      codeLength: CODE_LENGTH,
      colors: COLORS,
      maxGuesses: MAX_GUESSES,
      roundEndMs: this.state === 'playing' ? this._roundStartMs + ROUND_MS : null,
      roundDurationSec: ROUND_MS / 1000,
      myGuesses: board.guesses.map((g) => ({ pegs: g.pegs, black: g.black, white: g.white })),
      myGuessCount: board.guessCount,
      mySolved: board.solved,
      myDone: this.done.has(playerId),
      myBestBlack: board.bestBlack,
      opponents: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        solved: (this.boards[p] && this.boards[p].solved) || false,
        guessCount: (this.boards[p] && this.boards[p].guessCount) || 0,
      })),
      secretCode: revealed ? [...this.secretCode] : null,
      results: revealed ? this.getResults() : null,
      myId: playerId,
      acknowledged: [...this.acknowledged],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const cmp = (a, b) => {
      if (a.solved !== b.solved) return (b.solved ? 1 : 0) - (a.solved ? 1 : 0);
      if (a.solved) {
        if (a.guessCount !== b.guessCount) return a.guessCount - b.guessCount;
        return (a.solvedAtMs || 0) - (b.solvedAtMs || 0);
      }
      if (a.bestBlack !== b.bestBlack) return b.bestBlack - a.bestBlack;
      if (a.bestWhite !== b.bestWhite) return b.bestWhite - a.bestWhite;
      return a.guessCount - b.guessCount;
    };
    const entries = this.players.map((p) => {
      const b = this.boards[p] || emptyBoard();
      return {
        playerId: p,
        solved: b.solved,
        guessCount: b.guessCount,
        bestBlack: b.bestBlack,
        bestWhite: b.bestWhite,
        solvedAtMs: b.solvedAtMs,
      };
    });
    entries.sort(cmp);
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && cmp(entries[i - 1], e) < 0) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        solved: e.solved,
        guessCount: e.guessCount,
        bestBlack: e.bestBlack,
        handDescription: e.solved ? `Cracked in ${e.guessCount}` : `${e.bestBlack}B ${e.bestWhite}W`,
      };
    });
  }
}
