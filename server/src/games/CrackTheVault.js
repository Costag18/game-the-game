import { BaseGame } from './BaseGame.js';

const CODE_LENGTH = 4;
const MAX_GUESSES = 12;
const ROUND_MS = 120_000;   // overall cap — guarantees termination
const GRACE_MS = 8_000;     // after the FIRST crack, others get a short grace to finish
const ACK_MS = 10_000;      // reveal auto-advance

/**
 * Score a guess against the secret code, Mastermind-style on DIGITS.
 *  - locked  = correct digit in the correct position ("black peg")
 *  - loose   = correct digit, wrong position ("white peg"), each secret/guess
 *              digit consumed at most once.
 */
function scoreGuess(secret, guess) {
  let locked = 0;
  const sRem = [];
  const gRem = [];
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (guess[i] === secret[i]) locked++;
    else { sRem.push(secret[i]); gRem.push(guess[i]); }
  }
  let loose = 0;
  const pool = {};
  for (const d of sRem) pool[d] = (pool[d] || 0) + 1;
  for (const d of gRem) if (pool[d] > 0) { loose++; pool[d]--; }
  return { locked, loose };
}

// 4 DISTINCT digits 0..9 (distinct for clarity, per spec).
function generateCode() {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, CODE_LENGTH);
}

function emptyBoard() {
  return {
    guesses: [],          // { digits:[4], locked, loose }
    guessCount: 0,
    cracked: false,
    crackedRank: null,    // 1,2,3… finish order among crackers
    crackedAtMs: null,
    bestLocked: 0,
    bestLoose: 0,
    out: false,           // exhausted MAX_GUESSES without cracking
  };
}

