import type { Sandwich, SandwichProvenance } from '@/lib/api';
import { getMomentWindow } from '@/lib/moment';

/**
 * A legacy timestamp can have a start without an end. Holdings must still play
 * a bounded moment rather than carrying on through the rest of the episode.
 */
export const PODCAST_HOLDING_FALLBACK_CLIP_MS = 60_000;

/** The one clip represented by a held podcast Sandwich. */
export function podcastHoldingClipWindow(
  sandwich: Sandwich | null | undefined,
  provenance: SandwichProvenance,
): { startMs: number; endMs: number } | null {
  const sandwichWindow = sandwich ? getMomentWindow(sandwich) : null;
  const startMs = sandwichWindow?.startMs ?? provenance.source.startMs;
  if (startMs == null || startMs < 0) return null;

  const recordedEnd = sandwichWindow?.endMs ?? provenance.source.endMs;
  const endMs =
    recordedEnd != null && recordedEnd > startMs
      ? recordedEnd
      : startMs + PODCAST_HOLDING_FALLBACK_CLIP_MS;

  return { startMs, endMs };
}
