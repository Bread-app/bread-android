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
import {
  NATIVE_ZOOM_SOURCE_TEST_ID,
  useIsNativeZoomSource,
} from '@/lib/native-zoom';
import { measureZoomSource, type ZoomSourceRect } from '@/lib/zoom-transition';
import { BoardTone, HeaderPalette } from '@/screens/home/header-palette';

const F = Fonts.crt;

/**
 * Phosphor palette — deliberately NOT themed. The tape shares the header's
 * ground so the two read as one continuous board rather than a strip bolted
 * onto it.
 */
const BOARD = HeaderPalette.backgroundBottom;
// Use the app's bullish/chart green for positive movers.
const UP = '#35F046';
const DOWN = BoardTone.down;
const FLAT = BoardTone.flat;
/** Phosphor bleed, derived from each cell's own colour so it cannot drift. */
const GLOW_ALPHA = 0.38;

export const TICKER_HEIGHT = 34;
/** Sits inside the tape's line height so the logo never grows the strip. */
const LOGO_SIZE = 20;

/** How far the edge fade reaches in from each side. */
const FADE_WIDTH = 56;
/**
 * Board colour at full strength, then the same colour at zero alpha — both
 * derived from the one palette entry so they cannot drift from the board.
 */
const FADE_OPAQUE = `rgba(${HeaderPalette.backgroundBottomRgb}, 1)`;
const FADE_CLEAR = `rgba(${HeaderPalette.backgroundBottomRgb}, 0)`;

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

function colorFor(change: number | null): string {
  if (change === null || change === 0) return FLAT;
  return change > 0 ? UP : DOWN;
}

function changeLabel(change: number | null): string {
  if (change === null) return '--.--';
  return `${change > 0 ? '+' : change < 0 ? '-' : ''}${Math.abs(change).toFixed(2)}%`;
}

function TickerCell({ stock, onSelect }: { stock: Stock; onSelect?: Props['onSelect'] }) {
  const cellRef = useRef<View>(null);
  const nativeSourceKey = `home-ticker-${useId()}`;
  const isNativeZoomSource = useIsNativeZoomSource(nativeSourceKey);
  const change = stock.priceChange24h ?? null;
  const tone = colorFor(change);
  const lit = { color: tone, textShadowColor: withAlpha(tone, GLOW_ALPHA) };

  return (
    <Pressable
      ref={cellRef}
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
        backgroundColor={HeaderPalette.control}
        fallback={
          <View style={styles.logoFallback}>
            <Text style={styles.logoFallbackText}>
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
 * A full-bleed exchange ticker tape across the top of Home.
 *
 * The board is intentionally outside the app's light/dark theme: a ticker reads
 * as a physical object bolted to the wall, and a phosphor-green figure only
 * looks like phosphor against black. The glow is a real text shadow rather than
 * an overlay so it survives on both themes and costs nothing to composite.
 *
 * Motion is one long translate on a doubled run of cells: the second copy is
 * identical, so when the first has travelled exactly its own width the frame is
 * pixel-for-pixel where it started and the loop is seamless.
 */
export function TickerTape({ stocks, onSelect }: Props) {
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
      style={styles.board}
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
        colors={[FADE_OPAQUE, FADE_CLEAR]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        pointerEvents="none"
        style={[styles.fade, styles.fadeLeft]}
      />
      <LinearGradient
        colors={[FADE_CLEAR, FADE_OPAQUE]}
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
    // Exact bottom stop of the header gradient, and no rules: the tape should
    // read as the bottom of one board, not as a strip laid on top of it.
    backgroundColor: BOARD,
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
    backgroundColor: HeaderPalette.control,
  },
  logoFallbackText: {
    color: HeaderPalette.value,
    fontSize: 10,
    fontWeight: '700',
  },
  symbol: {
    fontFamily: F,
    // VT323 has a small x-height for its point size, so it needs more than a
    // UI face would at the same optical weight.
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 0.5,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  change: {
    fontFamily: F,
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 0.5,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
});
