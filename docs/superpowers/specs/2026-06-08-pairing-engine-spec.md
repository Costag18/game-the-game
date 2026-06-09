# Pairing Engine (1v1 tournament layer) — Implementation Spec

- **slug:** pairing-engine
- **type:** shared server infrastructure (NOT a registered game on its own)
- **status:** draft / build-ready
- **date:** 2026-06-08
- **depends on:** `server/src/games/BaseGame.js` (v2.7.0 leave contract), `shared/constants.js`
- **consumed by:** Connect 4, Ultimate Tic-Tac-Toe (any inherently-1v1 game)

---

## 1. Purpose & consumers

Tournament rounds in Game The Game can have **2–8 players**, and `getResults()` for every
round **must yield a complete N-player ranking** (placement 1..N, ties allowed) — that is
the single hardest design constraint, because `Scorer.calculateRoundScores()` /
`Scorer.calculateWagerReturn()` distribute points and wager returns by placement across
*all* participants (see `server/src/tournament/Scorer.js`,
`shared/constants.js > SCORING.PLACEMENT_MULTIPLIERS = [1.0,0.7,0.5,0.35,0.25,0.15]`).

Some games are **inherently 1v1** — Connect 4, Ultimate Tic-Tac-Toe — and have no native
notion of "4th place out of 6". The Pairing Engine solves this once, reusably:

> Wrap N players in a **Swiss-style mini-tournament**. Each mini-round pairs players into
> simultaneous 1v1 matches (odd count → one **bye** = auto-win that mini-round). Play **K**
> mini-rounds. After each mini-round, re-pair players who have similar records. Aggregate
> wins; `getResults()` ranks **all** N players by (wins desc, tiebreak by head-to-head, then
> in-match point/score differential).

**What it provides:**
- A class `PairingEngine extends BaseGame` that implements the full engine interface
  (`startGame / handleAction / getStateForPlayer / isComplete / getResults`) plus the
  optional timer hooks (`setOnStateChange / _emitChange / destroy`) and the v2.7.0 leave
  contract (`removePlayer`).
- A small, well-defined **MatchEngine** contract so a 1v1 game only has to implement the
  board logic for a single 1v1 game — never the N-player ranking, timers, pairing, byes,
  barriers, or leave handling.

**Consumers** (each registered as a *normal* game per the 8-step checklist in §"Registration"
below — they wrap themselves in a PairingEngine inside their constructor):

| Game | matchFactory produces | minPlayers | maxPlayers |
|------|----------------------|-----------|-----------|
| Connect 4 | `Connect4Match` (7×6 board, 4-in-a-row) | 2 | 8 |
| Ultimate Tic-Tac-Toe | `UltimateTTTMatch` (9 sub-boards) | 2 | 8 |

The Pairing Engine is **not** registered in `server/src/games/registry.js` itself and has
**no** `shared/gameList.js` entry — it is a library the consuming games import.

---

## 2. Public interface / API

### 2.1 `matchFactory(p1, p2) -> MatchEngine`

A plain factory function the consuming game passes into the PairingEngine constructor. It
receives the two `playerId`s for one match and returns a fresh **MatchEngine** instance. The
engine decides who is "X / first to move" — by convention `p1` moves first (the PairingEngine
randomizes the `(p1,p2)` order per match so first-move advantage is spread fairly across the
mini-tournament).

### 2.2 MatchEngine contract (what a 1v1 game implements)

A MatchEngine is a *plain object/class* (it does **not** extend BaseGame). It owns exactly one
1v1 board. Required methods:

```js
class FooMatch {
  constructor(p1, p2) { this.p1 = p1; this.p2 = p2; /* set up board, this.turn = p1 */ }

  // Apply a validated move. Return true if accepted, false if illegal/ignored.
  // PairingEngine has already verified playerId is one of {p1,p2} and that the
  // match isOver()===false before calling. The match still validates legality
  // (whose turn, cell occupied, etc.).
  applyMove(playerId, move) { /* ... */ return accepted; }

  // Per-player filtered view of THIS board. Never leak hidden info (n/a for C4/UTTT —
  // both are perfect-information, but the contract supports hidden-info 1v1 games).
  getView(playerId) { /* return { board, turn, ... , myMark, isMyTurn } */ }

  isOver()  { return this._over; }       // game decided (win or draw)
  winner()  { return this._winner; }     // playerId of winner, or null if draw / not over
  isDraw()  { return this._over && this._winner === null; }

  // OPTIONAL — score differential used as the FINAL tiebreak in standings.
  // C4: (myPieces - oppPieces) at game end, or +/- a large constant for a win.
  // UTTT: (mySubBoardsWon - oppSubBoardsWon). Default 0 if not implemented.
  scoreDiff(playerId) { /* ... */ return number; }

  // OPTIONAL teardown if the match holds its own timers (C4/UTTT do not — the
  // PairingEngine owns all timers). Default no-op.
  destroy() {}
}
```

