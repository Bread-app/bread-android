import { describe, expect, it } from 'vitest';

import { maxBuyAmount } from '@/lib/max-buy';

describe('maxBuyAmount', () => {
  it('always lands strictly under the balance', () => {
    for (const balance of [0.05, 1, 5.7, 12.34, 99.99, 100, 1234.56, 50000]) {
      const max = maxBuyAmount(balance);
      expect(max).toBeLessThan(balance);
      expect(max).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps 0.5% headroom, between one cent and one dollar', () => {
    expect(maxBuyAmount(100)).toBe(99.5);
    expect(maxBuyAmount(1)).toBe(0.99);
    expect(maxBuyAmount(10000)).toBe(9999);
  });

  it('floors whole dollars instead of rounding up', () => {
    expect(maxBuyAmount(5.7, 0)).toBe(5);
    expect(maxBuyAmount(6, 0)).toBe(5);
  });

  it('is zero for an empty or unknown balance', () => {
    expect(maxBuyAmount(0)).toBe(0);
    expect(maxBuyAmount(Number.NaN)).toBe(0);
  });
});
