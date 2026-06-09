# Wavelength — Implementation Spec

Slug: `wavelength` · Engine class: `Wavelength` · File: `server/src/games/Wavelength.js`
Spec date: 2026-06-08 · Targets BaseGame leave contract v2.7.0

---

## 1 Overview

- **Players:** 2–8 (best 4–8 — more guessers = richer scoring spread; works at 2 as a tight psychic-vs-guesser duel).
- **Type:** Turn-based clue/spectrum game. One player per round is the **psychic**; everyone else **guesses**.
- **Length:** `roundsPerGame = min(players.length, 8)`. Every player is psychic exactly once, then the game ends. (At 2 players that is 2 sub-rounds; at 8, eight.) This keeps the mini-game self-contained inside ONE tournament round.
- **Loop per sub-round:** psychic gets a hidden target band on a spectrum → writes a short clue → guessers slide 0–100 → reveal scores everyone → next psychic.
- **Title font:** `Audiowide` (headings/spectrum labels), `Quicksand` for body/clue text. Add both to the Google Fonts `<link>` already used by the client.
- **Hidden info:** target center+width and all guesses stay hidden from non-owners until the `reveal` state of that sub-round.

---

## 2 Tournament fit

`getResults()` ranks **all N players** by cumulative `totalPoints` (sum across every sub-round, as both guesser and psychic). Sorted descending; ties share placement using the canonical pattern:

```js
let placement = 1;
sorted.map((pid, i) => {
  if (i > 0 && totals[pid] < totals[sorted[i-1]]) placement = i + 1;
  return { playerId: pid, placement, score: totals[pid], handDescription: `${totals[pid]} pts` };
});
```

Because every player both guesses (rounds−1 times) and is psychic (once), the score distribution is balanced — no player is structurally advantaged by turn order. Placement array `[1.0,0.7,0.5,0.35,0.25,0.15]` is applied downstream by `Scorer`; this game only needs correct ordering + tie placements.

---

## 3 FSM (state × action → next)

States: `waiting`, `clue`, `guessing`, `reveal`, `finished`.

| State \ Action | `start` | `clueSubmitted` | `allGuessed` | `next` | `finish` |
|---|---|---|---|---|---|
| **waiting** | clue | — | — | — | — |
| **clue** | — | guessing | — | — | finished* |
| **guessing** | — | — | reveal | — | finished* |
| **reveal** | — | — | — | clue | finished |

`*` `finished` reachable from `clue`/`guessing` only via the leave path (`_forceFinish()` when ≤1 player remains) — not a normal player action; declared in `transitions` so `transition('finish')` is legal from those states.

```js
transitions: {
  waiting:  { start: 'clue' },
  clue:     { clueSubmitted: 'guessing', finish: 'finished' },
  guessing: { allGuessed: 'reveal', finish: 'finished' },
  reveal:   { next: 'clue', finish: 'finished' },
}
```

**onEnter hooks** (auto-fired by `BaseGame.transition`):
- `onEnterClue()` — pick next psychic from rotation, roll spectrum + hidden target, reset `clueText=null`/`guesses={}`, start **clue timer**.
- `onEnterGuessing()` — reset `guesses={}`, start **guess timer**.
- `onEnterReveal()` — compute sub-round scores, push to `roundHistory`, reset `acknowledged`, start **reveal/ack timer**.
- `onEnterFinished()` — `_clearTimers()`.

---

## 4 Server state (fields)

```js
class Wavelength extends BaseGame {
  // rotation / progression
  psychicOrder      // string[]  — shuffled copy of players at startGame, defines psychic sequence
  subRound          // number    — 1-based index into psychicOrder (current sub-round)
  roundsPerGame     // number    — psychicOrder.length at start (snapshot; leaves don't shrink it)
  psychicId         // string    — current psychic's playerId (null if their turn was skipped)

  // spectrum + hidden target (regenerated each clue)
  spectrum          // { left, right } from SPECTRUMS bank, e.g. {left:'Cold', right:'Hot'}
  targetCenter      // number 8..92  — band midpoint (hidden)
  targetWidth       // number (HALF-width); scoring bands derive from it (hidden)

  // per sub-round inputs
  clueText          // string|null  — psychic's clue, ≤ 40 chars
  guesses           // { [pid]: number 0..100 }  — guessers only, excludes psychic

  // scoring
  totalPoints       // { [pid]: number }  cumulative across game
  lastReveal        // { spectrum, targetCenter, targetWidth, clueText, psychicId,
                    //    guesses:{pid:val}, guessPoints:{pid:n}, psychicPoints:n }
  acknowledged      // Set<pid>  — reveal-phase acks
  roundHistory      // array of lastReveal snapshots

  // timers
  _clueTimer _guessTimer _revealTimer
}
```