**Forfeit semantics:** the PairingEngine never calls `applyMove` after deciding a forfeit. To
mark a forfeit/bye it calls `match.forfeit(loserId)` **if present**, otherwise it resolves the
match purely at the PairingEngine layer (records the winner in its own `matchResult`) and
discards the MatchEngine. Implementing `forfeit(loserId)` is **optional** — C4/UTTT don't need
it because the PairingEngine tracks the authoritative `winner` per pairing itself.

### 2.3 `new PairingEngine(players, opts)`

```js
const engine = new PairingEngine(players, {
  matchFactory: (p1, p2) => new Connect4Match(p1, p2), // REQUIRED
  miniRounds: 'auto',          // 'auto' => ceil(log2(N)) clamped to [3, 5]; or a fixed int
  matchTimerSec: TIMERS.CARD_GAME,   // per-player turn timeout within a match (default 30s)
  matchHardCapSec: 90,         // absolute wall-clock cap for a single match (default 90s)
  miniRoundBarrierGraceSec: 8, // how long fast finishers wait at the barrier (display only)
  title: 'Connect 4',          // for client header (optional)
});
```

`opts.miniRounds === 'auto'` resolves to `Math.min(5, Math.max(3, Math.ceil(Math.log2(N))))`
at `startGame()` time using the live player count:

| N | ceil(log2 N) | K (clamped 3..5) |
|---|--------------|-------------------|
| 2 | 1 | 3 |
| 3 | 2 | 3 |
| 4 | 2 | 3 |
| 5 | 3 | 3 |
| 6 | 3 | 3 |
| 7 | 3 | 3 |
| 8 | 3 | 3 |

(With N≤8, `auto` always lands on 3. The clamp/formula is kept so the module is reusable if
max players ever grows; you may also just pass `miniRounds: 3` and skip the formula.)

### 2.4 Socket events

The Pairing Engine introduces **no new socket events**. It rides entirely on the existing
generic flow already wired in `server/src/index.js`:

- **Client → server:** `EVENTS.GAME_ACTION` with the action payload (routed into
  `game.handleAction(socket.id, action)`).
- **Server → client:** `EVENTS.GAME_STATE` `{ gameId, state, nicknames, avatars }`
  (per-player, from `getStateForPlayer`), `EVENTS.GAME_COMPLETE`, `EVENTS.ROUND_RESULTS`.

The consuming game's `gameId` (e.g. `'connect4'`) is what flows through, so the client routes
to the right component via `GAME_COMPONENTS` — see §4.

### 2.5 Action shapes (client → `handleAction`)

```js
{ type: 'move', move: <game-specific> }   // e.g. C4: { col: 0..6 }; UTTT: { board, cell }
{ type: 'acknowledge' }                   // ack the mini-round-summary barrier screen
{ type: 'ping' }                          // client local-timer-expired nudge (no-op, triggers rebroadcast)
```

`move` is passed opaquely to `matchEngine.applyMove(playerId, action.move)`.

### 2.6 `getStateForPlayer(playerId)` shape (server → client `state`)

```js
{
  phase: 'match' | 'miniRoundSummary' | 'finished',
  // --- Swiss meta ---
  miniRound: 2,            // 1-based current mini-round
  totalMiniRounds: 3,
  // --- this player's current match (null if bye this mini-round, or phase!=='match') ---
  myMatch: {
    opponentId: '<id>' | null,    // null === bye
    isBye: false,
    board: <matchEngine.getView(playerId).board>,
    turn: '<id>',
    isMyTurn: true,
    over: false,
    result: null | 'win' | 'loss' | 'draw',
    ...matchView,                 // spread of matchEngine.getView(playerId) extras
    turnEndsAt: 1718000000000,    // epoch ms for the per-turn countdown, null if not my turn
  },
  // --- live standings across ALL N players (always present) ---
  standings: [
    { playerId, wins, byes, scoreDiff, rank, eliminated:false, displayWins },
    ...
  ],
  // --- barrier info: who the room is still waiting on ---
  waitingOn: ['<id>', ...],   // players whose match in THIS mini-round hasn't resolved
  myMiniRoundDone: true,      // did THIS player's match resolve already (fast finisher)?
  // --- mini-round summary (only when phase==='miniRoundSummary') ---
  lastMiniRound: {
    pairings: [ { p1, p2, winnerId, isBye, draw } , ... ],
  } | null,
}
```

### 2.7 `getResults()` shape (the contract that matters)

```js
[
  { playerId, placement, wins, byes, scoreDiff, handDescription: '2 wins' },
  ... // sorted best→worst, EVERY player present, ties share a placement number
]
```

Ranking key: `wins` desc → head-to-head (if exactly the tied players met, the winner ranks
higher) → `scoreDiff` desc. Tie pattern follows the codebase convention:
`let placement = 1; if (i>0 && worseThanPrev) placement = i+1;`.

---

## 3. Server design

### 3.1 Files

