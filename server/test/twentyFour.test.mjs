import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import {
  TwentyFour,
  evaluateExpression,
  isValidSolution,
  findSolution,
  generateDeal,
} from '../src/games/TwentyFour.js';

installClock();

function newGame(players) {
  const g = new TwentyFour(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// ---------------------------------------------------------------------------
// SAFE EVALUATOR
// ---------------------------------------------------------------------------
test('evaluator: arithmetic, precedence, and parentheses', () => {
  eq(evaluateExpression('2+3').value, 5);
  eq(evaluateExpression('2+3*4').value, 14);          // precedence
  eq(evaluateExpression('(2+3)*4').value, 20);        // parens
  eq(evaluateExpression('10-2-3').value, 5);          // left-assoc
  eq(evaluateExpression('12/4/3').value, 1);          // left-assoc div
  eq(evaluateExpression('  6 * ( 1 + 3 ) ').value, 24); // whitespace ok
});

test('evaluator: rejects illegal characters and malformed input', () => {
  eq(evaluateExpression('2^3'), null);     // ^ not allowed
  eq(evaluateExpression('2%3'), null);     // % not allowed
  eq(evaluateExpression('a+b'), null);     // letters
  eq(evaluateExpression('abc(1)'), null);  // letters / function-like
  eq(evaluateExpression('2.5+1'), null);   // decimal point not a token
  eq(evaluateExpression('2++3'), null);    // double operator
  eq(evaluateExpression('(2+3'), null);    // unbalanced
  eq(evaluateExpression('2+3)'), null);    // unbalanced
  eq(evaluateExpression(''), null);        // empty
  eq(evaluateExpression('2 3'), null);     // two numbers, no operator
  eq(evaluateExpression('5/0'), null);     // divide by zero
});

test('isValidSolution: accepts a known-good 24 with exactly the dealt numbers', () => {
  // 4,6,1,1 -> 6*4*1*1 = 24
  assert(isValidSolution('6*4*1*1', [4, 6, 1, 1]), 'valid solve accepted');
  // wrong literal count (only 3 numbers used) must be rejected
  assert(isValidSolution('(3+3)*4', [3, 3, 4, 1]) === false, 'wrong literal count rejected');
});

test('isValidSolution: rejects wrong-numbers, not-24, and bad-char submissions', () => {
  const nums = [8, 3, 8, 3];               // 8/(3-8/3) = 24 is a classic
  assert(isValidSolution('8/(3-8/3)', nums), 'classic 8338 solve accepted');
  // uses a 9 not dealt
  assert(!isValidSolution('8/(3-9/3)', nums), 'undealt number rejected');
  // uses an 8 too many times (only two 8s dealt)
  assert(!isValidSolution('8*8*8/(8+8)', nums), 'overused number rejected');
  // valid numbers but not equal to 24
  assert(!isValidSolution('8+3+8+3', nums), 'wrong value rejected');
  // illegal char
  assert(!isValidSolution('8^3+8+3', nums), 'illegal char rejected');
});

test('generateDeal/findSolution: every generated deal is actually solvable', () => {
  for (let i = 0; i < 50; i++) {
    const d = generateDeal();
    eq(d.numbers.length, 4);
    assert(d.numbers.every((n) => n >= 1 && n <= 9), 'integers 1..9');
    assert(isValidSolution(d.solution, d.numbers), `provided solution makes 24 (${d.numbers} -> ${d.solution})`);
    // and findSolution agrees it is solvable
    assert(findSolution(d.numbers) !== null, 'findSolution confirms solvable');
  }
});

// ---------------------------------------------------------------------------
// SPEED SCORING
// ---------------------------------------------------------------------------
test('speed scoring: k-th valid solver scores max(200, 1000 - k*250)', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  eq(g.state, 'deal');
  const sol = g._deal.solution;
  g.handleAction('a', { type: 'submit', expression: sol }); // rank 0
  g.handleAction('b', { type: 'submit', expression: sol }); // rank 1
  g.handleAction('c', { type: 'submit', expression: sol }); // rank 2
  g.handleAction('d', { type: 'submit', expression: sol }); // rank 3
  eq(g.scores['a'], 1000);
  eq(g.scores['b'], 750);
  eq(g.scores['c'], 500);
  eq(g.scores['d'], 250);
});

test('floor at 200 for slow solvers (rank >= 4)', () => {
  // 6 players: ranks 0..5 -> 1000,750,500,250, then floor 200,200
  const g = newGame(['a', 'b', 'c', 'd', 'e', 'f']);
  const sol = g._deal.solution;
  for (const p of ['a', 'b', 'c', 'd', 'e', 'f']) g.handleAction(p, { type: 'submit', expression: sol });
  eq(g.scores['e'], 200);
  eq(g.scores['f'], 200);
});

test('invalid submissions do NOT lock you out; you can retry and still score', () => {
  const g = newGame(['a', 'b']);
  const sol = g._deal.solution;
  g.handleAction('a', { type: 'submit', expression: '2^3' });        // bad char
  eq(g.getStateForPlayer('a').myReject, 'bad');
  g.handleAction('a', { type: 'submit', expression: '9+9+9+9' });    // wrong numbers (likely)
  // a still hasn't solved
  eq(g.solves['a'], undefined);
  g.handleAction('a', { type: 'submit', expression: sol });          // finally correct
  eq(g.scores['a'], 1000);
  // and a second correct submit is ignored (one solve per deal)
  g.handleAction('a', { type: 'submit', expression: sol });
  eq(g.scores['a'], 1000);
});

test('reject reasons are reported privately and never leak the example solution', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submit', expression: '1+1+1+1' }); // wrong value (or numbers)
  const s = g.getStateForPlayer('a');
  assert(s.myReject !== null, 'reject reason set');
  assert(s.reveal === null, 'no reveal during deal');
  // solution string is not present anywhere in the deal-phase payload
  assert(!('solution' in s), 'no solution key during deal');
});

