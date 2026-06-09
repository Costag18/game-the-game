# Drawing Canvas Infrastructure — Implementation Spec

slug: drawing-canvas-infra
status: draft
author: spec-writer subagent
date: 2026-06-08
depends-on: (none — this is shared infra)
consumed-by: skribbl (draw-and-guess), telephone-pictionary

---

## 1. Purpose & consumers

A reusable, server-authoritative real-time drawing layer. It owns **pixels only**: capturing one player's strokes, relaying them to everyone in the room, and replaying them to mid-round joiners/reconnects. It does **not** own turns, words, scoring, or game completion — that stays in the consuming game's FSM (a `BaseGame` subclass). The split, stated once and enforced everywhere:

- **Infra owns:** the canvas stroke list, stroke relay socket events, validation/throttle, word-bank picking, guess normalization/matching.
- **Game FSM owns:** who is the current drawer, the secret word, turn timers, when the drawing phase starts/ends, and `getResults()` placements.

The word is **never** sent to the client of a guesser. The guess-match util runs server-side only.

### Consumers

| Game | Uses |
|------|------|
| **Skribbl** (draw-and-guess) | `DrawingCanvas` (drawer writes, guessers read-only), stroke relay, `wordBank`, `guessMatch` (live chat-guess detection) |
| **Telephone Pictionary** | `DrawingCanvas` (each player draws on their own private canvas per phase), `wordBank` (initial prompts), `guessMatch` (optional fuzzy compare of final guess to original prompt for a "telephone accuracy" stat) |

Both games are separately specced. This doc specifies the shared interfaces those specs assume.

### Non-goals (YAGNI)

- No persistence of drawings to disk/DB.
- No image export (PNG download) in v1.
- No pressure sensitivity, layers, fill-bucket, or shapes — freehand pen + eraser + clear + undo only.
- No vector smoothing/bezier server-side; the client may smooth visually but transmits raw points.

---

## 2. Public interface / API

### 2.1 `shared/events.js` additions

Append to the existing `EVENTS` object (same style as `GIF_SEND`/`GIF_BROADCAST`):

```js
// --- Drawing canvas infra ---
STROKE_SEND:       'draw:strokeSend',       // drawer -> server: a stroke (or point batch)
STROKE_BROADCAST:  'draw:strokeBroadcast',  // server -> room: append this stroke
CANVAS_CLEAR_SEND: 'draw:clearSend',        // drawer -> server: clear my canvas
CANVAS_CLEAR:      'draw:clear',            // server -> room: wipe the canvas
CANVAS_UNDO_SEND:  'draw:undoSend',         // drawer -> server: remove my last stroke
CANVAS_UNDO:       'draw:undo',             // server -> room: pop last stroke (by strokeId)
CANVAS_SNAPSHOT:   'draw:snapshot',         // server -> one socket: full stroke list (join/reconnect)
```

`STROKE_SEND` / `CANVAS_*_SEND` are deliberately **separate channels from `GAME_ACTION`**. They are high-frequency pixel traffic and must not flow through the FSM's `handleAction` (which re-broadcasts full `GAME_STATE` to every player on every call — far too heavy for 20–30 strokes/sec). The FSM is informed of canvas activity only when it matters (a correct guess, drawer leaves), via the game's own `GAME_ACTION` events (e.g. a `guess` action) or via `CanvasSession` callbacks (Section 3.3).

### 2.2 Logical coordinate system

All coordinates are in a **fixed logical resolution** so every client agrees regardless of physical canvas size.

```
LOGICAL_WIDTH  = 800
LOGICAL_HEIGHT = 600   // 4:3
```

Points are stored/transmitted as floats `0..800` / `0..600`. The client scales its DOM canvas to this logical space (Section 4.3). The server never needs the physical pixel size.

### 2.3 Data shapes

```js
// A point in logical space.
Point = { x: number, y: number }     // 0..800, 0..600 (server clamps)

// A stroke: one continuous pen-down→pen-up gesture, OR a server-coalesced batch.
Stroke = {
  id:    string,          // stroke id, e.g. `${socketId}:${seq}` — assigned/validated server-side
  color: string,          // hex '#rrggbb' (eraser sends color '#ffffff' OR tool:'eraser')
  width: number,          // logical px, clamped 1..64
  tool:  'pen' | 'eraser',
  points: Point[],        // 1..MAX_POINTS_PER_STROKE
}

// STROKE_SEND payload (client -> server)
{ stroke: Stroke }        // id may be omitted; server (re)issues a canonical id

// STROKE_BROADCAST payload (server -> room)
{ stroke: Stroke, drawerId: string }

// CANVAS_SNAPSHOT payload (server -> joining socket)
{ strokes: Stroke[], drawerId: string | null, seq: number }

// CANVAS_UNDO payload (server -> room)
{ strokeId: string }

// CANVAS_CLEAR payload (server -> room)
{ drawerId: string }     // who cleared (for an optional UI flash)
```

