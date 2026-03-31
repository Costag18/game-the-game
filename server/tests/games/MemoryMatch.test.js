import { describe, test, expect, beforeEach } from '@jest/globals';
import { MemoryMatch } from '../../src/games/MemoryMatch.js';

describe('MemoryMatch', () => {
  let game;

  beforeEach(() => {
    game = new MemoryMatch(['p1', 'p2']);
    game.startGame();
  });

  test('board has 24 cards after startGame', () => {
    expect(game.board).toHaveLength(24);
  });

  test('board has 12 pairs (each value 1-12 appears exactly twice)', () => {
    const counts = {};
    for (const card of game.board) {
      counts[card.value] = (counts[card.value] || 0) + 1;
    }
    expect(Object.keys(counts)).toHaveLength(12);
    for (const v of Object.keys(counts)) {
      expect(counts[v]).toBe(2);
    }
  });

  test('all cards start face-down and unmatched', () => {
    expect(game.board.every((c) => !c.faceUp && !c.matched)).toBe(true);
  });

  test('starts in playing state with first player as turn player', () => {
    expect(game.state).toBe('playing');
    expect(game.currentTurnPlayer).toBe('p1');
  });

  test('flip reveals card at that position', () => {
    game.handleAction('p1', { type: 'flip', position: 0 });
    expect(game.board[0].faceUp).toBe(true);
  });

  test('getStateForPlayer hides value for face-down cards', () => {
    const state = game.getStateForPlayer('p1');
    // No cards flipped yet, all should have null value
    expect(state.board.every((c) => c.value === null)).toBe(true);
  });

  test('getStateForPlayer reveals value for face-up cards', () => {
    game.handleAction('p1', { type: 'flip', position: 0 });
    const state = game.getStateForPlayer('p1');
    expect(state.board[0].value).not.toBeNull();
    expect(state.board[0].faceUp).toBe(true);
  });

  test('matching pair marks both cards as matched and awards pair to player', () => {
    // Find two positions that have the same value
    const value = game.board[0].value;
    const pos2 = game.board.findIndex((c, i) => i !== 0 && c.value === value);

    game.handleAction('p1', { type: 'flip', position: 0 });
    game.handleAction('p1', { type: 'flip', position: pos2 });

    expect(game.board[0].matched).toBe(true);
    expect(game.board[pos2].matched).toBe(true);
    expect(game.pairs['p1']).toBe(1);
  });

  test('matching pair lets same player go again', () => {
    const value = game.board[0].value;
    const pos2 = game.board.findIndex((c, i) => i !== 0 && c.value === value);

    game.handleAction('p1', { type: 'flip', position: 0 });
    game.handleAction('p1', { type: 'flip', position: pos2 });

    expect(game.currentTurnPlayer).toBe('p1');
  });

  test('non-matching pair sets pendingFlipBack = true', () => {
    // Find two positions with different values
    const v1 = game.board[0].value;
    const pos2 = game.board.findIndex((c, i) => i !== 0 && c.value !== v1);

    game.handleAction('p1', { type: 'flip', position: 0 });
    game.handleAction('p1', { type: 'flip', position: pos2 });

    expect(game.pendingFlipBack).toBe(true);
  });

  test('non-matching pair flips both cards back face-down after acknowledge', () => {
    // Find two positions with different values
    const v1 = game.board[0].value;
    const pos2 = game.board.findIndex((c, i) => i !== 0 && c.value !== v1);

    game.handleAction('p1', { type: 'flip', position: 0 });
    game.handleAction('p1', { type: 'flip', position: pos2 });

    // Cards are still face-up, pendingFlipBack = true
    expect(game.board[0].faceUp).toBe(true);
    expect(game.board[pos2].faceUp).toBe(true);

    // Acknowledge to flip back
    game.handleAction('p1', { type: 'acknowledge' });

    expect(game.board[0].faceUp).toBe(false);
    expect(game.board[pos2].faceUp).toBe(false);
  });

  test('non-matching pair advances turn to next player after acknowledge', () => {
    const v1 = game.board[0].value;
    const pos2 = game.board.findIndex((c, i) => i !== 0 && c.value !== v1);

    game.handleAction('p1', { type: 'flip', position: 0 });
    game.handleAction('p1', { type: 'flip', position: pos2 });

    // Turn still belongs to p1 (pending acknowledge)
    expect(game.currentTurnPlayer).toBe('p1');

    // Acknowledge — flips cards back and advances to p2
    game.handleAction('p1', { type: 'acknowledge' });

    expect(game.currentTurnPlayer).toBe('p2');
  });

  test('non-turn player action is ignored', () => {
    game.handleAction('p2', { type: 'flip', position: 0 }); // p1's turn
    expect(game.board[0].faceUp).toBe(false);
  });

  test('cannot flip already matched card', () => {
    const value = game.board[0].value;
    const pos2 = game.board.findIndex((c, i) => i !== 0 && c.value === value);
    game.handleAction('p1', { type: 'flip', position: 0 });
    game.handleAction('p1', { type: 'flip', position: pos2 });
    // Now try to flip one of the matched cards again (p1's turn still)
    const flippedCount = game.flippedThisTurn.length;
    game.handleAction('p1', { type: 'flip', position: 0 });
    expect(game.flippedThisTurn.length).toBe(flippedCount);
  });

  test('game ends when all 12 pairs are matched', () => {
    // Force match all pairs by setting up board and flipping
    // Build pairs by value
    const valueToPositions = {};
    game.board.forEach((c, i) => {
      if (!valueToPositions[c.value]) valueToPositions[c.value] = [];
      valueToPositions[c.value].push(i);
    });

    for (const positions of Object.values(valueToPositions)) {
      const [a, b] = positions;
      // Ensure it's p1's turn (they get to keep matching)
      game.currentTurnPlayer = 'p1';
      game.handleAction('p1', { type: 'flip', position: a });
      game.handleAction('p1', { type: 'flip', position: b });
    }

    expect(game.state).toBe('finished');
    expect(game.isComplete()).toBe(true);
  });

  test('getResults returns players sorted by pairs collected descending', () => {
    // Give p2 2 pairs, p1 1 pair manually
    game.pairs['p1'] = 1;
    game.pairs['p2'] = 2;
    // Force finish
    game.board.forEach((c) => { c.matched = true; });
    game.transition('finish');

    const results = game.getResults();
    expect(results[0].playerId).toBe('p2');
    expect(results[0].pairsCollected).toBe(2);
    expect(results[0].placement).toBe(1);
    expect(results[1].playerId).toBe('p1');
    expect(results[1].placement).toBe(2);
  });

  test('isComplete returns false when not all pairs matched', () => {
    expect(game.isComplete()).toBe(false);
  });

  test('isMyTurn is true only for current turn player', () => {
    const stateP1 = game.getStateForPlayer('p1');
    const stateP2 = game.getStateForPlayer('p2');
    expect(stateP1.isMyTurn).toBe(true);
    expect(stateP2.isMyTurn).toBe(false);
  });

  test('flipping same position twice in one turn is ignored', () => {
    game.handleAction('p1', { type: 'flip', position: 0 });
    const flippedBefore = [...game.flippedThisTurn];
    game.handleAction('p1', { type: 'flip', position: 0 }); // same position
    expect(game.flippedThisTurn).toEqual(flippedBefore);
  });

  test('pairs is 0 for all players at start', () => {
    expect(game.pairs['p1']).toBe(0);
    expect(game.pairs['p2']).toBe(0);
  });

  test('cannot flip while pendingFlipBack (must acknowledge first)', () => {
    const v1 = game.board[0].value;
    const pos2 = game.board.findIndex((c, i) => i !== 0 && c.value !== v1);
    const pos3 = game.board.findIndex((c, i) => i !== 0 && i !== pos2 && !game.board[i].faceUp);

    game.handleAction('p1', { type: 'flip', position: 0 });
    game.handleAction('p1', { type: 'flip', position: pos2 });
    // pendingFlipBack = true now

    // Attempt to flip a third card — should be ignored
    const boardBefore = game.board.map((c) => ({ ...c }));
    if (pos3 >= 0) {
      game.handleAction('p1', { type: 'flip', position: pos3 });
      expect(game.board[pos3].faceUp).toBe(false);
    }
  });
});
