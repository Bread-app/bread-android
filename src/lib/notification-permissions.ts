import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  registerExpoPushToken,
  unregisterExpoPushToken,
} from "@/lib/api";

let permissionRequest: Promise<boolean> | null = null;
let lastRegisteredToken: string | null = null;

/**
 * Fill notifications for the user's own orders, which are never surfaced.
 *
 * Buying, selling, longing and shorting are silent: the trade screen already
 * shows the outcome as it lands, so a banner on top of the receipt is the same
 * news twice.
 *
 * The server no longer sends any of these at all — a basket run is silent
 * whatever its outcome. This set is kept as the belt to that braces: a shipped
 * client still talking to an older backend must not start showing receipts
 * again, and it costs one lookup per foreground push.
 *
 * This covers pushes that arrive while the app is open. One that arrives while
 * the app is backgrounded is drawn by the OS before this handler runs, so
 * silencing that half has to happen where the push is sent.
 */
const SILENCED_NOTIFICATION_TYPES = new Set([
  "buy_executed",
  "buy_partial",
  "buy_failed",
  "sell_executed",
]);

function isSilenced(notification: Notifications.Notification): boolean {
  const data = notification.request.content.data as { type?: unknown } | undefined;
  return typeof data?.type === "string" && SILENCED_NOTIFICATION_TYPES.has(data.type);
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const silenced = isSilenced(notification);
    return {
      shouldShowBanner: !silenced,
      shouldShowList: !silenced,
      shouldPlaySound: !silenced,
      // The server sends the recipient's unread count with every push, so the
      // springboard badge tracks the inbox instead of drifting from it. A
      // silenced fill still lands in the inbox, so it still counts here.
      shouldSetBadge: true,
    };
  },
});

/**
 * Shows the native Allow / Don't allow prompt while the OS still permits
 * asking (`canAskAgain`). Once the OS says the prompt is spent, a denial is
 * respected and never triggers another system prompt.
 */
export async function requestNotificationPermissionIfNeeded(): Promise<boolean> {
  if (permissionRequest) return permissionRequest;

  permissionRequest = (async () => {
    try {
      const current = await Notifications.getPermissionsAsync();
      if (current.status === "granted") return true;
      // `canAskAgain`, not `status === "undetermined"`: Android reports a first
      // "Don't allow" as denied but still lets the app ask once more, and the
      // OS — not us — decides when the prompt is spent.
      if (!current.canAskAgain) return false;

      await ensureAndroidChannels().catch(() => {});
      const requested = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      return requested.status === "granted";
    } catch {
      return false;
    } finally {
      permissionRequest = null;
    }
  })();

  return permissionRequest;
}

function expoProjectId(): string | null {
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
      ?.projectId ??
    null
  );
}

/**
 * One Android channel per preference category, so the OS-level toggles the
 * user sees in system settings line up with the ones in the app instead of
 * being a single all-or-nothing switch.
 *
 * Created BEFORE asking for permission: on Android 13+ the system notification
 * prompt can fail to appear while the app has no channel at all. Creating a
 * channel needs no permission, so this is safe to run first.
 */
async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Promise.all([
    Notifications.setNotificationChannelAsync("bread-money", {
      name: "Trades & cash",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    }),
    Notifications.setNotificationChannelAsync("bread-social", {
      name: "Follows, likes & comments",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    }),
    Notifications.setNotificationChannelAsync("bread-market", {
      name: "Market moves",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    }),
    Notifications.setNotificationChannelAsync("bread-product", {
      name: "Tips & updates",
      importance: Notifications.AndroidImportance.LOW,
      sound: "default",
    }),
  ]);
}

export async function registerForPushNotificationsIfNeeded(): Promise<boolean> {
  if (!Device.isDevice) return false;
  const granted = await requestNotificationPermissionIfNeeded();
  if (!granted) return false;
  await ensureAndroidChannels().catch(() => {});

  const projectId = expoProjectId();
  if (!projectId) return false;

  try {
    const token = (
      await Notifications.getExpoPushTokenAsync({ projectId })
    ).data;
    await registerExpoPushToken(token, Platform.OS);
    lastRegisteredToken = token;
    return true;
  } catch {
    return false;
  }
}

export async function unregisterCurrentPushToken(): Promise<void> {
  const token = lastRegisteredToken;
  if (!token) return;
  await unregisterExpoPushToken(token).catch(() => {});
  lastRegisteredToken = null;
}