// ---------------------------------------------------------------------------
// BARRIER / TIMERS
// ---------------------------------------------------------------------------
test('barrier advances to reveal when ALL players have solved', () => {
  const g = newGame(['a', 'b']);
  const sol = g._deal.solution;
  g.handleAction('a', { type: 'submit', expression: sol });
  eq(g.state, 'deal');
  g.handleAction('b', { type: 'submit', expression: sol });
  eq(g.state, 'reveal');
});

test('deal timer fires reveal on timeout and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  advance(45_000); // DEAL_MS
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on deal timeout');
  // reveal exposes the example solution + numbers now
  const s = g.getStateForPlayer('a');
  assert(s.reveal && s.reveal.solution, 'solution revealed at deal end');
  assert(isValidSolution(s.reveal.solution, s.reveal.numbers), 'revealed solution is valid');
});

test('reveal timer auto-acks and advances to next deal / finished', () => {
  const g = newGame(['a', 'b']);
  const sol = g._deal.solution;
  g.handleAction('a', { type: 'submit', expression: sol });
  g.handleAction('b', { type: 'submit', expression: sol });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(50_000); // REVEAL_MS
  assert(g.state === 'deal' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

// ---------------------------------------------------------------------------
// FULL GAMES + RANKING
// ---------------------------------------------------------------------------
function playFullGame(players, solverFn) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 50) {
    if (g.state === 'deal') {
      const sol = g._deal.solution;
      for (const p of g.players) solverFn(g, p, sol);
      // anyone who didn't solve: time out the deal
      if (g.state === 'deal') advance(45_000);
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const N of [2, 3, 4]) {
  test(`full game with ${N} players finishes; getResults length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    // a always solves first → highest cumulative → placement 1
    const g = playFullGame(players, (game, p, sol) => {
      game.handleAction(p, { type: 'submit', expression: sol });
    });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement', () => {
  // Nobody solves any deal → everyone scores 0 → all tie at placement 1.
  const g = playFullGame(['a', 'b', 'c'], () => { /* submit nothing */ });
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
  eq(res.every((r) => r.score === 0), true);
});

// ---------------------------------------------------------------------------
// LEAVE / TEARDOWN
// ---------------------------------------------------------------------------
test('removePlayer mid-deal advances the barrier (no deadlock)', () => {
  const g = newGame(['a', 'b', 'c']);
  const sol = g._deal.solution;
  g.handleAction('a', { type: 'submit', expression: sol }); // a solved
  g.handleAction('b', { type: 'submit', expression: sol }); // b solved
  eq(g.state, 'deal');
  g.removePlayer('c'); // c was the only one owed → barrier should resolve
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('removePlayer mid-reveal re-checks ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  const sol = g._deal.solution;
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', expression: sol });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  // c hasn't acked; if c leaves, the barrier should resolve
  g.removePlayer('c');
  assert(g.state === 'deal' || g.state === 'finished', `advanced past reveal (got ${g.state})`);
});

uninstallClock();
report('TwentyFour');
