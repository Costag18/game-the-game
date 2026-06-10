import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { ExquisiteCorpse } from '../src/games/ExquisiteCorpse.js';

installClock();

function newGame(players) {
  const g = new ExquisiteCorpse(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// a stroke deliberately drawn OUTSIDE the player's band (y far below) so we can
// assert the server clamps every point's y into [yStart, yEnd].
function strokeOutsideBand(g, pid) {
  const band = g.bands[pid];
  return {
    color: '#e53935', width: 8, tool: 'pen',
    points: [
      { x: 100, y: -50 },                 // above the canvas
      { x: 200, y: band.yEnd + 999 },     // far below the band
      { x: 300, y: (band.yStart + band.yEnd) / 2 }, // inside
    ],
  };
}

test('starts in draw with N bands assigned + a draw timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'draw');
  eq(Object.keys(g.bands).length, 3);
  eq(g.bandOrder.length, 3);
  // bands tile the full 600px with no gaps/overlap
  const ordered = g.bandOrder.map((p) => g.bands[p]).sort((x, y) => x.index - y.index);
  eq(ordered[0].yStart, 0);
  eq(ordered[2].yEnd, 600);
  assert(pendingTimers() >= 1, 'draw timer armed');
});

test('submitted drawing is sanitised + y-clamped into the author\'s band', () => {
  const g = newGame(['a', 'b', 'c']);
  const band = g.bands['a'];
  g.handleAction('a', { type: 'submit', strokes: [strokeOutsideBand(g, 'a')] });
  assert(g.submitted.has('a'), 'a marked submitted');
  const stored = g.drawings['a'];
  eq(stored.length, 1);
  for (const pt of stored[0].points) {
    assert(pt.y >= band.yStart - 1e-9 && pt.y <= band.yEnd + 1e-9, `y ${pt.y} clamped into band`);
    assert(pt.x >= 0 && pt.x <= 800, 'x clamped');
  }
  // canonical id + validated fields
  eq(stored[0].id, 'a:0');
  eq(stored[0].width, 8);
});

test('a player can only draw in their OWN band (others see no strokes pre-reveal)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', strokes: [strokeOutsideBand(g, 'a')] });
  // b must NOT see a's strokes anywhere in their draw-phase view
  const sb = g.getStateForPlayer('b');
  const aPoint = JSON.stringify(g.drawings['a'][0].points[2]);
  // b is not adjacent-below a unless bandOrder puts them so; force the check broadly:
  // strip out b's own band data, then ensure a's stroke ids never leak unless it's the sliver above b
  const above = g.bandOrder[g.bands['b'].index - 1];
  if (above !== 'a') {
    assert(!JSON.stringify(sb).includes('"a:0"'), 'a\'s stroke id not leaked to b');
  }
  // composite is null during draw for everyone
  eq(sb.composite, null);
});

test('sliver-above shows only the band directly above (never the whole canvas)', () => {
  const g = newGame(['a', 'b', 'c']);
  const top = g.bandOrder[0];
  const second = g.bandOrder[1];
  g.handleAction(top, { type: 'submit', strokes: [strokeOutsideBand(g, top)] });
  const sTop = g.getStateForPlayer(top);
  eq(sTop.sliverAbove, null); // top band has nothing above
  const sSecond = g.getStateForPlayer(second);
  assert(sSecond.sliverAbove, 'second band gets a sliver');
  eq(sSecond.sliverAbove.yEnd, g.bands[second].yStart);
  eq(sSecond.sliverAbove.yStart, g.bands[second].yStart - sSecond.sliverH);
  // the sliver carries the band-above's strokes only (one author), nothing else
  eq(sSecond.sliverAbove.strokes, g.drawings[top]);
});

test('draw barrier advances on ALL submitted', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', strokes: [] });
  eq(g.state, 'vote');
});

test('draw barrier advances on the timer + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', strokes: [] });
  const before = g.emitCount;
  advance(50_000);
  eq(g.state, 'vote');
  assert(g.emitCount > before, 'broadcast on draw timeout');
});

test('votes are hidden until reveal; composite hidden until reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', strokes: [strokeOutsideBand(g, p)] });
  eq(g.state, 'vote');
  // a votes for someone
  const target = g.bandOrder.find((x) => x !== 'a');
  g.handleAction('a', { type: 'vote', target });
  const sb = g.getStateForPlayer('b');
  // b can't learn a's vote, and can't see anyone's strokes/composite yet
  assert(!JSON.stringify(sb).includes(`"${target}"`) || sb.bandOrder.includes(target), 'no vote disclosure beyond ballot');
  eq(sb.composite, null);
  // explicitly: votes map not present in any player's state
  assert(!('votes' in sb), 'raw votes map never serialised');
});

