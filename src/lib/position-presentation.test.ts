import { describe, expect, it } from 'vitest';

import type { PositionDetail } from '@/lib/api';
import { positionShareStats } from '@/lib/position-presentation';

function position(overrides: Partial<PositionDetail> = {}): PositionDetail {
  return {
    kind: 'token', id: 'one', title: 'AAPL', subtitle: null, logoUri: null,
    symbols: ['AAPL'], mint: 'mint', sandwichId: null,
    openedAt: '2026-01-01T00:00:00.000Z', closedAt: null,
    costUsd: 100, proceedsUsd: null, realizedPnlUsd: null,
    realizedPnlPct: null, reason: null, leverage: null, sandwich: null,
    state: 'open', avgEntryPriceUsd: 10, avgExitPriceUsd: null,
    fills: [{ id: 'entry', side: 'entry', occurredAt: '2026-01-01T00:00:00.000Z', amountUsd: 100, quantity: 10, priceUsd: 10 }],
    chart: { openedAt: '2026-01-01T00:00:00.000Z', closedAt: null, legs: [{ id: 'leg', type: 'tokenized_stock', mint: 'mint', marketId: null, symbol: 'AAPL', label: 'Apple', side: 'long', weightBps: 10_000 }] },
    ...overrides,
  };
}

describe('positionShareStats', () => {
  it('uses weighted prices for an active single-asset position', () => {
    expect(positionShareStats(position(), 125)).toEqual([
      { label: 'Invested', value: '$100.00' },
      { label: 'Avg. entry', value: '$10.00' },
      { label: 'Current', value: '$12.50' },
    ]);
  });

  it('uses totals and holding period for a closed multi-asset sandwich', () => {
    const closed = position({
      kind: 'sandwich_spot', state: 'closed', closedAt: '2026-01-04T00:00:00.000Z',
      proceedsUsd: 140,
      chart: { openedAt: '2026-01-01T00:00:00.000Z', closedAt: '2026-01-04T00:00:00.000Z', legs: [
        { id: 'a', type: 'tokenized_stock', mint: 'a', marketId: null, symbol: 'A', label: 'A', side: 'long', weightBps: 5000 },
        { id: 'b', type: 'tokenized_stock', mint: 'b', marketId: null, symbol: 'B', label: 'B', side: 'long', weightBps: 5000 },
      ] },
    });

    expect(positionShareStats(closed, null)).toEqual([
      { label: 'Invested', value: '$100.00' },
      { label: 'Returned', value: '$140.00' },
      { label: 'Held', value: '3 days' },
    ]);
  });

  it('renders unknown basis and prices as em dashes', () => {
    const unknown = position({ costUsd: null, avgEntryPriceUsd: null });
    expect(positionShareStats(unknown, null).map((stat) => stat.value)).toEqual(['—', '—', '—']);
  });
});
