import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Timeline } from '../src/games/Timeline.js';

installClock();

function newGame(players) {
  const g = new Timeline(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts in guessing with an event and a guess timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'guessing');
  assert(g.event && typeof g.event.year === 'number', 'event loaded with a year');
  eq(g.qIndex, 0);
  assert(pendingTimers() >= 1, 'guess timer armed');
});

test('true year is hidden during guessing but present in reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  const trueYear = String(g.event.year);
  const dur = JSON.stringify(g.getStateForPlayer('a'));
  assert(!dur.includes(`"trueYear":${trueYear}`), 'true year not leaked in guessing');
  eq(g.getStateForPlayer('a').trueYear, null);
  // lock everyone -> reveal
  for (const p of g.players) g.handleAction(p, { type: 'submitYear', year: 1900 });
  eq(g.state, 'reveal');
  eq(g.getStateForPlayer('a').trueYear, g.event.year);
  const rv = JSON.stringify(g.getStateForPlayer('a'));
  assert(rv.includes(`"trueYear":${trueYear}`), 'true year present in reveal');
});

test('does not leak another player guess during guessing', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitYear', year: 1969 });
  const sb = g.getStateForPlayer('b');
  eq(sb.results, null);
  eq(sb.myGuess, null); // b has not guessed
  // a's own guess is visible to a only
  eq(g.getStateForPlayer('a').myGuess, 1969);
});

test('scoring: closer guess scores more; exact = 1000; far = 0', () => {
  const g = newGame(['a', 'b', 'c']);
  const ty = g.event.year;
  // pick an in-range "far" year > 50 yrs from ty so it floors to 0 without clamping
  const far = ty > 1700 ? 1500 : 1900;
  assert(Math.abs(far - ty) > 50, 'far guess is genuinely far');
  g.handleAction('a', { type: 'submitYear', year: ty });        // exact -> 1000
  g.handleAction('b', { type: 'submitYear', year: ty + 10 });   // 10 off -> 800
  g.handleAction('c', { type: 'submitYear', year: far });       // far -> 0
  eq(g.state, 'reveal');
  eq(g.scores['a'], 1000);
  eq(g.scores['b'], Math.max(0, 1000 - 10 * 20));
  eq(g.scores['c'], 0);
});

test('year is clamped to [min,max]', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitYear', year: 99999 });
  g.handleAction('b', { type: 'submitYear', year: -99999 });
  eq(g.guesses['a'], 2100);
  eq(g.guesses['b'], -4000);
});

test('cannot lock twice; ignores non-players', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'submitYear', year: 1800 });
  g.handleAction('a', { type: 'submitYear', year: 1500 }); // ignored
  eq(g.guesses['a'], 1800);
  g.handleAction('z', { type: 'submitYear', year: 1500 }); // not a player
  eq(g.guesses['z'], undefined);
});

test('all locked advances to reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitYear', year: 1900 });
  g.handleAction('b', { type: 'submitYear', year: 1910 });
  eq(g.state, 'guessing');
  g.handleAction('c', { type: 'submitYear', year: 1920 });
  eq(g.state, 'reveal');
  assert(g.revealData && g.revealData.results.length === 3, 'reveal results present');
});

test('guess timer auto-advances to reveal and broadcasts; missers score 0', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitYear', year: g.event.year }); // a guesses exact
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on guess timeout');
  eq(g.scores['a'], 1000);
  eq(g.scores['b'], 0); // missed
  eq(g.scores['c'], 0); // missed
  const missB = g.revealData.results.find((r) => r.playerId === 'b');
  eq(missB.missed, true);
});

test('reveal timer auto-acks and advances to next question', () => {
  const g = newGame(['a', 'b']);
  for (const p of g.players) g.handleAction(p, { type: 'submitYear', year: 1900 });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(6_000);
  eq(g.state, 'guessing');
  eq(g.qIndex, 1);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('reveal acknowledge by all advances early', () => {
  const g = newGame(['a', 'b']);
  for (const p of g.players) g.handleAction(p, { type: 'submitYear', year: 1900 });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  eq(g.state, 'reveal');
  g.handleAction('b', { type: 'acknowledge' });
  eq(g.state, 'guessing');
});

function runFullGame(players) {
  const g = newGame(players);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 60) {
    if (g.state === 'guessing') {
      // each player guesses a distinct year so scores differ deterministically
      let off = 0;
      for (const p of g.players) { g.handleAction(p, { type: 'submitYear', year: g.event.year + off }); off += 5; }
    } else if (g.state === 'reveal') {
      advance(6_000);
    }
  }
  return g;
}

for (const N of [2, 3, 4]) {
  test(`full game with ${N} players finishes; getResults length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = runFullGame(players);
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // 'a' guessed exact every round -> highest score -> first
    eq(res[0].playerId, 'a');
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 60) {
    if (g.state === 'guessing') {
      // everyone guesses exactly right -> all tie at 1000/round
      for (const p of g.players) g.handleAction(p, { type: 'submitYear', year: g.event.year });
    } else if (g.state === 'reveal') {
      advance(6_000);
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res.every((r) => r.placement === 1), true);
});

test('removePlayer mid-guess advances (no deadlock) and prunes leaver', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitYear', year: 1900 });
  g.handleAction('b', { type: 'submitYear', year: 1910 });
  eq(g.state, 'guessing');
  g.removePlayer('c'); // last one owing -> should reveal
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not in results');
});

test('removePlayer mid-reveal advances when last ack owed', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of g.players) g.handleAction(p, { type: 'submitYear', year: 1900 });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  eq(g.state, 'reveal'); // c still owes
  g.removePlayer('c');
  eq(g.state, 'guessing'); // advanced
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
report('Timeline');
