import { installClock, uninstallClock, test, assert, eq, report } from './helpers.mjs';
import { LiarsMarketMatch, ROUNDS } from '../src/games/LiarsMarketMatch.js';
import { LiarsMarket } from '../src/games/LiarsMarket.js';

installClock();

test('announce sets price, flips to responder; respond advances round + swaps announcer', () => {
  const m = new LiarsMarketMatch('a', 'b');
  eq(m.announcer, 'a'); eq(m.responder, 'b');
  eq(m.step, 'announce'); eq(m.turn, 'a');
  eq(m.applyMove('a', { type: 'announce', price: 10 }), true);
  eq(m.price, 10); eq(m.step, 'respond'); eq(m.turn, 'b');
  eq(m.applyMove('b', { type: 'respond', buy: false }), true);
  // next round: announcer swapped to b, price cleared
  eq(m.round, 2); eq(m.announcer, 'b'); eq(m.responder, 'a');
  eq(m.step, 'announce'); eq(m.price, null); eq(m.turn, 'b');
});

test('buy moves money: responder profit += value-price, announcer profit += price', () => {
  const m = new LiarsMarketMatch('a', 'b');
  m.trueValue.a = 15; // a is announcer in round 1
  m.applyMove('a', { type: 'announce', price: 8 });
  m.applyMove('b', { type: 'respond', buy: true });
  eq(m.profit.b, 15 - 8); // responder receives a's true value, pays price
  eq(m.profit.a, 8);      // announcer pockets the price
});

test('out-of-turn and wrong-step moves rejected', () => {
  const m = new LiarsMarketMatch('a', 'b');
  eq(m.applyMove('b', { type: 'announce', price: 5 }), false); // not b's turn
  eq(m.applyMove('a', { type: 'respond', buy: true }), false); // wrong step (announce expected)
  eq(m.applyMove('a', { type: 'announce', price: 0 }), false); // price below min
  eq(m.applyMove('a', { type: 'announce', price: 21 }), false); // price above max
  eq(m.applyMove('a', { type: 'announce', price: 3.5 }), false); // non-integer
  eq(m.applyMove('a', { type: 'announce', price: 12 }), true); // legal
  eq(m.applyMove('a', { type: 'respond', buy: true }), false); // not responder's turn
});

test('game ends after 6 rounds; higher net profit wins; turn null when over', () => {
  const m = new LiarsMarketMatch('a', 'b');
  // jump near the end: simulate being at round 6 with a leading
  m.profit.a = 30; m.profit.b = 5;
  m.round = ROUNDS; m.announcer = 'a'; m.responder = 'b'; m.step = 'announce'; m.turn = 'a';
  m.applyMove('a', { type: 'announce', price: 1 });
  m.applyMove('b', { type: 'respond', buy: false }); // no money moves
  eq(m.isOver(), true);
  eq(m.winner(), 'a');
  eq(m.turn, null);
  assert(!m.isDraw(), 'not a draw');
});

test('equal profit is a draw', () => {
  const m = new LiarsMarketMatch('a', 'b');
  m.profit.a = 7; m.profit.b = 7;
  m.round = ROUNDS; m.announcer = 'b'; m.responder = 'a'; m.step = 'announce'; m.turn = 'b';
  m.applyMove('b', { type: 'announce', price: 4 });
  m.applyMove('a', { type: 'respond', buy: false });
  eq(m.isOver(), true);
  eq(m.winner(), null);
  eq(m.isDraw(), true);
});

test('scoreDiff sign: +1000+margin win / -1000-margin loss / margin pre-finish', () => {
  const m = new LiarsMarketMatch('a', 'b');
  m.profit.a = 20; m.profit.b = 5;
  // pre-finish: scoreDiff is just the margin
  eq(m.scoreDiff('a'), 15);
  eq(m.scoreDiff('b'), -15);
  m.round = ROUNDS; m.announcer = 'a'; m.responder = 'b'; m.step = 'announce'; m.turn = 'a';
  m.applyMove('a', { type: 'announce', price: 1 });
  m.applyMove('b', { type: 'respond', buy: false });
  eq(m.scoreDiff('a'), 1000 + 15);
  eq(m.scoreDiff('b'), -1000 - 15);
});

test('autoMove returns a legal move for both steps', () => {
  const m = new LiarsMarketMatch('a', 'b');
  const am = m.autoMove();
  assert(am && am.type === 'announce' && am.price >= 1 && am.price <= 20, 'legal announce auto-move');
  eq(m.applyMove(m.turn, am), true);
  const rm = m.autoMove();
  assert(rm && rm.type === 'respond' && typeof rm.buy === 'boolean', 'legal respond auto-move');
  eq(m.applyMove(m.turn, rm), true);
});

test('hidden-info: getView reveals OWN value but NEVER opponent value until over', () => {
  const m = new LiarsMarketMatch('a', 'b');
  m.trueValue.a = 17; m.trueValue.b = 4;
  const va = m.getView('a');
  eq(va.myValue, 17);
  eq(va.oppValue, null); // a must not see b's secret mid-game
  const vb = m.getView('b');
  eq(vb.myValue, 4);
  eq(vb.oppValue, null); // b must not see a's secret mid-game
  // play out all rounds, then the opponent value is revealed
  let guard = 0;
  while (!m.isOver() && guard++ < 50) {
    m.applyMove(m.turn, m.autoMove());
  }
  eq(m.isOver(), true);
  eq(m.getView('a').oppValue, 4);
  eq(m.getView('b').oppValue, 17);
});

test('LiarsMarket wraps PairingEngine: full game ranks all N', () => {
  for (const n of [2, 3, 4]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = new LiarsMarket(players);
    g.setOnStateChange(() => {});
    g.startGame();
    eq(g.state, 'match');
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 200) {
      if (g.state === 'match') {
        for (const m of g.matches) {
          if (m.over || m.isBye || !m.engine) continue;
          let inner = 0;
          while (!m.engine.isOver() && inner++ < 100) {
            const turnPlayer = m.engine.getView(m.engine.p1).turn;
            m.engine.applyMove(turnPlayer, m.engine.autoMove());
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
report("Liar's Market");
