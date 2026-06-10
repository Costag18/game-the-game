import { PairingEngine } from './PairingEngine.js';
import { HexMatch } from './HexMatch.js';
import { TIMERS } from '../../../shared/constants.js';

/**
 * Hex — inherently 1v1, wrapped by the PairingEngine into a Swiss best-of-3 across
 * all N tournament players. This wrapper is intentionally thin: it only supplies
 * the match factory + config; all ranking/byes/timers/leave live in PairingEngine,
 * and one board lives in HexMatch.
 */
export class Hex extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new HexMatch(p1, p2),
      miniRounds: 3,
      matchTimerSec: TIMERS.CARD_GAME,
      matchHardCapSec: 120,
      title: 'Hex',
    });
  }
}
