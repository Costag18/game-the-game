import { installClock, uninstallClock, advance, setNow, getNow, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { WhackAPharaoh } from '../src/games/WhackAPharaoh.js';

installClock();

function newGame(players) {
  const g = new WhackAPharaoh(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force a deterministic single pop-up live in `cell` of `kind` (server-side state
// surgery — simulates what a spawn timer would do, so tests don't depend on RNG).
function forceLive(g, cell, kind, occId = 'occ-test') {
  g.live[cell] = {
    occId, kind,
    spawnAt: getNow(),
    despawnAt: getNow() + 1000,
  };
  return occId;
}

test('starts active with a pre-generated schedule and armed timers', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'active');
  assert(g.schedule.length > 0, 'schedule pre-generated');
  assert(pendingTimers() >= 2, 'spawn/despawn/round timers armed');
  // every schedule entry is a valid cell + known kind, within the round window
  for (const e of g.schedule) {
    assert(e.cell >= 0 && e.cell < 9, 'cell in range');
    assert(e.kind === 'pharaoh' || e.kind === 'mummy', 'valid kind');
    assert(e.spawnAt < e.despawnAt && e.despawnAt <= 25_000, 'lifetime sane');
  }
});

test('whacking a live pharaoh scores +100; mummy scores -60 floored at 0', () => {
  const g = newGame(['a', 'b']);
  forceLive(g, 4, 'pharaoh', 'p1');
  g.handleAction('a', { type: 'whack', cell: 4 });
  eq(g.scores['a'], 100);
  eq(g.hits['a'].pharaohs, 1);
  // mummy alone floors at 0 (would be -60)
  forceLive(g, 0, 'mummy', 'm1');
  g.handleAction('b', { type: 'whack', cell: 0 });
  eq(g.scores['b'], 0);
  eq(g.hits['b'].mummies, 1);
});

test('mummy subtracts from existing score (not floored when positive)', () => {
  const g = newGame(['a']);
  forceLive(g, 1, 'pharaoh', 'p1');
  g.handleAction('a', { type: 'whack', cell: 1 });
  forceLive(g, 2, 'mummy', 'm1');
  g.handleAction('a', { type: 'whack', cell: 2 });
  eq(g.scores['a'], 40); // 100 - 60
});

test('whacking an empty/expired cell scores nothing (anti-cheat)', () => {
  const g = newGame(['a', 'b']);
  // no live occupant anywhere
  g.live = {};
  g.handleAction('a', { type: 'whack', cell: 5 });
  eq(g.scores['a'], 0);
  // a live occupant that has been removed (expired) before the tap arrives
  forceLive(g, 3, 'pharaoh', 'p1');
  delete g.live[3];
  g.handleAction('a', { type: 'whack', cell: 3 });
  eq(g.scores['a'], 0);
});

test('cannot double-whack the same occupant; out-of-range cell ignored', () => {
  const g = newGame(['a']);
  forceLive(g, 6, 'pharaoh', 'p1');
  g.handleAction('a', { type: 'whack', cell: 6 });
  g.handleAction('a', { type: 'whack', cell: 6 }); // same occupant again
  eq(g.scores['a'], 100); // only credited once
  eq(g.hits['a'].pharaohs, 1);
  g.handleAction('a', { type: 'whack', cell: 99 }); // invalid
  g.handleAction('a', { type: 'whack', cell: -1 });
  eq(g.scores['a'], 100);
});

test('two players whack the SAME shared pop-up independently', () => {
  const g = newGame(['a', 'b']);
  forceLive(g, 7, 'pharaoh', 'p1');
  g.handleAction('a', { type: 'whack', cell: 7 });
  g.handleAction('b', { type: 'whack', cell: 7 });
  eq(g.scores['a'], 100);
  eq(g.scores['b'], 100);
});

test('getStateForPlayer hides the FUTURE schedule and only leaks live cells', () => {
  const g = newGame(['a', 'b']);
  g.live = {}; // no live occupants
  forceLive(g, 2, 'mummy', 'm1');
  const s = g.getStateForPlayer('a');
  eq(s.cells.length, 9);
  eq(s.cells[2].kind, 'mummy');
  eq(s.cells[2].occId, 'm1');
  // no other cell is live
  eq(s.cells.filter(Boolean).length, 1);
  // the full schedule / occIds of future targets must NOT be present anywhere
  const blob = JSON.stringify(s);
  assert(!('schedule' in s), 'schedule not in view');
  // a future occId from the plan should not leak (only the live m1 should appear)
  const futureLeak = g.schedule.some((e) => e.occId !== 'm1' && blob.includes(e.occId));
  assert(!futureLeak, 'future occupant ids not leaked');
});

test('per-player whacked flag is private + correct in the view', () => {
  const g = newGame(['a', 'b']);
  g.live = {};
  forceLive(g, 4, 'pharaoh', 'p1');
  g.handleAction('a', { type: 'whack', cell: 4 });
  const sa = g.getStateForPlayer('a');
  const sb = g.getStateForPlayer('b');
  eq(sa.cells[4].whacked, true);   // a already whacked it
  eq(sb.cells[4].whacked, false);  // b has not
  eq(sa.myScore, 100);
  eq(sb.myScore, 0);
});

test('every timer path (spawn / despawn / round-end) calls _emitChange', () => {
  const g = newGame(['a', 'b']);
  // drive the whole 25s schedule via the clock; spy already counts emits
  const before = g.emitCount;
  advance(26_000);
  eq(g.state, 'finished');
  assert(g.emitCount > before, 'timers broadcast as they fire');
});

test('a spawn timer toggles a live cell then despawn clears it', () => {
  const g = newGame(['a', 'b']);
  // find the first scheduled spawn and walk the clock to just past it
  const first = g.schedule.slice().sort((x, y) => x.spawnAt - y.spawnAt)[0];
  advance(first.spawnAt + 1);
  assert(g.live[first.cell] && g.live[first.cell].occId === first.occId, 'cell went live at spawnAt');
  advance((first.despawnAt - first.spawnAt) + 5);
  // either it cleared, or a later occupant took that cell — original occId must be gone
  assert(!g.live[first.cell] || g.live[first.cell].occId !== first.occId, 'occupant despawned');
});

test('full game reaches finished with getResults length N, placement 1 first (N=2,3,4)', () => {
  for (const players of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    const g = newGame(players);
    // player 'a' whacks every pharaoh as it pops; others stay idle
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 4000) {
      for (let c = 0; c < 9; c++) {
        const occ = g.live[c];
        if (occ && occ.kind === 'pharaoh') g.handleAction('a', { type: 'whack', cell: c });
      }
      advance(60);
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, players.length);
    eq(res[0].placement, 1);
    // a whacked pharaohs (others idle) → a is strictly first (or tie at 0 if no pharaohs popped)
    assert(res[0].score >= res[res.length - 1].score, 'sorted desc');
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, players.length);
  }
});

