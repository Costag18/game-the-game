import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { NonogramDash } from '../src/games/NonogramDash.js';

installClock();

function newGame(players) {
  const g = new NonogramDash(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

const mark = (g, p, row, col, state) => g.handleAction(p, { type: 'mark', row, col, state });

// Recompute run-clues independently to verify the generator's clues match its bitmap.
function lineClues(line) {
  const runs = [];
  let run = 0;
  for (const v of line) {
    if (v) run++;
    else if (run > 0) { runs.push(run); run = 0; }
  }
  if (run > 0) runs.push(run);
  return runs.length ? runs : [0];
}

// Drive a player to the exact solution by reading the server's hidden bitmap.
function solve(g, p) {
  const n = g.bitmap.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (g.bitmap[r][c] === 1) mark(g, p, r, c, 'filled');
    }
  }
}

test('generator produces a valid puzzle: clues match the bitmap, non-empty, in fill range', () => {
  for (let iter = 0; iter < 200; iter++) {
    const g = newGame(['a', 'b']);
    const n = g.bitmap.length;
    eq(n, 8, 'grid is 8x8');
    // non-empty
    let filled = 0;
    for (const row of g.bitmap) for (const v of row) if (v) filled++;
    assert(filled > 0, 'at least one filled cell');
    eq(g.filledCount, filled, 'filledCount matches bitmap');
    // row clues match
    for (let r = 0; r < n; r++) {
      eq(JSON.stringify(g.rowClues[r]), JSON.stringify(lineClues(g.bitmap[r])), `row ${r} clue`);
    }
    // col clues match
    for (let c = 0; c < n; c++) {
      const col = g.bitmap.map((row) => row[c]);
      eq(JSON.stringify(g.colClues[c]), JSON.stringify(lineClues(col)), `col ${c} clue`);
    }
    // fill ratio loosely in range (random so allow slack, but never absurd)
    const ratio = filled / (n * n);
    assert(ratio > 0.2 && ratio < 0.8, `ratio sane (${ratio})`);
  }
});

test('starts playing with a round timer; solution never leaks pre-reveal', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'playing');
  assert(pendingTimers() >= 1, 'round timer armed');
  const s = g.getStateForPlayer('a');
  eq(s.solution, null, 'solution hidden in playing');
  // bitmap must not appear anywhere in the serialized state
  const json = JSON.stringify(s);
  assert(!json.includes('"solution":['), 'no solution array serialized');
  // clues ARE sent
  assert(Array.isArray(s.rowClues) && Array.isArray(s.colClues), 'clues present');
  eq(s.rowClues.length, 8); eq(s.colClues.length, 8);
});

test('a correct fill is accepted; an out-of-bounds / bad-state mark is rejected', () => {
  const g = newGame(['a', 'b']);
  // find a filled cell and an empty cell
  let fr = -1, fc = -1, er = -1, ec = -1;
  for (let r = 0; r < 8 && fr < 0; r++) for (let c = 0; c < 8; c++) if (g.bitmap[r][c] === 1) { fr = r; fc = c; break; }
  for (let r = 0; r < 8 && er < 0; r++) for (let c = 0; c < 8; c++) if (g.bitmap[r][c] === 0) { er = r; ec = c; break; }
  mark(g, 'a', fr, fc, 'filled');
  eq(g.boards['a'].marks[fr][fc], 1, 'accepted fill');
  // illegal: out of bounds
  mark(g, 'a', 99, 0, 'filled');
  mark(g, 'a', 0, -1, 'filled');
  // illegal: unknown state
  mark(g, 'a', er, ec, 'banana');
  eq(g.boards['a'].marks[er][ec], 0, 'bad-state mark ignored');
  // empty mark works
  mark(g, 'a', er, ec, 'empty');
  eq(g.boards['a'].marks[er][ec], -1, 'marked empty');
});

test('an over-filled board is NOT solved; only an exact filled-match solves', () => {
  const g = newGame(['a', 'b']);
  // find an empty cell to over-fill BEFORE completing the picture (so the board never locks)
  let er = -1, ec = -1;
  for (let r = 0; r < 8 && er < 0; r++) for (let c = 0; c < 8; c++) if (g.bitmap[r][c] === 0) { er = r; ec = c; break; }
  assert(er >= 0, 'puzzle has at least one empty cell');
  // Over-fill FIRST (board never hits an exact-match/lock state), then fill all required cells.
  mark(g, 'a', er, ec, 'filled'); // the stray over-fill
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (g.bitmap[r][c] === 1) mark(g, 'a', r, c, 'filled');
  eq(g.boards['a'].solved, false, 'over-filled board is not solved');
  // remove the stray fill -> now an exact match -> solved
  mark(g, 'a', er, ec, 'empty');
  eq(g.boards['a'].solved, true, 'exact match solves');
});

