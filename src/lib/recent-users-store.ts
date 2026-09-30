import * as SecureStore from "expo-secure-store";

import { getUsersByIds, type SocialUser } from "@/lib/api";

/**
 * Recently opened people, for the search screen's Recents carousel.
 *
 * Only Privy IDS are persisted. Two reasons, and the second is the one that
 * matters:
 *
 *   • A snapshot goes stale. A follower count and — worse — a follow state both
 *     change while a row sits in local storage, so a cached card would offer
 *     "Follow" for somebody the user already follows.
 *   • SecureStore is the only persistence this app has, and it warns above
 *     ~2KB per value on Android. Ids are ~45 bytes each; a row with an avatar
 *     URL and a display name is five times that, which puts a full list of
 *     snapshots inside the danger zone for no benefit.
 *
 * So the device owns the ORDER (a recency order the database cannot reproduce)
 * and the server owns the bodies, fetched in one request by `getUsersByIds`.
 *
 * A module singleton rather than a React context: the carousel is one screen,
 * but rows are recorded from the People results, the profile overlay and the
 * asset sheet's holders list, and those must not each hold a divergent copy.
 */

const STORAGE_KEY = "bread.recentUsers.v1";

/** Enough to fill a carousel a few swipes deep; beyond that it is not "recent". */
const MAX_RECENT_USERS = 12;

let ids: string[] = [];
let hydrated = false;
let hydrating: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

async function persist(): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // A recents list is a convenience. Losing it is not worth surfacing, and
    // definitely not worth failing the tap that caused the write.
  }
}

/** Reads the stored order once per app session. Safe to call from anywhere. */
export function hydrateRecentUsers(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;

  hydrating = SecureStore.getItemAsync(STORAGE_KEY)
    .then((raw) => {
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          ids = parsed
            .filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            )
            .slice(0, MAX_RECENT_USERS);
        }
      }
    })
    .catch(() => {
      // Corrupt or unreadable storage starts the list empty rather than
      // wedging the screen that reads it.
    })
    .then(() => {
      hydrated = true;
      hydrating = null;
      emit();
    });

  return hydrating;
}

export function getRecentUserIds(): string[] {
  return ids;
}

export function isRecentUsersHydrated(): boolean {
  return hydrated;
}

/**
 * Moves a person to the front of the list.
 *
 * Re-opening someone already in the list re-orders rather than duplicates —
 * "recent" is a set with an order, not a log.
 */
export function recordRecentUser(privyUserId: string | null | undefined): void {
  if (!privyUserId) return;
  const next = [privyUserId, ...ids.filter((id) => id !== privyUserId)].slice(
    0,
    MAX_RECENT_USERS,
  );
  if (next.length === ids.length && next.every((id, i) => id === ids[i]))
    return;
  ids = next;
  emit();
  void persist();
}

export function removeRecentUser(privyUserId: string): void {
  if (!ids.includes(privyUserId)) return;
  ids = ids.filter((id) => id !== privyUserId);
  emit();
  void persist();
}

export function clearRecentUsers(): void {
  if (ids.length === 0) return;
  ids = [];
  emit();
  void persist();
}

export function subscribeToRecentUsers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hydrated rows for the current id order, dropping anyone who no longer resolves. */
export async function loadRecentUsers(
  viewerPrivyUserId: string | null | undefined,
): Promise<SocialUser[]> {
  await hydrateRecentUsers();
  if (ids.length === 0) return [];
  return getUsersByIds(ids, viewerPrivyUserId ?? null);
}
