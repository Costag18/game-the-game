import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { FactorFrenzy } from '../src/games/FactorFrenzy.js';

installClock();

function newGame(players) {
  const g = new FactorFrenzy(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// helpers to find a true-divisor cell index and a non-divisor cell index in the live grid
const divisorIdx = (g) => g.grid.findIndex((c) => c.isDivisor);
const nonDivisorIdx = (g) => g.grid.findIndex((c) => !c.isDivisor);

test('starts in a window with a target, a 12-cell grid, and a window timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'window');
  eq(g.windowNumber === undefined, true); // sanity: internal uses windowIndex
  eq(g.grid.length, 12);
  assert(g.target >= 12 && g.target <= 96, 'target in range');
  assert(pendingTimers() >= 1, 'window timer armed');
});

test('SERVER validates divisibility — every grid cell flag matches target % value', () => {
  for (let r = 0; r < 25; r++) {
    const g = newGame(['a', 'b']);
    for (const c of g.grid) {
      eq(c.isDivisor, g.target % c.value === 0, `cell ${c.value} vs target ${g.target}`);
    }
    eq(g.grid.length, 12);
    assert(g.grid.some((c) => c.isDivisor), 'has at least one true divisor');
    assert(g.grid.some((c) => !c.isDivisor), 'has at least one non-divisor');
  }
});

test('tapping a TRUE divisor scores +points; isDivisor key hidden during the window', () => {
  const g = newGame(['a', 'b']);
  const idx = divisorIdx(g);
  g.handleAction('a', { type: 'tap', index: idx });
  eq(g.scores['a'], 100); // first correct, streak 1 -> no bonus
  // state sent to a guesser must NOT leak isDivisor during the window
  const s = g.getStateForPlayer('b');
  eq(s.grid.every((c) => c.isDivisor === null), true);
  // my own tap echoes back to me
  const mine = g.getStateForPlayer('a');
  eq(mine.grid[idx].tappedByMe, true);
  eq(mine.grid[idx].myCorrect, true);
});

test('consecutive correct taps build a streak bonus; a wrong tap breaks it', () => {
  const g = newGame(['a', 'b']);
  const divs = g.grid.map((c, i) => ({ i, d: c.isDivisor })).filter((x) => x.d).map((x) => x.i);
  assert(divs.length >= 3, 'enough divisors to test streak');
  g.handleAction('a', { type: 'tap', index: divs[0] }); // +100 (streak1)
  g.handleAction('a', { type: 'tap', index: divs[1] }); // +125 (streak2: +25)
  g.handleAction('a', { type: 'tap', index: divs[2] }); // +150 (streak3: +50)
  eq(g.scores['a'], 100 + 125 + 150);
  eq(g.streaks['a'], 3);
  const wrong = nonDivisorIdx(g);
  g.handleAction('a', { type: 'tap', index: wrong }); // -50, streak reset
  eq(g.streaks['a'], 0);
  eq(g.scores['a'], 100 + 125 + 150 - 50);
});

test('a wrong tap penalty is clamped so the tap cannot drive score below zero', () => {
  const g = newGame(['a', 'b']);
  const wrong = nonDivisorIdx(g);
  // fresh player has 0 points: penalty clamps to 0, never negative
  g.handleAction('a', { type: 'tap', index: wrong });
  eq(g.scores['a'], 0);
  eq(g.grid[wrong].isDivisor, false);
});

test('rejects invalid taps: out-of-range index and re-tapping the same cell', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'tap', index: 99 });   // out of range
  g.handleAction('a', { type: 'tap', index: -1 });   // out of range
  g.handleAction('a', { type: 'tap', index: 'x' });  // not a number
  eq(Object.keys(g.taps['a']).length, 0);
  const idx = divisorIdx(g);
  g.handleAction('a', { type: 'tap', index: idx });
  const scoreAfterFirst = g.scores['a'];
  g.handleAction('a', { type: 'tap', index: idx });  // re-tap ignored
  eq(g.scores['a'], scoreAfterFirst);
  eq(Object.keys(g.taps['a']).length, 1);
});

test('window resolves early once every player has tapped all 12 cells', () => {
  const g = newGame(['a', 'b']);
  for (const p of ['a', 'b']) {
    for (let i = 0; i < g.grid.length; i++) g.handleAction(p, { type: 'tap', index: i });
  }
  eq(g.state, 'reveal'); // everyone cleared -> advance without waiting for the timer
  // reveal exposes isDivisor for every cell
  eq(g.revealData.cells.length, 12);
  eq(g.revealData.cells.every((c) => typeof c.isDivisor === 'boolean'), true);
});

test('window timeout resolves to reveal and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  advance(7_500);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on window timeout');
  // reveal timeout advances to next window (or finished)
  advance(2_500);
  assert(g.state === 'window' || g.state === 'finished', `advanced from reveal (got ${g.state})`);
});

test('reveal exposes isDivisor; isDivisor hidden in plain window state', () => {
  const g = newGame(['a', 'b']);
  const sWindow = g.getStateForPlayer('a');
  eq(sWindow.grid.every((c) => c.isDivisor === null), true);
  eq(sWindow.reveal, null);
  advance(7_500);
  const sReveal = g.getStateForPlayer('a');
  eq(sReveal.phase, 'reveal');
  eq(sReveal.grid.every((c) => typeof c.isDivisor === 'boolean'), true);
  assert(sReveal.reveal && sReveal.reveal.cells.length === 12, 'reveal payload present');
});

for (const N of [2, 3, 4]) {
  test(`full game with ${N} players reaches finished; getResults length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'window') {
        // each player taps every divisor (and a couple wrong) then we let the timer/clear advance
        for (const p of players) {
          for (let i = 0; i < g.grid.length; i++) {
            if (g.grid[i].isDivisor) g.handleAction(p, { type: 'tap', index: i });
          }
        }
        advance(7_500); // close the window via timer (not everyone cleared every cell)
      } else if (g.state === 'reveal') {
        for (const p of players) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // results contain every player exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('equal scores share a placement (tie handling)', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'window') {
      // everyone taps the SAME cells -> identical scores
      for (const p of g.players) {
        for (let i = 0; i < g.grid.length; i++) {
          if (g.grid[i].isDivisor) g.handleAction(p, { type: 'tap', index: i });
        }
      }
      advance(7_500);
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true); // all identical -> all tie at 1
});

test('removePlayer mid-window does not deadlock: leaver pruned, barrier re-checked', () => {
  const g = newGame(['a', 'b', 'c']);
  // a and b clear the whole grid; c is the only one owing
  for (const p of ['a', 'b']) {
    for (let i = 0; i < g.grid.length; i++) g.handleAction(p, { type: 'tap', index: i });
  }
  eq(g.state, 'window'); // still waiting on c
  g.removePlayer('c');    // c leaves -> a & b have both cleared -> advance
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
  assert(g.taps['c'] === undefined, 'leaver taps pruned');
});

test('removePlayer mid-reveal advances once remaining acks present', () => {
  const g = newGame(['a', 'b', 'c']);
  advance(7_500); // -> reveal
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  eq(g.state, 'reveal'); // still waiting on c
  g.removePlayer('c');    // c leaves -> a & b acked -> advance
  assert(g.state === 'window' || g.state === 'finished', `advanced (got ${g.state})`);
});

test('collapse to one player finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('FactorFrenzy');
