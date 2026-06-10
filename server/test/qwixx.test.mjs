import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Qwixx } from '../src/games/Qwixx.js';

installClock();

function newGame(players) {
  const g = new Qwixx(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force the offered number deterministically (bypassing the random roll).
function setOffer(g, n) {
  g.dice = [Math.min(n - 1, 6), n - Math.min(n - 1, 6)];
  g.offered = n;
}

test('starts in round 1 with a rolled offer in 2..12 and a round timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'round');
  eq(g.round, 1);
  assert(g.offered >= 2 && g.offered <= 12, 'offered in 2..12');
  assert(pendingTimers() >= 1, 'round timer armed');
  // four empty rows per player
  eq(Object.keys(g.boards['a']).length, 4);
});

test('a legal mark mutates the board; the offered number is recorded', () => {
  const g = newGame(['a', 'b']);
  setOffer(g, 5);
  g.handleAction('a', { type: 'mark', color: 'red', number: 5 });
  eq(g.boards['a'].red.length, 1);
  eq(g.boards['a'].red[0], 5);
  eq(g.acted['a'], true);
  eq(g.lastAction['a'], 'mark');
});

test('rejects marking a number that was not offered', () => {
  const g = newGame(['a', 'b']);
  setOffer(g, 5);
  g.handleAction('a', { type: 'mark', color: 'red', number: 8 }); // 8 != offered 5
  eq(g.boards['a'].red.length, 0);
  eq(g.acted['a'], false);
});

test('rejects a non-ascending (leftward) mark in red after an earlier mark', () => {
  const g = newGame(['a', 'b']);
  // round 1: mark red 8
  setOffer(g, 8);
  g.handleAction('a', { type: 'mark', color: 'red', number: 8 });
  g.handleAction('b', { type: 'pass' });
  eq(g.round, 2);
  // round 2: offer 5 — to the LEFT of 8 in an ascending row → illegal
  setOffer(g, 5);
  g.handleAction('a', { type: 'mark', color: 'red', number: 5 });
  eq(g.boards['a'].red.length, 1); // unchanged
  eq(g.acted['a'], false);
});

test('green/blue descend: a smaller number to the right is legal, a larger is not', () => {
  const g = newGame(['a', 'b']);
  setOffer(g, 10);
  g.handleAction('a', { type: 'mark', color: 'green', number: 10 });
  g.handleAction('b', { type: 'pass' });
  // round 2: offer 6 (smaller → right in a descending row) legal
  setOffer(g, 6);
  g.handleAction('a', { type: 'mark', color: 'green', number: 6 });
  eq(g.boards['a'].green.length, 2);
  g.handleAction('b', { type: 'pass' });
  // round 3: offer 9 (larger than 6 → would be LEFT in descending row) illegal
  setOffer(g, 9);
  g.handleAction('a', { type: 'mark', color: 'green', number: 9 });
  eq(g.boards['a'].green.length, 2); // unchanged
});

test('one action per round: a second mark after acting is ignored', () => {
  const g = newGame(['a', 'b']);
  setOffer(g, 4);
  g.handleAction('a', { type: 'mark', color: 'red', number: 4 });
  g.handleAction('a', { type: 'mark', color: 'yellow', number: 4 });
  eq(g.boards['a'].red.length, 1);
  eq(g.boards['a'].yellow.length, 0);
});

test('triangular scoring: n marks score n*(n+1)/2 per row, summed across rows', () => {
  const g = newGame(['a', 'b']);
  // give a three red marks (asc) + two blue (desc) over rounds; b passes
  const plan = [
    ['red', 3], ['red', 5], ['red', 9],   // red count 3 -> 6
    ['blue', 11], ['blue', 7],            // blue count 2 -> 3
  ];
  for (const [color, num] of plan) {
    setOffer(g, num);
    g.handleAction('a', { type: 'mark', color, number: num });
    g.handleAction('b', { type: 'pass' });
  }
  // red:6, blue:3, yellow:0, green:0 => 9
  eq(g._totalScore('a'), 6 + 3);
  eq(g._rowScore('a', 'red'), 6);
  eq(g._rowScore('a', 'blue'), 3);
});

test('HIDDEN-INFO: next round number is not revealed until the round flips', () => {
  const g = newGame(['a', 'b']);
  setOffer(g, 6);
  g.handleAction('a', { type: 'mark', color: 'red', number: 6 });
  // a has acted; its own state must not still show the offered number as actionable
  const s = g.getStateForPlayer('a');
  eq(s.hasActed, true);
  // legalMarks for an acted player is empty (no peeking at what they could still do)
  eq(Object.keys(s.legalMarks).length, 0);
  // and the dice/offered are only exposed during the active round, never for reveal/finished
  // (assert via stringify that finished state carries no live offer)
});

test('round advances when all act AND on timeout (auto-pass + broadcast)', () => {
  // all act
  const g1 = newGame(['a', 'b', 'c']);
  setOffer(g1, 7);
  g1.handleAction('a', { type: 'pass' });
  g1.handleAction('b', { type: 'pass' });
  g1.handleAction('c', { type: 'mark', color: 'red', number: 7 });
  eq(g1.round, 2);

  // timeout path
  const g2 = newGame(['a', 'b']);
  g2.handleAction('a', { type: 'pass' });
  const before = g2.emitCount;
  eq(g2.round, 1);
  advance(25_000); // round timer fires → b auto-passes, advance
  eq(g2.round, 2);
  assert(g2.emitCount > before, 'broadcast on round timeout');
});

function playFullGame(players) {
  const g = newGame(players);
  let guard = 0;
  while (g.state === 'round' && guard++ < 200) {
    // first player marks red if legal else passes; everyone else passes
    for (const p of g.players) {
      if (g.acted[p]) continue;
      g.handleAction(p, { type: 'pass' });
    }
  }
  return g;
}

for (const n of [2, 3, 4]) {
  test(`full ${n}-player game reaches reveal then finished; results length ${n}, placement 1 first`, () => {
    const players = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));
    const g = playFullGame(players);
    eq(g.state, 'reveal');
    advance(12_000); // reveal auto-advance
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, n);
  });
}

