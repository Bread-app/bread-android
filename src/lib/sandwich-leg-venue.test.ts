import { describe, expect, it } from 'vitest';

import type { PhoenixMarket } from './phoenix-api';
import { resolveLegVenue } from './sandwich-leg-venue';

function market(symbol: string): PhoenixMarket {
  return { symbol } as PhoenixMarket;
}

const MARKETS = [market('AAPL'), market('TSLA')];

describe('resolveLegVenue', () => {
  it('opens a short perp leg on its Phoenix market, short side', () => {
    expect(
      resolveLegVenue({
        leg: { venue: 'perp', side: 'short', underlyingSymbol: 'TSLA', symbol: 'TSLAX' },
        markets: MARKETS,
      }),
    ).toEqual({ venue: 'perp', market: MARKETS[1], side: 'short', perpUnavailable: false });
  });

  it('keeps a long perp leg long', () => {
    const target = resolveLegVenue({
      leg: { venue: 'perp', side: 'long', underlyingSymbol: 'AAPL' },
      markets: MARKETS,
    });
    expect(target).toMatchObject({ venue: 'perp', side: 'long' });
  });

  it('matches the wrapper ticker when the leg carries no underlying', () => {
    const target = resolveLegVenue({
      leg: { venue: 'perp', side: 'short', symbol: 'AAPLx' },
      markets: MARKETS,
    });
    expect(target).toMatchObject({ venue: 'perp', market: MARKETS[0], side: 'short' });
  });

  it('falls back to spot and flags a perp leg with no live market', () => {
    expect(
      resolveLegVenue({
        leg: { venue: 'perp', side: 'short', underlyingSymbol: 'HOOD' },
        markets: MARKETS,
      }),
    ).toEqual({ venue: 'spot', market: null, side: 'long', perpUnavailable: true });
  });

  it('flags a perp leg while markets are still loading, rather than offering spot', () => {
    expect(
      resolveLegVenue({ leg: { venue: 'perp', side: 'short', symbol: 'TSLA' }, markets: [] })
        .perpUnavailable,
    ).toBe(true);
  });

  it('leaves spot legs alone, market list or not', () => {
    expect(
      resolveLegVenue({
        leg: { venue: 'spot', side: 'long', underlyingSymbol: 'AAPL' },
        markets: MARKETS,
      }),
    ).toEqual({ venue: 'spot', market: null, side: 'long', perpUnavailable: false });
  });

  it('falls back to the sandwich venue for legs that predate per-leg venues', () => {
    expect(
      resolveLegVenue({
        leg: { side: 'short', underlyingSymbol: 'AAPL' },
        sandwichVenue: 'perp',
        markets: MARKETS,
      }),
    ).toMatchObject({ venue: 'perp', side: 'short' });
  });

  it('never infers a side — an unreadable side is long, and a short is only ever a stored short', () => {
    expect(
      resolveLegVenue({
        leg: { venue: 'perp', side: null, underlyingSymbol: 'AAPL' },
        markets: MARKETS,
      }).side,
    ).toBe('long');
  });
});
