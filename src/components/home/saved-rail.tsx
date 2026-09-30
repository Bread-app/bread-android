import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { SectionHeader } from '@/components/section-header';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import type { Sandwich, Stock } from '@/lib/api';

import { ASSET_TILE_HEIGHT, AssetTile } from './asset-tile';

const F = Fonts.rounded;

const SANDWICH_TILE_WIDTH = 220;

/** Combined cap across both kinds — Home previews, the Saved screen is the list. */
const MAX_ITEMS = 8;

type Props = {
  sandwiches: Sandwich[];
  stocks: Stock[];
  loading: boolean;
  failed: boolean;
  onSeeAll: () => void;
  onSelectSandwich: (sandwich: Sandwich) => void;
  onSelectStock: (stock: Stock) => void;
  onRetry: () => void;
};

function SandwichTile({
  sandwich,
  onPress,
}: {
  sandwich: Sandwich;
  onPress: (sandwich: Sandwich) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  const pnl = sandwich.pnlStatus === 'unavailable' ? null : sandwich.pnlPct;
  const pnlColor = pnl === null ? colors.textTertiary : pnl >= 0 ? colors.positive : colors.negative;
  const legCount = sandwich.legs.length;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Open sandwich ${sandwich.name}`}
      scaleTo={0.96}
      onPress={() => onPress(sandwich)}
      style={styles.sandwichTile}
    >
      <Text style={styles.sandwichName} numberOfLines={2}>
        {sandwich.name}
      </Text>
      <View style={styles.sandwichFooter}>
        <Text style={styles.sandwichLegs}>
          {legCount} {legCount === 1 ? 'leg' : 'legs'}
        </Text>
        <View style={styles.pnlPill}>
          <Text style={[styles.pnlText, { color: pnlColor }]}>
            {pnl === null ? '--' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

/**
 * Compact Saved preview. Replaces the old stacked full-width card list: Saved
 * is a self-curated, low-frequency list, so on Home it earns one rail and a
 * link to the real Saved screen rather than the bottom half of the page.
 */
export function SavedRail({
  sandwiches,
  stocks,
  loading,
  failed,
  onSeeAll,
  onSelectSandwich,
  onSelectStock,
  onRetry,
}: Props) {
  const styles = useThemedStyles(makeStyles);

  const visibleSandwiches = sandwiches.slice(0, MAX_ITEMS);
  const visibleStocks = stocks.slice(0, Math.max(0, MAX_ITEMS - visibleSandwiches.length));
  const isEmpty = !loading && !failed && visibleSandwiches.length === 0 && visibleStocks.length === 0;

  return (
    <View style={styles.section}>
      <SectionHeader title="Saved" onSeeAll={isEmpty ? undefined : onSeeAll} />

      {loading ? (
        <View style={styles.rail}>
          {Array.from({ length: 2 }).map((_, index) => (
            <View key={index} accessibilityLabel="Loading saved items" style={styles.skeletonTile} />
          ))}
        </View>
      ) : failed ? (
        <View style={styles.noticeRow}>
          <Text style={styles.notice}>Couldn&apos;t load saved items.</Text>
          <Text
            accessibilityRole="button"
            accessibilityLabel="Retry saved items"
            onPress={onRetry}
            style={styles.noticeAction}
          >
            Try again
          </Text>
        </View>
      ) : isEmpty ? (
        <Text style={styles.notice}>
          Bookmark a sandwich or asset and it will show up here.
        </Text>
      ) : (
        <Animated.View entering={FadeIn.delay(120).reduceMotion(ReduceMotion.System)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.railContent}
            style={styles.railBleed}
          >
            {visibleSandwiches.map((sandwich) => (
              <SandwichTile key={sandwich.id} sandwich={sandwich} onPress={onSelectSandwich} />
            ))}
            {visibleStocks.map((stock) => (
              <AssetTile key={stock.id} stock={stock} onPress={onSelectStock} />
            ))}
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: {
      marginTop: 44,
    },
    railBleed: {
      marginHorizontal: -24,
    },
    railContent: {
      paddingHorizontal: 24,
      gap: 12,
    },
    rail: {
      flexDirection: 'row',
      gap: 12,
    },
    skeletonTile: {
      width: SANDWICH_TILE_WIDTH,
      height: ASSET_TILE_HEIGHT,
      borderRadius: Radius.xl,
      backgroundColor: c.surfaceAlt,
    },
    sandwichTile: {
      width: SANDWICH_TILE_WIDTH,
      height: ASSET_TILE_HEIGHT,
      borderRadius: Radius.xl,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 16,
      paddingVertical: 14,
      justifyContent: 'space-between',
    },
    sandwichName: {
      color: c.text,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
      fontFamily: F,
    },
    sandwichFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    sandwichLegs: {
      color: c.textTertiary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      fontFamily: F,
    },
    pnlPill: {
      borderRadius: Radius.sm,
      backgroundColor: c.surface,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    pnlText: {
      fontSize: 12,
      lineHeight: 15,
      fontWeight: '800',
      fontFamily: Fonts.displayMedium,
      fontVariant: ['tabular-nums'],
    },
    noticeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    notice: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      fontFamily: F,
    },
    noticeAction: {
      color: c.actionPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
      fontFamily: F,
    },
  });
