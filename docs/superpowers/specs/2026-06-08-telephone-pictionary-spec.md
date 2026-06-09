# Telephone Pictionary — Implementation Spec

slug: telephone-pictionary
status: draft
author: spec-writer subagent
date: 2026-06-08
depends-on: drawing-canvas-infra (2026-06-08-drawing-canvas-infra-spec.md) — REQUIRED, read it first
extends: BaseGame (server/src/games/BaseGame.js), v2.7.0 leave contract

---

## 1. Overview

"Eat Poop You Cat" / Telephone Pictionary. Each player starts a **chain** with a written
phrase. Chains then rotate around the table: on each step a player receives the chain seat
that lands in front of them and either **draws** the most recent phrase, or **writes** a
guess of the most recent drawing. Draw/write steps alternate. After every chain has passed
through all seats, all chains are **revealed** in sequence (original phrase → drawing →
guess → drawing → … final guess), then players **vote** for the funniest chain. Score =
votes received on your authored items + a participation base so all N players rank.

| Field | Value |
|---|---|
| **id / slug** | `telephonePictionary` / telephone-pictionary |
| **Players** | 3–8 (best ≥4; works at 3) |
| **Type** | Simultaneous lockstep (step-barrier), then sequential reveal, then voting |
| **Length** | One round = setup + N alternating steps + reveal + vote (~3–6 min) |
| **Canvas** | drawing-canvas-infra `CanvasSession`, **one session per chain**, broadcast **scoped to the authoring player's own socket** (NOT `io.to(room)`) — private canvases |
| **Title font** | **Gochi Hand** (primary) with Sriracha fallback — handwritten/doodle feel |
| **Sounds** | `useSound()`: tick on submit, page-flip on reveal step, ta-da on vote results |
| **Shake** | `useScreenShake()` light when your authored item wins a vote at reveal |

Key infra note (from drawing-canvas-infra §9 Q5): Telephone does **not** use the single
shared room canvas. It owns **one `CanvasSession` per chain** and the stroke relay must be
**scoped to the player currently drawing on that chain** — every player draws privately,
seeing only their own canvas, until reveal. This requires a Telephone-specific stroke
relay path (§7.4) rather than the generic `io.to(lobbyId)` broadcast in the infra spec.

---

## 2. Tournament fit

`getResults()` returns one entry per player in `this.players`, sorted by total score
descending, **every** player assigned a `placement`, ties sharing a placement number
(exactly the `SpotTheDifference.getResults()` pattern). Because votes can be sparse
(a 3-player game has few votes), a **participation base** guarantees a meaningful spread
and that nobody scores literally 0 unless they no-showed every step.

- Engine score per player = `participationBase[p]` + `votePoints[p]` (see §8).
- `getResults()` → `[{ playerId, placement, score, votes, itemsAuthored }]`, sorted, ties
  share placement. The tournament `Scorer.calculateRoundScores` maps these placements onto
  `PLACEMENT_MULTIPLIERS = [1.0,0.7,0.5,0.35,0.25,0.15]` — so all N (3–8) are ranked and
  6th+ all share the 0.15 tier.
- Tie rule: `let placement=1; if (i>0 && entries[i].score < entries[i-1].score) placement=i+1;`

---

## 3. FSM (state × action → next)

States: `waiting → writing → step → reveal → voting → finished`. The `step` state is
re-entered N times (one per alternating draw/write step); a `stepIndex` counter, not a
distinct state per step, drives the lockstep. `reveal` is re-entered per reveal frame.

| State | Action / event | → Next | Notes |
|---|---|---|---|
| `waiting` | `start` | `writing` | onEnterWriting: open phrase entry, start writeTimer |
| `writing` | `beginSteps` (all phrases in OR timer) | `step` | onEnterStep: assign seat rotation, start stepTimer |
| `step` | `nextStep` (more steps remain) | `step` | re-enter; flip draw/write mode, rotate seats |
| `step` | `beginReveal` (last step done) | `reveal` | onEnterReveal: build ordered reveal frames |
| `reveal` | `nextFrame` (more frames) | `reveal` | re-enter; advance `revealIndex` |
| `reveal` | `beginVoting` (all chains shown) | `voting` | onEnterVoting: open vote, start voteTimer |
| `voting` | `finishVote` (all voted OR timer) | `finished` | tally votes, compute results |

```
transitions: {
  waiting: { start: 'writing' },
  writing: { beginSteps: 'step' },
  step:    { nextStep: 'step', beginReveal: 'reveal' },
  reveal:  { nextFrame: 'reveal', beginVoting: 'voting' },
  voting:  { finishVote: 'finished' },
}
initialState: 'waiting'
```

