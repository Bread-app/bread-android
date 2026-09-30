import { describe, expect, it } from 'vitest';

import {
  MAX_SELL_SIZING_PASSES,
  nextSellSizingPrice,
  sellBalanceUsd,
  sellSizingPriceFor,
  type SellSizingPrice,
} from './sell-sizing';

/**
 * Live numbers from Micron's Ondo wrapper on 2026-09-03: the card said $949.52
 * and the venue paid $872.78 for a $5 clip, so "sell $5" sized off the card
 * returned $4.60. One refinement pass took it to $5.00, and the effective price
 * moved only to $872.84 on the re-sized quote.
 */
const MINT = 'Fz9edBpaURPPzpKVRR1A8PENYDEgHqwx5D5th28ondo';
const CARD = 949.52;
const QUOTED = 872.78;

describe('sell sizing ruler', () => {
  it('adopts the venue price when the card is far from what the pool pays', () => {
    const next = nextSellSizingPrice({
      current: null,
      mint: MINT,
      key: `${MINT}:5`,
      quotedPrice: QUOTED,
      cardPrice: CARD,
    });

    expect(next?.price).toBe(QUOTED);
    expect(next?.passes).toBe(1);
  });

  it('ignores the re-sized quote that agrees with the ruler it produced', () => {
    // This is what stops the loop: pass two quotes $872.84 against a ruler of
    // $872.78, which is the same price and not worth another request.
    const current: SellSizingPrice = { mint: MINT, price: QUOTED, key: `${MINT}:5`, passes: 1 };
    const next = nextSellSizingPrice({
      current,
      mint: MINT,
      key: `${MINT}:5`,
      quotedPrice: 872.84,
      cardPrice: CARD,
    });

    expect(next).toBe(current);
  });

  it('stops refining one typed amount after the pass cap', () => {
    const current: SellSizingPrice = {
      mint: MINT,
      price: QUOTED,
      key: `${MINT}:5`,
      passes: MAX_SELL_SIZING_PASSES,
    };
    // A pool whose effective price keeps moving would otherwise re-quote forever.
    const next = nextSellSizingPrice({
      current,
      mint: MINT,
      key: `${MINT}:5`,
      quotedPrice: 800,
      cardPrice: CARD,
    });

    expect(next).toBe(current);
  });

  it('gives a newly typed amount a fresh budget', () => {
    const current: SellSizingPrice = {
      mint: MINT,
      price: QUOTED,
      key: `${MINT}:5`,
      passes: MAX_SELL_SIZING_PASSES,
    };
    const next = nextSellSizingPrice({
      current,
      mint: MINT,
      key: `${MINT}:250`,
      quotedPrice: 800,
      cardPrice: CARD,
    });

    expect(next?.price).toBe(800);
    expect(next?.passes).toBe(1);
  });

  it('never sizes one asset off another asset\'s ruler', () => {
    const current: SellSizingPrice = { mint: MINT, price: QUOTED, key: `${MINT}:5`, passes: 1 };

    expect(sellSizingPriceFor(current, 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', 360.85)).toBe(
      360.85,
    );
    expect(sellSizingPriceFor(current, MINT, CARD)).toBe(QUOTED);
    expect(sellSizingPriceFor(null, MINT, CARD)).toBe(CARD);
  });

  it('refuses a nonsense quote', () => {
    expect(
      nextSellSizingPrice({ current: null, mint: MINT, key: 'k', quotedPrice: 0, cardPrice: CARD }),
    ).toBeNull();
    expect(
      nextSellSizingPrice({
        current: null,
        mint: MINT,
        key: 'k',
        quotedPrice: Number.NaN,
        cardPrice: CARD,
      }),
    ).toBeNull();
  });
});

describe('sell balance', () => {
  it('prefers what the venue will actually pay for the position', () => {
    // 0.05 of Micron's Ondo wrapper marks at $47.48 and realizes $43.70.
    expect(sellBalanceUsd({ realizableUsd: 43.7, positionTokens: 0.05, marks: [CARD] })).toBe(43.7);
  });

  it('marks the position while the quote is still in flight', () => {
    expect(
      sellBalanceUsd({ realizableUsd: null, positionTokens: 0.05, marks: [QUOTED, CARD] }),
    ).toBe(0.05 * QUOTED);
  });

  it('falls through to the card price when no ruler has been learned', () => {
    expect(
      sellBalanceUsd({ realizableUsd: null, positionTokens: 0.05, marks: [null, CARD] }),
    ).toBeCloseTo(0.05 * CARD, 10);
  });

  it('reports a position that quotes at zero as zero, not as its mark', () => {
    // A pool that will pay nothing is the answer, not a gap in the data —
    // marking it instead would put an unfillable number on the pad.
    expect(sellBalanceUsd({ realizableUsd: 0, positionTokens: 0.0000001, marks: [CARD] })).toBe(0);
  });

  it('returns null when nothing can price the position', () => {
    expect(
      sellBalanceUsd({ realizableUsd: null, positionTokens: 1, marks: [null, undefined] }),
    ).toBeNull();
  });
});
