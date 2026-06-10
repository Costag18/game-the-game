import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { LightsOutMatch, CELLS, GRID, MAX_MOVES } from '../src/games/LightsOutMatch.js';
import { LightsOut } from '../src/games/LightsOut.js';

installClock();

const press = (m, pid, cell) => m.applyMove(pid, { cell });

test('a legal press toggles cell + neighbours and flips the turn', () => {
  const m = new LightsOutMatch('a', 'b');
  m.board = new Array(CELLS).fill(false); // force a known all-off board
  m._over = false; m._winner = null; m.turn = 'a';
  eq(press(m, 'a', 12), true); // center cell (row2,col2)
  // center + up(7) + down(17) + left(11) + right(13) toggled on
  eq(m.board[12], true);
  eq(m.board[7], true);
  eq(m.board[17], true);
  eq(m.board[11], true);
  eq(m.board[13], true);
  eq(m.turn, 'b');
});

test('corner press toggles only in-bounds neighbours', () => {
  const m = new LightsOutMatch('a', 'b');
  m.board = new Array(CELLS).fill(false); m._over = false; m._winner = null; m.turn = 'a';
  eq(press(m, 'a', 0), true); // top-left corner: self + right(1) + down(5)
  eq(m.board[0], true);
  eq(m.board[1], true);
  eq(m.board[5], true);
  // no wrap-around: cell 4 (top-right) untouched, cell 20 untouched
  eq(m.board[4], false);
  eq(m.board[20], false);
});

test('out-of-turn and out-of-range presses rejected', () => {
  const m = new LightsOutMatch('a', 'b');
  m.turn = 'a';
  eq(press(m, 'b', 5), false);     // not b's turn
  eq(press(m, 'a', 25), false);    // out of range (>= 25)
  eq(press(m, 'a', -1), false);    // out of range (< 0)
  eq(m.applyMove('a', {}), false); // no cell
});

test('string cell key tolerated (JSON round-trip)', () => {
  const m = new LightsOutMatch('a', 'b');
  m.turn = 'a';
  eq(m.applyMove('a', { cell: '12' }), true);
});

test('mover who clears the board WINS', () => {
  const m = new LightsOutMatch('a', 'b');
  // Set up so a single press at cell 12 clears the board: pressing 12 toggles
  // {12,7,17,11,13}, so seed exactly those lights on, everything else off.
  m.board = new Array(CELLS).fill(false);
  for (const i of [12, 7, 17, 11, 13]) m.board[i] = true;
  m._over = false; m._winner = null; m.turn = 'a';
  eq(press(m, 'a', 12), true);
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
  eq(m.isDraw(), false);
  eq(m.getView('a').litCount, 0);
});

test('hard cap with lights remaining → DRAW', () => {
  const m = new LightsOutMatch('a', 'b');
  // Force a board that stays lit, then drive to the move cap.
  m.board = new Array(CELLS).fill(false); m.board[0] = true; m.board[24] = true;
  m._over = false; m._winner = null; m._moveCount = MAX_MOVES - 1; m.turn = 'a';
  // press a far cell that won't clear both lit corners
  eq(press(m, 'a', 12), true);
  eq(m.isOver(), true);
  eq(m.winner(), null);
  eq(m.isDraw(), true);
});

test('scoreDiff is +1000 win / -1000 loss / 0 draw', () => {
  const win = new LightsOutMatch('a', 'b');
  win.board = new Array(CELLS).fill(false);
  for (const i of [12, 7, 17, 11, 13]) win.board[i] = true;
  win._over = false; win._winner = null; win.turn = 'a';
  press(win, 'a', 12);
  eq(win.scoreDiff('a'), 1000);
  eq(win.scoreDiff('b'), -1000);

  const draw = new LightsOutMatch('a', 'b');
  draw._over = true; draw._winner = null;
  eq(draw.scoreDiff('a'), 0);
  eq(draw.scoreDiff('b'), 0);
});

test('generated start board is lit (not already won)', () => {
  for (let i = 0; i < 25; i++) {
    const m = new LightsOutMatch('a', 'b');
    assert(m.getView('a').litCount > 0, 'start board must have ≥1 light');
    eq(m.isOver(), false);
    eq(m.turn, 'a'); // p1 moves first
  }
});

test('autoMove returns a legal in-range cell', () => {
  const m = new LightsOutMatch('a', 'b');
  const am = m.autoMove();
  assert(am && Number.isInteger(am.cell) && am.cell >= 0 && am.cell < CELLS, 'legal auto cell');
});

test('getView reports turn/isMyTurn/litCount/movesLeft and turn is null when over', () => {
  const m = new LightsOutMatch('a', 'b');
  const v = m.getView('a');
  eq(v.grid, GRID);
  eq(v.isMyTurn, true);
  eq(v.movesLeft, MAX_MOVES);
  assert(Array.isArray(v.board) && v.board.length === CELLS, 'board is 25 booleans');
  // win → turn null
  m.board = new Array(CELLS).fill(false);
  for (const i of [12, 7, 17, 11, 13]) m.board[i] = true;
  m._over = false; m._winner = null; m.turn = 'a';
  press(m, 'a', 12);
  eq(m.getView('a').turn, null);
});

test('LightsOut wraps PairingEngine: full game ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = new LightsOut(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 2000) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          let mguard = 0;
          while (!m.engine.isOver() && mguard++ < 200) {
            const turnPlayer = m.engine.getView(m.engine.p1).turn;
            m.engine.applyMove(turnPlayer, m.engine.autoMove());
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

test('per-turn timeout auto-presses (does not forfeit)', () => {
  const g = new LightsOut(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const before = m.engine._moveCount;
  advance(30_000); // per-turn timer → autoMove
  assert((m.engine && m.engine._moveCount > before) || g.state === 'miniRoundSummary', 'auto-pressed, not forfeited');
});

uninstallClock();
report('LightsOut');
