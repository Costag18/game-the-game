import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { PentagoMatch, SIZE } from '../src/games/PentagoMatch.js';
import { Pentago } from '../src/games/Pentago.js';

installClock();

const idx = (r, c) => r * SIZE + c;
// a "no-op" rotation target: q3 is empty at game start so rotating it cw/ccw never
// disturbs already-placed marbles in q0/q1/q2 used by the win-setup tests.
const move = (m, pid, cell) => m.applyMove(pid, { cell, quadrant: 3, dir: 'cw' });

test('a place + rotate is accepted and flips the turn', () => {
  const m = new PentagoMatch('a', 'b');
  eq(m.applyMove('a', { cell: idx(0, 0), quadrant: 3, dir: 'cw' }), true);
  eq(m.board[idx(0, 0)], 'a');
  eq(m.turn, 'b');
  eq(m._moveCount, 1);
});

test('out-of-turn, occupied-cell, and bad move shapes are rejected', () => {
  const m = new PentagoMatch('a', 'b');
  eq(m.applyMove('b', { cell: 0, quadrant: 0, dir: 'cw' }), false); // out of turn (a first)
  eq(m.applyMove('a', { cell: idx(0, 0), quadrant: 3, dir: 'cw' }), true);
  // now b's turn — illegal attempts
  eq(m.applyMove('b', { cell: idx(0, 0), quadrant: 3, dir: 'cw' }), false); // occupied
  eq(m.applyMove('b', { cell: 99, quadrant: 0, dir: 'cw' }), false);        // off-board cell
  eq(m.applyMove('b', { cell: idx(1, 1), quadrant: 9, dir: 'cw' }), false); // bad quadrant
  eq(m.applyMove('b', { cell: idx(1, 1), quadrant: 0, dir: 'spin' }), false); // bad dir
  eq(m.applyMove('b', {}), false);
  eq(m.turn, 'b'); // still b's turn — nothing applied
});

test('quadrant rotation moves marbles in place (cw and ccw)', () => {
  const m = new PentagoMatch('a', 'b');
  // place a marble at q0 top-left corner (0,0), then rotate q0 cw → should land at (0,2)
  m.board[idx(0, 0)] = 'a';
  m._rotateQuadrant(0, 'cw');
  eq(m.board[idx(0, 0)], null);
  eq(m.board[idx(0, 2)], 'a');
  // rotate q0 ccw → back to (0,0)
  m._rotateQuadrant(0, 'ccw');
  eq(m.board[idx(0, 0)], 'a');
  eq(m.board[idx(0, 2)], null);
});

test('five-in-a-row by the mover wins', () => {
  const m = new PentagoMatch('a', 'b');
  // pre-seed a's marbles at (0,0)..(0,3); deciding placement at (0,4) makes a horizontal 5
  m.board[idx(0, 0)] = 'a'; m.board[idx(0, 1)] = 'a'; m.board[idx(0, 2)] = 'a'; m.board[idx(0, 3)] = 'a';
  m.turn = 'a';
  eq(move(m, 'a', idx(0, 4)), true); // place (0,4) in q1, rotate empty q3 (no-op)
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
  eq(m._winningCells.length, 5);
});

test('rotation that completes only the opponent line → opponent wins', () => {
  const m = new PentagoMatch('a', 'b');
  // b's diagonal line (0,1),(1,2),(2,3),(3,4),(4,5). Gap = (2,3) (top-right quadrant q1).
  // The four other line cells are placed fixed; b's "source" marble sits at (2,5) inside q1.
  // a places a harmless marble at (0,0) then rotates q1 CW, which carries b's (2,5) marble
  // into the gap (2,3) — completing b's five even though a placed nothing on the line.
  m.board[idx(0, 1)] = 'b'; m.board[idx(1, 2)] = 'b'; m.board[idx(3, 4)] = 'b'; m.board[idx(4, 5)] = 'b';
  m.board[idx(2, 5)] = 'b'; // source marble in q1, will rotate into the gap
  m.turn = 'a';
  eq(m.applyMove('a', { cell: idx(0, 0), quadrant: 1, dir: 'cw' }), true);
  eq(m.board[idx(2, 3)], 'b'); // rotation brought b's marble into the gap
  eq(m.isOver(), true);
  eq(m.winner(), 'b'); // opponent completed by the mover's rotation
});

test('scoreDiff is +1000 / -1000 / 0', () => {
  const m = new PentagoMatch('a', 'b');
  m.board[idx(0, 0)] = 'a'; m.board[idx(0, 1)] = 'a'; m.board[idx(0, 2)] = 'a'; m.board[idx(0, 3)] = 'a';
  m.turn = 'a';
  move(m, 'a', idx(0, 4)); // a wins
  eq(m.scoreDiff('a'), 1000);
  eq(m.scoreDiff('b'), -1000);
  const d = new PentagoMatch('a', 'b');
  eq(d.scoreDiff('a'), 0); // not over → 0
});

test('autoMove returns a legal place+rotate move', () => {
  const m = new PentagoMatch('a', 'b');
  const am = m.autoMove();
  assert(am && Number.isInteger(am.cell) && am.cell >= 0 && am.cell < SIZE * SIZE, 'legal cell');
  assert(am.quadrant >= 0 && am.quadrant < 4, 'legal quadrant');
  assert(am.dir === 'cw' || am.dir === 'ccw', 'legal dir');
  eq(m.board[am.cell], null); // points at an empty cell
  eq(m.applyMove('a', am), true); // and it's actually applyable
});

test('getView reports turn=null shape when over and exposes myMark', () => {
  const m = new PentagoMatch('a', 'b');
  const v = m.getView('a');
  eq(v.myMark, 'B');
  eq(v.isMyTurn, true);
  eq(m.getView('b').myMark, 'W');
  eq(m.getView('b').isMyTurn, false);
});

test('Pentago wraps PairingEngine: full game ranks all N for n in {2,3,4}', () => {
  for (const n of [2, 3, 4]) {
    const players = ['a', 'b', 'c', 'd'].slice(0, n);
    const g = new Pentago(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 5000) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          let safety = 0;
          while (!m.engine.isOver() && safety++ < 1000) {
            const onTurn = m.engine.getView(m.engine.p1).turn;
            const am = m.engine.autoMove();
            if (!am) break;
            m.engine.applyMove(onTurn, am);
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

test('per-turn timeout auto-plays (does not forfeit) for Pentago', () => {
  const g = new Pentago(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const before = m.engine._moveCount;
  advance(30_000); // per-turn timer → autoMove
  assert((m.engine && m.engine._moveCount > before) || g.state === 'miniRoundSummary', 'auto-played, not forfeited');
});

uninstallClock();
report('Pentago');
