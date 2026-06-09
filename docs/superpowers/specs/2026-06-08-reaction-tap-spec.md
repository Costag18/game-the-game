# Reaction Tap — Implementation Spec

Slug: `reaction-tap` · id: `reactionTap` · Type: SIMULTANEOUS reflex · Players: 2-8 · Date: 2026-06-08

This spec is build-ready against the v2.7.0 BaseGame leave contract. It follows the
patterns of `RockPaperScissors.js` (simultaneous, per-round) and `SpotTheDifference.js`
(timer-driven broadcast via `setOnStateChange`/`_emitChange`). The defining trait of
Reaction Tap is that **state advances are driven by server timers**, not by player
input — the GO signal fires from a `setTimeout`, so every timer callback MUST call
`_emitChange()` (and re-check `isComplete()` upstream) or clients hang on the "Wait"
screen forever.

---

## 1 Overview

- **Name / title:** "Reaction Tap"
- **id:** `reactionTap`
- **Players:** 2-8 (`minPlayers: 2`, `maxPlayers: 8`)
- **Type:** Simultaneous reflex / reaction-time.
- **Length:** 5 rounds (`TOTAL_ROUNDS = 5`).
- **Goal:** Lowest cumulative reaction time wins. Each round, players wait on a red
  "WAIT" screen; after a server-chosen random delay (1.5-5s) the screen turns green
  ("GO!"). The first input after GO records the player's reaction time in ms. Lower
  total across 5 rounds = better.
- **Title font:** `'Black Ops One'` (primary). Fallback / alt: `'Wallpoet'`. Loaded via
  Google Fonts, applied only to the game title and the big WAIT/GO words.
- **One-line description:** "Wait for green, then tap. Fastest reflexes win."

---

## 2 Tournament fit

The tournament calls `getResults()` once per round and feeds the returned `placement`
values into `Scorer.calculateRoundScores(...)` (see `Scorer.js` line 42 — it reads
`r.placement` per player and honors ties). Therefore:

- **Ranks ALL N players (2-8):** `getResults()` maps over `this.players` (the full
  roster), never a filtered list. Every entry has `{ playerId, placement, ... }`.
- **Lower total is better:** sort ascending by `totalMs` (sum of per-round ms scores).
- **Ties share placement:** use the canonical pattern —
  `let placement = 1; if (i > 0 && totalMs > prev.totalMs) placement = i + 1;`
  Two players with identical totals get the same placement number; `Scorer` applies the
  same `PLACEMENT_MULTIPLIERS` index (`[1.0, 0.7, 0.5, 0.35, 0.25, 0.15]`) to both.
- A player who left mid-game and was auto-maxed still appears in results (they stay in
  `this.players`; only fully-removed leavers via `removePlayer` are pruned — see §9).

---

## 3 FSM

States: `waiting`, `arming`, `go`, `roundEnd`, `finished`.

`arming` = red "WAIT" screen (random delay counting down server-side, hidden duration).
`go` = green screen, accepting taps. `roundEnd` = per-round results / leaderboard.

### State × action → next state

| State      | Trigger (action / timer)                  | Next state | Notes |
|------------|-------------------------------------------|------------|-------|
| `waiting`  | `start` (startGame)                       | `arming`   | onEnterArming arms the random GO timer |
| `arming`   | timer: random 1.5-5s elapses (`fire`)     | `go`       | onEnterGo records `goTime`, `_emitChange()` |
| `arming`   | action `tap` from a player (jump-the-gun) | `arming`   | stays; records FOUL for that player, no transition |
| `go`       | all live players have a result (`endRound`)| `roundEnd`| early end when everyone tapped/fouled |
| `go`       | timer: cutoff ~3s after goTime (`endRound`)| `roundEnd`| non-tappers get max penalty |
| `roundEnd` | all ack'd OR ack timer (`nextRound`)      | `arming`   | not final round |
| `roundEnd` | all ack'd OR ack timer (`finish`)         | `finished` | final round (round 5) |

### `fsmConfig`

```js
super(players, {
  states: ['waiting', 'arming', 'go', 'roundEnd', 'finished'],
  initialState: 'waiting',
  transitions: {
    waiting:  { start: 'arming' },
    arming:   { fire: 'go' },
    go:       { endRound: 'roundEnd' },
    roundEnd: { nextRound: 'arming', finish: 'finished' },
  },
});
```

