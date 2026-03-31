import { describe, test, expect } from '@jest/globals';
import { BaseGame } from '../../src/games/BaseGame.js';

// A concrete subclass for testing
const testFsmConfig = {
  initialState: 'waiting',
  transitions: {
    waiting: {
      start: 'playing',
    },
    playing: {
      finish: 'finished',
      pause: 'paused',
    },
    paused: {
      resume: 'playing',
    },
    finished: {},
  },
};

class TestGame extends BaseGame {
  constructor(players) {
    super(players, testFsmConfig);
    this.enterPlayingCalled = false;
    this.enterFinishedCalled = false;
  }

  onEnterPlaying() {
    this.enterPlayingCalled = true;
  }

  onEnterFinished() {
    this.enterFinishedCalled = true;
  }

  getStateForPlayer(playerId) {
    return {
      state: this.state,
      currentTurnPlayer: this.currentTurnPlayer,
      isYourTurn: this.currentTurnPlayer === playerId,
    };
  }

  isComplete() {
    return this.state === 'finished';
  }

  getResults() {
    return this.activePlayers.map((p, i) => ({ playerId: p, placement: i + 1 }));
  }
}

describe('BaseGame', () => {
  test('initializes with correct state', () => {
    const game = new TestGame(['p1', 'p2', 'p3']);
    expect(game.state).toBe('waiting');
    expect(game.players).toEqual(['p1', 'p2', 'p3']);
    expect(game.activePlayers).toEqual(['p1', 'p2', 'p3']);
    expect(game.currentTurnPlayer).toBeNull();
    expect(game.turnIndex).toBe(0);
  });

  test('players and activePlayers are copies, not references', () => {
    const players = ['p1', 'p2'];
    const game = new TestGame(players);
    players.push('p3');
    expect(game.players).toHaveLength(2);
    expect(game.activePlayers).toHaveLength(2);
  });

  test('transitions between states', () => {
    const game = new TestGame(['p1', 'p2']);
    expect(game.state).toBe('waiting');
    game.transition('start');
    expect(game.state).toBe('playing');
    game.transition('finish');
    expect(game.state).toBe('finished');
  });

  test('calls onEnter hook after transition', () => {
    const game = new TestGame(['p1', 'p2']);
    expect(game.enterPlayingCalled).toBe(false);
    game.transition('start');
    expect(game.enterPlayingCalled).toBe(true);
    expect(game.enterFinishedCalled).toBe(false);
    game.transition('finish');
    expect(game.enterFinishedCalled).toBe(true);
  });

  test('rejects invalid transitions (throws)', () => {
    const game = new TestGame(['p1', 'p2']);
    expect(() => game.transition('finish')).toThrow(
      'Invalid transition: "finish" from state "waiting"'
    );
  });

  test('throws on unknown action from a valid state', () => {
    const game = new TestGame(['p1', 'p2']);
    game.transition('start'); // now in 'playing'
    expect(() => game.transition('nonexistent')).toThrow(
      'Invalid transition: "nonexistent" from state "playing"'
    );
  });

  test('setTurnPlayer updates current turn and turnIndex', () => {
    const game = new TestGame(['p1', 'p2', 'p3']);
    game.setTurnPlayer('p2');
    expect(game.currentTurnPlayer).toBe('p2');
    expect(game.turnIndex).toBe(1);
  });

  test('nextTurn cycles through players', () => {
    const game = new TestGame(['p1', 'p2', 'p3']);
    game.setTurnPlayer('p1');
    expect(game.nextTurn()).toBe('p2');
    expect(game.currentTurnPlayer).toBe('p2');
    expect(game.nextTurn()).toBe('p3');
    expect(game.nextTurn()).toBe('p1'); // wraps around
  });

  test('removePlayer removes from activePlayers', () => {
    const game = new TestGame(['p1', 'p2', 'p3']);
    game.removePlayer('p2');
    expect(game.activePlayers).toEqual(['p1', 'p3']);
    expect(game.players).toEqual(['p1', 'p2', 'p3']); // original unchanged
  });

  test('removePlayer advances turn when current player is removed', () => {
    const game = new TestGame(['p1', 'p2', 'p3']);
    game.setTurnPlayer('p2'); // turnIndex = 1
    game.removePlayer('p2');
    // activePlayers is now ['p1', 'p3'], turnIndex should clamp to 1 % 2 = 1
    expect(game.activePlayers).toEqual(['p1', 'p3']);
    expect(game.currentTurnPlayer).toBe('p3');
  });

  test('removePlayer with last player sets currentTurnPlayer to null', () => {
    const game = new TestGame(['p1']);
    game.setTurnPlayer('p1');
    game.removePlayer('p1');
    expect(game.activePlayers).toEqual([]);
    expect(game.currentTurnPlayer).toBeNull();
  });

  test('getStateForPlayer returns filtered view', () => {
    const game = new TestGame(['p1', 'p2']);
    game.setTurnPlayer('p1');
    const stateForP1 = game.getStateForPlayer('p1');
    const stateForP2 = game.getStateForPlayer('p2');
    expect(stateForP1.state).toBe('waiting');
    expect(stateForP1.isYourTurn).toBe(true);
    expect(stateForP2.isYourTurn).toBe(false);
  });

  test('isComplete returns false initially', () => {
    const game = new TestGame(['p1', 'p2']);
    expect(game.isComplete()).toBe(false);
  });

  test('isComplete returns true after finish', () => {
    const game = new TestGame(['p1', 'p2']);
    game.transition('start');
    game.transition('finish');
    expect(game.isComplete()).toBe(true);
  });

  test('getResults returns placements', () => {
    const game = new TestGame(['p1', 'p2', 'p3']);
    const results = game.getResults();
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ playerId: 'p1', placement: 1 });
    expect(results[1]).toEqual({ playerId: 'p2', placement: 2 });
    expect(results[2]).toEqual({ playerId: 'p3', placement: 3 });
  });
});
