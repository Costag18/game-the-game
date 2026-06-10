import { BaseGame } from './BaseGame.js';

// --- tuning -----------------------------------------------------------------
const PAD_COUNT = 4;        // coloured pads, indices 0..3
const MAX_LENGTH = 15;      // sequence length cap → game ends when reached
const STEP_FLASH_MS = 650;  // per-step on time during SHOW (server-driven)
const STEP_GAP_MS = 250;    // per-step gap between flashes during SHOW
const SHOW_LEAD_MS = 800;   // pause before the sequence starts flashing
const SHOW_TAIL_MS = 400;   // pause after the last flash before INPUT
const INPUT_BASE_MS = 5000; // base input window
const INPUT_PER_STEP_MS = 1200; // extra per sequence step (longer = more time)
const ACK_MS = 10_000;      // reveal auto-advance

/**
 * Echo Chamber — Simon / sequence-memory RACE. A single growing SEQUENCE of pad
 * indices (0..3) is generated server-side, one new step appended each ROUND.
 *
 * Each round: a SHOW phase flashes the FULL sequence in sync across all clients
 * (the server emits the sequence + per-step timing and runs a timer for the flash
 * window), then an INPUT phase where every still-alive player taps the pads back
 * in order. A correct full reproduction advances that player to the next (longer)
 * round; ONE wrong tap eliminates them at their current depth (= the longest
 * sequence length they had already reproduced). Input resolves when all alive
 * players finish-or-fail OR the input timer expires. Continues until everyone is
 * eliminated or MAX_LENGTH is reached. Players are ranked by DEPTH reached (ties
 * share a placement).
 *
 * Server-authoritative / anti-cheat: the sequence lives ONLY in the FSM. During
 * INPUT, getStateForPlayer does NOT resend the sequence (the player must remember
 * it) — it sends only their own progress (taps entered so far) + alive status.
 * Every tap is validated against the secret sequence server-side, so a client can
 * never claim a solve it didn't make. The SHOW phase only sends the sequence while
 * `phase === 'show'` (it's being flashed to everyone anyway).
 *
 * Timer-driven transitions all pair with `_emitChange()` per the v2.7.0 contract.
 */
