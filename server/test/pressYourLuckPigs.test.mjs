import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { PressYourLuckPigs } from '../src/games/PressYourLuckPigs.js';

installClock();

function newGame(players) {
  const g = new PressYourLuckPigs(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts on the first player\'s turn with an empty pot', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'turn');
  eq(g.currentTurnPlayer, 'a');
  eq(g.turnPot, 0);
  const s = g.getStateForPlayer('a');
  eq(s.isMyTurn, true);
  eq(g.getStateForPlayer('b').isMyTurn, false);
});

test('only the current player may roll or bank', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('b', { type: 'roll' }); // not b's turn
  eq(g.turnPot, 0);
  eq(g.lastRoll, null);
  g.handleAction('b', { type: 'bank' }); // not b's turn
  eq(g.scores['b'] || 0, 0);
});

test('a roll either grows the pot or busts (server-owned die)', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'roll' });
  assert(g.lastRoll >= 1 && g.lastRoll <= 6, 'die in range');
  if (g.lastRoll === 1) { eq(g.state, 'bust'); eq(g.turnPot, 0); }
  else { eq(g.state, 'turn'); eq(g.turnPot, g.lastRoll); }
});

test('banking moves the turn pot into the score and passes the turn', () => {
  const g = newGame(['a', 'b']);
  g.turnPot = 7; // simulate a built-up pot
  g.handleAction('a', { type: 'bank' });
  eq(g.scores['a'], 7);
  eq(g.turnPot, 0);
  eq(g.currentTurnPlayer, 'b'); // turn passed
});

test('rolling a 1 busts (loses the pot) then passes after the flash', () => {
  const g = newGame(['a', 'b']);
  let guard = 0;
  while (g.state === 'turn' && guard++ < 300) g.handleAction('a', { type: 'roll' });
  eq(g.state, 'bust');
  eq(g.turnPot, 0);
  eq(g.scores['a'] || 0, 0);
  advance(2500); // bust flash
  eq(g.state, 'turn');
  eq(g.currentTurnPlayer, 'b');
});

test('per-turn timeout auto-banks the pot', () => {
  const g = newGame(['a', 'b']);
  g.turnPot = 4;
  const before = g.emitCount;
  advance(30000);
  eq(g.scores['a'], 4); // auto-banked
  assert(g.emitCount > before, 'broadcast on timeout');
});

test('full game reaches finished; getResults ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    g.target = 10; // end quickly
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 2000) {
      if (g.state === 'turn') {
        const cur = g.currentTurnPlayer;
        g.handleAction(cur, { type: 'roll' });
        if (g.state === 'turn') g.handleAction(cur, { type: 'bank' });
      } else if (g.state === 'bust') advance(2500);
      else if (g.state === 'gameOver') { for (const p of [...g.players]) g.handleAction(p, { type: 'acknowledge' }); if (g.state === 'gameOver') advance(10000); }
    }
    eq(g.state, 'finished', `n=${n} finished`);
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
  }
});

test('leaving on your turn passes play (no deadlock)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('a'); // current player leaves mid-turn
  assert(g.state === 'turn' || g.state === 'gameOver' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver pruned');
});

test('leaving down to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('PressYourLuckPigs');
