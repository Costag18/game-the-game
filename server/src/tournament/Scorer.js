import { SCORING } from '../../../shared/constants.js';

export class Scorer {
  static getBasePoints(roundNumber) {
    return SCORING.BASE_START + (roundNumber - 1) * SCORING.BASE_INCREMENT;
  }

  static calculatePlacementPoints(placement, basePoints) {
    const index = Math.min(placement - 1, SCORING.PLACEMENT_MULTIPLIERS.length - 1);
    return Math.floor(basePoints * SCORING.PLACEMENT_MULTIPLIERS[index]);
  }

  /**
   * Wager return by placement, scaled to player count.
   * More players = higher rewards for top places, but break-even shifts to middle.
   */
  static calculateWagerReturn(wager, placement, playerCount) {
    const clamped = Math.min(Math.max(playerCount, 2), 8);
    const returns = SCORING.WAGER_RETURN_BY_PLAYERS[clamped] || SCORING.WAGER_RETURN_BY_PLAYERS[8];
    const index = Math.min(placement - 1, returns.length - 1);
    return Math.floor(wager * returns[index]);
  }

  /** Get the wager return table for a given player count (for client display). */
  static getWagerReturnTable(playerCount) {
    const clamped = Math.min(Math.max(playerCount, 2), 8);
    return SCORING.WAGER_RETURN_BY_PLAYERS[clamped] || SCORING.WAGER_RETURN_BY_PLAYERS[8];
  }

  static validateWager(amount, currentPoints) {
    if (amount < 0) return false;
    if (amount === 0) return true;
    if (currentPoints <= 0) return false;
    return amount <= Math.floor(currentPoints * SCORING.MAX_WAGER_PERCENT);
  }

  /**
   * Calculate round scores. `placements` is an array of player IDs ordered by rank.
   * `gameResults` is an optional array of { playerId, placement } from the game engine
   * which may contain ties (same placement number for multiple players).
   */
  static calculateRoundScores(placements, wagers, roundNumber, gameResults = null) {
    const basePoints = Scorer.getBasePoints(roundNumber);
    const scores = {};

    // Build a placement map — if gameResults has ties, use those placements
    const placementMap = {};
    if (gameResults && Array.isArray(gameResults)) {
      for (const r of gameResults) {
        if (r.playerId && r.placement) {
          placementMap[r.playerId] = r.placement;
        }
      }
    }

    for (let i = 0; i < placements.length; i++) {
      const playerId = placements[i];
      const placement = placementMap[playerId] || (i + 1);
      const base = Scorer.calculatePlacementPoints(placement, basePoints);
      const wagerCost = wagers[playerId] || 0;
      const wagerReturn = Scorer.calculateWagerReturn(wagerCost, placement, placements.length);
      const wagerNet = wagerReturn - wagerCost; // positive if profit, negative if loss
      scores[playerId] = { placement, base, wagerCost, wagerReturn, wagerNet, total: base + wagerNet };
    }
    return scores;
  }
}
