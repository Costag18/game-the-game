import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Yahtzee, scoreCategory } from '../src/games/Yahtzee.js';

installClock();

function newGame(players) {
  const g = new Yahtzee(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force a player's dice + roll-state so we can drive deterministic scenarios.
function setDice(g, pid, dice, rollsLeft = 2) {
  g.dice[pid] = dice.slice();
  g.hasRolled[pid] = true;
  g.rollsLeft[pid] = rollsLeft;
}

// --- pure scoring math ------------------------------------------------------

test('scoreCategory computes each category correctly', () => {
  eq(scoreCategory('ones', [1, 1, 3, 4, 1]), 3);
  eq(scoreCategory('sixes', [6, 6, 6, 2, 1]), 18);
  eq(scoreCategory('threeKind', [4, 4, 4, 2, 1]), 15);
  eq(scoreCategory('threeKind', [4, 4, 2, 3, 1]), 0);
  eq(scoreCategory('fourKind', [5, 5, 5, 5, 1]), 21);
  eq(scoreCategory('fourKind', [5, 5, 5, 2, 1]), 0);
  eq(scoreCategory('fullHouse', [2, 2, 2, 5, 5]), 25);
  eq(scoreCategory('fullHouse', [2, 2, 3, 5, 5]), 0);
  eq(scoreCategory('smallStraight', [1, 2, 3, 4, 4]), 30);
  eq(scoreCategory('smallStraight', [1, 2, 3, 5, 6]), 0);
  eq(scoreCategory('largeStraight', [2, 3, 4, 5, 6]), 40);
  eq(scoreCategory('largeStraight', [1, 2, 3, 4, 6]), 0);
  eq(scoreCategory('yahtzee', [3, 3, 3, 3, 3]), 50);
  eq(scoreCategory('yahtzee', [3, 3, 3, 3, 2]), 0);
  eq(scoreCategory('chance', [1, 2, 3, 4, 5]), 15);
});

// --- core rules: legal action mutates; illegal/out-of-turn rejected ---------

test('roll mutates dice, decrements rollsLeft, and keep preserves kept indices', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'turn');
  eq(g.rollsLeft['a'], 3);
  g.handleAction('a', { type: 'roll', keep: [] }); // first roll: keep ignored
  eq(g.hasRolled['a'], true);
  eq(g.rollsLeft['a'], 2);
  const first = g.dice['a'].slice();
  // re-roll keeping indices 0 and 1 — those two faces must be unchanged
  g.handleAction('a', { type: 'roll', keep: [0, 1] });
  eq(g.rollsLeft['a'], 1);
  eq(g.dice['a'][0], first[0]);
  eq(g.dice['a'][1], first[1]);
});

test('cannot roll more than 3 times', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'roll', keep: [] });
  g.handleAction('a', { type: 'roll', keep: [] });
  g.handleAction('a', { type: 'roll', keep: [] });
  eq(g.rollsLeft['a'], 0);
  const before = g.dice['a'].slice();
  g.handleAction('a', { type: 'roll', keep: [] }); // rejected
  eq(g.rollsLeft['a'], 0);
  eq(JSON.stringify(g.dice['a']), JSON.stringify(before));
});

test('assign records the right score and locks; assigning a used category is rejected', () => {
  const g = newGame(['a', 'b']);
  setDice(g, 'a', [5, 5, 5, 5, 1]);
  g.handleAction('a', { type: 'assign', category: 'fives' });
  eq(g.cards['a'].fives, 20);
  assert(g.assigned['a'] !== undefined, 'locked after assign');
  // a is locked; further actions ignored this turn
  g.handleAction('a', { type: 'roll', keep: [] });
  eq(g.cards['a'].fives, 20);
});

test('cannot assign before rolling, and unknown category rejected', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'assign', category: 'chance' }); // never rolled
  eq(g.assigned['a'], undefined);
  setDice(g, 'a', [1, 2, 3, 4, 5]);
  g.handleAction('a', { type: 'assign', category: 'bogus' });
  eq(g.assigned['a'], undefined);
});

