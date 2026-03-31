import { TIMERS } from './constants.js';

export const GAMES = {
  blackjack: {
    id: 'blackjack', name: 'Blackjack', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Beat the dealer. Closest to 21 wins.',
    tutorial: 'https://www.youtube.com/watch?v=eyoh-Ku9TCI',
  },
  poker: {
    id: 'poker', name: 'Texas Hold\'em', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Best hand wins the pot.',
    tutorial: 'https://www.youtube.com/watch?v=GAoR9ji8D6A',
  },
  uno: {
    id: 'uno', name: 'Uno', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'First to empty your hand wins.',
    tutorial: 'https://www.youtube.com/watch?v=p9n408gtqJQ',
  },
  war: {
    id: 'war', name: 'War', minPlayers: 2, maxPlayers: 2,
    turnTimer: TIMERS.CARD_GAME, description: 'Flip and compare. Highest card takes both.',
    tutorial: 'https://www.youtube.com/watch?v=J5vT33Vo04s',
  },
  goFish: {
    id: 'goFish', name: 'Go Fish', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Collect the most sets of four.',
    tutorial: 'https://www.youtube.com/watch?v=hDMzuvoGfOE',
  },
  crazyEights: {
    id: 'crazyEights', name: 'Crazy Eights', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Match suit or rank. First to empty hand wins.',
    tutorial: 'https://www.youtube.com/watch?v=KOHhx0Y3TC8',
  },
  rps: {
    id: 'rps', name: 'Rock Paper Scissors', minPlayers: 2, maxPlayers: 2,
    turnTimer: TIMERS.RPS, description: 'Best of 5. Choose wisely.',
    tutorial: 'https://www.youtube.com/watch?v=rudzYPHuewc',
  },
  liarsDice: {
    id: 'liarsDice', name: 'Liar\'s Dice', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Bluff or call. Last player with dice wins.',
    tutorial: 'https://www.youtube.com/watch?v=aVhHPm_nNGM',
  },
  memoryMatch: {
    id: 'memoryMatch', name: 'Memory Match', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Flip pairs. Best memory wins.',
    tutorial: 'https://www.youtube.com/watch?v=491bEaMLFGo',
  },
  roulette: {
    id: 'roulette', name: 'Roulette', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.ROULETTE, description: 'Place your bets. Highest winnings ranks first.',
    tutorial: 'https://www.youtube.com/watch?v=WLsgBaAszVQ',
  },
  hangman: {
    id: 'hangman', name: 'Hangman', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Guess the word. Fewest wrong guesses wins.',
    tutorial: 'https://www.youtube.com/watch?v=j6x-nHFbKFo',
  },
};

export function getEligibleGames(playerCount) {
  return Object.values(GAMES).filter(
    (g) => playerCount >= g.minPlayers && playerCount <= g.maxPlayers
  );
}
