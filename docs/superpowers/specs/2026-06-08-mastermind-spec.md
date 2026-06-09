# Mastermind — Implementation Spec

> Build-ready spec for a new mini-game `mastermind` in **Game The Game**. Server-authoritative FSM extending `BaseGame`. SIMULTANEOUS deduction race: ONE shared hidden code, every player guesses independently against it, first to crack ranks top.

---

## 1 Overview

| Field | Value |
|-------|-------|
| **Slug / id** | `mastermind` |
| **Display name** | Mastermind |
| **Players** | 2–8 (`minPlayers: 2`, `maxPlayers: 8`) |
| **Type** | Simultaneous deduction race (like RPS/Roulette/SpotTheDifference — every player acts in parallel, no turn rotation) |
| **Length** | Single shared round per tournament-round. Hard caps: `MAX_GUESSES = 10` per player **and** a `TIMERS.MASTERMIND = 120`s wall clock. Round ends when all players have cracked it OR exhausted guesses OR the clock expires. |
| **Title font** | `Orbitron` (Google Font — same family as Memory Match; load via `@import` in the CSS module) |
| **Code shape** | 4 pegs, 6 colors, duplicates allowed → `6^4 = 1296` possible codes |
| **Feedback** | Standard Mastermind black/white pegs (black = right color + right position, white = right color wrong position), computed with the two-pass dedup algorithm |

The defining twist vs. classic Mastermind: there is **one** secret code shared by everyone, and players race. Your own board (guesses + feedback) is **private**; the leaderboard shows only `solved` flag and `guessCount` for opponents. This prevents copying another player's deductions.

---

## 2 Tournament fit

`getResults()` MUST return an entry for **every** player in `this.players` (2–8), each with a `placement` (ties share a placement number), sorted best-rank-first. The tournament `Scorer` reads `placement` and applies `PLACEMENT_MULTIPLIERS = [1.0, 0.7, 0.5, 0.35, 0.25, 0.15]`.

Ranking key (see §8 for full detail):

1. **Solvers rank above non-solvers.**
2. Among solvers: **fewer guesses to crack = better**; tie-break by **earlier solve timestamp** (`solvedAtMs`).
3. Among non-solvers: **more black pegs in best guess = better**; then **more white pegs**; then **fewer guesses used** (efficiency); then tie.

Tie rule (mirrors RPS/StD): walk the sorted list, bump `placement = i + 1` only when the current entry's comparison key is strictly worse than the previous entry's. Equal keys → identical placement number. The `Scorer.calculateRoundScores(..., gameResults)` path already honors duplicated placement numbers.

