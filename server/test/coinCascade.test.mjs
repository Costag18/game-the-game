import { installClock, uninstallClock, advance, pendingTimers, getNow, test, assert, eq, report } from './helpers.mjs';
import { CoinCascade } from '../src/games/CoinCascade.js';

installClock();

// Build a game but REPLACE the random schedule with a deterministic one so we can
// drive the clock to exact arrival moments and assert server-computed scores.
// (The real _buildSchedule uses Math.random, which is fine — but tests need
// predictability, so we stub the schedule before onEnterActive arms its timers.)
function newGame(players, schedule) {
  const g = new CoinCascade(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  // Intercept schedule generation.
  g._buildSchedule = function () { this.schedule = schedule.map((o) => ({ ...o })); };
  g.startGame();
  return g;
}

// helper: a simple schedule of single-object arrivals
const sched = (...objs) => objs;

test('starts active, baskets at lane 2, scores 0, arrival+end timers armed', () => {
  const g = newGame(['a', 'b'], sched({ id: 'o0', lane: 0, kind: 'coin', arriveAt: 1000 }));
  eq(g.state, 'active');
  eq(g.baskets['a'], 2);
  eq(g.baskets['b'], 2);
  eq(g.scores['a'], 0);
  // 1 arrival timer + 1 end timer
  assert(pendingTimers() >= 2, 'arrival + end timers armed');
});

test('catch: basket in the object lane at arriveAt scores; coin +10 / gem +25 / bomb -15', () => {
  const g = newGame(['a', 'b'], sched(
    { id: 'o0', lane: 1, kind: 'coin', arriveAt: 1000 },
    { id: 'o1', lane: 3, kind: 'gem',  arriveAt: 2000 },
    { id: 'o2', lane: 4, kind: 'bomb', arriveAt: 3000 },
  ));
  // a moves to lane 1, b stays at lane 2
  g.handleAction('a', { type: 'move', lane: 1 });
  advance(1000); // o0 (lane 1, coin) lands
  eq(g.scores['a'], 10); // a caught the coin
  eq(g.scores['b'], 0);  // b at lane 2, no catch

  // a moves to lane 3 for the gem
  g.handleAction('a', { type: 'move', lane: 3 });
  advance(1000); // o1 (lane 3, gem) lands at t=2000
  eq(g.scores['a'], 35); // 10 + 25

  // a moves to lane 4 for the bomb (oops)
  g.handleAction('a', { type: 'move', lane: 4 });
  advance(1000); // o2 (lane 4, bomb) lands at t=3000
  eq(g.scores['a'], 20); // 35 - 15
});

test('score floors at 0 — a bomb can never push below zero', () => {
  const g = newGame(['a'], sched({ id: 'o0', lane: 0, kind: 'bomb', arriveAt: 1000 }));
  g.handleAction('a', { type: 'move', lane: 0 });
  advance(1000);
  eq(g.scores['a'], 0); // 0 - 15 -> floored to 0
});

test('wrong lane at arrival scores nothing; a stale move after arrival does not retro-credit', () => {
  const g = newGame(['a'], sched({ id: 'o0', lane: 2, kind: 'coin', arriveAt: 1000 }));
  g.handleAction('a', { type: 'move', lane: 0 }); // wrong lane
  advance(1000); // coin lands in lane 2, a is in lane 0
  eq(g.scores['a'], 0);
  g.handleAction('a', { type: 'move', lane: 2 }); // too late — object already resolved
  eq(g.scores['a'], 0);
});

test('move clamps to 0..4 and rejects non-finite lanes', () => {
  const g = newGame(['a'], sched({ id: 'o0', lane: 4, kind: 'coin', arriveAt: 9999 }));
  g.handleAction('a', { type: 'move', lane: 99 });
  eq(g.baskets['a'], 4);
  g.handleAction('a', { type: 'move', lane: -5 });
  eq(g.baskets['a'], 0);
  g.handleAction('a', { type: 'move', lane: 'nope' });
  eq(g.baskets['a'], 0); // unchanged — invalid ignored
});

test('shared stream: every player in the lane catches the SAME object', () => {
  const g = newGame(['a', 'b', 'c'], sched({ id: 'o0', lane: 2, kind: 'gem', arriveAt: 1000 }));
  // a & b stay at default lane 2, c moves away
  g.handleAction('c', { type: 'move', lane: 0 });
  advance(1000);
  eq(g.scores['a'], 25);
  eq(g.scores['b'], 25);
  eq(g.scores['c'], 0);
});

test('HIDDEN info: schedule / future objects / arriveAt thresholds NOT in getStateForPlayer', () => {
  const g = newGame(['a', 'b'], sched(
    { id: 'o0', lane: 1, kind: 'coin', arriveAt: 1000 },
    { id: 'farfuture', lane: 0, kind: 'bomb', arriveAt: 25000 },
  ));
  const s = g.getStateForPlayer('a');
  const blob = JSON.stringify(s);
  assert(!('schedule' in s), 'schedule not exposed');
  // far-future object (outside the visible window) must not leak
  assert(!blob.includes('farfuture'), 'far-future object id not leaked');
  // no raw arriveAt threshold field on the in-flight objects
  for (const o of s.objects || []) assert(!('arriveAt' in o), 'arriveAt not on visible objects');
});

test('in-flight window exposes lane + progress 0..1 for currently falling objects only', () => {
  const g = newGame(['a'], sched(
    { id: 'soon', lane: 3, kind: 'coin', arriveAt: 1000 },
    { id: 'later', lane: 1, kind: 'gem', arriveAt: 9000 },
  ));
  // at t≈0, 'soon' is within the ~2.6s visible window; 'later' is not yet
  const s = g.getStateForPlayer('a');
  const ids = (s.objects || []).map((o) => o.id);
  assert(ids.includes('soon'), 'soon object visible');
  assert(!ids.includes('later'), 'later object not yet visible');
  const soon = s.objects.find((o) => o.id === 'soon');
  eq(soon.lane, 3);
  assert(soon.progress >= 0 && soon.progress <= 1, 'progress in [0,1]');
});

test('every timer path (arrival + end) calls _emitChange', () => {
  const g = newGame(['a'], sched({ id: 'o0', lane: 2, kind: 'coin', arriveAt: 1000 }));
  const before = g.emitCount;
  advance(1000); // arrival fires -> _emitChange
  assert(g.emitCount > before, 'arrival broadcasts');
  const mid = g.emitCount;
  advance(60000); // run past end -> end timer fires -> _emitChange
  eq(g.state, 'finished');
  assert(g.emitCount > mid, 'end broadcasts');
});

test('ping action is a harmless re-broadcast nudge', () => {
  const g = newGame(['a'], sched({ id: 'o0', lane: 2, kind: 'coin', arriveAt: 1000 }));
  const before = g.emitCount;
  g.handleAction('a', { type: 'ping' });
  assert(g.emitCount > before, 'ping nudges a broadcast');
  eq(g.scores['a'], 0); // ping never scores
});

test('schedule exhaustion finishes the game', () => {
  const g = newGame(['a', 'b'], sched({ id: 'o0', lane: 2, kind: 'coin', arriveAt: 500 }));
  advance(60000);
  eq(g.state, 'finished');
});

function playFullGame(players, mover) {
  // deterministic schedule: 6 coins, one per player-ish, lanes cycle
  const schedule = [];
  for (let i = 0; i < 6; i++) {
    schedule.push({ id: `o${i}`, lane: i % 5, kind: 'coin', arriveAt: 1000 + i * 1000 });
  }
  const g = newGame(players, schedule);
  // mover decides each player's lane before the next arrival
  for (let i = 0; i < 6; i++) {
    for (const p of players) {
      const lane = mover(p, i);
      if (lane != null) g.handleAction(p, { type: 'move', lane });
    }
    advance(1000);
  }
  advance(60000); // ensure end
  return g;
}

for (const N of [2, 3, 4]) {
  test(`full ${N}-player game reaches finished; results length ${N}; placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd', 'e'].slice(0, N);
    // player 'a' parks in lane 0 (catches o0 & o5), others scatter to mostly miss
    const g = playFullGame(players, (p, i) => (p === 'a' ? 0 : 4 - (i % 2)));
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
    // placements monotonic non-decreasing
    for (let i = 1; i < res.length; i++) assert(res[i].placement >= res[i - 1].placement, 'placements ordered');
  });
}

test('tie shares a placement — two players catch identically', () => {
  // both a and b sit in lane 0 the whole time => identical scores
  const schedule = [
    { id: 'o0', lane: 0, kind: 'coin', arriveAt: 1000 },
    { id: 'o1', lane: 0, kind: 'gem', arriveAt: 2000 },
  ];
  const g = newGame(['a', 'b', 'c'], schedule);
  g.handleAction('a', { type: 'move', lane: 0 });
  g.handleAction('b', { type: 'move', lane: 0 });
  g.handleAction('c', { type: 'move', lane: 3 });
  advance(60000);
  eq(g.state, 'finished');
  const res = g.getResults();
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  eq(a.placement, 1);
  eq(b.placement, 1); // tie shares placement 1
  const c = res.find((r) => r.playerId === 'c');
  eq(c.placement, 3); // after the two tied at 1
});

test('removePlayer mid-play advances cleanly; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c'], sched(
    { id: 'o0', lane: 2, kind: 'coin', arriveAt: 1000 },
    { id: 'o1', lane: 2, kind: 'coin', arriveAt: 2000 },
  ));
  advance(1000); // all at lane 2 catch o0
  eq(g.scores['a'], 10);
  g.removePlayer('b'); // b leaves mid-game
  assert(!g.players.includes('b'), 'b pruned from players');
  advance(60000);
  eq(g.state, 'finished');
  const res = g.getResults();
  assert(!res.some((r) => r.playerId === 'b'), 'leaver not ranked');
  assert(res.length === 2, 'two players remain');
});

test('collapse to one finishes immediately', () => {
  const g = newGame(['a', 'b'], sched({ id: 'o0', lane: 2, kind: 'coin', arriveAt: 1000 }));
  g.removePlayer('b');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

test('destroy clears all timers', () => {
  const g = newGame(['a', 'b'], sched(
    { id: 'o0', lane: 0, kind: 'coin', arriveAt: 1000 },
    { id: 'o1', lane: 1, kind: 'gem', arriveAt: 2000 },
    { id: 'o2', lane: 2, kind: 'bomb', arriveAt: 3000 },
  ));
  assert(pendingTimers() > 0, 'timers armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('getStateForPlayer never leaks a final catch CLAIM — only myLastCatch resolved server-side', () => {
  const g = newGame(['a'], sched({ id: 'o0', lane: 2, kind: 'gem', arriveAt: 1000 }));
  let s = g.getStateForPlayer('a');
  eq(s.myLastCatch, null); // nothing caught yet
  advance(1000);
  s = g.getStateForPlayer('a');
  assert(s.myLastCatch && s.myLastCatch.kind === 'gem', 'last catch reflects server resolution');
  eq(s.myScore, 25);
});

uninstallClock();
report('CoinCascade');
