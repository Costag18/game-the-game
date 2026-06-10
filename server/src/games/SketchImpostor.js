import { BaseGame } from './BaseGame.js';
import { pickWord } from '../utils/wordBank.js';
import { isCorrectGuess } from '../utils/guessMatch.js';

const REVEAL_MS = 12000;
const TURN_MS = 20000;
const VOTE_MS = 45000;
const GUESS_MS = 25000;
const STROKES_PER_PLAYER = 2;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function sanitizeStroke(raw, id) {
  if (!raw || !Array.isArray(raw.points) || raw.points.length === 0) return null;
  const points = [];
  for (const p of raw.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    points.push({ x: Math.max(0, Math.min(800, p.x)), y: Math.max(0, Math.min(600, p.y)) });
    if (points.length >= 400) break;
  }
  if (points.length === 0) return null;
  const tool = raw.tool === 'eraser' ? 'eraser' : 'pen';
  let width = Number(raw.width);
  if (!Number.isFinite(width)) width = 5;
  width = Math.max(1, Math.min(64, width));
  const color = tool === 'eraser' ? '#ffffff' : (HEX_RE.test(raw.color) ? raw.color : '#000000');
  return { id, color, width, tool, points };
}

/**
 * Sketch Impostor (Fake Artist) — hidden-role draw-and-deduce. Everyone shares a
 * secret word and draws it one stroke at a time on a shared canvas — except the
 * impostor, who has no word and must fake a convincing contribution. Then the table
 * votes who the impostor is; if caught, the impostor can still win by naming the word.
 *
 * Server-authoritative anti-cheat: the word lives only in the FSM and is sent to
 * artists only (NEVER to the impostor until the final reveal); the impostor's
 * identity is never revealed to anyone until reveal. The shared drawing IS public
 * (that's the point). Strokes flow through GAME_ACTION (one per turn, low-frequency)
 * and the FSM rotates the drawer on each stroke, so you can't draw out of turn or
 * draw twice — fully server-enforced. No high-frequency relay, no `.canvas` field.
 */