> Re-entrant transitions (`step→step`, `reveal→reveal`) are allowed by `BaseGame.transition`
> (it only checks the transition exists for the current state). `onEnterStep` /
> `onEnterReveal` fire on every re-entry — used to advance counters and reset barriers.

**onEnter hooks**
- `onEnterWriting()` — init each chain, init `submitted` barrier, start `writeTimer`.
- `onEnterStep()` — compute `this.stepMode` (draw/write), rotate seat→chain mapping for
  this step, reset `submitted` barrier, start `stepTimer`, `reset()` each chain's
  `CanvasSession` + `setDrawer(authorForThisStepOnThatChain)`.
- `onEnterReveal()` — flatten all chains into `revealFrames`, set `revealIndex=0`, start
  `revealTimer`.
- `onEnterVoting()` — open voting, clear `votes`, start `voteTimer`.

---

## 4. Server state (fields)

`server/src/games/TelephonePictionary.js`

```js
// --- config (module consts) ---
const WRITE_TIMER_MS   = 50000;  // phrase entry
const STEP_TIMER_MS    = 70000;  // each draw OR write step
const REVEAL_FRAME_MS  = 6000;   // auto-advance per reveal frame (host can tap faster)
const VOTE_TIMER_MS    = 40000;
const ACK_GRACE_MS     = 10000;  // reveal/vote auto-advance grace
const MAX_PHRASE_LEN   = 120;
const PARTICIPATION_PER_ITEM = 20;   // base pts per non-blank item authored
const VOTE_POINTS      = 60;          // pts per vote your item received
const BLANK_DRAW = '__BLANK__';       // sentinel for an auto-filled blank drawing
const BLANK_TEXT = '???';

// --- instance fields ---
this.chains = [];          // chains[i] = { id, ownerId, items: Item[] }
                           //   ownerId = player who wrote the starting phrase (chain "belongs" to them)
this.numSteps = 0;         // = this.players.length (every seat sees every chain once incl. owner's write)
this.stepIndex = 0;        // 0-based; which alternating step we're on
this.stepMode = 'draw';    // 'draw' | 'write' for the current step
this.canvases = {};        // chainId -> CanvasSession  (one private canvas per chain)
this.submitted = new Set();// playerIds who submitted THIS step/phase (barrier)
this.seatOrder = [];       // stable seat order (snapshot of players at startGame)
this.assignment = {};      // for current step: playerId -> chainId they're working on
this.scores = {};          // engine score per player (base + votes), computed at finish
this.votePoints = {};      // playerId -> pts from votes
this.participation = {};    // playerId -> base pts
this.votes = {};           // voterId -> chainId voted for
this.revealFrames = [];    // flattened [{ chainId, ownerId, step, mode, authorId, content }]
this.revealIndex = 0;
this.acknowledged = new Set(); // reveal manual-advance / vote ack (host-agnostic: any ack counts)
this._writeTimer = null;
this._stepTimer = null;
this._revealTimer = null;
this._voteTimer = null;
this._onStateChange = null;
```

**Item shape** (one cell in a chain):
```js
Item = {
  step: number,        // 0 = starting phrase, 1.. = subsequent
  mode: 'phrase' | 'draw' | 'write',
  authorId: string,    // who produced it
  text: string|null,   // for phrase/write modes
  strokes: Stroke[]|null, // for draw mode — snapshot of that chain's CanvasSession at submit
  blank: boolean,      // auto-filled (leaver/timeout)
}
```

**Chain / seat rotation rule.** With `numSteps = players.length`, chain `i` owned by
seat `i`. On step `s` (1-based after the initial phrase), the player at seat
`(i + s) % N` works on chain `i`. Equivalently: `assignment[player at seat j] =
chains[(j - s + N) % N].id`. This guarantees each player touches each chain exactly once
and never sees their own chain twice in a row. `stepMode` alternates: phrase(step0,write-ish)
→ step1 `draw` → step2 `write` → step3 `draw` … The owner's starting phrase counts as the
seed; total items in a finished chain = `numSteps + 1` (seed phrase + N steps would
over-count, so we run **N−1 alternating steps** after the seed so `items.length === N`,
one authored cell per player). See §5 effects for the exact count guard.

---

## 5. Actions (`handleAction(playerId, action)`)

All actions ignored if `!this.players.includes(playerId)`. Each accepted action that
completes a barrier advances state and the index.js path broadcasts; timer-driven advances
go through `_emitChange()` (§7).

