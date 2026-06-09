# Aim Trainer Duel — Implementation Spec

- **slug:** `aim-trainer`
- **game id:** `aimTrainer`
- **date:** 2026-06-08
- **status:** draft / build-ready
- **type:** simultaneous, single fixed-duration round
- **players:** 2–8
- **server engine:** `server/src/games/AimTrainer.js` (extends `BaseGame`)
- **title font:** **Wallpoet** (Google Font) — fallback `'Teko'`

---

## 1. Overview

Aim Trainer Duel is a pure-reflex, server-authoritative shooting gallery. When the round starts, the **server** generates a private stream of targets for **each** player — randomized position and radius on a normalized logical play area — and timestamps each spawn. Every player sees only their **own** stream (parallel and fair; nobody waits on anyone). The player clicks/taps targets; the client sends `{ targetId, ... }`, the server validates that the `targetId` is the player's currently-alive target, credits a **hit**, and immediately spawns the next target for that player. There is exactly **one round** lasting `TIMERS.AIM` seconds (~25s). When the round timer fires, the round ends for everyone at once and `getResults()` ranks all N players by **hits**, with **accuracy** (`hits / clicks`) as the tiebreak. There is no hidden information worth protecting — a player can never see anyone else's targets, only the live scoreboard. The title is rendered in **Wallpoet** to give it a sci-fi HUD identity distinct from every other game.

Estimated round length: **~25 seconds** of play + the standard ≤10s results-ack window the orchestration already provides at the tournament level.

---

## 2. Tournament fit

The orchestration (`server/src/index.js`) calls `game.getResults()` exactly once when `game.isComplete()` becomes true. It maps `results.map(r => r.playerId)` into `placements` and passes the full `results` array (with `placement` numbers, including ties) into `tm.completeRound(placements, results)`. `Scorer.calculateRoundScores` then reads `r.placement` per player to assign placement points × `PLACEMENT_MULTIPLIERS` and the wager return. **Therefore `getResults()` MUST return one entry per player still in `this.players`, sorted best→worst, every player carrying a `placement`.**

Ranking each round:

1. **Primary key:** `hits` descending (more targets destroyed = better).
2. **Tiebreak:** `accuracy = clicks > 0 ? hits / clicks : 0` descending. A player who hit 10/10 outranks 10/14.
3. **Full tie:** equal hits AND equal accuracy → **shared placement** using the canonical pattern:
   ```js
   let placement = 1;
   sorted.forEach((p, i) => {
     if (i > 0 && !tiedWithPrev(p, sorted[i - 1])) placement = i + 1;
     // emit { playerId: p, placement, ... }
   });
   ```
   where `tiedWithPrev` compares both `hits` and `accuracy`. Tied players get the **same** placement integer; the next distinct rank skips accordingly (1,1,3,…). This is exactly the pattern `Scorer` expects (it reads `r.placement` verbatim).

A player with **zero clicks and zero hits** (AFK / never engaged) is still ranked — they simply land at the bottom with `hits=0, accuracy=0`. They always receive a `{playerId, placement, ...}` entry so wager math and standings never break.

---

## 3. FSM

States: `waiting` → `active` → `finished`. There is only one round, so there is no per-round loop and no reveal/ack phase inside the game (the tournament layer owns the post-round results screen).

| state | action (`transition(...)`) | next state | trigger |
|-------|----------------------------|-----------|---------|
| `waiting` | `start` | `active` | `startGame()` |
| `active` | `finish` | `finished` | round timer fires, OR `removePlayer` leaves ≤1 player |

`initialState: 'waiting'`.

`onEnter` hooks (BaseGame auto-invokes `onEnter<State>` after each transition):

- **`onEnterActive()`** — record `this.roundStartAt = Date.now()`, set `this.roundEndAt = roundStartAt + AIM_ROUND_MS`, spawn the first target for every player (`_spawnTarget(p)` for each `p`), arm the round timer (`_startRoundTimer()`).
- **`onEnterFinished()`** — clear the round timer (idempotent), freeze all state. No further mutation.

