import { describe, expect, it } from 'vitest';

import { nextManualSelection } from './manual-sandwich-selection';

type Leg = { id: string; venue: 'spot' | 'perp' };

describe('manual Sandwich venue selection', () => {
  it('stacks spot assets', () => {
    const result = nextManualSelection<Leg>(
      { direction: 'up', executionVenue: null, legs: [{ id: 'aapl', venue: 'spot' }] },
      { id: 'nvda', venue: 'spot' },
    );

    expect(result.legs.map((leg) => leg.id)).toEqual(['aapl', 'nvda']);
    expect(result.executionVenue).toBeNull();
    expect(result.direction).toBe('up');
  });

  it('replaces a spot basket with exactly one perp', () => {
    const result = nextManualSelection<Leg>(
      {
        direction: 'up',
        executionVenue: null,
        legs: [{ id: 'aapl', venue: 'spot' }, { id: 'nvda', venue: 'spot' }],
      },
      { id: 'tsla-perp', venue: 'perp' },
    );

    expect(result).toMatchObject({
      direction: 'up',
      executionVenue: 'perp',
      legs: [{ id: 'tsla-perp', venue: 'perp' }],
    });
  });

  it('replaces the existing perp and preserves its selected side', () => {
    const result = nextManualSelection<Leg>(
      {
        direction: 'down',
        executionVenue: 'perp',
        legs: [{ id: 'aapl-perp', venue: 'perp' }],
      },
      { id: 'nvda-perp', venue: 'perp' },
    );

    expect(result).toMatchObject({
      direction: 'down',
      executionVenue: 'perp',
      legs: [{ id: 'nvda-perp', venue: 'perp' }],
    });
  });

  it('replaces a short perp with long-only spot', () => {
    const result = nextManualSelection<Leg>(
      {
        direction: 'down',
        executionVenue: 'perp',
        legs: [{ id: 'aapl-perp', venue: 'perp' }],
      },
      { id: 'aapl', venue: 'spot' },
    );

    expect(result).toMatchObject({
      direction: 'up',
      executionVenue: null,
      legs: [{ id: 'aapl', venue: 'spot' }],
    });
  });
});
