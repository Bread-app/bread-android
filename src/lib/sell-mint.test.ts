import { describe, expect, it } from 'vitest';

import { collectSellCandidateMints, normalizeTicker } from './sell-mint';

const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoBb';
const TSLAON = 'TSLAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxondo';
const NVDAX = 'Xs1Nvda11111111111111111111111111111111111z';

const token = (mint: string | null, symbol: string | null, balance: number) => ({
  mint,
  symbol,
  balance,
});

describe('normalizeTicker', () => {
  it('strips wrapper suffixes and casing', () => {
    expect(normalizeTicker('TSLAX')).toBe('TSLA');
    expect(normalizeTicker('tslaon')).toBe('TSLA');
    expect(normalizeTicker(' TSLA ')).toBe('TSLA');
    expect(normalizeTicker(null)).toBe('');
  });
});

describe('collectSellCandidateMints', () => {
  it('puts the screen mint first', () => {
    expect(
      collectSellCandidateMints(TSLAX, 'TSLA', [token(TSLAX, 'TSLAX', 4)]),
    ).toEqual([TSLAX]);
  });

  it('adds a held variant of the same ticker under a different mint', () => {
    // The bug this exists for: screen shows the Ondo mint, wallet holds the
    // xStock one. Without the fallback the sell reads a 0 balance and refuses.
    expect(
      collectSellCandidateMints(TSLAON, 'TSLA', [token(TSLAX, 'TSLAX', 4)]),
    ).toEqual([TSLAON, TSLAX]);
  });

  it('orders held variants by balance, largest first', () => {
    expect(
      collectSellCandidateMints(null, 'TSLA', [
        token(TSLAON, 'TSLAON', 1),
        token(TSLAX, 'TSLAX', 9),
      ]),
    ).toEqual([TSLAX, TSLAON]);
  });

  it('ignores other tickers, zero balances and unusable mints', () => {
    expect(
      collectSellCandidateMints(null, 'TSLA', [
        token(NVDAX, 'NVDAX', 5),
        token(TSLAX, 'TSLAX', 0),
        token('short', 'TSLAX', 3),
        token(null, 'TSLAX', 3),
      ]),
    ).toEqual([]);
  });

  it('never repeats the screen mint', () => {
    expect(
      collectSellCandidateMints(TSLAX, 'TSLA', [token(TSLAX, 'TSLAX', 4)]),
    ).toEqual([TSLAX]);
  });

  it('caps the fan-out', () => {
    const mints = [TSLAX, TSLAON, NVDAX, 'Xs4Tsla1111111111111111111111111111111111z'];
    const tokens = mints.map((mint, i) => token(mint, 'TSLAX', 10 - i));
    expect(collectSellCandidateMints(null, 'TSLA', tokens, 2)).toHaveLength(2);
  });
});
