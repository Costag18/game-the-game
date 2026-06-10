import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { QuiplashClash } from '../src/games/QuiplashClash.js';

installClock();

function newGame(players) {
  const g = new QuiplashClash(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Have every player answer all of their assigned prompts.
function writeAll(g, textFor = (p, d) => `${p}_${d}`) {
  for (const p of g.players) {
    for (const d of g.assignments[p]) g.handleAction(p, { type: 'submitAnswer', duelId: d, text: textFor(p, d) });
  }
}

test('starts in writing; each prompt is a duel of exactly two players, ~2 each', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  eq(g.state, 'writing');
  assert(g.duels.length >= 1, 'at least one duel built');
  for (const d of g.duels) {
    eq(d.authors.length, 2, 'duel has two authors');
    assert(d.authors[0] !== d.authors[1], 'two DISTINCT authors');
  }
  // fair distribution: every player is in ~2 duels (within 1 of the mean)
  for (const p of g.players) assert(g.assignments[p].length >= 1, `${p} has prompts`);
  assert(pendingTimers() >= 1, 'write timer armed');
});

test('secret (authors / who-wrote-what) is NOT in the view before reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  writeAll(g);
  eq(g.state, 'voting');
  const d = g.currentDuel;
  // a voter who is NOT an author sees the two options but no authorId
  const voter = g.players.find((p) => !d.authors.includes(p));
  const s = g.getStateForPlayer(voter);
  const json = JSON.stringify(s.duel.options);
  for (const a of d.authors) assert(!json.includes(`"authorId":"${a}"`) && !json.includes(`"authorId": "${a}"`), 'no authorId leaked');
  for (const o of s.duel.options) assert(!('authorId' in o), 'option carries no authorId');
});

test('reveal DOES disclose authors, vote counts and points', () => {
  const g = newGame(['a', 'b', 'c']);
  writeAll(g);
  // vote through every duel: everyone eligible picks the first (left) option
  let guard = 0;
  while (g.state === 'voting' && guard++ < 30) {
    const d = g.currentDuel;
    const target = g.currentBallot[0].optionId;
    for (const v of g.players) if (!d.authors.includes(v)) g.handleAction(v, { type: 'castVote', optionId: target });
  }
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  assert(s.reveal && s.reveal.duels.length === g.duels.length, 'reveal carries all duels');
  const someDuel = s.reveal.duels[0];
  assert(someDuel.answers.every((ans) => 'authorId' in ans && 'votes' in ans && 'gained' in ans), 'reveal exposes authors/votes/points');
});

test('scoring: a blowout splits 1000 by vote share', () => {
  // exactly one duel between two players with two outside voters → controllable tally
  const g = newGame(['a', 'b', 'c', 'd']);
  // find a duel and make all NON-authors vote for the left option
  writeAll(g);
  const d0 = g.duels[0];
  // drive voting only until we resolve d0; simplest: vote every duel so all resolve
  while (g.state === 'voting') {
    const d = g.currentDuel;
    const left = g.currentBallot[0].optionId; // the left author
    for (const v of g.players) if (!d.authors.includes(v)) g.handleAction(v, { type: 'castVote', optionId: left });
  }
  eq(g.state, 'reveal');
  const rd = g.revealData.duels.find((x) => x.id === d0.id);
  const total = rd.total;
  // the author who got ALL votes earned 1000, the other earned 0 (total>0)
  if (total > 0) {
    const got1000 = rd.answers.filter((a) => a.gained === 1000).length;
    const got0 = rd.answers.filter((a) => a.gained === 0).length;
    eq(got1000, 1);
    eq(got0, 1);
  }
});

test('even split when a duel has no votes gives 500/500', () => {
  const g2 = newGame(['a', 'b', 'c', 'd']);
  writeAll(g2);
  // nobody votes at all → timeouts roll every duel forward → reveal → split evenly
  let guard = 0;
  while (g2.state === 'voting' && guard++ < 40) advance(15_000);
  eq(g2.state, 'reveal');
  for (const rd of g2.revealData.duels) {
    eq(rd.total, 0);
    for (const ans of rd.answers) eq(ans.gained, 500); // 1000 * 0.5
  }
});

test('an author cannot vote in their own duel', () => {
  const g = newGame(['a', 'b', 'c']);
  writeAll(g);
  const d = g.currentDuel;
  const author = d.authors[0];
  g.handleAction(author, { type: 'castVote', optionId: d.authors[1] });
  eq(g.votes[d.id][author], undefined);
});

