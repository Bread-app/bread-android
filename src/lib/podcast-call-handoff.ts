import type { Sandwich } from '@/lib/api';
import type { SandwichPosition } from '@/lib/sandwich-positions';

/**
 * In-memory handoff for the `podcast-call` route. Route params only carry
 * strings, so the opener parks what it already holds here and the route picks
 * it up on mount — falling back to a fetch by id on a cold entry.
 */
export type PodcastCallHandoff = {
  sandwich: Sandwich | null;
  /** The held position — required for a sell, which has nothing to fetch it from. */
  position?: SandwichPosition | null;
  /** A buy or sell's result: the updated position, or null on a full close. */
  onPositionUpdated?: (position: SandwichPosition | null) => void;
};

const pending = new Map<string, PodcastCallHandoff>();

export function stashPodcastCall(sandwichId: string, handoff: PodcastCallHandoff): void {
  pending.set(sandwichId, handoff);
}

export function takePodcastCall(sandwichId: string): PodcastCallHandoff | null {
  const handoff = pending.get(sandwichId) ?? null;
  pending.delete(sandwichId);
  return handoff;
}
