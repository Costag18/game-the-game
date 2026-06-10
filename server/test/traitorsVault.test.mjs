import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { TraitorsVault } from '../src/games/TraitorsVault.js';

installClock();

function newGame(players) {
  const g = new TraitorsVault(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}

const traitorsOf = (g) => g.players.filter((p) => g.roles[p] === 'TRAITOR');
const loyalsOf = (g) => g.players.filter((p) => g.roles[p] === 'LOYAL');

// Everyone taps ready -> leaves the role-card barrier into stage 1.
function passReveal(g) {
  for (const p of g.players) g.handleAction(p, { type: 'ready' });
}
// All active players submit `move` (a fn pid->move, or a string), then ack the result.
function runStage(g, mover) {
  const active = g.players.filter((p) => !g.ejected.has(p));
  for (const p of active) {
    const m = typeof mover === 'function' ? mover(p) : mover;
    g.handleAction(p, { type: 'submitMove', move: m });
  }
  // now in stageResult — everyone acks
  for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
}

test('role assignment: exactly 1 traitor for <=5 players, 2 for 6+', () => {
  for (const n of [4, 5]) {
    const g = newGame(Array.from({ length: n }, (_, i) => `p${i}`));
    eq(traitorsOf(g).length, 1, `${n}p -> 1 traitor`);
    eq(loyalsOf(g).length, n - 1);
  }
  for (const n of [6, 7, 8]) {
    const g = newGame(Array.from({ length: n }, (_, i) => `p${i}`));
    eq(traitorsOf(g).length, 2, `${n}p -> 2 traitors`);
    eq(loyalsOf(g).length, n - 2);
  }
});

test('starts in reveal with a ready timer; every player has a valid role', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  eq(g.state, 'reveal');
  assert(pendingTimers() >= 1, 'reveal timer armed');
  for (const p of g.players) assert(g.roles[p] === 'LOYAL' || g.roles[p] === 'TRAITOR', 'valid role');
});

test('ANTI-CHEAT: a player only ever sees their OWN role, never others, during play', () => {
  const g = newGame(['a', 'b', 'c', 'd', 'e', 'f']); // 6p -> 2 traitors
  passReveal(g);
  eq(g.state, 'stage');
  for (const me of g.players) {
    const s = g.getStateForPlayer(me);
    eq(s.myRole, g.roles[me], 'my role surfaced');
    // the view must not leak any OTHER player's role anywhere
    const blob = JSON.stringify(s);
    for (const other of g.players) {
      if (other === me) continue;
      assert(!blob.includes(`"${other}":"TRAITOR"`), `no ${other} TRAITOR leak`);
      assert(!blob.includes(`"${other}":"LOYAL"`), `no ${other} LOYAL leak`);
    }
    // no roles map / outcome / traitors list leaks mid-game
    assert(!('roles' in s), 'no roles map mid-game');
    assert(s.outcome === null, 'no outcome mid-game');
  }
  // a loyal player's view must never reveal a traitor's identity. The only role
  // string anywhere in their view is their OWN ("LOYAL"); the word "TRAITOR"
  // must not appear at all (no traitor is named/flagged).
  const aLoyal = loyalsOf(g)[0];
  const view = JSON.stringify(g.getStateForPlayer(aLoyal));
  assert(!view.includes('TRAITOR'), 'loyal view never contains the word TRAITOR mid-game');
});

test('ANTI-CHEAT: individual sabotage choices are never revealed — only the count', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  // a sabotages, others help
  const active = g.players;
  g.handleAction(active[0], { type: 'submitMove', move: 'sabotage' });
  for (let i = 1; i < active.length; i++) g.handleAction(active[i], { type: 'submitMove', move: 'help' });
  eq(g.state, 'stageResult');
  for (const me of g.players) {
    const s = g.getStateForPlayer(me);
    eq(s.stageResult.sabotageCount, 1, 'count shown');
    eq(s.stageResult.passed, false, 'failed because sabotage');
    const blob = JSON.stringify(s);
    // never expose WHO chose what (other than my own myMove)
    assert(!('choices' in s), 'choices map not sent');
    // my own move is fine; another player's move must not be present
    const other = g.players.find((p) => p !== me);
    // history/stageResult entries carry only stage/passed/sabotageCount
    assert(!blob.includes(`"${other}":"sabotage"`) && !blob.includes(`"${other}":"help"`), 'no per-player choice leak');
  }
});

test('stage passes only when sabotageCount === 0; stagesPassed increments', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  runStage(g, 'help'); // stage 1 all help -> pass
  eq(g.history[0].passed, true);
  eq(g.stagesPassed, 1);
  runStage(g, (p) => (p === g.players[0] ? 'sabotage' : 'help')); // stage 2 fail
  eq(g.history[1].passed, false);
  eq(g.history[1].sabotageCount, 1);
  eq(g.stagesPassed, 1);
});

