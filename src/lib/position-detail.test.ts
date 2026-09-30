import { describe, expect, it } from 'vitest';

import { normalizePositionDetail } from '@/lib/api';

function detail(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'token',
    id: 'position-1',
    title: 'AAPL',
    subtitle: null,
    logoUri: null,
    symbols: ['AAPL'],
    mint: 'mint-1',
    sandwichId: null,
    openedAt: '2026-01-01T00:00:00.000Z',
    closedAt: '2026-01-03T00:00:00.000Z',
    costUsd: null,
    proceedsUsd: null,
    realizedPnlUsd: null,
    realizedPnlPct: null,
    reason: 'user_close',
    leverage: null,
    sandwich: null,
    state: 'closed',
    avgEntryPriceUsd: null,
    avgExitPriceUsd: null,
    fills: [],
    chart: {
      openedAt: '2026-01-01T00:00:00.000Z',
      closedAt: '2026-01-03T00:00:00.000Z',
      legs: [{
        id: 'leg-1',
        type: 'tokenized_stock',
        mint: 'mint-1',
        marketId: null,
        symbol: 'AAPL',
        label: 'Apple',
        side: 'long',
        weightBps: 10_000,
      }],
    },
    ...overrides,
  };
}

describe('normalizePositionDetail', () => {
  it('keeps unknown basis, proceeds and prices unknown instead of zeroing them', () => {
    const normalized = normalizePositionDetail(detail());

    expect(normalized).toMatchObject({
      costUsd: null,
      proceedsUsd: null,
      realizedPnlUsd: null,
      avgEntryPriceUsd: null,
      avgExitPriceUsd: null,
    });
  });

  it('orders valid fills and discards malformed fills', () => {
    const normalized = normalizePositionDetail(detail({
      fills: [
        { id: 'exit', side: 'exit', occurredAt: '2026-01-03T00:00:00.000Z', amountUsd: 120, quantity: 2, priceUsd: 60 },
        { id: 'bad', side: 'other', occurredAt: '2026-01-02T00:00:00.000Z' },
        { id: 'entry', side: 'entry', occurredAt: '2026-01-01T00:00:00.000Z', amountUsd: 100, quantity: 2, priceUsd: 50 },
      ],
    }));

    expect(normalized?.fills.map((fill) => fill.id)).toEqual(['entry', 'exit']);
  });

  it('retains perp venue and short direction for charting', () => {
    const normalized = normalizePositionDetail(detail({
      kind: 'phoenix_perp',
      chart: {
        openedAt: '2026-01-01T00:00:00.000Z',
        closedAt: '2026-01-03T00:00:00.000Z',
        legs: [{
          id: 'perp-1', type: 'perp', mint: null, marketId: null,
          symbol: 'NVDA', label: 'Nvidia', side: 'short', weightBps: 10_000,
        }],
      },
    }));

    expect(normalized?.chart.legs[0]).toMatchObject({ type: 'perp', side: 'short' });
  });

  it('canonicalizes mint-backed tokenized_asset legs from the backend', () => {
    const normalized = normalizePositionDetail(detail({
      chart: {
        openedAt: '2026-01-01T00:00:00.000Z',
        closedAt: null,
        legs: [{
          id: 'asset-1', type: 'tokenized_asset', mint: 'mint-1', marketId: null,
          symbol: 'GOOGL', label: 'Alphabet', side: 'short', weightBps: 10_000,
        }],
      },
    }));

    expect(normalized?.chart.legs[0]).toMatchObject({ type: 'tokenized_stock', mint: 'mint-1' });
  });
});
