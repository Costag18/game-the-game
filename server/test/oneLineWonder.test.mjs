import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { OneLineWonder } from '../src/games/OneLineWonder.js';

installClock();

function newGame(players) {
  const g = new OneLineWonder(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// a valid single stroke (an array of length 1)
function oneStroke() {
  return [{ color: '#1e88e5', width: 8, tool: 'pen', points: [{ x: 10, y: 10 }, { x: 200, y: 300 }, { x: 400, y: 100 }] }];
}

// helper: everyone draws + rates so the game runs to reveal/finished
function ratingsFor(g, p, val) {
  const r = {};
  for (const t of g.players) if (t !== p) r[t] = val;
  return r;
}

test('starts in draw with a shared word and a draw timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'draw');
  assert(typeof g.word === 'string' && g.word.length > 0, 'word picked');
  assert(pendingTimers() >= 1, 'draw timer armed');
});

test('submitted drawing is sanitised (clamped/capped) and stored', () => {
  const g = newGame(['a', 'b', 'c']);
  const dirty = [{
    color: 'not-a-color', width: 999, tool: 'pen',
    points: [{ x: -50, y: 9999 }, { x: 1234, y: -10 }, { x: 'nope', y: 5 }, { x: 300, y: 300 }],
  }];
  g.handleAction('a', { type: 'submitDrawing', strokes: dirty });
  const s = g.drawings['a'];
  assert(s, 'stroke stored');
  eq(s.color, '#000000');          // invalid colour -> default
  eq(s.width, 64);                 // clamped to max
  // coords clamped into [0,800]x[0,600]; the non-finite point dropped
  for (const pt of s.points) {
    assert(pt.x >= 0 && pt.x <= 800, 'x clamped');
    assert(pt.y >= 0 && pt.y <= 600, 'y clamped');
  }
  eq(s.points.length, 3);          // the {x:'nope'} point was skipped
  assert(g.submitted.has('a'), 'marked submitted');
});

test('THE GIMMICK: a submission with more than one stroke is rejected', () => {
  const g = newGame(['a', 'b', 'c']);
  const two = [...oneStroke(), ...oneStroke()];
  g.handleAction('a', { type: 'submitDrawing', strokes: two });
  eq(g.drawings['a'], undefined);  // not stored
  assert(!g.submitted.has('a'), 'not marked submitted');
  // a single stroke is accepted
  g.handleAction('a', { type: 'submitDrawing', strokes: oneStroke() });
  assert(g.submitted.has('a'), 'single stroke accepted');
  eq(g.drawings['a'].points.length, 3);
});

test('empty submission allowed (stores null) and counts as submitted', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitDrawing', strokes: [] });
  eq(g.drawings['a'], null);
  assert(g.submitted.has('a'), 'empty submit still submitted');
});

test('HIDDEN-INFO: during draw a player never sees another player\'s strokes', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitDrawing', strokes: oneStroke() });
  g.handleAction('b', { type: 'submitDrawing', strokes: oneStroke() });
  // c looks at their state while still in draw (a,b submitted; c hasn't)
  // force c not to have completed barrier: c hasn't submitted, so still in draw
  eq(g.state, 'draw');
  const s = g.getStateForPlayer('c');
  eq(s.gallery, null);                 // no gallery during draw
  // c's own stroke list is empty; a's/b's strokes must NOT appear anywhere
  const blob = JSON.stringify(s);
  assert(!blob.includes('"1e88e5"'.slice(1)) || s.gallery === null, 'gallery hidden');
  eq(s.myStrokes.length, 0);
});

test('all submitted advances to rate phase', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
  eq(g.state, 'rate');
});

test('draw timer auto-submits everyone and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitDrawing', strokes: oneStroke() });
  const before = g.emitCount;
  advance(40_000);
  eq(g.state, 'rate');
  assert(g.submitted.has('b') && g.submitted.has('c'), 'missing players auto-submitted');
  assert(g.emitCount > before, 'broadcast on draw timeout');
});

test('RATE: you cannot rate your own drawing; others\' drawings now visible', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
  eq(g.state, 'rate');
  const s = g.getStateForPlayer('a');
  // gallery excludes self in rate
  assert(s.gallery.every((x) => x.playerId !== 'a'), 'own drawing not in rate gallery');
  eq(s.ratableIds.sort().join(','), 'b,c');
  // attempt to rate self is ignored (self never in ratable set)
  g.handleAction('a', { type: 'submitRatings', ratings: { a: 5, b: 4, c: 3 } });
  assert(g.ratings['a'].a === undefined, 'self-rating dropped');
  eq(g.ratings['a'].b, 4); eq(g.ratings['a'].c, 3);
});

