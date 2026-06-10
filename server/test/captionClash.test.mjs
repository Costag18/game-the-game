import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { CaptionClash } from '../src/games/CaptionClash.js';

installClock();

function newGame(players) {
  const g = new CaptionClash(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

const SAMPLE_STROKES = [
  { color: '#000000', width: 8, tool: 'pen', points: [{ x: 10, y: 10 }, { x: 50, y: 50 }] },
  { color: '#e53935', width: 4, tool: 'pen', points: [{ x: 100, y: 120 }] },
];

// Drive every player through the draw phase with a doodle.
function allDraw(g, strokesByPlayer) {
  for (const p of g.players) {
    g.handleAction(p, { type: 'submit', strokes: (strokesByPlayer && strokesByPlayer[p]) || SAMPLE_STROKES });
  }
}
function allCaption(g, textFn) {
  for (const p of g.players) g.handleAction(p, { type: 'caption', text: textFn ? textFn(p) : `caption by ${p}` });
}

test('starts in draw with a prompt and a draw timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'draw');
  assert(typeof g.prompt === 'string' && g.prompt.length > 0, 'prompt loaded');
  assert(pendingTimers() >= 1, 'draw timer armed');
});

test('a submitted drawing is sanitised + stored', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', {
    type: 'submit',
    strokes: [
      // out-of-bounds + bad color + over-cap width get clamped/normalised
      { color: 'notahex', width: 999, tool: 'pen', points: [{ x: -50, y: 9999 }, { x: 400, y: 300 }] },
      { tool: 'eraser', width: 0.1, points: [{ x: 5, y: 5 }] },
      { color: '#123456', width: 10, tool: 'pen', points: [] }, // empty → dropped
      null, // invalid → dropped
    ],
  });
  const stored = g.drawings['a'];
  eq(stored.length, 2);
  // clamp
  eq(stored[0].points[0].x, 0);
  eq(stored[0].points[0].y, 600);
  eq(stored[0].color, '#000000'); // bad hex normalised
  eq(stored[0].width, 64); // clamped
  eq(stored[1].tool, 'eraser');
  eq(stored[1].color, '#ffffff');
  eq(stored[1].width, 1);
  // a second submit is ignored (idempotent)
  g.handleAction('a', { type: 'submit', strokes: SAMPLE_STROKES });
  eq(g.drawings['a'].length, 2);
});

test('draw barrier advances on all-submitted', () => {
  const g = newGame(['a', 'b', 'c']);
  allDraw(g);
  eq(g.state, 'caption');
});

test('draw barrier advances on timer (broadcast fires)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', strokes: SAMPLE_STROKES });
  const before = g.emitCount;
  advance(60_000);
  eq(g.state, 'caption');
  assert(g.emitCount > before, 'broadcast on draw timeout');
  // missing players got empty drawings
  assert(Array.isArray(g.drawings['b']) && g.drawings['b'].length === 0, 'b auto-filled empty');
});

test('HIDDEN-INFO: during draw a player never sees another player\'s strokes', () => {
  const g = newGame(['a', 'b', 'c']);
  const unique = [{ color: '#43a047', width: 8, tool: 'pen', points: [{ x: 222, y: 333 }] }];
  g.handleAction('a', { type: 'submit', strokes: unique });
  const sB = g.getStateForPlayer('b');
  const json = JSON.stringify(sB);
  assert(!json.includes('222'), 'b cannot see a\'s strokes during draw');
  assert(!json.includes('333'), 'b cannot see a\'s strokes during draw');
  // b sees only their own (none yet)
  eq(sB.myDrawing.length, 0);
});

test('caption phase: each captioner is assigned SOMEONE ELSE\'S doodle (never their own)', () => {
  const g = newGame(['a', 'b', 'c']);
  const marks = {
    a: [{ color: '#000000', width: 8, tool: 'pen', points: [{ x: 11, y: 11 }] }],
    b: [{ color: '#000000', width: 8, tool: 'pen', points: [{ x: 22, y: 22 }] }],
    c: [{ color: '#000000', width: 8, tool: 'pen', points: [{ x: 33, y: 33 }] }],
  };
  allDraw(g, marks);
  eq(g.state, 'caption');
  for (const p of g.players) {
    assert(g.captionOf[p] !== p, `${p} not assigned own doodle`);
    const s = g.getStateForPlayer(p);
    assert(s.captionTask, `${p} has a caption task`);
    // they see the assigned doodle's strokes, which are not their own
    const target = g.captionOf[p];
    eq(s.captionTask.strokes[0].points[0].x, marks[target][0].points[0].x);
  }
});

test('caption barrier advances on all-captioned AND on timer', () => {
  const g = newGame(['a', 'b', 'c']);
  allDraw(g);
  allCaption(g);
  eq(g.state, 'vote');

  const g2 = newGame(['a', 'b', 'c']);
  allDraw(g2);
  g2.handleAction('a', { type: 'caption', text: 'only one' });
  const before = g2.emitCount;
  advance(45_000);
  eq(g2.state, 'vote');
  assert(g2.emitCount > before, 'broadcast on caption timeout');
});

