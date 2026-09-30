import { describe, expect, it } from 'vitest';

import type { Sandwich, SandwichPost } from '@/lib/api';
import { buildFeedItemsFromPosts, rankFeedItems, rankPosts, sortPosts } from '@/lib/sandwich-feed';

function market(id: string, over: Partial<Sandwich> = {}): Sandwich {
  return {
    id,
    sourceId: 'src-1',
    name: id,
    pnlPct: null,
    pnlBasis: 'spot',
    likeCount: 0,
    commentCount: 0,
    viewerHasLiked: false,
    postId: 'post-1',
    legs: [],
    source: {
      id: 'src-1',
      sourceType: 'typed',
      sourceUrl: null,
      input: 'hello',
      quote: null,
      authorHandle: null,
      authorName: null,
      authorAvatarUrl: null,
      editorialSummary: null,
      publishedAt: null,
    },
    ...over,
  } as unknown as Sandwich;
}

function videoMarket(id: string, over: Partial<Sandwich> = {}): Sandwich {
  return market(id, {
    source: {
      id: 'src-yt',
      sourceType: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=BJphreY_h7s',
      input: 'https://www.youtube.com/watch?v=BJphreY_h7s',
      quote: 'MARKET OPEN — the whole episode',
      authorHandle: '@notthreadguy',
      authorName: 'not threadguy',
      authorAvatarUrl: null,
      editorialSummary: null,
      publishedAt: null,
    },
    ...over,
  } as Partial<Sandwich>);
}

function post(id: string, sandwiches: Sandwich[], over: Partial<SandwichPost> = {}): SandwichPost {
  return {
    id,
    kind: 'thesis',
    sourceId: sandwiches[0]?.sourceId ?? null,
    title: id,
    coverUrl: null,
    originHandle: null,
    marketCount: sandwiches.length,
    publishedAt: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    sandwiches,
    likeCount: 0,
    commentCount: 0,
    viewerHasLiked: false,
    ...over,
  };
}

describe('buildFeedItemsFromPosts', () => {
  it('makes one card per post, however many markets it holds', () => {
    // The whole point of the cutover: the server states the grouping. Eight
    // markets on one episode are one card, not eight.
    const episode = post('post-yt', [videoMarket('a'), videoMarket('b'), videoMarket('c')], {
      kind: 'episode',
      sourceId: 'src-yt',
    });
    const items = buildFeedItemsFromPosts([episode]);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('video');
    expect(items[0].kind === 'video' && items[0].sandwiches).toHaveLength(3);
  });

  it('keys an episode card by its source, unchanged from the grouped builder', () => {
    // The episode screen and the group store address a card by source — a new
    // key would orphan whatever they hold.
    const items = buildFeedItemsFromPosts([
      post('post-yt', [videoMarket('a')], { kind: 'episode', sourceId: 'src-yt' }),
    ]);

    expect(items[0].key).toBe('video-src-yt');
  });

  it('renders a non-video post as a plain sandwich card', () => {
    const items = buildFeedItemsFromPosts([post('post-1', [market('solo')])]);

    expect(items[0]).toMatchObject({ kind: 'sandwich', key: 'solo' });
  });

  it('skips a post with no markets rather than rendering an empty row', () => {
    expect(buildFeedItemsFromPosts([post('post-empty', [])])).toEqual([]);
  });
});

describe('rankFeedItems', () => {
  it('ranks an episode by its best market, alongside single sandwiches', () => {
    // The regression this fixes: the episode was ranked on its equal-weight
    // mean ((80 + 0 + 0) / 3 = 26.7) and so sank below a +40% single sandwich,
    // even though the card itself displayed +80%.
    const episode = post(
      'post-yt',
      [videoMarket('yt-a', { pnlPct: 80 }), videoMarket('yt-b', { pnlPct: 0 }), videoMarket('yt-c', { pnlPct: 0 })],
      { kind: 'episode', sourceId: 'src-yt' },
    );
    const solo = post('post-solo', [market('solo', { pnlPct: 40, postId: 'post-solo' })]);

    const ranked = rankFeedItems(buildFeedItemsFromPosts([solo, episode]));

    expect(ranked.map((item) => item.key)).toEqual(['video-src-yt', 'solo']);
  });

  it('orders cards by return, descending', () => {
    const cards = [
      post('p1', [market('low', { pnlPct: 3, postId: 'p1' })]),
      post('p2', [market('high', { pnlPct: 61, postId: 'p2' })]),
      post('p3', [market('mid', { pnlPct: 22, postId: 'p3' })]),
    ];

    const ranked = rankFeedItems(buildFeedItemsFromPosts(cards));

    expect(ranked.map((item) => item.key)).toEqual(['high', 'mid', 'low']);
  });

  it('does not let an unpriced episode outrank a priced card', () => {
    const unpriced = post('p-yt', [videoMarket('yt-a'), videoMarket('yt-b')], {
      kind: 'episode',
      sourceId: 'src-yt',
    });
    const priced = post('p2', [market('priced', { pnlPct: 12, postId: 'p2' })]);

    const ranked = rankFeedItems(buildFeedItemsFromPosts([unpriced, priced]));

    expect(ranked[0].key).toBe('priced');
  });
});

describe('rankPosts', () => {
  it('ranks a page on its own, so appending never reorders earlier pages', () => {
    const pageOne = rankPosts([
      post('p1', [market('a', { pnlPct: 5, postId: 'p1' })]),
      post('p2', [market('b', { pnlPct: 20, postId: 'p2' })]),
    ]);
    // A much stronger card arrives on page two. It belongs at the top of ITS
    // page, not above the cards the reader already scrolled past.
    const pageTwo = rankPosts([
      post('p3', [market('c', { pnlPct: 1, postId: 'p3' })]),
      post('p4', [market('d', { pnlPct: 90, postId: 'p4' })]),
    ]);

    const feed = buildFeedItemsFromPosts([...pageOne, ...pageTwo]);

    expect(feed.map((item) => item.key)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('reuses one feed item per post, so unchanged cards keep their props', () => {
    const posts = [post('p1', [market('a', { postId: 'p1' })])];

    expect(buildFeedItemsFromPosts(posts)[0]).toBe(buildFeedItemsFromPosts(posts)[0]);
  });
});

describe('sortPosts', () => {
  const posts = [
    post('old-winner', [market('a', { pnlPct: 40, postId: 'old-winner', likeCount: 0 })], {
      publishedAt: '2026-09-01T00:00:00Z',
    }),
    post('new-unpriced', [market('b', { pnlPct: null, postId: 'new-unpriced' })], {
      publishedAt: '2026-09-20T00:00:00Z',
    }),
    post('mid-loser', [market('c', { pnlPct: -12, postId: 'mid-loser' })], {
      publishedAt: '2026-09-10T00:00:00Z',
    }),
  ];

  it('pnl: highest return first, unpriced below every priced card', () => {
    expect(sortPosts(posts, 'pnl').map((p) => p.id)).toEqual([
      'old-winner',
      'mid-loser',
      'new-unpriced',
    ]);
  });

  it('pnl: an episode sorts on its best market, the figure the card shows', () => {
    const episode = post('episode', [
      videoMarket('v1', { pnlPct: -5, postId: 'episode' }),
      videoMarket('v2', { pnlPct: 60, postId: 'episode' }),
    ]);
    expect(sortPosts([...posts, episode], 'pnl')[0].id).toBe('episode');
  });

  it('recent: newest published first', () => {
    expect(sortPosts(posts, 'recent').map((p) => p.id)).toEqual([
      'new-unpriced',
      'mid-loser',
      'old-winner',
    ]);
  });
});
