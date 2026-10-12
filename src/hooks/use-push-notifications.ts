import { usePrivy } from "@privy-io/expo";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { markNotificationsRead } from "@/lib/api";
import { useComposerProgress } from "@/lib/composer-progress-store";
import { registerForPushNotificationsIfNeeded } from "@/lib/notification-permissions";
import { useOnboardingStatus } from "@/lib/onboarding-store";

// Lets the home screen settle after the onboarding → home transition so the
// system dialog doesn't land mid-animation.
const PERMISSION_PROMPT_DELAY_MS = 800;

/**
 * Registers the signed-in device for push and routes taps to the right screen.
 *
 * Registration is attempted for every signed-in user, not just Like-to-Buy
 * users: notifications now cover follows, comments, fills and deposits.
 *
 * The system prompt is asked once the user is signed in AND onboarded — i.e.
 * right after finishing onboarding, or on the first sign-in after a reinstall
 * (deleting the app resets the OS permission to undetermined). It only ever
 * prompts while the status is undetermined, so a previous "Don't Allow" is
 * respected; an already-granted device just re-registers its token.
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
  const { isLoaded: onboardingLoaded, isComplete: onboarded } = useOnboardingStatus(user?.id ?? null);

  useEffect(() => {
    if (!user?.id || !onboardingLoaded || !onboarded) return;
    const timer = setTimeout(() => {
      void registerForPushNotificationsIfNeeded();
    }, PERMISSION_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [user?.id, onboardingLoaded, onboarded]);

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
      if (!response) return;
      // Consumed, not just remembered: Android can keep handing back the same
      // response on later launches, which reopened the inbox on every start.
      Notifications.clearLastNotificationResponse();
      go(response);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(go);
    return () => subscription.remove();
  }, [clearJobForSource, router, user?.id]);
}
