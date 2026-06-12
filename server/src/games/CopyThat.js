import { BaseGame } from './BaseGame.js';

const TOTAL_ROUNDS = 3;
const FLASH_MS = 7000;
const REDRAW_MS = 25000;
const REVEAL_MS = 9000;
const GRID = 24;            // rasterisation resolution (GRID x GRID boolean grid)
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const LW = 800;             // logical canvas width
const LH = 600;             // logical canvas height
const MAX_POINTS = 400;
const MAX_STROKES = 300;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Reference drawing bank. Each is a small list of strokes (in 800x600 logical
 * space) forming a recognizable simple shape. These live ONLY on the server and
 * are flashed to clients during the flash phase, then hidden during redraw.
 * `color`/`width` are only for client rendering — scoring ignores them.
 */
function buildReferenceBank() {
  const mk = (name, strokes) => ({ name, strokes: strokes.map((pts, i) => ({ id: `ref:${i}`, color: '#1565c0', width: 8, tool: 'pen', points: pts })) });
  return [
    mk('House', [
      [{ x: 250, y: 420 }, { x: 250, y: 250 }, { x: 550, y: 250 }, { x: 550, y: 420 }, { x: 250, y: 420 }], // body
      [{ x: 230, y: 250 }, { x: 400, y: 130 }, { x: 570, y: 250 }], // roof
      [{ x: 360, y: 420 }, { x: 360, y: 320 }, { x: 440, y: 320 }, { x: 440, y: 420 }], // door
    ]),
    mk('Star', [
      [{ x: 400, y: 130 }, { x: 460, y: 310 }, { x: 650, y: 310 }, { x: 500, y: 420 },
       { x: 560, y: 600 }, { x: 400, y: 490 }, { x: 240, y: 600 }, { x: 300, y: 420 },
       { x: 150, y: 310 }, { x: 340, y: 310 }, { x: 400, y: 130 }],
    ]),
    mk('Smiley', [
      circlePts(400, 300, 180, 32),                       // face
      [{ x: 330, y: 250 }, { x: 350, y: 250 }],           // left eye
      [{ x: 450, y: 250 }, { x: 470, y: 250 }],           // right eye
      arcPts(400, 320, 110, Math.PI * 0.15, Math.PI * 0.85, 16), // smile
    ]),
    mk('Sailboat', [
      [{ x: 200, y: 430 }, { x: 600, y: 430 }, { x: 520, y: 510 }, { x: 280, y: 510 }, { x: 200, y: 430 }], // hull
      [{ x: 400, y: 430 }, { x: 400, y: 140 }], // mast
      [{ x: 400, y: 160 }, { x: 560, y: 400 }, { x: 400, y: 400 }, { x: 400, y: 160 }], // sail
    ]),
    mk('Fish', [
      [{ x: 250, y: 300 }, { x: 470, y: 200 }, { x: 600, y: 300 }, { x: 470, y: 400 }, { x: 250, y: 300 }], // body
      [{ x: 600, y: 300 }, { x: 690, y: 230 }, { x: 690, y: 370 }, { x: 600, y: 300 }], // tail
      [{ x: 360, y: 270 }, { x: 364, y: 270 }], // eye dot
    ]),
    mk('Heart', [
      heartPts(400, 470, 170, 28),
    ]),
    mk('Umbrella', [
      arcPts(400, 300, 200, Math.PI, Math.PI * 2, 24), // canopy
      [{ x: 200, y: 300 }, { x: 600, y: 300 }],         // canopy base
      [{ x: 400, y: 300 }, { x: 400, y: 500 }, { x: 470, y: 520 }], // handle
    ]),
    mk('Key', [
      circlePts(280, 300, 90, 24),                     // bow
      [{ x: 360, y: 300 }, { x: 620, y: 300 }],         // shaft
      [{ x: 560, y: 300 }, { x: 560, y: 360 }],         // tooth 1
      [{ x: 620, y: 300 }, { x: 620, y: 370 }],         // tooth 2
    ]),
  ];
}

