import { describe, expect, it } from 'vitest';

import { formatSandwichDetailDateTime } from './sandwich-detail-date';

describe('formatSandwichDetailDateTime', () => {
  it('shows both the local time and compact date', () => {
    expect(formatSandwichDetailDateTime('2026-09-06T01:47:00')).toBe(
      '1:47 AM · 06/09/26',
    );
  });

  it('returns an empty label when the timestamp is unavailable or invalid', () => {
    expect(formatSandwichDetailDateTime(null)).toBe('');
    expect(formatSandwichDetailDateTime('not-a-date')).toBe('');
  });
});
