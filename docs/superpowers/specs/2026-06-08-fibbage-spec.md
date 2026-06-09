# Fibbage — Implementation Spec

Slug: `fibbage` · Build-ready spec for the "Game The Game" platform. Turn-based bluff-trivia mini-game extending `BaseGame`.

---

## 1 Overview

- **Players:** 3–8 (needs ≥3 so there is at least one decoy fake to vote on besides the truth; below 3 voting is trivial).
- **Type:** Round-based, two-phase-per-round (WRITE simultaneous-submit → VOTE simultaneous-submit), with a REVEAL acknowledgement between rounds. Not strictly turn-rotated — every player acts each phase — but classified TURN-BASED per brief (phase-gated, all players act, no real-time input). Server-authoritative FSM.
- **Length:** `TOTAL_ROUNDS = 4` prompts per game (tunable 3–5). Each prompt = one full WRITE→VOTE→REVEAL cycle.
- **Goal:** Fool others with a fake answer to the obscure question, while spotting the real answer yourself.
- **Title font:** `'Shrikhand'` (primary), fallback `'Fredoka One'`, then `cursive`. Loaded via Google Fonts in `index.html`.
- **Scoring constants:** `POINTS_TRUTH = 1000` (you found the real answer), `POINTS_FOOL = 500` (per other player who picked YOUR fake).

---

## 2 Tournament fit

`getResults()` ranks **all N players** every round, sorted by total fibbage points descending. Ties share a placement number (the standard `if (i > 0 && score < prev) placement = i + 1;` pattern). Placement 1..N feeds `Scorer.calculateRoundScores` via `gameResults` (placement map), which applies `PLACEMENT_MULTIPLIERS = [1.0, 0.7, 0.5, 0.35, 0.25, 0.15]`. Departed players are pruned from `this.players` by `removePlayer` so they are not ranked. Every returned object: `{ playerId, placement, score, foolCount, foundTruthCount }`.

---

## 3 FSM (state × action → next)

States: `waiting`, `writing`, `voting`, `reveal`, `finished`.

| State \ action | `start` | `vote` (internal) | `reveal` (internal) | `next` | `finish` |
|----------------|---------|-------------------|---------------------|--------|----------|
| `waiting`      | `writing` | — | — | — | — |
| `writing`      | — | `voting` | — | — | `finished` (≤1 left) |
| `voting`       | — | — | `reveal` | — | `finished` (≤1 left) |
| `reveal`       | — | — | — | `writing` | `finished` |

Transition labels passed to `transition(label)` — internal labels (`vote`, `reveal`, `next`, `finish`) are NOT player action `type`s; they are fired by server logic. Player `action.type`s are `submitFake`, `castVote`, `acknowledge` (see §5).

`transitions` config:
```js
{
  waiting: { start: 'writing' },
  writing: { vote: 'voting', finish: 'finished' },
  voting:  { reveal: 'reveal', finish: 'finished' },
  reveal:  { next: 'writing', finish: 'finished' },
}
```

**onEnter hooks** (BaseGame auto-invokes `onEnter<State>`):
- `onEnterWriting()` — `_beginPrompt()`: increment `promptIndex`, pull next prompt from bank, reset `fakes = {}`, `votes = {}`, `revealData = null`, `acknowledged = new Set()`, start WRITE timer.
- `onEnterVoting()` — `_buildBallot()`: assemble shuffled option list (all fakes + truth), reset votes, start VOTE timer.
- `onEnterReveal()` — `_resolveVotes()`: compute per-option voters, award points, build `revealData`, reset `acknowledged`, start REVEAL auto-advance timer.
- (no `onEnterFinished`; `destroy()` clears timers, orchestration finalizes.)

---

## 4 Server state (fields)

File: `server/src/games/Fibbage.js`.

```js
this.scores            // { [playerId]: number }  — cumulative fibbage points
this.foolCounts        // { [playerId]: number }  — total players fooled across game (for results tiebreak/display)
this.foundTruthCounts  // { [playerId]: number }  — times this player picked the truth
this.promptIndex       // 0-based; -1 before first prompt
this.totalRounds       // = TOTAL_ROUNDS (4)
this.bank              // shuffled copy of PROMPT_BANK at construction
this.prompt            // current { prompt, answer, alts[] } (alts = also-acceptable truths, used only for fake-dup rejection)
this.fakes             // { [playerId]: string }  — this round's submitted fakes (raw text, trimmed)
this.votes             // { [playerId]: string }  — playerId -> optionId they voted for
this.ballot            // [{ optionId, text, kind: 'fake'|'truth', authorId|null }] shuffled (authorId hidden from clients until reveal)
this.revealData        // { options:[{optionId,text,kind,authorId,voters:[pid]}], truthOptionId, awards:{[pid]:{found,fooled,gained}} } | null
this.acknowledged      // Set<playerId> — reveal acks
this._writeTimer       // setTimeout handle
this._voteTimer        // setTimeout handle
this._revealTimer      // setTimeout handle
this._onStateChange    // broadcast cb (set via setOnStateChange)
```

