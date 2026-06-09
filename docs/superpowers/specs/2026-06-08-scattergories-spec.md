# Scattergories — Implementation Spec

Slug: `scattergories` · Type: simultaneous · Players: 2–8 · Rounds: 3 · Status: build-ready

This spec targets the v2.7.0 leave/deadlock contract (`BaseGame._removeFromActive` vs `removePlayer` vs `destroy`) and follows the simultaneous-game patterns proven in `RockPaperScissors.js` and `SpotTheDifference.js` (auto-submit/auto-ack for leavers, `setOnStateChange`/`_emitChange` for timer broadcasts, reveal/ack 10s auto-advance).

---

## 1 Overview

- **Name:** Scattergories
- **Players:** 2–8
- **Type:** Simultaneous (all players write at once, no turn rotation)
- **Length:** 3 rounds. Each round = one random letter + a fixed list of ~10 categories.
- **Per-round flow:** server reveals letter + categories → all players type one answer per category within ~75s → server reveals everyone's answers and scores uniqueness → ack → next round.
- **Goal:** Highest total unique-answer points across all 3 rounds.
- **Title font:** `'Bungee'` (primary) with `'Lilita One'` fallback — bold, blocky, playful. Loaded via Google Fonts in the `.jsx`/`.module.css`, scoped to the title only (per project font convention).
- **Out of scope (future):** peer-challenge / voting on dubious answers. v1 uses a pure mechanical rule (non-empty + starts-with-letter + unique). Noted in §14.

---

## 2 Tournament fit

`getResults()` must rank **all N players every round** (N = 2–8) so the tournament `Scorer` can assign placement points (`PLACEMENT_MULTIPLIERS = [1.0, 0.7, 0.5, 0.35, 0.25, 0.15]`).

- Every player in `this.players` appears in the returned array with a `placement`.
- Sort by `totalScore` descending; secondary tiebreak by `totalAnswers` (count of scoring answers) descending — purely for stable ordering, ties still **share** placement.
- **Tie rule** (same pattern as RPS/StD): walk the sorted list, only bump `placement` to `i+1` when the current player's `totalScore` is strictly less than the previous player's. Equal scores → identical placement number. `Scorer.calculateRoundScores` reads these placements via its `placementMap`, so shared placements flow correctly into base + wager math.
- A leaver who never submitted contributes **0** and ranks last (still included so N stays consistent). See §9.

---

## 3 FSM (state × action → next)

States: `waiting`, `writing`, `reveal`, `finished`. Mirrors RPS's `waiting/round/reveal/finished` shape.

| State \ Action | `start` | `submit` (player) | `revealNow` (internal) | `acknowledge` | `next` | `finish` |
|----------------|---------|-------------------|------------------------|---------------|--------|----------|
| `waiting`      | `writing` | —                | —                      | —             | —      | —        |
| `writing`      | —       | `writing` (stays) | `reveal`               | —             | —      | —        |
| `reveal`       | —       | —                | —                      | `reveal` (stays) | `writing` | `finished` |
| `finished`     | —       | —                | —                      | —             | —      | —        |

Notes:
- `submit` does **not** transition state — it records/locks one player's answers. When the **last** un-submitted player submits, the engine internally fires `transition('revealNow')`.
- `acknowledge` does not transition — when all remaining players have acked (or the 10s timer fires), the engine fires `next` (more rounds left) or `finish` (last round).
- Only the FSM-registered transition names live in `fsmConfig.transitions`: `waiting.start`, `writing.revealNow`, `reveal.next`, `reveal.finish`.

**onEnter hooks** (auto-invoked by `BaseGame.transition` as `onEnter<State>`):
- `onEnterWriting()` — increment `round`, pick letter + categories, clear `answers`/`submitted`, start the 75s write timer, record `_writeStartTime`.
- `onEnterReveal()` — clear write timer, score the round into `scores`, push to `roundHistory`, reset `acknowledged`, start the 10s ack timer.
- `onEnterFinished()` — clear all timers (defensive; `destroy()` also does this).

---

## 4 Server state (fields)

File: `server/src/games/Scattergories.js`, class `Scattergories extends BaseGame`.

