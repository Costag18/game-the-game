# Typing Race — Implementation Spec

> Slug: `typing-race` · Engine id: `typingRace` · Type: simultaneous, single timed sprint
> Status: build-ready. Follows BaseGame v2.7.0 leave/deadlock contract. Reference engines: `RockPaperScissors.js` (simultaneous + reveal-ack), `SpotTheDifference.js` (timed broadcast + `setOnStateChange`/`_emitChange`).

## 1 Overview

- **Players:** 2–8 (min 2, max 8).
- **Type:** Simultaneous. No turns — every player types the same passage at the same time against one shared countdown.
- **Length:** ONE sprint of ~90 seconds (`TIMERS.TYPING = 90`). No multi-round loop; the whole mini-game is one race that ends on first-to-finish-all OR cutoff.
- **Goal:** Type the displayed passage exactly. Rank by who completes it (earliest finish wins); unfinished players rank by correct-character progress then time.
- **Theme:** "scroll transcription" — an aged parchment scroll with the passage as calligraphic body text the player transcribes; sender/racer lanes are wax-seal markers crawling rightward across the scroll.
- **Title font:** `Special Elite` (primary, typewriter feel). Fallback stack: `'Special Elite', 'Cutive Mono', monospace`. The live-typed text area uses `Cutive Mono` for fixed-width char alignment.
- **Server-authoritative:** the passage lives server-side. Clients only send incremental progress; the server validates every keystroke batch against the passage PREFIX and is the sole source of `correctChars`, `finished`, and `finishTime`. The client NEVER computes its own score.

## 2 Tournament fit

The orchestrator calls `getResults()` once when `isComplete()` is true; it must return EVERY player exactly once with a `placement`. `Scorer.calculateRoundScores()` reads `gameResults[].placement` (ties allowed — multiple players may share a placement) and maps it through `PLACEMENT_MULTIPLIERS = [1.0, 0.7, 0.5, 0.35, 0.25, 0.15]`.

- All N players (2–8) are always ranked, including those who typed 0 chars (they sort last).
- **Tie rule:** two players tie only when they have identical `finished` status, identical `correctChars`, AND (for finishers) identical `finishMs`. In practice finishers almost never tie because `finishMs` is sub-millisecond-distinct; the tie path mainly matters for two players who both typed 0 chars or stalled at the same prefix length when the cutoff hit. Tied players share a placement number; the next distinct rank skips by the size of the tie group (standard `placement = i + 1` only when the sort key strictly worsens).
- A player who leaves mid-race is frozen at their last validated progress and still ranked (they remain in `this.players` until `removePlayer` prunes them; see §9).

## 3 FSM

States: `waiting`, `racing`, `finished`. There is no per-round reveal/ack phase — the sprint result IS the round result, surfaced by the standard `roundResults` screen after `isComplete()`.

| State \ Action     | `start`   | `cutoff`    | (internal `_finishRace`) |
|--------------------|-----------|-------------|--------------------------|
| `waiting`          | `racing`  | —           | —                        |
| `racing`           | —         | `finished`  | `finished`               |
| `finished`         | —         | —           | —                        |

FSM config (BaseGame `transitions`):

```js
{
  states: ['waiting', 'racing', 'finished'],
  initialState: 'waiting',
  transitions: {
    waiting: { start: 'racing' },
    racing:  { cutoff: 'finished' },   // single labeled transition into finished
  },
}
```

Note: both the natural "everyone finished / first finisher" path and the timeout path transition via the SAME action label `cutoff` (so there is exactly one `racing → finished` edge). `_finishRace()` is the internal helper that calls `transition('cutoff')`; do not add a second edge.

**onEnter hooks** (BaseGame auto-invokes `onEnter<State>` after transition):
- `onEnterRacing()` — snapshot `this.raceStartMs = Date.now()`, compute `this.cutoffAt = raceStartMs + TIMERS.TYPING*1000`, arm `_cutoffTimer`.
- `onEnterFinished()` — `_clearTimers()`, freeze `this.endMs`, finalize each player's `finishMs` (finishers keep theirs; non-finishers get `null`). Idempotent (guard `if (this._finalized) return;`).

## 4 Server state (fields on the engine instance)

