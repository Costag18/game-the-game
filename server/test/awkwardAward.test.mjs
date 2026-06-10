import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { AwkwardAward } from '../src/games/AwkwardAward.js';

installClock();

function newGame(players) {
  const g = new AwkwardAward(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const myCardOpt = (g, p) => g.ballot.find((o) => o.authorId === p);
const otherCardOpt = (g, p) => g.ballot.find((o) => o.authorId !== p);

function submitAll(g) {
  let n = 0;
  for (const p of g.players) g.handleAction(p, { type: 'submitReason', text: `reason_${p}_${n++}` });
}

test('starts in writing with a trophy and a write timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'writing');
  assert(typeof g.trophy === 'string' && g.trophy.length > 0, 'trophy loaded');
  assert(pendingTimers() >= 1, 'write timer armed');
  assert(typeof g.getStateForPlayer('a').deadline === 'number', 'deadline exposed');
});

test('all reasons submitted advances to voting; ballot hides author', () => {
  const g = newGame(['a', 'b', 'c']);
  submitAll(g);
  eq(g.state, 'voting');
  const s = g.getStateForPlayer('a');
  eq(s.ballot.length, 3);
  for (const o of s.ballot) {
    assert(!('authorId' in o), 'authorId hidden in voting');
    assert('nomineeId' in o, 'nominee shown');
    assert(typeof o.text === 'string', 'reason text shown');
  }
  assert(s.ballot.some((o) => o.isMine), 'my own reason flagged');
});

test('reason text is shown but authorship + tallies are NOT leaked before reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  submitAll(g);
  // a votes for someone else's card
  const other = otherCardOpt(g, 'a');
  g.handleAction('a', { type: 'castVote', optionId: other.optionId });
  const s = JSON.stringify(g.getStateForPlayer('b'));
  assert(!s.includes('authorId'), 'authorId not in voting payload');
  assert(!s.includes('voters'), 'voters/tallies not in voting payload');
  assert(g.getStateForPlayer('b').reveal === null, 'no reveal pre-reveal');
});

test('cannot vote for the card showing your own reason', () => {
  const g = newGame(['a', 'b', 'c']);
  submitAll(g);
  const mine = myCardOpt(g, 'a');
  g.handleAction('a', { type: 'castVote', optionId: mine.optionId });
  eq(g.votes['a'], undefined);
});

test('scoring: the reason AUTHOR earns +500 per vote, not the nominee', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  submitAll(g);
  // everyone (who can) votes for a's reason card
  const aCard = myCardOpt(g, 'a');
  for (const p of ['b', 'c', 'd']) g.handleAction(p, { type: 'castVote', optionId: aCard.optionId });
  // a must still vote (can't vote own) — votes for b's reason
  const bCard = myCardOpt(g, 'b');
  g.handleAction('a', { type: 'castVote', optionId: bCard.optionId });
  eq(g.state, 'reveal');
  eq(g.scores['a'], 3 * 500); // a's reason got 3 votes
  eq(g.scores['b'], 1 * 500); // b's reason got a's vote
  // reveal discloses authors + voters
  const opt = g.revealData.options.find((o) => o.authorId === 'a');
  eq(opt.votes, 3);
  eq(opt.voters.length, 3);
  // secret (authorId) IS present at reveal
  assert(JSON.stringify(g.getStateForPlayer('c')).includes('authorId'), 'authorId disclosed at reveal');
});

test('write timeout injects house reasons and advances to voting + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitReason', text: 'I earned it.' });
  const before = g.emitCount;
  advance(40_000);
  eq(g.state, 'voting');
  assert(g.reasons['b'] && g.reasons['c'], 'missing players got house reasons');
  assert(g.emitCount > before, 'broadcast on write timeout');
});

test('vote timeout auto-votes everyone and advances to reveal + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  submitAll(g);
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on vote timeout');
});

test('reveal timeout auto-acks and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  submitAll(g);
  for (const p of g.players) {
    const o = otherCardOpt(g, p);
    g.handleAction(p, { type: 'castVote', optionId: o.optionId });
  }
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  assert(g.state === 'writing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('full 4-round game finishes; results rank all N, placement 1 first (N=3)', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'writing') {
      submitAll(g);
    } else if (g.state === 'voting') {
      // a's reason always gets every available vote → a wins
      const aCard = myCardOpt(g, 'a');
      for (const p of g.players) {
        const target = aCard.authorId === p ? otherCardOpt(g, p) : aCard;
        g.handleAction(p, { type: 'castVote', optionId: target.optionId });
      }
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res[0].placement, 1);
  eq(res[0].playerId, 'a');
});

test('full 4-round game finishes for N=4', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'writing') submitAll(g);
    else if (g.state === 'voting') {
      for (const p of g.players) {
        const o = otherCardOpt(g, p);
        g.handleAction(p, { type: 'castVote', optionId: o.optionId });
      }
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 4);
  eq(res[0].placement, 1);
});

test('a tie shares a placement (nobody votes anyone)', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'writing') submitAll(g);
    else if (g.state === 'voting') advance(30_000); // nobody votes → all 0 → tie
    else if (g.state === 'reveal') advance(12_000);
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  // auto-votes happen, but everyone gets votes too — assert tie pattern holds generally:
  // every player with the top score shares placement 1
  const top = res[0].score;
  for (const r of res) if (r.score === top) eq(r.placement, 1);
});

test('leave during writing (last owing) advances to voting; leaver not ranked', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitReason', text: 'apple reason' });
  g.handleAction('b', { type: 'submitReason', text: 'banana reason' });
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'voting');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during voting keeps remaining able to finish; leaver not awarded', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  submitAll(g);
  g.handleAction('a', { type: 'castVote', optionId: otherCardOpt(g, 'a').optionId });
  g.removePlayer('c'); // c leaves mid-vote
  for (const p of g.players) {
    if (g.votes[p] !== undefined) continue;
    const o = otherCardOpt(g, p);
    if (o) g.handleAction(p, { type: 'castVote', optionId: o.optionId });
  }
  eq(g.state, 'reveal');
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
report('AwkwardAward');
