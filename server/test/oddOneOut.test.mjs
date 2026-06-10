import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { OddOneOut } from '../src/games/OddOneOut.js';

installClock();

function newGame(players) {
  const g = new OddOneOut(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const odd = (g) => g.round.oddIndex;
const wrongIdx = (g) => (g.round.oddIndex === 0 ? 1 : 0);

test('starts in question phase with 4 items and an answer timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'question');
  const s = g.getStateForPlayer('a');
  eq(s.phase, 'question');
  eq(s.items.length, 4);
  eq(s.qNumber, 1);
  eq(s.total, 6);
  assert(pendingTimers() >= 1, 'answer timer armed');
});

test('answer key (oddIndex/rule) is NOT in question-phase state but IS in reveal', () => {
  const g = newGame(['a', 'b']);
  const sQ = g.getStateForPlayer('a');
  eq(sQ.oddIndex, null);
  eq(sQ.rule, null);
  assert(!JSON.stringify(sQ).includes(g.round.rule), 'rule not leaked in question');
  // both answer -> reveal
  g.handleAction('a', { type: 'tap', index: odd(g) });
  g.handleAction('b', { type: 'tap', index: odd(g) });
  eq(g.state, 'reveal');
  const sR = g.getStateForPlayer('a');
  eq(sR.oddIndex, g.round.oddIndex);
  eq(sR.rule, g.round.rule);
  assert(JSON.stringify(sR).includes(g.round.rule), 'rule present in reveal');
});

test('a correct tap scores, a wrong tap scores 0 and locks out', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'tap', index: odd(g) });   // correct, rank 0 -> 800
  g.handleAction('b', { type: 'tap', index: wrongIdx(g) }); // wrong -> 0
  eq(g.scores['a'], 800);
  eq(g.scores['b'], 0);
  // b is locked out: a second tap (even correct) is ignored
  g.handleAction('b', { type: 'tap', index: odd(g) });
  eq(g.scores['b'], 0);
});

test('speed ordering: k-th correct tapper gets max(200, 800 - k*100)', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const o = odd(g);
  g.handleAction('a', { type: 'tap', index: o }); // rank 0 -> 800
  g.handleAction('b', { type: 'tap', index: o }); // rank 1 -> 700
  g.handleAction('c', { type: 'tap', index: o }); // rank 2 -> 600
  g.handleAction('d', { type: 'tap', index: o }); // rank 3 -> 500
  eq(g.scores['a'], 800);
  eq(g.scores['b'], 700);
  eq(g.scores['c'], 600);
  eq(g.scores['d'], 500);
  eq(g.state, 'reveal'); // all answered -> reveal
});

test('points floor at 200 for many correct tappers', () => {
  const g = newGame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  const o = odd(g);
  for (const p of g.players) g.handleAction(p, { type: 'tap', index: o });
  // ranks 0..7 -> 800,700,600,500,400,300,200,200 (clamped)
  eq(g.scores['g'], 200); // rank 6 -> 200
  eq(g.scores['h'], 200); // rank 7 -> clamped to 200
});

test('all-answered advances to reveal immediately', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'tap', index: wrongIdx(g) });
  g.handleAction('b', { type: 'tap', index: wrongIdx(g) });
  eq(g.state, 'question');
  g.handleAction('c', { type: 'tap', index: odd(g) });
  eq(g.state, 'reveal');
});

test('answer timer auto-advances to reveal and broadcasts', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'tap', index: odd(g) });
  const before = g.emitCount;
  advance(15_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on answer timeout');
});

test('reveal auto-advances to the next question after the reveal timer', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'tap', index: odd(g) });
  g.handleAction('b', { type: 'tap', index: odd(g) });
  eq(g.state, 'reveal');
  const beforeQ = g.qIndex;
  advance(6_000);
  eq(g.state, 'question');
  eq(g.qIndex, beforeQ + 1);
});

function runFullGame(players, tapper) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 60) {
    if (g.state === 'question') {
      for (const p of g.players) tapper(g, p);
      advance(15_000); // flush any unanswered + safety
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      advance(6_000);
    }
  }
  return g;
}

for (const n of [2, 3, 4]) {
  test(`full game with ${n} players finishes; results length ${n}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, n);
    // a always taps correct first, others tap wrong -> a wins
    const g = runFullGame(players, (g, p) => {
      g.handleAction(p, { type: 'tap', index: p === 'a' ? odd(g) : wrongIdx(g) });
    });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'a');
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, n);
  });
}

test('a tie shares a placement', () => {
  // everyone taps correct in the same order each round -> by symmetry not equal,
  // so instead: everyone taps WRONG every round -> all score 0 -> all tie.
  const g = runFullGame(['a', 'b', 'c'], (g, p) => {
    g.handleAction(p, { type: 'tap', index: wrongIdx(g) });
  });
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
  eq(res.every((r) => r.score === 0), true);
});

test('removePlayer mid-question advances (no deadlock) and prunes leaver from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'tap', index: odd(g) });
  g.handleAction('b', { type: 'tap', index: wrongIdx(g) });
  eq(g.state, 'question'); // waiting on c
  g.removePlayer('c');     // c was the last owed -> should advance
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
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

uninstallClock();
report('OddOneOut');
