import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { BsCheat } from '../src/games/BsCheat.js';

installClock();

function newGame(players) {
  const g = new BsCheat(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const C = (rank, suit = 'hearts') => ({ rank, suit });

test('deals all 52 cards, evenly (±1), no duplicates; starts playing on seat 0', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  eq(g.state, 'playing');
  eq(g.requiredRank, 1);
  eq(g.currentTurnPlayer, 'a');
  const counts = g.players.map((p) => g.hands[p].length);
  eq(counts.reduce((s, n) => s + n, 0), 52);
  assert(Math.max(...counts) - Math.min(...counts) <= 1, 'even within 1');
  const seen = new Set();
  for (const p of g.players) for (const c of g.hands[p]) {
    const k = `${c.rank}-${c.suit}`;
    assert(!seen.has(k), 'no duplicate card');
    seen.add(k);
  }
  eq(seen.size, 52);
});

test('place moves cards to the pile and opens the challenge window', () => {
  const g = newGame(['a', 'b']);
  g.requiredRank = 5;
  g.hands['a'] = [C(5), C(5), C(9)];
  g.setTurnPlayer('a');
  const handBefore = g.hands['a'].length;
  g.handleAction('a', { type: 'place', cards: [0, 1] });
  eq(g.state, 'challengeWindow');
  eq(g.pendingPlay.claimedCount, 2);
  eq(g.pendingPlay.claimedRank, 5);
  eq(g.pile.length, 2);
  eq(g.hands['a'].length, handBefore - 2);
});

test('no challenge within the window advances the turn and rotates the rank', () => {
  const g = newGame(['a', 'b', 'c']);
  g.requiredRank = 5;
  g.hands['a'] = [C(5), C(6), C(7)];
  g.setTurnPlayer('a');
  g.handleAction('a', { type: 'place', cards: [0] });
  eq(g.state, 'challengeWindow');
  advance(4000); // challenge window expires
  eq(g.state, 'playing');
  eq(g.requiredRank, 6, 'rank rotated +1');
  eq(g.currentTurnPlayer, 'b', 'turn advanced');
  eq(g.pile.length, 1, 'pile unchanged (committed)');
});

test('truthful play challenged: the challenger takes the pile', () => {
  const g = newGame(['a', 'b', 'c']);
  g.requiredRank = 5;
  g.hands['a'] = [C(5), C(5), C(9)];
  g.hands['b'] = [C(2)];
  g.setTurnPlayer('a');
  g.handleAction('a', { type: 'place', cards: [0, 1] }); // two real 5s
  const pileSize = g.pile.length;
  g.handleAction('b', { type: 'callBS' });
  eq(g.state, 'reveal');
  eq(g.revealResult.liar, false);
  eq(g.revealResult.takerId, 'b');
  eq(g.hands['b'].length, 1 + pileSize, 'challenger scooped the pile');
  eq(g.pile.length, 0);
});

test('lying play challenged: the liar takes the pile', () => {
  const g = newGame(['a', 'b']);
  g.requiredRank = 5;
  g.hands['a'] = [C(5), C(9), C(3)];
  g.setTurnPlayer('a');
  g.handleAction('a', { type: 'place', cards: [0, 1] }); // a 5 and a 9 -> lie
  const pileSize = g.pile.length;
  const aBefore = g.hands['a'].length;
  g.handleAction('b', { type: 'callBS' });
  eq(g.revealResult.liar, true);
  eq(g.revealResult.takerId, 'a');
  eq(g.hands['a'].length, aBefore + pileSize, 'liar scooped the pile');
});

test('requiredRank wraps King(13) -> Ace(1)', () => {
  const g = newGame(['a', 'b']);
  g.requiredRank = 13;
  g.hands['a'] = [C(13), C(4)];
  g.setTurnPlayer('a');
  g.handleAction('a', { type: 'place', cards: [0] });
  advance(4000);
  eq(g.requiredRank, 1);
});

test('emptying your hand on an un-challenged play finishes you (still in roster)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.requiredRank = 5;
  g.hands['a'] = [C(5), C(6)];
  g.setTurnPlayer('a');
  g.handleAction('a', { type: 'place', cards: [0, 1] });
  advance(4000); // no challenge -> commit
  assert(g.finishOrder.includes('a'), 'a finished');
  assert(g.players.includes('a'), 'a still in roster (scored)');
  assert(!g.activePlayers.includes('a'), 'a out of rotation');
  eq(g.state, 'playing'); // b, c continue
});

