import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { ValueSkeletonLine } from '@/components/value-skeleton';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { PhoenixChange24h, PhoenixMarket } from '@/lib/phoenix-api';
import { perpLogoSources } from '@/lib/stock-logos';

const F = Fonts.rounded;

type Props = {
  market: PhoenixMarket;
  /** Live mark price. `null` while the first poll is in flight. */
  price: number | null;
  /** 24h move, shown under the price in the gain/loss colour. */
  change?: PhoenixChange24h | null;
  onPress?: (market: PhoenixMarket) => void;
};

/**
 * A Phoenix perp in a search result list.
 *
 * Deliberately shaped like [StockCard](./stock-card.tsx) — same 44px logo, same
 * identity column, same right-aligned tabular price — so a perp and a spot row
 * read as the same kind of thing in one list. The differences that matter are
 * carried by a leverage badge and the "Perp" label, not by a different layout.
 *
 * The price shown is the **mark price**, which is what drives PnL and
 * liquidation, and what the detail chart plots.
 */
export function PhoenixMarketCard({ market, price, change = null, onPress }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  const content = (
    <>
      <View style={styles.mainRow}>
        <AssetLogo
          {...perpLogoSources(market)}
          size={44}
          borderRadius={22}
          backgroundColor={colors.surfaceAlt}
          fallback={
            <View style={styles.iconFallback}>
              <Text style={styles.iconFallbackText}>{market.symbol.slice(0, 1)}</Text>
            </View>
          }
        />
        <View style={styles.identityCol}>
          <Text style={styles.symbol} numberOfLines={1}>
            {market.name}
          </Text>
          <View style={styles.subRow}>
            <Text style={styles.name} numberOfLines={1}>
              {market.symbol}
            </Text>
            <View style={styles.levBadge}>
              <Text style={styles.levText}>{market.maxLeverage}x</Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.rightCol}>
        {/* A skeleton rather than a zero while the first price is in flight: a
            perp priced at $0.00 reads as a broken market, and a dash reads as
            an unpriced one. */}
        {price === null ? (
          <ValueSkeletonLine lineHeight={24} width={84} accessibilityLabel="Loading price" />
        ) : (
          <Text style={styles.priceValue}>{formatUsd(price)}</Text>
        )}
        {change === null ? (
          <ValueSkeletonLine lineHeight={17} width={50} accessibilityLabel="Loading 24 hour change" />
        ) : (
          <Text
            style={[
              styles.change,
              {
                color:
                  change.changePercent === 0
                    ? colors.textTertiary
                    : change.changePercent > 0
                      ? colors.chartPositive
                      : colors.chartNegative,
              },
            ]}
          >
            {`${change.changePercent >= 0 ? '+' : ''}${change.changePercent.toFixed(2)}%`}
          </Text>
        )}
      </View>
    </>
  );

  if (!onPress) return <View style={styles.card}>{content}</View>;

  return (
    <Pressable
      onPress={() => onPress(market)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {content}
    </Pressable>
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
    iconFallback: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconFallbackText: { color: c.textInverse, fontSize: 12, fontWeight: '700', fontFamily: F },
    identityCol: { flex: 1, minWidth: 0 },
    symbol: { color: c.text, fontWeight: '800', fontSize: 17, lineHeight: 21, fontFamily: F },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    name: { color: c.textTertiary, fontSize: 12, fontWeight: '500', fontFamily: F },
    levBadge: {
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 5,
      backgroundColor: c.surfaceAlt,
    },
    levText: { color: c.textSecondary, fontSize: 10, fontWeight: '800', fontFamily: F },
    rightCol: { alignItems: 'flex-end', marginLeft: 8, gap: 2 },
    priceValue: {
      color: c.text,
      fontSize: 20,
      fontWeight: '700',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    change: {
      fontSize: 13,
      fontWeight: '800',
      fontFamily: Fonts.displayMedium,
      fontVariant: ['tabular-nums'],
    },
  });
