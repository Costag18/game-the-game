import { installClock, uninstallClock, advance, test, assert, eq, report } from './helpers.mjs';
import { NimHeistMatch } from '../src/games/NimHeistMatch.js';
import { NimHeist } from '../src/games/NimHeist.js';

installClock();

const take = (m, pid, pile, count) => m.applyMove(pid, { pile, count });

test('legal take removes tokens and flips the turn', () => {
  const m = new NimHeistMatch('a', 'b');
  eq(take(m, 'a', 2, 3), true);
  eq(m.piles[2], 4); // 7 - 3
  eq(m.turn, 'b');
  eq(m.lastMove.pile, 2);
  eq(m.lastMove.count, 3);
});

test('out-of-turn take rejected; illegal counts rejected', () => {
  const m = new NimHeistMatch('a', 'b');
  eq(take(m, 'b', 0, 1), false); // not b's turn
  eq(take(m, 'a', 0, 0), false); // count < 1
  eq(take(m, 'a', 0, 4), false); // count > pile (pile 0 = 3)
  eq(take(m, 'a', 5, 1), false); // bad pile index
  eq(take(m, 'a', 1, 1.5), false); // non-integer count
  eq(m.turn, 'a'); // nothing happened, still a's turn
});

test('taking the last token overall LOSES (misère)', () => {
  const m = new NimHeistMatch('a', 'b');
  // construct a near-end board: only one token left, in pile 0
  m.piles = [1, 0, 0];
  m.turn = 'a';
  eq(take(m, 'a', 0, 1), true); // a takes the last token
  eq(m.isOver(), true);
  eq(m.winner(), 'b'); // a took the last → a loses, b wins
});

test('emptying your own pile but not the board just flips the turn', () => {
  const m = new NimHeistMatch('a', 'b');
  m.piles = [2, 3, 0];
  m.turn = 'a';
  eq(take(m, 'a', 0, 2), true); // empties pile 0 but board not empty
  eq(m.isOver(), false);
  eq(m.turn, 'b');
});

test('scoreDiff is +1000 win / -1000 loss', () => {
  const m = new NimHeistMatch('a', 'b');
  m.piles = [1, 0, 0];
  m.turn = 'a';
  take(m, 'a', 0, 1); // a takes last → a loses, b wins
  eq(m.scoreDiff('b'), 1000);
  eq(m.scoreDiff('a'), -1000);
});

test('autoMove returns a legal take; null on empty board', () => {
  const m = new NimHeistMatch('a', 'b');
  const am = m.autoMove();
  assert(am && am.pile >= 0 && am.pile < m.piles.length, 'legal pile');
  assert(am.count >= 1 && am.count <= m.piles[am.pile], 'legal count');
  // exhaust the board → null
  m.piles = [0, 0, 0];
  eq(m.autoMove(), null);
});

test('getView exposes piles, turn, isMyTurn, totalTokens', () => {
  const m = new NimHeistMatch('a', 'b');
  const v = m.getView('a');
  eq(v.totalTokens, 15);
  eq(v.isMyTurn, true);
  eq(v.turn, 'a');
  eq(v.piles.length, 3);
  eq(m.getView('b').isMyTurn, false);
});

test('per-turn timeout auto-takes (does not forfeit) for Nim Heist', () => {
  const g = new NimHeist(['a', 'b']);
  g.setOnStateChange(() => {});
  g.startGame();
  const m = g.matches[0];
  const before = m.engine._totalTokens();
  advance(30_000); // per-turn timer → autoMove
  // either the match progressed by an auto-take or it resolved into summary
  assert((m.engine && m.engine._totalTokens() < before) || g.state === 'miniRoundSummary', 'auto-took, not forfeited');
});

test('NimHeist wraps PairingEngine: full game ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = new NimHeist(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          let safety = 0;
          while (!m.engine.isOver() && safety++ < 200) {
            m.engine.applyMove(m.engine.turn, m.engine.autoMove());
          }
          if (m.engine.isOver()) g._resolveMatch(g.matches.indexOf(m));
        }
      } else if (g.state === 'miniRoundSummary') {
        for (const p of [...g.players]) g.handleAction(p, { type: 'acknowledge' });
      }
    }
    eq(g.state, 'finished');
    const res = g.getResults();
    eq(res.length, n);
    eq(res[0].placement, 1);
  }
});

uninstallClock();
report('NimHeist');
