import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { BalloonBrinkmanship } from '../src/games/BalloonBrinkmanship.js';

installClock();

function newGame(players) {
  const g = new BalloonBrinkmanship(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force a deterministic threshold so we can drive pops/banks precisely.
function setThreshold(g, pid, val) { g.thresholds[pid] = val; }

test('starts in inflating with 0 air, hidden thresholds, and a round timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'inflating');
  eq(g.round, 1);
  eq(g.air['a'], 0);
  assert(g.thresholds['a'] >= 60 && g.thresholds['a'] <= 100, 'threshold in range');
  assert(pendingTimers() >= 1, 'round timer armed');
});

test('threshold is NEVER sent to the player (or anyone) pre-reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  setThreshold(g, 'a', 77);
  const s = g.getStateForPlayer('a');
  assert(!('threshold' in s), 'no top-level threshold');
  // none of the visible fields should carry my secret number
  assert(!JSON.stringify(s).includes('77'), 'my threshold 77 not leaked mid-round');
  for (const o of s.otherPlayers) eq(o.threshold, null);
  for (const o of s.otherPlayers) eq(o.air, null); // opponents' air hidden mid-round too
});

test('pump adds server-random air (8..15) and is server-authoritative', () => {
  const g = newGame(['a', 'b']);
  setThreshold(g, 'a', 100);
  g.handleAction('a', { type: 'pump' });
  assert(g.air['a'] >= 8 && g.air['a'] <= 15, `air after one pump (got ${g.air['a']})`);
  eq(g.status['a'], 'pumping');
});

test('air exceeding the hidden threshold POPS — banks nothing, locks the player', () => {
  const g = newGame(['a', 'b']);
  setThreshold(g, 'a', 60);
  // pump until pop (each pump <=15; threshold 60 → pops within ~5 pumps)
  let guard = 0;
  while (g.status['a'] === 'pumping' && guard++ < 50) g.handleAction('a', { type: 'pump' });
  eq(g.status['a'], 'popped');
  eq(g.bankedThisRound['a'], 0);
  eq(g.scores['a'], 0); // pop banks nothing
  assert(g.air['a'] > 60, 'air went past threshold');
  // further pumps after pop do nothing
  const airAtPop = g.air['a'];
  g.handleAction('a', { type: 'pump' });
  eq(g.air['a'], airAtPop);
});

test('bank locks the air into cumulative score; later pump is ignored', () => {
  const g = newGame(['a', 'b']);
  setThreshold(g, 'a', 100);
  g.handleAction('a', { type: 'pump' });
  const air = g.air['a'];
  g.handleAction('a', { type: 'bank' });
  eq(g.status['a'], 'banked');
  eq(g.scores['a'], air);
  g.handleAction('a', { type: 'pump' }); // locked
  eq(g.scores['a'], air);
  eq(g.air['a'], air);
});

test('round ends only when EVERY player has banked-or-popped, then reveals thresholds', () => {
  const g = newGame(['a', 'b']);
  setThreshold(g, 'a', 100);
  setThreshold(g, 'b', 60);
  g.handleAction('a', { type: 'pump' });
  g.handleAction('a', { type: 'bank' });
  eq(g.state, 'inflating'); // b still pumping
  let guard = 0;
  while (g.status['b'] === 'pumping' && guard++ < 50) g.handleAction('b', { type: 'pump' });
  eq(g.state, 'roundEnd'); // both resolved → round ends
  // reveal now exposes thresholds
  const s = g.getStateForPlayer('a');
  assert(s.reveal && s.reveal.outcomes.length === 2, 'reveal carries outcomes');
  const bOut = s.reveal.outcomes.find((o) => o.playerId === 'b');
  eq(bOut.threshold, 60); // threshold revealed at round end
  eq(bOut.status, 'popped');
});

test('20s timeout auto-banks anyone still pumping and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  setThreshold(g, 'a', 100);
  g.handleAction('a', { type: 'pump' });
  const aAir = g.air['a'];
  const before = g.emitCount;
  advance(20_000);
  eq(g.state, 'roundEnd');
  eq(g.status['a'], 'banked'); // auto-banked on timeout
  eq(g.scores['a'], aAir);
  assert(g.emitCount > before, 'broadcast on round timeout');
});

