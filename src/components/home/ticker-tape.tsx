import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AssetLogo } from '@/components/asset-logo';
import { Fonts } from '@/constants/theme';
import type { Stock } from '@/lib/api';
import { withAlpha } from '@/lib/color-utils';
import { useThemeStore } from '@/lib/theme-store';
import {
  NATIVE_ZOOM_SOURCE_TEST_ID,
  useIsNativeZoomSource,
} from '@/lib/native-zoom';
import { measureZoomSource, type ZoomSourceRect } from '@/lib/zoom-transition';

const F = Fonts.crt;

export const TICKER_HEIGHT = 26;
/** Sits inside the tape's line height so the logo never grows the strip. */
const LOGO_SIZE = 20;

/** How far the edge fade reaches in from each side. */
const FADE_WIDTH = 40;
/** Points travelled per second. Slow enough to read a symbol as it passes. */
const SPEED = 42;

type Props = {
  stocks: Stock[];
  onSelect?: (
    stock: Stock,
    source: ZoomSourceRect | null,
    nativeSourceKey: string,
  ) => void;
};

function changeLabel(change: number | null): string {
  if (change === null) return '--.--';
  return `${change > 0 ? '+' : change < 0 ? '-' : ''}${Math.abs(change).toFixed(2)}%`;
}

function TickerCell({ stock, onSelect }: { stock: Stock; onSelect?: Props['onSelect'] }) {
  const { colors } = useThemeStore();
  const cellRef = useRef<View>(null);
  const nativeSourceKey = `home-ticker-${useId()}`;
  const isNativeZoomSource = useIsNativeZoomSource(nativeSourceKey);
  const change = stock.priceChange24h ?? null;
  const tone = change === null || change === 0
    ? colors.textTertiary
    : change > 0 ? colors.positive : colors.negative;
  const lit = { color: tone };

  return (
    <Pressable
      ref={cellRef}
      hitSlop={8}
      testID={isNativeZoomSource ? NATIVE_ZOOM_SOURCE_TEST_ID : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${stock.symbol} ${changeLabel(change)}`}
      disabled={onSelect === undefined}
      onPress={() => {
        if (!onSelect) return;
        void measureZoomSource(cellRef, 8).then((source) =>
          onSelect(stock, source, nativeSourceKey),
        );
      }}
      style={styles.cell}
    >
      <AssetLogo
        uri={stock.icon}
        size={LOGO_SIZE}
        borderRadius={LOGO_SIZE / 2}
        backgroundColor={colors.surfaceAlt}
        fallback={
          <View style={[styles.logoFallback, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.logoFallbackText, { color: colors.text }]}>
              {stock.symbol.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        }
      />
      <Text style={[styles.symbol, lit]}>{stock.symbol.toUpperCase()}</Text>
      <Text style={[styles.change, lit]}>
        {change !== null && change > 0 ? '▲' : change !== null && change < 0 ? '▼' : '▬'}
        {changeLabel(change)}
      </Text>
    </Pressable>
  );
}

/**
 * A full-bleed exchange ticker tape across the top of Home, on the same themed
 * background as the portfolio and feed.
 *
 * Motion is one long translate on a doubled run of cells: the second copy is
 * identical, so when the first has travelled exactly its own width the frame is
 * pixel-for-pixel where it started and the loop is seamless.
 */
export function TickerTape({ stocks, onSelect }: Props) {
  const { colors } = useThemeStore();
  const offset = useSharedValue(0);
  const [runWidth, setRunWidth] = useState(0);
  const reducedMotion = useReducedMotion();

  // A tape of three symbols is a list, not a tape. Repeat a short catalogue so
  // there is always enough content to fill the screen twice over.
  const cells = useMemo(() => {
    if (stocks.length === 0) return [];
    const out: Stock[] = [];
    while (out.length < 12) out.push(...stocks);
    return out.slice(0, Math.max(12, stocks.length));
  }, [stocks]);

  useEffect(() => {
    if (runWidth <= 0 || reducedMotion || cells.length === 0) return;
    offset.value = 0;
    offset.value = withRepeat(
      withTiming(-runWidth, {
        duration: (runWidth / SPEED) * 1000,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => cancelAnimation(offset);
  }, [cells.length, offset, reducedMotion, runWidth]);

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  if (cells.length === 0) return null;

  const run = (measured: boolean) => (
    <View
      style={styles.run}
      onLayout={
        measured ? (event) => setRunWidth(event.nativeEvent.layout.width) : undefined
      }
    >
      {cells.map((stock, index) => (
        <TickerCell key={`${stock.id}-${index}`} stock={stock} onSelect={onSelect} />
      ))}
    </View>
  );

  return (
    <View
      accessibilityLabel="Market ticker"
      style={[styles.board, { backgroundColor: colors.background }]}
      // The tape scrolls itself; a screen reader should read the rail below it
      // instead of chasing moving text.
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.track, trackStyle]}>
        {run(true)}
        {run(false)}
      </Animated.View>

      {/* Cells arrive and leave THROUGH the fade rather than popping in at a
          hard edge. `pointerEvents="none"` is load-bearing: without it these
          two overlays would swallow taps on the outer cells. */}
      <LinearGradient
        colors={[withAlpha(colors.background, 1), withAlpha(colors.background, 0)]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        pointerEvents="none"
        style={[styles.fade, styles.fadeLeft]}
      />
      <LinearGradient
        colors={[withAlpha(colors.background, 0), withAlpha(colors.background, 1)]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        pointerEvents="none"
        style={[styles.fade, styles.fadeRight]}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    height: TICKER_HEIGHT,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  track: {
    flexDirection: 'row',
  },
  fade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: FADE_WIDTH,
  },
  fadeLeft: {
    left: 0,
  },
  fadeRight: {
    right: 0,
  },
  run: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  logoFallback: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoFallbackText: {
    fontSize: 10,
    fontWeight: '700',
  },
  symbol: {
    fontFamily: F,
    // VT323 has a small x-height for its point size, so it needs more than a
    // UI face would at the same optical weight.
    fontSize: 19,
    lineHeight: 21,
    letterSpacing: 0.3,
  },
  change: {
    fontFamily: F,
    fontSize: 19,
    lineHeight: 21,
    letterSpacing: 0.3,
  },
});
