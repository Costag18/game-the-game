import { BaseGame } from './BaseGame.js';

const CALL_INTERVAL_MS = 3000;   // a new number is called every ~3s
const MAX_CALLS        = 45;     // game ends after this many numbers are called
const ACK_TIMEOUT_MS   = 10000;  // finished/standings auto-advance safety net
const FREE_INDEX       = 12;     // center cell (row 2, col 2) is the pre-daubed FREE space

// B-I-N-G-O column ranges: col0 1-15, col1 16-30, col2 31-45, col3 46-60, col4 61-75.
function columnRange(col) {
  const lo = col * 15 + 1;
  return { lo, hi: lo + 14 };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a random 5x5 bingo card. Index layout is row-major: index = row * 5 + col.
 * Each COLUMN draws 5 distinct numbers from its B-I-N-G-O range. Center (index 12)
 * is a FREE space (value null) that starts pre-daubed.
 */
function buildCard() {
  const cells = new Array(25).fill(0);
  for (let col = 0; col < 5; col++) {
    const { lo } = columnRange(col);
    const pool = shuffle(Array.from({ length: 15 }, (_, i) => lo + i)).slice(0, 5);
    for (let row = 0; row < 5; row++) {
      const idx = row * 5 + col;
      cells[idx] = pool[row];
    }
  }
  cells[FREE_INDEX] = null; // FREE space
  return cells;
}

// The 12 winning lines: 5 rows, 5 columns, 2 main diagonals.
const LINES = (() => {
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);  // top-left → bottom-right
  lines.push([4, 8, 12, 16, 20]);  // top-right → bottom-left
  return lines;
})();

