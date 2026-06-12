import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { TakeSix, bullhead } from '../src/games/TakeSix.js';

installClock();

function newGame(players) {
  const g = new TakeSix(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force a deterministic board: rows of single end-cards + each player's hand.
function rig(g, rows, hands) {
  g.rows = rows.map((r) => [...r]);
  for (const p of Object.keys(hands)) g.hands[p] = [...hands[p]];
}

// ---- bullhead math --------------------------------------------------------
test('bullhead penalties use the HIGHEST applicable rule', () => {
  eq(bullhead(55), 7);   // 55 special (also mult of 5 & 11 — 7 wins)
  eq(bullhead(11), 5);   // mult of 11
  eq(bullhead(22), 5);
  eq(bullhead(99), 5);
  eq(bullhead(10), 3);   // mult of 10 (not 11)
  eq(bullhead(100), 3);
  eq(bullhead(5), 2);    // mult of 5 (not 10)
  eq(bullhead(25), 2);
  eq(bullhead(1), 1);    // plain
  eq(bullhead(7), 1);
  eq(bullhead(50), 3);   // mult of 10 beats mult of 5
});

// ---- setup ----------------------------------------------------------------
test('startGame deals 10 private cards each + 4 seeded rows, enters choosing', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'choosing');
  eq(g.round, 1);
  eq(g.rows.length, 4);
  for (const r of g.rows) eq(r.length, 1);
  for (const p of g.players) eq(g.hands[p].length, 10);
  // all dealt + seeded cards are distinct and in 1..104
  const all = [...g.rows.flat(), ...g.players.flatMap((p) => g.hands[p])];
  eq(new Set(all).size, all.length);
  assert(all.every((n) => n >= 1 && n <= 104), 'all cards in range');
  assert(pendingTimers() >= 1, 'pick timer armed');
});

// ---- legal / illegal actions ---------------------------------------------
test('a legal pick is recorded; an illegal (not-in-hand) pick is rejected', () => {
  const g = newGame(['a', 'b', 'c']);
  const card = g.hands['a'][0];
  g.handleAction('a', { type: 'playCard', card });
  eq(g.picks['a'], card);
  // not in hand
  g.handleAction('b', { type: 'playCard', card: 999 });
  eq(g.picks['b'], undefined);
  // second pick same round ignored
  g.handleAction('a', { type: 'playCard', card: g.hands['a'][1] });
  eq(g.picks['a'], card);
});

// ---- core placement rules -------------------------------------------------
test('append goes to the highest end still lower than the card', () => {
  const g = newGame(['a', 'b']);
  // rows ending 5, 20, 40, 60 ; a plays 23 -> should append to the row ending 20
  rig(g, [[5], [20], [40], [60]], { a: [23], b: [99] });
  g.handleAction('b', { type: 'playCard', card: 99 }); // higher, resolves later
  g.handleAction('a', { type: 'playCard', card: 23 });
  eq(g.state, 'reveal');
  const row20 = g.rows.find((r) => r.includes(23));
  eq(row20[row20.length - 1], 23);
  eq(row20.length, 2);
});

test('placing the 6th card makes that player TAKE the first 5 and seed the row', () => {
  const g = newGame(['a', 'b']);
  // a row already has 5 cards; a plays the 6th
  // bullheads: 5->2, 10->3, 11->5, 15->2, 20->3  => total 15
  rig(g, [[5, 10, 11, 15, 20], [70], [80], [90]], { a: [21], b: [99] });
  g.handleAction('b', { type: 'playCard', card: 99 });
  g.handleAction('a', { type: 'playCard', card: 21 });
  eq(g.state, 'reveal');
  eq(g.scores['a'], 2 + 3 + 5 + 2 + 3); // 15 bullheads taken
  const seeded = g.rows.find((r) => r[0] === 21);
  eq(seeded.length, 1);
});

test('a card lower than every row-end TAKES the row with fewest bullheads', () => {
  const g = newGame(['a', 'b']);
  // a plays 3, below all ends. Row penalties: [50]->3, [40]->1, [60]->1(?), ...
  // build: [50](pen3) [41](pen1) [70](pen1) [80](pen1) -> tie at 1, lowest index wins
  rig(g, [[50], [41], [70], [80]], { a: [3], b: [99] });
  g.handleAction('b', { type: 'playCard', card: 99 });
  g.handleAction('a', { type: 'playCard', card: 3 });
  eq(g.state, 'reveal');
  // [41] is the first row with the minimum penalty (1) -> taken, bullhead 1
  eq(g.scores['a'], 1);
  const seeded = g.rows.find((r) => r[0] === 3);
  eq(seeded.length, 1);
  eq(seeded[0], 3);
});

