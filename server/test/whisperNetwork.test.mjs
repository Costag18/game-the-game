import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { WhisperNetwork } from '../src/games/WhisperNetwork.js';

installClock();

function newGame(players) {
  const g = new WhisperNetwork(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

// drive the reveal->round transition by readying everyone
function readyAll(g) { for (const p of g.players) g.handleAction(p, { type: 'ready' }); }
// submit a push for everyone (default 0)
function pushAll(g, fn = () => 0) { for (const p of g.players) g.handleAction(p, { type: 'submitPush', push: fn(p) }); }
// submit guesses; mapper(p) -> { other: 'RED'|'BLUE' }
function guessAll(g, mapper) {
  for (const p of g.players) g.handleAction(p, { type: 'submitGuesses', guesses: mapper(p) });
}
function correctGuessMap(g, p) {
  const m = {};
  for (const o of g.players) if (o !== p) m[o] = g.factions[o];
  return m;
}

// ---- setup / role assignment ----
test('starts in reveal with even-ish factions and a reveal timer', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  eq(g.state, 'reveal');
  const reds = g.players.filter((p) => g.factions[p] === 'RED').length;
  const blues = g.players.filter((p) => g.factions[p] === 'BLUE').length;
  eq(reds + blues, 4);
  assert(Math.abs(reds - blues) <= 1, 'factions split as evenly as possible');
  assert(reds >= 1 && blues >= 1, 'both factions populated');
  assert(g.meter === 0, 'meter starts at 0');
  assert(pendingTimers() >= 1, 'reveal timer armed');
});

test('5 players split 3/2 (even-ish)', () => {
  const g = newGame(['a', 'b', 'c', 'd', 'e']);
  const reds = g.players.filter((p) => g.factions[p] === 'RED').length;
  const blues = g.players.filter((p) => g.factions[p] === 'BLUE').length;
  assert(Math.abs(reds - blues) === 1, '5 players -> 3/2');
  assert(reds + blues === 5, 'all assigned');
});

// ---- HIDDEN INFO: own faction only, never others', meter only mid-game ----
test('getStateForPlayer leaks only my own faction, never others, never pushes', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  eq(g.state, 'round');
  // everyone pushes secretly
  pushAll(g, (p) => (g.factions[p] === 'RED' ? 2 : -1));
  // round resolved -> meter moved, but no individual pushes exposed
  // re-enter a fresh round view (we are now in round 2)
  const sa = g.getStateForPlayer('a');
  const sStr = JSON.stringify(sa);
  // my faction present
  eq(sa.myFaction, g.factions['a']);
  // no OTHER player's faction in the payload
  for (const o of g.players) {
    if (o === 'a') continue;
    assert(!sStr.includes(`"${o}":"RED"`) && !sStr.includes(`"${o}":"BLUE"`), `faction of ${o} not leaked`);
  }
  // factions map only appears at finished
  assert(sa.reveal === null, 'no full reveal mid-game');
});

test('a push submitted by one player is never visible to another player', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  g.handleAction('a', { type: 'submitPush', push: 2 });
  const sb = g.getStateForPlayer('b');
  // b sees only their own push (null, hasn't pushed) + an aggregate count
  eq(sb.myPush, null);
  eq(sb.hasPushed, false);
  eq(sb.pushedCount, 1);
  // a's actual push value (2) must not be exposed to b beyond the count
  const sbStr = JSON.stringify(sb);
  assert(!sbStr.includes('"a":2'), 'a\'s individual push not leaked to b');
});

test('round reveals only the cumulative meter, not individual pushes', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  pushAll(g, (p) => (g.factions[p] === 'RED' ? 2 : 2)); // everyone +2 -> meter +8
  eq(g.meter, 8);
  const s = g.getStateForPlayer('a');
  eq(s.meter, 8);
});

