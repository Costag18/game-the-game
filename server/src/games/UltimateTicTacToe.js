import { PairingEngine } from './PairingEngine.js';
import { UltimateTTTMatch } from './UltimateTTTMatch.js';
import { TIMERS } from '../../../shared/constants.js';

/**
 * Ultimate Tic-Tac-Toe — 1v1, wrapped by the PairingEngine into a Swiss best-of-3
 * across all N tournament players. Thin wrapper: supplies the match factory + config;
 * all ranking/byes/timers/leave live in PairingEngine, one board in UltimateTTTMatch.
 */
export class UltimateTicTacToe extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new UltimateTTTMatch(p1, p2),
      miniRounds: 3,
      matchTimerSec: TIMERS.CARD_GAME,
      matchHardCapSec: 120,
      title: 'Ultimate Tic-Tac-Toe',
    });
  }
}
