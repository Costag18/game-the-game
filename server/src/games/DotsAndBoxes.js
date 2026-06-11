import { PairingEngine } from './PairingEngine.js';
import { DotsAndBoxesMatch } from './DotsAndBoxesMatch.js';

/**
 * Dots And Boxes — inherently 1v1, wrapped by the PairingEngine. Tuned to be a single,
 * relaxed match: ONE mini-round (each player plays one 1v1, ranked by win/loss) and NO
 * per-turn countdown (`noTurnTimer`) so players can think — a generous 5-minute hard cap
 * is the only safety against an abandoned game stalling the barrier.
 */
export class DotsAndBoxes extends PairingEngine {
  constructor(players) {
    super(players, {
      matchFactory: (p1, p2) => new DotsAndBoxesMatch(p1, p2),
      miniRounds: 1,
      noTurnTimer: true,
      matchHardCapSec: 300,
      title: 'Dots And Boxes',
    });
  }
}