// ---- accusation privacy ----
test('accusation guesses stay private until finished', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  // 5 rounds of all-zero pushes -> reach accusation
  for (let r = 0; r < 5; r++) pushAll(g, () => 0);
  eq(g.state, 'accusation');
  g.handleAction('a', { type: 'submitGuesses', guesses: { b: 'RED', c: 'BLUE' } });
  const sb = g.getStateForPlayer('b');
  // b cannot see a's guesses
  assert(Object.keys(sb.myGuesses).length === 0, 'b only sees own guesses');
  const sbStr = JSON.stringify(sb);
  assert(sb.reveal === null, 'no reveal during accusation');
  // a's guess about b should not be in b's payload
  assert(!sbStr.includes('"b":"RED"'), 'a\'s guess about b not leaked to b');
});

// ---- scoring: faction win ----
test('faction outcome: meter>0 gives each RED +500', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  // round 1: all RED push +2, all BLUE push 0 -> meter ends positive
  for (let r = 0; r < 5; r++) pushAll(g, (p) => (g.factions[p] === 'RED' ? 2 : 0));
  eq(g.state, 'accusation');
  assert(g.meter > 0, 'meter positive');
  // nobody guesses correctly (all submit empty) to isolate faction points
  guessAll(g, () => ({}));
  eq(g.state, 'finished');
  for (const p of g.players) {
    if (g.factions[p] === 'RED') eq(g.scores[p], 500, 'red +500');
    else eq(g.scores[p], 0, 'blue +0');
  }
});

test('faction outcome: meter<0 gives each BLUE +500', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  for (let r = 0; r < 5; r++) pushAll(g, (p) => (g.factions[p] === 'BLUE' ? -2 : 0));
  guessAll(g, () => ({}));
  eq(g.state, 'finished');
  assert(g.meter < 0, 'meter negative');
  for (const p of g.players) {
    if (g.factions[p] === 'BLUE') eq(g.scores[p], 500, 'blue +500');
    else eq(g.scores[p], 0, 'red +0');
  }
});

test('faction outcome: meter===0 awards nobody faction points', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  for (let r = 0; r < 5; r++) pushAll(g, () => 0); // meter stays 0
  eq(g.meter, 0);
  guessAll(g, () => ({}));
  eq(g.state, 'finished');
  for (const p of g.players) eq(g.scores[p], 0, 'nobody gets faction pts on tie');
});

// ---- scoring: detective bonus ----
test('detective bonus: +100 per correct faction guess about others', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  for (let r = 0; r < 5; r++) pushAll(g, () => 0); // tie -> no faction pts, isolate detective
  // everyone guesses everyone correctly: each player guesses N-1=3 others
  guessAll(g, (p) => correctGuessMap(g, p));
  eq(g.state, 'finished');
  for (const p of g.players) eq(g.scores[p], 300, 'each correctly guessed 3 others -> +300');
  // and the awards detail matches
  for (const p of g.players) eq(g.outcome.awards[p].correctGuesses, 3);
});

test('wrong/missing guesses earn nothing; reveal discloses all factions', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  for (let r = 0; r < 5; r++) pushAll(g, () => 0);
  // a guesses everyone WRONG (flip faction); b and c submit nothing -> timeout
  const flip = (f) => (f === 'RED' ? 'BLUE' : 'RED');
  g.handleAction('a', { type: 'submitGuesses', guesses: Object.fromEntries(g.players.filter((x) => x !== 'a').map((o) => [o, flip(g.factions[o])])) });
  advance(40_000); // accusation timeout -> b, c contribute no correct guesses
  eq(g.state, 'finished');
  eq(g.scores['a'], 0, 'all wrong -> 0 detective');
  // full reveal exposes every faction now
  const s = g.getStateForPlayer('b');
  assert(s.reveal, 'reveal present at finished');
  for (const p of g.players) eq(s.reveal.factions[p], g.factions[p], 'all factions disclosed');
});

// ---- barriers: advance on all-act AND on timeout ----
test('reveal barrier advances when all ready', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  eq(g.state, 'round');
});

test('reveal barrier advances on timeout (broadcasts)', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(20_000);
  eq(g.state, 'round');
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('round barrier advances on timeout, missing pushes count as 0', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  g.handleAction('a', { type: 'submitPush', push: 2 });
  const before = g.emitCount;
  advance(25_000); // b, c default to 0
  eq(g.meter, 2);
  assert(g.state === 'round', 'advanced to next round');
  eq(g.roundIndex, 1);
  assert(g.emitCount > before, 'broadcast on round timeout');
});

