import { BaseGame } from './BaseGame.js';
import { pickWord } from '../utils/wordBank.js';

const DRAW_MS = 40000;
const RATE_MS = 45000;
const REVEAL_MS = 12000;
const MAX_RATING = 5;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Sanitise ONE submitted stroke into the canonical {color,width,tool,points} shape.
 * Clamps coords to the 800x600 logical space, caps points, validates width + colour.
 */
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
  if (!Number.isFinite(width)) width = 6;
  width = Math.max(1, Math.min(64, width));
  const color = tool === 'eraser' ? '#ffffff' : (HEX_RE.test(raw.color) ? raw.color : '#000000');
  return { id, color, width, tool, points };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * One-Line Wonder — everyone draws the SAME secret word in a SINGLE unbroken stroke.
 *
 * THE GIMMICK (server-enforced): a submitted drawing must contain EXACTLY ONE stroke.
 * The server rejects any `submitDrawing` whose strokes array has length !== 1. The
 * client locks the canvas after the first pen-up to make this easy, but the rule is
 * authoritative on the server.
 *
 * Phases: draw (40s, simultaneous, barrier on all-submitted OR timer) -> rate (each
 * player privately rates every OTHER drawing 1..5; you CANNOT rate your own) -> reveal
 * (all drawings + per-drawing rating totals shown) -> finished.
 *
 * Anti-cheat (structural): the word is shared so it's fine to show, but during DRAW a
 * player only ever sees their OWN strokes (no peeking at others' lines). Other players'
 * drawings are withheld until the rate/reveal phases. Individual ratings are hidden
 * until reveal (only your own submitted rating echoes back during rating). Score =
 * total rating received; ranked DESC, ties share a placement.
 */
export class OneLineWonder extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'draw', 'rate', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'draw' },
        draw: { rate: 'rate', finish: 'finished' },
        rate: { reveal: 'reveal', finish: 'finished' },
        reveal: { finish: 'finished' },
      },
    });
    this.word = null;
    this.drawings = {};          // playerId -> stroke (single) or null (submitted blank)
    this.submitted = new Set();  // who has submitted their drawing
    this.ratings = {};           // raterId -> { targetId -> 1..5 }
    this.rated = new Set();      // who has finished rating
    this.scores = {};            // targetId -> total rating received
    this.acknowledged = new Set();
    this.revealOrder = [];
    this._seq = 0;
    this._drawTimer = null;
    this._rateTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    const w = pickWord();
    this.word = w ? w.word : 'mystery';
    this.transition('start'); // -> onEnterDraw
  }

  // ---------- DRAW ----------
  onEnterDraw() {
    this.submitted = new Set();
    this._clearTimers();
    this._drawTimer = setTimeout(() => {
      if (this.state !== 'draw') return;
      // auto-submit whatever (empty) for anyone who didn't finish
      for (const p of this.players) {
        if (!this.submitted.has(p)) { if (this.drawings[p] === undefined) this.drawings[p] = null; this.submitted.add(p); }
      }
      this._toRate();
      this._emitChange();
    }, DRAW_MS);
  }

  _checkDrawComplete() {
    if (this.state !== 'draw') return;
    if (this.players.length && this.players.every((p) => this.submitted.has(p))) this._toRate();
  }

  _toRate() {
    if (this.state !== 'draw') return;
    this._clearTimers();
    this.transition('rate'); // -> onEnterRate
  }

  // ---------- RATE ----------
  onEnterRate() {
    this.ratings = {};
    this.rated = new Set();
    // auto-mark anyone with no one to rate (e.g. solo) as done
    this._clearTimers();
    this._rateTimer = setTimeout(() => {
      if (this.state !== 'rate') return;
      for (const p of this.players) if (!this.rated.has(p)) this.rated.add(p);
      this._toReveal();
      this._emitChange();
    }, RATE_MS);
    // if only one player remains there's nothing to rate
    this._checkRateComplete();
  }

  _ratableTargetsFor(p) { return this.players.filter((t) => t !== p); }

  _checkRateComplete() {
    if (this.state !== 'rate') return;
    if (this.players.length && this.players.every((p) => this.rated.has(p))) this._toReveal();
  }

  _toReveal() {
    if (this.state !== 'rate') return;
    this._clearTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    // tally: score = total rating received from all other players
    const totals = {};
    const counts = {};
    for (const p of this.players) { totals[p] = 0; counts[p] = 0; }
    for (const [rater, byTarget] of Object.entries(this.ratings)) {
      if (!this.players.includes(rater)) continue;
      for (const [target, val] of Object.entries(byTarget)) {
        if (!this.players.includes(target) || target === rater) continue;
        const n = Number(val);
        if (!Number.isFinite(n)) continue;
        totals[target] = (totals[target] || 0) + n;
        counts[target] = (counts[target] || 0) + 1;
      }
    }
    for (const p of this.players) this.scores[p] = totals[p] || 0;
    this._revealCounts = counts;
    this.revealOrder = [...this.players].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
    this.acknowledged = new Set();
    this._clearTimers();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._finish();
      this._emitChange();
    }, REVEAL_MS);
    this._checkRevealComplete();
  }

  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.length && this.players.every((p) => this.acknowledged.has(p))) this._finish();
  }

  _finish() {
    if (this.state !== 'reveal') return;
    this._clearTimers();
    this.transition('finish'); // -> finished
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'draw' && (type === 'submitDrawing' || type === 'submit')) {
      if (this.submitted.has(playerId)) return;
      const strokes = Array.isArray(action.strokes) ? action.strokes : [];
      // THE GIMMICK: exactly one stroke. >1 is rejected outright.
      if (strokes.length > 1) return;
      const s = strokes.length === 1 ? sanitizeStroke(strokes[0], `${playerId}:${this._seq++}`) : null;
      this.drawings[playerId] = s; // null when they submit an empty canvas
      this.submitted.add(playerId);
      this._checkDrawComplete();
    } else if (this.state === 'rate' && (type === 'submitRatings' || type === 'rate')) {
      if (this.rated.has(playerId)) return;
      const raw = action.ratings && typeof action.ratings === 'object' ? action.ratings : {};
      const clean = {};
      for (const target of this._ratableTargetsFor(playerId)) {
        let v = Number(raw[target]);
        if (!Number.isFinite(v)) continue;
        v = Math.max(1, Math.min(MAX_RATING, Math.round(v)));
        clean[target] = v; // never allow a self-rating (target !== playerId by construction)
      }
      this.ratings[playerId] = clean;
      this.rated.add(playerId);
      this._checkRateComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _clearTimers() {
    for (const k of ['_drawTimer', '_rateTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.submitted.delete(playerId);
    this.rated.delete(playerId);
    this.acknowledged.delete(playerId);
    delete this.drawings[playerId];
    delete this.ratings[playerId];
    // drop ratings other players gave to the leaver
    for (const byTarget of Object.values(this.ratings)) delete byTarget[playerId];

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'draw') this._checkDrawComplete();
    else if (this.state === 'rate') this._checkRateComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const finished = this.state === 'finished';
    const showAll = this.state === 'rate' || this.state === 'reveal' || finished;

    // gallery of OTHER players' drawings — only exposed from rate phase onward.
    // during draw, a player sees ONLY their own stroke.
    let gallery = null;
    if (showAll) {
      gallery = this.players
        .filter((p) => p !== playerId || this.state !== 'rate') // in rate, you rate OTHERS; in reveal show everyone incl. you
        .map((p) => ({
          playerId: p,
          stroke: this.drawings[p] || null,
          isMine: p === playerId,
          // ratings + totals withheld until reveal/finished
          total: (this.state === 'reveal' || finished) ? (this.scores[p] || 0) : null,
        }));
      // during rate, exclude self entirely from the list to rate
      if (this.state === 'rate') gallery = gallery.filter((g) => g.playerId !== playerId);
    }

    return {
      phase: this.state,
      word: this.word, // shared word — fine to show always
      myId: playerId,
      // DRAW: only your own stroke
      myStroke: this.drawings[playerId] || null,
      myStrokes: this.drawings[playerId] ? [this.drawings[playerId]] : [],
      hasSubmitted: this.submitted.has(playerId),
      submittedCount: this.submitted.size,
      playerCount: this.players.length,
      // RATE
      gallery,
      ratableIds: this.state === 'rate' ? this._ratableTargetsFor(playerId) : [],
      myRatings: this.state === 'rate' && this.ratings[playerId] ? { ...this.ratings[playerId] } : null,
      hasRated: this.rated.has(playerId),
      ratedCount: this.rated.size,
      // REVEAL
      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      revealOrder: (this.state === 'reveal' || finished) ? this.revealOrder.slice() : null,
      scores: (this.state === 'reveal' || finished) ? { ...this.scores } : null,
      players: this.players.slice(),
      results: finished ? this.getResults() : null,
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
        handDescription: `${this.scores[playerId] || 0} ★`,
      };
    });
  }
}