test('cards resolve in ascending order (a lower card can fill a row the higher one then takes)', () => {
  const g = newGame(['a', 'b']);
  // row ends: 4 (with one card so far... make it have 5 so a 6th forces a take)
  // Setup so that ascending order matters: row [1,2,3,4,4x]? use distinct values.
  // Row R = [10,20,30,40,49] (5 cards, end 49). a plays 50, b plays 51.
  // Ascending: a(50) appends -> row now 6 -> a takes 5 -> seeds [50]. Then b(51): end 50 -> appends.
  rig(g, [[10, 20, 30, 40, 49], [60], [70], [80]], { a: [50], b: [51] });
  g.handleAction('a', { type: 'playCard', card: 50 });
  g.handleAction('b', { type: 'playCard', card: 51 });
  eq(g.state, 'reveal');
  // a took the 5: bullheads 10->3,20->3,30->3,40->1,49->1 = 11
  eq(g.scores['a'], 3 + 3 + 3 + 3 + 1); // 10,20,30,40 all multiples of 10 -> 3 each; 49 -> 1; total 13
  eq(g.scores['b'], 0);
  const seeded = g.rows.find((r) => r.includes(50));
  eq(seeded.slice(-1)[0], 51); // b appended onto a's seed
  eq(seeded.length, 2);
});

// ---- hidden info ----------------------------------------------------------
test('hidden info: opponent hands and picks are never in getStateForPlayer pre-reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  const bCard = g.hands['b'][0];
  const cCard = g.hands['c'][0];
  g.handleAction('b', { type: 'playCard', card: bCard });
  g.handleAction('c', { type: 'playCard', card: cCard });
  const s = g.getStateForPlayer('a');
  const json = JSON.stringify(s);
  // a's view must not contain any of b's or c's hand cards.
  // Match on a number boundary so "value":5 doesn't false-match "value":50.
  const leaks = (card) => new RegExp(`"value":${card}(?!\\d)`).test(json);
  for (const card of g.hands['b']) assert(!leaks(card) || g.hands['a'].includes(card),
    `b's card ${card} must not leak unless coincidentally in a's hand/rows`);
  for (const card of g.hands['c']) assert(!leaks(card) || g.hands['a'].includes(card),
    `c's card ${card} must not leak unless coincidentally in a's hand/rows`);
  // opponents expose only counts + a boolean, never the chosen card value
  const opp = s.players.find((p) => p.playerId === 'b');
  assert(!('card' in opp) && !('pick' in opp), 'no opponent pick field');
  eq(opp.hasPicked, true);
  // simultaneous picks are not revealed early: resolution null while choosing
  eq(s.resolution, null);
  // my own hand IS present
  eq(s.myHand.length, g.hands['a'].length);
});

test('a chosen card is not revealed to opponents until reveal phase', () => {
  const g = newGame(['a', 'b']);
  rig(g, [[5], [20], [40], [60]], { a: [23], b: [50] });
  g.handleAction('a', { type: 'playCard', card: 23 });
  // b has not picked; while still choosing, a's card 23 must not appear in b's view
  const sb = g.getStateForPlayer('b');
  assert(!JSON.stringify(sb).includes('23'), "a's secret pick not leaked to b mid-round");
  // b picks -> resolves -> now reveal exposes both cards
  g.handleAction('b', { type: 'playCard', card: 50 });
  eq(g.state, 'reveal');
  const sb2 = g.getStateForPlayer('b');
  assert(JSON.stringify(sb2.resolution).includes('23'), "a's card revealed at reveal");
});

// ---- barrier: all act AND timeout ----------------------------------------
test('round resolves when ALL players have picked', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'playCard', card: g.hands[p][0] });
  eq(g.state, 'reveal');
});

test('round resolves on the pick TIMEOUT, auto-picking the missing (and broadcasts)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'playCard', card: g.hands['a'][0] });
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on pick timeout');
});

test('reveal auto-advances on timeout', () => {
  const g = newGame(['a', 'b']);
  for (const p of ['a', 'b']) g.handleAction(p, { type: 'playCard', card: g.hands[p][0] });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(45_000);
  assert(g.state === 'choosing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

// ---- full games ----------------------------------------------------------
for (const N of [2, 3, 4]) {
  test(`full ${N}-player game reaches finished; results length ${N}, placement 1 first`, () => {
    const ids = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(ids);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'choosing') {
        for (const p of g.players) {
          if (g.picks[p] === undefined && g.hands[p].length) {
            g.handleAction(p, { type: 'playCard', card: g.hands[p][0] });
          }
        }
      } else if (g.state === 'reveal') {
        for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // ascending: each score >= previous, and placements non-decreasing
    for (let i = 1; i < res.length; i++) assert(res[i].score >= res[i - 1].score, 'scores ascending');
    // every player appears once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('tie shares a placement (ascending lowest-wins)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.scores = { a: 5, b: 5, c: 12 };
  g.state = 'finished';
  const res = g.getResults();
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(a.placement, 1);
  eq(b.placement, 1); // tie shares
  eq(c.placement, 3); // skips 2
});

// ---- leave / teardown -----------------------------------------------------
test('removePlayer mid-choosing advances the barrier and prunes the leaver', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'playCard', card: g.hands['a'][0] });
  g.handleAction('b', { type: 'playCard', card: g.hands['b'][0] });
  // c is the last owed; removing c must resolve the round
  g.removePlayer('c');
  eq(g.state, 'reveal');
  assert(!g.players.includes('c'), 'leaver pruned from players');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not in results');
});

test('removePlayer mid-reveal advances when the last ack is owed by the leaver', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of g.players) g.handleAction(p, { type: 'playCard', card: g.hands[p][0] });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // c owed the last ack
  assert(g.state === 'choosing' || g.state === 'finished', `advanced off reveal (got ${g.state})`);
  assert(!g.players.includes('c'), 'leaver pruned');
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
report('TakeSix');
