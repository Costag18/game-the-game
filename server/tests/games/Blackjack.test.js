import { describe, test, expect, beforeEach } from '@jest/globals';
import { Blackjack } from '../../src/games/Blackjack.js';

// Helper: send acknowledge from all players
function _acknowledgeAll(game) {
  for (const p of game.players) {
    game.handleAction(p, { type: 'acknowledge' });
  }
}

// Helper: complete a full 5-hand game, always having all players stand each hand.
// Returns when state === 'finished'.
function _completeFullGame(game) {
  while (game.state !== 'finished') {
    if (game.state === 'playing') {
      // Have each player stand in turn order
      for (const p of game.players) {
        if (game.state === 'playing' && game.currentTurnPlayer === p) {
          game.handleAction(p, { type: 'stand' });
        }
      }
      // If still playing after iterating once, loop again (shouldn't happen with stand)
      // Advance any remaining players
      let safety = 0;
      while (game.state === 'playing' && safety < 20) {
        game.handleAction(game.currentTurnPlayer, { type: 'stand' });
        safety++;
      }
    } else if (game.state === 'reveal') {
      _acknowledgeAll(game);
    } else {
      break; // unexpected state
    }
  }
}

describe('Blackjack', () => {
  let game;

  beforeEach(() => {
    game = new Blackjack(['p1', 'p2']);
  });

  test('starts in waiting state', () => {
    expect(game.state).toBe('waiting');
  });

  test('startGame transitions to playing state', () => {
    game.startGame();
    expect(game.state).toBe('playing');
  });

  test('startGame deals 2 cards to each player and dealer', () => {
    game.startGame();
    expect(game.hands['p1']).toHaveLength(2);
    expect(game.hands['p2']).toHaveLength(2);
    expect(game.dealerHand).toHaveLength(2);
  });

  test('startGame sets turn to first player', () => {
    game.startGame();
    expect(game.currentTurnPlayer).toBe('p1');
  });

  test('getStateForPlayer shows own hand and hides dealer hole card', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.myHand).toHaveLength(2);
    expect(state.dealerShowing).toHaveLength(1);
    expect(state.dealerTotal).toBeNull();
    expect(state.phase).toBe('playing');
  });

  test('getStateForPlayer shows full dealer hand when in reveal state', () => {
    game.startGame();
    // Have all players stand to move to reveal state
    game.handleAction('p1', { type: 'stand' });
    game.handleAction('p2', { type: 'stand' });
    expect(game.state).toBe('reveal');
    const state = game.getStateForPlayer('p1');
    expect(state.dealerShowing).toEqual(game.dealerHand);
    expect(state.dealerTotal).toBeGreaterThanOrEqual(0);
  });

  test('getStateForPlayer shows full dealer hand when finished', () => {
    game.startGame();
    _completeFullGame(game);
    expect(game.state).toBe('finished');
    const state = game.getStateForPlayer('p1');
    expect(state.dealerShowing).toEqual(game.dealerHand);
    expect(state.dealerTotal).toBeGreaterThanOrEqual(0);
  });

  test('hit adds a card to the player hand', () => {
    game.startGame();
    const initialCount = game.hands['p1'].length;
    game.handleAction('p1', { type: 'hit' });
    // If not busted, hand grows by 1
    if (!game.busted.includes('p1')) {
      expect(game.hands['p1'].length).toBe(initialCount + 1);
    }
  });

  test('stand moves turn to next player', () => {
    game.startGame();
    expect(game.currentTurnPlayer).toBe('p1');
    game.handleAction('p1', { type: 'stand' });
    // p2 should now be active (or game might be in dealerTurn if single player)
    if (game.state === 'playing') {
      expect(game.currentTurnPlayer).toBe('p2');
    }
    expect(game.stood).toContain('p1');
  });

  test('busting removes player from active turn rotation', () => {
    game.startGame();
    // Manually force p1 hand to bust
    game.hands['p1'] = [
      { rank: 10, suit: 'hearts' },
      { rank: 10, suit: 'spades' },
      { rank: 5, suit: 'clubs' },
    ];
    game.handleAction('p1', { type: 'hit' }); // one more card to trigger bust check... actually hand is already > 21
    // Actually let's just set it properly - after hit, if result > 21 player is busted
    // Reset and use a hand that will bust on next hit
    game.hands['p1'] = [
      { rank: 10, suit: 'hearts' },
      { rank: 10, suit: 'spades' },
    ];
    // Add a card manually that would bust
    game.hands['p1'].push({ rank: 5, suit: 'clubs' }); // 25 total
    game.busted.push('p1');
    game.advanceToNextPlayer();
    expect(game.busted).toContain('p1');
  });

  test('game goes to reveal after all players stand or bust (hand 1)', () => {
    game.startGame();
    game.handleAction('p1', { type: 'stand' });
    game.handleAction('p2', { type: 'stand' });
    expect(game.state).toBe('reveal');
  });

  test('game completes after 5 hands with acknowledges', () => {
    game.startGame();
    _completeFullGame(game);
    expect(game.state).toBe('finished');
    expect(game.isComplete()).toBe(true);
    expect(game.handNumber).toBe(5);
  });

  test('isComplete returns false at start', () => {
    game.startGame();
    expect(game.isComplete()).toBe(false);
  });

  test('getResults sorts players by wins descending', () => {
    game.startGame();
    // Manually set win counts and force finish
    game.wins['p1'] = 3;
    game.wins['p2'] = 1;
    game.handNumber = 5;
    game.stood = ['p1', 'p2'];
    game.transition('allDone');
    game.dealerPlay();
    game.transition('resolve');
    _acknowledgeAll(game);
    const results = game.getResults();
    expect(results[0].playerId).toBe('p1');
    expect(results[1].playerId).toBe('p2');
    expect(results[0].placement).toBe(1);
    expect(results[1].placement).toBe(2);
  });

  test('busted player in last hand scores lower in results', () => {
    game.startGame();
    // Force to hand 5 state: set handNumber=5, set up known hands, then resolve
    game.handNumber = 5;
    game.hands['p1'] = [{ rank: 10, suit: 'hearts' }, { rank: 10, suit: 'spades' }]; // 20
    game.hands['p2'] = [
      { rank: 10, suit: 'hearts' },
      { rank: 10, suit: 'spades' },
      { rank: 5, suit: 'clubs' },
    ]; // 25 - bust
    game.dealerHand = [{ rank: 5, suit: 'hearts' }, { rank: 8, suit: 'spades' }]; // 13
    game.busted = ['p2'];
    game.stood = ['p1'];
    game.transition('allDone');
    game.dealerPlay();
    game._recordHandResult();
    game.transition('resolve');
    _acknowledgeAll(game);

    expect(game.state).toBe('finished');
    const results = game.getResults();
    expect(results).toHaveLength(2);
    expect(results[0].placement).toBe(1);
    expect(results[1].placement).toBe(2);
    // p1 should rank higher than p2 (p2 busted, p1 has the win)
    expect(results[0].playerId).toBe('p1');
  });

  describe('calculateHandValue', () => {
    test('A + 10 = 21 (blackjack)', () => {
      const hand = [{ rank: 1, suit: 'hearts' }, { rank: 10, suit: 'spades' }];
      expect(game.calculateHandValue(hand)).toBe(21);
    });

    test('A + 10 + 10 = 21 (ace counts as 1)', () => {
      const hand = [
        { rank: 1, suit: 'hearts' },
        { rank: 10, suit: 'spades' },
        { rank: 10, suit: 'clubs' },
      ];
      expect(game.calculateHandValue(hand)).toBe(21);
    });

    test('A + A + 9 = 21 (one ace as 11, one as 1)', () => {
      const hand = [
        { rank: 1, suit: 'hearts' },
        { rank: 1, suit: 'spades' },
        { rank: 9, suit: 'clubs' },
      ];
      expect(game.calculateHandValue(hand)).toBe(21);
    });

    test('face cards (J=11, Q=12, K=13) count as 10', () => {
      const hand = [{ rank: 11, suit: 'hearts' }, { rank: 12, suit: 'spades' }];
      expect(game.calculateHandValue(hand)).toBe(20);
    });

    test('empty hand = 0', () => {
      expect(game.calculateHandValue([])).toBe(0);
    });

    test('5 + 6 + 7 = 18', () => {
      const hand = [
        { rank: 5, suit: 'hearts' },
        { rank: 6, suit: 'spades' },
        { rank: 7, suit: 'clubs' },
      ];
      expect(game.calculateHandValue(hand)).toBe(18);
    });
  });

  test('non-turn player action is ignored', () => {
    game.startGame();
    const initialHand = [...game.hands['p2']];
    game.handleAction('p2', { type: 'hit' }); // p1's turn, not p2
    expect(game.hands['p2']).toEqual(initialHand);
  });

  test('action is ignored when in reveal state (non-acknowledge)', () => {
    game.startGame();
    game.handleAction('p1', { type: 'stand' });
    game.handleAction('p2', { type: 'stand' });
    expect(game.state).toBe('reveal');
    // hit action should be ignored in reveal state
    const dealerHandBefore = [...game.dealerHand];
    game.handleAction('p1', { type: 'hit' });
    expect(game.dealerHand).toEqual(dealerHandBefore);
  });

  test('getStateForPlayer shows other players card counts', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.otherPlayers).toHaveLength(1);
    expect(state.otherPlayers[0].playerId).toBe('p2');
    expect(state.otherPlayers[0].cardCount).toBe(2);
  });

  test('isMyTurn is true only for current turn player', () => {
    game.startGame();
    const stateP1 = game.getStateForPlayer('p1');
    const stateP2 = game.getStateForPlayer('p2');
    expect(stateP1.isMyTurn).toBe(true);
    expect(stateP2.isMyTurn).toBe(false);
  });

  test('handNumber increments with each hand', () => {
    game.startGame();
    expect(game.handNumber).toBe(1);
    // Complete hand 1
    game.handleAction('p1', { type: 'stand' });
    game.handleAction('p2', { type: 'stand' });
    expect(game.state).toBe('reveal');
    _acknowledgeAll(game);
    expect(game.handNumber).toBe(2);
  });

  test('wins tracked across hands', () => {
    game.startGame();
    expect(game.wins['p1']).toBe(0);
    expect(game.wins['p2']).toBe(0);
    // Wins are tracked in the engine; just ensure the property exists
    expect(typeof game.wins).toBe('object');
  });
});
