import { BaseGame } from './BaseGame.js';

const TOTAL_ROUNDS = 5;
const FACTION_POINTS = 500;   // each winning-faction member earns this if the meter ends their way
const DETECTIVE_POINTS = 100; // per correct faction guess about another player
const REVEAL_MS = 20_000;     // faction-card ready barrier
const ROUND_MS = 25_000;      // per-round push submission window
const ACCUSE_MS = 40_000;     // accusation (guess everyone's faction) window
const VALID_PUSHES = [-2, -1, 0, 1, 2];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Whisper Network — hidden-faction tug-of-war + detective guessing.
 *
 * SETUP: players are split as evenly as possible into two secret factions, RED
 * and BLUE (random). A shared meter starts at 0. RED wants the meter > 0 at the
 * end; BLUE wants it < 0.
 *
 * PHASES: waiting -> reveal -> round (×5) -> accusation -> finished.
 *  - reveal: each player privately sees ONLY their own faction card + taps Ready.
 *    Advances when all ready or 20s.
 *  - round (×5): every player privately submits a PUSH in {-2,-1,0,1,2} (negative
 *    toward BLUE, positive toward RED). Advances when all submit or 25s (missing
 *    -> 0). ALL pushes are added to the meter; only the NEW meter total is shown
 *    to everyone — individual pushes are NEVER revealed.
 *  - accusation: every player privately submits a GUESS of every OTHER player's
 *    faction ('RED'|'BLUE'). Advances when all submit or 40s (missing -> wrong).
 *  - finished: factionOutcome — meter>0 => each RED +500; meter<0 => each BLUE
 *    +500; meter===0 => nobody. PLUS +100 per correct faction guess made. All
 *    factions + the meter + guesses are disclosed only now.
 *
 * Anti-cheat (server-authoritative): getStateForPlayer exposes ONLY the asking
 * player's own faction — never another player's faction, and never anyone's
 * individual push. Mid-game the room sees only the cumulative meter and aggregate
 * "submitted N/M" counts. Accusation guesses stay private until 'finished'. Every
 * timer callback pairs with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class WhisperNetwork extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'reveal', 'round', 'accusation', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'reveal' },
        reveal: { play: 'round', finish: 'finished' },
        round: { next: 'round', accuse: 'accusation', finish: 'finished' },
        accusation: { reveal: 'finished', finish: 'finished' },
      },
    });
    this.totalRounds = TOTAL_ROUNDS;
    this.roundIndex = -1;          // -1 until first round entered
    this.meter = 0;
    this.factions = {};            // playerId -> 'RED' | 'BLUE'
    this.scores = {};              // playerId -> cumulative points
    this.ready = new Set();        // reveal-phase ready set
    this.pushes = {};              // roundId scoped: playerId -> int (cleared each round)
    this.guesses = {};             // playerId -> { otherId: 'RED'|'BLUE' }
    this.guessSubmitted = new Set();
    this.outcome = null;           // computed at finished: { winningFaction, meter, awards }
    this.deadline = null;          // epoch-ms for the active phase timer
    this._revealTimer = null;
    this._roundTimer = null;
    this._accuseTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this._assignFactions();
    this.transition('start'); // -> onEnterReveal
  }

  _assignFactions() {
    // Split as evenly as possible: floor(n/2) to one faction, rest to the other.
    // Randomize which side gets the extra player so neither is predictable.
    const order = shuffle(this.players);
    const half = Math.floor(order.length / 2);
    const redFirst = Math.random() < 0.5;
    this.factions = {};
    order.forEach((pid, i) => {
      const inFirstGroup = i < half;
      // first group gets RED if redFirst else BLUE; remainder gets the other
      const faction = inFirstGroup ? (redFirst ? 'RED' : 'BLUE') : (redFirst ? 'BLUE' : 'RED');
      this.factions[pid] = faction;
    });
  }

  // ---------- REVEAL (faction card + ready) ----------
  onEnterReveal() {
    this.ready = new Set();
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.ready.add(p);
      this._startRounds();
      this._emitChange();
    }, REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.ready.has(p))) this._startRounds();
  }

  _startRounds() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    this.transition('play'); // -> onEnterRound (first round)
  }

  // ---------- ROUND (secret push -> add to meter) ----------
  onEnterRound() {
    this.roundIndex++;
    this.pushes = {};
    this._clearTimers();
    this.deadline = Date.now() + ROUND_MS;
    this._roundTimer = setTimeout(() => {
      if (this.state !== 'round') return;
      for (const p of this.players) if (this.pushes[p] === undefined) this.pushes[p] = 0; // missing -> 0
      this._resolveRound();
      this._emitChange();
    }, ROUND_MS);
  }

  _checkRoundComplete() {
    if (this.state !== 'round') return;
    if (this.players.every((p) => this.pushes[p] !== undefined)) this._resolveRound();
  }

  _resolveRound() {
    if (this.state !== 'round') return;
    this._clearTimers();
    // Add ALL pushes to the shared meter (individual pushes never leave the FSM).
    for (const p of this.players) this.meter += (this.pushes[p] || 0);
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('accuse'); // -> onEnterAccusation
    else this.transition('next'); // -> onEnterRound (next round)
  }

  // ---------- ACCUSATION (guess everyone's faction) ----------
  onEnterAccusation() {
    this.guesses = {};
    this.guessSubmitted = new Set();
    this._clearTimers();
    this.deadline = Date.now() + ACCUSE_MS;
    this._accuseTimer = setTimeout(() => {
      if (this.state !== 'accusation') return;
      // missing guesses count as wrong: leave their guess map empty (no correct hits)
      for (const p of this.players) if (!this.guessSubmitted.has(p)) { this.guesses[p] = this.guesses[p] || {}; this.guessSubmitted.add(p); }
      this._finish();
      this._emitChange();
    }, ACCUSE_MS);
  }

  _checkAccusationComplete() {
    if (this.state !== 'accusation') return;
    if (this.players.every((p) => this.guessSubmitted.has(p))) this._finish();
  }

  _finish() {
    if (this.state !== 'accusation') return;
    this._clearTimers();
    this._scoreGame();
    this.transition('reveal'); // -> finished
  }

  _scoreGame() {
    const winningFaction = this.meter > 0 ? 'RED' : (this.meter < 0 ? 'BLUE' : null);
    const awards = {};
    for (const p of this.players) {
      let factionPts = 0;
      if (winningFaction && this.factions[p] === winningFaction) factionPts = FACTION_POINTS;
      // detective bonus: +100 per correct faction guess about ANOTHER present player
      let correct = 0;
      const myGuesses = this.guesses[p] || {};
      for (const [otherId, guess] of Object.entries(myGuesses)) {
        if (otherId === p) continue; // never self
        if (!this.players.includes(otherId)) continue; // only present players count
        if (this.factions[otherId] === guess) correct++;
      }
      const detectivePts = correct * DETECTIVE_POINTS;
      const gained = factionPts + detectivePts;
      this.scores[p] = (this.scores[p] || 0) + gained;
      awards[p] = { factionPts, detectivePts, correctGuesses: correct, gained };
    }
    this.outcome = { winningFaction, meter: this.meter, awards };
  }

  onEnterFinished() { this._clearTimers(); }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'reveal' && type === 'ready') {
      this.ready.add(playerId);
      this._checkRevealComplete();
    } else if (this.state === 'round' && type === 'submitPush') {
      if (this.pushes[playerId] !== undefined) return; // one push per round
      const v = Number(action.push);
      if (!VALID_PUSHES.includes(v)) return;
      this.pushes[playerId] = v;
      this._checkRoundComplete();
    } else if (this.state === 'accusation' && type === 'submitGuesses') {
      if (this.guessSubmitted.has(playerId)) return; // one submission
      const incoming = (action && action.guesses) || {};
      const clean = {};
      for (const other of this.players) {
        if (other === playerId) continue;
        const g = incoming[other];
        if (g === 'RED' || g === 'BLUE') clean[other] = g; // omit invalid/missing -> counts wrong
      }
      this.guesses[playerId] = clean;
      this.guessSubmitted.add(playerId);
      this._checkAccusationComplete();
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearTimers() {
    for (const k of ['_revealTimer', '_roundTimer', '_accuseTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers rotation
    // Drop the leaver's faction, pending obligations and score so barriers/results ignore them.
    delete this.factions[playerId];
    delete this.scores[playerId];
    delete this.pushes[playerId];
    delete this.guesses[playerId];
    this.ready.delete(playerId);
    this.guessSubmitted.delete(playerId);
    // Other players may have guessed the leaver's faction — those entries become
    // moot because _scoreGame only scores guesses about still-present players.

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this.outcome = this.outcome || { winningFaction: null, meter: this.meter, awards: {} };
      this._emitChange();
      return;
    }
    if (this.state === 'reveal') this._checkRevealComplete();
    else if (this.state === 'round') this._checkRoundComplete();
    else if (this.state === 'accusation') this._checkAccusationComplete();
    this._emitChange();
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const finished = this.state === 'finished';
    return {
      phase: this.state,
      myId: playerId,
      totalRounds: this.totalRounds,
      roundNumber: this.state === 'round' ? this.roundIndex + 1 : (this.roundIndex < 0 ? 0 : this.roundIndex + 1),
      meter: this.meter,
      // ANTI-CHEAT: only the asking player's OWN faction is ever exposed pre-finish.
      myFaction: this.factions[playerId] || null,
      players: [...this.players],
      scores: { ...this.scores },
      playerCount: this.players.length,
      deadline: (this.state === 'reveal' || this.state === 'round' || this.state === 'accusation') ? this.deadline : null,
      // reveal barrier: who tapped Ready (aggregate, not secret)
      ready: this.state === 'reveal' ? [...this.ready] : [],
      // round barrier: only MY OWN push + aggregate submitted count — never others' pushes
      myPush: this.state === 'round' && this.pushes[playerId] !== undefined ? this.pushes[playerId] : null,
      hasPushed: this.state === 'round' ? this.pushes[playerId] !== undefined : false,
      pushedCount: this.state === 'round' ? Object.keys(this.pushes).length : 0,
      // accusation barrier: only MY OWN guesses + aggregate submitted count
      myGuesses: this.state === 'accusation' && this.guesses[playerId] ? { ...this.guesses[playerId] } : {},
      hasGuessed: this.state === 'accusation' ? this.guessSubmitted.has(playerId) : false,
      guessedCount: this.state === 'accusation' ? this.guessSubmitted.size : 0,
      // FULL disclosure ONLY at finished: all factions, the winning side, all guesses, awards
      reveal: finished
        ? {
            winningFaction: this.outcome ? this.outcome.winningFaction : null,
            meter: this.meter,
            factions: { ...this.factions },
            guesses: Object.fromEntries(Object.entries(this.guesses).map(([k, v]) => [k, { ...v }])),
            awards: this.outcome ? { ...this.outcome.awards } : {},
          }
        : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Rank all present players by cumulative points DESC. Ties share a placement
    // (dense over the sorted list). Whole factions sharing a score is expected.
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      const a = this.outcome && this.outcome.awards[playerId];
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        faction: this.factions[playerId] || null,
        correctGuesses: a ? a.correctGuesses : 0,
        handDescription: `${this.scores[playerId] || 0} pts${this.factions[playerId] ? ` · ${this.factions[playerId]}` : ''}`,
      };
    });
  }
}
