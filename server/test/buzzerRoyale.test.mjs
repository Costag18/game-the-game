import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { BuzzerRoyale } from '../src/games/BuzzerRoyale.js';

installClock();

function newGame(players) {
  const g = new BuzzerRoyale(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const correctIdx = (g) => g._q.answer;
const wrongIdx = (g) => (g._q.answer + 1) % g._q.choices.length;

test('starts in question phase with a question and 4 choices + answer timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'question');
  const s = g.getStateForPlayer('a');
  assert(s.question && s.question.length > 0, 'question text present');
  eq(s.choices.length, 4);
  eq(s.qNumber, 1);
  eq(s.total, 8);
  assert(pendingTimers() >= 1, 'answer timer armed');
});

test('the correct answer is NOT leaked during the question phase but IS in reveal', () => {
  const g = newGame(['a', 'b']);
  // during question: no `answer`/`reveal` payload, and no `correct:true` flag
  const sq = g.getStateForPlayer('a');
  eq(sq.reveal, null);
  eq(sq.myCorrect, null);
  const j = JSON.stringify(sq);
  assert(!/"answer"\s*:/.test(j), 'no answer key leaked in question state');
  // drive to reveal
  g.handleAction('a', { type: 'lock', choice: correctIdx(g) });
  g.handleAction('b', { type: 'lock', choice: wrongIdx(g) });
  eq(g.state, 'reveal');
  const sr = g.getStateForPlayer('a');
  assert(sr.reveal, 'reveal payload present');
  assert(Number.isInteger(sr.reveal.answer), 'correct index exposed in reveal');
});

test('a correct lock scores and a wrong lock scores 0 and locks the player out', () => {
  const g = newGame(['a', 'b']);
  const ans = correctIdx(g);
  g.handleAction('a', { type: 'lock', choice: ans });
  eq(g.scores['a'], 1000); // first correct buzz
  g.handleAction('b', { type: 'lock', choice: wrongIdx(g) });
  eq(g.scores['b'], 0);
  // b is locked out — a second (correct) attempt is ignored
  g.handleAction('b', { type: 'lock', choice: ans });
  eq(g.scores['b'], 0);
});

test('speed ordering: k-th correct buzzer scores max(200, 1000 - k*150)', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const ans = correctIdx(g);
  g.handleAction('a', { type: 'lock', choice: ans }); // rank 0 -> 1000
  g.handleAction('b', { type: 'lock', choice: ans }); // rank 1 -> 850
  g.handleAction('c', { type: 'lock', choice: ans }); // rank 2 -> 700
  g.handleAction('d', { type: 'lock', choice: ans }); // rank 3 -> 550
  eq(g.scores['a'], 1000);
  eq(g.scores['b'], 850);
  eq(g.scores['c'], 700);
  eq(g.scores['d'], 550);
});

test('a wrong buzz does NOT consume a speed rank', () => {
  const g = newGame(['a', 'b', 'c']);
  const ans = correctIdx(g);
  g.handleAction('a', { type: 'lock', choice: wrongIdx(g) }); // wrong, no rank consumed
  g.handleAction('b', { type: 'lock', choice: ans });         // still rank 0 -> 1000
  eq(g.scores['a'], 0);
  eq(g.scores['b'], 1000);
});

test('all answered advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  const ans = correctIdx(g);
  g.handleAction('a', { type: 'lock', choice: ans });
  g.handleAction('b', { type: 'lock', choice: wrongIdx(g) });
  eq(g.state, 'question');
  g.handleAction('c', { type: 'lock', choice: ans });
  eq(g.state, 'reveal');
});

test('answer timer auto-advances to reveal and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(12_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on answer timeout');
});

test('reveal auto-advances to the next question after the reveal timer', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'lock', choice: correctIdx(g) });
  g.handleAction('b', { type: 'lock', choice: correctIdx(g) });
  eq(g.state, 'reveal');
  eq(g.getStateForPlayer('a').qNumber, 1);
  const before = g.emitCount;
  advance(6_000);
  eq(g.state, 'question');
  eq(g.getStateForPlayer('a').qNumber, 2);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function runFullGame(players, picker) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'question') {
      for (const p of g.players) g.handleAction(p, { type: 'lock', choice: picker(g, p) });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const N of [2, 3, 4]) {
  test(`full game runs to finished with N=${N}; getResults length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    // first player always answers correctly (and first → most points); others always wrong
    const g = runFullGame(players, (gg, p) => (p === 'a' ? correctIdx(gg) : wrongIdx(gg)));
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'a');
    assert(res[0].score > 0, 'winner scored');
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement', () => {
  // everyone always locks the correct answer → but arrival order differs each Q.
  // Force a perfect tie: drive both players to lock simultaneously every question so
  // a is always rank 0 and b always rank 1 -> different totals. Instead, alternate who
  // buzzes first so cumulative scores end equal across an even number of questions.
  const g = newGame(['a', 'b']);
  let guard = 0;
  let qParity = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'question') {
      const ans = correctIdx(g);
      const order = qParity % 2 === 0 ? ['a', 'b'] : ['b', 'a'];
      for (const p of order) g.handleAction(p, { type: 'lock', choice: ans });
      qParity++;
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 2);
  // 8 questions, even split of first-buzz → equal totals → both placement 1
  eq(res[0].score, res[1].score);
  eq(res.every((r) => r.placement === 1), true);
});

test('removePlayer mid-question advances (no deadlock) and prunes the leaver', () => {
  const g = newGame(['a', 'b', 'c']);
  const ans = correctIdx(g);
  g.handleAction('a', { type: 'lock', choice: ans });
  g.handleAction('b', { type: 'lock', choice: wrongIdx(g) });
  eq(g.state, 'question'); // still waiting on c
  g.removePlayer('c');     // c was the last owed → advance
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver pruned from results');
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
report('Buzzer Royale');
