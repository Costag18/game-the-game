import { installClock, uninstallClock, fireNext, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { EchoChamber } from '../src/games/EchoChamber.js';

installClock();

function newGame(players) {
  const g = new EchoChamber(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// fire exactly ONE pending timer (advances the virtual clock to its deadline).
// Using fireNext (not advance()) keeps us from cascading through the whole
// show->input->reveal->show timer chain in a single step.
const advance = () => fireNext();

// advance past the current SHOW timer into INPUT
function intoInput(g) {
  assert(g.state === 'show', `expected show, got ${g.state}`);
  advance(); // fires the show timer only
}

// replay the correct sequence for a player (must be in 'input')
function solveCorrect(g, pid) {
  for (const pad of g.sequence) g.handleAction(pid, { type: 'tap', pad });
}

test('generator: sequence grows by exactly one valid pad index each round', () => {
  const g = newGame(['a', 'b']);
  eq(g.sequence.length, 1, 'round 1 has length 1');
  assert(g.sequence.every((s) => Number.isInteger(s) && s >= 0 && s < 4), 'all pads in 0..3');
  // drive both correct → advance to next show
  intoInput(g);
  solveCorrect(g, 'a'); solveCorrect(g, 'b');
  eq(g.state, 'reveal');
  advance(); // ack auto-advance → next show
  eq(g.state, 'show');
  eq(g.sequence.length, 2, 'sequence grew by one');
});

test('starts in show with the sequence visible; INPUT hides the sequence', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'show');
  const sShow = g.getStateForPlayer('a');
  assert(Array.isArray(sShow.sequence) && sShow.sequence.length === 1, 'sequence flashed in show');
  assert(sShow.showTiming && typeof sShow.showTiming.startMs === 'number', 'timing sent in show');
  intoInput(g);
  const sIn = g.getStateForPlayer('a');
  eq(sIn.sequence, null, 'sequence hidden during input');
  eq(sIn.showTiming, null, 'no timing during input');
});

test('ANTI-CHEAT: secret sequence not in getStateForPlayer JSON during input', () => {
  const g = newGame(['a', 'b']);
  intoInput(g);
  // make the sequence a recognizable marker would be ideal, but it's random;
  // assert structurally that neither player's serialized state contains a full
  // ordered copy of the secret during input.
  for (const pid of ['a', 'b']) {
    const json = JSON.stringify(g.getStateForPlayer(pid));
    assert(!json.includes('"sequence":['), `no sequence array leaked to ${pid}`);
    assert(!json.includes('"revealedSequence":['), `no revealedSequence leaked to ${pid}`);
  }
});

test('a correct tap is accepted; an incorrect tap eliminates the player', () => {
  const g = newGame(['a', 'b']);
  intoInput(g);
  const first = g.sequence[0];
  const wrong = (first + 1) % 4;
  // a taps correctly → progresses (and since length 1, completes)
  g.handleAction('a', { type: 'tap', pad: first });
  assert(g.doneThisRound.has('a'), 'a finished correctly');
  eq(g.depth['a'], 1, 'a depth advanced');
  assert(g.alive.has('a'), 'a still alive');
  // b taps wrong → eliminated at depth 0
  g.handleAction('b', { type: 'tap', pad: wrong });
  assert(!g.alive.has('b'), 'b eliminated');
  assert(g.failedThisRound.has('b'), 'b marked failed');
  eq(g.depth['b'], 0, 'b depth stays 0');
});

test('an illegal pad (out of range / non-int) is rejected, no progress', () => {
  const g = newGame(['a', 'b']);
  intoInput(g);
  g.handleAction('a', { type: 'tap', pad: 9 });
  g.handleAction('a', { type: 'tap', pad: -1 });
  g.handleAction('a', { type: 'tap', pad: 'x' });
  eq((g.progress['a'] || []).length, 0, 'no progress from illegal taps');
  assert(g.alive.has('a'), 'illegal tap does not eliminate');
});

test('show timer auto-advances to input and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const before = g.emitCount;
  intoInput(g);
  eq(g.state, 'input', 'auto-advanced to input');
  assert(g.emitCount > before, 'broadcast fired on show->input');
});

test('input timer auto-advances to reveal and broadcasts; non-finishers eliminated', () => {
  const g = newGame(['a', 'b']);
  intoInput(g);
  // neither taps → both should fail when the input timer fires
  const before = g.emitCount;
  advance();
  eq(g.state, 'reveal', 'input timer ended the round');
  assert(g.emitCount > before, 'broadcast fired on input->reveal');
  assert(!g.alive.has('a') && !g.alive.has('b'), 'idle players eliminated');
});

