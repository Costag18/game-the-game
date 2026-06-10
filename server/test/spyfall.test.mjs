import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Spyfall } from '../src/games/Spyfall.js';

installClock();

function newGame(players) {
  const g = new Spyfall(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const nonSpies = (g) => g.players.filter((p) => p !== g.spyId);

// Drive reveal -> voting by readying everyone present.
function readyAll(g) { for (const p of g.players) g.handleAction(p, { type: 'ready' }); }

test('startGame assigns exactly one spy; every non-spy has a distinct location role', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  eq(g.state, 'reveal');
  assert(g.players.includes(g.spyId), 'spy is a real player');
  const others = nonSpies(g);
  eq(others.length, 3);
  for (const p of others) assert(typeof g.roles[p] === 'string' && g.roles[p].length, `${p} has a role`);
  eq(g.roles[g.spyId], undefined); // spy has NO role
  assert(g.location && typeof g.location === 'string', 'a secret location was chosen');
});

test('ANTI-CHEAT: spy never receives the location; non-spy never sees the spy id (during play)', () => {
  // distinct multi-char ids so substring scans aren't fooled by single letters in words
  const g = newGame(['pid_zz1', 'pid_zz2', 'pid_zz3', 'pid_zz4', 'pid_zz5']);
  const spy = g.spyId;
  const other = nonSpies(g)[0];

  // spy's payload: location is null + role null. The real location name DOES appear
  // once inside the public locationOptions list (standard Spyfall — the spy sees all
  // location names as guess options) but is NOT singled out as the secret anywhere.
  const spyView = g.getStateForPlayer(spy);
  eq(spyView.isSpy, true);
  eq(spyView.location, null);
  eq(spyView.myRole, null);
  // strip the public options, then assert the secret location is nowhere else
  const spyWithoutOptions = { ...spyView, locationOptions: undefined };
  assert(!JSON.stringify(spyWithoutOptions).toLowerCase().includes(g.location.toLowerCase()), 'secret location not singled out for spy');

  // non-spy payload: has the location + own role. The spy's id appears ONLY as a
  // normal roster member (everyone knows who is playing); it must NEVER be flagged
  // as the spy. There is no spyId field, no isSpy:true for anyone else, no roles map.
  const ov = g.getStateForPlayer(other);
  eq(ov.isSpy, false);
  eq(ov.location, g.location);
  eq(ov.myRole, g.roles[other]);
  assert(!('spyId' in ov), 'no spyId field exposed to a non-spy');
  assert(!('roles' in ov), 'roles map not exposed to a non-spy');
  // the spy id may only appear inside the public roster / score keys — nowhere that identifies it as the spy
  eq(ov.players.includes(spy), true); // present as a normal roster member
  // removing roster + score keys, the spy id must not surface anywhere else
  const ovScrubbed = { ...ov, players: undefined, scores: undefined };
  assert(!JSON.stringify(ovScrubbed).includes(spy), 'spy not identifiable outside the public roster');
  // location list IS public to everyone (standard Spyfall)
  assert(Array.isArray(spyView.locationOptions) && spyView.locationOptions.length >= 12, 'public location list present for spy');
  assert(ov.locationOptions.includes(g.location), 'real location hidden among the public options');
});

test('reveal: all Ready advances to voting; ANTI-CHEAT holds through voting', () => {
  const g = newGame(['pid_zz1', 'pid_zz2', 'pid_zz3']);
  readyAll(g);
  eq(g.state, 'voting');
  const spyView = g.getStateForPlayer(g.spyId);
  const spyWithoutOptions = { ...spyView, locationOptions: undefined };
  assert(!JSON.stringify(spyWithoutOptions).toLowerCase().includes(g.location.toLowerCase()), 'secret location still hidden from spy in voting');
  const ov = g.getStateForPlayer(nonSpies(g)[0]);
  const ovScrubbed = { ...ov, players: undefined, scores: undefined };
  assert(!JSON.stringify(ovScrubbed).includes(g.spyId), 'spy not identifiable outside the public roster in voting');
});

test('reveal timeout (30s) auto-advances to voting and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(30_000);
  eq(g.state, 'voting');
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('voting: cannot vote for yourself; only my own vote crosses the wire', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  g.handleAction('a', { type: 'castVote', suspectId: 'a' }); // self → rejected
  eq(g.votes['a'], undefined);
  g.handleAction('a', { type: 'castVote', suspectId: 'b' });
  eq(g.votes['a'], 'b');
  const aView = g.getStateForPlayer('a');
  eq(aView.myVote, 'b');
  // b should not learn a's vote
  const bView = g.getStateForPlayer('b');
  eq(bView.myVote, null);
  assert(!('votes' in bView), 'raw votes map not exposed mid-vote');
});

test('all voted advances to spyGuess (spy present); voting timeout abstains and still advances', () => {
  const g = newGame(['a', 'b', 'c']);
  readyAll(g);
  for (const p of g.players) {
    // everyone votes someone who is not themselves
    const target = g.players.find((q) => q !== p);
    g.handleAction(p, { type: 'castVote', suspectId: target });
  }
  eq(g.state, 'spyGuess');

  const g2 = newGame(['a', 'b', 'c']);
  readyAll(g2);
  advance(90_000); // nobody voted
  eq(g2.state, 'spyGuess');
});

test('SCORING — spy ESCAPES (not caught): spy wins +1000 even on a wrong guess', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const spy = g.spyId;
  readyAll(g);
  // everyone votes a non-spy → spy not accused
  const scapegoat = nonSpies(g)[0];
  for (const p of g.players) {
    const target = p === scapegoat ? nonSpies(g).find((q) => q !== scapegoat) : scapegoat;
    g.handleAction(p, { type: 'castVote', suspectId: target });
  }
  eq(g.state, 'spyGuess');
  eq(g.spyCaught, false);
  // spy guesses wrong on purpose
  const wrong = g.locationOptions.find((l) => l.toLowerCase() !== g.location.toLowerCase());
  g.handleAction(spy, { type: 'guessLocation', location: wrong });
  eq(g.state, 'finished');
  eq(g.spyWins, true);
  eq(g.scores[spy], 1000);
  for (const p of nonSpies(g)) eq(g.scores[p], 0);
});

