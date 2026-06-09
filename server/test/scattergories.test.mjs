import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { Scattergories } from '../src/games/Scattergories.js';

installClock();

function newGame(players) {
  const g = new Scattergories(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const submit = (g, p, obj) => g.handleAction(p, { type: 'submit', answers: obj });
const ackAll = (g) => { for (const p of [...g.players]) g.handleAction(p, { type: 'acknowledge' }); };

test('all submitting triggers reveal with a scored result + ack timer', () => {
  const g = newGame(['a', 'b']);
  eq(g.state, 'writing');
  submit(g, 'a', { 0: 'Apple' });
  submit(g, 'b', { 0: 'Avocado' });
  eq(g.state, 'reveal');
  assert(g.roundResult, 'roundResult set');
  assert(pendingTimers() >= 1, 'ack timer running');
});

test('write timer expiry reveals; non-submitters score 0', () => {
  const g = newGame(['a', 'b']);
  g.letter = 'S'; g.categories = ['Food'];
  submit(g, 'a', { 0: 'Sushi' });
  advance(75_000);
  eq(g.state, 'reveal');
  eq(g.roundScores['a'], 1, 'valid unique scores');
  eq(g.roundScores['b'], 0, 'no submission scores 0');
});

test('duplicate answers score nobody; unique scores', () => {
  const g = newGame(['a', 'b', 'c']);
  g.letter = 'S'; g.categories = ['Food'];
  submit(g, 'a', { 0: 'Snake' });
  submit(g, 'b', { 0: 'snake' });
  submit(g, 'c', { 0: 'Salmon' });
  eq(g.roundResult.perPlayer['a'][0].status, 'dup');
  eq(g.roundResult.perPlayer['b'][0].status, 'dup');
  eq(g.roundResult.perPlayer['c'][0].status, 'scored');
  eq(g.roundScores['c'], 1);
  eq(g.roundScores['a'], 0);
});

test('wrong-letter is invalid, empty is empty, both score 0', () => {
  const g = newGame(['a', 'b']);
  g.letter = 'S'; g.categories = ['Food', 'City'];
  submit(g, 'a', { 0: 'Zebra', 1: '' });
  submit(g, 'b', { 0: 'Sun', 1: 'Seattle' });
  eq(g.roundResult.perPlayer['a'][0].status, 'invalid');
  eq(g.roundResult.perPlayer['a'][1].status, 'empty');
  eq(g.roundResult.perPlayer['b'][0].status, 'scored');
});

test('leading articles are stripped for letter + dedupe', () => {
  const g = newGame(['a', 'b']);
  g.letter = 'S'; g.categories = ['X'];
  submit(g, 'a', { 0: 'The Sun' });
  submit(g, 'b', { 0: 'sun' });
  eq(g.roundResult.perPlayer['a'][0].status, 'dup'); // both normalize to "sun"
});

test('JSON string keys are read defensively', () => {
  const g = newGame(['a', 'b']);
  g.letter = 'S'; g.categories = ['X'];
  g.handleAction('a', { type: 'submit', answers: { '0': 'Sun' } });
  submit(g, 'b', { 0: 'Sea' });
  eq(g.roundResult.perPlayer['a'][0].status, 'scored');
});

test('no re-submit: a second submit is ignored', () => {
  const g = newGame(['a', 'b']);
  g.letter = 'S'; g.categories = ['X'];
  submit(g, 'a', { 0: 'Sun' });
  submit(g, 'a', { 0: 'Star' });
  eq(g.answers['a'][0], 'Sun');
});

test('ranks all N players; ties share placement', () => {
  const players = ['a', 'b', 'c'];
  const g = newGame(players);
  // 3 rounds: a and b each score 1, c scores 0
  for (let r = 0; r < 3; r++) {
    g.letter = 'S'; g.categories = ['X'];
    submit(g, 'a', { 0: `Sun${r}` });   // unique each
    submit(g, 'b', { 0: `Sea${r}` });   // unique each
    submit(g, 'c', { 0: 'Zoo' });       // invalid (wrong letter)
    ackAll(g);
  }
  eq(g.isComplete(), true);
  const res = g.getResults();
  eq(res.length, 3);
  const a = res.find((e) => e.playerId === 'a');
  const b = res.find((e) => e.playerId === 'b');
  const c = res.find((e) => e.playerId === 'c');
  eq(a.placement, 1);
  eq(b.placement, 1); // tie
  eq(c.placement, 3);
  eq(a.score, 3);
});

test('hidden info: opponents answers null during writing', () => {
  const g = newGame(['a', 'b']);
  submit(g, 'a', { 0: 'Apple' });
  const s = g.getStateForPlayer('b');
  const other = s.otherPlayers.find((o) => o.playerId === 'a');
  eq(other.answers, null, 'opponent answers hidden while writing');
  assert(other.hasSubmitted === true, 'lock flag visible');
});

test('leave while writing (not last) keeps the round open', () => {
  const g = newGame(['a', 'b', 'c']);
  submit(g, 'a', { 0: 'x' });
  g.removePlayer('b'); // c still hasn't submitted
  eq(g.state, 'writing');
  assert(!g.players.includes('b'));
});

test('leave of the last un-submitted player auto-reveals', () => {
  const g = newGame(['a', 'b', 'c']);
  submit(g, 'a', { 0: 'x' });
  submit(g, 'c', { 0: 'y' });
  g.removePlayer('b'); // only un-submitted leaves
  eq(g.state, 'reveal');
});

test('leave during reveal (last un-acked) advances the round', () => {
  const g = newGame(['a', 'b', 'c']);
  submit(g, 'a', { 0: 'x' }); submit(g, 'b', { 0: 'y' }); submit(g, 'c', { 0: 'z' });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('c', { type: 'acknowledge' });
  g.removePlayer('b'); // last un-acked leaves -> all remaining acked -> advance
  eq(g.state, 'writing'); // round 2 of 3
});

test('down to one player finishes and clears timers', () => {
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
report('Scattergories');
