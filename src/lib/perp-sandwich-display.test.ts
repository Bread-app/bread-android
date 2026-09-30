import { describe, expect, it } from 'vitest';

import {
  formatTimestamp,
  momentDeepLink,
  perpSandwichContext,
  phoenixPositionFromPerpSandwich,
} from './perp-sandwich-display';
import type { PerpSandwichPosition } from './api';

function position(overrides: {
  leg?: Partial<PerpSandwichPosition['legs'][number]>;
  sandwich?: Partial<PerpSandwichPosition['sandwich']>;
  source?: Partial<PerpSandwichPosition['sandwich']['source']>;
  position?: Partial<PerpSandwichPosition>;
} = {}): PerpSandwichPosition {
  return {
    id: 'position-1',
    venue: 'perp',
    status: 'open',
    pdaIndex: 0,
    accountMode: 'isolated_pool',
    actionableStatus: 'close',
    marginUsdc: 50,
    leverage: 3,
    stopLossPct: 8,
    pnlAfterFundingUsd: 4,
    unrealizedPnlUsd: 5,
    unsettledFundingUsd: 1,
    withdrawableUsd: null,
    effectiveCollateralUsd: 54,
    collateralBalanceUsd: 50,
    readError: null,
    sandwich: {
      id: 'sandwich-1',
      name: 'Bearish semis basket',
      horizon: '30 days',
      venue: 'perp',
      headline: 'Memory pricing is about to roll over',
      speakerName: 'Guest',
      source: {
        sourceType: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc123',
        videoId: 'abc123',
        authorHandle: 'showhandle',
        authorName: 'The Show',
        startMs: 3_600_000,
        ...overrides.source,
      },
      ...overrides.sandwich,
    },
    legs: [
      {
        symbol: 'MU',
        side: 'short',
        subaccountIndex: 2,
        weightBps: 10_000,
        mint: 'MintAddress',
        tokenSymbol: 'MUx',
        startMs: 754_000,
        marginUsdc: 50,
        notionalUsd: 150,
        positionSize: -1.5,
        entryPrice: 100,
        markPrice: 96,
        stopLossPrice: 108,
        liquidationPrice: 130,
        unrealizedPnlUsd: 5,
        unsettledFundingUsd: 1,
        accumulatedFundingUsd: 0.25,
        pnlAfterFundingUsd: 4,
        ...overrides.leg,
      },
    ],
    ...overrides.position,
  } as PerpSandwichPosition;
}

describe('formatTimestamp', () => {
  it('renders minutes below an hour and hours above it', () => {
    expect(formatTimestamp(754_000)).toBe('12:34');
    expect(formatTimestamp(3_852_000)).toBe('1:04:12');
  });

  it('returns null rather than a placeholder when there is no timestamp', () => {
    // A source with no timeline has nothing to point into, and "0:00" would
    // read as the very start of an episode that may not exist.
    expect(formatTimestamp(null)).toBeNull();
    expect(formatTimestamp(undefined)).toBeNull();
    expect(formatTimestamp(-1)).toBeNull();
  });
});

describe('momentDeepLink', () => {
  it('appends the moment offset to the stored url', () => {
    expect(momentDeepLink(position())).toBe('https://www.youtube.com/watch?v=abc123&t=3600');
  });

  it('falls back to the video id when no url was stored', () => {
    const link = momentDeepLink(position({ source: { url: null } }));
    expect(link).toBe('https://www.youtube.com/watch?v=abc123&t=3600');
  });

  it('has no link for a source that is not a video', () => {
    expect(momentDeepLink(position({ source: { url: null, videoId: null } }))).toBeNull();
  });
});

describe('perpSandwichContext', () => {
  it('prefers the speaker headline over the generated Sandwich name', () => {
    expect(perpSandwichContext(position())?.title).toBe(
      'Memory pricing is about to roll over',
    );
  });

  it('falls back to the Sandwich name when the headline is blank', () => {
    const context = perpSandwichContext(position({ sandwich: { headline: '   ' } }));
    expect(context?.title).toBe('Bearish semis basket');
  });

  it('prefers the leg timestamp over the thesis window', () => {
    // A moment spans several passes; the leg records the one that produced this
    // exposure.
    expect(perpSandwichContext(position())?.startMs).toBe(754_000);
  });

  it('falls back to the thesis window when the leg has no timestamp', () => {
    expect(perpSandwichContext(position({ leg: { startMs: null } }))?.startMs).toBe(3_600_000);
  });
});

describe('phoenixPositionFromPerpSandwich', () => {
  it('keeps a short negative so the sheet cannot draw it as a long', () => {
    const mapped = phoenixPositionFromPerpSandwich(position());
    expect(mapped?.positionSize).toBeLessThan(0);
    expect(mapped?.stopLossPrice).toBe(108);
    expect(mapped?.liquidationPrice).toBe(130);
    expect(mapped?.leverage).toBe(3);
  });

  it('carries the headline through as the display name', () => {
    expect(phoenixPositionFromPerpSandwich(position())?.name).toBe(
      'Memory pricing is about to roll over',
    );
  });

  it('has nothing to show for a position with no legs', () => {
    expect(phoenixPositionFromPerpSandwich(position({ position: { legs: [] } }))).toBeNull();
    expect(perpSandwichContext(position({ position: { legs: [] } }))).toBeNull();
  });
});
