import { BaseGame } from './BaseGame.js';

const REVEAL_MS = 25_000;   // role-card ready barrier
const STAGE_MS = 30_000;    // help/sabotage submission window (missing -> 'help')
const EJECT_MS = 35_000;    // discussion + secret eject vote window
const STAGE_RESULT_MS = 9_000; // per-stage pass/fail reveal auto-advance
const TOTAL_STAGES = 5;
const EJECT_AFTER_STAGE = 3;

const CRACK_THRESHOLD = 4;  // stagesPassed >= 4 -> vault cracked (loyal win)
const LOYAL_WIN_POINTS = 500;
const TRAITOR_WIN_POINTS = 800;
const LOYAL_CATCH_BONUS = 200; // ejected player was a traitor

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Traitor's Vault — co-op heist with hidden traitors sabotaging the crack.
 *
 * Roles are secretly assigned at setup: TRAITORS = (players.length <= 5 ? 1 : 2),
 * everyone else is LOYAL. Across 5 stages every active player privately submits
 * 'help' or 'sabotage'; a stage PASSES iff sabotageCount === 0. After stage 3 the
 * crew holds one secret eject vote. The vault cracks if >=4 stages passed: cracked
 * -> LOYAL win; otherwise TRAITOR win; ejecting a traitor gives LOYAL a bonus.
 *
 * ANTI-CHEAT (server-authoritative): the secret role assignment lives ONLY in the
 * FSM. getStateForPlayer(pid) returns ONLY pid's own LOYAL/TRAITOR role and NEVER
 * another player's role/secret until the final 'finished' reveal. Individual
 * help/sabotage choices are NEVER disclosed — only the per-stage sabotageCount and
 * pass/fail. Eject votes are secret until the tally. Every timer callback pairs
 * with `_emitChange()` per the v2.7.0 broadcast contract.
 */
