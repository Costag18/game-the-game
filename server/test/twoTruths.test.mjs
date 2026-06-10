import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { TwoTruths } from '../src/games/TwoTruths.js';

installClock();

function newGame(players) {
  const g = new TwoTruths(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// drive the storyteller through writing -> guessing with a known lie position.
function writeStatements(g, lieIndex = 0) {
  g.handleAction(g.storyteller, {
    type: 'submitStatements',
    statements: ['born in Paris', 'has a pet snake', 'ran a marathon'],
    lieIndex,
  });
}
const lieOptId = (g) => g.lieOptionId;
const truthOpts = (g) => g.statements.filter((s) => s.optionId !== g.lieOptionId).map((s) => s.optionId);

test('starts in writing with a storyteller, rotation, and a write timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'writing');
  eq(g.totalRounds, 3);
  assert(g.players.includes(g.storyteller), 'storyteller is a real player');
  assert(pendingTimers() >= 1, 'write timer armed');
});

test('the lie is NOT in any guesser view before reveal, but IS at reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  writeStatements(g, 1);
  eq(g.state, 'guessing');
  const guesser = g._guessers[0];
  const s = g.getStateForPlayer(guesser);
  // statements present, but no flag tells which is the lie
  eq(s.statements.length, 3);
  for (const o of s.statements) {
    assert(!('isLie' in o), 'no isLie flag in guessing view');
    assert(!('_lie' in o), 'no _lie marker in guessing view');
  }
  assert(!JSON.stringify(s).includes('lieOptionId'), 'lieOptionId never sent to guesser');
  // finish the round and confirm the lie IS disclosed at reveal
  for (const p of g._guessers) g.handleAction(p, { type: 'guess', optionId: truthOpts(g)[0] });
  eq(g.state, 'reveal');
  const r = g.getStateForPlayer(guesser);
  assert(r.reveal && r.reveal.statements.some((x) => x.isLie), 'lie disclosed at reveal');
  eq(r.reveal.lieOptionId, lieOptId(g));
});

test('scoring: catchers +500, storyteller +250 per fooled guesser', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const st = g.storyteller;
  writeStatements(g, 0);
  const lie = lieOptId(g);
  const truth = truthOpts(g)[0];
  const guessers = g._guessers; // 3 of them
  // first guesser catches the lie; the other two are fooled
  g.handleAction(guessers[0], { type: 'guess', optionId: lie });
  g.handleAction(guessers[1], { type: 'guess', optionId: truth });
  g.handleAction(guessers[2], { type: 'guess', optionId: truth });
  eq(g.state, 'reveal');
  eq(g.scores[guessers[0]], 500);
  eq(g.scores[guessers[1]], 0);
  eq(g.scores[guessers[2]], 0);
  eq(g.scores[st], 250 * 2); // fooled 2
  eq(g.revealData.awards[st].fooled, 2);
  eq(g.revealData.caughtBy.length, 1);
});

test('storyteller cannot guess their own round', () => {
  const g = newGame(['a', 'b', 'c']);
  const st = g.storyteller;
  writeStatements(g, 2);
  g.handleAction(st, { type: 'guess', optionId: lieOptId(g) });
  eq(g.guesses[st], undefined);
  assert(g.state === 'guessing', 'still guessing — storyteller guess ignored');
});

test('a non-storyteller cannot submit statements', () => {
  const g = newGame(['a', 'b', 'c']);
  const notStory = g._guessers[0];
  g.handleAction(notStory, { type: 'submitStatements', statements: ['x', 'y', 'z'], lieIndex: 0 });
  assert(g.state === 'writing', 'still writing');
  assert(!g._hasStatements(), 'no statements registered from a non-storyteller');
});

