import { BaseGame } from './BaseGame.js';

const HAND_SIZE = 7;
const TURN_MS = 30_000;       // per-turn timer; auto-plays/draws/passes the staller
const ACK_TIMEOUT_MS = 10_000; // finished-screen / over auto-advance safety (unused at finish, kept for parity)

/** Build a shuffled double-six boneyard: 28 tiles [a,b] with 0<=a<=b<=6. */
function buildBoneyard() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) tiles.push([a, b]);
  }
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

const pipSum = (tile) => tile[0] + tile[1];
const handPips = (hand) => hand.reduce((s, t) => s + pipSum(t), 0);

/**
 * Domino Drift — Mexican-Train-lite. Turn-based score race. Each player holds a
 * PRIVATE hand of 7 tiles. A central train has two open ends (L pip / R pip). On
 * your turn you PLAY a tile that matches an open end (either half matches; it
 * attaches and the train's open end on that side becomes the tile's other half),
 * or DRAW one tile from the boneyard, or PASS if you can't play.
 *
 * First to empty their hand ends the game (they place 1st). Everyone else is
 * ranked ASCENDING by remaining pip-sum (fewer pips = better). If the game locks
 * (boneyard empty and all players pass in a row), everyone is ranked by pip-sum.
 *
 * Server-authoritative anti-cheat: a player's hand lives only on the server;
 * getStateForPlayer sends pid's OWN tiles and only COUNTS for opponents. Every
 * action is validated (your turn, tile in your hand, the half actually matches
 * the chosen open end). The turn timer auto-acts for a staller per the v2.7.0
 * broadcast contract (every timer callback pairs with _emitChange()).
 */
