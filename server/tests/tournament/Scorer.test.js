import { describe, test, expect } from '@jest/globals';
import { Scorer } from '../../src/tournament/Scorer.js';

describe('Scorer.getBasePoints', () => {
  test('round 1 returns 100', () => {
    expect(Scorer.getBasePoints(1)).toBe(100);
  });

  test('round 2 returns 150', () => {
    expect(Scorer.getBasePoints(2)).toBe(150);
  });

  test('round 5 returns 300', () => {
    expect(Scorer.getBasePoints(5)).toBe(300);
  });
});

describe('Scorer.calculatePlacementPoints', () => {
  test('1st place gets 100% of base points', () => {
    expect(Scorer.calculatePlacementPoints(1, 100)).toBe(100);
  });

  test('2nd place gets 70% of base points', () => {
    expect(Scorer.calculatePlacementPoints(2, 100)).toBe(70);
  });

  test('6th place gets 15% of base points', () => {
    expect(Scorer.calculatePlacementPoints(6, 100)).toBe(15);
  });

  test('7th place (beyond array) gets 15% (clamped to last multiplier)', () => {
    expect(Scorer.calculatePlacementPoints(7, 100)).toBe(15);
  });

  test('floors the result for fractional base points', () => {
    // 70% of 150 = 105
    expect(Scorer.calculatePlacementPoints(2, 150)).toBe(105);
    // 50% of 150 = 75
    expect(Scorer.calculatePlacementPoints(3, 150)).toBe(75);
  });
});

describe('Scorer.calculateWagerPayouts', () => {
  test('distributes pot 50/30/20 among top 3 placements', () => {
    const wagers = { p1: 100, p2: 100, p3: 100 };
    const placements = ['p1', 'p2', 'p3'];
    const payouts = Scorer.calculateWagerPayouts(wagers, placements);
    expect(payouts.p1).toBe(150); // 50% of 300
    expect(payouts.p2).toBe(90);  // 30% of 300
    expect(payouts.p3).toBe(60);  // 20% of 300
  });

  test('returns zeros when all wagers are zero', () => {
    const wagers = { p1: 0, p2: 0 };
    const placements = ['p1', 'p2'];
    const payouts = Scorer.calculateWagerPayouts(wagers, placements);
    expect(payouts.p1).toBe(0);
    expect(payouts.p2).toBe(0);
  });

  test('2-player game: only top 2 splits are used', () => {
    const wagers = { p1: 200, p2: 200 };
    const placements = ['p1', 'p2'];
    const payouts = Scorer.calculateWagerPayouts(wagers, placements);
    expect(payouts.p1).toBe(200); // 50% of 400
    expect(payouts.p2).toBe(120); // 30% of 400
  });

  test('players who did not wager get 0 payout', () => {
    const wagers = { p1: 100, p2: 0, p3: 100 };
    const placements = ['p1', 'p2', 'p3'];
    const payouts = Scorer.calculateWagerPayouts(wagers, placements);
    // Total pot = 200; p1 gets 50%=100, p2 gets 30%=60, p3 gets 20%=40
    expect(payouts.p1).toBe(100);
    expect(payouts.p2).toBe(60);
    expect(payouts.p3).toBe(40);
  });
});

describe('Scorer.validateWager', () => {
  test('valid wager within 50% of current points', () => {
    expect(Scorer.validateWager(50, 100)).toBe(true);
  });

  test('valid wager at exactly 50% of current points', () => {
    expect(Scorer.validateWager(50, 100)).toBe(true);
  });

  test('rejects wager over 50% of current points', () => {
    expect(Scorer.validateWager(51, 100)).toBe(false);
  });

  test('zero wager is always valid', () => {
    expect(Scorer.validateWager(0, 0)).toBe(true);
    expect(Scorer.validateWager(0, 100)).toBe(true);
  });

  test('rejects negative wager', () => {
    expect(Scorer.validateWager(-1, 100)).toBe(false);
  });

  test('rejects any positive wager when current points are 0 or less', () => {
    expect(Scorer.validateWager(1, 0)).toBe(false);
    expect(Scorer.validateWager(10, -50)).toBe(false);
  });
});

describe('Scorer.calculateRoundScores', () => {
  test('combines base points and wager payouts correctly for a full round', () => {
    const placements = ['p1', 'p2', 'p3'];
    const wagers = { p1: 50, p2: 30, p3: 20 };
    const roundNumber = 1; // basePoints = 100

    const scores = Scorer.calculateRoundScores(placements, wagers, roundNumber);

    // Total pot = 100; p1 50%, p2 30%, p3 20%
    // p1: base=100 (1st, 100%), wagerCost=50, wagerPayout=50 => total=100
    expect(scores.p1.placement).toBe(1);
    expect(scores.p1.base).toBe(100);
    expect(scores.p1.wagerCost).toBe(50);
    expect(scores.p1.wagerPayout).toBe(50);
    expect(scores.p1.total).toBe(100);

    // p2: base=70 (2nd, 70%), wagerCost=30, wagerPayout=30 => total=70
    expect(scores.p2.placement).toBe(2);
    expect(scores.p2.base).toBe(70);
    expect(scores.p2.wagerCost).toBe(30);
    expect(scores.p2.wagerPayout).toBe(30);
    expect(scores.p2.total).toBe(70);

    // p3: base=50 (3rd, 50%), wagerCost=20, wagerPayout=20 => total=50
    expect(scores.p3.placement).toBe(3);
    expect(scores.p3.base).toBe(50);
    expect(scores.p3.wagerCost).toBe(20);
    expect(scores.p3.wagerPayout).toBe(20);
    expect(scores.p3.total).toBe(50);
  });

  test('works with no wagers (all zeros)', () => {
    const placements = ['p1', 'p2'];
    const wagers = { p1: 0, p2: 0 };
    const roundNumber = 2; // basePoints = 150

    const scores = Scorer.calculateRoundScores(placements, wagers, roundNumber);

    expect(scores.p1.base).toBe(150);
    expect(scores.p1.wagerCost).toBe(0);
    expect(scores.p1.wagerPayout).toBe(0);
    expect(scores.p1.total).toBe(150);

    expect(scores.p2.base).toBe(105); // 70% of 150
    expect(scores.p2.total).toBe(105);
  });

  test('higher round number increases base points', () => {
    const placements = ['p1'];
    const wagers = { p1: 0 };
    const scores = Scorer.calculateRoundScores(placements, wagers, 5);
    expect(scores.p1.base).toBe(300); // basePoints=300, 1st place 100%
  });
});