```
this.passage          // string — the full target text the players transcribe
this.passageLen       // number — this.passage.length (cached)
this.progress         // { [playerId]: number }  validated correct-prefix length (0..passageLen)
this.finished         // { [playerId]: boolean }
this.finishMs         // { [playerId]: number|null } ms since raceStart when player hit passageLen
this.lastInputMs      // { [playerId]: number } last accepted-input timestamp (tiebreak for stalls)
this.mismatches       // { [playerId]: number } count of rejected (wrong-prefix) submissions — telemetry only, not scored
this.left             // Set<playerId> — players who left; frozen, excluded from "everyone finished" check
this.raceStartMs      // number — Date.now() when racing began
this.cutoffAt         // number — raceStartMs + TIMERS.TYPING*1000
this.endMs            // number|null — Date.now() when race finished (for final WPM calc)
this._cutoffTimer     // setTimeout handle
this._onStateChange   // broadcast callback (set via setOnStateChange)
this._finalized       // bool guard for onEnterFinished
```

**Passage source:** a server-side bank `TYPING_PASSAGES` (array of 60–120 char strings, ASCII printable, single spaces, no tab/newline). Pick one at random in `startGame()`: `this.passage = TYPING_PASSAGES[Math.floor(Math.random()*TYPING_PASSAGES.length)]`. Define the bank as a module-level const in `TypingRace.js` (or import from `server/src/utils/words.js` if a passages export is added there — keep it self-contained in `TypingRace.js` to avoid touching shared utils). Theme the passages as scroll/quote text (proverbs, classic opening lines) to match "scroll transcription".

```js
startGame() {
  this.passage = TYPING_PASSAGES[Math.floor(Math.random()*TYPING_PASSAGES.length)];
  this.passageLen = this.passage.length;
  for (const p of this.players) {
    this.progress[p] = 0; this.finished[p] = false; this.finishMs[p] = null;
    this.lastInputMs[p] = 0; this.mismatches[p] = 0;
  }
  this.transition('start');   // -> racing, onEnterRacing arms cutoff timer
}
```

## 5 Actions (`handleAction(playerId, action)`)

Guard first: `if (!this.players.includes(playerId)) return;` and `if (this.state !== 'racing') return;` (ignore everything once finished). Note: simultaneous game — there is NO `currentTurnPlayer` guard; any racing, non-finished, non-left player may submit at any time.

| `action.type` | Payload | Validation | Effects |
|---------------|---------|-----------|---------|
| `typed`       | `{ text: string }` — the player's FULL current typed string (cumulative, not a delta) | reject if `state !== 'racing'`; reject if `this.finished[playerId]` already true; reject if `this.left.has(playerId)`; reject if `typeof text !== 'string'`; clamp `text` to `passageLen` chars (ignore anything past the end) | compute `n = correctPrefixLen(text, passage)` (see below). If `n < this.progress[playerId]` (client regressed — backspaced past validated point, or stale packet) keep the MAX: `this.progress[playerId] = Math.max(this.progress[playerId], n)` is **wrong** — instead set `this.progress[playerId] = n` BUT never let a finished player un-finish. Use **monotonic correct prefix**: `this.progress[playerId] = n`. Update `this.lastInputMs[playerId] = Date.now()`. If `n === passageLen` → mark finish (below). |
| `progress`    | `{ count: number }` — alternative lighter payload: client claims it has correctly typed `count` chars of the prefix | server CANNOT trust a bare count (it never saw the chars). REJECT this form unless you also send the chars. **Decision:** only `typed` (with `text`) is accepted; `progress` is documented here as rejected to prevent a future contributor adding an unvalidated count path. | none (ignored) |
| `ping`        | none | always allowed while racing | no state change; lets a client that suspects the cutoff passed nudge the server. Server re-checks `Date.now() >= cutoffAt` and finishes if so (defense vs a dropped timer). Falls through to broadcast in `index.js`. |

**Prefix validation (server-authoritative, the security core):**

```js
correctPrefixLen(text, passage) {
  const max = Math.min(text.length, passage.length);
  let i = 0;
  while (i < max && text.charCodeAt(i) === passage.charCodeAt(i)) i++;
  return i; // length of the leading exact-match run; first wrong char stops it
}
```

A submission whose first differing char is at position `k` only counts `k` correct chars — the player must fix the typo before progress advances past `k`. If `n < previous progress` we still set progress to `n` (truth = current correct prefix); this naturally handles "typed wrong then backspaced". Increment `this.mismatches[playerId]` when `text.length > n` (i.e. there is an incorrect char being held) — telemetry for display only, never affects rank.