### 2.4 Server module surface

`server/src/utils/CanvasSession.js`

```js
export class CanvasSession {
  constructor({ logicalWidth = 800, logicalHeight = 600 } = {})

  setDrawer(playerId | null)          // game FSM tells infra who may draw now; clears nothing
  getDrawer()                          // -> playerId | null

  // Returns { ok, stroke } if accepted (id assigned, points clamped), or { ok:false } if rejected.
  // Enforces: sender === drawer, throttle, point cap, stroke cap, numeric validation.
  addStroke(senderId, rawStroke, now = Date.now())

  undo(senderId)    // -> { ok, strokeId } | { ok:false }  (only drawer; pops their last stroke)
  clear(senderId)   // -> { ok } | { ok:false }            (only drawer; wipes strokes)

  snapshot()        // -> { strokes, drawerId, seq }       (for joiners/reconnects)
  reset()           // wipe strokes + seq for a new drawing phase (keeps drawer)
  destroy()         // drop references (no timers live here)
}
```

`CanvasSession` holds **no timers** — it is pure state + validation. All timing (turn timer, reveal timer) lives in the consuming game FSM, which already follows the `setOnStateChange`/`destroy` timer contract.

### 2.5 Word-bank module surface

`server/src/utils/wordBank.js` (mirrors the flat-export style of `server/src/utils/words.js`)

```js
export const WORD_BANK = {
  animals:  { easy: [...], medium: [...], hard: [...] },
  food:     { easy: [...], medium: [...], hard: [...] },
  objects:  { easy: [...], medium: [...], hard: [...] },
  actions:  { easy: [...], medium: [...], hard: [...] },
  places:   { easy: [...], medium: [...], hard: [...] },
};

export const CATEGORIES = Object.keys(WORD_BANK);
export const DIFFICULTIES = ['easy', 'medium', 'hard'];

// Pick `count` distinct words. Filters by category/difficulty if given.
// Returns [{ word, category, difficulty }].
export function pickWords(count = 1, { category = null, difficulty = null, exclude = [] } = {})

// Convenience: one word.
export function pickWord(opts = {})   // -> { word, category, difficulty }
```

Words are lowercase single tokens or short two-word phrases (e.g. `'ice cream'`). The picker dedupes against `exclude` (already-used words this game) so no word repeats within a tournament round.

### 2.6 Guess-match util surface

`server/src/utils/guessMatch.js`

```js
// Normalize for comparison: lowercase, trim, collapse internal whitespace,
// strip punctuation, strip accents (NFD), remove a leading 'a '/'an '/'the '.
export function normalizeGuess(text)   // -> string

// True if guess matches the secret word.
// exact: normalized equality.
// fuzzy (default true): also accept Levenshtein distance <= maxDistance
//   ONLY when the word length >= 4 (avoid 'cat'~'cot' false positives).
export function isCorrectGuess(guess, secretWord, { fuzzy = true, maxDistance = 1 } = {})
  // -> { correct: boolean, exact: boolean, distance: number }

// "close but not exact" — for a "you're close!" private nudge to the guesser.
export function isCloseGuess(guess, secretWord)   // -> boolean (distance === 1..2, not correct)

export function levenshtein(a, b)   // -> number  (bounded; early-exits past a small cap)
```

`guessMatch` runs **server-side only** and is given the secret word by the FSM. The word never crosses the wire to a guesser.

### 2.7 Client component surface

`client/src/components/DrawingCanvas.jsx`

```jsx
<DrawingCanvas
  readOnly={boolean}          // guessers: true; current drawer: false
  strokes={Stroke[]}          // authoritative strokes to render (from snapshot + broadcasts)
  onStroke={(stroke) => {}}   // fired on pen-up (drawer only) — parent emits STROKE_SEND
  onClear={() => {}}          // drawer pressed Clear — parent emits CANVAS_CLEAR_SEND
  onUndo={() => {}}           // drawer pressed Undo — parent emits CANVAS_UNDO_SEND
  logicalWidth={800}
  logicalHeight={600}
  toolbar={boolean}           // show color/size/eraser/undo/clear controls (drawer only)
/>
```

