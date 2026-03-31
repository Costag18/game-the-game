import { TIMERS } from './constants.js';

export const GAMES = {
  blackjack: {
    id: 'blackjack', name: 'Blackjack', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Beat the dealer. Closest to 21 wins.',
  },
  poker: {
    id: 'poker', name: 'Texas Hold\'em', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Best hand wins the pot.',
  },
  uno: {
    id: 'uno', name: 'Uno', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'First to empty your hand wins.',
  },
  war: {
    id: 'war', name: 'War', minPlayers: 2, maxPlayers: 2,
    turnTimer: TIMERS.CARD_GAME, description: 'Flip and compare. Highest card takes both.',
  },
  goFish: {
    id: 'goFish', name: 'Go Fish', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Collect the most sets of four.',
  },
  crazyEights: {
    id: 'crazyEights', name: 'Crazy Eights', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Match suit or rank. First to empty hand wins.',
  },
  rps: {
    id: 'rps', name: 'Rock Paper Scissors', minPlayers: 2, maxPlayers: 2,
    turnTimer: TIMERS.RPS, description: 'Best of 5. Choose wisely.',
  },
  liarsDice: {
    id: 'liarsDice', name: 'Liar\'s Dice', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Bluff or call. Last player with dice wins.',
  },
  memoryMatch: {
    id: 'memoryMatch', name: 'Memory Match', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Flip pairs. Best memory wins.',
  },
  roulette: {
    id: 'roulette', name: 'Roulette', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.ROULETTE, description: 'Place your bets. Highest winnings ranks first.',
  },
  hangman: {
    id: 'hangman', name: 'Hangman', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Guess the word. Fewest wrong guesses wins.',
  },
};

export function getEligibleGames(playerCount) {
  return Object.values(GAMES).filter(
    (g) => playerCount >= g.minPlayers && playerCount <= g.maxPlayers
  );
}