```js
this.round           // number, 0 before first round, 1..TOTAL_ROUNDS
this.totalRounds     // = TOTAL_ROUNDS (3)
this.letter          // current uppercase letter, e.g. 'S'
this.categories      // string[] of ~10 category labels for this round
this.answers         // { [playerId]: { [categoryIndex]: string } } — submitted, locked
this.submitted       // Set<playerId> of players who have locked this round
this.scores          // { [playerId]: totalUniquePoints } cumulative across rounds
this.roundScores     // { [playerId]: pointsThisRound } reset each round
this.roundResult     // last round's scored breakdown (see §8), null during writing
this.acknowledged    // Set<playerId> for the reveal phase
this.roundHistory    // [{ round, letter, categories, perPlayer:{...}, roundScores:{...} }]
this._writeStartTime // Date.now() when writing began (drives client countdown)
this._writeTimer     // setTimeout handle (75s)
this._ackTimer       // setTimeout handle (10s)
this._onStateChange  // broadcast callback from setOnStateChange
```

Constants at top of file:
```js
const TOTAL_ROUNDS = 3;
const WRITE_TIMER_MS = TIMERS.SCATTERGORIES * 1000; // 75_000
const ACK_TIMER_MS = 10_000;
const CATEGORIES_PER_ROUND = 10;
const LETTERS = 'ABCDEFGHIKLMNPRSTW'.split(''); // drop hard letters Q/U/V/X/Y/Z/J/O
```

Static category bank (sample — ship ~40 so rounds vary; pick `CATEGORIES_PER_ROUND` at random without repeats per round):
```js
const CATEGORY_BANK = [
  'Animal', 'A boy\'s name', 'A girl\'s name', 'Food', 'City', 'Country',
  'Movie or TV show', 'Something cold', 'Job or profession', 'Sport or hobby',
  'Color', 'Body part', 'Things in a kitchen', 'Famous person', 'Brand or company',
  'School subject', 'Something you wear', 'A drink', 'Cartoon character', 'Vehicle',
  'Something found at the beach', 'Board game or video game', 'Musical instrument',
  'A fruit or vegetable', 'Reason to be late', 'Things that are sticky', 'Toy',
  'A place to live', 'Something in this room', 'A type of weather',
  'Holiday or celebration', 'Things you shout', 'A fictional villain',
  'An item in your fridge', 'A flower or plant', 'A song title', 'Things at a party',
  'A piece of furniture', 'Something electronic', 'A book title',
];
```

Letter + category selection per round (in `onEnterWriting`):
```js
this.letter = randomFrom(LETTERS);
this.categories = shuffle([...CATEGORY_BANK]).slice(0, CATEGORIES_PER_ROUND);
```
Use `server/src/utils/shuffle.js` if present; otherwise inline Fisher–Yates (as `SpotTheDifference` does).

---

## 5 Actions (`handleAction(playerId, action)`)

Guard at the top of every branch: `if (!this.players.includes(playerId)) return;` (matches RPS/StD). No turn guards — simultaneous game, any active player may act in the appropriate phase.

### `submit` — phase `writing`
- **Payload:** `{ type: 'submit', answers: { [categoryIndex]: string } }`. `categoryIndex` keys are stringified over Socket.IO — read defensively as `answers[i] ?? answers[String(i)]`.
- **Validation:**
  - Phase must be `writing`; else ignore.
  - Player must not already be in `this.submitted` (locks are final — no re-submit).
  - Coerce each entry: trim, cap length at 40 chars, drop non-string values. Missing categories default to `''`.
  - Store **only** what the player sent — a player who never submits has **no** entry in `this.answers` (critical for the leave rule, §9).
- **Effects:**
  - `this.answers[playerId] = sanitized`; `this.submitted.add(playerId)`.
  - If `this.players.every(p => this.submitted.has(p))` → `this.transition('revealNow')` (fires `onEnterReveal`, which scores + starts ack timer). The caller in `index.js` broadcasts afterward.
- **Timeout note:** if the 75s timer already fired but state hasn't advanced (race), the safety check in `writing` force-reveals (see §7), mirroring StD's stale-timer guard.

### `acknowledge` — phase `reveal`
- **Payload:** `{ type: 'acknowledge' }`.
- **Effects:** `this.acknowledged.add(playerId)`; if all remaining players have acked → `_advanceAfterReveal()` (fires `next` or `finish`). Same as RPS `_checkRevealComplete`.

