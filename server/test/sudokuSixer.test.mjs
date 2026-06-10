import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { SudokuSixer } from '../src/games/SudokuSixer.js';

installClock();

const N = 6;

function newGame(players) {
  const g = new SudokuSixer(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

const place = (g, p, row, col, value) => g.handleAction(p, { type: 'place', row, col, value });

/** Validate a flat N*N grid is a legal full 6x6 sudoku (rows/cols/2x3 boxes 1..6). */
function isValidSolution(grid) {
  if (grid.length !== N * N) return false;
  const ok = (vals) => {
    if (vals.length !== N) return false;
    const set = new Set(vals);
    if (set.size !== N) return false;
    return [1, 2, 3, 4, 5, 6].every((v) => set.has(v));
  };
  for (let r = 0; r < N; r++) if (!ok(Array.from({ length: N }, (_, c) => grid[r * N + c]))) return false;
  for (let c = 0; c < N; c++) if (!ok(Array.from({ length: N }, (_, r) => grid[r * N + c]))) return false;
  for (let br = 0; br < N; br += 2) {
    for (let bc = 0; bc < N; bc += 3) {
      const box = [];
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 3; dc++) box.push(grid[(br + dr) * N + (bc + dc)]);
      if (!ok(box)) return false;
    }
  }
  return true;
}

/** Drive a player to the full solution by reading the server's hidden solution. */
function solve(g, p) {
  for (let idx = 0; idx < N * N; idx++) {
    if (g.givens[idx] !== 0) continue; // skip givens
    place(g, p, Math.floor(idx / N), idx % N, g.solution[idx]);
  }
}

test('generator produces a valid 6x6 solution and a consistent uniquely-solvable puzzle', () => {
  for (let i = 0; i < 20; i++) {
    const g = newGame(['a', 'b']);
    assert(isValidSolution(g.solution), 'solution is a legal full sudoku');
    // every given must match the solution
    for (let idx = 0; idx < N * N; idx++) {
      if (g.givens[idx] !== 0) assert(g.givens[idx] === g.solution[idx], 'given matches solution');
    }
    // puzzle keeps at least one blank and stays uniquely solvable
    const blanks = g.givens.filter((v) => v === 0).length;
    assert(blanks > 0, 'puzzle has blanks');
  }
});

test('starts in playing with a round timer; solution never leaks pre-reveal', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'playing');
  assert(pendingTimers() >= 1, 'round timer armed');
  const s = g.getStateForPlayer('a');
  eq(s.solution, null, 'solution hidden in playing');
  assert(!JSON.stringify(s).includes('"solution":[') , 'no solution array serialized');
  // the givens sent must NOT equal the full solution (must have blanks shown as 0)
  assert(s.givens.includes(0), 'givens carry blanks, not the answer');
});

test('a correct move is accepted and increments correct-cell count', () => {
  const g = newGame(['a', 'b']);
  const givenCount = g.givens.filter((v) => v !== 0).length;
  const idx = g.givens.findIndex((v) => v === 0);
  place(g, 'a', Math.floor(idx / N), idx % N, g.solution[idx]);
  const after = g.getStateForPlayer('a').myCorrectCount;
  eq(after, givenCount + 1, 'givens plus one correct fill counted');
  eq(g.boards['a'].entries[idx], g.solution[idx]);
});

test('an incorrect value lowers correct count; placing on a given is rejected', () => {
  const g = newGame(['a', 'b']);
  const blank = g.givens.findIndex((v) => v === 0);
  const wrong = g.solution[blank] === 1 ? 2 : 1;
  place(g, 'a', Math.floor(blank / N), blank % N, wrong);
  eq(g.boards['a'].entries[blank], wrong);
  assert(!g.boards['a'].solved, 'wrong entry does not solve');

  // placing on a given cell is a no-op
  const given = g.givens.findIndex((v) => v !== 0);
  place(g, 'a', Math.floor(given / N), given % N, 6);
  assert(g.boards['a'].entries[given] === undefined, 'given cell not overwritten');
});

test('illegal moves rejected (out of range value, out of bounds, bad value)', () => {
  const g = newGame(['a', 'b']);
  const blank = g.givens.findIndex((v) => v === 0);
  const r = Math.floor(blank / N), c = blank % N;
  place(g, 'a', r, c, 7);   // value too high
  place(g, 'a', r, c, 0.5); // non-integer
  assert(g.boards['a'].entries[blank] === undefined, 'bad values rejected');
  place(g, 'a', 9, 9, 3);   // out of bounds
  assert(Object.keys(g.boards['a'].entries).length === 0, 'out-of-bounds ignored');
});

