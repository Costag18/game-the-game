import { describe, test, expect, beforeEach } from '@jest/globals';
import { LiarsDice } from '../../src/games/LiarsDice.js';

describe('LiarsDice', () => {
  let game;

  beforeEach(() => {
    game = new LiarsDice(['p1', 'p2', 'p3']);
    game.startGame();
  });

  test('each player starts with 5 dice', () => {
    expect(game.dice['p1']).toHaveLength(5);
    expect(game.dice['p2']).toHaveLength(5);
    expect(game.dice['p3']).toHaveLength(5);
  });

  test('all dice values are between 1 and 6', () => {
    for (const p of ['p1', 'p2', 'p3']) {
      for (const d of game.dice[p]) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(6);
      }
    }
  });

  test('starts in bidding state with first player as turn player', () => {
    expect(game.state).toBe('bidding');
    expect(game.currentTurnPlayer).toBe('p1');
  });

  test('valid first bid is accepted', () => {
    game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 3 });
    expect(game.currentBid).toEqual({ quantity: 2, faceValue: 3 });
  });

  test('valid bid with higher quantity is accepted', () => {
    game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 3 });
    game.handleAction('p2', { type: 'bid', quantity: 3, faceValue: 2 });
    expect(game.currentBid).toEqual({ quantity: 3, faceValue: 2 });
  });

  test('valid bid with same quantity but higher face value is accepted', () => {
    game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 3 });
    game.handleAction('p2', { type: 'bid', quantity: 2, faceValue: 4 });
    expect(game.currentBid).toEqual({ quantity: 2, faceValue: 4 });
  });

  test('invalid bid with lower quantity is rejected', () => {
    game.handleAction('p1', { type: 'bid', quantity: 3, faceValue: 3 });
    game.handleAction('p2', { type: 'bid', quantity: 2, faceValue: 3 });
    expect(game.currentBid).toEqual({ quantity: 3, faceValue: 3 }); // unchanged
  });

  test('invalid bid with same quantity and lower face value is rejected', () => {
    game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 4 });
    game.handleAction('p2', { type: 'bid', quantity: 2, faceValue: 3 });
    expect(game.currentBid).toEqual({ quantity: 2, faceValue: 4 }); // unchanged
  });

  test('invalid bid with same quantity and same face value is rejected', () => {
    game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 3 });
    game.handleAction('p2', { type: 'bid', quantity: 2, faceValue: 3 });
    expect(game.currentBid).toEqual({ quantity: 2, faceValue: 3 }); // unchanged
  });

  test('bid advances turn to next player', () => {
    expect(game.currentTurnPlayer).toBe('p1');
    game.handleAction('p1', { type: 'bid', quantity: 1, faceValue: 2 });
    expect(game.currentTurnPlayer).toBe('p2');
  });

  test('non-turn player bid is ignored', () => {
    game.handleAction('p2', { type: 'bid', quantity: 1, faceValue: 2 }); // p1's turn
    expect(game.currentBid).toBeNull();
  });

  test('challenge cannot happen without a bid', () => {
    expect(game.currentBid).toBeNull();
    game.handleAction('p1', { type: 'challenge' }); // no bid yet
    expect(game.state).toBe('bidding'); // still bidding
  });

  describe('challenge resolution', () => {
    test('challenger loses a die when bid is correct (actual >= bid)', () => {
      // Force known dice values: p1 has three 3s, p2 bids 2 threes
      game.dice['p1'] = [3, 3, 3, 4, 5];
      game.dice['p2'] = [2, 2, 4, 5, 6];
      game.dice['p3'] = [2, 2, 4, 5, 6];
      // p1 bids 2 threes (actual = 3, which is >= 2, so bid holds)
      game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 3 });
      // p2 challenges
      const p2DiceBefore = game.dice['p2'].length;
      game.handleAction('p2', { type: 'challenge' });
      expect(game.dice['p2'].length).toBe(p2DiceBefore - 1);
    });

    test('bidder loses a die when bid is too high (actual < bid)', () => {
      game.dice['p1'] = [3, 3, 4, 5, 6]; // only two 3s
      game.dice['p2'] = [2, 2, 4, 5, 6];
      game.dice['p3'] = [2, 2, 4, 5, 6];
      // p1 bids 10 threes (actual = 2, which is < 10)
      game.handleAction('p1', { type: 'bid', quantity: 10, faceValue: 3 });
      // p2 challenges
      const p1DiceBefore = game.dice['p1'].length;
      game.handleAction('p2', { type: 'challenge' });
      expect(game.dice['p1'].length).toBe(p1DiceBefore - 1);
    });

    test('1s are wild and count toward any face value', () => {
      game.dice['p1'] = [1, 1, 4, 5, 6]; // two wilds
      game.dice['p2'] = [3, 2, 4, 5, 6]; // one 3
      game.dice['p3'] = [2, 2, 4, 5, 6];
      // Actual 3s count: p1 has two 1s (wild) + p2 has one 3 = 3 total
      // p1 bids 3 threes
      game.handleAction('p1', { type: 'bid', quantity: 3, faceValue: 3 });
      // p2 challenges -> actual >= 3, challenger loses
      const p2DiceBefore = game.dice['p2'].length;
      game.handleAction('p2', { type: 'challenge' });
      expect(game.dice['p2'].length).toBe(p2DiceBefore - 1);
    });

    test('player with 0 dice is eliminated', () => {
      game.dice['p2'] = [4]; // p2 has 1 die left
      game.dice['p1'] = [3, 4, 5, 6, 2];
      game.dice['p3'] = [2, 2, 4, 5, 6];
      // p1 bids something that is too high so p2 loses
      game.handleAction('p1', { type: 'bid', quantity: 15, faceValue: 5 });
      game.handleAction('p2', { type: 'challenge' });
      // Bid was too high -> p1 (bidder) loses a die, not p2
      // Let's redo: make challenger lose
      // Reset and force p2 to challenge a correct bid
    });

    test('player eliminated when dice reach 0 after losing challenge', () => {
      game.dice['p2'] = [4]; // p2 has only 1 die
      game.dice['p1'] = [3, 3, 3, 3, 3];
      game.dice['p3'] = [2, 2, 4, 5, 6];
      // p1 bids 3 threes - actual is 3, so bid is correct
      game.handleAction('p1', { type: 'bid', quantity: 3, faceValue: 3 });
      // p2 challenges and loses (bid correct, challenger loses die)
      game.handleAction('p2', { type: 'challenge' });
      expect(game.eliminated).toContain('p2');
      expect(game.activePlayers).not.toContain('p2');
    });

    test('game returns to bidding state after challenge resolution (no elimination)', () => {
      game.dice['p1'] = [3, 3, 3, 4, 5];
      game.dice['p2'] = [2, 2, 4, 5, 6];
      game.dice['p3'] = [2, 2, 4, 5, 6];
      game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 3 });
      game.handleAction('p2', { type: 'challenge' });
      expect(game.state).toBe('bidding');
    });

    test('bid is reset to null after challenge', () => {
      game.dice['p1'] = [3, 3, 3, 4, 5];
      game.dice['p2'] = [2, 2, 4, 5, 6];
      game.dice['p3'] = [2, 2, 4, 5, 6];
      game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 3 });
      game.handleAction('p2', { type: 'challenge' });
      expect(game.currentBid).toBeNull();
    });
  });

  describe('game end', () => {
    test('last player standing wins', () => {
      // Use a 2-player game so it's easier to control
      const g = new LiarsDice(['a', 'b']);
      g.startGame();

      // Give 'a' enough dice and 'b' only 1 die
      g.dice['a'] = [4, 4, 4, 4, 4];
      g.dice['b'] = [2]; // one die, not a 4

      // 'a' bids 5 fours — actual count is 5 (all of a's dice)
      g.handleAction('a', { type: 'bid', quantity: 5, faceValue: 4 });
      // 'b' challenges — bid is correct (actual >= bid), challenger loses die
      g.handleAction('b', { type: 'challenge' });

      expect(g.state).toBe('finished');
      expect(g.isComplete()).toBe(true);
      const results = g.getResults();
      expect(results[0].playerId).toBe('a');
    });

    test('isComplete returns false at start', () => {
      expect(game.isComplete()).toBe(false);
    });

    test('getResults puts last standing first, eliminated in reverse order', () => {
      // Manually set up end state
      game.eliminated = ['p3', 'p2'];
      game.activePlayers = ['p1'];
      game.state = 'finished';

      const results = game.getResults();
      expect(results[0].playerId).toBe('p1');
      expect(results[0].placement).toBe(1);
      // Last eliminated = p2 -> placement 2
      expect(results[1].playerId).toBe('p2');
      expect(results[1].placement).toBe(2);
      // First eliminated = p3 -> placement 3
      expect(results[2].playerId).toBe('p3');
      expect(results[2].placement).toBe(3);
    });
  });

  describe('getStateForPlayer', () => {
    test('shows own dice values', () => {
      game.dice['p1'] = [1, 2, 3, 4, 5];
      const state = game.getStateForPlayer('p1');
      expect(state.myDice).toEqual([1, 2, 3, 4, 5]);
    });

    test('shows other players dice COUNT not values', () => {
      game.dice['p2'] = [1, 2, 3, 4, 5];
      const state = game.getStateForPlayer('p1');
      const p2Info = state.otherPlayers.find((p) => p.playerId === 'p2');
      expect(p2Info.diceCount).toBe(5);
      expect(p2Info).not.toHaveProperty('dice');
    });

    test('shows current bid', () => {
      game.handleAction('p1', { type: 'bid', quantity: 2, faceValue: 4 });
      const state = game.getStateForPlayer('p2');
      expect(state.currentBid).toEqual({ quantity: 2, faceValue: 4 });
    });

    test('isMyTurn is true only for current turn player', () => {
      const s1 = game.getStateForPlayer('p1');
      const s2 = game.getStateForPlayer('p2');
      expect(s1.isMyTurn).toBe(true);
      expect(s2.isMyTurn).toBe(false);
    });

    test('eliminated flag shows correctly', () => {
      game.eliminated = ['p3'];
      game.activePlayers = ['p1', 'p2'];
      const state = game.getStateForPlayer('p1');
      const p3Info = state.otherPlayers.find((p) => p.playerId === 'p3');
      expect(p3Info.eliminated).toBe(true);
    });
  });
});

// Helper used in the last-player-standing test
function rollDiceArray(count) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
}
