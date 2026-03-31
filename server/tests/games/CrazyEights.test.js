import { describe, test, expect, beforeEach } from '@jest/globals';
import { CrazyEights } from '../../src/games/CrazyEights.js';

describe('CrazyEights', () => {
  let game;

  beforeEach(() => {
    game = new CrazyEights(['p1', 'p2', 'p3']);
  });

  test('starts in waiting state', () => {
    expect(game.state).toBe('waiting');
  });

  test('startGame deals 5 cards to each player for 3+ players', () => {
    game.startGame();
    expect(game.hands['p1']).toHaveLength(5);
    expect(game.hands['p2']).toHaveLength(5);
    expect(game.hands['p3']).toHaveLength(5);
  });

  test('startGame deals 7 cards to each player for 2 players', () => {
    const g = new CrazyEights(['p1', 'p2']);
    g.startGame();
    expect(g.hands['p1']).toHaveLength(7);
    expect(g.hands['p2']).toHaveLength(7);
  });

  test('startGame transitions to playing state', () => {
    game.startGame();
    expect(game.state).toBe('playing');
  });

  test('startGame flips a non-8 starting card', () => {
    game.startGame();
    expect(game.discardPile.length).toBeGreaterThanOrEqual(1);
    const top = game.discardPile[game.discardPile.length - 1];
    expect(top.rank).not.toBe(8);
  });

  test('activeSuit is set to starting card suit', () => {
    game.startGame();
    const top = game.discardPile[game.discardPile.length - 1];
    expect(game.activeSuit).toBe(top.suit);
  });

  test('valid play by suit is accepted', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    // Force a known card and known top
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    game.hands[currentPlayer] = [{ suit: 'hearts', rank: 7 }, { suit: 'spades', rank: 2 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    expect(game.hands[currentPlayer]).toHaveLength(1);
  });

  test('valid play by rank is accepted', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    // Different suit but same rank
    game.hands[currentPlayer] = [{ suit: 'spades', rank: 5 }, { suit: 'clubs', rank: 2 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    expect(game.hands[currentPlayer]).toHaveLength(1);
  });

  test('invalid play is rejected', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    // Different suit and different rank, not an 8
    game.hands[currentPlayer] = [{ suit: 'spades', rank: 7 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    // Card stays in hand
    expect(game.hands[currentPlayer]).toHaveLength(1);
  });

  test('8 is wild and can be played on anything', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    // 8 of spades — different suit, but it's a wild
    game.hands[currentPlayer] = [{ suit: 'spades', rank: 8 }, { suit: 'clubs', rank: 2 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0, chosenSuit: 'clubs' });
    expect(game.hands[currentPlayer]).toHaveLength(1);
    expect(game.activeSuit).toBe('clubs');
  });

  test('8 changes the active suit to chosen suit', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    game.activeSuit = 'hearts';
    game.hands[currentPlayer] = [{ suit: 'hearts', rank: 8 }, { suit: 'clubs', rank: 2 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0, chosenSuit: 'diamonds' });
    expect(game.activeSuit).toBe('diamonds');
  });

  test('draw action adds cards to hand and advances turn', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const beforeCount = game.hands[currentPlayer].length;
    game.handleAction(currentPlayer, { type: 'draw' });
    // Player should have drawn at least one card
    expect(game.hands[currentPlayer].length).toBeGreaterThan(beforeCount);
    // Turn should advance
    expect(game.currentTurnPlayer).not.toBe(currentPlayer);
  });

  test('non-turn player action is ignored', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const otherPlayer = game.players.find((p) => p !== currentPlayer);
    const handBefore = [...game.hands[otherPlayer]];
    game.handleAction(otherPlayer, { type: 'draw' });
    expect(game.hands[otherPlayer]).toEqual(handBefore);
  });

  test('first player to empty hand wins', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    // Give exactly one card that matches the top discard
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    game.hands[currentPlayer] = [{ suit: 'hearts', rank: 9 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    expect(game.state).toBe('finished');
    expect(game.isComplete()).toBe(true);
    const results = game.getResults();
    expect(results[0].playerId).toBe(currentPlayer);
    expect(results[0].placement).toBe(1);
  });

  test('getResults winner has 0 remaining cards', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    game.hands[currentPlayer] = [{ suit: 'hearts', rank: 9 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    const results = game.getResults();
    expect(results[0].remainingCards).toBe(0);
  });

  test('getResults sorts by points ascending (lower points = better placement)', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const others = game.players.filter((p) => p !== currentPlayer);

    // Set up remaining hands with known points
    game.hands[others[0]] = [{ suit: 'hearts', rank: 2 }];      // 2 points
    game.hands[others[1]] = [{ suit: 'hearts', rank: 8 }];      // 50 points

    // Win with a single card
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    game.hands[currentPlayer] = [{ suit: 'hearts', rank: 7 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });

    const results = game.getResults();
    expect(results[0].playerId).toBe(currentPlayer); // winner
    const r1 = results.find((r) => r.playerId === others[0]);
    const r2 = results.find((r) => r.playerId === others[1]);
    expect(r1.placement).toBeLessThan(r2.placement);
  });

  test('getStateForPlayer returns own hand, top discard, activeSuit, others hand counts', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.myHand).toBeDefined();
    expect(state.topDiscard).toBeDefined();
    expect(state.activeSuit).toBeDefined();
    expect(state.otherPlayers).toHaveLength(2);
    state.otherPlayers.forEach((op) => {
      expect(typeof op.handCount).toBe('number');
    });
  });

  test('isMyTurn is correct', () => {
    game.startGame();
    const current = game.currentTurnPlayer;
    const other = game.players.find((p) => p !== current);
    expect(game.getStateForPlayer(current).isMyTurn).toBe(true);
    expect(game.getStateForPlayer(other).isMyTurn).toBe(false);
  });

  test('action is ignored when game is finished', () => {
    game.startGame();
    const current = game.currentTurnPlayer;
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    game.hands[current] = [{ suit: 'hearts', rank: 9 }];
    game.handleAction(current, { type: 'play', cardIndex: 0 });
    expect(game.state).toBe('finished');

    const nextPlayer = game.currentTurnPlayer;
    const handBefore = (game.hands[nextPlayer] || []).length;
    game.handleAction(nextPlayer, { type: 'draw' });
    expect((game.hands[nextPlayer] || []).length).toBe(handBefore);
  });

  test('isComplete returns false before game ends', () => {
    game.startGame();
    expect(game.isComplete()).toBe(false);
  });

  test('point scoring: 8=50, face cards=10, ace=1, others=face value', () => {
    game.startGame();
    const current = game.currentTurnPlayer;
    game.discardPile[game.discardPile.length - 1] = { suit: 'hearts', rank: 5 };
    game.activeSuit = 'hearts';
    // Win immediately
    game.hands[current] = [{ suit: 'hearts', rank: 5 }];
    // Set up specific hands for others
    const others = game.players.filter((p) => p !== current);
    game.hands[others[0]] = [
      { suit: 'hearts', rank: 8 },   // 50
      { suit: 'hearts', rank: 11 },  // 10 (Jack)
      { suit: 'hearts', rank: 1 },   // 1 (Ace)
    ]; // total = 61
    game.hands[others[1]] = [
      { suit: 'hearts', rank: 7 },   // 7
    ]; // total = 7

    game.handleAction(current, { type: 'play', cardIndex: 0 });

    const results = game.getResults();
    const r1 = results.find((r) => r.playerId === others[0]);
    const r2 = results.find((r) => r.playerId === others[1]);
    expect(r1.points).toBe(61);
    expect(r2.points).toBe(7);
    // others[1] should rank better (lower points)
    expect(r2.placement).toBeLessThan(r1.placement);
  });
});
