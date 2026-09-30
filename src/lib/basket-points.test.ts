import { describe, expect, it } from 'vitest';

import {
  anchorLatestReturn,
  buildBasketPoints,
  clipCandlesAt,
  synthesizeFallbackPoints,
  type LoadedLeg,
} from '@/lib/basket-points';
import { legSign } from '@/lib/sandwich-pnl';

/**
 * The chart's curve has to move the same way its headline number does.
 *
 * Candles are the raw price of the underlying, which moves AGAINST a short — so
 * an unsigned curve drew a winning short as a falling line. That was survivable
 * to look at but not to reason from, and `anchorLatestReturn` hid it: the sign
 * disagreement pushed every short down the additive branch, which lands the
 * ENDPOINT on the right number while leaving the shape inverted. Hence the
 * intermediate-point assertions below — the endpoint is correct either way,
 * which is exactly why the bug survived.
 */

function candles(closes: number[], stepMs = 60 * 60 * 1000) {
  const start = Date.UTC(2026, 0, 1);
  return closes.map((close, i) => ({
    timestamp: start + i * stepMs,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

function loaded(
  leg: Partial<LoadedLeg['leg']> & { weightBps: number },
  closes: number[],
): LoadedLeg {
  return {
    leg: { label: 'L', mint: 'mint', type: 'tokenized_stock', side: 'long', ...leg },
    items: candles(closes),
  };
}

describe('legSign', () => {
  it('flips short and sell, leaves long alone', () => {
    expect(legSign({ type: 'tokenized_stock', side: 'short' })).toBe(-1);
    expect(legSign({ type: 'tokenized_stock', side: 'SELL' })).toBe(-1);
    expect(legSign({ type: 'tokenized_stock', side: 'long' })).toBe(1);
  });

  it('never flips a prediction leg, whatever its side is called', () => {
    // A prediction market prices the OUTCOME, so a "no" share rising IS a gain.
    expect(legSign({ type: 'prediction_market', side: 'no' })).toBe(1);
  });
});

describe('buildBasketPoints', () => {
  it('draws a short as gaining when the underlying falls', () => {
    const points = buildBasketPoints([loaded({ weightBps: 10000, side: 'short' }, [100, 90, 80])], '1H');

    expect(points.at(-1)!.returnPct).toBeCloseTo(20, 6);
    // Monotonically UP across the window, not just right at the end.
    expect(points[1].returnPct).toBeCloseTo(10, 6);
    expect(points.every((p, i) => i === 0 || p.returnPct >= points[i - 1].returnPct)).toBe(true);
  });

  it('draws a short as losing when the underlying rallies', () => {
    const points = buildBasketPoints([loaded({ weightBps: 10000, side: 'short' }, [100, 110, 120])], '1H');

    expect(points.at(-1)!.returnPct).toBeCloseTo(-20, 6);
  });

  it('signs the return rather than inverting the ratio', () => {
    // A 50% drop is a +50% short, NOT the +100% that `1 / ratio` would produce.
    // This is the point where the client would silently diverge from the server.
    const points = buildBasketPoints([loaded({ weightBps: 10000, side: 'short' }, [100, 75, 50])], '1H');

    expect(points.at(-1)!.returnPct).toBeCloseTo(50, 6);
  });

  it('leaves a long untouched', () => {
    const points = buildBasketPoints([loaded({ weightBps: 10000 }, [100, 110, 120])], '1H');

    expect(points.at(-1)!.returnPct).toBeCloseTo(20, 6);
  });

  it('adds a winning short to a winning long instead of cancelling it', () => {
    const points = buildBasketPoints(
      [
        loaded({ weightBps: 5000, mint: 'a' }, [100, 110]),
        loaded({ weightBps: 5000, mint: 'b', side: 'short' }, [100, 90]),
      ],
      '1H',
    );

    expect(points.at(-1)!.returnPct).toBeCloseTo(10, 6);
  });

  it('does not double-invert a series-less short', () => {
    // With no candles the leg falls back to `leg.pnlPct`, which the SERVER has
    // already signed. Signing it again here would flip a winner into a loser.
    const points = buildBasketPoints(
      [
        loaded({ weightBps: 5000, mint: 'a' }, [100, 110]),
        { leg: { label: 'B', mint: 'b', type: 'tokenized_stock', side: 'short', weightBps: 5000, pnlPct: 20 }, items: [] },
      ],
      '1H',
    );

    expect(points.at(-1)!.returnPct).toBeCloseTo(15, 6);
  });
});

describe('anchorLatestReturn', () => {
  it('rescales (preserving shape) once a short curve agrees with the headline', () => {
    // The repair the sign fix buys back. A signed short curve now shares the
    // headline's sign, so the MULTIPLICATIVE branch runs and the curve keeps its
    // own ups and downs on the way to the target.
    const points = buildBasketPoints([loaded({ weightBps: 10000, side: 'short' }, [100, 90, 80])], '1H');
    const anchored = anchorLatestReturn(points, 30);

    expect(anchored.at(-1)!.returnPct).toBeCloseTo(30, 6);
    // Scale is 1.5, so the midpoint's +10% becomes +15%. Under the additive
    // branch it would be +15% too — so assert the FIRST point instead, which
    // rescaling leaves at 0 and drifting would push off it.
    expect(anchored[0].returnPct).toBeCloseTo(0, 6);
    expect(anchored[1].returnPct).toBeCloseTo(15, 6);
  });

  it('does not mirror the curve when it disagrees with the headline', () => {
    // The additive branch. It has to be tested with a curve that DIPS: on a
    // straight line the two branches produce identical points, so only a turn
    // in the curve can tell "shape preserved" from "shape mirrored".
    //
    // Raw returns are [0, +20, +10, +20] — a peak, a dip, a recovery. Against a
    // target of -5 a multiplicative scale would be negative and would turn the
    // dip at index 2 into a local PEAK; the drift path must leave it a dip.
    const points = buildBasketPoints([loaded({ weightBps: 10000 }, [100, 120, 110, 120])], '1H');
    const anchored = anchorLatestReturn(points, -5);

    expect(anchored.at(-1)!.returnPct).toBeCloseTo(-5, 6);
    expect(anchored[2].returnPct).toBeLessThan(anchored[1].returnPct);
    expect(anchored[2].returnPct).toBeLessThan(anchored[3].returnPct);
  });
});

describe('clipCandlesAt', () => {
  it('clips a closed chart at its recorded exit timestamp', () => {
    const rows = candles([100, 101, 102]);
    const endSeconds = rows[1].timestamp / 1000;

    expect(clipCandlesAt(rows, endSeconds).map((row) => row.close)).toEqual([100, 101]);
  });

  it('leaves an active chart open-ended', () => {
    const rows = candles([100, 101, 102]);
    expect(clipCandlesAt(rows, null)).toEqual(rows);
  });
});

/**
 * A basket created while the equity market is shut has no candles at all — no
 * leg has printed since it existed — which is not a failure and must not be
 * drawn as one. `synthesizeFallbackPoints` is what the chart falls back to
 * there: the known since-creation return, ramped across the window.
 */
describe('synthesizeFallbackPoints', () => {
  const createdAt = Math.floor(Date.parse('2026-08-30T16:50:00Z') / 1000);
  const endedAt = Math.floor(Date.parse('2026-08-30T17:04:00Z') / 1000);

  it('draws a flat line at 0 for a weekend basket that has not moved', () => {
    const points = synthesizeFallbackPoints(createdAt, 0, '1H', endedAt);

    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.every((point) => point.returnPct === 0)).toBe(true);
    expect(points[0].timestamp).toBe(createdAt * 1000);
  });

  it('lands on the headline return when there is one', () => {
    const points = synthesizeFallbackPoints(createdAt, 4, '1H', endedAt);

    expect(points[0].returnPct).toBe(0);
    expect(points[points.length - 1].returnPct).toBeCloseTo(4, 6);
  });
});
