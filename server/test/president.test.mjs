import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { President } from '../src/games/President.js';

installClock();

const card = (rv) => ({ rankValue: rv, label: String(rv), suit: '♠' });
function idxsOfRank(hand, rv, count) {
  const out = [];
  for (let i = 0; i < hand.length && out.length < count; i++) if (hand[i].rankValue === rv) out.push(i);
  return out;
}
function newGame(players) {
  const g = new President(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
// install a controlled trick: fixed hands, fresh open trick led by `leader`
function setup(g, hands, leader) {
  g.hands = hands;
  g.pile = [];
  g.trickCount = 0;
  g.trickTopRank = 0;
  g.passedThisTrick = new Set();
  g.trickLeader = leader;
  g.currentTurnPlayer = leader;
}

test('beat rules: same-count higher beats; wrong count / lower rejected; 2 is highest; clear returns lead', () => {
  const g = newGame(['a', 'b']);
  setup(g, {
    a: [card(7), card(7), card(15), card(15), card(3)], // 2s encoded as 15
    b: [card(9), card(9), card(5), card(5), card(8)],
  }, 'a');

  g.handleAction('a', { type: 'play', cardIndexes: idxsOfRank(g.hands.a, 7, 2) });
  eq(g.trickCount, 2); eq(g.trickTopRank, 7); eq(g.currentTurnPlayer, 'b');

  g.handleAction('b', { type: 'play', cardIndexes: idxsOfRank(g.hands.b, 9, 1) }); // single vs pair: count mismatch
  eq(g.trickTopRank, 7);
  g.handleAction('b', { type: 'play', cardIndexes: idxsOfRank(g.hands.b, 5, 2) }); // pair 5 < pair 7
  eq(g.trickTopRank, 7);
  g.handleAction('b', { type: 'play', cardIndexes: idxsOfRank(g.hands.b, 9, 2) }); // pair 9 beats
  eq(g.trickTopRank, 9); eq(g.trickLeader, 'b'); eq(g.currentTurnPlayer, 'a');

  g.handleAction('a', { type: 'play', cardIndexes: idxsOfRank(g.hands.a, 15, 2) }); // pair of 2s beats
  eq(g.trickTopRank, 15); eq(g.currentTurnPlayer, 'b');

  g.handleAction('b', { type: 'pass' }); // b can't beat → pass; a wins trick
  eq(g.trickCount, 0); eq(g.trickTopRank, 0); eq(g.currentTurnPlayer, 'a'); eq(g.pile.length, 0);
});

test('open lead allows any count after a clear', () => {
  const g = newGame(['a', 'b']);
  setup(g, { a: [card(4), card(4), card(4), card(9)], b: [card(6)] }, 'a');
  g.handleAction('a', { type: 'play', cardIndexes: [0, 1, 2] }); // triple 4s on a fresh lead
  eq(g.trickCount, 3); eq(g.trickTopRank, 4);
});

test('pass persistence: a passed player is skipped until the trick clears', () => {
  const g = newGame(['a', 'b', 'c']);
  setup(g, { a: [card(5), card(3)], b: [card(6), card(4)], c: [card(9), card(8)] }, 'a');
  g.handleAction('a', { type: 'play', cardIndexes: idxsOfRank(g.hands.a, 5, 1) }); // single 5
  eq(g.currentTurnPlayer, 'b');
  g.handleAction('b', { type: 'pass' });
  eq(g.currentTurnPlayer, 'c');
  g.handleAction('c', { type: 'play', cardIndexes: idxsOfRank(g.hands.c, 9, 1) }); // single 9 beats
  eq(g.currentTurnPlayer, 'a'); // b is SKIPPED (already passed)
  g.handleAction('a', { type: 'pass' });
  eq(g.trickCount, 0); eq(g.currentTurnPlayer, 'c'); // c wins, leads fresh
});

test('forced lead cannot pass; invalid plays rejected (no-op, turn unchanged)', () => {
  const g = newGame(['a', 'b']);
  setup(g, { a: [card(5), card(6)], b: [card(7)] }, 'a');
  g.handleAction('a', { type: 'pass' }); // leader on open trick can't pass
  eq(g.currentTurnPlayer, 'a'); eq(g.pile.length, 0);
  g.handleAction('a', { type: 'play', cardIndexes: [0, 1] }); // mixed ranks
  eq(g.pile.length, 0);
  g.handleAction('a', { type: 'play', cardIndexes: [99] }); // out of range
  eq(g.pile.length, 0);
  g.handleAction('a', { type: 'play', cardIndexes: [0, 0] }); // duplicate index
  eq(g.pile.length, 0);
});

test('finishing empties hand → recorded, removed from rotation, still in players', () => {
  const g = newGame(['a', 'b', 'c']);
  setup(g, { a: [card(5)], b: [card(6), card(9)], c: [card(8), card(4)] }, 'a');
  g.handleAction('a', { type: 'play', cardIndexes: [0] }); // a sheds last card
  assert(g.finishOrder.includes('a'), 'a recorded as finished');
  assert(!g.activePlayers.includes('a'), 'a out of rotation');
  assert(g.players.includes('a'), 'a still in players (scored)');
  eq(g.state, 'playing');
  assert(g.activePlayers.includes(g.currentTurnPlayer), 'turn on an active player');
});

test('last remaining player is the Scumlord; results are dense 1..N', () => {
  const g = newGame(['a', 'b']);
  setup(g, { a: [card(5)], b: [card(6)] }, 'a');
  g.handleAction('a', { type: 'play', cardIndexes: [0] }); // a finishes; b alone → finalize
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1);
  eq(res.find((r) => r.playerId === 'b').placement, 2);
});

test('full random game: getResults returns dense 1..N for every N', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    let iter = 0;
    while (g.state === 'playing' && iter++ < 2000) g._onTurnTimeout();
    eq(g.state, 'finished', `n=${n} terminates`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    const places = res.map((r) => r.placement).sort((a, b) => a - b);
    eq(JSON.stringify(places), JSON.stringify(Array.from({ length: n }, (_, i) => i + 1)), `n=${n} dense`);
  }
});

