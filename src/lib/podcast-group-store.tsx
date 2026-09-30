import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { Sandwich } from '@/lib/api';
import type { PodcastGroupVideo } from '@/components/podcast-sandwich-group-card';

/**
 * The episode currently open on the full-screen podcast route.
 *
 * Held in memory rather than refetched by id: the feed already has every market
 * of the episode loaded, and handing them over keeps the push instant. Mirrors
 * `sandwich-detail-store`, which does the same for a single Sandwich.
 */
export type PodcastGroup = { video: PodcastGroupVideo; sandwiches: Sandwich[] };

type PodcastGroupContextValue = {
  group: PodcastGroup | null;
  /** Push the full-screen episode view for these markets. */
  open: (group: PodcastGroup) => void;
  close: () => void;
  /**
   * Install a group WITHOUT navigating — how the episode screen puts itself
   * back after refetching by `sourceId` when it was entered cold.
   */
  hydrate: (group: PodcastGroup) => void;
  /** Keep a row in sync after the detail screen changes one of its markets. */
  applyUpdate: (updated: Sandwich) => void;
};

const PodcastGroupContext = createContext<PodcastGroupContextValue | null>(null);

export function PodcastGroupProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [group, setGroup] = useState<PodcastGroup | null>(null);

  const open = useCallback(
    (next: PodcastGroup) => {
      setGroup(next);
      // `sourceId` rides along as a recovery key only — the group above stays
      // the fast path. Every market of an episode shares a sourceId, so this is
      // enough to rebuild the whole screen when it is entered cold.
      router.push({
        pathname: '/podcast-sandwich',
        params: { sourceId: next.sandwiches[0]?.sourceId ?? '' },
      });
    },
    [router],
  );

  const close = useCallback(() => {
    router.back();
  }, [router]);

  const hydrate = useCallback((next: PodcastGroup) => {
    setGroup(next);
  }, []);

  const applyUpdate = useCallback((updated: Sandwich) => {
    setGroup((current) =>
      current
        ? {
            ...current,
            sandwiches: current.sandwiches.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          }
        : current,
    );
  }, []);

  const value = useMemo(
    () => ({ group, open, close, hydrate, applyUpdate }),
    [group, open, close, hydrate, applyUpdate],
  );

  return <PodcastGroupContext.Provider value={value}>{children}</PodcastGroupContext.Provider>;
}

export function usePodcastGroup(): PodcastGroupContextValue {
  const value = useContext(PodcastGroupContext);
  if (!value) {
    throw new Error('usePodcastGroup must be used within a PodcastGroupProvider');
  }
  return value;
}
