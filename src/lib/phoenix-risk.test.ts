import { describe, expect, it } from 'vitest';

import { buildPerpSandwichMarginPlan, type Sandwich, type SandwichLeg } from '@/lib/api';
import {
  LIQUIDATION_SAFETY_SHARE,
  MIN_STOP_LOSS_PCT,
  PERP_ENTRY_MIN_FEE_BUFFER_USD,
  maxLeverageForSize,
  maxStopLossPct,
  maxStopLossPctFromLiquidation,
  triggerOutcome,
  perpEntryCashRequirement,
  projectedLiquidationPrice,
  selectableMaxLeverage,
} from '@/lib/phoenix-risk';

const MAINTENANCE_BPS = 5_000;

/**
 * These helpers exist only to agree with the backend. So the assertions here are
 * written against transcribed copies of the *server's* code rather than against
 * hand-computed numbers — a hand-computed expectation would drift silently the
 * day the server changes, which is the exact failure this file is guarding.
 */

/** Verbatim from stock-backend/lib/server/phoenix/trade.ts. */
function serverAllocateUsdByWeight(totalUsd: number, legs: { weightBps: number }[]): number[] {
  const totalWeight = legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  let remaining = totalUsd;
  return legs.map((leg, index) => {
    const amount =
      index === legs.length - 1
        ? remaining
        : Math.floor(((totalUsd * leg.weightBps) / totalWeight) * 1_000_000) / 1_000_000;
    remaining -= amount;
    return amount;
  });
}

/** Verbatim from stock-backend/lib/server/phoenix/trade.ts:stopPriceWithSafety. */
function serverAcceptsStop(stopLossPct: number, markPrice: number, liquidationPrice: number) {
  const stopDistance = stopLossPct / 100;
  const liquidationDistance = Math.abs(liquidationPrice - markPrice) / markPrice;
  return stopDistance <= liquidationDistance * (1 - LIQUIDATION_SAFETY_SHARE);
}

function leg(id: string, order: number, weightBps: number, over: Partial<SandwichLeg> = {}) {
  return {
    id,
    order,
    weightBps,
    type: 'tokenized_stock',
    venue: 'perp',
    label: id.toUpperCase(),
    symbol: `${id.toUpperCase()}x`,
    underlyingSymbol: id.toUpperCase(),
    side: 'short',
    mint: null,
    marketId: null,
    ...over,
  } as unknown as SandwichLeg;
}

function sandwich(legs: SandwichLeg[]): Sandwich {
  return { id: 's1', venue: 'perp', legs } as unknown as Sandwich;
}

describe('buildPerpSandwichMarginPlan', () => {
  const weights = [3333, 3333, 3334];

  for (const margin of [100, 0.01, 99_999.99, 1, 7.77]) {
    it(`splits $${margin} exactly as the server does`, () => {
      const plan = buildPerpSandwichMarginPlan(
        sandwich(weights.map((w, i) => leg(`l${i}`, i, w))),
        margin,
      );
      const expected = serverAllocateUsdByWeight(margin, weights.map((weightBps) => ({ weightBps })));

      expect(plan.map((slice) => slice.marginUsd)).toEqual(expected);
      // Not `toBeCloseTo`: the slices must sum to the margin bit-for-bit, which
      // is exactly what the last-leg-absorbs-the-remainder rule buys us.
      expect(plan.reduce((sum, slice) => sum + slice.marginUsd, 0)).toBe(margin);
    });
  }

  it('gives a single leg the whole margin', () => {
    const plan = buildPerpSandwichMarginPlan(sandwich([leg('solo', 0, 10_000)]), 250);
    expect(plan).toHaveLength(1);
    expect(plan[0].marginUsd).toBe(250);
  });

  it('sorts by order, so the remainder lands on the same leg the server picks', () => {
    // Same legs, declared out of order — the executor loads them `order: asc`.
    const shuffled = buildPerpSandwichMarginPlan(
      sandwich([leg('c', 2, 3334), leg('a', 0, 3333), leg('b', 1, 3333)]),
      100,
    );
    expect(shuffled.map((slice) => slice.legId)).toEqual(['a', 'b', 'c']);
    // The remainder sits on `c` (last by order), not on whatever was declared last.
    expect(shuffled[2].marginUsd).toBeGreaterThan(shuffled[0].marginUsd);
  });

  it('reads the perp symbol from the underlying, not the wrapper', () => {
    const plan = buildPerpSandwichMarginPlan(sandwich([leg('aapl', 0, 10_000)]), 50);
    expect(plan[0].symbol).toBe('AAPL');
  });

  it('returns nothing for a non-positive or unparseable margin', () => {
    const s = sandwich([leg('a', 0, 10_000)]);
    expect(buildPerpSandwichMarginPlan(s, 0)).toEqual([]);
    expect(buildPerpSandwichMarginPlan(s, -5)).toEqual([]);
    expect(buildPerpSandwichMarginPlan(s, Number.NaN)).toEqual([]);
  });

  it('returns nothing when every weight is zero', () => {
    expect(buildPerpSandwichMarginPlan(sandwich([leg('a', 0, 0)]), 100)).toEqual([]);
  });
});

