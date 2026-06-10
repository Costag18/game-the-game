import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { LastBidStanding } from '../src/games/LastBidStanding.js';

installClock();

function newGame(players) {
  const g = new LastBidStanding(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in tick with equal bankrolls and a tick timer armed', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'tick');
  eq(g.bankroll['a'], 100);
  eq(g.bankroll['b'], 100);
  eq(g.bankroll['c'], 100);
  eq(g.tickNumber, 1);
  assert(pendingTimers() >= 1, 'tick timer armed');
});

test('RAISE is all-pay: the tick cost is deducted server-side even before resolve', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'raise' });
  g.handleAction('b', { type: 'raise' });
  g.handleAction('c', { type: 'drop' });
  // c dropped → a & b raised → both pay 5, both still in
  eq(g.bankroll['a'], 95);
  eq(g.bankroll['b'], 95);
  eq(g.sunk['a'], 5);
  eq(g.sunk['b'], 5);
  // c paid nothing (dropped)
  eq(g.bankroll['c'], 100);
  eq(g.sunk['c'], 0);
});

test('a player who cannot afford the tick auto-drops (bankroll-validated)', () => {
  const g = newGame(['a', 'b']);
  // drain a down to 3 (< tickCost 5) by hand
  g.bankroll['a'] = 3;
  // re-enter a tick so the broke-check runs
  // simulate: both still in, new tick — force the auto-drop by re-running onEnterTick
  g.choices = {};
  g.state = 'tick';
  g.onEnterTick();
  // a can't afford → auto-dropped already
  eq(g.choices['a'], 'drop');
  // an explicit over-bankroll RAISE from a is rejected → coerced to drop, never spends what it lacks
  g.bankroll['a'] = 3;
  const before = g.bankroll['a'];
  g.handleAction('a', { type: 'raise' });
  eq(g.choices['a'], 'drop');
  eq(g.bankroll['a'], before); // never went negative / never spent unowned coins
});

test('HIDDEN-INFO: my pending choice is private; opponents never see my choice pre-resolve', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'raise' });
  // a sees its own choice
  const sa = g.getStateForPlayer('a');
  eq(sa.myChoice, 'raise');
  // b must NOT learn a's choice anywhere in its view
  const sb = g.getStateForPlayer('b');
  eq(sb.myChoice, null);
  const blob = JSON.stringify(sb);
  // b's view may say a is "locked" (count), but never the literal choice value for a
  const aEntry = sb.players.find((p) => p.playerId === 'a');
  assert(!('choice' in aEntry), 'opponent entry must not carry a choice field');
  assert(aEntry.locked === true, 'opponent shown as locked (count only)');
  // the only "raise"/"drop" string about a must not be exposed — b only knows locked boolean
  // (b has not chosen, so no legitimate raise/drop string should appear for b either)
  assert(!blob.includes('"myChoice":"raise"'), 'no leaked raise choice in opponent view');
});

test('jackpot pays the last player standing and ranks reverse-elimination', () => {
  const g = newGame(['a', 'b', 'c']);
  // tick 1: c drops, a & b raise
  g.handleAction('c', { type: 'drop' });
  g.handleAction('a', { type: 'raise' });
  g.handleAction('b', { type: 'raise' });
  eq(g.state, 'reveal');
  // intermission → next tick
  advance(3_000);
  eq(g.state, 'tick');
  eq(g.tickNumber, 2);
  // tick 2: b drops, a raises → a alone → a wins
  g.handleAction('b', { type: 'drop' });
  g.handleAction('a', { type: 'raise' });
  eq(g.state, 'reveal');
  eq(g.winner, 'a');
  // a paid 5 (t1) + 5 (t2) = 10 sunk, bankroll 100-10+50 jackpot = 140
  eq(g.sunk['a'], 10);
  eq(g.bankroll['a'], 140);
  // finish the final scoreboard
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'acknowledge' });
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res[0].playerId, 'a');
  eq(res[0].placement, 1);
  eq(res[0].isWinner, true);
  // b dropped tick 2 (later) → ranks above c who dropped tick 1
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(b.placement, 2);
  eq(c.placement, 3);
});

