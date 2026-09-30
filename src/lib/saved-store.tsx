import { usePrivy } from '@privy-io/expo';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  appUserPayloadFromPrivyUser,
  getSavedItems,
  saveItem,
  type SavedItemType,
  unsaveItem,
} from '@/lib/api';

/**
 * App-level source of truth for the user's bookmarks (sandwiches + assets).
 *
 * Why a store instead of per-screen state: the bookmark lives in three places —
 * the sandwich feed card, the asset detail sheet, and the dedicated Saved
 * screen. Loading it independently in each meant three `/api/saved` round-trips
 * per session and three sets that could drift out of sync (save in the sheet,
 * the feed card stayed hollow). Hoisting it here means:
 *   - one fetch per session, hydrated once the Privy user is known;
 *   - an optimistic toggle that every consumer sees instantly;
 *   - the Saved screen renders straight from the same ordered ids.
 *
 * Ordering: `getSavedItems` returns newest-first, and we prepend on save, so the
 * `*Order` arrays stay newest-first for the Saved screen. The `*Ids` sets back
 * the O(1) `isSaved` lookups the cards need on every render.
 */
type SavedStoreValue = {
  /** True once the initial load has settled (or we know there's no user). */
  hydrated: boolean;
  /** Membership sets for fast `isSaved` checks. */
  savedSandwichIds: Set<string>;
  savedStockIds: Set<string>;
  /** Newest-first id order, for rendering the Saved screen. */
  savedSandwichOrder: string[];
  savedStockOrder: string[];
  /** Whether saving is possible (a signed-in user exists). */
  canSave: boolean;
  isSaved: (type: SavedItemType, id: string) => boolean;
  /**
   * Optimistically toggles a bookmark and reconciles with the server. Resolves
   * to the new saved state. No-ops (returns false) when signed out.
   */
  toggleSave: (type: SavedItemType, id: string) => Promise<boolean>;
  /** Re-fetches both lists from the server. */
  refresh: () => Promise<void>;
};

const SavedStoreContext = createContext<SavedStoreValue | null>(null);

export function SavedStoreProvider({ children }: { children: React.ReactNode }) {
  const { user } = usePrivy();
  const appUser = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);
  const canSave = !!appUser;

  const [savedSandwichOrder, setSavedSandwichOrder] = useState<string[]>([]);
  const [savedStockOrder, setSavedStockOrder] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const savedSandwichIds = useMemo(() => new Set(savedSandwichOrder), [savedSandwichOrder]);
  const savedStockIds = useMemo(() => new Set(savedStockOrder), [savedStockOrder]);

  const setOrder = useCallback(
    (type: SavedItemType, updater: (prev: string[]) => string[]) => {
      if (type === 'sandwich') setSavedSandwichOrder(updater);
      else setSavedStockOrder(updater);
    },
    [],
  );

  const load = useCallback(async () => {
    if (!appUser) {
      setSavedSandwichOrder([]);
      setSavedStockOrder([]);
      setHydrated(true);
      return;
    }
    try {
      // One call returns both types newest-first; split into the two ordered
      // lists. The endpoint 401s for anonymous users, which we treat as empty.
      const items = await getSavedItems();
      setSavedSandwichOrder(items.filter((i) => i.itemType === 'sandwich').map((i) => i.itemId));
      setSavedStockOrder(items.filter((i) => i.itemType === 'stock').map((i) => i.itemId));
    } catch {
      // Leave whatever we had; a transient failure shouldn't wipe the UI.
    } finally {
      setHydrated(true);
    }
  }, [appUser]);

  // Hydrate once the user is known; clear on sign-out.
  useEffect(() => {
    setHydrated(false);
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const isSaved = useCallback(
    (type: SavedItemType, id: string) =>
      type === 'sandwich' ? savedSandwichIds.has(id) : savedStockIds.has(id),
    [savedSandwichIds, savedStockIds],
  );

  // Serialize writes per id so a fast double-tap can't race save against unsave.
  const pendingRef = useRef<Set<string>>(new Set());

  const toggleSave = useCallback(
    async (type: SavedItemType, id: string): Promise<boolean> => {
      if (!appUser) return false;
      const key = `${type}:${id}`;
      if (pendingRef.current.has(key)) {
        return isSaved(type, id);
      }
      pendingRef.current.add(key);

      const wasSaved = isSaved(type, id);
      // Optimistically flip: prepend on save (newest-first), drop on unsave.
      setOrder(type, (prev) =>
        wasSaved ? prev.filter((x) => x !== id) : [id, ...prev.filter((x) => x !== id)],
      );

      try {
        if (wasSaved) await unsaveItem(type, id);
        else await saveItem(type, id);
        return !wasSaved;
      } catch {
        // Roll back to the pre-toggle order.
        setOrder(type, (prev) =>
          wasSaved ? [id, ...prev.filter((x) => x !== id)] : prev.filter((x) => x !== id),
        );
        return wasSaved;
      } finally {
        pendingRef.current.delete(key);
      }
    },
    [appUser, isSaved, setOrder],
  );

  const value = useMemo<SavedStoreValue>(
    () => ({
      hydrated,
      savedSandwichIds,
      savedStockIds,
      savedSandwichOrder,
      savedStockOrder,
      canSave,
      isSaved,
      toggleSave,
      refresh: load,
    }),
    [
      hydrated,
      savedSandwichIds,
      savedStockIds,
      savedSandwichOrder,
      savedStockOrder,
      canSave,
      isSaved,
      toggleSave,
      load,
    ],
  );

  return <SavedStoreContext.Provider value={value}>{children}</SavedStoreContext.Provider>;
}

export function useSavedStore(): SavedStoreValue {
  const ctx = useContext(SavedStoreContext);
  if (!ctx) {
    throw new Error('useSavedStore must be used within a SavedStoreProvider');
  }
  return ctx;
}

/**
 * The store when it is reachable, `null` when it is not.
 *
 * gorhom portals a sheet's content above every provider in `app/(app)/_layout`,
 * so a card rendered inside one reads no store at all — and the throwing hook
 * turns that into a red screen. Components that can be portalled read through
 * this and take their save controls from props instead; see [[bottom-sheet-context-loss]].
 */
export function useOptionalSavedStore(): SavedStoreValue | null {
  return useContext(SavedStoreContext);
}
