import Ionicons from '@expo/vector-icons/Ionicons';
import { usePrivy } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';

import { SkeletonRows } from '@/components/skeleton-rows';
import { AnimatedRows } from '@/components/animated-rows';
import { StockCard } from '@/components/stock-card';
import { StockDetailSheet, type StockDetailSheetRef } from '@/components/stock-detail-sheet';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  appUserPayloadFromPrivyUser,
  getSandwichById,
  getSavedStock,
  setCardLike,
  type CardSocial,
  type Sandwich,
  type Stock,
} from '@/lib/api';
import { useSavedStore } from '@/lib/saved-store';
import { cardSocial, toggledCardSocial, withCardSocial } from '@/lib/card-social';
import { getAnonymousSocialId } from '@/lib/social-identity';
import { useSandwichDetail } from '@/lib/sandwich-detail-store';
import {
  SandwichShareSheet,
  type SandwichShareSheetRef,
} from '@/components/sandwich-share-sheet';
import { LoadErrorState } from '@/components/load-error-state';
import { PodcastGroupCard, SandwichCard } from '@/components/sandwich-card';
import type { PodcastGroupVideo } from '@/components/podcast-sandwich-group-card';
import { usePodcastGroup } from '@/lib/podcast-group-store';
import { buildFeedItems } from '@/lib/sandwich-feed';
import { UserProfileScreen } from '@/screens/user-profile-screen';

const F = Fonts.rounded;

type SavedTab = 'sandwich' | 'stock';