function circlePts(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  return pts;
}
function arcPts(cx, cy, r, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  return pts;
}
function heartPts(cx, cy, s, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (i / n) * Math.PI * 2; // start/end at bottom point
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push({ x: cx + (x / 16) * s, y: cy - (y / 16) * s });
  }
  return pts;
}

function sanitizeStroke(raw, id) {
  if (!raw || !Array.isArray(raw.points) || raw.points.length === 0) return null;
  const points = [];
  for (const p of raw.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    points.push({ x: Math.max(0, Math.min(LW, p.x)), y: Math.max(0, Math.min(LH, p.y)) });
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

function sanitizeStrokes(rawStrokes) {
  if (!Array.isArray(rawStrokes)) return [];
  const out = [];
  for (const raw of rawStrokes) {
    const s = sanitizeStroke(raw, `s${out.length}`);
    if (s) out.push(s);
    if (out.length >= MAX_STROKES) break;
  }
  return out;
}

/**
 * Rasterise a stroke list to a GRID x GRID boolean grid by sampling points along
 * each segment and marking the cells they fall in (eraser strokes are skipped).
 * Returns a flat Uint8Array of length GRID*GRID.
 */
function rasterise(strokes) {
  const grid = new Uint8Array(GRID * GRID);
  const mark = (x, y) => {
    let gx = Math.floor((x / LW) * GRID);
    let gy = Math.floor((y / LH) * GRID);
    gx = Math.max(0, Math.min(GRID - 1, gx));
    gy = Math.max(0, Math.min(GRID - 1, gy));
    grid[gy * GRID + gx] = 1;
  };
  for (const s of strokes) {
    if (!s || s.tool === 'eraser' || !Array.isArray(s.points)) continue;
    const pts = s.points;
    if (pts.length === 1) { mark(pts[0].x, pts[0].y); continue; }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      // sample densely enough that no cell is skipped (cell ~33x25 px)
      const steps = Math.max(1, Math.ceil(dist / 6));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        mark(a.x + dx * t, a.y + dy * t);
      }
    }
  }
  return grid;
}

/** Intersection-over-union of two boolean grids → [0,1]. */
function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i], bv = b[i];
    if (av && bv) inter++;
    if (av || bv) uni++;
  }
  if (uni === 0) return 0;
  return inter / uni;
}

/**
 * Copy That — memory-redraw with OBJECTIVE similarity scoring (no voting). Each
 * round flashes a server-generated reference drawing for ~7s, then hides it and
 * gives players ~25s to redraw it from memory. The server scores each submission
 * by rasterising both the submission and the reference to a 24x24 boolean grid
 * and computing IoU; score = round(IoU * 1000). Cumulative over 3 rounds.
 *
 * Anti-cheat (structural): the reference lives ONLY in the FSM and is sent in
 * getStateForPlayer DURING FLASH ONLY — it is null during redraw/reveal/finished
 * for in-flight rounds, so a client cannot copy it pixel-perfect. Scoring is fully
 * server-side. A player only ever sees their OWN submission until the reveal phase,
 * which then discloses everyone's drawing + similarity for that round.
 */
