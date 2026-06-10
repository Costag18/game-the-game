import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { BingoBrawl } from '../src/games/BingoBrawl.js';

installClock();

function newGame(players) {
  const g = new BingoBrawl(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force a deterministic card on a player: numbers 1..25 column-major so we know
// exactly which numbers fill row 0 / col 0 / the diagonal, and FREE stays center.
function setCard(g, pid, cells) {
  g.cards[pid] = cells.slice();
  g.daubed[pid] = new Set([12]); // FREE pre-daubed
}

// A card whose top row (indices 0..4) holds a known set of small numbers.
function cardWithTopRow(nums) {
  // nums: 5 distinct values for indices 0..4; fill the rest with safe high values.
  const cells = new Array(25).fill(0).map((_, i) => 100 + i); // out-of-call-range filler (won't be called: >75)
  for (let i = 0; i < 5; i++) cells[i] = nums[i];
  cells[12] = null;
  return cells;
}

// Make the server "call" specific numbers (authoritative set) without timers.
function call(g, nums) {
  for (const n of nums) {
    if (!g.calledSet.has(n)) { g.calledSet.add(n); g.calledOrder.push(n); }
  }
}

test('starts playing: every player has a 25-cell card, FREE center daubed, one number called', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'playing');
  for (const p of g.players) {
    eq(g.cards[p].length, 25);
    eq(g.cards[p][12], null);          // FREE center
    assert(g.daubed[p].has(12), 'FREE pre-daubed');
  }
  eq(g.calledOrder.length, 1);         // first number called immediately
  assert(pendingTimers() >= 1, 'call timer armed');
});

test('card columns respect B-I-N-G-O ranges', () => {
  const g = newGame(['a']);
  const card = g.cards['a'];
  for (let col = 0; col < 5; col++) {
    const lo = col * 15 + 1, hi = lo + 14;
    for (let row = 0; row < 5; row++) {
      const idx = row * 5 + col;
      if (idx === 12) continue;
      const v = card[idx];
      assert(v >= lo && v <= hi, `col ${col} value ${v} in [${lo},${hi}]`);
    }
  }
});

test('daub rejected when number not called; accepted once called', () => {
  const g = newGame(['a', 'b']);
  setCard(g, 'a', cardWithTopRow([5, 16, 31, 46, 61]));
  // value 5 lives at index 0 but has NOT been called → reject
  g.handleAction('a', { type: 'daub', index: 0 });
  assert(!g.daubed['a'].has(0), 'daub rejected before call');
  call(g, [5]);
  g.handleAction('a', { type: 'daub', index: 0 });
  assert(g.daubed['a'].has(0), 'daub accepted after call');
  // can't daub FREE, can't re-daub, can't daub out of range
  g.handleAction('a', { type: 'daub', index: 12 });
  g.handleAction('a', { type: 'daub', index: 99 });
  eq(g.daubed['a'].size, 2); // FREE + index 0 only
});

test('bingo claim rejected without a full line; accepted with a valid top-row line', () => {
  const g = newGame(['a', 'b', 'c']);
  const nums = [5, 16, 31, 46, 61]; // top row indices 0..4
  setCard(g, 'a', cardWithTopRow(nums));
  call(g, nums);
  for (let i = 0; i < 4; i++) g.handleAction('a', { type: 'daub', index: i });
  // only 4 of 5 top-row cells daubed → no bingo yet
  g.handleAction('a', { type: 'bingo' });
  assert(!g.finishRank['a'], 'bingo rejected with incomplete line');
  g.handleAction('a', { type: 'daub', index: 4 });
  g.handleAction('a', { type: 'bingo' });
  eq(g.finishRank['a'], 1); // first valid bingo → rank 1
});

test('HIDDEN INFO: getStateForPlayer never exposes opponent card values', () => {
  const g = newGame(['a', 'b']);
  setCard(g, 'a', cardWithTopRow([5, 16, 31, 46, 61]));
  setCard(g, 'b', cardWithTopRow([7, 17, 32, 47, 62]));
  const sa = g.getStateForPlayer('a');
  const json = JSON.stringify(sa);
  // b's numbers must not appear (7,17,32,47,62 are b's, not on a's card)
  for (const v of [7, 17, 32, 47, 62]) {
    assert(!json.includes(`"value":${v}`), `opponent value ${v} not leaked`);
  }
  // opponents block carries only counts/flags, not cells
  for (const opp of sa.opponents) {
    assert(!('myCard' in opp) && !('card' in opp) && !('cells' in opp), 'no opponent cells');
    assert(typeof opp.daubCount === 'number', 'opponent daub count present');
  }
});

test('call timer advances the called set on a tick and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.calledOrder.length;
  const emits = g.emitCount;
  advance(3000);
  eq(g.calledOrder.length, before + 1);
  assert(g.emitCount > emits, 'broadcast on call tick');
});

