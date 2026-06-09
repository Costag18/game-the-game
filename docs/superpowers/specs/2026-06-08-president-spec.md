# President (Scumlord) — Implementation Spec

> Slug: `president` · Spec date: 2026-06-08 · Engine: BaseGame FSM (turn-based shedding)
> Reference games studied: `Uno.js` (turn rotation, leave contract), `LiarsDice.js` (elimination + ack timers, `getResults` finish-order pattern).

## 1 Overview

- **Game:** President (a.k.a. Scumlord / Asshole). Climbing/shedding card game.
- **Players:** 2–8 supported (`minPlayers: 2`, `maxPlayers: 8`). Best experience 4–6.
- **Type:** Turn-based, server-authoritative, single deck (52 cards). One game per tournament round.
- **Goal:** Be the first to empty your hand. Finish order = ranking. First out = **President**, last remaining = **Scumlord**.
- **Length:** One full play-out of the deck per round; typically 2–6 minutes. No card-exchange meta this version (see §14).
- **Title font:** `'Playfair Display'` (regal, matches President theme; `'Cinzel'` acceptable fallback per brief). Loaded via Google Fonts, applied to the game title only.
- **Hidden info:** every player's hand is private. Opponents see only counts.

### Rules summary (single round, no exchange)
- Full 52-card deck dealt as evenly as possible (low player counts get more cards; uneven remainder is fine — some players get 1 extra).
- Card rank order (low→high): `3 4 5 6 7 8 9 10 J Q K A 2`. **2 is the highest.** Suit is irrelevant for beating (suit only for display/dealing).
- Play proceeds **clockwise** (`this.players` order, fixed for the round).
- The trick leader plays a **group** of N cards of the same rank (1=single, 2=pair, 3=triple, 4=bomb). This sets the **required count** for the trick.
- Each subsequent player must either **play a same-count group of strictly higher rank**, or **pass**. (single beats single, pair beats pair, etc. — you cannot change the count mid-trick.)
- When everyone except the last player to play has passed, the **trick clears**; that last player **leads a fresh trick** (any count) with no rank floor.
- When a player plays their final card(s) they **finish** and are recorded in finish order (removed from rotation via `_removeFromActive`, but kept for results).
- Round ends when **one player remains** (the Scumlord). That last player is auto-appended to the finish order.

## 2 Tournament fit

`getResults()` MUST return one `{ playerId, placement, ... }` for **every** player who started the round (2–8), ranked. The tournament Scorer maps placement → `PLACEMENT_MULTIPLIERS = [1.0, 0.7, 0.5, 0.35, 0.25, 0.15]` (6th+ all use the last multiplier, 0.15).

- **Ranking source:** finish order. `finishOrder[0]` (first to empty hand) = placement 1; the single remaining player = last placement.
- **Ties:** President has **no ties under normal play** — each player finishes at a distinct moment, so placements are 1..N with no duplicates. The only tie path is a simultaneous mass-leave at round end (see §9); handle by assigning equal placement to players removed in the same resolution and following the `let placement = i+1` only-when-not-tied pattern. Default: assume distinct placements.
- Placement integers are **dense and contiguous** (1,2,3,…,N) so Scorer’s `placementMap` and the `placements` array agree.

## 3 FSM (state × action → next state)

States: `waiting`, `playing`, `finished`.

| State | Action (transition name) | Next state | onEnter hook |
|-------|--------------------------|------------|--------------|
| `waiting` | `start` | `playing` | `onEnterPlaying` (optional; not required) |
| `playing` | `finish` | `finished` | `onEnterFinished` (optional; clears timers) |

The FSM is intentionally minimal (like Uno). All trick/turn logic lives **inside** `playing` and is driven by `handleAction` + the turn timer, not by FSM transitions. Only the round-end fires `transition('finish')`.

```js
super(players, {
  states: ['waiting', 'playing', 'finished'],
  initialState: 'waiting',
  transitions: {
    waiting: { start: 'playing' },
    playing: { finish: 'finished' },
  },
});
```

`onEnterFinished()` (optional): clear the turn timer.

## 4 Server state (fields, set in constructor + `startGame`)

