import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useMemo } from "react";
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { AssetLogo } from "@/components/asset-logo";
import { PressableScale } from "@/components/pressable-scale";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import type { Stock } from "@/lib/api";
import {
  newsRelativeTime,
  sectionNewsStories,
  type NewsSection,
  type NewsStory,
} from "@/lib/news-feed";
import { useThemeStore } from "@/lib/theme-store";

const F = Fonts.rounded;

type Props = {
  stories: NewsStory[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Space the FAB and tab bar take up over the list's tail. */
  bottomInset: number;
  onOpenStory: (story: NewsStory) => void;
  onOpenStock: (stock: Stock) => void;
};

function formatChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * One asset the story names, with today's move. The chip is the reason news
 * lives in a trading app, so it rides on every row rather than behind a tap.
 */
export function NewsTickerChip({
  stock,
  onPress,
  size = "sm",
}: {
  stock: Stock;
  onPress: (stock: Stock) => void;
  size?: "sm" | "md";
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const change = stock.priceChange24h;
  const changeColor =
    change == null ? colors.textTertiary : change >= 0 ? colors.positive : colors.negative;
  const logo = size === "md" ? 18 : 16;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Open ${stock.name}, ${formatChange(change)} today`}
      onPress={() => onPress(stock)}
      scaleTo={0.94}
      hitSlop={4}
      style={[styles.chip, size === "md" && styles.chipMd]}
    >
      <AssetLogo
        uri={stock.icon}
        size={logo}
        borderRadius={logo / 2}
        backgroundColor={colors.surface}
        fallback={
          <View style={[styles.chipLogoFallback, { width: logo, height: logo, borderRadius: logo / 2 }]}>
            <Text style={styles.chipLogoFallbackText}>
              {(stock.symbol || "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
        }
      />
      <Text style={styles.chipSymbol} numberOfLines={1}>
        {stock.symbol}
      </Text>
      <Text style={[styles.chipChange, { color: changeColor }]}>{formatChange(change)}</Text>
    </PressableScale>
  );
}

function StoryMeta({ story, now }: { story: NewsStory; now: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const time = newsRelativeTime(story.postedAtMs, now);
  const extra = story.alsoReportedBy.length;
  const isX = story.item.feedSource === "x";

  return (
    <View style={styles.metaRow}>
      {isX ? (
        <View style={styles.xBadge}>
          <Text style={styles.xBadgeText}>𝕏</Text>
        </View>
      ) : null}
      <Text style={styles.metaSource} numberOfLines={1}>
        {story.source}
      </Text>
      {time ? <Text style={styles.metaDim}>· {time}</Text> : null}
      {extra > 0 ? (
        <View style={styles.sourcesPill}>
          <Ionicons name="layers-outline" size={10} color={colors.textSecondary} />
          <Text style={styles.sourcesPillText}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

function HeroStory({
  story,
  now,
  onOpenStory,
  onOpenStock,
}: {
  story: NewsStory;
  now: number;
  onOpenStory: (story: NewsStory) => void;
  onOpenStock: (stock: Stock) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={`Top story: ${story.title}`}
      onPress={() => onOpenStory(story)}
      scaleTo={0.985}
      style={styles.hero}
    >
      {story.imageUrl ? (
        <Image
          source={{ uri: story.imageUrl }}
          style={styles.heroImage}
          contentFit="cover"
          transition={180}
          accessible={false}
        />
      ) : null}
      <View style={styles.heroBody}>
        <Text style={styles.heroKicker}>Top story</Text>
        <Text style={styles.heroHeadline} numberOfLines={4}>
          {story.title}
        </Text>
        <StoryMeta story={story} now={now} />
        {story.related.length > 0 ? (
          <View style={styles.chipRow}>
            {story.related.slice(0, 3).map((stock) => (
              <NewsTickerChip key={stock.id} stock={stock} onPress={onOpenStock} size="md" />
            ))}
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

const StoryRow = React.memo(function StoryRow({
  story,
  now,
  onOpenStory,
  onOpenStock,
}: {
  story: NewsStory;
  now: number;
  onOpenStory: (story: NewsStory) => void;
  onOpenStock: (stock: Stock) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const lead = story.related[0];

  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={`Open story: ${story.title}`}
        onPress={() => onOpenStory(story)}
        scaleTo={0.985}
        style={styles.rowMain}
      >
        <View style={styles.rowCopy}>
          <StoryMeta story={story} now={now} />
          <Text style={styles.rowHeadline} numberOfLines={3}>
            {story.title}
          </Text>
        </View>
        {story.imageUrl ? (
          <Image
            source={{ uri: story.imageUrl }}
            style={styles.thumb}
            contentFit="cover"
            transition={150}
            recyclingKey={story.id}
            accessible={false}
          />
        ) : lead ? (
          <View style={styles.thumbFallback}>
            <AssetLogo
              uri={lead.icon}
              size={36}
              borderRadius={18}
              backgroundColor={colors.surface}
              fallback={
                <Text style={styles.thumbFallbackText}>
                  {lead.symbol.slice(0, 1).toUpperCase()}
                </Text>
              }
            />
          </View>
        ) : null}
      </PressableScale>
      {story.related.length > 0 ? (
        <View style={styles.chipRow}>
          {story.related.slice(0, 3).map((stock) => (
            <NewsTickerChip key={stock.id} stock={stock} onPress={onOpenStock} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function FeedSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessibilityLabel="Loading news" style={styles.skeletonWrap}>
      <View style={styles.skeletonHero} />
      <View style={[styles.skeletonLine, { width: "88%", marginTop: 16 }]} />
      <View style={[styles.skeletonLine, { width: "62%" }]} />
      {Array.from({ length: 4 }).map((_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonRowCopy}>
            <View style={[styles.skeletonLine, { width: "34%", height: 10 }]} />
            <View style={[styles.skeletonLine, { width: "96%" }]} />
            <View style={[styles.skeletonLine, { width: "70%" }]} />
          </View>
          <View style={styles.skeletonThumb} />
        </View>
      ))}
    </View>
  );
}

/**
 * News tab — the whole wire, not a sample. Every story from the feed (up to 50,
 * with outlets that ran the same event folded into one row) in time sections,
 * led by the freshest story with artwork.
 */
export function NewsFeed({
  stories,
  loading,
  refreshing,
  onRefresh,
  bottomInset,
  onOpenStory,
  onOpenStock,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  // One clock per render so every "3h" on screen agrees.
  const now = useMemo(() => Date.now(), [stories]); // eslint-disable-line react-hooks/exhaustive-deps

  // The lead is a fresh story with artwork, from near the top — a six-hour-old
  // picture shouldn't outrank what just crossed the wire. One that names a
  // tradeable asset wins over one that doesn't: the lead should be actionable.
  const hero = useMemo(() => {
    const recent = stories.slice(0, 6);
    return (
      recent.find((s) => s.imageUrl && s.related.length > 0) ??
      recent.slice(0, 4).find((s) => s.imageUrl) ??
      null
    );
  }, [stories]);

  const sections = useMemo<NewsSection[]>(
    () => sectionNewsStories(hero ? stories.filter((s) => s !== hero) : stories, now),
    [stories, hero, now],
  );

  const openStory = useCallback(
    (story: NewsStory) => {
      void Haptics.selectionAsync();
      onOpenStory(story);
    },
    [onOpenStory],
  );

  if (loading && stories.length === 0) {
    return <FeedSkeleton />;
  }

  if (stories.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Ionicons name="newspaper-outline" size={28} color={colors.textTertiary} />
        <Text style={styles.emptyTitle}>No stories right now</Text>
        <Text style={styles.emptyBody}>
          Market news and posts from @tokens land here as they break.
        </Text>
        <PressableScale
          accessibilityRole="button"
          onPress={onRefresh}
          style={styles.emptyButton}
        >
          <Text style={styles.emptyButtonText}>Refresh</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(story) => story.id}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      initialNumToRender={8}
      windowSize={9}
      contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View>
          {hero ? (
            <Animated.View entering={FadeIn.duration(220)}>
              <HeroStory
                story={hero}
                now={now}
                onOpenStory={openStory}
                onOpenStock={onOpenStock}
              />
            </Animated.View>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        // A quiet divider label, not a headline: small, muted caps so it can
        // never be mistaken for a story.
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <StoryRow story={item} now={now} onOpenStory={openStory} onOpenStock={onOpenStock} />
      )}
      ListFooterComponent={
        <View style={styles.footer}>
          <Ionicons name="checkmark-circle" size={16} color={colors.textTertiary} />
          <Text style={styles.footerText}>
            You&apos;re caught up · {stories.length} {stories.length === 1 ? "story" : "stories"}
          </Text>
        </View>
      }
    />
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    listContent: {
      paddingHorizontal: 18,
      paddingTop: 4,
    },
    // Hero
    hero: {
      borderRadius: 22,
      overflow: "hidden",
      backgroundColor: c.surfaceAlt,
      marginBottom: 6,
    },
    heroImage: {
      width: "100%",
      aspectRatio: 16 / 9,
      backgroundColor: c.surfaceSelected,
    },
    heroBody: {
      padding: 16,
      gap: 10,
    },
    heroKicker: {
      color: c.actionPrimary,
      fontSize: 12,
      fontWeight: "800",
      fontFamily: F,
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    heroHeadline: {
      color: c.text,
      fontSize: 22,
      lineHeight: 27,
      fontWeight: "800",
      fontFamily: F,
      letterSpacing: -0.3,
    },
    // Sections
    sectionHeader: {
      paddingTop: 24,
      paddingBottom: 2,
    },
    sectionTitle: {
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: F,
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },
    // Rows
    row: {
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowMain: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 14,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
      gap: 6,
    },
    rowHeadline: {
      color: c.text,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "700",
      fontFamily: F,
    },
    thumb: {
      width: 76,
      height: 76,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
    },
    thumbFallback: {
      width: 76,
      height: 76,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    thumbFallbackText: {
      color: c.text,
      fontSize: 14,
      fontWeight: "900",
      fontFamily: F,
    },
    // Meta
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minWidth: 0,
    },
    xBadge: {
      width: 16,
      height: 16,
      borderRadius: 4,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.text,
    },
    xBadgeText: {
      color: c.background,
      fontSize: 10,
      fontWeight: "900",
    },
    metaSource: {
      flexShrink: 1,
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: F,
    },
    metaDim: {
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: "600",
      fontFamily: F,
    },
    sourcesPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 6,
      height: 18,
      borderRadius: 9,
      backgroundColor: c.surfaceAlt,
    },
    sourcesPillText: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: F,
    },
    // Chips
    chipRow: {
      marginTop: 10,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    chip: {
      height: 30,
      borderRadius: 15,
      paddingLeft: 7,
      paddingRight: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.surfaceAlt,
    },
    chipMd: {
      height: 34,
      borderRadius: 17,
      backgroundColor: c.background,
    },
    chipLogoFallback: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceSelected,
    },
    chipLogoFallbackText: {
      color: c.text,
      fontSize: 9,
      fontWeight: "900",
    },
    chipSymbol: {
      color: c.text,
      fontSize: 12,
      fontWeight: "800",
      fontFamily: F,
    },
    chipChange: {
      fontSize: 12,
      fontWeight: "800",
      fontFamily: Fonts.displayMedium,
      fontVariant: ["tabular-nums"],
    },
    // Footer
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 28,
    },
    footerText: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: F,
    },
    // Empty
    emptyWrap: {
      alignItems: "center",
      paddingTop: 80,
      paddingHorizontal: 36,
      gap: 8,
    },
    emptyTitle: {
      marginTop: 4,
      color: c.text,
      fontSize: 18,
      fontWeight: "800",
      fontFamily: F,
    },
    emptyBody: {
      color: c.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      fontFamily: F,
    },
    emptyButton: {
      marginTop: 10,
      height: 40,
      paddingHorizontal: 20,
      borderRadius: 20,
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    emptyButtonText: {
      color: c.text,
      fontSize: 14,
      fontWeight: "800",
      fontFamily: F,
    },
    // Skeleton
    skeletonWrap: {
      paddingHorizontal: 18,
      paddingTop: 50,
    },
    skeletonHero: {
      width: "100%",
      aspectRatio: 16 / 11,
      borderRadius: 22,
      backgroundColor: c.surfaceAlt,
    },
    skeletonLine: {
      height: 14,
      borderRadius: 7,
      marginTop: 8,
      backgroundColor: c.surfaceAlt,
    },
    skeletonRow: {
      flexDirection: "row",
      gap: 14,
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    skeletonRowCopy: {
      flex: 1,
    },
    skeletonThumb: {
      width: 76,
      height: 76,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
    },
  });
