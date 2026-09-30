import { describe, expect, it } from 'vitest';

import { optimisticOpenSandwichPositionDetail } from './open-sandwich-position';
import type { SandwichPosition } from './sandwich-positions';

const position: SandwichPosition = {
  id: 'held-1',
  sandwichId: 'sandwich-1',
  name: 'AI Basket',
  summary: 'AI demand keeps climbing',
  investedUsd: 25,
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-08-30T10:00:00.000Z',
  pendingSync: true,
  strictAtomic: true,
  legs: [{
    legId: 'nvda',
    kind: 'swap',
    mint: 'mint-nvda',
    symbol: 'NVDAx',
    label: 'NVIDIA',
    imageUrl: 'https://example.com/nvda.png',
    weightBps: 10_000,
    inputAmount: '25000000',
    investedUsd: 25,
  }],
};

describe('optimisticOpenSandwichPositionDetail', () => {
  it('makes a locally synced holding immediately renderable and shareable', () => {
    const detail = optimisticOpenSandwichPositionDetail({ position });

    expect(detail).toMatchObject({
      id: 'held-1',
      sandwichId: 'sandwich-1',
      title: 'AI demand keeps climbing',
      state: 'open',
      costUsd: 25,
      symbols: ['NVDAx'],
    });
    expect(detail.fills).toHaveLength(1);
    expect(detail.chart.legs).toEqual([
      expect.objectContaining({ id: 'nvda', mint: 'mint-nvda', weightBps: 10_000 }),
    ]);
  });
});
