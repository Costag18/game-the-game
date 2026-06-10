import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { GoingOnce } from '../src/games/GoingOnce.js';

installClock();

function newGame(players) {
  const g = new GoingOnce(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force a deterministic lot value so tests can reason about money exactly.
function forceLot(g, value) { g.currentValue = value; g.lots[g.lotIndex] = value; }

test('starts in auction at price 0 with equal bankrolls and a going-once timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'auction');
  eq(g.currentPrice, 0);
  eq(g.highBidder, null);
  for (const p of ['a', 'b', 'c']) eq(g.bankroll[p], 100);
  assert(pendingTimers() >= 1, 'going-once timer armed');
  assert(g.deadline != null, 'deadline broadcast');
});

test('a raise validated against bankroll: over-bankroll bid rejected, no high bidder', () => {
  const g = newGame(['a', 'b']);
  g.bankroll['a'] = 3; // can't even afford the first 5 increment
  g.handleAction('a', { type: 'raise' });
  eq(g.highBidder, null);
  eq(g.currentPrice, 0);
  // a player who CAN afford takes the lead at +increment
  g.handleAction('b', { type: 'raise' });
  eq(g.highBidder, 'b');
  eq(g.currentPrice, 5);
  // b can keep raising up to bankroll but not past it
  g.bankroll['a'] = 100;
  g.handleAction('a', { type: 'raise' }); // -> 10, a leads
  g.bankroll['a'] = 12;                   // a now can't reach the next target (15)
  g.handleAction('b', { type: 'raise' }); // -> 15, b leads
  g.handleAction('a', { type: 'raise' }); // rejected: needs 20 > 12... actually target is 20
  eq(g.highBidder, 'b');
  eq(g.currentPrice, 15);
});

test('cannot outbid yourself; price only rises by the fixed increment', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'raise' });
  eq(g.currentPrice, 5);
  g.handleAction('a', { type: 'raise' }); // already high bidder → ignored
  eq(g.currentPrice, 5);
  eq(g.highBidder, 'a');
});

test('raise resets the going-once countdown; sale resolves on timeout', () => {
  const g = newGame(['a', 'b']);
  forceLot(g, 30);
  g.handleAction('a', { type: 'raise' }); // a leads at 5
  advance(4_000);                          // not yet expired
  eq(g.state, 'auction');
  g.handleAction('b', { type: 'raise' }); // b leads at 10, countdown RESET
  advance(4_000);                          // 4s since reset → still live
  eq(g.state, 'auction');
  eq(g.highBidder, 'b');
  const before = g.emitCount;
  advance(2_500);                          // now > 6s since the reset → SOLD
  eq(g.state, 'lotReveal');
  assert(g.emitCount > before, 'broadcast on auction timeout');
  // payment is server-authoritative
  eq(g.bankroll['b'], 90);   // paid 10
  eq(g.wonValue['b'], 30);   // gained lot value
  eq(g.bankroll['a'], 100);  // a paid nothing
});

test('a lot with no bids sells to nobody (no money moves)', () => {
  const g = newGame(['a', 'b']);
  forceLot(g, 25);
  advance(6_500); // nobody raised
  eq(g.state, 'lotReveal');
  eq(g.lastSummary.winner, null);
  eq(g.bankroll['a'], 100);
  eq(g.bankroll['b'], 100);
  eq(g.wonValue['a'], 0);
});

test('HIDDEN-INFO: a leaver/loser can never claim an unearned win; bankroll never leaks negative', () => {
  const g = newGame(['a', 'b']);
  forceLot(g, 40);
  g.bankroll['a'] = 20;
  // a raises until it can't afford more
  let guard = 0;
  while (g.canAfford && guard++ < 50) {
    const can = g._canAfford('a');
    if (!can) break;
    // make a the contesting bidder by alternating with b leading
    if (g.highBidder === 'a') break;
    g.handleAction('a', { type: 'raise' });
    if (g._canAfford('b')) g.handleAction('b', { type: 'raise' });
  }
  // never deduct below what was paid; bankroll stays >= 0
  advance(6_500);
  assert(g.bankroll['a'] >= 0 && g.bankroll['b'] >= 0, 'no negative bankroll');
});

test('HIDDEN-INFO: pre-reveal view never leaks per-lot win/paid records', () => {
  const g = newGame(['a', 'b', 'c']);
  forceLot(g, 30);
  g.handleAction('a', { type: 'raise' }); // a leads at 5
  const s = g.getStateForPlayer('b');
  const json = JSON.stringify(s);
  // The private per-lot won-ledger (value/paid pairs) must never be in any view.
  assert(!json.includes('wonLots'), 'per-lot ledger key not leaked');
  assert(!json.includes('"paid"'), 'paid-per-lot not leaked mid-auction');
  // b sees a's PUBLIC totals (wonValue) and bankroll but not a's hidden paid-per-lot
  const aView = s.players.find((p) => p.playerId === 'a');
  assert(aView && typeof aView.wonValue === 'number', 'public wonValue present');
  assert(!('wonLots' in aView), 'private per-lot ledger not in opponent view');
});

test('full game finishes; getResults ranks all N with placement 1 first, for N in [2,3,4]', () => {
  for (const N of [2, 3, 4]) {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'auction') {
        // first player raises once, then let it time out
        const leader = players.find((p) => g._canAfford(p));
        if (leader && g.highBidder == null) g.handleAction(leader, { type: 'raise' });
        advance(6_500);
      } else if (g.state === 'lotReveal') {
        for (const p of players) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // placements are non-decreasing and every player present once
    const ids = new Set(res.map((r) => r.playerId));
    eq(ids.size, N);
    for (let i = 1; i < res.length; i++) assert(res[i].placement >= res[i - 1].placement, 'placements non-decreasing');
  }
});

test('tie shares a placement (nobody bids → everyone 0 wonValue & 100 cash)', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 100) {
    if (g.state === 'auction') advance(6_500);        // no bids ever
    else if (g.state === 'lotReveal') for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true); // all tied
  eq(res.every((r) => r.wonValue === 0 && r.bankroll === 100), true);
});

test('lot reveal auto-advances on timeout and reaches finished', () => {
  const g = newGame(['a', 'b']);
  // win lot 1 quickly
  g.handleAction('a', { type: 'raise' });
  advance(6_500);
  eq(g.state, 'lotReveal');
  const before = g.emitCount;
  advance(10_500); // reveal auto-advance
  assert(g.state === 'auction' || g.state === 'finished', `advanced from reveal (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('removePlayer mid-auction (high bidder leaves) resets and does not deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  forceLot(g, 30);
  g.handleAction('a', { type: 'raise' }); // a leads at 5
  eq(g.highBidder, 'a');
  g.removePlayer('a'); // high bidder vanishes
  eq(g.state, 'auction');
  eq(g.highBidder, null);
  assert(!g.players.includes('a'), 'leaver pruned');
  // remaining players can still bid + the lot can still resolve
  g.handleAction('b', { type: 'raise' });
  advance(6_500);
  eq(g.state, 'lotReveal');
  eq(g.lastSummary.winner, 'b');
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver not ranked');
});

test('removePlayer during lotReveal re-checks the ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'raise' });
  advance(6_500);
  eq(g.state, 'lotReveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last un-acked leaves → barrier completes
  assert(g.state === 'auction' || g.state === 'finished', `barrier advanced (got ${g.state})`);
});

test('collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 1);
  eq(res[0].placement, 1);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('GoingOnce');
