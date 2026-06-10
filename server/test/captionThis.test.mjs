import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { CaptionThis } from '../src/games/CaptionThis.js';

installClock();

function newGame(players) {
  const g = new CaptionThis(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const myOpt = (g, p) => g.ballot.find((o) => o.authorId === p);
const otherOpt = (g, p) => g.ballot.find((o) => o.authorId !== p);

test('starts in writing with a scene (imagePrompt) and a write timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'writing');
  assert(typeof g.scene === 'string' && g.scene.length > 0, 'scene loaded');
  const s = g.getStateForPlayer('a');
  eq(s.imagePrompt, g.scene);
  assert(typeof s.deadline === 'number', 'deadline epoch-ms provided');
  assert(pendingTimers() >= 1, 'write timer armed');
});

test('rejects a duplicate caption; advances to voting when all submit', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitCaption', text: 'Hello world' });
  g.handleAction('b', { type: 'submitCaption', text: '  hello   WORLD ' }); // dup (norm-insensitive)
  eq(g.captions['b'], undefined);
  g.handleAction('b', { type: 'submitCaption', text: 'Second one' });
  g.handleAction('c', { type: 'submitCaption', text: 'Third one' });
  eq(g.state, 'voting');
});

test('voting ballot hides authorId; flags my own caption; tallies hidden pre-reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitCaption', text: 'alpha' });
  g.handleAction('b', { type: 'submitCaption', text: 'bravo' });
  g.handleAction('c', { type: 'submitCaption', text: 'charlie' });
  eq(g.state, 'voting');
  const s = g.getStateForPlayer('a');
  eq(s.ballot.length, 3);
  for (const o of s.ballot) {
    assert(!('authorId' in o), 'authorId hidden in voting');
    assert(!('voters' in o), 'voters hidden in voting');
    assert(!('votes' in o), 'vote counts hidden in voting');
  }
  assert(s.ballot.some((o) => o.isMine), 'my own caption flagged');
  // no vote tallies anywhere in the player state during voting
  assert(!JSON.stringify(s).includes('"voters"'), 'no voters list pre-reveal');
});

test('cannot vote for your own caption', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'alpha'], ['b', 'bravo'], ['c', 'charlie']]) g.handleAction(p, { type: 'submitCaption', text: t });
  const mine = myOpt(g, 'a');
  g.handleAction('a', { type: 'castVote', optionId: mine.optionId });
  eq(g.votes['a'], undefined);
});

test('scoring: +100 per vote received; reveal discloses authors + vote counts', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const [p, t] of [['a', 'alpha'], ['b', 'bravo'], ['c', 'charlie'], ['d', 'delta']]) g.handleAction(p, { type: 'submitCaption', text: t });
  const aOpt = myOpt(g, 'a').optionId;
  const dOpt = myOpt(g, 'd').optionId;
  // b, c vote a's caption; a votes d's; d votes a's → a got 3 votes, d got 1
  g.handleAction('b', { type: 'castVote', optionId: aOpt });
  g.handleAction('c', { type: 'castVote', optionId: aOpt });
  g.handleAction('d', { type: 'castVote', optionId: aOpt });
  g.handleAction('a', { type: 'castVote', optionId: dOpt });
  eq(g.state, 'reveal');
  eq(g.scores['a'], 3 * 100);
  eq(g.scores['d'], 1 * 100);
  eq(g.revealData.awards['a'].votes, 3);
  const opt = g.revealData.options.find((o) => o.optionId === aOpt);
  eq(opt.authorId, 'a'); eq(opt.votes, 3); eq(opt.voters.length, 3);
});

test('secret (authors) NOT in player state before reveal, IS at reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'zztop'], ['b', 'qqual'], ['c', 'wwide']]) g.handleAction(p, { type: 'submitCaption', text: t });
  // during voting: another player's authorship of "zztop" must not leak to b
  const sVote = g.getStateForPlayer('b');
  const dump = JSON.stringify(sVote);
  // the ballot text is present but no authorId mapping is exposed
  assert(!dump.includes('authorId'), 'no authorId key leaked during voting');
  // finish voting → reveal
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'castVote', optionId: otherOpt(g, p).optionId });
  eq(g.state, 'reveal');
  const sRev = g.getStateForPlayer('b');
  assert(JSON.stringify(sRev).includes('authorId'), 'authors disclosed at reveal');
});

