import { installClock, uninstallClock, test, assert, eq, report } from './helpers.mjs';
import { UltimateTTTMatch } from '../src/games/UltimateTTTMatch.js';
import { UltimateTicTacToe } from '../src/games/UltimateTicTacToe.js';

installClock();

test('first move sets the forced board from the cell played', () => {
  const m = new UltimateTTTMatch('a', 'b');
  eq(m.applyMove('a', { board: 4, cell: 0 }), true);
  eq(m.sub[4][0], 'X');
  eq(m.forcedBoard, 0); // opponent must play board 0
  eq(m.turn, 'b');
});

test('forced-board rule rejects a move in the wrong board', () => {
  const m = new UltimateTTTMatch('a', 'b');
  m.applyMove('a', { board: 4, cell: 0 }); // forces board 0
  eq(m.applyMove('b', { board: 3, cell: 0 }), false); // not the forced board
  eq(m.applyMove('b', { board: 0, cell: 5 }), true);
  eq(m.forcedBoard, 5);
});

test('out-of-turn, taken cell, and decided sub-board are rejected', () => {
  const m = new UltimateTTTMatch('a', 'b');
  eq(m.applyMove('b', { board: 0, cell: 0 }), false); // not b's turn
  m.applyMove('a', { board: 0, cell: 0 });
  m.forcedBoard = null; // free move for test
  eq(m.applyMove('b', { board: 0, cell: 0 }), false); // cell taken
  m.meta[1] = 'O';
  eq(m.applyMove('b', { board: 1, cell: 3 }), false); // sub-board decided
});

test('completing a sub-board line sets the meta cell', () => {
  const m = new UltimateTTTMatch('a', 'b');
  m.sub[0][0] = 'X'; m.sub[0][1] = 'X'; m.turn = 'a'; m.forcedBoard = 0;
  eq(m.applyMove('a', { board: 0, cell: 2 }), true);
  eq(m.meta[0], 'X');
});

test('winning three sub-boards in a line wins the match', () => {
  const m = new UltimateTTTMatch('a', 'b');
  m.meta[0] = 'X'; m.meta[1] = 'X';
  m.sub[2][0] = 'X'; m.sub[2][1] = 'X';
  m.turn = 'a'; m.forcedBoard = 2;
  eq(m.applyMove('a', { board: 2, cell: 2 }), true);
  eq(m._status, 'won');
  eq(m.winner(), 'a');
  eq(m.turn, null);
});

test('full sub-board with no line marks a draw cell (D)', () => {
  const m = new UltimateTTTMatch('a', 'b');
  // fill sub-board 0 with no 3-in-a-row: X O X / X O O / O X X
  const fill = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  for (let i = 0; i < 8; i++) m.sub[0][i] = fill[i];
  m.turn = 'a'; m.forcedBoard = 0;
  eq(m.applyMove('a', { board: 0, cell: 8 }), true); // X at 8 → no line
  eq(m.meta[0], 'D');
});

test('scoreDiff rewards the winner and the sub-board margin', () => {
  const m = new UltimateTTTMatch('a', 'b');
  m.meta = ['X', 'X', 'X', 'O', '', '', '', '', ''];
  m._winner = 'a'; m._status = 'won';
  eq(m.scoreDiff('a'), (3 - 1) + 1000);
  eq(m.scoreDiff('b'), (1 - 3) - 1000);
});

test('autoMove returns a legal move (or null when full)', () => {
  const m = new UltimateTTTMatch('a', 'b');
  const mv = m.autoMove();
  assert(mv && mv.board >= 0 && mv.cell >= 0, 'legal auto move');
  eq(m.applyMove('a', mv), true);
});

test('wrapper drives full random games to a complete N ranking', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = new UltimateTicTacToe(players);
    g.setOnStateChange(() => {});
    g.startGame();
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 60) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          let steps = 0;
          while (!m.engine.isOver() && steps++ < 200) {
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
    eq(g.state, 'finished', `n=${n} finished`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].placement, 1);
  }
});

uninstallClock();
report('UltimateTicTacToe');
