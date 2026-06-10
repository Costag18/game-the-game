import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { HigherLower } from '../src/games/HigherLower.js';

installClock();

function newGame(players) {
  const g = new HigherLower(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// The correct call for the live step (anchor vs next), computed from server state.
function correctDir(g) {
  const a = g.anchor.value, n = g.nextItem.value;
  return n > a ? 'higher' : n < a ? 'lower' : 'push';
}
const wrongDir = (g) => (correctDir(g) === 'higher' ? 'lower' : 'higher');

test('starts in question with an anchor, a next label, and an answer timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'question');
  assert(g.anchor && g.nextItem, 'anchor + next item loaded');
  const s = g.getStateForPlayer('a');
  eq(s.phase, 'question');
  assert(s.anchorLabel && typeof s.anchorValue === 'number', 'anchor shown with value');
  assert(s.nextLabel && s.nextLabel.length > 0, 'next label shown');
  assert(pendingTimers() >= 1, 'answer timer armed');
});

test('next value is hidden during question but revealed in reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  const sQ = g.getStateForPlayer('a');
  // structural anti-cheat: the engine exposes nextLabel/nextUnit but NEVER the next VALUE
  // (nor correctCall) until reveal. Don't substring-search the number — that false-positives
  // when the secret is a digit-substring of an exposed number (e.g. anchor 64 vs next 6).
  assert(!('nextValue' in sQ) && !('correctCall' in sQ), 'next value/answer not exposed during question');
  assert(sQ.reveal === null, 'no reveal payload during question');
  // everyone calls -> reveal
  for (const p of g.players) g.handleAction(p, { type: 'call', direction: correctDir(g) === 'push' ? 'higher' : correctDir(g) });
  eq(g.state, 'reveal');
  const sR = g.getStateForPlayer('a');
  assert(sR.reveal && typeof sR.reveal.nextValue === 'number', 'next value present in reveal');
  assert('correctCall' in sR.reveal, 'correctCall present in reveal');
});

test('correct call survives and streaks++, wrong call is eliminated', () => {
  const g = newGame(['a', 'b', 'c']);
  if (correctDir(g) === 'push') { eq(true, true); return; } // skip the rare push board
  const right = correctDir(g), wrong = wrongDir(g);
  g.handleAction('a', { type: 'call', direction: right });
  g.handleAction('b', { type: 'call', direction: wrong });
  g.handleAction('c', { type: 'call', direction: right });
  eq(g.state, 'reveal');
  eq(g.streaks['a'], 1);
  eq(g.streaks['c'], 1);
  eq(g.streaks['b'], 0);
  assert(g.alive.has('a') && g.alive.has('c'), 'correct callers survive');
  assert(!g.alive.has('b'), 'wrong caller eliminated');
  eq(g.revealData.outcomes['b'].result, 'wrong');
});

test('no call (timeout) eliminates the silent player', () => {
  const g = newGame(['a', 'b', 'c']);
  if (correctDir(g) === 'push') { eq(true, true); return; }
  const right = correctDir(g);
  g.handleAction('a', { type: 'call', direction: right });
  g.handleAction('b', { type: 'call', direction: right });
  // c never calls -> answer timer fires
  const before = g.emitCount;
  advance(ANSWER_TIMEOUT());
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on answer timeout');
  assert(!g.alive.has('c'), 'silent player eliminated');
  assert(g.alive.has('a') && g.alive.has('b'), 'callers survived');
});

test('all alive players called advances to reveal immediately', () => {
  const g = newGame(['a', 'b']);
  const dir = correctDir(g) === 'push' ? 'higher' : correctDir(g);
  g.handleAction('a', { type: 'call', direction: dir });
  eq(g.state, 'question'); // still waiting on b
  g.handleAction('b', { type: 'call', direction: dir });
  eq(g.state, 'reveal');
});

test('reveal auto-advances to the next question (or finished)', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of g.players) g.handleAction(p, { type: 'call', direction: correctDir(g) === 'push' ? 'higher' : correctDir(g) });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(REVEAL_TIMEOUT());
  assert(g.state === 'question' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('a full game runs to finished with N results, placement 1 first', () => {
  for (const N of [2, 3, 4]) {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'question') {
        // every alive player calls correctly so they survive as long as possible
        const dir = correctDir(g);
        for (const p of [...g.alive]) g.handleAction(p, { type: 'call', direction: dir === 'push' ? 'higher' : dir });
        // if it was a push, no one is eliminated; either way reveal is reached
        if (g.state === 'question') advance(ANSWER_TIMEOUT());
      } else if (g.state === 'reveal') {
        for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
        if (g.state === 'reveal') advance(REVEAL_TIMEOUT());
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  }
});

test('a tie shares a placement', () => {
  // 3 players all call correctly every step -> identical streaks -> all placement 1
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'question') {
      const dir = correctDir(g);
      for (const p of [...g.alive]) g.handleAction(p, { type: 'call', direction: dir === 'push' ? 'higher' : dir });
      if (g.state === 'question') advance(ANSWER_TIMEOUT());
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      if (g.state === 'reveal') advance(REVEAL_TIMEOUT());
    }
  }
  const res = g.getResults();
  eq(res.every((r) => r.placement === 1), true);
});

test('leave mid-question advances (no deadlock) and prunes leaver from results', () => {
  const g = newGame(['a', 'b', 'c']);
  const dir = correctDir(g) === 'push' ? 'higher' : correctDir(g);
  g.handleAction('a', { type: 'call', direction: dir });
  g.handleAction('b', { type: 'call', direction: dir });
  // c is the last owed; removing them should complete the step
  g.removePlayer('c');
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not in results');
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

// The engine's private timer constants, mirrored here for advancing the virtual clock.
function ANSWER_TIMEOUT() { return 15_000; }
function REVEAL_TIMEOUT() { return 6_000; }

uninstallClock();
report('HigherLower');
