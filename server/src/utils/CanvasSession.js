const MAX_POINTS_PER_STROKE = 400;
const MAX_STROKES = 1500;
const MIN_STROKE_INTERVAL_MS = 33;
const MAX_WIDTH = 64;
const MIN_WIDTH = 1;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * CanvasSession — pure server-side state + validation for a real-time drawing
 * surface. Owns pixels only (a stroke list); no timers, no players, no scoring.
 * Server-authoritative: only the active drawer may add/undo/clear, all input is
 * sanitized (coords clamped, widths clamped, colors validated, ids reissued), and
 * traffic is throttled. The consuming game FSM owns the word, turns and scoring.
 */
export class CanvasSession {
  constructor({ logicalWidth = 800, logicalHeight = 600 } = {}) {
    this.logicalWidth = logicalWidth;
    this.logicalHeight = logicalHeight;
    this.strokes = [];
    this.drawerId = null;
    this._seq = 0;
    this._lastStrokeAt = 0;
  }

  setDrawer(playerId) { this.drawerId = playerId || null; }
  getDrawer() { return this.drawerId; }

  addStroke(senderId, raw, now = Date.now()) {
    if (!this.drawerId || senderId !== this.drawerId) return { ok: false };
    if (now - this._lastStrokeAt < MIN_STROKE_INTERVAL_MS) return { ok: false };
    if (this.strokes.length >= MAX_STROKES) return { ok: false };
    if (!raw || !Array.isArray(raw.points) || raw.points.length === 0) return { ok: false };

    const points = [];
    for (const p of raw.points) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      points.push({
        x: Math.max(0, Math.min(this.logicalWidth, p.x)),
        y: Math.max(0, Math.min(this.logicalHeight, p.y)),
      });
      if (points.length >= MAX_POINTS_PER_STROKE) break;
    }
    if (points.length === 0) return { ok: false };

    const tool = raw.tool === 'eraser' ? 'eraser' : 'pen';
    let width = Number(raw.width);
    if (!Number.isFinite(width)) width = 4;
    width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
    let color = tool === 'eraser' ? '#ffffff' : (HEX_RE.test(raw.color) ? raw.color : '#000000');

    const stroke = { id: `${senderId}:${this._seq++}`, color, width, tool, points };
    this.strokes.push(stroke);
    this._lastStrokeAt = now;
    return { ok: true, stroke };
  }

  undo(senderId) {
    if (!this.drawerId || senderId !== this.drawerId) return { ok: false };
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].id.startsWith(`${senderId}:`)) {
        const [removed] = this.strokes.splice(i, 1);
        return { ok: true, strokeId: removed.id };
      }
    }
    return { ok: false };
  }

  clear(senderId) {
    if (!this.drawerId || senderId !== this.drawerId) return { ok: false };
    this.strokes = [];
    return { ok: true };
  }

  snapshot() { return { strokes: this.strokes, drawerId: this.drawerId, seq: this._seq }; }
  reset() { this.strokes = []; } // keep _seq monotonic so post-reset ids never collide
  destroy() { this.strokes = []; this.drawerId = null; }
}