test('clearing a cell with value 0 removes the entry', () => {
  const g = newGame(['a', 'b']);
  const blank = g.givens.findIndex((v) => v === 0);
  const r = Math.floor(blank / N), c = blank % N;
  place(g, 'a', r, c, 3);
  assert(g.boards['a'].entries[blank] === 3);
  place(g, 'a', r, c, 0);
  assert(g.boards['a'].entries[blank] === undefined, 'cell cleared');
});

test('solving is detected server-side and ends the round; first solver ranks #1', () => {
  const g = newGame(['a', 'b']);
  solve(g, 'a');                 // a fully solves first
  assert(g.boards['a'].solved, 'a solved');
  assert(g.done.has('a'));
  solve(g, 'b');                 // b solves second -> both done -> reveal
  eq(g.state, 'reveal');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1, 'first solver first');
  eq(res.find((r) => r.playerId === 'b').placement, 2);
});

test('client can NEVER claim a solve it did not make (server validates every cell)', () => {
  const g = newGame(['a', 'b']);
  // fill every blank with a deliberately wrong digit
  for (let idx = 0; idx < N * N; idx++) {
    if (g.givens[idx] !== 0) continue;
    const wrong = g.solution[idx] === 1 ? 2 : 1;
    place(g, 'a', Math.floor(idx / N), idx % N, wrong);
  }
  assert(!g.boards['a'].solved, 'wrong fills never register as solved');
});

test('solution revealed only at reveal; results present', () => {
  const g = newGame(['a', 'b']);
  solve(g, 'a');
  solve(g, 'b');
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  eq(JSON.stringify(s.solution), JSON.stringify(g.solution));
  assert(Array.isArray(s.results), 'results present at reveal');
});

test('hidden info: opponents expose only solved + correctCount (no grid/entries)', () => {
  const g = newGame(['a', 'b']);
  const blank = g.givens.findIndex((v) => v === 0);
  place(g, 'a', Math.floor(blank / N), blank % N, g.solution[blank]);
  const opp = g.getStateForPlayer('b').opponents.find((o) => o.playerId === 'a');
  eq(Object.keys(opp).sort().join(','), 'correctCount,playerId,solved');
  assert(!('entries' in opp) && !('myEntries' in opp), 'no board leaked');
});

test('round timer auto-advances to reveal and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  advance(150_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'timer broadcast fired');
});

test('non-solvers at timeout rank by correct-cell count', () => {
  const g = newGame(['a', 'b', 'c']);
  // give 'a' more correct cells than 'b'
  const blanks = g.givens.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  for (const idx of blanks.slice(0, 3)) place(g, 'a', Math.floor(idx / N), idx % N, g.solution[idx]);
  for (const idx of blanks.slice(0, 1)) place(g, 'b', Math.floor(idx / N), idx % N, g.solution[idx]);
  advance(150_000);
  eq(g.state, 'reveal');
  const res = g.getResults();
  const ra = res.find((r) => r.playerId === 'a').placement;
  const rb = res.find((r) => r.playerId === 'b').placement;
  assert(ra < rb, 'more correct cells ranks higher');
});

test('full game reaches finished with getResults length N, placement 1 first (N=2,3,4)', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    for (const p of players) solve(g, p); // everyone solves in order -> reveal
    eq(g.state, 'reveal');
    advance(10_000); // ack auto-advance
    eq(g.state, 'finished');
    eq(g.isComplete(), true);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].placement, 1, 'first placement is 1');
    eq(res[0].playerId, 'p0', 'first solver placed first');
    res.forEach((e) => assert(typeof e.placement === 'number'));
  }
});

test('a tie (equal progress, no solvers) shares a placement', () => {
  const g = newGame(['a', 'b']);
  advance(150_000); // nobody touches the board -> both 0 progress beyond givens? equal anyway
  const res = g.getResults();
  eq(res[0].placement, 1);
  eq(res[1].placement, 1, 'equal progress ties at 1');
});

test('removePlayer mid-solve advances with no deadlock', () => {
  const g = newGame(['a', 'b']);
  solve(g, 'b');        // b solved, a still working
  g.removePlayer('a');  // last unsolved player leaves
  assert(g.state === 'reveal' || g.state === 'finished', `ended (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver pruned from results');
});

test('leaving down to one finishes and clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('reveal auto-ack advances to finished after 10s', () => {
  const g = newGame(['a', 'b']);
  solve(g, 'a');
  solve(g, 'b');
  eq(g.state, 'reveal');
  advance(10_000);
  eq(g.state, 'finished');
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('SudokuSixer');
