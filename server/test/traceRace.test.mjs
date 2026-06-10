import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { TraceRace } from '../src/games/TraceRace.js';

installClock();

function newGame(players) {
  const g = new TraceRace(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// A "perfect" trace = one stroke whose points ARE the server's target path.
const perfectStroke = (g) => ({ color: '#1e88e5', width: 6, tool: 'pen', points: g.path.map((p) => ({ x: p.x, y: p.y })) });
// An off-path scribble in a corner (should score ~0 from spillover, ~0 coverage).
const offPathStroke = () => ({ color: '#1e88e5', width: 6, tool: 'pen', points: [{ x: 5, y: 5 }, { x: 30, y: 5 }, { x: 30, y: 30 }, { x: 5, y: 30 }, { x: 5, y: 5 }] });

test('starts in drawing with a generated path + a draw timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'drawing');
  assert(Array.isArray(g.path) && g.path.length > 5, 'path generated');
  assert(g.targetCells.size > 0, 'target rasterised');
  assert(pendingTimers() >= 1, 'draw timer armed');
});

test('a submitted drawing is sanitised + stored (clamped coords, capped strokes/points, validated width/color)', () => {
  const g = newGame(['a', 'b']);
  const dirty = [
    // out-of-range coords clamp to [0,800]x[0,600]; bad width -> clamp; bad color -> default
    { color: 'not-a-color', width: 9999, tool: 'pen', points: [{ x: -50, y: -50 }, { x: 5000, y: 9000 }] },
    { color: '#abcdef', width: 0, tool: 'eraser', points: Array.from({ length: 999 }, (_, i) => ({ x: i, y: i })) },
    { points: [] }, // dropped (no points)
    null,           // dropped
  ];
  g.handleAction('a', { type: 'submit', strokes: dirty });
  const stored = g.submissions['a'];
  assert(Array.isArray(stored), 'stored as array');
  eq(stored.length, 2); // two valid strokes, empties/nulls dropped
  const s0 = stored[0];
  eq(s0.points[0].x, 0); eq(s0.points[0].y, 0);
  eq(s0.points[1].x, 800); eq(s0.points[1].y, 600);
  eq(s0.width, 64);          // 9999 clamped
  eq(s0.color, '#1e88e5');   // invalid -> default pen color
  const s1 = stored[1];
  eq(s1.width, 1);           // 0 clamped up
  eq(s1.tool, 'eraser');
  assert(s1.points.length <= 400, 'points capped at 400');
});

test('draw barrier advances when ALL submit (to reveal)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', strokes: [perfectStroke(g)] });
  g.handleAction('b', { type: 'submit', strokes: [perfectStroke(g)] });
  eq(g.state, 'drawing'); // still waiting on c
  g.handleAction('c', { type: 'submit', strokes: [perfectStroke(g)] });
  eq(g.state, 'reveal');
});