test('reveal exposes the sequence + results; input never did', () => {
  const g = newGame(['a', 'b']);
  intoInput(g);
  solveCorrect(g, 'a'); solveCorrect(g, 'b');
  eq(g.state, 'reveal');
  const s = g.getStateForPlayer('a');
  assert(Array.isArray(s.revealedSequence), 'sequence revealed at reveal');
  assert(Array.isArray(s.results), 'results present at reveal');
});

test('opponents expose only counts/alive — never entered taps', () => {
  const g = newGame(['a', 'b']);
  intoInput(g);
  g.handleAction('a', { type: 'tap', pad: g.sequence[0] }); // completes round (len 1)
  const opp = g.getStateForPlayer('b').opponents.find((o) => o.playerId === 'a');
  eq(Object.keys(opp).sort().join(','), 'alive,depth,doneThisRound,playerId,tapsEntered');
  assert(!('taps' in opp) && !('progress' in opp), 'no raw taps leaked');
});

test('finish order by depth: deeper survivor ranks first', () => {
  const g = newGame(['a', 'b']);
  // round 1: both solve → length 1
  intoInput(g);
  solveCorrect(g, 'a'); solveCorrect(g, 'b');
  advance(); // -> show round 2
  eq(g.sequence.length, 2);
  // round 2: a solves, b fails on first wrong tap
  intoInput(g);
  solveCorrect(g, 'a');
  const wrong = (g.sequence[0] + 1) % 4;
  g.handleAction('b', { type: 'tap', pad: wrong });
  eq(g.state, 'reveal');
  const res = g.getResults();
  eq(res.find((r) => r.playerId === 'a').placement, 1, 'deeper player first');
  eq(res.find((r) => r.playerId === 'b').placement, 2, 'shallower second');
  assert(res.find((r) => r.playerId === 'a').depth > res.find((r) => r.playerId === 'b').depth);
});

test('tie: equal depth shares placement 1', () => {
  const g = newGame(['a', 'b', 'c']);
  intoInput(g);
  solveCorrect(g, 'a'); solveCorrect(g, 'b'); solveCorrect(g, 'c');
  eq(g.state, 'reveal');
  const res = g.getResults();
  res.forEach((r) => eq(r.placement, 1, 'all tied at length 1'));
});

test('full game reaches finished; getResults ranks all N (N=2,3,4)', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 100) {
      if (g.state === 'show') { advance(); continue; }
      if (g.state === 'input') {
        // p0 always solves; everyone else mistaps → eliminated
        solveCorrect(g, 'p0');
        for (let i = 1; i < n; i++) {
          if (g.alive.has(`p${i}`)) {
            const wrong = (g.sequence[0] + 1) % 4;
            g.handleAction(`p${i}`, { type: 'tap', pad: wrong });
          }
        }
        continue;
      }
      if (g.state === 'reveal') { advance(); continue; }
    }
    eq(g.state, 'finished', `n=${n} reaches finished`);
    eq(g.isComplete(), true);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].placement, 1, 'placement 1 exists');
    eq(res[0].playerId, 'p0', 'survivor ranks first');
  }
});

test('reaching MAX_LENGTH ends the game with a winner', () => {
  const g = newGame(['a']);
  // only 1 player → after startGame the constructor path keeps it running; drive solves
  // (single-player still completes via the cap or via leaving; here we just verify cap end)
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'show') { advance(); continue; }
    if (g.state === 'input') { solveCorrect(g, 'a'); continue; }
    if (g.state === 'reveal') { advance(); continue; }
  }
  eq(g.state, 'finished');
  assert(g.sequence.length <= 15, 'never exceeds cap');
  eq(g.depth['a'], g.sequence.length, 'depth equals cap reached');
});

test('reveal auto-ack advances after 10s', () => {
  const g = newGame(['a', 'b']);
  intoInput(g);
  solveCorrect(g, 'a'); solveCorrect(g, 'b');
  eq(g.state, 'reveal');
  advance(10_000);
  assert(g.state === 'show' || g.state === 'finished', `advanced from reveal (got ${g.state})`);
});

test('removePlayer mid-input advances (no deadlock)', () => {
  const g = newGame(['a', 'b']);
  intoInput(g);
  // a solves, then the only remaining un-done player leaves → round resolves
  solveCorrect(g, 'a');
  g.removePlayer('b');
  assert(g.state === 'reveal' || g.state === 'show' || g.state === 'finished', `resolved (got ${g.state})`);
  assert(!g.getResults().some((r) => r.playerId === 'b'), 'leaver pruned from results');
});

test('leaving down to one finishes and clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  eq(pendingTimers(), 0);
});

test('destroy clears timers', () => {
  const g = newGame(['a', 'b']);
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('EchoChamber');