```js
this.hands = {};            // playerId -> array of card objects {rank, suit}  (rank: 3..15 numeric, see below)
this.pile = [];             // current trick's plays, newest last: [{ playerId, cards:[...], rankValue, count }]
this.trickCount = 0;        // required group size for current trick (0 = fresh trick / leader chooses)
this.trickTopRank = 0;      // highest rankValue currently on the pile (0 = open lead)
this.trickLeader = null;    // playerId who currently "owns" the trick (last to play)
this.passedThisTrick = new Set(); // playerIds who have passed since the trick was (re)opened
this.finishOrder = [];      // playerIds in order they emptied their hand (index 0 = President)
this.lastAction = null;     // { type:'play'|'pass'|'lead'|'clear', playerId, cards? } for client animation/log
this._turnTimer = null;     // setTimeout handle for the active player's turn
this._onStateChange = null; // broadcast callback (set via setOnStateChange)
```

**Rank encoding:** store `rankValue` as a number so comparisons are trivial: `3→3, …, 10→10, J→11, Q→12, K→13, A→14, 2→15`. Card object: `{ rankValue, label, suit }` where `label` is `'3'..'10','J','Q','K','A','2'` and `suit ∈ {'♠','♥','♦','♣'}` for display only. Build a 52-card deck (4 suits × 13 ranks), shuffle (reuse `utils/shuffle.js`), deal round-robin.

`startGame()`:
```js
this.hands = {}; this.pile = []; this.trickCount = 0; this.trickTopRank = 0;
this.passedThisTrick = new Set(); this.finishOrder = []; this.lastAction = null;
const deck = shuffle(buildDeck());
this.players.forEach((p) => { this.hands[p] = []; });
deck.forEach((card, i) => { this.hands[this.players[i % this.players.length]].push(card); });
this.players.forEach((p) => this.hands[p].sort((a,b)=>a.rankValue-b.rankValue)); // stable display order
this.transition('start');
// Leader = holder of lowest card (3♣ convention) OR simply players[0]; spec: players[0] leads an OPEN trick.
this.setTurnPlayer(this.players[0]);
this.trickLeader = this.players[0];
this._startTurnTimer();
```

## 5 Actions (`handleAction(playerId, action)`)

Top guards (all actions): `if (this.state !== 'playing') return;` then `if (playerId !== this.currentTurnPlayer) return;`. Clear & restart the turn timer on every accepted action.

### 5.1 `{ type: 'play', cardIndexes: number[] }`
Player plays one group of same-rank cards.

**Validation (reject silently = `return` on any failure, do not advance):**
1. `cardIndexes` is a non-empty array of valid, **distinct** indexes into `this.hands[playerId]`.
2. All selected cards share the **same `rankValue`** (a valid group).
3. **Count rule:** if `this.trickCount === 0` (open lead) → any count 1..4 allowed and `this.trickCount = group.length`. Else `group.length === this.trickCount` (must match the trick’s count).
4. **Rank rule:** if open lead (`this.trickTopRank === 0`) any rank allowed. Else `group.rankValue > this.trickTopRank` (strictly higher).