There is no `onEnterWaiting` (nothing to do before `start`).

---

## 4. Server state

Instance fields set in `constructor(players)` / reset in `startGame()`:

```js
// FSM config passed to super(players, {...})
states: ['waiting', 'active', 'finished']
initialState: 'waiting'
transitions: {
  waiting: { start: 'active' },
  active:  { finish: 'finished' },
}

// --- per-player scoring ---
this.hits      = {};   // playerId -> number   (targets destroyed)
this.clicks    = {};   // playerId -> number   (total click/tap attempts incl. misses)
this.current   = {};   // playerId -> Target | null   (the one alive target for that player)
this._seq      = {};   // playerId -> number   (monotonic per-player target counter, for unique ids)

// --- timing ---
this.roundStartAt = null; // ms epoch
this.roundEndAt   = null; // ms epoch
this._roundTimer  = null; // setTimeout handle

// --- broadcast wiring ---
this._onStateChange = null;
```

`Target` shape (server-authoritative, one alive at a time per player):

```js
{
  id: string,    // `${playerId.slice(0,4)}-${seq}` — unique & easy to validate
  x: number,     // 0..1 normalized center X on the logical play area
  y: number,     // 0..1 normalized center Y
  r: number,     // 0.04..0.10 normalized radius (fraction of min(width,height))
  spawnAt: number, // Date.now() when spawned (server clock) — for analytics/expiry
}
```

The play area is **normalized 0..1** so the client can scale to any viewport. The server never deals in pixels.

`AIM_ROUND_MS = TIMERS.AIM * 1000` (≈ 25000).

`_spawnTarget(playerId)`:
```js
this._seq[playerId] = (this._seq[playerId] || 0) + 1;
const r = 0.04 + Math.random() * 0.06;            // 0.04..0.10
const x = r + Math.random() * (1 - 2 * r);        // keep fully on-screen
const y = r + Math.random() * (1 - 2 * r);
this.current[playerId] = { id: `${playerId.slice(0,4)}-${this._seq[playerId]}`, x, y, r, spawnAt: Date.now() };
```

---

## 5. Actions

`handleAction(playerId, action)` is invoked from the orchestration's `GAME_ACTION` handler. Guards first:

```js
if (this.state !== 'active') return;          // ignore before start / after finish
if (!this.players.includes(playerId)) return; // gone / never in game
```

There is **no turn ownership** (simultaneous) — every player may act at any time during `active`. Each player can only ever touch **their own** `current`/`hits`/`clicks`, so cross-player tampering is structurally impossible.

| action.type | payload | validation | state effect |
|-------------|---------|-----------|--------------|
| `shoot` | `{ targetId: string, clientHitTime?: number, x?: number, y?: number }` | `this.state === 'active'`; player in game; `cur = this.current[playerId]` exists. | Always `this.clicks[playerId]++` (a shoot is an attempt). Then **if** `cur && action.targetId === cur.id` → **hit**: `this.hits[playerId]++`, `_spawnTarget(playerId)` (immediately gives them the next target). Else → **miss/stale**: leave `current` unchanged (the still-alive target stays). |
| `miss` *(optional)* | `{}` | same as above | `this.clicks[playerId]++` only. Client emits this when the player clicks empty space, so accuracy reflects whiffs. (If you prefer to fold misses into `shoot` with a sentinel `targetId`, that is acceptable — pick one and keep it; see Open questions.) |

**Anti-cheat / server authority:** the credit decision is `action.targetId === cur.id`. `targetId` is opaque and minted server-side; a client cannot forge a hit on an expired or non-existent target because the only `id` the server will accept is the one currently in `this.current[playerId]`, and that id changes on every successful hit. `clientHitTime`/`x`/`y` are **advisory only** (logging / future leniency) and never gate the credit. Ignore any `shoot` whose `targetId` doesn't match — do **not** spawn a replacement (that would let spam-clicking farm spawns).

