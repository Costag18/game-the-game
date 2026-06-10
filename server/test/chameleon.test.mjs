import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { ChameleonClues } from '../src/games/ChameleonClues.js';

installClock();

function newGame(players) {
  const g = new ChameleonClues(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const nonChameleon = (g) => g.players.find((p) => p !== g.chameleon);

// ---- helpers to drive a full game to a chosen outcome ----
function readyAll(g) { for (const p of g.players) g.handleAction(p, { type: 'ready' }); }
function cluesAll(g) {
  let n = 0;
  for (const p of g.players) g.handleAction(p, { type: 'submitClue', clue: `clue${n++}` });
}

test('setup: exactly one chameleon, valid target, role card is private', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'reveal');
  assert(g.players.includes(g.chameleon), 'chameleon is a real player');
  assert(g.targetIndex >= 0 && g.targetIndex < 16, 'valid target index');
  assert(g.grid.length === 16, '16-word grid');
  assert(pendingTimers() >= 1, 'reveal timer armed');

  // chameleon's own view: knows it's the chameleon, NOT the word
  const cv = g.getStateForPlayer(g.chameleon);
  eq(cv.isChameleon, true);
  eq(cv.targetIndex, null);
  eq(cv.targetWord, null);
  // non-chameleon view: knows the word, knows it is NOT the chameleon
  const nv = g.getStateForPlayer(nonChameleon(g));
  eq(nv.isChameleon, false);
  eq(nv.targetIndex, g.targetIndex);
  eq(nv.targetWord, g.grid[g.targetIndex]);
});

test('ANTI-CHEAT: secret word never leaks to chameleon; chameleon id never leaks to crew (during play)', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const word = g.grid[g.targetIndex];
  // chameleon never receives the secret word in any pre-finished phase
  readyAll(g); // -> clues
  let s = JSON.stringify(g.getStateForPlayer(g.chameleon));
  assert(!s.includes(`"targetWord":"${word}"`), 'chameleon never sees the word (clues)');
  assert(s.includes('"targetWord":null'), 'chameleon targetWord null');

  cluesAll(g); // -> voting
  s = JSON.stringify(g.getStateForPlayer(g.chameleon));
  assert(!s.includes(`"targetWord":"${word}"`), 'chameleon never sees the word (voting)');

  // crew NEVER learns who the chameleon is before finished
  const crew = nonChameleon(g);
  const cs = JSON.stringify(g.getStateForPlayer(crew));
  assert(!cs.includes(`"chameleonId":"${g.chameleon}"`), 'chameleon id not in crew view');
  assert(cs.includes('"chameleonId":null'), 'chameleonId null pre-finish');
  assert(!cs.includes('"isChameleon":true'), 'crew is not told isChameleon true');
});

test('clues are private until the clue barrier, then public to all', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  eq(g.state, 'clues');
  g.handleAction('a', { type: 'submitClue', clue: 'apple' });
  // during clues, nobody (not even a) sees the public clue list
  eq(g.getStateForPlayer('b').clues, null);
  // a sees only their own clue echoed
  eq(g.getStateForPlayer('a').myClue, 'apple');
  // finish the barrier
  g.handleAction('b', { type: 'submitClue', clue: 'banana' });
  g.handleAction('c', { type: 'submitClue', clue: 'cherry' });
  eq(g.state, 'voting');
  const pub = g.getStateForPlayer('b').clues;
  assert(Array.isArray(pub) && pub.length === 3, 'clues public after barrier');
  assert(pub.some((c) => c.clue === 'apple'), 'a\'s clue now visible');
});

test('clue validation: rejects empty and multi-word', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  g.handleAction('a', { type: 'submitClue', clue: '   ' });
  eq(g.clues['a'], undefined);
  g.handleAction('a', { type: 'submitClue', clue: 'two words' });
  eq(g.clues['a'], undefined);
  g.handleAction('a', { type: 'submitClue', clue: '  Solo  ' });
  eq(g.clues['a'], 'Solo');
});