| File | Purpose |
|------|---------|
| `server/src/games/PairingEngine.js` | **NEW.** The reusable class below. |
| `server/src/games/Connect4Match.js` | Consumer-owned MatchEngine (separate spec). |
| `server/src/games/Connect4.js` | Thin `BaseGame` subclass that constructs a PairingEngine. |

The consuming game class is intentionally thin — it exists only so the registry can
`new Connect4(players)` per the existing `createGame` signature:

```js
// server/src/games/Connect4.js
import { PairingEngine } from './PairingEngine.js';
import { Connect4Match } from './Connect4Match.js';
import { TIMERS } from '../../../shared/constants.js';

export class Connect4 extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new Connect4Match(p1, p2),
      miniRounds: 3,
      matchTimerSec: TIMERS.CARD_GAME,
      title: 'Connect 4',
    });
  }
}
```

(Subclassing PairingEngine is cleaner than composition because `createGame` expects a single
`new EngineClass(players)` and the orchestration calls `setOnStateChange`, `startGame`,
`handleAction`, etc. directly on that instance.)

### 3.2 FSM

PairingEngine constructs `BaseGame` with:

```js
super(players, {
  states: ['waiting', 'match', 'miniRoundSummary', 'finished'],
  initialState: 'waiting',
  transitions: {
    waiting:           { start: 'match' },
    match:             { summary: 'miniRoundSummary' },
    miniRoundSummary:  { next: 'match', finish: 'finished' },
  },
});
```

| From | Action (internal) | To | Trigger |
|------|-------------------|----|---------| 
| waiting | `start` | match | `startGame()` builds mini-round 1 pairings |
| match | `summary` | miniRoundSummary | **all** pairings in current mini-round resolved (the barrier) |
| miniRoundSummary | `next` | match | ack-barrier complete AND more mini-rounds remain → re-pair |
| miniRoundSummary | `finish` | finished | ack-barrier complete AND `miniRound === totalMiniRounds` |

### 3.3 Internal state

```js
this.matchFactory; this.totalMiniRounds; this.matchTimerSec; this.matchHardCapSec;
this.miniRound = 0;
this.wins = {};        // playerId -> match wins
this.byes = {};        // playerId -> bye count (a bye counts as a win for ranking)
this.diff = {};        // playerId -> cumulative scoreDiff
this.h2h = {};         // `${a}|${b}` -> winnerId  (head-to-head log for tiebreaks)
this.matches = [];     // current mini-round: [{ p1, p2, engine, winnerId, draw, isBye, over, turnEndsAt }]
this.playerMatch = {}; // playerId -> index into this.matches (for O(1) routing); undefined if bye
this.acknowledged = new Set();   // miniRoundSummary barrier acks
this.lastMiniRound = null;       // snapshot for the summary screen
this._matchTimers = {};          // matchIndex -> setTimeout (per-turn)
this._hardCapTimers = {};        // matchIndex -> setTimeout (whole-match cap)
this._ackTimer = null;           // miniRoundSummary auto-advance (10s)
this._onStateChange = null;
```

### 3.4 Pairing algorithm (Swiss)

```
buildMiniRound():
  this.miniRound += 1
  // sort by current record so similar records meet (Swiss)
  let pool = [...this.players].sort((a,b) =>
        score(b) - score(a) || this.diff[b]-this.diff[a] || rand())
  // avoid immediate rematches when possible: greedy pair top-down, skip a
  // partner already met this engine if an alternative exists
  this.matches = []; this.playerMatch = {}
  while (pool.length >= 2):
     const p1 = pool.shift()
     let idx = pool.findIndex(c => !hasMet(p1, c))   // prefer un-met opponent
     if (idx === -1) idx = 0                          // forced rematch if unavoidable
     const p2 = pool.splice(idx,1)[0]
     pushMatch(p1, p2)                                // randomize who is "first"
  if (pool.length === 1):                             // odd → bye
     const byePlayer = pool[0]
     this.byes[byePlayer]++; this.wins[byePlayer]++   // bye = free win
     // record a synthetic resolved "match" so the barrier accounts for them
     this.matches.push({ p1: byePlayer, p2: null, isBye:true, over:true,
                         winnerId: byePlayer, draw:false })
```

`score(p) = wins[p]` (byes already folded into wins). Bye assignment prefers a player who
has **not** had a bye yet (track `byes[p]` and pick the lowest-bye, lowest-win pool tail
member) so no one gets two free wins while another gets none.

### 3.5 `startGame()`

```js
startGame() {
  for (const p of this.players) { this.wins[p]=0; this.byes[p]=0; this.diff[p]=0; }
  this.totalMiniRounds = resolveK(this.players.length, this._miniRoundsOpt);
  this.transition('start');     // -> 'match'
  this._buildMiniRound();
  this._armAllMatchTimers();
}
```

### 3.6 `handleAction(playerId, action)` — routing

