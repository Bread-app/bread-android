import { describe, expect, it } from 'vitest';

import type { SandwichBuyLeg, SandwichLeg } from '@/lib/api';
import { basketQuotedValueUsd } from '@/lib/basket-quote-value';

/**
 * "Est. value" on the Sandwich buy pad.
 *
 * The bug these pin: a $6 buy across three legs printed "≈ $7.70" — more than
 * the user was about to spend — because the quoted wrapper-token quantity was
 * valued at the listed SHARE price. See basket-quote-value.ts.
 */

function leg(overrides: Partial<SandwichLeg> & { id: string }): SandwichLeg {
  return {
    order: 0,
    type: 'tokenized_stock',
    venue: 'spot',
    label: 'Test',
    imageUrl: null,
    symbol: 'TSTx',
    underlyingSymbol: 'TST',
    mint: 'mint-' + overrides.id,
    marketId: null,
    eventId: null,
    question: null,
    side: 'long',
    weightBps: 10_000,
    priceUsd: 100,
    currentPriceUsd: 100,
    onchainPriceUsd: 100,
    pnlPct: 0,
    volume24hUsd: null,
    holderCount: null,
    closeTime: null,
    reason: '',
    matchSummary: null,
    legRole: null,
    legMechanism: null,
    startMs: null,
    endMs: null,
    execution: null,
    ...overrides,
  } as SandwichLeg;
}

function swap(legId: string, usd: number): SandwichBuyLeg {
  return {
    kind: 'swap',
    legId,
    label: 'Test',
    symbol: 'TSTx',
    mint: 'mint-' + legId,
    weightBps: 10_000,
    inputAmount: String(Math.round(usd * 1_000_000)),
  };
}

describe('basketQuotedValueUsd', () => {
  it('values quoted tokens at the on-chain price, not the listed share', () => {
    // The wrapper trades at $100 while the listed share prints $128 — the shape
    // that produced "$6 in, ≈ $7.70 out". $2 of a $100 token, less a 7.92%
    // route cost, is ~0.0185 tokens.
    const legs = [leg({ id: 'a', currentPriceUsd: 128, onchainPriceUsd: 100 })];
    const value = basketQuotedValueUsd(legs, [swap('a', 2)], () => 0.0185);

    expect(value).not.toBeNull();
    expect(value!).toBeCloseTo(1.85, 2);
    expect(value!).toBeLessThan(2);
  });

  it('never reports a buy as worth more than it cost', () => {
    // A stale or mismatched on-chain price cannot print as instant profit.
    const legs = [leg({ id: 'a', onchainPriceUsd: 130 })];
    expect(basketQuotedValueUsd(legs, [swap('a', 2)], () => 0.02)).toBe(2);
  });

  it('counts a leg at its slice when the server sent no on-chain price', () => {
    const legs = [
      leg({ id: 'a', onchainPriceUsd: null, currentPriceUsd: 128 }),
      leg({ id: 'b', onchainPriceUsd: 100 }),
    ];
    const quoted = (id: string) => (id === 'b' ? 0.0185 : null);
    const value = basketQuotedValueUsd(legs, [swap('a', 2), swap('b', 2)], quoted);

    // 2.00 (unpriced slice) + 1.85 (quoted) — the share price is never used.
    expect(value!).toBeCloseTo(3.85, 2);
  });

  it('hides the line when no leg has real quoted terms', () => {
    const legs = [leg({ id: 'a' })];
    expect(basketQuotedValueUsd(legs, [swap('a', 2)], () => null)).toBeNull();
  });

  it("counts a prediction leg's slice as its cost", () => {
    const legs = [leg({ id: 'p', type: 'prediction_market', mint: null }), leg({ id: 'a' })];
    const planned: SandwichBuyLeg[] = [
      { kind: 'prediction', legId: 'p', label: 'P', symbol: null, marketId: 'm', isYes: true, weightBps: 5_000, inputAmount: '5000000' },
      swap('a', 2),
    ];
    const value = basketQuotedValueUsd(legs, planned, (id) => (id === 'a' ? 0.0185 : null));
    expect(value!).toBeCloseTo(6.85, 2);
  });
});
