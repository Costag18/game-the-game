import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { CrackTheVault } from '../src/games/CrackTheVault.js';

installClock();

function newGame(players, code) {
  const g = new CrackTheVault(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  if (code) g.secretCode = code;
  return g;
}
const guess = (g, p, digits) => g.handleAction(p, { type: 'guess', digits });

// Drive a player to the actual solution by reading the server's secret code.
function crack(g, p) { guess(g, p, [...g.secretCode]); }

test('generator: 4 distinct digits in 0..9', () => {
  for (let i = 0; i < 200; i++) {
    const g = newGame(['a', 'b']);
    const code = g.secretCode;
    eq(code.length, 4, 'code length');
    assert(code.every((d) => Number.isInteger(d) && d >= 0 && d <= 9), 'digits in range');
    eq(new Set(code).size, 4, 'all distinct');
    g.destroy();
  }
});

test('starts cracking with an overall cap timer; code never leaks pre-reveal', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  eq(g.state, 'cracking');
  assert(pendingTimers() >= 1, 'cap timer armed');
  const s = g.getStateForPlayer('a');
  eq(s.secretCode, null, 'code hidden during cracking');
  assert(!JSON.stringify(s).includes('"secretCode":[1,2,3,4'), 'code not serialized');
});

test('feedback: locked/loose counted correctly (no double-count)', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  guess(g, 'a', [1, 2, 3, 4]); // exact
  let row = g.boards['a'].guesses.at(-1);
  eq(row.locked, 4); eq(row.loose, 0);
  eq(g.boards['a'].cracked, true);

  const g2 = newGame(['c', 'd'], [1, 2, 3, 4]);
  guess(g2, 'c', [4, 3, 2, 1]); // all present, none placed
  row = g2.boards['c'].guesses.at(-1);
  eq(row.locked, 0); eq(row.loose, 4);

  const g3 = newGame(['e', 'f'], [1, 2, 3, 4]);
  guess(g3, 'e', [1, 5, 6, 7]); // only the 1 is right & placed
  row = g3.boards['e'].guesses.at(-1);
  eq(row.locked, 1); eq(row.loose, 0);

  const g4 = newGame(['g', 'h'], [1, 2, 3, 4]);
  guess(g4, 'g', [2, 1, 9, 8]); // 1 and 2 present but swapped
  row = g4.boards['g'].guesses.at(-1);
  eq(row.locked, 0); eq(row.loose, 2);
});

test('invalid guesses rejected (length, non-digit, out of range)', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  guess(g, 'a', [1, 2, 3]);       // too short
  guess(g, 'a', [1, 2, 3, 4, 5]); // too long
  guess(g, 'a', [1, 2, 3, 10]);   // out of range
  guess(g, 'a', [1, 2, 3, '4']);  // non-integer
  eq(g.boards['a'].guessCount, 0, 'all invalid guesses ignored');
  // a valid one IS accepted
  guess(g, 'a', [0, 0, 0, 0]);
  eq(g.boards['a'].guessCount, 1);
});

test('a client cannot fake a crack — only a real 4-locked guess cracks', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  // wrong guess that the client might "claim" solved
  guess(g, 'a', [9, 9, 9, 9]);
  eq(g.boards['a'].cracked, false, 'wrong guess never cracks');
  // the only path to cracked is the real code
  crack(g, 'a');
  eq(g.boards['a'].cracked, true);
});

test('12-guess cap: a 13th guess is a no-op and player is out', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  for (let i = 0; i < 13; i++) guess(g, 'a', [5, 6, 7, 8]); // never the code
  eq(g.boards['a'].guessCount, 12);
  assert(g.done.has('a'), 'a is out of guesses');
  assert(g.boards['a'].out, 'marked out');
});

test('finish order = placement: first cracker ranks first', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  guess(g, 'a', [5, 6, 7, 8]); // a: one miss first
  crack(g, 'a');               // a cracks (2 guesses) FIRST
  crack(g, 'b');               // b cracks (1 guess) but SECOND
  eq(g.state, 'reveal', 'both done ends round');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1, 'first cracker first');
  eq(res.find((r) => r.playerId === 'b').placement, 2, 'second cracker second despite fewer guesses');
});

