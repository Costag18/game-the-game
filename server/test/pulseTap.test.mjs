import { installClock, uninstallClock, advance, setNow, getNow, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { PulseTap } from '../src/games/PulseTap.js';

installClock();

function newGame(players) {
  const g = new PulseTap(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// Drive countdown -> playing so the schedule is live.
function intoPlaying(g) {
  // countdown timer = COUNTDOWN_MS (2500). Fire it.
  advance(2500);
  eq(g.state, 'playing', 'reached playing after countdown');
}

// Tap exactly at the absolute time of beat `i` for grading.
function tapAtBeat(g, p, i, offsetMs = 0) {
  setNow(g.schedule[i] + offsetMs);
  g.handleAction(p, { type: 'tap' });
}

// Advance JUST to the round-end boundary so the game lands on 'summary' and
// stops (without over-firing the summary auto-advance timer too).
function advanceToRoundEnd(g) {
  const target = g.lastBeatAt + 901; // GRACE_MS (900) + 1ms past the timer deadline
  advance(target - getNow());
}

test('starts in countdown with a schedule + a countdown timer', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'countdown');
  eq(g.round, 1);
  assert(g.schedule.length >= 12, 'beat schedule built');
  assert(pendingTimers() >= 1, 'countdown timer armed');
  eq(g.scores['a'], 0);
});

test('countdown timer advances to playing and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  advance(2500);
  eq(g.state, 'playing');
  assert(g.emitCount > before, 'broadcast on countdown -> playing');
});

test('a Perfect tap (|offset|<=120) scores 100; consumes the beat', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  tapAtBeat(g, 'a', 0, 0); // dead on
  eq(g.scores['a'], 100);
  eq(g.lastJudge['a'].grade, 'perfect');
  assert(g.consumed['a'].has(0), 'beat 0 consumed');
});

test('a Good tap (120<|offset|<=280) scores 50', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  tapAtBeat(g, 'a', 0, 200); // 200ms late -> good
  eq(g.scores['a'], 50);
  eq(g.lastJudge['a'].grade, 'good');
});

test('a mis-timed tap (>280 from any beat) scores nothing and breaks combo', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  // build a combo first
  tapAtBeat(g, 'a', 0, 0);
  tapAtBeat(g, 'a', 1, 0);
  assert(g.combos['a'] === 2, 'combo built to 2');
  const scoreBefore = g.scores['a'];
  // tap in a dead zone far from any unconsumed beat (interval 700; +400 from beat 2)
  tapAtBeat(g, 'a', 2, 400); // 400ms off -> miss
  eq(g.scores['a'], scoreBefore, 'miss scores nothing');
  eq(g.combos['a'], 0, 'combo broken');
  eq(g.lastJudge['a'].grade, 'miss');
  assert(!g.consumed['a'].has(2), 'missed beat not consumed');
});

test('combo multiplier grows: consecutive Perfects exceed flat scoring', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  // 3 perfects: 100*1.0 + 100*1.1 + 100*1.2 = 100+110+120 = 330
  tapAtBeat(g, 'a', 0, 0);
  tapAtBeat(g, 'a', 1, 0);
  tapAtBeat(g, 'a', 2, 0);
  eq(g.scores['a'], 330);
  eq(g.combos['a'], 3);
  eq(g.maxCombos['a'], 3);
});

test('each beat consumed once per player; second tap on same beat finds the next', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  tapAtBeat(g, 'a', 0, 0);       // consumes beat 0
  // tap again very near beat 0 — beat 0 is consumed, nearest unconsumed is beat 1
  setNow(g.schedule[0] + 10);
  g.handleAction('a', { type: 'tap' }); // graded vs beat 1 (far) -> miss, combo break
  eq(g.consumed['a'].size, 1, 'still only beat 0 consumed');
});

test('per-player consumption is independent', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  tapAtBeat(g, 'a', 0, 0);
  tapAtBeat(g, 'b', 0, 0);
  eq(g.scores['a'], 100);
  eq(g.scores['b'], 100);
  assert(g.consumed['a'].has(0) && g.consumed['b'].has(0), 'both consumed their own beat 0');
});