test('draw barrier advances on TIMER (auto-submits stragglers) + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', strokes: [perfectStroke(g)] });
  const before = g.emitCount;
  advance(30_000);
  assert(g.state === 'reveal' || g.state === 'finished', `advanced past drawing (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on draw timeout');
  // b and c were auto-submitted (empty)
  assert(g.submitted.has('b') && g.submitted.has('c'), 'stragglers auto-submitted');
});

test('HIDDEN INFO: another player\'s submitted strokes are never exposed mid-game', () => {
  const g = newGame(['a', 'b', 'c']);
  // a submits a stroke with a distinctive color that never appears in the public path data
  const marker = { color: '#43a047', width: 7, tool: 'pen', points: [{ x: 123, y: 456 }, { x: 124, y: 457 }] };
  g.handleAction('a', { type: 'submit', strokes: [marker] });
  // b's view during drawing must NOT contain a's strokes (the path is public, but submissions are private)
  const sb = g.getStateForPlayer('b');
  assert(sb.mySubmission === null, 'b has no submission yet, sees null');
  assert(!JSON.stringify(sb).includes('#43a047'), 'a\'s private stroke not leaked to b mid-game');
  // a DOES see its own submission
  const sa = g.getStateForPlayer('a');
  assert(sa.mySubmission && sa.mySubmission.length === 1 && sa.mySubmission[0].color === '#43a047', 'a sees own drawing');
});

test('HIDDEN INFO: per-player round detail (coverage/spill) is not exposed during drawing', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submit', strokes: [perfectStroke(g)] });
  const sa = g.getStateForPlayer('a');
  eq(sa.myRoundDetail, null);   // not scored/revealed yet
  eq(sa.roundScores, null);
});

test('SCORING: a perfect trace scores high; an off-path scribble scores ~0; coverage beats spillover', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submit', strokes: [perfectStroke(g)] });
  g.handleAction('b', { type: 'submit', strokes: [offPathStroke()] });
  eq(g.state, 'reveal');
  const ra = g.roundResults.detail['a'];
  const rb = g.roundResults.detail['b'];
  assert(ra.coverage > 0.8, `perfect trace high coverage (got ${ra.coverage})`);
  assert(g.roundScores['a'] >= 800, `perfect trace high score (got ${g.roundScores['a']})`);
  assert(g.roundScores['b'] < 100, `off-path low score (got ${g.roundScores['b']})`);
  assert(g.roundScores['a'] > g.roundScores['b'], 'tracer beats scribbler');
});

test('SCORING reveal discloses MY detail to me only', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submit', strokes: [perfectStroke(g)] });
  g.handleAction('b', { type: 'submit', strokes: [offPathStroke()] });
  const sa = g.getStateForPlayer('a');
  assert(sa.myRoundDetail && typeof sa.myRoundDetail.coverage === 'number', 'a sees own detail at reveal');
  assert(sa.roundScores && typeof sa.roundScores['a'] === 'number', 'a sees round scoreboard');
});

function playRound(g, perfectFor = []) {
  for (const p of g.players) {
    const strokes = perfectFor.includes(p) ? [perfectStroke(g)] : [offPathStroke()];
    g.handleAction(p, { type: 'submit', strokes });
  }
}
function ackReveal(g) { advance(9_000); }

test('full 3-round game finishes; getResults length N, placement 1 first (N=3)', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 20) {
    if (g.state === 'drawing') playRound(g, ['a']); // a traces perfectly each round -> a wins
    else if (g.state === 'reveal') ackReveal(g);
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res[0].placement, 1);
  eq(res[0].playerId, 'a'); // perfect tracer wins
  assert(res[0].score > res[1].score, 'winner has top cumulative score');
});

test('full 4-round-style game finishes for N=4 with everyone present', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 20) {
    if (g.state === 'drawing') playRound(g, ['a', 'b', 'c', 'd']);
    else if (g.state === 'reveal') ackReveal(g);
  }
  eq(g.state, 'finished');
  eq(g.getResults().length, 4);
  eq(g.getResults()[0].placement, 1);
});

test('a tie shares a placement', () => {
  // everyone traces perfectly every round -> equal scores -> all placement 1
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 20) {
    if (g.state === 'drawing') playRound(g, ['a', 'b', 'c']);
    else if (g.state === 'reveal') ackReveal(g);
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
});

test('removePlayer mid-draw advances barrier (no deadlock) and prunes leaver from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', strokes: [perfectStroke(g)] });
  g.handleAction('b', { type: 'submit', strokes: [perfectStroke(g)] });
  g.removePlayer('c'); // c was the last owed in this round
  assert(g.state === 'reveal' || g.state === 'finished', `advanced after leave (got ${g.state})`);
  assert(!g.players.includes('c'), 'leaver pruned from players');
});

test('removePlayer collapsing to one finishes', () => {
  const g = newGame(['a', 'b']);
  g.removePlayer('b');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

test('destroy() clears all timers', () => {
  const g = newGame(['a', 'b', 'c']);
  assert(pendingTimers() >= 1, 'timer armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('runs for N in [2,3,4] to finished with full participation', () => {
  for (const players of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 20) {
      if (g.state === 'drawing') playRound(g, players);
      else if (g.state === 'reveal') ackReveal(g);
    }
    eq(g.state, 'finished');
    eq(g.getResults().length, players.length);
    eq(g.getResults()[0].placement, 1);
  }
});

uninstallClock();
report('TraceRace');
