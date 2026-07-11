import { BaseGame } from './BaseGame.js';

const TARGET_SCORE = 100;   // first to bank this much triggers game end after the round completes
const MAX_ROUNDS   = 20;    // hard cap on full rotations to guarantee termination
const TURN_MS      = 30_000; // per-turn timer: auto-BANKS on timeout
const END_ACK_MS   = 10_000; // gameOver ack auto-advance

/** Server-owned die roll (1..6). The client never generates the value. */
function rollDie() { return 1 + Math.floor(Math.random() * 6); }

/**
 * Press Your Luck Pigs — push-your-luck dice (Pig). Turn-based around this.players.
 *
 * On your turn you build a TURN POT: each {type:'roll'} adds a die (1-6) to the pot,
 * but rolling a 1 BUSTS — the turn pot is lost and your turn ends with 0 banked.
 * {type:'bank'} adds the turn pot to your permanent score and ends your turn.
 * A 30s per-turn timer auto-BANKS on timeout. First to TARGET_SCORE (checked when a
 * full rotation completes) — or MAX_ROUNDS rotations — ends the game.
 *
 * Server-authoritative anti-cheat: the die value is generated server-side; only the
 * current player may roll/bank; getStateForPlayer reveals only public info (banked
 * scores, whose turn, the live turn pot + last die). There is no hidden hand to leak,
 * but a player can never act out of turn and the RNG is never client-driven.
 *
 * Timer-driven advances pair with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class PressYourLuckPigs extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'turn', 'bust', 'gameOver', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting:  { start: 'turn' },
        turn:     { bust: 'bust', endGame: 'gameOver', nextTurn: 'turn' },
        bust:     { nextTurn: 'turn', endGame: 'gameOver' },
        gameOver: { finish: 'finished' },
      },
    });
    this.scores = {};
    this.turnPot = 0;
    this.lastRoll = null;       // last die shown this turn
    this.rollCount = 0;         // dice in the current turn pot
    this.bustPlayer = null;     // who just busted (for the bust flash)
    this.round = 0;             // completed full rotations
    this.maxRounds = MAX_ROUNDS;
    this.target = TARGET_SCORE;
    this.acknowledged = new Set();
    this._turnTimer = null;
    this._bustTimer = null;
    this._endTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.round = 0;
    this.setTurnPlayer(this.players[0]);
    this.transition('start'); // -> onEnterTurn
  }

  // ---------- TURN ----------
  onEnterTurn() {
    this.turnPot = 0;
    this.lastRoll = null;
    this.rollCount = 0;
    this._clearTimers();
    this._armTurnTimer();
  }

  _armTurnTimer() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    this._turnDeadline = Date.now() + TURN_MS;
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'turn') return;
      this._bank(this.currentTurnPlayer); // auto-BANK on timeout
      this._emitChange();
    }, TURN_MS);
  }

  // ---------- BUST ----------
  onEnterBust() {
    // turn pot is forfeited; brief flash before passing the dice
    this._clearTimers();
    this._bustTimer = setTimeout(() => {
      if (this.state !== 'bust') return;
      this._passOrEnd();
      this._emitChange();
    }, 2_500);
  }

  // ---------- GAME OVER ----------
  onEnterGameOver() {
    this._clearTimers();
    this.acknowledged = new Set();
    this._endTimer = setTimeout(() => {
      if (this.state !== 'gameOver') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._finish();
      this._emitChange();
    }, END_ACK_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- CORE ----------
  _roll(playerId) {
    if (this.state !== 'turn') return;
    if (playerId !== this.currentTurnPlayer) return;
    const die = rollDie();
    this.lastRoll = die;
    this.rollCount++;
    if (die === 1) {
      this.turnPot = 0;
      this.bustPlayer = playerId;
      this.transition('bust'); // -> onEnterBust
    } else {
      this.turnPot += die;
      this._armTurnTimer(); // each action resets the 30s clock
    }
  }

  _bank(playerId) {
    if (this.state !== 'turn') return;
    if (playerId !== this.currentTurnPlayer) return;
    this.scores[playerId] = (this.scores[playerId] || 0) + this.turnPot;
    this.turnPot = 0;
    this._passOrEnd();
  }

  /**
   * Advance to the next player; when a full rotation completes, bump the round
   * counter and check the end conditions (someone reached target, or round cap).
   * Works from both 'turn' (after bank) and 'bust' (after the flash).
   */
  _passOrEnd() {
    this._clearTimers();
    if (this.players.length === 0) { this._finishNow(); return; }

    const wasLast = this.currentTurnPlayer === this.players[this.players.length - 1];
    this.nextTurn(); // rotates activePlayers (== players here) and sets currentTurnPlayer
    if (wasLast) this.round++;

    const someoneWon = this.players.some((p) => (this.scores[p] || 0) >= this.target);
    const capReached = this.round >= this.maxRounds;

    // End the game fairly: only at the top of a fresh rotation, so everyone has had
    // an equal number of turns (someone hit the target) — or the round cap is hit.
    if ((wasLast && someoneWon) || capReached) {
      this.transition('endGame'); // (turn|bust) -> gameOver
      return;
    }

    this.bustPlayer = null;
    this.transition('nextTurn'); // (turn|bust) -> turn (re-enters onEnterTurn, resets pot/timer)
  }

  _finish() {
    if (this.state !== 'gameOver') return;
    this._clearTimers();
    this.transition('finish');
  }

  _finishNow() {
    this._clearTimers();
    if (this.state !== 'finished') this.state = 'finished';
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'turn') {
      if (type === 'roll') this._roll(playerId);
      else if (type === 'bank') this._bank(playerId);
      else if (type === 'ping') {
        // client fallback if its local turn timer expired and server hasn't advanced
        if (playerId === this.currentTurnPlayer) this._bank(playerId);
      }
    } else if (this.state === 'gameOver') {
      if (type === 'acknowledge' || type === 'ping') {
        this.acknowledged.add(playerId);
        if (this.players.every((p) => this.acknowledged.has(p))) this._finish();
      }
    }
  }

  // ---------- LEAVE / TEARDOWN ----------
  removePlayer(playerId) {
    const wasCurrent = this.currentTurnPlayer === playerId;
    const leavingDuringTurn = this.state === 'turn' && wasCurrent;
    super.removePlayer(playerId); // prunes this.players + activePlayers, reassigns turn if needed
    delete this.scores[playerId];
    if (this.bustPlayer === playerId) this.bustPlayer = null;
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      this._emitChange();
      return;
    }

    if (leavingDuringTurn) {
      // the leaver was mid-turn: forfeit their pot and start a fresh turn for the
      // player super.removePlayer rotated to (currentTurnPlayer now points at them).
      this.turnPot = 0;
      this.lastRoll = null;
      this.rollCount = 0;
      this.bustPlayer = null;
      this._clearTimers();
      this._armTurnTimer();
    } else if (this.state === 'gameOver') {
      if (this.players.every((p) => this.acknowledged.has(p))) this._finish();
    }
    this._emitChange();
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    for (const k of ['_turnTimer', '_bustTimer', '_endTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // ---------- STATE ----------
  getStateForPlayer(playerId) {
    return {
      phase: this.state,
      myId: playerId,
      isMyTurn: this.state === 'turn' && this.currentTurnPlayer === playerId,
      currentTurnPlayer: this.currentTurnPlayer,
      turnPot: this.turnPot,
      lastRoll: this.lastRoll,
      rollCount: this.rollCount,
      bustPlayer: this.state === 'bust' ? this.bustPlayer : null,
      busted: this.state === 'bust',
      round: this.round,
      maxRounds: this.maxRounds,
      target: this.target,
      turnDeadline: (this.state === 'turn' && this._turnTimer)
        ? this._turnDeadline
        : null,
      scores: { ...this.scores },
      players: [...this.players],
      acknowledged: this.state === 'gameOver' ? [...this.acknowledged] : [],
      results: this.state === 'finished' || this.state === 'gameOver' ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // highest banked score wins → sort DESCENDING; ties share a placement
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} banked`,
      };
    });
  }
}