test('vote gallery is anonymous (no author ids / votes leaked pre-reveal)', () => {
  const g = newGame(['a', 'b', 'c']);
  allDraw(g);
  allCaption(g);
  eq(g.state, 'vote');
  const s = g.getStateForPlayer('a');
  eq(s.gallery.length, 3);
  for (const item of s.gallery) {
    assert(!('doodleAuthorId' in item), 'doodleAuthorId hidden in voting');
    assert(!('captionAuthorId' in item), 'captionAuthorId hidden in voting');
    assert(!('voters' in item), 'voters hidden in voting');
    assert('canVote' in item, 'canVote flag present');
  }
  // no reveal data exposed during vote
  eq(s.reveal, null);
});

test('cannot vote for a pair you authored (own doodle or own caption)', () => {
  const g = newGame(['a', 'b', 'c']);
  allDraw(g);
  allCaption(g);
  // find a pair authored by 'a' on either side
  const ownPair = g.pairs.find((p) => p.doodleAuthorId === 'a' || p.captionAuthorId === 'a');
  assert(ownPair, 'a authors at least one side of some pair');
  g.handleAction('a', { type: 'vote', pairId: ownPair.pairId });
  eq(g.votes['a'], undefined);
  // the gallery flags that pair as not votable for a
  const sa = g.getStateForPlayer('a');
  const item = sa.gallery.find((x) => x.pairId === ownPair.pairId);
  eq(item.canVote, false);
});

test('scoring: both doodle + caption author earn per vote; reveal discloses authors + voters', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  allDraw(g);
  allCaption(g);
  eq(g.state, 'vote');
  // pick a pair NOT authored by everyone, then have all eligible voters vote it
  const target = g.pairs[0];
  const eligible = g.players.filter((p) => p !== target.doodleAuthorId && p !== target.captionAuthorId);
  for (const p of eligible) g.handleAction(p, { type: 'vote', pairId: target.pairId });
  // remaining (the two authors) must still vote to fill the barrier
  for (const p of g.players) if (g.votes[p] === undefined) g.handleAction(p, { type: 'vote', pairId: g.pairs.find((x) => x.doodleAuthorId !== p && x.captionAuthorId !== p).pairId });
  eq(g.state, 'reveal');
  const votes = eligible.length;
  eq(g.scores[target.doodleAuthorId] >= 100 * votes, true);
  eq(g.scores[target.captionAuthorId] >= 100 * votes, true);
  // reveal discloses authors + voters
  const rp = g.revealData.pairs.find((p) => p.pairId === target.pairId);
  eq(rp.doodleAuthorId, target.doodleAuthorId);
  eq(rp.captionAuthorId, target.captionAuthorId);
  eq(rp.voteCount, votes);
  assert(Array.isArray(rp.voters), 'voters listed at reveal');
});

test('vote timeout auto-votes everyone and advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  allDraw(g);
  allCaption(g);
  eq(g.state, 'vote');
  const before = g.emitCount;
  advance(40_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on vote timeout');
});

function playFull(players, voteStrategy) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'draw') {
      allDraw(g);
    } else if (g.state === 'caption') {
      allCaption(g);
    } else if (g.state === 'vote') {
      voteStrategy(g);
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const N of [3, 4]) {
  test(`full ${N}-player game finishes; getResults length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = playFull(players, (gg) => {
      // everyone votes the first pair they're allowed to
      for (const p of gg.players) {
        const opt = gg.pairs.find((x) => gg._canVote(x.pairId, p));
        gg.handleAction(p, { type: 'vote', pairId: opt.pairId });
      }
    });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement (nobody votes → all 0 → all placement 1)', () => {
  const g = playFull(['a', 'b', 'c'], () => { /* nobody votes manually */ advance(40_000); });
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  // auto-votes during timeout still distribute, but if all scores equal they share.
  // Force the equal-score case directly:
  const g2 = newGame(['a', 'b', 'c']);
  g2.scores = { a: 0, b: 0, c: 0 };
  g2.state = 'finished';
  const res2 = g2.getResults();
  eq(res2.every((r) => r.placement === 1), true);
});

test('removePlayer mid-draw advances the barrier (no deadlock)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submit', strokes: SAMPLE_STROKES });
  g.handleAction('b', { type: 'submit', strokes: SAMPLE_STROKES });
  g.removePlayer('c'); // c never drew, was the last owed
  eq(g.state, 'caption');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-caption advances the barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  allDraw(g);
  g.handleAction('a', { type: 'caption', text: 'one' });
  g.handleAction('b', { type: 'caption', text: 'two' });
  g.removePlayer('c');
  eq(g.state, 'vote');
});

test('removePlayer mid-vote advances; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  allDraw(g);
  allCaption(g);
  eq(g.state, 'vote');
  for (const p of ['a', 'b', 'c']) {
    const opt = g.pairs.find((x) => g._canVote(x.pairId, p));
    g.handleAction(p, { type: 'vote', pairId: opt.pairId });
  }
  g.removePlayer('d'); // d never voted, was the last owed
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'd'), 'leaver not ranked');
});

test('collapse to one player finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(g.isComplete(), true);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('CaptionClash');
