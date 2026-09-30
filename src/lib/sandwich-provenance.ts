import type { SandwichProvenance } from '@/lib/api';

/**
 * Turning a held sandwich's provenance into what a Holdings row shows and where
 * tapping it goes.
 *
 * Perp sandwich rows have shown the moment's headline and timestamp since
 * /api/perp-sandwich-positions; spot rows showed the generated basket name and
 * opened a generic detail sheet. These helpers give both the same treatment.
 */

/** `1:04:12` past an hour, `12:34` below it. Never renders a bare `0:00`. */
export { formatTimestamp } from '@/lib/perp-sandwich-display';

/**
 * Where tapping a sandwich holding goes.
 *
 * A position from a podcast opens the episode screen with its own market
 * focused, so the row lands on the moment it came from rather than on a basket
 * sheet that says nothing about the episode. Anything else keeps the existing
 * detail sheet, so this can never leave a row unable to open.
 *
 * Gated on the SOURCE being a video, not on the sandwich having a Post: the
 * episode screen rebuilds itself from `sourceId`, so this works whether or not
 * the Post backfill has run.
 */
export function sandwichHoldingRoute(
  provenance: SandwichProvenance | null | undefined,
  sandwichId: string,
):
  | { kind: 'episode'; pathname: '/podcast-sandwich'; params: Record<string, string> }
  | { kind: 'detail' } {
  if (provenance && provenance.source.sourceType === 'youtube') {
    // Group-stripped href: the route lives under (app) but is addressed without
    // the group segment. `focus` anchors the episode on this market.
    return {
      kind: 'episode',
      pathname: '/podcast-sandwich',
      params: { sourceId: provenance.sourceId, focus: sandwichId },
    };
  }
  return { kind: 'detail' };
}

/**
 * A YouTube link that opens at the moment, when the source is a video.
 *
 * Built from the stored url rather than the bare video id so a source that is
 * already a full watch/share link keeps whatever form it was ingested in.
 * Mirrors `momentDeepLink` on the perp side.
 */
export function provenanceDeepLink(provenance: SandwichProvenance | null | undefined): string | null {
  if (!provenance) return null;
  const { source } = provenance;
  const base =
    source.url ?? (source.videoId ? `https://www.youtube.com/watch?v=${source.videoId}` : null);
  if (!base) return null;
  if (source.startMs === null) return base;
  const seconds = Math.max(0, Math.floor(source.startMs / 1000));
  return `${base}${base.includes('?') ? '&' : '?'}t=${seconds}`;
}

/**
 * The row's title: the speaker's actual claim, falling back to the generated
 * basket label. Never an empty string.
 */
export function holdingTitle(
  provenance: SandwichProvenance | null | undefined,
  fallbackName: string,
): string {
  return provenance?.headline?.trim() || fallbackName;
}
