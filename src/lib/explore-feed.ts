import {
  getCachedPosts,
  getFeedPage,
  seedCachedPosts,
  type PostPage,
  type SandwichPost,
} from "@/lib/api";
import { readFeedFromDisk, writeFeedToDisk } from "@/lib/feed-disk-cache";
import { getAnonymousSocialId } from "@/lib/social-identity";

/**
 * The Explore feed's first page, shared between the screen and the prefetch
 * Home starts at launch.
 *
 * Native tabs mount a tab's screen on its first visit, so Explore used to start
 * its request only once tapped. Home now warms this at launch, and the screen
 * reads the same caches — by the time it is opened the page is usually already
 * in memory, and on a cold launch the disk copy paints while it arrives.
 */

/** A page is 20 CARDS, so one request is one screenful. */
export const EXPLORE_PAGE_SIZE = 20;

// Viewer-scoped: rows carry viewerHasLiked, and one shared file would flash the
// previous account's hearts after a switch.
const diskName = (anonymousId: string) => `explore-${anonymousId}`;

const inflight = new Map<string, Promise<PostPage>>();

/**
 * Fetch the first page fresh, persisting it for the next cold launch.
 * Concurrent callers for the same viewer share one request, so the screen
 * opening mid-prefetch waits on that request instead of starting a second.
 */
export function fetchExploreFirstPage(anonymousId: string): Promise<PostPage> {
  const pending = inflight.get(anonymousId);
  if (pending) return pending;
  const request = getFeedPage(EXPLORE_PAGE_SIZE, null, anonymousId)
    .then((page) => {
      writeFeedToDisk(diskName(anonymousId), page.rows);
      return page;
    })
    .finally(() => {
      inflight.delete(anonymousId);
    });
  inflight.set(anonymousId, request);
  return request;
}

/**
 * Whatever first page this device already has for the viewer — the in-memory
 * copy, else the one on disk (which then seeds memory). Null if neither exists.
 */
export async function readExploreFirstPage(anonymousId: string): Promise<SandwichPost[] | null> {
  const memory = getCachedPosts(EXPLORE_PAGE_SIZE, null, anonymousId, { allowStale: true });
  if (memory) return memory;
  const disk = await readFeedFromDisk(diskName(anonymousId));
  if (!disk) return null;
  seedCachedPosts(EXPLORE_PAGE_SIZE, null, anonymousId, disk.posts, disk.savedAt);
  // A network answer may have landed while the file was read; prefer it.
  return getCachedPosts(EXPLORE_PAGE_SIZE, null, anonymousId, { allowStale: true });
}

/** Warm Explore's first page in the background. Never throws. */
export async function prefetchExploreFeed(privyUserId: string | null | undefined): Promise<void> {
  try {
    const anonymousId = await getAnonymousSocialId(privyUserId);
    await readExploreFirstPage(anonymousId);
    await fetchExploreFirstPage(anonymousId);
  } catch {
    // A failed warm-up just leaves Explore to load on its own when opened.
  }
}
