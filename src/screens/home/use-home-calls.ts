import { useCallback, useEffect, useRef, useState } from "react";

import { getPostPage, type SandwichPost } from "@/lib/api";

/** The server caps a page at 50 cards. */
const PAGE_SIZE = 50;
/**
 * Pages Home walks before it stops: enough for every call of the last few
 * weeks without turning one Home open into an unbounded crawl. Raise it, or
 * move the ranking server-side, once the feed outgrows it.
 */
const MAX_PAGES = 8;

export type HomeCalls = {
  /** Every card fetched so far, in feed order; the section ranks them. */
  posts: SandwichPost[];
  /** True until the first page has answered. */
  loading: boolean;
  /** True while later pages are still arriving. */
  loadingMore: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
};

/**
 * The whole feed — podcast moments, X calls, every asset — for Home's ranked
 * list. `/api/posts?rank=trending` hands back only its top six cards, so this
 * walks the plain feed instead: the first page paints, the rest stream in
 * behind it.
 */
export function useHomeCalls(): HomeCalls {
  const [posts, setPosts] = useState<SandwichPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  // Bumped per load, so a refresh abandons the walk it replaces.
  const runRef = useRef(0);

  /**
   * Walks the feed. Resolves once the FIRST page is in, so pull-to-refresh
   * doesn't spin for the whole walk; later pages keep streaming in behind it.
   */
  const load = useCallback(() => new Promise<void>((resolveFirst) => {
    const run = ++runRef.current;
    setFailed(false);
    void (async () => {
      let cursor: string | null = null;
      const collected: SandwichPost[] = [];
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await getPostPage(PAGE_SIZE, cursor);
          if (run !== runRef.current) return;
          collected.push(...result.posts);
          setPosts([...collected]);
          if (page === 0) {
            setLoading(false);
            setLoadingMore(Boolean(result.nextCursor));
            resolveFirst();
          }
          cursor = result.nextCursor;
          if (!cursor) break;
        }
      } catch {
        if (run !== runRef.current) return;
        // A failed later page keeps what already arrived.
        if (collected.length === 0) setFailed(true);
      } finally {
        if (run === runRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
        resolveFirst();
      }
    })();
  }), []);

  useEffect(() => {
    void load();
  }, [load]);

  return { posts, loading, loadingMore, failed, refresh: load };
}