```js
handleAction(playerId, action) {
  if (!this.players.includes(playerId)) return;

  if (this.state === 'match') {
    if (action.type === 'move') {
      const mi = this.playerMatch[playerId];
      if (mi === undefined) return;            // this player has a bye / no match
      const m = this.matches[mi];
      if (m.over) return;
      if (!m.engine) return;
      const accepted = m.engine.applyMove(playerId, action.move);
      if (!accepted) return;
      this._rearmTurnTimer(mi);                // reset per-turn clock on a valid move
      if (m.engine.isOver()) this._resolveMatch(mi);   // may trip the barrier
    }
    // action.type === 'ping' / unknown: no-op; index.js rebroadcasts state anyway
  } else if (this.state === 'miniRoundSummary') {
    if (action.type === 'acknowledge') {
      this.acknowledged.add(playerId);
      this._checkSummaryComplete();
    }
  }
}
```

**Routing note:** the existing `index.js` `GAME_ACTION` handler calls
`game.handleAction(socket.id, action)` then rebroadcasts `getStateForPlayer` to everyone and
checks `isComplete()`. The PairingEngine therefore needs **no** special wiring — a move in one
pairing rebroadcasts to all, including spectators in other pairings (their `standings` /
`waitingOn` update live). 

### 3.7 Resolving a match + the mini-round barrier

```js
_resolveMatch(mi) {
  const m = this.matches[mi];
  if (m.over) return;                         // guard double-resolve
  m.over = true;
  this._clearMatchTimers(mi);
  if (m.isBye) { /* already credited at build time */ }
  else {
    const w = m.engine.winner();              // null === draw
    if (w) { this.wins[w]++; m.winnerId = w; this._recordH2H(m.p1, m.p2, w); }
    else   { m.draw = true; /* draw: 0.5 win each (see §7) */
             this.wins[m.p1]+=0.5; this.wins[m.p2]+=0.5; }
    this.diff[m.p1] += m.engine.scoreDiff?.(m.p1) ?? 0;
    this.diff[m.p2] += m.engine.scoreDiff?.(m.p2) ?? 0;
    m.engine.destroy?.();
    m.engine = null;                          // free the board; keep the result record
  }
  if (this._allMatchesOver()) this._enterSummary();
}

_enterSummary() {
  this.transition('summary');                 // 'match' -> 'miniRoundSummary'
  this.lastMiniRound = { pairings: this.matches.map(m => ({
      p1:m.p1, p2:m.p2, winnerId:m.winnerId ?? null, isBye:!!m.isBye, draw:!!m.draw })) };
  this.acknowledged = new Set();
  this._clearAllMatchTimers();
  this._startAckTimer();                      // 10s auto-advance barrier
}
```

**Fast-finisher barrier (explicit):** a player whose match resolves while another pairing is
still playing does **not** advance. `phase` stays `'match'` for them, `myMatch.over === true`,
`myMatch.result` is set, `myMiniRoundDone === true`, and `waitingOn` lists the players still in
unfinished pairings. Only when `_allMatchesOver()` is true does the engine transition to
`miniRoundSummary` for everyone simultaneously. This is the mini-round barrier the brief calls
out — fast finishers wait, the summary screen appears for all at once.

### 3.8 Summary ack → next mini-round / finish

```js
_checkSummaryComplete() {
  if (this.state !== 'miniRoundSummary') return;
  if (!this.players.every(p => this.acknowledged.has(p))) return;
  this._clearAckTimer();
  if (this.miniRound >= this.totalMiniRounds) {
    this.transition('finish');
  } else {
    this.transition('next');
    this._buildMiniRound();
    this._armAllMatchTimers();
  }
}

_startAckTimer() {
  this._clearAckTimer();
  this._ackTimer = setTimeout(() => {
    if (this.state !== 'miniRoundSummary') return;
    for (const p of this.players) this.acknowledged.add(p);  // auto-ack stragglers
    this._checkSummaryComplete();
    this._emitChange();                       // MUST broadcast — see leave/deadlock §6
  }, 10000);
}
```

### 3.9 Timers (per-turn + hard cap) — auto-forfeit a staller

Every active pairing arms a **per-turn timer** (`matchTimerSec`, default `TIMERS.CARD_GAME`):
on expiry the player whose turn it is **auto-forfeits that match** (opponent wins). A separate
**hard cap** (`matchHardCapSec`, default 90s) guards pathological back-and-forth so a single
pairing can't hold the whole room past the barrier.

```js
_armMatchTimer(mi) {
  const m = this.matches[mi];
  if (!m || m.over || m.isBye) return;
  const turnPlayer = m.engine.getView(m.p1).turn;   // whose move it is
  m.turnEndsAt = Date.now() + this.matchTimerSec*1000;
  this._matchTimers[mi] = setTimeout(() => {
    if (this.state !== 'match' || m.over) return;
    const loser = m.engine.getView(m.p1).turn;       // staller
    const winner = loser === m.p1 ? m.p2 : m.p1;
    this.wins[winner]++; m.winnerId = winner; m.over = true;
    this._recordH2H(m.p1, m.p2, winner);
    this._clearMatchTimers(mi);
    if (this._allMatchesOver()) this._enterSummary();
    this._emitChange();                              // broadcast the forfeit + maybe barrier
  }, this.matchTimerSec*1000);
}
```

