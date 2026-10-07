/**
 * Which venue holds the perps balance shown on the Perps card.
 *
 * Phoenix stays the default while trading still runs on it — showing the
 * Hyperliquid balance there before trading moves would hide users' real Phoenix
 * collateral. Set `EXPO_PUBLIC_PERPS_VENUE=hyperliquid` to exercise the
 * Hyperliquid cash ↔ perps flow in a dev or internal build.
 */
export type PerpsVenue = 'phoenix' | 'hyperliquid';

export const PERPS_VENUE: PerpsVenue =
  process.env.EXPO_PUBLIC_PERPS_VENUE === 'hyperliquid' ? 'hyperliquid' : 'phoenix';