export class TraitorsVault extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'reveal', 'stage', 'stageResult', 'ejectVote', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'reveal' },
        reveal: { begin: 'stage', finish: 'finished' },
        stage: { result: 'stageResult', finish: 'finished' },
        stageResult: { next: 'stage', eject: 'ejectVote', finish: 'finished' },
        ejectVote: { resume: 'stage', finish: 'finished' },
      },
    });
    this.roles = {};            // playerId -> 'LOYAL' | 'TRAITOR'  (SECRET)
    this.scores = {};           // playerId -> points
    this.ejected = new Set();   // ids ejected from stages 4-5 (role hidden until finished)
    this.stageIndex = 0;        // 1..5 once stages begin
    this.stagesPassed = 0;
    this.history = [];          // [{ stage, passed, sabotageCount }]  (NEVER who)
    this.choices = {};          // current stage: playerId -> 'help' | 'sabotage'  (SECRET)
    this.lastStage = null;      // { stage, passed, sabotageCount } for the result phase
    this.ejectVotes = {};       // voterId -> targetId  (SECRET until tally)
    this.ejectResult = null;    // { tally:{pid:count}, ejectedId, tie }
    this.ready = new Set();
    this.acknowledged = new Set();
    this.outcome = null;        // final reveal payload (roles, vaultCracked, etc.)
    this.deadline = null;
    this._revealTimer = null;
    this._stageTimer = null;
    this._stageResultTimer = null;
    this._ejectTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this._assignRoles();
    this.transition('start'); // -> onEnterReveal
  }

  _assignRoles() {
    const numTraitors = this.players.length <= 5 ? 1 : 2;
    const order = shuffle(this.players);
    const traitors = new Set(order.slice(0, numTraitors));
    for (const p of this.players) this.roles[p] = traitors.has(p) ? 'TRAITOR' : 'LOYAL';
  }

  // ---------- helpers ----------
  // Active = present (this.players) and not ejected from the heist.
  _activePlayers() { return this.players.filter((p) => !this.ejected.has(p)); }

  // ---------- REVEAL (role card + ready) ----------
  onEnterReveal() {
    this.ready = new Set();
    this._clearTimers();
    this.deadline = Date.now() + REVEAL_MS;
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      this._beginStages();
      this._emitChange();
    }, REVEAL_MS);
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.ready.has(p))) this._beginStages();
  }

  _beginStages() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    this.stageIndex = 0; // onEnterStage increments to 1
    this.transition('begin'); // -> onEnterStage
  }

  // ---------- STAGE (private help/sabotage) ----------
  onEnterStage() {
    this.stageIndex++;
    this.choices = {};
    this.lastStage = null;
    this._clearTimers();
    this.deadline = Date.now() + STAGE_MS;
    this._stageTimer = setTimeout(() => {
      if (this.state !== 'stage') return;
      // timeout: anyone who didn't submit defaults to 'help'
      for (const p of this._activePlayers()) if (this.choices[p] === undefined) this.choices[p] = 'help';
      this._resolveStage();
      this._emitChange();
    }, STAGE_MS);
  }

  _checkStageComplete() {
    if (this.state !== 'stage') return;
    const active = this._activePlayers();
    if (active.length === 0) { this._resolveStage(); return; }
    if (active.every((p) => this.choices[p] !== undefined)) this._resolveStage();
  }

  _resolveStage() {
    if (this.state !== 'stage') return;
    const active = this._activePlayers();
    let sabotageCount = 0;
    for (const p of active) if (this.choices[p] === 'sabotage') sabotageCount++;
    const passed = sabotageCount === 0;
    if (passed) this.stagesPassed++;
    const entry = { stage: this.stageIndex, passed, sabotageCount };
    this.history.push(entry);
    this.lastStage = entry;
    this.acknowledged = new Set();
    this._clearTimers();
    this.transition('result'); // -> onEnterStageResult
  }

  // ---------- STAGE RESULT (pass/fail + sabotageCount, never WHO) ----------
  onEnterStageResult() {
    this.acknowledged = new Set();
    this._clearTimers();
    this.deadline = Date.now() + STAGE_RESULT_MS;
    this._stageResultTimer = setTimeout(() => {
      if (this.state !== 'stageResult') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advanceFromResult();
      this._emitChange();
    }, STAGE_RESULT_MS);
  }

  _checkStageResultComplete() {
    if (this.state !== 'stageResult') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advanceFromResult();
  }

  _advanceFromResult() {
    if (this.state !== 'stageResult') return;
    this._clearTimers();
    if (this.stageIndex >= TOTAL_STAGES) { this._finish(); return; }
    if (this.stageIndex === EJECT_AFTER_STAGE) this.transition('eject'); // -> onEnterEjectVote
    else this.transition('next'); // -> onEnterStage
  }

  // ---------- EJECT VOTE (secret) ----------
  onEnterEjectVote() {
    this.ejectVotes = {};
    this.ejectResult = null;
    this._clearTimers();
    this.deadline = Date.now() + EJECT_MS;
    this._ejectTimer = setTimeout(() => {
      if (this.state !== 'ejectVote') return;
      this._resolveEject(); // missing votes simply abstain
      this._emitChange();
    }, EJECT_MS);
  }

  _checkEjectComplete() {
    if (this.state !== 'ejectVote') return;
    const active = this._activePlayers();
    if (active.length === 0) { this._resolveEject(); return; }
    if (active.every((p) => this.ejectVotes[p] !== undefined)) this._resolveEject();
  }

  _resolveEject() {
    if (this.state !== 'ejectVote') return;
    const tally = {};
    for (const target of Object.values(this.ejectVotes)) {
      // only count votes whose target is still an active player
      if (!this.ejected.has(target) && this.players.includes(target)) {
        tally[target] = (tally[target] || 0) + 1;
      }
    }
    let max = 0;
    for (const c of Object.values(tally)) if (c > max) max = c;
    const leaders = Object.keys(tally).filter((p) => tally[p] === max && max > 0);
    let ejectedId = null;
    let tie = false;
    if (leaders.length === 1) {
      ejectedId = leaders[0];
      this.ejected.add(ejectedId);
    } else if (leaders.length > 1) {
      tie = true; // tie -> no ejection
    }
    this.ejectResult = { tally: { ...tally }, ejectedId, tie };
    this._clearTimers();
    this.transition('resume'); // -> onEnterStage (stage 4)
  }

  // ---------- FINISH / SCORE ----------
  _finish() {
    this._clearTimers();
    const vaultCracked = this.stagesPassed >= CRACK_THRESHOLD;
    const ejectedId = this.ejectResult ? this.ejectResult.ejectedId : null;
    const caughtTraitor = ejectedId != null && this.roles[ejectedId] === 'TRAITOR';

    for (const p of this.players) {
      const role = this.roles[p];
      if (vaultCracked) {
        if (role === 'LOYAL') this.scores[p] += LOYAL_WIN_POINTS;
      } else {
        if (role === 'TRAITOR') this.scores[p] += TRAITOR_WIN_POINTS;
      }
      // catching a traitor in the eject vote rewards every loyal player
      if (caughtTraitor && role === 'LOYAL') this.scores[p] += LOYAL_CATCH_BONUS;
    }

    this.outcome = {
      vaultCracked,
      stagesPassed: this.stagesPassed,
      crackThreshold: CRACK_THRESHOLD,
      ejectedId,
      caughtTraitor,
      // ALL roles disclosed only now
      roles: { ...this.roles },
      traitors: this.players.filter((p) => this.roles[p] === 'TRAITOR'),
      ejectResult: this.ejectResult,
      history: this.history.map((h) => ({ ...h })),
    };
    this.deadline = null;
    if (this.state !== 'finished') this.state = 'finished';
  }

  onEnterFinished() { this._clearTimers(); this.deadline = null; }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;

    if (this.state === 'reveal' && type === 'ready') {
      this.ready.add(playerId);
      this._checkRevealComplete();
    } else if (this.state === 'stage' && type === 'submitMove') {
      if (this.ejected.has(playerId)) return;           // ejected players sit out
      if (this.choices[playerId] !== undefined) return; // one move per stage
      const move = action.move === 'sabotage' ? 'sabotage' : 'help';
      this.choices[playerId] = move;
      this._checkStageComplete();
    } else if (this.state === 'stageResult' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkStageResultComplete();
    } else if (this.state === 'ejectVote' && type === 'castEject') {
      if (this.ejected.has(playerId)) return;            // ejected can't vote
      if (this.ejectVotes[playerId] !== undefined) return;
      const target = action.targetId;
      if (target === playerId) return;                   // not self
      if (!this.players.includes(target) || this.ejected.has(target)) return; // must be active
      this.ejectVotes[playerId] = target;
      this._checkEjectComplete();
    }
  }

  // ---------- TIMERS / TEARDOWN ----------
  _clearTimers() {
    for (const k of ['_revealTimer', '_stageTimer', '_stageResultTimer', '_ejectTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  // ---------- LEAVE ----------
  removePlayer(playerId) {
    const wasTraitor = this.roles[playerId] === 'TRAITOR';
    super.removePlayer(playerId);     // prunes this.players + activePlayers rotation
    delete this.scores[playerId];     // stop scoring the leaver
    delete this.choices[playerId];    // drop pending stage obligation
    delete this.ejectVotes[playerId]; // drop pending eject vote
    this.ready.delete(playerId);
    this.acknowledged.delete(playerId);
    this.ejected.delete(playerId);    // no longer relevant
    // NOTE: keep this.roles[leaver] so a final reveal could still explain history,
    // but they're pruned from results either way.

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.outcome = this.outcome || null;
      this.state = 'finished';
      this.deadline = null;
      this._emitChange();
      return;
    }

    // re-check the active barrier so we never deadlock waiting on a ghost. If the
    // leaver was the (only relevant) traitor mid-heist, the stages just resolve on
    // the remaining choices — a leaving traitor can no longer sabotage.
    if (this.state === 'reveal') this._checkRevealComplete();
    else if (this.state === 'stage') this._checkStageComplete();
    else if (this.state === 'stageResult') this._checkStageResultComplete();
    else if (this.state === 'ejectVote') this._checkEjectComplete();
    this._emitChange();
    void wasTraitor;
  }

  // ---------- VIEW ----------
  getStateForPlayer(playerId) {
    const finished = this.state === 'finished';
    const active = this._activePlayers();
    return {
      phase: this.state,
      myId: playerId,
      // ONLY my own role is ever exposed pre-finish; never anyone else's.
      myRole: this.roles[playerId] || null,
      amEjected: this.ejected.has(playerId),
      stageIndex: this.stageIndex,
      totalStages: TOTAL_STAGES,
      stagesPassed: this.stagesPassed,
      crackThreshold: CRACK_THRESHOLD,
      ejectAfterStage: EJECT_AFTER_STAGE,
      players: [...this.players],
      activePlayers: [...active],
      ejectedPlayers: [...this.ejected],
      scores: { ...this.scores },
      playerCount: this.players.length,
      activeCount: active.length,
      deadline: this.deadline,
      // pass/fail + sabotageCount history — NEVER who sabotaged
      history: this.history.map((h) => ({ ...h })),

      // reveal barrier readiness (role card)
      ready: this.state === 'reveal' ? [...this.ready] : [],
      iAmReady: this.ready.has(playerId),
      readyCount: this.ready.size,

      // my own pending stage move only
      myMove: this.choices[playerId] != null ? this.choices[playerId] : null,
      hasSubmittedMove: this.choices[playerId] !== undefined,
      submittedCount: Object.keys(this.choices).length,

      // last stage result (pass/fail + count) shown to everyone in stageResult
      stageResult: this.state === 'stageResult' ? this.lastStage : null,
      acknowledged: this.state === 'stageResult' ? [...this.acknowledged] : [],

      // eject vote: only my own vote exposed pre-tally
      myEjectVote: this.ejectVotes[playerId] != null ? this.ejectVotes[playerId] : null,
      hasEjectVoted: this.ejectVotes[playerId] !== undefined,
      ejectVotedCount: Object.keys(this.ejectVotes).length,

      // EVERYTHING disclosed only at finished
      outcome: finished ? this.outcome : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    // Rank all present players by points DESC; ties share a placement (dense over
    // the sorted list). Hidden-role games naturally tie whole factions — fine.
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      const role = this.roles[playerId] || 'LOYAL';
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        role,
        handDescription: `${role} · ${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