Constructor FSM config: `states` list above, `initialState:'waiting'`. Also init `totalPoints[p]=0` for all players. **Spectrum bank** is a static module-level const array (`SPECTRUMS`) of `{left,right}` pairs (~40 entries, e.g. Cold/Hot, Underrated/Overrated, Round/Pointy, Useless/Useful, Common/Rare, Forbidden/Encouraged). Picked with no-repeat-within-game tracking via a `usedSpectra` Set.

---

## 5 Actions (handleAction)

Guard every action with `if (!this.players.includes(playerId)) return;` first.

| `action.type` | Valid state | Who | Payload | Validation | Effect |
|---|---|---|---|---|---|
| `submitClue` | `clue` | psychic only | `{ clue:string }` | `playerId === this.psychicId`; `clueText===null` (one-shot); trim, reject empty after trim; clamp to 40 chars; strip a bare number that equals the target (anti-cheat: reject clue matching `/^\s*\d{1,3}\s*$/`) | set `clueText`; `transition('clueSubmitted')` → `onEnterGuessing` starts guess timer |
| `guess` | `guessing` | guessers only | `{ value:number }` | `playerId !== this.psychicId`; `guesses[playerId]===undefined` (one-shot); coerce `Math.round`, clamp 0–100 | record `guesses[playerId]=value`; if **all expected guessers** submitted → `transition('allGuessed')` |
| `acknowledge` | `reveal` | anyone | `{}` | — | `acknowledged.add(playerId)`; if all `this.players` acked → `_advanceAfterReveal()` |
| `ping` | any | anyone | `{}` | safety no-op | falls through so `index.js` re-broadcasts state + re-checks `isComplete()` |

**Expected-guessers set:** `this.players.filter(p => p !== this.psychicId)`. "All guessed" = every expected guesser has a value. If `psychicId === null` (skipped-leave round), there is no clue phase — see §9.

**Turn guards:** `submitClue` from a non-psychic is ignored; `guess` from the psychic is ignored; actions in the wrong state are ignored (no throw — `transition` is only ever called internally on the guarded path).

---

## 6 getStateForPlayer (shape; hidden-info rules)

```js
getStateForPlayer(pid) {
  const isReveal = this.state === 'reveal' || this.state === 'finished';
  const amPsychic = pid === this.psychicId;
  return {
    phase: this.state,                 // 'waiting'|'clue'|'guessing'|'reveal'|'finished'
    subRound: this.subRound,
    roundsPerGame: this.roundsPerGame,
    psychicId: this.psychicId,
    amPsychic,
    spectrum: this.spectrum,           // both labels always visible
    clueText: this.clueText,           // visible to all once set (it IS the public clue)

    // HIDDEN target — only psychic during clue/guessing; everyone at reveal
    targetCenter: (amPsychic || isReveal) ? this.targetCenter : null,
    targetWidth:  (amPsychic || isReveal) ? this.targetWidth  : null,

    // own guess always; others' guesses ONLY at reveal
    myGuess: this.guesses[pid] ?? null,
    guesses: isReveal ? { ...this.guesses } : null,
    guessedIds: Object.keys(this.guesses),   // who has locked in (for "waiting on X" UI) — no values leaked

    totalPoints: { ...this.totalPoints },
    lastReveal: isReveal ? this.lastReveal : null,
    myId: pid,
  };
}
```

**Rules:** the band (`targetCenter`/`targetWidth`) is the ONLY secret in clue/guessing — never sent to non-psychics. `guessedIds` leaks *who* has answered (needed for the waiting indicator) but never *what* — values appear only in `reveal`. `clueText` is intentionally public.

---

## 7 Timers & broadcasting

`setOnStateChange(cb)` / `_emitChange()` identical to RPS/SpotTheDifference. Every timer callback that mutates state ends with `_emitChange()` (broadcasts + lets `index.js` re-check `isComplete()`).

| Timer | Duration | Set in | On expiry (auto-action) |
|---|---|---|---|
| `_clueTimer` | `TIMERS.WAVELENGTH_CLUE` = **45s** | `onEnterClue` | psychic didn't clue → auto-submit `clueText = '(no clue)'`, `transition('clueSubmitted')`, `_emitChange()` |
| `_guessTimer` | `TIMERS.WAVELENGTH_GUESS` = **30s** | `onEnterGuessing` | auto-fill missing guessers with `50` (neutral midpoint), `transition('allGuessed')`, `_emitChange()` |
| `_revealTimer` | **10s** | `onEnterReveal` | force-ack all `this.players`, `_advanceAfterReveal()`, `_emitChange()` |

