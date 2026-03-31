import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Timer } from '../../src/utils/Timer.js';

describe('Timer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('getRemainingSeconds returns the full duration before starting', () => {
    const timer = new Timer(10, () => {}, () => {});
    expect(timer.getRemainingSeconds()).toBe(10);
  });

  test('onTick is called with remaining seconds each second', () => {
    const ticks = [];
    const timer = new Timer(3, (remaining) => ticks.push(remaining), () => {});
    timer.start();

    jest.advanceTimersByTime(1000);
    expect(ticks).toEqual([2]);

    jest.advanceTimersByTime(1000);
    expect(ticks).toEqual([2, 1]);
  });

  test('onExpire is called when time runs out', () => {
    const onExpire = jest.fn();
    const timer = new Timer(3, () => {}, onExpire);
    timer.start();

    jest.advanceTimersByTime(3000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('onTick is NOT called on the final tick — onExpire is called instead', () => {
    const ticks = [];
    const onExpire = jest.fn();
    const timer = new Timer(2, (r) => ticks.push(r), onExpire);
    timer.start();

    jest.advanceTimersByTime(2000);
    // tick at 1s gives remaining=1, tick at 2s hits 0 → onExpire, not onTick
    expect(ticks).toEqual([1]);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('getRemainingSeconds decreases each second', () => {
    const timer = new Timer(5, () => {}, () => {});
    timer.start();

    jest.advanceTimersByTime(2000);
    expect(timer.getRemainingSeconds()).toBe(3);
  });

  test('stop prevents further ticks', () => {
    const ticks = [];
    const timer = new Timer(10, (r) => ticks.push(r), () => {});
    timer.start();

    jest.advanceTimersByTime(3000);
    timer.stop();
    jest.advanceTimersByTime(5000);

    expect(ticks).toHaveLength(3);
  });

  test('stop prevents onExpire from firing', () => {
    const onExpire = jest.fn();
    const timer = new Timer(5, () => {}, onExpire);
    timer.start();

    jest.advanceTimersByTime(3000);
    timer.stop();
    jest.advanceTimersByTime(3000);

    expect(onExpire).not.toHaveBeenCalled();
  });

  test('stop is safe to call multiple times', () => {
    const timer = new Timer(5, () => {}, () => {});
    timer.start();
    expect(() => {
      timer.stop();
      timer.stop();
    }).not.toThrow();
  });

  test('start resets remaining to full duration', () => {
    const timer = new Timer(5, () => {}, () => {});
    timer.start();
    jest.advanceTimersByTime(3000);
    timer.stop();
    timer.start();
    expect(timer.getRemainingSeconds()).toBe(5);
  });
});
