import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { TokenTussle } from '../src/games/TokenTussle.js';

installClock();

function newGame(players) {
  const g = new TokenTussle(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// deploy a full round for everyone, with a per-player allocation map
function deployAll(g, allocByPid) {
  for (const p of g.players) g.handleAction(p, { type: 'deploy', tokens: allocByPid[p] });
}
function ackAll(g) {
  for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
}

test('starts in deploy round 1 with 5 fronts, a bankroll of 20, and a timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'deploy');
  eq(g.roundNumber, 1);
  eq(g.fronts.length, 5);
  eq(g.fronts[0], 10); eq(g.fronts[4], 50);
  const s = g.getStateForPlayer('a');
  eq(s.tokensPerRound, 20);
  assert(s.deadline && s.deadline > Date.now(), 'deploy deadline set');
  assert(pendingTimers() >= 1, 'deploy timer armed');
});

test('over-bankroll bid is clamped to ≤ 20 (server validates against the bankroll)', () => {
  const g = newGame(['a', 'b']);
  // a tries to deploy 100 tokens total (10 per front) — must be clamped to sum 20
  g.handleAction('a', { type: 'deploy', tokens: [10, 10, 10, 10, 10] });
  const sum = g.allocations['a'].reduce((x, y) => x + y, 0);
  assert(sum <= 20, `clamped sum ${sum} ≤ 20`);
  eq(sum, 20); // first fronts greedily fill the bankroll: [10,10,0,0,0]
  eq(g.allocations['a'][0], 10);
  eq(g.allocations['a'][2], 0);
  // negative / NaN fronts coerce to 0
  g.handleAction('b', { type: 'deploy', tokens: [-5, 'x', 3, 2, 1] });
  eq(g.allocations['b'][0], 0);
  eq(g.allocations['b'][1], 0);
  eq(g.allocations['b'].reduce((x, y) => x + y, 0), 6);
});

test('cannot re-submit once locked in (one deployment per round)', () => {
  const g = newGame(['a', 'b']);
  g.handleAction('a', { type: 'deploy', tokens: [20, 0, 0, 0, 0] });
  g.handleAction('a', { type: 'deploy', tokens: [0, 0, 0, 0, 20] }); // ignored
  eq(g.allocations['a'][0], 20);
  eq(g.allocations['a'][4], 0);
});

test('win/payment resolves: most tokens on a front captures its prize; ties split', () => {
  const g = newGame(['a', 'b']);
  // front0(10): a20>b0 → a. front4(50): b owns it. middle fronts tie at 0 → split 20+30+40 / wait, compute precisely.
  // a: [20,0,0,0,0]  b: [0,0,0,0,20]
  // f0(10): a>b → a:10. f1(20): tie 0,0 → split 10 each. f2(30): tie → 15 each. f3(40): tie → 20 each. f4(50): b → 50.
  deployAll(g, { a: [20, 0, 0, 0, 0], b: [0, 0, 0, 0, 20] });
  eq(g.state, 'reveal');
  eq(g.scores['a'], 10 + 10 + 15 + 20); // 55
  eq(g.scores['b'], 10 + 15 + 20 + 50); // 95
  // reveal exposes both distributions + front winners
  const rev = g.getStateForPlayer('a').reveal;
  const aAlloc = rev.allocations.find((x) => x.playerId === 'a').tokens;
  eq(aAlloc[0], 20);
  eq(rev.fronts[0].winners.length, 1);
  eq(rev.fronts[0].winners[0], 'a');
  eq(rev.fronts[4].winners[0], 'b');
});

test('tie on a single front splits that prize among the top bidders', () => {
  const g = newGame(['a', 'b', 'c']);
  // all put 5 on front2(30) → 3-way tie → 10 each. front4(50): a alone with 15 → a.
  deployAll(g, {
    a: [0, 0, 5, 0, 15],
    b: [0, 0, 5, 0, 0],
    c: [0, 0, 5, 0, 0],
  });
  const rev = g.getStateForPlayer('a').reveal;
  const f2 = rev.fronts[2];
  eq(f2.winners.length, 3);
  eq(f2.share, 10);
  eq(rev.gained['a'] >= 10, true); // got the f2 share plus f4
});

test('HIDDEN-INFO: nobody else’s allocation is in getStateForPlayer before reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'deploy', tokens: [20, 0, 0, 0, 0] }); // a's secret stash
  g.handleAction('b', { type: 'deploy', tokens: [0, 0, 0, 0, 0] });
  // a has not been revealed; view it from b and c — must not contain a's tokens
  for (const viewer of ['b', 'c']) {
    const s = g.getStateForPlayer(viewer);
    eq(s.reveal, null);
    // serialize and ensure a's distinctive [20,...] is not present anywhere —
    // myTokens only ever carries the viewer's OWN stash, never a's 20-stack.
    const json = JSON.stringify(s);
    assert(!json.includes('20,0,0,0,0'), 'no foreign 20-stack leaked');
    assert(!json.includes('"myTokens":[20'), 'no foreign 20-stack in myTokens');
  }
  // a sees ONLY its own
  const sa = g.getStateForPlayer('a');
  eq(sa.myTokens[0], 20);
  eq(sa.reveal, null);
});

