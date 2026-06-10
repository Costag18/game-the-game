import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { TargetLocked } from '../src/games/TargetLocked.js';

installClock();

function newGame(players) {
  const g = new TargetLocked(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force a deterministic round (override the random deal/target) for evaluator tests.
function rigRound(g, numbers, target) {
  g.numbers = [...numbers];
  g.target = target;
}

// ---------- safe evaluator ----------

test('evaluator accepts a known-valid expression with correct value', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [3, 4, 5, 6, 25, 50], 100);
  const r = g._evaluateExpression('(3+5)*6+50'); // 8*6=48 +50 = 98
  assert(r, 'valid expr accepted');
  eq(r.value, 98);
});

test('evaluator respects operator precedence and parentheses', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [2, 3, 4, 5, 25, 50], 200);
  eq(g._evaluateExpression('2+3*4').value, 14);     // precedence
  eq(g._evaluateExpression('(2+3)*4').value, 20);   // parens override
  eq(g._evaluateExpression('50*4').value, 200);
});

test('evaluator rejects bad characters (letters, ^, %, decimal)', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [3, 4, 5, 6, 25, 50], 100);
  eq(g._evaluateExpression('3+a'), null);
  eq(g._evaluateExpression('3^4'), null);
  eq(g._evaluateExpression('50%4'), null);
  eq(g._evaluateExpression('3.5+4'), null);
  eq(g._evaluateExpression('foo(1)'), null); // function-call syntax rejected
});

test('evaluator rejects numbers not dealt or used too many times', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [3, 4, 5, 6, 25, 50], 100);
  eq(g._evaluateExpression('3+99'), null);   // 99 not dealt
  eq(g._evaluateExpression('3+3+4'), null);  // 3 used twice, dealt once
  assert(g._evaluateExpression('3+4').value === 7, 'each-once is fine');
});

test('evaluator allows a dealt duplicate to be used twice', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [5, 5, 4, 6, 25, 50], 100);
  assert(g._evaluateExpression('5+5').value === 10, 'duplicate dealt → usable twice');
  eq(g._evaluateExpression('5+5+5'), null); // but not three times
});

test('evaluator rejects fractional/non-positive intermediates', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [3, 4, 5, 7, 25, 50], 100);
  eq(g._evaluateExpression('7/4'), null);     // remainder
  eq(g._evaluateExpression('3-5'), null);     // negative intermediate
  eq(g._evaluateExpression('25/50'), null);   // 0.5
  assert(g._evaluateExpression('50/25').value === 2, 'exact division ok');
});

test('evaluator rejects malformed expressions', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [3, 4, 5, 6, 25, 50], 100);
  eq(g._evaluateExpression('3+'), null);
  eq(g._evaluateExpression('(3+4'), null);
  eq(g._evaluateExpression('3+4)'), null);
  eq(g._evaluateExpression('*3'), null);
  eq(g._evaluateExpression(''), null);
  eq(g._evaluateExpression('()'), null);
});

// ---------- scoring math ----------

test('closeness scoring tiers', () => {
  eq(TargetLocked.scoreDistance(0), 1000);
  eq(TargetLocked.scoreDistance(3), 700);
  eq(TargetLocked.scoreDistance(5), 700);
  eq(TargetLocked.scoreDistance(8), 500);
  eq(TargetLocked.scoreDistance(10), 500);
  eq(TargetLocked.scoreDistance(11), 300 - 11);   // 289
  eq(TargetLocked.scoreDistance(250), 50);
  eq(TargetLocked.scoreDistance(400), 0);          // floor
});

test('only the best (closest) submission per player counts', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [3, 4, 5, 6, 25, 50], 100);
  g.handleAction('a', { type: 'submit', expr: '50+25' });   // 75 → dist 25
  eq(g.best['a'].distance, 25);
  g.handleAction('a', { type: 'submit', expr: '(3+4)*6+50' }); // 92 → dist 8
  eq(g.best['a'].distance, 8);
  g.handleAction('a', { type: 'submit', expr: '50+25+4' });  // 79 → dist 21, worse → ignored
  eq(g.best['a'].distance, 8);
});

test('invalid submissions never score (stay a miss)', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [3, 4, 5, 6, 25, 50], 100);
  g.handleAction('a', { type: 'submit', expr: '3+999' }); // not dealt
  eq(g.best['a'], undefined);
  g.handleAction('a', { type: 'submit', expr: 'abc' });
  eq(g.best['a'], undefined);
});

// ---------- barrier / timers ----------

test('round timeout advances to reveal and broadcasts', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'round');
  const before = g.emitCount;
  advance(45_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on round timeout');
});

test('reveal timeout auto-acks, advances and broadcasts', () => {
  const g = newGame(['a', 'b']);
  advance(45_000); // → reveal
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(8_000);
  assert(g.state === 'round' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('reveal advances early when all players acknowledge', () => {
  const g = newGame(['a', 'b', 'c']);
  advance(45_000); // → reveal
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  eq(g.state, 'reveal'); // not all acked yet
  g.handleAction('c', { type: 'acknowledge' });
  assert(g.state === 'round' || g.state === 'finished', 'all-acked advanced');
});

test('round points are banked into cumulative score at reveal', () => {
  const g = newGame(['a', 'b']);
  rigRound(g, [3, 4, 5, 6, 25, 50], 100);
  g.handleAction('a', { type: 'submit', expr: '(3+4)*6+50' }); // 92 → dist 8 → 500
  advance(45_000); // → reveal banks
  eq(g.scores['a'], 500);
  eq(g.scores['b'], 0);
});

// ---------- full games ----------

function playFullGame(players) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'round') {
      // first player submits a single dealt number (always valid); rest do nothing
      const p0 = g.players[0];
      g.handleAction(p0, { type: 'submit', expr: String(g.numbers[0]) });
      advance(45_000); // timeout → reveal
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const n of [2, 3, 4]) {
  test(`full ${n}-player game reaches finished with N results, placement 1 first`, () => {
    const ids = ['a', 'b', 'c', 'd'].slice(0, n);
    const g = playFullGame(ids);
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, n);
  });
}

test('a tie shares a placement', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'round') {
      // nobody submits → all score 0 → all tie
      advance(45_000);
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
});

// ---------- leave / teardown ----------

test('removePlayer mid-round prunes leaver and keeps going (no deadlock)', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'round');
  g.removePlayer('b');
  assert(!g.players.includes('b'), 'leaver pruned');
  eq(g.state, 'round'); // still playing with a + c
  advance(45_000);
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver not ranked');
});

test('removePlayer during reveal re-checks the ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  advance(45_000); // → reveal
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('c', { type: 'acknowledge' });
  eq(g.state, 'reveal'); // waiting on b
  g.removePlayer('b');   // b gone → barrier satisfied
  assert(g.state === 'round' || g.state === 'finished', 'advanced after leaver removed');
});

test('collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('getStateForPlayer never leaks a solution during play', () => {
  const g = newGame(['a', 'b']);
  const s = g.getStateForPlayer('a');
  eq(s.phase, 'round');
  assert(Array.isArray(s.numbers) && s.numbers.length === 6, 'numbers sent');
  assert(typeof s.target === 'number', 'target sent');
  assert(s.reveal === null, 'no reveal/solution during round');
  assert(!('bestPossible' in s), 'best-possible not exposed mid-round');
});

uninstallClock();
report('TargetLocked');
