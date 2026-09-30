import { describe, expect, it } from 'vitest';

import type { Sandwich } from '@/lib/api';
import { rankFeedItems, type FeedItem } from '@/lib/sandwich-feed';

function sandwich(
  id: string,
  pnlPct: number | null,
  likeCount: number,
  createdAt = '2026-08-30T00:00:00.000Z',
): Sandwich {
  return {
    id,
    pnlPct,
    pnlBasis: 'spot',
    likeCount,
    createdAt,
  } as unknown as Sandwich;
}

function card(market: Sandwich): FeedItem {
  return { kind: 'sandwich', key: market.id, sandwich: market };
}

function episode(id: string, markets: Sandwich[]): FeedItem {
  return {
    kind: 'video',
    key: id,
    video: {} as FeedItem & never,
    sandwiches: markets,
  } as FeedItem;
}

describe('rankFeedItems', () => {
  it('rewards cards that combine profit and likes', () => {
    const ranked = rankFeedItems([
      card(sandwich('profit-only', 20, 0)),
      card(sandwich('likes-only', 0, 100)),
      card(sandwich('both', 10, 5)),
    ]);

    expect(ranked.map((item) => item.key)).toEqual(['both', 'profit-only', 'likes-only']);
  });

  it('ranks an episode on its best call, the figure its card displays', () => {
    // Reversed deliberately. Ranking on the equal-weight mean put this episode
    // BELOW `steady`, while its own card read +50% — the order contradicted the
    // numbers on it. The cost is stated where it is paid: an episode gets one
    // chance per call to produce a winner, bounded by the cap in `feedRank`.
    const ranked = rankFeedItems([
      episode('mixed-episode', [sandwich('win', 50, 10), sandwich('loss', -50, 10)]),
      card(sandwich('steady', 5, 1)),
    ]);

    expect(ranked.map((item) => item.key)).toEqual(['mixed-episode', 'steady']);
  });

  it('does not discount an episode for the markets it could not price', () => {
    // The coverage discount belonged to the mean, where an unpriced market
    // really does weaken the figure. The best market is priced by definition,
    // so scaling it by its neighbours punished a real +20% for their absence.
    const ranked = rankFeedItems([
      episode('partial', [sandwich('priced', 20, 0), sandwich('missing', null, 0)]),
      card(sandwich('complete', 15, 0)),
    ]);

    expect(ranked.map((item) => item.key)).toEqual(['partial', 'complete']);
  });

  it('keeps equally ranked cards newest first', () => {
    const ranked = rankFeedItems([
      card(sandwich('old', null, 0, '2026-08-28T00:00:00.000Z')),
      card(sandwich('new', null, 0, '2026-08-30T00:00:00.000Z')),
    ]);

    expect(ranked.map((item) => item.key)).toEqual(['new', 'old']);
  });

  it('does not mutate the grouped input', () => {
    const input = [card(sandwich('low', 1, 0)), card(sandwich('high', 20, 0))];

    expect(rankFeedItems(input).map((item) => item.key)).toEqual(['high', 'low']);
    expect(input.map((item) => item.key)).toEqual(['low', 'high']);
  });
});