test('write timeout injects house captions and advances; broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitCaption', text: 'only mine' });
  const before = g.emitCount;
  advance(45_000);
  eq(g.state, 'voting');
  assert(g.captions['b'] && g.captions['c'], 'missing players got house captions');
  assert(g.emitCount > before, 'broadcast on write timeout');
});

test('vote timeout auto-votes everyone and advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'alpha'], ['b', 'bravo'], ['c', 'charlie']]) g.handleAction(p, { type: 'submitCaption', text: t });
  advance(30_000);
  eq(g.state, 'reveal');
  eq(Object.keys(g.votes).length, 3);
});

test('reveal timeout auto-acks and advances; broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'alpha'], ['b', 'bravo'], ['c', 'charlie']]) g.handleAction(p, { type: 'submitCaption', text: t });
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'castVote', optionId: otherOpt(g, p).optionId });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  assert(g.state === 'writing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

function playFullGame(players, voteStrategy) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'writing') {
      let n = 0;
      for (const p of g.players) g.handleAction(p, { type: 'submitCaption', text: `cap_${p}_${n++}` });
    } else if (g.state === 'voting') {
      voteStrategy(g);
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

test('full 4-round game (N=3) finishes; results rank all N, placement 1 first', () => {
  const g = playFullGame(['a', 'b', 'c'], (g) => {
    // everyone votes the same victim ('a') each round → a wins
    for (const p of g.players) {
      const target = p === 'a' ? otherOpt(g, 'a') : myOpt(g, 'a');
      g.handleAction(p, { type: 'castVote', optionId: target.optionId });
    }
  });
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res[0].placement, 1);
  eq(res[0].playerId, 'a');
});

test('full 4-round game (N=4) finishes; results length 4, placement 1 first', () => {
  const g = playFullGame(['a', 'b', 'c', 'd'], (g) => {
    for (const p of g.players) g.handleAction(p, { type: 'castVote', optionId: otherOpt(g, p).optionId });
  });
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 4);
  eq(res[0].placement, 1);
  assert(res.every((r) => g.players.includes(r.playerId)), 'every result is a present player');
});

test('a tie shares a placement', () => {
  // nobody votes for anybody useful → everyone votes the "next" player's caption
  // is hard to make perfectly even, so force a tie: everyone abstains via timeout
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'writing') {
      let n = 0;
      for (const p of g.players) g.handleAction(p, { type: 'submitCaption', text: `cap_${p}_${n++}` });
    } else if (g.state === 'voting') {
      // each player votes for a DIFFERENT fixed option index so votes spread 1-1-1
      // simplest guaranteed tie: rotate votes so each caption gets exactly one vote
      const ids = g.ballot.map((o) => o.authorId);
      for (let i = 0; i < g.players.length; i++) {
        const voter = g.players[i];
        // vote for the option whose author is the NEXT player (never self)
        const targetAuthor = g.players[(i + 1) % g.players.length];
        const opt = g.ballot.find((o) => o.authorId === targetAuthor);
        g.handleAction(voter, { type: 'castVote', optionId: opt.optionId });
      }
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  // every caption got exactly one vote every round → all equal → all placement 1
  eq(res.every((r) => r.placement === 1), true);
  eq(res.every((r) => r.score === res[0].score), true);
});

test('leave during writing (last owing) advances to voting; leaver not ranked', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitCaption', text: 'alpha' });
  g.handleAction('b', { type: 'submitCaption', text: 'bravo' });
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'voting');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during voting keeps orphan caption on ballot; remaining still finish', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const [p, t] of [['a', 'alpha'], ['b', 'bravo'], ['c', 'charlie'], ['d', 'delta']]) g.handleAction(p, { type: 'submitCaption', text: t });
  const cOpt = myOpt(g, 'c').optionId;
  g.handleAction('a', { type: 'castVote', optionId: cOpt }); // a voted c's caption
  g.removePlayer('c'); // c leaves mid-vote
  g.handleAction('b', { type: 'castVote', optionId: otherOpt(g, 'b').optionId });
  g.handleAction('d', { type: 'castVote', optionId: otherOpt(g, 'd').optionId });
  eq(g.state, 'reveal');
  const opt = g.revealData.options.find((o) => o.optionId === cOpt);
  assert(opt, 'orphan caption still on ballot');
  assert(!('c' in g.revealData.awards), 'leaver not awarded');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver pruned from results');
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
report('CaptionThis');
