import { BaseGame } from './BaseGame.js';

const DRAW_MS = 60_000;
const CAPTION_MS = 45_000;
const VOTE_MS = 40_000;
const REVEAL_MS = 50_000; // long no-countdown AFK safety net; players advance via Continue
const VOTE_POINTS = 100; // awarded to BOTH the doodle author and the caption author per vote
const MAX_CAPTION_LEN = 100;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Silly prompts to doodle. Absurd on purpose.
const PROMPT_BANK = [
  'a cat running a business meeting',
  'a banana riding a skateboard',
  'the world\'s angriest teapot',
  'a dinosaur ordering coffee',
  'a robot trying to do yoga',
  'a snail in a hurry',
  'a penguin at the beach',
  'a wizard who lost his hat',
  'a duck driving a tank',
  'spaghetti escaping a plate',
  'a llama at the gym',
  'a ghost stuck in traffic',
  'a potato running for president',
  'a shark wearing a tiny hat',
  'a frog hosting a talk show',
  'an octopus juggling',
  'a sloth winning a race',
  'a pigeon plotting world domination',
  'a sandwich falling in love',
  'a confused robot vacuum',
  'a disco ball at a funeral',
  'a goose chasing a businessman',
  'a cactus going for a swim',
  'a hamster lifting weights',
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
 * Sanitise a single submitted stroke into the canonical Stroke shape used by the
 * DrawingCanvas. Clamps coords to the 800x600 logical space, caps points/width,
 * and validates color. Returns null for empty/invalid strokes.
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
  if (!Number.isFinite(width)) width = 5;
  width = Math.max(1, Math.min(64, width));
  const color = tool === 'eraser' ? '#ffffff' : (HEX_RE.test(raw.color) ? raw.color : '#000000');
  return { id, color, width, tool, points };
}

function sanitizeStrokes(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (let i = 0; i < rawList.length; i++) {
    const s = sanitizeStroke(rawList[i], `s${i}`);
    if (s) out.push(s);
    if (out.length >= 300) break;
  }
  return out;
}

/**
 * Caption Clash — draw → caption → vote in three phases.
 *
 *  DRAW: every player draws an absurd doodle to a shared silly prompt and submits
 *        the whole strokes array (one GAME_ACTION, no relay). A barrier advances
 *        on all-submitted or the draw timer.
 *  CAPTION: each player is shown SOMEONE ELSE'S doodle (rotated assignment) and
 *        writes a funny caption. Barrier on all-captioned or the caption timer.
 *  VOTE: each doodle+caption PAIR is shown anonymously; everyone votes the funniest
 *        pair. You cannot vote your own doodle OR your own caption.
 *  REVEAL/FINISHED: authors + votes + scoreboard. Both the doodle author and the
 *        caption author earn VOTE_POINTS per vote their pair received.
 *
 * Anti-cheat (structural, server-authoritative):
 *  - During DRAW a player's getStateForPlayer only ever contains their OWN strokes;
 *    another player's drawing is NEVER serialised to them until the caption/vote phase.
 *  - Caption assignments are computed server-side (rotation) so you can't caption
 *    your own doodle.
 *  - Voting pairs carry NO doodleAuthor / captionAuthor id and no who-voted info
 *    until reveal — they are anonymous. A player cannot vote for a pair they
 *    authored either side of (own doodle or own caption).
 */
export class CaptionClash extends BaseGame {
  constructor(players) {
    super(players, {
      states: ['waiting', 'draw', 'caption', 'vote', 'reveal', 'finished'],
      initialState: 'waiting',
      transitions: {
        waiting: { start: 'draw' },
        draw: { caption: 'caption', finish: 'finished' },
        caption: { vote: 'vote', finish: 'finished' },
        vote: { reveal: 'reveal', finish: 'finished' },
        reveal: { finish: 'finished' },
      },
    });
    this.scores = {};
    this.prompt = '';
    this.drawings = {};   // playerId -> strokes[]  (the doodle they drew)
    this.captionOf = {};  // captionerId -> doodleAuthorId they were assigned
    this.captions = {};   // captionerId -> caption text
    this.pairs = [];       // [{ pairId, doodleAuthorId, captionAuthorId, strokes, caption }]
    this.votes = {};       // voterId -> pairId
    this.revealData = null;
    this.acknowledged = new Set();
    this._phaseStart = 0; // ms timestamp of the current timed phase's entry (for client countdown)
    this._drawTimer = null;
    this._captionTimer = null;
    this._voteTimer = null;
    this._revealTimer = null;
  }

  setOnStateChange(cb) { this._onStateChange = cb; }
  _emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

  startGame() {
    for (const p of this.players) this.scores[p] = 0;
    this.prompt = PROMPT_BANK[Math.floor(Math.random() * PROMPT_BANK.length)];
    this.transition('start'); // -> onEnterDraw
  }

