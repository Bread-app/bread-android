import React, { useId, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { PressableScale } from '@/components/pressable-scale';
import { SectionHeader } from '@/components/section-header';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  NATIVE_ZOOM_SOURCE_TEST_ID,
  useIsNativeZoomSource,
} from '@/lib/native-zoom';
import { useThemeStore } from '@/lib/theme-store';
import type { NewsItem, Stock } from '@/lib/api';
import { measureZoomSource, type ZoomSourceRect } from '@/lib/zoom-transition';

const F = Fonts.rounded;

export type MarketMovingStory = {
  item: NewsItem;
  related: Stock[];
};

type Props = {
  stories: MarketMovingStory[];
  loading: boolean;
  failed: boolean;
  onOpenStory: (item: NewsItem) => void;
  onOpenStock: (
    stock: Stock,
    source: ZoomSourceRect | null,
    nativeSourceKey: string,
  ) => void;
  onRetry: () => void;
};

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(then);
}

function formatChange(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function relevantImage(item: NewsItem): string | null {
  const image = item.imageUrl?.trim();
  if (!image) return null;
  if (item.feedSource === 'x' && /profile[_-]?images|default[_-]?profile|avatar/i.test(image)) {
    return null;
  }
  return image;
}

function NewsAssetChip({
  stock,
  onOpenStock,
}: {
  stock: Stock;
  onOpenStock: Props['onOpenStock'];
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const chipRef = useRef<View>(null);
  const nativeSourceKey = `home-news-${useId()}`;
  const isNativeZoomSource = useIsNativeZoomSource(nativeSourceKey);
  const change = stock.priceChange24h;

  return (
    <View
      ref={chipRef}
      collapsable={false}
      testID={isNativeZoomSource ? NATIVE_ZOOM_SOURCE_TEST_ID : undefined}
      style={styles.assetChipZoomSource}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Open ${stock.name}, ${formatChange(change)} today`}
        onPress={() => {
          void measureZoomSource(chipRef, Radius.sm).then((source) =>
            onOpenStock(stock, source, nativeSourceKey),
          );
        }}
        scaleTo={0.96}
        style={styles.assetChip}
      >
        <Text style={styles.assetSymbol} numberOfLines={1}>{stock.symbol}</Text>
        <Text
          style={[
            styles.assetChange,
            { color: change === null ? colors.textTertiary : change >= 0 ? colors.positive : colors.negative },
          ]}
        >
          {formatChange(change)}
        </Text>
      </PressableScale>
    </View>
  );
}

function StoryRow({
  story,
  onOpenStory,
  onOpenStock,
}: {
  story: MarketMovingStory;
  onOpenStory: (item: NewsItem) => void;
  onOpenStock: Props['onOpenStock'];
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { item, related } = story;
  const source = item.sourceName ?? (item.feedSource === 'x' ? 'X' : 'Market news');
  const time = relativeTime(item.postedAt);
  const imageUrl = relevantImage(item);

  return (
    <View style={styles.story}>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={`Open story: ${item.title}`}
        onPress={() => onOpenStory(item)}
        scaleTo={0.985}
        style={styles.storyMain}
      >
        <View style={styles.storyCopy}>
          <Text style={styles.headline} numberOfLines={3}>
            {item.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {source}{time ? ` · ${time}` : ''}
          </Text>
        </View>
        {imageUrl ? (
          <Image accessible={false} source={{ uri: imageUrl }} style={styles.thumbnail} />
        ) : related[0] ? (
          <View style={styles.thumbnailFallback}>
            <AssetLogo
              uri={related[0].icon}
              size={38}
              borderRadius={19}
              backgroundColor={colors.surface}
              fallback={
                <Text style={styles.thumbnailFallbackText}>
                  {related[0].symbol.slice(0, 1).toUpperCase()}
                </Text>
              }
            />
          </View>
        ) : null}
      </PressableScale>

      {related.length > 0 ? (
        <View style={styles.chipRow}>
          {related.slice(0, 3).map((stock) => {
            return (
              <NewsAssetChip
                key={stock.id}
                stock={stock}
                onOpenStock={onOpenStock}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function MarketNewsSection({
  stories,
  loading,
  failed,
  onOpenStory,
  onOpenStock,
  onRetry,
}: Props) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.section}>
      {/* "Today" rather than "Daily brief / What moved the market": Movers
          answers the same question one section below, so the two only stop
          reading as duplicates if this one owns the shorter, plainer name. */}
      <SectionHeader variant="quiet" title="Today" />

      {loading && stories.length === 0 ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: 3 }).map((_, index) => (
            <View key={index} accessibilityLabel="Loading market news" style={styles.skeletonRow} />
          ))}
        </View>
      ) : failed && stories.length === 0 ? (
        <View style={styles.noticeRow}>
          <Text style={styles.notice}>Couldn&apos;t load the market brief.</Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry market brief"
            onPress={onRetry}
            style={styles.actionButton}
          >
            <Text style={styles.noticeAction}>Try again</Text>
          </PressableScale>
        </View>
      ) : stories.length === 0 ? (
        <Text style={styles.notice}>No major market stories yet. Check back after the next move.</Text>
      ) : (
        <View>
          {stories.map((story) => (
            <StoryRow
              key={`${story.item.url}-${story.item.postedAt ?? ''}`}
              story={story}
              onOpenStory={onOpenStory}
              onOpenStock={onOpenStock}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Tier spacing is owned by the home screen — see `HomeScreen`.
    section: {},
    story: {
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    storyMain: {
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    storyCopy: {
      flex: 1,
      minWidth: 0,
    },
    headline: {
      color: c.text,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '800',
      fontFamily: F,
    },
    meta: {
      marginTop: 7,
      color: c.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      fontFamily: F,
    },
    thumbnail: {
      width: 72,
      height: 72,
      borderRadius: Radius.md,
      backgroundColor: c.surfaceAlt,
    },
    thumbnailFallback: {
      width: 72,
      height: 72,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    thumbnailFallbackText: {
      color: c.text,
      fontSize: 14,
      fontWeight: '900',
      fontFamily: F,
    },
    chipRow: {
      marginTop: 12,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    assetChip: {
      minHeight: 40,
      borderRadius: Radius.sm,
      paddingHorizontal: 11,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: c.surfaceAlt,
    },
    assetChipZoomSource: {
      borderRadius: Radius.sm,
    },
    assetSymbol: {
      color: c.text,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '800',
      fontFamily: F,
    },
    assetChange: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '900',
      fontFamily: Fonts.displayMedium,
      fontVariant: ['tabular-nums'],
    },
    skeletonList: {
      gap: 1,
    },
    skeletonRow: {
      height: 108,
      borderRadius: Radius.lg,
      backgroundColor: c.surfaceAlt,
    },
    noticeRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    notice: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      fontFamily: F,
    },
    actionButton: {
      minHeight: 44,
      justifyContent: 'center',
    },
    noticeAction: {
      color: c.actionPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
      fontFamily: F,
    },
  });
