import { describe, test, expect, beforeEach } from '@jest/globals';
import { GoFish } from '../../src/games/GoFish.js';

describe('GoFish', () => {
  let game;

  beforeEach(() => {
    game = new GoFish(['p1', 'p2', 'p3']);
  });

  test('starts in waiting state', () => {
    expect(game.state).toBe('waiting');
  });

  test('startGame transitions to playing state', () => {
    game.startGame();
    expect(game.state).toBe('playing');
  });

  describe('deal correct count', () => {
    test('deals 7 cards each with 2-3 players', () => {
      const game2 = new GoFish(['p1', 'p2']);
      game2.startGame();
      // Account for possible sets removed; total should be <= 7
      // Verify that deck dealt 7 each (remaining = 52 - 14 - sets*4)
      const p1Cards = game2.hands['p1'].length;
      const p2Cards = game2.hands['p2'].length;
      const p1Sets = game2.completedSets['p1'];
      const p2Sets = game2.completedSets['p2'];
      expect(p1Cards + p1Sets * 4).toBe(7);
      expect(p2Cards + p2Sets * 4).toBe(7);
    });

    test('deals 5 cards each with 4+ players', () => {
      const game4 = new GoFish(['p1', 'p2', 'p3', 'p4']);
      game4.startGame();
      const p1Cards = game4.hands['p1'].length;
      const p1Sets = game4.completedSets['p1'];
      expect(p1Cards + p1Sets * 4).toBe(5);
    });
  });

  test('ask with match transfers all matching cards to asker', () => {
    game.startGame();
    // Manually set hands to control test
    game.hands['p1'] = [{ rank: 5, suit: 'hearts' }];
    game.hands['p2'] = [{ rank: 5, suit: 'spades' }, { rank: 5, suit: 'clubs' }];
    game.hands['p3'] = [{ rank: 7, suit: 'hearts' }];
    game.completedSets = { p1: 0, p2: 0, p3: 0 };
    game.setTurnPlayer('p1');

    game.handleAction('p1', { type: 'ask', targetPlayer: 'p2', rank: 5 });

    // p1 should have gained the 2 cards from p2 (now 3 total of rank 5)
    // but not yet 4 so no set
    expect(game.hands['p1'].filter((c) => c.rank === 5)).toHaveLength(3);
    expect(game.hands['p2'].filter((c) => c.rank === 5)).toHaveLength(0);
  });

  test('ask without match triggers go fish (draw from deck)', () => {
    game.startGame();
    game.hands['p1'] = [{ rank: 5, suit: 'hearts' }];
    game.hands['p2'] = [{ rank: 7, suit: 'spades' }];
    game.hands['p3'] = [{ rank: 8, suit: 'clubs' }];
    game.completedSets = { p1: 0, p2: 0, p3: 0 };
    const deckBefore = game.deck.remaining();
    game.setTurnPlayer('p1');

    game.handleAction('p1', { type: 'ask', targetPlayer: 'p2', rank: 5 });

    // p1 should have drawn from deck
    const deckAfter = game.deck.remaining();
    if (deckBefore > 0) {
      expect(deckAfter).toBe(deckBefore - 1);
    }
  });

  test('completed set of 4 is removed from hand', () => {
    game.startGame();
    // Give p1 exactly 4 of the same rank — should be converted to a set
    game.hands['p1'] = [
      { rank: 3, suit: 'hearts' },
      { rank: 3, suit: 'diamonds' },
      { rank: 3, suit: 'clubs' },
    ];
    game.hands['p2'] = [{ rank: 3, suit: 'spades' }, { rank: 9, suit: 'hearts' }];
    game.hands['p3'] = [{ rank: 7, suit: 'hearts' }];
    game.completedSets = { p1: 0, p2: 0, p3: 0 };
    game.setTurnPlayer('p1');

    game.handleAction('p1', { type: 'ask', targetPlayer: 'p2', rank: 3 });

    // All 4 rank-3 cards should be removed and set credited
    expect(game.hands['p1'].filter((c) => c.rank === 3)).toHaveLength(0);
    expect(game.completedSets['p1']).toBe(1);
  });

  test('asking for rank not in hand is invalid', () => {
    game.startGame();
    game.hands['p1'] = [{ rank: 5, suit: 'hearts' }];
    game.hands['p2'] = [{ rank: 9, suit: 'spades' }];
    game.hands['p3'] = [{ rank: 7, suit: 'clubs' }];
    game.completedSets = { p1: 0, p2: 0, p3: 0 };
    game.setTurnPlayer('p1');

    // p1 doesn't have rank 9
    const p2HandBefore = [...game.hands['p2']];
    game.handleAction('p1', { type: 'ask', targetPlayer: 'p2', rank: 9 });
    expect(game.hands['p2']).toEqual(p2HandBefore);
  });

  test('non-turn player action is ignored', () => {
    game.startGame();
    game.hands['p2'] = [{ rank: 5, suit: 'hearts' }, { rank: 9, suit: 'spades' }];
    game.hands['p1'] = [{ rank: 5, suit: 'clubs' }];
    game.setTurnPlayer('p1');

    const p1HandBefore = [...game.hands['p1']];
    game.handleAction('p2', { type: 'ask', targetPlayer: 'p1', rank: 5 });
    expect(game.hands['p1']).toEqual(p1HandBefore);
  });

  test('game ends when all 13 sets are completed', () => {
    game.startGame();
    // Force 12 sets completed between players
    game.completedSets['p1'] = 6;
    game.completedSets['p2'] = 6;
    game.completedSets['p3'] = 0;

    // Give p3 three rank-4 cards; p1 has the fourth
    game.hands['p3'] = [{ rank: 4, suit: 'hearts' }, { rank: 4, suit: 'diamonds' }, { rank: 4, suit: 'clubs' }];
    game.hands['p1'] = [{ rank: 4, suit: 'spades' }, { rank: 2, suit: 'hearts' }];
    game.hands['p2'] = [{ rank: 7, suit: 'clubs' }];
    game.setTurnPlayer('p3');

    game.handleAction('p3', { type: 'ask', targetPlayer: 'p1', rank: 4 });

    expect(game.isComplete()).toBe(true);
    expect(game.state).toBe('finished');
  });

  test('getResults sorted by completed sets descending', () => {
    game.startGame();
    game.completedSets['p1'] = 5;
    game.completedSets['p2'] = 3;
    game.completedSets['p3'] = 7;
    // Force finish
    game.state = 'finished';

    const results = game.getResults();
    expect(results[0].playerId).toBe('p3');
    expect(results[0].completedSets).toBe(7);
    expect(results[1].playerId).toBe('p1');
    expect(results[2].playerId).toBe('p2');
    expect(results[0].placement).toBe(1);
    expect(results[1].placement).toBe(2);
    expect(results[2].placement).toBe(3);
  });

  test('getStateForPlayer returns correct state', () => {
    game.startGame();
    game.hands['p1'] = [{ rank: 5, suit: 'hearts' }, { rank: 7, suit: 'clubs' }];
    game.hands['p2'] = [{ rank: 3, suit: 'spades' }];
    game.hands['p3'] = [{ rank: 8, suit: 'diamonds' }, { rank: 2, suit: 'hearts' }];
    game.completedSets = { p1: 2, p2: 1, p3: 3 };
    game.setTurnPlayer('p1');

    const state = game.getStateForPlayer('p1');
    expect(state.myHand).toHaveLength(2);
    expect(state.myCompletedSets).toBe(2);
    expect(state.isMyTurn).toBe(true);
    expect(state.otherPlayers).toHaveLength(2);

    const p2Info = state.otherPlayers.find((p) => p.playerId === 'p2');
    expect(p2Info.cardCount).toBe(1);
    expect(p2Info.completedSets).toBe(1);
  });

  test('isComplete returns false at start', () => {
    game.startGame();
    expect(game.isComplete()).toBe(false);
  });

  test('turn advances after unsuccessful ask (go fish)', () => {
    game.startGame();
    game.hands['p1'] = [{ rank: 5, suit: 'hearts' }];
    game.hands['p2'] = [{ rank: 9, suit: 'spades' }];
    game.hands['p3'] = [{ rank: 7, suit: 'clubs' }];
    game.completedSets = { p1: 0, p2: 0, p3: 0 };
    // Empty the deck to avoid lucky draws
    game.deck.cards = [];
    game.setTurnPlayer('p1');

    game.handleAction('p1', { type: 'ask', targetPlayer: 'p2', rank: 5 });

    // Turn should have advanced to p2
    expect(game.currentTurnPlayer).toBe('p2');
  });
});