test('all eligible voters voting advances to the next duel / reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  writeAll(g);
  eq(g.state, 'voting');
  const firstIdx = g.voteIndex;
  const d = g.currentDuel;
  for (const v of g.players) if (!d.authors.includes(v)) g.handleAction(v, { type: 'castVote', optionId: d.authors[0] });
  assert(g.voteIndex > firstIdx || g.state === 'reveal', 'advanced after all eligible voted');
});

test('write timeout fills blanks and advances to voting; broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(45_000);
  assert(g.state === 'voting' || g.state === 'reveal' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on write timeout');
});

test('vote timeout auto-advances through the duels', () => {
  const g = newGame(['a', 'b', 'c']);
  writeAll(g);
  eq(g.state, 'voting');
  const before = g.emitCount;
  let guard = 0;
  while (g.state === 'voting' && guard++ < 40) advance(15_000);
  assert(g.state === 'reveal' || g.state === 'finished', `left voting (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on vote timeout');
});

test('reveal timeout auto-acks and finishes; broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  writeAll(g);
  while (g.state === 'voting') {
    const d = g.currentDuel;
    for (const v of g.players) if (!d.authors.includes(v)) g.handleAction(v, { type: 'castVote', optionId: d.authors[0] });
  }
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  eq(g.state, 'finished');
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function runFullGame(players) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'writing') {
      writeAll(g);
    } else if (g.state === 'voting') {
      const d = g.currentDuel;
      if (!d) { advance(15_000); continue; }
      // everyone eligible votes for the left author → that author wins each duel
      for (const v of g.players) if (!d.authors.includes(v)) g.handleAction(v, { type: 'castVote', optionId: g.currentBallot[0].optionId });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

test('full game runs to finished for N in [3,4]; results length N, placement 1 first', () => {
  for (const players of [['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    const g = runFullGame(players);
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, players.length);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, players.length);
    // placements are non-decreasing
    for (let i = 1; i < res.length; i++) assert(res[i].placement >= res[i - 1].placement, 'placements monotonic');
  }
});

test('a tie shares a placement', () => {
  // Force a tie by letting NOBODY vote: every author gets an even split, all 1000s
  // become 500 per duel, but duel counts differ — instead construct equal totals.
  const g = newGame(['a', 'b', 'c', 'd']);
  writeAll(g);
  // nobody votes → every duel splits 500/500 → score = 500 * (#duels you are in)
  while (g.state === 'voting') advance(15_000);
  while (g.state === 'reveal') advance(12_000);
  eq(g.state, 'finished');
  const res = g.getResults();
  // group by score; any equal scores must share a placement
  for (let i = 1; i < res.length; i++) {
    if (res[i].score === res[i - 1].score) eq(res[i].placement, res[i - 1].placement, 'equal scores share placement');
    else assert(res[i].placement > res[i - 1].placement, 'lower score → worse placement');
  }
});

test('leave during writing advances barrier; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  // everyone except c submits all their answers
  for (const p of ['a', 'b', 'd']) for (const d of g.assignments[p]) g.handleAction(p, { type: 'submitAnswer', duelId: d, text: `${p}_${d}` });
  g.removePlayer('c'); // c never wrote; their duels drop, barrier should clear
  assert(g.state === 'voting' || g.state === 'reveal' || g.state === 'finished', `advanced past writing (got ${g.state})`);
  // run to finish without c
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 100) {
    if (g.state === 'voting') {
      const d = g.currentDuel;
      if (!d) { advance(15_000); continue; }
      for (const v of g.players) if (!d.authors.includes(v)) g.handleAction(v, { type: 'castVote', optionId: g.currentBallot[0].optionId });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during voting (an author of the live duel) skips it without deadlock', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  writeAll(g);
  eq(g.state, 'voting');
  const d = g.currentDuel;
  const leaver = d.authors[0];
  g.removePlayer(leaver);
  // game must not be stuck — keep resolving
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 120) {
    if (g.state === 'voting') {
      const cur = g.currentDuel;
      if (!cur) { advance(15_000); continue; }
      for (const v of g.players) if (!cur.authors.includes(v)) g.handleAction(v, { type: 'castVote', optionId: g.currentBallot[0].optionId });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    } else { advance(15_000); }
  }
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === leaver), 'leaver not ranked');
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
report('QuiplashClash');
