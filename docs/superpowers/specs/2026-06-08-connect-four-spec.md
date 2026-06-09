# Connect Four — Implementation Spec

- **slug:** `connect-four`
- **gameId (registry / gameList / GAME_COMPONENTS / GAME_PREVIEWS key):** `connect4`
- **type:** inherently 1v1, wrapped into an N-player ranked round by the **Pairing Engine**
- **status:** draft / build-ready
- **date:** 2026-06-08
- **depends on:**
  - `docs/superpowers/specs/2026-06-08-pairing-engine-spec.md` (the Swiss/barrier/timers/leave layer — READ FIRST)
  - `server/src/games/BaseGame.js` (v2.7.0 leave contract)
  - `shared/constants.js` (`SCORING.PLACEMENT_MULTIPLIERS`, `TIMERS.CARD_GAME`)
  - `server/src/tournament/Scorer.js` (`calculateRoundScores` consumes `getResults()` placements + ties)

> **Scope of THIS spec:** the `Connect4Match` MatchEngine (the 7×6 board logic) plus the thin
> `Connect4 extends PairingEngine` wrapper, the client board component, and registration. All
> N-player ranking, pairing, byes, the mini-round barrier, per-turn timers, and leave handling
> live in the **Pairing Engine** and are NOT re-implemented here — this spec only shows how
> `Connect4` delegates to it and how `Connect4Match` satisfies the MatchEngine contract.

---

## 1 Overview

| Field | Value |
|-------|-------|
| Players | 2–8 (the round; each underlying match is exactly 1v1) |
| Type | Turn-based 1v1 board game, wrapped in a Swiss mini-tournament across N |
| Board | 7 columns × 6 rows; drop discs into columns; gravity stacks them |
| Win condition (per match) | First to 4-in-a-row (horizontal, vertical, or either diagonal); full board with no line = draw |
| Round length | `miniRounds: 3` (best-of-3 Swiss); each match is one full Connect Four game |
| Hidden info | **None** — perfect-information game; both players see the full board |
| Per-match move timer | `TIMERS.CARD_GAME` (30s/turn) — **owned by the Pairing Engine**; on timeout the engine auto-drops a random legal column (see §7) |
| Title font | **Fredoka One** (fallback **Baloo 2**) — Google Font, title text only per CLAUDE.md Fonts convention |
| Background | Classic Connect Four blue board with yellow/red discs (unique per-game visual identity) |

The round plays as: N players → Pairing Engine builds mini-round 1 pairings (odd N → one bye =
free win) → each pair plays one Connect Four game simultaneously → fast finishers wait at the
barrier → mini-round summary → re-pair by record → repeat 3× → full 1..N ranking.

---

## 2 Tournament fit (getResults ranks all N; ties)

`Connect4` **does not implement `getResults()` itself** — it inherits the Pairing Engine's
implementation, which iterates `this.players` and returns one entry per player. The hardest
constraint (every round produces a complete 1..N ranking, ties share a placement) is satisfied
by the Pairing Engine, not by the board:

- Each match win → `wins[playerId]++`. A bye → `wins[byePlayer]++` and `byes[byePlayer]++`.
- A drawn match → `+0.5` to each player (fractional Swiss wins; Pairing Engine §7).
- `Connect4Match.scoreDiff(playerId)` feeds the final tiebreak: `+1000` for a win, `-1000` for a
  loss, `0` for a draw, so match outcomes dominate before any finer differential.

`getResults()` (inherited) sorts `wins desc → head-to-head (adjacency-local) → scoreDiff desc`
and emits:

```js
[ { playerId, placement, wins, byes, scoreDiff, handDescription: '2 wins' }, ... ]
```

with the codebase tie pattern `let placement = 1; if (i>0 && worseThanPrev) placement = i+1;`.
`Scorer.calculateRoundScores(placements, wagers, roundNumber, gameResults)` then distributes
placement points (`PLACEMENT_MULTIPLIERS`) and wager returns by the placements/ties it returns —
identical to every other game. **No Connect-Four-specific code touches the orchestration.**

---

## 3 FSM

### 3.1 Round-level FSM (the `Connect4`/PairingEngine instance)

`Connect4` constructs `BaseGame` with the Pairing Engine's FSM (it subclasses PairingEngine, so
this is inherited — listed here for completeness):

