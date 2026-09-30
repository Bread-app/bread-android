import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Sandwich, SandwichPost } from '@/lib/api';
import { useThemeStore } from '@/lib/theme-store';
import { usePodcastGroup } from '@/lib/podcast-group-store';
import type { PodcastGroupVideo } from '@/components/podcast-sandwich-group-card';
import { PodcastGroupCard, SandwichCard } from '@/components/sandwich-card';
import {
  SandwichShareSheet,
  type SandwichShareSheetRef,
} from '@/components/sandwich-share-sheet';
import { TakeCard } from '@/components/take-card';
import { buildFeedItems, buildFeedItemsFromPosts, rankFeedItems } from '@/lib/sandwich-feed';
import type { HomeSaved } from '@/screens/home/use-home-saved';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

/**
 * Home shows a real slice of the feed — it continues in the Sandwiches tab.
 * Counted in feed ITEMS, so a podcast episode with four markets costs one slot,
 * exactly as it does on the Sandwiches screen.
 */
const FEED_LENGTH = 6;

type FeedFilter = 'trending' | 'saved';

type Props = {
  posts: SandwichPost[];
  loading: boolean;
  failed: boolean;
  /** The bookmarked slice, shown behind the "saved" filter. */
  saved: HomeSaved;
  onSelect: (sandwich: Sandwich) => void;
  onToggleLike: (sandwich: Sandwich) => void;
  onComment: (sandwich: Sandwich) => void;
  onSeeAll: () => void;
  onSeeAllSaved: () => void;
  onRetry: () => void;
};