/**
 * Crack the Vault — numeric Mastermind RACE. The server picks ONE hidden 4-digit
 * code (distinct digits 0..9) shared by everyone; each player races to crack it on
 * their own pad. A guess returns server-computed feedback only: how many digits are
 * LOCKED (right digit, right slot) and LOOSE (right digit, wrong slot). First to 4
 * locked CRACKS it — finish order is placement. After the first crack a short grace
 * lets others finish; a 120s cap and a 12-guess-per-player cap guarantee the round ends.
 *
 * Anti-cheat: the code lives ONLY in the FSM, is generated server-side, and is NEVER
 * serialized before reveal — getStateForPlayer sends only the player's own guess
 * history + locked/loose feedback and opponents' guess COUNTS / cracked status. The
 * server validates every guess and computes feedback, so a client can't fake a crack.
 *
 * State advances are timer-driven (grace deadline, overall cap, reveal ack), so every
 * timer callback pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class CrackTheVault extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'cracking', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'cracking' },
        cracking: { reveal: 'reveal' },
        reveal: { finish: 'finished' },
      },
    });
    this.secretCode = [];
    this.boards = {};
    this.crackOrder = [];        // playerIds in crack finish order
    this.done = new Set();       // cracked OR out-of-guesses
    this.acknowledged = new Set();
    this._roundStartMs = 0;
    this._capTimer = null;       // overall 120s cap
    this._graceTimer = null;     // post-first-crack grace
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.transition('start'); // -> onEnterCracking
  }

  onEnterCracking() {
    this.secretCode = generateCode();
    this._roundStartMs = Date.now();
    this.boards = {};
    for (const p of this.players) this.boards[p] = emptyBoard();
    this.crackOrder = [];
    this.done = new Set();
    this._clearTimers();
    this._capTimer = setTimeout(() => {
      if (this.state === 'cracking') { this._endRound(); this._emitChange(); }
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

    if (this.state === 'cracking') {
      if (type === 'guess') {
        if (this.done.has(playerId)) return;
        const board = this.boards[playerId];
        if (!board || board.guessCount >= MAX_GUESSES) return;
        const digits = action.digits;
        if (!Array.isArray(digits) || digits.length !== CODE_LENGTH) return;
        if (!digits.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)) return;

        const { locked, loose } = scoreGuess(this.secretCode, digits);
        board.guesses.push({ digits: [...digits], locked, loose });
        board.guessCount++;
        if (locked > board.bestLocked || (locked === board.bestLocked && loose > board.bestLoose)) {
          board.bestLocked = locked;
          board.bestLoose = loose;
        }
        if (locked === CODE_LENGTH) {
          board.cracked = true;
          board.crackedAtMs = Date.now();
          this.crackOrder.push(playerId);
          board.crackedRank = this.crackOrder.length;
          this.done.add(playerId);
          this._onFirstCrack();
        } else if (board.guessCount >= MAX_GUESSES) {
          board.out = true;
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

  // Start the grace countdown the moment the FIRST player cracks the vault.
  _onFirstCrack() {
    if (this._graceTimer || this.crackOrder.length !== 1) return;
    this._graceTimer = setTimeout(() => {
      if (this.state === 'cracking') { this._endRound(); this._emitChange(); }
    }, GRACE_MS);
  }

  _checkRoundEnd() {
    if (this.state !== 'cracking') return;
    if (this.players.length > 0 && this.players.every((p) => this.done.has(p))) this._endRound();
  }

  _endRound() {
    if (this.state !== 'cracking') return; // guard double-call
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (!this.players.every((p) => this.acknowledged.has(p))) return;
    this._clearTimers();
    this.transition('finish');
  }

  _clearTimers() {
    for (const k of ['_capTimer', '_graceTimer', '_ackTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.boards[playerId];
    if (this.done) this.done.delete(playerId);
    if (this.acknowledged) this.acknowledged.delete(playerId);
    this.crackOrder = this.crackOrder.filter((p) => p !== playerId);
    // re-rank remaining crackers so finish order stays 1..k with no gaps
    this.crackOrder.forEach((p, i) => { if (this.boards[p]) this.boards[p].crackedRank = i + 1; });

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'cracking') {
      this._checkRoundEnd();
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
      myId: playerId,
      codeLength: CODE_LENGTH,
      maxGuesses: MAX_GUESSES,
      deadline: this.state === 'cracking' ? this._roundStartMs + ROUND_MS : null,
      graceSec: GRACE_MS / 1000,
      myGuesses: board.guesses.map((g) => ({ digits: g.digits, locked: g.locked, loose: g.loose })),
      myGuessCount: board.guessCount,
      myCracked: board.cracked,
      myCrackedRank: board.crackedRank,
      myOut: board.out,
      myDone: this.done.has(playerId),
      crackedCount: this.crackOrder.length,
      opponents: this.players.filter((p) => p !== playerId).map((p) => {
        const b = this.boards[p] || emptyBoard();
        return {
          playerId: p,
          guessCount: b.guessCount,
          cracked: b.cracked,
          crackedRank: b.crackedRank,
          out: b.out,
        };
      }),
      secretCode: revealed ? [...this.secretCode] : null,
      results: revealed ? this.getResults() : null,
      acknowledged: [...this.acknowledged],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const cmp = (a, b) => {
      if (a.cracked !== b.cracked) return (b.cracked ? 1 : 0) - (a.cracked ? 1 : 0);
      if (a.cracked) {
        // both cracked: finish order, then fewer guesses, then earlier time
        if (a.crackedRank !== b.crackedRank) return a.crackedRank - b.crackedRank;
        if (a.guessCount !== b.guessCount) return a.guessCount - b.guessCount;
        return (a.crackedAtMs || 0) - (b.crackedAtMs || 0);
      }
      // neither cracked: best progress (most locked, then most loose), then fewer guesses
      if (a.bestLocked !== b.bestLocked) return b.bestLocked - a.bestLocked;
      if (a.bestLoose !== b.bestLoose) return b.bestLoose - a.bestLoose;
      return a.guessCount - b.guessCount;
    };
    const entries = this.players.map((p) => {
      const b = this.boards[p] || emptyBoard();
      return {
        playerId: p,
        cracked: b.cracked,
        crackedRank: b.crackedRank,
        crackedAtMs: b.crackedAtMs,
        guessCount: b.guessCount,
        bestLocked: b.bestLocked,
        bestLoose: b.bestLoose,
      };
    });
    entries.sort(cmp);
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && cmp(entries[i - 1], e) < 0) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        cracked: e.cracked,
        guessCount: e.guessCount,
        bestLocked: e.bestLocked,
        handDescription: e.cracked
          ? `Cracked in ${e.guessCount}`
          : `${e.bestLocked} locked`,
      };
    });
  }
}
