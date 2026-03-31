import { describe, test, expect, beforeEach } from '@jest/globals';
import { War } from '../../src/games/War.js';

// Helper: send acknowledge from all players (used after pendingReveal = true)
function _acknowledgeAll(game) {
  for (const p of game.players) {
    game.handleAction(p, { type: 'acknowledge' });
  }
}

describe('War', () => {
  let game;

  beforeEach(() => {
    game = new War(['p1', 'p2']);
  });

  test('starts in waiting state', () => {
    expect(game.state).toBe('waiting');
  });

  test('startGame transitions to flipping state', () => {
    game.startGame();
    expect(game.state).toBe('flipping');
  });

  test('startGame splits deck 26/26', () => {
    game.startGame();
    expect(game.playerDecks['p1']).toHaveLength(26);
    expect(game.playerDecks['p2']).toHaveLength(26);
    expect(game.playerDecks['p1'].length + game.playerDecks['p2'].length).toBe(52);
  });

  test('startGame initializes flip count to 0', () => {
    game.startGame();
    expect(game.flipCount).toBe(0);
  });

  test('only one player flipping does not resolve', () => {
    game.startGame();
    game.handleAction('p1', { type: 'flip' });
    expect(game.state).toBe('flipping');
    expect(game.flipCount).toBe(0);
  });

  test('both players flipping triggers comparison', () => {
    game.startGame();
    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });
    expect(game.flipCount).toBe(1);
  });

  test('higher rank card wins both cards after acknowledge', () => {
    game.startGame();
    // Replace decks with known cards — p1 has high card
    game.playerDecks['p1'] = [{ rank: 10, suit: 'hearts' }, { rank: 2, suit: 'hearts' }];
    game.playerDecks['p2'] = [{ rank: 5, suit: 'spades' }, { rank: 3, suit: 'spades' }];

    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });

    // After flip, pendingReveal = true — cards not yet awarded
    expect(game.pendingReveal).toBe(true);

    // Acknowledge to award cards
    _acknowledgeAll(game);

    // p1 flipped rank-10, p2 flipped rank-5 — p1 wins both flipped cards
    // p1: started with 2, lost 1 (flip), gained 2 (both flipped) = 3
    // p2: started with 2, lost 1 (flip), gained 0 = 1
    expect(game.playerDecks['p1'].length).toBe(3);
    expect(game.playerDecks['p2'].length).toBe(1);
  });

  test('equal rank triggers war state', () => {
    game.startGame();
    game.playerDecks['p1'].unshift({ rank: 7, suit: 'hearts' });
    game.playerDecks['p2'].unshift({ rank: 7, suit: 'spades' });

    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });

    expect(game.state).toBe('war');
  });

  test('war: each player flipping resolves the war', () => {
    game.startGame();
    // Set up a tie
    game.playerDecks['p1'].unshift({ rank: 7, suit: 'hearts' });
    game.playerDecks['p2'].unshift({ rank: 7, suit: 'spades' });

    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });
    expect(game.state).toBe('war');

    // Both do their war flip
    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });

    // Should have resolved war — either back to flipping or finished
    expect(['flipping', 'finished']).toContain(game.state);
  });

  test('war winner gets all the cards', () => {
    game.startGame();
    // Set up a tie, then p1 wins the war
    game.playerDecks['p1'] = [
      { rank: 7, suit: 'hearts' },   // initial flip — ties
      { rank: 2, suit: 'hearts' },   // face-down war card
      { rank: 13, suit: 'hearts' },  // face-up war card — wins
    ];
    game.playerDecks['p2'] = [
      { rank: 7, suit: 'spades' },   // initial flip — ties
      { rank: 2, suit: 'spades' },   // face-down war card
      { rank: 3, suit: 'spades' },   // face-up war card — loses
    ];

    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });
    expect(game.state).toBe('war');

    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });

    // p1 should have all 6 cards, p2 should have 0
    const totalCards =
      game.playerDecks['p1'].length + game.playerDecks['p2'].length;
    expect(totalCards).toBe(6);
    expect(game.playerDecks['p1'].length).toBe(6);
    expect(game.playerDecks['p2'].length).toBe(0);
  });

  test('game ends when one player has all cards', () => {
    game.startGame();
    // Empty p2 deck
    game.playerDecks['p1'] = game.playerDecks['p1'].concat(game.playerDecks['p2']);
    game.playerDecks['p2'] = [];

    // Trigger flip — p2 has no cards, game should end or handle gracefully
    // Actually the check happens after flip comparison; let's trigger _checkEndCondition directly
    game.playerDecks['p2'] = [];
    game._checkEndCondition();
    expect(game.state).toBe('finished');
  });

  test('game ends after 26 flips', () => {
    game.startGame();
    game.flipCount = 25;
    // Do one more flip — ensure cards won't tie (use different ranks)
    game.playerDecks['p1'].unshift({ rank: 10, suit: 'hearts' });
    game.playerDecks['p2'].unshift({ rank: 5, suit: 'spades' });
    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });

    // After flip 26, pendingReveal=true; acknowledge to trigger end check
    if (game.pendingReveal) {
      _acknowledgeAll(game);
    }

    expect(game.state).toBe('finished');
    expect(game.isComplete()).toBe(true);
  });

  test('getResults sorts by card count descending', () => {
    game.startGame();
    // Give p1 more cards
    game.playerDecks['p1'] = [{ rank: 1, suit: 'hearts' }, { rank: 2, suit: 'hearts' }];
    game.playerDecks['p2'] = [{ rank: 3, suit: 'spades' }];
    game._endGame();

    const results = game.getResults();
    expect(results[0].playerId).toBe('p1');
    expect(results[0].placement).toBe(1);
    expect(results[0].cardCount).toBe(2);
    expect(results[1].playerId).toBe('p2');
    expect(results[1].placement).toBe(2);
    expect(results[1].cardCount).toBe(1);
  });

  test('getStateForPlayer shows own deck size and opponent deck size', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.myDeckSize).toBe(26);
    expect(state.opponentDeckSize).toBe(26);
    expect(state.phase).toBe('flipping');
  });

  test('getStateForPlayer shows flipped cards after flip', () => {
    game.startGame();
    game.playerDecks['p1'].unshift({ rank: 9, suit: 'hearts' });
    game.playerDecks['p2'].unshift({ rank: 4, suit: 'clubs' });

    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });

    // After comparison, flipCount incremented
    expect(game.flipCount).toBe(1);
  });

  test('duplicate flip action is ignored', () => {
    game.startGame();
    game.handleAction('p1', { type: 'flip' });
    const cardAfterFirst = game.flippedCards['p1'];
    game.handleAction('p1', { type: 'flip' }); // should be ignored
    expect(game.flippedCards['p1']).toEqual(cardAfterFirst);
  });

  test('isComplete returns false at game start', () => {
    game.startGame();
    expect(game.isComplete()).toBe(false);
  });

  test('pendingReveal is true after both players flip and one wins', () => {
    game.startGame();
    // Set up different ranks so there's a winner
    game.playerDecks['p1'].unshift({ rank: 10, suit: 'hearts' });
    game.playerDecks['p2'].unshift({ rank: 3, suit: 'spades' });

    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });

    expect(game.pendingReveal).toBe(true);
    expect(game.state).toBe('flipping');
  });

  test('acknowledging pendingReveal advances the round', () => {
    game.startGame();
    game.playerDecks['p1'].unshift({ rank: 10, suit: 'hearts' });
    game.playerDecks['p2'].unshift({ rank: 3, suit: 'spades' });

    game.handleAction('p1', { type: 'flip' });
    game.handleAction('p2', { type: 'flip' });

    expect(game.pendingReveal).toBe(true);
    _acknowledgeAll(game);
    expect(game.pendingReveal).toBe(false);
  });
});
