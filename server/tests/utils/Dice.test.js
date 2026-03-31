import { describe, test, expect } from '@jest/globals';
import { rollDice, rollMultiple } from '../../src/utils/Dice.js';

describe('rollDice', () => {
  test('returns a number between 1 and 6 (default sides)', () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice();
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(6);
    }
  });

  test('returns an integer', () => {
    const result = rollDice();
    expect(Number.isInteger(result)).toBe(true);
  });

  test('respects custom sides (d20)', () => {
    for (let i = 0; i < 200; i++) {
      const result = rollDice(20);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(20);
    }
  });

  test('respects custom sides (d4)', () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice(4);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(4);
    }
  });

  test('returns 1 for a 1-sided die', () => {
    expect(rollDice(1)).toBe(1);
  });
});

describe('rollMultiple', () => {
  test('returns an array of the specified count', () => {
    const results = rollMultiple(3);
    expect(results).toHaveLength(3);
  });

  test('each element is between 1 and 6 by default', () => {
    const results = rollMultiple(50);
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });

  test('respects custom sides', () => {
    const results = rollMultiple(20, 10);
    expect(results).toHaveLength(20);
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(10);
    }
  });

  test('returns an empty array for count 0', () => {
    expect(rollMultiple(0)).toHaveLength(0);
  });

  test('returns an array (not other iterable)', () => {
    expect(Array.isArray(rollMultiple(3))).toBe(true);
  });
});
