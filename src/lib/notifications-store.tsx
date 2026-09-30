import { usePrivy } from '@privy-io/expo';
import * as Notifications from 'expo-notifications';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  getNotifications,
  markNotificationsRead as markReadRequest,
  type AppNotification,
  type NotificationCategory,
} from '@/lib/api';

/**
 * App-wide source of truth for the notification inbox.
 *
 * The unread count drives the profile-menu badge and the OS app-icon badge, and
 * both must agree with the list the inbox screen renders — so the count is never
 * derived locally from the loaded page (which is only the first 30 rows). It is
 * whatever the server last said, refreshed on:
 *
 *   • sign-in,
 *   • every foreground (the common case: a push arrived while backgrounded),
 *   • a push received while the app is open,
 *   • a poll, as the backstop for events with no push (a muted category, quiet
 *     hours, or permission never granted).
 *
 * Marking read is optimistic in both directions so a tap feels instant, then
 * reconciled with the count the server returns.
 */

const POLL_INTERVAL_MS = 60_000;

type NotificationsStoreValue = {
  /** True once the first load has settled (or we know there is no user). */
  hydrated: boolean;
  unreadCount: number;
  notifications: AppNotification[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Reloads the first page for the active filter. */
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  category: NotificationCategory | null;
  setCategory: (category: NotificationCategory | null) => void;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Clears the badge without marking anything read — called when the inbox opens. */
  markSeen: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsStoreValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = usePrivy();
  const privyUserId = user?.id ?? null;

  const [hydrated, setHydrated] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [category, setCategoryState] = useState<NotificationCategory | null>(null);

  // Guards against a slow response from a previous user or a previous filter
  // landing after the user has moved on and overwriting the current list.
  const requestRef = useRef(0);

  const applyBadge = useCallback((count: number) => {
    setUnreadCount(count);
    void Notifications.setBadgeCountAsync(count).catch(() => {});
  }, []);

  const load = useCallback(
    async (nextCategory: NotificationCategory | null) => {
      if (!privyUserId) {
        setNotifications([]);
        applyBadge(0);
        setHydrated(true);
        return;
      }
      const requestId = ++requestRef.current;
      setLoading(true);
      try {
        const page = await getNotifications({ category: nextCategory });
        if (requestRef.current !== requestId) return;
        setNotifications(page.notifications);
        setCursor(page.nextCursor);
        applyBadge(page.unreadCount);
      } catch {
        // Leave the last good list in place: an empty inbox and a failed fetch
        // look identical to the user, and only one of them is true.
      } finally {
        if (requestRef.current === requestId) {
          setLoading(false);
          setHydrated(true);
        }
      }
    },
    [applyBadge, privyUserId],
  );

  const refresh = useCallback(() => load(category), [category, load]);

  const setCategory = useCallback(
    (next: NotificationCategory | null) => {
      setCategoryState(next);
      setNotifications([]);
      setCursor(null);
      void load(next);
    },
    [load],
  );

  const loadMore = useCallback(async () => {
    if (!privyUserId || !cursor || loadingMore) return;
    const requestId = requestRef.current;
    setLoadingMore(true);
    try {
      const page = await getNotifications({ cursor, category });
      if (requestRef.current !== requestId) return;
      setNotifications((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...page.notifications.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
      applyBadge(page.unreadCount);
    } catch {
      // Keep the current page; the user can pull to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [applyBadge, category, cursor, loadingMore, privyUserId]);

  const markRead = useCallback(
    async (ids: string[]) => {
      const unreadIds = ids.filter((id) => notifications.find((row) => row.id === id && !row.read));
      if (unreadIds.length === 0) return;
      setNotifications((current) =>
        current.map((row) => (unreadIds.includes(row.id) ? { ...row, read: true } : row)),
      );
      applyBadge(Math.max(0, unreadCount - unreadIds.length));
      try {
        const result = await markReadRequest({ ids: unreadIds });
        applyBadge(result.unreadCount);
      } catch {
        // The optimistic state stands; the next refresh reconciles it.
      }
    },
    [applyBadge, notifications, unreadCount],
  );

  const markAllRead = useCallback(async () => {
    setNotifications((current) => current.map((row) => ({ ...row, read: true })));
    applyBadge(0);
    try {
      const result = await markReadRequest({ all: true });
      applyBadge(result.unreadCount);
    } catch {
      // Same as above — reconciled on the next load.
    }
  }, [applyBadge]);

  const markSeen = useCallback(async () => {
    try {
      await markReadRequest();
    } catch {
      // Best-effort: seen state only affects the badge, never content.
    }
  }, []);

  // Initial load, and a full reset whenever Privy swaps users — one account must
  // never briefly show another's inbox.
  useEffect(() => {
    setHydrated(false);
    setNotifications([]);
    setCursor(null);
    setCategoryState(null);
    void load(null);
  }, [load, privyUserId]);

  // A push that lands while the app is open never reaches the tap handler, so
  // the inbox would otherwise sit stale behind the banner.
  useEffect(() => {
    if (!privyUserId) return;
    const subscription = Notifications.addNotificationReceivedListener(() => {
      void refresh();
    });
    return () => subscription.remove();
  }, [privyUserId, refresh]);

  useEffect(() => {
    if (!privyUserId) return;
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') void refresh();
    };
    const subscription = AppState.addEventListener('change', onChange);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [privyUserId, refresh]);

  const value = useMemo<NotificationsStoreValue>(
    () => ({
      hydrated,
      unreadCount,
      notifications,
      loading,
      loadingMore,
      hasMore: cursor !== null,
      refresh,
      loadMore,
      category,
      setCategory,
      markRead,
      markAllRead,
      markSeen,
    }),
    [
      category,
      cursor,
      hydrated,
      loadMore,
      loading,
      loadingMore,
      markAllRead,
      markRead,
      markSeen,
      notifications,
      refresh,
      setCategory,
      unreadCount,
    ],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsStoreValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error('useNotifications must be used inside <NotificationsProvider>');
  }
  return value;
}

/**
 * Badge-only reader for consumers that may render outside the provider (the
 * gorhom bottom sheets portal their children above it — see the note in
 * `sandwich-detail-store`). Returns 0 rather than throwing.
 */
export function useUnreadNotificationCount(): number {
  return useContext(NotificationsContext)?.unreadCount ?? 0;
}