| Phase | `action.type` | Payload | Validation | Effects |
|---|---|---|---|---|
| `writing` | `submitPhrase` | `{ text }` | non-empty after trim, ≤ MAX_PHRASE_LEN; not already submitted | set `chains[seat].items[0] = {step:0,mode:'phrase',authorId,text,blank:false}`; `submitted.add(pid)`; if `submitted.size === players.length` → `_beginSteps()` |
| `step` (write) | `submitWrite` | `{ text }` | only if `stepMode==='write'`; `assignment[pid]` exists; non-empty trim ≤ MAX_PHRASE_LEN; not already submitted this step | append write Item to that chain; `submitted.add(pid)`; if barrier full → `_advanceStep()` |
| `step` (draw) | `submitDraw` | `{}` (strokes pulled server-side) | only if `stepMode==='draw'`; `assignment[pid]` exists; not already submitted | snapshot `canvases[chainId].snapshot().strokes` into a draw Item; `submitted.add(pid)`; if barrier full → `_advanceStep()` |
| `step` | `ping` | — | — | no-op; lets index.js re-broadcast (client local-timer fallback) |
| `reveal` | `advanceReveal` | `{}` | state===reveal | `acknowledged.add(pid)`; if `players.every ack` OR caller is fine → `_nextRevealFrame()` (any player may tap to advance; majority not required) |
| `voting` | `vote` | `{ chainId }` | chainId exists; **`chains.find(c=>c.id===chainId).ownerId !== pid`** (can't vote your own chain); not already voted | `votes[pid] = chainId`; if `Object.keys(votes).length === eligibleVoters` → `_finishVote()` |
| `voting` | `skipVote` | `{}` | not already voted | record abstain (`votes[pid] = null`); same barrier check |

**Turn guards / barriers.** There is no per-player "turn" — every step is simultaneous.
The guard is the **`submitted` barrier**: a step (or the writing phase) is complete only
when every player in `this.players` is in `submitted`. Re-submission is rejected
(`submitted.has(pid)` → ignore). Stroke traffic during a draw step does **not** go through
`handleAction` — it flows on the dedicated stroke channel (§7.4); only the final
`submitDraw` (or timeout) commits the picture to the chain.

**Stroke draw step note.** During a `draw` step each drawer is the `setDrawer` of their
own chain's `CanvasSession`. A player may draw freely; `submitDraw` (or step timeout)
freezes the current strokes into the Item. If they never click submit, the timeout
auto-submits whatever strokes exist (possibly empty → `blank:true` if zero strokes).

---

## 6. getStateForPlayer(playerId)

Returns only what THIS player may see. **Hidden-info rule:** during `writing`/`step`, a
player sees only the **single prior item** on the chain they were assigned (the phrase to
draw, or the drawing to write about) — never the rest of the chain, never other players'
chains. Full chains are revealed only in `reveal`/`finished`.

```js
getStateForPlayer(pid) {
  const myChainId = this.assignment[pid] || null;
  const myChain = this.chains.find(c => c.id === myChainId);
  // the ONE prior item the player must react to (drawing→write, or phrase→draw)
  const priorItem = myChain ? myChain.items[myChain.items.length - 1] : null;
  return {
    phase: this.state,                 // 'writing'|'step'|'reveal'|'voting'|'finished'
    stepIndex: this.stepIndex,
    totalSteps: this.numSteps - 1,     // alternating steps after the seed phrase
    stepMode: this.stepMode,           // 'draw' | 'write' (current step)
    mySubmitted: this.submitted.has(pid),
    submittedCount: this.submitted.size,
    playerCount: this.players.length,
    deadline: this._currentDeadlineMs(),   // epoch ms for the active timer (writing/step/vote)
    // WRITING: nothing prior to show
    // STEP(write): show prior drawing strokes to caption; STEP(draw): show prior phrase text
    prompt: this.state==='step'
      ? (this.stepMode==='write'
          ? { kind:'drawing', strokes: priorItem?.strokes || [], chainId: myChainId }
          : { kind:'phrase',  text: priorItem?.text || '', chainId: myChainId })
      : null,
    myChainId,                          // which private canvas to render/draw on
    // REVEAL: one frame at a time, in order
    reveal: this.state==='reveal' ? {
      index: this.revealIndex,
      total: this.revealFrames.length,
      frame: this.revealFrames[this.revealIndex] || null,  // {ownerId,step,mode,authorId,text|strokes}
    } : null,
    // VOTING: list of chains (full content visible now) to vote on, minus your own
    voting: this.state==='voting' ? {
      chains: this.chains.map(c => ({
        id: c.id, ownerId: c.ownerId,
        items: c.items,                 // full chain now public
        isMine: c.ownerId === pid,      // greyed/disabled in UI
      })),
      myVote: this.votes[pid] ?? undefined,
    } : null,
    // FINISHED: standings
    results: this.state==='finished' ? this.getResults() : null,
    nicknames: undefined,  // provided by TournamentManager.getState wrapper, not here
  };
}
```

- **Never** include `this.chains` in full during `writing`/`step` — only `priorItem`.
- `prompt.strokes` for a write step is the prior drawing's strokes only (the immediately
  preceding draw Item), nothing earlier in the chain.
