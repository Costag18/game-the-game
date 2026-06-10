import { PairingEngine } from './PairingEngine.js';
import { LiarsMarketMatch } from './LiarsMarketMatch.js';
import { TIMERS } from '../../../shared/constants.js';

/**
 * Liar's Market — inherently 1v1 (a hidden-value bluffing duel), wrapped by the
 * PairingEngine into a Swiss best-of-3 across all N tournament players. This wrapper
 * is intentionally thin: it only supplies the match factory + config; all
 * ranking/byes/timers/leave live in PairingEngine, and one duel lives in
 * LiarsMarketMatch.
 */
export class LiarsMarket extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new LiarsMarketMatch(p1, p2),
      miniRounds: 3,
      matchTimerSec: TIMERS.CARD_GAME,
      matchHardCapSec: 120,
      title: "Liar's Market",
    });
  }
}