export class DominoDrift extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'playing', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'playing' },
        playing: { finish: 'finished' },
      },
    });
    this.hands = {};            // pid -> array of [a,b] tiles (private)
    this.boneyard = [];
    this.train = [];            // ordered tiles laid down (oriented L..R)
    this.leftEnd = null;        // open pip on the left
    this.rightEnd = null;       // open pip on the right
    this.consecutivePasses = 0; // lock detection
    this.lastEvent = null;      // small public log of the most recent move
    this.winnerId = null;       // first to empty hand (or null if locked)
    this.endReason = null;      // 'emptied' | 'locked'
    this.turnDeadline = null;   // epoch ms for client countdown
    this._turnTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.boneyard = buildBoneyard();
    for (const p of this.players) {
      this.hands[p] = this.boneyard.splice(0, HAND_SIZE);
    }
    // Seed the train from the next boneyard tile (guaranteed non-empty: 28 - N*7 >= 0
    // for N<=4; for larger N seed from a player's tile if needed).
    let seed = this.boneyard.shift();
    if (!seed) {
      // Boneyard exhausted by dealing (5+ players): pull the seed from the
      // player holding the most pips so play can begin.
      let donor = this.players[0];
      for (const p of this.players) if (handPips(this.hands[p]) > handPips(this.hands[donor])) donor = p;
      seed = this.hands[donor].pop();
    }
    this.train = [[...seed]];
    this.leftEnd = seed[0];
    this.rightEnd = seed[1];
    this.consecutivePasses = 0;
    this.lastEvent = { kind: 'seed', tile: [...seed] };
    this.transition('start'); // -> onEnterPlaying
    this.setTurnPlayer(this.players[0]);
    this._armTurnTimer();
  }

  onEnterPlaying() { /* turn player + timer armed by startGame */ }
  onEnterFinished() { this._clearTimers(); this.turnDeadline = null; }

  // ---- turn timer -----------------------------------------------------------

  _armTurnTimer() {
    this._clearTimers();
    if (this.state !== 'playing') return;
    this.turnDeadline = Date.now() + TURN_MS;
    this._turnTimer = setTimeout(() => {
      if (this.state !== 'playing') return;
      this._autoAct(this.currentTurnPlayer);
      this._emitChange();
    }, TURN_MS);
  }

  /** Auto-resolve a turn: play the first legal tile, else draw (if any), else pass. */
  _autoAct(pid) {
    if (this.state !== 'playing' || pid == null) return;
    const hand = this.hands[pid] || [];
    for (let i = 0; i < hand.length; i++) {
      const t = hand[i];
      if (t[0] === this.leftEnd || t[1] === this.leftEnd) { this._play(pid, i, 'L'); return; }
      if (t[0] === this.rightEnd || t[1] === this.rightEnd) { this._play(pid, i, 'R'); return; }
    }
    if (this.boneyard.length > 0) { this._draw(pid); return; }
    this._pass(pid);
  }

  // ---- actions --------------------------------------------------------------

  handleAction(playerId, action) {
    if (this.state !== 'playing') return;
    if (playerId !== this.currentTurnPlayer) return; // only the current player acts
    const type = action && action.type;
    if (type === 'play') {
      const idx = Number(action.tileIndex);
      const end = action.end === 'L' ? 'L' : action.end === 'R' ? 'R' : null;
      if (!Number.isInteger(idx) || end === null) return;
      if (!this._canPlay(playerId, idx, end)) return;
      this._play(playerId, idx, end);
      this._emitChange();
    } else if (type === 'draw') {
      if (this.boneyard.length === 0) return; // nothing to draw
      this._draw(playerId);
      this._emitChange();
    } else if (type === 'pass') {
      // Only legal when the player genuinely cannot play AND cannot draw.
      if (this._hasLegalPlay(playerId)) return;
      if (this.boneyard.length > 0) return; // must draw before passing
      this._pass(playerId);
      this._emitChange();
    }
  }

  _hasLegalPlay(pid) {
    const hand = this.hands[pid] || [];
    return hand.some((t) =>
      t[0] === this.leftEnd || t[1] === this.leftEnd ||
      t[0] === this.rightEnd || t[1] === this.rightEnd);
  }

  _canPlay(pid, idx, end) {
    const hand = this.hands[pid] || [];
    const t = hand[idx];
    if (!t) return false;
    const open = end === 'L' ? this.leftEnd : this.rightEnd;
    return t[0] === open || t[1] === open;
  }

  _play(pid, idx, end) {
    const hand = this.hands[pid];
    const tile = hand.splice(idx, 1)[0];
    if (end === 'L') {
      // The half matching leftEnd butts against the train; the OTHER half becomes the new open left end.
      const matchA = tile[0] === this.leftEnd;
      const newEnd = matchA ? tile[1] : tile[0];
      const oriented = matchA ? [tile[1], tile[0]] : [tile[0], tile[1]];
      this.train.unshift(oriented);
      this.leftEnd = newEnd;
    } else {
      const matchA = tile[0] === this.rightEnd;
      const newEnd = matchA ? tile[1] : tile[0];
      const oriented = matchA ? [tile[0], tile[1]] : [tile[1], tile[0]];
      this.train.push(oriented);
      this.rightEnd = newEnd;
    }
    this.consecutivePasses = 0;
    this.lastEvent = { kind: 'play', playerId: pid, tile: [...tile], end };

    if (hand.length === 0) {
      this.winnerId = pid;
      this.endReason = 'emptied';
      this._finish();
      return;
    }
    this._advanceTurn();
  }

  _draw(pid) {
    const drawn = this.boneyard.shift();
    if (drawn) this.hands[pid].push(drawn);
    this.consecutivePasses = 0;
    this.lastEvent = { kind: 'draw', playerId: pid };
    // Drawing does NOT end the turn — the player may now play the drawn tile or
    // (if still stuck and boneyard empty) pass. Re-arm the timer for the same player.
    this._armTurnTimer();
  }

  _pass(pid) {
    this.consecutivePasses += 1;
    this.lastEvent = { kind: 'pass', playerId: pid };
    if (this.consecutivePasses >= this.players.length) {
      // Everyone passed in a row with an empty boneyard -> locked.
      this.winnerId = null;
      this.endReason = 'locked';
      this._finish();
      return;
    }
    this._advanceTurn();
  }

  _advanceTurn() {
    if (this.state !== 'playing') return;
    this.nextTurn();
    this._armTurnTimer();
  }

  _finish() {
    this._clearTimers();
    this.turnDeadline = null;
    if (this.state !== 'finished') this.transition('finish');
  }

  // ---- leave / teardown -----------------------------------------------------

  removePlayer(playerId) {
    const wasCurrent = this.currentTurnPlayer === playerId;
    super.removePlayer(playerId); // prunes this.players + activePlayers, reassigns turn
    delete this.hands[playerId];

    if (this.players.length <= 1) {
      // Last player standing emptied the field — they win by survival.
      if (this.state !== 'finished') {
        this.winnerId = this.players[0] || null;
        this.endReason = this.endReason || 'emptied';
        this._finish();
      }
      this._emitChange();
      return;
    }
    if (this.state === 'playing') {
      if (wasCurrent) {
        // The leaver was on the clock: their turn passes to the reassigned
        // currentTurnPlayer (set by super.removePlayer). Re-arm for them.
        this.consecutivePasses = 0;
        this.lastEvent = { kind: 'left', playerId };
        this._armTurnTimer();
      }
    }
    this._emitChange();
  }

  destroy() {
    this._clearTimers();
    this._onStateChange = null;
  }

  _clearTimers() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
  }

  // ---- state / results ------------------------------------------------------

  getStateForPlayer(playerId) {
    const myHand = (this.hands[playerId] || []).map((t) => [...t]);
    const playable = this.state === 'playing' && playerId === this.currentTurnPlayer
      ? myHand.map((t) => ({
          L: t[0] === this.leftEnd || t[1] === this.leftEnd,
          R: t[0] === this.rightEnd || t[1] === this.rightEnd,
        }))
      : myHand.map(() => ({ L: false, R: false }));

    return {
      phase: this.state,
      myId: playerId,
      isMyTurn: this.state === 'playing' && playerId === this.currentTurnPlayer,
      currentTurnPlayer: this.currentTurnPlayer,
      turnDeadline: this.state === 'playing' ? this.turnDeadline : null,
      myHand,                       // ONLY this player's tiles
      playable,                     // per-tile { L, R } legality for the current player
      canDraw: this.state === 'playing' && playerId === this.currentTurnPlayer && this.boneyard.length > 0,
      canPass: this.state === 'playing' && playerId === this.currentTurnPlayer &&
               this.boneyard.length === 0 && !this._hasLegalPlay(playerId),
      leftEnd: this.leftEnd,
      rightEnd: this.rightEnd,
      trainLength: this.train.length,
      train: this.train.map((t) => [...t]),
      boneyardCount: this.boneyard.length,
      lastEvent: this.lastEvent,
      players: this.players.map((p) => ({
        playerId: p,
        tileCount: (this.hands[p] || []).length, // COUNT only — never opponent contents
        isCurrent: p === this.currentTurnPlayer,
      })),
      winnerId: this.winnerId,
      endReason: this.endReason,
      // pip-sums are revealed only when the game is over
      results: this.state === 'finished'
        ? this.getResults().map((r) => ({ playerId: r.playerId, placement: r.placement, pips: r.pips }))
        : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // The winner (emptied hand) is forced to 0 pips and first place. Everyone
    // else ranks ASCENDING by remaining pip-sum; ties share a placement.
    const entries = this.players.map((p) => ({
      playerId: p,
      pips: p === this.winnerId ? 0 : handPips(this.hands[p] || []),
    }));
    entries.sort((a, b) => {
      if (a.playerId === this.winnerId) return -1;
      if (b.playerId === this.winnerId) return 1;
      return a.pips - b.pips;
    });
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.pips > entries[i - 1].pips) placement = i + 1;
      return {
        playerId: e.playerId,
        placement,
        pips: e.pips,
        handDescription: e.playerId === this.winnerId ? 'Emptied hand!' : `${e.pips} pips left`,
      };
    });
  }
}
