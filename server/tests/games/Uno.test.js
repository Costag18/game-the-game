import { describe, test, expect, beforeEach } from '@jest/globals';
import { Uno } from '../../src/games/Uno.js';

describe('Uno', () => {
  let game;

  beforeEach(() => {
    game = new Uno(['p1', 'p2', 'p3']);
  });

  test('starts in waiting state', () => {
    expect(game.state).toBe('waiting');
  });

  test('deck has 108 cards', () => {
    // Build deck by starting game and counting total cards across all hands + piles
    game.startGame();
    const totalCards =
      game.drawPile.length +
      game.discardPile.length +
      Object.values(game.hands).reduce((sum, h) => sum + h.length, 0);
    expect(totalCards).toBe(108);
  });

  test('startGame deals 7 cards to each player', () => {
    game.startGame();
    expect(game.hands['p1']).toHaveLength(7);
    expect(game.hands['p2']).toHaveLength(7);
    expect(game.hands['p3']).toHaveLength(7);
  });

  test('startGame transitions to playing state', () => {
    game.startGame();
    expect(game.state).toBe('playing');
  });

  test('startGame flips a starting card onto discard pile', () => {
    game.startGame();
    expect(game.discardPile.length).toBeGreaterThanOrEqual(1);
    const top = game.discardPile[game.discardPile.length - 1];
    expect(top).toBeDefined();
    expect(top.rank).not.toBe('Wild');
    expect(top.rank).not.toBe('WildDrawFour');
  });

  test('currentColor is set after startGame', () => {
    game.startGame();
    expect(['red', 'yellow', 'green', 'blue']).toContain(game.currentColor);
  });

  test('valid play by color is accepted', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const topCard = game.discardPile[game.discardPile.length - 1];
    // Insert a matching color card into current player's hand
    game.hands[currentPlayer] = [{ color: game.currentColor, rank: 5 }];
    const handSizeBefore = game.hands[currentPlayer].length;
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    // Card was played, hand should be empty (and game finished since 0 cards)
    expect(game.hands[currentPlayer].length).toBe(0);
  });

  test('valid play by rank is accepted', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const topCard = game.discardPile[game.discardPile.length - 1];
    // Insert a card matching the rank but different color
    const otherColor = ['red', 'yellow', 'green', 'blue'].find(
      (c) => c !== game.currentColor
    );
    // Only do this test if top card has a number rank
    if (typeof topCard.rank === 'number') {
      game.hands[currentPlayer] = [{ color: otherColor, rank: topCard.rank }];
      game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
      expect(game.hands[currentPlayer].length).toBe(0);
    }
  });

  test('invalid play is rejected', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const topCard = game.discardPile[game.discardPile.length - 1];
    // Force a card that doesn't match color or rank
    const badColor = ['red', 'yellow', 'green', 'blue'].find(
      (c) => c !== game.currentColor
    );
    const badRank = typeof topCard.rank === 'number'
      ? (topCard.rank === 5 ? 7 : 5)
      : 5;
    game.hands[currentPlayer] = [{ color: badColor, rank: badRank }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    // Card stays in hand — invalid play rejected
    expect(game.hands[currentPlayer]).toHaveLength(1);
  });

  test('draw action adds one card to hand', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const beforeCount = game.hands[currentPlayer].length;
    game.handleAction(currentPlayer, { type: 'draw' });
    expect(game.hands[currentPlayer].length).toBe(beforeCount + 1);
  });

  test('draw either advances turn or lets player play/pass', () => {
    game.startGame();
    const firstPlayer = game.currentTurnPlayer;
    const handBefore = game.hands[firstPlayer].length;
    game.handleAction(firstPlayer, { type: 'draw' });
    expect(game.hands[firstPlayer].length).toBe(handBefore + 1);
    // If drawn card was playable, player stays on turn — pass to advance
    if (game.currentTurnPlayer === firstPlayer) {
      game.handleAction(firstPlayer, { type: 'pass' });
    }
    expect(game.currentTurnPlayer).not.toBe(firstPlayer);
  });

  test('non-turn player action is ignored', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const otherPlayer = game.players.find((p) => p !== currentPlayer);
    const handBefore = [...game.hands[otherPlayer]];
    game.handleAction(otherPlayer, { type: 'draw' });
    expect(game.hands[otherPlayer]).toEqual(handBefore);
  });

  test('Skip skips the next player', () => {
    game.startGame();
    // Force known state: p1's turn, red is current color
    game.discardPile[game.discardPile.length - 1] = { color: 'red', rank: 5 };
    game.currentColor = 'red';
    game.currentTurnPlayer = 'p1';
    game.turnIndex = 0;
    game.direction = 1;

    game.hands['p1'] = [{ color: 'red', rank: 'Skip' }, { color: 'red', rank: 3 }];
    game.handleAction('p1', { type: 'play', cardIndex: 0 });

    // p2 should be skipped, p3 should be current
    expect(game.currentTurnPlayer).toBe('p3');
  });

  test('Reverse changes direction', () => {
    game.startGame();
    expect(game.direction).toBe(1);
    const currentPlayer = game.currentTurnPlayer;
    game.hands[currentPlayer] = [{ color: game.currentColor, rank: 'Reverse' }, { color: game.currentColor, rank: 2 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    // Direction should have flipped (or in 2-player, might flip and flip back, so check net effect)
    // With 3 players, direction should now be -1
    expect(game.direction).toBe(-1);
  });

  test('DrawTwo makes next player draw 2 cards and skip their turn', () => {
    const g = new Uno(['p1', 'p2', 'p3']);
    g.startGame();
    // Force a known discard state so start card effects don't interfere
    g.discardPile[g.discardPile.length - 1] = { color: 'red', rank: 5 };
    g.currentColor = 'red';
    g.currentTurnPlayer = 'p1';
    g.turnIndex = 0;
    g.direction = 1;

    const nextHandBefore = g.hands['p2'].length;

    g.hands['p1'] = [{ color: 'red', rank: 'DrawTwo' }, { color: 'red', rank: 2 }];
    g.handleAction('p1', { type: 'play', cardIndex: 0 });

    // p2 (next player) should have 2 more cards and been skipped
    expect(g.hands['p2'].length).toBe(nextHandBefore + 2);
    // Turn should be on p3 (the player AFTER the skipped p2)
    expect(g.currentTurnPlayer).toBe('p3');
  });

  test('Wild changes current color', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const newColor = game.currentColor === 'red' ? 'blue' : 'red';
    game.hands[currentPlayer] = [{ color: null, rank: 'Wild' }, { color: 'blue', rank: 3 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0, chosenColor: newColor });
    expect(game.currentColor).toBe(newColor);
  });

  test('Wild can be played on any card', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    game.hands[currentPlayer] = [{ color: null, rank: 'Wild' }, { color: 'blue', rank: 3 }];
    const handBefore = game.hands[currentPlayer].length;
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0, chosenColor: 'red' });
    expect(game.hands[currentPlayer].length).toBe(handBefore - 1);
  });

  test('first player to empty hand wins', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    // Give current player exactly one playable card
    game.hands[currentPlayer] = [{ color: game.currentColor, rank: 5 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });
    expect(game.state).toBe('finished');
    expect(game.isComplete()).toBe(true);
    const results = game.getResults();
    expect(results[0].playerId).toBe(currentPlayer);
    expect(results[0].placement).toBe(1);
  });

  test('getResults sorts remaining players by points ascending', () => {
    game.startGame();
    const currentPlayer = game.currentTurnPlayer;
    const others = game.players.filter((p) => p !== currentPlayer);

    // Player with fewer points should be ranked higher (2nd place) than high-points player
    game.hands[others[0]] = [{ color: 'red', rank: 1 }]; // 1 point
    game.hands[others[1]] = [
      { color: null, rank: 'Wild' },
      { color: null, rank: 'Wild' },
    ]; // 100 points

    // Current player wins
    game.hands[currentPlayer] = [{ color: game.currentColor, rank: 3 }];
    game.handleAction(currentPlayer, { type: 'play', cardIndex: 0 });

    const results = game.getResults();
    expect(results[0].playerId).toBe(currentPlayer);
    const p2Result = results.find((r) => r.playerId === others[0]);
    const p3Result = results.find((r) => r.playerId === others[1]);
    expect(p2Result.placement).toBeLessThan(p3Result.placement);
  });

  test('getStateForPlayer returns own hand, top discard, other players hand counts', () => {
    game.startGame();
    const state = game.getStateForPlayer('p1');
    expect(state.myHand).toBeDefined();
    expect(state.topDiscard).toBeDefined();
    expect(state.currentColor).toBeDefined();
    expect(state.otherPlayers).toHaveLength(2);
    state.otherPlayers.forEach((op) => {
      expect(op.handCount).toBeDefined();
    });
  });

  test('isMyTurn is correct', () => {
    game.startGame();
    const current = game.currentTurnPlayer;
    const other = game.players.find((p) => p !== current);
    expect(game.getStateForPlayer(current).isMyTurn).toBe(true);
    expect(game.getStateForPlayer(other).isMyTurn).toBe(false);
  });

  test('action is ignored when not in playing state', () => {
    game.startGame();
    const current = game.currentTurnPlayer;
    // Force finish
    game.hands[current] = [{ color: game.currentColor, rank: 2 }];
    game.handleAction(current, { type: 'play', cardIndex: 0 });
    expect(game.state).toBe('finished');
    // Try to draw — should be ignored
    const nextPlayer = game.currentTurnPlayer;
    const handBefore = (game.hands[nextPlayer] || []).length;
    game.handleAction(nextPlayer, { type: 'draw' });
    expect((game.hands[nextPlayer] || []).length).toBe(handBefore);
  });

  describe('WildDrawFour', () => {
    test('WildDrawFour makes next player draw 4 and skip', () => {
      const g = new Uno(['p1', 'p2']);
      g.startGame();
      const current = g.currentTurnPlayer;
      const next = g.players.find((p) => p !== current);
      const nextBefore = g.hands[next].length;

      g.hands[current] = [{ color: null, rank: 'WildDrawFour' }, { color: 'red', rank: 3 }];
      g.handleAction(current, { type: 'play', cardIndex: 0, chosenColor: 'red' });

      expect(g.hands[next].length).toBe(nextBefore + 4);
      // After skipping next, turn should be back to current player (2-player)
      expect(g.currentTurnPlayer).toBe(current);
    });
  });
});