test('solving is detected, ranked by finish order, and locks further marks', () => {
  const g = newGame(['a', 'b']);
  solve(g, 'a');
  eq(g.boards['a'].solved, true, 'a solved');
  assert(g.done.has('a'), 'a is done');
  eq(g.getStateForPlayer('a').mySolveRank, 1, 'first solver rank 1');
  // a is locked: a stray mark is a no-op
  const before = JSON.stringify(g.boards['a'].marks);
  mark(g, 'a', 0, 0, g.bitmap[0][0] === 1 ? 'empty' : 'filled');
  eq(JSON.stringify(g.boards['a'].marks), before, 'solved board locked');
  solve(g, 'b');
  eq(g.state, 'reveal', 'both solved -> reveal');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1, 'a first');
  eq(res.find((r) => r.playerId === 'b').placement, 2, 'b second');
});

test('round timer auto-advances to reveal and broadcasts; non-solvers ranked by correct count', () => {
  const g = newGame(['a', 'b', 'c']);
  solve(g, 'a'); // a solves
  // b fills one correct cell only; c does nothing
  let fr = -1, fc = -1;
  for (let r = 0; r < 8 && fr < 0; r++) for (let c = 0; c < 8; c++) if (g.bitmap[r][c] === 1) { fr = r; fc = c; break; }
  // give b a partial: fill that one cell (still wrong overall)
  mark(g, 'b', fr, fc, 'filled');
  const emitsBefore = g.emitCount;
  advance(120_000);
  eq(g.state, 'reveal', 'timer ended round');
  assert(g.emitCount > emitsBefore, 'broadcast fired on timer');
  const s = g.getStateForPlayer('a');
  assert(Array.isArray(s.solution), 'solution revealed');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1, 'solver first');
  // b has more correct than c -> b ranks above c
  const bp = res.find((r) => r.playerId === 'b').placement;
  const cp = res.find((r) => r.playerId === 'c').placement;
  assert(bp <= cp, 'b (partial) ranks at or above c (blank)');
});

test('opponents expose only solved + percent (no marks/board leaked)', () => {
  const g = newGame(['a', 'b']);
  solve(g, 'a');
  const opp = g.getStateForPlayer('b').opponents.find((o) => o.playerId === 'a');
  eq(Object.keys(opp).sort().join(','), 'percent,playerId,solved');
  assert(!('marks' in opp) && !('myMarks' in opp), 'no board leaked');
});

test('full game reaches finished with getResults length N and placement 1 first (N in 2,3,4)', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    for (const p of players) solve(g, p); // everyone solves in order p0,p1,...
    eq(g.state, 'reveal', `n=${n} -> reveal`);
    // acknowledge all -> finished
    for (const p of players) g.handleAction(p, { type: 'acknowledge' });
    eq(g.state, 'finished', `n=${n} finished`);
    eq(g.isComplete(), true);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].placement, 1, 'first placement is 1');
    eq(res[0].playerId, 'p0', 'first solver placed first');
    res.forEach((e) => assert(typeof e.placement === 'number'));
  }
});

test('reveal auto-ack advances to finished after 10s', () => {
  const g = newGame(['a', 'b']);
  solve(g, 'a'); solve(g, 'b');
  eq(g.state, 'reveal');
  advance(10_000);
  eq(g.state, 'finished');
  eq(g.isComplete(), true);
});

test('a tie (no solvers, equal blank progress) shares placement 1', () => {
  const g = newGame(['a', 'b']);
  advance(120_000); // nobody touched anything -> equal correct counts
  const res = g.getResults();
  eq(res[0].placement, 1);
  eq(res[1].placement, 1, 'equal progress ties');
});

test('removePlayer mid-solve advances with no deadlock', () => {
  const g = newGame(['a', 'b']);
  solve(g, 'b'); // b solved; a still solving
  g.removePlayer('a'); // the only remaining racer leaves
  assert(g.state === 'reveal' || g.state === 'finished', `ended (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver pruned');
});

test('leaving down to one finishes and clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('NonogramDash');
