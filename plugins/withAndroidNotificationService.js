/**
 * Adds Bread's Android notification service: sender avatars and thread
 * grouping on pushes, the Android counterpart of bread-mobile's iOS
 * Notification Service Extension.
 *
 * A config plugin because `android/` is gitignored: EAS runs `expo prebuild`
 * on every build, so a hand edit there is gone on the next one. Everything here
 * re-applies from scratch each prebuild.
 *
 * What it does:
 *  - copies plugins/notification-service/*.kt into the app's sources;
 *  - swaps Expo's `NotificationsService` receiver for BreadNotificationsService
 *    (the styling). Expo hands every presentation to the first receiver that
 *    answers its NOTIFICATION_EVENT action, so Expo's own has to be removed
 *    rather than left alongside (it would also double-handle BOOT_COMPLETED);
 *  - swaps Expo's FCM service for BreadMessagingService, which turns Bread's
 *    data-only pushes into presentable ones. Android pushes are data-only
 *    because Firebase draws a push with a title itself while the app is in the
 *    background, so no app code would ever get to style it;
 *  - adds firebase-messaging to the app's dependencies for that subclass.
 *
 * The backend's half of the contract (stock-backend/lib/server/notifications/
 * push.ts): Android pushes are data-only with `_title` / `_body` / `_channelId`,
 * plus `senderId` / `senderName` / `avatarUrl` / `threadId` in `data`.
 */
const fs = require("fs");
const path = require("path");

const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require("@expo/config-plugins");

const SOURCE_DIR = path.join(__dirname, "notification-service");
const SOURCES = ["BreadNotificationsService.kt", "BreadMessagingService.kt"];
const PACKAGE_DIR = path.join("com", "breadapp", "notifications");
const EXPO_RECEIVER = "expo.modules.notifications.service.NotificationsService";
const BREAD_RECEIVER = "com.breadapp.notifications.BreadNotificationsService";
const EXPO_MESSAGING_SERVICE = "expo.modules.notifications.service.ExpoFirebaseMessagingService";
const BREAD_MESSAGING_SERVICE = "com.breadapp.notifications.BreadMessagingService";
// Same version expo-notifications compiles against; it only declares it as
// `implementation`, so the app needs it to subclass Expo's messaging service.
const FIREBASE_MESSAGING = "com.google.firebase:firebase-messaging:24.0.1";

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
      for (const file of SOURCES) {
        fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(destination, file));
      }
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

    const services = (application.service || []).filter(
      (service) => ![EXPO_MESSAGING_SERVICE, BREAD_MESSAGING_SERVICE].includes(service.$["android:name"]),
    );
    services.push({ $: { "android:name": EXPO_MESSAGING_SERVICE, "tools:node": "remove" } });
    services.push({
      $: { "android:name": BREAD_MESSAGING_SERVICE, "android:exported": "false" },
      "intent-filter": [{ action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }] }],
    });
    application.service = services;
    return config;
  });
}

function withFirebaseMessagingDependency(config) {
  return withAppBuildGradle(config, (config) => {
    const line = `    implementation("${FIREBASE_MESSAGING}")`;
    if (!config.modResults.contents.includes(FIREBASE_MESSAGING)) {
      config.modResults.contents = config.modResults.contents.replace(
        /dependencies\s*\{/,
        (match) => `${match}\n${line}`,
      );
    }
    return config;
  });
}

module.exports = function withAndroidNotificationService(config) {
  return withFirebaseMessagingDependency(withServiceReceiver(withServiceSource(config)));
};
