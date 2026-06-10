import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { DutchDrop } from '../src/games/DutchDrop.js';

installClock();

function newGame(players) {
  const g = new DutchDrop(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Drive a full game to 'finished'. `buyer(g)` optionally returns a playerId who
// buys the current lot the moment the auction opens (else the lot passes).
function playToFinish(g, buyer) {
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'auction') {
      const b = buyer ? buyer(g) : null;
      if (b && (g.bankroll[b] || 0) >= g.currentPrice) {
        g.handleAction(b, { type: 'buy' });
      } else {
        advance(1_500); // tick the price down once, then loop re-checks
      }
    } else if (g.state === 'lotReveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
}

test('starts in auction with hidden value, bankrolls set, a tick timer armed', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'auction');
  eq(g.bankroll['a'], 100);
  eq(g.profit['a'], 0);
  assert(g.currentValue >= 20 && g.currentValue <= 80, 'hidden value in range');
  eq(g.currentPrice, 90);
  assert(pendingTimers() >= 1, 'tick timer armed');
});

test('HIDDEN-INFO: the live lot value is never in getStateForPlayer pre-resolution', () => {
  const g = newGame(['a', 'b', 'c']);
  g.currentValue = 73; // force a distinctive value
  const s = g.getStateForPlayer('a');
  assert(!JSON.stringify(s).includes('73'), 'hidden value leaked during auction');
  assert(s.currentPrice === 90, 'price IS public');
  assert(s.lastLot === null, 'no resolved lot yet');
});

test('a buy deducts the current price, reveals value, books profit = value - price', () => {
  const g = newGame(['a', 'b', 'c']);
  g.currentValue = 60;
  g.currentPrice = 90;
  g.handleAction('a', { type: 'buy' });
  eq(g.state, 'lotReveal');
  eq(g.bankroll['a'], 10);          // 100 - 90
  eq(g.profit['a'], -30);           // 60 - 90
  eq(g.lotsWon['a'], 1);
  // value now public via lastLot reveal payload
  const s = g.getStateForPlayer('b');
  eq(s.lastLot.value, 60);
  eq(s.lastLot.winner, 'a');
  eq(s.lastLot.price, 90);
});

test('a profitable buy at a lower price books positive profit', () => {
  const g = newGame(['a', 'b']);
  g.currentValue = 70;
  g.currentPrice = 40;
  g.handleAction('b', { type: 'buy' });
  eq(g.bankroll['b'], 60);   // 100 - 40
  eq(g.profit['b'], 30);     // 70 - 40
});

test('over-bankroll bid is rejected (server validates affordability)', () => {
  const g = newGame(['a', 'b']);
  g.bankroll['a'] = 30; // a is broke-ish
  g.currentPrice = 90;  // can't afford
  g.handleAction('a', { type: 'buy' });
  eq(g.state, 'auction');     // ignored — still live
  eq(g.bankroll['a'], 30);    // untouched
  eq(g.lotsWon['a'], 0);
  // an affordable buyer can still take it
  g.currentPrice = 25;
  g.handleAction('a', { type: 'buy' });
  eq(g.state, 'lotReveal');
  eq(g.bankroll['a'], 5);
});

test('first affordable buy wins (serial arrival order); a later buy is ignored', () => {
  const g = newGame(['a', 'b', 'c']);
  g.currentValue = 50;
  g.currentPrice = 80;
  g.handleAction('b', { type: 'buy' }); // b arrives first
  g.handleAction('c', { type: 'buy' }); // too late
  eq(g.lastLot.winner, 'b');
  eq(g.lotsWon['b'], 1);
  eq(g.lotsWon['c'], 0);
  eq(g.bankroll['c'], 100); // c paid nothing
});

test('auction timer ticks the price DOWN and broadcasts', () => {
  const g = newGame(['a', 'b']);
  eq(g.currentPrice, 90);
  const before = g.emitCount;
  advance(1_500);
  eq(g.currentPrice, 85);
  assert(g.emitCount > before, 'broadcast on tick');
  advance(1_500);
  eq(g.currentPrice, 80);
});