test('eject vote happens after stage 3, then stages 4-5 run', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  runStage(g, 'help'); // 1
  runStage(g, 'help'); // 2
  runStage(g, 'help'); // 3 -> should route to ejectVote
  eq(g.state, 'ejectVote');
  eq(g.stageIndex, 3);
  // everyone votes for player index 0
  const target = g.players[0];
  for (const p of g.players) if (p !== target) g.handleAction(p, { type: 'castEject', targetId: target });
  // target abstains (or votes someone else) — vote for index 1
  g.handleAction(target, { type: 'castEject', targetId: g.players[1] });
  eq(g.state, 'stage');
  eq(g.stageIndex, 4);
  assert(g.ejected.has(target), 'most-voted ejected');
});

test('eject tie -> no ejection', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  runStage(g, 'help'); runStage(g, 'help'); runStage(g, 'help');
  eq(g.state, 'ejectVote');
  // a<->b each get 2 votes: a,c vote b ; b,d vote a -> tie
  g.handleAction('a', { type: 'castEject', targetId: 'b' });
  g.handleAction('c', { type: 'castEject', targetId: 'b' });
  g.handleAction('b', { type: 'castEject', targetId: 'a' });
  g.handleAction('d', { type: 'castEject', targetId: 'a' });
  eq(g.state, 'stage');
  eq(g.ejected.size, 0, 'no ejection on tie');
  eq(g.ejectResult.tie, true);
});

test('cannot vote for self; ejected players sit out stages 4-5', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  runStage(g, 'help'); runStage(g, 'help'); runStage(g, 'help');
  g.handleAction('a', { type: 'castEject', targetId: 'a' }); // self -> ignored
  eq(g.ejectVotes['a'], undefined);
  // eject 'b'
  for (const p of ['a', 'c', 'd']) g.handleAction(p, { type: 'castEject', targetId: 'b' });
  g.handleAction('b', { type: 'castEject', targetId: 'c' });
  assert(g.ejected.has('b'), 'b ejected');
  // stage 4: b's submit is ignored, stage resolves on the other 3
  g.handleAction('b', { type: 'submitMove', move: 'sabotage' });
  eq(g.choices['b'], undefined, 'ejected move ignored');
  for (const p of ['a', 'c', 'd']) g.handleAction(p, { type: 'submitMove', move: 'help' });
  eq(g.state, 'stageResult');
  eq(g.lastStage.passed, true, 'ejected saboteur could not affect stage');
});

test('SCORING — vault cracked: every LOYAL +500 (and ALL roles revealed at finished)', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  // 5 stages all help -> 5 passed -> cracked; eject after 3 -> no ejection (skip votes via timeout)
  runStage(g, 'help'); // 1
  runStage(g, 'help'); // 2
  runStage(g, 'help'); // 3 -> ejectVote
  eq(g.state, 'ejectVote');
  advance(35_000);     // eject window times out -> nobody ejected (no votes)
  eq(g.state, 'stage');
  runStage(g, 'help'); // 4
  runStage(g, 'help'); // 5 -> finished
  eq(g.state, 'finished');
  eq(g.outcome.vaultCracked, true);
  for (const p of loyalsOf(g)) eq(g.scores[p], 500, 'loyal +500');
  for (const p of traitorsOf(g)) eq(g.scores[p], 0, 'traitor 0 on crack');
  // finished reveal discloses ALL roles
  const s = g.getStateForPlayer(loyalsOf(g)[0]);
  assert(s.outcome && s.outcome.roles, 'roles disclosed at finished');
  for (const p of g.players) eq(s.outcome.roles[p], g.roles[p], 'role matches');
});

test('SCORING — vault NOT cracked: every TRAITOR +800', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  // fail enough stages so stagesPassed < 4. Traitor sabotages every stage.
  const t = traitorsOf(g)[0];
  const sab = (p) => (p === t ? 'sabotage' : 'help');
  runStage(g, sab); // 1 fail
  runStage(g, sab); // 2 fail
  runStage(g, sab); // 3 fail -> ejectVote
  advance(35_000);  // no ejection
  runStage(g, sab); // 4 fail
  runStage(g, sab); // 5 fail -> finished
  eq(g.state, 'finished');
  eq(g.outcome.vaultCracked, false);
  eq(g.stagesPassed, 0);
  for (const p of traitorsOf(g)) eq(g.scores[p], 800, 'traitor +800');
  for (const p of loyalsOf(g)) eq(g.scores[p], 0, 'loyal 0 when vault fails');
});

test('SCORING — catching a traitor in eject gives every LOYAL +200', () => {
  // Force a known traitor by constructing then overriding roles deterministically.
  const g = new TraitorsVault(['a', 'b', 'c', 'd']);
  g.setOnStateChange(() => {});
  g.startGame();
  // deterministic: make 'a' the traitor
  g.roles = { a: 'TRAITOR', b: 'LOYAL', c: 'LOYAL', d: 'LOYAL' };
  passReveal(g);
  // crack the vault (loyal win) AND eject the traitor for the +200 bonus
  runStage(g, 'help'); runStage(g, 'help'); runStage(g, 'help'); // -> ejectVote
  for (const p of ['b', 'c', 'd']) g.handleAction(p, { type: 'castEject', targetId: 'a' });
  g.handleAction('a', { type: 'castEject', targetId: 'b' });
  assert(g.ejected.has('a'), 'traitor ejected');
  runStage(g, 'help'); runStage(g, 'help'); // 4,5 -> finished, cracked
  eq(g.state, 'finished');
  eq(g.outcome.vaultCracked, true);
  eq(g.outcome.caughtTraitor, true);
  for (const p of ['b', 'c', 'd']) eq(g.scores[p], 500 + 200, 'loyal +500 +200');
});

