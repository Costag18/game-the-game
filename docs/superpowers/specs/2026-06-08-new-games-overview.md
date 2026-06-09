# New Games — Implementation Overview (2026-06-08)

This batch adds **14 new mini-games + 2 shared infrastructure modules** to **Game The Game**, each written as a build-ready spec in this folder. **Codenames was dropped** — its co-op "one team wins together" structure clashes with the platform's per-player placement scoring, which has no way to rank teammates against each other.

**The #1 constraint:** every mini-game must produce a full ranking of **all N players each round**. The tournament `Scorer` consumes `getResults()` as a placement list (1st…Nth; ties share a placement) and pays out base points × the placement multiplier `[1.0, 0.7, 0.5, 0.35, 0.25, 0.15]` (6th+ all use `0.15`). A game that only crowns a single winner, or leaves players unranked, is not shippable. The **Pairing Engine** exists specifically so inherently **1v1** games can still emit a clean N-player ranking (Swiss wins + tiebreaks).

All specs target the **v2.7.0 leave/deadlock contract** (`removePlayer` / `_removeFromActive` / `destroy` / `setOnStateChange`) shipped in the bug-fix pass that preceded this planning work.

---

## Build order

Build infra first, then games in dependency tiers. Within a tier the games are independent and can be built in parallel.

1. **Infrastructure (build first — blocks downstream tiers)**
   - **Pairing Engine** (L) — wraps any 1v1 `MatchEngine` into Swiss mini-rounds and turns per-match results into an N-player placement ranking. **Blocks Tier 2.**
   - **Drawing Canvas** (M) — shared stroke relay, snapshot sync, word bank, fuzzy guess matching. **Blocks Tier 3.**

2. **Tier 1 — no new infra** (can start immediately, even in parallel with infra). Rank all N players directly from their own state; depend only on existing `BaseGame` + `shared/` plumbing.
   - Scattergories, BS (Cheat), Wavelength, Reaction Tap, Aim Trainer Duel, Typing Race, Mastermind, President (Scumlord), Spoons, Fibbage.

3. **Tier 2 — 1v1 via the Pairing Engine.** Each implements only a `MatchEngine` (`applyMove`/`getView`/`winner`/`isDraw`/`isOver`); the Pairing Engine drives them and talks to the Scorer.
   - Connect Four, Ultimate Tic-Tac-Toe.

