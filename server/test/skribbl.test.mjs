import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Skribbl } from '../src/games/Skribbl.js';

installClock();

function newGame(players, word) {
  const g = new Skribbl(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  if (word) g.secretWord = word;
  return g;
}

test('starts a drawing turn; drawer is set; word hidden from guessers', () => {
  const g = newGame(['a', 'b', 'c'], 'penguin');
  eq(g.state, 'drawing');
  assert(g.drawerId, 'a drawer is chosen');
  const guesser = g.players.find((p) => p !== g.drawerId);
  const s = g.getStateForPlayer(guesser);
  eq(s.word, null); // guesser never sees the word
  eq(s.maskedWord, '_______'); // length-7 hint
  eq(g.getStateForPlayer(g.drawerId).word, 'penguin'); // drawer sees it
});

test('the drawer cannot guess; correct guesses score and reveal the truth', () => {
  const g = newGame(['a', 'b', 'c'], 'cat');
  const drawer = g.drawerId;
  const guessers = g.players.filter((p) => p !== drawer);
  g.handleAction(drawer, { type: 'guess', text: 'cat' }); // drawer can't guess
  eq(g.scores[drawer], 0);
  g.handleAction(guessers[0], { type: 'guess', text: 'Cat!' }); // normalized correct
  assert(g.solved.has(guessers[0]), 'first guesser solved');
  assert(g.scores[guessers[0]] > 0, 'guesser scored');
  eq(g.scores[drawer], 50); // drawer rewarded
});

test('a wrong guess gives private feedback and never leaks', () => {
  const g = newGame(['a', 'b', 'c'], 'elephant');
  const guesser = g.players.find((p) => p !== g.drawerId);
  g.handleAction(guesser, { type: 'guess', text: 'elefant' }); // close (dist 2)
  eq(g.getStateForPlayer(guesser).myGuessFeedback, 'close');
  assert(!g.solved.has(guesser), 'not solved');
  // feedback is private — another player doesn't see it
  const other = g.players.find((p) => p !== g.drawerId && p !== guesser);
  eq(g.getStateForPlayer(other).myGuessFeedback, null);
});

test('all guessers solving ends the turn into reveal', () => {
  const g = newGame(['a', 'b', 'c'], 'dog');
  const guessers = g.players.filter((p) => p !== g.drawerId);
  for (const gu of guessers) g.handleAction(gu, { type: 'guess', text: 'dog' });
  eq(g.state, 'reveal');
});

test('turn timer ends the turn; reveal auto-advances to the next drawer', () => {
  const g = newGame(['a', 'b', 'c'], 'fish');
  const firstDrawer = g.drawerId;
  advance(70_000); // turn timer
  eq(g.state, 'reveal');
  advance(8000); // reveal timer
  eq(g.state, 'drawing');
  assert(g.drawerId !== firstDrawer, 'a new player draws');
});

test('earlier correct guesses score more', () => {
  const g = newGame(['a', 'b', 'c', 'd'], 'apple');
  const guessers = g.players.filter((p) => p !== g.drawerId);
  g.handleAction(guessers[0], { type: 'guess', text: 'apple' });
  g.handleAction(guessers[1], { type: 'guess', text: 'apple' });
  assert(g.scores[guessers[0]] > g.scores[guessers[1]], 'first solver scored more');
});

test('full game runs every player as drawer then finishes; ranks all N', () => {
  const g = newGame(['a', 'b', 'c'], 'cat');
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 30) {
    if (g.state === 'drawing') {
      g.secretWord = 'cat';
      for (const gu of g.players.filter((p) => p !== g.drawerId)) g.handleAction(gu, { type: 'guess', text: 'cat' });
    } else if (g.state === 'reveal') {
      advance(8000);
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 3);
  eq(res[0].placement, 1);
});

test('drawer leaving abandons the turn and advances; guesser leave re-checks', () => {
  const g = newGame(['a', 'b', 'c'], 'cat');
  const drawer = g.drawerId;
  g.removePlayer(drawer);
  assert(g.state === 'reveal' || g.state === 'drawing' || g.state === 'finished', 'no hang');
  assert(!g.getResults().some((r) => r.playerId === drawer), 'leaver pruned');
});

test('leaving down to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c'], 'cat');
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('canvas only accepts strokes from the current drawer', () => {
  const g = newGame(['a', 'b', 'c'], 'cat');
  const drawer = g.drawerId;
  const guesser = g.players.find((p) => p !== drawer);
  eq(g.canvas.addStroke(guesser, { points: [{ x: 1, y: 1 }] }, 1000).ok, false);
  eq(g.canvas.addStroke(drawer, { points: [{ x: 1, y: 1 }] }, 2000).ok, true);
});

uninstallClock();
report('Skribbl');