`_rearmTurnTimer(mi)` clears+re-arms on each accepted move. `_armAllMatchTimers()` arms every
non-bye pairing at the start of a mini-round; the hard-cap timer is armed once per match and
forfeits *whoever's turn it is* at the cap (same path).

### 3.10 `setOnStateChange` / `_emitChange`

```js
setOnStateChange(cb) { this._onStateChange = cb; }
_emitChange() { if (typeof this._onStateChange === 'function') this._onStateChange(); }
```

**Every** timer-driven mutation (turn-timeout forfeit, hard-cap forfeit, ack auto-advance)
calls `_emitChange()` after mutating, exactly like `RockPaperScissors._startRevealTimer` and
`SpotTheDifference._endRound`. The orchestration's `setOnStateChange` callback (index.js
~1205) re-broadcasts `getStateForPlayer` to all and re-checks `isComplete()` →
`completeAndEmit`. Without this, a match that finishes on a timer while everyone is idle would
freeze the room (this is the exact bug class the v2.7.0 audit fixed).

### 3.11 `getStateForPlayer` / `isComplete` / `getResults`

`getStateForPlayer` builds the §2.6 shape. `myMatch` derives from `playerMatch[playerId]`:
if `undefined` → bye card; else spread `matches[mi].engine?.getView(playerId)` (or the frozen
result if `engine===null`). `standings` is computed from `wins/byes/diff` every call (cheap).

```js
isComplete() { return this.state === 'finished'; }

getResults() {
  const entries = this.players.map(p => ({
    playerId: p, wins: this.wins[p]||0, byes: this.byes[p]||0, scoreDiff: this.diff[p]||0,
  }));
  entries.sort((a,b) =>
    b.wins - a.wins
    || this._h2hCompare(a.playerId, b.playerId)   // -1 if a beat b head-to-head
    || b.scoreDiff - a.scoreDiff);
  let placement = 1;
  return entries.map((e, i) => {
    if (i>0 && (e.wins < entries[i-1].wins ||
        (e.wins === entries[i-1].wins && e.scoreDiff < entries[i-1].scoreDiff)))
      placement = i+1;
    return { ...e, placement, handDescription: `${e.wins} win${e.wins===1?'':'s'}` };
  });
}

destroy() { this._clearAllMatchTimers(); this._clearAckTimer();
            for (const m of this.matches) m.engine?.destroy?.();
            this._onStateChange = null; }
```

> **Head-to-head caveat for `getResults` sort:** a pure comparator using H2H can be
> non-transitive (rock-paper-scissors cycles). Use H2H **only** as a localized tiebreak
> between adjacent equal-`wins` entries, and fall back to `scoreDiff` when a cycle is
> detected. Keeping it adjacency-local (not a global custom sort key) avoids
> `Array.sort` instability — see Open Questions.

---

## 4. Client design

The Pairing Engine is server-side; on the client each **consuming game** ships its own
component (Connect 4 board, UTTT board). A shared wrapper renders the Swiss chrome so the two
boards don't each re-implement standings/barrier/bye UI.

### 4.1 Files

| File | Purpose |
|------|---------|
| `client/src/games/PairingShell.jsx` + `.module.css` | **NEW shared wrapper.** Renders header (mini-round X/Y), live standings strip, "waiting on…" barrier, bye card, mini-round summary screen, and slots the board via `children` / render-prop. |
| `client/src/games/Connect4.jsx` + `.module.css` | Board only; consumes `myMatch.board`, calls `onAction({type:'move', move:{col}})`. |
| `client/src/games/UltimateTicTacToe.jsx` + `.module.css` | Board only. |

### 4.2 Props (standard game-component contract from `App.jsx`)

```jsx
function Connect4Game({ gameState, onAction, nicknames, avatars }) { ... }
```

`gameState` is the §2.6 object. The component:
- Renders `<PairingShell gameState={gameState} nicknames={nicknames} avatars={avatars}>` and
  passes a board render-prop that reads `gameState.myMatch`.
- Uses `PlayerName` (`client/src/components/PlayerName.jsx`) for opponent + standings rows so
  avatars/nicknames render consistently.
- Uses `useSound()` for SFX: piece-drop / mark-place click, win sting on `myMatch.result==='win'`,
  a soft tick when `waitingOn` shrinks, summary chime on `phase==='miniRoundSummary'`.
- Unique Google Font for the title per the CLAUDE.md Fonts convention (e.g. **Bungee** for
  Connect 4, **Russo One** for UTTT) — title only; body stays default for readability.

### 4.3 Rendering by phase

