import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Wavelength } from '../src/games/Wavelength.js';

installClock();

function newGame(players) {
  const g = new Wavelength(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const guesser = (g) => g.players.find((p) => p !== g.psychicId);
const guessers = (g) => g.players.filter((p) => p !== g.psychicId);

function playSubRound(g, value = 50) {
  g.targetCenter = 50; g.targetWidth = 7;
  g.handleAction(g.psychicId, { type: 'submitClue', clue: 'x' });
  for (const p of guessers(g)) g.handleAction(p, { type: 'guess', value });
  for (const p of [...g.players]) g.handleAction(p, { type: 'acknowledge' });
}

test('starts in clue with a psychic and roundsPerGame snapshot', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'clue');
  eq(g.roundsPerGame, 3);
  eq(g.subRound, 1);
  assert(g.players.includes(g.psychicId), 'psychic is a player');
  assert(pendingTimers() >= 1, 'clue timer armed');
});

test('bullseye scores 4 for the guesser and the psychic', () => {
  const g = newGame(['a', 'b']);
  g.targetCenter = 50; g.targetWidth = 7;
  const psy = g.psychicId; const gu = guesser(g);
  g.handleAction(psy, { type: 'submitClue', clue: 'middle' });
  eq(g.state, 'guessing');
  g.handleAction(gu, { type: 'guess', value: 50 });
  eq(g.state, 'reveal');
  eq(g.lastReveal.guessPoints[gu], 4);
  eq(g.lastReveal.psychicPoints, 4);
  eq(g.totalPoints[gu], 4);
  eq(g.totalPoints[psy], 4);
});

test('scoring bands: close=3, near=2, miss=0', () => {
  const cases = [[58, 3], [65, 2], [80, 0]]; // C=50,W=7 -> d=8(close),15(near),30(miss)
  for (const [val, pts] of cases) {
    const g = newGame(['a', 'b']);
    g.targetCenter = 50; g.targetWidth = 7;
    const psy = g.psychicId; const gu = guesser(g);
    g.handleAction(psy, { type: 'submitClue', clue: 'x' });
    g.handleAction(gu, { type: 'guess', value: val });
    eq(g.lastReveal.guessPoints[gu], pts, `value ${val}`);
  }
});

test('hidden target: guessers see null until reveal; psychic always sees it', () => {
  const g = newGame(['a', 'b', 'c']);
  g.targetCenter = 40; g.targetWidth = 7;
  const psy = g.psychicId; const gu = guesser(g);
  eq(g.getStateForPlayer(psy).targetCenter, 40);
  eq(g.getStateForPlayer(gu).targetCenter, null);
  g.handleAction(psy, { type: 'submitClue', clue: 'x' });
  eq(g.getStateForPlayer(gu).targetCenter, null, 'still hidden during guessing');
  for (const p of guessers(g)) g.handleAction(p, { type: 'guess', value: 40 });
  eq(g.getStateForPlayer(gu).targetCenter, 40, 'revealed');
});

test('hidden guesses: values null until reveal; guessedIds tracks lock-ins', () => {
  const g = newGame(['a', 'b', 'c']);
  const psy = g.psychicId; const [g1, g2] = guessers(g);
  g.handleAction(psy, { type: 'submitClue', clue: 'x' });
  g.handleAction(g1, { type: 'guess', value: 30 });
  const s = g.getStateForPlayer(g2);
  eq(s.guesses, null, 'opponent guesses hidden');
  assert(s.guessedIds.includes(g1), 'lock-in shown without value');
  eq(g.state, 'guessing', 'waits for the other guesser');
});

test('clue anti-cheat: numeric clue rejected, text accepted + truncated to 40', () => {
  const g = newGame(['a', 'b']);
  const psy = g.psychicId;
  g.handleAction(psy, { type: 'submitClue', clue: '42' });
  eq(g.state, 'clue', 'numeric clue rejected');
  eq(g.clueText, null);
  const long = 'warm-ish but leaning toward properly scalding hot tea now';
  g.handleAction(psy, { type: 'submitClue', clue: long });
  eq(g.state, 'guessing');
  eq(g.clueText.length, 40);
});

test('one-shot guards: re-guess ignored; psychic cannot guess; non-psychic cannot clue', () => {
  const g = newGame(['a', 'b', 'c']);
  const psy = g.psychicId; const [g1] = guessers(g);
  g.handleAction(g1, { type: 'submitClue', clue: 'x' }); // non-psychic clue ignored
  eq(g.state, 'clue');
  g.handleAction(psy, { type: 'submitClue', clue: 'x' });
  g.handleAction(psy, { type: 'guess', value: 50 }); // psychic guess ignored
  eq(g.guesses[psy], undefined);
  g.handleAction(g1, { type: 'guess', value: 30 });
  g.handleAction(g1, { type: 'guess', value: 90 }); // re-guess ignored
  eq(g.guesses[g1], 30);
});

test('clue timeout auto-advances to guessing', () => {
  const g = newGame(['a', 'b']);
  advance(45_000);
  eq(g.state, 'guessing');
  eq(g.clueText, '(no clue)');
});

test('guess timeout auto-fills missing guessers and reveals', () => {
  const g = newGame(['a', 'b', 'c']);
  g.targetCenter = 50; g.targetWidth = 7;
  g.handleAction(g.psychicId, { type: 'submitClue', clue: 'x' });
  advance(30_000);
  eq(g.state, 'reveal');
  for (const p of guessers(g)) eq(g.lastReveal.guesses[p], 50, 'auto-filled to 50');
});

test('reveal auto-ack advances after 10s', () => {
  const g = newGame(['a', 'b']);
  g.handleAction(g.psychicId, { type: 'submitClue', clue: 'x' });
  g.handleAction(guesser(g), { type: 'guess', value: 50 });
  eq(g.state, 'reveal');
  advance(10_000);
  assert(g.state === 'clue' || g.state === 'finished', `advanced (got ${g.state})`);
});

test('ranks all N players each game; full game completes after roundsPerGame', () => {
  for (const n of [2, 3, 5]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    let guard = 0;
    while (!g.isComplete() && guard++ < 20) playSubRound(g);
    eq(g.isComplete(), true, `n=${n} completes`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    res.forEach((e) => assert(typeof e.placement === 'number', 'has placement'));
  }
});

test('psychic leaving during clue skips the sub-round without deadlock', () => {
  const g = newGame(['a', 'b', 'c']);
  const psy = g.psychicId;
  g.removePlayer(psy);
  assert(!g.players.includes(psy));
  assert(g.state === 'clue' || g.state === 'finished', `recovered (got ${g.state})`);
  if (g.state === 'clue') assert(g.psychicId !== psy && g.players.includes(g.psychicId), 'new psychic');
});

test('last-needed guesser leaving during guessing reveals immediately', () => {
  const g = newGame(['a', 'b', 'c']);
  const psy = g.psychicId; const [g1, g2] = guessers(g);
  g.handleAction(psy, { type: 'submitClue', clue: 'x' });
  g.handleAction(g1, { type: 'guess', value: 40 });
  g.removePlayer(g2); // the only remaining un-guessed
  eq(g.state, 'reveal');
});

test('leaving down to one player finishes', () => {
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
report('Wavelength');