test('ping forces a call when the deadline has passed', () => {
  const g = newGame(['a', 'b']);
  const before = g.calledOrder.length;
  // jump the virtual clock to/after the deadline WITHOUT firing the timer, then ping
  const dl = g._callDeadline;
  // advancing fires the real timer; instead set now via a 0-fire trick: use advance to deadline
  // (advance will fire the timer; to isolate ping, build a fresh game and clear timers)
  g._clearTimers();
  g._callDeadline = dl;
  // simulate time passing past the deadline by advancing (no timers pending now)
  advance(3001);
  g.handleAction('a', { type: 'ping' });
  eq(g.calledOrder.length, before + 1);
});

test('ends after MAX_CALLS numbers called; finished + getResults ranks all N', () => {
  for (const N of [2, 3, 4]) {
    const g = newGame(Array.from({ length: N }, (_, i) => `p${i}`));
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) advance(3000);
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  }
});

test('all-but-one bingo ends the game; finish order = placement', () => {
  const g = newGame(['a', 'b', 'c']);
  const aNums = [5, 16, 31, 46, 61];
  const bNums = [6, 17, 32, 47, 62];
  setCard(g, 'a', cardWithTopRow(aNums));
  setCard(g, 'b', cardWithTopRow(bNums));
  call(g, [...aNums, ...bNums]);
  for (let i = 0; i < 5; i++) g.handleAction('a', { type: 'daub', index: i });
  g.handleAction('a', { type: 'bingo' });    // a -> rank 1
  for (let i = 0; i < 5; i++) g.handleAction('b', { type: 'daub', index: i });
  g.handleAction('b', { type: 'bingo' });    // b -> rank 2; only c remains → end
  eq(g.state, 'finished');
  const res = g.getResults();
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(a.placement, 1);
  eq(b.placement, 2);
  eq(c.placement, 3);
  eq(a.gotBingo, true);
  eq(c.gotBingo, false);
});

test('tie shares a placement (two non-finishers with equal daub counts)', () => {
  const g = newGame(['a', 'b', 'c']);
  // a gets a bingo; b and c each daub exactly the same number of cells → tie for 2nd
  const aNums = [5, 16, 31, 46, 61];
  setCard(g, 'a', cardWithTopRow(aNums));
  setCard(g, 'b', cardWithTopRow([6, 17, 32, 47, 62]));
  setCard(g, 'c', cardWithTopRow([7, 18, 33, 48, 63]));
  call(g, [...aNums, 6, 17, 7, 18]);
  for (let i = 0; i < 5; i++) g.handleAction('a', { type: 'daub', index: i });
  g.handleAction('a', { type: 'bingo' });
  // b daubs indices 0,1 ; c daubs indices 0,1 → both have 3 daubs (incl FREE)
  g.handleAction('b', { type: 'daub', index: 0 });
  g.handleAction('b', { type: 'daub', index: 1 });
  g.handleAction('c', { type: 'daub', index: 0 });
  g.handleAction('c', { type: 'daub', index: 1 });
  // a's bingo left 2 remaining (b,c) so game is still playing; force finish via calls
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) advance(3000);
  const res = g.getResults();
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(a.placement, 1);
  eq(b.placement, c.placement); // tie shared
});

test('placement 1 is first for N in [2,3,4] via a full timed game', () => {
  for (const N of [2, 3, 4]) {
    const g = newGame(Array.from({ length: N }, (_, i) => `q${i}`));
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) advance(3000);
    const res = g.getResults();
    eq(res[0].placement, 1);
  }
});

test('removePlayer mid-game prunes leaver and avoids deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  assert(!g.players.includes('b'), 'leaver pruned from players');
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver not in results');
  eq(g.state, 'playing');
  // one more leaves → all-but-one remain → finish
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

test('leaving a finished bingo recomputes ranks for the rest', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const aNums = [5, 16, 31, 46, 61];
  const bNums = [6, 17, 32, 47, 62];
  setCard(g, 'a', cardWithTopRow(aNums));
  setCard(g, 'b', cardWithTopRow(bNums));
  call(g, [...aNums, ...bNums]);
  for (let i = 0; i < 5; i++) g.handleAction('a', { type: 'daub', index: i });
  g.handleAction('a', { type: 'bingo' }); // a rank 1
  for (let i = 0; i < 5; i++) g.handleAction('b', { type: 'daub', index: i });
  g.handleAction('b', { type: 'bingo' }); // b rank 2 (c,d remain → still playing)
  eq(g.state, 'playing');
  g.removePlayer('a'); // first finisher leaves → b should become rank 1
  eq(g.finishRank['b'], 1);
});

test('destroy clears all timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('BingoBrawl');