| `phase` | Render |
|---------|--------|
| `match`, `myMatch.isBye` | "Bye this round — free win!" card + live standings; no board. |
| `match`, `!over` | Board (interactive only if `myMatch.isMyTurn`), turn indicator, per-turn countdown from `myMatch.turnEndsAt`, standings strip. |
| `match`, `over` (fast finisher) | Frozen board with result banner (Win/Loss/Draw) + "Waiting on: {names}" from `waitingOn`. |
| `miniRoundSummary` | Pairings list (each `p1 vs p2 → winner`, bye highlighted) + "Continue" button → `onAction({type:'acknowledge'})`; after ack, "Waiting for others…". |
| `finished` | Final standings (the round's results screen takes over via `ROUND_RESULTS`). |

### 4.4 Touch + perf

- **Touch (no hover):** Connect 4 columns and UTTT cells use **tap-to-preview + confirm**
  exactly like the codebase pattern: first tap highlights the target (ghost piece / outlined
  cell), second tap on the same target commits `onAction`. A "Drop / Place" confirm button is
  also shown for accessibility. No `:hover`-only affordances.
- **Local turn timer:** mirror `turnEndsAt`; if it hits 0 and no new `GAME_STATE` arrived,
  send `{ type: 'ping' }` so the server rebroadcasts (matches the existing client-ping
  deadlock guard).
- **Perf:** state is small (one board + N standings rows); no throttling needed. Memoize the
  board grid on `myMatch.board` identity to avoid re-rendering the standings strip on every
  countdown tick (countdown is its own component reading `turnEndsAt`).
- **Re-render smoothness:** never null the board between states — keep the last board until the
  next `GAME_STATE`, per the "no screen jerk" UX preference.

### 4.5 Preview / vote screen

Each consuming game needs its own `gamepreviews/<id>.png` and an entry in `GAME_PREVIEWS`
(`GameVote.jsx`). The Pairing Engine itself has none.

---

## 5. Integration example (Connect 4, end to end)

1. **Author the MatchEngine** `Connect4Match` (separate spec): `constructor(p1,p2)` sets a 7×6
   grid, `this.turn=p1`; `applyMove(pid, {col})` validates turn + non-full column, drops a
   disc, flips turn, sets `_over/_winner` on 4-in-a-row or full board; `getView(pid)` returns
   `{ board, turn, isMyTurn: turn===pid, myMark }`; `scoreDiff(pid)` returns `+1000` for a win
   / `-1000` for a loss / `0` draw (so wins dominate the diff tiebreak).
2. **Author the thin wrapper** `Connect4 extends PairingEngine` (§3.1) — passes
   `matchFactory: (a,b)=>new Connect4Match(a,b)`, `miniRounds:3`.
3. **Register** (the 8-step checklist below) — registry + gameList + client component + preview.
4. **At round start** the orchestration does `createGame('connect4', players)` →
   `new Connect4(players)`, calls `setOnStateChange(cb)` (PairingEngine stores it), then
   `startGame()`. PairingEngine builds mini-round 1 pairings (e.g. 5 players → 2 matches + 1
   bye), arms turn timers, and the first `GAME_STATE` goes out.
5. **Play:** each player sees only their own pairing's board + the live standings. Player A
   beats B (A's `wins→1`). A now sees a "win — waiting on the other pairing" screen
   (`myMiniRoundDone:true`, `waitingOn:[C,D]`). When C/D's match resolves, the barrier trips,
   everyone transitions to `miniRoundSummary`, taps Continue, and mini-round 2 re-pairs by
   record (A vs the other winner, etc.).
6. **After 3 mini-rounds** `isComplete()===true`; `index.js` calls `getResults()` → a full
   1..N ranking by wins → h2h → diff → `tm.completeRound(placements, results)` distributes
   placement points + wager returns exactly like every other game. No game-specific code in
   the orchestration.

---

## 6. Leave/deadlock behavior (v2.7.0 contract — MANDATORY)

This layer is where leave handling lives; the consuming MatchEngine does **not** implement
leave logic.

### `removePlayer(playerId)` — player LEFT (disconnect)

```js
removePlayer(playerId) {
  super.removePlayer(playerId);          // prunes this.players + turn rotation (BaseGame)
  if (!(playerId in this.wins) && !this.players.includes(playerId)) { /* fallthrough */ }

  // 1) If they were in a live pairing THIS mini-round, they FORFEIT it now.
  const mi = this.playerMatch[playerId];
  if (mi !== undefined) {
    const m = this.matches[mi];
    if (m && !m.over) {
      const opp = m.p1 === playerId ? m.p2 : m.p1;
      if (opp) { this.wins[opp]++; m.winnerId = opp; this._recordH2H(m.p1, m.p2, opp); }
      m.over = true;
      this._clearMatchTimers(mi);
    } else if (m && m.isBye) {
      m.over = true;                     // their bye is moot; nothing to award an opponent
    }
  }
  delete this.playerMatch[playerId];

  // 2) Remaining mini-rounds: they're out of this.players, so future _buildMiniRound
  //    simply never includes them (Swiss re-pair handles the smaller pool, incl. new byes).

  // 3) Drop them from any pending barrier ack.
  this.acknowledged.delete(playerId);

  // 4) If the round collapses to <=1 real player, finish (orchestration force-completes too).
  if (this.players.length <= 1) {
    this._clearAllMatchTimers(); this._clearAckTimer();
    this.state = 'finished';
    return;
  }

  // 5) Their forfeit may have completed the current mini-round → trip the barrier.
  if (this.state === 'match' && this._allMatchesOver()) this._enterSummary();
  // 6) Or they were the last outstanding ack on the summary screen.
  else if (this.state === 'miniRoundSummary' && this.players.every(p => this.acknowledged.has(p)))
    this._checkSummaryComplete();
}
```

Notes on the contract:
- `removePlayer` calls `super.removePlayer` **first** (prunes `this.players` + rotation), then
  does game-specific nudges — exactly the pattern in `Hangman.removePlayer` /
  `SpotTheDifference.removePlayer`.
- A leaver **forfeits their current match and is excluded from all remaining mini-rounds**
  (they're gone from `this.players`, so the next `_buildMiniRound` never pairs them). They are
  also removed from `getResults` because results iterate `this.players`. (This matches the
  rest of the codebase — a disconnected player is not scored for the round.)
- The PairingEngine is effectively **simultaneous** (multiple concurrent matches), so per the
  v2.7.0 rule it auto-resolves on behalf of the leaver: **auto-forfeit** their live match and
  **auto-ack** the summary barrier — never wait on a player who is gone.

### `_removeFromActive(playerId)` — in-game "out" without leaving

Not used by this layer in the disconnect sense. The base `_removeFromActive` exists for
turn-rotation elimination; the PairingEngine doesn't use the BaseGame single-turn rotation
(it runs parallel matches), so it manages `playerMatch`/`matches` directly. If a future
consumer wants "knocked out of contention but still listed/scored" semantics, that maps to
keeping the player in `this.players` (so they stay in `getResults`) while excluding them from
`_buildMiniRound` — i.e. mark `eliminated[p]=true` and skip them in the pool. Documented here
so the distinction is explicit, but **not built** unless a consumer needs it (YAGNI).

### Timer ↔ `_emitChange` pairing (the critical rule)

Every `setTimeout`-driven advance **must** call `_emitChange()` after mutating:
- per-turn forfeit timer (§3.9) → emits → orchestration rebroadcasts + checks `isComplete`.
- hard-cap forfeit timer → same.
- summary auto-advance timer (§3.8) → emits.

If any of these mutated state without `_emitChange`, a match resolving while the room is idle
would leave clients frozen (no `GAME_ACTION` to trigger the index.js rebroadcast). This is the
single most important invariant in the module.

### `destroy()`

Clears **all** per-turn timers, all hard-cap timers, the ack timer, nulls every live
`match.engine` via `engine.destroy?.()`, and nulls `_onStateChange`. The orchestration calls
`destroy()` before discarding the game (`game.destroy?.()` at index.js ~1092, ~1181, ~1328,
~1354, ~1414) so no orphaned timer fires on a torn-down instance.

### Force-complete to one survivor

If leaves drop the room to a single player mid-mini-round, `removePlayer` sets
`state='finished'` and the orchestration's `tm.players.length === 1` branch (index.js ~1323)
calls `getResults()` and `completeRound`. `getResults` must still return a 1-element ranking
(`placement:1`) for the survivor — it does, since it iterates `this.players`.

---

## 7. Edge cases & test scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Odd N (5) | Each mini-round: 2 matches + 1 bye. Bye rotates to a player with the fewest byes; no one gets 2 byes before everyone gets ≤1. Bye = +1 win. |
| 2 | N=2 | Every mini-round is a single rematch (no other pairing possible). After K rounds, best-of-K decides 1st/2nd. `hasMet` always true → forced rematch path exercised. |
| 3 | Draw in a match (UTTT full board, no winner) | `isDraw()===true`; both get +0.5 win, `m.draw=true`, summary shows "Draw". Standings handle fractional wins; `getResults` sorts fine. |
| 4 | Fast finisher | First pairing to end: those 2 players see result + `waitingOn` until the slow pairing resolves; barrier trips only when `_allMatchesOver()`. No early advance. |
| 5 | Turn-timeout forfeit | Idle player's per-turn timer fires → opponent wins that match → `_emitChange` → state broadcast; if it completes the mini-round, summary appears for all. |
| 6 | Match hard cap | A ping-pong match exceeding `matchHardCapSec` forfeits whoever's turn it is; room never hangs past the cap. |
| 7 | Leaver mid-match | Forfeits current match (opp +1 win), excluded from future mini-rounds, dropped from `getResults`. If that trips the barrier, summary appears. |
| 8 | Leaver was a fast finisher (already done, waiting at barrier) | Just removed from `this.players` + `acknowledged`; if they were the last outstanding match/ack, advance. |
| 9 | Leaver on summary screen | Auto-removed from `acknowledged`; if remaining all acked, advance to next mini-round / finish. |
| 10 | Two leavers → 1 player left | `removePlayer` sets `finished`; orchestration force-completes; survivor placement 1. |
| 11 | All-equal wins at the end | `getResults` tiebreaks by adjacency head-to-head then `scoreDiff`; ties that can't be broken share a placement number (Scorer handles shared placements). |
| 12 | Rematch unavoidable (small N, many mini-rounds) | `hasMet` returns true for all candidates → engine pairs anyway (idx fallback 0); no crash, no infinite loop. |
| 13 | `acknowledge` from a player not in a summary | Ignored (guarded by `state !== 'miniRoundSummary'`). |
| 14 | `move` for a bye player or wrong pairing | `playerMatch[pid]===undefined` or `applyMove` returns false → ignored. |
| 15 | Illegal move (full C4 column / occupied UTTT cell / not your turn) | `applyMove` returns false; engine state unchanged; timer NOT re-armed. |
| 16 | JSON key stringification | `playerMatch` / `wins` keyed by socket-id strings (already strings) — no `obj[num]` hazard, but spec-check any numeric match indices use `Number()`/`String()` consistently. |
| 17 | `setOnStateChange` never set (defensive) | `_emitChange` no-ops; engine still works on `handleAction`-driven broadcasts (matches RPS/Hangman defensive guard). |

**Test approach:** unit-test `PairingEngine` headless with a trivial deterministic
`StubMatch` whose `applyMove(pid,{win:true})` instantly ends the match for `pid`. Drive:
build → resolve all → barrier → ack → re-pair → finish → `getResults` produces full 1..N
ranking with correct ties. Add fake-timer tests for forfeit + auto-ack paths asserting
`_emitChange` was called.

---

## 8. Effort & risks

**Effort:** **L** (the engine) — the PairingEngine itself is the bulk: ~350–450 LOC with the
Swiss pairing, barrier, dual timers, and leave handling. Each consuming game adds **M** (a
MatchEngine board + a thin board component, ~200–300 LOC each) plus the standard registration.
`PairingShell.jsx` is ~**M** and shared. Total first delivery (engine + Connect 4 + shell):
**L–XL**; UTTT afterwards is **M**.

**Risks / hotspots:**
- **Barrier + timer interplay** is the deadlock-prone area (the v2.7.0 bug class). Mitigate by
  funnelling *every* completion path (move-win, turn-forfeit, hard-cap, leave-forfeit) through
  one `_resolveMatch`/`_allMatchesOver` → `_enterSummary` chokepoint, and asserting in tests
  that each timer path calls `_emitChange`.
- **Head-to-head tiebreak non-transitivity** — keep it adjacency-local, don't use it as a
  global sort key (see §3.11 caveat + Open Questions).
- **Fractional wins from draws** — make sure `displayWins`/`handDescription` format `2.5`
  acceptably and standings sort handles floats. Alternative: count draws as 0 wins for both
  and break ties by diff (simpler; flagged below).
- **First-move advantage** — mitigated by randomizing `(p1,p2)` order per match; for N=2
  best-of-K it roughly balances over K rounds but isn't perfectly fair (Open Questions).
- **Spectator state size** — every move rebroadcasts full `getStateForPlayer` to all N; fine
  at N≤8, but the per-player payload includes the board + standings each time. Acceptable.

---

## 9. Open questions

1. **Draw scoring.** +0.5/+0.5 (fractional wins) vs. 0/0-with-diff-tiebreak. Fractional is
   more "correct" Swiss but introduces float wins into the UI. Recommend **fractional** but
   confirm the standings/`handDescription` formatting is acceptable, or switch to integer wins
   + diff tiebreak for simplicity.
2. **K (mini-round count) for small N.** `auto` lands on 3 for all N≤8. Is best-of-3 enough
   separation for N=2 (a 2-player round becomes best-of-3 of a 1v1 game)? Consider bumping K
   for N≤3, or letting the consuming game override (`miniRounds:5` for "feels too short").
3. **Head-to-head as a tiebreak** — adjacency-local is safe but can leave a 3-cycle unbroken;
   is falling back to `scoreDiff` (then leaving a true tie as a shared placement) acceptable?
   (It is for Scorer, which supports shared placements.)
4. **Should a disconnected leaver be scored last instead of dropped from `getResults`?** Every
   other game drops them (results iterate `this.players`). Confirm we keep that convention here
   rather than awarding them an explicit last placement.
5. **Match hard cap default (90s).** With per-turn timers already at 30s, is a 90s whole-match
   cap the right backstop for Connect 4 / UTTT, or should it scale with board size?
6. **Bye fairness across mini-rounds** — current rule (lowest-bye-count tail member) prevents
   double byes but, for some N/K combos, a player may still never get a bye while another gets
   one. Acceptable since a bye is a free win (slight luck), but flag if we want strict rotation.
