# Skribbl (Draw & Guess) — Implementation Spec

slug: skribbl
status: draft
author: spec-writer subagent
date: 2026-06-08
depends-on: **drawing-canvas-infra** (`docs/superpowers/specs/2026-06-08-drawing-canvas-infra-spec.md`) — ships first; this game consumes `CanvasSession`, `wordBank`, `guessMatch`, `DrawingCanvas`, and the 7 new `draw:*` socket events.

---

## 1. Overview

| Field | Value |
|---|---|
| **id / slug** | `skribbl` |
| **Display name** | Skribbl |
| **Players** | 2–8 (best with 3–8; 2 works but the lone guesser is always the only one needed) |
| **Type** | Hybrid: turn-rotated **drawer** (one per round) + **simultaneous guessing** by everyone else over a synced canvas. Timer-driven, broadcast via `setOnStateChange`/`_emitChange`. |
| **Length** | One "drawing turn" per player = one full rotation = the round. `TIMERS.SKRIBBL` (~70s) drawing phase + word-pick + reveal-ack per turn. |
| **Title font** | `'Patrick Hand'` (fallback `'Gochi Hand'`) — playful hand-drawn marker look. Add to the client `<head>` Google Fonts link. |
| **Server file** | `server/src/games/Skribbl.js` extends `BaseGame`, holds one `CanvasSession`. |
| **Hidden info** | The secret `word` (visible to the drawer + already-correct guessers only); **who has guessed correctly** is hidden from other guessers until reveal; a guesser's actual guess text is never shown to others. |

This is the canonical consumer of the drawing-canvas infra. Pixels flow through the infra's `draw:*` channels (NOT `GAME_ACTION`); words/scoring/turn rotation/results live entirely in this FSM.

---

## 2. Tournament fit