function FilterTitle({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Show ${label} sandwiches`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={6}
    >
      <Text style={[styles.title, !active && styles.titleInactive]}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** The same bookmark the cards carry, so the filter reads as "those ones". */
function SavedFilterButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Show saved sandwiches"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={6}
      style={styles.savedButton}
    >
      <Ionicons
        name={active ? 'bookmark' : 'bookmark-outline'}
        size={22}
        color={active ? colors.text : colors.textQuaternary}
      />
    </PressableScale>
  );
}

/**
 * The feed tier — the product, given air. There is no "See all": the feed IS
 * the see-all, it just continues in the Sandwiches tab once you run out of rows
 * here.
 */
export function SandwichCategories({
  posts,
  loading,
  failed,
  saved,
  onSelect,
  onToggleLike,
  onComment,
  onSeeAll,
  onSeeAllSaved,
  onRetry,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const podcastGroup = usePodcastGroup();
  const [filter, setFilter] = useState<FeedFilter>('trending');

  // Same themed share sheet as the Sandwiches tab. `open()` presents a gorhom
  // modal, which must run synchronously from the tap — so keep this sync.
  const shareSheetRef = useRef<SandwichShareSheetRef>(null);
  const shareSandwich = useCallback((sandwich: Sandwich) => {
    shareSheetRef.current?.open(sandwich);
  }, []);

  // Same `buildFeedItemsFromPosts` the Sandwiches screen uses, so a YouTube
  // episode that produced several markets is ONE episode card here too — not one
  // card per market each repeating the same video preview.
  const feedItems = useMemo(
    () => rankFeedItems(buildFeedItemsFromPosts(posts)).slice(0, FEED_LENGTH),
    [posts],
  );

  // An episode is ONE card with one like, so the heart toggles the card — not
  // every market under it. The old loop wrote a like row per market and fired
  // the author a notification per market; the group's markets all share a
  // postId, so any one of them addresses the card.
  const openGroup = useCallback(
    (video: PodcastGroupVideo, group: Sandwich[]) =>
      podcastGroup.open({ video, sandwiches: group }),
    [podcastGroup],
  );

  const toggleLikeGroup = useCallback(
    (group: Sandwich[]) => {
      const [card] = group;
      if (card) onToggleLike(card);
    },
    [onToggleLike],
  );

  /**
   * Bookmarks are loose markets, so they are grouped exactly like the feed
   * above: a saved YouTube episode renders as the same episode card it was
   * saved from, not as one plain card per market it produced.
   */
  const savedItems = useMemo(
    () => buildFeedItems(saved.sandwiches).slice(0, FEED_LENGTH),
    [saved.sandwiches],
  );
  const savedShown = savedItems.reduce(
    (total, item) => total + (item.kind === 'video' ? item.sandwiches.length : 1),
    0,
  );

  // Depends on the handler, not on `saved` — the hook returns a fresh object
  // every render, and closing over it would hand the memoised cards a new prop
  // each time.
  const savedToggleLike = saved.toggleLike;
  const toggleSavedLikeGroup = useCallback(
    (group: Sandwich[]) => {
      const [card] = group;
      if (card) savedToggleLike(card);
    },
    [savedToggleLike],
  );

  return (
    <View style={styles.section}>
      {/* Not `SectionHeader`: that renders its title at weight 900, and this
          one wants a step lighter. The two titles are the filter — the active
          one is the heading, the other sits beside it dimmed. */}
      <View style={styles.titleRow}>
        <FilterTitle
          label="Trending"
          active={filter === 'trending'}
          onPress={() => setFilter('trending')}
        />
        <SavedFilterButton active={filter === 'saved'} onPress={() => setFilter('saved')} />
      </View>

      {filter === 'saved' ? (
        saved.loading && savedItems.length === 0 ? (
          <View style={styles.skeletonList}>
            {Array.from({ length: 2 }).map((_, index) => (
              <View
                key={index}
                accessibilityLabel="Loading saved sandwiches"
                style={styles.skeletonCard}
              />
            ))}
          </View>
        ) : saved.count === 0 ? (
          <View style={styles.stateBlock}>
            <Text style={styles.stateTitle}>
              Bookmark a sandwich and it will show up here.
            </Text>
          </View>
        ) : savedItems.length === 0 ? (
          <View style={styles.stateBlock}>
            <Text style={styles.stateTitle}>Couldn&apos;t load saved sandwiches.</Text>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Retry saved sandwiches"
              onPress={() => void saved.refresh()}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Retry</Text>
            </PressableScale>
          </View>
        ) : (
          <View>
            {savedItems.map((item) =>
              item.kind === 'video' ? (
                <PodcastGroupCard
                  key={item.key}
                  video={item.video}
                  sandwiches={item.sandwiches}
                  onOpenGroup={openGroup}
                  onToggleLikeGroup={toggleSavedLikeGroup}
                  onComment={saved.openComments}
                  onShare={shareSandwich}
                />
              ) : (
                <SandwichCard
                  key={item.key}
                  sandwich={item.sandwich}
                  onPress={saved.open}
                  onToggleLike={saved.toggleLike}
                  onComment={saved.openComments}
                  onShare={shareSandwich}
                />
              ),
            )}
            {saved.count > savedShown ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Open the Saved screen"
                onPress={onSeeAllSaved}
                style={styles.continueRow}
              >
                <Text style={styles.actionText}>See all saved</Text>
              </PressableScale>
            ) : null}
          </View>
        )
      ) : loading && posts.length === 0 ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: 2 }).map((_, index) => (
            <View
              key={index}
              accessibilityLabel="Loading sandwiches"
              style={styles.skeletonCard}
            />
          ))}
        </View>
      ) : failed && posts.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>Couldn&apos;t load sandwiches.</Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry community sandwiches"
            onPress={onRetry}
            style={styles.actionButton}
          >
            <Text style={styles.actionText}>Retry</Text>
          </PressableScale>
        </View>
      ) : feedItems.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>No sandwiches in the latest batch.</Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Browse all sandwiches"
            onPress={onSeeAll}
            style={styles.actionButton}
          >
            <Text style={styles.actionText}>Browse all</Text>
          </PressableScale>
        </View>
      ) : (
        <View>
          {feedItems.map((item) =>
            item.kind === 'video' ? (
              <PodcastGroupCard
                key={item.key}
                video={item.video}
                sandwiches={item.sandwiches}
                onOpenGroup={openGroup}
                onToggleLikeGroup={toggleLikeGroup}
                onComment={onComment}
                onShare={shareSandwich}
              />
            ) : item.kind === 'take' ? (
              <TakeCard
                key={item.key}
                take={item.take}
                sandwich={item.sandwich}
                onPress={onSelect}
              />
            ) : (
              <SandwichCard
                key={item.key}
                sandwich={item.sandwich}
                onPress={onSelect}
                onToggleLike={onToggleLike}
                onComment={onComment}
                onShare={shareSandwich}
              />
            ),
          )}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Open the Sandwiches tab"
            onPress={onSeeAll}
            style={styles.continueRow}
          >
            <Text style={styles.actionText}>Keep reading</Text>
          </PressableScale>
        </View>
      )}
      <SandwichShareSheet ref={shareSheetRef} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Tier spacing is owned by the home screen so the three tiers stay in one
    // place instead of every section carrying its own margin.
    section: {},
    titleRow: {
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    savedButton: {
      // The title's 28pt line, so the icon centres on the heading.
      height: 28,
      justifyContent: 'center',
    },
    title: {
      // A step under SectionHeader's display title: this is a filter, not the
      // page heading.
      color: c.text,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '800',
      fontFamily: F,
      letterSpacing: -0.3,
    },
    titleInactive: {
      color: c.textQuaternary,
    },
    skeletonList: {
      gap: 16,
    },
    skeletonCard: {
      height: 92,
      borderRadius: Radius.lg,
      backgroundColor: c.surfaceAlt,
    },
    // One state shape for every slot on Home: 92pt, surfaceAlt, radius lg.
    stateBlock: {
      height: 92,
      borderRadius: Radius.lg,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 16,
      justifyContent: 'center',
      gap: 2,
    },
    stateTitle: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      fontFamily: F,
    },
    actionButton: {
      minHeight: 32,
      justifyContent: 'center',
    },
    actionText: {
      color: c.actionPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
      fontFamily: F,
    },
    continueRow: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
