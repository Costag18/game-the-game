import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { ThisOrThat } from '../src/games/ThisOrThat.js';

installClock();

function newGame(players) {
  const g = new ThisOrThat(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
const correct = (g) => g.currentQuestion.correct;
const wrong = (g) => (g.currentQuestion.correct === 'a' ? 'b' : 'a');

test('starts in question phase with a prompt + two options and an answer timer', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'question');
  assert(g.currentQuestion && g.currentQuestion.prompt, 'question loaded');
  const s = g.getStateForPlayer('a');
  assert(s.prompt && s.a && s.b, 'prompt + options exposed');
  eq(s.qNumber, 1);
  assert(pendingTimers() >= 1, 'answer timer armed');
});

test('correct side is hidden during question, exposed in reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  // the literal 'correct' key must not leak; assert on the JSON shape
  const sQ = g.getStateForPlayer('a');
  assert(!('correct' in sQ), 'no correct key during question');
  eq(sQ.reveal, null);
  // everyone answers correctly -> reveal
  for (const p of g.players) g.handleAction(p, { type: 'answer', choice: c });
  eq(g.state, 'reveal');
  const sR = g.getStateForPlayer('a');
  assert(sR.reveal && sR.reveal.correct === c, 'correct side present in reveal');
});

test('a wrong answer eliminates; a correct answer survives', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const c = correct(g), w = wrong(g);
  g.handleAction('a', { type: 'answer', choice: c });
  g.handleAction('b', { type: 'answer', choice: c });
  g.handleAction('c', { type: 'answer', choice: w });
  g.handleAction('d', { type: 'answer', choice: w });
  eq(g.state, 'reveal');
  assert(g.survivors.includes('a') && g.survivors.includes('b'), 'correct players survive');
  assert(!g.survivors.includes('c') && !g.survivors.includes('d'), 'wrong players eliminated');
  eq(g.eliminationRound['c'], 1);
  eq(g.eliminationRound['d'], 1);
  assert(g.lastReveal.eliminated.includes('c'), 'reveal lists eliminated');
  assert(g.lastReveal.survived.includes('a'), 'reveal lists survived');
});

test('eliminated player cannot answer in later questions', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g), w = wrong(g);
  g.handleAction('a', { type: 'answer', choice: c });
  g.handleAction('b', { type: 'answer', choice: c });
  g.handleAction('c', { type: 'answer', choice: w }); // c out
  eq(g.state, 'reveal');
  for (const p of g.survivors) g.handleAction(p, { type: 'acknowledge' });
  eq(g.state, 'question'); // next question
  const c2 = correct(g);
  g.handleAction('c', { type: 'answer', choice: c2 }); // ignored — c is out
  eq(g.answers['c'], undefined);
});

test('not wiping everyone: all-wrong on a question eliminates no one', () => {
  const g = newGame(['a', 'b']);
  const w = wrong(g);
  g.handleAction('a', { type: 'answer', choice: w });
  g.handleAction('b', { type: 'answer', choice: w });
  eq(g.state, 'reveal');
  eq(g.survivors.length, 2); // nobody knocked out
  eq(g.lastReveal.eliminated.length, 0);
});

test('all-answered advances to reveal without timer', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  for (const p of g.players) g.handleAction(p, { type: 'answer', choice: c });
  eq(g.state, 'reveal');
});

test('answer timeout auto-advances to reveal and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  const before = g.emitCount;
  advance(12_000);
  eq(g.state, 'reveal');
  assert(g.emitCount > before, 'broadcast on answer timeout');
});

test('reveal timeout auto-advances to next question / finished', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  for (const p of g.players) g.handleAction(p, { type: 'answer', choice: c });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(6_000);
  assert(g.state === 'question' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

for (const N of [2, 3, 4]) {
  test(`full game with ${N} players runs to finished; results length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 50) {
      if (g.state === 'question') {
        // everyone answers correctly each round -> all survive to the end
        const c = correct(g);
        for (const p of g.survivors) g.handleAction(p, { type: 'answer', choice: c });
      } else if (g.state === 'reveal') {
        for (const p of g.survivors) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    // all survived every question -> all tie at placement 1
    eq(res.every((r) => r.placement === 1), true);
  });
}

test('tie: players eliminated in the same round share a placement; survivor ranks 1', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g), w = wrong(g);
  // a survives; b and c eliminated together in round 1
  g.handleAction('a', { type: 'answer', choice: c });
  g.handleAction('b', { type: 'answer', choice: w });
  g.handleAction('c', { type: 'answer', choice: w });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' }); // sole survivor acks -> finish
  eq(g.state, 'finished'); // only 1 survivor -> game over
  const res = g.getResults();
  eq(res.length, 3);
  const ra = res.find((r) => r.playerId === 'a');
  const rb = res.find((r) => r.playerId === 'b');
  const rc = res.find((r) => r.playerId === 'c');
  eq(ra.placement, 1);
  eq(rb.placement, rc.placement); // tie shares placement
  assert(rb.placement > 1, 'eliminees rank below survivor');
});

test('removePlayer mid-question advances (no deadlock) and prunes leaver from results', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  g.handleAction('a', { type: 'answer', choice: c });
  g.handleAction('b', { type: 'answer', choice: c });
  g.removePlayer('c'); // c was the last owed -> should advance
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-reveal re-checks ack barrier', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  for (const p of g.players) g.handleAction(p, { type: 'answer', choice: c });
  eq(g.state, 'reveal');
  g.handleAction('a', { type: 'acknowledge' });
  g.handleAction('b', { type: 'acknowledge' });
  g.removePlayer('c'); // c was the last owed ack
  assert(g.state === 'question' || g.state === 'finished', `advanced past reveal (got ${g.state})`);
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
report('ThisOrThat');
