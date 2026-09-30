import { usePrivy } from "@privy-io/expo";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { markNotificationsRead } from "@/lib/api";
import { useComposerProgress } from "@/lib/composer-progress-store";
import { registerPushTokenIfPermitted } from "@/lib/notification-permissions";

/**
 * Registers the signed-in device for push and routes taps to the right screen.
 *
 * Registration is attempted for every signed-in user, not just Like-to-Buy
 * users: notifications now cover follows, comments, fills and deposits. It is a
 * no-op unless the OS has already granted permission — the system prompt is
 * asked from moments that earn it (opening the inbox, the notification settings
 * screen, enabling Like-to-Buy), never on launch.
 */
export function usePushNotifications(): void {
  const { user } = usePrivy();
  const router = useRouter();
  const { clearJobForSource } = useComposerProgress();
  // `getLastNotificationResponseAsync` keeps returning the same response for the
  // life of the process, so re-running this effect (a Privy user swap, a
  // remount) would re-navigate to a notification the user already dealt with.
  // Keyed by request identifier, per process.
  const handledResponses = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    void registerPushTokenIfPermitted();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const go = (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      if (identifier) {
        if (handledResponses.current.has(identifier)) return;
        handledResponses.current.add(identifier);
      }
      const data = response.notification.request.content.data as
        | { route?: unknown; params?: unknown; notificationId?: unknown }
        | undefined;
      if (typeof data?.notificationId === "string") void markNotificationsRead({ ids: [data.notificationId] }).catch(() => {});
      const route = typeof data?.route === "string" ? data.route : "/notifications";
      const rawParams = (data?.params ?? {}) as Record<string, unknown>;
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawParams)) {
        if (typeof value === "string") params[key] = value;
      }
      try {
        router.push({ pathname: route as never, params });
      } catch {
        // A payload written by a newer server than this build is still useful:
        // fall back to the inbox rather than swallowing the tap.
        router.push("/notifications");
      }

      // Opening the episode ends the wait for it. Without this the stored job
      // outlives its own result: the banner would keep reporting "listening to
      // the podcast" over the episode the user is now reading, and the next
      // launch would resume a waiter for work that finished hours ago.
      if (params.sourceId) {
        clearJobForSource(params.sourceId);
      }
    };

    // Cold start: the tap that opened the app. The live listener never sees it,
    // because it fired before this component mounted.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) go(response);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(go);
    return () => subscription.remove();
  }, [clearJobForSource, router, user?.id]);
}
