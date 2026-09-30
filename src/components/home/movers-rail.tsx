import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { GlassSegmentedControl } from '@/components/glass-segmented-control';
import { SectionHeader } from '@/components/section-header';
import { Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Stock } from '@/lib/api';
import type { ZoomSourceRect } from '@/lib/zoom-transition';

import { ASSET_TILE_HEIGHT, ASSET_TILE_WIDTH, AssetTile } from './asset-tile';

export const MOVER_DIRECTIONS = ['Gainers', 'Losers'] as const;
export type MoverDirection = (typeof MOVER_DIRECTIONS)[number];

type Props = {
  gainers: Stock[];
  losers: Stock[];
  loading: boolean;
  onSelect: (stock: Stock, source: ZoomSourceRect | null) => void;
};

/**
 * 24h top movers. The Gainers/Losers picker is floating chrome so it gets the
 * glass treatment; the tiles sit on raised white surfaces for clear separation
 * from the portfolio canvas.
 *
 * Failure is deliberately silent — see `MoversRail` usage in the home screen.
 * Movers are ambient discovery, so an error renders nothing rather than an
 * error card competing with the user's actual portfolio.
 */
export function MoversRail({ gainers, losers, loading, onSelect }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [direction, setDirection] = useState<MoverDirection>('Gainers');

  const stocks = direction === 'Gainers' ? gainers : losers;

  if (!loading && stocks.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader
        variant="quiet"
        title="Movers"
        accessory={
          <GlassSegmentedControl
            options={MOVER_DIRECTIONS}
            value={direction}
            onChange={setDirection}
            accessibilityLabel="Movers direction"
          />
        }
      />
      {loading ? (
        <View style={styles.rail}>
          {Array.from({ length: 3 }).map((_, index) => (
            <View
              key={index}
              accessibilityLabel="Loading movers"
              style={styles.skeletonTile}
            />
          ))}
        </View>
      ) : (
        /* Animation lives on the tile list, never wrapping the glass picker
           above — native glass layers can't be transformed by an animated
           parent. */
        <Animated.View entering={FadeIn.delay(60).reduceMotion(ReduceMotion.System)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.railContent}
            style={styles.railBleed}
          >
            {stocks.map((stock) => (
              <AssetTile
                key={stock.id}
                stock={stock}
                onPress={(selected, source) => onSelect(selected, source ?? null)}
                raised
                zoomSource
              />
            ))}
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Tier spacing is owned by the home screen — see `HomeScreen`.
    section: {},
    // Bleed the rail to the screen edges while keeping the first tile aligned
    // with the page's 24pt gutter (same trick the search screen uses).
    railBleed: {
      marginHorizontal: -24,
    },
    railContent: {
      paddingHorizontal: 24,
      paddingVertical: 12,
      gap: 12,
    },
    rail: {
      flexDirection: 'row',
      gap: 12,
    },
    skeletonTile: {
      width: ASSET_TILE_WIDTH,
      height: ASSET_TILE_HEIGHT,
      borderRadius: Radius.xl,
      backgroundColor: c.surfaceAlt,
    },
  });