test('voting: cannot vote for yourself; one vote each', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g); cluesAll(g);
  eq(g.state, 'voting');
  g.handleAction('a', { type: 'castVote', targetId: 'a' }); // self -> rejected
  eq(g.votes['a'], undefined);
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('a', { type: 'castVote', targetId: 'c' }); // second vote ignored
  eq(g.votes['a'], 'b');
});

test('outcome: chameleon CAUGHT and guesses wrong -> crew each +500, chameleon 0', () => {
  // force chameleon = a
  const g = newGame(['a', 'b', 'c']);
  g.chameleon = 'a';
  readyAll(g); cluesAll(g);
  // everyone votes a (the chameleon) -> caught
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('b', { type: 'castVote', targetId: 'a' });
  g.handleAction('c', { type: 'castVote', targetId: 'a' });
  eq(g.state, 'chameleonGuess');
  eq(g.accused, 'a');
  // chameleon guesses a WRONG cell
  const wrong = (g.targetIndex + 1) % 16;
  g.handleAction('a', { type: 'guessCell', index: wrong });
  eq(g.state, 'finished');
  eq(g.outcome.caught, true);
  eq(g.outcome.guessedRight, false);
  eq(g.outcome.chameleonWon, false);
  eq(g.scores['a'], 0);
  eq(g.scores['b'], 500);
  eq(g.scores['c'], 500);
});

test('outcome: chameleon ESCAPES (tie vote) -> chameleon +1000', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  g.chameleon = 'a';
  readyAll(g); cluesAll(g);
  // 2 votes b, 2 votes c -> tie -> not caught (no self-votes)
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('c', { type: 'castVote', targetId: 'b' });
  g.handleAction('b', { type: 'castVote', targetId: 'c' });
  g.handleAction('d', { type: 'castVote', targetId: 'c' });
  eq(g.state, 'chameleonGuess');
  eq(g.accused, null); // tie -> no single accused
  // chameleon guesses wrong but still wins because not caught
  g.handleAction('a', { type: 'guessCell', index: (g.targetIndex + 3) % 16 });
  eq(g.state, 'finished');
  eq(g.outcome.chameleonWon, true);
  eq(g.scores['a'], 1000);
  eq(g.scores['b'], 0);
});

test('outcome: chameleon CAUGHT but guesses RIGHT -> chameleon +1000', () => {
  const g = newGame(['a', 'b', 'c']);
  g.chameleon = 'a';
  readyAll(g); cluesAll(g);
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('b', { type: 'castVote', targetId: 'a' });
  g.handleAction('c', { type: 'castVote', targetId: 'a' });
  eq(g.state, 'chameleonGuess');
  eq(g.accused, 'a');
  g.handleAction('a', { type: 'guessCell', index: g.targetIndex }); // correct!
  eq(g.state, 'finished');
  eq(g.outcome.caught, true);
  eq(g.outcome.guessedRight, true);
  eq(g.outcome.chameleonWon, true);
  eq(g.scores['a'], 1000);
  eq(g.scores['b'], 0);
});

test('finished view discloses everything (chameleon id, word, guess, outcome)', () => {
  const g = newGame(['a', 'b', 'c']);
  g.chameleon = 'a';
  readyAll(g); cluesAll(g);
  g.handleAction('b', { type: 'castVote', targetId: 'a' });
  g.handleAction('c', { type: 'castVote', targetId: 'a' });
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.handleAction('a', { type: 'guessCell', index: (g.targetIndex + 1) % 16 });
  eq(g.state, 'finished');
  const v = g.getStateForPlayer('b');
  eq(v.chameleonId, 'a');
  eq(v.accused, 'a');
  eq(v.targetIndex, g.targetIndex);     // now revealed to everyone
  assert(v.outcome && v.outcome.chameleonWon === false, 'outcome present');
});

