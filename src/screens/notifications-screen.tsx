import Ionicons from '@expo/vector-icons/Ionicons';
import { usePrivy } from '@privy-io/expo';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ROW_LAYOUT, rowEntering, useFreshRowIds } from '@/components/animated-rows';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  appUserPayloadFromPrivyUser,
  type AppNotification,
  type NotificationCategory,
} from '@/lib/api';
import { registerForPushNotificationsIfNeeded } from '@/lib/notification-permissions';
import { useNotifications } from '@/lib/notifications-store';
import { useThemeStore } from '@/lib/theme-store';
import { UserProfileScreen } from '@/screens/user-profile-screen';

const F = Fonts.rounded;

const FILTERS: { key: NotificationCategory | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'social', label: 'Social' },
  { key: 'money', label: 'Money' },
  { key: 'market', label: 'Markets' },
];

/** Compact relative age — the list is scanned, not read. */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function iconForType(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'follow':
      return 'person-add';
    // Social-trade and asset-move events — see docs/notification-copy-spec.md.
    case 'follow_trade_buy':
    case 'follow_trade_long':
      return 'arrow-up-circle';
    case 'follow_trade_short':
      return 'arrow-down-circle';
    case 'follow_trade_sell':
      return 'checkmark-circle';
    case 'your_sandwich_bought':
      return 'cart';
    case 'asset_move_up':
    case 'asset_move_catalyst':
      return 'trending-up';
    case 'asset_move_down':
      return 'trending-down';
    case 'sandwich_move':
      return 'layers';
    case 'origin_new_sandwich':
    case 'curated_new':
      return 'sparkles';
    case 'market_news':
    case 'market_news_thread':
      return 'newspaper-outline';
    case 'market_mover':
    case 'market_catalyst':
    case 'market_call_vindicated':
    case 'market_call_wrong':
    case 'market_ath':
      return 'pulse';
    case 'market_open_digest':
      return 'sunny-outline';
    case 'holder_take':
      return 'chatbox-ellipses';
    case 'holder_take_reply':
      return 'chatbubbles';
    case 'sandwich_like':
      return 'heart';
    case 'sandwich_comment':
    case 'comment_mention':
      return 'chatbubble';
    case 'following_new_sandwich':
      return 'sparkles';
    case 'sandwich_bought':
    case 'following_trade':
      return 'cart';
    case 'deposit_received':
      return 'arrow-down-circle';
    case 'withdrawal_sent':
      return 'arrow-up-circle';
    case 'buy_executed':
    case 'sell_executed':
      return 'checkmark-circle';
    case 'buy_partial':
      return 'alert-circle';
    case 'buy_failed':
      return 'close-circle';
    case 'position_milestone':
      return 'trending-up';
    case 'weekly_recap':
      return 'calendar';
    default:
      return 'notifications';
  }
}

/**
 * The notification inbox.
 *
 * Every notification the app can send lands here, whether or not it was pushed —
 * a muted category, denied permission or quiet hours suppress the banner, never
 * the record. Tapping a row marks it read and follows the server-supplied deep
 * link target, so a new notification type is tappable without a client release.
 */
