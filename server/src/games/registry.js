import { Blackjack } from './Blackjack.js';
import { RockPaperScissors } from './RockPaperScissors.js';
import { War } from './War.js';
import { MemoryMatch } from './MemoryMatch.js';
import { LiarsDice } from './LiarsDice.js';

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
registerGame('war', War);
registerGame('memoryMatch', MemoryMatch);
registerGame('liarsDice', LiarsDice);
