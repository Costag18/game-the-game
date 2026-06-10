import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { DominoDrift } from '../src/games/DominoDrift.js';

installClock();

function newGame(players) {
  const g = new DominoDrift(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Deterministic state setup helper: forcibly install hands + train so we can test
// exact rules without fighting the shuffle. Boneyard left empty unless given.
function rig(g, { hands, leftEnd, rightEnd, train, boneyard = [], turn }) {
  g.hands = {};
  for (const [pid, tiles] of Object.entries(hands)) g.hands[pid] = tiles.map((t) => [...t]);
  g.leftEnd = leftEnd;
  g.rightEnd = rightEnd;
  g.train = (train || [[leftEnd, rightEnd]]).map((t) => [...t]);
  g.boneyard = boneyard.map((t) => [...t]);
  g.consecutivePasses = 0;
  g.setTurnPlayer(turn || g.players[0]);
  g._armTurnTimer();
}

test('deals 7 private tiles each, seeds a train with two open ends', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'playing');
  for (const p of g.players) eq(g.hands[p].length, 7);
  assert(g.leftEnd >= 0 && g.leftEnd <= 6, 'left end valid pip');
  assert(g.rightEnd >= 0 && g.rightEnd <= 6, 'right end valid pip');
  eq(g.train.length, 1);
  assert(pendingTimers() >= 1, 'turn timer armed');
});

