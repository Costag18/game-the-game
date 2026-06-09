import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Spoons } from '../src/games/Spoons.js';

installClock();

function newGame(players) {
  const g = new Spoons(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
// open grab via first survivor, everyone-but-last grabs (last = eliminated), then ack all
function eliminateLast(g) {
  const survs = [...g.survivors];
  g._openGrab(survs[0], 'X');
  for (let i = 0; i < survs.length - 1; i++) g.handleAction(survs[i], { type: 'grab' });
  for (const p of [...g.survivors]) g.handleAction(p, { type: 'acknowledge' });
  return survs[survs.length - 1];
}

test('starts in passing, each survivor holds 4, draw pile seeds the flow', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'passing');
  for (const p of g.survivors) eq(g.hands[p].length, 4);
  eq(g.drawPile.length, 4); // 4*(3+1) - 3*4
  eq(g.dealerId, 'a');
  assert(pendingTimers() >= 1, 'idle timer armed');
});

test('take-and-discard forwards a card to the next seat', () => {
  const g = newGame(['a', 'b', 'c']);
  // dealer a picks from draw pile, discards the picked card (index 4) → goes to b
  const before = g.incoming['b'].length;
  g.handleAction('a', { type: 'takeAndDiscard', cardIndex: 4 });
  eq(g.incoming['b'].length, before + 1);
  eq(g.hands['a'].length, 4);
  eq(g.state, 'passing');
});

test('completing four-of-a-kind opens the grab phase', () => {
  const g = newGame(['a', 'b', 'c']);
  g.hands['a'] = [
    { rank: 'A', suit: '♠', id: 'A♠' }, { rank: 'A', suit: '♥', id: 'A♥' },
    { rank: 'A', suit: '♦', id: 'A♦' }, { rank: 'K', suit: '♣', id: 'K♣' },
  ];
  g.incoming['a'] = [{ rank: 'A', suit: '♣', id: 'A♣' }];
  g.handleAction('a', { type: 'takeAndDiscard', cardIndex: 3 }); // pick A♣, throw K♣ → four aces
  eq(g.state, 'grab');
  eq(g.grabTriggeredBy, 'a');
  eq(g.spoonsRemaining, 2); // survivors-1
});

test('concurrent four-of-a-kind: only the first opens grab', () => {
  const g = newGame(['a', 'b', 'c']);
  g._openGrab('a', 'A');
  g._openGrab('b', 'K'); // no-op, already in grab
  eq(g.grabTriggeredBy, 'a');
  eq(g.state, 'grab');
});

test('grab race: the one survivor who does not grab is eliminated', () => {
  const g = newGame(['a', 'b', 'c']);
  g._openGrab('a', 'A');
  g.handleAction('a', { type: 'grab' });
  g.handleAction('b', { type: 'grab' }); // 2 of 3 grabbed → resolve, c loses
  eq(g.state, 'roundEnd');
  eq(g.eliminationOrder[g.eliminationOrder.length - 1], 'c');
  assert(!g.survivors.includes('c'), 'c eliminated');
  assert(g.players.includes('c'), 'c still scored');
});

test('grab timeout auto-resolves with exactly one elimination', () => {
  const g = newGame(['a', 'b', 'c']);
  g._openGrab('a', 'A'); // nobody taps
  advance(4_000);
  eq(g.state, 'roundEnd');
  eq(g.survivors.length, 2);
});

test('idle timer forces flow so the ring cannot freeze', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(25_000);
  eq(g.state, 'passing'); // still playing, just nudged
  assert(g.emitCount > before, 'broadcast after forced flow');
});

test('full game completes; results are dense unique 1..N for N=3..6', () => {
  for (const n of [3, 4, 5, 6]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 50) eliminateLast(g);
    eq(g.state, 'finished', `n=${n} finished`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(new Set(res.map((r) => r.placement)).size, n, `n=${n} unique placements`);
    eq(res[0].survivedToEnd, true, 'winner first');
  }
});

test('hidden info: a player never sees another hand or incoming card contents', () => {
  const g = newGame(['a', 'b', 'c']);
  const s = g.getStateForPlayer('a');
  assert(!('hands' in s), 'no raw hands map');
  const seatB = s.seats.find((x) => x.playerId === 'b');
  assert(!('hand' in seatB) && !('cards' in seatB), 'opponent cards hidden');
  eq(seatB.handCount, 4);
  // b's actual card ids must not appear anywhere in a's view
  const json = JSON.stringify(s);
  for (const c of g.hands['b']) assert(!json.includes(c.id), `b card ${c.id} not leaked`);
});

test('leave during passing: dealer leaving reassigns the dealer, ring continues', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  g.removePlayer('a'); // dealer leaves
  eq(g.state, 'passing');
  eq(g.dealerId, g.survivors[0]);
  assert(!g.survivors.includes('a'), 'a gone');
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver pruned from results');
});

test('leave during grab: a non-grabber leaving still resolves to one elimination', () => {
  const g = newGame(['a', 'b', 'c']);
  g._openGrab('a', 'A');
  g.handleAction('a', { type: 'grab' }); // only a grabbed
  g.removePlayer('c'); // c hadn't grabbed and leaves
  assert(g.state === 'roundEnd' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'c pruned from results');
});

test('leaving down to one finishes the game', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.survivors.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('destroy clears all timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g._openGrab('a', 'A');
  g.destroy();
  eq(pendingTimers(), 0);
  const before = g.emitCount;
  advance(10_000);
  eq(g.emitCount, before);
});

uninstallClock();
report('Spoons');
