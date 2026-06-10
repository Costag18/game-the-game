import { BaseGame } from './BaseGame.js';

const TOTAL_ROUNDS = 4;
const ROUND_MS = 20_000;        // round resolves after 20s (timeout = auto-bank current air)
const ACK_MS = 10_000;          // roundEnd auto-advance
const THRESHOLD_MIN = 60;
const THRESHOLD_MAX = 100;      // private burst threshold per player per round
const PUMP_MIN = 8;
const PUMP_MAX = 15;            // server-random air added per pump

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Balloon Brinkmanship — push-your-luck inflation, SIMULTANEOUS, 4 rounds.
 *
 * Each round every present player has a PRIVATE, server-random burst threshold
 * (60..100) and starts at 0 air. A {type:'pump'} adds a server-random amount
 * (8..15) to that player's air; the moment cumulative air EXCEEDS their hidden
 * threshold the balloon POPS (round banked = 0, locked for the round). A
 * {type:'bank'} banks the current air into the player's cumulative score and
 * locks them. The round resolves when every present player has banked-or-popped
 * OR the 20s timer fires (timeout = auto-bank current air). Thresholds are then
 * revealed for the round and the next begins. After 4 rounds highest cumulative
 * banked score wins; ties share a placement.
 *
 * Anti-cheat: BOTH the threshold AND every pump amount are server-generated. The
 * threshold lives ONLY in the FSM and is NEVER in getStateForPlayer pre-reveal —
 * the tension is not knowing how close you are. The client only sends pump/bank
 * intents; it never reports air or a score. Each timer path pairs with
 * `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class BalloonBrinkmanship extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'inflating', 'roundEnd', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'inflating' },
        inflating: { endRound: 'roundEnd', finish: 'finished' },
        roundEnd: { nextRound: 'inflating', finish: 'finished' },
      },
    });
    this.round = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.scores = {};            // cumulative banked score
    this.air = {};               // current round air per player
    this.thresholds = {};        // HIDDEN per-round burst threshold per player
    this.status = {};            // 'pumping' | 'banked' | 'popped'
    this.bankedThisRound = {};   // air banked this round (0 if popped)
    this.pumpCount = {};         // pumps this round (for flavor)
    this.roundReveal = null;     // thresholds + outcomes, only at roundEnd/finished
    this.roundHistory = [];
    this.acknowledged = new Set();
    this._roundTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.round = 0;
    this.scores = {};
    this.roundHistory = [];
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterInflating
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterInflating() {
    this.round++;
    this.air = {};
    this.thresholds = {};
    this.status = {};
    this.bankedThisRound = {};
    this.pumpCount = {};
    this.roundReveal = null;
    this.acknowledged = new Set();
    for (const p of this.players) {
      this.air[p] = 0;
      this.thresholds[p] = randInt(THRESHOLD_MIN, THRESHOLD_MAX);
      this.status[p] = 'pumping';
      this.pumpCount[p] = 0;
    }
    this._clearTimers();
    this._roundTimer = setTimeout(() => {
      if (this.state !== 'inflating') return;
      this._endRound(true); // timeout: auto-bank everyone still pumping
      this._emitChange();
    }, ROUND_MS);
  }

  onEnterRoundEnd() {
    this._clearTimer('_roundTimer');
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'roundEnd') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceFromRoundEnd();
      this._emitChange();
    }, ACK_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'inflating') {
      if (type === 'pump') {
        if (this.status[playerId] !== 'pumping') return; // locked (banked/popped)
        const add = randInt(PUMP_MIN, PUMP_MAX);
        this.air[playerId] += add;
        this.pumpCount[playerId] = (this.pumpCount[playerId] || 0) + 1;
        if (this.air[playerId] > this.thresholds[playerId]) {
          this.status[playerId] = 'popped';
          this.bankedThisRound[playerId] = 0; // pop → bank nothing this round
        }
        this._maybeEndRound();
      } else if (type === 'bank') {
        if (this.status[playerId] !== 'pumping') return;
        this.status[playerId] = 'banked';
        this.bankedThisRound[playerId] = this.air[playerId];
        this.scores[playerId] = (this.scores[playerId] || 0) + this.air[playerId];
        this._maybeEndRound();
      } else if (type === 'ping') {
        if (this.players.every((p) => this.status[p] !== 'pumping')) this._endRound(false);
      }
    } else if (this.state === 'roundEnd') {
      if (type === 'acknowledge' || type === 'pump' || type === 'bank') {
        this.acknowledged.add(playerId);
        if (this.players.every((p) => this.acknowledged.has(p))) this._advanceFromRoundEnd();
      }
    }
  }

  _maybeEndRound() {
    if (this.state !== 'inflating') return;
    if (this.players.every((p) => this.status[p] !== 'pumping')) this._endRound(false);
  }

  _endRound(timeout) {
    if (this.state !== 'inflating') return; // guard double-call
    this._clearTimers();
    if (timeout) {
      // anyone still pumping when the clock runs out auto-banks their current air
      for (const p of this.players) {
        if (this.status[p] === 'pumping') {
          this.status[p] = 'banked';
          this.bankedThisRound[p] = this.air[p];
          this.scores[p] = (this.scores[p] || 0) + this.air[p];
        }
      }
    }
    // Reveal thresholds + outcomes for the round (only safe to expose now).
    const outcomes = this.players.map((p) => ({
      playerId: p,
      threshold: this.thresholds[p],
      air: this.air[p],
      banked: this.bankedThisRound[p] || 0,
      status: this.status[p],
      score: this.scores[p] || 0,
    }));
    this.roundReveal = { round: this.round, outcomes };
    this.roundHistory.push(this.roundReveal);
    this.transition('endRound'); // -> onEnterRoundEnd
  }

  _advanceFromRoundEnd() {
    if (this.state !== 'roundEnd') return;
    this._clearTimer('_ackTimer');
    if (this.round >= this.totalRounds) this.transition('finish');
    else this.transition('nextRound');
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.air[playerId];
    delete this.thresholds[playerId];
    delete this.status[playerId];
    delete this.bankedThisRound[playerId];
    delete this.pumpCount[playerId];
    delete this.scores[playerId];
    if (this.acknowledged) this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'inflating') {
      this._maybeEndRound();
    } else if (this.state === 'roundEnd') {
      if (this.players.every((p) => this.acknowledged.has(p))) this._advanceFromRoundEnd();
    }
    this._emitChange();
  }

  destroy() { this._clearTimers(); this._onStateChange = null; }

  _clearTimer(name) { if (this[name]) { clearTimeout(this[name]); this[name] = null; } }
  _clearTimers() { this._clearTimer('_roundTimer'); this._clearTimer('_ackTimer'); }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const revealing = this.state === 'roundEnd' || this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      round: this.round,
      totalRounds: this.totalRounds,
      // visible reflex info: my own current air + lock status, never my threshold
      myAir: this.air[playerId] || 0,
      myStatus: this.status[playerId] || 'pumping',
      myPumpCount: this.pumpCount[playerId] || 0,
      myScore: this.scores[playerId] || 0,
      thresholdMin: THRESHOLD_MIN,
      thresholdMax: THRESHOLD_MAX,
      // others: only status + (banked air at reveal), NEVER their air mid-round
      otherPlayers: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        status: this.status[p] || 'pumping',
        score: this.scores[p] || 0,
        banked: revealing ? (this.bankedThisRound[p] || 0) : null,
        threshold: revealing ? (this.thresholds[p] ?? null) : null,
        air: revealing ? (this.air[p] || 0) : null,
      })),
      reveal: revealing ? this.roundReveal : null,
      scores: { ...this.scores },
      acknowledged: this.state === 'roundEnd' ? [...this.acknowledged] : [],
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      const pops = this.roundHistory.filter((r) => {
        const o = r.outcomes.find((x) => x.playerId === playerId);
        return o && o.status === 'popped';
      }).length;
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        pops,
        handDescription: `${this.scores[playerId] || 0} air banked${pops ? ` · ${pops} pop${pops > 1 ? 's' : ''}` : ''}`,
      };
    });
  }
}