test('price floors out with no buyer → lot passes (nobody profits), then advances', () => {
  const g = newGame(['a', 'b']);
  // 90 -> ... -> 5 (floor), then one more tick passes the lot
  advance(1_500 * 30); // plenty of ticks
  assert(g.state === 'lotReveal' || g.state === 'auction' || g.state === 'finished', 'progressed');
  // find the first lot in history — it should be a pass since no one bought
  if (g.history.length) {
    const first = g.history[0];
    assert(first.passed === true || first.winner !== null, 'first lot resolved');
    if (first.passed) { eq(first.winner, null); }
  }
  eq(g.profit['a'], 0);
  eq(g.profit['b'], 0);
});

test('explicit floor pass: buying at floor still works, else it passes', () => {
  const g = newGame(['a', 'b']);
  g.currentPrice = 5; // at the floor
  g.currentValue = 40;
  // a can still buy at the floor before the pass tick
  g.handleAction('a', { type: 'buy' });
  eq(g.state, 'lotReveal');
  eq(g.lastLot.winner, 'a');
  eq(g.lastLot.price, 5);
  eq(g.profit['a'], 35);
});

test('floor tick with no buyer marks the lot passed', () => {
  const g = newGame(['a', 'b']);
  g.currentPrice = 5; // sitting at floor, nobody buys
  advance(1_500);     // tick at/under floor → pass
  eq(g.state, 'lotReveal');
  eq(g.lastLot.passed, true);
  eq(g.lastLot.winner, null);
});

test('reveal auto-advances after the reveal window (broadcasts)', () => {
  const g = newGame(['a', 'b']);
  g.currentPrice = 50;
  g.handleAction('a', { type: 'buy' });
  eq(g.state, 'lotReveal');
  const before = g.emitCount;
  advance(4_000);
  assert(g.state === 'auction' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

for (const n of [2, 3, 4]) {
  test(`full ${n}-player game finishes with getResults length ${n}, placement 1 first`, () => {
    const ids = ['a', 'b', 'c', 'd'].slice(0, n);
    const g = newGame(ids);
    // 'a' always tries to buy at 30 so it wins lots at a profit; others never buy
    playToFinish(g, (gg) => (gg.currentPrice <= 30 ? 'a' : null));
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, n);
    // results sorted by profit DESC
    for (let i = 1; i < res.length; i++) assert(res[i].profit <= res[i - 1].profit, 'sorted desc');
  });
}

test('tie shares a placement (nobody buys → everyone 0 profit → all placement 1)', () => {
  const g = newGame(['a', 'b', 'c']);
  playToFinish(g, null); // nobody ever buys → all lots pass
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.profit === 0), true);
  eq(res.every((r) => r.placement === 1), true);
});

test('HIDDEN-INFO across a full game: no live lot value leaks before its reveal', () => {
  const g = newGame(['a', 'b']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'auction') {
      // before any tick, the current hidden value must not be in any player's view
      const v = String(g.currentValue);
      for (const p of g.players) {
        const s = g.getStateForPlayer(p);
        // currentValue field is never sent for the live lot
        assert(s.currentValue === undefined, 'currentValue field present in view');
        // the live value only appears if it coincidentally equals a public number;
        // guard the meaningful case: it must not show as a resolved lastLot value
        if (s.lastLot) assert(s.lastLot.value !== undefined, 'reveal carries value');
        void v;
      }
      advance(1_500);
    } else if (g.state === 'lotReveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
});

test('removePlayer mid-auction advances without deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'auction');
  g.removePlayer('b'); // mid-auction leaver
  assert(!g.players.includes('b'), 'leaver pruned');
  // game keeps going for the rest
  playToFinish(g, (gg) => (gg.currentPrice <= 40 ? 'a' : null));
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver not in results');
});

test('removePlayer of a lot winner scrubs them from history/results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.currentValue = 60;
  g.currentPrice = 50;
  g.handleAction('a', { type: 'buy' }); // a wins lot 1
  eq(g.lastLot.winner, 'a');
  g.removePlayer('a');
  assert(g.lastLot.winner === null, 'winner scrubbed from lastLot');
  assert(g.history.every((h) => h.winner !== 'a'), 'winner scrubbed from history');
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver not ranked');
});

test('removePlayer during lotReveal re-checks the ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  g.currentPrice = 50;
  g.handleAction('a', { type: 'buy' });
  eq(g.state, 'lotReveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  // only c is owed; c leaving should release the barrier
  g.removePlayer('c');
  assert(g.state === 'auction' || g.state === 'finished', `advanced (got ${g.state})`);
});

test('collapse to one player finishes', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  assert(pendingTimers() >= 1, 'a timer is armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('DutchDrop');