| From | Action (internal) | To | Trigger / onEnter hook |
|------|-------------------|----|------------------------|
| `waiting` | `start` | `match` | `startGame()` → init `wins/byes/diff`, resolve `totalMiniRounds=3`, `_buildMiniRound()`, `_armAllMatchTimers()` |
| `match` | `summary` | `miniRoundSummary` | **barrier:** ALL pairings in the current mini-round resolved → `_enterSummary()` snapshots `lastMiniRound`, starts 10s ack timer |
| `miniRoundSummary` | `next` | `match` | all acked (or 10s auto-ack) AND more mini-rounds remain → `_buildMiniRound()` re-pairs by record, `_armAllMatchTimers()` |
| `miniRoundSummary` | `finish` | `finished` | all acked AND `miniRound === totalMiniRounds` |

`onEnter*` hooks are realized in the Pairing Engine as the `_enterSummary` / `_buildMiniRound`
calls invoked alongside each `transition(...)` (not via BaseGame's `onEnter<State>` naming, since
PairingEngine drives them explicitly). No new hooks are added by Connect Four.

### 3.2 Match-level FSM (inside `Connect4Match`, plain object — NOT a BaseGame)

A single match is a tiny 2-state machine; the Pairing Engine polls `isOver()` after each move.

| From | Action | To | Effect |
|------|--------|----|--------|
| `playing` | `applyMove(pid,{col})` legal, no win | `playing` | drop disc, flip `this.turn` |
| `playing` | `applyMove(pid,{col})` makes 4-in-a-row | `over` (win) | set `_over=true`, `_winner=pid`, `_winningCells=[...]` |
| `playing` | `applyMove` fills last empty cell, no line | `over` (draw) | set `_over=true`, `_winner=null` |

`Connect4Match` exposes no FSM transition API — only `applyMove / getView / isOver / winner /
isDraw / scoreDiff / destroy`. State lives in `_over`, `_winner`, `this.turn`, `this.board`.

---

## 4 Server state

### 4.1 `Connect4` (thin wrapper) — `server/src/games/Connect4.js`

```js
import { PairingEngine } from './PairingEngine.js';
import { Connect4Match } from './Connect4Match.js';
import { TIMERS } from '../../../shared/constants.js';

export class Connect4 extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new Connect4Match(p1, p2),
      miniRounds: 3,
      matchTimerSec: TIMERS.CARD_GAME,   // 30s per turn
      matchHardCapSec: 90,               // whole-match wall-clock backstop
      title: 'Connect 4',
    });
  }
}
```

All Swiss/timer/barrier/leave fields (`wins`, `byes`, `diff`, `h2h`, `matches`, `playerMatch`,
`acknowledged`, `_matchTimers`, `_hardCapTimers`, `_ackTimer`, `_onStateChange`, `miniRound`,
`totalMiniRounds`) are owned by `PairingEngine` (Pairing Engine spec §3.3). `Connect4` adds none.

### 4.2 `Connect4Match` — `server/src/games/Connect4Match.js` (the board)

