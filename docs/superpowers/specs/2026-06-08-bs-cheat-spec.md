# BS (Cheat) — Implementation Spec

> Build-ready implementation spec for the mini-game **BS (Cheat)**, slug `bs-cheat`, engine id `bsCheat`.
> Target codebase: "Game The Game" (server-authoritative, FSM games extend `BaseGame`).
> Reference implementations mined: `server/src/games/LiarsDice.js` (turn + reveal/ack + reveal-all-on-challenge), `server/src/games/Uno.js` (empty-hand finish, leaver advance-then-prune), `server/src/games/BaseGame.js` (v2.7.0 leave contract).

---

## 1 Overview

| Field | Value |
|-------|-------|
| Display name | **BS (Cheat)** |
| Engine id / slug | `bsCheat` / `bs-cheat` |
| Type | Turn-based bluff (claim-and-challenge) |
| Players | 2–8 |
| Deck | Single 52-card deck, dealt as evenly as possible (some players get 1 extra card at start) |
| Length | One game per round = play until exactly one player has cards left ("the BS"); finish order ranks everyone |
| Turn timer | `TIMERS.CARD_GAME` (30s) — auto-plays lowest single card as required rank |
| Challenge window | `TIMERS.BS_CHALLENGE` (≈4s) new constant — first valid BS call wins |
| Reveal/ack | 10s auto-advance (matches LiarsDice convention) |
| Title font | `Creepster` (primary) — fallback `Bangers`. Loaded via Google Fonts, applied to the game title only. |

**Concept.** Cards are placed **face down** onto a shared pile. The claimed rank cycles A → 2 → … → K → A each turn (wrap). On your turn you must claim it is the current required rank — you place 1–4 cards face down and announce e.g. "Costa played 3 as Queens". Any other player has a short window to call **BS**. On a call, the just-played cards are revealed: if the player lied (any card ≠ claimed rank), the liar scoops the whole pile into their hand; if they were truthful, the **challenger** takes the whole pile. Empty your hand to escape (you FINISH, scored, out of rotation). Last player still holding cards loses. Goal in tournament terms: finish as early as possible (placement 1 = first to empty).

---

## 2 Tournament fit

`getResults()` returns an array covering **all N players** (2–8), each with `{ playerId, placement, ... }`, sorted by rank. Ranking key:

1. **Finish order** — players who emptied their hand, in the order they did so (1st to empty = placement 1, 2nd = placement 2, …).
2. **Non-finishers** — players still holding cards when the game ends (normally exactly one, but a multi-leave can leave more) ranked **after** all finishers by **fewest cards remaining** (ascending). Ties on card count share a placement.

The Scorer (`Scorer.calculateRoundScores`) consumes `gameResults` and honors tie placements via `placementMap`. `PLACEMENT_MULTIPLIERS = [1.0, 0.7, 0.5, 0.35, 0.25, 0.15]` applies by placement index — so this game must always produce placements `1..N`. **Constraint satisfied:** every player in `this.players` appears exactly once in the output.

**Tie rule.** Finish order is strict (no ties among finishers — they emptied on distinct turns). Ties only occur among non-finishers with identical `cardsRemaining`; they share the lowest placement of the group (standard `if (!tied) placement = i + 1;` pattern).

---

## 3 FSM (state × action → next)

States: `waiting`, `playing` (a player is selecting/placing cards on their turn), `challengeWindow` (cards down, others may call BS), `reveal` (challenge resolved, pile shown, players acknowledge), `finished`.

`fsmConfig` passed to `super(players, …)`:

```js
{
  states: ['waiting', 'playing', 'challengeWindow', 'reveal', 'finished'],
  initialState: 'waiting',
  transitions: {
    waiting:         { start: 'playing' },
    playing:         { place: 'challengeWindow', finish: 'finished' },
    challengeWindow: { challenge: 'reveal', pass: 'playing', finish: 'finished' },
    reveal:          { next: 'playing', finish: 'finished' },
  },
}
```

