import { describe, expect, it } from 'vitest';

import type { ClosedPosition, PublicSandwichHolding } from './api';
import { publicClosedPositionDetail, viewedPositionFromHolding } from './public-position-detail';

const holding: PublicSandwichHolding = {
  id: 'pos1',
  sandwichId: 'sw1',
  venue: 'spot',
  title: 'Solana narratives',
  subtitle: null,
  logoUri: null,
  symbols: ['SOL', 'NVDA'],
  legMints: ['mintA', 'mintB'],
  openedAt: '2026-09-23T09:01:49.000Z',
  costUsd: 5,
  valueUsd: 4.97,
  unrealizedPnlUsd: -0.03,
  unrealizedPnlPct: -0.006,
  leverage: null,
  sandwich: null,
};


describe('viewedPositionFromHolding', () => {
  it("carries the holder's own figures, with the return in percent", () => {
    const viewed = viewedPositionFromHolding(holding);
    expect(viewed.position.sandwichId).toBe('sw1');
    expect(viewed.valuation).toEqual({ costUsd: 5, valueUsd: 4.97, pnlUsd: -0.03, returnPct: -0.6 });
  });
});

describe('publicClosedPositionDetail', () => {
  it('shows both the entry and the exit', () => {
    const closed = {
      kind: 'sandwich_spot',
      id: 'c1',
      title: 't',
      subtitle: null,
      logoUri: null,
      symbols: [],
      mint: null,
      sandwichId: 'sw1',
      openedAt: '2026-09-01T00:00:00.000Z',
      closedAt: '2026-09-05T00:00:00.000Z',
      costUsd: 10,
      proceedsUsd: 12,
      realizedPnlUsd: 2,
      realizedPnlPct: 0.2,
      reason: null,
      leverage: null,
      sandwich: null,
    } satisfies ClosedPosition;
    const detail = publicClosedPositionDetail(closed);
    expect(detail.state).toBe('closed');
    expect(detail.fills.map((f) => [f.side, f.amountUsd])).toEqual([
      ['entry', 10],
      ['exit', 12],
    ]);
  });
});