### `ping` — any phase
- No-op for state, but allowed so the client's local-timer-expiry ping still triggers a state rebroadcast in `index.js`. In `writing`, treat the same as the stale-timer safety check.

Unknown action types: ignored (no throw).

---

## 6 `getStateForPlayer(playerId)`

Hidden-info rule: **never reveal another player's answers or even whether a category is filled until `reveal`/`finished`.** Only expose each player's own draft echo + a boolean "has locked" flag for others during `writing`.

```js
{
  phase: this.state,                 // 'writing' | 'reveal' | 'finished' (waiting only transiently)
  round: this.round,
  totalRounds: this.totalRounds,
  letter: this.letter,
  categories: this.categories,       // string[]
  writeEndTime: this.state === 'writing' && this._writeStartTime
    ? this._writeStartTime + WRITE_TIMER_MS : null,   // client computes countdown
  writeDurationSec: WRITE_TIMER_MS / 1000,
  myId: playerId,
  myAnswers: this.answers[playerId] ?? {},   // echo own locked answers (empty if not submitted)
  hasSubmitted: this.submitted.has(playerId),
  scores: { ...this.scores },                // cumulative totals (safe to show — no answer content)
  submittedCount: this.submitted.size,
  totalPlayers: this.players.length,
  // Other players: ONLY a lock flag during writing; full reveal at reveal/finished.
  otherPlayers: this.players.filter(p => p !== playerId).map(p => ({
    playerId: p,
    hasSubmitted: this.submitted.has(p),
    score: this.scores[p] || 0,
    answers: (this.state === 'reveal' || this.state === 'finished')
      ? (this.answers[p] ?? {}) : null,      // hidden until reveal
  })),
  // Full scored breakdown only after reveal:
  roundResult: (this.state === 'reveal' || this.state === 'finished')
    ? this.roundResult : null,
  roundHistory: this.roundHistory,
}
```

`roundResult` shape (built in scoring, §8): per-category, per-player flags so the client can color answers green (unique → scored), grey (duplicate → 0), red (invalid/empty → 0).

---

## 7 Timers & broadcasting

Register the broadcast callback exactly like RPS/StD:
```js
setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }
```
`index.js` registers `setOnStateChange` and, on each emit, broadcasts filtered state to every player **and** calls `game.isComplete()` to auto-finish the round. Every timer callback below ends with `this._emitChange()`.

- **Write timer — 75s** (`TIMERS.SCATTERGORIES`). Started in `onEnterWriting`. On fire:
  ```js
  this._writeTimer = setTimeout(() => {
    if (this.state !== 'writing') return;        // guard double-fire
    // anyone who didn't submit gets auto-locked with whatever the engine has = nothing
    this.transition('revealNow');                // scores + starts ack timer
    this._emitChange();
  }, WRITE_TIMER_MS);
  ```
  Auto-action on timeout = treat all non-submitters as having submitted **empty** (they simply have no `answers` entry → contribute 0). No forced default text.
- **Stale-timer safety in `writing`** (handleAction): if `Date.now() >= this._writeStartTime + WRITE_TIMER_MS` and still `writing`, call the reveal path before processing the action — mirrors StD's guard so a late client can't get stuck.
- **Ack timer — 10s.** Started in `onEnterReveal`. On fire: add all remaining players to `acknowledged`, call `_advanceAfterReveal()`, then `_emitChange()`. Same construction as RPS `_startRevealTimer`.
- `_advanceAfterReveal()`: guard `if (this.state !== 'reveal') return;`, clear timers, then `this.round >= this.totalRounds ? transition('finish') : transition('next')` (which re-enters `writing`).

All timers cleared in `_clearTimers()` and in `destroy()` (§9).

---

## 8 Scoring & `getResults`

**Per-answer rule (v1, mechanical):** an answer for category `c` by player `p` scores **1 point** iff:
1. non-empty after trim, AND
2. first alphabetic character (case-insensitive) equals `this.letter`, AND
3. it is **unique** among all players for that category — no other player submitted a case-insensitive-equal, whitespace-normalized answer for the same category. Duplicates → **0 for everyone** who shares that answer.