### onEnter hooks (BaseGame auto-calls `onEnter<State>` after transition)

- **`onEnterArming()`** — increment `this.round`; reset `this.results = {}`, `this.acknowledged = new Set()`; pick `this.armDelayMs = 1500 + Math.random()*3500`; set `this.goTime = null`; start the **arm timer** (`_armTimer`) that, after `armDelayMs`, guards `state === 'arming'`, calls `transition('fire')` then `_emitChange()`.
- **`onEnterGo()`** — set `this.goTime = Date.now()`; clear `_armTimer`; start the **cutoff timer** (`_cutoffTimer`, `GO_CUTOFF_MS ≈ 3000`) that, on `state === 'go'`, auto-resolves non-tappers to max and calls `_endRound()` + `_emitChange()`.
- **`onEnterRoundEnd()`** — clear arm/cutoff timers; push to `this.roundHistory`; start the **ack timer** (`_ackTimer`, 10000ms) that force-acks everyone, advances, and `_emitChange()`.
- **`onEnterFinished()`** — clear all timers (defensive).

Note: hooks may also be invoked manually from `_startRound()` for clarity, but keeping
logic inside hooks means `transition()` drives everything consistently.

---

## 4 Server state (fields)

File: `server/src/games/ReactionTap.js`, `class ReactionTap extends BaseGame`.

| Field | Type | Meaning |
|-------|------|---------|
| `this.players` | string[] | full roster (from BaseGame); results rank these |
| `this.round` | number | current round, 1-indexed; starts 0, incremented in onEnterArming |
| `this.totalRounds` | number | `TOTAL_ROUNDS = 5` |
| `this.goTime` | number\|null | `Date.now()` when GO fired this round (server clock) |
| `this.armDelayMs` | number | this round's random WAIT duration (NOT sent to clients) |
| `this.results` | object | per-round map `{ [playerId]: { ms, foul, missed } }` for current round |
| `this.totals` | object | `{ [playerId]: cumulativeMs }` across all rounds |
| `this.roundHistory` | array | `[{ round, results: {...} }]` for reveal/debug |
| `this.acknowledged` | Set | playerIds who ack'd current `roundEnd` |
| `this._armTimer` | Timeout\|null | fires the GO signal |
| `this._cutoffTimer` | Timeout\|null | ends the round ~3s after GO |
| `this._ackTimer` | Timeout\|null | force-advance past `roundEnd` after 10s |
| `this._onStateChange` | fn\|null | broadcast callback registered by index.js |

Constants (top of file):

```js
const TOTAL_ROUNDS   = 5;
const ARM_MIN_MS     = 1500;
const ARM_MAX_MS     = 5000;   // server delay 1.5–5s before GO
const GO_CUTOFF_MS   = 3000;   // window to tap after GO; non-tappers maxed
const ACK_TIMEOUT_MS = 10000;  // roundEnd auto-advance
const FOUL_MS        = 3000;   // penalty for tapping before GO (jump-the-gun)
const MISS_MS        = 3000;   // penalty for not tapping within cutoff
const MAX_MS         = 3000;   // any single-round score is clamped to this max
```

Rationale: `FOUL_MS`, `MISS_MS`, and the clamp all equal `MAX_MS` so the worst a player
can do in a round equals a 3000ms reaction — consistent, never NaN/Infinity, and a real
reaction is always strictly better than missing or fouling.

---

## 5 Actions (`handleAction(playerId, action)`)

Guard first: `if (!this.players.includes(playerId)) return;`

### `tap` (the only player action)

- **Payload:** `{ type: 'tap' }`. No client timestamp is read — the server uses its own
  receive time. **Latency caveat (see §7):** client→server network latency is included
  in the measured ms; this is acknowledged as a fairness limitation, identical for the
  whole player population in spirit but not per-packet. We deliberately do NOT trust any
  `action.clientTime` even if present.
- **Validation / effects by state:**