The component is **controlled**: it renders exactly the `strokes` array the parent passes plus the local in-progress stroke. It never holds the authoritative list — the parent (a game screen) owns it, fed by `CANVAS_SNAPSHOT` + `STROKE_BROADCAST`. This guarantees what the drawer sees == what guessers see (server is source of truth).

---

## 3. Server design

### 3.1 Where it lives & how it plugs into `BaseGame`

`CanvasSession` is a **helper owned by the game FSM instance**, not a `BaseGame` subclass and not a global. A drawing game holds one:

```js
// inside e.g. server/src/games/Skribbl.js (separately specced)
import { CanvasSession } from '../utils/CanvasSession.js';
import { pickWord } from '../utils/wordBank.js';
import { isCorrectGuess } from '../utils/guessMatch.js';

export class Skribbl extends BaseGame {
  constructor(players) {
    super(players, { /* states: waiting, drawing, reveal, finished ... */ });
    this.canvas = new CanvasSession();   // pixels
    this.secretWord = null;              // word — FSM-owned, never serialized to guessers
    // ... scores, turn order, round counters ...
  }
}
```

The infra deliberately does **not** know about `players`, scoring, or `getResults()` — that is the FSM's job and is unchanged from every other game.

### 3.2 Routing stroke traffic (NOT through handleAction)

Stroke events bypass the FSM's `handleAction`. They get their own socket handlers in `server/src/index.js`, registered alongside `GIF_SEND` (around line 427). They resolve the tournament/game the same way `GAME_ACTION` does (line 1061–1066) and forward to the game's `CanvasSession` **only if the active game exposes one**:

```js
// server/src/index.js  — new handlers, modeled on GIF_SEND + GAME_ACTION

socket.on(EVENTS.STROKE_SEND, (data) => {
  const lobbyId = lobbyManager.getPlayerLobby(socket.id);
  const tm = tournaments.get(lobbyId);
  if (!tm || !tm.activeGame || !tm.activeGame.canvas) return;   // not a drawing game
  const res = tm.activeGame.canvas.addStroke(socket.id, data?.stroke);
  if (!res.ok) return;                                          // throttled / not drawer / invalid
  io.to(lobbyId).emit(EVENTS.STROKE_BROADCAST, {
    stroke: res.stroke,
    drawerId: socket.id,
  });
});

socket.on(EVENTS.CANVAS_UNDO_SEND, (data) => {
  const lobbyId = lobbyManager.getPlayerLobby(socket.id);
  const tm = tournaments.get(lobbyId);
  if (!tm?.activeGame?.canvas) return;
  const res = tm.activeGame.canvas.undo(socket.id);
  if (res.ok) io.to(lobbyId).emit(EVENTS.CANVAS_UNDO, { strokeId: res.strokeId });
});

socket.on(EVENTS.CANVAS_CLEAR_SEND, () => {
  const lobbyId = lobbyManager.getPlayerLobby(socket.id);
  const tm = tournaments.get(lobbyId);
  if (!tm?.activeGame?.canvas) return;
  if (tm.activeGame.canvas.clear(socket.id).ok) {
    io.to(lobbyId).emit(EVENTS.CANVAS_CLEAR, { drawerId: socket.id });
  }
});
```

> Why the `tm.activeGame.canvas` duck-type check: keeps the relay generic. Any future drawing game that holds a `.canvas = new CanvasSession()` participates automatically; non-drawing games (Poker, Uno…) simply have no `.canvas`, so the handlers no-op. This mirrors the existing `typeof game.setOnStateChange === 'function'` duck-type at line 1204.

### 3.3 Snapshot on join / reconnect

Two places must push a `CANVAS_SNAPSHOT` so a late or reconnecting client paints what already exists:

1. **Right after the first `GAME_STATE` for a mid-round joiner.** The mid-tournament-join path and the leave/restart path both already loop `tm.players` emitting `GAME_STATE` (index.js ~1236, ~1402). Immediately after emitting `GAME_STATE` for a drawing game, also emit the canvas snapshot to that socket:

   ```js
   if (tm.activeGame?.canvas) {
     playerSocket.emit(EVENTS.CANVAS_SNAPSHOT, tm.activeGame.canvas.snapshot());
   }
   ```

2. **On a fresh `STROKE_BROADCAST` subscription is not needed** — broadcasts are live; only the backlog needs a snapshot. The client requests nothing; the server pushes proactively when it emits `GAME_STATE` to that socket.

> The snapshot is the canvas equivalent of the FSM's `getStateForPlayer` — it gives a new client the backlog. Keeping it on a separate event (not inside `GAME_STATE`) avoids bloating every `GAME_STATE` (emitted on every action) with the full stroke list.

