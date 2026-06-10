import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { MobRule } from '../src/games/MobRule.js';

installClock();

function newGame(players) {
  const g = new MobRule(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Force a deterministic reward rule on the CURRENT round for clean math tests.
function forceTwist(g, twist) {
  g.isTwist = twist;
  g.prompt = { ...g.prompt, isTwist: twist };
}

test('starts in picking with a prompt, two sides, a reward banner and a pick timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'picking');
  assert(g.prompt && g.prompt.prompt, 'prompt loaded');
  assert(g.prompt.a && g.prompt.b, 'two sides present');
  const s = g.getStateForPlayer('a');
  assert(typeof s.isTwist === 'boolean', 'twist flag exposed before picking');
  assert(s.rewardLabel.includes('MAJORITY') || s.rewardLabel.includes('MINORITY'), 'reward label shown pre-pick');
  assert(pendingTimers() >= 1, 'pick timer armed');
});

test('picks are private pre-reveal: nobody else can see who picked what', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  g.handleAction('b', { type: 'pickSide', side: 'b' });
  const s = g.getStateForPlayer('c');
  // c has not picked: must not learn a/b's picks, nor any reveal payload
  assert(s.reveal === null, 'no reveal payload during picking');
  assert(!('picks' in s), 'raw picks map not exposed');
  assert(s.myPick === null, "c's own pick is null (hasn't picked)");
  eq(s.pickedCount, 2); // aggregate count only
  // and a/b's chosen sides are NOT anywhere in the serialized state for c
  const json = JSON.stringify(s);
  assert(!json.includes('"side"'), 'no per-player side field leaked');
});

test('rejects invalid side and double-pick', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'pickSide', side: 'x' });
  eq(g.picks['a'], undefined);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  eq(g.picks['a'], 'a');
  g.handleAction('a', { type: 'pickSide', side: 'b' }); // already picked
  eq(g.picks['a'], 'a');
});

test('NORMAL round: majority side scores +500 each, minority scores 0', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  forceTwist(g, false);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  g.handleAction('b', { type: 'pickSide', side: 'a' });
  g.handleAction('c', { type: 'pickSide', side: 'a' }); // a-side majority (3)
  g.handleAction('d', { type: 'pickSide', side: 'b' }); // b-side minority (1)
  eq(g.state, 'reveal');
  eq(g.revealData.rewardedSide, 'a');
  eq(g.scores['a'], 500);
  eq(g.scores['b'], 500);
  eq(g.scores['c'], 500);
  eq(g.scores['d'], 0);
  // reveal now discloses picks + per-player award
  eq(g.revealData.picks['d'], 'b');
  eq(g.revealData.awards['d'].won, false);
  eq(g.revealData.awards['a'].won, true);
});

test('TWIST round: minority side scores +500, majority scores 0', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  forceTwist(g, true);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  g.handleAction('b', { type: 'pickSide', side: 'a' });
  g.handleAction('c', { type: 'pickSide', side: 'a' }); // majority (3) → 0
  g.handleAction('d', { type: 'pickSide', side: 'b' }); // minority (1) → +500
  eq(g.state, 'reveal');
  eq(g.revealData.rewardedSide, 'b');
  eq(g.scores['d'], 500);
  eq(g.scores['a'], 0);
});

test('exact tie: nobody scores (both NORMAL and TWIST)', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  forceTwist(g, false);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  g.handleAction('b', { type: 'pickSide', side: 'a' });
  g.handleAction('c', { type: 'pickSide', side: 'b' });
  g.handleAction('d', { type: 'pickSide', side: 'b' }); // 2-2 tie
  eq(g.state, 'reveal');
  eq(g.revealData.tie, true);
  eq(g.revealData.rewardedSide, null);
  for (const p of ['a', 'b', 'c', 'd']) eq(g.scores[p], 0);
});

test('the reward result is NOT computable before reveal; reveal exposes it', () => {
  const g = newGame(['a', 'b', 'c']);
  forceTwist(g, false); // deterministic: majority 'a' is rewarded
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  const sBefore = g.getStateForPlayer('b');
  assert(sBefore.reveal === null, 'no reveal data pre-reveal');
  assert(!('rewardedSide' in sBefore), 'rewardedSide not leaked pre-reveal');
  g.handleAction('b', { type: 'pickSide', side: 'a' });
  g.handleAction('c', { type: 'pickSide', side: 'b' });
  eq(g.state, 'reveal');
  const sAfter = g.getStateForPlayer('b');
  assert(sAfter.reveal && sAfter.reveal.rewardedSide === 'a', 'reveal exposes rewarded side');
});

test('all picks submitted advances picking -> reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  g.handleAction('b', { type: 'pickSide', side: 'b' });
  eq(g.state, 'picking');
  g.handleAction('c', { type: 'pickSide', side: 'a' });
  eq(g.state, 'reveal');
});

test('pick timeout auto-picks missing players and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  const before = g.emitCount;
  advance(25_000);
  eq(g.state, 'reveal');
  assert(g.picks['b'] !== undefined && g.picks['c'] !== undefined, 'missing players auto-picked');
  assert(g.emitCount > before, 'broadcast on pick timeout');
});

test('reveal timeout auto-acks and advances + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, s] of [['a', 'a'], ['b', 'a'], ['c', 'b']]) g.handleAction(p, { type: 'pickSide', side: s });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(10_000);
  assert(g.state === 'picking' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

for (const N of [3, 4]) {
  test(`full 5-round game (N=${N}) finishes; results rank all N, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 40) {
      if (g.state === 'picking') {
        // Everyone picks 'a' → unanimous. Normal round → all win; twist → tie (0).
        for (const p of g.players) g.handleAction(p, { type: 'pickSide', side: 'a' });
      } else if (g.state === 'reveal') {
        for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // unanimous every round → equal scores → everyone shares placement 1
    eq(res.every((r) => r.placement === 1), true);
  });
}

test('tie in scores shares a placement; a clear winner ranks first alone', () => {
  const g = newGame(['a', 'b', 'c']);
  // Round 1 forced normal: a & b pick majority side, c minority → a,b score, c 0
  forceTwist(g, false);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  g.handleAction('b', { type: 'pickSide', side: 'a' });
  g.handleAction('c', { type: 'pickSide', side: 'b' });
  eq(g.state, 'reveal');
  for (const p of ['a', 'b', 'c']) g.handleAction(p, { type: 'acknowledge' });
  // a=500, b=500, c=0
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1);
  eq(res.find((r) => r.playerId === 'b').placement, 1); // tie shares placement 1
  eq(res.find((r) => r.playerId === 'c').placement, 3); // skips 2
});

test('leave during picking (last owing) advances to reveal; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'pickSide', side: 'a' });
  g.handleAction('b', { type: 'pickSide', side: 'a' });
  g.removePlayer('c'); // c never picked, was the last owed
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during reveal advances; leaver not awarded and not in results', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const [p, s] of [['a', 'a'], ['b', 'a'], ['c', 'b']]) g.handleAction(p, { type: 'pickSide', side: s });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last owed ack leaves
  assert(g.state === 'picking' || g.state === 'finished', `advanced off reveal (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver pruned');
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
report('MobRule');
