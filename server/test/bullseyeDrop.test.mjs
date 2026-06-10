import { installClock, uninstallClock, advance, setNow, getNow, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { BullseyeDrop } from '../src/games/BullseyeDrop.js';

installClock();

function newGame(players) {
  const g = new BullseyeDrop(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// helper: position a player's reticle cycle so that releasing NOW reads radius=`frac*MAX_R`.
// elapsed = (now - cycleStart) mod period; for the rising half, frac = elapsed/(period/2).
function setReticleFrac(g, p, frac) {
  const period = g.period[p];
  const elapsed = (frac * period) / 2; // rising-half offset
  g.cycleStart[p] = getNow() - elapsed;
}

test('starts in throwing with full darts, per-player throw-window timers armed', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'throwing');
  eq(g.dartsLeft['a'], 5);
  eq(g.dartsLeft['b'], 5);
  // one window timer per player
  eq(pendingTimers(), 3);
});

test('bullseye at radius 0 scores +100; reticle params (not score) are what client gets', () => {
  const g = newGame(['a', 'b']);
  setReticleFrac(g, 'a', 0); // radius 0 → bullseye
  g.handleAction('a', { type: 'release' });
  eq(g.scores['a'], 100);
  eq(g.dartsLeft['a'], 4);
  eq(g.throws['a'][0].label, 'BULLSEYE');
  // client sees animation params only; the recomputed score lives server-side
  const s = g.getStateForPlayer('a');
  assert(s.reticle && typeof s.reticle.period === 'number' && typeof s.reticle.cycleStart === 'number', 'reticle params sent');
  eq(s.myScore, 100);
});

test('ring scoring across radii: 75 / 50 / 25 / 5 outward', () => {
  const g = newGame(['a', 'b']);
  // frac 0.20 -> INNER 75
  setReticleFrac(g, 'a', 0.20); g.handleAction('a', { type: 'release' });
  eq(g.throws['a'][0].points, 75);
  // frac 0.40 -> MID 50
  setReticleFrac(g, 'a', 0.40); g.handleAction('a', { type: 'release' });
  eq(g.throws['a'][1].points, 50);
  // frac 0.70 -> OUTER 25
  setReticleFrac(g, 'a', 0.70); g.handleAction('a', { type: 'release' });
  eq(g.throws['a'][2].points, 25);
  // frac 0.95 -> EDGE 5
  setReticleFrac(g, 'a', 0.95); g.handleAction('a', { type: 'release' });
  eq(g.throws['a'][3].points, 5);
  eq(g.scores['a'], 75 + 50 + 25 + 5);
});

test('each throw shortens the next reticle period (faster = harder)', () => {
  const g = newGame(['a', 'b']);
  const p0 = g.period['a'];
  g.handleAction('a', { type: 'release' });
  const p1 = g.period['a'];
  assert(p1 < p0, 'period shortened after a throw');
  // and cycleStart resets to "now" on each throw
  eq(g.cycleStart['a'], getNow());
});

test('release with no darts left scores nothing (invalid action)', () => {
  const g = newGame(['a', 'b']);
  for (let i = 0; i < 5; i++) { setReticleFrac(g, 'a', 0); g.handleAction('a', { type: 'release' }); }
  eq(g.dartsLeft['a'], 0);
  const scoreAfter5 = g.scores['a'];
  g.handleAction('a', { type: 'release' }); // 6th throw — ignored
  eq(g.scores['a'], scoreAfter5);
  eq(g.throws['a'].length, 5);
});

test('release from a non-player is ignored', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('zzz', { type: 'release' });
  eq(g.scores['zzz'], undefined);
});

test('no hidden info to leak, but score is never client-trusted; getStateForPlayer exposes no internal threshold', () => {
  const g = newGame(['a', 'b']);
  const s = g.getStateForPlayer('a');
  // a client cannot send its own score; only release/ping/acknowledge are honored
  g.handleAction('a', { type: 'release', score: 999999, points: 999999 });
  assert(g.scores['a'] <= 100, 'client-supplied score ignored');
  // no per-player secret threshold/fuse field leaked
  assert(!('threshold' in s) && !('fuse' in s) && !('secret' in s), 'no hidden fields in state');
});

test('per-player throw-window timeout auto-misses remaining darts and broadcasts', () => {
  const g = newGame(['a', 'b']);
  // a throws once, b throws nothing
  setReticleFrac(g, 'a', 0); g.handleAction('a', { type: 'release' });
  const before = g.emitCount;
  advance(20_000); // both windows expire
  eq(g.state, 'finished');
  // a had 4 darts left -> auto-missed; b had 5 -> auto-missed
  eq(g.dartsLeft['a'], 0);
  eq(g.dartsLeft['b'], 0);
  eq(g.throws['a'].filter((t) => t.missed).length, 4);
  eq(g.throws['b'].filter((t) => t.missed).length, 5);
  assert(g.emitCount > before, 'timeout broadcast fired');
});