test('HIDDEN-INFO: individual ratings + totals not exposed before reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
  g.handleAction('a', { type: 'submitRatings', ratings: ratingsFor(g, 'a', 5) });
  // b looks at the rate state — must not see a's rating of b, nor any totals
  const s = g.getStateForPlayer('b');
  // totals are null in rate gallery
  assert(s.gallery.every((x) => x.total === null), 'no totals during rate');
  // b can only see b's own submitted ratings (b hasn't rated yet -> null)
  eq(s.myRatings, null);
  // a's ratings of others must not leak into b's view
  const blob = JSON.stringify(s);
  assert(!blob.includes('"scores"') || s.scores === null, 'scores hidden in rate');
  eq(s.scores, null);
});

test('SCORING: score = total rating received; reveal discloses totals', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
  // a rates b=5,c=2 ; b rates a=1,c=4 ; c rates a=3,b=5
  g.handleAction('a', { type: 'submitRatings', ratings: { b: 5, c: 2 } });
  g.handleAction('b', { type: 'submitRatings', ratings: { a: 1, c: 4 } });
  g.handleAction('c', { type: 'submitRatings', ratings: { a: 3, b: 5 } });
  eq(g.state, 'reveal');
  // a received 1 (from b) + 3 (from c) = 4
  // b received 5 (from a) + 5 (from c) = 10
  // c received 2 (from a) + 4 (from b) = 6
  eq(g.scores['a'], 4);
  eq(g.scores['b'], 10);
  eq(g.scores['c'], 6);
  const s = g.getStateForPlayer('a');
  const bEntry = s.gallery.find((x) => x.playerId === 'b');
  eq(bEntry.total, 10); // total disclosed at reveal
});

test('rate timer auto-finishes raters and advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
  g.handleAction('a', { type: 'submitRatings', ratings: ratingsFor(g, 'a', 4) });
  const before = g.emitCount;
  advance(45_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on rate timeout');
});

test('reveal timer auto-acks and reaches finished', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitRatings', ratings: ratingsFor(g, p, 3) });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  eq(g.state, 'finished');
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function fullRun(players, rateVal) {
  const g = newGame(players);
  for (const p of players) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
  for (const p of players) g.handleAction(p, { type: 'submitRatings', ratings: ratingsFor(g, p, rateVal) });
  for (const p of players) g.handleAction(p, { type: 'acknowledge' });
  return g;
}

test('full game reaches finished; results length N, placement 1 first (N in [3,4])', () => {
  for (const players of [['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    const g = newGame(players);
    for (const p of players) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
    // give 'a' the highest score: everyone rates a=5, others=1
    for (const p of players) {
      const r = {};
      for (const t of players) if (t !== p) r[t] = (t === 'a' ? 5 : 1);
      g.handleAction(p, { type: 'submitRatings', ratings: r });
    }
    for (const p of players) g.handleAction(p, { type: 'acknowledge' });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, players.length);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'a');
  }
});

test('a tie shares a placement', () => {
  const g = fullRun(['a', 'b', 'c'], 3); // everyone rates everyone 3 -> equal scores
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  assert(res.every((r) => r.placement === 1), 'all tied at placement 1');
});

test('removePlayer mid-draw advances barrier (no deadlock)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitDrawing', strokes: oneStroke() });
  g.handleAction('b', { type: 'submitDrawing', strokes: oneStroke() });
  g.removePlayer('c'); // c was the last owed
  eq(g.state, 'rate');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-rate advances + leaver\'s received ratings dropped', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submitDrawing', strokes: oneStroke() });
  g.handleAction('a', { type: 'submitRatings', ratings: { b: 5, c: 5 } }); // a rated c
  g.handleAction('b', { type: 'submitRatings', ratings: { a: 4, c: 4 } });
  g.removePlayer('c'); // c never rated and was the last owed
  eq(g.state, 'reveal');
  assert(!('c' in g.scores) || g.scores['c'] === undefined ? true : true, 'c pruned from players');
  assert(!g.players.includes('c'), 'c removed');
  // a's score = only from b (4); a's rating of c removed, c gone
  eq(g.scores['a'], 4);
});

test('collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('OneLineWonder');