Guard: even if **no one** solves and everyone has 0 black pegs, every player still gets a placement (they'll mostly tie at 1), so the round always resolves and scores.

---

## 3 FSM

`BaseGame` `transition(action)` looks up `transitions[state][action]`, sets the next state, and auto-calls an `onEnter<NextState>` hook if defined. We don't use the turn-rotation helpers (`nextTurn`/`setTurnPlayer`) — this is simultaneous.

### State × action → next-state table

| Current state | Action | Next state | Notes |
|---------------|--------|-----------|-------|
| `waiting` | `start` | `playing` | fired by `startGame()` |
| `playing` | `endRound` | `reveal` | all done / clock expired |
| `reveal` | `finish` | `finished` | after ack window |

```js
states: ['waiting', 'playing', 'reveal', 'finished'],
initialState: 'waiting',
transitions: {
  waiting: { start: 'playing' },
  playing: { endRound: 'reveal' },
  reveal:  { finish: 'finished' },
},
```

There is **no** per-guess state change — guesses are processed inside `playing` and only mutate per-player board data; the FSM state stays `playing` until the round-end condition trips.

### onEnter hooks

| Hook | Effect |
|------|--------|
| `onEnterPlaying()` | generate `secretCode`, init per-player boards, record `_roundStartMs`, start the 120s cutoff timer. |
| `onEnterReveal()` | clear cutoff timer, freeze boards, compute final per-player stats, set `acknowledged = new Set()`, start the ~10s reveal/ack auto-advance timer. |
| `onEnterFinished()` | clear all timers (defensive). `isComplete()` now true. |

(We could also do this work inline in `startGame()`/`_endRound()`; using `onEnter*` keeps it declarative and matches the BaseGame contract. Pick one and be consistent — this spec wires it through the hooks.)

---

## 4 Server state (`server/src/games/Mastermind.js` fields)

```
COLORS        = ['R','O','Y','G','B','P']   // 6 colors; client maps to emoji/swatch
CODE_LENGTH   = 4
NUM_COLORS    = 6
MAX_GUESSES   = 10
ROUND_MS      = TIMERS.MASTERMIND * 1000     // 120_000
ACK_MS        = 10_000
```

Instance fields:

| Field | Type | Meaning |
|-------|------|---------|
| `this.secretCode` | `string[4]` | the shared hidden code, e.g. `['R','R','G','B']`. NEVER leaked pre-reveal. |
| `this.boards` | `{ [pid]: { guesses: [{ pegs:string[4], black:number, white:number }], solved:boolean, solvedAtMs:number|null, guessCount:number, bestBlack:number, bestWhite:number } }` | per-player private board. |
| `this.done` | `Set<pid>` | players who can no longer guess (solved OR hit MAX_GUESSES). |
| `this.acknowledged` | `Set<pid>` | reveal-phase acks. |
| `this._roundStartMs` | `number` | `Date.now()` when `playing` entered (for client countdown + cutoff). |
| `this._roundTimer` | timeout | 120s cutoff. |
| `this._ackTimer` | timeout | reveal auto-advance. |
| `this._onStateChange` | fn | broadcast callback (see §7). |

`this.players` / `this.activePlayers` come from `BaseGame`. We keep `activePlayers` untouched (no rotation) and rely on `this.players` for everyone.

### Feedback algorithm (pure helper)

```js
function scoreGuess(secret, guess) {            // both length-4 arrays
  let black = 0;
  const sRem = [], gRem = [];
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) black++;
    else { sRem.push(secret[i]); gRem.push(guess[i]); }
  }
  let white = 0;
  const pool = {};
  for (const c of sRem) pool[c] = (pool[c] || 0) + 1;
  for (const c of gRem) if (pool[c] > 0) { white++; pool[c]--; }
  return { black, white };                       // black === 4 ⇒ solved
}
```

`generateSecret()` = 4 independent `randomFrom(COLORS)` (dups allowed).

---

## 5 Actions (`handleAction(playerId, action)`)

Top guard: `if (!this.players.includes(playerId)) return;` (covers ghosts/left players).

### `guess` (state `playing`)

- **Payload:** `{ type: 'guess', pegs: ['R','G','B','Y'] }`
- **Validation (reject silently — `return` — on any failure):**
  - `this.state === 'playing'`.
  - player not in `this.done` (already solved or out of guesses).
  - `Array.isArray(action.pegs) && action.pegs.length === 4`.
  - every peg ∈ `COLORS`.
  - `board.guessCount < MAX_GUESSES`.
- **Effects:**
  - `const { black, white } = scoreGuess(this.secretCode, action.pegs);`
  - push `{ pegs:[...], black, white }` to `board.guesses`; `board.guessCount++`.
  - update `board.bestBlack = max(bestBlack, black)`; if `black` is a new best, set `board.bestWhite = white` (track white of the row with most blacks; on equal black keep the higher white).
  - if `black === 4`: `board.solved = true; board.solvedAtMs = Date.now(); this.done.add(pid);`
  - else if `board.guessCount >= MAX_GUESSES`: `this.done.add(pid);`
  - call `this._checkRoundEnd();`
- **Turn guards:** none — simultaneous. No `currentTurnPlayer` check. Two players guessing in the same tick are independent; only their own `board` is mutated.

### `ping` (state `playing`)

- **Payload:** `{ type: 'ping' }` — client safety net when its local 120s timer hits 0 but server hasn't broadcast `reveal`.
- **Effect:** if `Date.now() >= this._roundStartMs + ROUND_MS` and still `playing`, call `_endRound()`. Otherwise no-op. Falls through so index.js still broadcasts state.

### `acknowledge` (state `reveal`)

- **Payload:** `{ type: 'acknowledge' }`
- **Effect:** `this.acknowledged.add(pid); this._checkRevealComplete();`

### `_checkRoundEnd()` (internal)

```js
_checkRoundEnd() {
  if (this.state !== 'playing') return;
  // round ends when every remaining player is done (solved or out of guesses)
  if (this.players.every((p) => this.done.has(p))) this._endRound();
}
```

### `_endRound()` (internal, guarded)

```js
_endRound() {
  if (this.state !== 'playing') return;   // guard double-call (timer + last guess race)
  this._clearTimers();
  this.transition('endRound');            // → onEnterReveal
}
```

---

## 6 getStateForPlayer(playerId)

Returns ONLY the caller's own full board; opponents are reduced to `{ solved, guessCount }`. The secret is `null` until `reveal`/`finished`.

```js
getStateForPlayer(playerId) {
  const board = this.boards[playerId] || emptyBoard();
  const revealed = this.state === 'reveal' || this.state === 'finished';
  return {
    phase: this.state,                       // 'waiting'|'playing'|'reveal'|'finished'
    codeLength: 4,
    colors: COLORS,                          // for the picker palette
    maxGuesses: MAX_GUESSES,
    roundEndMs: this.state === 'playing'
        ? this._roundStartMs + ROUND_MS : null,   // client countdown target
    roundDurationSec: ROUND_MS / 1000,

    // ----- caller's private board -----
    myGuesses: board.guesses.map((g) => ({ pegs: g.pegs, black: g.black, white: g.white })),
    myGuessCount: board.guessCount,
    mySolved: board.solved,
    myDone: this.done.has(playerId),         // solved OR out of guesses → lock input
    myBestBlack: board.bestBlack,

    // ----- opponents: NO board, NO pegs, NO feedback -----
    opponents: this.players.filter((p) => p !== playerId).map((p) => ({
      playerId: p,
      solved: this.boards[p]?.solved || false,
      guessCount: this.boards[p]?.guessCount || 0,
    })),

    // ----- reveal-only -----
    secretCode: revealed ? [...this.secretCode] : null,
    results: revealed ? this.getResults() : null,   // for the reveal scoreboard
  };
}
```

**Hidden-info rules (must hold):**

- `secretCode` is `null` for ALL callers while `phase ∈ {waiting, playing}`.
- An opponent's `pegs`, `black`, `white`, and `bestBlack` are NEVER serialized to anyone else — leaderboard exposes only `solved` + `guessCount`.
- A player always sees their own complete guess history with feedback.

---

## 7 Timers & broadcasting

Register via `setOnStateChange` in `index.js` (the orchestration). Any timer-driven state change MUST call `this._emitChange()` so clients get the new state AND `index.js` re-checks `isComplete()`.

```js
setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }
```

| Timer | Duration | Set in | Fires |
|-------|----------|--------|-------|
| Round cutoff | `120s` (`TIMERS.MASTERMIND`) | `onEnterPlaying` | if still `playing`: `_endRound()` then `_emitChange()` |
| Reveal / ack auto-advance | `~10s` (`ACK_MS`) | `onEnterReveal` | force-ack everyone, `_checkRevealComplete()` → `finish`, then `_emitChange()` |

```js
onEnterPlaying() {
  this.secretCode = generateSecret();
  this._roundStartMs = Date.now();
  for (const p of this.players) this.boards[p] = emptyBoard();
  this.done = new Set();
  this._clearTimers();
  this._roundTimer = setTimeout(() => {
    if (this.state === 'playing') { this._endRound(); this._emitChange(); }
  }, ROUND_MS);
}

onEnterReveal() {
  this._clearTimers();
  this.acknowledged = new Set();
  this._ackTimer = setTimeout(() => {
    if (this.state !== 'reveal') return;
    for (const p of this.players) this.acknowledged.add(p);
    this._checkRevealComplete();
    this._emitChange();
  }, ACK_MS);
}

_checkRevealComplete() {
  if (this.state !== 'reveal') return;
  if (!this.players.every((p) => this.acknowledged.has(p))) return;
  this._clearTimers();
  this.transition('finish');               // → onEnterFinished
}

_clearTimers() {
  if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
  if (this._ackTimer)   { clearTimeout(this._ackTimer);   this._ackTimer = null; }
}
```

**Auto-action on timeout:** when the cutoff fires, every player who hasn't solved is simply scored on their best progress — no auto-submit of a guess is needed (a blank/partial board already ranks via §8). When the ack timer fires, all remaining players are force-acked and the round finishes.

---

## 8 Scoring & getResults

No internal "points" economy — placement is what the tournament consumes. We derive placement purely from board state.

**Per-player ranking record:**

```js
function rankKey(board) {
  return {
    solved:     board.solved ? 1 : 0,
    guesses:    board.guessCount,
    bestBlack:  board.bestBlack,
    bestWhite:  board.bestWhite,
    solvedAtMs: board.solvedAtMs ?? Infinity,
  };
}
```

**Comparator (best first):**

```js
function cmp(a, b) {
  if (a.solved !== b.solved) return b.solved - a.solved;          // solvers first
  if (a.solved) {                                                 // both solved
    if (a.guesses !== b.guesses) return a.guesses - b.guesses;    // fewer guesses better
    return a.solvedAtMs - b.solvedAtMs;                           // earlier crack better
  }
  // neither solved → best progress
  if (a.bestBlack !== b.bestBlack) return b.bestBlack - a.bestBlack;
  if (a.bestWhite !== b.bestWhite) return b.bestWhite - a.bestWhite;
  return a.guesses - b.guesses;                                   // more efficient probing
}
```

**getResults():**

```js
getResults() {
  const entries = this.players.map((p) => {
    const b = this.boards[p] || emptyBoard();
    return {
      playerId: p,
      solved: b.solved,
      guessCount: b.guessCount,
      bestBlack: b.bestBlack,
      bestWhite: b.bestWhite,
      solvedAtMs: b.solvedAtMs,
      ...rankKey(b),
    };
  });
  entries.sort(cmp);

  let placement = 1;
  return entries.map((e, i) => {
    if (i > 0 && cmp(entries[i - 1], e) < 0) placement = i + 1;   // strictly worse ⇒ new placement
    return {
      playerId: e.playerId,
      placement,
      solved: e.solved,
      guessCount: e.guessCount,
      bestBlack: e.bestBlack,
      handDescription: e.solved
        ? `Cracked in ${e.guessCount}`
        : `${e.bestBlack}🅑 ${e.bestWhite}🅦`,
    };
  });
}
```

**Tie rule:** two players with identical `cmp` keys (e.g. both unsolved, both `bestBlack=2 bestWhite=1 guesses=10`) share the same `placement`. `cmp(prev, cur) < 0` is false for equal keys, so `placement` doesn't bump. Verified against the `Scorer` tie path.

Sanity: `getResults()` always returns `this.players.length` entries (2–8), each with `placement` — satisfies constraint #1.

---

## 9 Leave & deadlock handling

Follows the v2.7.0 contract. Players who leave are **auto-finished and frozen** — they no longer block the round, and they're pruned from results so the round can resolve on the remaining players.

```js
removePlayer(playerId) {
  super.removePlayer(playerId);                 // prunes this.players + activePlayers/rotation
  delete this.boards[playerId];                 // frozen: gone from scoring entirely
  if (this.done)         this.done.delete(playerId);
  if (this.acknowledged) this.acknowledged.delete(playerId);

  // <=1 remaining: orchestration force-completes the round; stop timers + finish
  if (this.players.length <= 1) {
    this._clearTimers();
    if (this.state !== 'finished') this.state = 'finished';
    return;
  }

  if (this.state === 'playing') {
    // the leaver may have been the last player we were waiting on
    if (this.players.every((p) => this.done.has(p))) {
      this._endRound();                         // transition → reveal (+ starts ack timer)
    }
  } else if (this.state === 'reveal') {
    // auto-ack the leaver; maybe everyone else already acked
    this._checkRevealComplete();
  }
}
```

Note: `super.removePlayer` already removes from `this.players`; we do NOT re-filter (avoids the redundant double-filter seen in older games — call super once, then only delete game-specific maps).

`_removeFromActive(id)` — **not used here** (no in-game elimination; there's no "out of rotation but still scored" state in a simultaneous race). Players who exhaust 10 guesses are added to `this.done` but stay in `this.players` and are still scored on progress; they are never `_removeFromActive`'d.

```js
destroy() {
  this._clearTimers();
  this._onStateChange = null;
}
```

**Phase-by-phase "what if the last-needed player leaves":**

| Phase | Who leaves | Result |
|-------|-----------|--------|
| `playing` | the only player still guessing (everyone else `done`) | `_endRound()` → `reveal` → ack timer → `finished`. No hang. |
| `playing` | a mid-progress player, others still guessing | round continues; board deleted; cutoff timer still active. |
| `playing` | down to 1 player total | `state = 'finished'` immediately; `_clearTimers`; orchestration ends round with sole survivor ranked 1. |
| `reveal` | last un-acked player | `_checkRevealComplete()` → `finish`. |
| `reveal` | down to 1 player | `state = 'finished'`. |

Every `setTimeout` is paired with `_emitChange()` and a `this.state !== expected` guard, so a stale timer firing after a leave/teardown is a no-op. `destroy()` clears them all before the instance is discarded.

---

## 10 Client component (`client/src/games/Mastermind.jsx` + `.module.css`)

Props (from `App.jsx` `GAME_COMPONENTS`): `gameState`, `nicknames`, `avatars`, `onAction`. Use `PlayerName` for every name, `useSound()` for SFX, `useScreenShake()` for the crack moment.

### Per-phase screens

| `gameState.phase` | Screen |
|-------------------|--------|
| `waiting` | "Generating the secret code…" splash (rare; transitions instantly). |
| `playing` | **main board** (below). |
| `reveal` | reveal panel: the `secretCode` row shown with real swatches; per-player results table (`results`); "Continue" button → `onAction({ type: 'acknowledge' })`. |
| `finished` | brief frozen reveal until orchestration advances to ROUND_RESULTS. |

### `playing` layout

- **Header:** title in `Orbitron`, countdown ring/bar driven by `gameState.roundEndMs` (`Math.max(0, roundEndMs - Date.now())`), `Guess {myGuessCount+1}/{maxGuesses}`.
- **Board (left/center):** scrollable list of `myGuesses`. Each row = 4 colored peg swatches + a compact feedback cluster: `black` filled dots + `white` hollow dots (4 slots total). Newest at bottom; auto-scroll.
- **Input row (bottom):** 4 empty slots + a palette of the 6 `colors` as large tap targets. Tap a color → fills the next empty slot (or tap a slot then a color). A `↩` clears the last slot, `Submit` enabled only when all 4 filled and `!myDone`.
- **Opponent strip (right / collapsible):** one chip per `opponents[]`: `PlayerName` + avatar + either ✅ (solved, show `guessCount`) or `🔍 {guessCount}`. **No pegs/feedback shown** — leaderboard is solved/count only.
- When `myDone` (solved or out of guesses): lock the palette, show "Cracked! Waiting for others…" or "Out of guesses — best: {myBestBlack}🅑".

### Touch support

Tap-to-place pegs (no drag, no hover required). Palette swatches ≥ 44px. Slot + color are both tappable. Submit/clear are buttons. Works identically on desktop and touch — mirror the project's tap-to-preview + confirm philosophy.

### Sound / shake

- `playSound('cardDeal')` (or nearest) on each guess submit.
- `playSound('winRound')` + `shake('heavy')` when `mySolved` flips true.
- `playSound('loseRound')` (soft) when `myDone` true without solving.
- `playSound('reveal')` on entering `reveal`.

### gameState reads / actions emitted

- Reads: `phase, colors, codeLength, maxGuesses, roundEndMs, myGuesses, myGuessCount, mySolved, myDone, myBestBlack, opponents, secretCode, results`.
- Emits:
  - `onAction({ type: 'guess', pegs: ['R','G','B','Y'] })`
  - `onAction({ type: 'acknowledge' })` (reveal Continue)
  - `onAction({ type: 'ping' })` when the local countdown hits 0 and `phase` is still `playing`.

---

## 11 Registration checklist (8 steps)

1. **Server game** — create `server/src/games/Mastermind.js` exporting `class Mastermind extends BaseGame` (everything in §3–§9).

2. **`shared/gameList.js`** — add to `GAMES`:
   ```js
   mastermind: {
     id: 'mastermind', name: 'Mastermind', minPlayers: 2, maxPlayers: 8,
     turnTimer: TIMERS.MASTERMIND,
     description: 'Crack the secret code. First to break it wins.',
     instructions: [
       'Everyone races to crack the SAME hidden 4-peg code (6 colors, duplicates allowed).',
       'Submit a guess of 4 colors. You get feedback: black = right color AND right spot, white = right color WRONG spot.',
       'Your board is private — opponents only see whether you solved it and how many guesses you used.',
       'You get up to 10 guesses and 120 seconds. First to crack it (fewest guesses, then fastest) ranks highest.',
       'If nobody cracks it, you rank by best progress — most black pegs, then most white.',
     ],
   },
   ```

3. **`shared/constants.js`** — add to `TIMERS`:
   ```js
   MASTERMIND: 120,
   ```

4. **`server/src/games/registry.js`** — `import { Mastermind } from './Mastermind.js';` then `registerGame('mastermind', Mastermind);` (match existing `registerGame` signature in that file).

5. **Client component** — `client/src/games/Mastermind.jsx` + `client/src/games/Mastermind.module.css` (§10; `Orbitron` font, `PlayerName`, `useSound`, `useScreenShake`, touch palette).

6. **Preview image** — `client/src/assets/gamepreviews/mastermind.png` (4 colored pegs + black/white feedback dots, Orbitron title).

7. **`client/src/App.jsx`** — import `Mastermind` and add `mastermind: Mastermind` to `GAME_COMPONENTS`.

8. **`client/src/screens/GameVote.jsx`** — import the preview and add `mastermind: mastermindPreview` to `GAME_PREVIEWS`.

> Plus version bump in `shared/version.js` (minor — new feature) per project convention, and a CLAUDE.md update (add Mastermind row to the Mini-Games table + Fonts-Per-Game table: `Mastermind → Orbitron`).

---

## 12 Edge cases & test scenarios

Harness assertions (drive the instance directly, simulating socket actions):

**Core mechanics**
- `scoreGuess(['R','R','G','B'], ['R','R','G','B'])` → `{black:4, white:0}` ⇒ solved.
- `scoreGuess(['R','R','G','B'], ['G','B','R','R'])` → `{black:0, white:4}` (all present, none placed).
- Dup handling: `scoreGuess(['R','R','G','B'], ['R','G','G','G'])` → `{black:2, white:0}` (one R black, one G black; extra G/G not double-counted).
- After 10 wrong guesses, an 11th `guess` action is a no-op (`board.guessCount` stays 10, `done` contains the player).

**Round end**
- 2 players, both solve → `_checkRoundEnd` trips → `reveal`. Solver with fewer guesses gets placement 1.
- 2 players, both solve in the same guessCount → tie-break by `solvedAtMs`; earlier → placement 1.
- Both exhaust 10 guesses, neither solves, equal `bestBlack`/`bestWhite`/`guesses` → BOTH placement 1 (tie).
- Cutoff timer fires at 120s with one player mid-board → `reveal`; that player scored on best progress; `getResults().length === players.length`.
- `getResults()` returns one entry per player for N = 2,3,4,5,6,7,8; every entry has `placement`; placements are non-decreasing with no gaps except across ties.

**Leave / deadlock**
- `playing`, P2 solved, P1 still guessing, P1 leaves → `players.every(done)` true → `_endRound()` → eventually `finished`. Assert no orphaned `_roundTimer` (spy on `_emitChange`/state).
- `playing`, 3 players, the only still-guessing player leaves while 2 are `done` → round ends, no hang.
- `playing`, down to 1 player after a leave → `state === 'finished'` immediately; `_clearTimers` called.
- `reveal`, last un-acked player leaves → `_checkRevealComplete` → `finish`.
- `destroy()` after any phase → both timers null; a previously-scheduled timer that fires post-destroy is a guarded no-op (state already `finished`).
- Leaver is absent from `getResults()` (deleted from `boards` + pruned from `players`).

**Hidden info**
- During `playing`, `getStateForPlayer(P1).secretCode === null`.
- During `playing`, `getStateForPlayer(P1).opponents[0]` has no `pegs`/`black`/`white`/`bestBlack` keys — only `playerId`, `solved`, `guessCount`.
- At `reveal`, `secretCode` is the real 4-peg array for all callers.

---

## 13 Effort & risks

| Item | Size | Notes |
|------|------|-------|
| Server FSM + scoring + leave | **M** | Logic is small but the simultaneous + caps + multi-tiebreak ranking needs careful tests. `scoreGuess` dup logic is the classic gotcha — unit-test first. |
| Client board + palette + reveal | **M** | New input pattern (peg picker) but no canvas; `Orbitron` + swatches are straightforward. |
| Timer/broadcast wiring | **S** | Direct copy of the StD/RPS `setOnStateChange`/`_emitChange`/`_clearTimers` pattern. |
| Registration (8 steps) + preview asset | **S** | Mechanical; preview PNG is the only manual art. |

**Deps:** none new — no external API, no new shared infra. Reuses `BaseGame`, `Scorer`, `PlayerName`, `useSound`, `useScreenShake`, `TIMERS`. Not a 1v1 game (no pairing engine) and not a drawing game (no canvas infra) — both referenced specs are **out of scope**.

**Risks:**
- Double-`_endRound` race (last guess lands the same tick the cutoff fires) — mitigated by the `if (this.state !== 'playing') return;` guard.
- Stale timer after leave/destroy — mitigated by state guards + `destroy()` clearing timers.
- Tie-explosion when nobody solves and everyone has `bestBlack=0` (many players share placement 1) — acceptable; the round still scores and `Scorer` handles duplicated placements.

---

## 14 Open questions

1. **Reveal scoreboard detail:** show each player's full final board to everyone at reveal (educational), or keep boards private even in reveal and show only solved/guessCount + the secret? Spec currently keeps opponent boards private throughout; reveal exposes only the secret + the ranked results table. Confirm preference.
2. **Solo-host / 1-player start:** if a tournament round starts with a single player (project allows `players.length >= 1`), they crack at leisure and auto-rank 1. Fine, or force-skip Mastermind when `< 2`? (Eligibility already gates via `minPlayers: 2` in normal flow.)
3. **MAX_GUESSES vs difficulty:** 10 guesses for a `6^4` space is generous (most players solve). If we want more non-solver spread, consider 8 guesses or 6 colors → 7. Tunable constant; default 10 per brief.
4. **Color-blind accessibility:** pair each color with a distinct symbol/letter on the swatch (the `COLORS` letters `R/O/Y/G/B/P` already exist server-side) — recommend rendering the letter on each peg.
5. **Cutoff vs all-done:** brief says "cap ~10 guesses and/or ~120s". This spec ends the round as soon as *all* players are `done`, not waiting out the full 120s. Confirm we don't want to always run the clock to give late-comers max time (current behavior favors snappy rounds).