export function NotificationsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const { user } = usePrivy();
  const {
    notifications,
    loading,
    loadingMore,
    hasMore,
    hydrated,
    refresh,
    loadMore,
    category,
    setCategory,
    markRead,
    markSeen,
  } = useNotifications();

  const [refreshing, setRefreshing] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // Opening the inbox clears the badge but leaves rows unread — the user has
  // glanced at the list, which is not the same as having read what's in it.
  useEffect(() => {
    void markSeen();
  }, [markSeen]);

  // The one moment that earns the system permission prompt: the user came
  // looking for their notifications. Asking at launch instead is how apps
  // collect a permanent "no". A previous denial is respected — the helper only
  // prompts while the OS still reports `undetermined`.
  useEffect(() => {
    void registerForPushNotificationsIfNeeded();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onPressRow = useCallback(
    (notification: AppNotification) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void markRead([notification.id]);

      // A social row about a person opens that person; everything else follows
      // the target the server attached.
      if (notification.entityType === 'user' && notification.actor) {
        setProfileUserId(notification.actor.privyUserId);
        setProfileOpen(true);
        return;
      }
      const { route, params } = notification.target;
      if (!route || route === '/notifications') return;
      try {
        router.push({ pathname: route as never, params });
      } catch {
        // Unknown route from a newer server build — staying put beats crashing.
      }
    },
    [markRead, router],
  );

  const header = useMemo(
    () => (
      <View>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            onPress={() => router.back()}
            style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Notifications</Text>
          {/* Mirrors the back button so the title stays centred. */}
          <View style={styles.backBtn} />
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((filter) => {
            const active = category === filter.key;
            return (
              <Pressable
                key={filter.label}
                accessibilityRole="button"
                onPress={() => {
                  if (active) return;
                  void Haptics.selectionAsync();
                  setCategory(filter.key);
                }}
                style={styles.filterChip}>
                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    ),
    [category, colors.text, router, setCategory, styles],
  );

  // A notification that lands while the inbox is open rises in; rows already
  // seen (including ones scrolling back into the render window) don't replay.
  const freshIds = useFreshRowIds(useMemo(() => notifications.map((n) => n.id), [notifications]));

  const renderRow = useCallback(
    ({ item }: { item: AppNotification }) => (
      <Animated.View entering={freshIds.has(item.id) ? rowEntering() : undefined}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressRow(item)}
        style={styles.row}>
        {item.actor?.avatarUrl ? (
          <Image source={{ uri: item.actor.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.iconBubble}>
            <Ionicons name={iconForType(item.type)} size={18} color={colors.icon} />
          </View>
        )}
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.rowText} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
        <View style={styles.rowMeta}>
          <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>
          {!item.read ? <View style={styles.unreadDot} /> : null}
        </View>
      </Pressable>
      </Animated.View>
    ),
    [colors.icon, freshIds, onPressRow, styles],
  );

  const empty = hydrated && !loading ? (
    <View style={styles.emptyBox}>
      <Ionicons name="notifications-off-outline" size={30} color={colors.iconMuted} />
      <Text style={styles.emptyTitle}>Nothing yet</Text>
      <Text style={styles.emptyBody}>
        Follows, likes, comments and your trade updates will show up here.
      </Text>
    </View>
  ) : (
    <View style={styles.emptyBox}>
      <ActivityIndicator color={colors.accentBlue} />
    </View>
  );

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <Animated.FlatList
        data={notifications}
        // Filtering or a row arriving moves the others instead of jumping them.
        itemLayoutAnimation={ROW_LAYOUT}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        stickyHeaderIndices={[0]}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasMore && !loadingMore) void loadMore();
        }}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.accentBlue} />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.icon} />
        }
        contentContainerStyle={styles.listContent}
      />

      {profileUserId ? (
        <UserProfileScreen
          visible={profileOpen}
          onClose={() => setProfileOpen(false)}
          targetPrivyUserId={profileUserId}
          viewerPrivyUserId={user?.id ?? null}
          viewerPayload={user ? appUserPayloadFromPrivyUser(user) : null}
        />
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    listContent: { paddingBottom: 40 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.background,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontFamily: F, fontWeight: '800', fontSize: 18, color: c.text },
    filterRow: {
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 8,
      paddingBottom: 6,
      backgroundColor: c.background,
    },
    filterChip: { paddingHorizontal: 10, paddingVertical: 7 },
    filterText: { fontFamily: F, fontWeight: '600', fontSize: 17, color: c.textTertiary },
    filterTextActive: { fontWeight: '800', color: c.text },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceAlt },
    iconBubble: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { fontFamily: F, fontWeight: '800', fontSize: 14, color: c.text },
    rowText: { fontFamily: F, fontWeight: '500', fontSize: 13, color: c.textSecondary, lineHeight: 18 },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 },
    rowTime: { fontFamily: F, fontWeight: '600', fontSize: 12, color: c.textTertiary },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentBlue },
    footer: { paddingVertical: 20 },
    emptyBox: { alignItems: 'center', gap: 8, paddingTop: 80, paddingHorizontal: 40 },
    emptyTitle: { fontFamily: F, fontWeight: '800', fontSize: 16, color: c.text },
    emptyBody: {
      fontFamily: F,
      fontWeight: '500',
      fontSize: 13,
      color: c.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
