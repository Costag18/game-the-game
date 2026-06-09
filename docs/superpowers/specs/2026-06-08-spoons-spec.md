# Spoons — Implementation Spec

> Real-time grab-race card game. The HIGHEST Tier-1 complexity game in the platform.
> Server-authoritative pass model + a tap-to-grab race with hard concurrency requirements.
> Read the "Risks" section (13) BEFORE coding — the pass-queue + grab-lock are the load-bearing parts.

---

## 1 Overview

| Field | Value |
|-------|-------|
| **id / slug** | `spoons` |
| **Players** | 3–8 (needs ≥3 so first-round elimination still leaves a playable game) |
| **Type** | REAL-TIME, server-authoritative continuous pass + simultaneous grab race, **internal elimination rounds** |
| **Length** | One "round" of the tournament = a full Spoons match of (N−1) elimination rounds until 1 player remains |
| **Title font** | **Bangers** (primary) / Luckiest Guy (fallback) |
| **Mechanic** | Each elimination round every surviving player holds **4 cards**. There are **(survivors − 1) spoons**. Cards flow through a server-authoritative per-player incoming queue fed by the draw pile (dealer/first seat) and neighbor discards. First player to assemble **4-of-a-kind (matching rank)** triggers the GRAB phase; all race to tap a spoon; the one who fails to grab one is eliminated. |
| **Placement** | Reverse elimination order: first eliminated = last place; last survivor = 1st. |

This game does NOT use per-tournament-round scoring inside itself — it produces a single ranking of all N players via reverse-elimination order, handed to the Scorer once.

---

## 2 Tournament fit

`getResults()` MUST return an entry for **every** player passed to the constructor (3–8), each with `{ playerId, placement, ... }`, sorted by rank ascending. The Scorer (`server/src/tournament/Scorer.js`) reads `gameResults[].placement` and applies `SCORING.PLACEMENT_MULTIPLIERS = [1.0, 0.7, 0.5, 0.35, 0.25, 0.15]` (6+ all clamp to 0.15).

- **Ranking source:** an `eliminationOrder` array (first eliminated at index 0). Placement = `N − indexOf(playerId)`; the lone survivor gets placement 1.
- **Ties:** Spoons produces **no ties under normal play** — exactly one player is eliminated per round, in a strict order, so every player gets a unique placement. The ONE tie case is **simultaneous mid-round leaves** (two players leave in the same tick before any grab): both are appended to `eliminationOrder` in leave order, so they still get distinct placements. We never assign the same placement number. (If a future variant could co-eliminate, follow the `let placement = 1; if (i>0 && rankKey<prev) placement = i+1;` pattern — not needed here.)

---

## 3 FSM (state × action → next)

States: `waiting`, `passing`, `grab`, `roundEnd`, `finished`.

`passing` is the continuous real-time phase (no per-turn lock — all survivors can `takeAndDiscard` concurrently). `grab` is the race. `roundEnd` is a short reveal/ack of who was eliminated before re-dealing or finishing.

| State \ action (transition name) | `start` | `grabOpen` | `resolveGrab` | `next` | `finish` |
|---|---|---|---|---|---|
| **waiting** | → passing | — | — | — | — |
| **passing** | — | → grab | — | — | → finished* |
| **grab** | — | — | → roundEnd | — | → finished* |
| **roundEnd** | — | — | — | → passing | → finished |
| **finished** | — | — | — | — | — |

`*` direct `passing→finished` / `grab→finished` only via the leave path when ≤1 player remains (hard end). Normal flow always routes through `roundEnd`.

**onEnter hooks** (named `onEnter<State>` so BaseGame.transition auto-invokes):

- `onEnterPassing()` — clear grab/elim state, ensure each survivor holds 4 cards, seed each player's `incoming` queue, set `roundActive=true`, start the **idle/safety timer**, `_emitChange()`.
- `onEnterGrab()` — snapshot `grabbers={}`, set `spoonsRemaining = survivors.length − 1`, record `grabTriggeredBy`, **start the grab-window timer**, `_emitChange()`. (Triggered by a player event — see §7.)
- `onEnterRoundEnd()` — compute the eliminated player, append to `eliminationOrder`, `_removeFromActive(elimId)`, build `lastRoundSummary`, reset `acknowledged=new Set()`, start the **roundEnd ack timer**, `_emitChange()`.
- `onEnterFinished()` — clear all timers (`destroy()` semantics), set winner.

