import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePrivy } from '@privy-io/expo';

import {
  AssetActivitySheet,
  type AssetActivitySheetRef,
} from '@/components/asset-activity-sheet';
import {
  ASSET_MARKET_TOGGLE_HEIGHT,
  ASSET_MARKET_TOGGLE_WIDTH,
  type AssetMarketMode,
} from '@/components/asset-market-toggle';
import { PerpLegActions } from '@/components/perp-leg-actions';
import { NATIVE_ZOOM_TARGET_TEST_ID } from '@/lib/native-zoom';
import type { PerpActionBarState } from '@/components/phoenix-market-detail-sheet';
import {
  MARKET_TOGGLE_RIGHT,
  StockDetailSheet,
  getSheetColors,
  type StockDetailSheetRef,
} from '@/components/stock-detail-sheet';
import { StockTradeActions } from '@/components/stock-trade-actions';
import { ZoomScreen, type ZoomScreenRef } from '@/components/zoom-screen';
import type { ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { withAlpha } from '@/lib/color-utils';
import { ctaBottomInset } from '@/lib/screen-corners';
import { appUserPayloadFromPrivyUser, type Stock } from '@/lib/api';
import type { StockDetailOpenOptions } from '@/lib/stock-detail-store';
import { useStockDetail } from '@/lib/stock-detail-store';
import { useThemeStore } from '@/lib/theme-store';
import { UserProfileScreen } from '@/screens/user-profile-screen';

const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();
/** `StockDetailSheet`'s own `sheetBody` top padding, which sits above its header. */
const SHEET_CONTENT_TOP_PADDING = 24;
const CHROME_CONTENT_GAP = 12;
const BACK_BUTTON_SIZE = 40;
const CHROME_EDGE_INSET = 14;
/** Matches the stock sheet's COMPACT_HEADER_START, where the toggle is gone. */
const HISTORY_FADE_END = 48;
// Gap between the history button and the market toggle when both are drawn.
const CHROME_BUTTON_GAP = 10;

/**
 * The asset detail *screen* — the zoom destination behind `(app)/stock-detail`.
 *
 * It is the same surface the bottom sheet always rendered (`StockDetailSheet`
 * in its embedded mode), just presented as a card that grows out of the row the
 * user tapped instead of sliding up from the bottom. Callers reach it through
 * {@link useStockDetail}().open(stock, { source }), so search rows and sandwich
 * legs land on one screen rather than two lookalike sheets.
 *
 * The BUY / LONG / SHORT bar is drawn HERE, outside the zooming card, for the
 * reason documented on {@link PerpLegActions}: native Liquid Glass paints no
 * fill inside a transformed, clipped surface. Everything else lives inside.
 */
/**
 * Closed-trades button that leaves with the Spot/Perp toggle beside it: fully
 * gone by the scroll depth where the sheet's compact header takes over. Its own
 * component so the "fully hidden" flip re-renders this glyph, not the screen
 * and the whole detail sheet under it, mid-scroll.
 */
const HistoryButton = React.memo(function HistoryButton({
  scrollY,
  style,
  buttonStyle,
  pressedStyle,
  label,
  color,
  onPress,
}: {
  scrollY: SharedValue<number>;
  style: StyleProp<ViewStyle>;
  buttonStyle: StyleProp<ViewStyle>;
  pressedStyle: StyleProp<ViewStyle>;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, HISTORY_FADE_END], [1, 0], Extrapolation.CLAMP),
  }));
  useAnimatedReaction(
    () => scrollY.value >= HISTORY_FADE_END,
    (next, previous) => {
      if (next !== previous) runOnJS(setHidden)(next);
    },
  );
  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[style, fadeStyle]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        hitSlop={10}
        style={({ pressed }) => [buttonStyle, pressed && pressedStyle]}
      >
        <MaterialIcons name="history" size={26} color={color} />
      </Pressable>
    </Animated.View>
  );
});

