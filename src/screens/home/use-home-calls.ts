import { useCallback, useEffect, useRef, useState } from "react";

import { getPostPage, getTopCalls, type SandwichPost } from "@/lib/api";
import { readFeedFromDisk, writeFeedToDisk } from "@/lib/feed-disk-cache";

/**
 * A single feed page Home falls back to when the ranked endpoint is down (or
 * the backend predates it): fewer calls than the full ranking, never none.
 */
const FALLBACK_PAGE_SIZE = 50;
// Not viewer-scoped: the ranking carries no viewer's likes. `v2` because the
// rows changed from whole cards to one card per call.
const DISK_NAME = "home-top-calls-v2";

export type HomeCalls = {
  /** One card per call, best first; the section re-ranks them anyway. */
  posts: SandwichPost[];
  /** True until the first answer — disk or network — is on screen. */
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
};

/**
 * Home's ranked list — every recent call by return, top first.
 *
 * The ranking is the server's (`/api/posts/top-calls`, served from the CDN). It
 * used to be built here by walking the feed: 8 sequential pages of 50 cards,
 * ~5MB, re-sorting the list under the reader's thumb as each page landed. A
 * cold launch paints the last answer from disk, then one request replaces it.
 */
export function useHomeCalls(): HomeCalls {
  const [posts, setPosts] = useState<SandwichPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Bumped per load, so a refresh discards the answer it replaces.
  const runRef = useRef(0);
  // Any cards on screen — a failed refresh keeps them rather than an error.
  const shownRef = useRef(false);

  const load = useCallback(async () => {
    const run = ++runRef.current;
    setFailed(false);
    try {
      const { posts: next, rows } = await getTopCalls().catch(async () => {
        const page = await getPostPage(FALLBACK_PAGE_SIZE);
        return { posts: page.posts, rows: [] as unknown[] };
      });
      if (run !== runRef.current) return;
      if (next.length > 0 || !shownRef.current) {
        shownRef.current = next.length > 0;
        setPosts(next);
      }
      // Only the real ranking is worth a launch's head start.
      writeFeedToDisk(DISK_NAME, rows);
    } catch {
      if (run !== runRef.current) return;
      if (!shownRef.current) setFailed(true);
    } finally {
      if (run === runRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    // A head start only: the request starts at once alongside it, and a fresh
    // answer that lands first is never replaced by the older disk copy.
    void readFeedFromDisk(DISK_NAME).then((disk) => {
      if (!current || !disk || shownRef.current) return;
      shownRef.current = true;
      setPosts(disk.posts);
      setLoading(false);
    });
    void load();
    return () => {
      current = false;
    };
  }, [load]);

  return { posts, loading, failed, refresh: load };
}
