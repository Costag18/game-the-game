# Ultimate Tic-Tac-Toe — Implementation Spec

- **slug:** `ultimate-tic-tac-toe`
- **gameId:** `ultimateTicTacToe`
- **status:** draft / build-ready
- **date:** 2026-06-08
- **depends on:** `server/src/games/PairingEngine.js` (see `docs/superpowers/specs/2026-06-08-pairing-engine-spec.md`), `server/src/games/BaseGame.js` (v2.7.0 leave contract), `shared/constants.js`, `server/src/tournament/Scorer.js`
- **scope:** Implement **only** the `UltimateTTTMatch` MatchEngine (a single 1v1 board) plus the thin `UltimateTicTacToe extends PairingEngine` wrapper and the client board component. The N-player ranking, FSM, mini-round barrier, dual timers, and leave handling all live in the **already-specced PairingEngine** — do not re-implement them here.

> **Read the Pairing Engine spec first.** This game is inherently 1v1. It plugs a `matchFactory` into the PairingEngine, which wraps 2–8 players in a Swiss mini-tournament and produces the full N-player ranking. UTTT's only original code is the board rules in `UltimateTTTMatch`.

---

## 1. Overview

| Field | Value |
|-------|-------|
| **Players** | 2–8 (1v1 matches wrapped by PairingEngine into a Swiss mini-tournament) |
| **Type** | 1v1, turn-based, perfect-information; PairingEngine runs concurrent matches per mini-round |
| **Length** | 3 mini-rounds (PairingEngine `miniRounds: 3`); each match is a single Ultimate Tic-Tac-Toe game |
| **Per-match turn timer** | `TIMERS.CARD_GAME` (30s) per move → auto **random legal move** on timeout (PairingEngine timer fires, but the *random move selection* is the MatchEngine's job — see §7) |
| **Match hard cap** | PairingEngine default 90s (forfeits whoever is to move) |
| **Hidden info** | **None.** Both players see the full board. The MatchEngine `getView` returns the same board to both; only `yourMark` / `yourTurn` differ. |
| **Title font** | **'Press Start 2P'** (primary) with **'Silkscreen'** fallback — retro 8-bit grid aesthetic. Title only; body stays default per CLAUDE.md Fonts convention. Add to the Google Fonts `<link>`. |
| **Display name** | "Ultimate Tic-Tac-Toe" |

**Rules recap (the board logic you implement):**
- The board is a **3×3 grid of 3×3 sub-boards** (the "meta board" of 9 cells, each cell itself a tic-tac-toe board).
- A move is `{ board: 0..8, cell: 0..8 }` — place your mark in sub-board `board`, cell `cell`.
- **Forced-board rule:** after a move in cell `c` of any sub-board, the opponent **must** play in sub-board `c`. If sub-board `c` is already won or full, the opponent may play in **any** open sub-board ("free move").
- Winning a sub-board: 3 of your marks in a row within that 3×3 → that meta cell becomes yours.
- Winning the meta: 3 won sub-boards in a line (row/col/diag) on the meta board → you win the match.
- **Draw:** meta board fills (every sub-board won or full) with no 3-in-a-row line → draw. PairingEngine scores a draw as +0.5 win each (see Pairing spec §7).

---

## 2. Tournament fit

`getResults()` is **provided entirely by PairingEngine** — UTTT does not implement it. PairingEngine ranks **all N players** by `wins desc → head-to-head → scoreDiff desc`, assigns placements 1..N with the codebase tie pattern (`let placement=1; if (i>0 && worseThanPrev) placement=i+1;`), and every player is present in the returned array. `Scorer.calculateRoundScores` then distributes placement points (`PLACEMENT_MULTIPLIERS=[1.0,0.7,0.5,0.35,0.25,0.15]`) and wager returns across all participants. **No per-game ranking code in UTTT.**

What UTTT contributes to ranking: `UltimateTTTMatch.winner()` / `isDraw()` decide per-match win/loss/draw, and `scoreDiff(playerId)` feeds the final tiebreak. Definition (see §8):

```
scoreDiff(playerId) = (mySubBoardsWon - oppSubBoardsWon)
                      + (winner()===playerId ? +1000 : winner()&&winner()!==playerId ? -1000 : 0)
```

so a match win dominates the diff, and among equal records a player who won sub-boards more decisively ranks higher.

---

## 3. FSM

**UTTT itself has no FSM** — the FSM lives in PairingEngine (`waiting → match → miniRoundSummary → finished`, see Pairing spec §3.2). `UltimateTTTMatch` is a **plain class** (does NOT extend BaseGame, has no `transition`/`states`). Its only internal "state machine" is the board status:

| Match status | Set when | Effect on PairingEngine |
|--------------|----------|--------------------------|
| `playing` | construction / after a move that didn't end the game | `isOver()===false`; engine keeps routing moves + arms turn timer |
| `won` | a move completes a 3-in-a-row line on the meta board | `isOver()===true`, `winner()===mover`; PairingEngine `_resolveMatch` credits the win, trips barrier if all matches done |
| `draw` | meta board fully decided (all 9 sub-boards won/full), no line | `isOver()===true`, `winner()===null`, `isDraw()===true`; PairingEngine credits +0.5 each |

**onEnter hooks:** N/A for the MatchEngine (no FSM). The PairingEngine's `onEnter*` hooks (none are defined; transitions trigger `_buildMiniRound` / `_enterSummary` explicitly) are unchanged. The `UltimateTicTacToe extends PairingEngine` wrapper adds **no** new states or hooks.

---

## 4. Server state

### 4.1 Wrapper: `server/src/games/UltimateTicTacToe.js`

Thin subclass; holds no game state of its own beyond what it passes to `super`:

```js
import { PairingEngine } from './PairingEngine.js';
import { UltimateTTTMatch } from './UltimateTTTMatch.js';
import { TIMERS } from '../../../shared/constants.js';

export class UltimateTicTacToe extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new UltimateTTTMatch(p1, p2),
      miniRounds: 3,
      matchTimerSec: TIMERS.CARD_GAME,   // 30s per move
      matchHardCapSec: 120,              // UTTT games run long; give a generous cap
      title: 'Ultimate Tic-Tac-Toe',
    });
  }
}
```

### 4.2 MatchEngine: `server/src/games/UltimateTTTMatch.js` (the real work)

Fields:

```js
this.p1;            // playerId — moves first (X). PairingEngine randomizes (p1,p2) order.
this.p2;            // playerId — moves second (O)
this.marks = { [p1]: 'X', [p2]: 'O' };
this.turn;          // playerId whose move it is — init p1

// 9 sub-boards, each an array of 9 cells: '' | 'X' | 'O'
this.sub = Array.from({ length: 9 }, () => Array(9).fill(''));

// meta board: per sub-board status: '' (in play) | 'X' | 'O' | 'D' (drawn/full no winner)
this.meta = Array(9).fill('');

this.forcedBoard;   // 0..8 the next mover MUST play in, or null === free move (any open board)
this.lastMove;      // { board, cell, mark, playerId } | null — for client highlight
this._status;       // 'playing' | 'won' | 'draw'
this._winner;       // playerId | null
```

**Helper constant:** `LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]` — reused for both sub-board wins and meta wins.

**No timers, no hidden info, no leave logic in this file** — PairingEngine owns all of that.

---

## 5. Actions

Only one action type reaches the MatchEngine. PairingEngine has already verified `playerId ∈ {p1,p2}` and `isOver()===false` before calling `applyMove`. `acknowledge` / `ping` are handled by PairingEngine, never by the match.

### `applyMove(playerId, move)` → returns `true` (accepted) / `false` (illegal, ignored)

| Step | Rule |
|------|------|
| **Payload** | `move = { board: 0..8, cell: 0..8 }` |
| **Turn guard** | `if (playerId !== this.turn) return false;` |
| **Status guard** | `if (this._status !== 'playing') return false;` |
| **Bounds** | `board` and `cell` must be integers `0..8` (coerce with `Number()`, reject `NaN`/out-of-range) → else `false` |
| **Forced-board rule** | if `this.forcedBoard !== null` and `board !== this.forcedBoard` → `false`. (If `forcedBoard===null`, any open board is allowed.) |
| **Sub-board open** | `if (this.meta[board] !== '') return false;` (sub-board already won or drawn — cannot play there) |
| **Cell empty** | `if (this.sub[board][cell] !== '') return false;` |

**Effects (on a valid move):**
```js
const mark = this.marks[playerId];
this.sub[board][cell] = mark;
this.lastMove = { board, cell, mark, playerId };

// 1) did this complete the sub-board?
if (this._lineWin(this.sub[board], mark)) this.meta[board] = mark;
else if (this.sub[board].every(c => c !== '')) this.meta[board] = 'D'; // full, no winner

// 2) did completing a sub-board win the META?
if (this.meta[board] === mark && this._lineWin(this.meta, mark)) {
  this._status = 'won'; this._winner = playerId; this.forcedBoard = null; this.turn = null;
  return true;
}

// 3) META draw? all sub-boards decided, no line for either
if (this.meta.every(m => m !== '')) {
  this._status = 'draw'; this._winner = null; this.forcedBoard = null; this.turn = null;
  return true;
}

// 4) compute next forced board from the cell just played
const target = cell;                       // opponent must play in sub-board === cell index
this.forcedBoard = (this.meta[target] === '') ? target : null;  // null => free move
this.turn = (playerId === this.p1) ? this.p2 : this.p1;
return true;
```

`_lineWin(cells, mark)` = `LINES.some(L => L.every(i => cells[i] === mark))`.

**`scoreDiff(playerId)`** and **`getView(playerId)`** in §6/§8. No `forfeit()` / `destroy()` needed (PairingEngine tracks the authoritative winner and owns timers); both are optional in the contract and omitted.

---

## 6. getStateForPlayer / getView

UTTT does **not** implement `getStateForPlayer` — PairingEngine does (Pairing spec §2.6). PairingEngine builds `myMatch` by spreading `matchEngine.getView(playerId)`. UTTT must implement `getView(playerId)`:

```js
getView(playerId) {
  return {
    metaBoard: [...this.meta],                 // 9: '' | 'X' | 'O' | 'D'
    subBoards: this.sub.map(b => [...b]),       // 9 × 9 of '' | 'X' | 'O'
    forcedBoard: this.forcedBoard,              // 0..8 | null (null = play any open board)
    yourMark: this.marks[playerId],             // 'X' | 'O'
    turn: this.turn,                            // playerId | null  (PairingEngine reads this for timers)
    yourTurn: this.turn === playerId,
    lastMove: this.lastMove,                    // { board, cell, mark, playerId } | null
    status: this._status,                       // 'playing' | 'won' | 'draw'
    winnerMark: this._winner ? this.marks[this._winner] : null,
  };
}
```

**Hidden-info rules:** none — UTTT is perfect information. `getView` returns the identical board to both players; the only player-specific fields are `yourMark` / `yourTurn`. PairingEngine wraps this with `opponentId`, `isBye`, `result`, `turnEndsAt`, and the cross-board `standings` / `waitingOn`. The full per-player payload the client receives is the Pairing spec §2.6 object with `myMatch` = `{ opponentId, isBye, ...getView(playerId), over, result, turnEndsAt }`.

`PairingEngine` reads `getView(p1).turn` to know whose per-turn clock to run and who to forfeit on timeout — so keeping `turn` accurate (set to `null` when the match ends) is load-bearing.

---

## 7. Timers & broadcasting

**All timers are owned by PairingEngine** (per-turn `matchTimerSec` + per-match `matchHardCapSec`), and **every** timer-driven mutation in PairingEngine already calls `_emitChange()` (Pairing spec §3.9–3.10) so the orchestration rebroadcasts `getStateForPlayer` and re-checks `isComplete()`. UTTT adds **no** timers and **no** `setOnStateChange`/`_emitChange` of its own.

**Auto-action on timeout — the one UTTT-specific hook.** The brief requires "auto **random legal move**" rather than a forfeit. There are two equivalent ways to wire this; pick **Option A** (cleaner, keeps the game alive):

- **Option A (recommended — random legal move):** add an optional method to the MatchEngine and have the PairingEngine's per-turn timeout prefer it when present:
  ```js
  // UltimateTTTMatch
  autoMove(playerId) {                 // PairingEngine calls this on per-turn timeout if defined
    if (playerId !== this.turn || this._status !== 'playing') return false;
    const moves = this.legalMoves();   // [{board,cell}, ...]
    if (moves.length === 0) return false;
    const m = moves[Math.floor(Math.random() * moves.length)];
    return this.applyMove(playerId, m);
  }
  legalMoves() {
    const out = [];
    const boards = this.forcedBoard !== null
      ? [this.forcedBoard]
      : this.meta.map((s,i)=> s===''? i : -1).filter(i=>i>=0);
    for (const b of boards)
      for (let c=0;c<9;c++) if (this.sub[b][c]==='') out.push({ board:b, cell:c });
    return out;
  }
  ```
  PairingEngine per-turn timeout becomes: `if (m.engine.autoMove?.(staller)) { rearm if !over; if over resolve; } else { forfeit }`. This requires a **one-line tweak** to the PairingEngine timeout handler (documented as a small extension of Pairing spec §3.9: "if the MatchEngine exposes `autoMove`, attempt it; if it returns true and the match isn't over, re-arm the turn timer; otherwise forfeit"). The **hard cap** still forfeits (a match that's gone 120s ends decisively).

- **Option B (no PairingEngine change — pure forfeit):** if you don't want to touch PairingEngine, the per-turn timeout forfeits the staller (opponent wins). Simpler, but the brief explicitly asks for a random legal move, so prefer A.

**Broadcasting:** entirely via PairingEngine — a valid move (human or auto) flows `handleAction → applyMove → if isOver _resolveMatch → maybe _enterSummary`, and the index.js `GAME_ACTION` handler rebroadcasts. Timer-driven auto-moves go through PairingEngine's `_emitChange()`.

---

## 8. Scoring & getResults

**`getResults()` is PairingEngine's** (Pairing spec §2.7 / §3.11) — UTTT implements none of it. The chain:
1. Each match resolves: `UltimateTTTMatch.winner()` (a `playerId` or `null`) / `isDraw()`.
2. PairingEngine credits `wins[winner]++` (or `+0.5` each on draw), records head-to-head, and accumulates `diff[p] += match.scoreDiff(p)`.
3. After 3 mini-rounds, PairingEngine `getResults()` returns the full 1..N ranking; ties share a placement.

**UTTT's `scoreDiff(playerId)` (the only scoring code in this game):**
```js
scoreDiff(playerId) {
  const opp = playerId === this.p1 ? this.p2 : this.p1;
  const myMark = this.marks[playerId], oppMark = this.marks[opp];
  const mine = this.meta.filter(m => m === myMark).length;
  const theirs = this.meta.filter(m => m === oppMark).length;
  let bonus = 0;
  if (this._winner === playerId) bonus = 1000;
  else if (this._winner && this._winner !== playerId) bonus = -1000;
  return (mine - theirs) + bonus;   // wins dominate; sub-board margin breaks near-ties
}
```

**Tie rule:** handled by PairingEngine exactly per the codebase convention — equal `wins` → head-to-head (adjacency-local) → `scoreDiff` desc; genuine ties share the same placement number and `Scorer` distributes shared placements correctly.

---

## 9. Leave & deadlock handling

**All leave/deadlock handling is PairingEngine's** (Pairing spec §6). UTTT (`UltimateTTTMatch`) implements **no** `removePlayer` / `_removeFromActive` / `destroy` and holds no timers — there is nothing to tear down. Per the contract, the MatchEngine never implements leave logic.

Concretely, when a player leaves, PairingEngine's `removePlayer(playerId)` (Pairing spec §6) does, regardless of phase:
- **`removePlayer`** calls `super.removePlayer` first (prunes `this.players` + rotation), then:
  - If the leaver is in a **live UTTT match this mini-round**, they **forfeit it** — opponent gets `wins++`, head-to-head recorded, that `match.over = true`, its turn/hard-cap timers cleared. The `UltimateTTTMatch` instance is simply discarded (`engine = null`); no `forfeit()` call needed because PairingEngine tracks the authoritative winner.
  - The leaver is **excluded from all remaining mini-rounds** (gone from `this.players`, so `_buildMiniRound` never re-pairs them) and **dropped from `getResults`** (results iterate `this.players`) — standard codebase convention for disconnects.
  - Removed from the summary-barrier `acknowledged` set.
- **`_removeFromActive`** is the BaseGame elimination primitive; PairingEngine runs parallel matches and manages `playerMatch`/`matches` directly, so it isn't used in the disconnect path (documented in Pairing spec §6).
- **`destroy`** (PairingEngine) clears every per-turn timer, every hard-cap timer, the ack timer, and nulls live `match.engine` references.

**Per-phase "current / last-needed player leaves":**

| Phase when leaver departs | PairingEngine outcome (no UTTT code) |
|---------------------------|--------------------------------------|
| **Mid-match, it's their turn** | Their live match forfeits to the opponent; their per-turn/hard-cap timers cleared. If that was the last unresolved pairing → barrier trips → `_enterSummary`. No hang. |
| **Mid-match, opponent's turn** | Same forfeit (the match is decided in opponent's favor regardless of whose move it was). |
| **They were a fast finisher waiting at the barrier** | Removed from `this.players` + `acknowledged`; if they were the last outstanding match/ack, advance. |
| **On the miniRoundSummary screen (last ack outstanding)** | Auto-removed from `acknowledged`; `_checkSummaryComplete` advances to next mini-round / finish. |
| **Leaves drop room to 1 player** | PairingEngine sets `state='finished'`; orchestration force-completes; survivor placement 1. |

**Deadlock guards inherited from PairingEngine:** mini-round barrier only trips when `_allMatchesOver()`; summary screen has a **10s auto-advance** ack timer; per-turn 30s timer + 120s hard cap prevent a single match from stalling the room; **every** timer path calls `_emitChange()`. UTTT introduces no new deadlock surface because it owns no timers and no async state.

---

## 10. Client component

### 10.1 Files
- `client/src/games/UltimateTicTacToe.jsx` + `.module.css` — **board only**, rendered inside the shared `PairingShell` (Pairing spec §4.1) which draws the mini-round header, live standings strip, "waiting on…" barrier, bye card, and mini-round summary.
- Props (standard `App.jsx` contract): `function UltimateTicTacToeGame({ gameState, onAction, nicknames, avatars })`. `gameState` is the Pairing §2.6 object; the board reads `gameState.myMatch`.

### 10.2 Per-phase screens (delegated to PairingShell, board slots in for `phase==='match' && !isBye && !over`)

| `gameState.phase` / `myMatch` | Render |
|-------------------------------|--------|
| `match`, `myMatch.isBye` | PairingShell bye card ("Bye — free win!") + standings. No board. |
| `match`, `!over` | **The nested UTTT board** (this component): 3×3 of 3×3. Interactive only if `myMatch.isMyTurn`. Turn indicator + per-turn countdown from `myMatch.turnEndsAt`. Opponent via `PlayerName`. |
| `match`, `over` (fast finisher) | Frozen board with Win/Loss/Draw banner + PairingShell "Waiting on: {names}" from `waitingOn`. |
| `miniRoundSummary` | PairingShell pairings list + Continue → `onAction({ type:'acknowledge' })`. |
| `finished` | `ROUND_RESULTS` screen takes over. |

### 10.3 Board layout (the nested UI)

- Outer CSS grid `3×3` of sub-board cells; each sub-board is an inner CSS grid `3×3` of cells. `aspect-ratio: 1` on the outer container; thick gold gridlines between sub-boards, thin lines within. Read `gameState.myMatch.subBoards` (9×9), `metaBoard` (9), `forcedBoard`, `lastMove`, `yourMark`, `yourTurn`, `status`.
- **Forced sub-board highlight:** if `forcedBoard !== null`, that sub-board glows (e.g. animated gold border / brightened bg) and all other sub-boards are dimmed; if `forcedBoard === null` (free move), all *open* sub-boards (where `metaBoard[i]===''`) get the "playable" highlight.
- **Won sub-board overlay:** when `metaBoard[i] === 'X' | 'O'`, overlay a large translucent X/O across that whole sub-board (the meta mark); `'D'` overlays a muted "—" / grey wash. Won/drawn sub-boards are non-interactive.
- **Last move marker:** outline/pulse the `lastMove.board`/`lastMove.cell` so players can track the back-and-forth.
- **Mark colors:** X and O get distinct theme colors; render `yourMark` prominently in the turn indicator ("You are X").

### 10.4 Touch (no hover) + interaction
- **Tap-to-preview + confirm** per the codebase pattern: first tap on a legal empty cell shows a ghost mark in that cell; second tap on the **same** cell commits `onAction({ type:'move', move:{ board, cell } })`. A "Place" confirm button is also shown for accessibility. No `:hover`-only affordances.
- Only cells that are **legal** are tappable: `metaBoard[board]===''` AND `subBoards[board][cell]===''` AND (`forcedBoard===null || forcedBoard===board`) AND `myMatch.isMyTurn`. Illegal taps are inert (the server would reject them anyway).
- **Local turn timer:** mirror `myMatch.turnEndsAt`; if it hits 0 with no new `GAME_STATE`, send `onAction({ type:'ping' })` (the existing client deadlock nudge — PairingEngine treats `ping` as a no-op that triggers a rebroadcast).

### 10.5 Sound & shake (`useSound()`, `useScreenShake()`)
- Mark place → light click sound.
- Win a sub-board (detected when `metaBoard` gains your mark vs previous render) → coin/ding sound + **light** shake.
- `myMatch.result === 'win'` → win sting + **medium** shake; `'loss'` → lose sound; `'draw'` → neutral chime.
- `phase` becomes `miniRoundSummary` → summary chime; `waitingOn` shrinks → soft tick.
- Use a `useRef` of the previous `metaBoard` to fire sub-board-win SFX only on the transition (mirrors the "only NEW cards animate" pattern).

### 10.6 gameState read / actions emitted (summary)
- **Reads:** `gameState.phase`, `gameState.miniRound`, `gameState.totalMiniRounds`, `gameState.standings`, `gameState.waitingOn`, `gameState.myMatch.{ isBye, opponentId, isMyTurn, over, result, turnEndsAt, metaBoard, subBoards, forcedBoard, yourMark, lastMove, status }`.
- **Emits:** `onAction({ type:'move', move:{ board, cell } })`, `onAction({ type:'acknowledge' })` (via PairingShell), `onAction({ type:'ping' })` (local-timer nudge).
- Never null the board between `GAME_STATE` updates (keep last board until next state) per the "no screen jerk" UX rule.

---

## 11. Registration checklist

| # | File (absolute under `C:\Users\costa\Downloads\Dev Environment\game the game\`) | Edit |
|---|------|------|
| 1 | `server\src\games\UltimateTTTMatch.js` | **NEW** MatchEngine (board rules, §4.2/§5/§6/§7-autoMove/§8). |
| 1b | `server\src\games\UltimateTicTacToe.js` | **NEW** thin `UltimateTicTacToe extends PairingEngine` wrapper (§4.1). |
| 2 | `shared\gameList.js` | Add `GAMES.ultimateTicTacToe` entry (values below). |
| 3 | `shared\constants.js` | **No new TIMER needed** — reuses `TIMERS.CARD_GAME` (30s). (Hard cap 120s is passed as a literal in the wrapper opts.) |
| 4 | `server\src\games\registry.js` | `import { UltimateTicTacToe } from './UltimateTicTacToe.js';` then `registerGame('ultimateTicTacToe', UltimateTicTacToe);` (match the existing registry call signature). |
| 5 | `client\src\games\UltimateTicTacToe.jsx` + `client\src\games\UltimateTicTacToe.module.css` | **NEW** board component (§10). Uses `PlayerName`, `useSound`, `useScreenShake`, 'Press Start 2P' title font, touch tap-to-confirm. Wrap in `PairingShell`. |
| 6 | `client\src\assets\gamepreviews\ultimate-tic-tac-toe.png` | **NEW** preview image (nested 3×3 board art). |
| 7 | `client\src\App.jsx` | `import UltimateTicTacToeGame from './games/UltimateTicTacToe.jsx';` and add `ultimateTicTacToe: UltimateTicTacToeGame` to `GAME_COMPONENTS`. |
| 8 | `client\src\screens\GameVote.jsx` | `import previewUttt from '../assets/gamepreviews/ultimate-tic-tac-toe.png';` and add `ultimateTicTacToe: previewUttt` to `GAME_PREVIEWS`. |

**Concrete `shared/gameList.js` entry:**
```js
ultimateTicTacToe: {
  id: 'ultimateTicTacToe', name: 'Ultimate Tic-Tac-Toe', minPlayers: 2, maxPlayers: 8,
  turnTimer: TIMERS.CARD_GAME,
  description: 'Nine boards in one. Win the small games to win the big one.',
  instructions: [
    'The board is a 3×3 grid of nine mini tic-tac-toe boards.',
    'Your move sends your opponent to the matching mini-board: play cell (top-right) and they must play in the top-right board next.',
    'If that board is already won or full, your opponent may play in any open board.',
    'Win three cells in a row to claim a mini-board; claim three mini-boards in a row to win the match.',
    'Players are paired into 1v1 matches over 3 Swiss mini-rounds — most match wins ranks highest.',
    'Run out of time on a move and a random legal move is played for you.',
  ],
},
```
(Use `instructions[]` — there is no clean public tutorial video; matches the SpotTheDifference/Battleship pattern.)

---

## 12. Edge cases & test scenarios

Most leave/deadlock/barrier scenarios are covered by the **PairingEngine harness** (Pairing spec §7). UTTT adds **MatchEngine-level board tests** plus a couple of integration asserts.

**`UltimateTTTMatch` unit tests (headless, deterministic — no timers):**

| # | Scenario | Assert |
|---|----------|--------|
| 1 | Forced-board rule | After `applyMove(p1,{board:4,cell:2})`, `getView(p2).forcedBoard === 2`; `applyMove(p2,{board:5,cell:0})` returns `false` (wrong board); `applyMove(p2,{board:2,cell:x})` returns `true`. |
| 2 | Free move when target won | Steer sub-board 2 to a win, then a move whose `cell===2` sets `forcedBoard=null`; opponent may play any open board (`applyMove` to any `metaBoard[b]===''` succeeds). |
| 3 | Free move when target full-no-winner | Fill sub-board 2 to a draw (`meta[2]==='D'`), a move with `cell===2` ⇒ `forcedBoard=null`. |
| 4 | Win a sub-board | Three in a row in sub-board `b` ⇒ `metaBoard[b]===mover.mark`; that sub-board no longer accepts moves (`applyMove` returns `false`). |
| 5 | Win the meta | Claim sub-boards 0,1,2 for X ⇒ `isOver()===true`, `winner()===p1(X)`, `status==='won'`, `turn===null`. |
| 6 | Draw the meta | Drive all 9 sub-boards to decided with no meta line ⇒ `isOver()===true`, `isDraw()===true`, `winner()===null`, `status==='draw'`. |
| 7 | Turn guard | `applyMove(p2, ...)` while `turn===p1` ⇒ `false`, board unchanged. |
| 8 | Occupied cell / out-of-bounds | `applyMove` on a filled cell, or `board=9`/`cell=-1`/non-int ⇒ `false`, board unchanged. |
| 9 | Move after game over | After `won`/`draw`, any `applyMove` ⇒ `false`. |
| 10 | `legalMoves`/`autoMove` | `legalMoves()` respects `forcedBoard`; `autoMove(turn)` plays a legal move and returns `true`; `autoMove(notTurn)` ⇒ `false`. |
| 11 | `scoreDiff` sign | Winner's `scoreDiff > 0` and `> 1000`; loser's `< -999`; draw ⇒ `(mine-theirs)` only (no ±1000). |
| 12 | `getView` symmetry / no hidden info | `getView(p1).subBoards` deep-equals `getView(p2).subBoards`; only `yourMark`/`yourTurn` differ; no opponent-secret field exists. |

**Integration / leave-deadlock asserts (via PairingEngine with `matchFactory: (a,b)=>new UltimateTTTMatch(a,b)`):**

| # | Scenario | Assert |
|---|----------|--------|
| 13 | Per-turn timeout → random move | Fake-timer the 30s turn timer; PairingEngine calls `autoMove` (Option A) → a legal move applied, turn re-armed, `_emitChange` called; match not forfeited unless it ends. |
| 14 | Hard cap | A back-and-forth match exceeding 120s forfeits whoever is to move; `_emitChange` called; room never hangs past cap. |
| 15 | Leaver mid-match | Leaver forfeits current match (opp `wins++`); excluded from remaining mini-rounds; dropped from `getResults`; if it was the last unresolved pairing, summary appears. |
| 16 | Fast finisher barrier | Player who wins quickly sees `myMatch.over===true` + `waitingOn` non-empty; no advance until `_allMatchesOver()`. |
| 17 | Full N ranking each round | After 3 mini-rounds, `getResults()` returns **all N** players with placements 1..N, ties sharing a placement; draws produce fractional wins that sort correctly. |
| 18 | Odd N bye | N=5 ⇒ each mini-round 2 matches + 1 bye; bye = +1 win; no player gets 2 byes before all have ≤1. |

---

## 13. Effort & risks

- **Effort:** **M** overall (the heavy lifting — N-player ranking, Swiss pairing, barrier, dual timers, leave — is the already-specced **L** PairingEngine, reused). UTTT-specific work:
  - `UltimateTTTMatch.js`: **M** (~150–200 LOC) — board rules, forced-board logic, sub/meta win detection, `getView`, `scoreDiff`, `legalMoves`/`autoMove`.
  - `UltimateTicTacToe.jsx` + CSS: **M** (~250–300 LOC) — nested 3×3-of-3×3 board, forced-board highlight, won-board overlays, tap-to-confirm, sound/shake. The nested grid + highlight states are the fiddly part.
  - Wrapper + registration + preview: **S**.
- **Dependencies:** **PairingEngine must land first** (hard dependency) — and the small **Option A `autoMove` hook** in PairingEngine's per-turn timeout (one-line extension of Pairing spec §3.9). `PairingShell.jsx` (shared client wrapper from the Pairing spec) should exist before the board component so UTTT only ships the board.
- **Risks / hotspots:**
  - **Forced-board correctness** — the `null` (free move) cases (target board won OR full-no-winner) are the classic UTTT bug. Cover with tests #1–#3.
  - **Sub-board "full no winner" = `'D'`** must still count toward meta-draw detection but is **not** a meta line cell for either mark — easy to get wrong.
  - **`turn` must go `null` at game end** — PairingEngine reads `getView().turn` for timers; a stale `turn` after `won`/`draw` could mis-arm a timer.
  - **Auto-random-move vs forfeit** — confirm the Option A PairingEngine tweak is in; otherwise default to forfeit (Option B) and update the gameList instruction line.
  - **Nested-grid client perf/clarity** — 81 cells; memoize on `subBoards` identity, keep the countdown in its own component so it doesn't re-render the whole grid each tick.

---

## 14. Open questions

1. **Auto-move vs forfeit on per-turn timeout.** Brief says "auto **random legal move**" (Option A) — confirm we add the one-line `autoMove` hook to PairingEngine's per-turn timeout. If we'd rather not touch PairingEngine, fall back to forfeit (Option B) and reword the gameList instruction. **Recommend Option A.**
2. **Hard cap of 120s for UTTT.** UTTT matches can be long. Is 120s (vs the PairingEngine 90s default) the right whole-match backstop, or should it scale higher given the auto-random-move keeps games progressing?
3. **`scoreDiff` definition.** `(mySubBoardsWon − oppSubBoardsWon) ± 1000` — is sub-board margin the best decisive tiebreak, or should it be raw cells claimed across all sub-boards (finer-grained but noisier)?
4. **Draw scoring.** Inherits PairingEngine's +0.5/+0.5 fractional-wins draw rule (Pairing spec Open Q #1). UTTT draws are common at high play; confirm fractional wins in standings/`handDescription` are acceptable, or switch the whole engine to integer-wins + diff tiebreak.
5. **K=3 mini-rounds for N=2.** A 2-player round becomes best-of-3 UTTT (each game can take a while). Is best-of-3 the right length, or bump to `miniRounds: 5` only when `N===2` (consuming-game override)?
6. **First-move (X) advantage.** PairingEngine randomizes `(p1,p2)` order so X-advantage spreads across the mini-tournament, but for N=2 best-of-3 it's only roughly balanced. Acceptable, or alternate who is X within a single N=2 series?
