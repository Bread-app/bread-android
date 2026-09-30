import { File, Paths } from "expo-file-system";

import { getTrendingPostsPayload, normalizePosts, type SandwichPost } from "@/lib/api";

/**
 * Home's Trending cards, kept on disk so a cold launch paints instantly.
 *
 * The in-memory list cache dies with the process, so every launch used to open
 * on skeletons for the 3–4s the feed takes. This keeps the last good answer in
 * the cache directory (SecureStore's ~2KB values cannot hold a feed) and Home
 * shows it immediately, then swaps in the fresh one when the network answers.
 *
 * Rows are stored RAW, as the server sent them, and normalized on read —
 * `normalizePost` absorbs client-side shape changes, so only a change to the
 * envelope itself needs `VERSION` bumped.
 */
const VERSION = 1;

function cacheFile(anonymousId: string) {
  // Viewer-scoped: rows carry viewerHasLiked, and one shared file would flash
  // the previous account's hearts after a switch.
  const safe = anonymousId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return new File(Paths.cache, `home-trending-${safe}.json`);
}

/** The last Trending cards this device received, however old; null if none. */
export async function readTrendingFromDisk(anonymousId: string): Promise<SandwichPost[] | null> {
  try {
    const file = cacheFile(anonymousId);
    if (!file.exists) return null;
    const stored: unknown = JSON.parse(await file.text());
    if (
      typeof stored !== "object" ||
      stored === null ||
      (stored as { v?: unknown }).v !== VERSION ||
      !Array.isArray((stored as { rows?: unknown }).rows)
    ) {
      return null;
    }
    const posts = normalizePosts((stored as { rows: unknown[] }).rows);
    return posts.length > 0 ? posts : null;
  } catch {
    return null;
  }
}

/** Fetch fresh Trending cards and, when there are any, persist them. */
export async function fetchTrending(anonymousId: string): Promise<SandwichPost[]> {
  const { posts, rows } = await getTrendingPostsPayload(anonymousId);
  // Never persist an empty answer: it would open the next launch on a blank
  // section instead of the last good one.
  if (posts.length > 0) {
    try {
      cacheFile(anonymousId).write(JSON.stringify({ v: VERSION, savedAt: Date.now(), rows }));
    } catch {
      // An unwritable cache only costs the next launch its head start.
    }
  }
  return posts;
}