  // ---------- DRAW ----------
  onEnterDraw() {
    this.drawings = {};
    this._phaseStart = Date.now();
    this._clearAllTimers();
    this._drawTimer = setTimeout(() => {
      if (this.state !== 'draw') return;
      for (const p of this.players) if (this.drawings[p] === undefined) this.drawings[p] = [];
      this._toCaption();
      this._emitChange();
    }, DRAW_MS);
  }

  _toCaption() {
    if (this.state !== 'draw') return;
    this._clearAllTimers();
    this.transition('caption'); // -> onEnterCaption
  }

  // ---------- CAPTION ----------
  onEnterCaption() {
    // Rotate doodle assignments: each captioner gets the NEXT player's doodle.
    // With >=2 players this guarantees nobody captions their own doodle.
    const order = [...this.players];
    this.captionOf = {};
    const n = order.length;
    for (let i = 0; i < n; i++) {
      const captioner = order[i];
      const target = order[(i + 1) % n];
      this.captionOf[captioner] = target;
    }
    this.captions = {};
    this._phaseStart = Date.now();
    this._clearAllTimers();
    this._captionTimer = setTimeout(() => {
      if (this.state !== 'caption') return;
      for (const p of this.players) if (this.captions[p] === undefined) this.captions[p] = '';
      this._toVote();
      this._emitChange();
    }, CAPTION_MS);
  }

  _toVote() {
    if (this.state !== 'caption') return;
    this._clearAllTimers();
    this.transition('vote'); // -> onEnterVote
  }

  // ---------- VOTE ----------
  onEnterVote() {
    // Build the anonymous pair gallery: one pair per captioner (their caption on
    // the doodle author's drawing).
    const built = [];
    for (const captioner of this.players) {
      const doodleAuthorId = this.captionOf[captioner];
      if (doodleAuthorId === undefined) continue;
      built.push({
        doodleAuthorId,
        captionAuthorId: captioner,
        strokes: this.drawings[doodleAuthorId] || [],
        caption: this.captions[captioner] || '',
      });
    }
    this.pairs = shuffle(built).map((p, i) => ({ pairId: `pair_${i}`, ...p }));
    this.votes = {};
    this._phaseStart = Date.now();
    this._clearAllTimers();
    this._voteTimer = setTimeout(() => {
      if (this.state !== 'vote') return;
      for (const p of this.players) if (this.votes[p] === undefined) this._autoVote(p);
      this._toReveal();
      this._emitChange();
    }, VOTE_MS);
  }

  _canVote(pairId, voterId) {
    const pair = this.pairs.find((p) => p.pairId === pairId);
    if (!pair) return false;
    if (pair.doodleAuthorId === voterId) return false;  // own doodle
    if (pair.captionAuthorId === voterId) return false; // own caption
    return true;
  }

  _autoVote(p) {
    const choices = this.pairs.filter((pair) => this._canVote(pair.pairId, p));
    if (choices.length) this.votes[p] = choices[Math.floor(Math.random() * choices.length)].pairId;
    else this.votes[p] = null;
  }

  _toReveal() {
    if (this.state !== 'vote') return;
    this._clearAllTimers();
    this.transition('reveal'); // -> onEnterReveal
  }

  // ---------- REVEAL ----------
  onEnterReveal() {
    const votersByPair = {};
    for (const [voter, pairId] of Object.entries(this.votes)) {
      if (!pairId) continue;
      (votersByPair[pairId] = votersByPair[pairId] || []).push(voter);
    }
    // Award: both the doodle author and the caption author earn per vote.
    for (const pair of this.pairs) {
      const n = (votersByPair[pair.pairId] || []).length;
      if (n === 0) continue;
      const gain = VOTE_POINTS * n;
      if (this.scores[pair.doodleAuthorId] != null) this.scores[pair.doodleAuthorId] += gain;
      if (this.scores[pair.captionAuthorId] != null) this.scores[pair.captionAuthorId] += gain;
    }
    this.revealData = {
      pairs: this.pairs.map((p) => ({
        pairId: p.pairId,
        doodleAuthorId: p.doodleAuthorId,
        captionAuthorId: p.captionAuthorId,
        strokes: p.strokes,
        caption: p.caption,
        voters: votersByPair[p.pairId] || [],
        voteCount: (votersByPair[p.pairId] || []).length,
      })),
    };
    this.acknowledged = new Set();
    this._clearAllTimers();
    this._revealTimer = setTimeout(() => {
      if (this.state !== 'reveal') return;
      for (const p of this.players) this.acknowledged.add(p);
      this._finish();
      this._emitChange();
    }, REVEAL_MS);
  }

  _finish() {
    if (this.state !== 'reveal') return;
    this._clearAllTimers();
    this.transition('finish');
  }