test('roundEnd 10s ack timeout auto-advances to the next round + broadcasts', () => {
  const g = newGame(['a', 'b']);
  setThreshold(g, 'a', 100); setThreshold(g, 'b', 100);
  for (const p of ['a', 'b']) g.handleAction(p, { type: 'bank' });
  eq(g.state, 'roundEnd');
  const before = g.emitCount;
  advance(10_000);
  eq(g.state, 'inflating'); // round 1 -> 2
  eq(g.round, 2);
  assert(g.emitCount > before, 'broadcast on ack timeout');
});

function playRoundAllBank(g) {
  // every present player banks immediately (1 pump then bank, high threshold)
  for (const p of g.players) setThreshold(g, p, 100);
  for (const p of g.players) { g.handleAction(p, { type: 'pump' }); g.handleAction(p, { type: 'bank' }); }
  // now roundEnd → ack everyone
  for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
}

for (const N of [2, 3, 4]) {
  test(`full 4-round game with N=${N} reaches finished; results rank all N, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 40) {
      if (g.state === 'inflating') {
        for (const p of g.players) setThreshold(g, p, 100);
        for (const p of g.players) { g.handleAction(p, { type: 'pump' }); g.handleAction(p, { type: 'bank' }); }
      } else if (g.state === 'roundEnd') {
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

test('a tie shares a placement (every player ranked once)', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'inflating') {
      // force identical banked air for all → equal cumulative scores
      for (const p of g.players) setThreshold(g, p, 100);
      for (const p of g.players) { g.air[p] = 10; g.handleAction(p, { type: 'bank' }); }
    } else if (g.state === 'roundEnd') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true); // all tied → all placement 1
});

test('higher banked score wins (no popping)', () => {
  const g = newGame(['a', 'b']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'inflating') {
      setThreshold(g, 'a', 100); setThreshold(g, 'b', 100);
      g.air['a'] = 50; g.handleAction('a', { type: 'bank' });
      g.air['b'] = 10; g.handleAction('b', { type: 'bank' });
    } else if (g.state === 'roundEnd') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  const res = g.getResults();
  eq(res[0].playerId, 'a');
  eq(res[0].placement, 1);
  eq(res[1].placement, 2);
  assert(res[0].score > res[1].score, 'a outscored b');
});

test('every timer path calls _emitChange (spy the callback)', () => {
  // round timeout
  let g = newGame(['a', 'b']);
  let before = g.emitCount;
  advance(20_000);
  assert(g.emitCount > before, 'round timeout emitted');
  eq(g.state, 'roundEnd');
  // ack timeout
  before = g.emitCount;
  advance(10_000);
  assert(g.emitCount > before, 'ack timeout emitted');
});

test('removePlayer mid-inflate advances with no deadlock (banked leaver triggers end)', () => {
  const g = newGame(['a', 'b']);
  setThreshold(g, 'a', 100); setThreshold(g, 'b', 100);
  g.handleAction('a', { type: 'bank' }); // a done, waiting on b
  eq(g.state, 'inflating');
  g.removePlayer('b'); // b leaves → only a remains → finish
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver pruned from results');
});

test('removePlayer mid-inflate (3 players) resolves the round when last ower leaves', () => {
  const g = newGame(['a', 'b', 'c']);
  setThreshold(g, 'a', 100); setThreshold(g, 'b', 100);
  g.handleAction('a', { type: 'bank' });
  g.handleAction('b', { type: 'bank' });
  eq(g.state, 'inflating'); // waiting on c
  g.removePlayer('c'); // c was the only one still pumping
  eq(g.state, 'roundEnd'); // a & b resolved → round ends, no deadlock
  assert(!g.players.includes('c'), 'c pruned');
});

test('removePlayer during roundEnd auto-acks and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of g.players) setThreshold(g, p, 100);
  for (const p of g.players) g.handleAction(p, { type: 'bank' });
  eq(g.state, 'roundEnd');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  eq(g.state, 'roundEnd'); // waiting on c
  g.removePlayer('c');
  eq(g.state, 'inflating'); // c's ack no longer owed → advanced
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  assert(pendingTimers() >= 1, 'timer armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('collapse to one player finishes immediately', () => {
  const g = newGame(['a', 'b']);
  g.removePlayer('b');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

uninstallClock();
report('BalloonBrinkmanship');