test('accusation barrier advances on timeout to finished', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  for (let r = 0; r < 5; r++) pushAll(g, () => 0);
  eq(g.state, 'accusation');
  const before = g.emitCount;
  advance(40_000);
  eq(g.state, 'finished');
  assert(g.emitCount > before, 'broadcast on accusation timeout');
});

test('invalid push values are rejected', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  g.handleAction('a', { type: 'submitPush', push: 5 });   // out of range
  eq(g.pushes['a'], undefined);
  g.handleAction('a', { type: 'submitPush', push: 1.5 }); // non-integer in set
  eq(g.pushes['a'], undefined);
  g.handleAction('a', { type: 'submitPush', push: -2 });  // valid
  eq(g.pushes['a'], -2);
  g.handleAction('a', { type: 'submitPush', push: 2 });   // already pushed -> ignored
  eq(g.pushes['a'], -2);
});

// ---- full game reaches finished for N in [3,4,5], placement 1 first ----
for (const N of [3, 4, 5]) {
  test(`full ${N}-player game finishes; results length ${N}, placement 1 first`, () => {
    const ids = ['a', 'b', 'c', 'd', 'e'].slice(0, N);
    const g = newGame(ids);
    readyAll(g);
    // make RED win so there is a clear top placement; RED pushes +2, BLUE pushes 0
    for (let r = 0; r < 5; r++) pushAll(g, (p) => (g.factions[p] === 'RED' ? 2 : 0));
    // everyone guesses everyone correctly
    guessAll(g, (p) => correctGuessMap(g, p));
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, N);
    // placements are non-decreasing
    for (let i = 1; i < res.length; i++) assert(res[i].placement >= res[i - 1].placement, 'placements non-decreasing');
  });
}

test('whole faction tie shares placement', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  // tie meter, nobody guesses -> all scores 0 -> all placement 1
  for (let r = 0; r < 5; r++) pushAll(g, () => 0);
  guessAll(g, () => ({}));
  const res = g.getResults();
  eq(res.length, 4);
  assert(res.every((r) => r.placement === 1), 'all tied at placement 1');
});

// ---- leave handling: no deadlock, incl. mid-phase + special outcome ----
test('leave during reveal completes the ready barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'ready' });
  g.handleAction('b', { type: 'ready' });
  g.removePlayer('c'); // c never readied, was the last owed
  eq(g.state, 'round');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('leave during round completes the push barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  g.handleAction('a', { type: 'submitPush', push: 1 });
  g.handleAction('b', { type: 'submitPush', push: 1 });
  g.removePlayer('c'); // c was the last owed -> barrier completes
  eq(g.meter, 2);
  assert(g.state === 'round', 'advanced past round 1');
  eq(g.roundIndex, 1);
});

test('leave during accusation completes the guess barrier', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  for (let r = 0; r < 5; r++) pushAll(g, () => 0);
  eq(g.state, 'accusation');
  g.handleAction('a', { type: 'submitGuesses', guesses: correctGuessMap(g, 'a') });
  g.handleAction('b', { type: 'submitGuesses', guesses: correctGuessMap(g, 'b') });
  g.handleAction('c', { type: 'submitGuesses', guesses: correctGuessMap(g, 'c') });
  g.removePlayer('d'); // d was the last owed
  eq(g.state, 'finished');
  assert(!g.getResults().some((r) => r.playerId === 'd'), 'leaver pruned from results');
  for (const r of g.getResults()) assert(g.players.includes(r.playerId), 'results only present players');
});

test('collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('results never include or reference a leaver faction', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  readyAll(g);
  g.removePlayer('c');
  for (let r = 0; r < 5; r++) pushAll(g, () => 0);
  guessAll(g, () => ({}));
  eq(g.state, 'finished');
  const res = g.getResults();
  assert(!res.some((r) => r.playerId === 'c'), 'c not in results');
  // a finished reveal payload should not list c's faction
  const s = g.getStateForPlayer('a');
  assert(!('c' in s.reveal.factions), 'leaver faction not disclosed');
});

uninstallClock();
report('WhisperNetwork');