| Current state | Action (FSM) | Next state | Trigger |
|---|---|---|---|
| `waiting` | `start` | `playing` | `startGame()` |
| `playing` | `place` | `challengeWindow` | current player places 1–4 cards (`place` action) |
| `playing` | `finish` | `finished` | only ≤1 player remains (leave edge); never from a normal play |
| `challengeWindow` | `challenge` | `reveal` | first valid `callBS` |
| `challengeWindow` | `pass` | `playing` | window timer expires with no challenge → advance turn |
| `challengeWindow` | `finish` | `finished` | leave collapses game to ≤1 player |
| `reveal` | `next` | `playing` | all present players acknowledged (or 10s timeout) and ≥2 remain |
| `reveal` | `finish` | `finished` | ≤1 player has cards after resolution |

**onEnter hooks** (named `onEnter<State>` per `BaseGame.transition`):

- `onEnterChallengeWindow()` — snapshot `pendingPlay`, start `_challengeTimer` (≈4s). On expiry → `transition('pass')` path via `_resolveNoChallenge()` + `_emitChange()`.
- `onEnterReveal()` — resolve who takes the pile, build `revealResult` (face-up cards), reset `acknowledged = new Set()`, start `_revealTimer` (10s auto-advance) + `_emitChange()`.
- `onEnterPlaying()` — clear `pendingPlay`, `revealResult`; set required rank for the new turn; arm `_turnTimer` (30s).
- `onEnterFinished()` — `destroy()` all timers.

---

## 4 Server state (fields)

```js
this.hands = {};            // playerId -> [{ rank: 1..13, suit }]   (rank 1 = Ace, 11=J,12=Q,13=K)
this.pile = [];             // shared discard, face-down accumulation; array of card objects
this.requiredRank = 1;      // 1..13, claimed rank for the CURRENT turn (starts at Ace=1, wraps)
this.finishOrder = [];      // playerIds in order they emptied their hand (first = best placement)
this.pendingPlay = null;    // { playerId, cards:[...], claimedRank, claimedCount } during challengeWindow
this.revealResult = null;   // { liar:bool, playerId, challenger, claimedRank, revealedCards:[...],
                            //   takerId, pileSize } shown during 'reveal'
this.acknowledged = new Set();   // playerIds who ack'd the current reveal
this.lastPlayerId = null;   // who last placed (the claimant) — for turn re-anchoring after reveal
this._challengeTimer = null;
this._revealTimer = null;
this._turnTimer = null;
this._onStateChange = null; // set via setOnStateChange
```

Notes:
- `requiredRank` increments **only when the turn advances past a completed (un-challenged or resolved) play**, computed as `((requiredRank - 1 + 1) % 13) + 1` i.e. wraps 13 → 1.
- `pile` holds card objects but their values are NEVER sent to clients except inside `revealResult` for the cards that were just challenged.
- Deck built from `new Deck()` (utils/Deck.js: ranks 1–13, 4 suits), dealt round-robin so player counts that don't divide 52 evenly give the first `52 % N` players one extra card.

---

## 5 Actions (`handleAction(playerId, action)`)

All actions ignored unless preconditions hold (silent `return`, matching house style). Turn guard: a `place` is only valid from `this.currentTurnPlayer`; a `callBS` may come from **any player except** the claimant.

### `place` — { type:'place', cards: number[], claimedRank?: number }
- **Phase guard:** `this.state === 'playing'` and `playerId === this.currentTurnPlayer`.
- **Payload:** `cards` is an array of 1–4 **hand indices** to place face down. `claimedRank` is optional/ignored — the claim is forced to `this.requiredRank` (rotating-claim variant; you cannot choose the rank).
- **Validation:**
  - `Array.isArray(cards)`, `cards.length >= 1 && cards.length <= 4`.
  - All indices unique, in range `[0, hand.length)`.
  - Player has ≥ `cards.length` cards.
