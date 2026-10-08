import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { View as ViewType } from 'react-native';

import { HyperliquidCoinLogo } from '@/components/hyperliquid-logo';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { HyperliquidMarket } from '@/lib/hyperliquid-api';
import { hyperliquidChangePercent, hyperliquidPerpOnlyStock } from '@/lib/hyperliquid-perp-market';
import { NATIVE_ZOOM_SOURCE_TEST_ID, useIsNativeZoomSource } from '@/lib/native-zoom';
import { useThemeStore } from '@/lib/theme-store';
import { measureZoomSource, type ZoomSourceRect } from '@/lib/zoom-transition';

/** Matches the card's corner radius, so the zoom grows out of the exact shape. */
const CARD_RADIUS = 20;

const F = Fonts.rounded;

/**
 * A Hyperliquid market in a browse list — the same card as a Phoenix perp's,
 * with the venue named under the ticker. Prices come with the list read (one
 * catalog call prices every row), so there's no per-row skeleton.
 */
export function HyperliquidMarketCard({
  market,
  onPress,
}: {
  market: HyperliquidMarket;
  /** Gets the row's measured rect, so the full-screen market zooms out of it. */
  onPress: (market: HyperliquidMarket, source: ZoomSourceRect | null) => void;
}) {
  const cardRef = useRef<ViewType>(null);
  const isZoomSource = useIsNativeZoomSource(hyperliquidPerpOnlyStock(market).id);
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const change = hyperliquidChangePercent(market);
  const venue = market.dex ? `Hyperliquid · ${market.dex}` : 'Hyperliquid';

  return (
    <Pressable
      ref={cardRef}
      testID={isZoomSource ? NATIVE_ZOOM_SOURCE_TEST_ID : undefined}
      onPress={() => {
        void measureZoomSource(cardRef, CARD_RADIUS).then((source) => onPress(market, source));
      }}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.mainRow}>
        {/* Hyperliquid's own artwork: it covers every market it lists, stocks
            included, where the ticker-based CDNs miss most of them. */}
        <HyperliquidCoinLogo
          coin={market.coin}
          label={market.symbol}
          size={44}
          backgroundColor={colors.surfaceAlt}
          letterColor={colors.text}
        />
        <View style={styles.identityCol}>
          <Text style={styles.symbol} numberOfLines={1}>
            {market.symbol}
          </Text>
          <View style={styles.subRow}>
            <Text style={styles.venue} numberOfLines={1}>
              {venue}
            </Text>
            <View style={styles.levBadge}>
              <Text style={styles.levText}>{market.maxLeverage}x</Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.rightCol}>
        <Text style={styles.priceValue}>{formatPrice(market.markPx)}</Text>
        <Text
          style={[
            styles.change,
            {
              color:
                change === null || change === 0
                  ? colors.textTertiary
                  : change > 0
                    ? colors.chartPositive
                    : colors.chartNegative,
            },
          ]}
        >
          {change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
        </Text>
      </View>
    </Pressable>
  );
}

function formatPrice(value: number): string {
  // Sub-dollar coins need the extra digits; everything else reads in cents.
  const digits = value < 1 ? 5 : 2;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      paddingVertical: 16,
      paddingHorizontal: 16,
      marginBottom: 12,
      borderRadius: 20,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      shadowColor: c.shadow,
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },
    cardPressed: { transform: [{ scale: 0.97 }] },
    mainRow: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1, minWidth: 0 },
    identityCol: { flex: 1, minWidth: 0 },
    symbol: { color: c.text, fontWeight: '800', fontSize: 17, lineHeight: 21, fontFamily: F },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    venue: { color: c.textTertiary, fontSize: 12, fontWeight: '500', fontFamily: F },
    levBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: c.surfaceAlt },
    levText: { color: c.textSecondary, fontSize: 10, fontWeight: '800', fontFamily: F },
    rightCol: { alignItems: 'flex-end', marginLeft: 8, gap: 2 },
    priceValue: { color: c.text, fontSize: 20, fontWeight: '700', fontFamily: F, fontVariant: ['tabular-nums'] },
    change: { fontSize: 13, fontWeight: '700', fontFamily: F, fontVariant: ['tabular-nums'] },
  });
