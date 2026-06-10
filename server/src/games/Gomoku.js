import { PairingEngine } from './PairingEngine.js';
import { GomokuMatch } from './GomokuMatch.js';
import { TIMERS } from '../../../shared/constants.js';

/**
 * Gomoku (Five in a Row) — inherently 1v1, wrapped by the PairingEngine into a
 * Swiss best-of-3 across all N tournament players. This wrapper is intentionally
 * thin: it only supplies the match factory + config; all ranking/byes/timers/leave
 * live in PairingEngine, and one 15x15 board lives in GomokuMatch.
 */
export class Gomoku extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new GomokuMatch(p1, p2),
      miniRounds: 3,
      matchTimerSec: TIMERS.CARD_GAME,
      matchHardCapSec: 120,
      title: 'Gomoku',
    });
  }
}
