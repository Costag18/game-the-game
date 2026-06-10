import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { RankIt } from '../src/games/RankIt.js';

installClock();

function newGame(players) {
  const g = new RankIt(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in ranking with a category + shuffled items and an answer timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'ranking');
  const s = g.getStateForPlayer('a');
  assert(s.category && s.category.length > 0, 'category present');
  assert(Array.isArray(s.items) && s.items.length >= 2, 'shuffled items present');
  eq(s.roundNumber, 1);
  assert(pendingTimers() >= 1, 'answer timer armed');
});

test('the correct order is NOT in getStateForPlayer during ranking but IS in reveal', () => {
  const g = newGame(['a', 'b']);
  const orderedJson = JSON.stringify(g.ordered);
  const during = JSON.stringify(g.getStateForPlayer('a'));
  // the exact correct sequence must never appear pre-reveal
  assert(!during.includes(orderedJson), 'correct order not leaked during ranking');
  assert(during.includes('"reveal":null') || !during.includes('"correctOrder"'), 'no reveal payload during ranking');
  // submit + reach reveal
  g.handleAction('a', { type: 'submitOrder', order: [...g.ordered] });
  g.handleAction('b', { type: 'submitOrder', order: [...g.ordered] });
  eq(g.state, 'reveal');
  const after = JSON.stringify(g.getStateForPlayer('a'));
  assert(after.includes('correctOrder'), 'correct order present in reveal');
});

test('a perfect ordering scores 1000; a fully-reversed ordering scores 0', () => {
  const g = newGame(['a', 'b']);
  const correct = [...g.ordered];
  const reversed = [...g.ordered].reverse();
  g.handleAction('a', { type: 'submitOrder', order: correct });
  g.handleAction('b', { type: 'submitOrder', order: reversed });
  eq(g.state, 'reveal');
  eq(g.scores['a'], 1000);
  eq(g.scores['b'], 0); // reversed order shares no correctly-ordered adjacent pair
  eq(g.revealData.awards['a'].correctPairs, g.ordered.length - 1);
  eq(g.revealData.awards['b'].correctPairs, 0);
});

test('partial credit: one correct adjacent pair scores proportionally', () => {
  const g = newGame(['a', 'b']);
  const n = g.ordered.length; // >= 4 for the rank sets
  // swap the LAST two items: keeps the first n-2 adjacent pairs correct
  const partial = [...g.ordered];
  [partial[n - 1], partial[n - 2]] = [partial[n - 2], partial[n - 1]];
  g.handleAction('a', { type: 'submitOrder', order: partial });
  g.handleAction('b', { type: 'submitOrder', order: [...g.ordered] });
  eq(g.state, 'reveal');
  const denom = n - 1;
  // swapping the last pair breaks pairs (n-3..n-2) and (n-2..n-1) => correct = denom - 2
  const expectedCorrect = denom - 2;
  eq(g.revealData.awards['a'].correctPairs, expectedCorrect);
  eq(g.scores['a'], Math.round((1000 * expectedCorrect) / denom));
});

test('a non-permutation submission is rejected', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitOrder', order: ['totally', 'bogus', 'items'] });
  eq(g.answers['a'], undefined);
  g.handleAction('a', { type: 'submitOrder', order: [...g.shuffledItems] });
  assert(g.answers['a'] !== undefined, 'valid permutation accepted');
});

test('cannot submit twice', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitOrder', order: [...g.ordered] });
  const first = g.answers['a'];
  g.handleAction('a', { type: 'submitOrder', order: [...g.shuffledItems] });
  eq(g.answers['a'], first); // unchanged
});

test('all-submitted advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of g.players) g.handleAction(p, { type: 'submitOrder', order: [...g.shuffledItems] });
  eq(g.state, 'reveal');
});

test('answer timer auto-advances to reveal and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(40_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on answer timeout');
  // un-submitters got their shuffled guess credited (some score)
  assert('a' in g.revealData.awards, 'missing player scored');
});

test('reveal auto-advances to the next round / finished and broadcasts', () => {
  const g = newGame(['a', 'b']);
  for (const p of g.players) g.handleAction(p, { type: 'submitOrder', order: [...g.ordered] });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(6_000);
  assert(g.state === 'ranking' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

for (const N of [2, 3, 4]) {
  test(`full ${N}-player game runs to finished; getResults ranks all ${N} with placement 1 first`, () => {
    const ids = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(ids);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 40) {
      if (g.state === 'ranking') {
        // first player nails it, others submit the shuffled order
        g.handleAction(ids[0], { type: 'submitOrder', order: [...g.ordered] });
        for (const p of ids.slice(1)) g.handleAction(p, { type: 'submitOrder', order: [...g.shuffledItems] });
      } else if (g.state === 'reveal') {
        for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'ranking') {
      // everyone submits the perfect order each round → identical scores
      for (const p of g.players) g.handleAction(p, { type: 'submitOrder', order: [...g.ordered] });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.every((r) => r.placement === 1), true);
});

test('removePlayer mid-ranking advances with no deadlock and prunes leaver from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitOrder', order: [...g.ordered] });
  g.handleAction('b', { type: 'submitOrder', order: [...g.shuffledItems] });
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-reveal advances; collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of g.players) g.handleAction(p, { type: 'submitOrder', order: [...g.shuffledItems] });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last owed ack → advances
  assert(g.state === 'ranking' || g.state === 'finished', `advanced (got ${g.state})`);
  g.destroy(); // clear g's timers so the pendingTimers() check below only sees g2

  const g2 = newGame(['x', 'y', 'z']);
  g2.removePlayer('y');
  g2.removePlayer('z');
  eq(g2.players.length, 1);
  eq(g2.state, 'finished');
  g2.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('RankIt');
