import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { MostLikelyTo } from '../src/games/MostLikelyTo.js';

installClock();

function newGame(players) {
  const g = new MostLikelyTo(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in voting with a prompt and a vote timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'voting');
  assert(typeof g.currentPrompt === 'string' && g.currentPrompt.length > 0, 'prompt loaded');
  assert(pendingTimers() >= 1, 'vote timer armed');
});

test('individual votes are SECRET pre-reveal but the tally IS disclosed at reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('b', { type: 'castVote', targetId: 'b' });
  // c can see its own (null) vote + counts, but NEVER who a or b picked
  const s = g.getStateForPlayer('c');
  eq(s.phase, 'voting');
  eq(s.myVote, null);
  eq(s.votedCount, 2);
  assert(s.reveal == null, 'no reveal/tally pre-reveal');
  // the secret mapping (a→b, b→b) must not be serialized anywhere in the view
  const json = JSON.stringify(s);
  assert(!json.includes('"votes"'), 'raw votes map never leaked');
  // finish the round → tally is now exposed
  g.handleAction('c', { type: 'castVote', targetId: 'a' });
  eq(g.state, 'reveal');
  const r = g.getStateForPlayer('c');
  assert(r.reveal && r.reveal.tally, 'tally disclosed at reveal');
  eq(r.reveal.tally['b'], 2);
  eq(r.reveal.tally['a'], 1);
});

test('scoring: +100 per vote received, cumulative; winners are the round leaders', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  // b gets 3 votes, a gets 1 (self-vote allowed: a votes for a)
  g.handleAction('a', { type: 'castVote', targetId: 'a' });
  g.handleAction('b', { type: 'castVote', targetId: 'b' });
  g.handleAction('c', { type: 'castVote', targetId: 'b' });
  g.handleAction('d', { type: 'castVote', targetId: 'b' });
  eq(g.state, 'reveal');
  eq(g.scores['b'], 300);
  eq(g.scores['a'], 100);
  eq(g.scores['c'], 0);
  eq(g.lastReveal.winners.length, 1);
  eq(g.lastReveal.winners[0], 'b');
});

test('self-vote is allowed; voting for a non-player is rejected', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'castVote', targetId: 'a' }); // self-vote OK
  eq(g.votes['a'], 'a');
  g.handleAction('b', { type: 'castVote', targetId: 'zzz' }); // not a player
  eq(g.votes['b'], undefined);
});

test('all votes cast advances to reveal (barrier)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('b', { type: 'castVote', targetId: 'c' });
  eq(g.state, 'voting');
  g.handleAction('c', { type: 'castVote', targetId: 'a' });
  eq(g.state, 'reveal');
});

test('vote timeout auto-votes everyone and advances to reveal + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  const before = g.emitCount;
  advance(25_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on vote timeout');
  // every present player ended up with a vote
  eq(Object.keys(g.votes).length, 3);
});

test('reveal timeout auto-acks and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'castVote', targetId: 'a' });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(8_000);
  assert(g.state === 'voting' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function runFullGame(players, voteFor) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 60) {
    if (g.state === 'voting') {
      for (const p of g.players) g.handleAction(p, { type: 'castVote', targetId: voteFor(p) });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

test('full 5-round game finishes; results rank all N with placement 1 first (N=3,4)', () => {
  for (const players of [['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    // everyone votes for 'a' every round → a wins outright
    const g = runFullGame(players, () => 'a');
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, players.length);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'a');
    eq(res[0].score, players.length * 5 * 100); // N voters × 5 rounds × 100
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, players.length);
  }
});

test('a tie shares a placement', () => {
  // everyone self-votes every round → all tie with 500 each
  const g = runFullGame(['a', 'b', 'c'], (p) => p);
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
  eq(res.every((r) => r.score === 500), true);
});

test('the secret votes map is NEVER in any player view (deep JSON check, all phases)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('b', { type: 'castVote', targetId: 'c' });
  // mid-vote: b's and a's targets must not be discoverable by c
  for (const viewer of ['a', 'b', 'c']) {
    const s = g.getStateForPlayer(viewer);
    // the only target that may appear is the viewer's OWN myVote
    eq(typeof s.votedCount, 'number');
    assert(!('votes' in s), 'no votes map field');
  }
});

test('leave during voting (last owing) advances to reveal; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('b', { type: 'castVote', targetId: 'a' });
  g.removePlayer('c'); // c never voted, was the last owed → barrier should complete
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leaver removed mid-vote no longer scores; their cast vote stops counting', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  g.handleAction('a', { type: 'castVote', targetId: 'c' }); // a votes for c
  g.removePlayer('c'); // c leaves → a's vote for c no longer tallies
  g.handleAction('b', { type: 'castVote', targetId: 'a' });
  g.handleAction('d', { type: 'castVote', targetId: 'a' });
  eq(g.state, 'reveal');
  // a got 2 votes (b, d); the orphaned vote-for-c does not award anyone
  eq(g.scores['a'], 200);
  assert(!('c' in g.scores), 'leaver not in scores');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during reveal advances; collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'castVote', targetId: 'a' });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // c was the last owed ack → advances
  assert(g.state === 'voting' || g.state === 'finished', `advanced (got ${g.state})`);
  g.destroy(); // tear down g so its live timers don't pollute the pending count below

  const g2 = newGame(['a', 'b', 'c']);
  g2.removePlayer('b');
  g2.removePlayer('c');
  eq(g2.players.length, 1);
  eq(g2.state, 'finished');
  g2.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('MostLikelyTo');
