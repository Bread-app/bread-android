import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AssetLogo } from '@/components/asset-logo';
import { AssetPriceText } from '@/components/asset-price-text';
import { Stock } from '@/lib/api';
import { cleanStockName } from '@/lib/stock-name';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  NATIVE_ZOOM_SOURCE_TEST_ID,
  useIsNativeZoomSource,
} from '@/lib/native-zoom';
import { measureZoomSource, type ZoomSourceRect } from '@/lib/zoom-transition';

const F = Fonts.rounded;

/** Matches the card's own corner radius, so a zoom starts with the same corners. */
const CARD_RADIUS = 20;

type StockCardProps = {
  stock: Stock;
  rank?: number;
  /**
   * The row measures itself before handing control over, so a caller that opens
   * the zooming asset screen can grow it out of this exact rect. Callers that
   * present some other way simply ignore the second argument.
   */
  onPress?: (stock: Stock, source: ZoomSourceRect | null) => void;
};

function formatChange(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function changeColor(value: number | null): string {
  if (value === null || value === 0) {
    return '#000000';
  }

  return value > 0 ? '#35F046' : '#FF1F4B';
}

function cleanStockSymbol(symbol: string): string {
  return symbol.replace(/(ON|X)$/i, '').trim() || symbol;
}

const COMPANY_NAME_OVERRIDES: Record<string, string> = {
  TSLA: 'Tesla',
  AAPL: 'Apple',
  AMZN: 'Amazon',
  GOOGL: 'Google',
  GOOG: 'Google',
  META: 'Meta',
  MSFT: 'Microsoft',
  NVDA: 'Nvidia',
};

function getDisplayName(stock: Stock): string {
  if (stock.type === 'token') return stock.name.trim() || stock.symbol.trim().toUpperCase();
  const ticker = cleanStockSymbol(stock.symbol).toUpperCase();
  return COMPANY_NAME_OVERRIDES[ticker] ?? (cleanStockName(stock.name) || ticker);
}

export function StockCard({ stock, onPress }: StockCardProps) {
  const styles = useThemedStyles(makeStyles);
  const cardRef = useRef<View>(null);
  // Marked only while this row is the one being opened — the native patch finds
  // the source view by this identifier, so exactly one row may carry it.
  const isZoomSource = useIsNativeZoomSource(stock.id);
  const { colors } = useThemeStore();
  const trendColor = changeColor(stock.priceChange24h);
  const displayName = getDisplayName(stock);
  const displaySymbol =
    stock.type === 'token'
      ? stock.symbol.trim().toUpperCase()
      : cleanStockSymbol(stock.symbol).toUpperCase();

  const formattedPrice =
    stock.usdPrice === null
      ? 'N/A'
      : new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: stock.usdPrice < 1 ? 4 : 2,
          maximumFractionDigits: stock.usdPrice < 1 ? 6 : 2,
        }).format(stock.usdPrice);

  const content = (
    <>
      <View style={styles.mainRow}>
        <AssetLogo
          uri={stock.icon}
          size={44}
          borderRadius={22}
          backgroundColor={colors.surfaceAlt}
          fallback={
            <View style={styles.iconFallback}>
              <Text style={styles.iconFallbackText}>{displayName.slice(0, 1)}</Text>
            </View>
          }
        />
        <View style={styles.identityCol}>
          <Text style={styles.symbol} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.name} numberOfLines={1}>{displaySymbol}</Text>
        </View>
      </View>
      <View style={styles.rightCol}>
        <View style={styles.priceRow}>
          <AssetPriceText
            label={formattedPrice}
            size={20}
            lineHeight={24}
            style={styles.priceValue}
          />
          <Text style={[styles.changeText, { color: trendColor }]}>
            {formatChange(stock.priceChange24h)}
          </Text>
        </View>
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.card}>{content}</View>;
  }

  // Lightweight "push back" feedback: a discrete scale on the pressed state.
  // No animation library, no extra views, no per-card Animated.Value — so it
  // adds zero overhead to the (non-virtualized) home list.
  return (
    <Pressable
      ref={cardRef}
      testID={isZoomSource ? NATIVE_ZOOM_SOURCE_TEST_ID : undefined}
      // measureInWindow is callback-based, so the handler resolves a frame
      // later at worst; an unmeasurable row hands over `null` and the
      // destination presents without a zoom rather than from a bogus rect.
      onPress={() => {
        void measureZoomSource(cardRef, CARD_RADIUS).then((source) =>
          onPress(stock, source),
        );
      }}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {content}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderRadius: CARD_RADIUS,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: c.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  cardPressed: {
    transform: [{ scale: 0.97 }],
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
    minWidth: 0,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surfaceAlt,
  },
  iconFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFallbackText: {
    color: c.textInverse,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: F,
  },
  identityCol: {
    flex: 1,
    minWidth: 0,
  },
  symbol: {
    color: c.text,
    fontWeight: '800',
    fontSize: 17,
    lineHeight: 21,
    fontFamily: F,
  },
  name: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    fontFamily: F,
  },
  rightCol: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  priceRow: {
    alignItems: 'flex-end',
    gap: 2,
  },
  priceValue: {
    color: c.text,
    fontSize: 20,
    fontWeight: '700',
    fontFamily: F,
    fontVariant: ['tabular-nums'],
  },
  changeText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: F,
    fontVariant: ['tabular-nums'],
  },
});
