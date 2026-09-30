import { describe, expect, it } from 'vitest';

import { isHoldingToken, selectHoldings, sumHoldingsUsd } from './holdings';
import {
  SOLANA_NATIVE_SOL_MINT,
  SOLANA_USDC_MINT,
  SOLANA_WRAPPED_SOL_MINT,
} from './trading';

const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoBb';
const NVDAX = 'Xs1Nvda11111111111111111111111111111111111z';

const row = (
  mint: string | null,
  symbol: string | null,
  balance: number,
  usdValue: number | null,
) => ({ mint, symbol, balance, usdValue });

const held = { solTraded: true };
const neverTradedSol = { solTraded: false };

describe('isHoldingToken', () => {
  it('accepts a priced position', () => {
    expect(isHoldingToken(row(TSLAX, 'TSLAX', 2, 400), neverTradedSol)).toBe(true);
  });

  it('rejects cash', () => {
    expect(isHoldingToken(row(SOLANA_USDC_MINT, 'USDC', 250, 250), held)).toBe(false);
    expect(isHoldingToken(row(null, 'usdc', 250, 250), held)).toBe(false);
  });

  it('rejects emptied and dust rows', () => {
    expect(isHoldingToken(row(TSLAX, 'TSLAX', 0, 0), held)).toBe(false);
    expect(isHoldingToken(row(TSLAX, 'TSLAX', 0.000001, 0.004), held)).toBe(false);
  });

  it('rejects unpriced rows', () => {
    expect(isHoldingToken(row(TSLAX, 'TSLAX', 2, null), held)).toBe(false);
  });

  it('rejects SOL left behind as swap rent, in either mint spelling', () => {
    // ~0.002 SOL of routing rent accrues per swap; the user never bought it.
    expect(isHoldingToken(row(SOLANA_WRAPPED_SOL_MINT, 'SOL', 0.002, 0.4), neverTradedSol)).toBe(
      false,
    );
    expect(isHoldingToken(row(SOLANA_NATIVE_SOL_MINT, 'SOL', 0.002, 0.4), neverTradedSol)).toBe(
      false,
    );
  });

  it('keeps SOL once the server says it was actually traded', () => {
    expect(isHoldingToken(row(SOLANA_WRAPPED_SOL_MINT, 'SOL', 0.002, 0.4), held)).toBe(true);
  });
});

describe('selectHoldings', () => {
  it('returns only positions, largest first', () => {
    const tokens = [
      row(TSLAX, 'TSLAX', 2, 400),
      row(SOLANA_USDC_MINT, 'USDC', 250, 250),
      row(SOLANA_WRAPPED_SOL_MINT, 'SOL', 0.004, 0.8),
      row(NVDAX, 'NVDAX', 5, 900),
      row('emptied1111111111111111111111111111111111111', 'AMDX', 0, 0),
    ];
    expect(selectHoldings(tokens, neverTradedSol).map((t) => t.symbol)).toEqual([
      'NVDAX',
      'TSLAX',
    ]);
  });

  it('is empty for a wallet holding only cash and swap rent', () => {
    const tokens = [
      row(SOLANA_USDC_MINT, 'USDC', 41.2, 41.2),
      row(SOLANA_WRAPPED_SOL_MINT, 'SOL', 0.00203928, 0.42),
    ];
    expect(selectHoldings(tokens, neverTradedSol)).toEqual([]);
  });
});

describe('sumHoldingsUsd', () => {
  it('counts exactly what selectHoldings lists', () => {
    const tokens = [
      row(TSLAX, 'TSLAX', 2, 400),
      row(SOLANA_USDC_MINT, 'USDC', 250, 250),
      row(SOLANA_WRAPPED_SOL_MINT, 'SOL', 0.004, 0.8),
      row(NVDAX, 'NVDAX', 5, 900),
    ];
    expect(sumHoldingsUsd(tokens, neverTradedSol)).toBe(1300);
    expect(sumHoldingsUsd(tokens, held)).toBeCloseTo(1300.8, 6);
  });

  it('honours the caller-supplied exclusion', () => {
    const tokens = [row(TSLAX, 'TSLAX', 2, 400), row(NVDAX, 'NVDAX', 5, 900)];
    expect(
      sumHoldingsUsd(tokens, { solTraded: false, exclude: (t) => t.mint === NVDAX }),
    ).toBe(400);
  });
});