test('same-tick drops SHARE a placement', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  // tick 1: b and c both drop together; a and d raise
  g.handleAction('b', { type: 'drop' });
  g.handleAction('c', { type: 'drop' });
  g.handleAction('a', { type: 'raise' });
  g.handleAction('d', { type: 'raise' });
  eq(g.state, 'reveal');
  advance(3_000);
  eq(g.state, 'tick');
  // tick 2: d drops, a raises → a wins
  g.handleAction('d', { type: 'drop' });
  g.handleAction('a', { type: 'raise' });
  for (const p of ['a', 'b', 'c', 'd']) g.handleAction(p, { type: 'acknowledge' });
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 4);
  eq(res.find((r) => r.playerId === 'a').placement, 1);
  eq(res.find((r) => r.playerId === 'd').placement, 2);
  // b and c dropped on the same (first) tick → share placement 3
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(b.placement, 3);
  eq(c.placement, 3);
  // every player appears exactly once
  eq(new Set(res.map((r) => r.playerId)).size, 4);
});

test('tick timer auto-resolves non-responders as DROP and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  // only a raises; b and c never respond
  g.handleAction('a', { type: 'raise' });
  const before = g.emitCount;
  advance(8_000); // tick window expires
  assert(g.emitCount > before, 'broadcast on tick timeout');
  // a is the lone raiser → a wins
  eq(g.winner, 'a');
  assert(g.state === 'reveal' || g.state === 'finished', `resolved (got ${g.state})`);
  // b & c never paid (they dropped via timeout)
  eq(g.sunk['b'], 0);
  eq(g.sunk['c'], 0);
});

for (const N of [2, 3, 4]) {
  test(`full game with N=${N} reaches finished, getResults length ${N}, placement 1 first`, () => {
    const g = newGame(Array.from({ length: N }, (_, i) => `p${i}`));
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'tick') {
        // each IN player: everyone raises except the lowest-index in-player drops,
        // guaranteeing the field shrinks by one each tick until a single winner.
        const ins = g.inPlayers.slice();
        ins.forEach((p, idx) => {
          if (idx === 0 && ins.length > 1) g.handleAction(p, { type: 'drop' });
          else g.handleAction(p, { type: 'raise' });
        });
      } else if (g.state === 'reveal') {
        for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
        // if the intermission timer is what's pending, fire it
        if (g.state === 'reveal') advance(3_000);
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every roster player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
    // placements are non-decreasing and start at 1
    eq(res[0].placement, 1);
    for (let i = 1; i < res.length; i++) assert(res[i].placement >= res[i - 1].placement, 'placements non-decreasing');
  });
}

test('removePlayer mid-tick advances with no deadlock (leaver pruned from results)', () => {
  const g = newGame(['a', 'b', 'c']);
  // a raises, b raises, c is about to act but LEAVES
  g.handleAction('a', { type: 'raise' });
  g.handleAction('b', { type: 'raise' });
  g.removePlayer('c'); // c gone → a & b both chose → resolve
  // a & b both raised → still 2 in → moves to reveal intermission
  assert(g.state === 'reveal' || g.state === 'tick', `no deadlock (got ${g.state})`);
  // c never appears in results
  // advance to a finish so we can inspect results
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 50) {
    if (g.state === 'tick') {
      const ins = g.inPlayers.slice();
      ins.forEach((p, idx) => g.handleAction(p, { type: idx === 0 && ins.length > 1 ? 'drop' : 'raise' }));
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      if (g.state === 'reveal') advance(3_000);
    }
  }
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave collapsing to one player finishes immediately', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 1);
  eq(res[0].playerId, 'a');
  eq(res[0].placement, 1);
});

test('leave during a live tick when only one remains IN gives a walkover win', () => {
  const g = newGame(['a', 'b', 'c']);
  // c drops first so a & b remain
  g.handleAction('c', { type: 'drop' });
  g.handleAction('a', { type: 'raise' });
  g.handleAction('b', { type: 'raise' });
  advance(3_000); // -> tick 2, a & b in
  eq(g.state, 'tick');
  // b leaves mid-tick → a is the only one IN → walkover
  g.removePlayer('b');
  assert(g.winner === 'a' || g.inPlayers[0] === 'a', 'a wins the walkover');
});

test('destroy() clears all timers', () => {
  const g = newGame(['a', 'b', 'c']);
  assert(pendingTimers() >= 1, 'a timer is pending mid-game');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('LastBidStanding');
