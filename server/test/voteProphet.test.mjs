import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { VoteProphet } from '../src/games/VoteProphet.js';

installClock();

function newGame(players) {
  const g = new VoteProphet(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
// lock in a real preference + a group-plurality prediction
const lock = (g, p, pref, prediction) => g.handleAction(p, { type: 'lockIn', pref, prediction });

test('starts in predicting with a prompt, two sides, and a submit timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'predicting');
  assert(g.prompt && g.prompt.a && g.prompt.b, 'prompt with two sides loaded');
  eq(g.roundNumber, undefined); // internal index, exposed via state
  assert(pendingTimers() >= 1, 'submit timer armed');
});

test('secret prefs/predictions are NOT leaked to others before reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  lock(g, 'a', 'a', 'b');
  lock(g, 'b', 'b', 'b');
  // c has not submitted; inspect what c can see — must not contain anyone else's choice
  const s = g.getStateForPlayer('c');
  eq(s.reveal, null);
  eq(s.myPref, null);       // c hasn't chosen
  eq(s.myPrediction, null);
  // server holds a's/b's secrets but they must never appear in c's view
  const blob = JSON.stringify(s);
  // submittedCount leaks an aggregate count only (allowed); the per-player maps must be absent
  assert(!('prefs' in s), 'no prefs map sent');
  assert(!('predictions' in s), 'no predictions map sent');
  eq(s.submittedCount, 2);
  eq(blob.includes('"myPref":"a"'), false);
  // and the submitter only ever sees their OWN choice
  const sa = g.getStateForPlayer('a');
  eq(sa.myPref, 'a'); eq(sa.myPrediction, 'b');
});

test('reveal exposes the group split + awards (secret now allowed)', () => {
  const g = newGame(['a', 'b', 'c']);
  // real prefs: a,a,b -> plurality 'a'
  lock(g, 'a', 'a', 'a');
  lock(g, 'b', 'a', 'a');
  lock(g, 'c', 'b', 'a');
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  assert(s.reveal, 'reveal data present');
  eq(s.reveal.countA, 2);
  eq(s.reveal.countB, 1);
  eq(s.reveal.pluralitySide, 'a');
  eq(s.reveal.tie, false);
});

test('scoring: +500 to every prediction that matched the plurality', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  // real prefs: a,a,a,b -> plurality 'a'
  // predictions: a(✓), a(✓), b(✗), a(✓)
  lock(g, 'a', 'a', 'a');
  lock(g, 'b', 'a', 'a');
  lock(g, 'c', 'a', 'b');
  lock(g, 'd', 'b', 'a');
  eq(g.state, 'reveal');
  eq(g.scores['a'], 500);
  eq(g.scores['b'], 500);
  eq(g.scores['c'], 0);
  eq(g.scores['d'], 500);
  eq(g.revealData.awards['c'].correct, false);
  eq(g.revealData.awards['a'].correct, true);
});

test('plurality TIE: either prediction counts as correct (+500 to all)', () => {
  const g = newGame(['a', 'b']);
  // real prefs: a,b -> 1/1 tie
  lock(g, 'a', 'a', 'a'); // predicted a
  lock(g, 'b', 'b', 'b'); // predicted b
  eq(g.state, 'reveal');
  eq(g.revealData.tie, true);
  eq(g.revealData.pluralitySide, null);
  eq(g.scores['a'], 500);
  eq(g.scores['b'], 500);
});

test('barrier: all locked-in advances immediately to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  lock(g, 'a', 'a', 'a');
  lock(g, 'b', 'b', 'a');
  eq(g.state, 'predicting'); // still waiting on c
  lock(g, 'c', 'a', 'a');
  eq(g.state, 'reveal');
});

test('lockIn is one-shot (cannot change) and rejects bad payloads', () => {
  const g = newGame(['a', 'b', 'c']);
  lock(g, 'a', 'x', 'a'); // invalid pref
  eq(g.prefs['a'], undefined);
  lock(g, 'a', 'a', 'a'); // valid
  eq(g.prefs['a'], 'a'); eq(g.predictions['a'], 'a');
  lock(g, 'a', 'b', 'b'); // try to change -> ignored
  eq(g.prefs['a'], 'a'); eq(g.predictions['a'], 'a');
});

test('submit timeout auto-fills missing players and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  lock(g, 'a', 'a', 'a');
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'reveal');
  assert(g._hasSubmitted('b') && g._hasSubmitted('c'), 'missing players auto-filled');
  assert(g.emitCount > before, 'broadcast on submit timeout');
});

test('reveal timeout auto-acks and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) lock(g, p, 'a', 'a');
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(10_000);
  assert(g.state === 'predicting' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

for (const N of [3, 4]) {
  test(`full 5-round game (N=${N}) finishes; getResults ranks all N, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 40) {
      if (g.state === 'predicting') {
        // everyone really prefers 'a' AND predicts 'a' -> all correct every round
        for (const p of g.players) lock(g, p, 'a', 'a');
      } else if (g.state === 'reveal') {
        for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // all correct all 5 rounds -> equal scores -> all placement 1, all 2500
    eq(res.every((r) => r.placement === 1 && r.score === 2500), true);
  });
}

test('a tie in final scores shares a placement', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'predicting') {
      // real prefs all 'a' -> plurality 'a'. a & b predict 'a' (correct), c predicts 'b' (wrong)
      lock(g, 'a', 'a', 'a');
      lock(g, 'b', 'a', 'a');
      lock(g, 'c', 'a', 'b');
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  // a & b tie at 2500 (placement 1,1); c at 0 (placement 3)
  const byId = Object.fromEntries(res.map((r) => [r.playerId, r]));
  eq(byId['a'].placement, 1);
  eq(byId['b'].placement, 1);
  eq(byId['c'].placement, 3);
});

test('leave during predicting (last owing) advances to reveal; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  lock(g, 'a', 'a', 'a');
  lock(g, 'b', 'a', 'a');
  g.removePlayer('c'); // c never submitted, was the last owed
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during reveal (last owing ack) advances; no deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b', 'c']) lock(g, p, 'a', 'a');
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last un-acked leaves
  assert(g.state === 'predicting' || g.state === 'finished', `advanced (got ${g.state})`);
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
report('VoteProphet');
