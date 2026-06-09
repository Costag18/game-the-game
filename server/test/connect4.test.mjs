import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { Connect4Match, COLS, ROWS } from '../src/games/Connect4Match.js';
import { Connect4 } from '../src/games/Connect4.js';

installClock();

const drop = (m, pid, col) => m.applyMove(pid, { col });

test('drop lands at the lowest empty row and flips the turn', () => {
  const m = new Connect4Match('a', 'b');
  eq(drop(m, 'a', 3), true);
  eq(m.board[0][3], 'a');
  eq(m.lastMove.row, 0);
  eq(m.turn, 'b');
});

test('full column rejects the 7th drop; out-of-turn rejected', () => {
  const m = new Connect4Match('a', 'b');
  // fill column 0 (alternating turns)
  for (let i = 0; i < ROWS; i++) drop(m, m.turn, 0);
  eq(m._moveCount, ROWS);
  const ok = drop(m, m.turn, 0); // column full
  eq(ok, false);
  // out of turn
  const cur = m.turn;
  const off = cur === 'a' ? 'b' : 'a';
  eq(drop(m, off, 1), false);
});

test('horizontal four-in-a-row wins', () => {
  const m = new Connect4Match('a', 'b');
  // a plays cols 0,1,2,3 on row 0; b plays row1 above to burn turns
  drop(m, 'a', 0); drop(m, 'b', 0);
  drop(m, 'a', 1); drop(m, 'b', 1);
  drop(m, 'a', 2); drop(m, 'b', 2);
  drop(m, 'a', 3);
  eq(m.isOver(), true); eq(m.winner(), 'a');
  eq(m._winningCells.length, 4);
});

test('vertical four-in-a-row wins', () => {
  const m = new Connect4Match('a', 'b');
  drop(m, 'a', 0); drop(m, 'b', 1);
  drop(m, 'a', 0); drop(m, 'b', 1);
  drop(m, 'a', 0); drop(m, 'b', 1);
  drop(m, 'a', 0);
  eq(m.isOver(), true); eq(m.winner(), 'a');
});

test('diagonal four-in-a-row wins', () => {
  const m = new Connect4Match('a', 'b');
  // set up an ascending diagonal for a with the top cell still empty, then drop it
  m.board[0][0] = 'a';
  m.board[0][1] = 'b'; m.board[1][1] = 'a';
  m.board[0][2] = 'b'; m.board[1][2] = 'b'; m.board[2][2] = 'a';
  m.board[0][3] = 'b'; m.board[1][3] = 'b'; m.board[2][3] = 'b';
  m.turn = 'a';
  eq(drop(m, 'a', 3), true); // lands (3,3) → (0,0)(1,1)(2,2)(3,3)
  eq(m.isOver(), true); eq(m.winner(), 'a');
  eq(m._winningCells.length, 4);
});

test('scoreDiff is +1000/-1000/0', () => {
  const m = new Connect4Match('a', 'b');
  drop(m, 'a', 0); drop(m, 'b', 0);
  drop(m, 'a', 1); drop(m, 'b', 1);
  drop(m, 'a', 2); drop(m, 'b', 2);
  drop(m, 'a', 3); // a wins
  eq(m.scoreDiff('a'), 1000);
  eq(m.scoreDiff('b'), -1000);
});

test('string column key tolerated; bad columns rejected', () => {
  const m = new Connect4Match('a', 'b');
  eq(m.applyMove('a', { col: '3' }), true); // JSON string key
  eq(m.applyMove(m.turn, { col: 7 }), false);
  eq(m.applyMove(m.turn, { col: -1 }), false);
  eq(m.applyMove(m.turn, {}), false);
});

test('autoMove returns a legal column', () => {
  const m = new Connect4Match('a', 'b');
  const am = m.autoMove();
  assert(am && am.col >= 0 && am.col < COLS, 'legal auto column');
});

test('Connect4 wraps PairingEngine: full game ranks all N', () => {
  const players = ['a', 'b', 'c', 'd'];
  const g = new Connect4(players);
  g.setOnStateChange(() => {});
  g.startGame();
  eq(g.state, 'match');
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'match') {
      for (const m of g.matches) {
        if (m.over || m.isBye || !m.engine) continue;
        // make the on-turn player win instantly by stacking a vertical line
        const me = m.engine.turn;
        const opp = me === m.p1 ? m.p2 : m.p1;
        m.engine.applyMove(me, { col: 0 });
        m.engine.applyMove(opp, { col: 1 });
        m.engine.applyMove(me, { col: 0 });
        m.engine.applyMove(opp, { col: 1 });
        m.engine.applyMove(me, { col: 0 });
        m.engine.applyMove(opp, { col: 1 });
        m.engine.applyMove(me, { col: 0 }); // me wins vertical
        if (m.engine.isOver()) g._resolveMatch(g.matches.indexOf(m));
      }
    } else if (g.state === 'miniRoundSummary') {
      for (const p of [...g.players]) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 4);
  eq(res[0].placement, 1);
});

test('per-turn timeout auto-drops (does not forfeit) for Connect 4', () => {
  const g = new Connect4(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const before = m.engine._moveCount;
  advance(30_000); // per-turn timer → autoMove
  // either the match progressed by an auto-drop or it resolved into summary
  assert((m.engine && m.engine._moveCount > before) || g.state === 'miniRoundSummary', 'auto-dropped, not forfeited');
});

uninstallClock();
report('Connect4');
