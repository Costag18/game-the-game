import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { DotsAndBoxesMatch, BOXES, DOTS, TOTAL_BOXES } from '../src/games/DotsAndBoxesMatch.js';
import { DotsAndBoxes } from '../src/games/DotsAndBoxes.js';

installClock();

const move = (m, pid, orient, r, c) => m.applyMove(pid, { orient, r, c });

test('legal edge claims and flips the turn (no box completed)', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  eq(move(m, 'a', 'h', 0, 0), true);
  eq(m.hEdges[0][0], 'a');
  eq(m.turn, 'b'); // no box completed → turn flips
  eq(m.lastMove.orient, 'h');
});

test('out-of-turn move rejected', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  eq(move(m, 'b', 'h', 0, 0), false); // a moves first
  eq(m.turn, 'a');
});

test('re-claiming an edge is rejected', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  eq(move(m, 'a', 'h', 0, 0), true);
  eq(move(m, 'b', 'h', 0, 0), false); // already taken
});

test('out-of-range and malformed edges rejected', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  eq(move(m, 'a', 'h', DOTS, 0), false);     // row out of range for h
  eq(move(m, 'a', 'h', 0, BOXES), false);    // col out of range for h
  eq(move(m, 'a', 'v', BOXES, 0), false);    // row out of range for v
  eq(move(m, 'a', 'v', 0, DOTS), false);     // col out of range for v
  eq(m.applyMove('a', { orient: 'x', r: 0, c: 0 }), false); // bad orient
  eq(m.applyMove('a', {}), false);
});

test('completing a box claims it and grants ANOTHER turn', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  // box (0,0) edges: h[0][0] top, h[1][0] bottom, v[0][0] left, v[0][1] right.
  // Pre-set three edges directly, then let a place the 4th.
  m.hEdges[0][0] = 'a';
  m.hEdges[1][0] = 'a';
  m.vEdges[0][0] = 'a';
  m.turn = 'a';
  eq(move(m, 'a', 'v', 0, 1), true); // completes box (0,0)
  eq(m.boxes[0][0], 'a');
  eq(m.score['a'], 1);
  eq(m.turn, 'a'); // box completed → SAME player goes again
});

test('string-number coords tolerated', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  eq(m.applyMove('a', { orient: 'h', r: '0', c: '0' }), true);
  eq(m.hEdges[0][0], 'a');
});

test('game ends when all 25 boxes owned; most boxes wins', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  // Fill the whole board's edges and box owners directly to a near-complete state,
  // leaving exactly ONE box (the last) for a's deciding move, so the win condition
  // fires on a single play (no long alternating sequence needed).
  // Give 'a' 24 boxes already, claimed counter at 24.
  for (let r = 0; r < BOXES; r++) for (let c = 0; c < BOXES; c++) {
    if (r === BOXES - 1 && c === BOXES - 1) continue; // leave last box open
    m.boxes[r][c] = 'a';
  }
  m._claimed = TOTAL_BOXES - 1;
  m.score['a'] = TOTAL_BOXES - 1;
  // last box (4,4): top h[4][4], bottom h[5][4], left v[4][4], right v[4][5].
  m.hEdges[BOXES - 1][BOXES - 1] = 'a';     // top
  m.vEdges[BOXES - 1][BOXES - 1] = 'a';     // left
  m.vEdges[BOXES - 1][BOXES] = 'a';         // right
  m.turn = 'a';
  eq(move(m, 'a', 'h', DOTS - 1, BOXES - 1), true); // bottom edge → completes last box
  eq(m.isOver(), true);
  eq(m._claimed, TOTAL_BOXES);
  eq(m.winner(), 'a');
  eq(m.isDraw(), false);
});

test('scoreDiff sign: +1000 win, -1000 loss (plus margin)', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  // construct an a-wins finished board: a has 25, b has 0
  for (let r = 0; r < BOXES; r++) for (let c = 0; c < BOXES; c++) m.boxes[r][c] = 'a';
  m.score['a'] = TOTAL_BOXES; m.score['b'] = 0;
  m._claimed = TOTAL_BOXES; m._over = true; m._winner = 'a';
  assert(m.scoreDiff('a') > 1000, 'winner positive over 1000');
  assert(m.scoreDiff('b') < -1000, 'loser negative under -1000');
});

test('autoMove returns a legal edge', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  const am = m.autoMove();
  assert(am && (am.orient === 'h' || am.orient === 'v'), 'has orient');
  eq(m.applyMove(m.turn, am), true); // the auto move is actually legal
});

test('getView reports box counts and legal edges', () => {
  const m = new DotsAndBoxesMatch('a', 'b');
  const v = m.getView('a');
  eq(v.isMyTurn, true);
  eq(v.myBoxes, 0);
  eq(v.oppBoxes, 0);
  // total edges = horizontal (DOTS*BOXES) + vertical (BOXES*DOTS)
  eq(v.legalEdges.length, DOTS * BOXES + BOXES * DOTS);
});

function autoPlayMatch(engine) {
  let guard = 0;
  while (!engine.isOver() && guard++ < 200) {
    const mv = engine.autoMove();
    if (!mv) break;
    engine.applyMove(engine.turn, mv);
  }
}

for (const n of [2, 3, 4]) {
  test(`DotsAndBoxes wraps PairingEngine: full game ranks all ${n}`, () => {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = new DotsAndBoxes(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          autoPlayMatch(m.engine);
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
  });
}

test('no per-turn timer: a slow turn neither auto-plays nor forfeits; hard cap still ends an abandoned match', () => {
  const g = new DotsAndBoxes(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  // no per-turn countdown is exposed to the client (noTurnTimer)
  eq(g.getStateForPlayer(m.p1).myMatch.turnEndsAt, null);
  const legalBefore = m.engine._legalEdges().length;
  advance(60_000); // a full minute of "thinking" — nothing should change
  eq(m.engine._legalEdges().length, legalBefore); // board untouched, no auto-play
  assert(!m.over, 'match still live after a long think');
  // the generous 300s hard cap is the only safety against a truly abandoned match
  advance(300_000);
  assert(m.over || g.state !== 'match', 'hard cap eventually ends an abandoned match');
});

test('single mini-round (one game per player), no best-of-3', () => {
  const g = new DotsAndBoxes(['a', 'b', 'c', 'd']);
  g.setOnStateChange(() => {});
  g.startGame();
  eq(g.totalMiniRounds, 1);
});

uninstallClock();
report('DotsAndBoxes');
