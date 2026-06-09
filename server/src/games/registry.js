import { Blackjack } from './Blackjack.js';
import { Poker } from './Poker.js';
import { RockPaperScissors } from './RockPaperScissors.js';

import { MemoryMatch } from './MemoryMatch.js';
import { LiarsDice } from './LiarsDice.js';
import { Uno } from './Uno.js';
import { CrazyEights } from './CrazyEights.js';
import { GoFish } from './GoFish.js';
import { Roulette } from './Roulette.js';
import { Hangman } from './Hangman.js';
import { SpotTheDifference } from './SpotTheDifference.js';
import { Battleship } from './Battleship.js';
import { ReactionTap } from './ReactionTap.js';
import { TypingRace } from './TypingRace.js';
import { Scattergories } from './Scattergories.js';
import { BsCheat } from './BsCheat.js';
import { Wavelength } from './Wavelength.js';
import { AimTrainer } from './AimTrainer.js';
import { Mastermind } from './Mastermind.js';
import { President } from './President.js';
import { Spoons } from './Spoons.js';
import { Fibbage } from './Fibbage.js';
import { Connect4 } from './Connect4.js';
import { UltimateTicTacToe } from './UltimateTicTacToe.js';

const gameEngines = {};

export function registerGame(gameId, EngineClass) {
  gameEngines[gameId] = EngineClass;
}

export function createGame(gameId, players) {
  const EngineClass = gameEngines[gameId];
  if (!EngineClass) throw new Error(`No engine registered for game: ${gameId}`);
  return new EngineClass(players);
}

export function isGameRegistered(gameId) {
  return gameId in gameEngines;
}

export function getRegisteredGames() {
  return Object.keys(gameEngines);
}

registerGame('blackjack', Blackjack);
registerGame('rps', RockPaperScissors);

registerGame('memoryMatch', MemoryMatch);
registerGame('liarsDice', LiarsDice);
registerGame('uno', Uno);
registerGame('crazyEights', CrazyEights);
registerGame('goFish', GoFish);
registerGame('roulette', Roulette);
registerGame('hangman', Hangman);
registerGame('poker', Poker);
registerGame('spotTheDifference', SpotTheDifference);
registerGame('battleship', Battleship);
registerGame('reactionTap', ReactionTap);
registerGame('typingRace', TypingRace);
registerGame('scattergories', Scattergories);
registerGame('bsCheat', BsCheat);
registerGame('wavelength', Wavelength);
registerGame('aimTrainer', AimTrainer);
registerGame('mastermind', Mastermind);
registerGame('president', President);
registerGame('spoons', Spoons);
registerGame('fibbage', Fibbage);
registerGame('connect4', Connect4);
registerGame('ultimateTTT', UltimateTicTacToe);
