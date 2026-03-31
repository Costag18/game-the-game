import { Blackjack } from './Blackjack.js';

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
