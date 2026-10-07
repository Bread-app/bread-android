import { usePrivy } from "@privy-io/expo";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { setStatusBarStyle } from "expo-status-bar";
import React, { useCallback, useMemo, useState } from "react";
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

import { SandwichCategories } from "@/components/home/sandwich-categories";
import { CrtTexture } from "@/components/home/crt-texture";
import { TickerTape } from "@/components/home/ticker-tape";
import { BottomTabInset, Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { appUserPayloadFromPrivyUser } from "@/lib/api";
import { useStockDetail } from "@/lib/stock-detail-store";
import { useThemeStore } from "@/lib/theme-store";

import { AddCashButton } from "./add-cash-button";
import { SHEET_RADIUS } from "./header-palette";
import { formatUsd } from "./helpers";
import { PortfolioHero } from "./portfolio-hero";
import { useHomeFeed } from "./use-home-feed";
import { useHomeMovers } from "./use-home-movers";
import { useHomePortfolio } from "./use-home-portfolio";
import { useHomeSaved } from "./use-home-saved";

/**
 * Home keeps its balance and action on the same themed ground as the feed, with
 * the content riding up underneath a compact header while scrolling.
 *
 * The data behind each region lives in its own hook (`use-home-portfolio` and
 * `use-home-feed`), so this file is layout and sheet wiring only.
 */
export function HomeScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useThemeStore();
  const { user } = usePrivy();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const viewerPayload = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);
  const viewerPrivyUserId = viewerPayload?.privyUserId ?? null;

  const portfolio = useHomePortfolio();
  const feed = useHomeFeed(viewerPrivyUserId);
  const saved = useHomeSaved(viewerPrivyUserId);
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
    insets.top + BOARD_PAD_TOP + 84 + BOARD_PAD_BOTTOM,
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

  // Home now uses the normal themed page ground, so the status bar follows the
  // active scheme instead of being forced light for the old blue board.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(scheme === "dark" ? "light" : "dark");
      return () => setStatusBarStyle(scheme === "dark" ? "light" : "dark");
    }, [scheme]),
  );

  // Native iOS form sheet route (app/(app)/deposit.tsx), same as the wallet tab.
  const openDeposit = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/deposit");
  }, [router]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        portfolio.refresh(),
        feed.refresh(),
        saved.refresh(),
        refreshMovers(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [feed, portfolio, refreshMovers, saved]);

  return (
    <View style={styles.page}>
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
            onRefresh={() => void refreshAll()}
            tintColor={colors.textSecondary}
          />
        }
      >
        {/* The header stays in the scroll flow, but no longer paints a separate
            blue board behind the portfolio content. */}
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
              action={<AddCashButton onPress={openDeposit} />}
              showError={
                Boolean(portfolio.cashError) && !portfolio.cashLoading && !portfolio.ready
              }
              onRetry={() => void refreshAll()}
            />
          </View>
        </View>

        {/* Everything below the fold lives on the sheet, which laps up over the
            board's bottom edge. */}
        <View style={styles.sheet}>
          {/* 24h top and bottom performers — ticker and change only, always
              moving — above the feed's Trending title. */}
          <View style={styles.movers}>
            <TickerTape
              stocks={movers.tape}
              onSelect={(stock, source, nativeSourceKey) => {
                void Haptics.selectionAsync();
                openStock(stock, { source, nativeSourceKey });
              }}
            />
          </View>
          <SandwichCategories
            posts={feed.posts}
            loading={feed.loading}
            failed={feed.failed}
            saved={saved}
            onSelect={feed.open}
            onToggleLike={feed.toggleLike}
            onComment={feed.openComments}
            onSeeAll={() => router.push("/(app)/(tabs)/sandwich")}
            onSeeAllSaved={() => router.push("/(app)/(tabs)/saved")}
            onRetry={feed.reload}
          />
        </View>
      </Animated.ScrollView>

      {/* The compact balance uses the same background as the page, so the
          header can contract without introducing a coloured band. */}
      <Animated.View
        style={[styles.bar, barStyle, { height: barHeight, paddingTop: insets.top + BOARD_PAD_TOP }]}
        pointerEvents="none"
      >
        <Text numberOfLines={1} style={styles.compactValue}>
          {portfolio.ready && portfolio.walletAddress
            ? formatUsd(portfolio.displayedValue)
            : "\u2014"}
        </Text>
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

      {/* CRT scanlines over the whole page, fixed to the screen, strongest at
          the top and fading out toward the bottom. Last child so it lies over
          everything; the texture itself ignores touches. */}
      <CrtTexture
        id="home-page-scanlines"
        color={scheme === "dark" ? "rgba(255, 255, 255, 0.07)" : "rgba(11, 22, 34, 0.07)"}
        fade
      />
    </View>
  );
}

/**
 * The frosted edge under the panel, and how tall the fall-off is. Blur only at
 * the very edge: it is the content going under that should soften, not the
 * panel itself.
 */
const EDGE_BLUR = 28;
const EDGE_HEIGHT = 40;

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
      backgroundColor: c.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      backgroundColor: c.background,
    },
    board: {
      backgroundColor: c.background,
    },
    headerInner: {
      paddingHorizontal: 24,
      paddingBottom: BOARD_PAD_BOTTOM,
    },
    bar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      backgroundColor: c.background,
    },
    compactValue: {
      color: c.text,
      fontSize: 17,
      lineHeight: COMPACT_HERO_HEIGHT,
      fontWeight: '800',
      fontFamily: Fonts.rounded,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.4,
    },
    edge: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: EDGE_HEIGHT,
    },
    // Full bleed: the tape runs edge to edge through the sheet's gutter.
    movers: {
      marginHorizontal: -24,
      marginBottom: 14,
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
