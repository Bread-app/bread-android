import type { Sandwich, SandwichLeg } from '@/lib/api';

/**
 * The formatting a YouTube-sourced call is rendered with.
 *
 * These live outside the episode component so the row list and anything else
 * that shows the same call (the moments feed, a future summary row) format it
 * identically — a number that renders one way in one place and another
 * elsewhere reads as two different calls.
 */

/** The instrument a call leads with — its logo and ticker head the row. */
export function primaryLeg(sandwich: Sandwich): SandwichLeg | null {
  return sandwich.legs[0] ?? null;
}

export function marketTicker(sandwich: Sandwich): string {
  const leg = primaryLeg(sandwich);
  return leg?.underlyingSymbol ?? leg?.symbol ?? leg?.label ?? sandwich.name;
}

/** A leg's own display line — ticker where it has one, else its label. */
export function legLabel(leg: SandwichLeg): string {
  if (leg.type === 'prediction_market') return leg.question ?? leg.label;
  const ticker = leg.underlyingSymbol ?? leg.symbol;
  return ticker ? ticker.toUpperCase() : leg.label;
}

/**
 * What was actually said at the moment the call was made — the episode's own
 * captions, verbatim.
 *
 * `sandwich.name` is the model's generated headline for the idea, not the
 * speaker's words, so it is the fallback rather than the source: a row with an
 * empty second line reads as broken, not as an absent quote.
 */
export function callCaption(sandwich: Sandwich): string {
  return sandwich.thesis?.quote?.trim() || sandwich.name;
}

export function formatPct(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatCompactUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: Math.abs(value) >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 100000 ? 1 : 2,
  }).format(value);
}

/** A leg's displayed price: live if we have it, else its entry. */
export function formatLegPriceValue(leg: SandwichLeg): string {
  const value = leg.currentPriceUsd ?? leg.priceUsd;
  if (value === null) return '--';
  // A prediction leg is priced in cents of probability, never dollars.
  if (leg.type === 'prediction_market') return `${Math.round(value * 100)}c`;
  return formatCompactUsd(value);
}
