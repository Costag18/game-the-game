import { BaseGame } from './BaseGame.js';
import { CanvasSession } from '../utils/CanvasSession.js';

const WRITE_MS = 50000;
const STEP_MS = 70000;
const REVEAL_FRAME_MS = 6000;
const VOTE_MS = 40000;
const MAX_PHRASE_LEN = 120;
const PARTICIPATION_PER_ITEM = 20;
const VOTE_POINTS = 60;
const BLANK_TEXT = '???';

/**
 * Telephone Pictionary ("Eat Poop You Cat"). Each player seeds a phrase; chains
 * rotate so every player draws the phrase before them / captions the drawing before
 * them, alternating, until every page is full; then all chains are revealed and
 * players vote for the funniest. Lockstep simultaneous steps with a submit-barrier.
 *
 * Anti-cheat (structural): during writing/step a player sees ONLY the single prior
 * item on their assigned chain (never the rest of the chain, never other chains) —
 * full chains are public only at reveal/voting. Each player draws on a PRIVATE
 * per-chain canvas scoped to them (the stroke relay echoes back to the author only,
 * never the room). You cannot vote for your own chain.
 */
export class TelephonePictionary extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'writing', 'step', 'reveal', 'voting', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'writing' },
        writing: { beginSteps: 'step' },
        step: { nextStep: 'step', beginReveal: 'reveal' },
        reveal: { nextFrame: 'reveal', beginVoting: 'voting' },
        voting: { finishVote: 'finished' },
      },
    });
    this.seatOrder = [...players];
    this.N = players.length;
    this.chains = this.seatOrder.map((owner, i) => ({ id: `chain${i}`, ownerId: owner, items: [] }));
    this.canvases = {};
    for (const c of this.chains) this.canvases[c.id] = new CanvasSession();
    this.stepIndex = 0;
    this.stepMode = 'phrase';
    this.assignment = {};
    this.submitted = new Set();
    this.acknowledged = new Set();
    this.votes = {};
    this.participation = {};
    this.votePoints = {};
    this.scores = {};
    this.revealFrames = [];
    this.revealIndex = 0;
    this._phaseStartAt = 0;
    this._writeTimer = null;
    this._stepTimer = null;
    this._revealTimer = null;
    this._voteTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    this.transition('start'); // -> writing
    this._setupWriting();
  }

  _chain(id) { return this.chains.find((c) => c.id === id); }

  _assignFor(stepIndex) {
    this.assignment = {};
    for (const p of this.players) {
      const j = this.seatOrder.indexOf(p);
      if (j < 0) continue;
      const chainIdx = (((j - stepIndex) % this.N) + this.N) % this.N;
      this.assignment[p] = this.chains[chainIdx].id;
    }
    for (const c of this.chains) { const cv = this.canvases[c.id]; if (cv) cv.setDrawer(null); }
    if (this.stepMode === 'draw') {
      for (const p of this.players) { const cv = this.canvases[this.assignment[p]]; if (cv) cv.setDrawer(p); }
    }
  }

  _setupWriting() {
    this.stepIndex = 0;
    this.stepMode = 'phrase';
    this._assignFor(0); // each on own chain
    this.submitted = new Set();
    this._phaseStartAt = Date.now();
    this._clearTimers();
    this._writeTimer = setTimeout(() => {
      if (this.state !== 'writing') return;
      for (const p of this.players) if (!this.submitted.has(p)) this._autoFillPhrase(p);
      this._beginSteps();
      this._emitChange();
    }, WRITE_MS);
  }

  _autoFillPhrase(pid) {
    const c = this._chain(this.assignment[pid]);
    if (c && c.items.length === 0) c.items.push({ step: 0, mode: 'phrase', authorId: pid, text: BLANK_TEXT, strokes: null, blank: true });
  }

  _setupStep() {
    this.stepMode = this.stepIndex % 2 === 1 ? 'draw' : 'write';
    for (const c of this.chains) { const cv = this.canvases[c.id]; if (cv) cv.reset(); }
    this._assignFor(this.stepIndex);
    this.submitted = new Set();
    this._phaseStartAt = Date.now();
    this._clearTimers();
    this._stepTimer = setTimeout(() => {
      if (this.state !== 'step') return;
      for (const p of this.players) if (!this.submitted.has(p)) this._autoFillStepFor(p);
      this._advanceStep();
      this._emitChange();
    }, STEP_MS);
  }

  _autoFillStepFor(pid) {
    const chainId = this.assignment[pid];
    const c = this._chain(chainId);
    if (!c) return;
    if (this.stepMode === 'write') {
      c.items.push({ step: this.stepIndex, mode: 'write', authorId: pid, text: BLANK_TEXT, strokes: null, blank: true });
    } else {
      const strokes = this.canvases[chainId] ? this.canvases[chainId].snapshot().strokes.slice() : [];
      c.items.push({ step: this.stepIndex, mode: 'draw', authorId: pid, text: null, strokes, blank: strokes.length === 0 });
    }
  }

  _beginSteps() {
    if (this.state !== 'writing') return;
    this._clearTimers();
    this.stepIndex = 1;
    this.transition('beginSteps');
    this._setupStep();
  }

  _maybeAdvanceStep() { if (this.players.length && this.players.every((p) => this.submitted.has(p))) this._advanceStep(); }

  _advanceStep() {
    if (this.state !== 'step') return;
    this._clearTimers();
    if (this.stepIndex >= this.N - 1) { this._beginReveal(); return; }
    this.stepIndex++;
    this.transition('nextStep');
    this._setupStep();
  }

  _beginReveal() {
    this._clearTimers();
    this.transition('beginReveal');
    this.revealFrames = [];
    for (const c of this.chains) {
      for (const it of c.items) {
        this.revealFrames.push({ chainId: c.id, ownerId: c.ownerId, step: it.step, mode: it.mode, authorId: it.authorId, text: it.text, strokes: it.strokes, blank: it.blank });
      }
    }
    this.revealIndex = 0;
    this._phaseStartAt = Date.now();
    this._revealTimer = setTimeout(() => { if (this.state === 'reveal') { this._nextRevealFrame(); this._emitChange(); } }, REVEAL_FRAME_MS);
  }

  _nextRevealFrame() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.revealIndex >= this.revealFrames.length - 1) { this._beginVoting(); return; }
    this.revealIndex++;
    this.transition('nextFrame');
    this._phaseStartAt = Date.now();
    this._revealTimer = setTimeout(() => { if (this.state === 'reveal') { this._nextRevealFrame(); this._emitChange(); } }, REVEAL_FRAME_MS);
  }

  _beginVoting() {
    this._clearTimers();
    this.transition('beginVoting');
    this.votes = {};
    this._phaseStartAt = Date.now();
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'voting') return;
      for (const p of this.players) if (this.votes[p] === undefined) this.votes[p] = null;
      this._finishVote();
      this._emitChange();
    }, VOTE_MS);
  }

  _allVotesIn() { return this.players.length && this.players.every((p) => this.votes[p] !== undefined); }

  _finishVote() {
    if (this.state !== 'voting') return;
    this._clearTimers();
    this.transition('finishVote');
    this.participation = {};
    this.votePoints = {};
    for (const p of this.players) this.participation[p] = PARTICIPATION_PER_ITEM * this._nonBlankItemsBy(p);
    const chainVotes = {};
    for (const v of Object.values(this.votes)) if (v) chainVotes[v] = (chainVotes[v] || 0) + 1;
    for (const c of this.chains) {
      if (!this.players.includes(c.ownerId)) continue;
      this.votePoints[c.ownerId] = (this.votePoints[c.ownerId] || 0) + VOTE_POINTS * (chainVotes[c.id] || 0);
    }
    for (const p of this.players) this.scores[p] = (this.participation[p] || 0) + (this.votePoints[p] || 0);
  }

  _nonBlankItemsBy(p) {
    let n = 0;
    for (const c of this.chains) for (const it of c.items) if (it.authorId === p && !it.blank) n++;
    return n;
  }
  _votesForOwner(p) {
    const chainVotes = {};
    for (const v of Object.values(this.votes)) if (v) chainVotes[v] = (chainVotes[v] || 0) + 1;
    let n = 0;
    for (const c of this.chains) if (c.ownerId === p) n += chainVotes[c.id] || 0;
    return n;
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'writing' && type === 'submitPhrase') {
      if (this.submitted.has(playerId)) return;
      const t = String(action.text || '').trim().slice(0, MAX_PHRASE_LEN);
      if (!t) return;
      const c = this._chain(this.assignment[playerId]);
      if (!c || c.items.length > 0) return;
      c.items.push({ step: 0, mode: 'phrase', authorId: playerId, text: t, strokes: null, blank: false });
      this.submitted.add(playerId);
      if (this.players.every((p) => this.submitted.has(p))) this._beginSteps();
    } else if (this.state === 'step' && type === 'submitWrite') {
      if (this.stepMode !== 'write' || this.submitted.has(playerId)) return;
      const t = String(action.text || '').trim().slice(0, MAX_PHRASE_LEN);
      if (!t) return;
      const c = this._chain(this.assignment[playerId]);
      if (!c) return;
      c.items.push({ step: this.stepIndex, mode: 'write', authorId: playerId, text: t, strokes: null, blank: false });
      this.submitted.add(playerId);
      this._maybeAdvanceStep();
    } else if (this.state === 'step' && type === 'submitDraw') {
      if (this.stepMode !== 'draw' || this.submitted.has(playerId)) return;
      const chainId = this.assignment[playerId];
      const c = this._chain(chainId);
      if (!c) return;
      const strokes = this.canvases[chainId] ? this.canvases[chainId].snapshot().strokes.slice() : [];
      c.items.push({ step: this.stepIndex, mode: 'draw', authorId: playerId, text: null, strokes, blank: strokes.length === 0 });
      this.submitted.add(playerId);
      this._maybeAdvanceStep();
    } else if (this.state === 'reveal' && type === 'advanceReveal') {
      this.acknowledged.add(playerId);
      this._nextRevealFrame();
    } else if (this.state === 'voting' && type === 'vote') {
      if (this.votes[playerId] !== undefined) return;
      const c = this._chain(action.chainId);
      if (!c || c.ownerId === playerId) return;
      this.votes[playerId] = c.id;
      if (this._allVotesIn()) this._finishVote();
    } else if (this.state === 'voting' && type === 'skipVote') {
      if (this.votes[playerId] !== undefined) return;
      this.votes[playerId] = null;
      if (this._allVotesIn()) this._finishVote();
    }
  }

  _clearTimers() {
    for (const k of ['_writeTimer', '_stepTimer', '_revealTimer', '_voteTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); for (const c of Object.values(this.canvases)) if (c && c.destroy) c.destroy(); this._onStateChange = null; }

  removePlayer(playerId) {
    const unsub = !this.submitted.has(playerId);
    if (this.state === 'writing' && unsub) this._autoFillPhrase(playerId);
    else if (this.state === 'step' && unsub) this._autoFillStepFor(playerId);
    super.removePlayer(playerId);
    this.submitted.delete(playerId);
    this.acknowledged.delete(playerId);
    delete this.assignment[playerId];
    delete this.votes[playerId];

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'writing' && this.players.every((p) => this.submitted.has(p))) this._beginSteps();
    else if (this.state === 'step' && this.players.every((p) => this.submitted.has(p))) this._advanceStep();
    else if (this.state === 'voting' && this._allVotesIn()) this._finishVote();
  }

  _currentDeadlineMs() {
    if (this.state === 'writing') return this._phaseStartAt + WRITE_MS;
    if (this.state === 'step') return this._phaseStartAt + STEP_MS;
    if (this.state === 'reveal') return this._phaseStartAt + REVEAL_FRAME_MS;
    if (this.state === 'voting') return this._phaseStartAt + VOTE_MS;
    return null;
  }

  getStateForPlayer(pid) {
    const myChainId = this.assignment[pid] || null;
    const myChain = this._chain(myChainId);
    const priorItem = myChain && myChain.items.length ? myChain.items[myChain.items.length - 1] : null;
    return {
      phase: this.state,
      stepIndex: this.stepIndex,
      totalSteps: this.N - 1,
      stepMode: this.stepMode,
      mySubmitted: this.submitted.has(pid),
      submittedCount: this.submitted.size,
      playerCount: this.players.length,
      deadline: this._currentDeadlineMs(),
      myId: pid,
      myChainId,
      prompt: this.state === 'step'
        ? (this.stepMode === 'write'
          ? { kind: 'drawing', strokes: (priorItem && priorItem.strokes) || [], chainId: myChainId }
          : { kind: 'phrase', text: (priorItem && priorItem.text) || '', chainId: myChainId })
        : null,
      reveal: this.state === 'reveal'
        ? { index: this.revealIndex, total: this.revealFrames.length, frame: this.revealFrames[this.revealIndex] || null }
        : null,
      voting: this.state === 'voting'
        ? {
          chains: this.chains.map((c) => ({ id: c.id, ownerId: c.ownerId, items: c.items, isMine: c.ownerId === pid })),
          myVote: this.votes[pid],
        }
        : null,
      results: this.state === 'finished' ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const entries = this.players.map((p) => ({
      playerId: p,
      score: (this.participation[p] || 0) + (this.votePoints[p] || 0),
      votes: this._votesForOwner(p),
      itemsAuthored: this._nonBlankItemsBy(p),
    }));
    entries.sort((a, b) => (b.score - a.score) || (b.votes - a.votes) || (b.itemsAuthored - a.itemsAuthored));
    let placement = 1;
    return entries.map((e, i) => {
      if (i > 0 && e.score < entries[i - 1].score) placement = i + 1;
      return { ...e, placement, handDescription: `${e.score} pts` };
    });
  }
}