**Broadcast on action:** `handleAction` does **not** itself broadcast — the orchestration's `GAME_ACTION` handler already re-emits `GAME_STATE` to every player after every action and checks `isComplete()`. So a hit → next-target swap is reflected on the next `GAME_STATE` the shooter receives. (This matches how RPS/Roulette rely on the index.js loop, not on `_emitChange`, for action-driven updates. `_emitChange` is reserved for the **timer-driven** round end — see §7.)

---

## 6. getStateForPlayer

```js
getStateForPlayer(playerId) {
  const now = Date.now();
  return {
    phase: this.state,                      // 'waiting' | 'active' | 'finished'
    myId: playerId,
    target: this.state === 'active' ? this.current[playerId] : null, // {id,x,y,r} — MINE only
    myHits: this.hits[playerId] || 0,
    myClicks: this.clicks[playerId] || 0,
    myAccuracy: (this.clicks[playerId] || 0) > 0
      ? (this.hits[playerId] || 0) / this.clicks[playerId] : 0,
    timeLeftMs: this.roundEndAt ? Math.max(0, this.roundEndAt - now) : null,
    roundEndAt: this.roundEndAt,            // absolute epoch — client computes its own countdown
    serverTime: now,                        // for client clock-skew correction
    // live scoreboard — hits only, never targets
    scoreboard: this.players
      .map((p) => ({ playerId: p, hits: this.hits[p] || 0 }))
      .sort((a, b) => b.hits - a.hits),
    totalPlayers: this.players.length,
  };
}
```

**HIDDEN-INFO rules:**

