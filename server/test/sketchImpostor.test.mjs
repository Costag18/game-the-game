import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { SketchImpostor } from '../src/games/SketchImpostor.js';

installClock();

function newGame(players, word, impostor) {
  const g = new SketchImpostor(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  if (word) g.word = word;
  if (impostor) g.impostor = impostor;
  return g;
}
const ackAll = (g) => { for (const p of [...g.players]) g.handleAction(p, { type: 'acknowledge' }); };
const stroke = () => ({ type: 'drawStroke', stroke: { color: '#ff0000', width: 5, tool: 'pen', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] } });
function drawAllTurns(g) { let guard = 0; while (g.state === 'drawing' && guard++ < 100) g.handleAction(g.currentDrawer, stroke()); }
// every player casts a valid vote for `target`; `target` (can't self-vote) votes another player
function voteAll(g, target) {
  for (const p of [...g.players]) {
    if (p === target) g.handleAction(p, { type: 'vote', target: g.players.find((x) => x !== p) });
    else g.handleAction(p, { type: 'vote', target });
  }
}

test('exactly one impostor; the impostor never receives the word, artists do', () => {
  const g = newGame(['a', 'b', 'c'], 'penguin', 'b');
  eq(g.state, 'reveal');
  const impView = g.getStateForPlayer('b');
  eq(impView.myRole, 'impostor');
  eq(impView.word, null); // impostor never sees the word
  const artistView = g.getStateForPlayer('a');
  eq(artistView.myRole, 'artist');
  eq(artistView.word, 'penguin');
  // an artist's view never reveals who the impostor is
  assert(!JSON.stringify(artistView).includes('"impostorId":"b"'), 'impostor id not leaked mid-game');
  eq(artistView.impostorId, null);
});

test('drawing rotates one stroke per turn; you cannot draw out of turn', () => {
  const g = newGame(['a', 'b', 'c'], 'cat', 'c');
  ackAll(g);
  eq(g.state, 'drawing');
  const drawer = g.currentDrawer;
  const notDrawer = g.players.find((p) => p !== drawer);
  g.handleAction(notDrawer, stroke()); // out of turn -> ignored
  eq(g._strokes.length, 0);
  g.handleAction(drawer, stroke()); // valid -> adds + rotates
  eq(g._strokes.length, 1);
  assert(g.currentDrawer !== drawer, 'turn rotated');
});

test('after 2 strokes per player the game goes to voting', () => {
  const g = newGame(['a', 'b', 'c'], 'cat', 'c');
  ackAll(g);
  drawAllTurns(g);
  eq(g.state, 'voting');
  eq(g._strokes.length, 6); // 3 players x 2 strokes
});

test('catching the impostor (wrong word guess) scores the artists', () => {
  const g = newGame(['a', 'b', 'c'], 'cat', 'b');
  ackAll(g); drawAllTurns(g);
  voteAll(g, 'b'); // the table fingers the impostor
  eq(g.state, 'impostorGuess');
  g.handleAction('b', { type: 'guessWord', text: 'dog' }); // wrong
  eq(g.state, 'finished');
  assert(g.scores['a'] === 300 && g.scores['c'] === 300, 'artists scored');
  eq(g.scores['b'], 0);
});

test('caught impostor who guesses the word right still scores', () => {
  const g = newGame(['a', 'b', 'c'], 'cat', 'b');
  ackAll(g); drawAllTurns(g);
  voteAll(g, 'b');
  g.handleAction('b', { type: 'guessWord', text: 'Cat!' }); // correct (normalized)
  eq(g.state, 'finished');
  eq(g.scores['b'], 400);
});

test('impostor escaping the vote scores the impostor and finishes', () => {
  const g = newGame(['a', 'b', 'c'], 'cat', 'b');
  ackAll(g); drawAllTurns(g);
  voteAll(g, 'a'); // the table wrongly fingers a; impostor b escapes
  eq(g.state, 'finished');
  eq(g.scores['b'], 600);
});

test('full game reveal discloses impostor + word; getResults ranks all N', () => {
  for (const n of [3, 4, 5]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players, 'cat');
    ackAll(g); drawAllTurns(g);
    voteAll(g, g.impostor);
    if (g.state === 'impostorGuess') g.handleAction(g.impostor, { type: 'guessWord', text: 'wrong' });
    eq(g.state, 'finished');
    const fin = g.getStateForPlayer(players[0]);
    eq(fin.impostorId, g.impostor); // disclosed now
    eq(fin.word, 'cat');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
  }
});

test('timers: reveal auto-begins, turn auto-skips, vote auto-resolves', () => {
  const g = newGame(['a', 'b', 'c'], 'cat', 'b');
  advance(12000); // reveal -> drawing
  eq(g.state, 'drawing');
  let guard = 0;
  while (g.state === 'drawing' && guard++ < 20) advance(20000); // each turn auto-skips
  eq(g.state, 'voting');
  const before = g.emitCount;
  advance(45000); // vote auto-resolves (no votes -> no one caught -> impostor escapes)
  assert(g.state === 'finished', `resolved (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on vote timeout');
});

test('impostor leaving ends the round; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c'], 'cat', 'b');
  ackAll(g);
  g.removePlayer('b'); // impostor leaves
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

uninstallClock();
report('SketchImpostor');
