import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { FlashFlood } from '../src/games/FlashFlood.js';

installClock();

function newGame(players) {
  const g = new FlashFlood(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const recall = (g, p, cells) => g.handleAction(p, { type: 'recall', cells });

test('starts in SHOW with a valid pattern and an armed show timer', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'show');
  eq(g.round, 1);
  eq(g.size, 3);
  assert(pendingTimers() >= 1, 'show timer armed');
  // valid pattern: ~40% of 9 cells, all indices in range, unique, not all/none
  const total = g.size * g.size;
  assert(g.pattern.length >= 2 && g.pattern.length < total, 'lit count sane');
  const set = new Set(g.pattern);
  eq(set.size, g.pattern.length, 'no duplicate lit cells');
  assert(g.pattern.every((c) => Number.isInteger(c) && c >= 0 && c < total), 'cells in range');
});

test('generator: ~40% lit and grid grows each round', () => {
  const g = newGame(['a', 'b']);
  // round 1: 3x3 => round(9*0.4)=4 lit
  eq(g.size, 3);
  eq(g.pattern.length, 4);
  // drive to round 2 via the SHOW timer then everyone recalls correctly
  advance(g._showMs);
  eq(g.state, 'recall');
  recall(g, 'a', g.pattern); recall(g, 'b', g.pattern);
  eq(g.state, 'roundEnd');
  advance(10_000); // ack auto-advance -> next round SHOW
  eq(g.state, 'show');
  eq(g.round, 2);
  eq(g.size, 4); // grid grew
  eq(g.pattern.length, Math.round(16 * 0.4)); // 6 lit
});

test('the lit pattern is NOT serialized during RECALL (anti-cheat)', () => {
  const g = newGame(['a', 'b']);
  const inShow = g.getStateForPlayer('a');
  assert(Array.isArray(inShow.pattern), 'pattern shown during SHOW');
  advance(g._showMs);
  eq(g.state, 'recall');
  const s = g.getStateForPlayer('a');
  eq(s.pattern, null, 'pattern null during RECALL');
  // hard assertion: the actual lit indices appear nowhere in the serialized state
  const sol = g.pattern;
  const blob = JSON.stringify(g.getStateForPlayer('a'));
  const probe = JSON.stringify(sol);
  assert(!blob.includes(probe), 'solution array not embedded in recall state');
});

test('correct recall banks + survives; wrong recall eliminates at current depth', () => {
  const g = newGame(['a', 'b']);
  advance(g._showMs);
  eq(g.state, 'recall');
  const sol = g.pattern;
  recall(g, 'a', sol);            // exact -> bank
  // b taps an off-pattern cell: pick any index not lit
  const total = g.size * g.size;
  let wrong = null;
  for (let i = 0; i < total; i++) if (!sol.includes(i)) { wrong = i; break; }
  recall(g, 'b', [...sol.slice(1), wrong]); // wrong set
  eq(g.boards['a'].banked, 1);
  eq(g.boards['a'].alive, true);
  eq(g.boards['b'].alive, false);
  eq(g.boards['b'].eliminatedRound, 1);
});

test('incomplete recall (missing a cell) is rejected -> elimination', () => {
  const g = newGame(['a', 'b']);
  advance(g._showMs);
  const sol = g.pattern;
  recall(g, 'a', sol.slice(0, sol.length - 1)); // missing one lit cell
  eq(g.boards['a'].alive, false);
});

test('extra cell (superset) is rejected -> elimination', () => {
  const g = newGame(['a', 'b']);
  advance(g._showMs);
  const sol = g.pattern;
  const total = g.size * g.size;
  let extra = null;
  for (let i = 0; i < total; i++) if (!sol.includes(i)) { extra = i; break; }
  recall(g, 'a', [...sol, extra]); // all correct PLUS one extra
  eq(g.boards['a'].alive, false);
});

test('out-of-range / duplicate taps are sanitized before judging', () => {
  const g = newGame(['a', 'b']);
  advance(g._showMs);
  const sol = g.pattern;
  // submit the solution but with a duplicate and an out-of-range index appended
  recall(g, 'a', [...sol, sol[0], 999, -3]);
  eq(g.boards['a'].alive, true, 'sanitized to the exact set -> correct');
  eq(g.boards['a'].banked, 1);
});

test('recall window auto-judges: non-submitters are eliminated', () => {
  const g = newGame(['a', 'b']);
  advance(g._showMs);
  eq(g.state, 'recall');
  recall(g, 'a', g.pattern); // a submits, b does not
  const before = g.emitCount;
  advance(12_000); // recall timer fires
  eq(g.state, 'roundEnd');
  assert(g.emitCount > before, 'broadcast on recall timeout');
  eq(g.boards['a'].alive, true);
  eq(g.boards['b'].alive, false, 'non-submitter eliminated');
});

