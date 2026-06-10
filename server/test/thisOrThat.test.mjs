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
  eq(s.total, 10); // ten rounds
  assert(pendingTimers() >= 1, 'answer timer armed');
});

test('correct side is hidden during question, exposed in reveal', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  const sQ = g.getStateForPlayer('a');
  assert(!('correct' in sQ), 'no correct key during question');
  eq(sQ.reveal, null);
  for (const p of g.players) g.handleAction(p, { type: 'answer', choice: c });
  eq(g.state, 'reveal');
  const sR = g.getStateForPlayer('a');
  assert(sR.reveal && sR.reveal.correct === c, 'correct side present in reveal');
});

test('a correct answer scores points; a wrong answer scores 0 (no elimination)', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const c = correct(g), w = wrong(g);
  g.handleAction('a', { type: 'answer', choice: c });
  g.handleAction('b', { type: 'answer', choice: c });
  g.handleAction('c', { type: 'answer', choice: w });
  g.handleAction('d', { type: 'answer', choice: w });
  eq(g.state, 'reveal');
  assert(g.scores['a'] > 0 && g.scores['b'] > 0, 'correct players scored');
  eq(g.scores['c'], 0);
  eq(g.scores['d'], 0);
  // everyone is still a player (nobody eliminated)
  eq(g.players.length, 4);
});

test('faster correct answer scores at least as much as a slower one (speed bonus)', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  g.handleAction('a', { type: 'answer', choice: c }); // rank 0 -> 1000 (+0 streak bonus, first round)
  g.handleAction('b', { type: 'answer', choice: c }); // rank 1 -> 920
  assert(g.scores['a'] > g.scores['b'], `first faster (a=${g.scores['a']} b=${g.scores['b']})`);
});

test('wrong answer is still recorded and locks the round (one answer per round)', () => {
  const g = newGame(['a', 'b']);
  const w = wrong(g);
  g.handleAction('a', { type: 'answer', choice: w });
  assert(g.answers['a'] && g.answers['a'].correct === false, 'wrong recorded');
  // a second attempt is ignored
  g.handleAction('a', { type: 'answer', choice: correct(g) });
  eq(g.answers['a'].correct, false);
});

test('consecutive correct answers build a streak; a wrong answer resets it', () => {
  const g = newGame(['a', 'b']);
  // round 1: both correct
  let c = correct(g);
  g.handleAction('a', { type: 'answer', choice: c });
  g.handleAction('b', { type: 'answer', choice: c });
  eq(g.streaks['a'], 1);
  for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
  // round 2: a correct (streak 2), b wrong (streak reset)
  c = correct(g);
  const w = wrong(g);
  g.handleAction('a', { type: 'answer', choice: c });
  g.handleAction('b', { type: 'answer', choice: w });
  eq(g.streaks['a'], 2);
  eq(g.streaks['b'], 0);
  eq(g.bestStreak['a'], 2);
});

test('all-answered advances to reveal without the timer', () => {
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

test('reveal timeout auto-advances to next round / finished and broadcasts', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  for (const p of g.players) g.handleAction(p, { type: 'answer', choice: c });
  eq(g.state, 'reveal');
  const before = g.emitCount;
  advance(5_000);
  assert(g.state === 'question' || g.state === 'finished', `advanced (got ${g.state})`);
  assert(g.emitCount > before, 'broadcast on reveal timeout');
});

for (const N of [2, 3, 4]) {
  test(`full game with ${N} players runs all 10 rounds to finished; results length ${N}, placement 1 first`, () => {
    const players = ['a', 'b', 'c', 'd'].slice(0, N);
    const g = newGame(players);
    let guard = 0;
    let rounds = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'question') {
        const c = correct(g);
        for (const p of g.players) g.handleAction(p, { type: 'answer', choice: c });
      } else if (g.state === 'reveal') {
        rounds++;
        for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    eq(rounds, 10); // every round played; nobody eliminated early
    const res = g.getResults();
    eq(res.length, N);
    eq(res[0].placement, 1);
    assert(res[0].score > 0, 'winner accumulated points across rounds');
    // scores are non-increasing down the standings
    for (let i = 1; i < res.length; i++) assert(res[i].score <= res[i - 1].score, 'sorted by score');
  });
}

test('tie: equal cumulative scores share a placement', () => {
  // both players answer WRONG every round -> both finish on 0 -> tie at placement 1
  const g = newGame(['a', 'b']);
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 200) {
    if (g.state === 'question') {
      const w = wrong(g);
      for (const p of g.players) g.handleAction(p, { type: 'answer', choice: w });
    } else if (g.state === 'reveal') {
      for (const p of g.players) g.handleAction(p, { type: 'acknowledge' });
    }
  }
  eq(g.state, 'finished');
  const res = g.getResults();
  eq(res.length, 2);
  eq(res[0].score, 0);
  eq(res[1].score, 0);
  eq(res[0].placement, 1);
  eq(res[1].placement, 1); // tie shares placement
});

test('removePlayer mid-question advances (no deadlock) and prunes leaver from results', () => {
  const g = newGame(['a', 'b', 'c']);
  const c = correct(g);
  g.handleAction('a', { type: 'answer', choice: c });
  g.handleAction('b', { type: 'answer', choice: c });
  g.removePlayer('c'); // c was the last owed -> should advance to reveal
  eq(g.state, 'reveal');
  assert(!g.getResults().some((r) => r.playerId === 'c'), 'leaver not ranked');
});

test('removePlayer mid-reveal re-checks the ack barrier', () => {
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