- **Effects:**
  - Remove those cards from `hands[playerId]` (splice high-index-first to keep indices stable), push them onto `pile`.
  - `this.pendingPlay = { playerId, cards: removed, claimedRank: this.requiredRank, claimedCount: removed.length }`.
  - `this.lastPlayerId = playerId`.
  - **If hand now empty:** the player has emptied but the pile is still live — they are subject to challenge. Keep them eligible to finish only after the challenge window resolves truthfully (see resolution). Do NOT finish here; mark via `pendingPlay`/resolution path so a BS call can still pull cards back.
  - `transition('place')` → `onEnterChallengeWindow()` (starts ≈4s window, broadcasts).

### `callBS` — { type:'callBS' }
- **Phase guard:** `this.state === 'challengeWindow'`.
- **Who:** any `playerId` in `this.activePlayers` **except** `this.pendingPlay.playerId`. First valid call wins — once we enter `reveal` the state guard rejects later calls.
- **Effects:** clear `_challengeTimer`; record `challenger = playerId`; `transition('challenge')` → `onEnterReveal()` which calls `_resolveChallenge(challenger)`.

### `acknowledge` — { type:'acknowledge' }
- **Phase guard:** `this.state === 'reveal'`.
- **Effects:** `this.acknowledged.add(playerId); this._checkRevealAckComplete();`

### `ping` — { type:'ping' }
- Client fallback when a local timer hits 0 and server hasn't transitioned. No-op except: if `challengeWindow` and window already elapsed, force `_resolveNoChallenge()`; if `reveal` and timer elapsed, force ack-complete. Defensive only; primary advance is server timers.

**No-challenge resolution (`_resolveNoChallenge()`):** called by the challenge-window timeout/`pass`:
- Commit the play (cards stay on the pile, nobody picks up).
- If `pendingPlay.playerId` now has 0 cards → that player **finishes**: push to `finishOrder`, `_removeFromActive(id)`.
- Advance: `requiredRank` wraps +1; `transition('pass')` → `onEnterPlaying()` sets next turn (next active player after the claimant).
- If `activePlayers.length <= 1` after a finish → `transition('finish')` instead.

**Challenge resolution (`_resolveChallenge(challenger)`):**
- `lied = pendingPlay.cards.some(c => c.rank !== pendingPlay.claimedRank)`.
- `takerId = lied ? pendingPlay.playerId : challenger`.
- Build `revealResult = { liar: lied, playerId: pendingPlay.playerId, challenger, claimedRank, revealedCards: [...pendingPlay.cards], takerId, pileSize: this.pile.length }`.
- Taker scoops: `hands[takerId].push(...this.pile); this.pile = [];`
- A player who emptied via a truthful play but was challenged-and-vindicated still counts as emptied (pile went to challenger, claimant keeps 0) → eligible to finish on `next`.
- Reset `acknowledged`, arm 10s reveal timer, `_emitChange()`. Actual hand/turn advance happens in `_advanceAfterReveal()`.

