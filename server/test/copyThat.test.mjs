import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { CopyThat } from '../src/games/CopyThat.js';

installClock();

function newGame(players) {
  const g = new CopyThat(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// A submission that perfectly replicates the current round's reference strokes.
function copyOfReference(g) {
  return g.reference.strokes.map((s) => ({ color: '#000000', width: 6, tool: 'pen', points: s.points.map((p) => ({ x: p.x, y: p.y })) }));
}

test('starts in flash with a reference + flash timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'flash');
  assert(g.reference && Array.isArray(g.reference.strokes) && g.reference.strokes.length > 0, 'reference loaded');
  assert(g.refGrid && g.refGrid.length === 24 * 24, 'reference rasterised');
  assert(pendingTimers() >= 1, 'flash timer armed');
});

test('a submitted drawing is sanitised (clamped, capped) and stored', () => {
  const g = newGame(['a', 'b']);
  advance(7000); // flash -> redraw
  eq(g.state, 'redraw');
  const huge = { color: 'not-a-color', width: 999, tool: 'pen', points: [{ x: -50, y: 99999 }, { x: 400, y: 300 }, { x: 12000, y: -3 }] };
  // also include junk that must be dropped
  g.handleAction('a', { type: 'submit', strokes: [huge, { points: [] }, null, { points: [{ x: NaN, y: NaN }] }] });
  const stored = g.submissions['a'];
  assert(Array.isArray(stored) && stored.length === 1, 'only the one valid stroke kept');
  const s = stored[0];
  for (const p of s.points) {
    assert(p.x >= 0 && p.x <= 800, 'x clamped');
    assert(p.y >= 0 && p.y <= 600, 'y clamped');
  }
  assert(s.width >= 1 && s.width <= 64, 'width clamped');
  assert(/^#[0-9a-fA-F]{6}$/.test(s.color), 'color defaulted to valid hex');
});

test('flash timer hides reference + advances to redraw (broadcasts)', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(7000);
  eq(g.state, 'redraw');
  assert(g.emitCount > before, 'broadcast on flash timeout');
  // reference no longer exposed in player state during redraw
  const s = g.getStateForPlayer('a');
  eq(s.reference, null);
});

test('HIDDEN-INFO: reference not exposed during redraw; only own submission visible before reveal', () => {
  const g = newGame(['a', 'b']);
  advance(7000); // -> redraw
  // build a recognisable submission for a, none for b yet
  g.handleAction('a', { type: 'submit', strokes: copyOfReference(g) });
  const refStr = JSON.stringify(g.reference.strokes[0].points[0]); // a reference coordinate

  const sb = g.getStateForPlayer('b'); // b hasn't submitted, and isn't a
  eq(sb.reference, null);
  eq(sb.mySubmission, null);
  assert(!JSON.stringify(sb).includes('"perPlayer"'), 'no reveal data leaked mid-redraw');
  // b must not see a's submission
  assert(!('a' in (sb.reveal || {})), 'no opponent submission before reveal');

  const sa = g.getStateForPlayer('a');
  eq(sa.reference, null, 'reference hidden even from a during redraw');
  assert(Array.isArray(sa.mySubmission), 'a sees own submission');
});

test('all submitted advances to reveal; IoU scoring: perfect copy ~1000, blank 0', () => {
  const g = newGame(['a', 'b']);
  advance(7000); // -> redraw
  g.handleAction('a', { type: 'submit', strokes: copyOfReference(g) }); // perfect
  g.handleAction('b', { type: 'submit', strokes: [] });                  // blank
  eq(g.state, 'reveal');
  assert(g.roundScores['a'] >= 950, `perfect copy scores high (got ${g.roundScores['a']})`);
  eq(g.roundScores['b'], 0);
  // reveal discloses reference + everyone's drawing
  assert(g.revealData.reference, 'reference disclosed at reveal');
  assert(g.revealData.perPlayer['a'] && g.revealData.perPlayer['b'], 'all submissions in reveal');
  eq(g.revealData.perPlayer['a'].score, g.roundScores['a']);
});

test('redraw timer auto-submits empty for missing players and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  advance(7000); // -> redraw
  g.handleAction('a', { type: 'submit', strokes: copyOfReference(g) });
  advance(25000); // redraw timeout
  eq(g.state, 'reveal');
  eq(g.roundScores['b'], 0);
  eq(g.roundScores['c'], 0);
});

test('reveal timer auto-acks and advances; reveal HIDDEN until reveal phase', () => {
  const g = newGame(['a', 'b']);
  advance(7000);
  // before reveal, nobody's reveal data is exposed
  const mid = g.getStateForPlayer('a');
  eq(mid.reveal, null);
  g.handleAction('a', { type: 'submit', strokes: [] });
  g.handleAction('b', { type: 'submit', strokes: [] });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(9000);
  assert(g.state === 'flash' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('full 3-round game finishes; getResults length N with placement 1 first (N=3 and N=4)', () => {
  for (const players of [['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 40) {
      if (g.state === 'flash') {
        advance(7000);
      } else if (g.state === 'redraw') {
        // a copies the reference (high score), others draw nothing
        g.handleAction('a', { type: 'submit', strokes: copyOfReference(g) });
        for (const p of players) if (p !== 'a') g.handleAction(p, { type: 'submit', strokes: [] });
      } else if (g.state === 'reveal') {
        for (const p of players) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, players.length);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'a'); // a had the best similarity each round
  }
});

test('a tie shares a placement', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'flash') advance(7000);
    else if (g.state === 'redraw') { for (const p of g.players) g.handleAction(p, { type: 'submit', strokes: [] }); } // everyone blank -> all 0
    else if (g.state === 'reveal') { for (const p of g.players) g.handleAction(p, { type: 'acknowledge' }); }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  assert(res.every((r) => r.placement === 1), 'all tied at placement 1');
});

test('removePlayer mid-redraw advances (no deadlock) and prunes the leaver', () => {
  const g = newGame(['a', 'b', 'c']);
  advance(7000); // -> redraw
  g.handleAction('a', { type: 'submit', strokes: copyOfReference(g) });
  g.handleAction('b', { type: 'submit', strokes: [] });
  g.removePlayer('c'); // c was the last owed -> should advance to reveal
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-reveal advances; collapse to one finishes', () => {
  const g = newGame(['a', 'b', 'c']);
  advance(7000);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', strokes: [] });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last un-acked leaves -> advance
  assert(g.state === 'flash' || g.state === 'finished', `advanced off reveal (got ${g.state})`);

  const g2 = newGame(['a', 'b', 'c']);
  g2.removePlayer('b');
  g2.removePlayer('c');
  eq(g2.players.length, 1);
  eq(g2.state, 'finished');
});

test('destroy() clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  assert(pendingTimers() >= 1, 'a timer is armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('CopyThat');
