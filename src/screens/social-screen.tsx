import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  followUser,
  getFollowers,
  getFollowing,
  unfollowUser,
  type AppUserPayload,
  type FollowEntry,
} from '@/lib/api';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { LoadErrorState } from '@/components/load-error-state';
import { FollowButton } from '@/components/follow-button';
import { HandleText } from '@/components/handle-text';
import { ValueSkeleton } from '@/components/value-skeleton';
import { userDisplayName } from '@/lib/user-display';

const F = Fonts.rounded;

type Tab = 'followers' | 'following';

type Props = {
  visible: boolean;
  onClose: () => void;
  targetPrivyUserId: string;
  viewerPrivyUserId: string | null;
  viewerPayload: AppUserPayload | null;
  targetUsername?: string | null;
  initialFollowerCount?: number;
  initialFollowingCount?: number;
  onSelectUser?: (user: FollowEntry) => void;
};

type ListState = {
  entries: FollowEntry[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
};

const EMPTY_LIST: ListState = {
  entries: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
};

function Avatar({ avatarUrl }: { avatarUrl: string | null; name?: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={styles.rowAvatar} />;
  }
  return (
    <View style={styles.rowAvatarFallback}>
      <Ionicons name="person" size={22} color={colors.textTertiary} />
    </View>
  );
}

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function SocialScreen({
  visible,
  onClose,
  targetPrivyUserId,
  viewerPrivyUserId,
  viewerPayload,
  targetUsername,
  initialFollowerCount = 0,
  initialFollowingCount = 0,
  onSelectUser,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const [activeTab, setActiveTab] = useState<Tab>('followers');
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [followingCount, setFollowingCount] = useState(initialFollowingCount);
  const [followers, setFollowers] = useState<ListState>(EMPTY_LIST);
  const [following, setFollowing] = useState<ListState>(EMPTY_LIST);
  const followedRef = useRef<Map<string, boolean>>(new Map());
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    setFollowerCount(initialFollowerCount);
    setFollowingCount(initialFollowingCount);
  }, [initialFollowerCount, initialFollowingCount]);

  const loadFollowers = useCallback(
    async (cursor?: string | null) => {
      const isRefresh = !cursor;
      setFollowers((prev) => ({
        ...prev,
        loading: isRefresh,
        loadingMore: !isRefresh,
        error: null,
      }));
      try {
        const result = await getFollowers(targetPrivyUserId, viewerPrivyUserId, 20, cursor);
        setFollowers((prev) => ({
          entries: isRefresh ? result.entries : [...prev.entries, ...result.entries],
          nextCursor: result.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        }));
      } catch (err) {
        setFollowers((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: err instanceof Error ? err.message : 'Failed to load.',
        }));
      }
    },
    [targetPrivyUserId, viewerPrivyUserId],
  );

  const loadFollowing = useCallback(
    async (cursor?: string | null) => {
      const isRefresh = !cursor;
      setFollowing((prev) => ({
        ...prev,
        loading: isRefresh,
        loadingMore: !isRefresh,
        error: null,
      }));
      try {
        const result = await getFollowing(targetPrivyUserId, viewerPrivyUserId, 20, cursor);
        setFollowing((prev) => ({
          entries: isRefresh ? result.entries : [...prev.entries, ...result.entries],
          nextCursor: result.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        }));
      } catch (err) {
        setFollowing((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: err instanceof Error ? err.message : 'Failed to load.',
        }));
      }
    },
    [targetPrivyUserId, viewerPrivyUserId],
  );

  useEffect(() => {
    if (!visible) return;
    void loadFollowers();
    void loadFollowing();
  }, [visible, loadFollowers, loadFollowing]);

  function getIsFollowing(entry: FollowEntry): boolean {
    const override = followedRef.current.get(entry.privyUserId);
    return override !== undefined ? override : entry.isFollowing;
  }

  async function handleFollow(entry: FollowEntry) {
    if (!viewerPayload) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const currently = getIsFollowing(entry);
    followedRef.current.set(entry.privyUserId, !currently);
    forceUpdate((n) => n + 1);

    try {
      if (currently) {
        await unfollowUser(viewerPayload, entry.privyUserId);
      } else {
        await followUser(viewerPayload, entry.privyUserId);
      }
    } catch {
      followedRef.current.set(entry.privyUserId, currently);
      forceUpdate((n) => n + 1);
    }
  }

  function isOwnProfile(entry: FollowEntry) {
    return entry.privyUserId === viewerPrivyUserId;
  }

  function renderEntry(entry: FollowEntry) {
    const isMe = isOwnProfile(entry);
    const following = getIsFollowing(entry);
    const canTap = !isMe && !!onSelectUser;

    return (
      <Pressable
        key={entry.id}
        style={({ pressed }) => [styles.row, canTap && pressed && { opacity: 0.72 }]}
        onPress={canTap ? () => onSelectUser(entry) : undefined}
        disabled={!canTap}>
        <Avatar avatarUrl={entry.avatarUrl} name={entry.name} />
        <View style={styles.rowInfo}>
          <HandleText style={styles.rowName} numberOfLines={1}>
            {`@${userDisplayName(entry).replace(/^@+/, '')}`}
          </HandleText>
          <Text style={styles.rowSub}>{formatCount(entry.followerCount)} followers</Text>
        </View>
        {isMe ? (
          <View style={styles.youPill}>
            <Text style={styles.youPillText}>You</Text>
          </View>
        ) : (
          <FollowButton
            size="sm"
            following={following}
            followingTone="sky"
            shape="rounded"
            disabled={!viewerPayload}
            dimmed={!viewerPayload}
            onPress={(e) => { e.stopPropagation(); void handleFollow(entry); }}
          />
        )}
      </Pressable>
    );
  }

  const currentState = activeTab === 'followers' ? followers : following;
  const currentCount = activeTab === 'followers' ? followerCount : followingCount;
  const normalizedUsername = targetUsername?.trim().replace(/^@+/, '');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        {/* The page sheet's own grabber and pull-down are the close
            affordance; a chevron beside the title was a second one. */}
        <View style={styles.header}>
          <HandleText numberOfLines={1} style={styles.headerTitle}>
            {normalizedUsername ? `@${normalizedUsername}` : 'People'}
          </HandleText>
        </View>

        {/* Tabs */}
        <View style={styles.tabBar}>
          <Pressable
            onPress={() => { void Haptics.selectionAsync(); setActiveTab('followers'); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'followers' }}
            style={[styles.tab, activeTab === 'followers' && styles.tabActive]}>
            <Text style={[styles.tabText, activeTab === 'followers' && styles.tabTextActive]}>
              Followers
            </Text>
            <Text style={[styles.tabCount, activeTab === 'followers' && styles.tabCountActive]}>
              {formatCount(followerCount)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { void Haptics.selectionAsync(); setActiveTab('following'); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'following' }}
            style={[styles.tab, activeTab === 'following' && styles.tabActive]}>
            <Text style={[styles.tabText, activeTab === 'following' && styles.tabTextActive]}>
              Following
            </Text>
            <Text style={[styles.tabCount, activeTab === 'following' && styles.tabCountActive]}>
              {formatCount(followingCount)}
            </Text>
          </Pressable>
        </View>

        {/* List. The keyed Animated.View remounts when the tab or the
            loaded/error/empty branch changes, so resolved content fades in
            instead of popping over the spinner. */}
        {currentState.loading ? (
          <View accessibilityLabel="Loading people" style={styles.skeletonList}>
            {Array.from({ length: 6 }, (_, index) => (
              <View key={index} style={styles.row}>
                <ValueSkeleton width={44} height={44} radius={22} accessibilityLabel="" />
                <View style={styles.skeletonCopy}>
                  <ValueSkeleton width="45%" height={14} accessibilityLabel="" />
                  <ValueSkeleton width="30%" height={11} accessibilityLabel="" />
                </View>
                <ValueSkeleton width={112} height={34} radius={17} accessibilityLabel="" />
              </View>
            ))}
          </View>
        ) : currentState.error ? (
          <Animated.View
            key={`${activeTab}-error`}
            entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
            style={styles.center}>
            <LoadErrorState
              size="section"
              title={activeTab === 'followers' ? "Couldn't load followers" : "Couldn't load following"}
              onRetry={() => activeTab === 'followers' ? void loadFollowers() : void loadFollowing()}
            />
          </Animated.View>
        ) : currentState.entries.length === 0 ? (
          <Animated.View
            key={`${activeTab}-empty`}
            entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
            style={styles.center}>
            <Text style={styles.emptyText}>
              {activeTab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
            </Text>
          </Animated.View>
        ) : (
          <Animated.FlatList
            key={`${activeTab}-list`}
            entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
            data={currentState.entries}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => renderEntry(item)}
            contentContainerStyle={styles.listContent}
            onEndReached={() => {
              if (currentState.nextCursor && !currentState.loadingMore) {
                if (activeTab === 'followers') {
                  void loadFollowers(currentState.nextCursor);
                } else {
                  void loadFollowing(currentState.nextCursor);
                }
              }
            }}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              currentState.loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={colors.text} size="small" />
                </View>
              ) : currentCount > currentState.entries.length && currentState.nextCursor ? (
                <Pressable
                  onPress={() => {
                    if (activeTab === 'followers') void loadFollowers(currentState.nextCursor);
                    else void loadFollowing(currentState.nextCursor);
                  }}
                  style={styles.loadMoreBtn}>
                  <Text style={styles.loadMoreText}>Load more</Text>
                </Pressable>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    textAlign: 'center',
    color: c.text,
    fontSize: 17,
    fontWeight: '900',
    fontFamily: F,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.background,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: c.text,
  },
  tabText: {
    color: c.textQuaternary,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: F,
  },
  tabTextActive: {
    color: c.text,
  },
  tabCount: {
    color: c.textSecondary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    fontFamily: F,
  },
  tabCountActive: {
    color: c.text,
  },
  skeletonList: { paddingHorizontal: 16, paddingTop: 8 },
  skeletonCopy: { flex: 1, gap: 8 },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surfaceAlt,
  },
  rowAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    // Neutral default profile picture (person glyph) — no per-user color.
    backgroundColor: c.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarLetter: {
    color: c.textInverse,
    fontSize: 16,
    fontWeight: '800',
    fontFamily: F,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: c.text,
    fontSize: 15,
    fontWeight: '800',
    fontFamily: F,
  },
  rowSub: {
    marginTop: 2,
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: F,
  },
  youPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: c.surfaceAlt,
    minWidth: 82,
    alignItems: 'center',
  },
  youPillText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: F,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 60,
  },
  emptyText: {
    color: c.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: F,
  },
  errorText: {
    color: c.negative,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: F,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryBtn: {
    borderRadius: 999,
    backgroundColor: c.text,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryBtnText: {
    color: c.textInverse,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: F,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  loadMoreBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: c.surfaceAlt,
  },
  loadMoreText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: F,
  },
});