**Finish marking** (inside `typed` when `n === passageLen`):

```js
this.finished[playerId] = true;
this.finishMs[playerId] = Date.now() - this.raceStartMs;
this.progress[playerId] = passageLen;
// First finisher does NOT end the race for others — they keep racing for placement.
// Race ends only when ALL non-left players are finished, or cutoff fires.
if (this._allActiveFinished()) this._finishRace();
```

`_allActiveFinished()` = every `p in this.players` with `!this.left.has(p)` has `this.finished[p] === true`. If there are no active players left, treat as finished.

**Turn guards:** none (simultaneous). The only gates are state, finished-flag, and left-flag, all enforced above.

## 6 getStateForPlayer(playerId)

Hidden-info rules: there is essentially nothing secret — everyone transcribes the same visible passage, and racers' progress is public (it's a race; the live track is the whole point). The only thing NOT echoed is each opponent's raw keystroke text — only their validated `progress` count, derived WPM, and `finished` flag are exposed. The requesting player gets their own `progress` so the client can reconcile/correct optimistic local rendering.

```js
getStateForPlayer(playerId) {
  const now = Date.now();
  const elapsedMs = this.state === 'finished'
    ? (this.endMs - this.raceStartMs)
    : (this.state === 'racing' ? now - this.raceStartMs : 0);
  return {
    phase: this.state,                     // 'waiting' | 'racing' | 'finished'
    passage: this.passage,                 // full target text (public)
    passageLen: this.passageLen,
    cutoffAt: this.cutoffAt,               // absolute epoch ms — client derives countdown
    durationSec: TIMERS.TYPING,            // 90
    raceStartMs: this.raceStartMs,
    myId: playerId,
    myProgress: this.progress[playerId] || 0,
    myFinished: !!this.finished[playerId],
    myFinishMs: this.finishMs[playerId] ?? null,
    myWpm: this._wpm(playerId, elapsedMs),
    racers: this.players.map((p) => ({
      playerId: p,
      progress: this.progress[p] || 0,
      pct: this.passageLen ? Math.round(100 * (this.progress[p] || 0) / this.passageLen) : 0,
      finished: !!this.finished[p],
      finishMs: this.finishMs[p] ?? null,
      wpm: this._wpm(p, elapsedMs),
      left: this.left.has(p),
    })),
    // Final standings only revealed when finished (client can also derive, but send for safety)
    standings: this.state === 'finished' ? this.getResults() : null,
  };
}
```

`_wpm(playerId, elapsedMs)`: standard 5-chars-per-word: `correctChars / 5` words over `elapsedMs/60000` minutes. Use the player's `finishMs` when finished so a fast finisher's WPM freezes at their finish time, not the full 90s:

```js
_wpm(p, fallbackElapsedMs) {
  const chars = this.progress[p] || 0;
  const ms = this.finished[p] && this.finishMs[p] != null ? this.finishMs[p] : fallbackElapsedMs;
  if (!ms || ms <= 0) return 0;
  return Math.round((chars / 5) / (ms / 60000));
}
```

## 7 Timers & broadcasting

- **Cutoff timer:** single `setTimeout` armed in `onEnterRacing()` for `TIMERS.TYPING*1000` ms (90 000). On fire: guard `if (this.state !== 'racing') return;`, then `this._finishRace()` and `this._emitChange()` so all clients receive the finished state and `index.js` re-checks `isComplete()`. THIS IS MANDATORY — without `_emitChange()` after a timer-driven transition, clients whose local countdown also expired would be stuck (matches the Spot the Difference lesson).

```js
onEnterRacing() {
  this.raceStartMs = Date.now();
  this.cutoffAt = this.raceStartMs + TIMERS.TYPING * 1000;
  this._clearTimers();
  this._cutoffTimer = setTimeout(() => {
    if (this.state !== 'racing') return;
    this._finishRace();
    this._emitChange();
  }, TIMERS.TYPING * 1000);
}

_finishRace() {
  if (this.state !== 'racing') return;   // idempotency guard
  this.transition('cutoff');             // -> finished, fires onEnterFinished
}

setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }

_clearTimers() {
  if (this._cutoffTimer) { clearTimeout(this._cutoffTimer); this._cutoffTimer = null; }
}
```