| State | `tap` effect |
|-------|--------------|
| `arming` | **FOUL** — `this.results[playerId] = { ms: FOUL_MS, foul: true, missed: false }`. Do NOT transition. If this completes all live players' results early, still wait for GO is impossible (we're pre-GO) — fouls are final for the round, so check `_maybeEndRoundEarly()` only after GO; here just record. Idempotent: if a result already exists for this player this round, ignore. |
| `go` | **VALID TAP** — if `this.results[playerId]` already set, ignore (one tap per round). Else `ms = Math.min(Date.now() - this.goTime, MAX_MS)`; `this.results[playerId] = { ms, foul: false, missed: false }`. Then `_maybeEndRoundEarly()`. |
| `roundEnd` | treat as implicit `acknowledge` (mobile users tap to continue): `this.acknowledged.add(playerId)`; if all live players ack'd → advance. |
| `waiting` / `finished` | ignore. |

### `acknowledge` (roundEnd only)

- **Payload:** `{ type: 'acknowledge' }`.
- **Effect:** `this.acknowledged.add(playerId)`; if `this.players.every(p => this.acknowledged.has(p))` → clear `_ackTimer`, advance (`nextRound` or `finish`). Mirrors RPS/Spot ack flow.

### `ping` (client safety net)

- If client's local timer hits 0 (cutoff) but no new state arrived, it sends
  `{ type: 'ping' }`. Server: if `state === 'go'` and `Date.now() >= goTime + GO_CUTOFF_MS`,
  run `_endRound()`. If `state === 'arming'` and `Date.now() >= armStart + armDelayMs`,
  run `transition('fire')`. Always falls through so index.js broadcasts fresh state.

**No turn guards** — this is simultaneous; there is no `currentTurnPlayer`. Every live
player may act independently each round.

### Helper: `_maybeEndRoundEarly()`

```js
_maybeEndRoundEarly() {
  if (this.state !== 'go') return;
  const allDone = this.players.every(p => this.results[p] !== undefined);
  if (allDone) this._endRound();   // emits via the caller (handleAction broadcast)
}
```

### Helper: `_endRound()` (guarded, idempotent)

```js
_endRound() {
  if (this.state !== 'go') return;               // guard double-call
  this._clearTimers();
  for (const p of this.players) {                // non-tappers → MISS
    if (this.results[p] === undefined) {
      this.results[p] = { ms: MISS_MS, foul: false, missed: true };
    }
    this.totals[p] = (this.totals[p] || 0) + this.results[p].ms;
  }
  this.roundHistory.push({ round: this.round, results: { ...this.results } });
  this.transition('endRound');                   // → roundEnd, onEnterRoundEnd starts ack timer
}
```

---

## 6 `getStateForPlayer(playerId)`

