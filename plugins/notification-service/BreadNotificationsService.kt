//  Bread — rich push notifications on Android.
//
//  The Android half of bread-mobile's iOS Notification Service Extension
//  (bread-mobile/plugins/notification-service/NotificationService.swift).
//  Both read the same contract from the push's `data`
//  (stock-backend/lib/server/notifications/push.ts):
//
//    senderId + senderName  → who the notification is from
//    avatarUrl              → their photo
//    threadId               → the conversation it belongs to
//
//  On iOS that becomes a Communication Notification. Here it becomes a
//  MessagingStyle notification whose sender `Person` carries the avatar, plus
//  a long-lived conversation shortcut on Android 11+ so the system draws the
//  avatar in place of the app icon. `threadId` becomes a notification group.
//
//  Expo's own pipeline still builds the notification first: its content
//  intent, extras and marshalled request are what route a tap back to JS
//  (`addNotificationResponseReceivedListener`). This only restyles that
//  notification, and every failure path returns Expo's unstyled one. A missing
//  avatar must never cost the user the notification itself.
//
//  Wired in by plugins/withAndroidNotificationService.js, which swaps Expo's
//  NotificationsService receiver for this one in the manifest.

package com.breadapp.notifications

import android.app.Notification
import android.app.NotificationManager
import android.app.Person
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.notifications.notifications.model.NotificationBehaviorRecord
import expo.modules.notifications.service.NotificationsService
import expo.modules.notifications.service.delegates.ExpoPresentationDelegate
import expo.modules.notifications.service.interfaces.PresentationDelegate
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import expo.modules.notifications.notifications.model.Notification as ExpoNotification

private const val TAG = "BreadNotifications"

/** Expo's receiver, with our presentation delegate in place of its own. */
class BreadNotificationsService : NotificationsService() {
  override fun getPresentationDelegate(context: Context): PresentationDelegate =
    BreadPresentationDelegate(context)
}

class BreadPresentationDelegate(context: Context) : ExpoPresentationDelegate(context) {
  override suspend fun createNotification(
    notification: ExpoNotification,
    notificationBehavior: NotificationBehaviorRecord?
  ): Notification {
    val base = super.createNotification(notification, notificationBehavior)
    return try {
      BreadNotificationStyler(context).style(notification, base)
    } catch (t: Throwable) {
      Log.w(TAG, "Styling failed; delivering the plain notification", t)
      base
    }
  }
}

private class BreadNotificationStyler(private val context: Context) {
  private data class Sender(val id: String, val name: String)

  fun style(notification: ExpoNotification, base: Notification): Notification {
    // For a remote push, Expo's `body` IS the `data` the backend sent.
    val data = notification.notificationRequest.content.body ?: return base
    val sender = sender(data)
    val threadId = data.nonEmpty("threadId")
    if (sender == null && threadId == null) return base

    val builder = Notification.Builder.recoverBuilder(context, base)

    val group = threadId?.let { "bread-thread:$it" }
    if (group != null) builder.setGroup(group)

    if (sender != null) {
      val avatar = data.nonEmpty("avatarUrl")?.let(this::downloadAvatar)
      applySender(builder, base, sender, avatar)
    }

    val styled = builder.build()
    if (group != null) postGroupSummaryIfStacked(group, base)
    return styled
  }

  private fun applySender(
    builder: Notification.Builder,
    base: Notification,
    sender: Sender,
    avatar: Bitmap?
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      // No Person API: the round avatar goes where the large icon sits.
      avatar?.let { builder.setLargeIcon(it) }
      return
    }

