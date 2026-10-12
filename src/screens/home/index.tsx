import { usePrivy } from "@privy-io/expo";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { setStatusBarStyle } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  Path,
  Stop,
} from "react-native-svg";
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useComposeAction } from "@/components/compose-fab";
import { CrtTexture } from "@/components/home/crt-texture";
import { BestCallsSection } from "@/components/home/best-calls-section";
import { TICKER_HEIGHT, TickerTape } from "@/components/home/ticker-tape";
import { BottomTabInset, Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import type { Sandwich } from "@/lib/api";
import { withAlpha } from "@/lib/color-utils";
import { prefetchExploreFeed } from "@/lib/explore-feed";
import { useSandwichComposer } from "@/lib/sandwich-composer-store";
import { useSandwichDetail } from "@/lib/sandwich-detail-store";
import { useStockDetail } from "@/lib/stock-detail-store";
import { useThemeStore } from "@/lib/theme-store";

import { AddCashButton } from "./add-cash-button";
import { HeaderPalette, SHEET_RADIUS } from "./header-palette";
import { formatUsd } from "./helpers";
import { PortfolioHero } from "./portfolio-hero";
import { useHomeCalls } from "./use-home-calls";
import { useHomeMovers } from "./use-home-movers";
import { useHomePortfolio } from "./use-home-portfolio";

/**
 * Home is a dark header board — balance, action, ticker — with the content
 * riding up over it on a rounded sheet.
 *
 * The data behind each region lives in its own hook (`use-home-portfolio`,
 * `use-home-calls`, `use-home-movers`), so this file is layout and sheet
 * wiring only.
 */
export function HomeScreen() {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useThemeStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const composer = useSandwichComposer();
  // The "+" itself lives in the tabs layout (shared with the Sandwich feed).
  const openComposer = useCallback(() => {
    composer.open();
  }, [composer]);
  useComposeAction("home", openComposer);
  const { width } = useWindowDimensions();

  // Explore is a native tab, mounted on its first visit, so it used to start
  // loading only once tapped. Warm its first page just behind Home's own
  // requests; the Explore screen reads the same cache.
  const { user } = usePrivy();
  const viewerId = user?.id ?? null;
  useEffect(() => {
    if (!viewerId) return;
    const timer = setTimeout(() => void prefetchExploreFeed(viewerId), EXPLORE_PREFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [viewerId]);

  const portfolio = useHomePortfolio();
  const calls = useHomeCalls();
  const { open: openSandwichDetail } = useSandwichDetail();
  const openSandwich = useCallback((sandwich: Sandwich) => {
    void Haptics.selectionAsync();
    openSandwichDetail(sandwich);
  }, [openSandwichDetail]);
  const movers = useHomeMovers();
  const refreshMovers = movers.refresh;
  const { open: openStock } = useStockDetail();

  const [refreshing, setRefreshing] = useState(false);
  // The board rides INSIDE the scroll content rather than floating over it, so
  // it scrolls away exactly like any other content — that is what makes this
  // smooth and, more to the point, what makes it impossible for the feed to
  // appear above it. Nothing about the board is animated at all.
  //
  // Its height is measured only so the compact bar knows when to take over.
  const [boardHeight, setBoardHeight] = useState(
    insets.top + BOARD_PAD_TOP + 84 + BOARD_PAD_BOTTOM + TICKER_HEIGHT,
  );
  const barHeight = insets.top + BOARD_PAD_TOP + COMPACT_HERO_HEIGHT + COMPACT_PAD_BOTTOM;

  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // The one animated thing on the screen: the compact bar's opacity, on the UI
  // thread. No layout, no transforms, no re-renders while scrolling.
  //
  // It reaches full strength exactly as the board's bottom edge arrives at the
  // bar's own bottom edge, so the swap happens with the two edges coincident and
  // there is never a frame where neither is covering the top of the screen. The
  // bar is the board's colour, so the fade itself is invisible — it reads as the
  // panel simply contracting as the balance shrinks into place.
  const handoff = Math.max(boardHeight - barHeight, 1);
  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [handoff - HANDOFF_FADE, handoff],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  // The blurred band is clipped to the sheet's silhouette — square sides, the
  // sheet's radius on top — so the blur stops exactly where the curve does.
  const edgeMaskPath =
    `M 0 ${SHEET_RADIUS}` +
    ` A ${SHEET_RADIUS} ${SHEET_RADIUS} 0 0 1 ${SHEET_RADIUS} 0` +
    ` L ${width - SHEET_RADIUS} 0` +
    ` A ${SHEET_RADIUS} ${SHEET_RADIUS} 0 0 1 ${width} ${SHEET_RADIUS}` +
    ` L ${width} ${EDGE_HEIGHT} L 0 ${EDGE_HEIGHT} Z`;

  // The frosted edge rides whatever the panel's bottom edge currently is: the
  // board's while it is still scrolling away, the bar's once it has taken over.
  // Transform only, and it stops dead at the bar rather than following the
  // board off the top.
  const edgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 24], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: Math.max(handoff - scrollY.value, 0) }],
  }));

  // The header runs behind the status bar, so its glyphs have to be light while
  // Home is focused regardless of the app's theme — and handed back on the way
  // out, or every other tab inherits Home's setting.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle("light");
      return () => setStatusBarStyle(scheme === "dark" ? "light" : "dark");
    }, [scheme]),
  );

  // Native iOS form sheet route (app/(app)/deposit.tsx), same as the wallet tab.
  const openDeposit = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/deposit");
  }, [router]);

  // Everything handed to the hero, the tape and the feed is kept stable, and
  // each of them is memoized: the feed and the balance update on their own
  // clocks, and one must not re-render (and re-roll) the other.
  const refreshPortfolio = portfolio.refresh;
  const refreshCalls = calls.refresh;
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        refreshPortfolio(),
        refreshCalls(),
        refreshMovers(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshCalls, refreshPortfolio, refreshMovers]);
  const retryAll = useCallback(() => void refreshAll(), [refreshAll]);
  const retryCalls = useCallback(() => void refreshCalls(), [refreshCalls]);
  const addCashAction = useMemo(() => <AddCashButton onPress={openDeposit} />, [openDeposit]);
  const selectTapeStock = useCallback<NonNullable<React.ComponentProps<typeof TickerTape>["onSelect"]>>(
    (stock, source, nativeSourceKey) => {
      void Haptics.selectionAsync();
      openStock(stock, { source, nativeSourceKey });
    },
    [openStock],
  );

  return (
    <View style={styles.page}>
      {/* Behind the scroll view, so it only shows in the bounce gap above the
          header — the one dark band that the header's own texture cannot reach. */}
      <View style={styles.topGround} pointerEvents="none">
        <CrtTexture id="page-scanlines" />
      </View>

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical
        onScroll={scrollHandler}
        // 1, not 16: the handler runs on the UI thread, and throttling it just
        // makes the board step behind the finger.
        scrollEventThrottle={1}
        // Insets are applied by hand below so the header can sit behind the
        // status bar; letting iOS also adjust would double-count them.
        contentInsetAdjustmentBehavior="never"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={retryAll}
            // Pulling down reveals the dark header, never the page background.
            tintColor={HeaderPalette.muted}
          />
        }
      >
        {/* The dark board, in the scroll flow. It travels up with the feed, and
            the sheet's rounded top follows it the whole way — no offsets to keep
            in step, and no way for content to outrun it. */}
        <View
          style={[styles.board, { paddingTop: insets.top + BOARD_PAD_TOP }]}
          onLayout={(event) => {
            const { height } = event.nativeEvent.layout;
            setBoardHeight((current) => (current === height ? current : height));
          }}
        >
          <View style={styles.headerInner}>
            <PortfolioHero
              ready={portfolio.ready && Boolean(portfolio.walletAddress)}
              valueLabel={formatUsd(portfolio.displayedValue)}
              changeUsd={portfolio.displayedChangeUsd}
              positive={portfolio.positive}
              loadingValue={portfolio.cashLoading}
              action={addCashAction}
              showError={
                Boolean(portfolio.cashError) && !portfolio.cashLoading && !portfolio.ready
              }
              onRetry={retryAll}
            />
          </View>

          {/* The tape rides the bottom edge of the board: 24h top and bottom
              movers, each with its token logo. */}
          <TickerTape
            stocks={movers.tape}
            onSelect={selectTapeStock}
          />

          {/* Last child, so the scanlines cover the safe-area band, the balance
              and the tape in one pass. */}
          <CrtTexture />
        </View>

        {/* Everything below the fold lives on the sheet, which laps up over the
            board's bottom edge. */}
        <View style={styles.sheet}>
          {/* Home's feed is every call ranked by PnL — podcast moments, X
              posts, any asset. */}
          <BestCallsSection
            posts={calls.posts}
            loading={calls.loading}
            failed={calls.failed}
            onSelect={openSandwich}
            onRetry={retryCalls}
          />
        </View>
      </Animated.ScrollView>

      {/* The contracted panel: the balance, small and centred, on the board's
          sky blue. It only fades in once the board itself has very
          nearly scrolled off, and being the last thing drawn it is what the feed
          runs underneath — so nothing from the sheet can ever reach the top of
          the screen. */}
      <Animated.View
        style={[styles.bar, barStyle, { height: barHeight, paddingTop: insets.top + BOARD_PAD_TOP }]}
        pointerEvents="none"
      >
        <Text numberOfLines={1} style={styles.compactValue}>
          {portfolio.ready && portfolio.walletAddress
            ? formatUsd(portfolio.displayedValue)
            : "\u2014"}
        </Text>

        <CrtTexture id="bar-scanlines" />
      </Animated.View>

      {/* The frosted edge. Not the panel — the panel is solid — but the band of
          content immediately under it: a blur that is full strength against the
          panel's edge and gone a few points later, so the feed reads as
          softening on its way up and out rather than being clipped off at a
          line. The gradient is the mask, so the blur itself fades out with it. */}
      <Animated.View
        style={[styles.edge, edgeStyle, { top: barHeight }]}
        pointerEvents="none"
      >
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <Svg width={width} height={EDGE_HEIGHT}>
              <Defs>
                <SvgGradient
                  id="edge-fade"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2={EDGE_HEIGHT}
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop offset="0" stopColor="#000000" stopOpacity="1" />
                  <Stop offset="0.5" stopColor="#000000" stopOpacity="0.5" />
                  <Stop offset="1" stopColor="#000000" stopOpacity="0" />
                </SvgGradient>
              </Defs>
              {/* The mask carries BOTH jobs: the vertical fall-off, and the
                  sheet's own rounded top. A plain rectangular fade blurs the
                  ground outside the curve as well, and that smudge in the
                  corners is visible against the dark board. */}
              <Path d={edgeMaskPath} fill="url(#edge-fade)" />
            </Svg>
          }
        >
          <BlurView
            intensity={EDGE_BLUR}
            tint={scheme === "dark" ? "dark" : "light"}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      </Animated.View>

      {/* The sheet's rounded shoulders, redrawn just BELOW the bar. The real
          ones have travelled up underneath it by now, and the feed would
          otherwise meet the bar on a hard square edge.

          These are inverse corners — the small wedge of ground OUTSIDE the
          curve — so they have to be drawn, not built out of a rounded View: a
          rounded box paints the inside of the curve, which is the part the feed
          is already filling. Hence the two paths, and hence nothing solid
          between them: the content keeps running underneath. */}
      <Animated.View
        style={[styles.shoulders, barStyle, { top: barHeight }]}
        pointerEvents="none"
      >
        <ShoulderWedge
          d={`M 0 0 L ${SHEET_RADIUS} 0 A ${SHEET_RADIUS} ${SHEET_RADIUS} 0 0 0 0 ${SHEET_RADIUS} Z`}
        />
        <ShoulderWedge
          d={`M ${SHEET_RADIUS} 0 L 0 0 A ${SHEET_RADIUS} ${SHEET_RADIUS} 0 0 1 ${SHEET_RADIUS} ${SHEET_RADIUS} Z`}
        />
      </Animated.View>

    </View>
  );
}

