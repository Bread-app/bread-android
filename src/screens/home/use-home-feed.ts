import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";

import { setCardLike, type Sandwich, type SandwichPost } from "@/lib/api";
import { applyCardSocialToPosts, cardSocial, toggledCardSocial } from "@/lib/card-social";
import { useSandwichDetail } from "@/lib/sandwich-detail-store";
import { getAnonymousSocialId } from "@/lib/social-identity";
import { useToast } from "@/lib/toast-store";
import { fetchTrending, readTrendingFromDisk } from "@/lib/trending-disk-cache";

/**
 * The last Trending answer this process saw, so Home remounting (a tab switch,
 * an account round-trip) repaints synchronously instead of re-reading disk.
 */
let lastInMemory: { anonymousId: string; posts: SandwichPost[] } | null = null;

export type HomeFeed = {
  /** The cards Home renders, exactly as the server grouped them. */
  posts: SandwichPost[];
  loading: boolean;
  failed: boolean;
  open: (sandwich: Sandwich) => void;
  openComments: (sandwich: Sandwich) => void;
  toggleLike: (sandwich: Sandwich) => void;
  reload: () => void;
  refresh: () => Promise<void>;
};

/**
 * The slice of the sandwich feed Home shows, plus the like/open interactions
 * that mutate it in place. Likes are optimistic and roll back on failure, so a
 * tap always feels instant even on a slow network.
 */
export function useHomeFeed(privyUserId: string | null): HomeFeed {
  const sandwichDetail = useSandwichDetail();
  const appToast = useToast();
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const [posts, setPosts] = useState<SandwichPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // A different viewer means different like state, so the list is cleared and
  // refetched rather than briefly showing the previous account's feed.
  useEffect(() => {
    let active = true;
    setAnonymousId(null);
    setPosts([]);
    setLoading(true);
    void getAnonymousSocialId(privyUserId).then((value) => {
      if (active) setAnonymousId(value);
    });
    return () => {
      active = false;
    };
  }, [privyUserId]);

  // Set once the network has answered for this viewer, so a slower disk read
  // can never paint over fresher cards.
  const freshRef = useRef<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!anonymousId) return;

    if (!refresh) {
      // Paint first, fetch second: memory, then disk, then the network. Only a
      // viewer with nothing cached anywhere sees skeletons.
      if (lastInMemory?.anonymousId === anonymousId) {
        setPosts(lastInMemory.posts);
        setLoading(false);
      } else {
        void readTrendingFromDisk(anonymousId).then((cached) => {
          if (!cached || freshRef.current === anonymousId) return;
          setPosts((current) => (current.length > 0 ? current : cached));
          setLoading(false);
        });
      }
    }
    setFailed(false);

    try {
      const fresh = await fetchTrending(anonymousId);
      freshRef.current = anonymousId;
      lastInMemory = { anonymousId, posts: fresh };
      setPosts(fresh);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [anonymousId]);

  useEffect(() => {
    if (anonymousId) void load();
  }, [anonymousId, load]);

  const applyUpdated = useCallback((updated: Sandwich) => {
    setPosts((current) =>
      current.map((post) =>
        post.sandwiches.some((sandwich) => sandwich.id === updated.id)
          ? {
              ...post,
              sandwiches: post.sandwiches.map((sandwich) =>
                sandwich.id === updated.id ? updated : sandwich,
              ),
            }
          : post,
      ),
    );
  }, []);

  const open = useCallback((sandwich: Sandwich) => {
    void Haptics.selectionAsync();
    sandwichDetail.open(sandwich, { onUpdated: applyUpdated });
  }, [applyUpdated, sandwichDetail]);

  const openComments = useCallback((sandwich: Sandwich) => {
    void Haptics.selectionAsync();
    sandwichDetail.open(sandwich, { onUpdated: applyUpdated, showComments: true });
  }, [applyUpdated, sandwichDetail]);

  /**
   * Like the CARD this row belongs to, in one request.
   *
   * A card holds its counts on the post AND on every market under it, so both
   * the optimistic write and the server's answer move both — otherwise opening
   * the episode from a market that was not the one tapped shows a stale heart.
   */
  const toggleLike = useCallback((sandwich: Sandwich) => {
    if (!anonymousId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const before = cardSocial([sandwich]);
    const optimistic = toggledCardSocial(before);
    setPosts((current) => applyCardSocialToPosts(current, sandwich, optimistic));

    void (async () => {
      try {
        const result = await setCardLike(sandwich, optimistic.viewerHasLiked, anonymousId);
        setPosts((current) => applyCardSocialToPosts(current, sandwich, result));
      } catch {
        setPosts((current) => applyCardSocialToPosts(current, sandwich, before));
        appToast.showToast("Couldn't update that like", "error");
      }
    })();
  }, [anonymousId, appToast]);

  const refresh = useCallback(() => load(true), [load]);
  const reload = useCallback(() => void load(true), [load]);

  return {
    posts,
    loading,
    failed,
    open,
    openComments,
    toggleLike,
    reload,
    refresh,
  };
}
