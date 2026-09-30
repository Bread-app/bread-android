import { describe, expect, it } from 'vitest';

import { normalizeSandwichResearch } from './api';

describe('normalizeSandwichResearch', () => {
  it('returns null for the empty default a legacy row carries', () => {
    // Every sandwich built before research existed has `{}` here. It must read
    // as "no research" so the card renders nothing, not an empty section.
    expect(normalizeSandwichResearch({})).toBeNull();
    expect(normalizeSandwichResearch(undefined)).toBeNull();
    expect(normalizeSandwichResearch(null)).toBeNull();
  });

  it('returns null when there is neither a summary nor a company', () => {
    expect(normalizeSandwichResearch({ mechanism: 'something', falsifiers: ['x'] })).toBeNull();
  });

  it('parses a full brief', () => {
    const research = normalizeSandwichResearch({
      summary: 'OPEC+ signalled an increase.',
      mechanism: 'More barrels compress crude.',
      companies: ['Exxon Mobil', 'Chevron'],
      catalysts: [{ label: 'OPEC+ meeting', date: '2026-09-04' }, { label: 'Earnings', date: null }],
      falsifiers: ['They defer'],
      citations: [{ url: 'https://example.com', title: 'Reuters' }],
    });

    expect(research).not.toBeNull();
    expect(research!.companies).toEqual(['Exxon Mobil', 'Chevron']);
    expect(research!.catalysts).toHaveLength(2);
    expect(research!.citations[0].title).toBe('Reuters');
  });

  it('drops malformed entries rather than rendering blanks', () => {
    const research = normalizeSandwichResearch({
      summary: 'x',
      companies: ['Apple', 42, null, ''],
      catalysts: [{ label: '', date: '2026-01-01' }, { date: '2026-01-02' }, 'nope'],
      citations: [{ url: '' }, { title: 'No url' }, { url: 'https://ok.com' }],
    });

    expect(research!.companies).toEqual(['Apple']);
    expect(research!.catalysts).toEqual([]);
    expect(research!.citations).toEqual([{ url: 'https://ok.com', title: null }]);
  });

  it('tolerates non-array sections', () => {
    const research = normalizeSandwichResearch({ summary: 'x', companies: 'Apple', catalysts: 5 });
    expect(research!.companies).toEqual([]);
    expect(research!.catalysts).toEqual([]);
  });
});