`getResults()` must return **all N players ranked every round** (the platform's #1 constraint — `PLACEMENT_MULTIPLIERS = [1.0, 0.7, 0.5, 0.35, 0.25, 0.15]` maps placement → base points in `Scorer.calculatePlacementPoints`).

- Score accumulated across **all drawing turns this round** (every player draws once, everyone guesses on every other turn). `this.scores[playerId]` is a running total.
- `getResults()` sorts every player in `this.players` by `scores` desc, assigns `placement` with the standard tie pattern (`if (i>0 && score < prev.score) placement = i+1;`), so tied players **share** a placement number.
- Tie-break before placement assignment: secondary sort key = `solvedCount` (turns this player guessed correctly) desc, then stable by original order. Players with equal `scores` AND equal `solvedCount` genuinely tie (share placement) — `Scorer.calculateRoundScores` honors the shared placement via its `placementMap`.
- A player who never guessed and was a poor drawer still appears with `scores=0` and a real placement (last). **No player is ever omitted.**

---

## 3. FSM

States: `waiting`, `picking`, `drawing`, `reveal`, `finished`.

### State × action → next

| From \ action | `start` | `pickWord` | `beginDraw` | `endTurn` | `nextTurn` | `finish` |
|---|---|---|---|---|---|---|
| **waiting** | picking | — | — | — | — | — |
| **picking** | — | drawing | — | — | — | — |
| **drawing** | — | — | — | reveal | — | — |
| **reveal** | — | — | — | — | picking | finished |
| **finished** | — | — | — | — | — | — |

> `picking → drawing` uses action name `pickWord`. `drawing → reveal` uses `endTurn`. `reveal → picking` uses `nextTurn`; `reveal → finished` uses `finish`. Matches `BaseGame.transition()` which derives `onEnter<State>` hooks from the **destination** state name.

### onEnter hooks

- **`onEnterPicking()`** — advance to next drawer in `turnOrder`; `canvas.reset()` + `canvas.setDrawer(drawerId)`; pick 3 candidate words via `pickWords(3, {exclude:this.usedWords})`; set `this.wordChoices`; start the **pick timer** (`PICK_TIMEOUT_MS`, auto-pick `wordChoices[0]` on expiry). `secretWord` stays `null` until picked.
- **`onEnterDrawing()`** — set `this.secretWord`, push to `usedWords`, clear `wordChoices`, reset `this.solved`, record `this._turnStartTime`, broadcast a `CANVAS_CLEAR` (via the `_emitChange` path), start the **draw timer** (`TIMERS.SKRIBBL * 1000`).
- **`onEnterReveal()`** — clear draw timer, compute drawer reward, push turn to `turnHistory`, reset `acknowledged`, start the **reveal-ack timer** (`REVEAL_ACK_MS = 8000`, auto-advance on expiry). The plain `secretWord` is now revealed to everyone in `getStateForPlayer`.
- **`onEnterFinished()`** — clear all timers; terminal. `isComplete()` returns true.

All onEnter hooks that start a timer pair it with `_emitChange()` on fire (Section 7).

---

## 4. Server state (fields on `Skribbl`)

```js
constructor(players) {
  super(players, {
    states: ['waiting','picking','drawing','reveal','finished'],
    initialState: 'waiting',
    transitions: {
      waiting: { start: 'picking' },
      picking: { pickWord: 'drawing' },
      drawing: { endTurn: 'reveal' },
      reveal:  { nextTurn: 'picking', finish: 'finished' },
    },
  });

  this.canvas      = new CanvasSession();   // pixels (infra) — never holds word/score
  this.turnOrder   = [...players];          // drawer rotation, snapshot at start
  this.turnIdx     = -1;                     // ++ on each onEnterPicking
  this.drawerId    = null;
  this.secretWord  = null;                   // FSM-owned; NEVER serialized to guessers
  this.wordChoices = [];                     // [{word,category,difficulty}] x3 — drawer-only
  this.usedWords   = [];                      // exclude list for pickWords (no repeats this game)

  this.scores      = {};                     // playerId -> running total (all turns)
  this.solved      = new Map();              // THIS turn: playerId -> { order, ms } (correct guessers)
  this.solvedCount = {};                     // playerId -> # turns they guessed correctly (tie-break)
  this.acknowledged = new Set();             // reveal-phase acks

  this.turnNumber  = 0;                       // 1..N (one per player)
  this.totalTurns  = players.length;          // full rotation = the round
  this.turnHistory = [];                      // [{drawerId, word, solvers:[...], turnNumber}]

  this._turnStartTime = null;
  this._pickTimer = null;
  this._drawTimer = null;
  this._ackTimer  = null;
  this._onStateChange = null;

  for (const p of players) { this.scores[p] = 0; this.solvedCount[p] = 0; }
}
```

Constants (top of file):
```js
const PICK_TIMEOUT_MS = 15000;   // auto-pick wordChoices[0]
const REVEAL_ACK_MS   = 8000;    // reveal -> next turn auto-advance
const HINT_SCHEDULE    = [0.45, 0.70];  // reveal a letter at 45% and 70% of draw time elapsed
const DRAWER_PER_SOLVER = 30;    // drawer points per correct guesser
const GUESS_BASE = 120, GUESS_MIN = 40;  // speed-scaled guesser points (see §8)
```
(`TIMERS.SKRIBBL` lives in `shared/constants.js`, value `70`.)

---

## 5. Actions (`handleAction(playerId, action)`)

Guard at top: `if (!this.players.includes(playerId)) return;`. Stroke/undo/clear traffic does **NOT** arrive here — it goes through the infra's `draw:*` socket handlers straight into `this.canvas`.

| `action.type` | Allowed phase | Sender guard | Payload | Effect |
|---|---|---|---|---|
| `pickWord` | `picking` | **drawer only** (`playerId === this.drawerId`) | `{ word }` | Validate `word` is one of `this.wordChoices[].word`; ignore otherwise. Clear pick timer, `this.transition('pickWord')` (→ `onEnterDrawing` sets `secretWord`). |
| `guess` | `drawing` | **non-drawer** (`playerId !== this.drawerId`) AND not already in `this.solved` | `{ text }` (string, trimmed, ≤ 80 chars) | See "guess flow" below. |
| `acknowledge` | `reveal` | any player | — | `this.acknowledged.add(playerId)`; if all current `this.players` acked → `_advanceAfterReveal()`. |
| `ping` | any | any | — | No-op; exists so a stuck client can force a state rebroadcast (index.js re-emits `GAME_STATE` after every `handleAction`). On `drawing`, also runs the "timer should have expired" safety check below. |

**Guess flow (the core):**
```js
if (action.type === 'guess' && this.state === 'drawing') {
  if (playerId === this.drawerId) return;          // drawer can't guess
  if (this.solved.has(playerId)) return;           // already solved — idempotent
  const text = String(action.text || '').slice(0, 80);
  const { correct } = isCorrectGuess(text, this.secretWord);   // server-side only
  if (correct) {
    const order = this.solved.size + 1;
    const ms = Date.now() - this._turnStartTime;
    this.solved.set(playerId, { order, ms });
    this.solvedCount[playerId] += 1;
    this.scores[playerId] += this._guessPoints(order, ms);     // earlier = more (§8)
    // round ends when EVERY non-drawer has solved
    if (this.solved.size >= this.players.length - 1) this._endTurn();
  }
  // WRONG or CLOSE guesses: optionally surface to the guesser only as private feedback
  // (isCloseGuess -> "you're close!"). NEVER broadcast guess text that contains/equals
  // the word to other guessers — that would leak it. See test #9, §12.
}
```

**Safety re-check on `drawing` actions** (mirrors SpotTheDifference): if `this._turnStartTime && Date.now() >= this._turnStartTime + TIMERS.SKRIBBL*1000` and still `drawing`, call `this._endTurn()` (fall through so index.js broadcasts). Prevents a stuck turn if the timer somehow didn't fire.

`_endTurn()` (guarded `if (this.state !== 'drawing') return;`): clear draw timer, `this.transition('endTurn')` → `onEnterReveal`.

---

## 6. getStateForPlayer(playerId)

Returns FSM/word/score state ONLY. **Pixels are never in here** — the client gets strokes via `CANVAS_SNAPSHOT` (on join) + `STROKE_BROADCAST` (live), per the infra spec.

```js
getStateForPlayer(playerId) {
  const isDrawer = playerId === this.drawerId;
  const revealed = this.state === 'reveal' || this.state === 'finished';
  const haveSolved = this.solved.has(playerId);
  const seesWord = isDrawer || haveSolved || revealed;   // who may see the plaintext word

  return {
    phase: this.state,                      // 'picking' | 'drawing' | 'reveal' | 'finished'
    drawerId: this.drawerId,
    isDrawer,
    turnNumber: this.turnNumber,
    totalTurns: this.totalTurns,

    // WORD VISIBILITY — the security boundary
    word:       seesWord ? this.secretWord : null,
    maskedWord: this.secretWord ? this._mask(this.secretWord) : null,  // "_ _ _ _  _ _ _" + hints
    wordLength: this.secretWord ? this.secretWord.replace(/\s/g,'').length : null,

    // drawer-only word picking
    wordChoices: (isDrawer && this.state === 'picking')
        ? this.wordChoices.map(w => w.word) : null,

    // who solved — hidden mid-draw, revealed at reveal/finish
    iSolved: haveSolved,
    solvedOrder: haveSolved ? this.solved.get(playerId).order : null,
    solvedIds: revealed ? [...this.solved.keys()] : [],         // empty until reveal
    solvedCount: this.solved.size,                               // count is OK to show (no identities)

    scores: this.scores,                    // running totals are public (leaderboard)
    solvedCounts: this.solvedCount,
    turnEndTime: this.state === 'drawing' && this._turnStartTime
        ? this._turnStartTime + TIMERS.SKRIBBL * 1000 : null,
    turnDurationSec: TIMERS.SKRIBBL,
    turnHistory: this.turnHistory,
  };
}
```

**Masking + timed hints** — `_mask(word)`:
- Replace each letter with `_`, preserve spaces (show word/phrase shape). A 2-word phrase shows two underscore groups.
- As draw time elapses, reveal letters per `HINT_SCHEDULE`. Track `this._hintsRevealed` (count) updated by the draw timer's hint checkpoints (Section 7); `_mask` un-blanks that many letter positions (pick fixed positions, e.g. first then a middle one, deterministically so all clients agree).
- The drawer's own view always shows the full `word`, never the mask.

**Hidden-info rules (enforced structurally):**
1. `secretWord` only crosses the wire to drawer / already-correct guessers / everyone at reveal.
2. `wordChoices` only to the drawer, only in `picking`.
3. `solvedIds` is `[]` until reveal — a mid-draw guesser cannot learn who else solved (prevents collusion/timing leaks).
4. Guess text is processed server-side via `guessMatch` (`isCorrectGuess`) and **never** echoed to other players.

---

## 7. Timers & broadcasting

Implements the `setOnStateChange` / `_emitChange` contract exactly like `SpotTheDifference`. **Every** `setTimeout`-driven state change calls `_emitChange()` after mutating state so index.js re-broadcasts `GAME_STATE` to all players AND re-checks `isComplete()`.

```js
setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }
```

| Timer | Duration | Phase | On expiry (must `_emitChange()`) |
|---|---|---|---|
| **Pick** (`_pickTimer`) | `PICK_TIMEOUT_MS` (15s) | `picking` | Auto-pick `wordChoices[0]`: set word, `transition('pickWord')`, `_emitChange()`. |
| **Draw** (`_drawTimer`) | `TIMERS.SKRIBBL * 1000` (70s) | `drawing` | `_endTurn()` (→ reveal), `_emitChange()`. |
| **Hint checkpoints** | at `HINT_SCHEDULE` fractions of draw time | `drawing` | `this._hintsRevealed++`, `_emitChange()` (re-broadcasts new mask). Implement as two `setTimeout`s scheduled inside `onEnterDrawing`, tracked so `destroy`/leave can clear them. |
| **Reveal-ack** (`_ackTimer`) | `REVEAL_ACK_MS` (8s) | `reveal` | Force-ack everyone, `_advanceAfterReveal()`, `_emitChange()`. |

`_advanceAfterReveal()` (guarded `if (this.state !== 'reveal') return;`): clear timers; if `this.turnNumber >= this.totalTurns` → `transition('finish')`; else `transition('nextTurn')` (→ `onEnterPicking` advances drawer + new word choices).

```js
_clearTimers() {
  for (const t of ['_pickTimer','_drawTimer','_ackTimer']) {
    if (this[t]) { clearTimeout(this[t]); this[t] = null; }
  }
  if (this._hintTimers) { this._hintTimers.forEach(clearTimeout); this._hintTimers = []; }
}
```

**Auto-action on timeout** summary: drawer idle in picking → first word auto-picked; drawer/guessers idle in drawing → turn ends at 70s, scoring as-is (unsolved = 0); reveal idle → auto-advance after 8s. No phase can deadlock.

`CANVAS_CLEAR` between turns: `onEnterDrawing` (and the leave path) trigger the room-wide clear via the `setOnStateChange` broadcast path / index.js helper — the infra's per-drawer `draw:clearSend` is only for the drawer's own button.

---

## 8. Scoring & getResults

**Guesser points (speed-scaled, earlier = more):**
```js
_guessPoints(order, ms) {
  const T = TIMERS.SKRIBBL * 1000;
  const timeFactor = Math.max(0, 1 - ms / T);          // 1.0 at t=0 → 0 at timeout
  const orderBonus = Math.max(0, (this.players.length - order) * 5); // beat others = small bonus
  return Math.round(GUESS_MIN + (GUESS_BASE - GUESS_MIN) * timeFactor) + orderBonus;
}
```
Fast correct guess ≈ `GUESS_BASE` (120) + order bonus; a last-second guess ≈ `GUESS_MIN` (40). Clamped non-negative.

**Drawer points (per correct guesser):**
```js
// computed in onEnterReveal
this.scores[this.drawerId] += this.solved.size * DRAWER_PER_SOLVER;   // 30 each
// optional all-solved bonus: if every non-drawer solved, +20 (good, guessable drawing)
if (this.solved.size === this.players.length - 1 && this.players.length > 1) this.scores[this.drawerId] += 20;
```
A drawer nobody guesses gets 0 for that turn (and so do the guessers) — discourages unguessable/intentionally-bad drawing.

**`getResults()` — ranks ALL N, ties share placement:**
```js
getResults() {
  const entries = this.players.map(p => ({
    playerId: p,
    score: this.scores[p] || 0,
    solvedCount: this.solvedCount[p] || 0,
  }));
  entries.sort((a,b) => b.score - a.score || b.solvedCount - a.solvedCount);
  let placement = 1;
  return entries.map((e,i) => {
    if (i > 0 && (e.score < entries[i-1].score || (e.score === entries[i-1].score && e.solvedCount < entries[i-1].solvedCount)))
      placement = i + 1;
    return { ...e, placement };
  });
}
```
Every player in `this.players` gets exactly one `{playerId, placement, score, solvedCount}`. Equal `score` AND equal `solvedCount` → identical `placement` (genuine tie). `Scorer.calculateRoundScores` reads these placements from its `placementMap`, so ties award equal placement points.

`isComplete()` → `this.state === 'finished'`.

---

## 9. Leave & deadlock handling (v2.7.0 contract)

Override `removePlayer` per the contract: call `super.removePlayer(playerId)` first (prunes `this.players` + `activePlayers` rotation), then nudge by phase. The `CanvasSession` holds no players/timers, so the FSM drives everything; its only obligation is `setDrawer(null)`/`reset()` when told.

```js
removePlayer(playerId) {
  super.removePlayer(playerId);                       // prunes this.players + rotation
  this.turnOrder = this.turnOrder.filter(p => p !== playerId);
  this.solved.delete(playerId);
  this.acknowledged.delete(playerId);

  // <=1 remaining: orchestration force-completes the round; stop timers + finish
  if (this.players.length <= 1) {
    this._clearTimers();
    this.canvas.setDrawer(null);
    this.state = 'finished';
    return;
  }

  // The current DRAWER left mid-turn -> this turn can't continue (no pixels coming).
  if (playerId === this.drawerId && (this.state === 'picking' || this.state === 'drawing')) {
    this._clearTimers();
    this.canvas.setDrawer(null);
    // no draw reward for abandoned word; guessers keep what they already solved
    this.turnHistory.push({ drawerId: playerId, word: this.secretWord, abandoned: true,
                            solvers: [...this.solved.keys()], turnNumber: this.turnNumber });
    this.totalTurns = Math.max(this.turnNumber, this.turnOrder.length); // they no longer draw
    // jump straight to next turn (skip reveal for an abandoned turn) or finish
    if (this.turnNumber >= this.totalTurns) { this.state = 'finished'; }
    else { this.state = 'reveal'; this._advanceAfterReveal(); }  // advance immediately
    return;
  }

  // A GUESSER left:
  if (this.state === 'drawing') {
    // threshold dropped — their leaving may complete the turn (everyone else solved)
    if (this.solved.size >= this.players.length - 1) this._endTurn();
  } else if (this.state === 'reveal') {
    // auto-ack the leaver; advance if everyone remaining has acked
    if (this.players.every(p => this.acknowledged.has(p))) this._advanceAfterReveal();
  }
}
```

- **`_removeFromActive(id)`** — not used for in-turn elimination here (Skribbl re-picks a drawer each turn, never eliminates mid-round). It is invoked indirectly by `super.removePlayer` to keep rotation consistent. Players stay scored.
- **`destroy()`** — `this._clearTimers(); this.canvas.destroy(); this._onStateChange = null;`. Orchestration calls this before discarding the instance.
- **Stroke relay during/after leave** — infra handlers no-op safely: `addStroke` checks `senderId === drawerId` (nulled on drawer leave); snapshot/broadcast guard on `tm.activeGame.canvas`, which is gone once `activeGame` is nulled on completion.

**Per-phase "last-needed player leaves":**
- *picking, drawer leaves* → abandon turn, advance (above).
- *drawing, drawer leaves* → abandon turn, no draw reward, advance.
- *drawing, last un-solved guesser leaves* → `solved.size >= players.length-1` becomes true → `_endTurn()` → reveal.
- *reveal, last un-acked player leaves* → auto-advance.
- *any phase, down to 1 player* → finish; orchestration awards that player the round via `getResults()`.

Every `setTimeout` advance pairs with `_emitChange()` so leavers never freeze the survivors.

---

## 10. Client component

`client/src/games/Skribbl.jsx` + `Skribbl.module.css`. Props (App.jsx contract): `gameState`, `nicknames`, `avatars`, `onAction`. Owns the authoritative `strokes` array (the canvas component is controlled per infra spec).

**State + socket wiring (game screen owns strokes):**
```js
const [strokes, setStrokes] = useState([]);
useEffect(() => {
  socket.on(EVENTS.CANVAS_SNAPSHOT,   ({ strokes }) => setStrokes(strokes));
  socket.on(EVENTS.STROKE_BROADCAST,  ({ stroke }) => setStrokes(s => [...s, stroke]));
  socket.on(EVENTS.CANVAS_UNDO,       ({ strokeId }) => setStrokes(s => s.filter(x => x.id !== strokeId)));
  socket.on(EVENTS.CANVAS_CLEAR,      () => setStrokes([]));
  return () => { /* off all four */ };
}, [socket]);
// new turn / phase change wipes local strokes too
useEffect(() => { if (gameState.phase === 'picking') setStrokes([]); }, [gameState.drawerId]);
```

**Per-phase screens** (read `gameState.phase`):

- **`picking`**
  - *Drawer:* "Choose a word" — three big tap buttons from `gameState.wordChoices` → `onAction({type:'pickWord', word})`. Countdown ring (`PICK_TIMEOUT`). `useSound('click')` on pick.
  - *Guessers:* "PlayerName is choosing a word…" with their `PlayerName` + avatar. Empty canvas placeholder.

- **`drawing`** — three-zone layout:
  - Center: `<DrawingCanvas readOnly={!gameState.isDrawer} strokes={strokes} onStroke={s=>socket.emit(EVENTS.STROKE_SEND,{stroke:s})} onUndo={()=>socket.emit(EVENTS.CANVAS_UNDO_SEND)} onClear={()=>socket.emit(EVENTS.CANVAS_CLEAR_SEND)} toolbar={gameState.isDrawer} />`. The toolbar (palette/size/eraser/undo/clear) shows for the drawer only — provided by the infra component.
  - Top bar: `maskedWord` rendered as spaced underscores with revealed hint letters, `wordLength`, turn timer ring (`turnEndTime`), `solvedCount`/`players-1` progress ("3/5 guessed").
  - Right rail: live **scoreboard** (sorted `gameState.scores`, `PlayerName` + avatar, checkmark badge once `solvedIds` includes them at reveal; mid-draw show a neutral "✏️ drawing" / "🤔 guessing" status — NOT who solved).
  - Bottom (guessers only): **guess input** (text box + send) → `onAction({type:'guess', text})`. Disabled for the drawer and for anyone in `iSolved` (show "You got it! 🎉"). On a correct guess the server flips `iSolved` next state — show a green flash + `useScreenShake('light')` + `useSound('win')`. Optional private "you're close!" toast if the server returns close feedback.

- **`reveal`** — overlay: "The word was **{word}**" (now `gameState.word` is populated for everyone). List solvers from `solvedIds` in order with the points each earned this turn; show drawer reward. `useSound('roundWin')` + `useScreenShake('medium')` if you solved. Auto-dismisses; player taps "Next" → `onAction({type:'acknowledge'})`. Countdown shows the 8s auto-advance.

- **`finished`** — standings handled by the platform Results screen; this component just renders a brief final scoreboard until orchestration transitions.

**Layout / touch / sound / shake:**
- Desktop respects the fixed pet sidebar (`.gameMainArea margin-left:220px; width:calc(100% - 220px)`). Canvas is `aspect-ratio:4/3`, max-width fills available width. Mobile: canvas on top, scoreboard collapses below, guess box pinned bottom.
- Touch: handled inside `DrawingCanvas` (Pointer Events, `touch-action:none`, `setPointerCapture`, ≥44px tap targets) per infra spec — nothing extra here. Guess input uses a normal `<input>` with an explicit Send button (no Enter-to-submit reliance on mobile, but Enter allowed).
- Sounds via `useSound()`: `click` (pick/tool), `win` (your correct guess), `roundWin` (reveal), `cardDeal`/tick for hint reveals (optional). Shake via `useScreenShake()`: light on your correct guess, medium on reveal if you solved.
- Title uses the `'Patrick Hand'` font (CSS module class on the game header).

**gameState fields read:** `phase, isDrawer, drawerId, wordChoices, word, maskedWord, wordLength, iSolved, solvedIds, solvedCount, scores, solvedCounts, turnEndTime, turnDurationSec, turnNumber, totalTurns, turnHistory`.
**Actions emitted:** FSM via `onAction`: `pickWord`, `guess`, `acknowledge`, `ping`. Canvas via direct `socket.emit`: `STROKE_SEND`, `CANVAS_UNDO_SEND`, `CANVAS_CLEAR_SEND`.

---

## 11. Registration checklist (8 steps)

| # | File (absolute under project root) | Exact edit |
|---|---|---|
| 1 | `server/src/games/Skribbl.js` | New file: `export class Skribbl extends BaseGame` holding `new CanvasSession()`; implements `startGame/handleAction/getStateForPlayer/isComplete/getResults` + `setOnStateChange/_emitChange`, `removePlayer`, `destroy`. Imports `CanvasSession`, `pickWords`, `isCorrectGuess`, `isCloseGuess`. |
| 2 | `shared/gameList.js` (`GAMES` array) | `{ id: 'skribbl', name: 'Skribbl', minPlayers: 2, maxPlayers: 8, turnTimer: TIMERS.SKRIBBL, description: 'Take turns drawing a secret word while everyone races to guess it. Fast guesses score more; good drawings reward the artist.', instructions: ['One player is the drawer each turn and picks a word from 3 options.', 'The drawer sketches it — no letters, no words.', 'Everyone else types guesses; correct guesses are checked instantly and stay secret from other guessers.', 'Guess faster to score more. The drawer scores for every player who guesses right.', 'After ~70s or once everyone guesses, the word is revealed and the next player draws.'] }` |
| 3 | `shared/constants.js` (`TIMERS`) | Add `SKRIBBL: 70,` (drawing phase seconds). |
| 4 | `server/src/games/registry.js` | `import { Skribbl } from './Skribbl.js';` + `registerGame('skribbl', Skribbl);` (match existing registry call style). |
| 5 | `client/src/games/Skribbl.jsx` + `client/src/games/Skribbl.module.css` | New component (Section 10): props `gameState/nicknames/avatars/onAction`; uses `DrawingCanvas`, `PlayerName`, `useSound()`, `useScreenShake()`; title in `'Patrick Hand'`. Add Google Fonts `Patrick Hand` (+ `Gochi Hand`) to `client/index.html` head. |
| 6 | `client/src/assets/gamepreviews/skribbl.png` | Preview image (hand-drawn doodle on a canvas, marker font title). |
| 7 | `client/src/App.jsx` (`GAME_COMPONENTS`) | `import SkribblGame from './games/Skribbl.jsx';` + `skribbl: SkribblGame,`. |
| 8 | `client/src/screens/GameVote.jsx` (`GAME_PREVIEWS`) | `import skribblPreview from '../assets/gamepreviews/skribbl.png';` + `skribbl: skribblPreview,`. |

**Infra prerequisite (from the canvas spec — must already be merged):** `server/src/utils/CanvasSession.js`, `wordBank.js`, `guessMatch.js`; `client/src/components/DrawingCanvas.jsx` (+ css); 7 `draw:*` events in `shared/events.js`; 3 socket handlers + 2 snapshot-emit lines in `server/src/index.js`. Skribbl adds **no** new socket handlers of its own — it reuses the infra's `draw:*` relay and the existing `GAME_ACTION` channel for `pickWord/guess/acknowledge`.

---

## 12. Edge cases & test scenarios (leave/deadlock harness assertions)

| # | Scenario | Expected assertion |
|---|---|---|
| 1 | Drawer never picks a word | `_pickTimer` fires at 15s → `wordChoices[0]` auto-picked, `phase==='drawing'`, `_emitChange` called once. |
| 2 | Nobody guesses for 70s | `_drawTimer` fires → `phase==='reveal'`, drawer reward 0, all guessers 0, `_emitChange` called. |
| 3 | Every non-drawer guesses correctly | turn ends immediately (`solved.size === players.length-1`) → reveal; no wait for the 70s timer. |
| 4 | Drawer emits `guess` | Ignored (`playerId === drawerId` guard); no score change. |
| 5 | Same guesser guesses correct twice | Second is a no-op (`solved.has` guard); scored exactly once (idempotent). |
| 6 | Two guessers race correct in same tick | Processed sequentially; `solved` map dedupes; `order` 1 then 2; scoring deterministic by arrival. |
| 7 | A guesser sends the word in chat-like guess | Server detects correct via `isCorrectGuess`; **never** broadcasts the guess text to others (`solvedIds` empty mid-draw, no echo) → word not leaked. |
| 8 | Mid-draw `getStateForPlayer` for an unsolved guesser | `word===null`, `maskedWord` present, `solvedIds===[]`, `wordChoices===null`. |
| 9 | Close guess `"ellephant"` vs `"elephant"` | `isCorrectGuess` fuzzy (len≥4, dist 1) → correct + scored. `"cot"` vs `"cat"` (len 3) → NOT correct. |
| 10 | **Drawer leaves during `drawing`** | `removePlayer`: `setDrawer(null)`, turn marked `abandoned`, no draw reward, advance to next turn (or finish); survivors get a fresh `GAME_STATE` (not frozen); `_emitChange` fired. |
| 11 | **Drawer leaves during `picking`** | Abandon turn, advance to next drawer; no crash; canvas drawer nulled. |
| 12 | **Last un-solved guesser leaves during `drawing`** | Threshold `players.length-1` now met → `_endTurn()` → reveal. |
| 13 | **Player leaves during `reveal`** | Auto-ack removed player; if all remaining acked → `_advanceAfterReveal()`. |
| 14 | **Down to 1 player any phase** | `_clearTimers()`, `state='finished'`, `setDrawer(null)`; `getResults()` ranks the lone survivor 1st and the rest by score. |
| 15 | `getResults()` with 8 players, some tied | Returns 8 entries; equal `score`+`solvedCount` share `placement`; placements feed `Scorer.placementMap` correctly. |
| 16 | `destroy()` after game over | All timers (`_pick/_draw/_ack/_hint`) cleared, `canvas.destroy()` called, no orphaned `setTimeout` fires `_emitChange` on a dead game. |
| 17 | Stale `STROKE_SEND` from ex-drawer after leave | Infra `addStroke` rejects (`senderId !== drawerId`); nothing broadcast. |
| 18 | Mid-round joiner during `drawing` | Gets `GAME_STATE` (word masked) + `CANVAS_SNAPSHOT` (existing strokes) — paints identical board; can guess. |
| 19 | Hint checkpoints | At 45% and 70% of 70s, `_hintsRevealed` increments and `_emitChange` re-broadcasts a less-masked word; drawer always sees full word. |
| 20 | All non-drawers solve | Drawer gets `solvers*30 + 20` all-solved bonus; reveal lists everyone. |

**Pure unit tests (no socket):** scoring (`_guessPoints` monotonic decreasing in `ms`; `getResults` tie handling & full-N coverage); mask/hint position determinism; phase transitions table; leave nudges for each phase (assert resulting `state` + that timers are cleared).

---

## 13. Effort & risks

**Effort: M** (the FSM is medium; the heavy/fiddly parts — canvas, pointer/touch, word bank, guess matching — are the **infra** dependency and are specced/built separately).

Breakdown:
- `Skribbl.js` FSM (4 phases, 4 timers, scoring, leave nudges) — **M**, ~1 day incl. unit tests.
- `Skribbl.jsx` + css (4 phase screens, scoreboard, guess box, hooks `DrawingCanvas`) — **M**, ~1 day; most UI complexity is delegated to `DrawingCanvas`.
- Registration (8 steps) + version bump — **S**.

**Risks / mitigations:**
- **Hard dependency on drawing-canvas-infra.** Cannot start until that ships (events, `CanvasSession`, `DrawingCanvas`, `wordBank`, `guessMatch`). Mitigate: stub the infra modules behind their documented interfaces to develop the FSM in parallel.
- **Word leak via guess echo** — structural guard: word lives only in FSM; `getStateForPlayer` masks; guesses processed server-side and never echoed; `solvedIds` empty mid-draw. Covered by tests #7/#8.
- **Drawer-leave deadlock** — explicit abandon-and-advance path with `_emitChange`; the contract's biggest trap. Covered by tests #10/#11.
- **2-player degeneracy** — with 1 guesser, the turn ends the instant they guess; fine, but the round is short. Acceptable; matches "best 3-8."
- **Timer/broadcast pairing** — every `setTimeout` advance pairs with `_emitChange` (the just-fixed bug class). Enforced in §7 and tested (#16).

---

## 14. Open questions

1. **`TIMERS.SKRIBBL` value** — 70s default per brief. Tune after playtest (faster for short words / small lobbies?). Could scale by word difficulty.
2. **Hint count/schedule** — 2 hints at 45%/70%. More hints for `hard` words, fewer for `easy`? Currently fixed.
3. **Drawer reward tuning** — `30/solver + 20 all-solved`. Does this over/under-reward drawing vs guessing across a full rotation? Validate that a strong drawer and a strong guesser end up competitively ranked.
4. **Close-guess feedback** — surface `isCloseGuess` as a private "you're close!" to the guesser? Brief says scores by speed; this is a nice-to-have. Ship without, add if testers want it (must remain private to avoid hinting).
5. **Wrong-guess visibility** — do we show a public "X is guessing…" feed (without text), like real Skribbl's chat? v1 keeps guesses fully private to avoid any leak surface; a sanitized "made a guess" pulse is a possible enhancement.
6. **Abandoned-turn `totalTurns` accounting** — when the drawer leaves, we shrink the rotation. Confirm the round still feels complete (each remaining player still drew once) and `getResults` is fair. Edge: drawer leaves before drawing at all on their turn → simply skipped, no penalty/reward.
7. **Repeat-word exhaustion** — `pickWords(3, {exclude:usedWords})` near bank limits may allow repeats (per infra spec). With ≤8 turns and ~375 words this never triggers; documented as non-issue.