**`_advanceAfterReveal()`** (all ack'd or 10s timeout):
- For each active player now at 0 cards (could be the claimant), push to `finishOrder` + `_removeFromActive`.
- If `activePlayers.length <= 1` → `transition('finish')`; return.
- Next turn: the **taker** plays next if still active and the rotation lands there naturally; default = next active player clockwise from `lastPlayerId`. (Concrete rule below in §7.) `requiredRank` does **not** advance when the pile was picked up after a challenge — the claimed rank for the next turn resets to the next rank in sequence from `requiredRank` (design choice: keep it simple — always `requiredRank = wrap(requiredRank + 1)` on every turn change including post-reveal, so the cycle never desyncs across clients). `transition('next')` → `onEnterPlaying()`.

---

## 6 `getStateForPlayer(playerId)`

Shape (hidden-info safe):

```js
{
  phase: this.state,                         // 'waiting'|'playing'|'challengeWindow'|'reveal'|'finished'
  myHand: this.hands[playerId] || [],        // FULL card objects — only ever your own hand
  requiredRank: this.requiredRank,           // claimed rank for current/next play (1..13)
  pileCount: this.pile.length,               // count only, NEVER the card values
  currentTurnPlayer: this.currentTurnPlayer,
  isMyTurn: this.currentTurnPlayer === playerId && this.state === 'playing',
  lastPlayerId: this.lastPlayerId,
  pendingPlay: this.state === 'challengeWindow' && this.pendingPlay ? {
    playerId: this.pendingPlay.playerId,
    claimedRank: this.pendingPlay.claimedRank,
    claimedCount: this.pendingPlay.claimedCount,   // "played N as <rank>" — NO card values
  } : null,
  canCallBS: this.state === 'challengeWindow'
             && this.pendingPlay
             && this.pendingPlay.playerId !== playerId
             && this.activePlayers.includes(playerId),
  revealResult: this.state === 'reveal' ? this.revealResult : null,  // values revealed ONLY here
  finished: this.finishOrder.includes(playerId),
  finishOrder: [...this.finishOrder],
  otherPlayers: this.players
    .filter((p) => p !== playerId)
    .map((p) => ({
      playerId: p,
      handCount: (this.hands[p] || []).length,
      finished: this.finishOrder.includes(p),
    })),
}
```

**Hidden-info rules (must hold):**
- `myHand` reveals only the requester's own cards.
- `pile` contents are never serialized — only `pileCount`.
- `pendingPlay` exposes `claimedCount` + `claimedRank` (the public announcement) but **never** the actual card values during `challengeWindow`.
- Card values of a play are revealed **only** in `revealResult.revealedCards`, and only while `phase === 'reveal'`, and only for the cards that were challenged (not the whole pile).
- Opponent hands are exposed as counts only via `otherPlayers[].handCount`.

---

## 7 Timers & broadcasting

`setOnStateChange(cb)` / `_emitChange()` identical to LiarsDice:

```js
setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }
```

The registered callback (in `index.js` orchestration) broadcasts filtered state to all players **and** checks `isComplete()` to auto-finish. Every timer-driven advance MUST call `_emitChange()` after mutating.

| Timer | Field | Duration | On expiry |
|---|---|---|---|
| Turn timer | `_turnTimer` | `TIMERS.CARD_GAME` = 30s | Auto-action: place the **lowest single card** required (1 card, index of min-rank card) as the claimed rank → same path as a manual `place`. Then `_emitChange()`. |
| Challenge window | `_challengeTimer` | `TIMERS.BS_CHALLENGE` = 4s (new constant) | `_resolveNoChallenge()` → advance turn → `_emitChange()`. |
| Reveal ack | `_revealTimer` | 10000ms | Auto-ack all present active players → `_advanceAfterReveal()` → `_emitChange()`. |

Durations: define `TIMERS.BS_CHALLENGE = 4` in `shared/constants.js`; the server uses `TIMERS.BS_CHALLENGE * 1000`. Reveal auto-advance hardcoded `10000` (matches LiarsDice). Turn timer surfaced to client via `turnTimer` in gameList for the visible countdown.

**Turn-timer guard.** Arm in `onEnterPlaying()`; clear at the top of `handleAction` when a valid `place` lands and in `destroy()`. Guard the timeout body with `if (this.state !== 'playing' || this.currentTurnPlayer !== expectedId) return;` to prevent a stale fire from acting on the wrong turn (store the player id the timer was armed for).

**Next-turn rule (concrete).** Maintain a stable seat order = `this.players` order at construction. After any resolution, next turn = first player in seat order *after* `lastPlayerId` (cyclically) who is still in `activePlayers`. Use `_advanceTurnFrom(lastPlayerId)`:

```js
_advanceTurnFrom(anchorId) {
  const seats = this.players;            // post-prune roster
  if (seats.length === 0) return;
  let idx = seats.indexOf(anchorId);
  if (idx === -1) idx = this.turnIndex % seats.length;
  for (let step = 1; step <= seats.length; step++) {
    const cand = seats[(idx + step) % seats.length];
    if (this.activePlayers.includes(cand)) { this.setTurnPlayer(cand); return; }
  }
}
```

`requiredRank` increments by 1 (wrap) on every transition into `playing` from `challengeWindow`/`reveal`.

---

## 8 Scoring & `getResults()`

No internal points — placement only. Tournament Scorer applies base + wager from placement.

```js
getResults() {
  const results = [];
  let placement = 1;
  // 1) finishers in the exact order they emptied
  for (const p of this.finishOrder) {
    results.push({ playerId: p, placement, cardsRemaining: 0 });
    placement++;
  }
  // 2) everyone else (still holding cards) — fewest cards first, ties share placement
  const remaining = this.players
    .filter((p) => !this.finishOrder.includes(p))
    .map((p) => ({ playerId: p, cardsRemaining: (this.hands[p] || []).length }))
    .sort((a, b) => a.cardsRemaining - b.cardsRemaining);

  for (let i = 0; i < remaining.length; i++) {
    if (i > 0 && remaining[i].cardsRemaining !== remaining[i - 1].cardsRemaining) {
      placement = results.length + 1;
    }
    results.push({ playerId: remaining[i].playerId, placement, cardsRemaining: remaining[i].cardsRemaining });
    if (i === remaining.length - 1) break;
  }
  return results;
}
```

- **Formula:** placement 1..N; finishers ranked by finish order, non-finishers by ascending `cardsRemaining`.
- **Tie rule:** consecutive non-finishers with equal `cardsRemaining` share a placement; the next distinct count jumps to `results.length + 1` (skip pattern). Finishers never tie.
- **Guarantee:** `this.players` is fully partitioned into `finishOrder` ∪ remaining → every player appears exactly once.

---

## 9 Leave & deadlock handling

Follows v2.7.0 contract. `removePlayer` = departure (prune roster + rotation + nudge). `_removeFromActive` = elimination/finish (stays scored). `destroy()` clears all timers.

### `removePlayer(playerId)`

```js
removePlayer(playerId) {
  const wasCurrent = this.currentTurnPlayer === playerId;
  const wasClaimant = this.pendingPlay && this.pendingPlay.playerId === playerId;

  // If the leaver holds the turn during 'playing', advance off them first
  // (while still in this.players so seat math is correct).
  if (wasCurrent && this.state === 'playing' && this.players.length > 1) {
    this.requiredRank = ((this.requiredRank) % 13) + 1; // their skipped claim still rotates the cycle
    this._advanceTurnFrom(playerId);
  }

  super.removePlayer(playerId);        // prune this.players + activePlayers + reanchor turn
  delete this.hands[playerId];
  this.acknowledged?.delete(playerId);

  // <=1 remaining -> finish immediately
  if (this.activePlayers.length <= 1 && this.state !== 'finished') {
    this.destroy();
    this.state = 'finished';
    return;
  }

  // Phase-specific nudges:
  if (this.state === 'challengeWindow') {
    if (wasClaimant) {
      // Claimant vanished mid-window: their face-down cards stay on the pile,
      // no one can be the liar/taker -> treat as no-challenge commit + advance.
      if (this._challengeTimer) { clearTimeout(this._challengeTimer); this._challengeTimer = null; }
      this._resolveNoChallenge();
      this._emitChange();
    }
    // else: a potential challenger left; window timer still governs. No action.
  } else if (this.state === 'reveal') {
    // They may have been the last needed ack.
    this._checkRevealAckComplete();
  } else if (this.state === 'playing' && wasCurrent) {
    // Turn already advanced above; rearm via onEnter side already done by _advanceTurnFrom.
    this._emitChange();
  }
}
```

### `_removeFromActive` usage (finish)
Called from `_resolveNoChallenge` / `_advanceAfterReveal` when a player reaches 0 cards: push to `finishOrder`, then `_removeFromActive(id)`. The finisher stays in `this.players` → still scored at their finish placement. They are out of the turn rotation.

### `destroy()`

```js
destroy() {
  for (const t of ['_challengeTimer', '_revealTimer', '_turnTimer']) {
    if (this[t]) { clearTimeout(this[t]); this[t] = null; }
  }
}
```

### Per-phase "what if the needed player leaves" matrix

| Phase | Player who leaves | Handling |
|---|---|---|
| `playing` | current turn player | advance turn off them (`_advanceTurnFrom`), rotate `requiredRank`, rearm turn timer, broadcast. Their hand is discarded (not added to pile). |
| `playing` | non-current | prune only; turn unaffected. |
| `challengeWindow` | the claimant | commit play as no-challenge, clear window timer, advance, broadcast. |
| `challengeWindow` | a non-claimant | window timer keeps running; if they were the only other player and now ≤1 remain → finish. |
| `reveal` | any | drop from `acknowledged`, re-check ack completeness; if they were last-needed, advance. |
| any | leave collapses to ≤1 active | `destroy()` + `state='finished'`; `getResults()` ranks survivor(s) by remaining cards after finishers. |

---

## 10 Client component (`client/src/games/BsCheat.jsx` + `.module.css`)

Props: `{ gameState, nicknames, avatars, onAction }` (matches every other game; `onAction(action)` emits the player action). Uses `PlayerName`, `useSound()`, `useScreenShake()`. Title font `Creepster` (CSS `font-family: 'Creepster', 'Bangers', cursive`).

**Reads from `gameState`:** `phase`, `myHand`, `requiredRank`, `pileCount`, `isMyTurn`, `currentTurnPlayer`, `pendingPlay`, `canCallBS`, `revealResult`, `finished`, `finishOrder`, `otherPlayers`.

**Actions emitted:** `onAction({ type:'place', cards:[indices] })`, `onAction({ type:'callBS' })`, `onAction({ type:'acknowledge' })`, `onAction({ type:'ping' })` (local-timer fallback).

### Per-phase screens

| Phase | UI |
|---|---|
| `playing` (my turn) | Fanned hand at bottom. Big banner: "You must claim **{rankName(requiredRank)}**". Tap cards to toggle-select (1–4); selected cards lift up. "PLAY {n} as {rank}" button enabled when 1–4 selected. 30s countdown ring. |
| `playing` (not my turn) | Dimmed hand (read-only), banner "{nick} is playing {rankName} — pile: {pileCount}". |
| `challengeWindow` | Center pile graphic + announcement "{claimant} played **{claimedCount}** as **{rankName(claimedRank)}**". Giant pulsing **CALL BS!** button (only if `canCallBS`), ≈4s shrinking timer bar. First tap fires `callBS`; lock button after tap. |
| `reveal` | Flip the `revealResult.revealedCards` face-up. Verdict banner: liar → "BS! {claimant} lied — takes {pileSize} cards" (red); truthful → "Clean! {challenger} was wrong — takes {pileSize}" (green). "Got it" → `acknowledge`; 10s auto. |
| `finished` (me) | "You're OUT — you escaped! Placement #{index+1}" celebratory. |
| game over | rankings list from `finishOrder` + remaining. |

`rankName(r)` map: 1→"Aces", 2..10 number+"s", 11→"Jacks", 12→"Queens", 13→"Kings".

### Layout & touch
- Mobile: pile center, hand as horizontally scrollable fan at bottom, CALL BS as full-width sticky button. Tap-to-select (no hover), confirm with PLAY button — touch-safe pattern.
- Desktop: `.gameMainArea` with `margin-left: 220px; width: calc(100% - 220px)` (pet sidebar). Pile centered, opponents arranged as avatar chips with card-count badges around the top.
- Selected-card preview lift; no reliance on hover.

### Sound & shake (`useSound()`, `useScreenShake()`)
- `cardPlay` on place; `voteCast`/`click` on select.
- On `phase` → `challengeWindow`: subtle tick/`emoteSend`.
- On `reveal`: `shake('medium')` + `winRound`/`loseRound` sound depending on whether `socket.id === revealResult.takerId` (taker = loser of that exchange).
- On own finish (`finished` flips true for me): `shake('heavy')` + `casinoWin`.
- Use `useRef` to diff previous `phase`/`pileCount` so sounds fire on transitions only.

### Local timer fallback
Mirror server timers client-side; if a countdown hits 0 and `gameState.phase` hasn't changed, emit `onAction({ type:'ping' })` once.

---

## 11 Registration checklist (8 steps)

1. **Server engine** — create `server/src/games/BsCheat.js` exporting `class BsCheat extends BaseGame` (everything in §3–§9). Use `new Deck()` from `../utils/Deck.js` for the 52-card deal.

2. **`shared/gameList.js`** — add to `GAMES`:
   ```js
   bsCheat: {
     id: 'bsCheat', name: 'BS (Cheat)', minPlayers: 2, maxPlayers: 8,
     turnTimer: TIMERS.CARD_GAME,
     description: 'Bluff your cards away. Call BS to bust the liar — first to empty their hand escapes.',
     instructions: [
       'Cards are dealt evenly and the claimed rank cycles A, 2, 3 … K each turn.',
       'On your turn place 1–4 cards FACE DOWN and claim they are the current rank (e.g. "two Kings").',
       'Other players get a few seconds to call BS. First to call wins the challenge.',
       'If the claim was a lie, the liar takes the whole pile. If it was true, the challenger takes it.',
       'Empty your hand to escape — the last player still holding cards loses. Finish earliest to place highest.',
     ],
   },
   ```

3. **`shared/constants.js`** — add `BS_CHALLENGE: 4` to `TIMERS` (challenge window seconds). Turn uses existing `CARD_GAME: 30`.

4. **`server/src/games/registry.js`** — `import { BsCheat } from './BsCheat.js';` and `registerGame('bsCheat', BsCheat);`.

5. **Client component** — create `client/src/games/BsCheat.jsx` + `client/src/games/BsCheat.module.css` (props `gameState/nicknames/avatars/onAction`; `PlayerName`; `useSound()`; `useScreenShake()`; `Creepster` title font; touch-first selection).

6. **Preview image** — add `client/src/assets/gamepreviews/bsCheat.png` (cards face-down + a "BS!" call-out).

7. **`client/src/App.jsx`** — `import BsCheatGame from './games/BsCheat.jsx';` then add `bsCheat: BsCheatGame,` to `GAME_COMPONENTS`.

8. **`client/src/screens/GameVote.jsx`** — `import previewBsCheat from '../assets/gamepreviews/bsCheat.png';` then add `bsCheat: previewBsCheat,` to `GAME_PREVIEWS`.

Also: bump `shared/version.js` (minor), commit, push, tell the user the new version. Update CLAUDE.md mini-games table (13 games) + fonts table (`BS (Cheat)` → `Creepster`).

---

## 12 Edge cases & test scenarios (harness assertions)

Construct with mock player ids; drive via `handleAction` and timer fast-forward (`destroy` + manual calls to the `_resolve*`/`_advanceAfter*` helpers, or fake timers).

**Core flow**
1. 4 players, deal: total cards = 52; per-player counts differ by ≤1; union of hands has no duplicate card; `requiredRank === 1`, `state === 'playing'`, turn = `players[0]`.
2. Valid `place` of 2 cards → `state === 'challengeWindow'`, `pendingPlay.claimedCount === 2`, pile grew by 2, hand shrank by 2.
3. Window times out with no call → next player's turn, `requiredRank` wrapped +1, pile unchanged.
4. Truthful play + `callBS` → challenger's hand grows by `pileSize`, pile empties, `revealResult.liar === false`, `takerId === challenger`.
5. Lying play + `callBS` → claimant takes pile, `revealResult.liar === true`, `takerId === claimant`.
6. `requiredRank` wraps 13 → 1 after a King turn.

**Finish / results**
7. Player empties hand via un-challenged play → on window resolve they enter `finishOrder`, `_removeFromActive` called, still in `this.players`.
8. Player empties via truthful-but-challenged play (pile went to challenger) → still finishes.
9. Last two players: one empties → game `finished`; `getResults()` length === N, placements `1..N`, finisher placement 1, the lone non-finisher last.
10. `getResults()` covers every `this.players` id exactly once; ties among equal-card non-finishers share a placement; next distinct count uses skip pattern.

**Leave / deadlock**
11. Current player leaves during `playing` → turn advances to next active, `requiredRank` rotated, timer rearmed, no crash; their hand discarded.
12. Claimant leaves during `challengeWindow` → play committed as no-challenge, turn advances, `_emitChange` fired, no orphan window timer.
13. The only eligible challenger leaves during `challengeWindow`, leaving ≤1 active → `state === 'finished'`.
14. A player leaves during `reveal` who was the last-needed ack → `_advanceAfterReveal` runs, game progresses (no deadlock).
15. Players leave until 1 remains, in every phase → `state === 'finished'`, `destroy()` cleared all three timers (assert each is null).
16. `destroy()` after game over leaves no pending timers (spy on `clearTimeout`).
17. JSON round-trip: `acknowledged` membership checks tolerate string ids; `requiredRank`/`pileCount` survive serialization.

**Timeout auto-actions**
18. Turn timer expiry auto-plays the lowest single card as `requiredRank`, advances to `challengeWindow`.
19. Reveal timer expiry auto-acks all present active players and advances.
20. Stale turn-timer fire after a manual `place` is a no-op (guard on armed player id).

---

## 13 Effort & risks

**Effort: M** (medium). Server engine is squarely in the LiarsDice family (turn + challenge-window + reveal/ack + reveal-on-challenge) plus Uno's empty-hand finish — both already in-repo to copy from. Client is one component with four phase screens; no canvas, no new infra.

Dependencies: `utils/Deck.js` (exists), `Scorer` tie handling (exists), `TIMERS.BS_CHALLENGE` (new, trivial), Google Font `Creepster` (add `<link>` if not already loaded). No new server libs, no external APIs.

Risks / watch-items:
- **Challenge-window race:** first-call-wins must be enforced purely by the `challengeWindow→reveal` state guard; concurrent `callBS` from two players → second sees `state==='reveal'` and is rejected. Verify under the orchestration's single-threaded event loop (safe) and that `_challengeTimer` is cleared the instant a call lands.
- **Empty-hand-but-challengeable:** a player who plays their last cards is NOT finished until the window/reveal resolves — must not finish them in `handleAction('place')`. Easy to get wrong; covered by tests 7–8.
- **Timer/teardown hygiene:** three timers; every advance path must pair mutation with `_emitChange()` and every finish/leave path must clear timers (test 15–16). This is the #1 deadlock source per the project's lessons.
- **requiredRank cycle desync:** rule is "advance +1 on every entry into `playing`" — keep it unconditional so all clients agree without server pushing per-turn rank separately (it's also in `gameState.requiredRank`).

---

## 14 Open questions

1. **Rank selection variant.** This spec uses the *rotating claim* (rank forced to `requiredRank`, classic "Cheat" sequence). The alternative is *free claim* (player names any rank). Rotating is simpler, deadlock-friendlier, and matches the brief ("Claimed rank increments each turn, wrap"). Confirm we keep rotating-only (so the `place` payload's `claimedRank` is ignored).
2. **Challenge window length.** 4s (`TIMERS.BS_CHALLENGE`). Too short for slow players, too long stalls pace. Tune 3–5s after playtest; expose as constant either way.
3. **Multiple simultaneous claims of same last cards.** Not applicable — strictly one claimant per turn. Confirmed.
4. **Should the taker play next, or strict clockwise?** Spec uses strict clockwise from `lastPlayerId` (deterministic, leave-safe). Classic Cheat often gives the loser of the challenge the next turn — flag if owner prefers that (would tweak `_advanceTurnFrom` anchor).
5. **Pile cap / stalemate.** With a single 52-card deck and forced 1–4 placement there's no true draw pile to exhaust (you place from hand), so no Uno-style reshuffle/stalemate is possible — the game always resolves to one player holding everything. Confirm no max-rounds safety cap is wanted; if desired, add a generous turn-count cap that triggers `finish` and ranks by remaining cards.
6. **Preview art** — needs a `bsCheat.png` asset produced before the GameVote tile renders (placeholder acceptable for first build).