test('a legal PLAY on the right end attaches and flips the open end', () => {
  const g = newGame(['a', 'b']);
  rig(g, {
    hands: { a: [[3, 5]], b: [[0, 0]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], turn: 'a',
  });
  // a plays [3,5] on R: 3 matches rightEnd(3) -> new right end = 5
  g.handleAction('a', { type: 'play', tileIndex: 0, end: 'R' });
  eq(g.rightEnd, 5);
  eq(g.leftEnd, 2);
  eq(g.hands['a'].length, 0); // emptied -> finished
  eq(g.state, 'finished');
  eq(g.winnerId, 'a');
});

test('a legal PLAY on the left end flips the left open end', () => {
  const g = newGame(['a', 'b']);
  rig(g, {
    hands: { a: [[6, 2], [4, 4]], b: [[0, 0]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], turn: 'a',
  });
  // a plays [6,2] on L: 2 matches leftEnd(2) -> new left end = 6
  g.handleAction('a', { type: 'play', tileIndex: 0, end: 'L' });
  eq(g.leftEnd, 6);
  eq(g.rightEnd, 3);
  eq(g.hands['a'].length, 1);
  eq(g.currentTurnPlayer, 'b'); // turn advanced
});

test('an ILLEGAL play (half does not match the chosen end) is rejected', () => {
  const g = newGame(['a', 'b']);
  rig(g, {
    hands: { a: [[5, 6]], b: [[0, 0]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], turn: 'a',
  });
  g.handleAction('a', { type: 'play', tileIndex: 0, end: 'R' }); // 5/6 vs end 3 -> no
  eq(g.hands['a'].length, 1); // unchanged
  eq(g.rightEnd, 3);
  eq(g.currentTurnPlayer, 'a'); // still a's turn
});

test('out-of-turn action is rejected', () => {
  const g = newGame(['a', 'b']);
  rig(g, {
    hands: { a: [[3, 5]], b: [[3, 1]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], turn: 'a',
  });
  g.handleAction('b', { type: 'play', tileIndex: 0, end: 'R' }); // not b's turn
  eq(g.hands['b'].length, 1);
  eq(g.currentTurnPlayer, 'a');
});

test('DRAW keeps the turn; PASS only legal with empty boneyard and no play', () => {
  const g = newGame(['a', 'b']);
  rig(g, {
    hands: { a: [[6, 6]], b: [[1, 1]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], boneyard: [[5, 5]], turn: 'a',
  });
  // a cannot play (6/6 vs 2/3). pass illegal while boneyard non-empty.
  g.handleAction('a', { type: 'pass' });
  eq(g.currentTurnPlayer, 'a'); // pass refused
  // draw: gets [5,5], still a's turn, boneyard now empty
  g.handleAction('a', { type: 'draw' });
  eq(g.hands['a'].length, 2);
  eq(g.boneyardCount ?? g.boneyard.length, 0);
  eq(g.currentTurnPlayer, 'a');
  // still cannot play (6/6 and 5/5 vs 2/3); now pass is allowed
  g.handleAction('a', { type: 'pass' });
  eq(g.currentTurnPlayer, 'b'); // turn advanced after legal pass
});

test('HIDDEN INFO: opponent tile contents never appear in getStateForPlayer', () => {
  const g = newGame(['a', 'b', 'c']);
  rig(g, {
    hands: { a: [[3, 5]], b: [[6, 1], [2, 2]], c: [[0, 4]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], turn: 'a',
  });
  const s = g.getStateForPlayer('a');
  const json = JSON.stringify(s);
  // a's own tile is present...
  assert(json.includes('[3,5]') || json.includes('[ 3, 5 ]'), 'my own tile present');
  // ...opponent b/c tiles must NOT leak
  assert(!json.includes('[6,1]'), "b's tile leaked");
  assert(!json.includes('[2,2]'), "b's tile leaked");
  assert(!json.includes('[0,4]'), "c's tile leaked");
  // opponents reported as counts only
  const bEntry = s.players.find((p) => p.playerId === 'b');
  eq(bEntry.tileCount, 2);
  assert(!('hand' in bEntry) && !('tiles' in bEntry), 'no opponent hand field');
});

test('turn timer auto-acts on timeout (auto-play) and broadcasts', () => {
  const g = newGame(['a', 'b']);
  rig(g, {
    hands: { a: [[3, 5], [6, 6]], b: [[0, 0]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], turn: 'a',
  });
  const before = g.emitCount;
  advance(30_000); // a's turn times out -> auto-plays [3,5] on R
  assert(g.emitCount > before, 'broadcast on timeout');
  eq(g.rightEnd, 5);
  eq(g.currentTurnPlayer, 'b');
});

test('turn timer auto-PASS when locked (empty boneyard, no play) advances', () => {
  const g = newGame(['a', 'b']);
  rig(g, {
    hands: { a: [[6, 6]], b: [[1, 1]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], boneyard: [], turn: 'a',
  });
  advance(30_000); // a auto-passes
  eq(g.currentTurnPlayer, 'b');
  eq(g.consecutivePasses, 1);
});

test('a full game finishes; getResults ranks all N with winner at placement 1, ascending pips', () => {
  for (const N of [2, 3, 4]) {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 5000) {
      // drive every turn via the engine's own auto-act for determinism
      g._autoAct(g.currentTurnPlayer);
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // ascending pip-sum ordering, placements monotonic non-decreasing
    for (let i = 1; i < res.length; i++) {
      assert(res[i].pips >= res[i - 1].pips, `pips ascending (N=${N})`);
      assert(res[i].placement >= res[i - 1].placement, `placement monotonic (N=${N})`);
    }
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  }
});

test('tie shares a placement (locked game, two players equal pips)', () => {
  const g = newGame(['a', 'b', 'c']);
  rig(g, {
    hands: { a: [[6, 6]], b: [[6, 6]], c: [[5, 5]] }, // a,b = 12 pips, c = 10
    leftEnd: 0, rightEnd: 1, train: [[0, 1]], boneyard: [], turn: 'c',
  });
  // c can't play (5/5 vs 0/1), boneyard empty -> auto resolve everyone to lock
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 20) g._autoAct(g.currentTurnPlayer);
  eq(g.state, 'finished');
  eq(g.endReason, 'locked');
  const res = g.getResults();
  // c (10 pips) is 1st; a & b (12 each) tie for 2nd
  const c = res.find((r) => r.playerId === 'c');
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  eq(c.placement, 1);
  eq(a.placement, b.placement);
  eq(a.placement, 2);
});

test('removePlayer mid-turn advances (no deadlock) and prunes the leaver', () => {
  const g = newGame(['a', 'b', 'c']);
  rig(g, {
    hands: { a: [[3, 5]], b: [[6, 1]], c: [[0, 4]] },
    leftEnd: 2, rightEnd: 3, train: [[2, 3]], turn: 'a',
  });
  g.removePlayer('a'); // current player leaves
  assert(!g.players.includes('a'), 'leaver pruned from players');
  assert(!('a' in g.hands), 'leaver hand pruned');
  assert(g.state === 'playing', 'game continues');
  assert(g.currentTurnPlayer === 'b' || g.currentTurnPlayer === 'c', 'turn on a present player');
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver not in results');
});

test('collapse to one player finishes the game', () => {
  const g = newGame(['a', 'b']);
  g.removePlayer('a');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(g.winnerId, 'b');
});

test('destroy() clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  assert(pendingTimers() >= 1, 'a timer is pending');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('DominoDrift');