---

## 4 Server state (fields on the class)

```text
this.players          // string[]  master roster (all N) — never reorder; drives getResults
this.survivors        // string[]  still-in-the-game, in SEAT ORDER (the pass ring)
this.eliminationOrder // string[]  index 0 = first eliminated (worst placement)
this.roundNumber      // int        1..(N-1)

// --- pass model (the hard part) ---
this.hands            // { [pid]: card[] }  exactly 4 while round is live (5 transiently mid-action)
this.incoming         // { [pid]: card[] }  FIFO queue of cards waiting to be picked up
this.drawPile         // card[]             feeds the FIRST seat's incoming
this.dealerId         // pid                survivors[0] for the round; pulls from drawPile
this.passSeq          // int                monotonically incrementing op counter (ordering/debug)

// --- grab race ---
this.grabbers         // { [pid]: { ts, seq } }  who has grabbed, in arrival order
this.spoonsRemaining  // int
this.grabTriggeredBy  // pid    who hit 4-of-a-kind (immune from elimination)
this.grabOpenSeq      // int    seq value at the instant grab opened (for race auditing)

// --- bookkeeping ---
this.acknowledged     // Set<pid>   roundEnd acks
this.lastRoundSummary // { eliminated, grabTriggeredBy, fourOfAKindRank, grabbers, spoonsRemaining }
this.roundActive      // bool

// --- timers (cleared in destroy) ---
this._idleTimer       // safety timer in passing
this._grabTimer       // grab-window
this._ackTimer        // roundEnd auto-advance
this._onStateChange   // broadcast cb
```

**Card shape:** `{ rank: '2'..'A', suit: '♠♥♦♣', id: 'AS' }`. Only **rank** matters for 4-of-a-kind; suits are cosmetic and make duplicate ranks visually distinct. Deck = the 4 suits of `(survivors+1)` distinct ranks, shuffled (see §5 deal). Use `server/src/utils/` Deck/shuffle helpers.

---

## 5 Actions (`handleAction(playerId, action)`)

Guard top of method: `if (!this.survivors.includes(playerId)) return;` (eliminated/left players cannot act). Then switch on `this.state`.

### 5.1 `takeAndDiscard` — only in `state === 'passing'`

**Payload:** `{ type: 'takeAndDiscard', cardIndex }` — `cardIndex` is the index in the player's CURRENT 5-card hand of the card they choose to discard (after auto-picking up the head of their `incoming`). Real-time: any survivor may send this at any time; processed in server arrival order (Socket.IO is single-threaded per process, so handler bodies are atomic — no locks needed for the queue mutation itself).

