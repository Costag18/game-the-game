import { BaseGame } from './BaseGame.js';

// ---- tuning ------------------------------------------------------------------
const START_BANKROLL = 100;
const JACKPOT = 50;
const TICK_COST = 5;
const TICK_MS = 8_000;   // window for each RAISE/DROP decision
const REVEAL_MS = 3_000; // pause to show who dropped before the next tick
const ACK_MS = 10_000;   // final scoreboard auto-advance

/**
 * Last Bid Standing — an ALL-PAY attrition auction for ONE jackpot.
 *
 * Every player starts with an equal private bankroll. The game runs in TICKS: on
 * each tick every player still IN must choose RAISE or DROP within a window.
 * Everyone who RAISEs PAYS the tick cost from their bankroll (ALL-PAY — you pay
 * even if you ultimately lose) and stays in; DROP takes you out for good. A
 * player who can't afford the tick auto-drops. When exactly ONE player remains
 * IN, they win the jackpot (added to their tournament score). Ranking is
 * reverse-elimination like Spoons: the last one standing is 1st, then by drop
 * order (a later drop ranks better); players who drop on the SAME tick share a
 * placement.
 *
 * Server-authoritative anti-cheat:
 *  - ALL money lives only on the server. Bids are deducted server-side; a client
 *    can never spend more than its bankroll or claim an unearned jackpot.
 *  - A player's CHOICE this tick is hidden from everyone (including from
 *    getStateForPlayer of other players) until the tick resolves. Opponents see
 *    only "still in" + their public bankroll/sunk — never this tick's pending
 *    RAISE/DROP. Each player sees only their own pending choice.
 */
