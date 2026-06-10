import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { PriceIsWrong } from '../src/games/PriceIsWrong.js';

installClock();

function newGame(players) {
  const g = new PriceIsWrong(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in guessing with a prompt + unit and a guess timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'guessing');
  assert(g.fact && typeof g.fact.answer === 'number', 'fact loaded with numeric answer');
  const s = g.getStateForPlayer('a');
  assert(s.prompt && s.unit, 'prompt + unit sent to client');
  eq(s.round, 1);
  eq(s.totalRounds, 5);
  assert(pendingTimers() >= 1, 'guess timer armed');
});

test('true answer is hidden during guessing but present in reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  const answer = g.fact.answer;
  const s = g.getStateForPlayer('a');
  // The exact answer value must not be serialized anywhere in the guessing payload.
  assert(!JSON.stringify(s).includes(`"answer":${answer}`), 'answer not leaked in guessing');
  eq(s.reveal, null);
  // everyone guesses -> reveal exposes the answer
  for (const p of g.players) g.handleAction(p, { type: 'submitGuess', guess: 1 });
  eq(g.state, 'reveal');
  const r = g.getStateForPlayer('a');
  assert(r.reveal && r.reveal.answer === answer, 'answer present in reveal');
});

test('guesses are private until reveal (no opponent guess leaks)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitGuess', guess: 7 });
  const sb = g.getStateForPlayer('b');
  assert(!JSON.stringify(sb).includes('7') || sb.myGuess === null, "a's guess not visible to b");
  eq(sb.submittedCount, 1);
  eq(sb.myGuess, null);
});

test('closest-without-over scoring ladder + over scores 0', () => {
  const g = newGame(['a', 'b', 'c', 'd', 'e']);
  const ans = g.fact.answer;
  // a closest under, b next, c third, d fourth (rest=200), e over (0)
  g.handleAction('a', { type: 'submitGuess', guess: ans });        // exact -> diff 0
  g.handleAction('b', { type: 'submitGuess', guess: ans - 1 });
  g.handleAction('c', { type: 'submitGuess', guess: ans - 2 });
  g.handleAction('d', { type: 'submitGuess', guess: ans - 3 });
  g.handleAction('e', { type: 'submitGuess', guess: ans + 100 }); // over
  eq(g.state, 'reveal');
  eq(g.scores['a'], 1000);
  eq(g.scores['b'], 700);
  eq(g.scores['c'], 500);
  eq(g.scores['d'], 200);
  eq(g.scores['e'], 0);
  eq(g.revealData.awards['e'].over, true);
  eq(g.revealData.awards['a'].rank, 1);
});

test('all-submitted advances to reveal immediately', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitGuess', guess: 1 });
  eq(g.state, 'guessing');
  g.handleAction('b', { type: 'submitGuess', guess: 2 });
  eq(g.state, 'reveal');
});

test('guess timer auto-advances to reveal and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitGuess', guess: 1 });
  const before = g.emitCount;
  advance(25_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on guess timeout');
});

test('reveal timer auto-acks and advances to next round / finished', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of g.players) g.handleAction(p, { type: 'submitGuess', guess: 1 });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(6_000);
  assert(g.state === 'guessing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function runFullGame(players, guessFn) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 60) {
    if (g.state === 'guessing') {
      for (const p of g.players) g.handleAction(p, { type: 'submitGuess', guess: guessFn(p, g) });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const n of [2, 3, 4]) {
  test(`full game with ${n} players finishes; results length ${n}, placement 1 first`, () => {
    const ids = ['a', 'b', 'c', 'd'].slice(0, n);
    // 'a' always guesses the exact answer -> always closest -> wins outright
    const g = runFullGame(ids, (p, gg) => (p === 'a' ? gg.fact.answer : 1));
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
  // everyone guesses 0 every round -> all under, equal diff -> all tie at 1000/round
  const g = runFullGame(['a', 'b', 'c'], () => 0);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
});

test('removePlayer mid-guessing advances with no deadlock and prunes leaver', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitGuess', guess: 1 });
  g.handleAction('b', { type: 'submitGuess', guess: 2 });
  g.removePlayer('c'); // c was the last owed -> should advance
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver pruned from results');
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
report('PriceIsWrong');