- Draw-step strokes are streamed live via the canvas channel (§7.4), not via this state;
  the `prompt` for a draw step is just the phrase text.

---

## 7. Timers & broadcasting

Standard contract: `setOnStateChange(cb)` stores `this._onStateChange`; `_emitChange()`
calls it. index.js registers the callback (duck-typed `typeof game.setOnStateChange ===
'function'`) so timer-driven transitions broadcast fresh `GAME_STATE` to all and re-check
`isComplete()`. Every `setTimeout` advance below pairs with `_emitChange()`.

| Timer | Duration | On expiry (auto-action) |
|---|---|---|
| `_writeTimer` | `WRITE_TIMER_MS` 50s | auto-fill missing phrases with `BLANK_TEXT` (`blank:true`), force `_beginSteps()`, `_emitChange()` |
| `_stepTimer` | `STEP_TIMER_MS` 70s | for each non-submitted player: write step → append `{text:BLANK_TEXT,blank:true}`; draw step → snapshot current strokes (blank if none). Then `_advanceStep()`, `_emitChange()` |
| `_revealTimer` | `REVEAL_FRAME_MS` 6s | `_nextRevealFrame()`, `_emitChange()` (auto-paces the slideshow; a tap just advances early) |
| `_voteTimer` | `VOTE_TIMER_MS` 40s | abstain all non-voters, `_finishVote()`, `_emitChange()` |
| reveal/vote ack grace | `ACK_GRACE_MS` 10s | safety net: if a phase somehow stalls with everyone acked but no advance, force-advance |

```js
setOnStateChange(cb){ this._onStateChange = cb; }
_emitChange(){ if (typeof this._onStateChange==='function') this._onStateChange(); }

_clearTimers(){
  for (const k of ['_writeTimer','_stepTimer','_revealTimer','_voteTimer']) {
    if (this[k]) { clearTimeout(this[k]); this[k]=null; }
  }
}
```

**The step-barrier** (the heart of the lockstep). A step ends the instant the last needed
submission arrives OR the step timer fires — whichever first. `_maybeAdvanceStep()` is
called after every `submitted.add`:

```js
_maybeAdvanceStep(){
  if (this.players.every(p => this.submitted.has(p))) this._advanceStep();
}
_advanceStep(){
  if (this.state !== 'step') return;          // guard double-call
  this._clearTimers();
  // commit current canvases already done per-submit; rotate to next step
  if (this.stepIndex >= this.numSteps - 1) {   // ran all alternating steps
    this.transition('beginReveal');            // onEnterReveal builds frames + revealTimer
    return;
  }
  this.transition('nextStep');                 // onEnterStep: ++stepIndex, flip mode, re-assign, reset barrier+canvases, new stepTimer
}
```

Guard pattern (`if (this.state !== 'step') return;`) prevents the timer and the
last-submission racing into a double advance — same discipline as SpotTheDifference's
`_endRound` guard.

---

## 8. Scoring & getResults

Score computed at `_finishVote()`:

```
participation[p] = PARTICIPATION_PER_ITEM × (number of NON-blank items p authored)
votePoints[p]    = VOTE_POINTS × (votes whose chosen chain CONTAINS at least one item authored by p)
                   — simplest model: votes go to a CHAIN; the chain's points are split:
                     ownerId gets the vote, OR (richer) each contributor on the winning
                     chain shares. v1 = whole-chain vote credited to chain.ownerId.
scores[p] = participation[p] + votePoints[p]
```

v1 vote model (recommended, least ambiguous): **a vote is for a chain; the chain's votes
credit its `ownerId`.** This rewards starting a phrase that produced a funny chain.
`participation` ensures every contributor still ranks even with zero votes.

> Open question (§14 Q2): split votes among all contributors of the winning chain instead
> of crediting only the owner. v1 keeps owner-credit for simplicity and clear ranking.

