import { PairingEngine } from './PairingEngine.js';
import { Connect4Match } from './Connect4Match.js';
import { TIMERS } from '../../../shared/constants.js';

/**
 * Connect 4 — inherently 1v1, wrapped by the PairingEngine into a Swiss best-of-3
 * across all N tournament players. This wrapper is intentionally thin: it only
 * supplies the match factory + config; all ranking/byes/timers/leave live in
 * PairingEngine, and one board lives in Connect4Match.
 */
export class Connect4 extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new Connect4Match(p1, p2),
      miniRounds: 3,
      matchTimerSec: TIMERS.CARD_GAME,
      matchHardCapSec: 90,
      title: 'Connect 4',
    });
  }
}
