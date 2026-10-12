import { File, Paths } from "expo-file-system";

import { normalizePosts, type SandwichPost } from "@/lib/api";

/**
 * Feeds kept on disk so a cold launch paints the last good cards instantly.
 *
 * The in-memory list cache in lib/api dies with the process, so every launch
 * opened Home and Explore on skeletons for as long as the network took. Each
 * feed keeps its last good answer in the cache directory (SecureStore's ~2KB
 * values cannot hold one) and shows it at once, then swaps in the fresh copy.
 *
 * Rows are stored RAW, as the server sent them, and normalized on read —
 * `normalizePost` absorbs client-side shape changes, so only a change to the
 * envelope itself needs `VERSION` bumped.
 */
const VERSION = 1;

export type DiskFeed = { posts: SandwichPost[]; savedAt: number };

function cacheFile(name: string) {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 96);
  return new File(Paths.cache, `feed-${safe}.json`);
}

/** The last copy of this feed the device saved, however old; null if none. */
export async function readFeedFromDisk(name: string): Promise<DiskFeed | null> {
  try {
    const file = cacheFile(name);
    if (!file.exists) return null;
    const stored: unknown = JSON.parse(await file.text());
    if (typeof stored !== "object" || stored === null) return null;
    const { v, rows, savedAt } = stored as { v?: unknown; rows?: unknown; savedAt?: unknown };
    if (v !== VERSION || !Array.isArray(rows)) return null;
    const posts = normalizePosts(rows);
    if (posts.length === 0) return null;
    return { posts, savedAt: typeof savedAt === "number" ? savedAt : 0 };
  } catch {
    return null;
  }
}

/**
 * Persist raw rows for this feed. An empty answer is never written: it would
 * open the next launch on a blank feed instead of the last good one.
 */
export function writeFeedToDisk(name: string, rows: unknown[]): void {
  if (rows.length === 0) return;
  // Off the current frame — the caller is usually about to render these rows.
  setTimeout(() => {
    try {
      cacheFile(name).write(JSON.stringify({ v: VERSION, savedAt: Date.now(), rows }));
    } catch {
      // An unwritable cache only costs the next launch its head start.
    }
  }, 0);
}