```js
getResults(){
  const entries = this.players.map(p => ({
    playerId: p,
    score: (this.participation[p]||0) + (this.votePoints[p]||0),
    votes: this._votesForOwner(p),
    itemsAuthored: this._nonBlankItemsBy(p),
  }));
  entries.sort((a,b) => b.score - a.score
                    || b.votes - a.votes
                    || b.itemsAuthored - a.itemsAuthored);
  let placement = 1;
  return entries.map((e,i) => {
    if (i>0 && e.score < entries[i-1].score) placement = i+1;
    return { ...e, placement };
  });
}
```

Ties share `placement` (`<` not `<=`). Every player in `this.players` appears → all N
ranked, satisfying the #1 constraint. Tie-breakers (votes, then items) only reorder display
within equal `score`; players with truly identical score+votes+items keep the same placement.

---

## 9. Leave & deadlock handling (v2.7.0 contract)

The danger: lockstep means one missing submission can freeze every other chain. The fix:
a leaver is **auto-filled blank for their current obligation**, pruned from the barrier, and
the step re-checked immediately so chains never wait on a ghost.

```js
removePlayer(playerId){
  super.removePlayer(playerId);              // prunes this.players + activePlayers rotation
  // 1) If they owed a submission this phase, auto-fill BLANK so the barrier can complete.
  if (this.state === 'writing' && !this.submitted.has(playerId)) {
    const seat = this.seatOrder.indexOf(playerId);
    // their chain may be unseeded — seed it blank so later steps have a prior item
    this._autoFillPhrase(playerId);
  }
  if (this.state === 'step' && !this.submitted.has(playerId)) {
    this._autoFillStepFor(playerId);         // blank write OR blank-draw snapshot on their assigned chain
  }
  // 2) Remove them from barriers so .every() no longer waits on them.
  this.submitted.delete(playerId);
  this.acknowledged.delete(playerId);
  delete this.assignment[playerId];
  delete this.votes[playerId];
  // 3) <=1 player remains → finish (orchestration force-completes the round).
  if (this.players.length <= 1) {
    this._clearTimers();
    // still build whatever reveal/scores make sense; mark finished so isComplete() true
    if (this.state !== 'finished') this.state = 'finished';
    return;
  }
  // 4) Re-check the active barrier now that this player is gone.
  if (this.state === 'writing' && this.players.every(p=>this.submitted.has(p))) this._beginSteps();
  else if (this.state === 'step' && this.players.every(p=>this.submitted.has(p))) this._advanceStep();
  else if (this.state === 'voting' && this._allVotesIn()) this._finishVote();
  else if (this.state === 'reveal') { /* reveal is timer-paced; nothing to wait on */ }
}
```

- **`_removeFromActive(id)`** — not used for normal leaves here (Telephone never eliminates
  mid-round; everyone authors every step). Reserved/inherited; left to BaseGame default.
  A leaver is a full `removePlayer`, not an elimination.
- **`destroy()`** — `this._clearTimers(); for (const c of Object.values(this.canvases))
  c?.destroy(); this._onStateChange = null;` Orchestration calls it on teardown so no
  orphaned `_stepTimer`/`_revealTimer` fires on a dead instance.

**Phase-specific "who left" answers**

| Phase | Leaver role | Result |
|---|---|---|
| `writing` | any | their phrase seeded `BLANK_TEXT`; barrier re-checked; if they were the last needed, `_beginSteps()` fires immediately (no freeze) |
| `step` (draw) | the player drawing chain X | `_autoFillStepFor` snapshots whatever strokes exist on chain X (or blank), commits Item, prunes barrier; chain X continues to next seat next step |
| `step` (write) | the player captioning a drawing | blank `???` write Item committed; barrier re-checked |
| `step` | the **last-needed** submitter | their auto-fill completes the barrier → `_advanceStep()` runs in the same `removePlayer` call → `_emitChange()` broadcasts; **no deadlock** |
| `reveal` | any | reveal is purely timer/tap-paced; remove from `acknowledged`; slideshow keeps going |
| `voting` | the last non-voter | abstain pruned; if all remaining votes in → `_finishVote()` |
| any | drops to **1 player** | `_clearTimers()`, `state='finished'`, orchestration scores the single remaining player as winner via `getResults()` |

Because `removePlayer` itself can call `_advanceStep`/`_beginSteps`/`_finishVote`, and the
caller in index.js always follows a leave with a state broadcast, no separate `_emitChange`
is strictly required inside `removePlayer`; but advancing transitions that start a NEW
timer is safe (the new timer pairs with its own `_emitChange`). Mirror SpotTheDifference:
do the work synchronously, let index.js broadcast.

---

## 10. Client component

