import type { PhoenixMarket, PhoenixTradeSide } from '@/lib/phoenix-api';
// Imported from the pure module, not `phoenix-api`: this file must stay free of
// SecureStore and the auth layer so it can be unit-tested off-device.
import { phoenixMarketMatchesAsset } from '@/lib/phoenix-symbol';

/**
 * The subset of a Sandwich leg this resolver reads. Kept structural so tests and
 * callers holding a partially-hydrated leg preview can use it.
 */
export type LegVenueInput = {
  venue?: string | null;
  side?: string | null;
  underlyingSymbol?: string | null;
  symbol?: string | null;
  label?: string | null;
};

export type LegVenueTarget = {
  /** Venue the detail surface should open on. */
  venue: 'spot' | 'perp';
  /** Phoenix market backing the leg. Null whenever `venue` is `spot`. */
  market: PhoenixMarket | null;
  /** Side the perp ticket opens on. Meaningless when `venue` is `spot`. */
  side: PhoenixTradeSide;
  /**
   * The leg trades as a perp but no live Phoenix market backs it, so this fell
   * back to spot. Callers must not offer a spot BUY in that state — for a short
   * leg it is the exact opposite of the thesis.
   */
  perpUnavailable: boolean;
};

const SPOT: LegVenueTarget = {
  venue: 'spot',
  market: null,
  side: 'long',
  perpUnavailable: false,
};

/**
 * Where a Sandwich leg should open: the venue it actually trades on, and — for a
 * perp — the Phoenix market and the side the user holds.
 *
 * Two rules, both learned the hard way:
 *
 * 1. **Side is read, never inferred.** A stored leg's `side` is the truth; a
 *    sandwich-level `direction` is not, and inferring long made every short
 *    silently wrong (see [[podcast-moment-parity-shipped]]).
 * 2. **No Phoenix market means spot, not a dead end.** A perp leg whose ticker
 *    has no live market still has a tokens.xyz identity, so the spot view is a
 *    real page — better than an empty venue. It is flagged `perpUnavailable`
 *    so the caller can withhold the spot BUY, which for a short would be
 *    backwards.
 */
export function resolveLegVenue(options: {
  leg: LegVenueInput;
  /** Sandwich-level venue, used when the leg predates per-leg venues. */
  sandwichVenue?: string | null;
  /** Live Phoenix markets. Pass an empty list while they are still loading. */
  markets: readonly PhoenixMarket[];
}): LegVenueTarget {
  const { leg, sandwichVenue, markets } = options;
  const venue = leg.venue ?? sandwichVenue ?? 'spot';
  if (venue !== 'perp') return SPOT;

  const symbol = leg.underlyingSymbol ?? leg.symbol ?? leg.label ?? null;
  const market = symbol
    ? markets.find((candidate) => phoenixMarketMatchesAsset(candidate, symbol)) ?? null
    : null;
  if (!market) return { ...SPOT, perpUnavailable: true };

  return {
    venue: 'perp',
    market,
    side: leg.side === 'short' ? 'short' : 'long',
    perpUnavailable: false,
  };
}