```js
export const COLS = 7;
export const ROWS = 6;

export class Connect4Match {
  constructor(p1, p2) {
    this.p1 = p1;                 // by convention p1 moves first ('R' = red)
    this.p2 = p2;                 // ('Y' = yellow)
    this.turn = p1;               // playerId whose move it is
    // board[r][c]: 0 = bottom row, 5 = top row. null = empty, else playerId.
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.lastMove = null;         // { col, row, playerId } | null
    this._over = false;
    this._winner = null;          // playerId | null (null = draw or not over)
    this._winningCells = null;    // [[r,c],...] the 4 cells, for client highlight | null
    this._moveCount = 0;
  }
  // ... methods in §5/§6
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `p1`, `p2` | string | the two socket-ids; `p1` = red/first, `p2` = yellow |
| `turn` | string | playerId to move next |
| `board` | `(string\|null)[6][7]` | `board[row][col]`; row 0 = bottom; cell holds the playerId who dropped there |
| `lastMove` | `{col,row,playerId}` \| null | for drop animation + highlight on the client |
| `_over` | bool | match decided |
| `_winner` | string \| null | winner's playerId, or null for draw / in-progress |
| `_winningCells` | `[[r,c]×4]` \| null | the winning line, for client glow |
| `_moveCount` | int | discs placed (42 = full board) |

Disc color is **derived**, not stored: a cell's color is red if its value === `p1`, yellow if === `p2`.

---

## 5 Actions

The Pairing Engine receives all client actions via `handleAction(playerId, action)` and routes
them (Pairing Engine spec §2.5 / §3.6). Connect Four contributes exactly one move type; the
others (`acknowledge`, `ping`) are handled generically by the engine.

| `action.type` | Payload | Handled by | Validation | Effect |
|---------------|---------|-----------|-----------|--------|
| `move` | `{ col: 0..6 }` | `PairingEngine.handleAction` → `Connect4Match.applyMove(pid,{col})` | see below | drop disc, flip turn, maybe end match |
| `acknowledge` | — | PairingEngine (summary barrier) | only in `miniRoundSummary` | adds pid to `acknowledged` |
| `ping` | — | PairingEngine | always no-op | triggers a state rebroadcast (deadlock guard) |

### 5.1 `Connect4Match.applyMove(playerId, move)`

```js
applyMove(playerId, move) {
  // --- turn guard: PairingEngine already verified playerId ∈ {p1,p2} & !isOver() ---
  if (this._over) return false;
  if (playerId !== this.turn) return false;            // not your turn
  const col = move && Number(move.col);                // tolerate string keys (JSON)
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return false; // bad column
  const row = this._lowestEmptyRow(col);
  if (row === -1) return false;                        // column full → illegal, IGNORED

  // --- effect ---
  this.board[row][col] = playerId;
  this.lastMove = { col, row, playerId };
  this._moveCount += 1;

  const line = this._findWinFrom(row, col, playerId);  // 4-in-a-row through the new disc
  if (line) { this._over = true; this._winner = playerId; this._winningCells = line; }
  else if (this._moveCount >= ROWS * COLS) { this._over = true; this._winner = null; } // draw
  else { this.turn = (playerId === this.p1) ? this.p2 : this.p1; } // flip turn

  return true;                                         // accepted → engine re-arms turn timer
}
```

- **`_lowestEmptyRow(col)`** scans `board[0..5][col]`, returns first row whose value is `null`,
  or `-1` if the column is full.
- **`_findWinFrom(row, col, pid)`** checks the 4 directions (horizontal, vertical, two diagonals)
  through the just-placed disc; returns the array of 4 `[r,c]` cells if a run of ≥4 exists, else
  `null`. (Only need to check lines through the new disc — O(1).)
- **Return contract:** `true` = accepted (Pairing Engine re-arms the per-turn timer); `false` =
  illegal/ignored (timer NOT re-armed — Pairing Engine spec §3.6 / edge case 15). A full-column
  or wrong-turn move is silently rejected, the board is unchanged, and the same player must move.

### 5.2 Turn guards (who can move when)

- Only `this.turn` may move; the Pairing Engine never calls `applyMove` for a bye player or for a
  player not in this pairing (`playerMatch[pid] === undefined` → rejected upstream).
- After a match `isOver()`, the Pairing Engine never calls `applyMove` again; any late `move`
  from that pairing is dropped at the engine routing layer (`m.over` guard).

---

## 6 getStateForPlayer (shape; hidden-info rules)

`Connect4` inherits `PairingEngine.getStateForPlayer(playerId)` (Pairing Engine spec §2.6). The
per-match slice comes from `Connect4Match.getView(playerId)`:

```js
getView(playerId) {
  const opp = playerId === this.p1 ? this.p2 : this.p1;
  return {
    board: this.board,            // full 6×7 grid — perfect information, no redaction
    cols: COLS, rows: ROWS,
    turn: this.turn,
    isMyTurn: !this._over && this.turn === playerId,
    myColor: playerId === this.p1 ? 'R' : 'Y',     // red=first, yellow=second
    oppColor: opp === this.p1 ? 'R' : 'Y',
    lastMove: this.lastMove,      // {col,row,playerId} | null — for drop animation
    over: this._over,
    winnerId: this._winner,       // playerId | null
    draw: this._over && this._winner === null,
    winningCells: this._winningCells,  // [[r,c]×4] | null — client glow
    legalCols: this._legalCols(),      // [0,2,3,...] non-full columns, for tap targets
  };
}
```

The full assembled `gameState` the client receives (Pairing Engine builds it):

```js
{
  phase: 'match' | 'miniRoundSummary' | 'finished',
  miniRound: 2, totalMiniRounds: 3,
  myMatch: {                       // null when phase!=='match'
    opponentId: '<id>' | null,     // null === bye
    isBye: false,
    result: null | 'win' | 'loss' | 'draw',
    turnEndsAt: 1718000000000,     // epoch ms for the per-turn countdown (null if not my turn)
    ...getView(playerId),          // board, isMyTurn, myColor, lastMove, over, winningCells, legalCols
  },
  standings: [ { playerId, wins, byes, scoreDiff, rank, displayWins }, ... ], // all N
  waitingOn: ['<id>', ...],        // pairings still unresolved this mini-round
  myMiniRoundDone: true,           // did THIS player's match already resolve?
  lastMiniRound: { pairings: [ { p1, p2, winnerId, isBye, draw } ] } | null, // summary only
}
```

**Hidden-info rules:** none. Connect Four is perfect-information — `board` is sent in full to both
players (and to spectators in other pairings). The only "filtering" is per-player convenience
fields (`isMyTurn`, `myColor`, `result`, `turnEndsAt`). Standings/`waitingOn` are identical for all.

`scoreDiff(playerId)`:

```js
scoreDiff(playerId) {
  if (!this._over) return 0;
  if (this._winner === null) return 0;              // draw
  return this._winner === playerId ? 1000 : -1000;  // wins dominate the diff tiebreak
}
```

`destroy()` is a no-op for `Connect4Match` (it owns no timers — the Pairing Engine owns all
timers). Keep the method present so `match.engine.destroy?.()` is safe.

---

## 7 Timers & broadcasting

**All timers are owned by the Pairing Engine** (Pairing Engine spec §3.9–§3.10). Connect Four
configures durations only and the Match exposes the hooks the engine needs.

- **Per-turn timer:** `TIMERS.CARD_GAME` (30s). Armed/re-armed by the engine on each accepted
  move. `myMatch.turnEndsAt` = epoch ms of expiry, surfaced to the client for the countdown.
- **Hard cap:** `matchHardCapSec` (90s) wall-clock backstop so a single ping-pong match can't
  hold the room past the barrier.
- **Mini-round summary auto-advance:** 10s ack timer (engine) auto-acks stragglers.

### 7.1 Auto-action on timeout (the brief's "auto-drop random legal col")

The brief specifies a random legal drop on timeout. The Pairing Engine's default timeout behavior
is **auto-forfeit the staller**. For Connect Four we override the timeout to instead **auto-drop a
random legal column** so a single slow turn doesn't hand the whole match away. This is done by
having `Connect4Match` expose a helper the engine's timeout path calls **if present**:

```js
// Connect4Match — optional auto-move provider the PairingEngine timeout path uses.
autoMove() {                       // returns a legal {col} for the current turn, or null
  const legal = this._legalCols();
  if (!legal.length) return null;  // board full (shouldn't happen — draw would have fired)
  const col = legal[Math.floor(Math.random() * legal.length)];
  return { col };
}
```

Pairing-engine timeout path (per-turn timer fires) becomes:

```
on per-turn timeout for match mi:
  m = matches[mi]; if (state!=='match' || m.over) return;
  const auto = m.engine.autoMove?.();         // Connect4Match provides one
  if (auto) { m.engine.applyMove(m.engine.getView(m.p1).turn, auto); _rearmTurnTimer(mi); }
  else      { /* fallback: forfeit whoever's turn it is (engine default) */ }
  if (m.engine.isOver()) _resolveMatch(mi);    // may trip the barrier
  _emitChange();                               // MANDATORY broadcast (see below)
