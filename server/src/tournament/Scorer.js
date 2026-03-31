import { SCORING } from '../../../shared/constants.js';

export class Scorer {
  static getBasePoints(roundNumber) {
    return SCORING.BASE_START + (roundNumber - 1) * SCORING.BASE_INCREMENT;
  }

  static calculatePlacementPoints(placement, basePoints) {
    const index = Math.min(placement - 1, SCORING.PLACEMENT_MULTIPLIERS.length - 1);
    return Math.floor(basePoints * SCORING.PLACEMENT_MULTIPLIERS[index]);
  }

  static calculateWagerPayouts(wagers, placements) {
    const totalPot = Object.values(wagers).reduce((sum, w) => sum + w, 0);
    const payouts = {};
    for (const playerId of Object.keys(wagers)) payouts[playerId] = 0;
    if (totalPot === 0) return payouts;
    for (let i = 0; i < SCORING.WAGER_POT_SPLIT.length && i < placements.length; i++) {
      payouts[placements[i]] = Math.floor(totalPot * SCORING.WAGER_POT_SPLIT[i]);
    }
    return payouts;
  }

  static validateWager(amount, currentPoints) {
    if (amount < 0) return false;
    if (amount === 0) return true;
    if (currentPoints <= 0) return false;
    return amount <= Math.floor(currentPoints * SCORING.MAX_WAGER_PERCENT);
  }

  static calculateRoundScores(placements, wagers, roundNumber) {
    const basePoints = Scorer.getBasePoints(roundNumber);
    const wagerPayouts = Scorer.calculateWagerPayouts(wagers, placements);
    const scores = {};
    for (let i = 0; i < placements.length; i++) {
      const playerId = placements[i];
      const placement = i + 1;
      const base = Scorer.calculatePlacementPoints(placement, basePoints);
      const wagerCost = wagers[playerId] || 0;
      const wagerPayout = wagerPayouts[playerId] || 0;
      scores[playerId] = { placement, base, wagerCost, wagerPayout, total: base + wagerPayout - wagerCost };
    }
    return scores;
  }
}