describe('maxLeverageForSize', () => {
  const tiers = [
    { maxLeverage: 20, maxSizeBaseLots: 1_000 },
    { maxLeverage: 5, maxSizeBaseLots: 10_000 },
    { maxLeverage: 1, maxSizeBaseLots: 100_000 },
  ];

  it('picks the first tier the size fits in', () => {
    expect(maxLeverageForSize(tiers, 1)).toBe(20);
    expect(maxLeverageForSize(tiers, 1_000)).toBe(20);
    expect(maxLeverageForSize(tiers, 1_001)).toBe(5);
    expect(maxLeverageForSize(tiers, 10_000)).toBe(5);
    expect(maxLeverageForSize(tiers, 10_001)).toBe(1);
  });

  it('falls back to the last tier past the top of the ladder', () => {
    expect(maxLeverageForSize(tiers, 10_000_000)).toBe(1);
  });

  it('is 1x when a market reports no tiers at all', () => {
    expect(maxLeverageForSize([], 500)).toBe(1);
  });
});

describe('projectedLiquidationPrice', () => {
  it('uses the tier and maintenance factor, not the naive 1/L', () => {
    const price = projectedLiquidationPrice({
      side: 'long',
      markPrice: 100,
      leverage: 2,
      maxLeverage: 20,
      maintenanceMarginBps: MAINTENANCE_BPS,
    });
    expect(price).toBeCloseTo(51.2820512821, 10);
  });

  it('moves the other way for a short', () => {
    expect(
      projectedLiquidationPrice({
        side: 'short',
        markPrice: 100,
        leverage: 2,
        maxLeverage: 20,
        maintenanceMarginBps: MAINTENANCE_BPS,
      }),
    ).toBeCloseTo(146.3414634146, 10);
  });

  it('keeps a valid liquidation price at the advertised tier ceiling', () => {
    expect(
      projectedLiquidationPrice({
        side: 'long',
        markPrice: 100,
        leverage: 20,
        maxLeverage: 20,
        maintenanceMarginBps: MAINTENANCE_BPS,
      }),
    ).toBeCloseTo(97.4358974359, 10);
  });

  it('is null without a usable mark', () => {
    expect(
      projectedLiquidationPrice({
        side: 'long',
        markPrice: 0,
        leverage: 2,
        maxLeverage: 20,
        maintenanceMarginBps: MAINTENANCE_BPS,
      }),
    ).toBeNull();
  });
});

describe('maxStopLossPct', () => {
  it('collapses as leverage climbs toward the tier ceiling', () => {
    expect(maxStopLossPct(2, 20, MAINTENANCE_BPS, 'long')).toBeCloseTo(38.9743589744, 10);
    expect(maxStopLossPct(10, 20, MAINTENANCE_BPS, 'long')).toBeCloseTo(6.1538461538, 10);
    expect(maxStopLossPct(16, 20, MAINTENANCE_BPS, 'long')).toBeCloseTo(3.0769230769, 10);
    expect(maxStopLossPct(20, 20, MAINTENANCE_BPS, 'long')).toBeCloseTo(2.0512820513, 10);
  });

  it('is exactly the boundary the server enforces', () => {
    for (const leverage of [2, 5, 10, 16, 19]) {
      const markPrice = 100;
      const liquidationPrice = projectedLiquidationPrice({
        side: 'long',
        markPrice,
        leverage,
        maxLeverage: 20,
        maintenanceMarginBps: MAINTENANCE_BPS,
      })!;
      const ceiling = maxStopLossPct(leverage, 20, MAINTENANCE_BPS, 'long');
      expect(serverAcceptsStop(ceiling * 0.9999, markPrice, liquidationPrice)).toBe(true);
      expect(serverAcceptsStop(ceiling * 1.0001, markPrice, liquidationPrice)).toBe(false);
    }
  });
});

