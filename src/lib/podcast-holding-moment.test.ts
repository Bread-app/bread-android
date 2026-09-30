import { describe, expect, it } from 'vitest';

import type { Sandwich, SandwichProvenance } from '@/lib/api';
import {
  PODCAST_HOLDING_FALLBACK_CLIP_MS,
  podcastHoldingClipWindow,
} from '@/lib/podcast-holding-moment';

function provenance(startMs: number | null = 312_000, endMs: number | null = 340_000): SandwichProvenance {
  return {
    sandwichId: 'sandwich-1',
    sourceId: 'source-1',
    postId: 'post-1',
    postKind: 'episode',
    headline: 'AI demand keeps climbing',
    speakerName: 'Speaker',
    source: {
      sourceType: 'youtube',
      url: 'https://youtube.com/watch?v=abc',
      videoId: 'abc',
      authorHandle: 'channel',
      authorName: 'Channel',
      startMs,
      endMs,
    },
  };
}

function sandwich(overrides: Partial<Sandwich> = {}): Sandwich {
  return {
    id: 'sandwich-1',
    commentary: null,
    summary: 'The broad thesis',
    derivation: { explanation: '', segments: [], steps: [] },
    thesis: {
      summary: 'The thesis summary',
      startMs: 315_000,
      endMs: 330_000,
    },
    legs: [
      {
        id: 'leg-1',
        label: 'Nvidia',
        symbol: 'NVDA',
        underlyingSymbol: 'NVDA',
        legMechanism: 'More accelerator demand should lift data-center revenue.',
        matchSummary: null,
        reason: 'Fallback reason',
      },
    ],
    ...overrides,
  } as Sandwich;
}

describe('podcast holding clip', () => {
  it('uses the Sandwich moment instead of the whole episode', () => {
    expect(podcastHoldingClipWindow(sandwich(), provenance())).toEqual({
      startMs: 315_000,
      endMs: 330_000,
    });
  });

  it('bounds a legacy start-only moment to one minute', () => {
    const row = sandwich({
      thesis: { ...sandwich().thesis, startMs: 315_000, endMs: null },
      legs: [{ ...sandwich().legs[0], startMs: 315_000, endMs: null }],
    });
    expect(podcastHoldingClipWindow(row, provenance(315_000, null))).toEqual({
      startMs: 315_000,
      endMs: 315_000 + PODCAST_HOLDING_FALLBACK_CLIP_MS,
    });
  });
});
