import { describe, expect, it } from 'vitest';

import type { Sandwich, SandwichLeg } from '@/lib/api';
import { recommendSandwiches } from '@/lib/sandwich-recommendations';

function leg(partial: Partial<SandwichLeg>): SandwichLeg {
  return {
    type: 'tokenized_stock',
    venue: 'spot',
    mint: null,
    marketId: null,
    eventId: null,
    symbol: null,
    underlyingSymbol: null,
    ...partial,
  } as SandwichLeg;
}

function sandwich(id: string, legs: SandwichLeg[], likeCount = 0, sourceId = id): Sandwich {
  return { id, legs, likeCount, sourceId } as unknown as Sandwich;
}

describe('recommendSandwiches', () => {
  const current = sandwich('current', [
    leg({ mint: 'TSLA_MINT', symbol: 'TSLAx' }),
    leg({ mint: 'NVDA_MINT', symbol: 'NVDAx' }),
  ]);

  it('ranks by shared assets before likes, and never returns the current one', () => {
    const pool = [
      current,
      sandwich('popular', [leg({ mint: 'AAPL_MINT' })], 500),
      sandwich('one', [leg({ mint: 'TSLA_MINT' })], 1),
      sandwich('two', [leg({ mint: 'TSLA_MINT' }), leg({ mint: 'NVDA_MINT' })], 0),
    ];
    expect(recommendSandwiches(current, pool).map((s) => s.id)).toEqual([
      'two',
      'one',
      'popular',
    ]);
  });

  it('matches a perp leg to the spot wrapper by ticker', () => {
    const perp = sandwich('perp', [leg({ venue: 'perp', symbol: 'TSLA' })]);
    const other = sandwich('other', [leg({ mint: 'AAPL_MINT' })], 10);
    expect(recommendSandwiches(current, [other, perp])[0].id).toBe('perp');
  });

  it('skips sibling calls from the same source', () => {
    const sibling = sandwich('sibling', [leg({ mint: 'TSLA_MINT' })], 0, 'current');
    expect(recommendSandwiches(current, [sibling])).toEqual([]);
  });
});
