import { describe, expect, it } from 'vitest';

import { formatClosedPositionDate } from './closed-position-date';

describe('formatClosedPositionDate', () => {
  it('formats a current-year close like the compact history reference', () => {
    expect(
      formatClosedPositionDate(
        '2026-02-18T01:48:00',
        new Date('2026-08-25T00:00:00'),
      ),
    ).toBe('18 Feb at 1:48 AM');
  });

  it('includes the year for an older close', () => {
    expect(
      formatClosedPositionDate(
        '2025-02-18T13:48:00',
        new Date('2026-08-25T00:00:00'),
      ),
    ).toBe('18 Feb 2025 at 1:48 PM');
  });

  it('returns an empty string for an invalid timestamp', () => {
    expect(formatClosedPositionDate('not-a-date')).toBe('');
  });
});