export class EchoChamber extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'show', 'input', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'show' },
        show: { beginInput: 'input' },
        input: { endRound: 'reveal' },
        reveal: { nextRound: 'show', finish: 'finished' },
      },
    });
    this.sequence = [];          // the secret growing sequence of pad indices
    this.round = 0;              // 1-based round number == current sequence length
    this.alive = new Set();      // players still in (reproduced every prior round)
    this.depth = {};             // pid -> longest sequence length fully reproduced
    this.progress = {};          // pid -> taps entered this round
    this.failedThisRound = new Set(); // pids that mistapped this round
    this.doneThisRound = new Set();   // pids that finished-or-failed this round
    this.acknowledged = new Set();
    this._showStartMs = 0;
    this._showTimer = null;
    this._inputTimer = null;
    this._ackTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  // --- lifecycle -------------------------------------------------------------

  startGame() {
    this.sequence = [];
    this.round = 0;
    this.alive = new Set(this.players);
    this.depth = {};
    for (const p of this.players) this.depth[p] = 0;
    this.transition('start'); // -> onEnterShow
  }

  _showDurationMs() {
    // lead + (flash+gap) per step + tail
    return SHOW_LEAD_MS + this.sequence.length * (STEP_FLASH_MS + STEP_GAP_MS) + SHOW_TAIL_MS;
  }

  _inputDurationMs() {
    return INPUT_BASE_MS + this.sequence.length * INPUT_PER_STEP_MS;
  }

  onEnterShow() {
    // append a new random step → grow the sequence by one
    this.round++;
    this.sequence.push(Math.floor(Math.random() * PAD_COUNT));
    this.progress = {};
    this.doneThisRound = new Set();
    this.failedThisRound = new Set();
    for (const p of this.alive) this.progress[p] = [];
    this._showStartMs = Date.now();
    this._clearTimers();
    this._showTimer = setTimeout(() => {
      if (this.state !== 'show') return;
      this.transition('beginInput'); // -> onEnterInput
      this._emitChange();
    }, this._showDurationMs());
  }

  onEnterInput() {
    this._clearTimers();
    this._inputTimer = setTimeout(() => {
      if (this.state !== 'input') return;
      this._endRound();
      this._emitChange();
    }, this._inputDurationMs());
    // a round with no alive players (all left) should just end
    this._maybeEndRoundEarly();
  }

  onEnterReveal() {
    this._clearTimers();
    this.acknowledged = new Set();
    this._ackTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceFromReveal();
      this._emitChange();
    }, ACK_MS);
  }

  onEnterFinished() { this._clearTimers(); }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'show') {
      if (type === 'ping') {
        if (Date.now() >= this._showStartMs + this._showDurationMs()) {
          this.transition('beginInput');
        }
      }
      return;
    }

    if (this.state === 'input') {
      if (type === 'tap') {
        this._handleTap(playerId, action.pad);
      } else if (type === 'ping') {
        if (Date.now() >= this._showStartMs + this._showDurationMs() + this._inputDurationMs()) {
          this._endRound();
        }
      }
      return;
    }

    if (this.state === 'reveal') {
      if (type === 'acknowledge') {
        this.acknowledged.add(playerId);
        this._checkRevealAck();
      }
    }
  }

  _handleTap(playerId, pad) {
    if (!this.alive.has(playerId)) return;          // eliminated players can't tap
    if (this.doneThisRound.has(playerId)) return;   // already finished this round
    const idx = Number(pad);
    if (!Number.isInteger(idx) || idx < 0 || idx >= PAD_COUNT) return; // illegal pad

    const entered = this.progress[playerId] || (this.progress[playerId] = []);
    const pos = entered.length;
    const expected = this.sequence[pos];

    if (idx !== expected) {
      // ONE wrong tap eliminates the player at their current depth
      this.failedThisRound.add(playerId);
      this.doneThisRound.add(playerId);
      this.alive.delete(playerId);
      this._removeFromActive(playerId);
      this._checkRoundComplete();
      return;
    }

    entered.push(idx);
    if (entered.length === this.sequence.length) {
      // full correct reproduction → advance depth
      this.depth[playerId] = this.sequence.length;
      this.doneThisRound.add(playerId);
      this._checkRoundComplete();
    }
  }

  // --- round resolution ------------------------------------------------------

  _maybeEndRoundEarly() {
    this._checkRoundComplete();
  }

  _checkRoundComplete() {
    if (this.state !== 'input') return;
    // every still-alive player has finished-or-failed?
    const aliveList = [...this.alive];
    const pending = aliveList.filter((p) => !this.doneThisRound.has(p));
    // players who failed are removed from alive but are in doneThisRound; survivors
    // that finished correctly are also in doneThisRound. So round ends when no alive
    // player is still mid-entry.
    if (pending.length === 0) this._endRound();
  }

  _endRound() {
    if (this.state !== 'input') return; // guard double-call
    this._clearTimers();
    // any alive player who never finished entering counts as a fail at this depth
    for (const p of [...this.alive]) {
      if (!this.doneThisRound.has(p)) {
        // didn't complete the sequence in time → eliminated at current depth
        this.failedThisRound.add(p);
        this.alive.delete(p);
        this._removeFromActive(p);
      }
    }
    this.transition('endRound'); // -> onEnterReveal
  }

  _advanceFromReveal() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    // continue while at least one player is alive AND the cap isn't hit
    if (this.alive.size >= 1 && this.sequence.length < MAX_LENGTH) {
      this.transition('nextRound'); // -> onEnterShow (grows sequence)
    } else {
      this.transition('finish');
    }
  }

  _checkRevealAck() {
    if (this.state !== 'reveal') return;
    if (!this.players.every((p) => this.acknowledged.has(p))) return;
    this._advanceFromReveal();
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.alive.delete(playerId);
    delete this.depth[playerId];
    delete this.progress[playerId];
    this.failedThisRound.delete(playerId);
    this.doneThisRound.delete(playerId);
    this.acknowledged.delete(playerId);

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'input') {
      this._checkRoundComplete();
    } else if (this.state === 'reveal') {
      this._checkRevealAck();
    }
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    for (const k of ['_showTimer', '_inputTimer', '_ackTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const showing = this.state === 'show';
    const revealing = this.state === 'reveal' || this.state === 'finished';
    const myProgress = this.progress[playerId] || [];
    return {
      phase: this.state,
      myId: playerId,
      padCount: PAD_COUNT,
      round: this.round,
      maxLength: MAX_LENGTH,
      seqLength: this.sequence.length,
      // The sequence is sent ONLY while it is being flashed to everyone (SHOW).
      // During INPUT it is NEVER sent — the player must remember it.
      sequence: showing ? [...this.sequence] : null,
      // server-driven flash timing so all clients flash in sync
      showTiming: showing
        ? {
            startMs: this._showStartMs,
            leadMs: SHOW_LEAD_MS,
            flashMs: STEP_FLASH_MS,
            gapMs: STEP_GAP_MS,
          }
        : null,
      deadline: this._deadline(),
      // my own progress only
      myAlive: this.alive.has(playerId),
      myDepth: this.depth[playerId] || 0,
      myTapsEntered: this.state === 'input' ? myProgress.length : 0,
      myDoneThisRound: this.doneThisRound.has(playerId),
      myFailedThisRound: this.failedThisRound.has(playerId),
      // opponents: only counts + alive status, NEVER their entered taps
      opponents: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        alive: this.alive.has(p),
        depth: this.depth[p] || 0,
        tapsEntered: this.state === 'input' ? (this.progress[p] || []).length : 0,
        doneThisRound: this.doneThisRound.has(p),
      })),
      aliveCount: this.alive.size,
      results: revealing ? this.getResults() : null,
      // reveal the full sequence at round reveal so survivors can verify
      revealedSequence: revealing ? [...this.sequence] : null,
      acknowledged: [...this.acknowledged],
    };
  }

  _deadline() {
    if (this.state === 'show') return this._showStartMs + this._showDurationMs();
    if (this.state === 'input') return this._showStartMs + this._showDurationMs() + this._inputDurationMs();
    return null;
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // rank by depth DESC (longest sequence reproduced); ties share a placement
    const entries = this.players.map((p) => ({
      playerId: p,
      depth: this.depth[p] || 0,
    }));
    entries.sort((a, b) => b.depth - a.depth);
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.depth < entries[i - 1].depth) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        depth: e.depth,
        handDescription: e.depth > 0 ? `Reached length ${e.depth}` : 'Out at length 1',
      };
    });
  }
}