test('code revealed + results present at reveal, not before', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  eq(g.getStateForPlayer('a').secretCode, null);
  crack(g, 'a'); crack(g, 'b');
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  eq(JSON.stringify(s.secretCode), JSON.stringify([1, 2, 3, 4]));
  assert(Array.isArray(s.results), 'results present');
});

test('hidden info: opponents expose only counts/cracked status (no digits/feedback)', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  guess(g, 'a', [1, 2, 9, 9]); // 2 locked
  const opp = g.getStateForPlayer('b').opponents.find((o) => o.playerId === 'a');
  eq(Object.keys(opp).sort().join(','), 'cracked,crackedRank,guessCount,out,playerId');
  assert(!('digits' in opp) && !('locked' in opp) && !('guesses' in opp) && !('bestLocked' in opp),
    'no board/feedback leaked');
});

test('first crack starts an 8s grace that ends the round', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  crack(g, 'a');             // a cracks; b still going
  eq(g.state, 'cracking', 'round continues during grace');
  advance(8_000);            // grace expires
  eq(g.state, 'reveal', 'grace ended the round');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1);
  // b never cracked → ranks after a
  assert(res.find((r) => r.playerId === 'b').placement >= 2);
});

test('overall cap auto-advances; ranks all N by best progress', () => {
  for (const n of [2, 3, 5, 8]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players, [1, 2, 3, 4]);
    guess(g, 'p0', [1, 2, 9, 9]); // 2 locked, best progress
    advance(120_000);
    eq(g.state, 'reveal', `n=${n} cap advanced`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].playerId, 'p0', 'best progress first');
    res.forEach((e) => assert(typeof e.placement === 'number'));
  }
});

test('full game reaches finished with placement 1 first, for N in [2,3,4]', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players, [3, 1, 4, 2]);
    // crack in order p0, p1, p2... within grace
    players.forEach((p) => crack(g, p));
    eq(g.state, 'reveal', `n=${n} all cracked → reveal`);
    advance(10_000); // ack auto-advance
    eq(g.state, 'finished', `n=${n} finished`);
    eq(g.isComplete(), true);
    const res = g.getResults();
    eq(res.length, n, `n=${n} results length`);
    eq(res[0].placement, 1, 'first placement is 1');
    eq(res.find((r) => r.playerId === 'p0').placement, 1, 'p0 cracked first → 1st');
  }
});

test('tie: two non-crackers with equal progress share a placement', () => {
  const g = newGame(['a', 'b', 'c'], [1, 2, 3, 4]);
  guess(g, 'a', [1, 9, 9, 9]); // 1 locked
  guess(g, 'b', [1, 8, 8, 8]); // 1 locked (same progress, same count)
  // c does nothing
  advance(120_000);
  eq(g.state, 'reveal');
  const res = g.getResults();
  const ra = res.find((r) => r.playerId === 'a');
  const rb = res.find((r) => r.playerId === 'b');
  eq(ra.placement, rb.placement, 'equal progress shares placement');
  eq(ra.placement, 1, 'tied at the top');
});

test('reveal auto-ack advances to finished after 10s', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  crack(g, 'a'); crack(g, 'b');
  eq(g.state, 'reveal');
  advance(10_000);
  eq(g.state, 'finished');
  eq(g.isComplete(), true);
});

test('reveal completes immediately when everyone acknowledges', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  crack(g, 'a'); crack(g, 'b');
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  eq(g.state, 'finished');
});

test('removePlayer mid-solve advances (leaver pruned, no deadlock)', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  crack(g, 'b'); // b done (cracked)
  g.removePlayer('a'); // the only still-cracking player leaves
  assert(g.state === 'reveal' || g.state === 'finished', `ended (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver pruned from results');
});

test('removePlayer re-ranks crackOrder with no gaps', () => {
  const g = newGame(['a', 'b', 'c'], [1, 2, 3, 4]);
  crack(g, 'a'); // rank 1
  crack(g, 'b'); // rank 2
  g.removePlayer('a'); // a (rank 1) leaves → b should become rank 1
  eq(g.boards['b'].crackedRank, 1, 'b re-ranked to 1');
});

test('leaving down to one finishes and clears timers', () => {
  const g = newGame(['a', 'b', 'c'], [1, 2, 3, 4]);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b'], [1, 2, 3, 4]);
  assert(pendingTimers() >= 1, 'has timers');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('CrackTheVault');
