//  Bread — how Android pushes reach BreadNotificationsService at all.
//
//  Expo's push service sends a push with a title as an FCM *notification*
//  message, and while the app is backgrounded Android's Firebase SDK draws
//  those itself — no app code runs, so there is nothing to style. The backend
//  therefore sends Android pushes data-only (stock-backend/lib/server/
//  notifications/push.ts), carrying the visible text inside `data` as
//  `_title` / `_body` / `_channelId`.
//
//  A data-only push always reaches this service. Here the text is lifted into
//  the fields Expo reads for a presentable data message (`title`, `message`,
//  `channelId`), and Expo takes it from there: presented in the background
//  through BreadNotificationsService's styling delegate, with taps routed to
//  JS as usual. Expo hands data-only messages to JS only to drop them while the
//  app is in the foreground, so in the foreground it is presented directly.

package com.breadapp.notifications

import android.app.ActivityManager
import android.os.Bundle
import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import expo.modules.notifications.service.NotificationsService
import org.json.JSONObject
import expo.modules.notifications.service.delegates.FirebaseMessagingDelegate as ExpoFirebaseMessagingDelegate
import expo.modules.notifications.service.interfaces.FirebaseMessagingDelegate as FirebaseMessagingDelegateInterface

private const val TAG = "BreadNotifications"

class BreadMessagingService : ExpoFirebaseMessagingService() {
  override val firebaseMessagingDelegate: FirebaseMessagingDelegateInterface by lazy {
    BreadFirebaseMessagingDelegate(this)
  }
}

class BreadFirebaseMessagingDelegate(context: android.content.Context) : ExpoFirebaseMessagingDelegate(context) {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val displayable = try {
      withDisplayFields(remoteMessage)
    } catch (t: Throwable) {
      Log.w(TAG, "Could not read push payload; handing it to Expo unchanged", t)
      null
    }
    if (displayable == null) {
      super.onMessageReceived(remoteMessage)
      return
    }
    if (isAppInForeground()) {
      NotificationsService.present(context, createNotification(displayable))
    } else {
      super.onMessageReceived(displayable)
    }
  }

  /**
   * The same message with Bread's `_title` / `_body` / `_channelId` (inside
   * Expo's `body` JSON) copied to the top-level keys Expo presents from, or
   * null when this is not one of Bread's data-only pushes.
   */
  private fun withDisplayFields(message: RemoteMessage): RemoteMessage? {
    if (message.notification != null) return null
    val data = message.data
    if (!data["title"].isNullOrEmpty() || !data["message"].isNullOrEmpty()) return null
    val body = data["body"]?.let(::JSONObject) ?: return null
    val title = body.optString("_title", "")
    val text = body.optString("_body", "")
    if (title.isEmpty() && text.isEmpty()) return null

    val bundle = Bundle()
    for ((key, value) in data) bundle.putString(key, value)
    bundle.putString("title", title)
    bundle.putString("message", text)
    body.optString("_channelId", "").takeIf { it.isNotEmpty() }?.let { bundle.putString("channelId", it) }
    message.messageId?.let { bundle.putString("google.message_id", it) }
    bundle.putString("google.sent_time", message.sentTime.toString())
    message.from?.let { bundle.putString("from", it) }
    return RemoteMessage(bundle)
  }

  private fun isAppInForeground(): Boolean {
    val state = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(state)
    return state.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }
}
