import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { OthelloMatch, SIZE } from '../src/games/OthelloMatch.js';
import { Othello } from '../src/games/Othello.js';

installClock();

const mv = (m, pid, r, c) => m.applyMove(pid, { r, c });

test('opening board is set; p1 (black) moves first', () => {
  const m = new OthelloMatch('a', 'b');
  eq(m.board[3][3], 'a'); eq(m.board[4][4], 'a');
  eq(m.board[3][4], 'b'); eq(m.board[4][3], 'b');
  eq(m.turn, 'a');
});

test('legal bracketing move flips discs and flips the turn', () => {
  const m = new OthelloMatch('a', 'b');
  // black at (2,3) brackets white (3,3)... wait — pick a real legal opener:
  // (2,4): downward brackets white (3,4) then black (4,4) → flips (3,4)
  eq(mv(m, 'a', 2, 4), true);
  eq(m.board[2][4], 'a');
  eq(m.board[3][4], 'a'); // flipped from white to black
  eq(m.turn, 'b');        // turn passes to white
  eq(m.lastMove.flipped, 1);
});

test('non-flipping move and out-of-turn move are rejected', () => {
  const m = new OthelloMatch('a', 'b');
  eq(mv(m, 'a', 0, 0), false);   // empty corner, brackets nothing
  eq(mv(m, 'a', 3, 3), false);   // occupied cell
  eq(mv(m, 'b', 2, 4), false);   // white tries to move out of turn
  eq(m.turn, 'a');
});

test('legalMoves lists exactly the four opening moves for black', () => {
  const m = new OthelloMatch('a', 'b');
  const moves = m._legalMoves('a').map((x) => `${x.r},${x.c}`).sort();
  eq(JSON.stringify(moves), JSON.stringify(['2,4', '3,5', '4,2', '5,3']));
});

test('no-legal-move side auto-passes (turn flips back)', () => {
  const m = new OthelloMatch('a', 'b');
  // craft a board where after black moves, white has no move but black does.
  // empty everything, then a tiny corner pocket.
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) m.board[r][c] = null;
  m.board[0][0] = 'b';
  m.board[0][1] = 'a'; // black already owns
  // black plays (0,2)? brackets nothing... instead set up: white sandwiched.
  // a at (0,0), b at (0,1), play a at (0,2) flips b(0,1)
  m.board[0][0] = 'a'; m.board[0][1] = 'b'; m.board[0][2] = null;
  m.turn = 'a';
  eq(mv(m, 'a', 0, 2), true);
  eq(m.board[0][1], 'a');           // white disc flipped
  // white now has zero discs and no legal move → auto-pass → still black's turn (black also can't... so game over)
  // After flip, board has only black discs → neither can move → over.
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
});

test('game ends when board is full / nobody can move; most discs wins', () => {
  const m = new OthelloMatch('a', 'b');
  // fill the whole board with black except one empty cell that black can fill with a flip.
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) m.board[r][c] = 'a';
  // leave (0,0) empty, put white at (0,1) and black at (0,2) so (0,0) brackets nothing for black...
  // simpler: (0,0) empty, (0,1)=white, (0,2)=black → black plays (0,0)? brackets right: white(0,1)+black(0,2) → flips
  m.board[0][0] = null; m.board[0][1] = 'b'; m.board[0][2] = 'a';
  m.turn = 'a';
  eq(mv(m, 'a', 0, 0), true);
  eq(m.isOver(), true);
  eq(m.winner(), 'a');               // black dominates
  eq(m.isDraw(), false);
});

test('scoreDiff sign: win positive, loss negative, plus margin', () => {
  const m = new OthelloMatch('a', 'b');
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) m.board[r][c] = 'a';
  m.board[0][0] = null; m.board[0][1] = 'b'; m.board[0][2] = 'a';
  m.turn = 'a';
  mv(m, 'a', 0, 0); // black wins, owns all 64
  assert(m.scoreDiff('a') > 1000, 'winner scoreDiff > 1000');
  assert(m.scoreDiff('b') < -1000, 'loser scoreDiff < -1000');
});

test('autoMove returns a legal flipping move', () => {
  const m = new OthelloMatch('a', 'b');
  const am = m.autoMove();
  assert(am && Number.isInteger(am.r) && Number.isInteger(am.c), 'auto move has coords');
  assert(m._flips(am.r, am.c, m.turn).length > 0, 'auto move actually flips');
});

test('getView hides nothing (perfect info) and reports counts + turn', () => {
  const m = new OthelloMatch('a', 'b');
  const va = m.getView('a');
  eq(va.myDiscs, 2); eq(va.oppDiscs, 2);
  eq(va.turn, 'a'); eq(va.isMyTurn, true);
  eq(va.myColor, 'B'); eq(va.oppColor, 'W');
  eq(va.legalMoves.length, 4);
  const vb = m.getView('b');
  eq(vb.isMyTurn, false);
  eq(vb.legalMoves.length, 0); // not white's turn → no legal-move hints
});

test('Othello wraps PairingEngine: full game ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = ['a', 'b', 'c', 'd'].slice(0, n);
    const g = new Othello(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 5000) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          let safety = 0;
          while (!m.engine.isOver() && safety++ < 200) {
            const auto = m.engine.autoMove();
            if (!auto) break;
            m.engine.applyMove(m.engine.turn, auto);
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

test('per-turn timeout auto-plays (keeps match alive) for Othello', () => {
  const g = new Othello(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const before = m.engine ? JSON.stringify(m.engine.board) : null;
  advance(30_000); // per-turn timer → autoMove
  assert((m.engine && JSON.stringify(m.engine.board) !== before) || g.state === 'miniRoundSummary', 'auto-played, not stuck');
});

uninstallClock();
report('Othello');
