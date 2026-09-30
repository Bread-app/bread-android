/**
 * Take presentation rules (§8), kept out of the components that render them.
 *
 * The stamp in particular is the reason a take is not a tweet, and it appears in
 * three places — the detail section, the feed card and the holding card quote —
 * so it is decided once here rather than three times in three styles.
 */

import type { PositionTake } from '@/lib/api';

/**
 * Holding age, in the units a reader thinks in.
 *
 * Switches to weeks at 14 days, not 7: the spec's own examples read "13d" and
 * "3w", and rounding 13 days to "2w" both overstates the hold and loses the
 * precision that makes a short hold legible.
 */
export function ageLabel(ageDays: number): string {
  return ageDays >= 14 ? `${Math.round(ageDays / 7)}w` : `${ageDays}d`;
}

/** One decimal below 10%, none above — the same rule the notification copy uses. */
export function signedPct(pct: number): string {
  return `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(pct !== 0 && Math.abs(pct) < 10 ? 1 : 0)}%`;
}

/**
 * What the position was doing when these words were written — or what it
 * settled at, once it closed and there is no live number left to read.
 */
export function stampLabel(take: PositionTake): string {
  const { pct, ageDays, closed } = take.stamp;
  return closed ? `closed at ${signedPct(pct)}` : `holding · ${signedPct(pct)} · ${ageLabel(ageDays)}`;
}

/**
 * The composer's prompt. A blank box asking for "a thesis" gets a blank box
 * back; the question the position itself raises is what gets an answer — and
 * that question is different at +12% than it is at -8%.
 */
export function placeholderFor(input: { hasTakes: boolean; pct: number | null }): string {
  if (!input.hasTakes || input.pct === null) return 'Why are you in this?';
  if (input.pct > 0) return `Still holding at +${Math.abs(input.pct).toFixed(0)}%. What's the plan?`;
  if (input.pct < 0) return `Down ${Math.abs(input.pct).toFixed(0)}%. Conviction or exit?`;
  return 'Why are you in this?';
}

export function formatCountdown(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 1 ? 'a minute' : `${minutes} minutes`;
}

/** A band is shown; "hidden" and "unknown" are not numbers and are not shown. */
export function visibleSizeBand(sizeBand: string | null | undefined): string | null {
  if (!sizeBand || sizeBand === 'hidden' || sizeBand === 'unknown') return null;
  return sizeBand;
}

export const TAKE_SIGNAL_LABEL: Record<string, string> = {
  adding: 'Adding',
  holding: 'Holding',
  trimming: 'Trimming',
};

/**
 * Everything the thesis composer needs to draw its position card, as one
 * object. Built wherever a position is at hand — a holding card, a trade
 * receipt — and turned into route params by {@link takeComposerRoute}, so the
 * composer never fetches: the server re-verifies ownership on write anyway.
 */
export type TakeComposerTarget = {
  positionKind: 'sandwichId' | 'perp' | 'phoenix';
  positionId: string;
  name: string;
  direction?: string | null;
  /** Perp leverage, shown beside the direction as "SHORT 8x". */
  leverage?: number | null;
  pct: number | null;
  valueUsd: number | null;
  logoUrl?: string | null;
  /**
   * Further artwork to try when `logoUrl` misses — a perp's Phoenix mark is
   * an SVG a bare <Image> draws as nothing, so the tokens.xyz art has to be
   * in the list too.
   */
  logoFallbackUrls?: (string | null | undefined)[];
  openedAt?: string | null;
  takeCount?: number;
};

export function takeComposerRoute(target: TakeComposerTarget): {
  pathname: '/position-take-composer';
  params: Record<string, string>;
} {
  const ageDays = target.openedAt
    ? Math.max(0, Math.round((Date.now() - new Date(target.openedAt).getTime()) / 86_400_000))
    : null;
  return {
    pathname: '/position-take-composer',
    params: {
      positionKind: target.positionKind,
      positionId: target.positionId,
      name: target.name,
      direction: target.direction ?? '',
      leverage: target.leverage == null ? '' : String(target.leverage),
      pct: target.pct === null ? '' : String(target.pct),
      valueUsd: target.valueUsd === null ? '' : String(target.valueUsd),
      logoUrl: target.logoUrl ?? '',
      logoFallbackUrls: JSON.stringify((target.logoFallbackUrls ?? []).filter(Boolean)),
      ageDays: ageDays === null ? '' : String(ageDays),
      takeCount: String(target.takeCount ?? 0),
    },
  };
}

/**
 * The amount Copy trade pre-fills, from the taker's size band (§8.1: "the
 * taker's size band pre-selected").
 *
 * A band is a range, so this is its LOWER bound — the least a reader can be
 * sure the taker put in, and the least aggressive honest reading of "copy
 * this". "< $100" has no floor to take, so it starts at $10. It is a pre-fill,
 * never an order: the pad still waits for the reader to confirm, and says so
 * when their cash will not cover it. A hidden or unknown band pre-fills
 * nothing rather than inventing a size the taker chose not to show.
 */
export function copyTradeAmount(sizeBand: string | null | undefined): string | null {
  switch (sizeBand) {
    case '< $100':
      return '10';
    case '$100–1K':
      return '100';
    case '$1K–10K':
      return '1000';
    case '$10K+':
      return '10000';
    default:
      return null;
  }
}