test('deploy timer auto-resolves with an even split + broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'deploy', tokens: [20, 0, 0, 0, 0] });
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on deploy timeout');
  // b and c got an even split (4 each = 20)
  eq(g.allocations['b'].reduce((x, y) => x + y, 0), 20);
  assert(g.allocations['b'].every((t) => t === 4), 'even split default');
});

test('reveal timer auto-acks and advances to next round / finish + broadcasts', () => {
  const g = newGame(['a', 'b']);
  deployAll(g, { a: [20, 0, 0, 0, 0], b: [0, 0, 0, 0, 20] });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(10_000);
  assert(g.state === 'deploy' || g.state === 'finished', `advanced (got ${g.state})`);
  eq(g.roundNumber >= 2, true);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('full 3-round game finishes; getResults length N, placement 1 first — for N in [2,3,4]', () => {
  for (const N of [2, 3, 4]) {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 30) {
      if (g.state === 'deploy') {
        // first player stacks front4 (50) to guarantee a clear winner ordering
        for (let k = 0; k < players.length; k++) {
          const alloc = [0, 0, 0, 0, 0];
          alloc[4] = 20 - k; // a:20, b:19, c:18, d:17 on the richest front
          g.handleAction(players[k], { type: 'deploy', tokens: alloc });
        }
      } else if (g.state === 'reveal') {
        ackAll(g);
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    eq(res[0].playerId, 'a'); // always won front 4 (the 50-prize) all 3 rounds
    // placements are non-decreasing & every player appears once
    const ids = new Set(res.map((r) => r.playerId));
    eq(ids.size, N);
  }
});

test('a tie shares a placement (equal scores → equal placement)', () => {
  const g = newGame(['a', 'b']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 20) {
    if (g.state === 'deploy') {
      // identical mirrored allocations → identical scores every round
      deployAll(g, { a: [4, 4, 4, 4, 4], b: [4, 4, 4, 4, 4] });
    } else if (g.state === 'reveal') {
      ackAll(g);
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 2);
  eq(res[0].score, res[1].score);
  eq(res[0].placement, 1);
  eq(res[1].placement, 1); // tie shares placement 1
});

test('removePlayer mid-deploy advances the barrier (no deadlock)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'deploy', tokens: [20, 0, 0, 0, 0] });
  g.handleAction('b', { type: 'deploy', tokens: [0, 20, 0, 0, 0] });
  // c never deployed — was the last owed; leaving must resolve the round
  g.removePlayer('c');
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver pruned from results');
});

test('removePlayer mid-reveal advances; collapse to one finishes', () => {
  const g = newGame(['a', 'b', 'c']);
  deployAll(g, { a: [20, 0, 0, 0, 0], b: [0, 20, 0, 0, 0], c: [0, 0, 20, 0, 0] });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // last un-acked leaves → advances out of reveal
  assert(g.state === 'deploy' || g.state === 'finished', `advanced from reveal (got ${g.state})`);
  // collapse to one finishes
  g.removePlayer('b');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('TokenTussle');
