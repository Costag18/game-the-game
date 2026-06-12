import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Fibbage } from '../src/games/Fibbage.js';

installClock();

function newGame(players) {
  const g = new Fibbage(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const truthOptId = (g) => g.ballot.find((o) => o.kind === 'truth').optionId;
const myFakeOpt = (g, p) => g.ballot.find((o) => o.kind === 'fake' && o.authorId === p);

test('starts in writing with a prompt and a write timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'writing');
  assert(g.prompt && g.prompt.answer, 'prompt loaded');
  assert(pendingTimers() >= 1, 'write timer armed');
});

test('rejects a fake equal to the truth or a duplicate; hides truth pre-reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitFake', text: g.prompt.answer.toUpperCase() }); // == truth
  eq(g.fakes['a'], undefined);
  g.handleAction('a', { type: 'submitFake', text: 'Zebra' });
  g.handleAction('b', { type: 'submitFake', text: 'zebra ' }); // dup of a's (case/space-insensitive)
  eq(g.fakes['b'], undefined);
  // truth never exposed during writing
  const s = g.getStateForPlayer('c');
  assert(!JSON.stringify(s).includes(g.prompt.answer), 'truth not leaked in writing');
});

test('all fakes submitted advances to voting; ballot hides author/kind', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitFake', text: 'fib-a' });
  g.handleAction('b', { type: 'submitFake', text: 'fib-b' });
  g.handleAction('c', { type: 'submitFake', text: 'fib-c' });
  eq(g.state, 'voting');
  const s = g.getStateForPlayer('a');
  eq(s.ballot.length, 4); // 3 fakes + truth
  for (const o of s.ballot) {
    assert(!('authorId' in o), 'authorId hidden in voting');
    assert(!('kind' in o), 'kind hidden in voting');
  }
  assert(s.ballot.some((o) => o.isMine), 'my own fib flagged');
});

test('cannot vote for your own fib', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'fib-a'], ['b', 'fib-b'], ['c', 'fib-c']]) g.handleAction(p, { type: 'submitFake', text: t });
  const mine = myFakeOpt(g, 'a');
  g.handleAction('a', { type: 'castVote', optionId: mine.optionId });
  eq(g.votes['a'], undefined);
});

test('scoring: found truth +1000 and +500 per fool; reveal discloses authors/voters', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const [p, t] of [['a', 'fib-a'], ['b', 'fib-b'], ['c', 'fib-c'], ['d', 'fib-d']]) g.handleAction(p, { type: 'submitFake', text: t });
  const truth = truthOptId(g);
  const aFake = myFakeOpt(g, 'a').optionId;
  // a finds truth; b, c, d all pick a's fake → a fooled 3
  g.handleAction('a', { type: 'castVote', optionId: truth });
  g.handleAction('b', { type: 'castVote', optionId: aFake });
  g.handleAction('c', { type: 'castVote', optionId: aFake });
  g.handleAction('d', { type: 'castVote', optionId: aFake });
  eq(g.state, 'reveal');
  eq(g.scores['a'], 1000 + 3 * 500);
  eq(g.revealData.awards['a'].fooled, 3);
  eq(g.revealData.awards['a'].found, true);
  // reveal now discloses kind + voters
  const opt = g.revealData.options.find((o) => o.optionId === aFake);
  eq(opt.kind, 'fake'); eq(opt.authorId, 'a'); eq(opt.voters.length, 3);
});

test('full 4-round game finishes; results rank all N with a tie sharing placement', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 30) {
    if (g.state === 'writing') {
      let n = 0;
      for (const p of g.players) g.handleAction(p, { type: 'submitFake', text: `fib_${p}_${n++}` });
    } else if (g.state === 'voting') {
      // everyone picks the truth → all tie each round
      const truth = truthOptId(g);
      for (const p of g.players) g.handleAction(p, { type: 'castVote', optionId: truth });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  // all found truth every round, nobody fooled → equal scores → all placement 1
  eq(res.every((r) => r.placement === 1), true);
});

test('write timeout injects house fakes and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitFake', text: 'fib-a' });
  advance(35_000);
  eq(g.state, 'voting');
  assert(g.fakes['b'] && g.fakes['c'], 'missing players got house fakes');
});

test('vote timeout auto-votes everyone and advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'fib-a'], ['b', 'fib-b'], ['c', 'fib-c']]) g.handleAction(p, { type: 'submitFake', text: t });
  advance(25_000);
  eq(g.state, 'reveal');
});

test('reveal timeout auto-acks and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'fib-a'], ['b', 'fib-b'], ['c', 'fib-c']]) g.handleAction(p, { type: 'submitFake', text: t });
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'castVote', optionId: truthOptId(g) });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  assert(g.state === 'writing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('leave during writing (last owing) advances to voting; orphan fake stays', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitFake', text: 'fib-a' });
  g.handleAction('b', { type: 'submitFake', text: 'fib-b' });
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'voting');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during voting keeps the orphan fake on the ballot', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const [p, t] of [['a', 'fib-a'], ['b', 'fib-b'], ['c', 'fib-c'], ['d', 'fib-d']]) g.handleAction(p, { type: 'submitFake', text: t });
  const cFake = myFakeOpt(g, 'c').optionId;
  g.handleAction('a', { type: 'castVote', optionId: cFake }); // a was fooled by c's fake
  g.removePlayer('c'); // c leaves mid-vote
  // remaining must still finish voting
  g.handleAction('b', { type: 'castVote', optionId: truthOptId(g) });
  g.handleAction('d', { type: 'castVote', optionId: truthOptId(g) });
  eq(g.state, 'reveal');
  const opt = g.revealData.options.find((o) => o.optionId === cFake);
  assert(opt, 'orphan fake still on ballot');
  assert(!('c' in g.revealData.awards), 'leaver not awarded');
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
report('Fibbage');