Each timer setter clears its prior handle first. Guess timer uses a stored `_guessStartTime` so `handleAction`’s `guess`/`ping` safety branch can force-end if the wall clock passed (mirrors SpotTheDifference). Register `turnTimer: TIMERS.WAVELENGTH_CLUE` in gameList (drives the generic client turn HUD).

---

## 8 Scoring & getResults

Computed in `onEnterReveal` from `targetCenter` (C) and `targetWidth` (W, the HALF-width of the bullseye). Distance `d = |guess − C|`.

**Guesser bands (Wavelength-style 4/3/2/0):**

| Band | Condition | Points |
|---|---|---|
| Bullseye | `d ≤ W` | **4** |
| Close | `W < d ≤ 2W` | **3** |
| Near | `2W < d ≤ 3W` | **2** |
| Miss | `d > 3W` | **0** |

Default `targetWidth = 7` → bullseye ±7 (15-wide), close ±14, near ±21. Roll `targetWidth ∈ {6,7,8}` and `targetCenter ∈ [8,92]` so all bands fit on the 0–100 track.

**Psychic score (from guessers' avg, capped):** reward the clue when guessers land near the band, but cap so a psychic can’t out-earn a perfect guesser.

```js
const guessVals = expectedGuessers.map(p => this.guesses[p]);          // post auto-fill, never empty
const avgPts = mean(guessVals.map(v => guesserPoints(v)));             // 0..4
psychicPoints = Math.min(4, Math.round(avgPts));                       // cap at 4
```

If there are **no guessers** (only the psychic remains — pathological 1-player) the sub-round is skipped (see §9), psychic earns 0. Add every player's per-sub-round points into `totalPoints`. Store `guessPoints` map + `psychicPoints` in `lastReveal`.

**getResults()** — rank all N by `totalPoints` desc, ties share placement (exact code in §2). Every entry: `{ playerId, placement, score, handDescription }`. Players who left mid-game were pruned from `this.players` by `removePlayer`, so they’re absent here — the orchestrator scores only present players, which is correct (a quit forfeits remaining points).

---

## 9 Leave & deadlock handling

`removePlayer(id)` MUST call `super.removePlayer(id)` first (prunes `this.players` + rotation), then nudge per phase. Also prune `psychicOrder`, `guesses[id]`, `acknowledged`, `totalPoints[id]`. **Do not** decrement `roundsPerGame` (the snapshot) — instead guard `subRound`/`psychicOrder` index access.

```js
removePlayer(id) {
  super.removePlayer(id);
  this.psychicOrder = this.psychicOrder.filter(p => p !== id);
  delete this.guesses[id];
  delete this.totalPoints[id];
  this.acknowledged?.delete(id);

  if (this.players.length <= 1) return this._forceFinish();   // <=1 remain → end

  if (this.state === 'clue' && id === this.psychicId) {
    // PSYCHIC left pre-clue → skip this sub-round entirely
    this._skipSubRound();                  // clears clue timer, advances to next psychic OR finish
  } else if (this.state === 'guessing') {
    if (id === this.psychicId) {           // psychic bailed mid-guessing → still score what guessers have
      this._endGuessingEarly();            // auto-fill remaining, go to reveal (psychic gets 0)
    } else {
      // a guesser left → re-check "all guessed" with the now-smaller expected set
      const exp = this.players.filter(p => p !== this.psychicId);
      if (exp.every(p => this.guesses[p] !== undefined)) this.transition('allGuessed');
    }
  } else if (this.state === 'reveal') {
    this.acknowledged.add(id);             // auto-ack the leaver
    if (this.players.every(p => this.acknowledged.has(p))) this._advanceAfterReveal();
  }
}
```

Helpers:
- `_skipSubRound()` — `clearTimeout(_clueTimer)`; record an empty `lastReveal` (no points); if `subRound >= roundsPerGame` (relative to remaining order) → `_forceFinish()` else `transition('next')` then `onEnterClue` picks the next psychic. Because the leaver was removed from `psychicOrder`, the next index naturally advances.
- `_advanceAfterReveal()` — `_clearTimers()`; if all psychics have served (`subRound >= roundsPerGame` accounting for pruning, i.e. no more unserved players in `psychicOrder`) → `transition('finish')` else `transition('next')`.
- `_forceFinish()` — `_clearTimers()`; if `state !== 'finished'` then set directly (`this.state='finished'`) to avoid an illegal-transition throw from `waiting`, otherwise `transition('finish')`. Scores already in `totalPoints` are preserved.

**Per-phase "current/last-needed player leaves":**
- **Psychic leaves in `clue`** → skip sub-round, no one penalized, advance. (Most important case — without this the round deadlocks waiting for a clue that never comes.)
- **Last-needed guesser leaves in `guessing`** → expected-set recomputed → if all others already guessed, immediately `allGuessed` → reveal. No deadlock.
- **Sole remaining guesser leaves** while psychic still present but `players.length` drops to 1 → `_forceFinish()`.
- **Last un-acked player leaves in `reveal`** → auto-ack triggers `_advanceAfterReveal`.

`destroy()` clears `_clueTimer`, `_guessTimer`, `_revealTimer`. Every `setTimeout` path pairs with `_emitChange()` so broadcasts + `isComplete()` re-check always happen.

---

## 10 Client component

`client/src/games/Wavelength.jsx` + `.module.css`. Props: `gameState`, `nicknames`, `avatars`, `onAction`. Uses `PlayerName`, `useSound()`, `useScreenShake()`. Title in `Audiowide`, body in `Quicksand`.

**Shared chrome (all phases):** spectrum bar — a horizontal track with the two labels (`spectrum.left` left, `spectrum.right` right) in Audiowide, 0–100 gradient. Sub-round pill: `Sub-round {subRound}/{roundsPerGame}` + current psychic via `PlayerName`. `totalPoints` mini-leaderboard.

| Phase | Psychic view | Guesser view |
|---|---|---|
| `clue` | Band rendered as a translucent overlay on the track (uses `targetCenter±targetWidth`, scaled to the three bands). 40-char clue `<input>` + Submit button (emits `submitClue`). Live char counter; Submit disabled when empty. | "Psychic is thinking…" + spinner; spectrum shown, band hidden. |
| `guessing` | "Waiting for guesses" + `guessedIds` checklist via `PlayerName`. Band still visible to psychic only. | Draggable **slider/marker** over the track (range `0–100`); big value readout; Lock-in button emits `guess {value}`. After lock, marker frozen, "waiting on others". Touch: `pointerdown`+`pointermove` on the track sets value (tap-to-place), confirm button to lock — no hover needed. |
| `reveal` | Band revealed (bullseye gold, close/near rings). All guess markers placed via `lastReveal.guesses`, each labelled by `PlayerName`, colored by band. Per-player +pts and psychic +pts shown. Acknowledge button emits `acknowledge`. | Same reveal view (read-only). |
| `finished` | Final `totalPoints` order (acts as a brief end card before `ROUND_RESULTS`). | same |

**Sound:** `playSound('vote')` on slider lock, `playSound('cardDeal')` on clue submit, win/lose chime by own band at reveal. **Shake:** `shake('light')` when own guess is a bullseye at reveal; `shake('medium')` if the psychic scores a perfect 4. **gameState read:** `phase`, `amPsychic`, `spectrum`, `clueText`, `targetCenter/Width` (null-guarded), `myGuess`, `guesses`, `guessedIds`, `totalPoints`, `lastReveal`. **Actions emitted:** `submitClue`, `guess`, `acknowledge`, `ping` (fire `ping` if a local phase timer hits 0 and server hasn’t advanced).

---

## 11 Registration checklist

| # | Path | Edit |
|---|---|---|
| 1 | `server/src/games/Wavelength.js` | Create engine class `Wavelength extends BaseGame` per §3–§9. |
| 2 | `shared/gameList.js` | Add `GAMES.wavelength` (values below). |
| 3 | `shared/constants.js` | Add `TIMERS.WAVELENGTH_CLUE = 45` and `TIMERS.WAVELENGTH_GUESS = 30`. |
| 4 | `server/src/games/registry.js` | `import { Wavelength } from './Wavelength.js';` + `registerGame('wavelength', Wavelength);` |
| 5 | `client/src/games/Wavelength.jsx` + `Wavelength.module.css` | Component per §10. |
| 6 | `client/src/assets/gamepreviews/wavelength.png` | Spectrum-dial preview image. |
| 7 | `client/src/App.jsx` | `import WavelengthGame from './games/Wavelength.jsx';` + `wavelength: WavelengthGame` in `GAME_COMPONENTS`. |
| 8 | `client/src/screens/GameVote.jsx` | import preview + add to `GAME_PREVIEWS`. |

**`shared/gameList.js` entry (concrete):**

```js
wavelength: {
  id: 'wavelength', name: 'Wavelength', minPlayers: 2, maxPlayers: 8,
  turnTimer: TIMERS.WAVELENGTH_CLUE,
  description: 'Read the psychic\'s mind. Slide to the hidden target on the spectrum.',
  instructions: [
    'Each sub-round one player is the Psychic and sees a hidden target band on a spectrum (e.g. Cold ↔ Hot).',
    'The Psychic writes one short clue (no numbers!) hinting where the target sits.',
    'Everyone else slides a marker from 0 to 100 to guess the band — guesses stay hidden until reveal.',
    'Bullseye = 4 pts, close = 3, near = 2, miss = 0. The Psychic scores from how well the guessers did (capped at 4).',
    'Every player is Psychic once. Highest total across all sub-rounds wins the round!',
  ],
},
```

---

## 12 Edge cases & test scenarios

Harness asserts (each = a state-machine unit test on the engine):

1. **All N ranked every round:** `getResults().length === players.length`; placements cover 1..k with ties collapsed. Run for N=2,3,5,8.
2. **Ties share placement:** two players with equal `totalPoints` → identical `placement`, next distinct player skips correctly.
3. **Hidden target:** `getStateForPlayer(guesser).targetCenter === null` during `clue` and `guessing`; non-null at `reveal`. Psychic sees it during `clue`/`guessing`.
4. **Hidden guesses:** `getStateForPlayer(x).guesses === null` until `reveal`; `guessedIds` reflects lock-ins without leaking values.
5. **Clue anti-cheat:** `submitClue {clue:'42'}` rejected; `{clue:'warm-ish'}` accepted, truncated at 40.
6. **One-shot guards:** second `guess` from same pid ignored; `submitClue` from non-psychic ignored; `guess` from psychic ignored.
7. **Clue timeout:** no `submitClue` within 45s → auto `(no clue)`, advances to `guessing`, `_emitChange` fired.
8. **Guess timeout:** missing guessers auto-filled to 50, advances to `reveal`.
9. **Reveal auto-ack:** no acks within 10s → all force-acked, advances to next psychic or `finished`.
10. **Psychic leaves in `clue`:** `removePlayer(psychic)` → sub-round skipped, no points awarded, next psychic begins (or `finished` if last). No deadlock.
11. **Last-needed guesser leaves in `guessing`:** remaining expected set all-guessed → immediate `reveal`.
12. **Leave to ≤1:** `removePlayer` dropping to 1 player → state `finished`, `isComplete()` true, `getResults()` returns the survivor at placement 1 plus any already-scored leavers’ absence handled.
13. **Leave during `reveal`:** leaver auto-acked; if they were last needed, advances.
14. **destroy():** after `destroy()`, no timer fires (spy on `_emitChange`); safe to call twice.
15. **Full game completes:** simulate N psychics each cluing + guessers guessing → `isComplete()` true after exactly `roundsPerGame` reveals; `subRound === roundsPerGame`.

---

## 13 Effort & risks

- **Server engine:** **M** — FSM is small but the rotating-psychic + per-phase leave matrix is the bulk; reuse RPS/SpotTheDifference timer scaffolding verbatim.
- **Client component:** **M** — the draggable slider with touch (`pointer` events) + band-overlay rendering is the only non-trivial UI; everything else is static panels.
- **Spectrum bank + preview asset:** **S**.
- **Deps:** none new (no canvas, no external API). Fonts Audiowide/Quicksand added to existing Google Fonts link. Reuses `PlayerName`, `useSound`, `useScreenShake`, `Scorer` (placement-only).
- **Top risk:** psychic-leave deadlock if `_skipSubRound`/`_forceFinish` aren’t wired to `_emitChange` — covered by tests 10 & 12. Secondary risk: band-to-pixel scaling mismatch between server `targetWidth` and client overlay (keep one shared scale: pixels = `pct/100 * trackWidth`).

---

## 14 Open questions

1. **Sub-rounds at 2 players:** 2 sub-rounds may feel thin. Option: at N=2, run `roundsPerGame = 4` (each player psychic twice). Default keeps it = N for simplicity; flag for playtest.
2. **Psychic-points cap:** current cap = 4 (= a single bullseye). Alternative: cap at 3 so a guesser bullseye always beats the psychic. Pick during balance pass.
3. **Spectrum bank size/source:** ~40 static pairs enough for an 8-sub-round game without repeats? Confirm `usedSpectra` reset only per-game (not per-tournament-round) is acceptable.
4. **Clue length:** 40 chars vs allowing a 2–3 word phrase only. 40 is generous; tighten if clues get spammy.
5. **Auto-fill neutral value (50):** is midpoint the fairest no-show penalty, or should a no-guess score a hard 0 regardless of band? Current: 50 then scored by band (usually a miss). Confirm.