`client/src/games/TelephonePictionary.jsx` + `.module.css`. Props (App.jsx contract):
`gameState`, `nicknames`, `avatars`, `onAction`, plus the canvas socket wiring (§7.4).
Owns `const [strokes,setStrokes]=useState([])` for the active private canvas, fed by the
Telephone-scoped stroke listeners. Title font **Gochi Hand**. `useSound()`, `useScreenShake()`,
`PlayerName` for every name. Touch: all inputs tap-friendly, canvas `touch-action:none`,
≥44px buttons, no hover-only affordances.

Render by `gameState.phase`:

| Phase | Screen | Layout / actions emitted |
|---|---|---|
| `writing` | **Phrase entry** | big centered textarea (maxLength 120), "Lock it in" button → `onAction({type:'submitPhrase',text})`. Shows `submittedCount/playerCount` waiting bar + countdown to `deadline`. Enter key disabled (project convention) — submit via button only. |
| `step` + `draw` | **Draw screen** | prompt phrase shown at top ("Draw: *a cat on a skateboard*"); `<DrawingCanvas readOnly={false} toolbar strokes={strokes} onStroke=… onUndo=… onClear=… />` bound to `myChainId` canvas; "Done drawing" → `onAction({type:'submitDraw'})`. Countdown + waiting count. |
| `step` + `write` | **Caption screen** | `<DrawingCanvas readOnly strokes={gameState.prompt.strokes} />` showing the prior drawing; textarea "What is this?" → `onAction({type:'submitWrite',text})`. Countdown + waiting count. |
| `reveal` | **Reveal viewer** | one frame at a time from `gameState.reveal.frame`: render phrase text big, or a read-only canvas of `frame.strokes`, captioned with `PlayerName(frame.authorId)` and "Chain owned by `PlayerName(ownerId)`". Progress `index+1 / total`. "Next →" → `onAction({type:'advanceReveal'})` (auto-advances on `REVEAL_FRAME_MS` too). Page-flip sound per frame. |
| `voting` | **Voting UI** | grid of chains (`gameState.voting.chains`); each card shows the full chain mini-strip (phrase → thumb → caption …). Your own chain (`isMine`) greyed + "Your chain" badge, unclickable. Tap a chain → `onAction({type:'vote',chainId})`; "Skip" → `skipVote`. Shows `myVote` highlighted, countdown. |
| `finished` | **Standings** | `gameState.results` sorted; show placement, score, votes; light shake if `socket.id` authored the winning chain. Then standard Results screen takes over. |

**Canvas read of `gameState`:** the draw step reads `gameState.myChainId` to know which
private canvas to attach listeners for; the write step reads `gameState.prompt.strokes`
(static, no live listeners needed — the prior drawing is final). Voting/reveal read
`items[].strokes` to render static thumbnails (small read-only `DrawingCanvas`,
`toolbar={false}`).

---

## 11. Registration checklist (8 steps)

| # | File (absolute under project root) | Edit |
|---|---|---|
| 1 | `server/src/games/TelephonePictionary.js` | `class TelephonePictionary extends BaseGame`; holds `this.canvases` (one `CanvasSession` per chain, from `../utils/CanvasSession.js`); FSM per §3; implements startGame/handleAction/getStateForPlayer/isComplete/getResults/setOnStateChange/removePlayer/destroy |
| 2 | `shared/gameList.js` → `GAMES` | add entry (values below) |
| 3 | `shared/constants.js` → `TIMERS` | add `TELEPHONE_STEP: 70` (step turn timer surfaced to lobby/gameList); other timers (write/reveal/vote) live as module consts in the game file |
| 4 | `server/src/games/registry.js` | `import { TelephonePictionary } from './TelephonePictionary.js';` + `registerGame('telephonePictionary', TelephonePictionary);` |
| 5 | `client/src/games/TelephonePictionary.jsx` + `TelephonePictionary.module.css` | per §10; props `gameState/nicknames/avatars/onAction`; uses `DrawingCanvas`, `PlayerName`, `useSound()`, `useScreenShake()`; title font **Gochi Hand**; Telephone-scoped canvas listeners (§7.4) |
| 6 | `client/src/assets/gamepreviews/telephonePictionary.png` | preview image (scribbly chain motif) |
| 7 | `client/src/App.jsx` → `GAME_COMPONENTS` | `import TelephonePictionaryGame from './games/TelephonePictionary.jsx';` + `telephonePictionary: TelephonePictionaryGame` |
| 8 | `client/src/screens/GameVote.jsx` → `GAME_PREVIEWS` | `import previewTelephone from '../assets/gamepreviews/telephonePictionary.png';` + `telephonePictionary: previewTelephone` |

