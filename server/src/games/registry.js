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
import { DefinitionDuel } from './DefinitionDuel.js';
import { QuiplashClash } from './QuiplashClash.js';
import { CaptionThis } from './CaptionThis.js';
import { AwkwardAward } from './AwkwardAward.js';
import { MostLikelyTo } from './MostLikelyTo.js';
import { VoteProphet } from './VoteProphet.js';
import { GroupMind } from './GroupMind.js';
import { MobRule } from './MobRule.js';
import { TwoTruths } from './TwoTruths.js';
import { SuperlativeShowdown } from './SuperlativeShowdown.js';
import { Spyfall } from './Spyfall.js';
import { ChameleonClues } from './ChameleonClues.js';
import { TraitorsVault } from './TraitorsVault.js';
import { WhisperNetwork } from './WhisperNetwork.js';
import { SketchImpostor } from './SketchImpostor.js';
import { TakeSix } from './TakeSix.js';
import { PressYourLuckPigs } from './PressYourLuckPigs.js';
import { Qwixx } from './Qwixx.js';
import { Yahtzee } from './Yahtzee.js';
import { DominoDrift } from './DominoDrift.js';
import { BingoBrawl } from './BingoBrawl.js';
import { TwentyFour } from './TwentyFour.js';
import { TargetLocked } from './TargetLocked.js';
import { FactorFrenzy } from './FactorFrenzy.js';

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
registerGame('definitionDuel', DefinitionDuel);
registerGame('quiplashClash', QuiplashClash);
registerGame('captionThis', CaptionThis);
registerGame('awkwardAward', AwkwardAward);
registerGame('mostLikelyTo', MostLikelyTo);
registerGame('voteProphet', VoteProphet);
registerGame('groupMind', GroupMind);
registerGame('mobRule', MobRule);
registerGame('twoTruths', TwoTruths);
registerGame('superlativeShowdown', SuperlativeShowdown);
registerGame('spyfall', Spyfall);
registerGame('chameleon', ChameleonClues);
registerGame('traitorsVault', TraitorsVault);
registerGame('whisperNetwork', WhisperNetwork);
registerGame('sketchImpostor', SketchImpostor);
registerGame('takeSix', TakeSix);
registerGame('pressYourLuckPigs', PressYourLuckPigs);
registerGame('qwixx', Qwixx);
registerGame('yahtzee', Yahtzee);
registerGame('dominoDrift', DominoDrift);
registerGame('bingoBrawl', BingoBrawl);
registerGame('twentyFour', TwentyFour);
registerGame('targetLocked', TargetLocked);
registerGame('factorFrenzy', FactorFrenzy);
