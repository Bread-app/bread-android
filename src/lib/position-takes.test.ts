import { describe, expect, it } from 'vitest';

import type { PositionTake, Sandwich, SandwichPost } from '@/lib/api';
import { normalizePositionTake } from '@/lib/api';
import { ageLabel, copyTradeAmount, formatCountdown, placeholderFor, stampLabel, visibleSizeBand } from '@/lib/position-takes';
import { buildFeedItemsFromPosts } from '@/lib/sandwich-feed';

function take(over: Partial<PositionTake> = {}): PositionTake {
  return {
    id: 't1',
    postId: 'post-take',
    sandwichId: 's1',
    body: 'privacy is the only trade that matters this cycle',
    signal: null,
    attachmentUrl: null,
    attachmentKind: null,
    sizeBand: '$100–1K',
    stamp: { pct: 12, ageDays: 13, closed: false, closedPct: null },
    edited: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    author: { id: 'u1', username: 'vzy', name: null, avatarUrl: null },
    holderAgeDays: 13,
    ...over,
  };
}

describe('the verified stamp', () => {
  // The stamp is the whole reason a take is not a tweet: it says what the
  // position was doing when these words were written.
  it('reads holding, return and age while the position is open', () => {
    // 13 days reads as "13d", not "2w" — the spec's own example, and the
    // reason the weeks threshold is 14 rather than 7.
    expect(stampLabel(take())).toBe('holding · +12% · 13d');
    expect(stampLabel(take({ stamp: { pct: -8.4, ageDays: 3, closed: false, closedPct: null } }))).toBe(
      'holding · -8.4% · 3d',
    );
    expect(stampLabel(take({ stamp: { pct: 34, ageDays: 21, closed: false, closedPct: null } }))).toBe(
      'holding · +34% · 3w',
    );
  });

  it('switches to what it settled at once closed', () => {
    expect(stampLabel(take({ stamp: { pct: 21, ageDays: 40, closed: true, closedPct: 21 } }))).toBe(
      'closed at +21%',
    );
  });
});

describe('composer prompts', () => {
  // A blank box asking for "a thesis" gets a blank box back. The question the
  // position itself raises is what gets an answer — and it differs by state.
  it('asks the question the position raises', () => {
    expect(placeholderFor({ hasTakes: false, pct: 12 })).toBe('Why are you in this?');
    expect(placeholderFor({ hasTakes: true, pct: 12 })).toBe("Still holding at +12%. What's the plan?");
    expect(placeholderFor({ hasTakes: true, pct: -8 })).toBe('Down 8%. Conviction or exit?');
  });

  it('falls back to the opening question when the position cannot be valued', () => {
    expect(placeholderFor({ hasTakes: true, pct: null })).toBe('Why are you in this?');
  });

  it('counts the cooldown in whole minutes', () => {
    expect(formatCountdown(30_000)).toBe('a minute');
    expect(formatCountdown(11 * 60_000)).toBe('11 minutes');
  });
});

describe('size bands', () => {
  // §8.4: a band is shown, a number never is — and "hidden" or "unknown" are
  // not bands, so they render as nothing rather than as text.
  it('shows a real band and nothing else', () => {
    expect(visibleSizeBand('$1K–10K')).toBe('$1K–10K');
    expect(visibleSizeBand('hidden')).toBeNull();
    expect(visibleSizeBand('unknown')).toBeNull();
    expect(visibleSizeBand(undefined)).toBeNull();
  });
});

describe('normalizing a take', () => {
  it('refuses a payload with no body', () => {
    expect(normalizePositionTake({ id: 't1' })).toBeNull();
  });

  it('drops a signal it does not recognise rather than passing it through', () => {
    expect(normalizePositionTake({ id: 't1', body: 'x', signal: 'out' })?.signal).toBeNull();
    expect(normalizePositionTake({ id: 't1', body: 'x', signal: 'trimming' })?.signal).toBe('trimming');
  });
});

function sandwich(): Sandwich {
  return {
    id: 's1',
    sourceId: 'src-1',
    name: 'Privacy coins rerate',
    pnlPct: null,
    pnlBasis: 'spot',
    likeCount: 0,
    commentCount: 0,
    viewerHasLiked: false,
    postId: 'post-thesis',
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
  } as unknown as Sandwich;
}

function post(over: Partial<SandwichPost> = {}): SandwichPost {
  return {
    id: 'post-take',
    kind: 'take',
    sourceId: null,
    title: 'Privacy coins rerate',
    coverUrl: null,
    originHandle: '@vzy',
    marketCount: 1,
    publishedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    sandwiches: [sandwich()],
    likeCount: 0,
    commentCount: 0,
    viewerHasLiked: false,
    take: take(),
    ...over,
  };
}

describe('takes in the feed', () => {
  it('builds a take card carrying the basket it is about', () => {
    const items = buildFeedItemsFromPosts([post()]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('take');
    // Copy trade opens the basket, so the card is useless without it.
    if (items[0].kind === 'take') expect(items[0].sandwich.id).toBe('s1');
  });

  // A `kind: "take"` post whose join row failed to load is still a Post, and
  // rendering nothing would silently drop a card the server counted.
  it('falls back to an ordinary card when the take itself is missing', () => {
    expect(buildFeedItemsFromPosts([post({ take: null })])[0].kind).toBe('sandwich');
  });
});

describe('copy trade pre-fill', () => {
  // A band is a range; the pre-fill is its LOWER bound — the least a reader can
  // be sure the taker put in.
  it('starts from the bottom of the taker\'s band', () => {
    expect(copyTradeAmount('$100–1K')).toBe('100');
    expect(copyTradeAmount('$1K–10K')).toBe('1000');
    expect(copyTradeAmount('$10K+')).toBe('10000');
    expect(copyTradeAmount('< $100')).toBe('10');
  });

  // A size the taker chose not to show is not something to invent.
  it('pre-fills nothing for a hidden or unknown band', () => {
    expect(copyTradeAmount('hidden')).toBeNull();
    expect(copyTradeAmount('unknown')).toBeNull();
    expect(copyTradeAmount(null)).toBeNull();
  });
});

describe('holding age', () => {
  it('stays in days below two weeks', () => {
    expect(ageLabel(0)).toBe('0d');
    expect(ageLabel(13)).toBe('13d');
    expect(ageLabel(14)).toBe('2w');
  });
});
