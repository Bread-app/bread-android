import { describe, expect, it } from 'vitest';

import { sandwichLegValueUsd, valueSandwichPosition } from './sandwich-holding-value';

/**
 * The rule under test is the one that let a sold sandwich stay in Holdings
 * forever: a leg with no tokens fell back to its cost basis, so an exited
 * position rendered at its purchase price and was re-synced to the backend on
 * every profile load.
 *
 * The fix is not "never fall back" — the fallback protects a real position from
 * a price feed blinking out. It is that the fallback applies to an UNKNOWN
 * balance and never to one known to be zero.
 */
const leg = { investedUsd: 25, inputAmount: '25000000' };

describe('sandwichLegValueUsd', () => {
  it('uses the live value whenever there is one', () => {
    expect(sandwichLegValueUsd(leg, { balance: 3, usdValue: 31.5 }, true)).toBe(31.5);
  });

  it('values a sold-out leg at zero once balances are known', () => {
    // The regression. Both shapes a sold leg can take: gone from the wallet
    // feed entirely, and present with an emptied token account.
    expect(sandwichLegValueUsd(leg, null, true)).toBe(0);
    expect(sandwichLegValueUsd(leg, { balance: 0, usdValue: 0 }, true)).toBe(0);
  });

  it('falls back to cost basis while balances are unknown', () => {
    // A failed or in-flight balance read must not blank a real position.
    expect(sandwichLegValueUsd(leg, null, false)).toBe(25);
    expect(sandwichLegValueUsd(leg, { balance: 0, usdValue: 0 }, false)).toBe(25);
  });

  it('recovers cost basis from the raw input amount on older rows', () => {
    expect(sandwichLegValueUsd({ investedUsd: null, inputAmount: '12500000' }, null, false)).toBe(12.5);
  });

  it('keeps a held leg visible when only its price is missing', () => {
    // Balances loaded, tokens genuinely held, but the feed has no USD for them.
    // This is the case the fallback exists for, and `balancesKnown` must not
    // swallow it — the balance is not zero.
    expect(sandwichLegValueUsd(leg, { balance: 3, usdValue: null }, true)).toBe(25);
  });

  it('reports zero when there is neither a balance nor a recoverable basis', () => {
    expect(sandwichLegValueUsd({ investedUsd: null, inputAmount: null }, null, false)).toBe(0);
  });
});

describe('valueSandwichPosition', () => {
  it('anchors P&L to the buyer\'s own entry quantity', () => {
    const valuation = valueSandwichPosition(
      [{ investedUsd: 2, inputAmount: '2000000', outputAmount: '20000000', decimals: 8 }],
      new Map([['stock', { balance: 2, usdValue: 20 }]]),
      true,
      ['stock'],
    );

    expect(valuation.valueUsd).toBeCloseTo(2);
    expect(valuation.pnlUsd).toBeCloseTo(0);
    expect(valuation.returnPct).toBeCloseTo(0);
  });

  it('caps a position at its own units when the wallet holds more of the mint', () => {
    const valuation = valueSandwichPosition(
      [{ investedUsd: 2, inputAmount: '2000000', outputAmount: '100000000', decimals: 8 }],
      new Map([['stock', { balance: 5, usdValue: 60 }]]),
      true,
      ['stock'],
    );

    expect(valuation.valueUsd).toBeCloseTo(12);
    expect(valuation.returnPct).toBeCloseTo(500);
  });
});

describe('valueSandwichPosition — leg synced without decimals', () => {
  // Real case: a $5 buy with a $3 SOL leg showed $5.39, because the backend
  // merge stripped decimals and the leg valued the wallet's WHOLE SOL balance,
  // including the rent SOL every swap leaves behind.
  it('caps a leg at the units bought, using the wallet row decimals', () => {
    const solMint = 'So11111111111111111111111111111111111111112';
    const price = 117.5;
    const walletSol = 0.028969;
    const result = valueSandwichPosition(
      [{ investedUsd: 3, inputAmount: '3000000', outputAmount: '25443773', decimals: null }],
      new Map([[solMint, { balance: walletSol, usdValue: walletSol * price, decimals: 9 }]]),
      true,
      [solMint],
    );
    expect(result.valueUsd).toBeCloseTo(0.025443773 * price, 6);
    expect(result.valueUsd).toBeLessThan(walletSol * price);
  });
});