export class CopyThat extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'flash', 'redraw', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'flash' },
        flash: { redraw: 'redraw', finish: 'finished' },
        redraw: { reveal: 'reveal', finish: 'finished' },
        reveal: { next: 'flash', finish: 'finished' },
      },
    });
    this.totalRounds = TOTAL_ROUNDS;
    this.roundIndex = -1;
    this.scores = {};                 // cumulative
    this.bank = shuffle(buildReferenceBank());
    this.reference = null;            // current round's reference {name, strokes}
    this.refGrid = null;              // rasterised reference for the current round
    this.submissions = {};            // pid -> sanitized strokes (current round)
    this.roundScores = {};            // pid -> this-round score (current round)
    this.revealData = null;
    this.acknowledged = new Set();
    this._redrawStart = null;         // epoch-ms when the redraw window opened (drives the client countdown)
    this._flashTimer = null;
    this._redrawTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> onEnterFlash
  }

  // ---------- FLASH ----------
  onEnterFlash() {
    this.roundIndex++;
    this.reference = this.bank[this.roundIndex % this.bank.length];
    this.refGrid = rasterise(this.reference.strokes);
    this.submissions = {};
    this.roundScores = {};
    this.revealData = null;
    this.acknowledged = new Set();
    this._clearTimers();
    this._flashTimer = setTimeout(() => {
      if (this.state !== 'flash') return;
      this._toRedraw();
      this._emitChange();
    }, FLASH_MS);
  }

  _toRedraw() {
    if (this.state !== 'flash') return;
    this._clearTimers();
    this.transition('redraw'); // -> onEnterRedraw
  }

  // ---------- REDRAW ----------
  onEnterRedraw() {
    this._clearTimers();
    this._redrawStart = Date.now(); // exposed as redrawEndTime so the client can show a countdown
    this._redrawTimer = setTimeout(() => {
      if (this.state !== 'redraw') return;
      for (const p of this.players) if (this.submissions[p] === undefined) this.submissions[p] = []; // auto-empty
      this._toReveal();
      this._emitChange();
    }, REDRAW_MS);
  }

  _toReveal() {
    if (this.state !== 'redraw') return;
    this._clearTimers();
    this._redrawStart = null; // redraw window closed
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const perPlayer = {};
    for (const p of this.players) {
      const strokes = this.submissions[p] || [];
      const score = Math.round(iou(rasterise(strokes), this.refGrid) * 1000);
      this.roundScores[p] = score;
      this.scores[p] = (this.scores[p] || 0) + score;
      perPlayer[p] = { strokes, score, percent: Math.round((score / 1000) * 100) };
    }
    this.revealData = {
      reference: this.reference,         // disclosed now (round is over)
      referenceName: this.reference.name,
      perPlayer,
      roundScores: { ...this.roundScores },
    };
    this.acknowledged = new Set();
    this._clearTimers();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else this.transition('next'); // -> onEnterFlash
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'redraw' && (type === 'submit' || type === 'submitDrawing')) {
      if (this.submissions[playerId] !== undefined) return; // one submit per round
      this.submissions[playerId] = sanitizeStrokes(action.strokes);
      this._checkRedrawComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkRedrawComplete() {
    if (this.state !== 'redraw') return;
    if (this.players.every((p) => this.submissions[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.every((p) => this.acknowledged.has(p))) this._advance();
  }

  _clearTimers() {
    for (const k of ['_flashTimer', '_redrawTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    delete this.submissions[playerId];
    delete this.roundScores[playerId];

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'redraw') this._checkRedrawComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const inFlash = this.state === 'flash';
    return {
      phase: this.state,
      roundNumber: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      myId: playerId,
      scores: { ...this.scores },
      playerCount: this.players.length,
      // Reference shown ONLY during flash for in-flight rounds (anti-cheat). It is
      // re-disclosed inside `reveal` once the round is scored.
      reference: inFlash ? this.reference : null,
      referenceName: inFlash ? this.reference?.name : null,
      // Redraw deadline (epoch-ms) so the client can render a countdown + auto-submit on timeout.
      redrawEndTime: (this.state === 'redraw' && this._redrawStart) ? this._redrawStart + REDRAW_MS : null,
      // Your own submission is the only drawing you can see before reveal.
      mySubmission: this.submissions[playerId] !== undefined ? this.submissions[playerId] : null,
      hasSubmitted: this.submissions[playerId] !== undefined,
      submittedCount: Object.keys(this.submissions).length,
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: (this.state === 'reveal' || this.state === 'finished') ? this.revealData : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((playerId, i) => {
      if (i > 0 && (this.scores[playerId] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return {
        playerId,
        placement,
        score: this.scores[playerId] || 0,
        handDescription: `${this.scores[playerId] || 0} similarity pts`,
      };
    });
  }
}
