import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Mastermind } from '../src/games/Mastermind.js';

installClock();

function newGame(players, code) {
  const g = new Mastermind(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  if (code) g.secretCode = code;
  return g;
}
const guess = (g, p, pegs) => g.handleAction(p, { type: 'guess', pegs });

test('starts playing with a round timer; secret never leaks pre-reveal', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  eq(g.state, 'playing');
  assert(pendingTimers() >= 1, 'cutoff timer armed');
  eq(g.getStateForPlayer('a').secretCode, null, 'secret hidden in playing');
});

test('feedback: exact solve, all-white, and duplicate handling', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  guess(g, 'a', ['R', 'R', 'G', 'B']); // exact
  let row = g.boards['a'].guesses.at(-1);
  eq(row.black, 4); eq(row.white, 0);
  eq(g.boards['a'].solved, true);

  const g2 = newGame(['c', 'd'], ['R', 'R', 'G', 'B']);
  guess(g2, 'c', ['G', 'B', 'R', 'R']); // all present, none placed
  row = g2.boards['c'].guesses.at(-1);
  eq(row.black, 0); eq(row.white, 4);

  const g3 = newGame(['e', 'f'], ['R', 'R', 'G', 'B']);
  guess(g3, 'e', ['R', 'G', 'G', 'G']); // one R black, one G black, extra G not double-counted
  row = g3.boards['e'].guesses.at(-1);
  eq(row.black, 2); eq(row.white, 0);
});

test('invalid guesses are rejected (bad length, bad color)', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  guess(g, 'a', ['R', 'G', 'B']);      // too short
  guess(g, 'a', ['R', 'G', 'B', 'Z']); // bad color
  eq(g.boards['a'].guessCount, 0);
});

test('10-guess cap: an 11th guess is a no-op and player is done', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  for (let i = 0; i < 11; i++) guess(g, 'a', ['O', 'O', 'O', 'O']);
  eq(g.boards['a'].guessCount, 10);
  assert(g.done.has('a'), 'a is out of guesses');
});

test('both solving ends the round; fewer guesses ranks first', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  guess(g, 'a', ['O', 'O', 'O', 'O']); // a: 1 wrong then solve = 2 guesses
  guess(g, 'a', ['R', 'R', 'G', 'B']);
  guess(g, 'b', ['R', 'R', 'G', 'B']); // b: solves in 1
  eq(g.state, 'reveal');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'b').placement, 1, 'fewer guesses first');
  eq(res.find((r) => r.playerId === 'a').placement, 2);
});

test('secret revealed and results present at reveal', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  guess(g, 'a', ['R', 'R', 'G', 'B']);
  guess(g, 'b', ['R', 'R', 'G', 'B']);
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  eq(JSON.stringify(s.secretCode), JSON.stringify(['R', 'R', 'G', 'B']));
  assert(Array.isArray(s.results), 'results present');
});

test('hidden info: opponents expose only solved + guessCount (no pegs/feedback)', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  guess(g, 'a', ['O', 'O', 'O', 'O']);
  const opp = g.getStateForPlayer('b').opponents.find((o) => o.playerId === 'a');
  eq(Object.keys(opp).sort().join(','), 'guessCount,playerId,solved');
  assert(!('pegs' in opp) && !('black' in opp) && !('bestBlack' in opp), 'no board leaked');
});

test('cutoff timer ends the round, scoring best progress; ranks all N', () => {
  for (const n of [2, 3, 5, 8]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players, ['R', 'R', 'G', 'B']);
    guess(g, 'p0', ['R', 'R', 'O', 'O']); // 2 black
    advance(120_000);
    eq(g.state, 'reveal');
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].playerId, 'p0', 'best progress first');
    res.forEach((e) => assert(typeof e.placement === 'number'));
  }
});

test('all-AFK / no solvers with equal progress all tie at placement 1', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  advance(120_000);
  const res = g.getResults();
  eq(res[0].placement, 1);
  eq(res[1].placement, 1);
});

test('reveal auto-ack advances to finished after 10s', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  guess(g, 'a', ['R', 'R', 'G', 'B']);
  guess(g, 'b', ['R', 'R', 'G', 'B']);
  eq(g.state, 'reveal');
  advance(10_000);
  eq(g.state, 'finished');
  eq(g.isComplete(), true);
});

test('leave of the last still-guessing player ends the round', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  guess(g, 'b', ['R', 'R', 'G', 'B']); // b done (solved)
  g.removePlayer('a'); // the only still-guessing player leaves
  assert(g.state === 'reveal' || g.state === 'finished', `ended (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver pruned');
});

test('leaving down to one finishes and clears timers', () => {
  const g = newGame(['a', 'b', 'c'], ['R', 'R', 'G', 'B']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b'], ['R', 'R', 'G', 'B']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('Mastermind');
