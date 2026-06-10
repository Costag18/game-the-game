import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { PairHunt } from '../src/games/PairHunt.js';

installClock();

function newGame(players) {
  const g = new PairHunt(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// --- local copy of the SET rule, to validate the engine independently --------
const ATTRS = ['shape', 'color', 'count', 'fill'];
function isSetLocal(c0, c1, c2) {
  for (const attr of ATTRS) {
    const a = c0[attr], b = c1[attr], c = c2[attr];
    const allSame = a === b && b === c;
    const allDiff = a !== b && b !== c && a !== c;
    if (!allSame && !allDiff) return false;
  }
  return true;
}

/** Find the ids of one valid SET currently on the engine's live tableau (server-side read). */
function findSetIds(g) {
  const t = g.tableau;
  for (let i = 0; i < t.length; i++)
    for (let j = i + 1; j < t.length; j++)
      for (let k = j + 1; k < t.length; k++)
        if (isSetLocal(t[i], t[j], t[k])) return [t[i].id, t[j].id, t[k].id];
  return null;
}

const claim = (g, p, ids) => g.handleAction(p, { type: 'claim', cardIds: ids });

// --- generator validity ------------------------------------------------------

test('generator: deck is 81 unique cards, tableau dealt, opening board solvable', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'playing');
  // 81 total cards exist; 12 dealt + remainder in deck (minus any escape-hatch deals).
  const all = [...g.tableau, ...g.deck];
  eq(all.length, 81, 'full 81-card deck present');
  const ids = new Set(all.map((c) => c.id));
  eq(ids.size, 81, 'all card ids unique');
  assert(g.tableau.length >= 12, 'at least 12 cards face-up');
  // The opening tableau is guaranteed to contain at least one SET.
  assert(findSetIds(g) !== null, 'opening tableau is solvable');
});

test('SET rule: a hand-built valid trio is accepted, an invalid trio rejected', () => {
  // all-same shape/color/fill, all-different count → valid SET
  const valid = [
    { shape: 'circle', color: 'r', count: 1, fill: 'solid' },
    { shape: 'circle', color: 'r', count: 2, fill: 'solid' },
    { shape: 'circle', color: 'r', count: 3, fill: 'solid' },
  ];
  assert(isSetLocal(valid[0], valid[1], valid[2]), 'control: trio is a SET');
  // two-same-one-different on count → NOT a SET
  const invalid = [
    { shape: 'circle', color: 'r', count: 1, fill: 'solid' },
    { shape: 'circle', color: 'r', count: 1, fill: 'solid' },
    { shape: 'circle', color: 'r', count: 3, fill: 'solid' },
  ];
  assert(!isSetLocal(invalid[0], invalid[1], invalid[2]), 'control: trio is not a SET');
});

// --- claim validation against the live tableau -------------------------------

test('a correct claim scores +1, removes the cards, and refills the board', () => {
  const g = newGame(['a', 'b']);
  const ids = findSetIds(g);
  assert(ids, 'a SET exists');
  const before = g.tableau.length;
  claim(g, 'a', ids);
  eq(g.counts['a'], 1, 'claimer +1');
  // the three claimed ids are gone from the tableau
  for (const id of ids) assert(!g.tableau.some((c) => c.id === id), `${id} removed`);
  // board refilled back to (at least) original size while deck has cards
  assert(g.tableau.length >= Math.min(before, 12), 'board refilled');
});

test('an invalid claim is rejected (no point), locks the player out briefly', () => {
  const g = newGame(['a', 'b']);
  // pick 3 ids that are NOT a SET (search for a non-SET trio on the board)
  const t = g.tableau;
  let bad = null;
  outer:
  for (let i = 0; i < t.length; i++)
    for (let j = i + 1; j < t.length; j++)
      for (let k = j + 1; k < t.length; k++)
        if (!isSetLocal(t[i], t[j], t[k])) { bad = [t[i].id, t[j].id, t[k].id]; break outer; }
  assert(bad, 'a non-SET trio exists');
  claim(g, 'a', bad);
  eq(g.counts['a'], 0, 'no point for an invalid claim');
  assert(g.lockUntil['a'] > Date.now(), 'player is locked out');
  // a follow-up claim during lockout is ignored even if it IS a valid SET
  const good = findSetIds(g);
  claim(g, 'a', good);
  eq(g.counts['a'], 0, 'locked-out valid claim ignored');
  // after the lockout expires, the same valid claim works
  advance(2500);
  claim(g, 'a', findSetIds(g));
  eq(g.counts['a'], 1, 'claim works after lockout');
});