test('barriers advance on TIMEOUT with a broadcast (reveal/clues/voting/guess)', () => {
  const g = newGame(['a', 'b', 'c']);
  let before = g.emitCount;
  advance(25_000); // reveal timeout -> clues
  eq(g.state, 'clues');
  assert(g.emitCount > before, 'broadcast on reveal timeout');

  before = g.emitCount;
  advance(45_000); // clues timeout -> voting (missing -> '...')
  eq(g.state, 'voting');
  assert(g.players.every((p) => g.clues[p] !== undefined), 'missing clues auto-filled');

  before = g.emitCount;
  advance(40_000); // voting timeout -> chameleonGuess
  eq(g.state, 'chameleonGuess');
  assert(g.emitCount > before, 'broadcast on voting timeout');

  before = g.emitCount;
  advance(20_000); // guess timeout -> finished
  eq(g.state, 'finished');
  assert(g.emitCount > before, 'broadcast on guess timeout');
  assert(g.outcome, 'outcome computed on timeout');
});

test('full game reaches finished; results rank all N with placement 1 first (N=3,4,5)', () => {
  for (const N of [3, 4, 5]) {
    const players = Array.from({ length: N }, (_, i) => `p${i}`);
    const g = newGame(players);
    g.chameleon = 'p0';
    readyAll(g);
    cluesAll(g);
    // everyone votes p0 -> caught; chameleon guesses wrong -> crew wins +500
    for (const p of g.players) {
      if (p === 'p0') g.handleAction(p, { type: 'castVote', targetId: 'p1' });
      else g.handleAction(p, { type: 'castVote', targetId: 'p0' });
    }
    eq(g.state, 'chameleonGuess');
    g.handleAction('p0', { type: 'guessCell', index: (g.targetIndex + 1) % 16 });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // crew all tied at 500, chameleon last
    assert(res.every((r) => r.placement >= 1), 'placements assigned');
    const cham = res.find((r) => r.wasChameleon);
    eq(cham.score, 0);
  }
});

test('removePlayer mid-clues advances barrier; no deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  g.chameleon = 'a'; // ensure leaver below is NOT the chameleon
  readyAll(g);
  g.handleAction('a', { type: 'submitClue', clue: 'apple' });
  g.handleAction('b', { type: 'submitClue', clue: 'banana' });
  g.removePlayer('c'); // c was the last owed
  eq(g.state, 'voting');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-voting advances barrier; vote FOR leaver dropped', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  g.chameleon = 'a';
  readyAll(g); cluesAll(g);
  eq(g.state, 'voting');
  g.handleAction('b', { type: 'castVote', targetId: 'c' }); // b voted for c
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  g.removePlayer('c'); // c leaves mid-vote; b's vote for c must be dropped
  assert(g.votes['b'] === undefined, 'b\'s vote for the leaver was dropped');
  // remaining owed: b (vote dropped) + d
  g.handleAction('b', { type: 'castVote', targetId: 'd' });
  g.handleAction('d', { type: 'castVote', targetId: 'b' });
  eq(g.state, 'chameleonGuess');
});

test('special role (chameleon) leaving ends the round sensibly; no deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  g.chameleon = 'a';
  readyAll(g); cluesAll(g);
  eq(g.state, 'voting');
  g.removePlayer('a'); // the chameleon bails
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'leaver pruned from results');
  // crew not scored against an absent chameleon
  assert(g.getResults().every((r) => r.placement >= 1), 'results valid');
});

test('chameleon leaving exactly at chameleonGuess entry resolves to finished', () => {
  const g = newGame(['a', 'b', 'c']);
  g.chameleon = 'a';
  readyAll(g); cluesAll(g);
  g.handleAction('b', { type: 'castVote', targetId: 'c' });
  g.handleAction('c', { type: 'castVote', targetId: 'b' });
  g.handleAction('a', { type: 'castVote', targetId: 'b' });
  eq(g.state, 'chameleonGuess');
  g.removePlayer('a'); // chameleon leaves before guessing
  eq(g.state, 'finished');
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
report('ChameleonClues');