test('rejects bad submissions (wrong count, empty, bad lieIndex)', () => {
  const g = newGame(['a', 'b', 'c']);
  const st = g.storyteller;
  g.handleAction(st, { type: 'submitStatements', statements: ['only', 'two'], lieIndex: 0 });
  assert(!g._hasStatements(), 'two statements rejected');
  g.handleAction(st, { type: 'submitStatements', statements: ['a', '', 'c'], lieIndex: 0 });
  assert(!g._hasStatements(), 'empty statement rejected');
  g.handleAction(st, { type: 'submitStatements', statements: ['a', 'b', 'c'], lieIndex: 5 });
  assert(!g._hasStatements(), 'out-of-range lieIndex rejected');
  // valid one works
  g.handleAction(st, { type: 'submitStatements', statements: ['a', 'b', 'c'], lieIndex: 1 });
  eq(g.state, 'guessing');
});

test('all guesses in advances to reveal (barrier)', () => {
  const g = newGame(['a', 'b', 'c']);
  writeStatements(g, 0);
  eq(g.state, 'guessing');
  for (const p of g._guessers) g.handleAction(p, { type: 'guess', optionId: truthOpts(g)[0] });
  eq(g.state, 'reveal');
});

test('write timeout skips scoring that round and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(45_000);
  assert(g.state === 'reveal' || g.state === 'finished', `advanced past writing (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on write timeout');
  if (g.state === 'reveal') {
    eq(g.revealData.skipped, true);
    // nobody scored on a skipped round
    for (const p of g.players) eq(g.scores[p], 0);
  }
});

test('guess timeout auto-misses everyone and advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  writeStatements(g, 1);
  const st = g.storyteller;
  eq(g.state, 'guessing');
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on guess timeout');
  // nobody guessed -> all guessers fooled -> storyteller +250 each
  eq(g.scores[st], 250 * g._guessers.length);
});

test('reveal timeout auto-acks and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  writeStatements(g, 0);
  for (const p of g._guessers) g.handleAction(p, { type: 'guess', optionId: truthOpts(g)[0] });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  assert(g.state === 'writing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function playFullGame(players, lieIndexFn) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 60) {
    if (g.state === 'writing') {
      writeStatements(g, lieIndexFn ? lieIndexFn(g) : 0);
    } else if (g.state === 'guessing') {
      for (const p of g._guessers) g.handleAction(p, { type: 'guess', optionId: truthOpts(g)[0] });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

test('full game (N=3) finishes; results rank all 3, placement 1 first', () => {
  const g = playFullGame(['a', 'b', 'c']);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res[0].placement, 1);
  // every player appears exactly once
  eq(new Set(res.map((r) => r.playerId)).size, 3);
});

test('full game (N=4) finishes; results rank all 4, placement 1 first', () => {
  const g = playFullGame(['a', 'b', 'c', 'd']);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 4);
  eq(res[0].placement, 1);
  eq(new Set(res.map((r) => r.playerId)).size, 4);
});

test('a tie shares a placement', () => {
  // everyone guesses the truth every round, so every storyteller fools all
  // guessers equally -> identical cumulative scores -> all placement 1.
  const g = playFullGame(['a', 'b', 'c']);
  const res = g.getResults();
  // with symmetric play each player storytells once (fool 2 -> +500) and is a
  // guesser twice (always wrong -> +0): every player ends on 500 -> all tie.
  eq(res.every((r) => r.score === res[0].score), true);
  eq(res.every((r) => r.placement === 1), true);
});

test('leave during writing (storyteller) skips the round and advances; leaver pruned', () => {
  const g = newGame(['a', 'b', 'c']);
  const st = g.storyteller;
  g.removePlayer(st); // storyteller bails before writing
  assert(g.state === 'reveal' || g.state === 'writing' || g.state === 'finished', `progressed (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === st), 'leaver not ranked');
});

test('leave during guessing (a guesser, last owing) advances to reveal', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  writeStatements(g, 0);
  const guessers = g._guessers; // 3
  g.handleAction(guessers[0], { type: 'guess', optionId: truthOpts(g)[0] });
  g.handleAction(guessers[1], { type: 'guess', optionId: truthOpts(g)[0] });
  g.removePlayer(guessers[2]); // the last owed guesser leaves
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === guessers[2]), 'leaver pruned from results');
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
report('TwoTruths');