export class LastBidStanding extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'tick', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'tick' },
        tick: { resolve: 'reveal', finish: 'finished' },
        reveal: { next: 'tick', finish: 'finished' },
      },
    });
    this.jackpot = JACKPOT;
    this.tickCost = TICK_COST;
    this.startBankroll = START_BANKROLL;
    this.bankroll = {};       // pid -> coins remaining
    this.sunk = {};           // pid -> total all-pay coins spent
    this.inPlayers = [...players];       // still IN, seat order
    this.dropOrder = [];      // array of arrays: dropOrder[i] = ids that dropped on tick i (earliest first)
    this.winner = null;
    this.tickNumber = 0;
    this.deadline = 0;        // wall-clock ms when the current tick auto-resolves
    this.choices = {};        // pid -> 'raise' | 'drop' (HIDDEN — this tick only)
    this.lastReveal = null;   // summary of the tick just resolved
    this.acknowledged = new Set();
    this._tickTimer = null;
    this._revealTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) { this.bankroll[p] = this.startBankroll; this.sunk[p] = 0; }
    this.transition('start'); // -> onEnterTick
  }

  // ---------- TICK ----------
  onEnterTick() {
    this.tickNumber++;
    this.choices = {};
    this.deadline = Date.now() + TICK_MS;
    this._clearTimer('_tickTimer');
    this._tickTimer = setTimeout(() => {
      if (this.state !== 'tick') return;
      this._resolveTick();
      this._emitChange();
    }, TICK_MS);
    // A player who cannot afford the tick auto-drops immediately.
    for (const p of this.inPlayers) {
      if (this.bankroll[p] < this.tickCost) this.choices[p] = 'drop';
    }
    this._emitChange();
    this._maybeResolveEarly();
  }

  _canAfford(pid) { return this.bankroll[pid] >= this.tickCost; }

  // Resolve as soon as every still-IN player has chosen (no need to wait the window).
  _maybeResolveEarly() {
    if (this.state !== 'tick') return;
    if (this.inPlayers.every((p) => this.choices[p] !== undefined)) this._resolveTick();
  }

  _resolveTick() {
    if (this.state !== 'tick') return;
    this._clearTimer('_tickTimer');

    // Non-responders DROP (timeout path); broke players already auto-dropped.
    for (const p of this.inPlayers) if (this.choices[p] === undefined) this.choices[p] = 'drop';

    const raisers = this.inPlayers.filter((p) => this.choices[p] === 'raise');
    const droppers = this.inPlayers.filter((p) => this.choices[p] === 'drop');

    // ALL-PAY: every raiser pays the tick cost now (server-authoritative deduction).
    const payments = {};
    for (const p of raisers) {
      this.bankroll[p] -= this.tickCost;
      this.sunk[p] += this.tickCost;
      payments[p] = this.tickCost;
    }

    // Special case: EVERYONE dropped this tick (e.g. all broke / all timed out
    // simultaneously). Nobody raised — the players who dropped this tick all
    // share the last placement; the best-ranked among them is whoever was IN.
    // With nobody raising there is no survivor, so the whole IN set drops together
    // and the winner is decided by reverse order — they all tie for last. To keep
    // a single jackpot winner we treat a tie-to-zero as: all share this drop tick.
    if (raisers.length === 0) {
      // All remaining players are out on the same tick → they share a placement.
      this.dropOrder.push([...this.inPlayers]);
      this.inPlayers = [];
    } else {
      // Droppers are out for good this tick (they share a placement among themselves).
      if (droppers.length > 0) this.dropOrder.push([...droppers]);
      for (const p of droppers) this._removeFromActive(p);
      this.inPlayers = raisers;
    }

    this.lastReveal = {
      tickNumber: this.tickNumber,
      raisers: [...raisers],
      droppers: [...droppers],
      payments,
      remainingIn: [...this.inPlayers],
      tickCost: this.tickCost,
    };

    // Did we reach a single winner (or wipe out)?
    if (this.inPlayers.length === 1) {
      this.winner = this.inPlayers[0];
      this.bankroll[this.winner] += this.jackpot; // jackpot credited to bankroll display
      this.transition('resolve'); // -> onEnterReveal (final reveal then finish)
    } else if (this.inPlayers.length === 0) {
      // No survivor (all dropped together) → no jackpot winner.
      this.winner = null;
      this.transition('resolve');
    } else {
      this.transition('resolve'); // -> onEnterReveal (intermission, then next tick)
    }
  }

  // ---------- REVEAL (intermission between ticks / final) ----------
  onEnterReveal() {
    this.acknowledged = new Set();
    const isFinal = this.inPlayers.length <= 1;
    this._clearTimer('_revealTimer');
    this._clearTimer('_ackTimer');
    if (isFinal) {
      // Final scoreboard: longer ack window.
      this._ackTimer = setTimeout(() => {
        if (this.state !== 'reveal') return;
        this._advanceAfterReveal();
        this._emitChange();
      }, ACK_MS);
    } else {
      // Short intermission before the next tick.
      this._revealTimer = setTimeout(() => {
        if (this.state !== 'reveal') return;
        this._advanceAfterReveal();
        this._emitChange();
      }, REVEAL_MS);
    }
  }

  _advanceAfterReveal() {
    if (this.state !== 'reveal') return;
    this._clearTimer('_revealTimer');
    this._clearTimer('_ackTimer');
    if (this.inPlayers.length <= 1) this.transition('finish'); // -> onEnterFinished
    else this.transition('next'); // -> onEnterTick
  }

  _checkAckComplete() {
    if (this.state !== 'reveal') return;
    if (this.inPlayers.length > 1) return; // only the final scoreboard waits on acks
    const voters = this.players; // everyone left in the roster
    if (voters.every((p) => this.acknowledged.has(p))) this._advanceAfterReveal();
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'tick' && (type === 'raise' || type === 'drop')) {
      this._handleChoice(playerId, type);
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkAckComplete();
      this._emitChange();
    } else if (type === 'ping') {
      // client-side fallback if its local timer expired before the server transition
      if (this.state === 'tick' && Date.now() >= this.deadline) { this._resolveTick(); this._emitChange(); }
    }
  }

  _handleChoice(playerId, type) {
    if (!this.inPlayers.includes(playerId)) return;     // dropped/eliminated can't act
    if (this.choices[playerId] !== undefined) return;   // one choice per tick (no take-backs)
    if (type === 'raise' && !this._canAfford(playerId)) {
      // Can't afford → treated as a drop (server is the authority on the bankroll).
      this.choices[playerId] = 'drop';
    } else {
      this.choices[playerId] = type;
    }
    this._emitChange();
    this._maybeResolveEarly();
  }

  // ---------- TIMERS ----------
  _clearTimer(name) { if (this[name]) { clearTimeout(this[name]); this[name] = null; } }
  _clearTimers() { this._clearTimer('_tickTimer'); this._clearTimer('_revealTimer'); this._clearTimer('_ackTimer'); }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    const wasIn = this.inPlayers.includes(playerId);
    super.removePlayer(playerId); // prunes this.players + activePlayers rotation
    this.inPlayers = this.inPlayers.filter((p) => p !== playerId);
    delete this.choices[playerId];
    delete this.bankroll[playerId];
    delete this.sunk[playerId];
    this.acknowledged.delete(playerId);
    // Prune from any drop-order bucket so a leaver is never ranked.
    this.dropOrder = this.dropOrder.map((b) => b.filter((p) => p !== playerId)).filter((b) => b.length > 0);
    if (this.winner === playerId) this.winner = null;

    if (this.players.length <= 1) {
      this._clearTimers();
      // Whoever (if anyone) is still IN becomes the winner.
      if (this.inPlayers.length === 1 && this.winner !== this.inPlayers[0]) {
        this.winner = this.inPlayers[0];
      }
      if (this.state !== 'finished') this.state = 'finished';
      this._emitChange();
      return;
    }

    if (this.state === 'tick' && wasIn) {
      // One fewer racer — if everyone still IN has chosen, resolve now.
      if (this.inPlayers.length === 1) {
        // Only one left IN: they win by walkover.
        this._resolveTick();
      } else {
        this._maybeResolveEarly();
      }
    } else if (this.state === 'reveal') {
      this._checkAckComplete();
    }
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const phase = this.state;
    const myChoice = this.choices[playerId] !== undefined ? this.choices[playerId] : null;
    return {
      phase,
      jackpot: this.jackpot,
      tickCost: this.tickCost,
      tickNumber: this.tickNumber,
      startBankroll: this.startBankroll,
      myId: playerId,
      myBankroll: this.bankroll[playerId] != null ? this.bankroll[playerId] : 0,
      mySunk: this.sunk[playerId] != null ? this.sunk[playerId] : 0,
      iAmIn: this.inPlayers.includes(playerId),
      myChoice,                                   // ONLY my own pending choice
      hasChosen: this.choices[playerId] !== undefined,
      // deadline only exposed during an open tick
      deadline: phase === 'tick' ? this.deadline : null,
      // Public per-player state — NEVER includes opponents' pending choices.
      players: this.players.map((p) => ({
        playerId: p,
        isMe: p === playerId,
        bankroll: this.bankroll[p] != null ? this.bankroll[p] : 0,
        sunk: this.sunk[p] != null ? this.sunk[p] : 0,
        in: this.inPlayers.includes(p),
        // who has locked a choice this tick (count only — not WHAT they chose)
        locked: phase === 'tick' ? (this.choices[p] !== undefined) : false,
      })),
      inCount: this.inPlayers.length,
      lockedCount: phase === 'tick' ? Object.keys(this.choices).length : 0,
      reveal: phase === 'reveal' || phase === 'finished' ? this.lastReveal : null,
      winner: phase === 'finished' || (phase === 'reveal' && this.inPlayers.length <= 1) ? this.winner : null,
      acknowledged: phase === 'reveal' ? [...this.acknowledged] : [],
      results: phase === 'finished' ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Reverse-elimination ranking: winner (last standing) first, then later drops
    // rank better than earlier drops. dropOrder is earliest-first, so reversing it
    // puts the latest droppers near the top. Players in the SAME drop bucket share
    // a placement.
    const tiers = []; // each tier = array of pids sharing a placement, best first
    if (this.winner && this.players.includes(this.winner)) tiers.push([this.winner]);
    // anyone still IN but not the recorded winner (e.g. multi-survivor via leave) ranks next
    const stillIn = this.inPlayers.filter((p) => p !== this.winner && this.players.includes(p));
    if (stillIn.length) tiers.push(stillIn);
    for (let i = this.dropOrder.length - 1; i >= 0; i--) {
      const bucket = this.dropOrder[i].filter((p) => this.players.includes(p));
      if (bucket.length) tiers.push(bucket);
    }
    // any roster player not yet placed (safety net) → last
    const placed = new Set(tiers.flat());
    const leftover = this.players.filter((p) => !placed.has(p));
    if (leftover.length) tiers.push(leftover);

    const results = [];
    let placement = 1;
    for (const tier of tiers) {
      for (const pid of tier) {
        results.push({
          playerId: pid,
          placement,
          isWinner: pid === this.winner,
          bankroll: this.bankroll[pid] != null ? this.bankroll[pid] : 0,
          sunk: this.sunk[pid] != null ? this.sunk[pid] : 0,
          handDescription: pid === this.winner
            ? `Won the ${this.jackpot} jackpot 💰`
            : `Sunk ${this.sunk[pid] != null ? this.sunk[pid] : 0}, dropped out`,
        });
      }
      placement += tier.length; // next tier's placement skips past the tie
    }
    return results;
  }
}