test('barrier advances on REVEAL timeout with a broadcast', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(25_000);
  eq(g.state, 'stage');
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

test('barrier advances on STAGE timeout (missing -> help) with a broadcast', () => {
  const g = newGame(['a', 'b', 'c']);
  passReveal(g);
  g.handleAction('a', { type: 'submitMove', move: 'sabotage' });
  const before = g.emitCount;
  advance(30_000); // b,c default to help
  eq(g.state, 'stageResult');
  eq(g.lastStage.sabotageCount, 1, 'only a sabotaged');
  assert(g.emitCount > before, 'broadcast on stage timeout');
});

test('barrier advances on EJECT timeout (abstain) with a broadcast', () => {
  const g = newGame(['a', 'b', 'c']);
  passReveal(g);
  runStage(g, 'help'); runStage(g, 'help'); runStage(g, 'help');
  eq(g.state, 'ejectVote');
  const before = g.emitCount;
  advance(35_000);
  eq(g.state, 'stage');
  eq(g.ejected.size, 0, 'no votes -> no ejection');
  assert(g.emitCount > before, 'broadcast on eject timeout');
});

test('full game reaches finished; getResults ranks all N, placement 1 first — N in [3,4,5]', () => {
  for (const n of [3, 4, 5]) {
    const g = newGame(Array.from({ length: n }, (_, i) => `p${i}`));
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 60) {
      if (g.state === 'reveal') passReveal(g);
      else if (g.state === 'stage') {
        for (const p of g.players.filter((x) => !g.ejected.has(x))) g.handleAction(p, { type: 'submitMove', move: 'help' });
      } else if (g.state === 'stageResult') {
        for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      } else if (g.state === 'ejectVote') {
        // everyone votes p0 (except p0 votes p1) -> deterministic ejection
        for (const p of g.players) g.handleAction(p, { type: 'castEject', targetId: p === 'p0' ? 'p1' : 'p0' });
      }
    }
    eq(g.state, 'finished', `n=${n} finished`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} all ranked`);
    eq(res[0].placement, 1, `n=${n} first is placement 1`);
    // placements are non-decreasing and start at 1
    let prev = 0;
    for (const r of res) { assert(r.placement >= prev, 'placement non-decreasing'); prev = r.placement; }
    // all-help -> cracked -> loyals share top placement (ties OK)
    assert(g.outcome.vaultCracked, 'all-help cracks the vault');
  }
});

test('removePlayer during stage advances (no deadlock), leaver pruned from results', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  g.handleAction('a', { type: 'submitMove', move: 'help' });
  g.handleAction('b', { type: 'submitMove', move: 'help' });
  // c is the last owed; c leaves -> only d remains owing... d still owes
  g.removePlayer('c');
  assert(g.state === 'stage' || g.state === 'stageResult', 'still progressing');
  g.handleAction('d', { type: 'submitMove', move: 'help' });
  eq(g.state, 'stageResult');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer of the TRAITOR mid-stage still resolves (no deadlock)', () => {
  const g = new TraitorsVault(['a', 'b', 'c', 'd']);
  g.setOnStateChange(() => {});
  g.startGame();
  g.roles = { a: 'TRAITOR', b: 'LOYAL', c: 'LOYAL', d: 'LOYAL' };
  passReveal(g);
  // traitor 'a' about to sabotage but leaves before others finish
  g.handleAction('b', { type: 'submitMove', move: 'help' });
  g.removePlayer('a'); // the traitor leaves
  g.handleAction('c', { type: 'submitMove', move: 'help' });
  g.handleAction('d', { type: 'submitMove', move: 'help' });
  eq(g.state, 'stageResult');
  eq(g.lastStage.passed, true, 'departed traitor cannot sabotage');
  assert(!g.getResults().some((r) => r.playerId === 'a'), 'traitor leaver pruned');
});

test('removePlayer during ejectVote advances; voted-out leaver handled', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  passReveal(g);
  runStage(g, 'help'); runStage(g, 'help'); runStage(g, 'help');
  eq(g.state, 'ejectVote');
  g.handleAction('a', { type: 'castEject', targetId: 'b' });
  g.handleAction('c', { type: 'castEject', targetId: 'b' });
  g.removePlayer('b'); // the front-runner leaves mid-vote
  // d is the only one owing now
  g.handleAction('d', { type: 'castEject', targetId: 'a' });
  assert(g.state === 'stage', `advanced past eject (got ${g.state})`);
  assert(!g.players.includes('b'), 'leaver pruned');
});

test('collapse to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  passReveal(g);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('TraitorsVault');