### 3.4 Interaction with the FSM lifecycle methods

| `BaseGame` method | Canvas responsibility |
|---|---|
| `startGame()` | FSM picks first drawer + word; calls `this.canvas.setDrawer(drawerId)` and `this.canvas.reset()`. |
| `handleAction(pid, action)` | Handles game actions only (e.g. `{type:'guess', text}`). On a correct guess (via `isCorrectGuess`) the FSM scores it and may end the drawing phase. **Stroke traffic never reaches here.** |
| `getStateForPlayer(pid)` | Returns FSM state (phase, whose turn, masked word as `_ _ _`, scores). Does **not** include strokes (those come via snapshot/broadcast). For the drawer only, include the plain `word`. |
| `isComplete()` | Pure FSM (all rounds done). Canvas state is irrelevant to completion. |
| `getResults()` | Pure FSM scoring → full N-player ranking with tie handling. Canvas contributes nothing. |
| `setOnStateChange(cb)` / `_emitChange()` | Standard timer-broadcast contract for turn timer / reveal timer (Section 6). Pixels are not broadcast here. |
| `destroy()` | Clear FSM timers AND call `this.canvas.destroy()`. |

**Drawing-phase transition (drawer-side):** when the FSM advances to a new drawer (next turn / next round), it calls `this.canvas.reset()` then `this.canvas.setDrawer(newDrawerId)`, and emits `CANVAS_CLEAR` to the room via the `setOnStateChange` broadcast path so all clients wipe. (The FSM triggers the clear; the relay handlers are only for the drawer's own clicks.)

### 3.5 `CanvasSession` internals (validation, throttle, caps)

```js
const MAX_POINTS_PER_STROKE = 400;     // a long gesture; excess points are dropped (truncate)
const MAX_STROKES           = 1500;    // hard cap per drawing phase; reject beyond
const MIN_STROKE_INTERVAL_MS = 33;     // ~30 msgs/sec per drawer (throttle window)
const MAX_WIDTH = 64, MIN_WIDTH = 1;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
```

`addStroke(senderId, raw, now)` rejects (`{ok:false}`) when any holds:

- `senderId !== this.drawerId` (only the active drawer may draw).
- `now - this._lastStrokeAt < MIN_STROKE_INTERVAL_MS` (throttle — drop, don't queue).
- `this.strokes.length >= MAX_STROKES`.
- `raw` shape invalid: missing/empty `points`, non-array, or any point not finite numbers.

On accept it **sanitizes** (never trusts the client):

- Clamp every `x` to `[0, logicalWidth]`, `y` to `[0, logicalHeight]`; drop non-finite points; truncate to `MAX_POINTS_PER_STROKE`.
- Clamp `width` to `[MIN_WIDTH, MAX_WIDTH]`; default `tool` to `'pen'`; for `tool==='eraser'` ignore `color`.
- Validate `color` against `HEX_RE`, else default `#000000`.
- Assign canonical `id = \`${senderId}:${this._seq++}\`` (ignore any client-supplied id — prevents id spoofing/collisions).
- Push to `this.strokes`, set `this._lastStrokeAt = now`, return `{ ok:true, stroke }`.

`undo(senderId)` — only if `senderId === drawerId`; pop the **last stroke whose id starts with `senderId:`** (the drawer's own), return its id. (In single-drawer games every stroke is the drawer's, so this is just "pop last".)

`clear(senderId)` — only if `senderId === drawerId`; empty `this.strokes`; keep `_seq` monotonic so post-clear ids never collide with pre-clear (stale) ids on slow clients.

`reset()` — empties strokes, keeps `_seq` monotonic, used at each new drawing phase.

> **Throttle policy is drop-not-queue** to bound memory and latency. The client already batches points into ~30ms flushes (Section 4.4), so legitimate traffic stays under the limit; dropped frames just mean a slightly coarser line, never a desync (the next flush includes the newer points).

---

## 4. Client design

### 4.1 Component tree (in a consuming game screen)

```
SkribblGame (game screen — owns authoritative strokes[])
 ├─ <DrawingCanvas readOnly={!isMyTurn} strokes={strokes} onStroke=… onUndo=… onClear=… />
 ├─ word hint / masked word / timer  (from gameState)
 └─ guess input (guessers)  →  onAction({ type:'guess', text })
```

The **game screen** (not `DrawingCanvas`) owns `const [strokes, setStrokes] = useState([])` and wires socket listeners:

```js
socket.on(EVENTS.CANVAS_SNAPSHOT, ({ strokes }) => setStrokes(strokes));
socket.on(EVENTS.STROKE_BROADCAST, ({ stroke }) => setStrokes((s) => [...s, stroke]));
socket.on(EVENTS.CANVAS_UNDO, ({ strokeId }) => setStrokes((s) => s.filter((x) => x.id !== strokeId)));
socket.on(EVENTS.CANVAS_CLEAR, () => setStrokes([]));
```

Because the server echoes the drawer's own strokes back via `STROKE_BROADCAST`, the drawer's authoritative array is updated by the same listener as everyone else — guaranteeing pixel parity. (The drawer also paints an optimistic in-progress stroke locally so the line feels instant; see 4.4.)

### 4.2 Rendering

- One `<canvas>` element at `logicalWidth × logicalHeight` backing-store, scaled with CSS to fit its container (`width:100%; height:auto; aspect-ratio:4/3`). Because the backing store is always 800×600, coordinates need no per-client rescale for drawing into it — only pointer input is mapped (4.3).
- Render via `useEffect` keyed on `strokes`: clear the canvas, then for each stroke draw a poly-line (`lineJoin='round'`, `lineCap='round'`, `strokeStyle=color`, `lineWidth=width`; eraser uses `globalCompositeOperation='destination-out'`). A stroke of a single point draws a dot (filled arc of radius `width/2`).
- For perf, on a `STROKE_BROADCAST` append we can draw just the new stroke incrementally instead of full-redraw; full-redraw is only needed on undo/clear/snapshot. v1 may full-redraw always (≤1500 strokes is cheap); incremental append is an optimization flagged in Section 8.

### 4.3 Pointer input → logical coords (touch + mouse)

Use **Pointer Events** (`onPointerDown/Move/Up/Leave`) so mouse, touch, and stylus share one path — and call `e.currentTarget.setPointerCapture(e.pointerId)` on down so a drag that leaves the canvas still tracks. Map physical → logical:

```js
function toLogical(e, canvasEl, LW, LH) {
  const r = canvasEl.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width)  * LW,
    y: ((e.clientY - r.top)  / r.height) * LH,
  };
}
```

`touch-action: none` on the canvas (CSS) prevents the browser from scrolling/zooming while drawing — **required** for touch devices per the project's touch-support preference. No hover-only affordances: the toolbar uses tap targets (≥44px), and tool selection is tap-to-activate.

### 4.4 Throttling / batching (client side)

A stroke can produce a pointermove flood. The drawer:

1. Accumulates points in a `currentStroke.points` ref on each pointermove, and paints them locally immediately (optimistic in-progress line on a top overlay or directly).
2. **Flushes are coalesced:** rather than emitting per-point, the drawer emits **one `STROKE_SEND` on pen-up** containing the whole stroke (simplest, matches `Stroke` = one gesture). For very long gestures, optionally mid-flush every ~`FLUSH_MS=120ms` as a partial stroke with a stable `id` so the server appends incrementally — **v1 keeps it simple: emit once on pen-up.** This naturally stays well under the 30 msg/s server throttle for normal drawing.
3. Undo/clear emit immediately (rare, user-initiated).

> Decision: **one STROKE_SEND per gesture on pen-up.** It is the least code, can't desync, and the 30 msg/s server cap then only matters for someone scribbling many tiny strokes fast — which the cap correctly bounds. Mid-stroke streaming is deferred (Section 9 open question).

### 4.5 Read-only mode (guessers)

`readOnly` → no pointer handlers attached, no toolbar, `pointer-events:none` on the canvas, cursor default. Guessers only receive `strokes` and render. Their input is the **guess text box**, which is a normal `onAction({type:'guess', text})` FSM action — not a canvas event.

### 4.6 Toolbar (drawer only, `toolbar` + `!readOnly`)

- Color swatches (8 presets matching the palette in `SpotTheDifference` `COLORS` for visual consistency) + black/eraser.
- Brush size: 3 tap presets (small/medium/large → logical widths 3/8/18).
- Eraser toggle, Undo, Clear (Clear behind a 1-tap confirm to avoid accidental wipes).
- `useSound()` SFX: a soft `click` on tool change, `menuOpen`-style tick on clear (reuse existing sound names from `SoundEngine`).

---

## 5. Integration example

A consuming game (Skribbl) wiring, end to end:

**Server FSM (`Skribbl.js`)**
```js
startGame() {
  this.transition('start');
  this._beginTurn();                       // picks drawer + word
}
_beginTurn() {
  this.drawerId = this.turnOrder[this.turnIdx];
  const { word } = pickWord({ exclude: this.usedWords });
  this.usedWords.push(word);
  this.secretWord = word;                  // FSM-owned; NEVER in guesser state
  this.canvas.reset();
  this.canvas.setDrawer(this.drawerId);
  this._startTurnTimer();                  // 80s; uses setOnStateChange to broadcast + check complete
  this._emitChange();                      // also triggers a CANVAS_CLEAR broadcast (Section 3.4)
}
handleAction(pid, action) {
  if (this.state !== 'drawing') return;
  if (action.type === 'guess' && pid !== this.drawerId) {
    const { correct } = isCorrectGuess(action.text, this.secretWord);
    if (correct && !this.solved.has(pid)) {
      this.solved.add(pid);
      this.scores[pid] += this._guessPoints();     // earlier guess = more
      this.scores[this.drawerId] += 50;            // drawer reward
      if (this.solved.size >= this.players.length - 1) this._endTurn();  // everyone got it
    }
    // else: broadcast a sanitized chat line WITHOUT the word (guess-leak guard)
  }
}
getStateForPlayer(pid) {
  return {
    phase: this.state,
    drawerId: this.drawerId,
    isDrawer: pid === this.drawerId,
    word: pid === this.drawerId ? this.secretWord : null,     // only the drawer sees it
    maskedWord: this.secretWord.replace(/[a-z]/gi, '_'),      // length hint for guessers
    solved: [...this.solved],
    scores: this.scores,
    /* ...timer, round counters... */
  };
}
destroy() { this._clearTimers(); this.canvas.destroy(); }
```

**Client (`Skribbl.jsx`)** — owns `strokes`, renders `<DrawingCanvas readOnly={!gameState.isDrawer} strokes={strokes} onStroke={(s)=>socket.emit(EVENTS.STROKE_SEND,{stroke:s})} onUndo={()=>socket.emit(EVENTS.CANVAS_UNDO_SEND)} onClear={()=>socket.emit(EVENTS.CANVAS_CLEAR_SEND)} />`, plus the four canvas listeners from 4.1 and a guess box that calls `onAction({type:'guess', text})`.

**Registration (8 steps)** — these are for the *consuming game*, not the infra; the infra ships as plain modules with **no registry/gameList entry of its own**:

| # | File | Edit |
|---|------|------|
| 1 | `server/src/games/Skribbl.js` | `extends BaseGame`, holds `new CanvasSession()` |
| 2 | `shared/gameList.js` `GAMES` | `{ id:'skribbl', name:'Skribbl', minPlayers:2, maxPlayers:8, turnTimer: TIMERS.SKRIBBL_TURN, description:'…', instructions:[…] }` |
| 3 | `shared/constants.js` `TIMERS` | add `SKRIBBL_TURN: 80` (drawing turn) — infra itself adds no timer |
| 4 | `server/src/games/registry.js` | `import { Skribbl }` + `registerGame('skribbl', Skribbl)` |
| 5 | `client/src/games/Skribbl.jsx` + `.module.css` | uses `DrawingCanvas`, `PlayerName`, `useSound()`, unique Google Font for title |
| 6 | `client/src/assets/gamepreviews/skribbl.png` | preview image |
| 7 | `client/src/App.jsx` `GAME_COMPONENTS` | `skribbl: SkribblGame` (+ import) |
| 8 | `client/src/screens/GameVote.jsx` `GAME_PREVIEWS` | `skribbl: previewSkribbl` (+ import) |

**Infra files added (no registration, just imports where used):**
- `server/src/utils/CanvasSession.js`
- `server/src/utils/wordBank.js`
- `server/src/utils/guessMatch.js`
- `client/src/components/DrawingCanvas.jsx` + `DrawingCanvas.module.css`
- `shared/events.js` (7 new event names — Section 2.1)
- `server/src/index.js` (3 new socket handlers + 2 snapshot-emit lines — Section 3.2/3.3)

---

## 6. Leave/deadlock behavior (v2.7.0 contract)

The infra holds **no players and no timers**, so the leave contract is enforced almost entirely by the consuming FSM. The infra's only obligation: `CanvasSession.setDrawer(null)` / `reset()` when told to, and never block.

### What each layer does on a leave

- **`removePlayer(id)` (FSM override):** call `super.removePlayer(id)` first (prunes `this.players` + turn rotation per `BaseGame`). Then:
  - **If the leaver is the current drawer:** the drawing phase cannot continue (nobody is producing pixels). The FSM **ends the current drawing turn immediately** — score it as a no-completion turn (drawer gets 0 for the abandoned word, guessers keep whatever they already solved), call `this.canvas.setDrawer(null)`, then advance to the next drawer/round or `finish` if `<=1` players remain. This is the drawing analogue of Hangman's "active turn-holder left → reassign/end round" and SpotTheDifference's "<=1 left → finish."
  - **If a guesser leaves:** just prune them; re-check the round-complete condition (`solved.size >= players.length - 1`) since the threshold dropped — a guesser leaving may complete the turn. No canvas action needed.
  - **If `<=1` player remains:** clear timers, set state `finished` (orchestration force-completes the round to the single remaining player via `getResults()`), call `this.canvas.destroy()` defensively is not required here (orchestration calls `destroy()` on teardown) but timers MUST be cleared.
- **`_removeFromActive(id)`:** used for in-game "done with their turn" semantics if a drawing game ever eliminates within a round (not expected for Skribbl/Telephone — they re-pick drawers each turn). Keeps the player scored.
- **`destroy()`:** FSM clears its turn/reveal timers **and** calls `this.canvas.destroy()`. The orchestration already calls `game.destroy?.()` before discarding (index.js lines 1092, 1181).

### Timer/broadcast pairing (the bug class just fixed)

Every `setTimeout`-driven advance in a drawing FSM (turn timer expiry, reveal timer, round auto-advance) **must** be paired with `setOnStateChange`/`_emitChange` so it broadcasts fresh `GAME_STATE` and re-checks `isComplete()` — exactly as SpotTheDifference (`_roundTimer`→`_emitChange`) and Hangman (`_roundTimer`→`_emitChange`) do. The infra's stroke broadcasts are *separate live events* and do **not** substitute for this: a turn that ends on a timer with no live action would otherwise freeze guessers. Concretely:

- **Turn timer** (`TIMERS.SKRIBBL_TURN`): on expiry → reveal the word, score, `_emitChange()`, then auto-advance.
- **Reveal phase**: ~10s auto-advance timer (per contract) → next drawer or finish, with `_emitChange()`.
- **Guesser idle / drawer idle:** covered by the turn timer; no separate ack needed because guessing is optional (you simply score 0).

### Stroke relay during/after a leave

`STROKE_SEND` handlers no-op safely if the sender is no longer the drawer (`addStroke` checks `senderId === drawerId`, which the FSM nulled). Late `STROKE_BROADCAST`/snapshot for a torn-down game can't fire because `tm.activeGame` is set to `null` on completion and the handlers guard on `tm.activeGame.canvas`.

---

## 7. Edge cases & test scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Non-drawer emits `STROKE_SEND` | Rejected (`senderId !== drawerId`); nothing broadcast. |
| 2 | Drawer spams strokes < 33ms apart | Excess dropped by throttle; line still coherent on next accepted flush; no crash. |
| 3 | Client sends a stroke with `points:[{x:99999,y:-5}]` | Clamped to canvas bounds; non-finite dropped. |
| 4 | Client sends `width:9999`, `color:'red'`, bogus `id` | Width clamped to 64; color defaulted to `#000000`; id replaced with canonical `senderId:seq`. |
| 5 | 2000 strokes in one phase | Accepted up to `MAX_STROKES=1500`, rest rejected; no unbounded memory. |
| 6 | Mid-round joiner arrives after 40 strokes | Receives `CANVAS_SNAPSHOT` with all 40 right after their first `GAME_STATE`; paints identical board. |
| 7 | Reconnect (same path) | Same as joiner — snapshot replays current canvas. |
| 8 | Drawer hits Undo twice then a guesser had already seen the stroke | `CANVAS_UNDO` removes by `strokeId`; all clients converge (controlled render). |
| 9 | Drawer leaves mid-draw | FSM ends turn, `setDrawer(null)`, advances; guessers get a state broadcast (not frozen). |
| 10 | Last guesser leaves; only drawer + nobody to guess | Round-complete threshold (`players.length-1`) hits 0 → turn ends; if `<=1` total, finish. |
| 11 | Guess equals word exactly | `isCorrectGuess` → correct; scored once (idempotent via `solved` set). |
| 12 | Guess is `"Cat!"` vs word `"cat"` | `normalizeGuess` strips punctuation/case → exact match. Word len 3 → fuzzy disabled, but exact still wins. |
| 13 | Guess `"ellephant"` vs `"elephant"` | Levenshtein 1, len≥4 → accepted as correct (fuzzy on). |
| 14 | Guess `"cot"` vs word `"cat"` | len 3 → fuzzy OFF → **not** accepted (avoids false positive). |
| 15 | Guess that *contains* the word in chat | FSM must NOT echo a chat line that leaks the word; if `isCloseGuess`/correct, suppress or replace text. (Consuming-game responsibility; util provides the detection.) |
| 16 | `pickWords(5, {exclude})` near bank exhaustion | Returns as many distinct as possible; never throws; if exhausted, allows repeats as last resort. |
| 17 | Clear then a stale pre-clear stroke arrives | New stroke gets a higher `_seq` id; stale undo/broadcast can't accidentally match (monotonic seq). |
| 18 | Game with no `.canvas` (e.g. Poker) receives a `STROKE_SEND` | Handler no-ops (duck-type guard). |
| 19 | Two clients race a correct guess in same tick | Both processed sequentially server-side; `solved` set dedupes; scoring deterministic by arrival order. |
| 20 | Touch device: drag off canvas edge | `setPointerCapture` keeps tracking; `touch-action:none` prevents scroll. |

### Suggested unit tests (pure modules — fast, no socket)

- `guessMatch`: normalize table (case/punct/accents/leading article), exact, fuzzy len-gate, close-but-wrong.
- `wordBank.pickWords`: count, distinctness, category/difficulty filter, exclude, exhaustion.
- `CanvasSession`: drawer gate, throttle window, point/stroke caps, clamping, undo-own-stroke, clear, snapshot shape, monotonic seq.

---

## 8. Effort & risks

**Effort: M** (multi-file but each module is small and mostly pure; the hard parts are tested in isolation).

Rough breakdown:
- `guessMatch.js` + tests — S (couple hours).
- `wordBank.js` (curate ~5 categories × 3 difficulties × ~25 words = ~375 words) + picker + tests — S–M (curation is the time sink).
- `CanvasSession.js` + tests — S.
- `DrawingCanvas.jsx` + CSS (pointer events, scaling, toolbar, touch) — M (the most fiddly piece; touch + scaling needs device testing).
- `index.js` handlers + snapshot hooks + `events.js` — S.

**Risks / mitigations:**
- **Bandwidth spikes** from fast drawing → mitigated by per-gesture send + 30 msg/s server throttle + point cap. Low risk at 8 players.
- **Pixel desync drawer vs guessers** → mitigated by controlled render: drawer paints from the *same* broadcast list everyone else does (plus an optimistic local in-progress line that is reconciled when its own broadcast returns).
- **Word leaking to guessers** → structural guard: word lives only in FSM, `getStateForPlayer` masks it; `guessMatch` is server-only. The one place a leak can sneak in is a chat echo of a guess — flagged explicitly as the consuming game's responsibility (test #15).
- **Touch correctness** across iOS/Android (the project cares about touch) → needs real-device QA; `touch-action:none` + Pointer Events is the standard robust path.
- **Full-redraw cost** at 1500 strokes every broadcast → acceptable in v1; incremental-append render is the documented optimization if profiling shows jank.

---

## 9. Open questions

1. **Mid-stroke streaming vs pen-up-only.** v1 sends one `STROKE_SEND` per completed gesture (simplest, can't desync) but a very long unbroken stroke shows on other screens only at pen-up. Acceptable? Or do we want mid-stroke partial flushes (~120ms) with a stable stroke id and server-side append-to-same-id? Recommend shipping pen-up-only, revisiting if testers complain about latency on long strokes.
2. **Eraser semantics on shared canvas.** Eraser uses `destination-out` locally; on full-redraw it must be drawn *in order* with pens (it is — strokes render in array order). Confirm no need for a separate "true white pen" fallback on any target browser.
3. **Word-bank size & sourcing.** ~375 hand-curated words enough for variety, or do we want a larger bank / external list? Curation effort scales here.
4. **Fuzzy length gate threshold.** Spec uses "fuzzy only when word length ≥ 4, maxDistance 1." Tune after playtest (some want stricter for short words, looser for long phrases).
5. **Telephone Pictionary canvas privacy.** Telephone needs *per-player private* canvases each phase (not one shared room canvas). Does that game use one `CanvasSession` keyed by phase/player, or N sessions? This spec covers the *single shared-canvas* (Skribbl) model; the Telephone spec must define how it instantiates/relays private canvases (likely one `CanvasSession` per active drawing, with `STROKE_BROADCAST` scoped to that player's own socket rather than the room). Flagging the relay-scoping difference as an explicit dependency for the Telephone spec.
6. **Snapshot on every `GAME_STATE` socket emit** — should snapshot be throttled/deduped so a chatty `GAME_STATE` (emitted per action) doesn't resend the whole stroke list repeatedly to already-synced clients? Recommend: only snapshot on *first* `GAME_STATE` a socket receives for a given drawing phase (track a per-socket "synced" flag), not on every emit.