test('a tie shares a placement', () => {
  const g = newGame(['a', 'b', 'c']);
  // nobody whacks anything; let it finish → all 0 → all placement 1
  advance(26_000);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
  eq(res.every((r) => r.score === 0), true);
});

test('placements gap correctly with mixed scores', () => {
  const g = newGame(['a', 'b', 'c']);
  forceLive(g, 0, 'pharaoh', 'p1');
  g.handleAction('a', { type: 'whack', cell: 0 }); // a:100
  forceLive(g, 1, 'pharaoh', 'p2');
  g.handleAction('b', { type: 'whack', cell: 1 }); // b:100
  // c:0  → a,b tie at placement 1, c at placement 3
  advance(26_000);
  const res = g.getResults();
  const byId = Object.fromEntries(res.map((r) => [r.playerId, r.placement]));
  eq(byId['a'], 1);
  eq(byId['b'], 1);
  eq(byId['c'], 3);
});

test('removePlayer mid-play advances with no deadlock; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  forceLive(g, 0, 'pharaoh', 'p1');
  g.handleAction('a', { type: 'whack', cell: 0 });
  g.removePlayer('b'); // b leaves mid-game
  assert(!g.players.includes('b'), 'b pruned from roster');
  assert(g.state === 'active', 'still running with 2 players');
  // play on and finish
  advance(26_000);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 2);
  assert(!res.some((r) => r.playerId === 'b'), 'leaver not ranked');
});

test('collapse to one player finishes immediately', () => {
  const g = newGame(['a', 'b']);
  g.removePlayer('b');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

test('ping action is a harmless re-broadcast nudge', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  g.handleAction('a', { type: 'ping' });
  assert(g.emitCount > before, 'ping rebroadcasts');
  eq(g.scores['a'], 0); // changes nothing
});

test('destroy() clears all timers', () => {
  const g = newGame(['a', 'b']);
  assert(pendingTimers() > 0, 'timers armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('no action scores after finished', () => {
  const g = newGame(['a', 'b']);
  advance(26_000);
  eq(g.state, 'finished');
  forceLive(g, 0, 'pharaoh', 'late'); // even if a cell were live
  g.handleAction('a', { type: 'whack', cell: 0 });
  eq(g.scores['a'], 0);
});

uninstallClock();
report('WhackAPharaoh');