export function SavedScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const { user } = usePrivy();
  // A holder tapped in the asset sheet opens their profile over this screen.
  const [holderId, setHolderId] = useState<string | null>(null);
  const [holderOpen, setHolderOpen] = useState(false);
  const sandwichDetail = useSandwichDetail();
  const podcastGroup = usePodcastGroup();
  const { savedSandwichOrder, savedStockOrder, isSaved, toggleSave, refresh, hydrated } =
    useSavedStore();

  const [tab, setTab] = useState<SavedTab>('sandwich');
  const [refreshing, setRefreshing] = useState(false);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);

  // Land on the tab that actually has saves so a user whose only bookmarks are
  // assets doesn't open to an empty "Sandwiches" tab and think it's broken.
  // Runs once, after the store hydrates, and never fights a manual switch.
  const didAutoSelectTab = useRef(false);
  useEffect(() => {
    if (!hydrated || didAutoSelectTab.current) return;
    didAutoSelectTab.current = true;
    if (savedSandwichOrder.length === 0 && savedStockOrder.length > 0) {
      setTab('stock');
    }
  }, [hydrated, savedSandwichOrder.length, savedStockOrder.length]);

  // Resolved card data keyed by id. Saved rows only persist the id, so we
  // rehydrate the full sandwich/stock on demand and cache it here.
  const [sandwichDetails, setSandwichDetails] = useState<Map<string, Sandwich>>(new Map());
  const [stockDetails, setStockDetails] = useState<Map<string, Stock>>(new Map());
  // Ids we've already attempted (resolved OR failed). Kept in state — not a ref —
  // so the loading flag re-evaluates when a fetch settles. This is what stops an
  // unresolvable item (deleted sandwich, unlistable mint) spinning forever.
  const [triedSandwich, setTriedSandwich] = useState<Set<string>>(new Set());
  const [triedStock, setTriedStock] = useState<Set<string>>(new Set());

  const stockDetailSheetRef = useRef<StockDetailSheetRef>(null);
  const shareSheetRef = useRef<SandwichShareSheetRef>(null);
  const stockSheetIndex = useSharedValue(-1);

  useEffect(() => {
    let cancelled = false;
    setAnonymousId(null);
    void getAnonymousSocialId(user?.id).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Fetch any saved sandwich ids we don't have card data for yet.
  useEffect(() => {
    const missing = savedSandwichOrder.filter((id) => !triedSandwich.has(id));
    if (missing.length === 0) return;
    // Mark as tried up-front so we don't refetch mid-flight; the loading flag
    // keys off this so a failed fetch still settles the spinner.
    setTriedSandwich((prev) => new Set([...prev, ...missing]));
    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        const sandwich = await getSandwichById(id, anonymousId).catch(() => null);
        return [id, sandwich] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      setSandwichDetails((prev) => {
        const next = new Map(prev);
        for (const [id, sandwich] of results) {
          if (sandwich) next.set(id, sandwich);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // `triedSandwich` is intentionally NOT a dep: this effect both reads it and
    // calls setTriedSandwich, so listing it would re-run the effect the instant
    // we mark ids tried — the cleanup would set cancelled=true and the in-flight
    // fetch's result would be dropped, leaving the list permanently empty. The
    // effect already re-runs on savedSandwichOrder changes (including refresh,
    // which hands it a fresh array), and the closure sees the latest triedSandwich.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSandwichOrder, anonymousId]);

  // Fetch any saved stock ids we don't have card data for yet.
  useEffect(() => {
    const missing = savedStockOrder.filter((id) => !triedStock.has(id));
    if (missing.length === 0) return;
    setTriedStock((prev) => new Set([...prev, ...missing]));
    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        const stock = await getSavedStock(id).catch(() => null);
        return [id, stock] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      setStockDetails((prev) => {
        const next = new Map(prev);
        for (const [id, stock] of results) {
          if (stock) next.set(id, stock);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // See the sandwich effect above: `triedStock` is deliberately left out of the
    // deps. Including it re-runs the effect when we mark ids tried, whose cleanup
    // cancels the only in-flight fetch before it can populate stockDetails — the
    // exact cause of "Couldn't load saved assets" on a perfectly resolvable mint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedStockOrder]);

  // Render straight from the store's newest-first order, dropping any ids whose
  // detail couldn't be resolved (deleted sandwich, unlistable mint).
  const sandwiches = useMemo(
    () =>
      savedSandwichOrder
        .map((id) => sandwichDetails.get(id))
        .filter((s): s is Sandwich => !!s),
    [savedSandwichOrder, sandwichDetails],
  );
  const stocks = useMemo(
    () => savedStockOrder.map((id) => stockDetails.get(id)).filter((s): s is Stock => !!s),
    [savedStockOrder, stockDetails],
  );

  // Still loading while the store hasn't hydrated, or there are saved ids we
  // haven't finished attempting to resolve yet. Once every id has been tried the
  // spinner clears even if some failed to resolve.
  const sandwichesPending = savedSandwichOrder.some((id) => !triedSandwich.has(id));
  const stocksPending = savedStockOrder.some((id) => !triedStock.has(id));
  const sandwichesLoading = !hydrated || (sandwiches.length === 0 && sandwichesPending);
  const stocksLoading = !hydrated || (stocks.length === 0 && stocksPending);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Allow re-fetching details for everything currently saved.
    setTriedSandwich(new Set());
    setTriedStock(new Set());
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handleToggleSaveSandwich = useCallback(
    (sandwich: Sandwich) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void toggleSave('sandwich', sandwich.id);
    },
    [toggleSave],
  );

  const applyUpdatedSandwich = useCallback((updated: Sandwich) => {
    setSandwichDetails((prev) => {
      const next = new Map(prev);
      next.set(updated.id, updated);
      return next;
    });
  }, []);

  /**
   * Write a card's social state onto EVERY saved market of that card.
   *
   * An episode card reads its heart and its counts off the first market it
   * holds, so updating only the market the tap arrived on left the card showing
   * the old number whenever the group happened to be ordered differently.
   */
  const writeCardSocial = useCallback((card: Sandwich, social: CardSocial) => {
    setSandwichDetails((prev) => {
      const next = new Map(prev);
      for (const [id, row] of prev) {
        const onCard = card.postId ? row.postId === card.postId : row.id === card.id;
        if (onCard) next.set(id, withCardSocial(row, social));
      }
      return next;
    });
  }, []);

  const handleToggleLike = useCallback(
    async (sandwich: Sandwich) => {
      if (!anonymousId) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // The like belongs to the card this market sits on, so one request covers
      // an episode however many markets it produced.
      const before = cardSocial([sandwich]);
      const optimistic = toggledCardSocial(before);
      writeCardSocial(sandwich, optimistic);
      try {
        const updated = await setCardLike(sandwich, optimistic.viewerHasLiked, anonymousId);
        writeCardSocial(sandwich, updated);
      } catch {
        writeCardSocial(sandwich, before);
      }
    },
    [anonymousId, writeCardSocial],
  );

  /** One episode is one like, so the card's first market addresses it. */
  const handleToggleLikeGroup = useCallback(
    (group: Sandwich[]) => {
      const [card] = group;
      if (card) void handleToggleLike(card);
    },
    [handleToggleLike],
  );

  const handleShareSandwich = useCallback((sandwich: Sandwich) => {
    shareSheetRef.current?.open(sandwich);
  }, []);

  /**
   * Saved rows are loose markets, so they go through the SAME grouping the feed
   * uses: a YouTube episode is one card here too. Without this, bookmarking an
   * episode (which saves every market on it) filled this list with one plain
   * sandwich card per market, none of them looking like the card that was
   * saved.
   */
  const feedItems = useMemo(() => buildFeedItems(sandwiches), [sandwiches]);

  const openGroup = useCallback(
    (video: PodcastGroupVideo, group: Sandwich[]) =>
      podcastGroup.open({ video, sandwiches: group }),
    [podcastGroup],
  );

  const openSandwichComments = useCallback(
    (sandwich: Sandwich) =>
      sandwichDetail.open(sandwich, {
        onUpdated: applyUpdatedSandwich,
        showComments: true,
      }),
    [sandwichDetail, applyUpdatedSandwich],
  );

  const openSandwich = useCallback(
    (sandwich: Sandwich) => {
      sandwichDetail.open(sandwich, { onUpdated: applyUpdatedSandwich });
    },
    [sandwichDetail, applyUpdatedSandwich],
  );

  const openStock = useCallback((stock: Stock) => {
    stockDetailSheetRef.current?.open(stock);
  }, []);

  const isSandwichTab = tab === 'sandwich';

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.icon} />
        </Pressable>
        <Text style={styles.headerTitle}>Saved</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TabButton
          label="Sandwiches"
          active={isSandwichTab}
          count={savedSandwichOrder.length}
          onPress={() => setTab('sandwich')}
        />
        <TabButton
          label="Assets"
          active={!isSandwichTab}
          count={savedStockOrder.length}
          onPress={() => setTab('stock')}
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {isSandwichTab ? (
          savedSandwichOrder.length === 0 ? (
            <EmptyState
              icon="star-outline"
              title="No saved sandwiches"
              subtitle="Tap the star on any sandwich to save it here."
            />
          ) : sandwichesLoading ? (
            <LoadingState variant="card" />
          ) : sandwiches.length === 0 ? (
            <LoadErrorState title="Couldn't load saved sandwiches" onRetry={onRefresh} />
          ) : (
            // Unsaving a card lets it fade out while the rest close the gap.
            <AnimatedRows>
            {feedItems.map((item) =>
              item.kind === 'video' ? (
                <PodcastGroupCard
                  key={item.key}
                  video={item.video}
                  sandwiches={item.sandwiches}
                  onOpenGroup={openGroup}
                  onToggleLikeGroup={handleToggleLikeGroup}
                  onComment={openSandwichComments}
                  onShare={handleShareSandwich}
                />
              ) : (
                <SandwichCard
                  key={item.key}
                  sandwich={item.sandwich}
                  onPress={openSandwich}
                  onToggleLike={handleToggleLike}
                  onComment={openSandwichComments}
                  onShare={handleShareSandwich}
                />
              ),
            )}
            </AnimatedRows>
          )
        ) : savedStockOrder.length === 0 ? (
          <EmptyState
            icon="star-outline"
            title="No saved assets"
            subtitle="Tap the star on any asset to save it here."
          />
        ) : stocksLoading ? (
          <LoadingState variant="row" />
        ) : stocks.length === 0 ? (
          <LoadErrorState title="Couldn't load saved assets" onRetry={onRefresh} />
        ) : (
          // Unsaving a row lets it fade out while the rest close the gap.
          <AnimatedRows>
            {stocks.map((stock) => (
              <StockCard key={stock.id} stock={stock} onPress={openStock} />
            ))}
          </AnimatedRows>
        )}
      </ScrollView>

      <StockDetailSheet
        ref={stockDetailSheetRef}
        animatedIndex={stockSheetIndex}
        onOpenUser={(privyUserId) => {
          setHolderId(privyUserId);
          setHolderOpen(true);
        }}
      />
      <SandwichShareSheet ref={shareSheetRef} />
      {holderId ? (
        <UserProfileScreen
          visible={holderOpen}
          onClose={() => setHolderOpen(false)}
          targetPrivyUserId={holderId}
          viewerPrivyUserId={user?.id ?? null}
          viewerPayload={user ? appUserPayloadFromPrivyUser(user) : null}
        />
      ) : null}
    </SafeAreaView>
  );
}

function TabButton({
  label,
  active,
  count,
  onPress,
}: {
  label: string;
  active: boolean;
  count: number;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
        {count > 0 ? ` · ${count}` : ''}
      </Text>
    </Pressable>
  );
}

/** The saved list's own shape while it loads — cards for sandwiches, rows for assets. */
function LoadingState({ variant }: { variant: 'card' | 'row' }) {
  return (
    <SkeletonRows
      count={variant === 'card' ? 3 : 5}
      variant={variant}
      accessibilityLabel={variant === 'card' ? 'Loading saved sandwiches' : 'Loading saved assets'}
    />
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <View style={styles.centerState}>
      <Ionicons name={icon} size={40} color={colors.iconMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: c.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: F,
    fontWeight: '800',
    fontSize: 18,
    color: c.text,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  tabBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: c.surfaceAlt,
  },
  tabBtnActive: {
    backgroundColor: c.text,
  },
  tabText: {
    fontFamily: F,
    fontWeight: '600',
    fontSize: 14,
    color: c.textTertiary,
  },
  tabTextActive: {
    color: c.textInverse,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 120,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 96,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: F,
    fontWeight: '700',
    fontSize: 16,
    color: c.text,
    marginTop: 8,
  },
  emptySubtitle: {
    fontFamily: F,
    fontWeight: '400',
    fontSize: 14,
    color: c.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
