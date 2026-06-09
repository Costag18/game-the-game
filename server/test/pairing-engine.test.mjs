import { installClock, uninstallClock, advance, pendingTimers, test, assert, eq, report } from './helpers.mjs';
import { PairingEngine } from '../src/games/PairingEngine.js';

installClock();

// Deterministic 1v1 stub: the player on turn can win/draw, or pass the turn.
class StubMatch {
  constructor(p1, p2) { this.p1 = p1; this.p2 = p2; this.turn = p1; this._over = false; this._winner = null; }
  applyMove(pid, move) {
    if (this._over || pid !== this.turn) return false;
    if (move && move.win) { this._over = true; this._winner = pid; return true; }
    if (move && move.draw) { this._over = true; this._winner = null; return true; }
    this.turn = this.turn === this.p1 ? this.p2 : this.p1;
    return true;
  }
  getView(pid) { return { board: [], turn: this.turn, isMyTurn: this.turn === pid }; }
  isOver() { return this._over; }
  winner() { return this._winner; }
  isDraw() { return this._over && this._winner === null; }
  scoreDiff(pid) { if (!this._over || this._winner === null) return 0; return this._winner === pid ? 1000 : -1000; }
  destroy() {}
}

function newGame(players, opts = {}) {
  const g = new PairingEngine(players, { matchFactory: (a, b) => new StubMatch(a, b), miniRounds: 3, ...opts });
  g.emitCount = 0;
  g.setOnStateChange(() => { g.emitCount++; });
  g.startGame();
  return g;
}
// resolve every live match this mini-round by having the on-turn player win
function resolveAllMatches(g) {
  for (let mi = 0; mi < g.matches.length; mi++) {
    const m = g.matches[mi];
    if (m.over || m.isBye || !m.engine) continue;
    g.handleAction(m.engine.turn, { type: 'move', move: { win: true } });
  }
}
const ackAll = (g) => { for (const p of [...g.players]) g.handleAction(p, { type: 'acknowledge' }); };

test('startGame builds mini-round 1; odd N gives one bye = free win', () => {
  const g = newGame(['a', 'b', 'c', 'd', 'e']);
  eq(g.state, 'match');
  eq(g.miniRound, 1);
  const byeMatches = g.matches.filter((m) => m.isBye);
  eq(byeMatches.length, 1);
  eq(g.wins[byeMatches[0].p1], 1); // bye credited
  eq(g.matches.filter((m) => !m.isBye).length, 2); // 2 real matches
});

test('resolving all matches trips the barrier into miniRoundSummary', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  resolveAllMatches(g);
  eq(g.state, 'miniRoundSummary');
  assert(g.lastMiniRound && g.lastMiniRound.pairings.length >= 1, 'summary snapshot built');
});

test('fast finisher waits at the barrier; waitingOn lists the slow pairing', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  // resolve only the first real match
  const first = g.matches.find((m) => !m.isBye);
  g.handleAction(first.engine.turn, { type: 'move', move: { win: true } });
  eq(g.state, 'match'); // barrier not tripped — other match still live
  const winnerView = g.getStateForPlayer(first.p1);
  eq(winnerView.myMiniRoundDone, true);
  assert(winnerView.waitingOn.length >= 2, 'still waiting on the other pairing');
});

test('full game finishes after K mini-rounds; results rank all N', () => {
  for (const n of [2, 3, 4, 6]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = newGame(players);
    let guard = 0;
    while (g.state !== 'finished' && guard++ < 40) {
      if (g.state === 'match') resolveAllMatches(g);
      else if (g.state === 'miniRoundSummary') ackAll(g);
    }
    eq(g.state, 'finished', `n=${n} finished`);
    const res = g.getResults();
    eq(res.length, n, `n=${n} ranks everyone`);
    eq(res[0].placement, 1);
    res.forEach((e) => assert(typeof e.placement === 'number'));
  }
});

test('per-turn timeout forfeits the staller and broadcasts', () => {
  const g = newGame(['a', 'b']);
  const m = g.matches[0];
  const staller = m.engine.turn;
  const opp = staller === m.p1 ? m.p2 : m.p1;
  const before = g.emitCount;
  advance(30_000); // matchTimerSec default
  eq(m.over, true);
  eq(g.wins[opp], 1);
  assert(g.emitCount > before, 'forfeit broadcast');
});

test('a draw awards half a win to each player', () => {
  const g = newGame(['a', 'b']);
  const m = g.matches[0];
  g.handleAction(m.engine.turn, { type: 'move', move: { draw: true } });
  eq(g.state, 'miniRoundSummary');
  eq(g.wins['a'], 0.5);
  eq(g.wins['b'], 0.5);
  assert(g.lastMiniRound.pairings[0].draw, 'summary marks draw');
});

test('illegal/foreign moves are ignored', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const m = g.matches.find((x) => !x.isBye);
  const offTurn = m.engine.turn === m.p1 ? m.p2 : m.p1;
  g.handleAction(offTurn, { type: 'move', move: { win: true } }); // not their turn
  eq(m.over, false);
  g.handleAction('zzz', { type: 'move', move: { win: true } }); // not a player
  eq(m.over, false);
});

test('leave mid-match forfeits to the opponent and excludes leaver from results', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const m = g.matches.find((x) => !x.isBye);
  const leaver = m.p1;
  const opp = m.p2;
  g.removePlayer(leaver);
  eq(m.over, true);
  eq(g.wins[opp], 1);
  assert(!g.getResults().some((r) => r.playerId === leaver), 'leaver pruned');
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

test('summary ack auto-advances after 10s', () => {
  const g = newGame(['a', 'b']);
  g.handleAction(g.matches[0].engine.turn, { type: 'move', move: { win: true } });
  eq(g.state, 'miniRoundSummary');
  const before = g.emitCount;
  advance(10_000);
  eq(g.state, 'match'); // advanced to mini-round 2
  assert(g.emitCount > before, 'auto-advance broadcast');
});

test('hidden routing: a player only ever sees their own match board', () => {
  const g = newGame(['a', 'b', 'c', 'd']);
  const s = g.getStateForPlayer('a');
  assert(!('matches' in s), 'no raw matches array');
  // myMatch is only a's pairing; opponentId is a real opponent or null (bye)
  if (s.myMatch && !s.myMatch.isBye) {
    assert([s.myMatch.opponentId].every((o) => g.players.includes(o)), 'opponent is a real player');
  }
});

uninstallClock();
report('PairingEngine');