test('timeout auto-pass for a non-leader; auto-lead lowest single for the leader', () => {
  const g = newGame(['a', 'b']);
  setup(g, { a: [card(5), card(9)], b: [card(7), card(8)] }, 'a');
  g._startTurnTimer();
  advance(30_000); // a is leader on open trick → auto-lead lowest single (5)
  eq(g.hands.a.length, 1);
  eq(g.trickCount, 1); eq(g.trickTopRank, 5); eq(g.currentTurnPlayer, 'b');
  const before = g.emitCount;
  advance(30_000); // b is non-leader → auto-pass → a wins → clear, a leads
  assert(g.emitCount > before, 'broadcast on timeout');
  eq(g.trickCount, 0); eq(g.currentTurnPlayer, 'a');
});

test('leave: current+leader leaves → trick clears, lead reassigned, leaver absent from results', () => {
  const g = newGame(['a', 'b', 'c']);
  setup(g, { a: [card(5), card(3)], b: [card(6), card(4)], c: [card(9), card(8)] }, 'a');
  g.removePlayer('a');
  eq(g.state, 'playing');
  assert(g.activePlayers.includes(g.currentTurnPlayer), 'turn on active player');
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver pruned from results');
});

test('leave down to one finishes the round', () => {
  const g = newGame(['a', 'b']);
  setup(g, { a: [card(5)], b: [card(6)] }, 'a');
  g.removePlayer('a');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('destroy clears the turn timer', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
  const before = g.emitCount;
  advance(60_000);
  eq(g.emitCount, before);
});

test('hidden info: getStateForPlayer never leaks another hand', () => {
  const g = newGame(['a', 'b']);
  setup(g, { a: [card(5), card(9)], b: [card(7), card(8)] }, 'a');
  const s = g.getStateForPlayer('a');
  const json = JSON.stringify(s);
  // b's private cards (7,8 not yet played) must not appear under any hand field
  assert(!('hands' in s), 'no raw hands map');
  eq(s.myHand.length, 2);
  const opp = s.players.find((p) => p.playerId === 'b');
  assert(!('hand' in opp) && !('cards' in opp), 'opponent card contents not exposed');
  eq(opp.handCount, 2);
});

uninstallClock();
report('President');
