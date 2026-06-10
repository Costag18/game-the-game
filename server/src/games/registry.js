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
import { Skribbl } from './Skribbl.js';
import { TelephonePictionary } from './TelephonePictionary.js';
import { Othello } from './Othello.js';
import { DotsAndBoxes } from './DotsAndBoxes.js';
import { Gomoku } from './Gomoku.js';
import { Hex } from './Hex.js';
import { OrderAndChaos } from './OrderAndChaos.js';
import { NimHeist } from './NimHeist.js';
import { BuzzerRoyale } from './BuzzerRoyale.js';
import { HigherLower } from './HigherLower.js';
import { PriceIsWrong } from './PriceIsWrong.js';
import { Timeline } from './Timeline.js';
import { Guesstimate } from './Guesstimate.js';
import { OddOneOut } from './OddOneOut.js';
import { RankIt } from './RankIt.js';
import { ThisOrThat } from './ThisOrThat.js';

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
registerGame('skribbl', Skribbl);
registerGame('telephonePictionary', TelephonePictionary);
registerGame('othello', Othello);
registerGame('dotsAndBoxes', DotsAndBoxes);
registerGame('gomoku', Gomoku);
registerGame('hex', Hex);
registerGame('orderChaos', OrderAndChaos);
registerGame('nim', NimHeist);
registerGame('buzzerRoyale', BuzzerRoyale);
registerGame('higherLower', HigherLower);
registerGame('priceIsWrong', PriceIsWrong);
registerGame('timeline', Timeline);
registerGame('guesstimate', Guesstimate);
registerGame('oddOneOut', OddOneOut);
registerGame('rankIt', RankIt);
registerGame('thisOrThat', ThisOrThat);