test('finishes when everyone is out of darts (highest total wins)', () => {
  const g = newGame(['a', 'b']);
  for (let i = 0; i < 5; i++) { setReticleFrac(g, 'a', 0); g.handleAction('a', { type: 'release' }); }   // a: 500
  for (let i = 0; i < 5; i++) { setReticleFrac(g, 'b', 0.95); g.handleAction('b', { type: 'release' }); } // b: 25
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 2);
  eq(res[0].playerId, 'a');
  eq(res[0].placement, 1);
  eq(res[1].placement, 2);
});

test('every timer path calls _emitChange (spy the callback) — window timeout + finished ack', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  advance(20_000); // window timeouts -> finish (emits)
  assert(g.emitCount > before, 'window timeout emitted');
  eq(g.state, 'finished');
  const afterFinish = g.emitCount;
  advance(10_000); // finished ack auto-advance (emits)
  assert(g.emitCount > afterFinish, 'ack timeout emitted');
  for (const p of g.players) assert(g.acknowledged.has(p), 'auto-acked on timeout');
});

for (const N of [2, 3, 4]) {
  test(`full game reaches finished with getResults length ${N}, placement 1 first`, () => {
    const players = Array.from({ length: N }, (_, i) => `p${i}`);
    const g = newGame(players);
    // everyone throws all 5 darts at decreasing fracs so scores differ -> p0 best
    players.forEach((p, idx) => {
      for (let i = 0; i < 5; i++) {
        setReticleFrac(g, p, Math.min(0.99, idx * 0.18)); // p0 -> bullseyes, later players worse
        g.handleAction(p, { type: 'release' });
      }
    });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
  });
}

test('a tie shares a placement (every player once)', () => {
  const g = newGame(['a', 'b', 'c']);
  // a and b both score identically; c scores lower
  for (const p of ['a', 'b']) for (let i = 0; i < 5; i++) { setReticleFrac(g, p, 0); g.handleAction(p, { type: 'release' }); }
  for (let i = 0; i < 5; i++) { setReticleFrac(g, 'c', 0.95); g.handleAction('c', { type: 'release' }); }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  const a = res.find((r) => r.playerId === 'a');
  const b = res.find((r) => r.playerId === 'b');
  const c = res.find((r) => r.playerId === 'c');
  eq(a.placement, 1);
  eq(b.placement, 1); // tie shares placement
  eq(c.placement, 3); // next distinct placement skips to 3
});

test('removePlayer mid-throw advances (no deadlock); leaver excluded from results', () => {
  const g = newGame(['a', 'b']);
  // b finishes all darts; a still has darts. b leaving should NOT be needed, but
  // test: a finishes, then b leaves before finishing -> game should finish.
  for (let i = 0; i < 5; i++) { setReticleFrac(g, 'a', 0); g.handleAction('a', { type: 'release' }); }
  eq(g.state, 'throwing'); // still waiting on b
  g.removePlayer('b');     // only a remains -> finish
  eq(g.state, 'finished');
  const res = g.getResults();
  assert(!res.some((r) => r.playerId === 'b'), 'leaver pruned from results');
  eq(res.length, 1);
});

test('removePlayer of a non-blocking player unblocks the finish barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  for (const p of ['a', 'b']) for (let i = 0; i < 5; i++) { setReticleFrac(g, p, 0); g.handleAction(p, { type: 'release' }); }
  eq(g.state, 'throwing'); // c still owes darts
  g.removePlayer('c');     // c gone -> a & b are done -> finish
  eq(g.state, 'finished');
  eq(g.getResults().length, 2);
});

test('collapse to one finishes; destroy clears all timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('ping is a harmless no-op nudge (no score change, state preserved)', () => {
  const g = newGame(['a', 'b']);
  setReticleFrac(g, 'a', 0); g.handleAction('a', { type: 'release' });
  const before = g.scores['a'];
  g.handleAction('a', { type: 'ping' });
  eq(g.scores['a'], before);
  eq(g.state, 'throwing');
});

test('triangle wave: half-period release reads MAX_R (edge), not bullseye', () => {
  const g = newGame(['a', 'b']);
  const period = g.period['a'];
  g.cycleStart['a'] = getNow() - period / 2; // peak of the triangle
  const r = g._radiusAt('a', getNow());
  assert(Math.abs(r - g.getStateForPlayer('a').maxR) < 0.001, 'radius at peak == maxR');
  g.handleAction('a', { type: 'release' });
  eq(g.throws['a'][0].points, 5); // EDGE
});

uninstallClock();
report('BullseyeDrop');