test('last two players: one empties -> finished; getResults ranks all 1..N', () => {
  const g = newGame(['a', 'b']);
  g.requiredRank = 5;
  g.hands['a'] = [C(5), C(6)];
  g.hands['b'] = [C(7), C(8), C(9)];
  g.setTurnPlayer('a');
  g.handleAction('a', { type: 'place', cards: [0, 1] });
  advance(4000);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 2);
  eq(res[0].playerId, 'a');
  eq(res[0].placement, 1);
  eq(res[1].placement, 2);
});

test('getResults covers everyone once; non-finisher ties share placement', () => {
  const g = newGame(['a', 'b', 'c']);
  g.finishOrder = ['a'];
  g.hands['b'] = [C(2), C(3)];
  g.hands['c'] = [C(4), C(5)]; // same count as b -> tie
  const res = g.getResults();
  eq(res.length, 3);
  const ids = new Set(res.map((r) => r.playerId));
  eq(ids.size, 3);
  eq(res.find((r) => r.playerId === 'a').placement, 1);
  eq(res.find((r) => r.playerId === 'b').placement, 2);
  eq(res.find((r) => r.playerId === 'c').placement, 2); // tie
});

test('current player leaving during playing advances the turn, no crash', () => {
  const g = newGame(['a', 'b', 'c']);
  g.setTurnPlayer('a');
  const rankBefore = g.requiredRank;
  g.removePlayer('a');
  assert(!g.players.includes('a'));
  eq(g.state, 'playing');
  assert(g.players.includes(g.currentTurnPlayer), 'turn on a present player');
  eq(g.requiredRank, (rankBefore % 13) + 1, 'skipped claim rotated the rank');
});

test('claimant leaving mid challenge-window commits the play and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  g.requiredRank = 5;
  g.hands['a'] = [C(5), C(6)];
  g.setTurnPlayer('a');
  g.handleAction('a', { type: 'place', cards: [0] });
  eq(g.state, 'challengeWindow');
  g.removePlayer('a'); // claimant vanishes
  eq(g.state, 'playing');
  assert(!g.players.includes('a'));
  eq(pendingTimers() >= 0, true); // no orphan challenge timer crash
});

test('reveal timer auto-acks and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  g.requiredRank = 5;
  g.hands['a'] = [C(5), C(9)];
  g.setTurnPlayer('a');
  g.handleAction('a', { type: 'place', cards: [0, 1] }); // lie
  g.handleAction('b', { type: 'callBS' });
  eq(g.state, 'reveal');
  advance(10_000);
  eq(g.state, 'playing'); // advanced
});

test('turn timer auto-plays the lowest single card', () => {
  const g = newGame(['a', 'b']);
  g.requiredRank = 5;
  g.hands['a'] = [C(9), C(3), C(7)]; // lowest is the 3 at index 1
  g.setTurnPlayer('a');
  advance(30_000); // turn timer (armed for seat 0 = 'a' since startGame)
  eq(g.state, 'challengeWindow');
  eq(g.pile.length, 1);
  eq(g.pendingPlay.claimedRank, 5);
  eq(g.hands['a'].length, 2);
});

test('leaving until one remains finishes the game and clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.activePlayers.length <= 1, true);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('destroy clears all timers', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('BsCheat');
