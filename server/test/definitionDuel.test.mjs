import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { DefinitionDuel } from '../src/games/DefinitionDuel.js';

installClock();

function newGame(players) {
  const g = new DefinitionDuel(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const truthOptId = (g) => g.ballot.find((o) => o.kind === 'truth').optionId;
const myFakeOpt = (g, p) => g.ballot.find((o) => o.kind === 'fake' && o.authorId === p);

test('starts in writing with a real word + definition and a write timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'writing');
  assert(g.word && g.word.word && g.word.definition, 'word loaded');
  assert(pendingTimers() >= 1, 'write timer armed');
});

test('the real definition is NOT in getStateForPlayer before reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  // writing
  let s = g.getStateForPlayer('c');
  assert(!JSON.stringify(s).includes(g.word.definition), 'definition not leaked in writing');
  // voting (ballot strips kind/authorId; truth text is on the ballot but unlabelled)
  for (const [p, t] of [['a', 'aaa'], ['b', 'bbb'], ['c', 'ccc']]) g.handleAction(p, { type: 'submitFake', text: t });
  eq(g.state, 'voting');
  s = g.getStateForPlayer('a');
  for (const o of s.ballot) {
    assert(!('authorId' in o), 'authorId hidden in voting');
    assert(!('kind' in o), 'kind hidden in voting');
  }
  // truthOptionId / authorship must not be exposed pre-reveal
  assert(!JSON.stringify(s).includes('truthOptionId'), 'truth id not leaked in voting');
});

test('the real definition IS disclosed at reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'aaa'], ['b', 'bbb'], ['c', 'ccc']]) g.handleAction(p, { type: 'submitFake', text: t });
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'castVote', optionId: truthOptId(g) });
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  assert(JSON.stringify(s).includes(g.word.definition), 'definition shown at reveal');
  const truth = s.reveal.options.find((o) => o.kind === 'truth');
  assert(truth && truth.text === g.word.definition, 'truth option labelled at reveal');
});

test('rejects a fake equal to the real definition or a duplicate', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitFake', text: `  ${g.word.definition.toUpperCase()}  ` }); // == truth
  eq(g.fakes['a'], undefined);
  g.handleAction('a', { type: 'submitFake', text: 'a kind of woven basket' });
  g.handleAction('b', { type: 'submitFake', text: 'A KIND OF WOVEN BASKET' }); // dup of a's
  eq(g.fakes['b'], undefined);
});

test('all fakes submitted advances to voting; ballot hides author/kind and flags mine', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitFake', text: 'apple' });
  g.handleAction('b', { type: 'submitFake', text: 'banana' });
  g.handleAction('c', { type: 'submitFake', text: 'cherry' });
  eq(g.state, 'voting');
  const s = g.getStateForPlayer('a');
  eq(s.ballot.length, 4); // 3 fakes + truth
  assert(s.ballot.some((o) => o.isMine), 'my own fake flagged');
});

test('cannot vote for your own fake', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'apple'], ['b', 'banana'], ['c', 'cherry']]) g.handleAction(p, { type: 'submitFake', text: t });
  const mine = myFakeOpt(g, 'a');
  g.handleAction('a', { type: 'castVote', optionId: mine.optionId });
  eq(g.votes['a'], undefined);
});

test('scoring: found truth +1000 and +500 per fool; reveal discloses authors/voters', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const [p, t] of [['a', 'apple'], ['b', 'banana'], ['c', 'cherry'], ['d', 'date']]) g.handleAction(p, { type: 'submitFake', text: t });
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
  const opt = g.revealData.options.find((o) => o.optionId === aFake);
  eq(opt.kind, 'fake'); eq(opt.authorId, 'a'); eq(opt.voters.length, 3);
});

test('full 4-round game finishes; results rank all N (placement 1 first) with a tie sharing placement, N=3', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 30) {
    if (g.state === 'writing') {
      let n = 0;
      for (const p of g.players) g.handleAction(p, { type: 'submitFake', text: `fake_${p}_${n++}` });
    } else if (g.state === 'voting') {
      const truth = truthOptId(g);
      for (const p of g.players) g.handleAction(p, { type: 'castVote', optionId: truth }); // all tie
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res[0].placement, 1);
  eq(res.every((r) => r.placement === 1), true); // equal scores → tie share placement 1
});

test('full 4-round game finishes with N=4 and distinct scores rank placement 1 first', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 30) {
    if (g.state === 'writing') {
      let n = 0;
      for (const p of g.players) g.handleAction(p, { type: 'submitFake', text: `fake_${p}_${n++}` });
    } else if (g.state === 'voting') {
      // only 'a' finds the truth every round → a leads, rest tie at 0
      const truth = truthOptId(g);
      g.handleAction('a', { type: 'castVote', optionId: truth });
      for (const p of g.players) if (p !== 'a' && g.votes[p] === undefined) {
        const notTruth = g.ballot.find((o) => o.optionId !== truth && !(o.kind === 'fake' && o.authorId === p));
        g.handleAction(p, { type: 'castVote', optionId: notTruth.optionId });
      }
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 4);
  eq(res[0].placement, 1);
  eq(res[0].playerId, 'a');
  assert(res[1].placement > 1, 'second place behind a');
});

test('write timeout injects house fakes and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitFake', text: 'apple' });
  const before = g.emitCount;
  advance(45_000);
  eq(g.state, 'voting');
  assert(g.fakes['b'] && g.fakes['c'], 'missing players got house fakes');
  assert(g.emitCount > before, 'broadcast on write timeout');
});

test('vote timeout auto-votes everyone and advances to reveal + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'apple'], ['b', 'banana'], ['c', 'cherry']]) g.handleAction(p, { type: 'submitFake', text: t });
  const before = g.emitCount;
  advance(35_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on vote timeout');
});

test('reveal timeout auto-acks and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, t] of [['a', 'apple'], ['b', 'banana'], ['c', 'cherry']]) g.handleAction(p, { type: 'submitFake', text: t });
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'castVote', optionId: truthOptId(g) });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(12_000);
  assert(g.state === 'writing' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('leave during writing (last owing) advances to voting; leaver not ranked', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitFake', text: 'apple' });
  g.handleAction('b', { type: 'submitFake', text: 'banana' });
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'voting');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during voting keeps the orphan fake on the ballot; leaver not awarded', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  for (const [p, t] of [['a', 'apple'], ['b', 'banana'], ['c', 'cherry'], ['d', 'date']]) g.handleAction(p, { type: 'submitFake', text: t });
  const cFake = myFakeOpt(g, 'c').optionId;
  g.handleAction('a', { type: 'castVote', optionId: cFake }); // a fooled by c's fake
  g.removePlayer('c'); // c leaves mid-vote
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
report('DefinitionDuel');