Articles like a leading "the "/"a "/"an " are stripped before the starts-with check and before the duplicate comparison so "The Sun" matches letter S and dedupes against "sun".

Scoring routine (in `onEnterReveal`, before transitioning out):
```js
const norm = (s) => s.trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
const startsOk = (s) => {
  const m = norm(s).match(/[a-z]/);            // first letter char
  return m && m[0] === this.letter.toLowerCase();
};
this.roundResult = { letter: this.letter, categories: this.categories, perPlayer: {} };
for (const p of this.players) this.roundScores[p] = 0;

for (let c = 0; c < this.categories.length; c++) {
  // bucket normalized answers per category
  const counts = {};
  for (const p of this.players) {
    const raw = (this.answers[p]?.[c] ?? this.answers[p]?.[String(c)] ?? '').toString();
    if (raw.trim() && startsOk(raw)) {
      const key = norm(raw);
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  for (const p of this.players) {
    const raw = (this.answers[p]?.[c] ?? this.answers[p]?.[String(c)] ?? '').toString();
    const valid = raw.trim() && startsOk(raw);
    const unique = valid && counts[norm(raw)] === 1;
    if (unique) { this.scores[p] = (this.scores[p]||0) + 1; this.roundScores[p] += 1; }
    (this.roundResult.perPlayer[p] ||= {})[c] =
      { text: raw, status: !raw.trim() ? 'empty' : !valid ? 'invalid' : unique ? 'scored' : 'dup' };
  }
}
this.roundHistory.push({ round: this.round, letter: this.letter,
  roundScores: { ...this.roundScores } });
```

**`getResults()`** — ranks all N (ties share placement, RPS pattern):
```js
getResults() {
  const sorted = [...this.players].sort((a, b) =>
    (this.scores[b]||0) - (this.scores[a]||0));
  let placement = 1;
  return sorted.map((playerId, i) => {
    if (i > 0 && (this.scores[playerId]||0) < (this.scores[sorted[i-1]]||0)) {
      placement = i + 1;
    }
    return { playerId, placement, score: this.scores[playerId]||0,
      handDescription: `${this.scores[playerId]||0} unique answers` };
  });
}
```
`isComplete()` → `this.state === 'finished'`.

---

## 9 Leave & deadlock handling

The engine stores answers **only on submit**, so a player who leaves before submitting has no `answers` entry and automatically contributes 0 — no auto-fill needed. The `removePlayer` override prunes them, then re-checks the active phase so the game never waits on a ghost.

```js
removePlayer(playerId) {
  super.removePlayer(playerId);                  // prunes this.players + rotation
  this.submitted.delete(playerId);
  this.acknowledged.delete(playerId);
  delete this.answers[playerId];                 // discard any partial (they leave = no contribution)

  if (this.players.length <= 1) {                // orchestration force-completes the round
    this._clearTimers();
    if (this.state !== 'finished') this.state = 'finished';
    return;
  }
  if (this.state === 'writing') {
    // maybe they were the last un-submitted player
    if (this.players.every(p => this.submitted.has(p))) {
      this.transition('revealNow');              // scores + starts ack timer
    }
  } else if (this.state === 'reveal') {
    this.acknowledged.add(playerId);             // auto-ack the leaver
    if (this.players.every(p => this.acknowledged.has(p))) {
      this._advanceAfterReveal();
    }
  }
}
```

- `_removeFromActive(id)` is **not** used by Scattergories for leaving — there's no elimination/rotation concept (simultaneous). It exists on the base class only; we rely on `removePlayer` for departures.
- `destroy()` clears every timer so an orphaned `setTimeout` can't fire after teardown:
  ```js
  destroy() { this._clearTimers(); this._onStateChange = null; }
  _clearTimers() {
    if (this._writeTimer) { clearTimeout(this._writeTimer); this._writeTimer = null; }
    if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; }
  }
  ```

**Phase-by-phase: who can be the "last needed" player and what happens**
- **writing, current/any player leaves, others still writing:** prune; if remaining all submitted → reveal; else keep writing (timer still bounds it). No deadlock.
- **writing, the last un-submitted player leaves:** the `every(submitted)` check fires → immediate reveal. No waiting on a gone player.
- **reveal, a non-acked player leaves:** auto-ack; if that was the last needed ack → advance. No stuck reveal.
- **down to 1 player at any phase:** `_clearTimers()` + force `finished`; orchestration ends the round/tournament with the survivor. Matches StD's `<= 1` handling.
- All `setTimeout`-driven advances pair with `_emitChange()` so the broadcast + `isComplete()` re-check always run.

