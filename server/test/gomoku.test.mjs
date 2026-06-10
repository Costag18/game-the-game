import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { GomokuMatch, SIZE, NEED } from '../src/games/GomokuMatch.js';
import { Gomoku } from '../src/games/Gomoku.js';

installClock();

const place = (m, pid, row, col) => m.applyMove(pid, { row, col });

test('placing a stone marks the point and flips the turn', () => {
  const m = new GomokuMatch('a', 'b');
  eq(place(m, 'a', 7, 7), true);
  eq(m.board[7][7], 'a');
  eq(m.lastMove.row, 7);
  eq(m.lastMove.col, 7);
  eq(m.turn, 'b');
});

test('occupied point rejected; out-of-turn rejected; off-board rejected', () => {
  const m = new GomokuMatch('a', 'b');
  eq(place(m, 'a', 5, 5), true);
  eq(place(m, 'b', 5, 5), false); // occupied
  // out of turn (it is b's turn now)
  eq(place(m, 'a', 0, 0), false);
  // off-board
  eq(place(m, 'b', -1, 0), false);
  eq(place(m, 'b', 0, SIZE), false);
  eq(place(m, 'b', 0, 0.5), false);
  eq(place(m, 'b', 0, 0), true);
});

test('horizontal five-in-a-row wins through the placed stone', () => {
  const m = new GomokuMatch('a', 'b');
  // pre-place 4 of a's stones, leave the gap, then play the deciding move
  m.board[7][3] = 'a'; m.board[7][4] = 'a'; m.board[7][6] = 'a'; m.board[7][7] = 'a';
  m.turn = 'a';
  eq(place(m, 'a', 7, 5), true); // completes 3..7 horizontal
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
  assert(m._winningCells.length >= NEED, 'winning line length');
});

test('vertical five-in-a-row wins', () => {
  const m = new GomokuMatch('a', 'b');
  m.board[2][8] = 'a'; m.board[3][8] = 'a'; m.board[4][8] = 'a'; m.board[6][8] = 'a';
  m.turn = 'a';
  eq(place(m, 'a', 5, 8), true);
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
});

test('diagonal five-in-a-row wins', () => {
  const m = new GomokuMatch('a', 'b');
  m.board[1][1] = 'a'; m.board[2][2] = 'a'; m.board[4][4] = 'a'; m.board[5][5] = 'a';
  m.turn = 'a';
  eq(place(m, 'a', 3, 3), true); // (1,1)(2,2)(3,3)(4,4)(5,5)
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
  assert(m._winningCells.length >= NEED, 'diagonal line length');
});

test('anti-diagonal five-in-a-row wins', () => {
  const m = new GomokuMatch('a', 'b');
  m.board[1][9] = 'a'; m.board[2][8] = 'a'; m.board[4][6] = 'a'; m.board[5][5] = 'a';
  m.turn = 'a';
  eq(place(m, 'a', 3, 7), true); // (1,9)(2,8)(3,7)(4,6)(5,5)
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
});

test('four-in-a-row does NOT win', () => {
  const m = new GomokuMatch('a', 'b');
  m.board[7][3] = 'a'; m.board[7][4] = 'a'; m.board[7][5] = 'a';
  m.turn = 'a';
  eq(place(m, 'a', 7, 6), true); // only four
  eq(m.isOver(), false);
  eq(m.turn, 'b');
});

test('scoreDiff is +1000/-1000/0', () => {
  const m = new GomokuMatch('a', 'b');
  m.board[0][0] = 'a'; m.board[0][1] = 'a'; m.board[0][2] = 'a'; m.board[0][3] = 'a';
  m.turn = 'a';
  eq(place(m, 'a', 0, 4), true); // a wins
  eq(m.scoreDiff('a'), 1000);
  eq(m.scoreDiff('b'), -1000);
});

test('scoreDiff is 0 while the game is undecided', () => {
  const m = new GomokuMatch('a', 'b');
  eq(m.scoreDiff('a'), 0);
  eq(m.scoreDiff('b'), 0);
});

test('autoMove returns a legal empty intersection', () => {
  const m = new GomokuMatch('a', 'b');
  m.board[7][7] = 'a';
  const am = m.autoMove();
  assert(am && Number.isInteger(am.row) && Number.isInteger(am.col), 'has coords');
  assert(am.row >= 0 && am.row < SIZE && am.col >= 0 && am.col < SIZE, 'in bounds');
  assert(m.board[am.row][am.col] === null, 'targets an empty point');
});

test('Gomoku wraps PairingEngine: full game ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = new Gomoku(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          while (!m.engine.isOver()) {
            const turnPlayer = m.engine.turn;
            m.engine.applyMove(turnPlayer, m.engine.autoMove());
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

test('per-turn timeout auto-plays (does not forfeit) for Gomoku', () => {
  const g = new Gomoku(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const before = m.engine._moveCount;
  advance(30_000); // per-turn timer → autoMove
  assert((m.engine && m.engine._moveCount > before) || g.state === 'miniRoundSummary', 'auto-played, not forfeited');
});

uninstallClock();
report('Gomoku');