export function StockDetailScreen({ zoom = true, assetOverride, optionsOverride, openTradePad = false, tweetUrl }: { zoom?: boolean; assetOverride?: Stock; optionsOverride?: StockDetailOpenOptions; openTradePad?: boolean; tweetUrl?: string } = {}) {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useThemeStore();
  const insets = useSafeAreaInsets();
  const { user } = usePrivy();
  const detail = useStockDetail();
  // The provider holds ONE asset, but these routes stack: a Sandwich opened
  // from this screen can open another asset on top. Pin this instance to the
  // asset it was opened with, still following that asset's own hydration, so
  // Back never lands on a screen that has been swapped to the newer asset.
  const ownRef = useRef<{ stock: Stock | null; options: StockDetailOpenOptions }>({
    stock: detail.stock,
    options: detail.options,
  });
  if (
    detail.stock &&
    (!ownRef.current.stock || detail.stock.id === ownRef.current.stock.id)
  ) {
    ownRef.current = { stock: detail.stock, options: detail.options };
  }
  const stock = assetOverride ?? ownRef.current.stock;
  const options = optionsOverride ?? ownRef.current.options;
  // Holder rows open that user's profile over this screen.
  const [holderId, setHolderId] = useState<string | null>(null);
  const [holderOpen, setHolderOpen] = useState(false);
  const handleOpenUser = useCallback((privyUserId: string) => {
    setHolderId(privyUserId);
    setHolderOpen(true);
  }, []);
  const close = detail.close;
  const zoomRef = useRef<ZoomScreenRef>(null);
  const detailRef = useRef<StockDetailSheetRef>(null);
  const activityRef = useRef<AssetActivitySheetRef>(null);
  const openActivity = useCallback(() => activityRef.current?.open(), []);
  // A screen the OS is zooming is settled from its first frame: UIKit owns the
  // transition, there is no JS morph for glass or the action bar to wait on.
  const [settled, setSettled] = useState(!zoom);
  const [venueMode, setVenueMode] = useState<AssetMarketMode>(
    options.venue ?? 'spot',
  );
  const [perpAction, setPerpAction] = useState<PerpActionBarState | null>(null);
  const [hasSellableBalance, setHasSellableBalance] = useState(false);
  const [heldSpotLatched, setHeldSpotLatched] = useState(false);
  const [tradeOverlayOpen, setTradeOverlayOpen] = useState(false);
  // Whether the sheet is drawing the Spot/Perp toggle on the chrome row. The
  // history button shares that row's right edge, so it has to step left of the
  // toggle when there is one and take the edge itself when there is not.
  const [canToggleMarket, setCanToggleMarket] = useState(false);
  // Published by whichever venue layer is showing. The zoom's drag-to-collapse
  // spans the whole screen, so it reads this to leave a scrolled list alone.
  const contentScrollY = useSharedValue(0);
  // The destination's dismiss pan spans the entire screen. The perp chart
  // publishes its touch ownership here on the UI thread so pinch/axis gestures
  // can never be mistaken for a collapse.
  const chartGestureActive = useSharedValue(false);

  const sheetColors = getSheetColors(colors);
  // Spot/Perp is navigation chrome, not asset data. Give it a stable safe-area
  // row so it cannot cover the identity or quote, and so the header never jumps
  // when market availability resolves.
  const chromeTop = Math.max(insets.top - 2, 8);
  const toggleTop = chromeTop;
  // The back button shares the toggle's band, centred on it, at the left edge.
  const backButtonTop = chromeTop + (ASSET_MARKET_TOGGLE_HEIGHT - BACK_BUTTON_SIZE) / 2;
  // The history button sits just left of the toggle (which the sheet pins at
  // `MARKET_TOGGLE_RIGHT`), or mirrors the back button when no toggle is drawn.
  const historyButtonRight = canToggleMarket
    ? MARKET_TOGGLE_RIGHT + ASSET_MARKET_TOGGLE_WIDTH + CHROME_BUTTON_GAP
    : CHROME_EDGE_INSET;
  const contentTop = chromeTop + ASSET_MARKET_TOGGLE_HEIGHT + CHROME_CONTENT_GAP;
  // `StockDetailSheet` already owns 24pt above its header, so pass only the
  // remaining safe-area clearance. The zoom uses the same total to preserve the
  // row-to-detail alignment during its opening transition.
  const topInset = Math.max(contentTop - SHEET_CONTENT_TOP_PADDING, 0);
  const headerOffset = topInset + SHEET_CONTENT_TOP_PADDING;

  // The route is popped by the zoom's own completion, never directly, so the
  // card is always back on its row before the screen unmounts.
  const handleDismissed = useCallback(() => close(), [close]);
  const handleBack = useCallback(() => {
    if (zoom) {
      zoomRef.current?.dismiss();
      return;
    }
    close();
  }, [close, zoom]);

  useEffect(() => {
    setHasSellableBalance(false);
    setHeldSpotLatched(false);
  }, [stock?.id]);

  // Home's ticker board opens any asset with a Phoenix market on the perp
  // venue, which only offers LONG / SHORT. A user who already holds the stock
  // itself came to manage that position, so the page lands on spot — BUY MORE /
  // SELL — instead. A Sandwich leg names its `side` and keeps its venue: that
  // is the thesis, not a default. Latched, so selling out while on spot does
  // not throw the page back to perp under the user.
  const defaultedToPerp =
    options.venue === 'perp' && options.side === undefined && options.hideActions !== true;
  useEffect(() => {
    if (defaultedToPerp && hasSellableBalance) setHeldSpotLatched(true);
  }, [defaultedToPerp, hasSellableBalance]);
  const requestedVenue: AssetMarketMode =
    heldSpotLatched ? 'spot' : options.venue ?? 'spot';

  const openedTrade = useRef(false);
  useEffect(() => {
    if (!openTradePad || !stock || !settled || openedTrade.current || !detailRef.current) return;
    if (requestedVenue === 'perp' && (!perpAction || !options.perpMarket)) return;
    openedTrade.current = true;
    if (requestedVenue === 'perp') detailRef.current.tradePerp(options.side ?? 'long');
    else detailRef.current.trade('buy');
  }, [openTradePad, stock, settled, requestedVenue, options.perpMarket, options.side, perpAction]);

  if (!stock) return <View style={styles.root} />;

  const perpUnavailable = options.hideActions === true;
  const showActions = settled && !tradeOverlayOpen;

  /* The safe-area gap the 92%-height sheet used to get for free.
     
     Handed to the sheet rather than applied here as padding: the trade pad and
     the perp order ticket are `absoluteFill` children of that surface, so
     padding this wrapper pushed them down and left a dead band exactly this
     tall at the bottom of the screen. */
  const surface = (
    <View style={styles.surface}>
      <StockDetailSheet
        ref={detailRef}
        embeddedStock={stock}
        notificationTweetUrl={tweetUrl}
        // Native glass cannot follow the morph, so it switches on only once the
        // card has stopped moving.
        embeddedGlassEnabled={settled}
        embeddedPerpMarket={options.perpMarket ?? null}
        embeddedVenue={requestedVenue}
        embeddedPerpSide={options.side}
        hideEmbeddedActions
        onEmbeddedVenueChange={setVenueMode}
        onEmbeddedCanToggleMarketChange={setCanToggleMarket}
        onEmbeddedPerpActionStateChange={setPerpAction}
        onEmbeddedSellableBalanceChange={setHasSellableBalance}
        onEmbeddedTradeOpenChange={setTradeOverlayOpen}
        embeddedScrollY={contentScrollY}
        embeddedChartGestureActive={chartGestureActive}
        // Only meaningful on the native route: UIKit reads it to know where the
        // tapped row should land. Harmless on the JS route, which does the same
        // alignment itself with `contentLift`.
        embeddedHeaderTestID={NATIVE_ZOOM_TARGET_TEST_ID}
        embeddedTopInset={topInset}
        embeddedToggleTop={toggleTop}
        onOpenUser={handleOpenUser}
      />
    </View>
  );

  const chromeButton = (
    icon: React.ComponentProps<typeof Ionicons>['name'],
    size: number,
  ) =>
    HAS_GLASS ? (
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        tintColor={withAlpha(colors.text, scheme === 'dark' ? 0.22 : 0.1)}
        colorScheme={scheme === 'dark' ? 'dark' : 'light'}
        style={styles.chromeButtonGlass}
      >
        <Ionicons name={icon} size={size} color={colors.text} />
      </GlassView>
    ) : (
      <View style={[styles.chromeButtonGlass, { backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name={icon} size={size} color={colors.text} />
      </View>
    );

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* A trade modal covers the card these would dismiss, so the buttons
          would either sit orphaned on top of the pad or throw the screen away
          from under an open order. The pad draws its own close chevron. */}
      {tradeOverlayOpen ? null : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={handleBack}
            hitSlop={10}
            style={({ pressed }) => [
              styles.chromeButton,
              styles.backButton,
              { top: backButtonTop },
              pressed && styles.chromeButtonPressed,
            ]}
          >
            {chromeButton('chevron-back', 24)}
          </Pressable>
          {/* This asset's closed trades. Sits just left of the Spot/Perp toggle
              when there is one, otherwise mirrors the back button at the edge.
              A bare glyph, not a disc: the disc marks the one control that
              leaves the page, and this reads as a header action beside it. */}
          <HistoryButton
            scrollY={contentScrollY}
            style={[styles.chromeButton, { top: backButtonTop, right: historyButtonRight }]}
            buttonStyle={styles.historyButton}
            pressedStyle={styles.chromeButtonPressed}
            label={`Closed trades in ${stock.symbol}`}
            color={colors.textSecondary}
            onPress={openActivity}
          />
        </>
      )}
      <AssetActivitySheet
        ref={activityRef}
        symbol={stock.symbol}
        mint={stock.id}
        name={stock.name}
        logoUrl={stock.icon}
      />
      {zoom ? (
        <ZoomScreen
          ref={zoomRef}
          source={options.source ?? null}
          backgroundColor={sheetColors.background}
          onDismissed={handleDismissed}
          onSettledChange={setSettled}
          // While the trade pad is up, a downward drag belongs to the pad.
          dismissEnabled={!tradeOverlayOpen}
          dismissGestureLocked={chartGestureActive}
          contentOffset={contentScrollY}
          contentLift={headerOffset}
        >
          {surface}
        </ZoomScreen>
      ) : (
        surface
      )}

      {showActions ? (
        <Animated.View
          // Liquid Glass renders washed-out under any ancestor opacity < 1, and
          // can stay that way after an opacity fade — so glass pills skip the
          // fade and materialize on their own.
          entering={HAS_GLASS ? undefined : FadeIn.duration(160)}
          exiting={HAS_GLASS ? undefined : FadeOut.duration(120)}
          style={[
            styles.actionHost,
            { paddingBottom: ctaBottomInset(insets.bottom) },
          ]}
          pointerEvents="box-none"
        >
          {/* With glass the pill refracts the content behind it and wants no
              backing; without it the buttons need the same fade the sheet drew
              under its own inline bar. */}
          {!HAS_GLASS ? (
            <LinearGradient
              colors={[`${sheetColors.background}00`, sheetColors.background]}
              locations={[0, 0.55]}
              style={styles.actionFade}
              pointerEvents="none"
            />
          ) : null}
          {venueMode === 'perp' ? (
            <PerpLegActions
              state={perpAction}
              colors={colors}
              onTrade={(side) => detailRef.current?.tradePerp(side)}
              onActivate={() => detailRef.current?.activatePerps()}
            />
          ) : perpUnavailable ? (
            // A perp leg with no live Phoenix market falls back to the spot
            // page. A spot BUY on a short leg is the opposite of the thesis, so
            // it gets no action at all.
            null
          ) : (
            <StockTradeActions
              stockMint={stock.id}
              stockSymbol={stock.symbol}
              onTrade={(side) => detailRef.current?.trade(side)}
              hasPosition={hasSellableBalance}
            />
          )}
        </Animated.View>
      ) : null}
      {holderId ? (
        <UserProfileScreen
          visible={holderOpen}
          onClose={() => setHolderOpen(false)}
          targetPrivyUserId={holderId}
          viewerPrivyUserId={user?.id ?? null}
          viewerPayload={user ? appUserPayloadFromPrivyUser(user) : null}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    surface: {
      flex: 1,
      backgroundColor: getSheetColors(c).background,
    },
    actionHost: {
      position: 'absolute',
      // Flush; <StockTradeActions> supplies the shared CTA margin itself.
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 45,
      paddingTop: 12,
    },
    actionFade: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      top: -60,
    },
    historyButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    chromeButton: {
      position: 'absolute',
      width: BACK_BUTTON_SIZE,
      height: BACK_BUTTON_SIZE,
      zIndex: 60,
      borderRadius: BACK_BUTTON_SIZE / 2,
      overflow: 'hidden',
    },
    backButton: { left: CHROME_EDGE_INSET },
    chromeButtonGlass: {
      width: BACK_BUTTON_SIZE,
      height: BACK_BUTTON_SIZE,
      borderRadius: BACK_BUTTON_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chromeButtonPressed: { opacity: 0.65 },
  });