---

## 10 Client component

Files: `client/src/games/Scattergories.jsx` + `Scattergories.module.css`. Props: `{ gameState, nicknames, avatars, onAction }`. Use `PlayerName`, `useSound()`, optional `useScreenShake()`.

Read from `gameState`: `phase`, `round`, `totalRounds`, `letter`, `categories`, `writeEndTime`, `myAnswers`, `hasSubmitted`, `submittedCount`, `totalPlayers`, `otherPlayers`, `roundResult`, `scores`.

**Phase screens:**
- **writing:** Big letter badge (font `'Bungee'`) + round `X / 3`. A countdown bar driven by `writeEndTime` (recompute each tick; when it hits 0, emit `{ type: 'ping' }` once). A vertical list of `categories`, each with a text `<input>` bound to local `draft[c]`. A "Submit answers" button → `onAction({ type: 'submit', answers: draft })`; after submit, lock inputs, show "Waiting for others… (submittedCount/totalPlayers)". Inputs use `inputMode="text"`, `autoCapitalize="words"`, large 44px tap targets, no hover-only affordances (touch support).
- **reveal:** Grid/table: rows = categories, columns = players (`PlayerName` headers with avatars). Each cell colored by `roundResult.perPlayer[pid][c].status` → green `scored`, grey `dup`, red `invalid`/`empty`. Show per-player round points + cumulative `scores`. "Continue" button → `onAction({ type: 'acknowledge' })`; auto-advances at 10s regardless.
- **finished:** brief standings recap before the screen unmounts (round results screen takes over).

**Sound:** `playSound('click')` on submit/continue; a tick or `vote` sound when the round reveal lands; `winRound`/`loseRound` cues optional on reveal based on whether you topped the round. **Shake:** light `shake('light')` when your submission locks in or when you score the round's only unique answer in a category (optional flourish). Keep subtle per project conventions.

**Layout:** respect `.gameMainArea` sizing (pet sidebar `margin-left: 220px`, `width: calc(100% - 220px)` on desktop). Single-column category list on mobile; reveal table horizontally scrollable on narrow screens.

---

## 11 Registration checklist (8 steps)

1. **Server game** — create `server/src/games/Scattergories.js` (class `Scattergories extends BaseGame`, all of §3–§9).
2. **`shared/gameList.js`** — add to `GAMES`:
   ```js
   scattergories: {
     id: 'scattergories', name: 'Scattergories', minPlayers: 2, maxPlayers: 8,
     turnTimer: TIMERS.SCATTERGORIES,
     description: 'One letter, ten categories. Be the only one with each answer.',
     instructions: [
       'Each round a random letter and 10 categories appear.',
       'Type one answer per category that STARTS with the letter, before the 75-second timer runs out.',
       'An answer scores 1 point only if it is valid AND unique — if two or more players write the same thing, nobody gets the point.',
       'Empty answers and answers that do not start with the letter score 0.',
       'There are 3 rounds. Highest total of unique answers wins!',
     ],
   },
   ```
3. **`shared/constants.js`** — add `SCATTERGORIES: 75` to `TIMERS`.
4. **`server/src/games/registry.js`** — `import { Scattergories } from './Scattergories.js';` then `registerGame('scattergories', Scattergories);` (match the existing import + register pattern in that file).
5. **Client component** — `client/src/games/Scattergories.jsx` + `Scattergories.module.css` (props `gameState/nicknames/avatars/onAction`; `PlayerName`; `useSound()`; title font `'Bungee'`/`'Lilita One'`; touch support).
6. **Preview image** — `client/src/assets/gamepreviews/scattergories.png`.
7. **`client/src/App.jsx`** — import `Scattergories` and add `scattergories: Scattergories` to `GAME_COMPONENTS`.
8. **`client/src/screens/GameVote.jsx`** — import the preview and add `scattergories: scattergoriesPreview` to `GAME_PREVIEWS`.

