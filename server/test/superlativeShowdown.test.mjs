import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { SuperlativeShowdown } from '../src/games/SuperlativeShowdown.js';

installClock();

function newGame(players) {
  const g = new SuperlativeShowdown(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Everyone submits the SAME ranking `order` (a consensus), driving deterministic Borda.
function allRank(g, order) {
  for (const p of g.players) g.handleAction(p, { type: 'submitRanking', order });
}

test('starts in ranking with a superlative, a deadline, and a timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'ranking');
  assert(typeof g.prompt === 'string' && g.prompt.length > 0, 'superlative loaded');
  assert(pendingTimers() >= 1, 'rank timer armed');
  const s = g.getStateForPlayer('a');
  assert(s.deadline > Date.now(), 'deadline is in the future');
  eq(s.players.length, 3);
});

test('rejects an invalid ranking (not a permutation of present players)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitRanking', order: ['a', 'b'] });        // too short
  eq(g.rankings['a'], undefined);
  g.handleAction('a', { type: 'submitRanking', order: ['a', 'b', 'b'] });    // dup
  eq(g.rankings['a'], undefined);
  g.handleAction('a', { type: 'submitRanking', order: ['a', 'b', 'z'] });    // unknown id
  eq(g.rankings['a'], undefined);
  g.handleAction('a', { type: 'submitRanking', order: ['c', 'b', 'a'] });    // valid
  assert(Array.isArray(g.rankings['a']) && g.rankings['a'].length === 3, 'valid ranking accepted');
});

test('others rankings are NOT leaked pre-reveal; only my own + counts are', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitRanking', order: ['a', 'b', 'c'] });
  g.handleAction('b', { type: 'submitRanking', order: ['c', 'b', 'a'] });
  // c has not submitted; view from c must not reveal a's or b's orderings/tallies
  const sc = g.getStateForPlayer('c');
  eq(sc.phase, 'ranking');
  eq(sc.reveal, null);
  eq(sc.myRanking, null);
  eq(sc.submittedCount, 2);
  const json = JSON.stringify(sc);
  // a's distinctive ordering ['a','b','c'] and b's ['c','b','a'] must not appear
  assert(!json.includes('"rankings"'), 'no rankings map pre-reveal');
  assert(!json.includes('roundPoints'), 'no tallies pre-reveal');
  // my own ranking IS visible to me though
  const sa = g.getStateForPlayer('a');
  assert(Array.isArray(sa.myRanking) && sa.myRanking.length === 3, 'I can see my own ranking');
});

test('all submit advances to reveal; Borda math is correct', () => {
  // N=3: positions earn (N-1-p) = 2,1,0. If everyone ranks a>b>c this round,
  // a gets 3*2=6, b gets 3*1=3, c gets 3*0=0.
  const g = newGame(['a', 'b', 'c']);
  allRank(g, ['a', 'b', 'c']);
  eq(g.state, 'reveal');
  eq(g.scores['a'], 6);
  eq(g.scores['b'], 3);
  eq(g.scores['c'], 0);
  // reveal exposes consensus order + per-voter rankings
  assert(g.revealData && g.revealData.consensus[0].playerId === 'a', 'consensus top is a');
  eq(g.revealData.consensus[0].rank, 1);
  assert(g.revealData.rankings['a'].join(',') === 'a,b,c', 'voter ranking disclosed at reveal');
  const sa = g.getStateForPlayer('a');
  assert(sa.reveal && sa.reveal.rankings, 'reveal payload present in state');
});

test('rank timeout auto-fills missing rankings and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitRanking', order: ['a', 'b', 'c'] });
  const before = g.emitCount;
  advance(46_000);
  eq(g.state, 'reveal');
  assert(g.rankings['b'] && g.rankings['c'], 'missing players auto-ranked');
  assert(g.emitCount > before, 'broadcast on rank timeout');
});

test('reveal timeout auto-acks and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  allRank(g, ['a', 'b', 'c']);
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  assert(g.state === 'ranking' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function playFullGame(players, perRoundOrder) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'ranking') {
      const order = typeof perRoundOrder === 'function' ? perRoundOrder(g) : perRoundOrder;
      allRank(g, order);
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const N of [3, 4]) {
  test(`full 4-round game (N=${N}) finishes; results length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = playFullGame(players, players); // everyone always ranks a>b>...; a wins
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'a');
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement', () => {
  // 4 players, every round everyone ranks them all tied is impossible (it is a strict
  // permutation), so instead make two pairs symmetric across rounds:
  // round uses order rotating so a&b accumulate equal, c&d accumulate equal.
  // Simpler: 4 players, half rank a>b>c>d, half rank b>a>d>c each round → a==b, c==d.
  const g = newGame(['a', 'b', 'c', 'd']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'ranking') {
      g.handleAction('a', { type: 'submitRanking', order: ['a', 'b', 'c', 'd'] });
      g.handleAction('b', { type: 'submitRanking', order: ['b', 'a', 'd', 'c'] });
      g.handleAction('c', { type: 'submitRanking', order: ['a', 'b', 'c', 'd'] });
      g.handleAction('d', { type: 'submitRanking', order: ['b', 'a', 'd', 'c'] });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  // a and b tie (both top), c and d tie (both bottom)
  eq(res[0].score, res[1].score);
  eq(res[0].placement, res[1].placement);
  eq(res[2].score, res[3].score);
  eq(res[2].placement, res[3].placement);
  eq(res[2].placement, 3); // two tied at 1, next shared placement is 3
});

test('leave during ranking (last owing) advances to reveal; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitRanking', order: ['a', 'b', 'c'] });
  g.handleAction('b', { type: 'submitRanking', order: ['a', 'b', 'c'] });
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
  // remaining rankings had c filtered out so they stay valid 2-perms
  for (const p of g.players) assert(!g.rankings[p].includes('c'), 'leaver scrubbed from rankings');
});

test('leave during reveal re-checks ack and does not deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  allRank(g, ['a', 'b', 'c']);
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // c was the last we waited on
  assert(g.state === 'ranking' || g.state === 'finished', `advanced past reveal (got ${g.state})`);
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
report('SuperlativeShowdown');