  // ---------- ACTIONS ----------
  handleAction(playerId, action) {
    if (!this.players.includes(playerId)) return;
    const type = action && action.type;
    if (this.state === 'draw' && (type === 'submit' || type === 'submitDrawing')) {
      if (this.drawings[playerId] !== undefined) return;
      this.drawings[playerId] = sanitizeStrokes(action.strokes);
      this._checkDrawComplete();
    } else if (this.state === 'caption' && type === 'caption') {
      if (this.captions[playerId] !== undefined) return;
      const t = String(action.text || '').trim().slice(0, MAX_CAPTION_LEN);
      this.captions[playerId] = t;
      this._checkCaptionComplete();
    } else if (this.state === 'vote' && (type === 'vote' || type === 'castVote')) {
      if (this.votes[playerId] !== undefined) return;
      const pairId = action.pairId;
      if (!this._canVote(pairId, playerId)) return;
      this.votes[playerId] = pairId;
      this._checkVoteComplete();
    } else if (this.state === 'reveal' && type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkRevealComplete();
    }
  }

  _checkDrawComplete() {
    if (this.state !== 'draw') return;
    if (this.players.length && this.players.every((p) => this.drawings[p] !== undefined)) this._toCaption();
  }
  _checkCaptionComplete() {
    if (this.state !== 'caption') return;
    if (this.players.length && this.players.every((p) => this.captions[p] !== undefined)) this._toVote();
  }
  _checkVoteComplete() {
    if (this.state !== 'vote') return;
    if (this.players.length && this.players.every((p) => this.votes[p] !== undefined)) this._toReveal();
  }
  _checkRevealComplete() {
    if (this.state !== 'reveal') return;
    if (this.players.length && this.players.every((p) => this.acknowledged.has(p))) this._finish();
  }

  _clearAllTimers() {
    for (const k of ['_drawTimer', '_captionTimer', '_voteTimer', '_revealTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
  }
  destroy() { this._clearAllTimers(); this._onStateChange = null; }

  removePlayer(playerId) {
    super.removePlayer(playerId); // prunes this.players + activePlayers
    this.acknowledged.delete(playerId);
    delete this.votes[playerId];

    if (this.players.length <= 1 && this.state !== 'finished') {
      this._clearAllTimers();
      this.state = 'finished';
      this._emitChange();
      return;
    }
    if (this.state === 'draw') this._checkDrawComplete();
    else if (this.state === 'caption') this._checkCaptionComplete();
    else if (this.state === 'vote') this._checkVoteComplete();
    else if (this.state === 'reveal') this._checkRevealComplete();
    this._emitChange();
  }

  getStateForPlayer(playerId) {
    const revealed = this.state === 'reveal' || this.state === 'finished';
    // During caption phase, show the captioner the doodle they were assigned.
    let captionTask = null;
    if (this.state === 'caption') {
      const targetId = this.captionOf[playerId];
      if (targetId !== undefined) {
        captionTask = { strokes: this.drawings[targetId] || [], hasCaptioned: this.captions[playerId] !== undefined };
      }
    }
    return {
      phase: this.state,
      prompt: this.prompt,
      myId: playerId,
      playerCount: this.players.length,
      scores: { ...this.scores },

      // phase deadlines for client countdown + timeout auto-submit (reveal intentionally omitted:
      // its long REVEAL_MS is a no-countdown AFK net — players advance via Continue)
      drawEndTime: this.state === 'draw' ? this._phaseStart + DRAW_MS : null,
      captionEndTime: this.state === 'caption' ? this._phaseStart + CAPTION_MS : null,
      voteEndTime: this.state === 'vote' ? this._phaseStart + VOTE_MS : null,

      // DRAW — a player only ever sees their OWN strokes
      myDrawing: this.state === 'draw' ? (this.drawings[playerId] || []) : null,
      hasDrawn: this.drawings[playerId] !== undefined,
      drawnCount: Object.keys(this.drawings).length,

      // CAPTION
      captionTask,
      hasCaptioned: this.captions[playerId] !== undefined,
      captionedCount: Object.keys(this.captions).length,

      // VOTE — anonymous gallery, no author ids leaked, can-vote flag per pair
      gallery: this.state === 'vote'
        ? this.pairs.map((p) => ({
            pairId: p.pairId,
            strokes: p.strokes,
            caption: p.caption,
            canVote: this._canVote(p.pairId, playerId),
          }))
        : null,
      myVote: this.votes[playerId] != null ? this.votes[playerId] : null,
      votedCount: Object.keys(this.votes).length,

      acknowledged: this.state === 'reveal' ? [...this.acknowledged] : [],
      reveal: revealed ? this.revealData : null,
      results: this.state === 'finished' ? this.getResults() : null,
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
        handDescription: `${this.scores[playerId] || 0} pts`,
      };
    });
  }
}