**Effects on valid play:**
```js
remove cards from this.hands[playerId];
this.pile.push({ playerId, cards: group, rankValue: group[0].rankValue, count: group.length });
this.trickCount = group.length;
this.trickTopRank = group[0].rankValue;
this.trickLeader = playerId;
this.passedThisTrick.clear();          // a play re-opens the "who has passed" set relative to new top
this.lastAction = { type: this.pile.length===1?'lead':'play', playerId, cards: group };
if (this.hands[playerId].length === 0) this._finishPlayer(playerId); // see §8/§9
this._advanceTurn();                   // to next active player who hasn't passed/finished
this._emitChange();
```
> Note: `passedThisTrick` is cleared on every successful play because the trick top changed — players who passed earlier get another chance only when the trick **clears**, not on a new top. (Standard President: once you pass you're out **until the trick clears**.) To honor that, do NOT clear `passedThisTrick` on play; instead `_advanceTurn()` must **skip** anyone in `passedThisTrick`. Keep `passedThisTrick` and only reset it on `_clearTrick()`. (Chosen rule for this build — see §12 T4.)

### 5.2 `{ type: 'pass' }`
```js
this.passedThisTrick.add(playerId);
this.lastAction = { type: 'pass', playerId };
this._afterPassCheckClear();  // if only trickLeader remains un-passed → clear trick
this._advanceTurn();
this._emitChange();
```
**Open-lead guard:** a player who is the trick leader on a fresh trick (`this.trickCount === 0`) **cannot pass** — they must play. Reject pass if `this.trickCount === 0 && playerId === this.trickLeader`. Auto-action on this case plays the lowest single (§7).

### 5.3 `{ type: 'ping' }` (client safety)
If the client’s local turn timer hits 0 and the server hasn’t advanced (clock skew), client emits `ping`. Server: if `playerId === currentTurnPlayer && state==='playing'`, run the **timeout auto-action** (§7) immediately. Otherwise ignore.

### Turn guards / helpers
- `_advanceTurn()`: rotate `turnIndex` forward through `this.players` (clockwise), **skipping** players not in `activePlayers` (finished/left) and players in `passedThisTrick`. If no eligible next player remains except the leader → call `_clearTrick()` then set turn to leader.
- `_clearTrick()`: `this.pile = []; this.trickCount = 0; this.trickTopRank = 0; this.passedThisTrick.clear();` set `currentTurnPlayer = this.trickLeader` (or, if leader finished, the next active player after them), `lastAction = { type:'clear' }`, restart timer, emit.
- `_afterPassCheckClear()`: eligible = `activePlayers` minus `passedThisTrick`. If `eligible.length <= 1` → the lone remaining (the leader) wins the trick → `_clearTrick()` with that player leading.

## 6 `getStateForPlayer(playerId)`

Return **only** the requesting player's hand. Opponents expose counts + finish status, never card contents.

```js
{
  phase: this.state,                              // 'playing' | 'finished'
  myHand: this.hands[playerId] || [],             // [{rankValue,label,suit}], sorted
  myFinished: this.finishOrder.includes(playerId),
  isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
  currentTurnPlayer: this.currentTurnPlayer,
  trickCount: this.trickCount,                    // required group size (0 = I may lead any count)
  trickTopRank: this.trickTopRank,                // 0 = open lead
  pile: this.pile.map(p => ({ playerId: p.playerId, cards: p.cards, count: p.count })), // visible — already-played cards are public
  lastAction: this.lastAction,
  passedPlayers: [...this.passedThisTrick],
  finishOrder: [...this.finishOrder],             // public ranking-so-far (President, VP, ...)
  players: this.players.map(p => ({
    playerId: p,
    handCount: (this.hands[p] || []).length,
    finished: this.finishOrder.includes(p),
    passed: this.passedThisTrick.has(p),
    isLeader: this.trickLeader === p,
  })),
}
```
**Hidden-info rule:** never include `this.hands[other]` contents. Played cards in `pile` are public by definition. `finishOrder` is public (it’s the visible scoreboard).

**Legal-move hint (client convenience):** also compute `canPlay` / `canPass` for the requesting player when it’s their turn, so the client can disable buttons:
- `canPass = isMyTurn && !(trickCount === 0 && trickLeader === playerId)`
- `canLeadOnly = isMyTurn && trickCount === 0`

## 7 Timers & broadcasting

- **Mechanism:** `setOnStateChange(cb)` stores `this._onStateChange`; `_emitChange()` calls it (broadcast filtered state + check `isComplete()`), mirroring `LiarsDice`. Registered in `server/src/games/index.js` orchestration like other timer games.
- **Turn timer:** `TIMERS.CARD_GAME` (30s). `_startTurnTimer()` clears any prior timer then `setTimeout(() => this._onTurnTimeout(), 30000)`.
- **Auto-action on timeout (`_onTurnTimeout`)**, guarded `if (this.state !== 'playing') return;`:
  - If the current player **must lead** (`trickCount === 0`): auto-play their **lowest single** card.
  - Else: **auto-pass** (the safe, rules-legal default — never forces a play). (Brief allows "auto lowest legal"; this build chooses **auto-pass** for simplicity and to avoid leaking that they had a legal play. Document in §14.)
  - After the auto-action, `_emitChange()` (broadcasts new turn AND re-checks `isComplete()`).
- **Every `setTimeout`-driven advance pairs with `_emitChange()`** so clients never get stuck on an expired timer (the core lesson from timer games).
- **`destroy()`** clears `this._turnTimer`.

```js
setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }
_startTurnTimer() {
  if (this._turnTimer) clearTimeout(this._turnTimer);
  if (this.state !== 'playing') return;
  this._turnTimer = setTimeout(() => { this._onTurnTimeout(); this._emitChange(); }, 30000);
}
destroy() { if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; } }
```

## 8 Scoring & `getResults()`

Ranking is pure finish order. No per-card scoring (no exchange meta).

`_finishPlayer(playerId)`:
```js
this.finishOrder.push(playerId);
this._removeFromActive(playerId);      // out of rotation, STAYS in this.players for results
this.passedThisTrick.delete(playerId);
if (this.trickLeader === playerId) this.trickLeader = null; // next clear re-assigns
if (this.activePlayers.length <= 1) this._finalizeRound();   // §9
```

`_finalizeRound()`: append the last remaining active player (the Scumlord) to `finishOrder` if not already there, clear timer, `transition('finish')`, `_emitChange()`.

`isComplete()` → `this.state === 'finished'`.

`getResults()` (mirrors LiarsDice finish-order pattern; placements dense 1..N):
```js
getResults() {
  // finishOrder is President-first. Ensure every starter is present exactly once.
  const order = [...this.finishOrder];
  for (const p of this.players) if (!order.includes(p)) order.push(p); // safety net
  return order.map((p, i) => ({ playerId: p, placement: i + 1, rankTitle: TITLES[i] }));
}
```
`TITLES` for flavor only (not used by Scorer): `['President','Vice President','Citizen',…,'Scumlord']` — compute first=President, last=Scumlord, middle='Citizen'. **Placement is the load-bearing field; every player gets a unique 1..N.**

## 9 Leave & deadlock handling

Two distinct removals (per BaseGame v2.7.0 contract):
- `_removeFromActive(id)` = **finished** (emptied hand). Stays in `this.players` → still ranked.
- `removePlayer(id)` = **left/disconnected**. Prune from `this.players` AND rotation; they do **not** appear in results.

### `removePlayer(playerId)` (override)
```js
removePlayer(playerId) {
  const wasCurrent = this.currentTurnPlayer === playerId;
  const wasLeader = this.trickLeader === playerId;

  // If leaver holds the turn, advance off them FIRST (while still in players so rotation is correct).
  if (wasCurrent && this.activePlayers.length > 1) this._advanceTurn();

  super.removePlayer(playerId);          // prunes this.players + activePlayers (BaseGame)
  delete this.hands[playerId];
  this.passedThisTrick.delete(playerId);
  // Leaver should NOT be ranked: drop from finishOrder if somehow present.
  this.finishOrder = this.finishOrder.filter((p) => p !== playerId);

  if (wasLeader) {
    // The trick loses its owner → clear it and give the lead to the current active player.
    this._clearTrick();
  } else {
    // Their pass/seat is gone; re-check whether the trick should now clear.
    this._afterPassCheckClear();
  }

  if (this.activePlayers.length <= 1 && this.state === 'playing') {
    this._finalizeRound();               // last active = Scumlord, transition('finish')
    return;
  }
  this._startTurnTimer();
  // Caller (orchestration) broadcasts; if game owns the loop, also _emitChange().
}
```

### Phase-by-phase "what if X leaves"
| Situation | Behavior |
|-----------|----------|
| **Current player leaves mid-trick** | `_advanceTurn()` off them first, then prune. Next eligible (non-passed, active) player gets the turn. No deadlock. |
| **Trick leader leaves** (they own the top, may not be current) | `_clearTrick()` → pile resets, lead goes to current active player. Prevents "everyone waits on a ghost to be beaten." |
| **A passed player leaves** | They were already out of the trick; just `_afterPassCheckClear()` in case removing them tips eligible count to ≤1 → trick clears to leader. |
| **Leave drops to 1 active player** | `_finalizeRound()`: that player is Scumlord, round ends. |
| **Leave during their own turn-timeout race** | `removePlayer` clears/restarts timer; `_onTurnTimeout` guards `state==='playing'` and re-checks current player, so a stale fire is a no-op. |
| **Finisher then everyone else leaves** | finishers stay ranked (they're in `this.players` + `finishOrder`); leavers pruned; `_finalizeRound` ranks the last active. |

### `destroy()`
Clears `this._turnTimer`. Called by orchestration before discarding the instance so no orphan timeout fires on a torn-down game.

**Deadlock guards summary:** every turn has a 30s timer → auto-pass/auto-lead; `ping` action lets a stuck client nudge the server; `_advanceTurn` always lands on an eligible player or clears the trick; `_afterPassCheckClear` guarantees a trick can never wait on someone who can't act; `_finalizeRound` fires the moment ≤1 active remain.

## 10 Client component (`client/src/games/President.jsx` + `.module.css`)

Props: `{ gameState, nicknames, avatars, onAction }` — `gameState` is the `getStateForPlayer` shape. Use `PlayerName` for names/avatars, `useSound()` for SFX, `useScreenShake()` for big moments.

### Layout (single `playing` phase, no sub-screens)
- **Title bar:** "President" in `'Playfair Display'`, plus subtitle showing current rank-titles earned (President / Scumlord badges).
- **Opponents row (top):** one chip per `gameState.players` (excluding me): avatar + name + `handCount` cards (face-down fan or count badge) + `passed`/`finished`/`isLeader` indicator. Finished players show their `rankTitle`.
- **Center pile:** the current trick. Show the latest group large; show `trickCount` ("Pairs", "Singles", "Triples", "Bombs") and `trickTopRank` label. "New trick — your lead" banner when `trickCount === 0` and it’s my turn.
- **My hand (bottom):** fanned cards from `myHand`, sorted. **Tap-to-select** (touch-friendly): tap toggles a card into a selection set; selecting a card auto-deselects cards of a different rank (enforce same-rank group client-side too, but server is authority). Selected cards lift up.
- **Action buttons:** `Play` (enabled only when selection is a legal group vs trick), `Pass` (enabled when `canPass`). On fresh lead, hide/disable Pass. A small "lowest legal" hint is optional.
- **Turn timer ring** around my avatar; when it hits 0 locally and `isMyTurn`, emit `{ type:'ping' }`.

### Touch support
- No hover dependence: tap-to-select + explicit `Play` confirm (per project touch pattern). Big hit targets for cards (overlap fan, last-tapped card on top z-index).

### Sound / shake (`useSound`, `useScreenShake`)
- `playSound('cardPlay')` on each `play`; `playSound('cardPass')` (or a soft tone) on pass; `playSound('roundStart')` on first state.
- On a **bomb** (4-of-a-kind played) → `shake('medium')` + a distinct sound.
- On **someone finishing** → small chime; if **I** finish 1st (President) → `shake('heavy')` + `winRound` sound. If I end as Scumlord → `loseRound` sound.
- On **trick clear** → subtle "sweep" sound, brief pile-clear animation.

### gameState reads → actions emitted
- Read `isMyTurn`, `trickCount`, `trickTopRank`, `myHand`, `players`, `pile`, `lastAction`, `finishOrder`.
- Emit via `onAction`: `{ type:'play', cardIndexes:[...] }`, `{ type:'pass' }`, `{ type:'ping' }`.

## 11 Registration checklist (8 steps — exact paths & values)

1. **`server/src/games/President.js`** — `export class President extends BaseGame` implementing §3–§9.
2. **`shared/gameList.js`** — add to `GAMES`:
   ```js
   president: {
     id: 'president', name: 'President', minPlayers: 2, maxPlayers: 8,
     turnTimer: TIMERS.CARD_GAME,
     description: 'Shed your hand first to rule. Last one stuck is the Scumlord.',
     instructions: [
       'Everyone is dealt the whole deck. Card order low to high: 3,4,5,6,7,8,9,10,J,Q,K,A,2 (2 is highest).',
       'The leader plays any group of same-rank cards (single, pair, triple, or four).',
       'On your turn, beat the pile with a higher group of the SAME size, or pass.',
       'Once you pass you are out until the trick clears. When all but one player passes, that player leads a fresh trick.',
       'Empty your hand to finish. First out is President, last left is Scumlord. Your finish order is your ranking.',
     ],
   },
   ```
3. **`shared/constants.js`** — no new timer needed; reuse `TIMERS.CARD_GAME` (30s). (Skip step.)
4. **`server/src/games/registry.js`** — `import { President } from './President.js';` then `registerGame('president', President);`.
5. **`client/src/games/President.jsx`** + **`President.module.css`** — component per §10 (props `gameState/nicknames/avatars/onAction`; `PlayerName`; `useSound`; title font `'Playfair Display'`; touch tap-to-select).
6. **`client/src/assets/gamepreviews/president.png`** — add preview art.
7. **`client/src/App.jsx`** — `import PresidentGame from './games/President.jsx';` and add `president: PresidentGame,` to `GAME_COMPONENTS`.
8. **`client/src/screens/GameVote.jsx`** — `import previewPresident from '../assets/gamepreviews/president.png';` and add `president: previewPresident,` to `GAME_PREVIEWS`.

Also bump `shared/version.js` (minor) and update CLAUDE.md (Mini-Games table → 13 games; Fonts table → President / Playfair Display) per project conventions.

## 12 Edge cases & test scenarios (harness assertions)

- **T1 — Results completeness:** for N in 2..8, run a full random game; assert `getResults().length === N`, placements are exactly `[1..N]` with no gaps/dupes, every starter present.
- **T2 — Beat rules:** leading a pair of 7s; a pair of 9s beats it, a single 9 is rejected (count mismatch), a pair of 5s is rejected (lower), a pair of 2s beats it (2 is highest).
- **T3 — Open lead any count:** after a trick clears, the leader may play a triple even though the prior trick was singles.
- **T4 — Pass persistence:** A passes a trick; B then raises the top; assert A is **still skipped** (not given another turn) until `_clearTrick()`. Then after clear, A is eligible again.
- **T5 — Trick clear → leader leads:** all but C pass; assert `trickCount===0`, `trickTopRank===0`, `currentTurnPlayer===C`, pile empty.
- **T6 — Finish:** player empties hand on a play; assert added to `finishOrder`, removed from `activePlayers`, still in `this.players`, turn advances correctly; if they were the leader, trick clears.
- **T7 — Last player:** when `activePlayers.length===1`, assert `_finalizeRound` ran, `state==='finished'`, last player is final entry in `finishOrder`.
- **T8 — Leave: current player** mid-trick → turn advances to next eligible; no exception; timer restarted.
- **T9 — Leave: trick leader** (not current) → trick clears, lead reassigned to a current active player; leaver absent from `finishOrder` and `getResults`.
- **T10 — Leave drops to 1 active** → round finalizes; remaining player is Scumlord (last placement); leavers excluded from results.
- **T11 — Timeout auto-pass:** stub timer; fire `_onTurnTimeout` on a non-leader → that player passes, turn advances, `_emitChange` called.
- **T12 — Timeout auto-lead:** fire timeout on a fresh-trick leader → lowest single auto-played, not a pass.
- **T13 — `destroy()`** clears `_turnTimer`; a subsequently fired stale timeout is a no-op (`state` already `finished`).
- **T14 — ping race:** client `ping` when it's their turn triggers the same auto-action path as the timer; `ping` from a non-current player is ignored.
- **T15 — Invalid plays rejected:** mixed-rank group, out-of-range index, duplicate index, wrong count, non-higher rank, pass on forced lead — each is a no-op (state unchanged, same player still on turn).

## 13 Effort & risks

- **Effort: M.** Server engine is moderate (group/trick comparison, pass-persistence skip logic, finish vs leave separation). Client is a standard fanned-hand card UI with tap-to-select; reuse Uno/Poker card CSS patterns.
- **Dependencies:** `utils/shuffle.js` (deck shuffle); `BaseGame` rotation helpers; orchestration registration of `setOnStateChange` (same wiring as LiarsDice/SpotTheDifference). No new shared timer, no new APIs.
- **Risks:**
  - *Pass-persistence skip* is the trickiest invariant — `_advanceTurn` must skip `passedThisTrick` AND `activePlayers`-excluded players, and `_clearTrick` must reset the pass set. Mis-handling causes either soft-lock (waiting on a passed player) or letting a passed player re-raise. Covered by T4/T5.
  - *Leader leaves* edge (T9) — must clear the trick or the round can stall.
  - *Finish vs leave* mixup — using `removePlayer` instead of `_removeFromActive` on a finisher would wrongly drop them from results. Covered by T6/T1.

## 14 Open questions

1. **Card-exchange meta** (President gives 2 best cards to Scumlord, etc.) — **skipped this version** (single round). Future: needs a prior-round President/Scumlord memory carried across tournament rounds; out of scope for one-round-per-round model. Note added for a v2 follow-up.
2. **Timeout default — auto-pass vs auto-lowest-legal.** This spec chose **auto-pass** (never forces away a card, no info leak). Confirm preference; auto-lowest-legal would make AFK players shed faster and could feel more "fair" but reveals they had a play.
3. **2s / special powers:** classic variants let a single **2** clear any trick, and 4-of-a-kind "bombs" beat anything. This build treats 2 only as the highest rank (no auto-clear) and bombs only beat same-count groups. Confirm whether to add a "2 clears the trick" power and cross-count bombs (would change §5 count rule).
4. **Opening lead convention:** spec leads `players[0]` on an open trick. Alternative: force holder of 3♣ to lead first trick (classic). `players[0]` is simpler and fine for a tournament round.
5. **Revolution / suit-tiebreak:** not implemented (suit irrelevant to beating). Confirm acceptable.
