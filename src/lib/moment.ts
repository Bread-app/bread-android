import type { Sandwich } from '@/lib/api';

/** The window of the source video a call was made in. */
export type MomentWindow = {
  startMs: number;
  /** Null when the call has no known end — play on past it rather than cutting. */
  endMs: number | null;
};

/**
 * `mm:ss`, or `h:mm:ss` past an hour. Returns the placeholder for a missing or
 * negative offset so a chip never renders an empty box.
 */
export function formatTimestamp(ms: number | null | undefined, fallback = '--:--'): string {
  if (ms == null || ms < 0) return fallback;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Where in the source video this sandwich's call was made, or null if it didn't
 * come from a timestamped moment.
 *
 * The thesis IS the moment, so its window is authoritative. Legs carry a
 * denormalized copy (written by `buildSandwichFromMoment`), which is the
 * fallback for sandwiches built before the thesis fields shipped — that
 * fallback is why this needs no backfill to work on existing rows.
 */
export function getMomentWindow(sandwich: Sandwich): MomentWindow | null {
  const thesisStart = sandwich.thesis?.startMs;
  if (thesisStart != null && thesisStart >= 0) {
    return { startMs: thesisStart, endMs: sandwich.thesis.endMs ?? null };
  }

  for (const leg of sandwich.legs) {
    if (leg.startMs != null && leg.startMs >= 0) {
      return { startMs: leg.startMs, endMs: leg.endMs ?? null };
    }
  }

  return null;
}

/** Strips the quotation marks a stored line may already carry. */
function unquote(line: string): string {
  return line.replace(/^["\u201c\s]+|["\u201d\s]+$/g, '');
}

/** The episode's own words at a call, and where in the episode they were said. */
export type MomentCaption = {
  text: string;
  startMs: number;
  endMs: number | null;
};

/**
 * The captions a holding from a timestamped video shows in place of its written
 * line — what was actually said, at the point it was said.
 *
 * Leads with `thesis.quote` so the same call reads identically here and in the
 * episode row (`callCaption`); the other verbatim fields are fallbacks, so a
 * moment carrying only a headline quote still shows words. Returned unquoted —
 * the card draws its own quotation marks.
 *
 * Null unless the source is a video AND the call is timestamped: a text- or
 * X-sourced sandwich has no captions to quote, and an untimestamped one has no
 * moment to anchor them to. Callers fall back to the written line there.
 */
export function momentCaption(sandwich: Sandwich | null | undefined): MomentCaption | null {
  if (!sandwich || sandwich.source.sourceType !== 'youtube') return null;
  const window = getMomentWindow(sandwich);
  if (!window) return null;
  const spoken =
    sandwich.thesis?.quote?.trim() ||
    sandwich.thesis?.headlineQuote?.trim() ||
    sandwich.thesis?.quotes?.[0]?.trim() ||
    null;
  if (!spoken) return null;
  const text = unquote(spoken);
  return text ? { text, startMs: window.startMs, endMs: window.endMs } : null;
}

/**
 * What a trade receipt quotes: the episode's own words at the moment the call
 * was made.
 *
 * The verbatim line comes FIRST, and that ordering is the point. The line
 * renders beside the channel mark, which frames it as something that was said —
 * a generated summary in that slot reads as a transcript without being one. The
 * written take is only the fallback for a sandwich with no verbatim line to show
 * (text- and X-sourced ones, which never reach this surface anyway).
 *
 * Returned unquoted: the receipt renders every line in quotation marks, so
 * punctuating here too would double them up.
 */
export function momentReceiptLine(sandwich: Sandwich | null): string | null {
  if (!sandwich) return null;
  const spoken =
    sandwich.thesis?.headlineQuote?.trim() ||
    sandwich.thesis?.quote?.trim() ||
    sandwich.thesis?.quotes?.[0]?.trim() ||
    null;
  if (spoken) return unquote(spoken);
  return (
    sandwich.commentary?.trim() ||
    sandwich.thesis?.summary?.trim() ||
    sandwich.summary?.trim() ||
    null
  );
}
