/**
 * Adds Bread's Android notification service: sender avatars and thread
 * grouping on pushes, the Android counterpart of bread-mobile's iOS
 * Notification Service Extension.
 *
 * A config plugin because `android/` is gitignored: EAS runs `expo prebuild`
 * on every build, so a hand edit there is gone on the next one. Everything here
 * re-applies from scratch each prebuild.
 *
 * Two pieces:
 *  - copies plugins/notification-service/BreadNotificationsService.kt into the
 *    app's sources;
 *  - swaps Expo's `NotificationsService` receiver for it in the manifest. Expo
 *    hands every presentation to the first receiver that answers its
 *    NOTIFICATION_EVENT action, so Expo's own has to be removed rather than
 *    left alongside (it would also double-handle BOOT_COMPLETED rescheduling).
 *
 * The backend's half of the contract is `data.senderId` / `senderName` /
 * `avatarUrl` / `threadId` (stock-backend/lib/server/notifications/push.ts).
 */
const fs = require("fs");
const path = require("path");

const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

const SOURCE = path.join(__dirname, "notification-service", "BreadNotificationsService.kt");
const PACKAGE_DIR = path.join("com", "breadapp", "notifications");
const EXPO_RECEIVER = "expo.modules.notifications.service.NotificationsService";
const BREAD_RECEIVER = "com.breadapp.notifications.BreadNotificationsService";

const RECEIVER_ACTIONS = [
  "expo.modules.notifications.NOTIFICATION_EVENT",
  "android.intent.action.BOOT_COMPLETED",
  "android.intent.action.REBOOT",
  "android.intent.action.QUICKBOOT_POWERON",
  "com.htc.intent.action.QUICKBOOT_POWERON",
  "android.intent.action.MY_PACKAGE_REPLACED",
];

function withServiceSource(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const destination = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        PACKAGE_DIR,
      );
      fs.mkdirSync(destination, { recursive: true });
      fs.copyFileSync(SOURCE, path.join(destination, path.basename(SOURCE)));
      return config;
    },
  ]);
}

function withServiceReceiver(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] || "http://schemas.android.com/tools";

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    const receivers = (application.receiver || []).filter(
      (receiver) => ![EXPO_RECEIVER, BREAD_RECEIVER].includes(receiver.$["android:name"]),
    );

    receivers.push({ $: { "android:name": EXPO_RECEIVER, "tools:node": "remove" } });
    receivers.push({
      $: {
        "android:name": BREAD_RECEIVER,
        "android:enabled": "true",
        "android:exported": "false",
      },
      "intent-filter": [
        {
          action: RECEIVER_ACTIONS.map((name) => ({ $: { "android:name": name } })),
        },
      ],
    });
    application.receiver = receivers;
    return config;
  });
}

module.exports = function withAndroidNotificationService(config) {
  return withServiceReceiver(withServiceSource(config));
};