describe('selectableMaxLeverage', () => {
  it('offers Phoenix’s full advertised tier ceiling', () => {
    for (const max of [2, 3, 5, 10, 20, 25, 50]) {
      expect(selectableMaxLeverage(max, MAINTENANCE_BPS)).toBe(max);
    }
  });

  it('only offers leverage that still permits a legal stop', () => {
    for (const max of [2, 3, 5, 10, 20, 25, 50]) {
      const selectable = selectableMaxLeverage(max, MAINTENANCE_BPS);
      if (selectable > 1) {
        expect(
          maxStopLossPct(selectable, max, MAINTENANCE_BPS, 'short'),
        ).toBeGreaterThanOrEqual(MIN_STOP_LOSS_PCT);
      }
    }
  });

  it('always leaves a displayable liquidation price at the selectable maximum', () => {
    for (const maxLeverage of [2, 3, 5, 10, 20, 25, 50]) {
      const leverage = selectableMaxLeverage(maxLeverage, MAINTENANCE_BPS);
      expect(
        projectedLiquidationPrice({
          side: 'long',
          markPrice: 100,
          leverage,
          maxLeverage,
          maintenanceMarginBps: MAINTENANCE_BPS,
        }),
      ).not.toBeNull();
    }
  });

  it('degrades to 1x on a 1x market', () => {
    expect(selectableMaxLeverage(1, MAINTENANCE_BPS)).toBe(1);
    expect(selectableMaxLeverage(0, MAINTENANCE_BPS)).toBe(1);
  });
});

describe('perpEntryCashRequirement', () => {
  it('funds fees on top of the margin, so an exact-margin wallet is short', () => {
    // The failure this exists to stop: a $100.00 balance passed a gate that
    // compared the raw margin, then the server demanded $100.34.
    const { cashMovedUsd } = perpEntryCashRequirement({
      marginUsd: 100,
      estimatedTakerFeeUsd: 0.34,
      availableMarginUsd: 0,
    });
    expect(cashMovedUsd).toBeCloseTo(100.34, 6);
    expect(cashMovedUsd).toBeGreaterThan(100);
  });

  it('applies the $0.10 floor when fees round to nothing', () => {
    const { feeBufferUsd, cashMovedUsd } = perpEntryCashRequirement({
      marginUsd: 100,
      estimatedTakerFeeUsd: 0.001,
      availableMarginUsd: 0,
    });
    expect(feeBufferUsd).toBe(PERP_ENTRY_MIN_FEE_BUFFER_USD);
    expect(cashMovedUsd).toBeCloseTo(100.1, 6);
  });

  it('spends posted Phoenix collateral before wallet cash', () => {
    // Collateral stays in the parent after a close, so this is the ordinary
    // repeat-entry case, not an edge case.
    expect(
      perpEntryCashRequirement({
        marginUsd: 100,
        estimatedTakerFeeUsd: 0.34,
        availableMarginUsd: 40,
      }).cashMovedUsd,
    ).toBeCloseTo(60.34, 6);
  });

  it('debits nothing when posted collateral already covers the entry', () => {
    expect(
      perpEntryCashRequirement({
        marginUsd: 100,
        estimatedTakerFeeUsd: 0.34,
        availableMarginUsd: 250,
      }).cashMovedUsd,
    ).toBe(0);
  });

  it('treats unknown or negative collateral as zero rather than a discount', () => {
    for (const availableMarginUsd of [Number.NaN, -50]) {
      expect(
        perpEntryCashRequirement({
          marginUsd: 100,
          estimatedTakerFeeUsd: 0.34,
          availableMarginUsd,
        }).cashMovedUsd,
      ).toBeCloseTo(100.34, 6);
    }
  });

  it('matches the server deposit sizing across the range', () => {
    // Transcription check against `trade.ts`: depositNative =
    // max(0, marginUsd + max(0.1, fees) - availableMargin).
    for (const marginUsd of [1, 100, 1000, 100_000]) {
      for (const fees of [0, 0.05, 2.5, 300]) {
        for (const available of [0, 25, 5000]) {
          expect(
            perpEntryCashRequirement({
              marginUsd,
              estimatedTakerFeeUsd: fees,
              availableMarginUsd: available,
            }).cashMovedUsd,
          ).toBeCloseTo(Math.max(0, marginUsd + Math.max(0.1, fees) - available), 6);
        }
      }
    }
  });
});

