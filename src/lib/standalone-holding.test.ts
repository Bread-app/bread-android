import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

import type { CostBasisEntry } from './cost-basis';
import { sandwichLegReserve, standaloneHolding } from './standalone-holding';
import type { SandwichPosition } from './sandwich-positions';

const ZEC = 'ZEcMint111111111111111111111111111111111111';

function entry(overrides: Partial<CostBasisEntry>): CostBasisEntry {
  return {
    mint: ZEC,
    qty: 0,
    avgPriceUsd: 0,
    realizedPnlUsd: 0,
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('standaloneHolding', () => {
  it('shows nothing for ZEC bought only inside a Sandwich', () => {
    const held = standaloneHolding({
      walletBalance: 2,
      entry: entry({ qty: 2, avgPriceUsd: 50, standaloneQty: 0, standaloneAvgPriceUsd: 0 }),
      mint: ZEC,
    });
    expect(held).toEqual({ qty: 0, avgPriceUsd: null });
  });

  it('shows only the direct units, at their own average, when both exist', () => {
    const held = standaloneHolding({
      walletBalance: 3,
      entry: entry({ qty: 3, avgPriceUsd: 60, standaloneQty: 1, standaloneAvgPriceUsd: 80 }),
      mint: ZEC,
    });
    expect(held).toEqual({ qty: 1, avgPriceUsd: 80 });
  });

  it('never claims more than the wallet holds', () => {
    const held = standaloneHolding({
      walletBalance: 0.4,
      entry: entry({ qty: 1, avgPriceUsd: 80, standaloneQty: 1, standaloneAvgPriceUsd: 80 }),
      mint: ZEC,
    });
    expect(held.qty).toBeCloseTo(0.4);
  });

  it('subtracts a stored Sandwich leg when the ledger has no split', () => {
    const held = standaloneHolding({
      walletBalance: 3,
      entry: undefined,
      reserve: new Map([[ZEC, 2]]),
      mint: ZEC,
    });
    expect(held).toEqual({ qty: 1, avgPriceUsd: null });
  });

  it('treats a leg of unrecorded size as owning the balance', () => {
    expect(
      standaloneHolding({ walletBalance: 3, entry: undefined, reserve: new Map([[ZEC, null]]), mint: ZEC })
        .qty,
    ).toBe(0);
  });

  it('keeps a transfer-in with no ledger and no Sandwich as a holding of unknown cost', () => {
    expect(standaloneHolding({ walletBalance: 5, entry: undefined, reserve: new Map(), mint: ZEC })).toEqual({
      qty: 5,
      avgPriceUsd: null,
    });
  });

  it('keeps a small direct buy beside a much larger leg', () => {
    const held = standaloneHolding({
      walletBalance: 1000.05,
      entry: entry({ qty: 1000.05, avgPriceUsd: 10, standaloneQty: 0.05, standaloneAvgPriceUsd: 100 }),
      mint: ZEC,
    });
    expect(held.qty).toBeCloseTo(0.05);
  });
});

describe('sandwichLegReserve', () => {
  it('sums recorded leg quantities and poisons on an unknown one', () => {
    const leg = (outputAmount: string | null) => ({
      legId: 'l',
      mint: ZEC,
      symbol: 'ZEC',
      label: 'ZEC',
      imageUrl: null,
      weightBps: 5000,
      inputAmount: null,
      investedUsd: null,
      outputAmount,
      decimals: 8,
    });
    const position = (legs: ReturnType<typeof leg>[]) =>
      ({ legs }) as unknown as SandwichPosition;

    expect(sandwichLegReserve([position([leg('100000000')]), position([leg('50000000')])]).get(ZEC)).toBeCloseTo(1.5);
    expect(sandwichLegReserve([position([leg('100000000')]), position([leg(null)])]).get(ZEC)).toBeNull();
  });
});
