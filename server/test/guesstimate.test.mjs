import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Guesstimate } from '../src/games/Guesstimate.js';

installClock();

function newGame(players) {
  const g = new Guesstimate(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in question phase with a numeric prompt and an answer timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'question');
  assert(g.fact && typeof g.fact.answer === 'number', 'fact loaded with numeric answer');
  assert(g.getStateForPlayer('a').prompt.length > 0, 'prompt exposed');
  assert(pendingTimers() >= 1, 'answer timer armed');
  assert(g.getStateForPlayer('a').deadline > Date.now(), 'deadline in the future');
});

test('answer key is NOT in question-phase state but IS in reveal state', () => {
  const g = newGame(['a', 'b']);
  const answer = g.fact.answer;
  const sQ = g.getStateForPlayer('a');
  // structural anti-cheat: the engine never includes an `answer` field pre-reveal. Don't
  // substring-search the number — the epoch-ms `deadline` in state makes that check flaky.
  assert(!('answer' in sQ), 'answer key not exposed during question');
  // robust check: reveal is null and no per-player results during question
  eq(sQ.reveal, null);
  g.handleAction('a', { type: 'submitGuess', value: answer });
  g.handleAction('b', { type: 'submitGuess', value: answer });
  eq(g.state, 'reveal');
  const sR = g.getStateForPlayer('a');
  assert(sR.reveal && sR.reveal.answer === answer, 'answer present in reveal');
  assert(JSON.stringify(sR).includes(String(answer)), 'answer serialized in reveal');
});

test('exact guess scores 1000; a far order-of-magnitude miss scores less', () => {
  const g = newGame(['a', 'b']);
  const answer = g.fact.answer;
  g.handleAction('a', { type: 'submitGuess', value: answer });          // exact -> 1000
  g.handleAction('b', { type: 'submitGuess', value: answer * 100 });    // 100x off -> ~333
  eq(g.state, 'reveal');
  eq(g.scores['a'], 1000);
  assert(g.scores['b'] > 0 && g.scores['b'] < g.scores['a'], 'far miss scores positive but less');
});

test('a 10x miss scores ~500 (log-relative)', () => {
  const g = newGame(['a', 'b']);
  const answer = g.fact.answer;
  g.handleAction('a', { type: 'submitGuess', value: answer * 10 });
  g.handleAction('b', { type: 'submitGuess', value: answer });
  eq(g.scores['a'], 500); // 1000 / (1 + log10(10)) = 500
});

test('non-positive / non-numeric guesses are rejected', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitGuess', value: 0 });
  eq(g.guesses['a'], undefined);
  g.handleAction('a', { type: 'submitGuess', value: -5 });
  eq(g.guesses['a'], undefined);
  g.handleAction('a', { type: 'submitGuess', value: 'banana' });
  eq(g.guesses['a'], undefined);
  g.handleAction('a', { type: 'submitGuess', value: 12 });
  eq(g.guesses['a'], 12);
});

test('cannot submit twice in a round', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitGuess', value: 5 });
  g.handleAction('a', { type: 'submitGuess', value: 999 });
  eq(g.guesses['a'], 5);
});

test('all-submitted advances to reveal without waiting for timer', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitGuess', value: 10 });
  g.handleAction('b', { type: 'submitGuess', value: 20 });
  eq(g.state, 'question');
  g.handleAction('c', { type: 'submitGuess', value: 30 });
  eq(g.state, 'reveal');
});

test('answer timer auto-advances to reveal and broadcasts; missers score 0', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitGuess', value: g.fact.answer });
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on answer timeout');
  eq(g.scores['b'], 0); // b never guessed
});

test('reveal auto-advances to the next question / finished and broadcasts', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitGuess', value: 5 });
  g.handleAction('b', { type: 'submitGuess', value: 5 });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(6_000);
  assert(g.state === 'question' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function runFullGame(players) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 50) {
    if (g.state === 'question') {
      for (const p of g.players) g.handleAction(p, { type: 'submitGuess', value: g.fact.answer });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const n of [2, 3, 4]) {
  test(`full game with ${n} players finishes with ranked results (placement 1 first)`, () => {
    const ids = ['a', 'b', 'c', 'd'].slice(0, n);
    const g = runFullGame(ids);
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, n);
  });
}

test('a tie shares a placement', () => {
  // everyone guesses the exact answer every round -> equal scores -> all placement 1
  const g = runFullGame(['a', 'b', 'c']);
  const res = g.getResults();
  eq(res.every((r) => r.placement === 1), true);
});

test('distinct scores produce distinct placements 1,2,3', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 50) {
    if (g.state === 'question') {
      const ans = g.fact.answer;
      g.handleAction('a', { type: 'submitGuess', value: ans });          // best
      g.handleAction('b', { type: 'submitGuess', value: ans * 10 });     // middle
      g.handleAction('c', { type: 'submitGuess', value: ans * 1000 });   // worst
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  const res = g.getResults();
  eq(res.map((r) => r.placement).join(','), '1,2,3');
  eq(res[0].playerId, 'a');
});

test('removePlayer mid-question advances with no deadlock and prunes leaver from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitGuess', value: 5 });
  g.handleAction('b', { type: 'submitGuess', value: 5 });
  eq(g.state, 'question'); // still waiting on c
  g.removePlayer('c');     // c was the last owed -> should advance
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-reveal re-checks the ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of g.players) g.handleAction(p, { type: 'submitGuess', value: 5 });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  eq(g.state, 'reveal'); // still waiting on c
  g.removePlayer('c');   // last owed -> advance
  assert(g.state === 'question' || g.state === 'finished', `advanced (got ${g.state})`);
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
report('Guesstimate');