describe('maxStopLossPctFromLiquidation', () => {
  it('leaves 20% of the mark-to-liquidation gap, either side', () => {
    // Long: liquidation 30% below the mark → 24% of stop is the ceiling.
    expect(maxStopLossPctFromLiquidation(100, 70)).toBeCloseTo(24, 10);
    // Short: the gap is above the mark, and the ceiling is the same size.
    expect(maxStopLossPctFromLiquidation(100, 130)).toBeCloseTo(24, 10);
  });

  it('agrees with the leverage-derived ceiling on a fresh position', () => {
    // Before an entry exists the two are the same rule read from different
    // inputs; if they ever disagree the pad clamps to a level the entry rejects.
    for (const leverage of [2, 3, 5, 10]) {
      const liquidationPrice = projectedLiquidationPrice({
        side: 'long',
        markPrice: 100,
        leverage,
        maxLeverage: 20,
        maintenanceMarginBps: MAINTENANCE_BPS,
      });
      expect(maxStopLossPctFromLiquidation(100, liquidationPrice)).toBeCloseTo(
        maxStopLossPct(leverage, 20, MAINTENANCE_BPS, 'long'),
        8,
      );
    }
  });

  it('returns null when either price is unusable', () => {
    // Null is "unknown", not "zero": a zero ceiling would disable the stop
    // control on a position whose liquidation price simply has not loaded.
    expect(maxStopLossPctFromLiquidation(null, 70)).toBeNull();
    expect(maxStopLossPctFromLiquidation(100, null)).toBeNull();
    expect(maxStopLossPctFromLiquidation(0, 70)).toBeNull();
  });

  it('is zero when the mark is already at liquidation', () => {
    expect(maxStopLossPctFromLiquidation(100, 100)).toBe(0);
  });
});

describe('triggerOutcome', () => {
  it('books the PnL against the entry, not against the live mark', () => {
    // The bug this replaced: `notional × move%` with notional quoted at the
    // mark. A long opened at $100, now marked $120, holding 2 units, with a
    // take profit at $150.
    //   correct:  2 × (150 − 100)          = $100
    //   old form: (2 × 120) × (150−100)/100 = $120  — 20% too generous
    const { pnlUsd } = triggerOutcome({
      side: 'long',
      quantity: 2,
      basisPrice: 100,
      triggerPrice: 150,
      marginUsd: 50,
    });
    expect(pnlUsd).toBeCloseTo(100, 10);
  });

  it('agrees with the notional form on a position that has not moved', () => {
    // Why the error was invisible on a fresh entry: at mark === entry the two
    // forms are identical.
    const notionalUsd = 200;
    const fill = 100;
    const { pnlUsd } = triggerOutcome({
      side: 'long',
      quantity: notionalUsd / fill,
      basisPrice: fill,
      triggerPrice: 103,
      marginUsd: 100,
    });
    expect(pnlUsd).toBeCloseTo(notionalUsd * 0.03, 10);
  });

  it('flips the sign for a short', () => {
    expect(
      triggerOutcome({
        side: 'short',
        quantity: 2,
        basisPrice: 100,
        triggerPrice: 80,
        marginUsd: 50,
      }).pnlUsd,
    ).toBeCloseTo(40, 10);
    expect(
      triggerOutcome({
        side: 'short',
        quantity: 2,
        basisPrice: 100,
        triggerPrice: 110,
        marginUsd: 50,
      }).pnlUsd,
    ).toBeCloseTo(-20, 10);
  });

  it('returns a percentage of collateral, so leverage is visible', () => {
    // $100 margin at 5x is $500 notional = 5 units at $100. A 2% price move is
    // 10% of the user's money, and 10% is the number they are deciding about.
    const { pnlUsd, returnPercent } = triggerOutcome({
      side: 'long',
      quantity: 5,
      basisPrice: 100,
      triggerPrice: 102,
      marginUsd: 100,
    });
    expect(pnlUsd).toBeCloseTo(10, 10);
    expect(returnPercent).toBeCloseTo(10, 10);
  });

  it('reports null rather than a wrong number when an input is missing', () => {
    expect(
      triggerOutcome({
        side: 'long',
        quantity: null,
        basisPrice: 100,
        triggerPrice: 110,
        marginUsd: 100,
      }),
    ).toEqual({ pnlUsd: null, returnPercent: null });
    // Unknown collateral drops the percentage but keeps the dollars.
    const { pnlUsd, returnPercent } = triggerOutcome({
      side: 'long',
      quantity: 1,
      basisPrice: 100,
      triggerPrice: 110,
      marginUsd: null,
    });
    expect(pnlUsd).toBeCloseTo(10, 10);
    expect(returnPercent).toBeNull();
  });
});
