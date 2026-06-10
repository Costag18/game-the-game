import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { QuoridorMatch, SIZE, WALLS_PER_PLAYER } from '../src/games/QuoridorMatch.js';
import { Quoridor } from '../src/games/Quoridor.js';

installClock();

const step = (m, pid, r, c) => m.applyMove(pid, { type: 'move', r, c });
const wall = (m, pid, r, c, orient) => m.applyMove(pid, { type: 'wall', r, c, orient });

test('initial setup: pawns, goals, walls, p1 first', () => {
  const m = new QuoridorMatch('a', 'b');
  eq(m.pawns.a.r, 0); eq(m.pawns.a.c, 4);
  eq(m.pawns.b.r, 8); eq(m.pawns.b.c, 4);
  eq(m.goalRow.a, SIZE - 1); eq(m.goalRow.b, 0);
  eq(m.wallsLeft.a, WALLS_PER_PLAYER); eq(m.wallsLeft.b, WALLS_PER_PLAYER);
  eq(m.turn, 'a');
});

test('a legal pawn step moves the pawn and flips the turn', () => {
  const m = new QuoridorMatch('a', 'b');
  eq(step(m, 'a', 1, 4), true);
  eq(m.pawns.a.r, 1); eq(m.pawns.a.c, 4);
  eq(m.turn, 'b');
  eq(m.lastMove.type, 'move');
});

test('out-of-turn and illegal (non-adjacent / diagonal) pawn moves rejected', () => {
  const m = new QuoridorMatch('a', 'b');
  eq(step(m, 'b', 7, 4), false);       // not b's turn
  eq(step(m, 'a', 2, 4), false);       // two cells away
  eq(step(m, 'a', 1, 5), false);       // diagonal (no jump situation)
  eq(step(m, 'a', 0, 4), false);       // staying put / off-board direction
  eq(m.turn, 'a');                     // nothing applied
});

test('a wall placement decrements walls-left and flips turn', () => {
  const m = new QuoridorMatch('a', 'b');
  eq(wall(m, 'a', 2, 2, 'h'), true);
  eq(m.wallsLeft.a, WALLS_PER_PLAYER - 1);
  eq(m.walls.length, 1);
  eq(m.turn, 'b');
});

test('a wall blocks the pawn step it spans', () => {
  const m = new QuoridorMatch('a', 'b');
  // horizontal wall at post (0,4) blocks (0,4)<->(1,4)
  eq(wall(m, 'a', 0, 4, 'h'), true);
  eq(step(m, 'b', 7, 4), true); // b moves (unrelated)
  // a tries to step down into the wall
  eq(step(m, 'a', 1, 4), false);
  // but a can still step sideways
  eq(step(m, 'a', 0, 3), true);
});

test('overlapping / same-post wall placements rejected', () => {
  const m = new QuoridorMatch('a', 'b');
  eq(wall(m, 'a', 3, 3, 'h'), true);
  eq(wall(m, 'b', 3, 3, 'v'), false);   // same post (cross) rejected
  eq(wall(m, 'b', 3, 3, 'h'), false);   // duplicate rejected
  eq(wall(m, 'b', 3, 4, 'h'), false);   // collinear horizontal overlap rejected
  eq(wall(m, 'b', 5, 5, 'h'), true);    // far away → fine
});

test('a wall that seals off a pawn from its goal is rejected (BFS)', () => {
  const m = new QuoridorMatch('a', 'b');
  // build a horizontal fence across the whole board on the same row boundary,
  // leaving exactly one gap, then the wall that closes the gap must be rejected.
  // posts h at row boundary 0: cols 0,2,4,6 cover cols {0,1},{2,3},{4,5},{6,7} → col 8 open.
  m.walls.push({ r: 0, c: 0, orient: 'h' });
  m.walls.push({ r: 0, c: 2, orient: 'h' });
  m.walls.push({ r: 0, c: 4, orient: 'h' });
  m.walls.push({ r: 0, c: 6, orient: 'h' });
  // col 8 still open via post (0,7) covering {7,8}; closing it walls a in completely
  // a still has a path (through col 8) right now:
  assert(m._hasPathToGoal('a'), 'a still reachable before closing the last gap');
  // attempting the sealing wall at (0,7) must be rejected
  eq(m._isLegalWall('a', 0, 7, 'h'), false);
});

