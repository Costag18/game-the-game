import { installClock, uninstallClock, advance, fireNext, setNow, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { ReactionTap } from '../src/games/ReactionTap.js';

installClock();

// Drive one full round. `taps` = { playerId: reactionMs }. Missing players don't tap.
function playRound(game, taps) {
  assert(game.state === 'arming', `expected arming, got ${game.state}`);
  fireNext(); // arm timer -> GO
  assert(game.state === 'go', `expected go after arm timer, got ${game.state}`);
  const goTime = game.goTime;
  for (const [pid, ms] of Object.entries(taps)) {
    setNow(goTime + ms);
    game.handleAction(pid, { type: 'tap' });
  }
  if (game.state === 'go') fireNext(); // cutoff -> roundEnd (non-tappers MISS)
  // acknowledge everyone present to advance
  for (const p of [...game.players]) game.handleAction(p, { type: 'acknowledge' });
}

function newGame(players) {
  const g = new ReactionTap(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in arming with the GO timer armed', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'arming');
  eq(g.round, 1);
  assert(pendingTimers() >= 1, 'arm timer should be pending');
});

test('arm timer fires GO, sets goTime, and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  fireNext();
  eq(g.state, 'go');
  assert(typeof g.goTime === 'number' && g.goTime > 0, 'goTime set');
  assert(g.emitCount > before, '_emitChange fired on GO');
});

test('valid tap records reaction ms; second tap same round ignored', () => {
  const g = newGame(['a', 'b']);
  fireNext();
  const goTime = g.goTime;
  setNow(goTime + 250);
  g.handleAction('a', { type: 'tap' });
  eq(g.results['a'].ms, 250);
  eq(g.results['a'].foul, false);
  setNow(goTime + 999);
  g.handleAction('a', { type: 'tap' }); // ignored
  eq(g.results['a'].ms, 250);
});

test('tap during arming is a FOUL, state stays arming, second foul ignored', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'arming');
  g.handleAction('a', { type: 'tap' });
  eq(g.state, 'arming');
  eq(g.results['a'].foul, true);
  eq(g.results['a'].ms, 3000);
  g.handleAction('a', { type: 'tap' });
  eq(g.results['a'].ms, 3000);
});

test('cutoff maxes non-tappers as MISSED and broadcasts', () => {
  const g = newGame(['a', 'b']);
  fireNext();
  const goTime = g.goTime;
  setNow(goTime + 200);
  g.handleAction('a', { type: 'tap' });
  const before = g.emitCount;
  fireNext(); // cutoff
  eq(g.state, 'roundEnd');
  eq(g.results['b'].missed, true);
  eq(g.results['b'].ms, 3000);
  assert(g.emitCount > before, '_emitChange fired at cutoff');
});

test('all tapping ends the round early without the cutoff', () => {
  const g = newGame(['a', 'b']);
  fireNext();
  const goTime = g.goTime;
  setNow(goTime + 100); g.handleAction('a', { type: 'tap' });
  setNow(goTime + 150); g.handleAction('b', { type: 'tap' });
  eq(g.state, 'roundEnd'); // resolved immediately
});

test('ranks all N players after 5 rounds, fastest first, completes', () => {
  for (const n of [2, 3, 5, 8]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    for (let r = 0; r < 5; r++) {
      const taps = {};
      players.forEach((p, i) => { taps[p] = 100 + i * 50; }); // p0 fastest
      playRound(g, taps);
    }
    eq(g.isComplete(), true, `n=${n} complete`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'p0', `n=${n} fastest is p0`);
    res.forEach((e) => assert(typeof e.placement === 'number' && typeof e.totalMs === 'number', 'shape'));
    // ascending placement vs totalMs
    for (let i = 1; i < res.length; i++) assert(res[i].totalMs >= res[i - 1].totalMs, 'ascending totals');
  }
});

test('identical totals share a placement (dense ranking)', () => {
  const players = ['a', 'b', 'c'];
  const g = newGame(players);
  for (let r = 0; r < 5; r++) {
    // a and b identical, c slower
    playRound(g, { a: 200, b: 200, c: 400 });
  }
  const res = g.getResults();
  const a = res.find((e) => e.playerId === 'a');
  const b = res.find((e) => e.playerId === 'b');
  const c = res.find((e) => e.playerId === 'c');
  eq(a.placement, 1);
  eq(b.placement, 1);
  eq(c.placement, 3); // dense ranking on value
});

test('getStateForPlayer hides armDelay and opponents ms pre-reveal', () => {
  const g = newGame(['a', 'b']);
  let s = g.getStateForPlayer('a');
  assert(!('armDelayMs' in s), 'no armDelayMs leaked');
  assert(s.otherPlayers.every((o) => o.ms === null), 'opponent ms hidden in arming');
  fireNext(); // go
  const goTime = g.goTime;
  setNow(goTime + 100); g.handleAction('a', { type: 'tap' });
  s = g.getStateForPlayer('b');
  assert(s.otherPlayers.find((o) => o.playerId === 'a').ms === null, 'opponent ms hidden in go');
});

test('leave in go (last non-tapper) resolves the round; leaver pruned from results', () => {
  const g = newGame(['a', 'b']);
  fireNext();
  const goTime = g.goTime;
  setNow(goTime + 120); g.handleAction('a', { type: 'tap' });
  g.removePlayer('b'); // the only non-tapper leaves
  assert(!g.players.includes('b'), 'b pruned');
  // a remains; <=1 player -> finished per spec
  eq(g.state, 'finished');
  const res = g.getResults();
  assert(!res.some((e) => e.playerId === 'b'), 'leaver absent from results');
});

test('down to one player finishes and clears all timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('destroy clears timers and stops broadcasts', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
  const before = g.emitCount;
  g._emitChange && g._emitChange();
  eq(g.emitCount, before, 'no broadcast after destroy');
});

test('endRound is idempotent (one history entry, totals added once)', () => {
  const g = newGame(['a', 'b']);
  fireNext();
  const goTime = g.goTime;
  setNow(goTime + 100); g.handleAction('a', { type: 'tap' });
  setNow(goTime + 110); g.handleAction('b', { type: 'tap' });
  eq(g.state, 'roundEnd');
  const total = g.totals['a'];
  g._endRound(); // stray call — guarded
  eq(g.totals['a'], total, 'totals not double-counted');
  eq(g.roundHistory.length, 1, 'one history entry');
});

uninstallClock();
report('ReactionTap');