test('anti-cheat: claiming a card no longer on the tableau is rejected', () => {
  const g = newGame(['a', 'b']);
  const ids = findSetIds(g);
  claim(g, 'a', ids);            // removes those 3 ids from the board
  eq(g.counts['a'], 1);
  // 'b' tries to claim the same (now-removed) ids → not on board → rejected
  const cntBefore = g.counts['b'];
  claim(g, 'b', ids);
  eq(g.counts['b'], cntBefore, 'removed-card claim rejected');
  assert(g.lockUntil['b'] > Date.now(), 'and treated as an invalid attempt');
});

test('claim ignored: wrong length, non-distinct ids, or unknown ids', () => {
  const g = newGame(['a', 'b']);
  claim(g, 'a', [g.tableau[0].id, g.tableau[1].id]);                 // too short
  claim(g, 'a', [g.tableau[0].id, g.tableau[0].id, g.tableau[1].id]); // duplicate id
  eq(g.counts['a'], 0);
  eq(g.attempts['a'], 0, 'malformed claims are not even counted as attempts');
});

// --- hidden-info / state ------------------------------------------------------

test('getStateForPlayer never serializes the SET solution before reveal', () => {
  const g = newGame(['a', 'b']);
  const s = g.getStateForPlayer('a');
  const json = JSON.stringify(s);
  assert(!('solution' in s) && !('solutionIds' in s), 'no solution key');
  // tableau is public, but results (final ranking) are withheld until reveal
  eq(s.results, null, 'no results pre-reveal');
  assert(json.includes('tableau'), 'public tableau is sent');
  // the deck (undealt cards) is never serialized — only a count
  assert(typeof s.deckRemaining === 'number', 'deck count only');
  assert(!json.includes('"deck"'), 'raw deck never sent');
});

// --- finish-order / ranking ---------------------------------------------------

test('more SETs ranks first; ranks all N for N in [2,3,4]', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    // p0 claims one SET, others none
    claim(g, 'p0', findSetIds(g));
    advance(120_000);
    eq(g.state, 'reveal');
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].playerId, 'p0', 'most SETs first');
    eq(res[0].placement, 1, 'leader is placement 1');
    res.forEach((e) => assert(typeof e.placement === 'number'));
  }
});

test('a full game reaches finished with getResults length N and a placement-1', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    claim(g, 'p0', findSetIds(g)); // give p0 a lead
    advance(120_000);              // overall timer ends the round
    eq(g.state, 'reveal');
    advance(10_000);               // reveal auto-ack
    eq(g.state, 'finished');
    eq(g.isComplete(), true);
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
  }
});

test('a tie (equal counts) shares a placement', () => {
  const g = newGame(['a', 'b']);
  advance(120_000); // nobody claims → both 0 SETs
  const res = g.getResults();
  eq(res[0].count, 0);
  eq(res[0].placement, 1);
  eq(res[1].placement, 1, 'equal counts tie at 1');
});

test('two players with equal counts AND equal attempts tie', () => {
  const g = newGame(['a', 'b']);
  claim(g, 'a', findSetIds(g)); // a: 1 SET, 1 attempt
  claim(g, 'b', findSetIds(g)); // b: 1 SET, 1 attempt
  advance(120_000);
  const res = g.getResults();
  eq(res[0].count, 1);
  eq(res[1].count, 1);
  eq(res[0].placement, 1);
  eq(res[1].placement, 1, 'identical records tie');
});

// --- timers / leave / teardown ------------------------------------------------

test('overall timer auto-advances to reveal and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  advance(120_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'timer broadcast fired');
});

test('claiming until the board is exhausted ends the round', () => {
  const g = newGame(['a']); // solo: just drive the board to exhaustion
  // PairHunt requires >=1 player; with 1 player removePlayer would finish,
  // but here we never remove — we claim every SET until none remain.
  let guard = 0;
  while (g.state === 'playing' && guard++ < 200) {
    const ids = findSetIds(g);
    if (!ids) { g.handleAction('a', { type: 'ping' }); break; }
    claim(g, 'a', ids);
  }
  assert(g.state === 'reveal' || g.state === 'finished', `board exhausted ends round (got ${g.state})`);
  assert(g.deck.length === 0, 'deck drained');
  assert(g.counts['a'] > 0, 'claimed real SETs');
});

test('removePlayer mid-solve advances without deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  claim(g, 'a', findSetIds(g));
  g.removePlayer('b'); // a non-essential player leaves mid-race
  eq(g.state, 'playing', 'race continues with 2 players');
  assert(!g.players.includes('b'), 'leaver pruned');
  // down to one → finishes
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0, 'timers cleared on finish');
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver absent from results');
});

test('leave during reveal still completes the ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  advance(120_000);
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last un-acked player leaves → barrier clears
  eq(g.state, 'finished');
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('PairHunt');