Also bump `shared/version.js` (minor) and update CLAUDE.md (games table → 13 games, new font row "Scattergories | Bungee").

---

## 12 Edge cases & test scenarios

Harness = construct `new Scattergories([p1,p2,p3])`, call `startGame()`, drive `handleAction`/`removePlayer`, assert.

1. **All-N submit → reveal:** every player submits → state `reveal`, `roundResult` non-null, ack timer running.
2. **Timer expiry with non-submitters:** one player never submits; fire write timer → reveal; their answers absent → they score 0 that round.
3. **Duplicate kills points:** p1 and p2 both answer "Snake" for category c → both `status:'dup'`, neither gains; p3's unique "Salmon" scores 1.
4. **Wrong letter / empty:** answer not starting with `letter` → `status:'invalid'`, 0; empty → `status:'empty'`, 0.
5. **Article stripping:** "The Sun" with letter S → valid; dedupes against "sun".
6. **Tie placements:** two players finish equal total → `getResults()` gives both the same `placement`; next player gets `i+1`. Assert all N present.
7. **Leave while writing (not last):** `removePlayer(p2)` mid-writing with p1,p3 still typing → game stays `writing`, p2 gone from `players`, no crash.
8. **Leave is the last un-submitted player:** p1,p3 submitted, p2 (only one left) leaves → auto-reveal fires.
9. **Leave during reveal before acking:** `removePlayer` auto-acks; if last needed ack → advances. No stuck reveal.
10. **Leave down to 1:** state → `finished`, all timers cleared; assert no timer fires afterward (advance fake timers, expect no double-transition).
11. **`destroy()` after finish:** call `destroy()`, advance timers → no `_emitChange`, no throw.
12. **Stale write timer + late action:** simulate `Date.now()` past write end while still `writing`, then a late `submit` → safety guard reveals first; no double-score (round only scored once — guard `if (this.state !== 'writing') return` in the timer and `onEnterReveal` runs once per round).
13. **JSON key coercion:** submit `answers` with string keys (`{"0":"Sun"}`) → scoring reads them via `answers[c] ?? answers[String(c)]`.
14. **No re-submit:** second `submit` from same player ignored (already in `this.submitted`).

---

## 13 Effort & risks

- **Overall: M.** Server engine is straightforward (no rotation, no hidden per-turn state); the only real logic is the uniqueness scoring pass. Client reveal table is the bulk of UI work.
- **Server: S–M.** Reuses RPS/StD timer + leave skeletons almost verbatim. Risk: normalization rule edge cases (articles, accents, multi-word) — keep v1 conservative.
- **Client: M.** Reveal grid with per-cell coloring + responsive horizontal scroll for 8 players × 10 categories is the fiddly part. Touch inputs are routine.
- **Deps:** `TIMERS.SCATTERGORIES` (new), `shuffle` util (existing or inline), `PlayerName`, `useSound`, fonts `'Bungee'`/`'Lilita One'` (add Google Fonts link). No new server packages.
- **Risk — duplicate fairness:** purely-mechanical dedupe will occasionally punish legitimately different phrasings ("New York" vs "NYC"). Acceptable for v1; peer-challenge (future) mitigates.
- **Risk — empty rounds:** with a hard letter, many categories may be blank. Letter pool already excludes Q/U/V/X/Y/Z/J/O to reduce this.

---

## 14 Open questions

1. **Points per answer:** v1 = 1 point per unique valid answer (max 10/round). Should valid-but-duplicate award a small consolation (e.g. 0.5)? Default: no — duplicates = 0, classic Scattergories.
2. **Peer challenge (future):** add a post-reveal `challenge` phase where players flag bogus answers and the table votes. Out of scope here; FSM would gain a `challenge` state between `reveal` and `next`.
3. **Round count / timer tuning:** 3 rounds × 75s. Confirm 75s feels right for 10 categories; could scale categories down to 8 for snappier play.
4. **Letter pool:** is excluding O/J too aggressive? Tune `LETTERS` after playtest.
5. **Category bank size:** ship ~40 (above). More variety lowers repeat-category odds across a 3-round game; can grow freely without code changes.
6. **Normalization depth:** strip accents/punctuation too, or keep the simple lowercase+article-strip? Default: simple, to avoid over-merging distinct answers.