```

> **Decision:** per-turn timeout = auto-drop random legal col (keeps the match alive). The
> **hard cap** (90s) keeps the engine's forfeit fallback (forfeit whoever's turn it is) so a
> pathological auto-vs-auto loop still terminates within the cap. This matches the brief
> ("auto-drop random legal col — pairing engine owns") while preserving the deadlock backstop.

### 7.2 `setOnStateChange` / `_emitChange`

Inherited from the Pairing Engine. **Every timer-driven mutation** (auto-drop, forfeit at cap,
ack auto-advance) calls `_emitChange()` after mutating, so the orchestration's `setOnStateChange`
callback (`server/src/index.js` ~1205) rebroadcasts `getStateForPlayer` to all and re-checks
`isComplete()`. Without this, a match resolving on a timer while the room is idle freezes clients
(the exact v2.7.0 bug class). `Connect4Match` itself never calls `_emitChange` — it has no timers.

---

## 8 Scoring & getResults

`getResults()` is **inherited from the Pairing Engine** — Connect Four does not override it.

- **Win** (line found) → `wins[winner]++`, `h2h[a|b]=winner`, `diff[winner]+=1000`, `diff[loser]-=1000`.
- **Draw** (full board, no line) → `wins[p1]+=0.5`, `wins[p2]+=0.5`, `m.draw=true`, both `diff+=0`.
- **Bye** (odd N) → `wins[byePlayer]++`, `byes[byePlayer]++` (free win).
- **Timeout auto-drop** keeps the match going; only a real line/draw/forfeit ends it.

Ranking key (inherited): `wins desc → head-to-head (adjacency-local tiebreak between equal-wins
neighbors) → scoreDiff desc`. Tie rule (codebase convention):

```js
let placement = 1;
return entries.map((e, i) => {
  if (i>0 && (e.wins < entries[i-1].wins ||
      (e.wins === entries[i-1].wins && e.scoreDiff < entries[i-1].scoreDiff)))
    placement = i+1;
  return { ...e, placement, handDescription: `${e.wins} win${e.wins===1?'':'s'}` };
});
```

Tied players (same `wins`, same `scoreDiff`, no decisive head-to-head) share a placement number;
`Scorer.calculateRoundScores` handles shared placements natively. Every one of the N players
appears exactly once. The orchestration calls `getResults()` after `isComplete()` becomes true
and feeds placements + `gameResults` (for ties) straight into `tm.completeRound(...)`.

---

## 9 Leave & deadlock handling

**All leave handling lives in the Pairing Engine** (Pairing Engine spec §6). `Connect4Match`
implements **no** leave logic — when a player leaves, the engine resolves their match without ever
calling into the board for that pairing again. Connect Four neither overrides `removePlayer`,
`_removeFromActive`, nor `destroy` (all inherited). Concrete behavior by phase:

| Phase when player leaves | Pairing Engine action (inherited) | Connect4Match involvement |
|--------------------------|-----------------------------------|---------------------------|
| Mid-match, in a live pairing | `removePlayer` forfeits their current match → opponent `wins++`, `h2h` recorded, `m.over=true`, clears that match's timers; excluded from all future mini-rounds; if forfeit completes the mini-round → `_enterSummary()` | none — engine sets `m.engine=null`; board discarded |
| Mid-match, opponent of the leaver | opponent is awarded the win immediately; if both pairings now resolved → barrier trips | none |
| Bye holder leaves | their synthetic bye match marked `over`; nothing to award | none |
| Fast finisher (already done, waiting at barrier) | removed from `this.players` + `acknowledged`; if they were the last outstanding match/ack → advance | none |
| On `miniRoundSummary` screen | removed from `acknowledged`; if remaining all acked → `next`/`finish` | none |
| Leaves drop room to 1 player | `removePlayer` sets `state='finished'`; orchestration force-completes; survivor `placement:1` (results iterate `this.players`) | none |

**Current/last-needed-player nuances:**
- *Current mover leaves mid-match:* their unfinished match is a **forfeit to the opponent**
  (not a draw, not a replay). The board is thrown away; the opponent gets the win and the diff.
- *Last unresolved pairing's player leaves:* the forfeit completes `_allMatchesOver()` → barrier
  trips → summary appears for everyone (no hang).
- *Simultaneous-game rule:* because multiple matches run at once, the engine **auto-forfeits** the
  leaver's live match and **auto-acks** the summary barrier on their behalf — it never waits on a
  player who is gone (v2.7.0 simultaneous-game requirement).

**`destroy()`** (inherited) clears all per-turn timers, all hard-cap timers, the ack timer, nulls
every live `match.engine` via `engine.destroy?.()`, and nulls `_onStateChange`. The orchestration
calls it before discarding the game so no orphaned timer fires on a torn-down instance.

**Timer ↔ `_emitChange` invariant:** every `setTimeout`-driven advance (auto-drop, hard-cap
forfeit, ack auto-advance) calls `_emitChange()` after mutating — the single most important
deadlock-prevention rule, enforced in the Pairing Engine.

---

## 10 Client component

Files (`gameId = connect4`):

| File | Purpose |
|------|---------|
| `client/src/games/Connect4.jsx` | Board component; consumes `gameState.myMatch`, emits `onAction({type:'move', move:{col}})` |
| `client/src/games/Connect4.module.css` | Blue board, red/yellow disc styles, drop animation, Fredoka One title |
| (shared) `client/src/games/PairingShell.jsx` | Swiss chrome (header, standings strip, barrier, bye card, summary) — provided by the Pairing Engine deliverable |

Standard contract from `App.jsx`:

```jsx
function Connect4Game({ gameState, onAction, nicknames, avatars }) { ... }
```

The component renders `<PairingShell gameState={gameState} nicknames={nicknames}
avatars={avatars}>` and supplies the board as a render-prop reading `gameState.myMatch`.

### 10.1 Per-phase screens

| `phase` / condition | Render |
|---------------------|--------|
| `match`, `myMatch.isBye` | "Bye this round — free win!" card + live standings strip. No board. |
| `match`, `!myMatch.over` | 7×6 board; columns interactive only if `myMatch.isMyTurn`; turn indicator ("Your turn" / "{opp}'s turn"); per-turn countdown from `myMatch.turnEndsAt`; standings strip. |
| `match`, `myMatch.over` (fast finisher) | Frozen board with winning line glowing (`winningCells`); result banner (Win/Loss/Draw); "Waiting on: {names}" from `waitingOn`. |
| `miniRoundSummary` | `lastMiniRound.pairings` list (`p1 vs p2 → winner`, bye highlighted, draw labeled) + "Continue" → `onAction({type:'acknowledge'})`; after ack: "Waiting for others…". |
| `finished` | Final standings; `ROUND_RESULTS` screen takes over. |

### 10.2 Layout

- Board: CSS grid, 7 columns × 6 rows, `aspect-ratio` locked so discs are circular on any width.
  Render top-row-first visually (`board[5]` at top, `board[0]` at bottom) — iterate rows
  descending so gravity reads correctly.
- A column-header click-strip (7 wide tap zones) sits above the grid; tapping a column targets it.
- Standings strip + "mini-round X/Y" header come from `PairingShell` (shared), so the board file
  only owns the grid + column controls.

### 10.3 Touch (no hover) — tap-to-preview + confirm

Per the CLAUDE.md touch convention:
- **First tap** on a column → ghost disc shown at the lowest empty cell of that column
  (`myColor`), column highlighted. No move sent yet.
- **Second tap on the same column** → commit `onAction({ type:'move', move:{ col } })`.
- A persistent **"Drop"** confirm button (enabled once a column is previewed) provides an explicit
  accessible commit path. Tapping a different column moves the preview.
- Full columns (`!legalCols.includes(col)`) are disabled (greyed, non-tappable).
- No `:hover`-only affordances — desktop pointer also uses the same preview/confirm, with hover as
  a bonus highlight only.

### 10.4 Sound & shake

- `useSound()`: disc-drop click on each accepted move (own + opponent, detected via `lastMove`
  change), win sting on `myMatch.result==='win'`, lose tone on `'loss'`, soft tick when
  `waitingOn` shrinks, summary chime on `phase==='miniRoundSummary'`.
- `useScreenShake()`: `shake('medium')` on your own win (4-in-a-row landed), `shake('light')` on a
  draw. No shake for a loss (avoid punishing feel).

### 10.5 gameState reads / actions emitted

- **Reads:** `gameState.phase`, `gameState.myMatch.{board,isMyTurn,myColor,lastMove,over,result,
  winningCells,legalCols,turnEndsAt,opponentId,isBye}`, `gameState.standings`,
  `gameState.waitingOn`, `gameState.miniRound`, `gameState.totalMiniRounds`,
  `gameState.lastMiniRound`.
- **Emits:** `onAction({type:'move', move:{col}})`, `onAction({type:'acknowledge'})`,
  `onAction({type:'ping'})` (local turn timer hit 0 with no fresh `GAME_STATE`).
- **Re-render smoothness:** keep the last board rendered until the next `GAME_STATE` (never null it
  between phases — "no screen jerk" UX rule). Memoize the grid on `myMatch.board` identity; the
  countdown is its own component reading `turnEndsAt` so it doesn't re-render the grid each tick.

---

## 11 Registration checklist

| # | Path | Exact edit |
|---|------|------------|
| 1 | `server/src/games/Connect4Match.js` | **NEW.** The `Connect4Match` board class (§4.2, §5, §6). Export `Connect4Match`, `COLS=7`, `ROWS=6`. |
| 1b | `server/src/games/Connect4.js` | **NEW.** `Connect4 extends PairingEngine` wrapper (§4.1). |
| 2 | `shared/gameList.js` | Add `GAMES.connect4` entry (values below). |
| 3 | `shared/constants.js` | No new timer needed — reuse `TIMERS.CARD_GAME` (30s). (`matchHardCapSec:90` is a literal in the wrapper; add `TIMERS.CONNECT4_HARDCAP=90` only if you prefer it centralized.) |
| 4 | `server/src/games/registry.js` | `import { Connect4 } from './Connect4.js';` then `registerGame('connect4', Connect4);` |
| 5 | `client/src/games/Connect4.jsx` + `Connect4.module.css` | **NEW.** Board component (§10). Props `{gameState,onAction,nicknames,avatars}`; uses `PlayerName`, `useSound()`, `useScreenShake()`; Fredoka One title font. |
| 6 | `client/src/assets/gamepreviews/connect4.png` | **NEW.** Preview thumbnail (blue board with a red/yellow stack). |
| 7 | `client/src/App.jsx` | `import Connect4Game from './games/Connect4.jsx';` then add `connect4: Connect4Game` to `GAME_COMPONENTS`. |
| 8 | `client/src/screens/GameVote.jsx` | `import connect4Preview from '../assets/gamepreviews/connect4.png';` then add `connect4: connect4Preview` to `GAME_PREVIEWS`. |

**Plus (Pairing Engine prerequisite, once):** `server/src/games/PairingEngine.js` and
`client/src/games/PairingShell.jsx` must already exist (their own spec). Connect Four is the first
consumer; subsequent 1v1 games reuse both.

### 11.1 Concrete `shared/gameList.js` entry

```js
connect4: {
  id: 'connect4', name: 'Connect 4', minPlayers: 2, maxPlayers: 8,
  turnTimer: TIMERS.CARD_GAME,
  description: 'Drop discs, get four in a row. 1v1 matchups across a best-of-3 ladder.',
  instructions: [
    'You are paired 1v1 against another player each mini-round (odd player count = one free-win bye).',
    'Take turns dropping a disc into a column — it falls to the lowest empty slot.',
    'First to line up four of your discs in a row (across, down, or diagonally) wins the match.',
    'Full board with no four-in-a-row = a draw (counts as half a win for both).',
    'Win your matches across 3 mini-rounds; the most wins ranks first. Slowpokes get a random drop after 30s.',
  ],
},
```

(Use `instructions[]` like Spot the Difference rather than a YouTube `tutorial` — Connect Four
needs no external link, and the Swiss-ladder framing benefits from in-app rules.)

---

## 12 Edge cases & test scenarios

Board-level (`Connect4Match`) and round-level (`PairingEngine` interplay) assertions. Use a
headless `Connect4Match` for board tests and the Pairing Engine's `StubMatch` harness for the
ladder; add Connect-Four-specific cases:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Drop into empty column | Lands at `board[0][col]`; `lastMove.row===0`; turn flips to opponent. |
| 2 | Stack a column to full (6 discs) | 6th drop lands `row 5`; 7th `applyMove` on that col → `_lowestEmptyRow` returns -1 → `applyMove` returns **false**, board unchanged, turn unchanged. |
| 3 | Horizontal 4-in-a-row | `_findWinFrom` returns 4 cells; `_over=true`, `_winner=mover`, `winningCells` set. |
| 4 | Vertical 4-in-a-row | Same; detected on the 4th stacked disc. |
| 5 | Both diagonals | `/` and `\` runs of 4 each detected through the new disc. |
| 6 | Full board, no line | 42nd disc with no win → `_over=true`, `_winner=null`, `isDraw()===true`. |
| 7 | Move out of turn | `applyMove(opponent,{col})` while `turn` is mine → returns false, no mutation. |
| 8 | Bad column (`-1`, `7`, `'3'`, missing) | `Number(col)` validated; `'3'`→3 accepted, `7`/`-1`/`NaN`→false (JSON-string-key safety, edge 16). |
| 9 | `scoreDiff` after win/loss/draw | `+1000` / `-1000` / `0`. Drives final tiebreak. |
| 10 | Per-turn timeout (30s) | Pairing Engine calls `autoMove()` → random legal `{col}` dropped → turn continues; `_emitChange` fired. NOT a forfeit. |
| 11 | Hard cap (90s) reached | Engine forfeits whoever's turn it is (auto-vs-auto loop terminates); `_emitChange` fired; barrier may trip. |
| 12 | Odd N (5) | 2 matches + 1 bye each mini-round; bye = +1 win; `getResults` ranks all 5. |
| 13 | N=2 | Best-of-3 rematches; `hasMet` always true → forced-rematch path; 1st/2nd by match wins, ties by diff. |
| 14 | Draw in a match | Both `+0.5` win; summary labels "Draw"; `getResults` sorts fractional wins fine. |
| 15 | **Leave/deadlock: current mover leaves mid-match** | `removePlayer` (engine) forfeits → opponent `+1 win`; leaver excluded from future mini-rounds + `getResults`; if barrier completes → summary. Assert `_emitChange`/finish path fires. |
| 16 | Leave: last unresolved pairing's player leaves | Forfeit completes `_allMatchesOver()` → `_enterSummary()`; no room hang. |
| 17 | Leave: fast finisher / on summary screen | Auto-removed from `acknowledged`; if last outstanding → advance (`next`/`finish`). |
| 18 | Two leaves → 1 survivor | Engine sets `finished`; orchestration force-completes; survivor `placement:1`. |
| 19 | `move` from a bye player / wrong pairing | `playerMatch[pid]===undefined` → ignored at engine layer. |
| 20 | `acknowledge` outside summary / `ping` anytime | Guarded no-op; `ping` triggers rebroadcast only. |

**Leave/deadlock harness assertions (must pass):** every match-completion path (line win,
auto-drop-into-win, hard-cap forfeit, leave forfeit) funnels through the engine's
`_resolveMatch → _allMatchesOver → _enterSummary` chokepoint and each timer path calls
`_emitChange()` exactly once after mutating. `destroy()` clears all timers (assert no timer fires
after teardown via fake timers).

---

## 13 Effort & risks

**Effort:**
- `Connect4Match` (board + win detection + auto-move): **S–M** (~150–200 LOC; win check is the
  only non-trivial bit, and it's a standard 4-direction scan through the last disc).
- `Connect4.js` wrapper: **S** (~15 LOC).
- `Connect4.jsx` + CSS (board UI, drop animation, tap-to-preview): **M** (~250–300 LOC).
- Registration: **S** (8 mechanical edits).
- **Net for Connect Four alone: M** — *assuming the Pairing Engine + PairingShell already exist*.

**Dependencies / blockers:**
- **Hard dependency on the Pairing Engine + PairingShell** (separate spec, effort **L**). Connect
  Four cannot ship until those land. Build order: PairingEngine → PairingShell → Connect4Match →
  Connect4 wrapper → client board → register.

**Risks / hotspots:**
- **Win-detection correctness** — off-by-one in the 4-direction scan is the classic Connect Four
  bug. Mitigate with exhaustive unit tests (cases 3–6) and by scanning only through the new disc.
- **Auto-drop vs forfeit semantics** — must wire the per-turn timeout to `autoMove()` (keep match
  alive) while the hard cap keeps the forfeit backstop. Getting these crossed either hangs the
  room (no backstop) or hands matches away on a single slow turn. Covered by cases 10–11.
- **Timer ↔ `_emitChange`** — inherited risk from the Pairing Engine; Connect Four adds no timers
  but the auto-drop path must still emit. Asserted in the harness.
- **JSON column key** — `move.col` may arrive as `'3'` after Socket.IO; `Number(col)` guard
  (case 8) prevents a silent reject.

---

## 14 Open questions

1. **Auto-drop vs forfeit on per-turn timeout.** This spec chooses auto-drop-random-legal-col per
   the brief, with the 90s hard cap as the forfeit backstop. Alternative (simpler, matches the
   Pairing Engine default everywhere): straight forfeit on the 30s turn timer, no `autoMove`.
   Confirm we want the per-turn auto-drop override (more forgiving, more code) over a plain forfeit.
2. **First-move advantage.** Red (`p1`) moving first is a known edge in Connect Four. The Pairing
   Engine randomizes `(p1,p2)` order per match so it spreads across the ladder, but for N=2
   best-of-3 it isn't perfectly balanced (2 reds vs 1, or vice versa). Acceptable, or force
   strict alternation of who is red across a 2-player rematch series?
3. **Draw scoring (+0.5/+0.5).** Inherited from the Pairing Engine open question — draws in
   Connect Four are common enough that fractional wins will appear in standings/`handDescription`
   (e.g. "2.5 wins"). Confirm the UI formats fractional wins acceptably, or switch to integer-wins
   + scoreDiff tiebreak.
4. **`miniRounds: 3` enough for Connect Four?** A best-of-3 of a ~2-minute board game per mini-round
   could run long for N=2 (up to 3 full games). Consider `miniRounds: 3` is fine, or cap match
   length harder (lower `matchHardCapSec`) so a round stays snappy.
5. **Preview asset.** Need a `connect4.png` gamepreview — generate or source a board image
   consistent with the other previews' style.
6. **Centralize the hard cap?** Currently `matchHardCapSec:90` is a literal in `Connect4.js`. Add
   `TIMERS.CONNECT4_HARDCAP` to `shared/constants.js` for consistency, or leave as a wrapper
   literal since it's engine-config, not a shared game timer?