export class SketchImpostor extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'reveal', 'drawing', 'voting', 'impostorGuess', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'reveal' },
        reveal: { begin: 'drawing' },
        drawing: { vote: 'voting' },
        voting: { guess: 'impostorGuess', finish: 'finished' },
        impostorGuess: { finish: 'finished' },
      },
    });
    this.scores = {};
    this.word = null;
    this.impostor = null;
    this._strokes = [];
    this._seq = 0;
    this._turnQueue = [];
    this.acknowledged = new Set();
    this.votes = {};
    this.accused = null;
    this.impostorWordGuess = null;
    this._revealTimer = null;
    this._turnTimer = null;
    this._voteTimer = null;
    this._guessTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    const w = pickWord();
    this.word = w ? w.word : 'mystery';
    this.impostor = this.players[Math.floor(Math.random() * this.players.length)];
    this.acknowledged = new Set();
    this.transition('start'); // -> reveal
    this._revealTimer = setTimeout(() => { if (this.state === 'reveal') { this._beginDrawing(); this._emitChange(); } }, REVEAL_MS);
  }

  get currentDrawer() { return this._turnQueue[0] || null; }

  _beginDrawing() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    const base = shuffle(this.players);
    this._turnQueue = [];
    for (let i = 0; i < STROKES_PER_PLAYER; i++) this._turnQueue.push(...base);
    this.transition('begin'); // -> drawing
    this._startTurnTimer();
  }

  _startTurnTimer() {
    this._clearTimer('_turnTimer');
    if (this.state !== 'drawing') return;
    this._turnTimer = setTimeout(() => { if (this.state === 'drawing') { this._rotate(); this._emitChange(); } }, TURN_MS);
  }

  _rotate() {
    this._turnQueue.shift();
    if (this._turnQueue.length === 0) { this._toVoting(); return; }
    this._startTurnTimer();
  }

  _toVoting() {
    this._clearTimers();
    this.votes = {};
    this.transition('vote'); // -> voting
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'voting') return;
      this._resolveVote();
      this._emitChange();
    }, VOTE_MS);
  }

  _resolveVote() {
    this._clearTimers();
    const tally = {};
    for (const v of Object.values(this.votes)) if (v) tally[v] = (tally[v] || 0) + 1;
    let top = null;
    let topN = 0;
    let tie = false;
    for (const [pid, n] of Object.entries(tally)) {
      if (n > topN) { top = pid; topN = n; tie = false; } else if (n === topN) tie = true;
    }
    this.accused = tie ? null : top;
    const caught = this.accused === this.impostor && this.impostor != null;
    if (caught) {
      this.transition('guess'); // -> impostorGuess
      this._guessTimer = setTimeout(() => { if (this.state === 'impostorGuess') { this._finish(); this._emitChange(); } }, GUESS_MS);
    } else {
      this._finish();
    }
  }

  _finish() {
    this._clearTimers();
    const caught = this.accused === this.impostor && this.impostor != null;
    const guessedRight = !!(this.impostorWordGuess && this.word && isCorrectGuess(this.impostorWordGuess, this.word).correct);
    if (!caught) {
      if (this.scores[this.impostor] != null) this.scores[this.impostor] += 600;
    } else if (guessedRight) {
      if (this.scores[this.impostor] != null) this.scores[this.impostor] += 400;
      for (const p of this.players) if (p !== this.impostor) this.scores[p] += 100;
    } else {
      for (const p of this.players) if (p !== this.impostor) this.scores[p] += 300;
    }
    if (this.state !== 'finished') this.transition(this.state === 'impostorGuess' ? 'finish' : 'finish');
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      if (this.players.every((p) => this.acknowledged.has(p))) this._beginDrawing();
    } else if (this.state === 'drawing' && type === 'drawStroke') {
      if (playerId !== this.currentDrawer) return;
      const s = sanitizeStroke(action.stroke, `${playerId}:${this._seq++}`);
      if (!s) return;
      this._strokes.push(s);
      this._rotate();
    } else if (this.state === 'drawing' && type === 'skipStroke') {
      if (playerId !== this.currentDrawer) return;
      this._rotate();
    } else if (this.state === 'voting' && type === 'vote') {
      if (this.votes[playerId] !== undefined) return;
      if (action.target === playerId) return; // no self-vote
      if (!this.players.includes(action.target)) return;
      this.votes[playerId] = action.target;
      if (this.players.every((p) => this.votes[p] !== undefined)) this._resolveVote();
    } else if (this.state === 'impostorGuess' && type === 'guessWord') {
      if (playerId !== this.impostor) return;
      this.impostorWordGuess = String(action.text || '').slice(0, 60);
      this._finish();
    }
  }

  _clearTimer(name) { if (this[name]) { clearTimeout(this[name]); this[name] = null; } }
  _clearTimers() { for (const k of ['_revealTimer', '_turnTimer', '_voteTimer', '_guessTimer']) this._clearTimer(k); }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    const wasImpostor = playerId === this.impostor;
    super.removePlayer(playerId);
    this.acknowledged.delete(playerId);
    delete this.votes[playerId];
    this._turnQueue = this._turnQueue.filter((p) => p !== playerId);

    if (this.players.length <= 1 || (wasImpostor && this.state !== 'finished')) {
      // round can't meaningfully continue without the impostor; end it (no impostor scoring)
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      return;
    }
    if (this.state === 'reveal' && this.players.every((p) => this.acknowledged.has(p))) this._beginDrawing();
    else if (this.state === 'drawing') {
      if (this._turnQueue.length === 0) this._toVoting();
      else this._startTurnTimer();
    } else if (this.state === 'voting' && this.players.every((p) => this.votes[p] !== undefined)) this._resolveVote();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const finished = this.state === 'finished';
    const isImpostor = playerId === this.impostor;
    return {
      phase: this.state,
      myRole: isImpostor ? 'impostor' : 'artist',
      // word: artists see it throughout; the impostor NEVER sees it until the reveal
      word: finished ? this.word : (!isImpostor ? this.word : null),
      strokes: this._strokes,
      currentDrawer: this.state === 'drawing' ? this.currentDrawer : null,
      isMyTurn: this.state === 'drawing' && this.currentDrawer === playerId,
      turnsLeft: this._turnQueue.length,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      myVote: this.votes[playerId] != null ? this.votes[playerId] : null,
      votedCount: Object.keys(this.votes).length,
      // disclosure only at the end:
      impostorId: finished ? this.impostor : null,
      accused: finished ? this.accused : null,
      impostorWordGuess: finished ? this.impostorWordGuess : null,
      players: this.players.slice(),
      scores: { ...this.scores },
      results: finished ? this.getResults() : null,
      myId: playerId,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((p, i) => {
      if (i > 0 && (this.scores[p] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return { playerId: p, placement, score: this.scores[p] || 0, handDescription: p === this.impostor ? 'Impostor' : 'Artist' };
    });
  }
}
