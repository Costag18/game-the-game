import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { SealedVault } from '../src/games/SealedVault.js';

installClock();

function newGame(players) {
  const g = new SealedVault(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in bidding with a hidden lot value and a bid timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'bidding');
  assert(g.lotValue >= 20 && g.lotValue <= 80, 'lot value in range');
  assert(pendingTimers() >= 1, 'bid timer armed');
});

test('HIDDEN-INFO: lot value never leaked in bidding view', () => {
  const g = newGame(['a', 'b', 'c']);
  g.lotValue = 73; // force a known value
  const s = g.getStateForPlayer('a');
  assert(!JSON.stringify(s).includes('73'), 'lot value not leaked pre-reveal');
  assert(s.reveal === null, 'no reveal block during bidding');
});

test('HIDDEN-INFO: opponents sealed bids never leaked in bidding view', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('b', { type: 'bid', amount: 47 }); // b's sealed bid
  const sa = g.getStateForPlayer('a'); // a should NOT see 47 anywhere
  assert(!JSON.stringify(sa).includes('47'), 'opponent sealed bid not leaked');
  const opp = sa.players.find((p) => p.playerId === 'b');
  assert(opp.hasBid === true, 'opponent hasBid flag shown');
  assert(!('amount' in opp) && !('bid' in opp), 'opponent bid amount absent');
  // but b sees their OWN bid
  const sb = g.getStateForPlayer('b');
  eq(sb.myBid, 47);
});

test('a bid over bankroll is rejected; a valid bid is accepted and deducted on win', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'bid', amount: 9999 }); // > 100 bankroll
  eq(g.bids['a'], undefined);
  g.handleAction('a', { type: 'bid', amount: -5 }); // negative
  eq(g.bids['a'], undefined);
  g.handleAction('a', { type: 'bid', amount: 40 }); // valid
  eq(g.bids['a'], 40);
});

test('highest bidder wins: pays their bid, gains lot value, value revealed', () => {
  const g = newGame(['a', 'b', 'c']);
  g.lotValue = 50;
  g.handleAction('a', { type: 'bid', amount: 30 });
  g.handleAction('b', { type: 'bid', amount: 55 });
  g.handleAction('c', { type: 'bid', amount: 10 });
  eq(g.state, 'reveal');
  eq(g.bankroll['b'], 100 - 55); // winner paid their bid
  eq(g.wonValue['b'], 50); // gained lot value
  eq(g.bankroll['a'], 100); // losers pay nothing
  eq(g.bankroll['c'], 100);
  eq(g.revealData.winnerId, 'b');
  eq(g.revealData.lotValue, 50);
  // reveal now discloses everyone's bids
  const bBid = g.revealData.bids.find((x) => x.playerId === 'b');
  eq(bBid.amount, 55); eq(bBid.isWinner, true);
});

test('highest-bid tie resolves to lowest seat (this.players order)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.lotValue = 40;
  g.handleAction('c', { type: 'bid', amount: 50 });
  g.handleAction('b', { type: 'bid', amount: 50 }); // submitted before a, same amount
  g.handleAction('a', { type: 'bid', amount: 50 });
  eq(g.state, 'reveal');
  eq(g.revealData.winnerId, 'a'); // lowest seat wins the tie
  eq(g.bankroll['a'], 50);
});

test('bid timeout auto-resolves (missing bids treated as 0) and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.lotValue = 60;
  g.handleAction('a', { type: 'bid', amount: 25 }); // only a bids
  const before = g.emitCount;
  advance(25_000);
  eq(g.state, 'reveal');
  eq(g.revealData.winnerId, 'a'); // a's 25 beats two auto-0s
  eq(g.bids['b'], 0); eq(g.bids['c'], 0);
  assert(g.emitCount > before, 'broadcast on bid timeout');
});

test('reveal timeout auto-acks and advances to the next lot', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'bid', amount: 10 });
  g.handleAction('b', { type: 'bid', amount: 20 });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(10_000);
  assert(g.state === 'bidding' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function playFullGame(players, bidFn) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 100) {
    if (g.state === 'bidding') {
      for (const p of g.players) g.handleAction(p, { type: 'bid', amount: bidFn(p, g) });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const n of [2, 3, 4]) {
  test(`full ${n}-player game reaches finished; results length ${n}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, n);
    // distinct bids so there is a clear winner each lot (capped to bankroll)
    const g = playFullGame(players, (p, gg) => {
      const base = { a: 30, b: 20, c: 10, d: 5 }[p];
      return Math.min(base, gg.bankroll[p]);
    });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    assert(res.every((r) => r.playerId), 'every player ranked once');
    // a always bid highest → a should win every lot and lead
    eq(res[0].playerId, 'a');
  });
}

test('a tie shares a placement (identical wonValue + bankroll)', () => {
  // everyone bids 0 every lot → lowest seat wins all lots for free; the rest are
  // all tied at 0 wonValue / 100 bankroll → share placement 2.
  const g = playFullGame(['a', 'b', 'c'], () => 0);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res[0].playerId, 'a'); // won every free lot
  // b and c: both 0 wonValue, 100 bankroll → tied
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(b.placement, c.placement);
  eq(b.placement, 2);
});

test('removePlayer mid-auction advances (no deadlock), leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'bid', amount: 10 });
  g.handleAction('b', { type: 'bid', amount: 20 });
  g.removePlayer('c'); // c was the last owed → barrier should complete
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
  // their dropped bid can't win
  assert(g.revealData.winnerId !== 'c', 'leaver did not win');
});

test('leave during reveal re-checks ack barrier and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'bid', amount: 10 });
  g.handleAction('b', { type: 'bid', amount: 20 });
  g.handleAction('c', { type: 'bid', amount: 5 });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last un-acked leaves → advance
  assert(g.state === 'bidding' || g.state === 'finished', `advanced (got ${g.state})`);
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
report('SealedVault');