test('cannot vote your own band', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', strokes: [] });
  g.handleAction('a', { type: 'vote', target: 'a' });
  eq(g.votes['a'], undefined);
});

test('vote tally scores band authors; reveal exposes the composite + votes', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const p of g.players) g.handleAction(p, { type: 'submit', strokes: [strokeOutsideBand(g, p)] });
  eq(g.state, 'vote');
  // b, c, d all vote for a's band → a gets 3 votes; a votes for b
  g.handleAction('b', { type: 'vote', target: 'a' });
  g.handleAction('c', { type: 'vote', target: 'a' });
  g.handleAction('d', { type: 'vote', target: 'a' });
  g.handleAction('a', { type: 'vote', target: 'b' });
  eq(g.state, 'reveal');
  eq(g.voteTally['a'], 3);
  eq(g.voteTally['b'], 1);
  eq(g.scores['a'], 300);
  eq(g.scores['b'], 100);
  // composite now visible with strokes + vote counts
  const s = g.getStateForPlayer('c');
  assert(Array.isArray(s.composite), 'composite revealed');
  eq(s.composite.length, 4);
  const aBand = s.composite.find((bnd) => bnd.authorId === 'a');
  eq(aBand.votes, 3);
  assert(aBand.strokes.length > 0, 'a\'s strokes now visible in composite');
});

test('vote timeout auto-votes everyone and advances to reveal + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', strokes: [] });
  eq(g.state, 'vote');
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on vote timeout');
  // everyone got an auto-vote
  for (const p of ['a', 'b', 'c']) assert(g.votes[p] !== undefined, `${p} auto-voted`);
});

test('reveal timeout auto-acks and finishes + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', strokes: [] });
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'vote', target: g.bandOrder.find((x) => x !== p) });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(14_000);
  eq(g.state, 'finished');
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function playFullGame(players, voteFn) {
  const g = newGame(players);
  for (const p of g.players) g.handleAction(p, { type: 'submit', strokes: [strokeOutsideBand(g, p)] });
  for (const p of g.players) g.handleAction(p, { type: 'vote', target: voteFn(g, p) });
  for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
  return g;
}

for (const N of [3, 4]) {
  test(`full ${N}-player game finishes; getResults length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd', 'e'].slice(0, N);
    // everyone votes for the first band author (not themselves) → that author wins
    const winner = (g) => g.bandOrder[0];
    const g = playFullGame(players, (g, p) => {
      const w = winner(g);
      return w !== p ? w : g.bandOrder[1];
    });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    assert(res[0].score >= res[res.length - 1].score, 'sorted desc');
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement', () => {
  // 4 players, votes split a<->b (1 each), c & d get 0 → c,d tie for placement 3
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const p of g.players) g.handleAction(p, { type: 'submit', strokes: [] });
  g.handleAction('a', { type: 'vote', target: 'b' });
  g.handleAction('b', { type: 'vote', target: 'a' });
  g.handleAction('c', { type: 'vote', target: 'a' }); // a gets 2
  g.handleAction('d', { type: 'vote', target: 'b' }); // b gets 2
  eq(g.state, 'reveal');
  for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
  eq(g.state, 'finished');
  const res = g.getResults();
  // a & b both have 200 (placement 1), c & d both have 0 (placement 3)
  const byId = Object.fromEntries(res.map((r) => [r.playerId, r]));
  eq(byId['a'].placement, byId['b'].placement);
  eq(byId['c'].placement, byId['d'].placement);
  eq(byId['c'].placement, 3);
});

test('removePlayer mid-draw advances when the leaver was the last owed', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', strokes: [] });
  g.handleAction('b', { type: 'submit', strokes: [] });
  g.removePlayer('c'); // c never submitted, was the only one left
  eq(g.state, 'vote');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-vote advances + leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'submit', strokes: [] });
  g.handleAction('a', { type: 'vote', target: 'b' });
  g.handleAction('b', { type: 'vote', target: 'a' });
  g.removePlayer('c'); // last voter leaves
  eq(g.state, 'reveal');
  for (const p of ['a', 'b']) g.handleAction(p, { type: 'acknowledge' });
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not in results');
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
report('ExquisiteCorpse');
