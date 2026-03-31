import { describe, test, expect, beforeEach } from '@jest/globals';
import { Hangman } from '../../src/games/Hangman.js';

describe('Hangman', () => {
  let game;

  beforeEach(() => {
    game = new Hangman(['p1', 'p2', 'p3']);
    game.startGame();
    // Override word with a known value for deterministic testing
    game.word = 'castle';
    game.revealed = new Array('castle'.length).fill(false);
    game.guessedLetters = new Set();
    game.wrongCounts = { p1: 0, p2: 0, p3: 0 };
    game.eliminated = [];
    // Reset activePlayers to all players
    game.activePlayers = [...game.players];
    game.setTurnPlayer('p1');
  });

  test('starts in waiting state', () => {
    const freshGame = new Hangman(['p1', 'p2']);
    expect(freshGame.state).toBe('waiting');
  });

  test('startGame transitions to playing state', () => {
    expect(game.state).toBe('playing');
  });

  test('startGame picks a word', () => {
    expect(game.word).toBeTruthy();
    expect(game.word.length).toBeGreaterThan(0);
  });

  test('correct guess reveals all instances of the letter', () => {
    // 'castle' has one 'c', one 'a', one 's', one 't', one 'l', one 'e'
    game.handleAction('p1', { type: 'guess', letter: 'c' });
    expect(game.revealed[0]).toBe(true); // 'c' is at index 0
    expect(game.guessedLetters.has('c')).toBe(true);
  });

  test('correct guess with multiple instances reveals all', () => {
    // Use word 'ladder' which has two 'd's (index 2 and 3 -> l-a-d-d-e-r)
    game.word = 'ladder';
    game.revealed = new Array('ladder'.length).fill(false);
    game.setTurnPlayer('p1');

    game.handleAction('p1', { type: 'guess', letter: 'd' });
    expect(game.revealed[2]).toBe(true);
    expect(game.revealed[3]).toBe(true);
  });

  test('wrong guess increments player wrong count', () => {
    game.handleAction('p1', { type: 'guess', letter: 'z' });
    expect(game.wrongCounts['p1']).toBe(1);
  });

  test('already guessed letter is rejected', () => {
    game.handleAction('p1', { type: 'guess', letter: 'c' });
    const wrongCountBefore = game.wrongCounts['p2'];
    // p2's turn, try to guess same letter
    game.handleAction('p2', { type: 'guess', letter: 'c' });
    expect(game.wrongCounts['p2']).toBe(wrongCountBefore);
  });

  test('6 wrong guesses eliminates a player', () => {
    // Make p1 guess 6 wrong letters
    const wrongLetters = ['z', 'x', 'q', 'w', 'y', 'v'];
    // p1 goes on turns 1, 4, 7, ... (round robin)
    // We need to control turn so p1 always guesses
    game.activePlayers = ['p1'];
    game.setTurnPlayer('p1');

    for (const letter of wrongLetters) {
      game.handleAction('p1', { type: 'guess', letter });
    }

    expect(game.eliminated).toContain('p1');
    expect(game.wrongCounts['p1']).toBe(6);
  });

  test('word complete ends game', () => {
    // Guess all letters in 'castle': c, a, s, t, l, e
    game.activePlayers = ['p1'];
    game.setTurnPlayer('p1');

    for (const letter of ['c', 'a', 's', 't', 'l', 'e']) {
      game.handleAction('p1', { type: 'guess', letter });
    }

    expect(game.isComplete()).toBe(true);
    expect(game.state).toBe('finished');
  });

  test('all players eliminated ends game', () => {
    // 2-player game, each gets 6 wrong guesses
    const twoPlayerGame = new Hangman(['p1', 'p2']);
    twoPlayerGame.startGame();
    twoPlayerGame.word = 'castle';
    twoPlayerGame.revealed = new Array('castle'.length).fill(false);
    twoPlayerGame.guessedLetters = new Set();
    twoPlayerGame.wrongCounts = { p1: 0, p2: 0 };
    twoPlayerGame.eliminated = [];
    twoPlayerGame.activePlayers = ['p1', 'p2'];
    twoPlayerGame.setTurnPlayer('p1');

    const wrongLetters = 'zxqwyv'.split('');
    const moreWrongLetters = 'bjfghm'.split('');

    // p1 and p2 alternate; each needs 6 wrong guesses
    for (let i = 0; i < 6; i++) {
      twoPlayerGame.handleAction('p1', { type: 'guess', letter: wrongLetters[i] });
      if (!twoPlayerGame.isComplete()) {
        twoPlayerGame.handleAction('p2', { type: 'guess', letter: moreWrongLetters[i] });
      }
    }

    expect(twoPlayerGame.isComplete()).toBe(true);
  });

  test('results: survivors first sorted by fewest wrong, then eliminated', () => {
    game.wrongCounts = { p1: 1, p2: 2, p3: 3 };
    game.eliminated = [];
    game.state = 'finished';

    const results = game.getResults();
    expect(results[0].playerId).toBe('p1');
    expect(results[1].playerId).toBe('p2');
    expect(results[2].playerId).toBe('p3');
    expect(results[0].placement).toBe(1);
  });

  test('results: eliminated players placed after survivors', () => {
    game.wrongCounts = { p1: 1, p2: 6, p3: 6 };
    game.eliminated = ['p3', 'p2']; // p3 eliminated first, then p2
    game.state = 'finished';

    const results = game.getResults();
    // p1 = survivor (placement 1)
    // p2 = eliminated last (placement 2 - higher among eliminated)
    // p3 = eliminated first (placement 3 - lower among eliminated)
    expect(results[0].playerId).toBe('p1');
    expect(results[0].eliminated).toBe(false);
    expect(results[1].eliminated).toBe(true);
    expect(results[2].eliminated).toBe(true);
    // Last eliminated should rank higher (lower placement number)
    expect(results[1].playerId).toBe('p2'); // last eliminated
    expect(results[2].playerId).toBe('p3'); // first eliminated
  });

  test('turn advances to next player after each guess', () => {
    game.handleAction('p1', { type: 'guess', letter: 'c' }); // correct
    expect(game.currentTurnPlayer).toBe('p2');

    game.handleAction('p2', { type: 'guess', letter: 'z' }); // wrong
    expect(game.currentTurnPlayer).toBe('p3');
  });

  test('non-turn player action is ignored', () => {
    const wrongCountBefore = game.wrongCounts['p2'];
    game.handleAction('p2', { type: 'guess', letter: 'z' }); // p1's turn
    expect(game.wrongCounts['p2']).toBe(wrongCountBefore);
  });

  test('getStateForPlayer hides the word during play', () => {
    const state = game.getStateForPlayer('p1');
    expect(state.word).toBeUndefined();
    expect(state.displayWord).toHaveLength(game.word.length);
    expect(state.displayWord.every((c) => c === '_')).toBe(true);
  });

  test('getStateForPlayer reveals word when game is finished', () => {
    game.state = 'finished';
    const state = game.getStateForPlayer('p1');
    expect(state.word).toBe(game.word);
  });

  test('isComplete returns false at start', () => {
    expect(game.isComplete()).toBe(false);
  });

  test('case-insensitive letter guessing', () => {
    game.handleAction('p1', { type: 'guess', letter: 'C' }); // uppercase
    expect(game.revealed[0]).toBe(true);
    expect(game.guessedLetters.has('c')).toBe(true);
  });
});
