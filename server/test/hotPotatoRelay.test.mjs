import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { HotPotatoRelay } from '../src/games/HotPotatoRelay.js';

installClock();

const FUSE_MAX_MS = 14000; // advancing past this guarantees the hidden fuse fired

function newGame(players) {
  const g = new HotPotatoRelay(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

test('starts live with a random holder and an armed (hidden) fuse', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'live');
  assert(g.players.includes(g.holder), 'holder is a real player');
  assert(pendingTimers() >= 1, 'fuse timer armed');
});

test('fuse duration is NEVER sent to clients (hidden info)', () => {
  const g = newGame(['a', 'b', 'c']);
  const s = g.getStateForPlayer('a');
  const json = JSON.stringify(s);
  assert(!('fuseId' in s), 'internal fuseId not exposed');
  // no key carrying a fuse/timer duration
  assert(!/fuse|fuseMs|fuseDuration|timeLeft|msLeft|remaining/i.test(json), 'no fuse/timer hint leaked');
  // and the actual hidden number must not appear anywhere in the payload
  assert(!json.includes(String(g._fuseRemaining || 'never-present')), 'no hidden duration in payload');
});

test('only the holder can pass; a non-holder pass is ignored', () => {
  const g = newGame(['a', 'b', 'c']);
  const holder = g.holder;
  const nonHolder = g.players.find((p) => p !== holder);
  g.handleAction(nonHolder, { type: 'pass' });
  eq(g.holder, holder); // unchanged — non-holder ignored
  g.handleAction(holder, { type: 'pass' });
  eq(g.holder, g._nextSurvivor(holder), 'holder passed to next survivor');
});

test('the player HOLDING the token when the fuse fires is eliminated', () => {
  const g = newGame(['a', 'b', 'c']);
  const victim = g.holder;
  advance(FUSE_MAX_MS + 1); // force the fuse
  assert(!g.survivors.includes(victim), 'holder at fire time was eliminated');
  eq(g.survivors.length, 2);
  eq(g.lastBlast.eliminated, victim);
  // a fresh fuse armed for the remaining 2 and token moved off the victim
  eq(g.state, 'live');
  assert(g.holder !== victim, 'token moved off the victim');
  assert(pendingTimers() >= 1, 'fresh fuse armed');
});

test('passing changes who explodes (server computes from holder at fire time)', () => {
  const g = newGame(['a', 'b', 'c']);
  const first = g.holder;
  g.handleAction(first, { type: 'pass' }); // hand it off so `first` is safe
  const newHolder = g.holder;
  assert(newHolder !== first, 'token moved');
  advance(FUSE_MAX_MS + 1);
  assert(g.survivors.includes(first), 'the passer survived');
  assert(!g.survivors.includes(newHolder), 'the new holder blew up');
});

test('every timer path calls _emitChange (spy the broadcast callback)', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(FUSE_MAX_MS + 1); // fuse fires -> _explode -> _emitChange
  assert(g.emitCount > before, 'fuse fire broadcasts');
  // run it down to gameOver and assert the ack timer also broadcasts
  let guard = 0;
  while (g.state === 'live' && guard++ < 10) advance(FUSE_MAX_MS + 1);
  eq(g.state, 'gameOver');
  const beforeAck = g.emitCount;
  advance(11000); // ack auto-advance
  eq(g.state, 'finished');
  assert(g.emitCount > beforeAck, 'gameOver ack-timeout broadcasts');
});

test('ack from survivor advances gameOver -> finished', () => {
  const g = newGame(['a', 'b']);
  advance(FUSE_MAX_MS + 1); // one pop leaves a single survivor -> gameOver
  eq(g.state, 'gameOver');
  const winner = g.survivors[0];
  g.handleAction(winner, { type: 'acknowledge' });
  eq(g.state, 'finished');
});

test('ping is a harmless re-broadcast nudge', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  const holder = g.holder;
  g.handleAction('a', { type: 'ping' });
  assert(g.emitCount > before, 'ping broadcasts');
  eq(g.holder, holder); // state untouched
  eq(g.survivors.length, 3);
});

for (const N of [2, 3, 4]) {
  test(`full game with ${N} players finishes; results length ${N}, placement 1 first`, () => {
    const g = newGame(Array.from({ length: N }, (_, i) => `p${i}`));
    let guard = 0;
    // Fire fuses one at a time (fireNext on the single pending fuse) so we don't
    // accidentally race past the gameOver ack timer in one big advance.
    while (g.state === 'live' && guard++ < 50) advance(FUSE_MAX_MS + 1);
    assert(g.state === 'gameOver' || g.state === 'finished', `reached end (got ${g.state})`);
    // ack the lone survivor (or it already auto-advanced)
    for (const p of g.survivors) g.handleAction(p, { type: 'acknowledge' });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    assert(res[0].survivedToEnd, 'winner survived to end');
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
    // placements are a non-decreasing sequence
    for (let i = 1; i < res.length; i++) assert(res[i].placement >= res[i - 1].placement, 'placements ordered');
  });
}

test('co-eliminations (same-tick leaves) share a placement', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  // Force a single tier of two eliminated together via the internal eliminate path,
  // then resolve the rest naturally.
  g._eliminate(['c', 'd']); // c & d out at the same tick -> one tier
  // c & d are no longer survivors
  assert(!g.survivors.includes('c') && !g.survivors.includes('d'), 'both removed');
  // make sure holder is still a survivor, then run the bomb to completion
  if (!g.survivors.includes(g.holder)) g.holder = g.survivors[0];
  let guard = 0;
  while (g.state === 'live' && guard++ < 20) advance(FUSE_MAX_MS + 1);
  for (const p of g.survivors) g.handleAction(p, { type: 'acknowledge' });
  eq(g.state, 'finished');
  const res = g.getResults();
  const c = res.find((r) => r.playerId === 'c');
  const d = res.find((r) => r.playerId === 'd');
  eq(c.placement, d.placement); // tie shares placement
});

test('removePlayer mid-play advances (no deadlock); holder hand-off', () => {
  const g = newGame(['a', 'b', 'c']);
  // force `a` to hold
  g.holder = 'a';
  g.removePlayer('a'); // the current holder leaves
  assert(!g.players.includes('a'), 'leaver pruned from roster');
  assert(g.survivors.includes(g.holder), 'fuse handed to a present survivor');
  eq(g.state, 'live');
  // game still completes
  let guard = 0;
  while (g.state === 'live' && guard++ < 20) advance(FUSE_MAX_MS + 1);
  eq(g.state, 'gameOver');
  for (const p of g.survivors) g.handleAction(p, { type: 'acknowledge' });
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver not in results');
});

test('removePlayer down to one survivor finishes immediately', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

test('destroy() clears all timers', () => {
  const g = newGame(['a', 'b', 'c']);
  assert(pendingTimers() >= 1, 'a timer is armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('a pass after the game is over is ignored', () => {
  const g = newGame(['a', 'b']);
  advance(FUSE_MAX_MS + 1);
  eq(g.state, 'gameOver');
  const before = JSON.stringify(g.survivors);
  g.handleAction(g.survivors[0], { type: 'pass' });
  eq(JSON.stringify(g.survivors), before); // no change
});

uninstallClock();
report('HotPotatoRelay');
