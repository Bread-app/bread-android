import { describe, expect, it } from 'vitest';

import type { Sandwich } from '@/lib/api';
import { formatTimestamp, getMomentWindow, momentCaption } from '@/lib/moment';

function sandwich(
  thesis: { startMs: number | null; endMs: number | null } | null,
  legs: { startMs: number | null; endMs: number | null }[] = [],
): Sandwich {
  return {
    thesis: thesis ? { ...thesis } : {},
    legs,
  } as unknown as Sandwich;
}

describe('formatTimestamp', () => {
  it('formats mm:ss, and h:mm:ss past an hour', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65_000)).toBe('01:05');
    expect(formatTimestamp(3_725_000)).toBe('1:02:05');
  });

  it('returns the placeholder for a missing or negative offset', () => {
    expect(formatTimestamp(null)).toBe('--:--');
    expect(formatTimestamp(-1)).toBe('--:--');
    expect(formatTimestamp(null, '')).toBe('');
  });
});

describe('getMomentWindow', () => {
  it('prefers the thesis, which IS the moment', () => {
    const window = getMomentWindow(
      sandwich({ startMs: 1000, endMs: 2000 }, [{ startMs: 9999, endMs: 9999 }]),
    );

    expect(window).toEqual({ startMs: 1000, endMs: 2000 });
  });

  it('falls back to the first timestamped leg', () => {
    // Sandwiches built before the thesis fields shipped only have the
    // denormalized leg copy — this fallback is why no backfill is needed.
    const window = getMomentWindow(
      sandwich(null, [
        { startMs: null, endMs: null },
        { startMs: 4000, endMs: 5000 },
      ]),
    );

    expect(window).toEqual({ startMs: 4000, endMs: 5000 });
  });

  it('reports a missing end as null rather than inventing one', () => {
    expect(getMomentWindow(sandwich({ startMs: 1000, endMs: null }))).toEqual({
      startMs: 1000,
      endMs: null,
    });
  });

  it('returns null for a sandwich that did not come from a moment', () => {
    expect(getMomentWindow(sandwich(null, [{ startMs: null, endMs: null }]))).toBeNull();
  });
});

function videoSandwich(
  thesis: Partial<Sandwich['thesis']>,
  sourceType = 'youtube',
): Sandwich {
  return { source: { sourceType }, thesis, legs: [] } as unknown as Sandwich;
}

describe('momentCaption', () => {
  it('quotes what was said, with where in the episode it was said', () => {
    expect(
      momentCaption(
        videoSandwich({ quote: '\u201Cwe are buying more nvidia\u201D', startMs: 65_000, endMs: 80_000 }),
      ),
    ).toEqual({ text: 'we are buying more nvidia', startMs: 65_000, endMs: 80_000 });
  });

  it('falls back to the other verbatim lines before giving up', () => {
    expect(
      momentCaption(videoSandwich({ headlineQuote: 'nvidia is cheap', startMs: 1000, endMs: null })),
    ).toEqual({ text: 'nvidia is cheap', startMs: 1000, endMs: null });
    expect(
      momentCaption(videoSandwich({ quotes: ['nvidia is cheap'], startMs: 1000, endMs: null })),
    ).toEqual({ text: 'nvidia is cheap', startMs: 1000, endMs: null });
  });

  it('never stands in a generated line for captions', () => {
    // No verbatim line means no captions — the caller keeps its written one
    // rather than presenting a summary as something that was said.
    expect(momentCaption(videoSandwich({ summary: 'a take', startMs: 1000, endMs: null }))).toBeNull();
  });

  it('needs both a video source and a timestamp', () => {
    expect(momentCaption(videoSandwich({ quote: 'said it', startMs: null, endMs: null }))).toBeNull();
    expect(
      momentCaption(videoSandwich({ quote: 'said it', startMs: 1000, endMs: null }, 'x')),
    ).toBeNull();
  });
});
