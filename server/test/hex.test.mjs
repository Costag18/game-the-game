import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { HexMatch, SIZE } from '../src/games/HexMatch.js';
import { Hex } from '../src/games/Hex.js';

installClock();

const place = (m, pid, r, c) => m.applyMove(pid, { r, c });

test('place lands on the cell and flips the turn', () => {
  const m = new HexMatch('a', 'b');
  eq(place(m, 'a', 5, 5), true);
  eq(m.board[5][5], 'a');
  eq(m.lastMove.r, 5);
  eq(m.lastMove.c, 5);
  eq(m.turn, 'b');
});

test('occupied cell rejected; out-of-turn rejected; out-of-bounds rejected', () => {
  const m = new HexMatch('a', 'b');
  eq(place(m, 'a', 0, 0), true); // a -> b
  eq(place(m, 'b', 0, 0), false); // occupied
  eq(place(m, 'a', 1, 1), false); // out of turn (it's b's turn)
  eq(place(m, 'b', SIZE, 0), false); // out of bounds
  eq(place(m, 'b', -1, 0), false); // out of bounds
  eq(m.turn, 'b'); // unchanged by rejected moves
});

test('p1 wins by connecting TOP to BOTTOM (vertical column)', () => {
  const m = new HexMatch('a', 'b');
  // Fill column 5 for player a in rows 0..SIZE-2 directly, then play the last row.
  for (let r = 0; r < SIZE - 1; r++) m.board[r][5] = 'a';
  m.turn = 'a';
  eq(place(m, 'a', SIZE - 1, 5), true); // completes top→bottom chain
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
  assert(m._winningCells && m._winningCells.length >= SIZE, 'winning chain spans both edges');
});

test('p2 wins by connecting LEFT to RIGHT (horizontal row)', () => {
  const m = new HexMatch('a', 'b');
  // Player b owns left/right. Fill row 5 cols 0..SIZE-2, then play last col.
  for (let c = 0; c < SIZE - 1; c++) m.board[5][c] = 'b';
  m.turn = 'b';
  eq(place(m, 'b', 5, SIZE - 1), true); // completes left→right chain
  eq(m.isOver(), true);
  eq(m.winner(), 'b');
});

test('winning chain may use hex diagonal adjacency', () => {
  const m = new HexMatch('a', 'b');
  // Build a staircase for p1 using (r+1,c-1) neighbour links, top to bottom.
  // Start at (0, SIZE-1) and step down-left to (SIZE-1, 0).
  for (let r = 0; r < SIZE - 1; r++) m.board[r][SIZE - 1 - r] = 'a';
  m.turn = 'a';
  eq(place(m, 'a', SIZE - 1, 0), true);
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
});

test('a non-connecting stone does not win and flips turn', () => {
  const m = new HexMatch('a', 'b');
  for (let r = 0; r < SIZE - 2; r++) m.board[r][3] = 'a'; // short of bottom edge
  m.turn = 'a';
  eq(place(m, 'a', SIZE - 2, 3), true); // still one row short of bottom
  eq(m.isOver(), false);
  eq(m.turn, 'b');
});

test('Hex never draws', () => {
  const m = new HexMatch('a', 'b');
  eq(m.isDraw(), false);
  place(m, 'a', 0, 0);
  eq(m.isDraw(), false);
});

test('scoreDiff is +1000/-1000/0', () => {
  const m = new HexMatch('a', 'b');
  for (let r = 0; r < SIZE - 1; r++) m.board[r][2] = 'a';
  m.turn = 'a';
  place(m, 'a', SIZE - 1, 2); // a wins top-bottom
  eq(m.scoreDiff('a'), 1000);
  eq(m.scoreDiff('b'), -1000);
  const fresh = new HexMatch('a', 'b');
  eq(fresh.scoreDiff('a'), 0); // not over
});

test('string r/c keys tolerated; autoMove returns a legal empty cell', () => {
  const m = new HexMatch('a', 'b');
  eq(m.applyMove('a', { r: '4', c: '6' }), true); // JSON string keys
  eq(m.board[4][6], 'a');
  const am = m.autoMove();
  assert(am && Number.isInteger(am.r) && Number.isInteger(am.c), 'auto move shape');
  assert(am.r >= 0 && am.r < SIZE && am.c >= 0 && am.c < SIZE, 'auto move in bounds');
  assert(m.board[am.r][am.c] === null, 'auto move targets an empty cell');
});

test('Hex wraps PairingEngine: full game ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = new Hex(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 5000) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          while (!m.engine.isOver()) {
            const mv = m.engine.autoMove();
            if (!mv) break;
            m.engine.applyMove(m.engine.turn, mv);
          }
          if (m.engine.isOver()) g._resolveMatch(g.matches.indexOf(m));
        }
      } else if (g.state === 'miniRoundSummary') {
        for (const p of [...g.players]) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
  }
});

test('per-turn timeout auto-plays (does not forfeit) for Hex', () => {
  const g = new Hex(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const before = m.engine._moveCount;
  advance(30_000); // per-turn timer → autoMove
  assert((m.engine && m.engine._moveCount > before) || g.state === 'miniRoundSummary', 'auto-played, not forfeited');
});

uninstallClock();
report('Hex');