**Validation:**
1. `state === 'passing'` and `roundActive` — else return (ignore late actions after grab opened; client may still have stale UI).
2. The player must have a pending card to pick up: `this.incoming[playerId].length > 0` **OR** (player is `dealerId` AND `drawPile.length > 0`). If nothing to pick up, return (they can't pass air).
3. After pickup their hand is length 5; `cardIndex` must be `0..4`. Clamp/reject out-of-range.

**Effects (atomic body):**
1. **Pick up:** `card = incoming[playerId].shift()` (or for dealer, if incoming empty, `drawPile.shift()`). Push into `hands[playerId]` → hand now length 5. `passSeq++`.
2. **Check 4-of-a-kind BEFORE discard?** No — check AFTER the player chooses what to keep. Player discards `hands[playerId].splice(cardIndex,1)[0]` → hand back to 4.
3. **Win check:** if the remaining 4 cards share a rank → this player triggers grab. Call `_openGrab(playerId, rank)` (transitions `passing→grab`). Do NOT enqueue the discard in that case — the round freezes the instant grab opens.
4. **Otherwise pass the discard** to the next seat's `incoming`: `this.incoming[ nextSeat(playerId) ].push(discard)`. `nextSeat` = next entry in `survivors` ring (wrap). The dealer is the only one who also draws from `drawPile`; the last seat's discards go into a `trash` sink that the dealer reshuffles from when `drawPile` empties (keeps cards flowing forever; never run dry while ≥1 four-of-a-kind is impossible).
5. `_emitChange()` + reset idle timer.

**Concurrency note:** because each handler invocation runs to completion before the next (Node event loop), the "pick head of incoming, mutate hand, push to neighbor" sequence is already a critical section. The only true race is the **grab open** (two players could each complete a four-of-a-kind in back-to-back ticks) — resolved deterministically: the FIRST handler to call `_openGrab` wins; the second sees `state !== 'passing'` in its guard and its action is ignored, so its discard is dropped. That player is NOT the trigger but is fully eligible to grab.

### 5.2 `grab` — only in `state === 'grab'`

**Payload:** `{ type: 'grab' }`.

**Validation:** `state === 'grab'`, player is a survivor, player hasn't already grabbed (`!grabbers[playerId]`), and `spoonsRemaining > 0`.

**Effects (atomic):**
1. Record `grabbers[playerId] = { ts: Date.now(), seq: ++this.passSeq }`. The first `spoonsRemaining` players to reach this line get a spoon — but we don't decrement per-grab; instead we count at resolution. (Recording every grab with a strictly increasing `seq` makes ordering deterministic regardless of timestamp collisions.)
2. If `Object.keys(grabbers).length >= survivors.length - 1` → everyone who can grab has grabbed; the loser is the one survivor (other than nobody-special) NOT in `grabbers`. Transition `grab→roundEnd` via `_resolveGrab()`.
3. `_emitChange()`.

**Race handling for grab:** order is determined by `seq` (server arrival), not client `ts`. The grabbers sorted by `seq` ascending; the first `(survivors−1)` keep spoons; the **single** survivor with no spoon is eliminated. Since there are exactly `survivors−1` spoons and `survivors` players, exactly one is left out. The trigger player (`grabTriggeredBy`) is immune in the sense that they almost always grab first, but they are NOT auto-saved — if they somehow fumble (e.g. they leave), normal resolution applies.

### 5.3 `acknowledge` — only in `state === 'roundEnd'`

**Payload:** `{ type: 'acknowledge' }`. Adds to `acknowledged`; when all survivors+eliminated-this-round have acked (or ack timer fires) → `_advanceAfterRound()` which either `next` (re-deal next elimination round) or `finish`.

### 5.4 `ping` — keep-alive / desync recovery (any state)

Client sends `{ type: 'ping' }` when its local grab/idle timer hits 0 but no state change arrived. Server re-runs the relevant timeout check (`_onGrabTimeout` / `_onIdleTimeout` / ack check) idempotently. Guarded by state so a stale ping is a no-op.

---

## 6 `getStateForPlayer(playerId)` — shape & hidden-info rules

Return a per-player view. **Hidden-info rule:** a player sees ONLY their own hand and the COUNT (not contents) of every other player's incoming queue and hand. Never leak who is about to complete four-of-a-kind.

```js
{
  phase: this.state,                       // 'passing' | 'grab' | 'roundEnd' | 'finished'
  roundNumber, totalRounds: this.players.length - 1,
  myId: playerId,
  iAmSurvivor: this.survivors.includes(playerId),
  myHand: this.hands[playerId] ?? [],      // 4 (or 5 transiently) full card objects — ONLY mine
  myIncomingCount: this.incoming[playerId]?.length ?? 0,
  myNextCard: phase==='passing' && incoming head exists ? peek (full card) : null, // optional preview of card you'll pick up
  canTake: phase==='passing' && (myIncomingCount>0 || (isDealer && drawPile>0)),
  isDealer: this.dealerId === playerId,
  drawPileCount: this.drawPile.length,     // count only
  // ring of all survivors in seat order, opponents redacted:
  seats: this.survivors.map(p => ({
    playerId: p,
    isMe: p===playerId,
    handCount: this.hands[p]?.length ?? 0,        // count only for others
    incomingCount: this.incoming[p]?.length ?? 0, // count only
    hasGrabbed: phase!=='passing' ? !!this.grabbers[p] : false,
    eliminated: !this.survivors.includes(p),      // always false here (survivors only)
  })),
  // grab phase:
  spoonsRemaining: phase==='grab' ? this.spoonsRemaining : null,
  grabTriggeredBy: (phase==='grab'||phase==='roundEnd') ? this.grabTriggeredBy : null,
  iHaveGrabbed: !!this.grabbers[playerId],
  // round end / finished reveal:
  lastRoundSummary: (phase==='roundEnd'||phase==='finished') ? this.lastRoundSummary : null,
  eliminationOrder: phase==='finished' ? [...this.eliminationOrder] : undefined,
}
```

`lastRoundSummary` reveals the eliminated player's id, the `fourOfAKindRank`, and the full `grabbers` ordering (now safe to show). During `passing`/`grab` no opponent card contents are ever sent.

---

## 7 Timers & broadcasting

Register `setOnStateChange(cb)` / `_emitChange()` exactly like RPS/SpotTheDifference. **Every** `setTimeout` callback MUST: re-check `this.state`, do its work, then call `_emitChange()` (which broadcasts AND lets the orchestration re-check `isComplete()`).

| Timer | Field | Duration | Fires when | Auto-action on timeout |
|-------|-------|----------|-----------|------------------------|
| **Idle/safety** | `_idleTimer` | `TIMERS.SPOONS_IDLE = 25s`, reset on every `takeAndDiscard` | No pass action for the whole window during `passing` | Force-progress: the dealer auto-takes+discards a random non-matching card to keep cards flowing; if a full ring rotates with no progress, pick the dealer to auto-discard. Prevents a stalled ring deadlock. Then `_emitChange()`. |
| **Grab window** | `_grabTimer` | `TIMERS.SPOONS_GRAB = 4s` | Set in `onEnterGrab` | Auto-`grab` for every survivor who hasn't grabbed yet, **in `seq` order of their connection index** (deterministic), then `_resolveGrab()`. Guarantees the round always resolves even if humans freeze. `_emitChange()`. |
| **RoundEnd ack** | `_ackTimer` | `10s` | Set in `onEnterRoundEnd` | Force all acks, then `_advanceAfterRound()`. `_emitChange()`. |

`_openGrab(pid, rank)` is the player-event entry point: guard `if (this.state!=='passing') return;`, set `grabTriggeredBy=pid`, `fourOfAKindRank=rank`, `transition('grabOpen')` (which runs `onEnterGrab`). Then `_emitChange()` so all clients flip to the grab screen instantly.

`onEnterGrab` immediately auto-records a grab for the trigger player? **No** — the trigger must still tap (it's the fun part), but they have a head start because their client knows first. The grab timer protects against them fumbling.

---

## 8 Scoring & `getResults()`

No internal point scoring — pure ranking by reverse elimination.

```js
getResults() {
  // survivors should be length 1 at finish (the winner)
  const winner = this.survivors[0];
  // ranking: index 0 of order = first eliminated = WORST place
  const ranked = [...this.eliminationOrder, winner].reverse(); // best first
  const N = this.players.length;
  return ranked.map((playerId, i) => ({
    playerId,
    placement: i + 1,
    eliminatedRound: this.eliminationOrder.includes(playerId)
      ? this.eliminationOrder.indexOf(playerId) + 1 : null,
    survivedToEnd: playerId === winner,
    handDescription: playerId === winner ? 'Last one standing 🥄'
      : `Out round ${this.eliminationOrder.indexOf(playerId)+1}`,
  }));
}
```

**Tie rule:** none under normal play (strict elimination order ⇒ unique placements). The only path to two players sharing a tick (double-leave) still appends them in order to `eliminationOrder`, so placements stay distinct. Defensive assert in tests: `new Set(results.map(r=>r.placement)).size === results.length` and `results.length === this.players.length`.

`isComplete() { return this.state === 'finished'; }`

---

## 9 Leave & deadlock handling (v2.7.0 contract)

Two distinct paths. **`_removeFromActive(id)`** = in-game elimination (BaseGame helper: drops from `activePlayers`/turn rotation, KEEPS in `this.players` for scoring). We also maintain our own `survivors` array, so elimination = append to `eliminationOrder` + remove from `survivors` + `_removeFromActive(id)`. **`removePlayer(id)`** = player gone entirely (disconnect/leave) — prune from `survivors` too and nudge the phase forward.

```js
removePlayer(playerId) {
  super.removePlayer(playerId);            // prunes this.players + activePlayers rotation
  if (!this.survivors.includes(playerId) && !this._isGone(playerId)) return; // already out
  const wasSurvivor = this.survivors.includes(playerId);
  this.survivors = this.survivors.filter(p => p !== playerId);
  // free their queued cards back into circulation so the ring never dries up
  if (this.incoming[playerId]) { this.drawPile.push(...this.incoming[playerId]); delete this.incoming[playerId]; }
  delete this.hands[playerId];

  // <=1 survivor => game ends immediately, leaver ranked first-out
  if (this.survivors.length <= 1) {
    if (wasSurvivor && !this.eliminationOrder.includes(playerId)) this.eliminationOrder.push(playerId);
    this._clearTimers();
    if (this.state !== 'finished') this.state = 'finished';
    return;
  }

  if (this.state === 'passing') {
    // if leaver was dealer, reassign dealer to new survivors[0]; re-seed draw flow
    if (this.dealerId === playerId) this.dealerId = this.survivors[0];
    // a leave can't complete 4-of-a-kind; just continue, reset idle timer
    this._resetIdleTimer();
  } else if (this.state === 'grab') {
    // AUTO-GRAB-FAIL: treat the leaver as a non-grabber. Re-resolve:
    // there are now (survivors-1) spoons but one fewer racer — recompute who's out.
    this.spoonsRemaining = this.survivors.length - 1;
    this._maybeResolveGrabAfterLeave(playerId); // if leaver was the one without a spoon, they're the elim
  } else if (this.state === 'roundEnd') {
    this.acknowledged.add(playerId);           // auto-ack
    this._checkRoundEndComplete();
  }
  this._emitChange();
}

destroy() { this._clearTimers(); }
_clearTimers() { clearTimeout(this._idleTimer); clearTimeout(this._grabTimer); clearTimeout(this._ackTimer); }
```

**Phase-specific "what if the needed player leaves":**

- **Current dealer leaves during `passing`:** reassign `dealerId = survivors[0]`; their incoming cards spill back to `drawPile`. Ring keeps flowing.
- **Grab trigger leaves during `grab`:** they vacate; with one fewer racer the spoon math (`survivors−1` spoons, `survivors` players) self-corrects. If the leaver was destined to be the no-spoon loser, the LEAVER becomes the elimination (append to `eliminationOrder`) — a fair "you left, you're out." Otherwise resolution proceeds and the human loser is eliminated as normal.
- **Last-needed acker leaves during `roundEnd`:** auto-ack via `removePlayer`, `_checkRoundEndComplete` fires → advance.
- **Two leave in the same tick:** each `removePlayer` runs to completion sequentially; both appended to `eliminationOrder` in order; if that drops survivors to 1, game finishes with both ranked just below the winner.

**Deadlock guarantees:** idle timer (force dealer auto-discard) prevents a frozen ring; grab timer auto-grabs stragglers; ack timer auto-advances roundEnd. Every timeout calls `_emitChange()` so a torn-down instance can't strand clients, and `destroy()` clears all three.

---

## 10 Client component (`client/src/games/Spoons.jsx` + `.module.css`)

Props: `gameState`, `nicknames`, `avatars`, `onAction`. Use `PlayerName`, `useSound()`, `useScreenShake()`. Title font **Bangers** (import via Google Fonts). Full touch support — every interactive element is tap-first, no hover-only affordances.

**Per-phase screens (read `gameState.phase`):**

1. **`passing`** — central fan of `myHand` (4 cards, full). A pulsing "incoming" indicator showing `myIncomingCount` / a peek of `myNextCard`. Tapping a hand card while `canTake` is true emits `onAction({ type:'takeAndDiscard', cardIndex })` (the tapped card is the DISCARD, after auto-pickup — UI shows the picked-up card sliding into the fan first, then you tap which of 5 to throw). A ring/row of opponent seats around the edge shows each `seat.handCount` as face-down card backs + nickname/avatar + a small incoming-count badge. Idle-timer countdown bar (from `TIMERS.SPOONS_IDLE`). Sound: soft "card slide" on each pass (own and broadcast).
2. **`grab`** — **the money screen.** Huge "🥄 GRAB!" banner (Bangers, screen-shake `medium` on entry). A big tappable SPOON button per remaining spoon (or one giant button); tapping emits `onAction({ type:'grab' })`. Show `spoonsRemaining`, live `seats[].hasGrabbed` checkmarks, and `iHaveGrabbed` state (button locks once grabbed). Grab-window countdown. Trigger player highlighted ("X went for it!"). Sounds: tense sting on open, "clink" on your grab, shake `heavy` if you're the trigger.
3. **`roundEnd`** — reveal: `lastRoundSummary` shows the eliminated player (dimmed avatar + "ELIMINATED"), the `fourOfAKindRank`, and the grab order. "Continue" button emits `acknowledge`. Sound: lose sting for the eliminated viewer, neutral chime for survivors. Auto-advances on ack timer.
4. **`finished`** — final standings from `eliminationOrder` reversed (winner top, 🥄 crown). Confetti for `socket.id === winner`. This screen is brief; the tournament's Results screen takes over.

**Layout:** survivor ring adapts to count (3–8) — flex circle on desktop, vertical list on mobile. `.gameMainArea` already gets `margin-left:220px` + `width:calc(100% - 220px)` for the pet sidebar; don't override. Buttons ≥44px for touch.

**gameState reads:** `phase, myHand, canTake, myIncomingCount, myNextCard, isDealer, seats, spoonsRemaining, iHaveGrabbed, grabTriggeredBy, lastRoundSummary, roundNumber, totalRounds`.
**Actions emitted:** `takeAndDiscard{cardIndex}`, `grab`, `acknowledge`, `ping` (on local timer expiry).

---

## 11 Registration checklist (8 steps)

| # | File (absolute) | Edit |
|---|-----------------|------|
| 1 | `server\src\games\Spoons.js` | New `export class Spoons extends BaseGame` implementing all of §3–§9. |
| 2 | `shared\gameList.js` | Add `GAMES.spoons` entry (values below). |
| 3 | `shared\constants.js` | Add `TIMERS.SPOONS_IDLE = 25`, `TIMERS.SPOONS_GRAB = 4` (seconds). `turnTimer` for the lobby uses `TIMERS.SPOONS_GRAB` (shortest meaningful action window). |
| 4 | `server\src\games\registry.js` | `import { Spoons } from './Spoons.js';` + `registerGame('spoons', Spoons);` |
| 5 | `client\src\games\Spoons.jsx` + `Spoons.module.css` | New component per §10 (PlayerName, useSound, useScreenShake, Bangers font, touch). |
| 6 | `client\src\assets\gamepreviews\spoons.png` | Preview image (cards + spoons, Bangers title). |
| 7 | `client\src\App.jsx` | Import `Spoons` and add `spoons: Spoons` to `GAME_COMPONENTS`. |
| 8 | `client\src\screens\GameVote.jsx` | Import `spoons.png` and add to `GAME_PREVIEWS`. |

**Concrete `shared/gameList.js` entry:**

```js
spoons: {
  id: 'spoons', name: 'Spoons', minPlayers: 3, maxPlayers: 8,
  turnTimer: TIMERS.SPOONS_GRAB,
  description: 'Pass cards fast, get four of a kind, then GRAB a spoon. Last one out each round is gone.',
  instructions: [
    'Everyone holds 4 cards. There is always one fewer spoon than players.',
    'Cards flow around the table — pick up the card coming to you, then tap one card to pass on.',
    'The instant someone gets four of a kind, the GRAB phase opens for everyone.',
    'Tap a spoon as fast as you can — the one player left without a spoon is eliminated.',
    'Survive each round. The last player standing wins; finishing order sets your placement.',
  ],
},
```

(Also bump `shared/version.js` — minor bump for a new game — and commit/push per project convention.)

---

## 12 Edge cases & test scenarios (leave/deadlock harness)

Assertions (drive the engine directly, no socket layer):

1. **Full game completes:** 4 players, script grabs each round → `isComplete()` true, `getResults().length === 4`, placements `{1,2,3,4}` unique, winner = last survivor.
2. **getResults ranks all N (3–8):** for each N in 3..8, run to finish; assert every constructor player appears exactly once with a unique placement and reverse-elimination order holds.
3. **Concurrent four-of-a-kind:** two players' `takeAndDiscard` both complete a four-of-a-kind back to back — assert only the FIRST opens grab (`grabTriggeredBy` = first), the second's action is a no-op (state already `grab`), both can still grab.
4. **Grab race ordering:** in `grab`, fire `grab` for all but one survivor → that survivor is eliminated; assert `eliminationOrder` last entry = the non-grabber.
5. **Grab timeout:** open grab, no one taps → `_grabTimer` auto-grabs in deterministic order, exactly one eliminated, state → `roundEnd`.
6. **Idle deadlock:** in `passing`, send no actions → `_idleTimer` forces dealer auto-discard, ring keeps flowing, no permanent stall; assert `_emitChange` called.
7. **Leave during passing (dealer):** dealer leaves → `dealerId` reassigned to new `survivors[0]`, their incoming cards returned to `drawPile`, game continues.
8. **Leave during grab (would-be loser):** the survivor who has NOT grabbed leaves → they become the elimination (appended to `eliminationOrder`), grab resolves, no deadlock.
9. **Leave during grab (a grabber):** a player who already grabbed leaves → spoon math recomputes; the remaining non-grabber is the elim; assert exactly one out.
10. **Leave during roundEnd:** non-acked survivor leaves → auto-ack → `_advanceAfterRound` fires.
11. **Down to 1 via leaves:** repeatedly leave until 1 survivor → state `finished`, leavers ranked below winner in leave order, results complete.
12. **destroy() clears timers:** start each phase, call `destroy()`, assert no timer callback mutates state afterward (spy that `_idleTimer/_grabTimer/_ackTimer` are cleared).
13. **Hidden info:** `getStateForPlayer(A)` never contains another player's hand contents or incoming card contents during `passing`/`grab` (only counts).
14. **ping idempotency:** sending `ping` after a timeout already fired is a no-op (no double elimination).

---

## 13 Effort & risks

**Effort: L (Large)** — the most complex Tier-1 game.

- **Server engine:** L — continuous pass queue + grab lock + per-round re-deal + elimination tracking + 3 timers.
- **Client:** M–L — three distinct live screens, real-time pass animation, grab race UI, touch.
- **Deps:** `server/src/utils/` Deck/shuffle; BaseGame `_removeFromActive`/`removePlayer`/`destroy`; Scorer placement ties; `useScreenShake`, `useSound`, `PlayerName`, ConfettiOverlay (already exist).

**Risks (flag these):**

1. **Grab concurrency (highest):** two near-simultaneous four-of-a-kinds, and the grab race itself. Mitigation: Node's single-threaded handler atomicity + `state` guards + monotonic `seq` ordering (never trust client timestamps). Resolution counts grabbers at the end, not per-tap. **Test exhaustively (scenarios 3–5, 8–9).**
2. **Ring never drying up:** with discards flowing one direction and the dealer drawing, the pile can empty. Mitigation: last-seat discards feed a trash sink the dealer reshuffles from. Risk of an unwinnable "no one can ever get four-of-a-kind" stall — mitigated by the idle timer forcing progress, but verify the deck composition (4 suits × (survivors+1) ranks) always makes four-of-a-kind reachable.
3. **Leave-during-grab fairness:** recomputing spoon math when a racer vanishes is fiddly — wrong logic either eliminates two or zero. Scenarios 8–9 are mandatory gates.
4. **Client/server desync on the fast pass:** broadcasts must be frequent (`_emitChange` after every action) and the client must render from `gameState`, never optimistic local pass state, or hands drift. `ping` is the recovery valve.
5. **Mobile tap latency in grab:** the race must feel fair on phones; keep the grab window generous (4s) and resolve by server arrival, so network jitter — not reflexes alone — doesn't unfairly punish.

---

## 14 Open questions

1. **Deck size / ranks per round:** spec assumes `(survivors+1)` distinct ranks × 4 suits, reshuffling discards. Confirm this guarantees reachable four-of-a-kind for all counts 3–8, or pin to a fixed 52-card deck with a top-up rule.
2. **Trash-sink vs strict ring:** real Spoons passes only to the neighbor (no central draw beyond the dealer). Confirm the dealer+trash-reshuffle model is acceptable, or simplify to a pure neighbor-pass ring with a finite draw pile (which then needs a different stall rule).
3. **Should the grab trigger get an auto-grab?** Current spec: no, they must tap (more fun, fairer head start). Confirm we don't auto-save the trigger.
4. **Grab window length:** 4s proposed — tune for mobile fairness vs pacing.
5. **min/maxPlayers:** set min to **3** (so first elimination leaves ≥2). Confirm we don't want to allow 2 (would be a 1-spoon duel — playable but trivial; excluded for now).
6. **Spoon count display:** show physical spoon buttons (one per remaining spoon) or a single grab button? Proposed single big button + `spoonsRemaining` counter for clarity on small screens — confirm.
7. **Reconnect:** does a `RECONNECT_GRACE` (45s) window apply mid-grab, or is a disconnect during grab an instant auto-grab-fail? Proposed: instant fail (the race can't wait 45s). Confirm.