`setOnStateChange(cb)` / `_emitChange()` identical to LiarsDice/RPS.

`PROMPT_BANK` is a module-level array of `{ prompt, answer, alts }` (≥40 entries to avoid repeats; sampled without replacement per game). Example entries:
```js
{ prompt: 'In 2016, a town in Spain accidentally elected a ____ as honorary mayor.', answer: 'goat', alts: [] },
{ prompt: 'The world record for most ____ caught in the mouth in one minute is 94.', answer: 'grapes', alts: ['grape'] },
```
`alts` are alternate spellings/synonyms of the truth — a submitted fake matching any alt (case-insensitive) is rejected as too close to truth.

---

## 5 Actions (`handleAction(playerId, action)`)

Guard at top: `if (!this.players.includes(playerId)) return;`

### `submitFake` — state must be `writing`
- **Payload:** `{ type: 'submitFake', text: string }`
- **Validation:**
  - `if (this.state !== 'writing') return;`
  - `if (this.fakes[playerId] !== undefined) return;` (one fake per player; no resubmit)
  - `const t = String(text || '').trim().slice(0, 80);` reject empty: `if (!t) return;`
  - **Reject if equals truth:** `if (this._matchesTruth(t)) return;` — case-insensitive compare against `prompt.answer` and every `prompt.alts`.
  - **Reject if duplicate of an existing fake:** `if (this._duplicateFake(t, playerId)) return;` — case-insensitive vs other players' submitted fakes. (Server may instead silently de-dup by appending a marker; brief says reject — return without storing; client shows "too close, try another".)
- **Effects:** `this.fakes[playerId] = t;` then `_checkWriteComplete()`.
- **Turn guard:** none (simultaneous). Completion when **every** `p in this.players` has a fake → `transition('vote')`.

### `castVote` — state must be `voting`
- **Payload:** `{ type: 'castVote', optionId: string }`
- **Validation:**
  - `if (this.state !== 'voting') return;`
  - `if (this.votes[playerId] !== undefined) return;`
  - option must exist in `this.ballot`: `const opt = this.ballot.find(o => o.optionId === optionId); if (!opt) return;`
  - **May NOT vote for own fake:** `if (opt.kind === 'fake' && opt.authorId === playerId) return;`
- **Effects:** `this.votes[playerId] = optionId;` then `_checkVoteComplete()`.
- **Turn guard:** none. Completion when **every** `p in this.players` has voted → `transition('reveal')`.

### `acknowledge` — state must be `reveal`
- **Payload:** `{ type: 'acknowledge' }`
- **Effects:** `this.acknowledged.add(playerId);` then `_checkRevealComplete()`.
- Completion when every present player acked → advance to next prompt or finish.

### `ping` (client fallback)
- If client local timer hits 0 and server hasn't transitioned, client may send `{ type: 'ping' }`. Server ignores unless a timer should already have fired; harmless no-op (timers are server-authoritative). Optional.

---

## 6 getStateForPlayer(playerId) — shape & hidden-info rules

```js
{
  phase: this.state,                       // 'writing'|'voting'|'reveal'|'finished'
  promptNumber: this.promptIndex + 1,
  totalRounds: this.totalRounds,
  promptText: this.prompt?.prompt ?? '',
  scores: { ...this.scores },              // visible always (cumulative)
  myId: playerId,

  // WRITING
  myFake: this.fakes[playerId] ?? null,
  hasSubmitted: this.fakes[playerId] !== undefined,
  submittedCount: Object.keys(this.fakes).length,   // count only, never WHO
  playerCount: this.players.length,

  // VOTING — ballot WITHOUT authorId/kind
  ballot: this.state === 'voting'
    ? this.ballot.map(o => ({ optionId: o.optionId, text: o.text, isMine: o.authorId === playerId }))
    : null,
  myVote: this.votes[playerId] ?? null,
  votedCount: Object.keys(this.votes).length,        // count only, never WHO

  // REVEAL — full disclosure
  reveal: (this.state === 'reveal' || this.state === 'finished')
    ? this.revealData : null,
}
```