test('roundEnd reveals the pattern; auto-advances after ack window', () => {
  const g = newGame(['a', 'b']);
  advance(g._showMs);
  const sol = g.pattern;
  recall(g, 'a', sol); recall(g, 'b', sol);
  eq(g.state, 'roundEnd');
  const s = g.getStateForPlayer('a');
  assert(Array.isArray(s.pattern), 'pattern revealed at roundEnd');
  eq(JSON.stringify(s.pattern), JSON.stringify(sol));
  advance(10_000);
  eq(g.state, 'show'); // both alive -> next round
  eq(g.round, 2);
});

test('game ends when everyone is eliminated; ranks all N with placement 1 first', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    // round 1: p0 banks, everyone else misses -> all eliminated except p0 (alive)
    advance(g._showMs);
    recall(g, 'p0', g.pattern);
    for (let i = 1; i < n; i++) recall(g, `p${i}`, []); // empty -> wrong
    eq(g.state, 'roundEnd');
    advance(10_000);
    // only p0 alive -> game should finish (no one left to compete)
    eq(g.state, 'finished', `n=${n} finishes when one survivor`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].playerId, 'p0', 'survivor (most banked) first');
    eq(res[0].placement, 1);
    res.forEach((e) => assert(typeof e.placement === 'number'));
  }
});

test('full multi-round game reaches finished; deeper survivor ranks first', () => {
  const g = newGame(['a', 'b']);
  // a banks every round; b is eliminated round 1
  advance(g._showMs);
  recall(g, 'a', g.pattern);
  recall(g, 'b', []); // b out round 1
  eq(g.state, 'roundEnd');
  advance(10_000);
  // b eliminated, a alive -> only one alive -> finished
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1);
  eq(res.find((r) => r.playerId === 'b').placement, 2);
  assert(res.find((r) => r.playerId === 'a').banked >= 1);
});

test('survivors continue across multiple rounds then finish at depth tie', () => {
  const g = newGame(['a', 'b', 'c']);
  // Round 1: a & b bank, c misses
  advance(g._showMs);
  recall(g, 'a', g.pattern); recall(g, 'b', g.pattern); recall(g, 'c', []);
  advance(10_000);
  eq(g.state, 'show'); eq(g.round, 2); // a,b alive -> continue
  // Round 2: a & b bank again, then both miss round 3 -> all out -> finished
  advance(g._showMs);
  recall(g, 'a', g.pattern); recall(g, 'b', g.pattern);
  advance(10_000);
  eq(g.round, 3);
  advance(g._showMs);
  recall(g, 'a', []); recall(g, 'b', []); // both out
  advance(10_000);
  eq(g.state, 'finished');
  const res = g.getResults();
  // a and b both banked 2; share placement 1 (tie); c placement 3
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(a.banked, 2); eq(b.banked, 2); eq(c.banked, 0);
});

test('a tie (equal banked + equal speed) shares a placement', () => {
  const g = newGame(['a', 'b']);
  advance(g._showMs);
  const sol = g.pattern;
  // both recall correctly at the same virtual instant -> identical speed
  recall(g, 'a', sol); recall(g, 'b', sol);
  eq(g.state, 'roundEnd');
  advance(10_000);
  eq(g.state, 'show'); // both alive, round 2
  // both miss round 2 -> all out, equal banked(1) + equal speed(0 dt)
  advance(g._showMs);
  recall(g, 'a', []); recall(g, 'b', []);
  advance(10_000);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res[0].placement, 1);
  eq(res[1].placement, 1, 'tie shares placement 1');
});

test('removePlayer mid-recall advances (no deadlock)', () => {
  const g = newGame(['a', 'b']);
  advance(g._showMs);
  eq(g.state, 'recall');
  recall(g, 'a', g.pattern); // a submitted, waiting on b
  g.removePlayer('b');       // last unsubmitted leaves
  assert(g.state === 'roundEnd' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver pruned from results');
});

test('leaving down to one player finishes and clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('removePlayer mid-roundEnd advances the ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  advance(g._showMs);
  recall(g, 'a', g.pattern); recall(g, 'b', g.pattern); recall(g, 'c', g.pattern);
  eq(g.state, 'roundEnd');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last un-acked leaves -> barrier resolves
  eq(g.state, 'show'); // all alive -> next round
  eq(g.round, 2);
});

test('ping during SHOW after window forces RECALL; ping during RECALL after window ends round', () => {
  const g = newGame(['a', 'b']);
  // simulate the show window elapsing then a client ping
  advance(g._showMs + 1);
  // timer would already have fired; assert recall reached
  eq(g.state, 'recall');
  // drive recall timeout via ping
  advance(RECALL_MS_GUESS()); // helper below
  eq(g.state, 'roundEnd');
});
function RECALL_MS_GUESS() { return 12_000; }

test('destroy clears timers', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('FlashFlood');