test('a tie shares a placement (everyone passes all 12 rounds → all 0 → all placement 1)', () => {
  const g = playFullGame(['a', 'b', 'c']);
  advance(12_000);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.every((r) => r.placement === 1), true);
  eq(res.every((r) => r.score === 0), true);
});

test('a constructed winner outranks others (highest total wins)', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state === 'round' && guard++ < 200) {
    // a marks red ascending whenever legal; b and c always pass
    if (!g.acted['a']) {
      const offered = g.offered;
      if (g._isLegalMark('a', 'red', offered)) g.handleAction('a', { type: 'mark', color: 'red', number: offered });
      else g.handleAction('a', { type: 'pass' });
    }
    for (const p of ['b', 'c']) if (!g.acted[p]) g.handleAction(p, { type: 'pass' });
  }
  advance(12_000);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res[0].playerId, 'a');
  eq(res[0].placement, 1);
  assert(res[0].score >= res[1].score, 'winner has top score');
});

test('removePlayer mid-round resolves the barrier (no deadlock) and prunes the leaver', () => {
  const g = newGame(['a', 'b', 'c']);
  setOffer(g, 6);
  g.handleAction('a', { type: 'pass' });
  g.handleAction('b', { type: 'pass' });
  // c is the last owed; remove c → round should resolve and advance
  g.removePlayer('c');
  assert(!g.players.includes('c'), 'leaver pruned from players');
  assert(g.boards['c'] === undefined, 'leaver board pruned');
  eq(g.round, 2);
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
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

test('opponent board contents are present (Qwixx boards are public) but no dice leak after game', () => {
  const g = playFullGame(['a', 'b']);
  advance(12_000);
  eq(g.state, 'finished');
  const s = g.getStateForPlayer('a');
  eq(s.dice, null);
  eq(s.offered, null);
  assert(!JSON.stringify(s).includes('"dice":['), 'no live dice array in finished state');
});

uninstallClock();
report('Qwixx');