**Hidden-info rules (must hold):**
- During `writing`: never expose other players' fakes, authorship, the truth, or who has/hasn't submitted (only an aggregate `submittedCount`).
- During `voting`: ballot options carry NO `authorId`, NO `kind` (truth vs fake indistinguishable). Only `isMine` flag (so client can disable the player's own fake). Never expose who voted for what, or vote tallies, until reveal.
- During `reveal`/`finished`: `revealData` fully discloses each option's `authorId`, `kind`, `voters[]`, the `truthOptionId`, and per-player `awards`.
- `scores` (cumulative totals) are visible throughout — acceptable, mirrors RPS exposing `scores`. Do NOT reveal per-prompt point sources until reveal.

---

## 7 Timers & broadcasting

`setOnStateChange(cb)` + `_emitChange()` REQUIRED — every server-driven timeout transition must `_emitChange()` (re-broadcast filtered state to all) AND the broadcast wrapper re-checks `isComplete()` for auto-finish (mirrors registry/index wiring used by LiarsDice/RPS/SpotTheDifference).

| Phase | Field / constant | Duration | On timeout (auto-action) |
|-------|------------------|----------|--------------------------|
| WRITE | `TIMERS.FIBBAGE_WRITE` | 35s | For each player with no fake: auto-submit a safe house fake (`_houseFake()` — a pre-baked decoy NOT equal to truth/existing) OR leave them with no fake (see §9). Then force `transition('vote')`. |
| VOTE  | `TIMERS.FIBBAGE_VOTE` | 25s | For each player with no vote: auto-cast a random valid option (not own fake) via `_autoVote(p)`. Then force `transition('reveal')`. |
| REVEAL| `FIBBAGE_REVEAL_MS = 12000` (module const, not a turn timer) | 12s | Auto-ack all present players, then advance (`next` or `finish`). |

Timer helpers (pattern from RPS/LiarsDice):
```js
_startWriteTimer() {
  clearTimeout(this._writeTimer);
  this._writeTimer = setTimeout(() => {
    if (this.state !== 'writing') return;
    for (const p of this.players) if (this.fakes[p] === undefined) this.fakes[p] = this._houseFake();
    this._forceToVoting();          // transition('vote') + setup
    this._emitChange();
  }, TIMERS.FIBBAGE_WRITE * 1000);
}
```
Analogous `_startVoteTimer` (auto-vote then `_forceToReveal`) and `_startRevealTimer` (auto-ack then `_checkRevealComplete`). All three cleared in `destroy()`. Each phase-entry hook starts exactly one timer and clears the others.

**Decision points must guard re-entry:** `_checkWriteComplete()` returns early `if (this.state !== 'writing')`, etc., to prevent double-transition when the last manual submit races the timeout.

---

## 8 Scoring & getResults

### Per-prompt awards (`_resolveVotes()` in `onEnterReveal`)
1. Build `voters` per optionId from `this.votes`.
2. `truthOptionId` = the ballot option with `kind==='truth'`.
3. For each player `p`:
   - **Found truth:** if `this.votes[p] === truthOptionId` → `this.scores[p] += POINTS_TRUTH; this.foundTruthCounts[p]++;`
   - **Fooled others:** let `myOption` = the fake authored by `p` (if any). `fooled = voters[myOption.optionId]?.length || 0` (voters of your fake; a player can't vote own fake, so no self-fool). `this.scores[p] += POINTS_FOOL * fooled; this.foolCounts[p] += fooled;`
4. Store `revealData.awards[p] = { found: bool, fooled, gained }`.

Pseudocode:
```js
for (const p of this.players) {
  let gained = 0, found = false;
  if (this.votes[p] === truthOptionId) { gained += POINTS_TRUTH; found = true; this.foundTruthCounts[p]++; }
  const mine = this.ballot.find(o => o.kind === 'fake' && o.authorId === p);
  const fooled = mine ? (votersByOption[mine.optionId]?.length || 0) : 0;
  gained += POINTS_FOOL * fooled; this.foolCounts[p] += fooled;
  this.scores[p] += gained;
  awards[p] = { found, fooled, gained };
}
```

### getResults()
```js
getResults() {
  const sorted = [...this.players].sort((a, b) => this.scores[b] - this.scores[a]);
  let placement = 1;
  return sorted.map((playerId, i) => {
    if (i > 0 && this.scores[playerId] < this.scores[sorted[i - 1]]) placement = i + 1;
    return {
      playerId, placement,
      score: this.scores[playerId],
      foolCount: this.foolCounts[playerId] || 0,
      foundTruthCount: this.foundTruthCounts[playerId] || 0,
    };
  });
}
```
**Tie rule:** equal `scores` ⇒ identical placement number; next distinct score jumps to `i+1`. Ranks all N. (No secondary tiebreak — ties intentionally share placement so `Scorer` splits points by shared placement multiplier.)

`isComplete()` → `this.state === 'finished'`.

---

## 9 Leave & deadlock handling

`_removeFromActive(id)` — not used as a primary mechanism (no per-turn rotation/elimination in Fibbage); `removePlayer` calls `super.removePlayer` which calls it internally for roster consistency.

```js
removePlayer(playerId) {
  super.removePlayer(playerId);          // prunes this.players + activePlayers
  this.acknowledged?.delete(playerId);
  // Keep their already-submitted fake ANONYMOUS in the ballot (brief: keep leaver's fake).
  // Do NOT delete this.fakes[playerId] or this.scores[playerId]:
  //   - fakes[leaver] stays so the ballot option remains and others can still be fooled by it,
  //     but the leaver no longer scores fool points (they're out of this.players).
  //   - votes[leaver] is dropped from "needed" set implicitly (loops iterate this.players).

  if (this.players.length <= 1 && this.state !== 'finished') {
    this._clearAllTimers();
    this.state = 'finished';
    return;
  }
  // Re-check the phase the leaver may have been blocking:
  if (this.state === 'writing') this._checkWriteComplete();
  else if (this.state === 'voting') this._checkVoteComplete();
  else if (this.state === 'reveal') this._checkRevealComplete();
}
```

**Important nuance on the kept leaver fake during VOTING:** `this.ballot` references `authorId = leaver`. Completion loops iterate `this.players` (now excludes leaver) for *who must vote*, so the leaver is no longer "needed". Remaining players can still vote for the orphan fake; at reveal, its `voters[]` are shown but `awards[leaver]` is never computed (leaver not in `this.players`), so fool points evaporate — acceptable and intended.

**Phase-by-phase "current/last-needed player leaves":**
- **writing, leaver was the last player owing a fake:** after prune, all remaining `this.players` have fakes ⇒ `_checkWriteComplete()` fires `transition('vote')`. No deadlock.
- **writing, leaver had NOT submitted:** their slot is simply gone; if everyone else already submitted, advance immediately.
- **voting, leaver was last owing a vote:** prune ⇒ remaining all voted ⇒ `transition('reveal')`. Orphan fake stays on ballot.
- **voting, leaver had not voted:** removed from needed set; advance if others done.
- **reveal, leaver was blocking ack:** `acknowledged.delete` + `_checkRevealComplete()` (which only checks `this.players`) ⇒ advance.
- **anytime, drops to ≤1 player:** force `finished` immediately, clear timers; orchestration ends tournament with the survivor.

`destroy()`:
```js
destroy() { this._clearAllTimers(); }
_clearAllTimers() {
  for (const k of ['_writeTimer','_voteTimer','_revealTimer']) {
    if (this[k]) { clearTimeout(this[k]); this[k] = null; }
  }
}
```

---

## 10 Client component

File: `client/src/games/Fibbage.jsx` + `Fibbage.module.css`. Props: `{ gameState, nicknames, avatars, onAction }`. Use `PlayerName`, `useSound()`, `useScreenShake()`. Title in `'Shrikhand'`/`'Fredoka One'`. Mobile-first, tap targets ≥44px, no hover-only interactions.

**Phase screens (switch on `gameState.phase`):**

- **`writing`:** Big prompt card (`promptText`) with a blank `____`. Single-line text input + "Submit Fib" button. After submit (`hasSubmitted`), input locks, show "Waiting for others… `submittedCount`/`playerCount`". Show write timer ring/bar. Reject feedback (server returns no state change on dup/truth match): client tracks a local `pending` flag, and if state hasn't flipped `hasSubmitted` after ~1.5s, surface "Too close to the truth — try another." Disable Enter-key auto-submit per project convention? (Fibbage NEEDS submit; allow button + Enter here since it's the intended action — but debounce double-fire.) `useSound('click')` on submit.
- **`voting`:** Prompt card + list of `ballot` options as large tappable cards (shuffled order from server). The option flagged `isMine` is rendered disabled/greyed ("Your fib"). Tap to select, confirm button to lock (tap-to-preview + confirm pattern for touch). After `myVote` set, lock and show "Votes in: `votedCount`/`playerCount`". Vote timer bar. `useSound('vote')`.
- **`reveal`:** Reveal each option sequentially: show its `text`, then flip to show `kind` (TRUTH highlighted gold) + author `PlayerName` + avatar chips of `voters`. Per-player award toast: "+1000 found the truth", "+500 ×N fooled". Running `scores` leaderboard. "Continue" button → `onAction({ type: 'acknowledge' })`. Auto-advances at 12s. `shake('medium')` if you found the truth or fooled ≥2; `useSound('winRound')`/`'coin'`.
- **`finished`:** brief "Final fibs" leaderboard, then orchestration moves to ROUND_RESULTS.

**gameState reads:** `phase, promptNumber/totalRounds, promptText, scores, myFake, hasSubmitted, submittedCount, playerCount, ballot[], myVote, votedCount, reveal{...}`.

**Actions emitted:** `onAction({ type:'submitFake', text })`, `onAction({ type:'castVote', optionId })`, `onAction({ type:'acknowledge' })`.

**Layout:** account for fixed pet sidebar (`margin-left:220px`, `width: calc(100% - 220px)` desktop) per project convention; full-width stacked on mobile. Unique background (e.g. deep teal/cream "trivia" theme) distinct from other games.

---

## 11 Registration checklist (8 steps)

1. **`server/src/games/Fibbage.js`** — implement `class Fibbage extends BaseGame` per §3–9. Export `{ Fibbage }`. Include module-level `PROMPT_BANK`, `POINTS_TRUTH=1000`, `POINTS_FOOL=500`, `TOTAL_ROUNDS=4`, `FIBBAGE_REVEAL_MS=12000`.

2. **`shared/gameList.js`** — add to `GAMES`:
```js
fibbage: {
  id: 'fibbage', name: 'Fibbage', minPlayers: 3, maxPlayers: 8,
  turnTimer: TIMERS.FIBBAGE_WRITE,
  description: 'Bluff your friends with a fake answer to an obscure question. Spot the truth, fool the rest.',
  instructions: [
    'Each round shows an obscure trivia question with a blank.',
    'Everyone secretly writes a FAKE answer designed to fool others (you cannot reuse the real answer or someone else\'s fib).',
    'All fakes plus the REAL answer are shuffled and shown. Pick the one you think is true — you can\'t pick your own fib.',
    'Score +1000 for finding the truth, and +500 for every player your fib fools.',
    'Highest total after 4 questions wins the round!',
  ],
},
```

3. **`shared/constants.js`** — add to `TIMERS`:
```js
FIBBAGE_WRITE: 35,
FIBBAGE_VOTE: 25,
```
(`FIBBAGE_REVEAL_MS` stays a module const in Fibbage.js since it's not a turn timer.)

4. **`server/src/games/registry.js`** — `import { Fibbage } from './Fibbage.js';` then `registerGame('fibbage', Fibbage);` (match existing registration call shape). Ensure index/orchestration wires `setOnStateChange` for timer broadcasts (same path as `liarsDice`/`rps`).

5. **`client/src/games/Fibbage.jsx` + `Fibbage.module.css`** — per §10 (props `gameState/nicknames/avatars/onAction`, `PlayerName`, `useSound`, `useScreenShake`, `'Shrikhand'` title, touch support).

6. **`client/src/assets/gamepreviews/fibbage.png`** — preview tile (trivia-card art, Shrikhand title).

7. **`client/src/App.jsx`** — import component and add `fibbage: Fibbage` to `GAME_COMPONENTS`.

8. **`client/src/screens/GameVote.jsx`** — import `fibbagePreview` and add to `GAME_PREVIEWS` map keyed `fibbage`.

(Also: bump `shared/version.js` minor, add a "Fibbage" row to CLAUDE.md game table + fonts table, commit/push per project convention.)

---

## 12 Edge cases & test scenarios (harness assertions)

Construct with N test players; drive via `handleAction`/`removePlayer`; assert on `getStateForPlayer`/`getResults`/`isComplete`.

- **Truth/dup rejection:** submitting `text === prompt.answer` (any case) → `fakes[p]` stays undefined, phase unchanged. Submitting a fake equal to another's existing fake → rejected. Whitespace/casing normalized.
- **Self-vote block:** `castVote` for own fake's optionId → ignored, `votes[p]` unset.
- **Full happy path 4 players:** all submit → phase `voting`; all vote → phase `reveal`; all ack → next prompt; after 4th reveal ack → `finished`. `getResults` length === 4, placements cover 1..4, scores match awards.
- **Scoring math:** player whose fake gets 3 votes and who also found truth → `+1000 + 3*500 = 2500` that prompt; `awards` reflects `{found:true, fooled:3, gained:2500}`.
- **Tie:** two players end equal totals → same `placement`; the third gets `placement = 3` (skip), not 2.
- **WRITE timeout:** advance clock without one player submitting → house fake injected (or leave-empty variant), `transition('vote')` fires, `_emitChange` called. No deadlock.
- **VOTE timeout:** one player never votes → auto-voted to a random non-own option, `transition('reveal')`.
- **REVEAL timeout:** nobody acks → after 12s auto-ack all, advances; `_emitChange` called.
- **Leave during writing (last owing):** 4 players, 3 submitted, 4th `removePlayer` → immediately `voting` (3-player ballot). `getResults` ranks 3.
- **Leave during voting keeps fake:** leaver had submitted a fake AND not voted; `removePlayer` → ballot still contains their anonymous fake; remaining players advance to reveal; `revealData` shows the orphan fake's voters but `awards` has no entry for leaver; leaver absent from `getResults`.
- **Leave during reveal:** leaver was the only un-acked → `_checkRevealComplete` advances.
- **Collapse to 1:** sequential `removePlayer` until 1 remains → `state==='finished'`, `isComplete()===true`, no timers left pending (assert `_writeTimer/_voteTimer/_revealTimer` null after `destroy()`).
- **Double-submit/double-vote race:** manual last submit + simultaneous timer fire → guarded by `if (this.state !== 'writing') return;`; exactly one transition.
- **JSON key safety:** `optionId`s are strings (e.g. `'opt_0'`), avoiding the numeric-key-stringification pitfall.

---

## 13 Effort & risks

- **Effort: M.** Server FSM is moderate (two simultaneous-submit phases + reveal ack + 3 timers) — close in shape to RPS+LiarsDice combined, both already proven. Client is M (three distinct phase screens + reveal animation). Content (prompt bank) is the long pole.
- **Dependencies:** new `TIMERS` entries; `'Shrikhand'`/`'Fredoka One'` Google Font added to `index.html`; preview PNG asset; registry/index `setOnStateChange` wiring (existing pattern).
- **Risks:**
  - *Content quality* — needs ≥40 genuinely obscure, single-word-ish answers; weak bank ruins the game. Curate `answer` short so fakes are plausible.
  - *Fake-dup UX* — silent server rejection needs clear client feedback (timeout-based "try another"); risk of confusing players. Mitigate with the 1.5s pending heuristic.
  - *Min players 3* — if a lobby has exactly 3 and the vote is between 1 fake + truth + maybe house fakes, fooling is easy; acceptable but note for balancing.
  - *Kept-leaver fake* — must NOT crash reveal when `awards[leaver]` absent; loops guard on `this.players`.

---

## 14 Open questions

1. **WRITE timeout policy:** inject a `_houseFake()` decoy (keeps ballot full, more fun) vs. leave the non-submitter with no option (simpler, but smaller ballot)? Spec assumes house-fake; confirm.
2. **Prompt count:** 4 fixed, or scale by player count / make it a lobby option? Spec uses fixed 4.
3. **Point values:** 1000/500 chosen so a strong round (~2500) is meaningful vs `BASE_START=100` placement points — confirm these magnitudes don't distort the placement-based tournament scoring (fibbage points only set *placement*, not raw tournament points, so magnitude is cosmetic — verify that's the intended model).
4. **Cumulative `scores` visible mid-game:** acceptable (matches RPS) or hide until reveal for more tension?
5. **Same prompt reuse across rounds/games:** sample without replacement within a game; across separate games in a tournament, reshuffle from full bank — confirm no per-tournament dedup needed.
6. **Identical fakes by coincidence after the case-insensitive dedup:** rejection means second submitter is blocked — should we instead merge identical fakes into one option whose fool-points split? Spec rejects (simpler, per brief).
