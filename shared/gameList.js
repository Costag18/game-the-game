import { TIMERS } from './constants.js';

export const GAMES = {
  blackjack: {
    id: 'blackjack', name: 'Blackjack', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Beat the dealer. Closest to 21 wins.',
    tutorial: 'https://www.youtube.com/watch?v=TDkbWXJ16hU',
  },
  poker: {
    id: 'poker', name: 'Texas Hold\'em', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Best hand wins the pot.',
    tutorial: 'https://www.youtube.com/watch?v=b9HYxquQt-M',
  },
  uno: {
    id: 'uno', name: 'Uno', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'First to empty your hand wins.',
    tutorial: 'https://www.youtube.com/watch?v=sWoSZmHsCls',
  },
  goFish: {
    id: 'goFish', name: 'Go Fish', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Collect the most sets of four.',
    tutorial: 'https://www.youtube.com/watch?v=emvdufe6t-8',
  },
  crazyEights: {
    id: 'crazyEights', name: 'Crazy Eights', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Match suit or rank. First to empty hand wins.',
    tutorial: 'https://www.youtube.com/watch?v=1c4YPQTS35I',
  },
  rps: {
    id: 'rps', name: 'Rock Paper Scissors', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.RPS, description: 'Best of 5. Choose wisely.',
    tutorial: 'https://www.youtube.com/watch?v=2dsHuU10udY',
  },
  liarsDice: {
    id: 'liarsDice', name: 'Liar\'s Dice', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Bluff or call. Last player with dice wins.',
    tutorial: 'https://www.youtube.com/watch?v=fAbnMuiR734',
  },
  memoryMatch: {
    id: 'memoryMatch', name: 'Memory Match', minPlayers: 2, maxPlayers: 6,
    turnTimer: TIMERS.CARD_GAME, description: 'Flip pairs. Best memory wins.',
    tutorial: 'https://www.youtube.com/watch?v=wQV5RJKs_qI',
  },
  roulette: {
    id: 'roulette', name: 'Roulette', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.ROULETTE, description: 'Place your bets. Highest winnings ranks first.',
    tutorial: 'https://www.youtube.com/watch?v=YuePFYmplm0',
  },
  hangman: {
    id: 'hangman', name: 'Hangman', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.CARD_GAME, description: 'Guess the word. Fewest wrong guesses wins.',
    tutorial: 'https://www.youtube.com/watch?v=leW9ZotUVYo',
  },
  spotTheDifference: {
    id: 'spotTheDifference', name: 'Spot the Difference', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.SPOT_DIFFERENCE, description: 'Race to find differences between two grids. First to spot wins!',
    instructions: [
      'Two grids of colored shapes are shown side by side — one is the original, the other has been modified.',
      'Click on any cell where you spot a difference between the two grids (color, shape, size, or rotation).',
      'First player to click a difference gets +150 points. Wrong clicks cost -25 points with a 1-second cooldown.',
      'There are 3 rounds with increasing difficulty: 5, 7, then 9 differences to find.',
      'Each round has a 45-second timer. The round ends when all differences are found or time runs out.',
      'Highest total score across all rounds wins!',
    ],
  },
  battleship: {
    id: 'battleship', name: 'Battleship', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.BATTLESHIP, description: 'Place your fleet and sink your opponent\'s ships!',
    tutorial: 'https://www.youtube.com/watch?v=RY4nAyRgkLo',
    instructions: [
      'Place 5 ships on your 10×10 grid during the setup phase (60 seconds).',
      'Ships: Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2).',
      'Take turns firing at your opponent\'s grid. Hits are red, misses are white.',
      'Hit a ship = fire again! Miss = opponent\'s turn.',
      'Sink all 5 of your opponent\'s ships to win.',
    ],
  },
  reactionTap: {
    id: 'reactionTap', name: 'Reaction Tap', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.REACTION_TAP,
    description: 'Wait for green, then tap. Fastest reflexes win.',
    instructions: [
      'Each round shows a red WAIT screen. Do NOT tap while it is red.',
      'After a random delay (1.5–5s) the screen turns green and says GO — tap as fast as you can.',
      'Tapping while red is a foul (max 3000ms penalty). Not tapping in time also scores the max.',
      'Your reaction time in milliseconds is recorded by the server (lower is better).',
      'Play 5 rounds; the lowest total reaction time across all rounds wins.',
      'Note: your network latency is included in the measured time — the server times your tap on its own clock and never trusts the browser, so results are spoof-proof but slightly favor faster connections.',
    ],
  },
  typingRace: {
    id: 'typingRace', name: 'Typing Race', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.TYPING,
    description: 'Transcribe the scroll fastest. First to finish wins the sprint.',
    instructions: [
      'A passage from an ancient scroll appears — type it exactly as written.',
      'Your typing is checked live: a wrong character stops your progress until you fix it (backspace and retype).',
      'Watch the race track — every player\'s marker crawls toward the finish line in real time.',
      'You have 90 seconds. First player to finish the whole passage ranks highest.',
      'If time runs out, players are ranked by how many correct characters they typed, then by speed.',
      'Your WPM (words per minute) is shown live and frozen when you finish.',
    ],
  },
  scattergories: {
    id: 'scattergories', name: 'Scattergories', minPlayers: 2, maxPlayers: 8,
    turnTimer: TIMERS.SCATTERGORIES,
    description: 'One letter, ten categories. Be the only one with each answer.',
    instructions: [
      'Each round a random letter and 10 categories appear.',
      'Type one answer per category that STARTS with the letter, before the 75-second timer runs out.',
      'An answer scores 1 point only if it is valid AND unique — if two or more players write the same thing, nobody gets the point.',
      'Empty answers and answers that do not start with the letter score 0.',
      'There are 3 rounds. Highest total of unique answers wins!',
    ],
  },
};

export function getEligibleGames(playerCount) {
  return Object.values(GAMES).filter(
    (g) => playerCount >= g.minPlayers && playerCount <= g.maxPlayers
  );
}