test('cannot assign a category twice across turns', () => {
  const g = newGame(['a', 'b']);
  setDice(g, 'a', [1, 1, 1, 1, 1]);
  setDice(g, 'b', [2, 2, 2, 2, 2]);
  g.handleAction('a', { type: 'assign', category: 'ones' }); // a: 5
  g.handleAction('b', { type: 'assign', category: 'twos' }); // b done -> turn 2
  eq(g.state, 'turnEnd');
  advance(4000); // -> turn 2
  eq(g.state, 'turn');
  setDice(g, 'a', [1, 1, 1, 3, 4]);
  g.handleAction('a', { type: 'assign', category: 'ones' }); // already used
  eq(g.assigned['a'], undefined);
  eq(g.cards['a'].ones, 5); // unchanged
});

// --- hidden info ------------------------------------------------------------

test('opponent dice contents are never in getStateForPlayer', () => {
  const g = newGame(['a', 'b']);
  setDice(g, 'b', [6, 6, 6, 6, 6]); // distinctive faces
  const sA = g.getStateForPlayer('a');
  const json = JSON.stringify(sA);
  // a sees only its own dice; b's hand of 6s must not appear, nor a 'dice' array for b
  assert(!json.includes('6,6,6,6,6'), 'opponent dice not leaked');
  for (const opp of sA.opponents) {
    assert(!('dice' in opp), 'no dice field on opponent');
    assert(!('previews' in opp), 'no previews on opponent');
  }
  eq(sA.myId, 'a');
});

test('pending assignment / pre-lock dice not revealed to opponents before turn resolves', () => {
  const g = newGame(['a', 'b']);
  setDice(g, 'a', [3, 3, 3, 3, 3]); // a about to assign yahtzee
  // a has NOT assigned yet; b must not see a's faces or a chosen category
  const sB = g.getStateForPlayer('b');
  const json = JSON.stringify(sB);
  assert(!json.includes('3,3,3,3,3'), "a's pre-lock dice hidden from b");
  for (const opp of sB.opponents) {
    eq(opp.hasAssigned, false);
    assert(!('category' in opp), 'no pending category leaked');
  }
});

// --- barrier advances when all act AND on timeout ---------------------------

test('turn advances when all players assign', () => {
  const g = newGame(['a', 'b', 'c']);
  setDice(g, 'a', [1, 1, 1, 1, 1]);
  setDice(g, 'b', [2, 2, 2, 2, 2]);
  setDice(g, 'c', [3, 3, 3, 3, 3]);
  g.handleAction('a', { type: 'assign', category: 'ones' });
  g.handleAction('b', { type: 'assign', category: 'twos' });
  eq(g.state, 'turn'); // c still owing
  const before = g.emitCount;
  g.handleAction('c', { type: 'assign', category: 'threes' });
  eq(g.state, 'turnEnd');
  assert(g.emitCount >= before, 'broadcast happened path ok');
});

test('40s timeout auto-assigns best remaining category for stragglers and advances', () => {
  const g = newGame(['a', 'b']);
  setDice(g, 'a', [6, 6, 6, 6, 6]); // a rolled but never assigns
  // b never rolls at all
  const before = g.emitCount;
  advance(40_000);
  eq(g.state, 'turnEnd');
  assert(g.emitCount > before, 'broadcast on timeout');
  // a's best with five 6s is sixes=30 (vs yahtzee 50!) — yahtzee scores higher, picked
  assert(g.assigned['a'] !== undefined, 'a auto-assigned');
  eq(g.assigned['a'].category, 'yahtzee');
  eq(g.assigned['a'].score, 50);
  // b never rolled -> auto-assigns some category at score 0
  assert(g.assigned['b'] !== undefined, 'b auto-assigned');
  eq(g.assigned['b'].score, 0);
});

