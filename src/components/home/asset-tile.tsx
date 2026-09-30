import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { AssetPriceText } from '@/components/asset-price-text';
import { PressableScale } from '@/components/pressable-scale';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  NATIVE_ZOOM_SOURCE_TEST_ID,
  useIsNativeZoomSource,
} from '@/lib/native-zoom';
import { useThemeStore } from '@/lib/theme-store';
import type { Stock } from '@/lib/api';
import { measureZoomSource, type ZoomSourceRect } from '@/lib/zoom-transition';

const F = Fonts.rounded;

export const ASSET_TILE_WIDTH = 150;
// Tall enough to stack price over change: four-figure prices ($2,417.30) and
// three-digit percentages can't share a 150pt row without truncating.
export const ASSET_TILE_HEIGHT = 146;

function formatPrice(value: number | null): string {
  if (value === null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatPct(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

type Props = {
  stock: Stock;
  onPress: (stock: Stock, source?: ZoomSourceRect | null) => void;
  /** Raised white-surface treatment used by the homepage movers rail. */
  raised?: boolean;
  /** Measure and mark this card as the source of the stock-detail zoom. */
  zoomSource?: boolean;
};

/**
 * Compact asset tile for horizontal rails. Deliberately not `StockCard` — that
 * is a full-width stacked card with its own shadow, which doesn't survive being
 * squeezed into a rail. Flat `surfaceAlt` fill, no glass: this is content, and
 * glass belongs on floating chrome only.
 */
export function AssetTile({ stock, onPress, raised = false, zoomSource = false }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const tileRef = useRef<View>(null);
  const isNativeZoomSource = useIsNativeZoomSource(stock.id);

  const change = stock.priceChange24h;
  const changeColor =
    change === null ? colors.textTertiary : change >= 0 ? colors.positive : colors.negative;

  const tile = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Open ${stock.name}, ${formatPrice(stock.usdPrice)}, ${formatPct(change)}`}
      scaleTo={0.96}
      onPress={() => {
        if (!zoomSource) {
          onPress(stock);
          return;
        }

        void measureZoomSource(tileRef, Radius.xl).then((source) =>
          onPress(stock, source),
        );
      }}
      style={[styles.tile, raised && styles.raisedTile]}
    >
      <AssetLogo
        uri={stock.icon}
        size={36}
        borderRadius={18}
        backgroundColor={colors.surface}
        fallback={
          <View style={styles.iconFallback}>
            <Text style={styles.iconFallbackText}>
              {(stock.symbol || stock.name).slice(0, 1).toUpperCase()}
            </Text>
          </View>
        }
      />
      <View style={styles.copy}>
        <Text style={styles.symbol} numberOfLines={1}>
          {stock.symbol}
        </Text>
        <Text style={styles.name} numberOfLines={1}>
          {stock.name}
        </Text>
      </View>
      <View style={styles.footer}>
        <AssetPriceText
          label={formatPrice(stock.usdPrice)}
          size={15}
          lineHeight={19}
          style={styles.price}
        />
        <Text style={[styles.change, { color: changeColor }]} numberOfLines={1}>
          {formatPct(change)}
        </Text>
      </View>
    </PressableScale>
  );

  if (!zoomSource) return tile;

  return (
    <View
      ref={tileRef}
      collapsable={false}
      testID={isNativeZoomSource ? NATIVE_ZOOM_SOURCE_TEST_ID : undefined}
      style={styles.zoomSource}
    >
      {tile}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    tile: {
      width: ASSET_TILE_WIDTH,
      height: ASSET_TILE_HEIGHT,
      borderRadius: Radius.xl,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: 14,
      paddingVertical: 13,
      justifyContent: 'space-between',
    },
    zoomSource: {
      width: ASSET_TILE_WIDTH,
      height: ASSET_TILE_HEIGHT,
      borderRadius: Radius.xl,
    },
    raisedTile: {
      backgroundColor: c.surface,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.14,
      shadowRadius: 14,
      elevation: 5,
    },
    iconFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
    },
    iconFallbackText: {
      color: c.text,
      fontSize: 13,
      fontWeight: '900',
      fontFamily: F,
    },
    copy: {
      minWidth: 0,
    },
    symbol: {
      color: c.text,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '800',
      fontFamily: F,
    },
    name: {
      marginTop: 1,
      color: c.textTertiary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
      fontFamily: F,
    },
    footer: {
      gap: 1,
    },
    price: {
      color: c.text,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '800',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    change: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '800',
      fontFamily: Fonts.displayMedium,
      fontVariant: ['tabular-nums'],
    },
  });