**Exact `shared/gameList.js` entry:**
```js
telephonePictionary: {
  id: 'telephonePictionary', name: 'Telephone Pictionary', minPlayers: 3, maxPlayers: 8,
  turnTimer: TIMERS.TELEPHONE_STEP,
  description: 'Write a phrase, draw the last one, guess the last drawing. Chaos by reveal.',
  instructions: [
    'Everyone secretly writes a starting phrase.',
    'Each step you get the person-before-you\'s page: draw the phrase, or guess the drawing.',
    'You only ever see the ONE thing right before you — never the whole chain.',
    'Steps alternate draw / write and rotate around the table until every page is full.',
    'All chains are revealed one frame at a time — watch the phrase mutate into nonsense.',
    'Vote for the funniest chain. Most votes + taking part scores you the round.',
  ],
},
```

**Also wire (from drawing-canvas-infra, if not already added by Skribbl):** the infra
modules `server/src/utils/CanvasSession.js`, `client/src/components/DrawingCanvas.jsx`,
and the `shared/events.js` `STROKE_*`/`CANVAS_*` names. Telephone ADDS its own scoped relay
(see §7.4 below) — it does **not** reuse the generic `io.to(lobbyId)` stroke handler.

### 7.4 Telephone-scoped private stroke relay (infra divergence)

Because every player draws their own private canvas simultaneously, strokes must **not**
broadcast to the room. New socket handlers in `server/src/index.js` (alongside the generic
ones, guarded so they only fire for this game):

```js
socket.on(EVENTS.STROKE_SEND, (data) => {
  const lobbyId = lobbyManager.getPlayerLobby(socket.id);
  const tm = tournaments.get(lobbyId);
  const g = tm?.activeGame;
  if (!g || g.constructor.name !== 'TelephonePictionary') return;  // generic handler covers others
  const chainId = g.assignment[socket.id];
  const cv = chainId && g.canvases[chainId];
  if (!cv || cv.getDrawer() !== socket.id) return;
  const res = cv.addStroke(socket.id, data?.stroke);
  if (res.ok) socket.emit(EVENTS.STROKE_BROADCAST, { stroke: res.stroke, drawerId: socket.id });
  //          ^^^^^^ socket.emit — back to the AUTHOR ONLY, never io.to(room)
});
// CANVAS_UNDO_SEND / CANVAS_CLEAR_SEND: same pattern, echo to `socket` only.
```

Add `TELEPHONE_STEP` to `shared/constants.js`:
```js
TELEPHONE_STEP: 70,
```

---

## 12. Edge cases & test scenarios (leave/deadlock harness assertions)

| # | Scenario | Expected assertion |
|---|---|---|
| 1 | All N submit phrases | `state==='step'`, `stepIndex===1`, `stepMode==='draw'`, each chain `items.length===1` |
| 2 | One player never submits a phrase; write timer fires | their chain seeded `{text:'???',blank:true}`; `_beginSteps` runs; no freeze |
| 3 | Draw step: every player submits but one | barrier NOT complete; `submitted.size===N-1`; nothing advances until last submit or timer |
| 4 | Draw step: last-needed player **leaves** | `removePlayer` auto-fills their chain (blank/partial), prunes barrier, `players.every` now true → `_advanceStep` fires inside the same call → `isComplete()` unchanged, next step assigned; **no deadlock** |
| 5 | Write step timeout with 2 non-submitters | both get `???` blank Items, `_advanceStep`, `_emitChange` broadcasts; chains intact |
| 6 | Player tries to submit twice in one step | second `submitDraw/submitWrite` ignored (`submitted.has` guard); no duplicate Item |
| 7 | Player votes for their own chain | rejected (`ownerId===pid` guard); `votes[pid]` unset |
| 8 | All eligible voters vote | `_finishVote()`; `state==='finished'`; `getResults()` length === current `players.length` |
| 9 | Vote timer expires with 1 non-voter | non-voter abstained; tally proceeds; results computed |
| 10 | Drops to 1 player mid-step | `_clearTimers()`, `state==='finished'`, `isComplete()===true`, `getResults()` ranks the survivor placement 1 |
| 11 | `getResults()` ties (two players equal score+votes+items) | both share identical `placement`; next distinct score gets `i+1` |
| 12 | Reveal frame auto-advance | after `REVEAL_FRAME_MS` with no tap, `revealIndex++`, `_emitChange` broadcasts; last frame → `_finishReveal`→`beginVoting` |
| 13 | Mid-step joiner (mid-tournament) | blocked during active game per lobby rules; if join is allowed only between rounds, no canvas state needed; assert join is rejected while `state∈{writing,step,reveal,voting}` |
| 14 | Hidden-info: write-step player requests state | `getStateForPlayer` exposes ONLY `prompt.strokes` of the one prior drawing, not earlier items, not other chains |
| 15 | Stroke from a non-assigned player during draw step | scoped relay rejects (`cv.getDrawer() !== socket.id`); no echo |
| 16 | `destroy()` after step timer scheduled | timer cleared; all `canvases` destroyed; no late `_emitChange` on dead instance |
| 17 | 3-player game (minimum) | runs 2 alternating steps (`numSteps-1`), reveal of 3 chains, voting excludes own chain (each has 2 votable chains) |
| 18 | Player leaves during `reveal` | removed from `acknowledged`; slideshow timer unaffected; reaches voting |

