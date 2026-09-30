import { isDemoMode } from './demo/demo-config';
import { YoutubeTranscript } from 'youtube-transcript';

/**
 * Captions fetched ON DEVICE and posted to the backend with the source.
 *
 * Why the app does this at all: YouTube serves captions to a residential IP
 * (a phone) but routinely refuses a datacenter one, so the deployed backend
 * gets nothing and the whole episode degrades to a single title-derived card.
 * The phone's request succeeds, so the app fetches the transcript and hands it
 * over. The library is pure fetch + regex — no Node builtins — so it runs in
 * React Native unchanged, and it tries YouTube's InnerTube (Android client)
 * endpoint before falling back to scraping the watch page.
 */

/** Wire shape the backend's `parseClientTranscript` accepts verbatim. */
export type CaptionSegment = { text: string; offset: number; duration: number };

// Enough for a ~4h episode; guards against building an enormous request body.
const MAX_SEGMENTS = 20_000;

/**
 * Captions for a video, or null when there are none / the fetch fails.
 * Never throws: a caption miss must not stop the user from posting — the
 * backend still tries its own fetch and reports honestly if neither worked.
 */
export async function fetchCaptions(videoId: string): Promise<CaptionSegment[] | null> {
  // Demo mode scripts the analysis, so there is nothing for captions to feed.
  // Skipping the fetch also keeps a shoot working on a bad hotel connection —
  // this is the one call in the flow that goes somewhere other than our API.
  if (isDemoMode()) return null;
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId);
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const segments = raw.slice(0, MAX_SEGMENTS).flatMap((row): CaptionSegment[] => {
      const text = typeof row?.text === 'string' ? row.text : '';
      const offset = Number(row?.offset);
      if (!text.trim() || !Number.isFinite(offset) || offset < 0) return [];
      const duration = Number(row?.duration);
      return [{ text, offset, duration: Number.isFinite(duration) && duration >= 0 ? duration : 0 }];
    });
    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}
