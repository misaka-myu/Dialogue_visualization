import { describe, it, expect } from 'vitest';
import { niceCeil, yTicks } from '../../src/renderer/views/TokenChartView';

// Regression suite for the BUG-2a / BUG-2b fixes. The Epicurus agent
// report flagged niceCeil(1001..1999) returning 1000 and yTicks emitting
// non-nice numbers. Both claims were false alarms on read of the
// current code, but we lock the behaviour down so any future
// regression gets caught.
describe('niceCeil', () => {
  it('rounds <=1 to 1', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(0.5)).toBe(1);
    expect(niceCeil(1)).toBe(1);
  });

  it('snaps sub-1000 to 1, 2, 5, 10', () => {
    expect(niceCeil(1.5)).toBe(2);
    expect(niceCeil(2)).toBe(2);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(5)).toBe(5);
    expect(niceCeil(6)).toBe(10);
    expect(niceCeil(9.99)).toBe(10);
  });

  it('snaps the 1000..9999 range to 1000, 2000, 5000, 10000', () => {
    // The 1001..1999 case was specifically called out in the audit.
    expect(niceCeil(1000)).toBe(1000);
    expect(niceCeil(1001)).toBe(2000);
    expect(niceCeil(1500)).toBe(2000);
    expect(niceCeil(1999)).toBe(2000);
    expect(niceCeil(2000)).toBe(2000);
    expect(niceCeil(2001)).toBe(5000);
    expect(niceCeil(5000)).toBe(5000);
    expect(niceCeil(5001)).toBe(10000);
    expect(niceCeil(9999)).toBe(10000);
  });

  it('snaps the 10000+ range correctly', () => {
    expect(niceCeil(10000)).toBe(10000);
    expect(niceCeil(10001)).toBe(20000);
    expect(niceCeil(23456)).toBe(50000);
    expect(niceCeil(67890)).toBe(100000);
  });
});

describe('yTicks', () => {
  it('emits 5 evenly-spaced ticks from 0..max for nice max', () => {
    expect(yTicks(1000)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(yTicks(2000)).toEqual([0, 400, 800, 1200, 1600, 2000]);
    expect(yTicks(5000)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(yTicks(10000)).toEqual([0, 2000, 4000, 6000, 8000, 10000]);
  });

  it('rounds the last tick to max (no floating-point drift)', () => {
    const ticks = yTicks(1000);
    expect(ticks[ticks.length - 1]).toBe(1000);
  });
});
