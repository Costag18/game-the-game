import { describe, test, expect, beforeEach } from '@jest/globals';
import { RockPaperScissors } from '../../src/games/RockPaperScissors.js';

// Helper: send acknowledge from all players
function _acknowledgeAll(game) {
  for (const p of game.players) {
    game.handleAction(p, { type: 'acknowledge' });
  }
}

describe('RockPaperScissors', () => {
  let game;

  beforeEach(() => {
    game = new RockPaperScissors(['p1', 'p2']);
  });

  test('starts in waiting state', () => {
    expect(game.state).toBe('waiting');
  });

  test('startGame transitions to round state', () => {
    game.startGame();
    expect(game.state).toBe('round');
  });

  test('startGame initializes scores to 0', () => {
    game.startGame();
    expect(game.scores['p1']).toBe(0);
    expect(game.scores['p2']).toBe(0);
  });

  test('startGame sets round number to 1', () => {
    game.startGame();
    expect(game.roundNumber).toBe(1);
  });

  test('both players choosing triggers reveal transition', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    expect(game.state).toBe('round'); // only one chosen
    game.handleAction('p2', { type: 'choose', choice: 'scissors' });
    expect(game.state).toBe('reveal');
  });

  test('rock beats scissors — p1 wins round', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    game.handleAction('p2', { type: 'choose', choice: 'scissors' });
    expect(game.scores['p1']).toBe(1);
    expect(game.scores['p2']).toBe(0);
    expect(game.lastRoundResult.winner).toBe('p1');
  });

  test('paper beats rock — p2 wins round', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    game.handleAction('p2', { type: 'choose', choice: 'paper' });
    expect(game.scores['p2']).toBe(1);
    expect(game.scores['p1']).toBe(0);
    expect(game.lastRoundResult.winner).toBe('p2');
  });

  test('scissors beats paper — p1 wins round', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'scissors' });
    game.handleAction('p2', { type: 'choose', choice: 'paper' });
    expect(game.scores['p1']).toBe(1);
    expect(game.scores['p2']).toBe(0);
  });

  test('tie gives no point to either player', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    game.handleAction('p2', { type: 'choose', choice: 'rock' });
    expect(game.scores['p1']).toBe(0);
    expect(game.scores['p2']).toBe(0);
    expect(game.lastRoundResult.tie).toBe(true);
    expect(game.lastRoundResult.winner).toBeNull();
  });

  test('first player to reach 3 wins ends the game after acknowledge', () => {
    game.startGame();
    // p1 wins 3 rounds, each followed by acknowledge
    for (let i = 0; i < 3; i++) {
      game.handleAction('p1', { type: 'choose', choice: 'rock' });
      game.handleAction('p2', { type: 'choose', choice: 'scissors' });
      expect(game.state).toBe('reveal');
      if (i < 2) {
        // Not the final round yet — acknowledge advances to next round
        _acknowledgeAll(game);
        expect(game.state).toBe('round');
      }
    }
    // After 3rd win, acknowledge should finish the game
    _acknowledgeAll(game);
    expect(game.state).toBe('finished');
    expect(game.isComplete()).toBe(true);
    expect(game.scores['p1']).toBe(3);
  });

  test('getResults returns winner first', () => {
    game.startGame();
    for (let i = 0; i < 3; i++) {
      game.handleAction('p1', { type: 'choose', choice: 'rock' });
      game.handleAction('p2', { type: 'choose', choice: 'scissors' });
      if (i < 2) {
        _acknowledgeAll(game);
      }
    }
    _acknowledgeAll(game);
    expect(game.state).toBe('finished');
    const results = game.getResults();
    expect(results[0].playerId).toBe('p1');
    expect(results[0].placement).toBe(1);
    expect(results[1].playerId).toBe('p2');
    expect(results[1].placement).toBe(2);
  });

  test('getStateForPlayer hides opponent choice during round phase', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    const state = game.getStateForPlayer('p1');
    expect(state.phase).toBe('round');
    expect(state.myChoice).toBe('rock');
    expect(state.opponentChoice).toBeNull();
  });

  test('getStateForPlayer reveals opponent choice after reveal', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    game.handleAction('p2', { type: 'choose', choice: 'scissors' });
    expect(game.state).toBe('reveal');
    const state = game.getStateForPlayer('p1');
    expect(state.opponentChoice).toBe('scissors');
    expect(state.myChoice).toBe('rock');
  });

  test('duplicate choice from same player is ignored', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    game.handleAction('p1', { type: 'choose', choice: 'paper' }); // should be ignored
    expect(game.choices['p1']).toBe('rock');
  });

  test('invalid choice is ignored', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'gun' });
    expect(game.choices['p1']).toBeUndefined();
  });

  test('isComplete returns false at start of game', () => {
    game.startGame();
    expect(game.isComplete()).toBe(false);
  });

  test('advanceToNextRound increments round number', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    game.handleAction('p2', { type: 'choose', choice: 'rock' }); // tie
    expect(game.roundNumber).toBe(1);
    expect(game.state).toBe('reveal');
    game.advanceToNextRound();
    expect(game.roundNumber).toBe(2);
    expect(game.state).toBe('round');
  });

  test('acknowledge advances round after reveal', () => {
    game.startGame();
    game.handleAction('p1', { type: 'choose', choice: 'rock' });
    game.handleAction('p2', { type: 'choose', choice: 'rock' }); // tie, goes to reveal
    expect(game.state).toBe('reveal');
    _acknowledgeAll(game);
    expect(game.state).toBe('round');
    expect(game.roundNumber).toBe(2);
  });
});