test('turnEnd auto-advances to next turn after its short timer', () => {
  const g = newGame(['a', 'b']);
  setDice(g, 'a', [1, 1, 1, 1, 1]);
  setDice(g, 'b', [2, 2, 2, 2, 2]);
  g.handleAction('a', { type: 'assign', category: 'ones' });
  g.handleAction('b', { type: 'assign', category: 'twos' });
  eq(g.state, 'turnEnd');
  eq(g.turn, 1);
  advance(4000);
  eq(g.state, 'turn');
  eq(g.turn, 2);
});

// --- full game reaches finished for N in [2,3,4] ----------------------------

function playFullGame(players) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 500) {
    if (g.state === 'turn') {
      for (const p of g.players) {
        if (g.assigned[p] !== undefined) continue;
        // ensure rolled, then assign first unused category
        if (!g.hasRolled[p]) g.handleAction(p, { type: 'roll', keep: [] });
        const unused = g._unusedCategories(p);
        g.handleAction(p, { type: 'assign', category: unused[0] });
      }
    } else if (g.state === 'turnEnd') {
      advance(4000);
    }
  }
  return g;
}

for (const n of [2, 3, 4]) {
  test(`full ${n}-player game reaches finished with N results, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, n);
    const g = playFullGame(players);
    eq(g.state, 'finished');
    eq(g.turn, 13);
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, n);
    // placements are non-decreasing as score descends
    for (let i = 1; i < res.length; i++) {
      assert(res[i].score <= res[i - 1].score, 'sorted by score desc');
      assert(res[i].placement >= res[i - 1].placement, 'placement non-decreasing');
    }
  });
}

test('tie shares a placement', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 500) {
    if (g.state === 'turn') {
      // force everyone to identical dice each turn -> identical scores -> tie
      for (const p of g.players) {
        if (g.assigned[p] !== undefined) continue;
        setDice(g, p, [3, 3, 3, 1, 2]);
        const unused = g._unusedCategories(p);
        g.handleAction(p, { type: 'assign', category: unused[0] });
      }
    } else if (g.state === 'turnEnd') {
      advance(4000);
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
});

test('upper bonus of 35 applied when upper subtotal >= 63', () => {
  const g = newGame(['a', 'b']);
  // hand-build a's card: max out the upper section (1s..6s) = 63 exactly
  g.cards['a'] = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
  eq(g._upperSubtotal('a'), 63);
  eq(g._bonus('a'), 35);
  eq(g._grandTotal('a'), 63 + 35);
  g.cards['b'] = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 12 };
  eq(g._bonus('b'), 0);
});

// --- leave / teardown -------------------------------------------------------

test('removePlayer mid-turn advances when the leaver was the last owed', () => {
  const g = newGame(['a', 'b', 'c']);
  setDice(g, 'a', [1, 1, 1, 1, 1]);
  setDice(g, 'b', [2, 2, 2, 2, 2]);
  g.handleAction('a', { type: 'assign', category: 'ones' });
  g.handleAction('b', { type: 'assign', category: 'twos' });
  eq(g.state, 'turn'); // c owing
  g.removePlayer('c');
  eq(g.state, 'turnEnd'); // barrier completes without c
  assert(!g.players.includes('c'), 'leaver pruned');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer during turnEnd advances; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  setDice(g, 'a', [1, 1, 1, 1, 1]);
  setDice(g, 'b', [2, 2, 2, 2, 2]);
  setDice(g, 'c', [3, 3, 3, 3, 3]);
  g.handleAction('a', { type: 'assign', category: 'ones' });
  g.handleAction('b', { type: 'assign', category: 'twos' });
  g.handleAction('c', { type: 'assign', category: 'threes' });
  eq(g.state, 'turnEnd');
  g.removePlayer('c');
  eq(g.state, 'turn'); // advanced to next turn
  assert(!g.players.includes('c'), 'leaver pruned');
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

test('destroy clears the active turn timer', () => {
  const g = newGame(['a', 'b']);
  assert(pendingTimers() >= 1, 'turn timer armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('Yahtzee');
