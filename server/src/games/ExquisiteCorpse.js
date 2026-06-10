import { BaseGame } from './BaseGame.js';

// ---- tuning ----------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 600;
const SLIVER_H = 40;            // how much of the band ABOVE you can see
const DRAW_MS = 50_000;         // simultaneous draw phase
const VOTE_MS = 30_000;         // vote-the-best-band phase
const REVEAL_MS = 14_000;       // composite reveal / scoreboard ack
const MAX_POINTS = 400;         // per stroke
const MAX_STROKES = 300;        // per band
const VOTE_POINTS = 100;        // points per vote a band author receives
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const PROMPTS = [
  'a glorious monster', 'a fashionable alien', 'the world\'s weirdest creature',
  'a mythical beast', 'a robot gone wrong', 'a deep-sea horror',
  'a cryptid caught on camera', 'a fabulous swamp thing', 'an eldritch party guest',
  'a patchwork golem', 'a many-legged wonder', 'a cursed mascot',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Sanitise ONE submitted stroke into the canonical shape, clamping every point's
 * y into the author's [yStart, yEnd] band so a player can NEVER draw outside their
 * own slice (enforced server-side; the client UI is just a convenience). x is clamped
 * to [0, CANVAS_W]. Caps points/stroke; validates width 1..64 and a #rrggbb colour
 * or the 'eraser' tool.
 */
function sanitizeStroke(raw, id, yStart, yEnd) {
  if (!raw || !Array.isArray(raw.points) || raw.points.length === 0) return null;
  const points = [];
  for (const p of raw.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const x = Math.max(0, Math.min(CANVAS_W, p.x));
    const y = Math.max(yStart, Math.min(yEnd, p.y)); // CLAMP into the band
    points.push({ x, y });
    if (points.length >= MAX_POINTS) break;
  }
  if (points.length === 0) return null;
  const tool = raw.tool === 'eraser' ? 'eraser' : 'pen';
  let width = Number(raw.width);
  if (!Number.isFinite(width)) width = 6;
  width = Math.max(1, Math.min(64, width));
  const color = tool === 'eraser' ? '#ffffff' : (HEX_RE.test(raw.color) ? raw.color : '#000000');
  return { id, color, width, tool, points };
}

/**
 * Exquisite Corpse — collaborative band drawing. The 600px-tall canvas is split into
 * N horizontal bands, one per player. Each player draws ONLY in their band (the server
 * clamps every submitted point's y into the band range — spillover is impossible). During
 * the DRAW phase a player sees only their own band plus a thin sliver of the band ABOVE
 * (to connect to) — never anyone else's full work. When everyone submits (or the timer
 * fires) the full COMPOSITE is revealed and everyone votes the BEST band (not their own).
 * Band authors score per vote received; ranked by votes, ties share a placement.
 *
 * Anti-cheat (structural): another player's strokes are NEVER in getStateForPlayer during
 * draw (only your own band + the sliver-above strip); band y-clamping is server-enforced;
 * votes are hidden until reveal; you can't vote your own band.
 */
export class ExquisiteCorpse extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'draw', 'vote', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'draw' },
        draw: { vote: 'vote', finish: 'finished' },
        vote: { reveal: 'reveal', finish: 'finished' },
        reveal: { finish: 'finished' },
      },
    });
    this.scores = {};
    this.prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    this.bandOrder = [];          // player ids top->bottom (band index = position)
    this.bands = {};              // pid -> { index, yStart, yEnd }
    this.drawings = {};           // pid -> [strokes] (their band's strokes, full-canvas coords)
    this.submitted = new Set();   // pids that submitted their band
    this.votes = {};              // voterPid -> bandAuthorPid
    this.acknowledged = new Set();
    this.voteTally = {};          // authorPid -> votes received
    this._drawTimer = null;
    this._voteTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this._assignBands();
    this.transition('start'); // -> onEnterDraw
  }

  _assignBands() {
    this.bandOrder = shuffle(this.players);
    this.bands = {};
    this.drawings = {};
    const n = this.bandOrder.length;
    const bandH = CANVAS_H / n;
    this.bandOrder.forEach((pid, i) => {
      const yStart = i * bandH;
      const yEnd = (i + 1) * bandH;
      this.bands[pid] = { index: i, yStart, yEnd };
      this.drawings[pid] = [];
    });
  }

  // ---------- DRAW ----------
  onEnterDraw() {
    this.submitted = new Set();
    this._clearTimers();
    this._drawTimer = setTimeout(() => {
      if (this.state !== 'draw') return;
      this._toVote();
      this._emitChange();
    }, DRAW_MS);
  }

  _toVote() {
    if (this.state !== 'draw') return;
    this._clearTimers();
    this.votes = {};
    this.transition('vote'); // -> onEnterVote
  }

  // ---------- VOTE ----------
  onEnterVote() {
    this._clearTimers();
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'vote') return;
      for (const p of this.players) if (this.votes[p] === undefined) this._autoVote(p);
      this._toReveal();
      this._emitChange();
    }, VOTE_MS);
  }

  _autoVote(p) {
    const choices = this.bandOrder.filter((author) => author !== p);
    if (choices.length) this.votes[p] = choices[Math.floor(Math.random() * choices.length)];
  }

  _toReveal() {
    if (this.state !== 'vote') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    this.voteTally = {};
    for (const author of this.bandOrder) this.voteTally[author] = 0;
    for (const author of Object.values(this.votes)) {
      if (this.voteTally[author] !== undefined) this.voteTally[author] += 1;
    }
    for (const author of this.bandOrder) {
      this.scores[author] = (this.scores[author] || 0) + this.voteTally[author] * VOTE_POINTS;
    }
    this.acknowledged = new Set();
    this._clearTimers();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._finish();
      this._emitChange();
    }, REVEAL_MS);
  }

  _finish() {
    if (this.state === 'finished') return;
    this._clearTimers();
    this.transition('finish');
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'draw' && (type === 'submit' || type === 'submitDrawing')) {
      if (this.submitted.has(playerId)) return;
      const band = this.bands[playerId];
      if (!band) return;
      const raw = Array.isArray(action.strokes) ? action.strokes : [];
      const clean = [];
      for (const s of raw) {
        const ss = sanitizeStroke(s, `${playerId}:${clean.length}`, band.yStart, band.yEnd);
        if (ss) clean.push(ss);
        if (clean.length >= MAX_STROKES) break;
      }
      this.drawings[playerId] = clean;
      this.submitted.add(playerId);
      this._checkDrawComplete();
    } else if (this.state === 'vote' && type === 'vote') {
      if (this.votes[playerId] !== undefined) return;
      const target = action.target;
      if (target === playerId) return;                 // can't vote your own band
      if (!this.bandOrder.includes(target)) return;
      this.votes[playerId] = target;
      this._checkVoteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkDrawComplete() {
    if (this.state !== 'draw') return;
    if (this.players.every((p) => this.submitted.has(p))) { this._toVote(); this._emitChange(); }
  }
  _checkVoteComplete() {
    if (this.state !== 'vote') return;
    if (this.players.every((p) => this.votes[p] !== undefined)) { this._toReveal(); this._emitChange(); }
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) { this._finish(); this._emitChange(); }
  }

  _clearTimers() {
    for (const k of ['_drawTimer', '_voteTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.submitted.delete(playerId);
    this.acknowledged.delete(playerId);
    delete this.votes[playerId];
    // votes that were cast FOR the leaver stay counted toward an absent author's
    // band; that band simply has no one to score, harmless. Keep bands intact so
    // the composite still renders the full creature.

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'draw') this._checkDrawComplete();
    else if (this.state === 'vote') this._checkVoteComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  /** The thin strip of the band directly ABOVE `playerId`, so they can connect to it. */
  _sliverAbove(playerId) {
    const band = this.bands[playerId];
    if (!band || band.index === 0) return null; // top band has nothing above
    const aboveAuthor = this.bandOrder[band.index - 1];
    const aboveBand = this.bands[aboveAuthor];
    if (!aboveBand) return null;
    const cutY = band.yStart - SLIVER_H; // only the bottom SLIVER_H px of the band above
    // strokes are kept as-is (full-canvas coords); the client crops to [cutY, yStart]
    return {
      yStart: cutY,
      yEnd: band.yStart,
      strokes: (this.drawings[aboveAuthor] || []),
    };
  }

  getStateForPlayer(playerId) {
    const finished = this.state === 'finished';
    const revealing = this.state === 'reveal' || finished;
    const band = this.bands[playerId] || null;

    // Composite (ALL bands) is exposed ONLY at reveal/finished.
    let composite = null;
    if (revealing) {
      composite = this.bandOrder.map((author) => ({
        authorId: author,
        index: this.bands[author].index,
        yStart: this.bands[author].yStart,
        yEnd: this.bands[author].yEnd,
        strokes: this.drawings[author] || [],
        votes: this.voteTally[author] || 0,
      }));
    }

    return {
      phase: this.state,
      prompt: this.prompt,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      sliverH: SLIVER_H,
      playerCount: this.players.length,
      myId: playerId,
      // --- draw phase (private) ---
      myBand: band ? { index: band.index, yStart: band.yStart, yEnd: band.yEnd } : null,
      myStrokes: this.drawings[playerId] || [],
      sliverAbove: this.state === 'draw' ? this._sliverAbove(playerId) : null,
      hasSubmitted: this.submitted.has(playerId),
      submittedCount: this.submitted.size,
      // --- vote phase ---
      bandOrder: revealing || this.state === 'vote' ? this.bandOrder.slice() : null,
      composite, // only at reveal/finished
      myVote: this.votes[playerId] != null ? this.votes[playerId] : null,
      votedCount: this.state === 'vote' ? Object.keys(this.votes).length : 0,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      scores: { ...this.scores },
      results: finished ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((pid, i) => {
      if (i > 0 && (this.scores[pid] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      const band = this.bands[pid];
      return {
        playerId: pid,
        placement,
        score: this.scores[pid] || 0,
        votes: this.voteTally[pid] || 0,
        handDescription: `Band ${band ? band.index + 1 : '?'} — ${this.voteTally[pid] || 0} vote${(this.voteTally[pid] || 0) === 1 ? '' : 's'}`,
      };
    });
  }
}