**Harness style** (mirror existing game tests): construct `new TelephonePictionary([a,b,c,d])`,
`startGame()`, drive `handleAction`, assert `state`/barrier/`getResults()`; for leave cases
call `removePlayer` mid-barrier and assert the FSM advanced rather than hung (the core
deadlock guarantee).

---

## 13. Effort & risks

**Effort: L** — the most complex game in the set. Lockstep barrier + per-chain private
canvases + reveal slideshow + voting are four sub-systems.

Breakdown:
- Server FSM (chains/rotation/barrier/reveal/vote/scoring) — **M–L** (the seat-rotation and
  barrier correctness are the risk; heavily unit-test).
- Telephone-scoped private stroke relay in index.js — **S** (small diff, but a NEW path that
  diverges from the infra's room broadcast — easy to get the scoping wrong).
- Client: 6 phase screens incl. reveal slideshow + voting grid + thumbnails — **M–L**.
- Preview asset + registration — **S**.

**Deps:** drawing-canvas-infra (`CanvasSession`, `DrawingCanvas`, `STROKE_*`/`CANVAS_*`
events) MUST land first. Reuses `PlayerName`, `useSound`, `useScreenShake`, `Scorer`.

**Risks / mitigations:**
- **Lockstep freeze** (one slow/gone player stalls all chains) → bounded by `_stepTimer`
  auto-submit + `removePlayer` auto-fill + barrier re-check; the #1 thing the test harness
  must prove (scenarios 4/5/10).
- **Private-canvas scoping leak** (a player seeing another's in-progress drawing) →
  structural: `socket.emit` to author only, `setDrawer` gate per chain. Test #15.
- **Hidden-info leak in `getStateForPlayer`** → only ever emit the single `priorItem`;
  never serialize `this.chains` before reveal. Test #14.
- **Reveal pacing UX** → timer auto-advance + manual tap; tune `REVEAL_FRAME_MS`.
- **Sparse votes at 3 players** → participation base guarantees ranking spread (§8).
- **Double-advance race** (last submit + timer) → `if (this.state!=='step') return;` guards.

---

## 14. Open questions

1. **Step count vs item count.** Spec runs `numSteps - 1` alternating steps so each chain
   ends with exactly N items (seed phrase + N−1). Confirm we want one authored cell per
   player (cleanest) vs. a longer chain that revisits seats (more chaos, needs >N steps and
   re-seeing your own chain). Recommend one-cell-per-player.
2. **Vote credit model.** v1 credits all of a winning chain's votes to its `ownerId`.
   Alternative: split votes among every contributor of that chain (rewards the funny
   *drawing/caption*, not just the seed). Splitting complicates ranking; defer to v2.
3. **Best-item voting vs best-chain voting.** Brief mentions "funniest stack/best item."
   v1 = vote a whole chain (simplest UI, one tap). A "best single item" mode would need
   per-item vote targets and a different tally. Recommend chain-level for v1.
4. **Mid-tournament join.** Active game blocks joins (lobby rule). Confirm Telephone is
   fully join-blocked once `start` fires (it must be — seats/rotation are fixed at
   `startGame`). No mid-round canvas snapshot path needed if so.
5. **Reveal advance authority.** v1 lets ANY player tap "Next" to advance the slideshow
   (plus auto-timer). Should it be host-only, or majority? Any-tap + timer is least
   deadlock-prone; recommend keeping it.
6. **Start mode.** Does everyone write a seed phrase (current design), or does the game
   hand out random `wordBank` prompts as seeds (faster start, less personality)? Player-
   written seeds are funnier; `wordBank` is the auto-fill fallback for blanks.
7. **Even vs odd N and draw/write parity.** With alternating modes, an even N ends a chain
   on a `write`, odd N on a `draw`. Reveal handles both; confirm no scoring asymmetry
   (participation is per-item, mode-agnostic, so none) — flagging for the playtest.
