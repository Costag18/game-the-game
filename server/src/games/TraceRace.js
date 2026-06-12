import { BaseGame } from './BaseGame.js';

const ROUNDS = 3;
const DRAW_MS = 30_000;
const REVEAL_MS = 9_000;
const GRID = 32;          // rasterisation resolution (32x32)
const W = 800;            // logical canvas width
const H = 600;            // logical canvas height
const TARGET_THICK = 1;   // target path "thickness" radius in grid cells (so the band is 3 cells wide)
const SPILLOVER_NEAR = 1; // submission cells within this grid-distance of the target are "on path" (not penalised)
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_POINTS = 400;
const MAX_STROKES = 300;

function sanitizeStroke(raw, id) {
  if (!raw || !Array.isArray(raw.points) || raw.points.length === 0) return null;
  const points = [];
  for (const p of raw.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    points.push({ x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) });
    if (points.length >= MAX_POINTS) break;
  }
  if (points.length === 0) return null;
  const tool = raw.tool === 'eraser' ? 'eraser' : 'pen';
  let width = Number(raw.width);
  if (!Number.isFinite(width)) width = 6;
  width = Math.max(1, Math.min(64, width));
  const color = tool === 'eraser' ? '#ffffff' : (HEX_RE.test(raw.color) ? raw.color : '#1e88e5');
  return { id, color, width, tool, points };
}

function sanitizeStrokes(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  let seq = 0;
  for (const raw of rawList) {
    if (out.length >= MAX_STROKES) break;
    const s = sanitizeStroke(raw, `s${seq++}`);
    if (s) out.push(s);
  }
  return out;
}

const clampCell = (v) => Math.max(0, Math.min(GRID - 1, v));

/** Mark a single point (logical coords) into the grid Set with an optional thickness radius. */
function stampPoint(set, x, y, radius) {
  const cx = clampCell(Math.floor((x / W) * GRID));
  const cy = clampCell(Math.floor((y / H) * GRID));
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      set.add(clampCell(cx + dx) * GRID + clampCell(cy + dy));
    }
  }
}

/** Rasterise a list of {x,y} points (a poly-line) into a Set of cell indices, sampling along each segment. */
function rasterizePolyline(points, radius) {
  const set = new Set();
  if (!points || !points.length) return set;
  stampPoint(set, points[0].x, points[0].y, radius);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    // sample roughly one step per ~half a grid cell so no gaps
    const steps = Math.max(1, Math.ceil(dist / (Math.min(W, H) / GRID / 2)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      stampPoint(set, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius);
    }
  }
  return set;
}

/** Rasterise a player's submitted strokes (each stroke is its own poly-line) into a Set. */
function rasterizeStrokes(strokes, radius) {
  const set = new Set();
  for (const st of strokes || []) {
    const sub = rasterizePolyline(st.points, radius);
    for (const c of sub) set.add(c);
  }
  return set;
}

/** Generate a curvy poly-line target path across the canvas (server-side). */
function generatePath() {
  const pad = 90;
  const cols = 4 + Math.floor(Math.random() * 2); // 4-5 control points
  const ctrl = [];
  for (let i = 0; i < cols; i++) {
    const x = pad + ((W - 2 * pad) * i) / (cols - 1);
    const y = pad + Math.random() * (H - 2 * pad);
    ctrl.push({ x, y });
  }
  if (Math.random() < 0.5) ctrl.reverse();
  // smooth the control points into a denser poly-line via Catmull-Rom-ish interpolation
  const pts = [];
  const SEG = 14;
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let s = 0; s < SEG; s++) {
      const t = s / SEG;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      pts.push({ x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(H, y)) });
    }
  }
  pts.push(ctrl[ctrl.length - 1]);
  return pts;
}

/**
 * Trace Race — trace-the-path speed + accuracy with OBJECTIVE server-side scoring
 * (no voting). The server generates a curvy target path and shows it faintly on each
 * player's PRIVATE canvas; players trace over it and submit their whole strokes array
 * via GAME_ACTION. The SERVER rasterises both the true target path and the submission
 * to a 32x32 grid and scores by COVERAGE − 0.5·SPILLOVER:
 *   coverage      = fraction of target cells the submission hit
 *   spilloverRatio= submission cells far off the path / total submission cells
 *   score         = round(max(0, coverage − 0.5·spilloverRatio) * 1000)
 *
 * Anti-cheat: the path is data the client renders (it's a dexterity test, so the path
 * being visible is fine), but the SCORE is computed server-side purely from the
 * submitted strokes vs the true path — a client can't claim a score. A player only ever
 * sees their OWN submitted drawing; nobody else's strokes are exposed until 'finished'.
 */