    val icon = avatar?.let { Icon.createWithBitmap(it) }
    val person = Person.Builder()
      .setKey(sender.id)
      .setName(sender.name)
      .apply { icon?.let { setIcon(it) } }
      .build()
    val me = Person.Builder().setName("You").build()
    val text = base.extras.getCharSequence(Notification.EXTRA_TEXT) ?: ""
    val style = Notification.MessagingStyle(me)
      .addMessage(Notification.MessagingStyle.Message(text, base.`when`, person))
    builder.setStyle(style)
    // The sender's avatar replaces this; leaving it would draw the same photo
    // a second time on the right, which is exactly what iOS avoids too.
    builder.setLargeIcon(null as Icon?)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      shortcutFor(sender, avatar)?.let { builder.setShortcutId(it) }
    }
  }

  /**
   * Android 11+ only treats a MessagingStyle notification as a conversation —
   * and only then draws the person in place of the app icon — when it points
   * at a long-lived shortcut for that person.
   */
  private fun shortcutFor(sender: Sender, avatar: Bitmap?): String? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    val id = "bread-sender:${sender.id}"
    val person = androidx.core.app.Person.Builder()
      .setKey(sender.id)
      .setName(sender.name)
      .apply { avatar?.let { setIcon(IconCompat.createWithBitmap(it)) } }
      .build()
    val shortcut = ShortcutInfoCompat.Builder(context, id)
      .setShortLabel(sender.name)
      .setLongLived(true)
      .setPerson(person)
      .setIntent(Intent(launch).setAction(Intent.ACTION_VIEW))
      .apply { avatar?.let { setIcon(IconCompat.createWithBitmap(it)) } }
      .build()
    return try {
      // Evicts the least-recently-used shortcut once the per-app cap is hit.
      ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
      id
    } catch (t: Throwable) {
      Log.w(TAG, "Could not publish conversation shortcut", t)
      null
    }
  }

  /**
   * Android only stacks a group under a summary notification. Posted once a
   * second notification joins the thread, so a lone notification never sits
   * under a summary of one.
   */
  private fun postGroupSummaryIfStacked(group: String, base: Notification) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val alreadyInGroup = manager.activeNotifications.count {
      it.notification.group == group &&
        (it.notification.flags and Notification.FLAG_GROUP_SUMMARY) == 0
    }
    if (alreadyInGroup < 1) return

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, base.channelId)
        .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val summary = builder
      .setSmallIcon(base.smallIcon)
      .setColor(base.color)
      .setGroup(group)
      .setGroupSummary(true)
      .setAutoCancel(true)
      .setContentIntent(base.contentIntent)
      .build()
    try {
      NotificationManagerCompat.from(context).notify(group, 0, summary)
    } catch (e: SecurityException) {
      Log.w(TAG, "Notification permission revoked; skipping group summary", e)
    }
  }

  private fun sender(data: JSONObject): Sender? {
    val id = data.nonEmpty("senderId") ?: return null
    val name = data.nonEmpty("senderName") ?: return null
    return Sender(id, name)
  }

  /**
   * Time-boxed like the iOS extension: past this an avatar is not worth
   * delaying the notification for. https only, matching the backend's filter.
   */
  private fun downloadAvatar(url: String): Bitmap? {
    if (!url.startsWith("https://")) return null
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 6000
        readTimeout = 6000
      }
      if (connection.responseCode !in 200..299) return null
      val bytes = connection.inputStream.use { it.readBytes() }
      decodeScaled(bytes, AVATAR_PX)?.let(this::circleCrop)
    } catch (t: Throwable) {
      Log.w(TAG, "Avatar download failed", t)
      null
    } finally {
      connection?.disconnect()
    }
  }

  private fun decodeScaled(bytes: ByteArray, target: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= target) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  private fun circleCrop(source: Bitmap): Bitmap {
    val size = minOf(source.width, source.height, AVATAR_PX)
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    canvas.drawOval(RectF(0f, 0f, size.toFloat(), size.toFloat()), paint)
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    // Centre-crop the source square into the circle.
    val edge = minOf(source.width, source.height)
    val left = (source.width - edge) / 2
    val top = (source.height - edge) / 2
    canvas.drawBitmap(source, Rect(left, top, left + edge, top + edge), Rect(0, 0, size, size), paint)
    return output
  }

  private fun JSONObject.nonEmpty(key: String): String? =
    optString(key, "").takeIf { it.isNotBlank() }

  companion object {
    private const val AVATAR_PX = 256
  }
}