- `target` is **only ever** the requesting player's own current target. No field exposes any other player's `current`, coordinates, or radius. Leaking an opponent's target position is meaningless competitively but still: do **not** include other players' `current` in the payload.
- The `scoreboard` exposes **hits only** (a count), which is intentional public info (it's what the on-screen leaderboard shows). It does **not** expose opponents' accuracy or click counts mid-round (avoids reverse-engineering opponent misses). Accuracy is revealed for everyone via `getResults()` at round end only.
- Before `active` (`waiting`) and after `finished`, `target` is `null` so the client shows the countdown / final card rather than a clickable dot.

---

## 7. Timers & broadcasting

This is a **timer-driven** game (the round ends on a clock, not on a player action), so it MUST wire `setOnStateChange` / `_emitChange` exactly like Roulette's `_spinAckTimer` and SpotTheDifference's round timer — otherwise clients freeze when the timer fires because no `handleAction` is ever called.

```js
setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }
```

The orchestration registers the callback in `startSelectedGame` (already generic): it re-broadcasts `GAME_STATE` to all `tm.players` AND calls `completeAndEmit` when `game.isComplete()`. So our timer just needs to flip state + `_emitChange()`.

| timer | duration | purpose | on fire |
|-------|----------|---------|---------|
| **round timer** (`_roundTimer`) | `AIM_ROUND_MS` (`TIMERS.AIM * 1000`, ≈25000) | end the single round for everyone simultaneously | `if (this.state !== 'active') return; this.transition('finish'); this._emitChange();` |

```js
_startRoundTimer() {
  if (this._roundTimer) clearTimeout(this._roundTimer);
  this._roundTimer = setTimeout(() => {
    if (this.state !== 'active') return;     // guard against double-finish (leave race)
    this.transition('finish');               // onEnterFinished clears the timer too
    this._emitChange();                      // broadcast final state + trigger isComplete() check
  }, AIM_ROUND_MS);
}
```

**Auto-action on timeout:** there is no per-player "turn", so the only timeout is the round end above — which simply finishes the game. There is **no** per-target expiry in the baseline (a slow player just keeps the same target; their accuracy/hits naturally suffer). *Optional* per-target expiry is flagged in Open questions — if added it must also `_emitChange()` so the new target reaches the client.

No reveal/ack phase exists inside this game, so no 10s ack timer is needed here — the post-round results screen + its 15s auto-advance live in the tournament layer (`index.js` `NEXT_ROUND` handler), unchanged.

`isComplete()`:
```js
isComplete() { return this.state === 'finished'; }
```

`destroy()` (called by orchestration before discarding the game):
```js
destroy() { if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; } }
```
Also clear `_roundTimer` inside `onEnterFinished()` so a leave-driven finish doesn't leave a stray timer that fires on a torn-down instance.

---

## 8. Scoring & getResults

Formula per player: `hits` (primary), `accuracy = clicks>0 ? hits/clicks : 0` (tiebreak). No points are computed inside the game — placement → tournament points is entirely `Scorer`'s job.

```js
getResults() {
  const rank = (p) => ({
    playerId: p,
    hits: this.hits[p] || 0,
    clicks: this.clicks[p] || 0,
    accuracy: (this.clicks[p] || 0) > 0 ? (this.hits[p] || 0) / this.clicks[p] : 0,
  });
  const sorted = this.players.map(rank).sort((a, b) =>
    (b.hits - a.hits) || (b.accuracy - a.accuracy)
  );
  let placement = 1;
  return sorted.map((s, i) => {
    if (i > 0) {
      const prev = sorted[i - 1];
      const tied = s.hits === prev.hits && s.accuracy === prev.accuracy;
      if (!tied) placement = i + 1;
    }
    return {
      playerId: s.playerId,
      placement,
      hits: s.hits,
      clicks: s.clicks,
      accuracy: Math.round(s.accuracy * 100), // 0..100 integer % for display
      handDescription: `${s.hits} hits · ${Math.round(s.accuracy * 100)}%`,
    };
  });
}
```

- Returns **one entry per `this.players`** (leavers already pruned — see §9), sorted best→worst.
- **Tie rule:** equal hits AND equal accuracy share the same `placement` integer; the run of ties is followed by `i+1` for the next distinct rank (e.g. `[1,1,3,4]`). This is exactly what `Scorer.calculateRoundScores` consumes via `placementMap`.
- `handDescription` mirrors the convention other games use (RPS `"${n} wins"`, Battleship etc.) so any generic results UI has a human string.

---

## 9. Leave & deadlock handling (v2.7.0 contract)

Aim Trainer is **simultaneous** — no one is ever "waiting on" a specific player's turn, so a leave can never deadlock a turn rotation. The only obligations are: prune the leaver so `getResults()` is leaver-free, and finish if ≤1 remain.

**`removePlayer(playerId)` — player LEFT (disconnect / leave lobby):**

```js
removePlayer(playerId) {
  super.removePlayer(playerId);          // prunes this.players + turn rotation (unused here, but contract)
  delete this.hits[playerId];
  delete this.clicks[playerId];
  delete this.current[playerId];
  delete this._seq[playerId];

  // If ≤1 player remains, finish immediately so the orchestration force-completes
  // the round to the single survivor via getResults().
  if (this.players.length <= 1) {
    if (this._roundTimer) { clearTimeout(this._roundTimer); this._roundTimer = null; }
    if (this.state !== 'finished') this.state = 'finished';
    return;
  }
  // Otherwise nothing to nudge: remaining players keep shooting their own streams,
  // the round timer is untouched, and getResults() will simply omit the leaver.
}
```

Notes:
- We set `this.state = 'finished'` directly (not `transition('finish')`) when collapsing to ≤1, mirroring RPS/Roulette — it avoids throwing if we're somehow already past `active`, and `onEnterFinished` clearing is duplicated by the explicit `clearTimeout` above for safety.
- `super.removePlayer` already removes from `this.players` and `activePlayers`. `index.js handlePlayerLeave` *also* does `tm.players = tm.players.filter(...)` and then calls `tm.activeGame.removePlayer(socket.id)` — both layers prune; our delete-from-maps is the game-specific part.
- **Simultaneous auto-submit/auto-ack:** there is no pending submission or ack to auto-fill (no per-round `choose`, no reveal). The leaver's hits/clicks are simply dropped (their score "frozen" = discarded, since they're out of the ranking entirely). This satisfies the contract's "score frozen / auto-handled" requirement for simultaneous games.