Hidden-info rules: during `arming` the remaining WAIT time and `armDelayMs` are NEVER
sent (that's the whole game — players must not predict GO). During `go`, do not reveal
other players' exact ms until the round resolves; only reveal `hasTapped`. Full per-round
results are revealed in `roundEnd` / `finished`.

```js
getStateForPlayer(playerId) {
  const revealing = this.state === 'roundEnd' || this.state === 'finished';
  const mine = this.results[playerId] || null;

  return {
    phase: this.state,                       // 'waiting'|'arming'|'go'|'roundEnd'|'finished'
    round: this.round,
    totalRounds: this.totalRounds,
    // GO timing — client starts its own ms stopwatch from receipt of phase==='go'.
    // goTime itself is a server clock value; client uses local now() delta for display only.
    goSignaled: this.state === 'go',
    goCutoffSec: GO_CUTOFF_MS / 1000,        // for client countdown bar after GO
    // NEVER send armDelayMs or remaining wait time during 'arming'.
    myResult: mine,                          // { ms, foul, missed } | null
    hasActed: mine !== null,
    myTotalMs: this.totals[playerId] || 0,
    // Opponents: position only until reveal
    otherPlayers: this.players.filter(p => p !== playerId).map(p => ({
      playerId: p,
      hasActed: this.results[p] !== undefined,
      ms: revealing ? (this.results[p]?.ms ?? null) : null,
      foul: revealing ? !!this.results[p]?.foul : false,
      missed: revealing ? !!this.results[p]?.missed : false,
      totalMs: this.totals[p] || 0,
    })),
    // Round results table only when revealing
    roundResults: revealing
      ? this.players.map(p => ({
          playerId: p,
          ms: this.results[p]?.ms ?? MAX_MS,
          foul: !!this.results[p]?.foul,
          missed: !!this.results[p]?.missed,
        })).sort((a, b) => a.ms - b.ms)
      : null,
    totals: { ...this.totals },              // standings always visible
    acknowledged: [...(this.acknowledged || [])],
  };
}
```

---

## 7 Timers & broadcasting

`setOnStateChange` / `_emitChange` are **essential** here because two of the three state
advances (`arming → go`, `go → roundEnd` via cutoff) originate from `setTimeout`, not
from a socket action. Without broadcasting, clients sit on WAIT forever.

```js
setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }
```

`index.js` registers the callback so it (a) re-emits `GAME_STATE` per player and
(b) checks `game.isComplete()` to auto-finish the round — same wiring as
SpotTheDifference.

| Timer | Duration | Set in | On fire (guarded) |
|-------|----------|--------|-------------------|
| `_armTimer` | random `ARM_MIN_MS`-`ARM_MAX_MS` (1.5-5s) | onEnterArming | if `state==='arming'`: `transition('fire')` (→ onEnterGo sets goTime), then `_emitChange()` |
| `_cutoffTimer` | `GO_CUTOFF_MS` (~3000) | onEnterGo | if `state==='go'`: `_endRound()` (non-tappers→MISS), then `_emitChange()` |
| `_ackTimer` | `ACK_TIMEOUT_MS` (10000) | onEnterRoundEnd | if `state==='roundEnd'`: force-ack all, advance (`nextRound`/`finish`), then `_emitChange()` |

**Auto-action on timeout:** non-tappers at cutoff are assigned `MISS_MS` (max). Players
who never ack a roundEnd are force-ack'd at 10s so the round can advance.

Every `setTimeout` callback pairs with `_emitChange()` — this is the v2.7.0 contract for
timer-driven games.

### Latency caveat (document in code + instructions)

Reaction time is measured as `serverReceiveTime − goTime`, both on the server clock. This
intentionally includes the client→server network leg, so a player on a slow connection is
penalized versus a fast one. We accept this because: (1) it is unspoofable (we never trust
client timestamps), (2) it keeps the server authoritative, and (3) typical LAN/broadband
RTT (~20-80ms) is small relative to human reaction times (~250ms) and the 3000ms penalty
floor. A future improvement could subtract a measured per-socket RTT/2, but is out of
scope for v1. This caveat is noted in the gameList `instructions[]`.

---

## 8 Scoring & `getResults`

- **Per-round ms score:** valid tap = `min(Date.now()-goTime, MAX_MS)`; FOUL (pre-GO) =
  `FOUL_MS`; MISS (no tap by cutoff) = `MISS_MS`. All ≤ `MAX_MS = 3000`.
- **Cumulative:** `this.totals[p]` = sum of the 5 rounds' ms. **Lower is better.**
- **getResults** sorts ascending by `totalMs`, assigns dense placement with ties:

```js
getResults() {
  const entries = this.players.map(p => ({
    playerId: p,
    totalMs: this.totals[p] || 0,
    fouls: this.roundHistory.filter(r => r.results[p]?.foul).length,
  }));
  entries.sort((a, b) => a.totalMs - b.totalMs);   // ascending: fastest first
  let placement = 1;
  return entries.map((e, i) => {
    if (i > 0 && e.totalMs > entries[i - 1].totalMs) placement = i + 1;
    return {
      playerId: e.playerId,
      placement,
      totalMs: e.totalMs,
      handDescription: `${(e.totalMs / 1000).toFixed(2)}s total`,
    };
  });
}
```

- **Tie rule:** identical `totalMs` → identical `placement` (Scorer honors it). Tie-break
  is intentionally NOT applied (no fractional placements); two equally-fast players share
  the rank, matching every other game in this codebase.

`isComplete() { return this.state === 'finished'; }`

---

## 9 Leave & deadlock handling

This is a simultaneous game, so the v2.7.0 contract requires auto-submitting for leavers
so the round never waits on someone who is gone. Concrete overrides:

### `removePlayer(playerId)` — player left entirely (disconnect / leave lobby)

```js
removePlayer(playerId) {
  super.removePlayer(playerId);      // prunes this.players + activePlayers
  delete this.results[playerId];     // their pending result no longer blocks the round
  delete this.totals[playerId];      // they are gone from standings & getResults
  if (this.acknowledged) this.acknowledged.delete(playerId);

  // <=1 remaining → orchestration force-finishes; stop our timers, finish cleanly.
  if (this.players.length <= 1) {
    this._clearTimers();
    if (this.state !== 'finished') this.state = 'finished';
    return;
  }

  // Re-check phase completion now that we no longer wait on the leaver:
  if (this.state === 'go') {
    this._maybeEndRoundEarly();      // maybe everyone left has now tapped
  } else if (this.state === 'roundEnd') {
    if (this.players.every(p => this.acknowledged.has(p))) {
      this._clearTimers();
      if (this.round >= this.totalRounds) this.transition('finish');
      else this.transition('nextRound');
    }
  }
  // arming: nothing to do — GO timer still pending for remaining players.
}
```

Note: because `super.removePlayer` deletes them from `this.players`, the leaver is NOT
auto-maxed in *future* rounds — they simply vanish from results, which is correct for a
full leave. (The brief's "auto-max missed rounds" applies to a *temporary* non-tapper /
disconnect-without-removal, which is the MISS_MS path in `_endRound`. A player who is
fully removed exits the standings.)

### `_removeFromActive(playerId)` — inherited; not used here

Reaction Tap has no per-turn rotation, so there is no in-game "elimination" concept. We do
not call `_removeFromActive` directly; `super.removePlayer` already invokes it to keep
`activePlayers` consistent. No game-specific elimination path exists.

### `destroy()`

```js
destroy() { this._clearTimers(); this._onStateChange = null; }
_clearTimers() {
  for (const k of ['_armTimer','_cutoffTimer','_ackTimer']) {
    if (this[k]) { clearTimeout(this[k]); this[k] = null; }
  }
}
```

### What if the current/last-needed player leaves, per phase

| Phase | Who leaves | Result |
|-------|-----------|--------|
| `arming` | anyone | GO timer keeps running for the rest; no deadlock. If ≤1 remains → finish. |
| `go` | the last player who hadn't tapped | `_maybeEndRoundEarly()` fires → round resolves immediately; survivors keep ms, leaver pruned. |
| `roundEnd` | the last player who hadn't ack'd | ack check passes → advances (nextRound/finish) without waiting; ack timer also covers it. |
| any | down to 1 player | `_clearTimers()` + `state='finished'`; orchestration ends round with sole player ranked 1st. |

All deadlock surfaces (GO never fires, cutoff never ends, ack never completes) are covered
by the three server timers AND the leave re-checks AND the client `ping` safety net.

---

## 10 Client component

Files: `client/src/games/ReactionTap.jsx` + `ReactionTap.module.css`.
Props (App.jsx contract): `gameState`, `nicknames`, `avatars`, `onAction`.
Use `PlayerName` for all name rendering, `useSound()` for audio, `useScreenShake()` for shake.

### Per-phase screens

- **`waiting`** — brief "Get ready..." splash with the title in `'Black Ops One'`. Auto
  flows to arming server-side; mostly a flash.
- **`arming` (RED "WAIT"):** full-area solid red panel, huge centered word **"WAIT"** in
  the title font, subtext "Don't tap yet!". The ENTIRE panel is the tap target. Tapping
  here emits `{ type: 'tap' }` → server records a FOUL; client immediately shows a red
  "TOO SOON! 😬" flash for that player and `playSound('lose')` + `shake('light')`. No
  countdown shown (the wait is hidden by design).
- **`go` (GREEN "GO!"):** panel flips to bright green, giant **"GO! TAP NOW"**. On first
  tap emit `{ type: 'tap' }`, capture local `performance.now()` only for an instant
  on-screen "your reaction: 312ms" estimate (display-only; authoritative ms comes from
  server in roundResults). `playSound('coin')` + `shake('light')` on tap. A thin shrinking
  bar shows the `goCutoffSec` window. If `gameState.hasActed` already true, show "Tapped —
  waiting for others ⏳".
- **`roundEnd`:** results table sorted by ms (from `gameState.roundResults`), each row =
  `<PlayerName>` + `{ms}ms` or "FOUL" / "MISSED" badges; show running `totals`. "Round N/5"
  header. A "Continue" button (and tap-anywhere) emits `{ type: 'acknowledge' }`. Auto
  advances at 10s. `playSound('roundWin')` for the round's fastest if it's me.
- **`finished`:** brief standings flash (engine hands off to the tournament Results screen).

### Layout & touch

- Single full-area reactive panel that swaps background color — the dominant visual is the
  color flip (red→green), which is the classic reaction-test affordance and reads instantly
  on touch devices.
- The whole panel is a `<button>`/`onPointerDown` target (use `pointerdown`, not `click`,
  to shave latency — fire on first contact). Prevent double-fire with `gameState.hasActed`.
- Respect `.gameMainArea` sizing (desktop `margin-left: 220px` for pet sidebar; use `calc`).
- Big touch targets, no hover dependency. Disable text selection on the panel.

### gameState reads / actions emitted

- Reads: `phase`, `round`, `totalRounds`, `goSignaled`, `goCutoffSec`, `myResult`,
  `hasActed`, `myTotalMs`, `roundResults`, `totals`, `otherPlayers`.
- Emits via `onAction`: `{ type: 'tap' }`, `{ type: 'acknowledge' }`, `{ type: 'ping' }`
  (the last only if a local cutoff timer expires without a server update).
- Sound/shake: tap = `coin` + light shake; foul = `lose` + light shake; my round-fastest =
  `roundWin`. Keep it subtle per the master-gain convention.

---

## 11 Registration checklist (8 steps)

1. **`server/src/games/ReactionTap.js`** — `export class ReactionTap extends BaseGame`
   implementing the FSM/§4-9 above, with `setOnStateChange`/`_emitChange`, `removePlayer`,
   `destroy`, `getResults`.

2. **`shared/gameList.js`** — add to `GAMES`:

```js
reactionTap: {
  id: 'reactionTap', name: 'Reaction Tap', minPlayers: 2, maxPlayers: 8,
  turnTimer: TIMERS.REACTION_TAP,
  description: 'Wait for green, then tap. Fastest reflexes win.',
  instructions: [
    'Each round shows a red WAIT screen. Do NOT tap while it is red.',
    'After a random delay (1.5–5s) the screen turns green and says GO — tap as fast as you can.',
    'Tapping while red is a foul (max 3000ms penalty). Not tapping in time also scores the max.',
    'Your reaction time in milliseconds is recorded by the server (lower is better).',
    'Play 5 rounds; the lowest total reaction time across all rounds wins.',
    'Note: your network latency is included in the measured time — the server times your tap on its own clock and never trusts the browser, so results are spoof-proof but slightly favor faster connections.',
  ],
},
```

3. **`shared/constants.js`** — add timer (cutoff window is the natural per-action timer):

```js
// inside TIMERS:
REACTION_TAP: 3,   // seconds: GO cutoff window (matches GO_CUTOFF_MS)
```

4. **`server/src/games/registry.js`** — `import { ReactionTap } from './ReactionTap.js';`
   then `registerGame('reactionTap', ReactionTap);` (match the existing registry call
   signature in that file).

5. **`client/src/games/ReactionTap.jsx`** + **`ReactionTap.module.css`** — component per
   §10 (props `gameState`/`nicknames`/`avatars`/`onAction`; `PlayerName`; `useSound()`;
   title font `'Black Ops One'` / `'Wallpoet'`; touch via `pointerdown`).

6. **`client/src/assets/gamepreviews/reactionTap.png`** — preview image (red/green split
   with a lightning/tap motif).

7. **`client/src/App.jsx`** — import and add to `GAME_COMPONENTS`:
   `import ReactionTap from './games/ReactionTap.jsx';` →
   `GAME_COMPONENTS = { ..., reactionTap: ReactionTap }`.

8. **`client/src/screens/GameVote.jsx`** — import preview and add to `GAME_PREVIEWS`:
   `import reactionTapPreview from '../assets/gamepreviews/reactionTap.png';` →
   `GAME_PREVIEWS = { ..., reactionTap: reactionTapPreview }`.

Plus standard project hygiene: bump `shared/version.js` (minor — new feature), add a row
to the Mini-Games table + Fonts table in `CLAUDE.md`, commit, push, tell the user the new
version.

---

## 12 Edge cases & test scenarios

Leave/deadlock harness assertions (Node test against the engine, like existing games):

1. **All ranked every round:** with N=2..8, after 5 rounds `getResults().length === N` and
   every entry has a numeric `placement` and `totalMs`.
2. **Ascending order:** results are sorted so `placement 1` has the smallest `totalMs`.
3. **Tie shares placement:** two players forced to identical totals → identical placement;
   third player gets `placement 3` (dense ranking on value, not index).
4. **GO timer fires:** start a round, advance fake timers by `armDelayMs`; assert
   `state === 'go'`, `goTime !== null`, and `_emitChange` was called once.
5. **Cutoff maxes non-tappers:** in `go`, one player taps, advance timers by
   `GO_CUTOFF_MS`; assert state `roundEnd`, the non-tapper's round result `missed:true`,
   `ms === MISS_MS`, and `_emitChange` fired.
6. **Foul:** tap during `arming` → result `foul:true`, `ms === FOUL_MS`, state still
   `arming`; a second tap that round is ignored.
7. **Early end:** all live players tap in `go` → `_endRound` runs immediately without
   waiting for cutoff.
8. **Leave in `go` (last non-tapper):** the one player who hadn't tapped leaves →
   `removePlayer` → round resolves immediately, survivors keep ms, leaver absent from
   `getResults`.
9. **Leave in `roundEnd` (last non-ack):** the only un-ack'd player leaves → advances to
   next round / finished without hanging.
10. **Down to 1 player:** removing players until one remains → `state === 'finished'`, no
    pending timers (`_armTimer/_cutoffTimer/_ackTimer` all null), sole player placement 1.
11. **destroy() clears timers:** after `destroy()`, all three timer handles are null and no
    `_emitChange` fires afterward (orphan-timer guard).
12. **Idempotent endRound:** calling `_endRound()` twice (cutoff timer + a stray ping) only
    pushes one `roundHistory` entry and only adds totals once (state guard).
13. **No hidden leak:** in `arming`/`go`, `getStateForPlayer` returns no `armDelayMs`, no
    remaining-wait, and opponents' `ms` is null until `roundEnd`.
14. **Ping safety net:** simulate cutoff elapsed but timer suppressed; a `ping` action in
    `go` triggers `_endRound`.

---

## 13 Effort & risks

- **Server engine:** **S-M**. Mechanically simpler than RPS (no win-matrix) but the
  timer choreography (arm → cutoff → ack, each pairing `_emitChange`) is the part to get
  right. Closely mirrors SpotTheDifference's timer structure — reuse that shape.
- **Client component:** **S**. Single color-flipping panel + results table; no card-deal
  or grid rendering. The latency-sensitive `pointerdown` handling is the only nuance.
- **Integration/registration:** **S**. The standard 8-step wiring.
- **Deps:** none new. No external API, no new fonts beyond Google Fonts `Black Ops One`
  (already used by RPS) and `Wallpoet`. Uses existing `useSound`, `useScreenShake`,
  `PlayerName`, `setOnStateChange` plumbing in `index.js`.
- **Risks:** (1) orphaned timers double-completing a round — mitigated by state guards +
  `destroy()` + the `<=1` early finish in `removePlayer` (the exact bug SpotTheDifference
  documents). (2) Network latency unfairness — documented, accepted for v1. (3) Forgetting
  `_emitChange()` in any timer callback → clients stuck on WAIT; covered by tests 4-5.

---

## 14 Open questions

1. **Cutoff length:** is 3000ms the right tap window after GO? Long enough for slow
   connections, short enough to keep rounds snappy. Tunable via `GO_CUTOFF_MS`.
2. **Penalty value:** should FOUL be *worse* than MISS (e.g. FOUL_MS = 4000) to punish
   jumping the gun harder than passivity? Current spec sets both = MAX_MS = 3000 for
   simplicity; trivial to split.
3. **Best-of vs total:** total-ms is specified. Should we instead award per-round placement
   points (like RPS wins) and rank by points won? Total-ms is more "true reflex" but a
   single fat-fingered foul hurts a lot — confirm with owner.
4. **Multiple taps / spam:** spec ignores taps after the first per round. Should rapid
   re-taps in `arming` stack penalties, or is one foul per round (current) fine?
5. **Latency compensation:** worth subtracting a measured per-socket RTT/2 in a later
   version, or keep the simple unspoofable model permanently?
6. **Round count:** 5 rounds confirmed? RPS and the timer games vary (RPS 5, Spot 3).
7. **Preview art:** generate the `reactionTap.png` via the project's AI image flow or
   hand-make a red/green split — owner preference.
