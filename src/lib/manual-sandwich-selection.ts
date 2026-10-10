import type { SandwichDirection, SandwichVenue } from '@/lib/api';

type SelectableLeg = { venue: SandwichVenue };

/**
 * The most picks a Sandwich may have — manual and remix alike. The server
 * enforces the same number (MAX_SANDWICH_LEGS in stock-backend buildSandwich.ts)
 * and refuses a fifth, so the composer stops at it first.
 */
export const MAX_SANDWICH_LEGS = 4;

export type ManualSelectionState<T extends SelectableLeg> = {
  direction: SandwichDirection;
  executionVenue: 'perp' | null;
  legs: T[];
};

/**
 * Apply an asset-picker choice without ever producing a mixed-venue Sandwich.
 *
 * Spot assets may stack. A perp always occupies the Sandwich by itself, and
 * crossing from one venue to the other replaces the old composition. Venue is
 * chosen before direction: a newly selected perp starts Long and then exposes
 * the Long/Short control, while spot is always reset to Long.
 */
export function nextManualSelection<T extends SelectableLeg>(
  current: ManualSelectionState<T>,
  picked: T,
): ManualSelectionState<T> {
  const pickedPerp = picked.venue === 'perp';
  const currentPerp = current.executionVenue === 'perp';
  const changingVenue = current.legs.length > 0 && currentPerp !== pickedPerp;
  const direction = pickedPerp && currentPerp ? current.direction : 'up';

  const replaces = pickedPerp || changingVenue;
  // At the cap, a further spot pick is ignored rather than appended.
  if (!replaces && current.legs.length >= MAX_SANDWICH_LEGS) return current;
  return {
    direction,
    executionVenue: pickedPerp ? 'perp' : null,
    legs: replaces ? [picked] : [...current.legs, picked],
  };
}