**`_removeFromActive(id)` — in-game elimination:** **not used.** No player is ever "finished" or "out" mid-round in Aim Trainer (everyone plays the full duration), so there is no elimination concept. (Documented here so a future maintainer doesn't add a phantom call.)

**`destroy()`:** clears `_roundTimer` (see §7). The orchestration calls it in three places — normal completion (`completeAndEmit`), force-complete on leave (`handlePlayerLeave`), and `tm.activeGame?.destroy?.()` on teardown — so the timer can never fire on a discarded instance.

**Phase-by-phase: what if the current/last-needed player leaves?**

| when | who leaves | result |
|------|-----------|--------|
| during `active`, 3+ players | any | leaver pruned; remaining players keep shooting; round timer unchanged; `getResults()` omits leaver. No freeze. |
| during `active`, exactly 2 players | one | `players.length` becomes 1 → `removePlayer` clears timer + sets `finished`. `index.js` sees `players.length === 1 && !isComplete()` is now false (we set finished), or its own ≤1 branch fires → force-completes round to the lone survivor via `getResults()` (returns the single player at placement 1). |
| `waiting` (between `start` transition firing and first `GAME_STATE`) | any | window is ~instant (we spawn + arm timer inside `onEnterActive`, synchronously in `startGame`). If it happens, same `removePlayer` logic; timer already armed so it still fires correctly for survivors. |
| `finished` (after timer, before orchestration reads results) | any | `super.removePlayer` prunes them from `this.players`, so the about-to-be-read `getResults()` won't include them. Safe — array still non-empty for ≥1 remaining. |

The orchestration's existing "1 player left → force complete via `getResults()`" path (index.js lines ~1322-1343 and ~1349-1356) handles the collapse; our job is only to make `getResults()` always safe and leaver-free, which the deletes above guarantee.

---

## 10. Client component

`client/src/games/AimTrainer.jsx` + `AimTrainer.module.css`. Props (per App.jsx GAME_COMPONENTS contract): `{ gameState, nicknames, avatars, onAction }`. `gameState` is the `getStateForPlayer` payload (already unwrapped from `gameState.state` by App.jsx).

**Phases / screens:**

1. **`waiting`** (brief): centered "Get ready…" with the **Wallpoet** title "AIM TRAINER". No play area yet.
2. **`active`** (the game): full-bleed dark HUD play area with a single glowing target.
3. **`finished`**: dim the play area, show "Time!" + your `myHits` / `myAccuracy`, plus the final `scoreboard`. (Brief — App.jsx will switch to the tournament `roundResults` screen as soon as `ROUND_RESULTS` arrives.)

**Layout:**

- Root `.arena` mirrors other games: `min-height:100vh`, dark radial background, themed border, `font-family: var(--font-heading)` for body, and the title uses `font-family: 'Wallpoet', 'Teko', sans-serif`.
- A `.playfield` element is the **logical play area**: `position: relative`, `aspect-ratio` or fixed-ish responsive box, `width: min(90vw, 70vh)` square-ish so the normalized 0..1 coords map cleanly. Measure its rendered size with a `ref` + `getBoundingClientRect()` (or a `ResizeObserver`) to convert `target.x/y/r` → pixels.
- HUD strip above/below the playfield: **time left** (big countdown), **my hits**, **my accuracy %**, and a compact live `scoreboard` list (use `PlayerName` for each row so avatars render).

**Key interactions / touch:**

- The target is an absolutely-positioned circular button at `left: x*W`, `top: y*H`, `width/height: r*2*min(W,H)`, centered via `transform: translate(-50%,-50%)`.
- **Hit:** `onPointerDown` on the target → `onAction({ type: 'shoot', targetId: target.id, clientHitTime: Date.now() })`. Use `onPointerDown` (not `onClick`) for minimum latency and to unify mouse + touch; call `e.preventDefault()` / `e.stopPropagation()` so the tap doesn't also register as a playfield miss.
- **Miss:** `onPointerDown` on the `.playfield` background (not the target) → `onAction({ type: 'miss' })` (or `shoot` with a non-matching id, per the chosen convention). This is the tap-anywhere model — **no hover required**, fully touch-friendly. There is no tap-to-preview+confirm here because aiming *is* the game; the "no hover-only" rule is satisfied because every interaction is a direct pointer-down, never a hover state.
- **Countdown:** the client computes its own smooth countdown from `roundEndAt - (Date.now() + skew)` where `skew = serverTime - clientNow` captured on first `active` frame, ticking via `requestAnimationFrame`/`setInterval(100ms)`. It does **not** wait for server frames to update the clock (server only re-broadcasts on actions + the final timer fire).
- Optimistic UX: on a local hit, you may briefly flash the target and rely on the next `GAME_STATE` to deliver the new target id. Always render the **server's** `target` as the source of truth — never spawn targets client-side (anti-cheat + fairness).

**Sound / shake hooks** (per CLAUDE.md conventions):

- `const { playSound } = useSound();` — play a short `'coin'`/`'cardDeal'`-style blip on each successful hit (reuse an existing SFX name; add a dedicated `'aimHit'`/`'aimMiss'` to `SoundEngine.js` if desired, but reuse is fine for v1). Play a `'roundStart'`-ish cue on entering `active` and the existing win/lose cue on `finished` if you placed 1st.
- `const shake = useScreenShake();` — optional light shake (`shake('light')`) on a hit streak or `medium` on the final buzzer. Keep subtle.
- Detect "my hit happened" by comparing the new `myHits` to the previous render's `myHits` in a `useRef` (same pattern the card games use to animate only *new* cards).

**gameState fields read:** `phase`, `target {id,x,y,r}`, `myHits`, `myClicks`, `myAccuracy`, `timeLeftMs`, `roundEndAt`, `serverTime`, `scoreboard [{playerId,hits}]`, `totalPlayers`, `myId`.

**Actions emitted:** `{ type: 'shoot', targetId, clientHitTime }`, `{ type: 'miss' }`.

---

## 11. Registration checklist

| # | file (absolute) | edit |
|---|-----------------|------|
| 1 | `C:\Users\costa\Downloads\Dev Environment\game the game\server\src\games\AimTrainer.js` | Create `class AimTrainer extends BaseGame` implementing `startGame`, `handleAction`, `getStateForPlayer`, `isComplete`, `getResults`, `setOnStateChange`/`_emitChange`, `removePlayer`, `destroy`, `_spawnTarget`, `_startRoundTimer`, `onEnterActive`, `onEnterFinished`. |
| 2 | `C:\Users\costa\Downloads\Dev Environment\game the game\shared\gameList.js` | Add `GAMES.aimTrainer` entry (values below). |
| 3 | `C:\Users\costa\Downloads\Dev Environment\game the game\shared\constants.js` | Add `AIM: 25` to the `TIMERS` object (new constant — round duration in seconds). |
| 4 | `C:\Users\costa\Downloads\Dev Environment\game the game\server\src\games\registry.js` | `import { AimTrainer } from './AimTrainer.js';` and `registerGame('aimTrainer', AimTrainer);` |
| 5 | `C:\Users\costa\Downloads\Dev Environment\game the game\client\src\games\AimTrainer.jsx` + `...\AimTrainer.module.css` | Create the component (props `gameState/nicknames/avatars/onAction`; `PlayerName`; `useSound`; Wallpoet title; pointer-based, touch-safe). |
| 6 | `C:\Users\costa\Downloads\Dev Environment\game the game\client\src\assets\gamepreviews\aimTrainer.png` | Add a preview image (HUD/crosshair art). |
| 7 | `C:\Users\costa\Downloads\Dev Environment\game the game\client\src\App.jsx` | `import AimTrainerGame from './games/AimTrainer.jsx';` and add `aimTrainer: AimTrainerGame` to `GAME_COMPONENTS`. |
| 8 | `C:\Users\costa\Downloads\Dev Environment\game the game\client\src\screens\GameVote.jsx` | `import previewAimTrainer from '../assets/gamepreviews/aimTrainer.png';` and add `aimTrainer: previewAimTrainer` to `GAME_PREVIEWS`. |

Plus per CLAUDE.md: bump `shared/version.js` (minor — new feature), update the Mini-Games table & Fonts table in `CLAUDE.md`, commit, push, tell the user the version.

**Concrete `gameList.js` entry:**

```js
aimTrainer: {
  id: 'aimTrainer', name: 'Aim Trainer Duel', minPlayers: 2, maxPlayers: 8,
  turnTimer: TIMERS.AIM,
  description: 'Hit as many targets as you can in 25 seconds. Fastest aim wins.',
  instructions: [
    'When the round starts, a target appears in your own play area.',
    'Click or tap the target as fast as you can — each hit instantly spawns the next one.',
    'You have 25 seconds. Every player gets their own private stream of targets, so it is perfectly fair.',
    'Most hits wins the round. If tied, the higher accuracy (hits ÷ clicks) ranks first.',
    'Clicking empty space counts as a miss and lowers your accuracy — aim, do not spray.',
  ],
},
```

(Uses `instructions:[...]` like SpotTheDifference/Battleship rather than a `tutorial:` YouTube URL, since there's no canonical "how to play" video for this custom mode.)

**Concrete `constants.js` edit:**

```js
export const TIMERS = {
  CARD_GAME: 30,
  RPS: 15,
  ROULETTE: 60,
  VOTE: 20,
  WAGER: 30,
  SPOT_DIFFERENCE: 45,
  BATTLESHIP: 30,
  AIM: 25,            // <-- new: Aim Trainer Duel round duration (seconds)
  RECONNECT_GRACE: 45,
};
```

---

## 12. Edge cases & test scenarios

Mirror the existing leave/deadlock harness assertions (leaver pruned, turn always valid, `getResults()` safe + leaver-free, round completes). Suggested unit/integration cases:

**Core gameplay**
1. **Hit credits & re-spawns:** `shoot` with the matching `current.id` → `hits++`, `clicks++`, `current` is a *new* target with a *new* id. Re-sending the *old* id → `clicks++` only, no `hits`, `current` unchanged.
2. **Stale/forged id rejected:** `shoot` with a random/garbage `targetId` → `clicks++`, no `hits`, no respawn (anti-cheat: spam can't farm spawns).
3. **Miss accounting:** `miss` (or empty-space shoot) → `clicks++`, `hits` unchanged; accuracy reflects it.
4. **Accuracy tiebreak:** two players both `hits=8`, accuracies 8/8 vs 8/12 → 8/8 ranks first; placements `[1,2]`.
5. **Full tie:** two players `hits=5`, both `5/7` accuracy → shared `placement=1`, third distinct player `placement=3`. Assert `Scorer.calculateRoundScores` reads the tie correctly.
6. **AFK player:** a player who never sends any action → `hits=0, clicks=0, accuracy=0`, still appears in `getResults()` at the bottom placement.
7. **All-AFK degenerate round:** every player `hits=0` → all tied at `placement=1`; `getResults()` length === N; no throw.

**Timing / completion**
8. **Round ends on timer:** advance fake timers by `AIM_ROUND_MS` → `state==='finished'`, `isComplete()===true`, `_emitChange` invoked once (assert the registered `setOnStateChange` cb ran → orchestration would broadcast + complete).
9. **No double-finish:** timer fires after a leave already set `finished` → guard `if (this.state !== 'active') return;` prevents a second `transition('finish')` throw.
10. **Mid-round `GAME_STATE` correctness:** `getStateForPlayer(p)` only ever contains `p`'s own `target`; never another player's `current` (grep the payload).

**Leave / deadlock harness**
11. **Leaver pruned from results:** 4 players, one leaves mid-`active` → `removePlayer` deletes their maps; `getResults()` has exactly 3 entries, none is the leaver, placements `[1,2,3]` (no gaps from the missing player), all `playerId` defined.
12. **Collapse to one survivor:** 2 players, one leaves → `players.length===1`, timer cleared, `state==='finished'`; `getResults()` returns the single survivor at `placement=1`. Orchestration force-complete path produces a valid round result (assert no exception, round completes).
13. **Turn always valid (trivially):** assert `currentTurnPlayer` is never read by Aim Trainer logic (simultaneous) — there is no path where a pruned player's turn is referenced. (Smoke test: after any sequence of leaves, `handleAction` for a remaining player still works.)
14. **Leave during `finished`:** call `removePlayer` after the timer fired → no throw; `getResults()` still returns ≥1 entry for the remainder.
15. **destroy() clears timer:** start, then `destroy()`, then advance fake clock past `AIM_ROUND_MS` → the round-timer callback does **not** run (no `_emitChange`, no state mutation on the dead instance).
16. **Reset on restart:** calling `startGame()` twice (defensive) zeroes `hits/clicks/current/_seq`, clears any prior `_roundTimer`, and re-enters `active` cleanly.

---

## 13. Effort & risks

- **Size:** **S–M.** Server engine is small and self-contained (one round, no turn rotation, no hidden-info filtering complexity, no deck/dice utils). Most of the effort is the client playfield: normalized→pixel mapping, smooth `requestAnimationFrame` countdown, pointer/touch handling, and the hit/miss feedback polish. Call it **M** mostly because of client feel/animation, **S** on the server.
- **Risks / watch-outs:**
  - **Countdown jitter:** server only re-broadcasts on actions + the final timer, so the client MUST run its own local countdown from `roundEndAt` (with `serverTime` skew correction). If you naively render `timeLeftMs` from server frames only, the clock will freeze between hits. (Documented in §10.)
  - **Miss-event spam:** background `miss` events on every empty tap could be noisy. They're cheap (just `clicks++`) and rate-limiting isn't needed for fairness, but consider a tiny client debounce so a frantic player doesn't flood the socket. Low risk.
  - **Pointer event double-fire:** ensure target `onPointerDown` `stopPropagation` so one tap isn't counted as both a hit and a playfield miss.
  - **Tie granularity:** float accuracy comparison for ties — compare the raw ratio (or compare `hits*otherClicks` cross-multiplied) consistently in both `getResults` sort and the tie check to avoid `0.6666 !== 0.6667` false-distinct placements. Using the same `accuracy` number for both sort and tie test (as written) avoids this.
- **Dependencies:** **none.** Does **not** depend on the Pairing Engine (it's natively N-player parallel, not 1v1) or the Drawing Canvas. Only depends on already-existing infra: `BaseGame`, the orchestration's generic `setOnStateChange`/`GAME_ACTION` loop, `Scorer`, `PlayerName`, `useSound`, `useScreenShake`.

---

## 14. Open questions

1. **Miss representation:** two equally valid encodings — (a) a dedicated `{ type: 'miss' }` action, or (b) fold misses into `shoot` and treat a non-matching/absent `targetId` as a miss. Spec defaults to **(a)** for clarity; pick one and document it in the engine. *(Low stakes — implementer's call.)*
2. **Per-target expiry?** Baseline has **no** expiry (a target lives until hit; slow players just score fewer). An optional expiry (e.g. target auto-despawns after ~1.5s and respawns elsewhere, counting as an implicit miss) would add pressure but requires a per-player timer set that must each `_emitChange()`. Recommend **shipping without it** (YAGNI) and adding later if playtesting feels too easy.
3. **Difficulty curve:** should target radius shrink over the 25s (ramp difficulty), or stay uniformly random `0.04..0.10`? Spec uses uniform random for simplicity. A time-based shrink is a nice-to-have, not required for v1.
4. **SFX:** reuse an existing `playSound` name for hits, or add dedicated `aimHit`/`aimMiss` tones to `SoundEngine.js`? Cosmetic; reuse is fine for v1.

Otherwise: **none blocking.**
