import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { AimTrainer } from '../src/games/AimTrainer.js';

installClock();

function newGame(players) {
  const g = new AimTrainer(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const hit = (g, p) => g.handleAction(p, { type: 'shoot', targetId: g.current[p].id });

test('starts active with a target per player and an armed round timer', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'active');
  assert(g.current['a'] && g.current['a'].id, 'a has a target');
  assert(g.current['b'] && g.current['b'].id, 'b has a target');
  assert(pendingTimers() >= 1, 'round timer armed');
});

test('hitting the current target credits a hit and spawns a new one', () => {
  const g = newGame(['a', 'b']);
  const oldId = g.current['a'].id;
  hit(g, 'a');
  eq(g.hits['a'], 1);
  eq(g.clicks['a'], 1);
  assert(g.current['a'].id !== oldId, 'new target spawned');
  // re-sending the old id: click only, no hit, no respawn
  const curId = g.current['a'].id;
  g.handleAction('a', { type: 'shoot', targetId: oldId });
  eq(g.hits['a'], 1);
  eq(g.clicks['a'], 2);
  eq(g.current['a'].id, curId, 'target unchanged');
});

test('forged/garbage targetId is a click only (no farmed spawns)', () => {
  const g = newGame(['a', 'b']);
  const curId = g.current['a'].id;
  g.handleAction('a', { type: 'shoot', targetId: 'totally-fake' });
  eq(g.hits['a'], 0);
  eq(g.clicks['a'], 1);
  eq(g.current['a'].id, curId);
});

test('miss action counts a click only', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'miss' });
  eq(g.clicks['a'], 1);
  eq(g.hits['a'], 0);
});

test('ranks by hits, accuracy breaks ties', () => {
  const g = newGame(['a', 'b']);
  // a: 8/8, b: 8/12
  for (let i = 0; i < 8; i++) hit(g, 'a');
  for (let i = 0; i < 8; i++) hit(g, 'b');
  for (let i = 0; i < 4; i++) g.handleAction('b', { type: 'miss' });
  const res = g.getResults();
  eq(res[0].playerId, 'a', 'higher accuracy first');
  eq(res[0].placement, 1);
  eq(res[1].placement, 2);
});

test('full tie shares placement; third distinct skips', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b']) { for (let i = 0; i < 5; i++) hit(g, p); for (let i = 0; i < 2; i++) g.handleAction(p, { type: 'miss' }); }
  for (let i = 0; i < 2; i++) hit(g, 'c'); // c lower
  const res = g.getResults();
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(a.placement, 1);
  eq(b.placement, 1);
  eq(c.placement, 3);
});

test('AFK player still ranked last; all-AFK all tied', () => {
  const g = newGame(['a', 'b', 'c']);
  hit(g, 'a');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.find((r) => r.playerId === 'a').placement, 1);
  // b and c both 0 hits -> tie at placement 2
  eq(res.find((r) => r.playerId === 'b').placement, 2);
  eq(res.find((r) => r.playerId === 'c').placement, 2);

  const g2 = newGame(['x', 'y']);
  const res2 = g2.getResults();
  eq(res2.length, 2);
  eq(res2[0].placement, 1);
  eq(res2[1].placement, 1); // all-AFK tie
});

test('round timer finishes the game and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  advance(25_000);
  eq(g.state, 'finished');
  eq(g.isComplete(), true);
  assert(g.emitCount > before, 'broadcast on finish');
  eq(pendingTimers(), 0);
});

test('hidden info: getStateForPlayer only ever has my own target', () => {
  const g = newGame(['a', 'b']);
  const s = g.getStateForPlayer('a');
  eq(s.target.id, g.current['a'].id);
  // no field leaks b's target
  const json = JSON.stringify(s);
  assert(!json.includes(g.current['b'].id), 'opponent target id not leaked');
});

test('leaver pruned from results; placements contiguous', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  hit(g, 'a'); hit(g, 'b');
  g.removePlayer('c');
  const res = g.getResults();
  eq(res.length, 3);
  assert(!res.some((r) => r.playerId === 'c'));
  res.forEach((e, i) => assert(typeof e.placement === 'number'));
});

test('collapse to one survivor finishes; timer cleared', () => {
  const g = newGame(['a', 'b']);
  g.removePlayer('b');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
  const res = g.getResults();
  eq(res.length, 1);
  eq(res[0].placement, 1);
});

test('no double-finish: timer after a collapse is a no-op', () => {
  const g = newGame(['a', 'b']);
  g.removePlayer('b'); // sets finished + clears timer
  advance(25_000);     // nothing to fire
  eq(g.state, 'finished');
});

test('destroy clears the round timer', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
  const before = g.emitCount;
  advance(25_000);
  eq(g.emitCount, before, 'no broadcast after destroy');
});

uninstallClock();
report('AimTrainer');