- **No per-turn timer, no reveal-ack timer.** A simultaneous single sprint has no acknowledgement phase; `roundResults` is the standard post-game screen with its own 15s orchestrator auto-advance, so we do NOT add a 10s ack timer here.
- **Live progress broadcasting:** every accepted `typed` action mutates progress; `index.js` already broadcasts state after `handleAction`. To keep the live race track smooth without flooding, the CLIENT throttles `typed` emits to ~5–10/sec (one per accepted keystroke is fine for short passages; debounce/coalesce to at most every 80–120 ms). The server does NOT push unsolicited ticks — it broadcasts on each action and on the cutoff `_emitChange`. (Optional polish: a 1 Hz `_emitChange` heartbeat so idle-but-watching clients see opponents' WPM tick; only add if the live track looks stale. Keep it behind a single `setInterval` cleared in `destroy()` if adopted.)
- **Auto-action on timeout:** there is no per-player auto-action — when the cutoff fires, whatever each player has validated is their final progress. Players who never typed score 0 chars and rank last.

## 8 Scoring & getResults

`getResults()` returns one entry per player in `this.players`, sorted best→worst, with ties sharing a placement. Sort key (descending desirability):

1. **finished** (true before false).
2. Among finishers: **earlier `finishMs`** wins (ascending).
3. Among non-finishers: **higher `correctChars` (`progress`)** wins (descending).
4. Final tiebreak for equal-progress non-finishers: **earlier `lastInputMs`** (reached that prefix first) — ascending. (Negligible but deterministic; keeps results stable.)

```js
getResults() {
  const entries = this.players.map((p) => ({
    playerId: p,
    finished: !!this.finished[p],
    correctChars: this.progress[p] || 0,
    finishMs: this.finishMs[p] ?? null,
    lastInputMs: this.lastInputMs[p] || Infinity,
    wpm: this._wpm(p, (this.endMs ?? Date.now()) - this.raceStartMs),
  }));

  entries.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) return a.finishMs - b.finishMs;      // earlier finish first
    if (b.correctChars !== a.correctChars) return b.correctChars - a.correctChars; // more chars first
    return a.lastInputMs - b.lastInputMs;                              // reached it sooner first
  });

  // Tie key: two entries tie iff finished+correctChars+finishMs all equal
  const sameRank = (x, y) =>
    x.finished === y.finished &&
    x.correctChars === y.correctChars &&
    x.finishMs === y.finishMs;

  let placement = 1;
  return entries.map((e, i) => {
    if (i > 0 && !sameRank(e, entries[i - 1])) placement = i + 1;
    return {
      playerId: e.playerId,
      placement,
      finished: e.finished,
      correctChars: e.correctChars,
      wpm: e.wpm,
      handDescription: e.finished
        ? `Finished — ${e.wpm} WPM`
        : `${e.correctChars}/${this.passageLen} chars`,
    };
  });
}
```

`handDescription` mirrors the convention other engines use (RPS `"${score} wins"`, Spot `score`) — it surfaces in the round-results UI. The orchestrator passes `placement` (with ties) into `Scorer.calculateRoundScores`, so wager/base points follow the standard table automatically.

## 9 Leave & deadlock handling

Contract: `removePlayer(id)` MUST call `super.removePlayer(id)` first (prunes `this.players` + rotation — rotation is unused here but harmless), then apply game-specific nudges; any timer it clears must be balanced by the orchestrator's post-leave broadcast. `_removeFromActive` is for elimination (not used — nobody is eliminated mid-sprint). `destroy()` clears all timers.

```js
removePlayer(playerId) {
  super.removePlayer(playerId);                 // prunes this.players
  this.left.add(playerId);                      // freeze marker (kept for any late state reads)
  // Their progress/finished/finishMs are LEFT INTACT and excluded from "all finished" via this.left.
  // They were pruned from this.players, so getResults() no longer includes them — which is correct:
  // a player who left the lobby/disconnected should not occupy a placement in the round scoring.

  if (this.state === 'racing') {
    if (this.players.length === 0) {            // everyone gone
      this._finishRace();
      return;
    }
    // If the only reason the race was still open was this player, finish now.
    if (this._allActiveFinished()) {
      this._finishRace();
    }
  }
}
```

Why freeze + prune both: `super.removePlayer` removes them from `this.players` so `getResults()` and `_allActiveFinished()` no longer wait on or rank them (correct — a gone player shouldn't take a placement). `this.left` additionally short-circuits any lingering reference and documents intent; `_allActiveFinished()` checks `this.players` minus `this.left` defensively.

Per-phase "what if the last-needed player leaves":

- **`waiting`:** transient (we transition to `racing` synchronously in `startGame`); a leave here just prunes. If `<2` players remain the orchestrator force-ends the round/tournament (1 player left ⇒ they win) — engine does nothing special.
- **`racing`, the leaver was the last un-finished player:** after pruning, `_allActiveFinished()` becomes true ⇒ `_finishRace()` ⇒ `finished`. The orchestrator broadcasts post-leave, so clients see the finish. No deadlock.
- **`racing`, others still typing:** prune the leaver, race continues normally; the live track simply drops their lane (`left: true` if any state is still read before prune completes).
- **`racing`, everyone leaves:** `this.players.length === 0` ⇒ `_finishRace()`; `getResults()` returns `[]` — the orchestrator's "≤1 player remains" path already handles ending the round before this matters.
- **`finished`:** no-op beyond pruning; results already final.

```js
destroy() {
  this._clearTimers();
  this._onStateChange = null;
}
```

`onEnterFinished()` is idempotent so a leave-triggered `_finishRace()` racing with the cutoff timer cannot double-finalize:

```js
onEnterFinished() {
  if (this._finalized) return;
  this._finalized = true;
  this._clearTimers();
  this.endMs = Date.now();
}
```

## 10 Client component (`client/src/games/TypingRace.jsx` + `.module.css`)

Props (standard signature): `{ gameState, nicknames, avatars, onAction }`. Read everything from `gameState` (the `getStateForPlayer` shape). Emit via `onAction({ type, ... })`.

**Layout (scroll-transcription theme):**
- Parchment scroll background (CSS gradient + subtle paper texture, deckled/curled top & bottom edges via pseudo-elements). Title "Typing Race" in `Special Elite` at top, a wax-seal-style countdown badge showing `Math.max(0, Math.ceil((cutoffAt - Date.now())/1000))` updated by a local `requestAnimationFrame`/`setInterval(…,100)` driven off `cutoffAt` (NOT off a prop tick — server only sends `cutoffAt`).
- **Passage panel:** the target text rendered in `Cutive Mono`, with a 3-color overlay derived from `myProgress`: chars `[0, myProgress)` = "inked correct" (dark/green), the char at `myProgress` = caret highlight, chars `(myProgress, len)` = "faint ghost" (low-opacity). Because the server only sends `myProgress`, the client colors purely by index — it does NOT need to know which char was wrong.
- **Hidden input / contenteditable:** a focused `<textarea>` (or hidden input) captures typing. On every `input` event, send the FULL current value: throttle to ≤1 emit / 90 ms via a ref'd timer, `onAction({ type: 'typed', text: el.value })`. Render the colored passage from server `myProgress` (authoritative) so a rejected char doesn't visually advance. Disable the textarea when `myFinished` or `phase === 'finished'`.
- **Live race track:** one lane per `racers[]` entry — avatar (`avatars[playerId]`) + `PlayerName` at the left, a horizontal track with the marker positioned at `pct%`, a flag/seal at the right (finish line at `passageLen`). Show `wpm` and, when `finished`, a checkmark + finish order. Own lane highlighted. This is the centerpiece — must update smoothly as state broadcasts arrive.

**Per-phase screens:**
- `waiting`: brief "Unrolling the scroll…" (rarely seen — race starts immediately).
- `racing`: passage panel + textarea + live track + countdown.
- `finished`: dim the textarea, reveal `standings` (placement, WPM, chars) over the scroll; let the standard `roundResults` screen take over after the orchestrator advances.

**Touch support:** the textarea must accept the mobile soft keyboard (auto-focus on `racing` start, `inputMode="text"`, `autoCapitalize="off"`, `autoCorrect="off"`, `autoComplete="off"`, `spellCheck={false}` — autocorrect would inject wrong chars and tank the score). Tapping the passage focuses the input. No hover-only interactions.

**Sound / shake:** `useSound()` — play a soft "click/typewriter key" on each accepted local keystroke (cap rate so it isn't machine-gun; e.g. only on every accepted char or throttled), a "ding"/win cue when `myFinished` flips true, and a round-win cue handled by the existing App-level `ROUND_RESULTS` listener. `useScreenShake()` — `shake('light')` when the local player crosses the finish line; `shake('medium')` reserved for first-place finish if detectable from `standings`. Do not shake on every keystroke.

**gameState reads / actions emitted (summary):**
- Reads: `phase`, `passage`, `passageLen`, `cutoffAt`, `myProgress`, `myFinished`, `myWpm`, `racers[]`, `standings`.
- Emits: `{ type: 'typed', text }` (throttled), `{ type: 'ping' }` (only if local countdown hits 0 and `phase` still `racing` after a grace, mirroring the existing client safety pattern).

## 11 Registration checklist

| # | File (absolute under `…\game the game`) | Exact edit |
|---|------------------------------------------|-----------|
| 1 | `server\src\games\TypingRace.js` | New engine: `export class TypingRace extends BaseGame` per §3–§9. Include module-level `const TYPING_PASSAGES = [...]`. |
| 2 | `shared\gameList.js` | Add `GAMES.typingRace` entry (values below). |
| 3 | `shared\constants.js` | Add `TYPING: 90` to the `TIMERS` object. |
| 4 | `server\src\games\registry.js` | `import { TypingRace } from './TypingRace.js';` + `registerGame('typingRace', TypingRace);` |
| 5 | `client\src\games\TypingRace.jsx` + `client\src\games\TypingRace.module.css` | New component per §10 (props `gameState/nicknames/avatars/onAction`, `PlayerName`, `useSound`, `useScreenShake`, `Special Elite`/`Cutive Mono` fonts, touch-friendly textarea). |
| 6 | `client\src\assets\gamepreviews\typingrace.png` | Add preview image (scroll + typewriter motif). |
| 7 | `client\src\App.jsx` | `import TypingRaceGame from './games/TypingRace.jsx';` (near other game imports) AND add `typingRace: TypingRaceGame,` to `GAME_COMPONENTS`. |
| 8 | `client\src\screens\GameVote.jsx` | `import previewTypingRace from '../assets/gamepreviews/typingrace.png';` AND add `typingRace: previewTypingRace,` to `GAME_PREVIEWS`. |

**Concrete `shared/gameList.js` entry:**

```js
typingRace: {
  id: 'typingRace', name: 'Typing Race', minPlayers: 2, maxPlayers: 8,
  turnTimer: TIMERS.TYPING,
  description: 'Transcribe the scroll fastest. First to finish wins the sprint.',
  instructions: [
    'A passage from an ancient scroll appears — type it exactly as written.',
    'Your typing is checked live: a wrong character stops your progress until you fix it (backspace and retype).',
    'Watch the race track — every player\'s marker crawls toward the finish line in real time.',
    'You have 90 seconds. First player to finish the whole passage ranks highest.',
    'If time runs out, players are ranked by how many correct characters they typed, then by speed.',
    'Your WPM (words per minute) is shown live and frozen when you finish.',
  ],
},
```

Also add to `shared/constants.js`:

```js
export const TIMERS = {
  CARD_GAME: 30,
  RPS: 15,
  ROULETTE: 60,
  VOTE: 20,
  WAGER: 30,
  SPOT_DIFFERENCE: 45,
  BATTLESHIP: 30,
  TYPING: 90,           // <-- new
  RECONNECT_GRACE: 45,
};
```

`getEligibleGames(playerCount)` needs no change — it filters by min/max from the new entry automatically.

## 12 Edge cases & test scenarios (leave/deadlock harness assertions)

Construct with N socket-id strings; drive via `handleAction` and fake timers.

1. **All ranked every game:** 2..8 players, mixed finishers and partials → `getResults().length === players.length`; every entry has a numeric `placement`; placements start at 1 and only increase when the sort key strictly worsens.
2. **Prefix rejection (security):** player sends `typed` with a wrong 3rd char → `progress` stops at 2; sending a longer wrong string never advances past the first error; `mismatches` increments. Fixing the char (correct prefix) advances normally.
3. **No trust in client count:** sending `{ type: 'progress', count: 999 }` is ignored; `progress` unchanged.
4. **First finisher does not end race:** P1 hits `passageLen` → `finished[P1]` true, `finishMs` set, race still `racing`; P2 keeps typing and can still place 2nd. Race only flips to `finished` when all active finish OR cutoff fires.
5. **Cutoff finish + broadcast:** advance fake clock past `cutoffAt`; `_cutoffTimer` fires → state `finished`, `_emitChange` called once, `isComplete()` true. Assert no second finalize when a late `typed`/`ping` arrives (`onEnterFinished` guarded by `_finalized`).
6. **Ping safety:** drop the cutoff timer (simulate), client sends `{ type:'ping' }` after `Date.now() >= cutoffAt` → server detects and finishes (no permanent stall).
7. **Leave — last un-finished player (deadlock):** P1 finished, P2 not; `removePlayer(P2)` while `racing` → `_allActiveFinished()` true → `_finishRace()` → `finished`; `getResults()` excludes P2, includes P1 as placement 1. No orphaned timer (assert `_cutoffTimer === null`).
8. **Leave — one of several racers:** 4 players racing, `removePlayer(P3)` → race continues; `getResults()` has 3 entries; remaining ranks contiguous.
9. **Leave — everyone leaves:** remove all during `racing` → `_finishRace()`, `getResults()` returns `[]`; no throw; `destroy()` clears timers.
10. **Leave during `finished`:** `removePlayer` after finish only prunes; results regenerate without the leaver, no exception.
11. **Idempotent finish:** call `_finishRace()` twice and let cutoff fire after a manual finish → exactly one `finished` transition, `endMs` set once.
12. **destroy() clears timers:** after `destroy()`, advancing the clock fires nothing (`_cutoffTimer === null`).
13. **Zero-typer ranking:** a player who never sends `typed` → `correctChars 0`, `finished false`, sorts last; ties with other 0-char non-finishers share a placement.
14. **WPM freeze:** a fast finisher's `wpm` computed from `finishMs` (not full 90s) and does not change after finishing.
15. **Clamp past end:** `typed` with `text.length > passageLen` only counts up to `passageLen`; extra chars ignored; finish triggers exactly at `passageLen`.

## 13 Effort & risks

- **Server engine (`TypingRace.js`): S–M.** Simpler than Spot the Difference (no grid generation, no per-round loop, no ack phase). Core risk is getting the prefix-validation + monotonic-progress semantics and the single `cutoff` edge right.
- **Client (`TypingRace.jsx` + CSS): M.** The live race track and the colored passage overlay driven purely by server `myProgress` are the bulk of the work; mobile soft-keyboard + autocorrect-off handling needs real-device testing. Throttling `typed` emits to avoid socket flooding is important.
- **Registration: S.** 8 mechanical edits.
- **Deps:** none new. Reuses `PlayerName`, `useSound`, `useScreenShake`, existing Google Fonts loader (add `Special Elite` + `Cutive Mono` to the font `<link>` if not already present — check `index.html`/global font import; both are free Google Fonts).
- **Risks:** (a) socket spam from per-keystroke emits — mitigate with client throttle; (b) mobile autocorrect injecting characters that fail the prefix check — mitigate with `autoCorrect/autoCapitalize/spellCheck` off and clear instructions; (c) clock skew between client countdown and `cutoffAt` — countdown is cosmetic; server `cutoffAt` is authoritative and the `ping` path covers a dropped timer.

## 14 Open questions

1. **Passage length / difficulty:** fixed ~90–110 chars, or scale to player skill? Recommend fixed length banked strings for fairness; confirm desired character range so 90s is "hard but finishable" for an average typer (~40 WPM ⇒ ~600 chars in 90s, so a 90–120 char passage is very finishable — should we lengthen to make finishing-order meaningful, or keep short so most finish and `finishMs` decides?). **Recommendation:** ~140–180 chars so not everyone finishes, making both finish-order AND partial-progress rankings meaningful.
2. **Passage source:** hard-coded bank in `TypingRace.js` (proposed) vs. pulling from `server/src/utils/words.js`. Confirm we keep it self-contained.
3. **Live WPM heartbeat:** add the optional 1 Hz `_emitChange` so spectators see opponents' WPM tick even when not typing, or rely solely on action-driven broadcasts? (Default: action-driven only; add heartbeat only if the track looks stale.)
4. **Casino/free-play exposure:** Typing Race is tournament-only like the other 12; no casino-sidebar variant planned — confirm.
5. **Sound cadence:** per-accepted-char typewriter click vs. throttled — confirm it won't be annoying; may gate behind the existing mute.
