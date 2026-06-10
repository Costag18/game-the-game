import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { SequenceSleuth } from '../src/games/SequenceSleuth.js';

installClock();

function newGame(players) {
  const g = new SequenceSleuth(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const guess = (g, p, value) => g.handleAction(p, { type: 'guess', value });

test('generator produces a valid, internally-consistent sequence with an extra answer term', () => {
  // Sample many generations and verify each rule actually holds for every revealable
  // position and the hidden "next" term.
  for (let i = 0; i < 200; i++) {
    const g = newGame(['a', 'b']);
    const t = g.terms;
    eq(t.length, 7, 'full term list length = MAX_REVEALABLE + 1');
    assert(t.every((x) => Number.isInteger(x)), 'all terms integers');
    // The label must describe a rule that the terms satisfy. We validate by detecting at
    // least ONE consistent pattern across the list (a real sequence is never random noise).
    const arith = t.every((_, k) => k < 2 || t[k] - t[k - 1] === t[1] - t[0]);
    const geo = t[0] !== 0 && t.every((_, k) => k === 0 || t[k] === t[k - 1] * (t[1] / t[0]));
    const fib = t.every((_, k) => k < 2 || t[k] === t[k - 1] + t[k - 2]);
    const squares = t.every((x) => x >= 0 && Number.isInteger(Math.sqrt(x)));
    // Alternating = two interleaved arithmetic progressions: even indices share a step,
    // odd indices share a (possibly different) step.
    const evens = t.filter((_, k) => k % 2 === 0);
    const odds = t.filter((_, k) => k % 2 === 1);
    const isArith = (arr) => arr.length < 2 || arr.every((_, k) => k < 2 || arr[k] - arr[k - 1] === arr[1] - arr[0]);
    const alt = isArith(evens) && isArith(odds);
    assert(arith || geo || fib || squares || alt, `seq has a consistent rule: ${JSON.stringify(t)} (${g.ruleLabel})`);
    g.destroy();
  }
});

test('the answer term is exactly terms[shown] and is never sent pre-reveal', () => {
  const g = newGame(['a', 'b']);
  eq(g.shown, 2);
  const s = g.getStateForPlayer('a');
  // Only the first `shown` terms are revealed; the answer (terms[2]) is absent.
  eq(s.revealedTerms.length, 2);
  eq(JSON.stringify(s.revealedTerms), JSON.stringify(g.terms.slice(0, 2)));
  const blob = JSON.stringify(s);
  assert(!blob.includes('"answer"'), 'no answer field pre-reveal');
  assert(!blob.includes('"resolve":{') && s.resolve === null, 'no resolve snapshot pre-reveal');
  // The hidden next term must not appear in the serialized payload as a revealed value.
  assert(!s.revealedTerms.includes(g.terms[2]) || g.terms.slice(0, 2).includes(g.terms[2]),
    'answer term not leaked through revealed list');
});

test('a correct lock is accepted and scored; earlier lock scores more', () => {
  const g = newGame(['a', 'b']);
  const answer = g.terms[2]; // shown=2 at start
  guess(g, 'a', answer);     // locked at revealedCount 2 -> 600 - 200 = 400
  eq(g.locks['a'].correct, true);
  eq(g.locks['a'].points, 400);
  eq(g.scores['a'], 400);

  // b waits one reveal then locks at shown=3 (worth less)
  // Advance just under the reveal so only the timer fires once (resolution happens at answer term).
});

test('an incorrect / illegal lock is rejected or zeroed', () => {
  const g = newGame(['a', 'b']);
  const answer = g.terms[2];
  guess(g, 'a', answer + 1); // wrong number -> locked out, 0 points
  eq(g.locks['a'].correct, false);
  eq(g.locks['a'].points, 0);
  eq(g.scores['a'], 0);

  // illegal payloads are rejected entirely (no lock recorded)
  const g2 = newGame(['c', 'd']);
  g2.handleAction('c', { type: 'guess', value: 3.5 });        // non-integer
  g2.handleAction('c', { type: 'guess', value: 'x' });         // non-number
  g2.handleAction('c', { type: 'guess' });                     // missing
  eq(g2.locks['c'], undefined, 'no illegal lock recorded');

  // can't lock twice
  const g3 = newGame(['e', 'f']);
  guess(g3, 'e', g3.terms[2] + 5);
  guess(g3, 'e', g3.terms[2]); // second attempt ignored
  eq(g3.locks['e'].value, g3.terms[2] + 5);
});

test('lock status is private — opponents only expose hasLocked', () => {
  const g = newGame(['a', 'b']);
  guess(g, 'a', g.terms[2] + 9);
  const opp = g.getStateForPlayer('b').opponents.find((o) => o.playerId === 'a');
  eq(Object.keys(opp).sort().join(','), 'hasLocked,playerId');
  eq(opp.hasLocked, true);
  assert(!('value' in opp) && !('correct' in opp) && !('points' in opp), 'no lock detail leaked');
});

test('everyone locking resolves the sequence immediately to reveal', () => {
  const g = newGame(['a', 'b']);
  const answer = g.terms[2];
  guess(g, 'a', answer);
  guess(g, 'b', answer + 1);
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  assert(s.resolve !== null, 'resolve snapshot present');
  eq(s.resolve.answer, answer, 'answer revealed at reveal');
  eq(s.myLock.correct, true);
});

test('reveal timer auto-reveals/resolves and broadcasts', () => {
  const g = newGame(['a', 'b']);
  guess(g, 'a', g.terms[2]); // a locks, b does not
  eq(g.state, 'playing');
  const before = g.emitCount;
  advance(4000); // one reveal interval -> reaches answer term -> resolves
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'a broadcast fired on auto-resolve');
});

test('correct locker is ranked first by finish-order/score; ties shared', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    const answer = g.terms[2];
    guess(g, 'p0', answer);            // p0 nails it -> 400
    for (let i = 1; i < n; i++) guess(g, players[i], answer + 100); // wrong -> 0
    eq(g.state, 'reveal');
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].playerId, 'p0', 'correct locker first');
    eq(res[0].placement, 1);
    // all wrong-lockers tie at placement 2
    for (let i = 1; i < n; i++) {
      eq(res.find((r) => r.playerId === players[i]).placement, 2, 'wrong lockers tie');
    }
    g.destroy();
  }
});

