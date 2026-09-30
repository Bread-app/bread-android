import { describe, expect, it } from 'vitest';

import type { SandwichProvenance } from '@/lib/api';
import {
  formatTimestamp,
  holdingTitle,
  provenanceDeepLink,
  sandwichHoldingRoute,
} from '@/lib/sandwich-provenance';

/**
 * Where a Holdings row goes when tapped, and what it says.
 *
 * A spot sandwich bought from a podcast used to show the generated basket name
 * with no timestamp and open a basket sheet that said nothing about the
 * episode. These are the rules that changed it.
 */

function provenance(overrides: Partial<SandwichProvenance> = {}): SandwichProvenance {
  return {
    sandwichId: 's1',
    sourceId: 'src_1',
    postId: 'post_1',
    postKind: 'episode',
    headline: 'Hyperscaler capex is still climbing',
    speakerName: 'Guest',
    source: {
      sourceType: 'youtube',
      url: 'https://www.youtube.com/watch?v=abc',
      videoId: 'abc',
      authorHandle: '@pod',
      authorName: 'The Pod',
      startMs: 312_000,
      endMs: 340_000,
    },
    ...overrides,
  };
}

describe('sandwich holding route', () => {
  it('opens the episode focused on the market the position came from', () => {
    expect(sandwichHoldingRoute(provenance(), 's1')).toEqual({
      kind: 'episode',
      pathname: '/podcast-sandwich',
      params: { sourceId: 'src_1', focus: 's1' },
    });
  });

  it('routes on the source, not on the Post backfill having run', () => {
    // A pod holding must open its episode whether or not cards exist yet.
    const route = sandwichHoldingRoute(provenance({ postId: null, postKind: null }), 's1');
    expect(route.kind).toBe('episode');
  });

  it('keeps the detail sheet for a non-video source', () => {
    const notVideo = provenance({
      source: { ...provenance().source, sourceType: 'x_post' },
    });
    expect(sandwichHoldingRoute(notVideo, 's1')).toEqual({ kind: 'detail' });
  });

  it('keeps the detail sheet when provenance never loaded', () => {
    // The fetch fails soft, so a row must still open.
    expect(sandwichHoldingRoute(null, 's1')).toEqual({ kind: 'detail' });
    expect(sandwichHoldingRoute(undefined, 's1')).toEqual({ kind: 'detail' });
  });
});

describe('holding title', () => {
  it("prefers the speaker's claim over the generated basket label", () => {
    expect(holdingTitle(provenance(), 'NVDA Basket')).toBe(
      'Hyperscaler capex is still climbing',
    );
  });

  it('falls back rather than rendering an empty string', () => {
    expect(holdingTitle(provenance({ headline: '   ' }), 'NVDA Basket')).toBe('NVDA Basket');
    expect(holdingTitle(provenance({ headline: null }), 'NVDA Basket')).toBe('NVDA Basket');
    expect(holdingTitle(null, 'NVDA Basket')).toBe('NVDA Basket');
  });
});

describe('timestamp', () => {
  it('renders minutes below an hour and hours past it', () => {
    expect(formatTimestamp(312_000)).toBe('5:12');
    expect(formatTimestamp(3_852_000)).toBe('1:04:12');
  });

  it('renders nothing rather than a bare 0:00 for a source with no timeline', () => {
    expect(formatTimestamp(null)).toBeNull();
  });
});

describe('moment deep link', () => {
  it('appends the offset to the stored url', () => {
    expect(provenanceDeepLink(provenance())).toBe(
      'https://www.youtube.com/watch?v=abc&t=312',
    );
  });

  it('falls back to the video id when no url was stored', () => {
    const noUrl = provenance({ source: { ...provenance().source, url: null } });
    expect(provenanceDeepLink(noUrl)).toBe('https://www.youtube.com/watch?v=abc&t=312');
  });

  it('returns the bare link when there is no offset', () => {
    const noOffset = provenance({ source: { ...provenance().source, startMs: null } });
    expect(provenanceDeepLink(noOffset)).toBe('https://www.youtube.com/watch?v=abc');
  });

  it('has no link at all for a non-video source', () => {
    const notVideo = provenance({
      source: { ...provenance().source, url: null, videoId: null },
    });
    expect(provenanceDeepLink(notVideo)).toBeNull();
    expect(provenanceDeepLink(null)).toBeNull();
  });
});
