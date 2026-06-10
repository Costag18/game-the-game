import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { GroupMind } from '../src/games/GroupMind.js';

installClock();

function newGame(players) {
  const g = new GroupMind(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in writing with a category and a write timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'writing');
  assert(typeof g.category === 'string' && g.category.length > 0, 'category loaded');
  assert(pendingTimers() >= 1, 'write timer armed');
});

test('answers are private pre-reveal: no other answer in getStateForPlayer', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitAnswer', text: 'pepperoni' });
  g.handleAction('b', { type: 'submitAnswer', text: 'mushroom' });
  // c has not answered; c must not see a's or b's answer text
  const s = g.getStateForPlayer('c');
  const blob = JSON.stringify(s);
  assert(!blob.includes('pepperoni'), 'a\'s answer not leaked to c');
  assert(!blob.includes('mushroom'), 'b\'s answer not leaked to c');
  eq(s.reveal, null);
  // a sees only its own answer echoed back
  const sa = g.getStateForPlayer('a');
  eq(sa.myAnswer, 'pepperoni');
  assert(!JSON.stringify(sa).includes('mushroom'), 'b\'s answer not leaked to a');
});

test('answer is locked after first submit', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitAnswer', text: 'cheese' });
  g.handleAction('a', { type: 'submitAnswer', text: 'olives' });
  eq(g.answers['a'], 'cheese');
});

test('all answers submitted advances to reveal; reveal exposes buckets', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitAnswer', text: 'Pepperoni' });
  g.handleAction('b', { type: 'submitAnswer', text: 'pepperoni!' }); // normalises to match a
  g.handleAction('c', { type: 'submitAnswer', text: 'mushroom' });
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  assert(s.reveal, 'reveal data present');
  assert(JSON.stringify(s).toLowerCase().includes('pepperoni'), 'answers visible at reveal');
});

test('scoring: +100 per OTHER player in the same normalised bucket', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  // a, b, c all match (pepperoni); d is alone
  g.handleAction('a', { type: 'submitAnswer', text: 'Pepperoni' });
  g.handleAction('b', { type: 'submitAnswer', text: 'pepperoni ' });
  g.handleAction('c', { type: 'submitAnswer', text: 'PEPPERONI!!' });
  g.handleAction('d', { type: 'submitAnswer', text: 'pineapple' });
  eq(g.state, 'reveal');
  // each of a/b/c matched 2 others -> 200; d matched none -> 0
  eq(g.scores['a'], 200);
  eq(g.scores['b'], 200);
  eq(g.scores['c'], 200);
  eq(g.scores['d'], 0);
  eq(g.revealData.awards['a'].matched, 2);
  eq(g.revealData.awards['d'].matched, 0);
});

test('blanks never match each other (two no-answers score 0)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('c', { type: 'submitAnswer', text: 'apple' });
  advance(40_000); // a and b never answered -> each a unique blank bucket
  eq(g.state, 'reveal');
  eq(g.scores['a'], 0);
  eq(g.scores['b'], 0);
  eq(g.scores['c'], 0);
});

test('write timeout auto-blanks missing players and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitAnswer', text: 'apple' });
  const before = g.emitCount;
  advance(40_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on write timeout');
  // b and c recorded as blank
  eq(g.answers['b'], '');
  eq(g.answers['c'], '');
});

test('reveal timeout auto-acks and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitAnswer', text: 'apple' });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  assert(g.state === 'writing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('cumulative scoring across rounds; full 5-round game finishes for N=3', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'writing') {
      // everyone says the same thing every round -> all match (2 others each = +200/round)
      for (const p of g.players) g.handleAction(p, { type: 'submitAnswer', text: 'same' });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  // 5 rounds * 200 = 1000 each, all tie -> all placement 1
  eq(res.every((r) => r.score === 1000), true);
  eq(res.every((r) => r.placement === 1), true);
  eq(res[0].placement, 1);
});

test('full 4-player game finishes; results length N and placement 1 first', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'writing') {
      // a & b always match each other; c & d always unique -> a,b lead
      g.handleAction('a', { type: 'submitAnswer', text: 'twins' });
      g.handleAction('b', { type: 'submitAnswer', text: 'twins' });
      g.handleAction('c', { type: 'submitAnswer', text: 'cccc' });
      g.handleAction('d', { type: 'submitAnswer', text: 'dddd' });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 4);
  eq(res[0].placement, 1);
  // a and b tie at top (5*100 each), c and d tie at 0
  eq(res[0].score, 500);
  eq(res[1].score, 500);
  eq(res[0].placement, 1);
  eq(res[1].placement, 1);
  eq(res[2].placement, 3); // tie skips placement 2
});

test('a tie shares a placement', () => {
  const g = newGame(['a', 'b', 'c']);
  // round 1 only matters for ranking; force all equal then finish via leaves? No —
  // run one full game where a & b match, c alone, each round.
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'writing') {
      g.handleAction('a', { type: 'submitAnswer', text: 'pair' });
      g.handleAction('b', { type: 'submitAnswer', text: 'pair' });
      g.handleAction('c', { type: 'submitAnswer', text: 'solo' });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  const res = g.getResults();
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  eq(a.placement, b.placement); // shared
  eq(a.placement, 1);
});

test('leave during writing (last owing) advances to reveal; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitAnswer', text: 'apple' });
  g.handleAction('b', { type: 'submitAnswer', text: 'apple' });
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
  // a & b still matched each other -> 100 each
  eq(g.scores['a'], 100);
  eq(g.scores['b'], 100);
});

test('leave during reveal advances when remaining have acked', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitAnswer', text: 'x' });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // c was the only one not acked
  assert(g.state === 'writing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver pruned');
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
report('GroupMind');