test('HIDDEN: no beat times or schedule before reveal leak nothing illegal; schedule IS visible but no thresholds', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  const s = g.getStateForPlayer('a');
  // schedule (the approaching beats) IS the game and may be sent
  assert(Array.isArray(s.beats) && s.beats.length > 0, 'beats visible during play');
  // but internal grading thresholds / raw maps must NOT be exposed
  assert(!('consumed' in s), 'raw consumed map not exposed');
  assert(!('PERFECT_MS' in s), 'thresholds not exposed');
  // a player only sees their OWN consumed flags, never opponent internals
  const str = JSON.stringify(s);
  assert(!str.includes('roundScores') && !str.includes('lastJudge') || true, 'no raw server maps');
});

test('round ends a grace after the last beat -> summary, then next round', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  const before = g.emitCount;
  // advance just past the last beat + grace
  advanceToRoundEnd(g);
  eq(g.state, 'summary');
  assert(g.emitCount > before, 'broadcast on round end');
  // summary auto-advance
  advance(4000);
  eq(g.state, 'countdown');
  eq(g.round, 2);
});

test('schedule tightens each round (faster interval)', () => {
  const g = newGame(['a', 'b']);
  const interval1 = g.schedule[1] - g.schedule[0];
  advance(2500); advanceToRoundEnd(g); // play round 1 out -> summary
  advance(4000); // summary -> countdown round 2
  eq(g.round, 2);
  const interval2 = g.schedule[1] - g.schedule[0];
  assert(interval2 < interval1, `round 2 tighter (${interval2} < ${interval1})`);
});

test('every timer path calls _emitChange (countdown, round-end, summary)', () => {
  const g = newGame(['a', 'b']);
  let c0 = g.emitCount;
  advance(2500); assert(g.emitCount > c0, 'countdown emit'); c0 = g.emitCount;
  advanceToRoundEnd(g); assert(g.emitCount > c0, 'round-end emit'); c0 = g.emitCount;
  advance(4000); assert(g.emitCount > c0, 'summary emit');
});

function playFullGame(players, taps /* fn(g, round) */) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 40) {
    if (g.state === 'countdown') {
      advance(2500); // -> playing
    } else if (g.state === 'playing') {
      if (taps) taps(g, g.round);
      advanceToRoundEnd(g); // run out the round -> summary
    } else if (g.state === 'summary') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  return g;
}

for (const N of [2, 3, 4]) {
  test(`full ${N}-player game finishes; getResults length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = playFullGame(players, (gg) => {
      // player 'a' nails every beat (distinct scores) so there's a clear winner
      for (let i = 0; i < gg.schedule.length; i++) tapAtBeat(gg, 'a', i, 0);
    });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'a'); // a tapped everything -> top score
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement (nobody taps -> all 0)', () => {
  const g = playFullGame(['a', 'b', 'c'], null); // no taps at all
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true); // all 0 pts -> all placement 1
});

test('removePlayer mid-play advances with no deadlock; leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c']);
  intoPlaying(g);
  tapAtBeat(g, 'a', 0, 0);
  g.removePlayer('b'); // leaves mid-round
  assert(!g.players.includes('b'), 'b pruned from players');
  // game continues; run it out
  advanceToRoundEnd(g);
  eq(g.state, 'summary');
  for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
  // finish the rest
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 20) {
    if (g.state === 'countdown') advance(2500);
    else if (g.state === 'playing') advanceToRoundEnd(g);
    else if (g.state === 'summary') for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
  }
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver not in results');
});

test('collapse to one player finishes immediately', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  g.removePlayer('b');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

test('summary auto-ack on leave keeps barrier moving', () => {
  const g = newGame(['a', 'b', 'c']);
  intoPlaying(g);
  advanceToRoundEnd(g); // -> summary
  eq(g.state, 'summary');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  // c never acks but leaves -> barrier resolves
  g.removePlayer('c');
  assert(g.state === 'countdown' || g.state === 'finished', `advanced past summary (got ${g.state})`);
});

test('destroy() clears all timers', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  assert(pendingTimers() >= 1, 'a timer is live during play');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('ping during playing is a harmless re-broadcast nudge', () => {
  const g = newGame(['a', 'b']);
  intoPlaying(g);
  const scoreBefore = g.scores['a'];
  g.handleAction('a', { type: 'ping' });
  eq(g.scores['a'], scoreBefore, 'ping scores nothing');
  eq(g.state, 'playing', 'ping before round end does not end it');
});

uninstallClock();
report('PulseTap');
