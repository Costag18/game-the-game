import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { Roulette } from '../../src/games/Roulette.js';

// Helper: send acknowledge from all players (advances from spinning state)
function _acknowledgeAll(game) {
  for (const p of game.players) {
    game.handleAction(p, { type: 'acknowledge' });
  }
}

describe('Roulette', () => {
  let game;

  beforeEach(() => {
    game = new Roulette(['p1', 'p2']);
  });

  test('starts in waiting state', () => {
    expect(game.state).toBe('waiting');
  });

  test('startGame gives each player 1000 chips', () => {
    game.startGame();
    expect(game.chips['p1']).toBe(1000);
    expect(game.chips['p2']).toBe(1000);
  });

  test('startGame transitions to betting state', () => {
    game.startGame();
    expect(game.state).toBe('betting');
  });

  test('valid bet is accepted', () => {
    game.startGame();
    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 100 }] });
    expect(game.betSubmitted['p1']).toBe(true);
    expect(game.bets['p1']).toHaveLength(1);
  });

  test('over-budget bet is rejected', () => {
    game.startGame();
    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 1500 }] });
    expect(game.betSubmitted['p1']).toBe(false);
  });

  test('multiple bets exceeding budget are rejected', () => {
    game.startGame();
    game.handleAction('p1', {
      type: 'bet',
      bets: [{ type: 'red', amount: 600 }, { type: 'black', amount: 600 }],
    });
    expect(game.betSubmitted['p1']).toBe(false);
  });

  test('straight bet pays 35:1', () => {
    game.startGame();
    // Mock the spin to land on number 7
    game._spin = function () {
      this.transition('spin');
      this.spinResult = 7;
      const result = 7;
      const payouts = {};
      for (const p of this.players) {
        const betList = this.bets[p] || [];
        let netChange = -this._totalBetAmount(betList);
        for (const bet of betList) {
          netChange += this._calculatePayout(bet, result);
        }
        this.chips[p] = Math.max(0, this.chips[p] + netChange);
        payouts[p] = netChange;
      }
      this.history.push({ round: this.round, result, payouts });
      this.acknowledged = new Set();
      // Stay in spinning state (like the real engine)
    };

    game.bets['p1'] = [{ type: 'straight', value: 7, amount: 100 }];
    game.bets['p2'] = [{ type: 'red', amount: 50 }];
    game.betSubmitted['p1'] = false;
    game.betSubmitted['p2'] = false;

    // Submit bets to trigger spin
    game.handleAction('p1', { type: 'bet', bets: [{ type: 'straight', value: 7, amount: 100 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'red', amount: 50 }] });

    // p1 bet 100 straight on 7, result is 7 => wins 35:1 => net +3500
    expect(game.chips['p1']).toBe(1000 - 100 + 3600); // 1000 - 100 bet + 3600 return
  });

  test('color bet pays 1:1', () => {
    game.startGame();

    // Force spin to red number (e.g. 1)
    const originalRandom = Math.random;
    Math.random = () => 1 / 37; // ~0.027 => Math.floor(0.027 * 37) = 1

    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 100 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'black', amount: 100 }] });

    Math.random = originalRandom;

    // p1 bet red, result was 1 (red) => net +100
    expect(game.chips['p1']).toBe(1100);
    // p2 bet black, result was 1 (red) => net -100
    expect(game.chips['p2']).toBe(900);
  });

  test('0 loses color, odd/even bets', () => {
    game.startGame();

    // Force spin to 0
    const originalRandom = Math.random;
    Math.random = () => 0; // Math.floor(0 * 37) = 0

    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 100 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'odd', amount: 100 }] });

    Math.random = originalRandom;

    expect(game.chips['p1']).toBe(900);  // lost
    expect(game.chips['p2']).toBe(900);  // lost
  });

  test('straight bet on wrong number loses', () => {
    game.startGame();

    // Force spin to 1
    const originalRandom = Math.random;
    Math.random = () => 1 / 37;

    game.handleAction('p1', { type: 'bet', bets: [{ type: 'straight', value: 36, amount: 100 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'red', amount: 50 }] });

    Math.random = originalRandom;

    expect(game.chips['p1']).toBe(900); // lost straight bet
  });

  test('3 rounds then game finishes after all acknowledges', () => {
    game.startGame();

    const originalRandom = Math.random;
    Math.random = () => 0.5;

    for (let round = 0; round < 3; round++) {
      game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
      game.handleAction('p2', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
      // After both bets submitted, spin fires — state moves to 'spinning'
      expect(game.state).toBe('spinning');
      _acknowledgeAll(game);
    }

    Math.random = originalRandom;

    expect(game.state).toBe('finished');
    expect(game.isComplete()).toBe(true);
  });

  test('1 round completes when bets submitted and acknowledged', () => {
    game.startGame();
    expect(game.round).toBe(1);

    const originalRandom = Math.random;
    Math.random = () => 0.5;

    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
    // State is now 'spinning' — round not yet incremented
    expect(game.state).toBe('spinning');
    _acknowledgeAll(game);

    Math.random = originalRandom;

    expect(game.round).toBe(2);
    expect(game.state).toBe('betting');
  });

  test('results sorted by chip count descending', () => {
    game.startGame();

    // Force a spin where p1 wins big
    const originalRandom = Math.random;
    Math.random = () => 0;  // result = 0

    // p1 bets straight on 0, p2 bets red
    game.handleAction('p1', { type: 'bet', bets: [{ type: 'straight', value: 0, amount: 500 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'red', amount: 100 }] });
    // spinning state — acknowledge
    _acknowledgeAll(game);

    Math.random = originalRandom;

    // Force remaining rounds
    Math.random = () => 0.5;
    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
    _acknowledgeAll(game);

    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
    _acknowledgeAll(game);

    Math.random = originalRandom;

    const results = game.getResults();
    expect(results[0].placement).toBe(1);
    expect(results[1].placement).toBe(2);
    expect(results[0].chips).toBeGreaterThanOrEqual(results[1].chips);
  });

  test('getStateForPlayer shows own chips and bet state', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.myChips).toBe(1000);
    expect(state.round).toBe(1);
    expect(state.totalRounds).toBe(3);
    expect(state.phase).toBe('betting');
  });

  test('duplicate bet submission is ignored', () => {
    game.startGame();
    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 100 }] });

    // Try to submit again
    game.handleAction('p1', { type: 'bet', bets: [{ type: 'black', amount: 200 }] });

    // Should still only have the first bet
    expect(game.bets['p1']).toHaveLength(1);
    expect(game.bets['p1'][0].type).toBe('red');
  });

  test('isComplete returns false at start', () => {
    game.startGame();
    expect(game.isComplete()).toBe(false);
  });

  test('spin result visible in spinning state', () => {
    game.startGame();

    const originalRandom = Math.random;
    Math.random = () => 0; // result = 0

    game.handleAction('p1', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });
    game.handleAction('p2', { type: 'bet', bets: [{ type: 'red', amount: 10 }] });

    Math.random = originalRandom;

    expect(game.state).toBe('spinning');
    const state = game.getStateForPlayer('p1');
    expect(state.spinResult).toBe(0);
    expect(state.phase).toBe('spinning');
  });
});