test('reaching the goal row wins; scoreDiff sign correct', () => {
  const m = new QuoridorMatch('a', 'b');
  // teleport a one step from its goal (row 8); move b off (8,4) so it's a clear step
  m.pawns.a = { r: 7, c: 4 };
  m.pawns.b = { r: 8, c: 0 };
  m.turn = 'a';
  eq(step(m, 'a', 8, 4), true);
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
  eq(m.turn, null);
  assert(m.scoreDiff('a') >= 1000, 'winner scoreDiff >= 1000');
  assert(m.scoreDiff('b') <= -1000, 'loser scoreDiff <= -1000');
});

test('straight jump over an adjacent opponent', () => {
  const m = new QuoridorMatch('a', 'b');
  m.pawns.a = { r: 4, c: 4 };
  m.pawns.b = { r: 5, c: 4 };
  m.turn = 'a';
  const legal = m._legalPawnMoves('a');
  assert(legal.some((mv) => mv.r === 6 && mv.c === 4), 'jump to (6,4) available');
  assert(!legal.some((mv) => mv.r === 5 && mv.c === 4), 'cannot land on opponent');
  eq(step(m, 'a', 6, 4), true);
  eq(m.pawns.a.r, 6);
});

test('blocked straight jump yields diagonal side-steps', () => {
  const m = new QuoridorMatch('a', 'b');
  m.pawns.a = { r: 4, c: 4 };
  m.pawns.b = { r: 5, c: 4 };
  // wall behind b (post (5,4) horizontal blocks (5,4)<->(6,4))
  m.walls.push({ r: 5, c: 4, orient: 'h' });
  m.turn = 'a';
  const legal = m._legalPawnMoves('a');
  assert(!legal.some((mv) => mv.r === 6 && mv.c === 4), 'straight jump blocked');
  assert(legal.some((mv) => mv.r === 5 && mv.c === 3), 'diagonal (5,3) available');
  assert(legal.some((mv) => mv.r === 5 && mv.c === 5), 'diagonal (5,5) available');
});

test('getView reports both pawns, walls, walls-left, legal moves', () => {
  const m = new QuoridorMatch('a', 'b');
  const v = m.getView('a');
  eq(v.myPawn.r, 0); eq(v.oppPawn.r, 8);
  eq(v.myWallsLeft, WALLS_PER_PLAYER);
  eq(v.isMyTurn, true);
  assert(Array.isArray(v.legalPawnMoves) && v.legalPawnMoves.length > 0, 'legal moves present on my turn');
  const vb = m.getView('b');
  eq(vb.isMyTurn, false);
  eq(vb.legalPawnMoves.length, 0); // not b's turn
});

test('autoMove returns a legal move that the match accepts', () => {
  const m = new QuoridorMatch('a', 'b');
  const am = m.autoMove();
  assert(am && am.type === 'move', 'autoMove is a pawn step');
  eq(m.applyMove('a', am), true);
});

test('autoMove steps toward the goal', () => {
  const m = new QuoridorMatch('a', 'b');
  const am = m.autoMove(); // a starts at row 0, goal row 8 → should go down
  eq(am.r, 1); eq(am.c, 4);
});

test('Quoridor wraps PairingEngine: full game ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = ['a', 'b', 'c', 'd'].slice(0, n);
    const g = new Quoridor(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 5000) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          let mguard = 0;
          while (!m.engine.isOver() && mguard++ < 2000) {
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

test('per-turn timeout auto-moves (does not forfeit) via the engine', () => {
  const g = new Quoridor(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const beforeA = m.engine.pawns[m.engine.p1].r;
  advance(30_000); // per-turn timer → autoMove
  assert(
    (m.engine && m.engine.pawns[m.engine.p1].r !== beforeA) || g.state === 'miniRoundSummary' || m.engine === null,
    'auto-moved, not forfeited'
  );
});

uninstallClock();
report('Quoridor');
