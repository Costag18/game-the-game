import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { TelephonePictionary } from '../src/games/TelephonePictionary.js';

installClock();

let clk = 1000;
function newGame(players) {
  const g = new TelephonePictionary(players);
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
function completeStep(g) {
  if (g.state === 'writing') {
    for (const p of [...g.players]) g.handleAction(p, { type: 'submitPhrase', text: `seed-${p}` });
  } else if (g.state === 'step') {
    for (const p of [...g.players]) {
      if (g.stepMode === 'draw') {
        const cid = g.assignment[p];
        g.canvases[cid].addStroke(p, { points: [{ x: 1, y: 1 }] }, clk++);
        g.handleAction(p, { type: 'submitDraw' });
      } else {
        g.handleAction(p, { type: 'submitWrite', text: `cap-${p}-${g.stepIndex}` });
      }
    }
  }
}

test('all phrases submitted starts the draw step; each chain seeded once', () => {
  const g = newGame(['a', 'b', 'c']);
  eq(g.state, 'writing');
  completeStep(g);
  eq(g.state, 'step');
  eq(g.stepIndex, 1);
  eq(g.stepMode, 'draw');
  for (const c of g.chains) eq(c.items.length, 1);
});

test('hidden info: a stepping player sees only the single prior item, never other chains', () => {
  const g = newGame(['a', 'b', 'c']);
  completeStep(g); // -> draw step
  const p = g.players[0];
  const s = g.getStateForPlayer(p);
  eq(s.reveal, null);
  eq(s.voting, null);
  assert(!('chains' in s), 'full chains not exposed during step');
  eq(s.prompt.kind, 'phrase'); // drawing the seed phrase
  eq(s.prompt.chainId, s.myChainId);
  // the prompt text is the prior author's phrase on MY assigned chain only
  const myChain = g.chains.find((c) => c.id === s.myChainId);
  eq(s.prompt.text, myChain.items[0].text);
});

test('barrier waits for everyone; double submit ignored', () => {
  const g = newGame(['a', 'b', 'c']);
  completeStep(g); // draw step
  const [a, b, c] = g.players;
  g.canvases[g.assignment[a]].addStroke(a, { points: [{ x: 2, y: 2 }] }, clk++);
  g.handleAction(a, { type: 'submitDraw' });
  g.handleAction(a, { type: 'submitDraw' }); // duplicate ignored
  eq(g.submitted.size, 1);
  eq(g.state, 'step'); // not all in yet
});

test('full game runs all steps, reveal, voting, finish; ranks all N', () => {
  for (const n of [3, 4]) {
    clk += 1000;
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'writing' || g.state === 'step') completeStep(g);
      else if (g.state === 'reveal') g.handleAction(g.players[0], { type: 'advanceReveal' });
      else if (g.state === 'voting') {
        for (const p of [...g.players]) {
          const target = g.chains.find((c) => c.ownerId !== p);
          g.handleAction(p, { type: 'vote', chainId: target.id });
        }
      }
    }
    eq(g.state, 'finished', `n=${n} finished`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].placement, 1);
    res.forEach((e) => assert(typeof e.placement === 'number'));
  }
});

test('cannot vote for your own chain', () => {
  const g = newGame(['a', 'b', 'c']);
  let guard = 0;
  while (g.state !== 'voting' && guard++ < 100) {
    if (g.state === 'writing' || g.state === 'step') completeStep(g);
    else if (g.state === 'reveal') g.handleAction(g.players[0], { type: 'advanceReveal' });
  }
  eq(g.state, 'voting');
  const a = g.players[0];
  const ownChain = g.chains.find((c) => c.ownerId === a);
  g.handleAction(a, { type: 'vote', chainId: ownChain.id });
  eq(g.votes[a], undefined); // rejected
});

test('write timeout auto-fills missing phrases and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  g.handleAction('a', { type: 'submitPhrase', text: 'hello' });
  advance(50_000);
  eq(g.state, 'step'); // advanced despite b,c not submitting
  for (const c of g.chains) eq(c.items.length, 1); // all seeded (some blank)
});

test('step timeout auto-fills non-submitters and advances', () => {
  const g = newGame(['a', 'b', 'c']);
  completeStep(g); // draw step, fresh
  const before = g.stepIndex;
  advance(70_000);
  assert(g.stepIndex > before || g.state === 'reveal', 'advanced past the step');
});

test('leave of the last-needed submitter advances the step (no deadlock)', () => {
  const g = newGame(['a', 'b', 'c']);
  completeStep(g); // draw step
  const [a, b, c] = g.players;
  g.canvases[g.assignment[a]].addStroke(a, { points: [{ x: 1, y: 1 }] }, clk++);
  g.handleAction(a, { type: 'submitDraw' });
  g.canvases[g.assignment[b]].addStroke(b, { points: [{ x: 1, y: 1 }] }, clk++);
  g.handleAction(b, { type: 'submitDraw' });
  g.removePlayer(c); // c was the last one owing
  assert(g.stepIndex >= 2 || g.state === 'reveal' || g.state === 'finished', `advanced (got ${g.state} step ${g.stepIndex})`);
  assert(!g.getResults().some((r) => r.playerId === c), 'leaver pruned');
});

test('leaving down to one finishes; destroy clears timers', () => {
  const g = newGame(['a', 'b', 'c']);
  g.removePlayer('b');
  g.removePlayer('c');
  eq(g.players.length, 1);
  eq(g.state, 'finished');
  g.destroy();
  eq(pendingTimers(), 0);
});

test('private canvas: each chain canvas only accepts its assigned drawer', () => {
  const g = newGame(['a', 'b', 'c']);
  completeStep(g); // draw step
  const a = g.players[0];
  const myCid = g.assignment[a];
  const other = g.players.find((p) => g.assignment[p] !== myCid);
  eq(g.canvases[myCid].addStroke(other, { points: [{ x: 1, y: 1 }] }, clk++).ok, false);
  eq(g.canvases[myCid].addStroke(a, { points: [{ x: 1, y: 1 }] }, clk++).ok, true);
});

uninstallClock();
report('TelephonePictionary');