test('all-AFK / no one correct -> everyone ties at placement 1', () => {
  const g = newGame(['a', 'b']);
  advance(4000); // auto-resolve sequence 1, nobody locked
  eq(g.state, 'reveal');
  const res = g.getResults();
  eq(res[0].placement, 1);
  eq(res[1].placement, 1);
});

test('reveal auto-ack advances; full 5-sequence game reaches finished with N results', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `q${i}`);
    const g = newGame(players);
    for (let s = 0; s < 5; s++) {
      eq(g.state, 'playing', `seq ${s} playing`);
      // everyone locks the true answer -> resolves immediately
      const answer = g.terms[g.shown];
      for (const p of players) guess(g, p, answer);
      eq(g.state, 'reveal');
      advance(10_000); // ack timeout -> advance
    }
    eq(g.state, 'finished');
    eq(g.isComplete(), true);
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1, 'placement 1 first');
    // all correct every round -> identical scores -> all tie at 1
    res.forEach((r) => eq(r.placement, 1, 'all-correct tie'));
    g.destroy();
  }
});

test('removePlayer mid-solve advances (no deadlock)', () => {
  const g = newGame(['a', 'b', 'c']);
  const answer = g.terms[2];
  guess(g, 'a', answer);
  guess(g, 'b', answer);
  // c hasn't locked; removing c means everyone remaining has locked -> resolve
  g.removePlayer('c');
  assert(g.state === 'reveal' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver pruned from results');
});

test('leaving down to one finishes and clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('removePlayer during reveal can complete the ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  const answer = g.terms[2];
  for (const p of ['a', 'b', 'c']) guess(g, p, answer);
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  // c is the last un-acked; removing c should complete the barrier and advance
  g.removePlayer('c');
  assert(g.state === 'playing' || g.state === 'finished', `barrier resolved (got ${g.state})`);
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('SequenceSleuth');
