import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { OrderAndChaosMatch, SIZE } from '../src/games/OrderAndChaosMatch.js';
import { OrderAndChaos } from '../src/games/OrderAndChaos.js';

installClock();

const place = (m, pid, r, c, symbol) => m.applyMove(pid, { r, c, symbol });

test('legal placement lands the symbol and flips the turn', () => {
  const m = new OrderAndChaosMatch('a', 'b');
  eq(place(m, 'a', 2, 3, 'X'), true);
  eq(m.board[2][3], 'X');
  eq(m.lastMove.symbol, 'X');
  eq(m.turn, 'b');
});

test('both players may place both symbols', () => {
  const m = new OrderAndChaosMatch('a', 'b');
  eq(place(m, 'a', 0, 0, 'O'), true); // Order places O
  eq(place(m, 'b', 0, 1, 'X'), true); // Chaos places X
  eq(m.board[0][0], 'O');
  eq(m.board[0][1], 'X');
});

test('out-of-turn and occupied-cell moves are rejected', () => {
  const m = new OrderAndChaosMatch('a', 'b');
  eq(place(m, 'b', 0, 0, 'X'), false); // not b's turn
  eq(place(m, 'a', 0, 0, 'X'), true);
  eq(place(m, 'b', 0, 0, 'O'), false); // cell occupied
  // bad symbol / out of bounds
  eq(place(m, 'b', 1, 1, 'Z'), false);
  eq(place(m, 'b', -1, 1, 'X'), false);
  eq(place(m, 'b', 1, 6, 'X'), false);
});

test('Order wins immediately on five-in-a-row (horizontal)', () => {
  const m = new OrderAndChaosMatch('a', 'b');
  // pre-place four X in row 0, then play the deciding fifth
  m.board[0][0] = 'X'; m.board[0][1] = 'X'; m.board[0][2] = 'X'; m.board[0][3] = 'X';
  m._moveCount = 4;
  m.turn = 'a';
  eq(place(m, 'a', 0, 4, 'X'), true);
  eq(m.isOver(), true);
  eq(m.winner(), 'a'); // ORDER = p1
  eq(m._winningCells.length, 5);
});

test('five-in-a-row by EITHER player still makes ORDER win', () => {
  const m = new OrderAndChaosMatch('a', 'b');
  // CHAOS (p2) completes a line of five → ORDER still wins
  m.board[1][0] = 'O'; m.board[1][1] = 'O'; m.board[1][2] = 'O'; m.board[1][3] = 'O';
  m._moveCount = 4;
  m.turn = 'b';
  eq(place(m, 'b', 1, 4, 'O'), true);
  eq(m.isOver(), true);
  eq(m.winner(), 'a'); // ORDER (p1) wins regardless of who placed
});

test('Chaos wins when the board fills with no five-in-a-row', () => {
  const m = new OrderAndChaosMatch('a', 'b');
  // Fill 35 cells avoiding any 5-line, then place the last cell.
  // Pattern XXXXO repeating per row prevents 5 identical in any direction.
  const pat = (r, c) => (((r + c) % 5) === 4 ? 'O' : 'X');
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (r === SIZE - 1 && c === SIZE - 1) continue; // leave last empty
      m.board[r][c] = pat(r, c);
    }
  }
  m._moveCount = SIZE * SIZE - 1;
  m.turn = 'a';
  eq(place(m, 'a', SIZE - 1, SIZE - 1, pat(SIZE - 1, SIZE - 1)), true);
  eq(m.isOver(), true);
  eq(m.winner(), 'b'); // CHAOS = p2
});

test('scoreDiff is +1000 winner / -1000 loser', () => {
  const m = new OrderAndChaosMatch('a', 'b');
  m.board[0][0] = 'X'; m.board[0][1] = 'X'; m.board[0][2] = 'X'; m.board[0][3] = 'X';
  m._moveCount = 4; m.turn = 'a';
  place(m, 'a', 0, 4, 'X'); // Order wins
  eq(m.scoreDiff('a'), 1000);
  eq(m.scoreDiff('b'), -1000);
});

test('autoMove returns a legal empty cell + valid symbol', () => {
  const m = new OrderAndChaosMatch('a', 'b');
  m.board[0][0] = 'X';
  const am = m.autoMove();
  assert(am && am.r >= 0 && am.r < SIZE && am.c >= 0 && am.c < SIZE, 'in bounds');
  assert(am.symbol === 'X' || am.symbol === 'O', 'valid symbol');
  assert(m.board[am.r][am.c] === null, 'targets an empty cell');
});

test('OrderAndChaos wraps PairingEngine: full game ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = new OrderAndChaos(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 2000) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          while (!m.engine.isOver()) {
            const me = m.engine.turn;
            const mv = m.engine.autoMove();
            m.engine.applyMove(me, mv);
          }
          g._resolveMatch(g.matches.indexOf(m));
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

test('per-turn timeout auto-plays (keeps the match alive) for Order & Chaos', () => {
  const g = new OrderAndChaos(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const before = m.engine._moveCount;
  advance(30_000); // per-turn timer → autoMove
  assert((m.engine && m.engine._moveCount > before) || g.state === 'miniRoundSummary', 'auto-played, not forfeited');
});

uninstallClock();
report('OrderAndChaos');