/**
 * One inverse corner under the panel: the wedge of ground OUTSIDE the curve.
 *
 * The shape can only be drawn, not built from a rounded `View` — a rounded box
 * paints the inside of the curve, which is the part the feed already fills.
 */
function ShoulderWedge({ d }: { d: string }) {
  return (
    <Svg width={SHEET_RADIUS} height={SHEET_RADIUS}>
      <Path d={d} fill={HeaderPalette.backgroundBottom} />
    </Svg>
  );
}

/**
 * The frosted edge under the panel, and how tall the fall-off is. Blur only at
 * the very edge: it is the content going under that should soften, not the
 * panel itself.
 */
const EDGE_BLUR = 28;
const EDGE_HEIGHT = 40;

/** How long after Home mounts the Explore feed is warmed. */
const EXPLORE_PREFETCH_DELAY_MS = 800;

/** Board padding above the balance (below the status bar) and under it. */
const BOARD_PAD_TOP = 4;
const BOARD_PAD_BOTTOM = 10;
/** What the padding under the balance shrinks to on the contracted bar. */
const COMPACT_PAD_BOTTOM = 8;
/** One line of the small centred figure — the contracted board's whole body. */
const COMPACT_HERO_HEIGHT = 22;
/** How long the compact bar takes to fade up as the board leaves. */
const HANDOFF_FADE = 40;

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: {
      flex: 1,
      // The sheet's colour, NOT the header's. The tab bar is translucent and
      // the content can bounce clear of it, so whatever sits here is what tints
      // the bar — a dark page ground read as a permanent shadow behind the nav.
      backgroundColor: c.background,
    },
    // Dark ground for the TOP overscroll only, behind the scroll view. Bouncing
    // past the top has to reveal the board's own colour or the header appears
    // to detach from the status bar. Fixed height so it never reaches the nav.
    topGround: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 420,
      backgroundColor: HeaderPalette.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      // The sheet's rounded top corners expose this parent. Match the board's
      // lower stop so the board colour continues behind the curves instead of
      // flashing the bright overscroll blue at the left and right edges.
      backgroundColor: HeaderPalette.backgroundBottom,
    },
    board: {
      backgroundColor: HeaderPalette.background,
    },
    headerInner: {
      paddingHorizontal: 24,
      paddingBottom: BOARD_PAD_BOTTOM,
    },
    // The contracted panel. Same sky blue as the board, so its fade-in reads as
    // the board contracting rather than as a second surface arriving.
    bar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      backgroundColor: HeaderPalette.backgroundBottom,
    },
    compactValue: {
      color: HeaderPalette.value,
      fontSize: 17,
      lineHeight: COMPACT_HERO_HEIGHT,
      fontWeight: '800',
      fontFamily: Fonts.rounded,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.4,
      textShadowColor: withAlpha(HeaderPalette.value, 0.45),
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 8,
    },
    edge: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: EDGE_HEIGHT,
    },
    shoulders: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: SHEET_RADIUS,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    sheet: {
      flexGrow: 1,
      backgroundColor: c.background,
      borderTopLeftRadius: SHEET_RADIUS,
      borderTopRightRadius: SHEET_RADIUS,
      paddingHorizontal: 24,
      paddingTop: 28,
      // Clear the native tab bar (which floats over content) plus breathing room.
      paddingBottom: BottomTabInset + 70,
    },
  });