/**
 * Bingo Brawl — real-time bingo race. The server owns the called-numbers set
 * (authoritative): it CALLS a new random unused number (1-75) every ~3s. Each
 * player holds a PRIVATE random 5x5 card; opponents see only counts, never the
 * cell values. A player daubs a cell — the server rejects the daub unless that
 * cell's number has actually been called. With any full daubed line of CALLED
 * numbers a player claims {type:'bingo'} — the server re-validates the line
 * server-side. Bingo finish order is the placement; non-finishers rank by
 * valid-daub count. End when all-but-one have bingo OR MAX_CALLS numbers called.
 *
 * Timer-driven (the caller fires from setTimeout), so every timer callback pairs
 * with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class BingoBrawl extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { finish: 'finished' },
      },
    });
    this.cards = {};            // playerId -> number[25] (null at FREE)
    this.daubed = {};           // playerId -> Set<index> (indices the player has daubed)
    this.calledOrder = [];      // numbers in the order they were called
    this.calledSet = new Set(); // fast membership check (authoritative)
    this.bingoOrder = [];       // playerIds in the order they got a valid bingo
    this.finishRank = {};       // playerId -> 1-based bingo placement
    this._callTimer = null;
    this._ackTimer = null;
    this._callDeadline = null;  // epoch ms of the next call (for client countdown)
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) {
      this.cards[p] = buildCard();
      this.daubed[p] = new Set([FREE_INDEX]); // FREE space starts daubed
    }
    this.transition('start'); // -> onEnterPlaying
  }

  // --- FSM hooks -------------------------------------------------------------

  onEnterPlaying() {
    this._clearTimers();
    this._callNumber();          // call the first number immediately
    this._armCallTimer();
  }

  onEnterFinished() { this._clearTimers(); }

  _armCallTimer() {
    this._clearCallTimer();
    this._callDeadline = Date.now() + CALL_INTERVAL_MS;
    this._callTimer = setTimeout(() => {
      if (this.state !== 'playing') return;
      this._callNumber();
      if (this.state === 'playing') this._armCallTimer();
      this._emitChange();
    }, CALL_INTERVAL_MS);
  }

  /** Draw one unused number 1-75 and add it to the authoritative called set. */
  _callNumber() {
    if (this.state !== 'playing') return;
    if (this.calledOrder.length >= MAX_CALLS) { this._finish(); return; }
    const remaining = [];
    for (let n = 1; n <= 75; n++) if (!this.calledSet.has(n)) remaining.push(n);
    if (remaining.length === 0) { this._finish(); return; }
    const n = remaining[Math.floor(Math.random() * remaining.length)];
    this.calledSet.add(n);
    this.calledOrder.push(n);
    if (this.calledOrder.length >= MAX_CALLS) this._finish();
  }

  // --- actions ---------------------------------------------------------------

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (type === 'ping') {
      // client nudge if its local call timer elapsed but no broadcast arrived
      if (this.state === 'playing' && this._callDeadline != null && Date.now() >= this._callDeadline) {
        this._callNumber();
        if (this.state === 'playing') this._armCallTimer();
      }
      return;
    }

    if (this.state !== 'playing') return;

    if (type === 'daub') {
      this._daub(playerId, action.index);
    } else if (type === 'bingo') {
      this._claimBingo(playerId);
    }
  }

  /** Validate + record a daub. Rejected unless the cell's number was called. */
  _daub(playerId, index) {
    const card = this.cards[playerId];
    if (!card) return;
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx > 24) return;
    if (idx === FREE_INDEX) return;                 // FREE is already daubed
    if (this.daubed[playerId].has(idx)) return;     // already daubed
    const value = card[idx];
    if (value == null) return;                      // shouldn't happen off-center
    if (!this.calledSet.has(value)) return;         // ANTI-CHEAT: number not called yet
    this.daubed[playerId].add(idx);
  }

  /** True if the player has at least one fully-daubed line of CALLED numbers. */
  _hasValidLine(playerId) {
    const daubed = this.daubed[playerId];
    const card = this.cards[playerId];
    if (!daubed || !card) return false;
    for (const line of LINES) {
      let ok = true;
      for (const idx of line) {
        if (idx === FREE_INDEX) continue; // FREE always counts
        if (!daubed.has(idx)) { ok = false; break; }
        if (!this.calledSet.has(card[idx])) { ok = false; break; } // re-validate
      }
      if (ok) return true;
    }
    return false;
  }

  _claimBingo(playerId) {
    if (this.finishRank[playerId]) return;          // already finished
    if (!this._hasValidLine(playerId)) return;      // ANTI-CHEAT: validate the line
    this.bingoOrder.push(playerId);
    this.finishRank[playerId] = this.bingoOrder.length;
    // End when all-but-one have a bingo.
    const remaining = this.players.filter((p) => !this.finishRank[p]);
    if (remaining.length <= 1) this._finish();
  }

  _finish() {
    if (this.state === 'finished') return;
    this._clearTimers();
    this.transition('finish'); // -> onEnterFinished
  }

  // --- leave / teardown ------------------------------------------------------

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.cards[playerId];
    delete this.daubed[playerId];
    delete this.finishRank[playerId];
    this.bingoOrder = this.bingoOrder.filter((p) => p !== playerId);
    // recompute bingo placements after pruning the leaver
    this.finishRank = {};
    this.bingoOrder.forEach((p, i) => { this.finishRank[p] = i + 1; });

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      this._emitChange();
      return;
    }
    // a leave can satisfy "all-but-one finished"
    if (this.state === 'playing') {
      const remaining = this.players.filter((p) => !this.finishRank[p]);
      if (remaining.length <= 1) this._finish();
    }
    this._emitChange();
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearCallTimer() {
    if (this._callTimer) { clearTimeout(this._callTimer); this._callTimer = null; }
  }
  _clearTimers() {
    this._clearCallTimer();
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
  }

  // --- state / results -------------------------------------------------------

  getStateForPlayer(playerId) {
    const card = this.cards[playerId] || [];
    const myDaubed = this.daubed[playerId] || new Set();
    // Build MY card with per-cell called/daubed flags. Opponent cards are NEVER sent.
    const cells = card.map((value, index) => ({
      index,
      value,                                   // my own numbers only
      free: index === FREE_INDEX,
      daubed: myDaubed.has(index),
      called: value == null ? true : this.calledSet.has(value),
    }));
    const lastCalled = this.calledOrder.length ? this.calledOrder[this.calledOrder.length - 1] : null;

    return {
      phase: this.state,
      myId: playerId,
      myCard: cells,
      hasBingo: !!this.finishRank[playerId],
      myRank: this.finishRank[playerId] || null,
      canCallBingo: this.state === 'playing' && !this.finishRank[playerId] && this._hasValidLine(playerId),
      calledNumbers: [...this.calledOrder],      // shared, authoritative
      lastCalled,
      callCount: this.calledOrder.length,
      maxCalls: MAX_CALLS,
      callDeadline: this.state === 'playing' ? this._callDeadline : null,
      opponents: this.players.filter((p) => p !== playerId).map((p) => ({
        playerId: p,
        daubCount: (this.daubed[p] ? this.daubed[p].size : 0),
        hasBingo: !!this.finishRank[p],
        rank: this.finishRank[p] || null,
      })),
      standings: this.state === 'finished'
        ? this.getResults().map((r) => ({ playerId: r.playerId, placement: r.placement, hasBingo: !!this.finishRank[r.playerId], daubCount: (this.daubed[r.playerId] ? this.daubed[r.playerId].size : 0) }))
        : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Rank: bingo finishers first (by finish order), then non-finishers by daub
    // count (descending). Ties share a placement.
    const entries = this.players.map((p) => ({
      playerId: p,
      rank: this.finishRank[p] || null,        // bingo order (lower = earlier)
      daubCount: this.daubed[p] ? this.daubed[p].size : 0,
    }));
    entries.sort((a, b) => {
      const aHas = a.rank != null;
      const bHas = b.rank != null;
      if (aHas && bHas) return a.rank - b.rank;          // both finished → by order
      if (aHas) return -1;                               // finisher beats non-finisher
      if (bHas) return 1;
      return b.daubCount - a.daubCount;                  // neither → more daubs first
    });

    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0) {
        const prev = entries[i - 1];
        const samePlacement =
          (e.rank != null && prev.rank != null && e.rank === prev.rank) ||
          (e.rank == null && prev.rank == null && e.daubCount === prev.daubCount);
        if (!samePlacement) placement = i + 1;
      }
      return {
        playerId: e.playerId,
        placement,
        gotBingo: e.rank != null,
        bingoRank: e.rank,
        daubCount: e.daubCount,
        handDescription: e.rank != null ? `BINGO #${e.rank}` : `${e.daubCount} daubs`,
      };
    });
  }
}