test('SCORING — spy CAUGHT and guesses WRONG: group wins, each non-spy +500', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const spy = g.spyId;
  readyAll(g);
  // everyone votes the spy → accused === spy
  for (const p of g.players) {
    const target = p === spy ? nonSpies(g)[0] : spy;
    g.handleAction(p, { type: 'castVote', suspectId: target });
  }
  eq(g.state, 'spyGuess');
  eq(g.spyCaught, true);
  const wrong = g.locationOptions.find((l) => l.toLowerCase() !== g.location.toLowerCase());
  g.handleAction(spy, { type: 'guessLocation', location: wrong });
  eq(g.state, 'finished');
  eq(g.spyWins, false);
  eq(g.scores[spy], 0);
  for (const p of nonSpies(g)) eq(g.scores[p], 500);
});

test('SCORING — spy CAUGHT but guesses RIGHT: spy steals the win +1000', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const spy = g.spyId;
  readyAll(g);
  for (const p of g.players) {
    const target = p === spy ? nonSpies(g)[0] : spy;
    g.handleAction(p, { type: 'castVote', suspectId: target });
  }
  eq(g.spyCaught, true);
  g.handleAction(spy, { type: 'guessLocation', location: g.location });
  eq(g.state, 'finished');
  eq(g.spyGuessedRight, true);
  eq(g.spyWins, true);
  eq(g.scores[spy], 1000);
  for (const p of nonSpies(g)) eq(g.scores[p], 0);
});

test('ANTI-CHEAT: at finished EVERYTHING is disclosed', () => {
  const g = newGame(['a', 'b', 'c']);
  const spy = g.spyId;
  const loc = g.location;
  readyAll(g);
  for (const p of g.players) g.handleAction(p, { type: 'castVote', suspectId: p === spy ? nonSpies(g)[0] : spy });
  g.handleAction(spy, { type: 'guessLocation', location: g.locationOptions.find((l) => l.toLowerCase() !== loc.toLowerCase()) });
  eq(g.state, 'finished');
  const v = g.getStateForPlayer(nonSpies(g)[0]);
  assert(v.outcome, 'outcome present at finished');
  eq(v.outcome.location, loc);
  eq(v.outcome.spyId, spy);
  assert(JSON.stringify(v.outcome).includes(loc), 'location revealed at finish');
});

test('spy guess timeout (25s) = no guess = wrong; resolves to finished', () => {
  const g = newGame(['a', 'b', 'c']);
  const spy = g.spyId;
  readyAll(g);
  for (const p of g.players) g.handleAction(p, { type: 'castVote', suspectId: p === spy ? nonSpies(g)[0] : spy });
  eq(g.state, 'spyGuess');
  const before = g.emitCount;
  advance(25_000);
  eq(g.state, 'finished');
  eq(g.spyGuessedRight, false);
  assert(g.emitCount > before, 'broadcast on guess timeout');
});

for (const n of [3, 4, 5]) {
  test(`full game with N=${n} reaches finished; getResults ranks all N, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd', 'e'].slice(0, n);
    const g = newGame(players);
    const spy = g.spyId;
    readyAll(g);
    // catch the spy so the group scores (clear winners/losers split)
    for (const p of g.players) g.handleAction(p, { type: 'castVote', suspectId: p === spy ? nonSpies(g)[0] : spy });
    g.handleAction(spy, { type: 'guessLocation', location: g.locationOptions.find((l) => l.toLowerCase() !== g.location.toLowerCase()) });
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
    // every player appears exactly once
    eq(new Set(res.map((r) => r.playerId)).size, n);
    // group won → all non-spies tie at placement 1
    const winners = res.filter((r) => r.placement === 1);
    eq(winners.length, n - 1);
    eq(res.every((r) => r.placement >= 1), true);
  });
}

test('removePlayer mid-reveal (non-spy) advances barrier, no deadlock', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const others = nonSpies(g);
  // everyone readies except one non-spy, who then leaves → barrier completes
  for (const p of g.players) if (p !== others[0]) g.handleAction(p, { type: 'ready' });
  eq(g.state, 'reveal');
  g.removePlayer(others[0]);
  eq(g.state, 'voting');
  assert(!g.getResults().some((r) => r.playerId === others[0]), 'leaver not ranked');
});

test('removePlayer the SPY mid-voting ends the round (treated as caught), group scores', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const spy = g.spyId;
  const others = nonSpies(g);
  readyAll(g);
  eq(g.state, 'voting');
  g.removePlayer(spy);
  eq(g.state, 'finished');
  eq(g.spyCaught, true);
  for (const p of others) eq(g.scores[p], 500);
  assert(!g.getResults().some((r) => r.playerId === spy), 'departed spy not ranked');
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

test('destroy() clears active timers mid-phase', () => {
  const g = newGame(['a', 'b', 'c']);
  assert(pendingTimers() >= 1, 'reveal timer armed');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('Spyfall');
