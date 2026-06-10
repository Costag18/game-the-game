import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { GridLock } from '../src/games/GridLock.js';

installClock();

const N = 4;
const SIZE = 16;
const BLANK = 0;

function newGame(players) {
  const g = new GridLock(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

const slide = (g, p, tile) => g.handleAction(p, { type: 'slide', tile });

function neighbors(idx) {
  const r = Math.floor(idx / N);
  const c = idx % N;
  const out = [];
  if (r > 0) out.push(idx - N);
  if (r < N - 1) out.push(idx + N);
  if (c > 0) out.push(idx - 1);
  if (c < N - 1) out.push(idx + 1);
  return out;
}

function isSolvedArr(b) {
  for (let i = 0; i < SIZE - 1; i++) if (b[i] !== i + 1) return false;
  return b[SIZE - 1] === BLANK;
}

// Parity-based solvability check for the 15-puzzle: the permutation parity of the
// tiles (blank excluded) must match the blank-row parity (counted from bottom).
function isSolvable(board) {
  const tiles = board.filter((v) => v !== BLANK);
  let inversions = 0;
  for (let i = 0; i < tiles.length; i++)
    for (let j = i + 1; j < tiles.length; j++)
      if (tiles[i] > tiles[j]) inversions++;
  const blankIdx = board.indexOf(BLANK);
  const blankRowFromBottom = N - Math.floor(blankIdx / N);
  // For a 4-wide board the SOLVED goal has (inversions=0)+(blankRow=1)=1 (odd),
  // so a position is solvable iff (inversions + blankRowFromBottom) is ODD.
  return (inversions + blankRowFromBottom) % 2 === 1;
}

// Drive a player from their current board to the fully solved board by BFS over
// blank-slides, replaying the moves through the real handleAction (proves the
// server validates + applies every slide).
function driveToSolve(g, p) {
  const start = g.boards[p].board.slice();
  if (isSolvedArr(start)) return [];
  const goal = [];
  for (let i = 1; i < SIZE; i++) goal.push(i);
  goal.push(BLANK);
  const goalKey = goal.join(',');

  const seen = new Set([start.join(',')]);
  const queue = [{ board: start, path: [] }];
  while (queue.length) {
    const { board, path } = queue.shift();
    const blank = board.indexOf(BLANK);
    for (const nb of neighbors(blank)) {
      const next = board.slice();
      const movedTile = next[nb];
      next[blank] = movedTile;
      next[nb] = BLANK;
      const key = next.join(',');
      if (seen.has(key)) continue;
      const newPath = path.concat(movedTile);
      if (key === goalKey) {
        for (const t of newPath) slide(g, p, t);
        return newPath;
      }
      seen.add(key);
      queue.push({ board: next, path: newPath });
    }
  }
  throw new Error('no solution path found (scramble unsolvable?)');
}

// Make the scramble shallow so BFS solve is fast/deterministic in tests.
function withShallowScramble(g, slides = 6) {
  // rebuild a solvable board only a few legal slides from solved
  const board = [];
  for (let i = 1; i < SIZE; i++) board.push(i);
  board.push(BLANK);
  let blank = SIZE - 1;
  let prev = -1;
  for (let i = 0; i < slides; i++) {
    const opts = neighbors(blank).filter((n) => n !== prev);
    const pick = opts[i % opts.length];
    board[blank] = board[pick];
    board[pick] = BLANK;
    prev = blank;
    blank = pick;
  }
  g.scramble = board.slice();
  for (const p of g.players) g.boards[p].board = board.slice();
}

test('starts playing; generator produces a SOLVABLE, non-solved scramble', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'playing');
  assert(pendingTimers() >= 1, 'round timer armed');
  eq(g.scramble.length, SIZE);
  // contains exactly 0..15 once each
  const sorted = [...g.scramble].sort((x, y) => x - y);
  eq(sorted.join(','), Array.from({ length: SIZE }, (_, i) => i).join(','));
  assert(!isSolvedArr(g.scramble), 'scramble is not already solved');
  assert(isSolvable(g.scramble), 'scramble is solvable');
  // every player starts from the SAME scramble
  eq(g.boards['a'].board.join(','), g.scramble.join(','));
  eq(g.boards['b'].board.join(','), g.scramble.join(','));
});

test('100 generated scrambles are all solvable + not pre-solved', () => {
  for (let i = 0; i < 100; i++) {
    const g = newGame(['a']);
    assert(isSolvable(g.scramble), `scramble #${i} solvable`);
    assert(!isSolvedArr(g.scramble), `scramble #${i} not solved`);
  }
});

test('a legal slide (tile adjacent to blank) is accepted and applied', () => {
  const g = newGame(['a', 'b']);
  const board = g.boards['a'].board;
  const blank = board.indexOf(BLANK);
  const tileIdx = neighbors(blank)[0];
  const tile = board[tileIdx];
  slide(g, 'a', tile);
  eq(g.boards['a'].moves, 1, 'move counted');
  eq(g.boards['a'].board[blank], tile, 'tile slid into old blank slot');
  eq(g.boards['a'].board[tileIdx], BLANK, 'blank moved to tile slot');
});

