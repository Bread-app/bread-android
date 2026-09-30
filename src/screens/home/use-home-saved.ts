import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getSandwichById, setCardLike, type Sandwich } from "@/lib/api";
import { cardSocial, toggledCardSocial, withCardSocial } from "@/lib/card-social";
import { useSandwichDetail } from "@/lib/sandwich-detail-store";
import { useSavedStore } from "@/lib/saved-store";
import { getAnonymousSocialId } from "@/lib/social-identity";
import { useToast } from "@/lib/toast-store";

export type HomeSaved = {
  /** Bookmarked sandwiches, newest-first, resolved to card data. */
  sandwiches: Sandwich[];
  /** True while the store hydrates or there are ids not yet resolved. */
  loading: boolean;
  /** How many the user has bookmarked, resolved or not. */
  count: number;
  open: (sandwich: Sandwich) => void;
  openComments: (sandwich: Sandwich) => void;
  toggleLike: (sandwich: Sandwich) => void;
  refresh: () => Promise<void>;
};

/**
 * The bookmarked sandwiches Home shows behind its "saved" filter. The store
 * only holds ids, so this resolves each to a card the same way the Saved
 * screen does, and carries the same optimistic like handling as the feed.
 */
export function useHomeSaved(privyUserId: string | null): HomeSaved {
  const sandwichDetail = useSandwichDetail();
  const appToast = useToast();
  const { savedSandwichOrder, hydrated, refresh: refreshStore } = useSavedStore();

  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const [details, setDetails] = useState<Map<string, Sandwich>>(() => new Map());
  const [tried, setTried] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    setAnonymousId(null);
    void getAnonymousSocialId(privyUserId).then((value) => {
      if (active) setAnonymousId(value);
    });
    return () => {
      active = false;
    };
  }, [privyUserId]);

  // Fetch any saved ids we don't have card data for yet.
  useEffect(() => {
    if (!anonymousId) return;
    const missing = savedSandwichOrder.filter((id) => !tried.has(id));
    if (missing.length === 0) return;
    setTried((prev) => new Set([...prev, ...missing]));
    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        const sandwich = await getSandwichById(id, anonymousId).catch(() => null);
        return [id, sandwich] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      setDetails((prev) => {
        const next = new Map(prev);
        for (const [id, sandwich] of results) {
          if (sandwich) next.set(id, sandwich);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // `tried` is deliberately not a dep: this effect writes it, and re-running
    // on that write would cancel the in-flight fetch before it lands. See the
    // same note on the Saved screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSandwichOrder, anonymousId]);

  const sandwiches = useMemo(
    () =>
      savedSandwichOrder
        .map((id) => details.get(id))
        .filter((s): s is Sandwich => !!s),
    [savedSandwichOrder, details],
  );

  const pending = savedSandwichOrder.some((id) => !tried.has(id));
  const loading = !hydrated || (sandwiches.length === 0 && pending);

  const applyUpdated = useCallback((updated: Sandwich) => {
    setDetails((prev) => {
      const next = new Map(prev);
      next.set(updated.id, updated);
      return next;
    });
  }, []);

  const open = useCallback((sandwich: Sandwich) => {
    void Haptics.selectionAsync();
    sandwichDetail.open(sandwich, { onUpdated: applyUpdated });
  }, [applyUpdated, sandwichDetail]);

  const openComments = useCallback((sandwich: Sandwich) => {
    void Haptics.selectionAsync();
    sandwichDetail.open(sandwich, { onUpdated: applyUpdated, showComments: true });
  }, [applyUpdated, sandwichDetail]);

  const toggleLike = useCallback((sandwich: Sandwich) => {
    if (!anonymousId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const before = cardSocial([sandwich]);
    const optimistic = toggledCardSocial(before);
    applyUpdated(withCardSocial(sandwich, optimistic));

    void (async () => {
      try {
        const result = await setCardLike(sandwich, optimistic.viewerHasLiked, anonymousId);
        applyUpdated(withCardSocial(sandwich, result));
      } catch {
        applyUpdated(withCardSocial(sandwich, before));
        appToast.showToast("Couldn't update that like", "error");
      }
    })();
  }, [anonymousId, appToast, applyUpdated]);

  const refresh = useCallback(async () => {
    // Allow re-fetching details for everything currently saved.
    setTried(new Set());
    await refreshStore();
  }, [refreshStore]);

  return {
    sandwiches,
    loading,
    count: savedSandwichOrder.length,
    open,
    openComments,
    toggleLike,
    refresh,
  };
}