4. **Tier 3 — drawing games on the Drawing Canvas infra.**
   - Skribbl (shared room canvas), Telephone Pictionary (**per-player private canvases** — scoped to each player's own socket, not `io.to(room)`).

> Land and smoke-test each infra module before starting the games that depend on it. Suggested first build: **Reaction Tap or Typing Race** (smallest, no infra) to exercise the new-game pipeline end-to-end, then the infra, then outward.

---

## Spec inventory

| Game / Module | Type | Players | Size | Depends on | Spec file |
|---|---|---|---|---|---|
| **Pairing Engine** | Infra — 1v1 tournament layer | wraps N | L | BaseGame leave contract, Scorer | `2026-06-08-pairing-engine-spec.md` |
| **Drawing Canvas** | Infra — real-time canvas | — | M | Socket.IO room relay | `2026-06-08-drawing-canvas-infra-spec.md` |
| Scattergories | Simultaneous, timed | 2–8 | M | — | `2026-06-08-scattergories-spec.md` |
| BS (Cheat) | Turn-based, bluff | 2–8 | M | — | `2026-06-08-bs-cheat-spec.md` |
| Wavelength | Turn-based, clue | 2–8 | M | — | `2026-06-08-wavelength-spec.md` |
| Reaction Tap | Simultaneous, reflex | 2–8 | S | — | `2026-06-08-reaction-tap-spec.md` |
| Aim Trainer Duel | Simultaneous, reflex | 2–8 | M | — | `2026-06-08-aim-trainer-spec.md` |
| Typing Race | Simultaneous | 2–8 | S | — | `2026-06-08-typing-race-spec.md` |
| Mastermind | Simultaneous, deduction | 2–8 | M | — | `2026-06-08-mastermind-spec.md` |
| President (Scumlord) | Turn-based, climbing | 2–8 | M | — | `2026-06-08-president-spec.md` |
| Spoons | Real-time, grab race | 3–8 | L | — | `2026-06-08-spoons-spec.md` |
| Fibbage | Turn-based, bluff trivia | 3–8 | M | — | `2026-06-08-fibbage-spec.md` |
| Connect Four | 1v1 (pairing) | 2–8 | M | Pairing Engine | `2026-06-08-connect-four-spec.md` |
| Ultimate Tic-Tac-Toe | 1v1 (pairing) | 2–8 | M | Pairing Engine | `2026-06-08-ultimate-tic-tac-toe-spec.md` |
| Skribbl (Draw & Guess) | Real-time draw | 2–8 | L | Drawing Canvas | `2026-06-08-skribbl-spec.md` |
| Telephone Pictionary | Real-time draw | 3–8 | L | Drawing Canvas (per-socket sessions) | `2026-06-08-telephone-pictionary-spec.md` |

Rough total: **2 L + 1 M infra**, then **~2 S + 6 M + 1 L** Tier-1, **2 M** Tier-2, **2 L** Tier-3.

---

## Shared conventions (every game spec honours these)

- **`getResults()` ranks everyone** — sorted `[{ playerId, placement, ... }]` over all active players; ties share a placement (`let placement = 1; if (i > 0 && score < prev.score) placement = i + 1;`). 1v1 games never compute placements themselves — the Pairing Engine does.
- **v2.7.0 leave/deadlock contract** — `removePlayer` (prune + advance/re-check/finish-if-≤1) vs `_removeFromActive` (eliminate/finish, stays scored) vs `destroy` (clear timers). Simultaneous games auto-submit/auto-ack for a leaver. Any `setTimeout`-driven advance MUST pair with `setOnStateChange`/`_emitChange`.
- **8-step registration** — server `games/Your.js` → `shared/gameList.js` entry → `shared/constants.js` timer (if new) → `registry.js` → client `Your.jsx` + `.module.css` → preview image → `GAME_COMPONENTS` (App.jsx) → `GAME_PREVIEWS` (GameVote.jsx).
- **Unique title font**, `PlayerName` for avatars, `useSound()` hooks, touch-first interactions (tap-to-preview + confirm, no hover-only).

---

## Decisions worth making now (cross-cutting)

These ripple across multiple specs, so settling them up front avoids rework. Everything else (timer durations, point magnitudes, bank sizes) is **tuning** — the specs ship sensible defaults you can adjust at playtest.

1. **Draw scoring in the Pairing Engine** — fractional `+0.5/+0.5` wins (UI shows "2.5 wins") **vs** integer wins + `scoreDiff` tiebreak. Affects Connect Four & Ultimate Tic-Tac-Toe standings. *(Spec default: fractional.)*
2. **Mini-round count `K` for the 1v1 games at small N** — best-of-3 of a full board game at N=2 can run long. Keep `K=3` everywhere, or bump only at N=2, or cap match length harder? *(Spec default: K≈3 auto.)*
3. **Disconnected-leaver in `getResults()`** — drop them (current codebase convention) **vs** award an explicit last placement. Cross-cutting (Pairing Engine + every game). *(Spec default: drop, per convention.)*
4. **Reaction Tap ranking** — cumulative reaction-ms (a single early "foul" hurts a lot) **vs** per-round placement points like RPS. *(Spec default: total-ms.)*
5. **President AFK timeout** — auto-pass (no info leak) **vs** auto-play-lowest-legal (sheds faster). *(Spec default: auto-pass.)*

Each spec also lists its own **Open questions** (mostly tuning). Notable ones: Spoons' pass-model concurrency (its main risk, flagged **L**), Telephone Pictionary's per-player canvas sessions (resolved in-spec), Fibbage house-fake on write-timeout, Mastermind board privacy at reveal.

---

## Next step

Each spec is **build-ready** — scoped, with dependencies, leave/deadlock handling, registration steps, and open questions called out. When implementation starts, run the **`writing-plans` skill per game** to turn its spec into a step-by-step build plan before touching code. Build the two infra modules first, then Tier 1 → Tier 2 → Tier 3.