test('an illegal slide (non-adjacent tile) is rejected', () => {
  const g = newGame(['a', 'b']);
  const board = g.boards['a'].board;
  const blank = board.indexOf(BLANK);
  const adj = new Set(neighbors(blank).map((i) => board[i]));
  // find a tile NOT adjacent to the blank
  let badTile = null;
  for (let v = 1; v <= 15; v++) if (!adj.has(v)) { badTile = v; break; }
  const before = board.join(',');
  slide(g, 'a', badTile);
  eq(g.boards['a'].moves, 0, 'illegal move not counted');
  eq(g.boards['a'].board.join(','), before, 'board unchanged');
});

test('invalid tile values (out of range / non-integer) are rejected', () => {
  const g = newGame(['a', 'b']);
  slide(g, 'a', 0);    // blank itself
  slide(g, 'a', 16);   // too high
  slide(g, 'a', -1);   // negative
  slide(g, 'a', 2.5);  // non-integer
  eq(g.boards['a'].moves, 0, 'no invalid move counted');
});

test('SOLUTION (solved goal) is NOT leaked pre-reveal; only my own board is sent', () => {
  const g = newGame(['a', 'b']);
  withShallowScramble(g, 6);
  const s = g.getStateForPlayer('a');
  eq(s.results, null, 'no results pre-reveal');
  // opponents never expose their board array, only solved + counts
  const opp = s.opponents.find((o) => o.playerId === 'b');
  assert(!('board' in opp), 'opponent board not leaked');
  eq(Object.keys(opp).sort().join(','), 'moves,playerId,solved,tilesCorrect');
  // the solved goal string must not appear anywhere in the serialized state
  const goal = Array.from({ length: SIZE - 1 }, (_, i) => i + 1).concat(0).join(',');
  const dump = JSON.stringify(s);
  assert(!dump.includes(goal), 'solved-goal sequence not present in pre-reveal state');
});

test('server detects a real solve (validated move-by-move) and ranks finish order', () => {
  const g = newGame(['a', 'b']);
  withShallowScramble(g, 6);
  driveToSolve(g, 'a'); // a solves first
  eq(g.boards['a'].solved, true, 'a solved');
  assert(g.done.has('a'), 'a done');
  driveToSolve(g, 'b'); // b solves second -> round ends (all solved)
  eq(g.state, 'reveal');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1, 'first solver is 1st');
  eq(res.find((r) => r.playerId === 'b').placement, 2, 'second solver is 2nd');
});

test('a client cannot fake a solve — only server-validated slides reach solved', () => {
  const g = newGame(['a', 'b']);
  withShallowScramble(g, 6);
  // bogus actions don't change anything
  g.handleAction('a', { type: 'solve' });
  g.handleAction('a', { type: 'slide' });            // no tile
  g.handleAction('a', { type: 'slide', tile: 99 });  // invalid
  eq(g.boards['a'].solved, false, 'no fake solve');
  eq(g.boards['a'].moves, 0, 'no moves applied');
});

test('solver ranks ahead of non-solver; reveal shows results + solved goal', () => {
  const g = newGame(['a', 'b']);
  withShallowScramble(g, 6);
  driveToSolve(g, 'a');           // a solves
  advance(120_000);               // timer ends round (b never solved)
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  assert(Array.isArray(s.results), 'results present at reveal');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1, 'solver first');
  eq(res.find((r) => r.playerId === 'b').placement, 2, 'non-solver second');
  assert(res.find((r) => r.playerId === 'a').solved, 'a marked solved');
});

test('overall timer auto-advances to reveal + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(120_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'timer fired a broadcast');
});

test('non-solvers ranked by fewest tiles out of place; equal progress ties', () => {
  const g = newGame(['a', 'b']);
  // identical untouched boards => identical tilesCorrect => tie at 1
  advance(120_000);
  const res = g.getResults();
  eq(res[0].placement, 1);
  eq(res[1].placement, 1, 'equal progress shares placement');
});

test('full game reaches finished with N results, placement 1 first, for N in [2,3,4]', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    withShallowScramble(g, 6);
    // everyone solves in order p0, p1, ...
    for (const p of players) driveToSolve(g, p);
    eq(g.state, 'reveal', `n=${n} reached reveal`);
    advance(10_000); // ack auto-advance
    eq(g.state, 'finished', `n=${n} finished`);
    eq(g.isComplete(), true);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].placement, 1, `n=${n} first placement is 1`);
    eq(res[0].playerId, 'p0', 'first solver is first');
  }
});

test('reveal auto-ack advances to finished after 10s', () => {
  const g = newGame(['a', 'b']);
  withShallowScramble(g, 6);
  driveToSolve(g, 'a');
  driveToSolve(g, 'b');
  eq(g.state, 'reveal');
  advance(10_000);
  eq(g.state, 'finished');
  eq(g.isComplete(), true);
});

test('removePlayer mid-solve advances (the last unsolved player leaving ends round)', () => {
  const g = newGame(['a', 'b']);
  withShallowScramble(g, 6);
  driveToSolve(g, 'a');     // a solved, b still playing
  g.removePlayer('b');      // only remaining = a => finishes
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver pruned from results');
});

test('leaving down to one finishes and clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('a present player solving while one already solved keeps round live until all done', () => {
  const g = newGame(['a', 'b', 'c']);
  withShallowScramble(g, 6);
  driveToSolve(g, 'a');
  eq(g.state, 'playing', 'still playing with b,c unsolved');
  driveToSolve(g, 'b');
  eq(g.state, 'playing', 'still playing with c unsolved');
  driveToSolve(g, 'c');
  eq(g.state, 'reveal', 'all solved -> reveal');
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('GridLock');