export class TraceRace extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'drawing', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'drawing' },
        drawing: { reveal: 'reveal' },
        reveal: { next: 'drawing', finish: 'finished' },
      },
    });
    this.totalRounds = ROUNDS;
    this.roundIndex = -1;
    this.scores = {};               // cumulative across rounds
    this.path = [];                 // current round target poly-line (server-only truth)
    this.targetCells = new Set();   // rasterised target for current round
    this.submissions = {};          // pid -> sanitised strokes (current round)
    this.submitted = new Set();
    this.roundScores = {};          // pid -> this round's score
    this.roundResults = null;       // detail for reveal
    this._phaseStart = 0;           // ms timestamp of the current drawing phase's entry (for client countdown)
    this._drawTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.transition('start'); // -> drawing
    this._setupRound();
  }

  _setupRound() {
    this.roundIndex++;
    this.path = generatePath();
    this.targetCells = rasterizePolyline(this.path, TARGET_THICK);
    this.submissions = {};
    this.submitted = new Set();
    this.roundScores = {};
    this.roundResults = null;
    this._phaseStart = Date.now();
    this._clearTimers();
    this._drawTimer = setTimeout(() => {
      if (this.state !== 'drawing') return;
      for (const p of this.players) if (!this.submitted.has(p)) this._submit(p, []); // auto-submit empty for stragglers
      this._toReveal();
      this._emitChange();
    }, DRAW_MS);
  }

  _submit(pid, rawStrokes) {
    if (this.submissions[pid] !== undefined) return;
    this.submissions[pid] = sanitizeStrokes(rawStrokes);
    this.submitted.add(pid);
  }

  /** Score one submission vs the target. coverage − 0.5·spilloverRatio, scaled to 0..1000. */
  _scoreSubmission(strokes) {
    // give the submission the same band thickness as the target so a centred trace
    // can fully cover the target band (a thin centreline only hits the middle row).
    const subCells = rasterizeStrokes(strokes, TARGET_THICK);
    if (this.targetCells.size === 0) return { score: 0, coverage: 0, spilloverRatio: 0, hits: 0 };
    let hits = 0;
    let spill = 0;
    for (const c of subCells) {
      if (this.targetCells.has(c)) { hits++; continue; }
      // is this cell near the target band? (within SPILLOVER_NEAR grid cells)
      const cx = Math.floor(c / GRID);
      const cy = c % GRID;
      let near = false;
      for (let dx = -SPILLOVER_NEAR; dx <= SPILLOVER_NEAR && !near; dx++) {
        for (let dy = -SPILLOVER_NEAR; dy <= SPILLOVER_NEAR && !near; dy++) {
          if (this.targetCells.has(clampCell(cx + dx) * GRID + clampCell(cy + dy))) near = true;
        }
      }
      if (near) hits++; else spill++;
    }
    const coverage = Math.min(1, hits / this.targetCells.size);
    const spilloverRatio = subCells.size > 0 ? spill / subCells.size : 0;
    const score = Math.round(Math.max(0, coverage - 0.5 * spilloverRatio) * 1000);
    return { score, coverage, spilloverRatio, hits, subCells: subCells.size };
  }

  _toReveal() {
    if (this.state !== 'drawing') return;
    this._clearTimers();
    const detail = {};
    for (const p of this.players) {
      const r = this._scoreSubmission(this.submissions[p] || []);
      this.roundScores[p] = r.score;
      this.scores[p] = (this.scores[p] || 0) + r.score;
      detail[p] = r;
    }
    this.roundResults = { round: this.roundIndex + 1, detail, scores: { ...this.roundScores } };
    this.transition('reveal'); // -> reveal
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      this._advance();
      this._emitChange();
    }, REVEAL_MS);
  }

  _advance() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    if (this.roundIndex + 1 >= this.totalRounds) this.transition('finish');
    else { this.transition('next'); this._setupRound(); }
  }

  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'drawing' && (type === 'submit' || type === 'submitDrawing')) {
      if (this.submitted.has(playerId)) return;
      this._submit(playerId, action.strokes);
      if (this.players.length && this.players.every((p) => this.submitted.has(p))) this._toReveal();
    }
  }

  _clearTimer(name) { if (this[name]) { clearTimeout(this[name]); this[name] = null; } }
  _clearTimers() { this._clearTimer('_drawTimer'); this._clearTimer('_revealTimer'); }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    delete this.submissions[playerId];
    this.submitted.delete(playerId);
    delete this.roundScores[playerId];

    if (this.players.length <= 1) {
      this._clearTimers();
      if (this.state !== 'finished') this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'drawing' && this.players.every((p) => this.submitted.has(p))) this._toReveal();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const finished = this.state === 'finished';
    return {
      phase: this.state,
      round: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      // draw-phase deadline for client countdown + timeout auto-submit (reveal omitted:
      // its short REVEAL_MS is an internal advance, not a visible countdown)
      drawEndTime: this.state === 'drawing' ? this._phaseStart + DRAW_MS : null,
      // the target path is data the client renders (dexterity test) — visible during draw + reveal
      path: this.path,
      // a player sees ONLY their own submitted strokes; never anyone else's mid-game
      mySubmission: this.submissions[playerId] || null,
      hasSubmitted: this.submitted.has(playerId),
      submittedCount: this.submitted.size,
      playerCount: this.players.length,
      myRoundScore: this.roundScores[playerId] != null ? this.roundScores[playerId] : null,
      // round detail is disclosed only at reveal/finished, and only YOUR own coverage/spill numbers
      myRoundDetail: (this.state === 'reveal' || finished) && this.roundResults
        ? (this.roundResults.detail[playerId] || null)
        : null,
      roundScores: (this.state === 'reveal' || finished) && this.roundResults ? { ...this.roundResults.scores } : null,
      scores: { ...this.scores },
      players: this.players.slice(),
      myId: playerId,
      results: finished ? this.getResults() : null,
    };
  }

  isComplete() { return this.state === 'finished'; }

  getResults() {
    const sorted = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    let placement = 1;
    return sorted.map((p, i) => {
      if (i > 0 && (this.scores[p] || 0) < (this.scores[sorted[i - 1]] || 0)) placement = i + 1;
      return { playerId: p, placement, score: this.scores[p] || 0, handDescription: `${this.scores[p] || 0} pts` };
    });
  }
}
