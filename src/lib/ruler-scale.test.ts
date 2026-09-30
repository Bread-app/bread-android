import { describe, expect, it } from 'vitest';

import {
  fractionToValue,
  logSnapStep,
  majorTickInterval,
  trackWindow,
  valueToFraction,
} from '@/lib/ruler-scale';

const TRACK = 780;
const MIN_GAP = 36;

describe('majorTickInterval', () => {
  it('gives two rulers of different range the same tick density', () => {
    // The bug: a 36% stop ruler and a 100% target ruler both on a 1% grid drew
    // 36 and 100 majors on identical widths — sparse bars beside a solid comb.
    const stop = majorTickInterval({
      majorEvery: 1,
      range: 35.8,
      trackPx: TRACK,
      minGapPx: MIN_GAP,
    });
    const target = majorTickInterval({
      majorEvery: 1,
      range: 99.8,
      trackPx: TRACK,
      minGapPx: MIN_GAP,
    });

    const stopTicks = 35.8 / stop;
    const targetTicks = 99.8 / target;
    // Not identical — intervals are round numbers, not arbitrary — but close
    // enough that neither ruler reads as a different control.
    expect(Math.abs(stopTicks - targetTicks)).toBeLessThan(4);
    for (const interval of [stop, target]) {
      expect((interval / (interval === stop ? 35.8 : 99.8)) * TRACK).toBeGreaterThanOrEqual(
        MIN_GAP,
      );
    }
  });

  it('keeps the caller interval when it is already wide enough', () => {
    // The close pad's 25% grid over 100% is four ticks — untouched.
    expect(majorTickInterval({ majorEvery: 25, range: 99, trackPx: TRACK, minGapPx: MIN_GAP }))
      .toBe(25);
  });

  it('only ever widens to a round multiple', () => {
    const interval = majorTickInterval({
      majorEvery: 1,
      range: 400,
      trackPx: TRACK,
      minGapPx: MIN_GAP,
    });
    expect([1, 2, 5, 10, 20, 25, 50, 100]).toContain(interval);
  });

  it('degrades to the caller interval rather than dividing by zero', () => {
    expect(majorTickInterval({ majorEvery: 1, range: 0, trackPx: TRACK, minGapPx: MIN_GAP }))
      .toBe(1);
    expect(majorTickInterval({ majorEvery: 1, range: 10, trackPx: 0, minGapPx: MIN_GAP }))
      .toBe(1);
  });
});

describe('log track', () => {
  const MIN = 0.2;
  const MAX = 1_000;

  it('round-trips a value through the track', () => {
    for (const value of [0.2, 1, 3, 12.5, 70, 420, 1_000]) {
      const f = valueToFraction(value, MIN, MAX);
      expect(fractionToValue(f, MIN, MAX)).toBeCloseTo(value, 6);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('never moves the value backwards as the finger moves forwards', () => {
    // The property the growing-ruler version broke: the same finger position
    // must always mean the same value, and moving right must always increase
    // it. No resizing, so no 70% → 4200% spike.
    let previous = -Infinity;
    for (let step = 0; step <= 100; step += 1) {
      const value = fractionToValue(step / 100, MIN, MAX);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('spends half the track on the settings people actually use', () => {
    // A linear 0.2–1000 track puts a 3% target 15 pixels from the left. The log
    // track puts the whole 0.2–14% band in the first half.
    const midpoint = fractionToValue(0.5, MIN, MAX);
    expect(midpoint).toBeGreaterThan(10);
    expect(midpoint).toBeLessThan(20);
    expect(valueToFraction(3, MIN, MAX)).toBeGreaterThan(0.3);
  });

  it('clamps out of range rather than escaping the track', () => {
    expect(valueToFraction(0.01, MIN, MAX)).toBe(0);
    expect(valueToFraction(9_999, MIN, MAX)).toBe(1);
    expect(fractionToValue(-1, MIN, MAX)).toBeCloseTo(MIN, 6);
    expect(fractionToValue(2, MIN, MAX)).toBeCloseTo(MAX, 6);
  });

  it('degrades safely on a range a log track cannot express', () => {
    expect(valueToFraction(5, 0, 100)).toBe(0);
    expect(fractionToValue(0.5, 10, 10)).toBe(10);
  });

  it('keeps about three significant figures at every magnitude', () => {
    expect(logSnapStep(0.34)).toBeCloseTo(0.01, 10);
    expect(logSnapStep(3.4)).toBeCloseTo(0.1, 10);
    expect(logSnapStep(34)).toBeCloseTo(1, 10);
    expect(logSnapStep(340)).toBeCloseTo(10, 10);
  });
});

describe('trackWindow', () => {
  const BASE = 200;
  const CAP = 25_000;

  it('keeps the base window until the value outgrows it', () => {
    expect(trackWindow(3, BASE, CAP)).toBe(BASE);
    expect(trackWindow(179, BASE, CAP)).toBe(BASE);
    expect(trackWindow(181, BASE, CAP)).toBe(1_000);
  });

  it('is idempotent — the same value always gives the same scale', () => {
    // The property that makes this safe to recompute on every release: the
    // previous window is not an input, so the mapping cannot drift the way the
    // old "double the current span" version did.
    for (const value of [3, 181, 900, 4_000, 20_000]) {
      const once = trackWindow(value, BASE, CAP);
      expect(trackWindow(value, once, CAP)).toBe(once);
    }
  });

  it('steps by a factor that barely moves the needle on a log track', () => {
    // Stepping up must read as the scale breathing, not as the value jumping.
    const before = valueToFraction(181, 0.2, trackWindow(179, BASE, CAP));
    const after = valueToFraction(181, 0.2, trackWindow(181, BASE, CAP));
    expect(before - after).toBeLessThan(0.25);
  });

  it('never exceeds the cap', () => {
    expect(trackWindow(1e9, BASE, CAP)).toBe(CAP);
  });

  it('degrades to the base on nonsense input', () => {
    expect(trackWindow(Number.NaN, BASE, CAP)).toBe(BASE);
    expect(trackWindow(50, 0, CAP)).toBe(0);
  });
});
