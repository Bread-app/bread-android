import { NotificationTweet } from '@/components/notification-tweet';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  useAnimatedKeyboard,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { AssetLogo } from '@/components/asset-logo';
import { BlurBackdrop } from '@/components/blur-backdrop';
import { PhoenixMarkChart } from '@/components/phoenix-mark-chart';
import { PhoenixAutoClosePad } from '@/components/phoenix-auto-close-pad';
import { PhoenixOrderPad } from '@/components/phoenix-order-pad';
import { SideGlassButton } from '@/components/side-glass-button';
import { ValueSkeletonLine } from '@/components/value-skeleton';
import { CTA } from '@/lib/screen-corners';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { getSheetColors } from '@/lib/sheet-colors';
import { withAlpha } from '@/lib/color-utils';
import { isPaperMode } from '@/lib/paper-mode';
import {
  clearPhoenixOrderPrebuild,
  prebuildPhoenixOrder,
  takePhoenixOrderBuild,
} from '@/lib/phoenix-prebuild';
import { useThemeStore } from '@/lib/theme-store';
import { useCash } from '@/hooks/use-cash';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  applyLiveMark,
  chartWindowChange,
  PHOENIX_RANGE_ORDER,
  PHOENIX_RANGES,
  type PhoenixRange,
  usePhoenixLiveMarket,
} from '@/hooks/use-phoenix-live';
import { signAndSendBase64WithResult, type SigningWallet } from '@/lib/cash';
import {
  buildPhoenixDeposit,
  confirmPhoenixOpen,
  getPhoenixAccount,
  normalizePhoenixAssetSymbol,
  PhoenixApiError,
  registerPhoenixAccount,
  type PhoenixAccountResponse,
  type PhoenixMarket,
  type PhoenixTradeSide,
} from '@/lib/phoenix-api';
import { useToast } from '@/lib/toast-store';
import { useTradeFx } from '@/lib/trade-fx';
import { perpLogoSources } from '@/lib/stock-logos';
import { recordPhoenixPositionLeverage } from '@/lib/phoenix-position-leverage';
import { entryRisk, selectableMaxLeverage } from '@/lib/phoenix-risk';

/** How long a dev paper fill pretends to work before the receipt. */
const PAPER_FILL_DELAY_MS = 700;


const F = Fonts.rounded;

// House pattern: resolve glass availability once at module scope, always ship a
// solid fallback (see stock-trade-actions.tsx).
const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

type PhoenixDetailTab = 'about' | 'sandwiches' | 'holders';

function changeTintColors(value: number | null | undefined): readonly [string, string] {
  if (value == null || value === 0) return ['#9aa3b014', '#9aa3b000'];
  return value > 0 ? ['#35F04617', '#35F04600'] : ['#D2042D17', '#D2042D00'];
}

/**
 * Stacking geometry, shared by every layer so the stack never compounds: each
 * card starts at the same inset and is therefore the same height as the one
 * behind it, no matter how deep you go.
 */
const STACK_INSET = 22;

/**
 * A CEILING on the order ticket's height, not its actual height. The card is
 * bottom-anchored in an overlay that starts just below the status bar, and
 * `orderCard`'s `flexShrink` clamps it to that box — so in practice the ticket
 * fills the overlay and this only matters on a screen tall enough that 96%
 * still leaves room. Fixed rather than content-sized so the card is the same
 * size on every market, and so the pad inside it has a known height to lay out
 * against. To move the ticket's top edge, change the overlay's `top`.
 */
const ORDER_CARD_HEIGHT = Dimensions.get('window').height * 0.96;

/**
 * The ticket's entry and exit. Both are tuned for the full height of the card:
 * a spring stiff enough for a short hop reads as a snap over 780pt, and the
 * exit is eased *in* so the card gathers speed on its way out the way a sheet
 * being pushed away does, instead of leaving at a constant clip.
 */
const ORDER_ENTRY = { damping: 30, stiffness: 200, mass: 1 } as const;
const ORDER_EXIT = { duration: 280, easing: Easing.in(Easing.cubic) } as const;
/**
 * How far the SL/TP card travels on the way in. It hugs its content, so this is
 * a ceiling rather than its exact height — starting it any closer would leave
 * the card's footer visible on the first frame.
 */
const AUTO_CARD_TRAVEL = ORDER_CARD_HEIGHT;
const STACK_SCALE = 0.93;
/**
 * Scaling about the centre pushes a layer's top edge *down* by ~3.5% of its
 * height, which would hide it behind the card in front. This lifts it back up
 * by that much plus the strip we want to see.
 */
const STACK_PUSH_Y = -38;
const SHEET_RADIUS = 28;

export type PhoenixMarketDetailSheetRef = {
  open: (market: PhoenixMarket) => void;
  close: () => void;
  /** Raise the order ticket on `side` — the pinned bar's own action, exposed
   *  for a host that renders that bar itself. See `embeddedActionBar`. */
  openOrder: (side: PhoenixTradeSide) => void;
  /** Register the perps account, likewise. */
  activate: () => void;
};

/**
 * What a hoisted action bar should currently show. The perp view owns the
 * account state; a host rendering the bar needs to be told which of the three
 * states it is in. While the account lookup is unresolved, the host receives
 * `null` and leaves the action area empty.
 */
export type PerpActionBarState =
  | { kind: 'trade' }
  | { kind: 'activate'; submitting: boolean };

type PhoenixMarketDetailSheetProps = {
  notificationTweetUrl?: string;
  onClose?: () => void;
  /**
   * Mirrors gorhom's sheet position (-1 closed → 0 open). The screen behind
   * subscribes to it and scales itself down, so presenting this sheet is the
   * same stack gesture as everything inside it.
   */
  animatedIndex?: SharedValue<number>;
  /** Render the perp experience inside the already-open asset detail sheet. */
  embeddedMarket?: PhoenixMarket | null;
  /**
   * Wallet resolved by the host before the sheet enters gorhom's portal.
   * Privy's hook cannot be read from the embedded portal because its provider
   * lives below that portal host. Standalone sheets resolve their own wallet.
   */
  embeddedWallet?: SigningWallet | null;
  /**
   * Side the embedded view opens on. A bearish podcast call arrives here having
   * already said which way it goes, so making the user re-pick Short is asking
   * a question that was answered upstream. Defaults to long everywhere else.
   */
  embeddedInitialSide?: PhoenixTradeSide;
  /**
   * Raise the order pad on `embeddedInitialSide` as soon as the market opens,
   * for a caller whose control said "Short this" rather than "show me this".
   * Honoured only once the perps account is registered and a wallet is
   * present — before that the bottom bar is the ACTIVATE PERPS step, and
   * throwing a ticket over it would ask for a size that cannot be submitted.
   */
  embeddedAutoOpenOrder?: boolean;
  /**
   * Reports whether a card (the order ticket or Auto Close) is raised over the
   * market, so the host can hide chrome that would otherwise float on top of
   * it — the venue toggle sits above this whole surface.
   *
   * **Rendering only.** This must never be wired back into the host sheet's
   * `enableContentPanningGesture` / `enablePanDownToClose`: toggling those on an
   * open gorhom modal remounts everything inside it, which is exactly what used
   * to destroy the ticket a frame after it opened. The cards block the sheet's
   * drag with their own pan gesture instead.
   */
  onEmbeddedOverlayOpenChange?: (open: boolean) => void;
  /**
   * Opens the deposit flow. The order pad offers it when the wallet cannot
   * cover a margin, and from the "+" beside the available balance. Falls back
   * to the deposit route when the host has no sheet of its own.
   */
  onEmbeddedAddCash?: () => void;
  /**
   * Spendable wallet USDC, read by the host.
   *
   * Embedded, this component is rendered into gorhom's portal, so it mounts
   * ABOVE `WalletStoreProvider` (the provider lives in the `(app)` layout, the
   * portal host in the root one) and `useCash()` silently returns the empty
   * fallback — $0.00. Every ticket then said "Not enough cash for this margin"
   * no matter what the wallet held. The host reads cash at its own place in the
   * tree and hands it down. See [[bottom-sheet-context-loss]].
   */
  embeddedCashUsd?: number | null;
  /** Re-read the host's wallet balances after this view moves money. */
  onEmbeddedCashRefresh?: () => Promise<void> | void;
  /** Shared detail tabs remain selected when the user switches venues. */
  embeddedActiveTab?: PhoenixDetailTab;
  onEmbeddedTabChange?: (tab: PhoenixDetailTab) => void;
  embeddedSandwichesContent?: React.ReactNode;
  /** Perp-only holders list (open positions on this market), owned by the host. */
  embeddedHoldersContent?: React.ReactNode;
  /** Shown on the Holders tab label; null while loading, hidden at zero. */
  embeddedHolderCount?: number | null;
  /** Actions shared with the spot header (for example share and save). */
  embeddedHeaderActions?: React.ReactNode;
  /**
   * The host pins the Spot/Perp toggle beside its own back button, so this
   * header must not reserve a row for it above the market identity.
   */
  embeddedTogglePinned?: boolean;
  /**
   * Raster icon from the spot side, used for markets the equity logo CDN does
   * not serve — every crypto perp. Phoenix's own `logoUri` is an SVG, which RN's
   * `Image` cannot render, so without this a crypto header falls through to the
   * initial-letter placeholder.
   */
  embeddedIconUri?: string | null;
  /**
   * The host is mid-animation, so native layers cannot follow it — the same
   * gate the spot side applies through `embeddedGlassEnabled`. An unpainted
   * low-opacity glass pill is a white label on a near-white fill, so the CTAs take
   * their opaque fallback fill until the host settles.
   *
   * A settled clipped/transformed/shadowed host is fine: measured on iOS 26,
   * `GlassView` paints identically inside one.
   */
  embeddedDisableGlass?: boolean;
  /**
   * Where the pinned LONG / SHORT bar is rendered.
   *
   * `hoisted` means the host draws it outside this surface and this view draws
   * nothing. The Sandwich leg needs that: measured on iOS 26, a `GlassView`
   * inside the leg's morph card paints no fill at all, while the identical pill
   * in the host's own floating layer — the one the spot BUY uses — paints
   * normally. A hoisted host drives the bar through `openOrder` / `activate`
   * and follows {@link onEmbeddedActionStateChange}.
   */
  embeddedActionBar?: 'inline' | 'hoisted';
  /** Which bar a hoisted host should be showing right now. */
  onEmbeddedActionStateChange?: (state: PerpActionBarState | null) => void;
  /**
   * Mirror of this surface's scroll offset, for a host whose own drag gesture
   * spans the whole screen (the zoom screen) and therefore has to know when the
   * content underneath still has scrolling left to do.
   */
  embeddedScrollY?: SharedValue<number>;
  /**
   * The headline this surface is showing (live mark + selected-range %), so a
   * host's own collapsed header can print the perp's figures instead of spot's.
   */
  onEmbeddedQuoteChange?: (quote: { price: number | null; changePercent: number | null }) => void;
  /** Blocks a parent full-screen dismiss gesture while this chart owns touches. */
  embeddedChartGestureActive?: SharedValue<boolean>;
  /**
   * Safe-area gap for a host that renders this surface full-screen.
   *
   * It has to land on the CONTENT, never on the surface itself: the order
   * ticket and its backdrop are `absoluteFill` children, so padding the
   * container shifts them down and leaves a dead band of exactly this height at
   * the bottom of the screen.
   */
  embeddedTopInset?: number;
};

/**
 * Detail sheet for a Phoenix perp, opened from a search result.
 *
 * **Live.** The mark price repolls every 5s and the candles every 15s, and the
 * live mark is folded into the newest candle (`applyLiveMark`) so the rightmost
 * bar tracks the headline number rather than sitting frozen between candle
 * refreshes. Polling stops when the sheet closes and when the app backgrounds —
 * Phoenix's ~5 req/s budget is shared with everything else in the app.
 *
 * Trading is atomic: existing free Phoenix collateral is used first and any
 * shortfall is deposited from wallet USDC immediately before the market order.
 * Both instructions share one user approval and either land together or fail.
 *
 * The order ticket itself lives behind the LONG / SHORT bar pinned to the
 * bottom of the sheet: tapping either side raises {@link PhoenixOrderPad} as an
 * in-sheet overlay rather than a second modal — stacking modals is unreliable
 * on the New Architecture. See [[bottom-sheet-present-pattern]].
 */
const PhoenixMarketDetailSheetContent = forwardRef<
  PhoenixMarketDetailSheetRef,
  PhoenixMarketDetailSheetProps & { resolvedWallet: SigningWallet | null }
>(function PhoenixMarketDetailSheetContent(
  {
    onClose,
    animatedIndex,
    embeddedMarket = null,
    notificationTweetUrl,
    embeddedScrollY,
    embeddedChartGestureActive,
    embeddedTopInset = 0,
    resolvedWallet: wallet,
    embeddedInitialSide = 'long',
    embeddedAutoOpenOrder = false,
    onEmbeddedOverlayOpenChange,
    onEmbeddedAddCash,
    embeddedCashUsd = null,
    onEmbeddedCashRefresh,
    embeddedActiveTab = 'sandwiches',
    onEmbeddedTabChange,
    embeddedSandwichesContent,
    embeddedHoldersContent,
    embeddedHolderCount = null,
    embeddedHeaderActions,
    embeddedTogglePinned = false,
    embeddedIconUri = null,
    embeddedDisableGlass = false,
    embeddedActionBar = 'inline',
    onEmbeddedActionStateChange,
    onEmbeddedQuoteChange,
  },
  ref,
) {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useThemeStore();
    const sheetColors = getSheetColors(colors);
    const safeArea = useSafeAreaInsets();
    // Native glass is enabled once the host has settled; the host keeps the
    // fallback only during its transform animation.
    const useGlass = HAS_GLASS && !embeddedDisableGlass;
    const toast = useToast();
    const tradeFx = useTradeFx();
    // Only trustworthy when this component is NOT embedded — see
    // `embeddedCashUsd` for why the portal makes this read $0.
    const cash = useCash();
    const cashUsd = embeddedCashUsd ?? cash.idleUsdc;
    const refreshCash = useCallback(async () => {
      if (onEmbeddedCashRefresh) await onEmbeddedCashRefresh();
      else await cash.refresh(true);
    }, [cash, onEmbeddedCashRefresh]);
    const { width } = useWindowDimensions();

    const sheetRef = useRef<BottomSheetModal>(null);
    const isOpenRef = useRef(false);
    /** One auto-raised ticket per embedded open — see the effect below. */
    const autoOrderFiredRef = useRef(false);

    const [market, setMarket] = useState<PhoenixMarket | null>(null);
    const [range, setRange] = useState<PhoenixRange>('24H');
    const { timeframe, bars: rangeBars } = PHOENIX_RANGES[range];
    const [live, setLive] = useState(false);
    const [account, setAccount] = useState<PhoenixAccountResponse | null>(null);
    // Starts true: the account is unknown, not absent, until the first read
    // lands. Starting false made the bar render ACTIVATE PERPS for the gap
    // between mount and the read — telling an activated user to activate.
    const [accountLoading, setAccountLoading] = useState(true);
    const [side, setSide] = useState<PhoenixTradeSide>('long');
    const [marginUsd, setMarginUsd] = useState('');
    const [leverage, setLeverage] = useState(2);
    const [submitting, setSubmitting] = useState(false);
    /** Separate from `submitting`: only the top-up chip should show a spinner. */
    const [movingCash, setMovingCash] = useState(false);
    const [tradeError, setTradeError] = useState<string | null>(null);
    const [orderOpen, setOrderOpen] = useState(false);
    const [autoCloseOpen, setAutoCloseOpen] = useState(false);
    // 0 = Auto Close hidden, 1 = raised. Also drives the scale-down of the
    // order ticket stacked behind it.
    const autoProgress = useSharedValue(0);
    const autoDragY = useSharedValue(0);
    // Auto-close levels chosen for the entry being sized. They ride along with
    // the market order so the position is never briefly unprotected.
    const [takeProfitPrice, setTakeProfitPrice] = useState<number | null>(null);
    const [stopLossPrice, setStopLossPrice] = useState<number | null>(null);

    // 0 = order pad hidden, 1 = fully raised. Drives both the overlay transform
    // and the dimming of the market content behind it.
    const orderProgress = useSharedValue(0);
    const orderDragY = useSharedValue(0);
    const orderTouchStartX = useSharedValue(0);
    const orderTouchStartY = useSharedValue(0);
    const autoTouchStartX = useSharedValue(0);
    const autoTouchStartY = useSharedValue(0);

    const snapPoints = useMemo(() => ['92%'], []);

    const { detail, candles, loading, error, candlesError, refresh } = usePhoenixLiveMarket(
      market?.symbol ?? null,
      timeframe,
      live,
    );

    /**
     * Read the perps account, and **never downgrade a known-good one**.
     *
     * This drives the pinned action bar: a null account renders ACTIVATE PERPS
     * instead of LONG / SHORT. Wiping state on every failure meant one 429 —
     * routine, since this screen also polls prices and candles against Phoenix's
     * shared ~5 req/s bucket — replaced a registered user's trade buttons with an
     * activation button, and there was no way to long or short until the sheet
     * was reopened. Only an answer that genuinely means "there is no account"
     * clears it. Same rule as the cash balance's; see [[cash-balance-never-zero]].
     */
    const loadAccount = useCallback(async () => {
      setAccountLoading(true);
      try {
        setAccount(await getPhoenixAccount());
      } catch (cause) {
        const code = cause instanceof PhoenixApiError ? cause.code : null;
        if (code === 'no_wallet' || code === 'Unauthorized') setAccount(null);
      } finally {
        setAccountLoading(false);
      }
    }, []);

    /**
     * The market's own tier-1 ceiling (20x on AAPL) — Bread no longer imposes a
     * flat cap of its own. Floored to a whole number so the ruler ends on a
     * labelled stop; the backend still re-checks the tier for the actual size.
     */
    const maxLeverage = Math.max(1, Math.floor(market?.maxLeverage ?? 1));

    const hideOrderPadImmediately = useCallback(() => {
      setOrderOpen(false);
      setAutoCloseOpen(false);
      setTakeProfitPrice(null);
      setStopLossPrice(null);
      orderProgress.value = 0;
      orderDragY.value = 0;
      autoProgress.value = 0;
      autoDragY.value = 0;
    }, [autoDragY, autoProgress, orderDragY, orderProgress]);

    const openAutoClose = useCallback(() => {
      autoDragY.value = 0;
      if (autoOpenRef.current) {
        // Caught mid-close: reverse now, no mount is coming.
        autoProgress.value = withSpring(1, ORDER_ENTRY);
      } else {
        // Parked off-screen; the entry starts in the effect below, once the pad
        // has mounted. Same race as the ticket — a spring started here spent its
        // first frames on a card that did not exist yet.
        autoProgress.value = 0;
      }
      setAutoCloseOpen(true);
    }, [autoDragY, autoProgress]);

    const autoOpenRef = useRef(false);
    useEffect(() => {
      const wasOpen = autoOpenRef.current;
      autoOpenRef.current = autoCloseOpen;
      if (autoCloseOpen && !wasOpen) {
        autoProgress.value = withSpring(1, ORDER_ENTRY);
      }
    }, [autoCloseOpen, autoProgress]);

    const closeAutoClose = useCallback(() => {
      Keyboard.dismiss();
      autoProgress.value = withTiming(0, ORDER_EXIT, (finished) => {
        'worklet';
        if (finished) runOnJS(setAutoCloseOpen)(false);
      });
    }, [autoProgress]);

    const closeOrderPad = useCallback(() => {
      // Unmount only once the exit animation finishes — dropping the overlay on
      // the spot would cut it off mid-slide. A fast re-tap on LONG/SHORT can
      // still grab it mid-close and spring it back.
      // The drag offset is left where the finger dropped it — openOrderPad
      // resets it before the next open — so the pad continues from there.
      orderProgress.value = withTiming(0, ORDER_EXIT, (finished) => {
        'worklet';
        if (finished) runOnJS(setOrderOpen)(false);
      });
    }, [orderProgress]);

    const openOrderPad = useCallback(
      (nextSide: PhoenixTradeSide) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setSide(nextSide);
        setMarginUsd('');
        setLeverage(Math.min(2, maxLeverage));
        setTradeError(null);
        setAutoCloseOpen(false);
        autoProgress.value = 0;
        // Levels are side-specific — a long's take profit is above the mark and
        // a short's is below — so they never carry across a side switch.
        setTakeProfitPrice(null);
        setStopLossPrice(null);
        orderDragY.value = 0;
        if (orderOpenRef.current) {
          // Already mounted — this tap caught the ticket mid-close, so reverse
          // it now rather than waiting for a mount that isn't coming.
          orderProgress.value = withSpring(1, ORDER_ENTRY);
        } else {
          // Parked off-screen. The entry spring starts in the effect below,
          // AFTER the ticket has mounted: kicking it off here ran the first
          // third of the animation on the UI thread while JS was still
          // rendering the pad, so the card appeared already halfway up.
          orderProgress.value = 0;
        }
        setOrderOpen(true);
      },
      [autoProgress, maxLeverage, orderDragY, orderProgress],
    );

    // Mount first, then slide. See the comment in openOrderPad.
    const orderOpenRef = useRef(false);
    useEffect(() => {
      const wasOpen = orderOpenRef.current;
      orderOpenRef.current = orderOpen;
      if (orderOpen && !wasOpen) {
        orderProgress.value = withSpring(1, ORDER_ENTRY);
      }
    }, [orderOpen, orderProgress]);

    // Latest-callback refs: the handle is declared above `activate`, and a
    // hoisted action bar needs both actions.
    const openOrderPadRef = useRef(openOrderPad);
    openOrderPadRef.current = openOrderPad;
    const activateRef = useRef<() => void>(() => {});

    useImperativeHandle(
      ref,
      () => ({
        // Presented straight from the tap rather than through an `isOpen` effect:
        // the modal must be driven imperatively or the first open silently no-ops.
        open(next: PhoenixMarket) {
          setMarket(next);
          setRange('24H');
          setSide('long');
          setMarginUsd('');
          setLeverage(Math.min(2, Math.max(1, next.maxLeverage)));
          setTradeError(null);
          setLive(true);
          hideOrderPadImmediately();
          void loadAccount();
          isOpenRef.current = true;
          sheetRef.current?.present();
        },
        close() {
          if (!isOpenRef.current) return;
          sheetRef.current?.dismiss();
        },
        openOrder(side: PhoenixTradeSide) {
          openOrderPadRef.current(side);
        },
        activate() {
          activateRef.current();
        },
      }),
      [hideOrderPadImmediately, loadAccount],
    );

    // Keyed on the market's SYMBOL, not the object.
    //
    // This effect is a navigation reset: it wipes the amount and leverage and,
    // via `hideOrderPadImmediately`, any open order ticket. Keyed on object
    // identity, a parent that re-creates an equal market
    // object re-ran the whole reset while the user was standing on the screen.
    // The visible symptom was brutal and looked like a dead control: tapping
    // LONG or SHORT opened the ticket and the next reset closed it again within
    // a frame, so perps simply could not be traded from the stock detail screen.
    // A market whose symbol has not changed is the same market.
    const embeddedSymbol = embeddedMarket?.symbol ?? null;
    useEffect(() => {
      if (!embeddedMarket) return;

      autoOrderFiredRef.current = false;
      setMarket(embeddedMarket);
      setRange('24H');
      setSide(embeddedInitialSide);
      setMarginUsd('');
      setLeverage(Math.min(2, Math.max(1, embeddedMarket.maxLeverage)));
      setTradeError(null);
      setLive(true);
      hideOrderPadImmediately();
      void loadAccount();

      return () => {
        setLive(false);
        hideOrderPadImmediately();
      };
      // Re-running when the requested side changes is intended: it means the
      // parent opened this market from a different call. Toggling LONG/SHORT
      // *inside* the sheet only moves local state, so it never resets the pad.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `embeddedSymbol`
      // stands in for `embeddedMarket` on purpose; see the note above.
    }, [embeddedSymbol, embeddedInitialSide, hideOrderPadImmediately, loadAccount]);

    useEffect(() => {
      if (!embeddedMarket) return;
      onEmbeddedOverlayOpenChange?.(orderOpen || autoCloseOpen);
    }, [autoCloseOpen, embeddedMarket, onEmbeddedOverlayOpenChange, orderOpen]);

    const activate = useCallback(async () => {
      if (submitting) return;
      setSubmitting(true);
      setTradeError(null);
      const toastId = toast.showToast('Activating perps…', 'processing', 0);
      try {
        await registerPhoenixAccount();
        // Phoenix broadcasts through its onboarder service; its public trader
        // view can trail confirmation briefly, so keep this one-tap flow on the
        // activation state until registration is actually visible.
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750));
          const next = await getPhoenixAccount();
          setAccount(next);
          if (next.account.registered) break;
        }
        toast.dismissToast(toastId);
        toast.showToast('Perps account activated', 'success');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not activate perps.';
        setTradeError(message);
        toast.dismissToast(toastId);
        toast.showToast(message, 'error');
      } finally {
        setSubmitting(false);
      }
    }, [submitting, toast]);

    const placeTrade = useCallback(async () => {
      if (!market || submitting) return;
      if (!wallet) {
        // Silently returning here left the confirm button inert with no
        // explanation. The guard further down throws the same sentence into
        // the error toast; this one only ever swallowed it.
        const message = 'Connect a wallet before trading.';
        setTradeError(message);
        toast.showToast(message, 'error');
        return;
      }
      setSubmitting(true);
      setTradeError(null);
      const label = side === 'long' ? 'Long' : 'Short';
      /** Artwork for the receipt, best source first. See `perpLogoSources`. */
      const perpReceiptLogo = () => {
        const logo = perpLogoSources(market, embeddedIconUri);
        return { logoUri: logo.uri, logoFallbackUris: logo.fallbackUris };
      };
      const receiptLogo = perpReceiptLogo();
      const receiptSymbol = normalizePhoenixAssetSymbol(market.symbol);
      const pendingReceipt = {
        action: 'open' as const,
        side,
        symbol: receiptSymbol,
        name: market.name ?? null,
        ...receiptLogo,
        leverage,
        entryPrice: detail?.markPrice ?? null,
        marginUsd: Number(marginUsd) || null,
        // Phoenix positions have no Bread row; the symbol is the key, scoped
        // to the trader server-side.
        thesis: {
          positionKind: 'phoenix' as const,
          positionId: receiptSymbol,
          name: market.name?.trim() || receiptSymbol,
          direction: label.toUpperCase(),
          leverage,
          pct: null,
          valueUsd: Number(marginUsd) || null,
          logoUrl: receiptLogo.logoUri,
          logoFallbackUrls: receiptLogo.logoFallbackUris,
        },
      };
      // Use the same progress surface as a stock buy. `loading` suppresses the
      // receipt's hero, burst and success haptics until the position is real.
      const receiptId = tradeFx.playPerp({ ...pendingReceipt, loading: true });
      try {
        // Paper mode (dev builds only): everything above this line has already
        // run — the pad validated, sized, and priced the order — so the receipt
        // gets the same numbers a live fill would have produced. What it skips
        // is the part that costs money: building, signing, and broadcasting.
        if (isPaperMode()) {
          await new Promise((resolve) => setTimeout(resolve, PAPER_FILL_DELAY_MS));
          tradeFx.updatePerp(receiptId, { ...pendingReceipt, loading: false });
          closeOrderPad();
          setSubmitting(false);
          return;
        }
        if (!wallet) throw new Error('Connect a wallet before trading.');
        // Usually already built while the pad sat on these inputs; see
        // lib/phoenix-prebuild. Falls back to a fresh build otherwise.
        const built = await takePhoenixOrderBuild(
          {
            symbol: market.symbol,
            side,
            marginUsd,
            leverage,
            autoFund: true,
            takeProfitPrice,
            stopLossPrice,
          },
          detail?.markPrice ?? null,
        );
        const sent = await signAndSendBase64WithResult(wallet, built.transaction, {
          lastValidBlockHeight: built.lastValidBlockHeight,
          requireConfirmed: true,
          // The build route simulated these exact instructions a moment ago;
          // a second simulation in /api/solana/send is a duplicate RPC hop.
          skipSimulation: true,
          // "processed" is a landed fill. Holding for "confirmed" only adds a
          // slot plus a 400ms poll tick; the send helper still falls back to
          // the full confirmation window if the fast pass sees nothing.
          fastConfirm: true,
        });
        // Followers hear about the open; the server verifies the fill first.
        void confirmPhoenixOpen({
          signature: sent.signature,
          symbol: market.symbol,
          side,
          marginUsd: built.preview.marginUsd,
          leverage: built.preview.leverage,
        });
        // Bookkeeping never blocks the receipt. The leverage ledger is written
        // before the account re-read so the refreshed position shows the right
        // multiplier; both are best-effort after a fill that already landed.
        void recordPhoenixPositionLeverage(
          wallet.address,
          market.symbol,
          built.preview.leverage,
          built.preview.marginUsd,
        )
          .then(() => Promise.all([loadAccount(), refreshCash()]))
          .catch(() => undefined);
        // The same full-screen receipt a stock buy opens, carrying the three
        // facts a spot trade has no slot for: direction, leverage, and fill.
        tradeFx.updatePerp(receiptId, {
          action: 'open',
          side,
          symbol: normalizePhoenixAssetSymbol(market.symbol),
          name: market.name ?? null,
          ...perpReceiptLogo(),
          leverage: built.preview.leverage,
          entryPrice: built.preview.markPrice,
          marginUsd: built.preview.marginUsd,
          loading: false,
        });
        // Drop back to the market once the position exists, so the fresh
        // account/stats are what the user lands on.
        closeOrderPad();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : `Could not open ${label.toLowerCase()}.`;
        setTradeError(message);
        tradeFx.dismissPerp(receiptId);
        toast.showToast(message, 'error');
      } finally {
        setSubmitting(false);
      }
    }, [
      closeOrderPad,
      detail?.markPrice,
      embeddedIconUri,
      leverage,
      loadAccount,
      marginUsd,
      market,
      refreshCash,
      side,
      stopLossPrice,
      submitting,
      takeProfitPrice,
      toast,
      tradeFx,
      wallet,
    ]);

    const handleDismiss = useCallback(() => {
      isOpenRef.current = false;
      // Stop polling the moment the sheet goes away — a closed sheet must not
      // keep spending the shared rate-limit budget.
      setLive(false);
      hideOrderPadImmediately();
      onClose?.();
    }, [hideOrderPadImmediately, onClose]);

    // Swipe down anywhere on the order pad closes only the pad, never the whole
    // sheet. Manual activation keeps taps, the leverage ruler, and the keypad
    // with their own responders until the touch is clearly a downward drag.
    const orderDismissPan = useMemo(
      () =>
        Gesture.Pan()
          .manualActivation(true)
          .onTouchesDown((event) => {
            'worklet';
            const touch = event.allTouches[0];
            if (!touch) return;
            orderTouchStartX.value = touch.absoluteX;
            orderTouchStartY.value = touch.absoluteY;
          })
          .onTouchesMove((event, manager) => {
            'worklet';
            const touch = event.allTouches[0];
            if (!touch) return;
            const dx = touch.absoluteX - orderTouchStartX.value;
            const dy = touch.absoluteY - orderTouchStartY.value;
            if (Math.abs(dx) > Math.abs(dy)) {
              if (Math.abs(dx) > 10) manager.fail();
              return;
            }
            if (dy < 0) {
              manager.fail();
              return;
            }
            if (dy > 10) manager.activate();
          })
          .onUpdate((event) => {
            'worklet';
            orderDragY.value = Math.max(0, event.translationY);
          })
          .onEnd((event) => {
            'worklet';
            // Apple's momentum projection: distance and velocity resolve into a
            // single dismiss decision.
            const decel = 0.998;
            const projected = event.translationY + (event.velocityY / 1000) * (decel / (1 - decel));
            if (projected > 120) {
              runOnJS(closeOrderPad)();
            } else {
              orderDragY.value = withSpring(0, {
                velocity: event.velocityY,
                damping: 24,
                stiffness: 260,
                mass: 1,
              });
            }
          }),
      [closeOrderPad, orderDragY, orderTouchStartX, orderTouchStartY],
    );

    const autoDismissPan = useMemo(
      () =>
        Gesture.Pan()
          .manualActivation(true)
          .onTouchesDown((event) => {
            'worklet';
            const touch = event.allTouches[0];
            if (!touch) return;
            autoTouchStartX.value = touch.absoluteX;
            autoTouchStartY.value = touch.absoluteY;
          })
          .onTouchesMove((event, manager) => {
            'worklet';
            const touch = event.allTouches[0];
            if (!touch) return;
            const dx = touch.absoluteX - autoTouchStartX.value;
            const dy = touch.absoluteY - autoTouchStartY.value;
            if (Math.abs(dx) > Math.abs(dy)) {
              if (Math.abs(dx) > 10) manager.fail();
              return;
            }
            if (dy < 0) {
              manager.fail();
              return;
            }
            if (dy > 10) manager.activate();
          })
          .onUpdate((event) => {
            'worklet';
            autoDragY.value = Math.max(0, event.translationY);
          })
          .onEnd((event) => {
            'worklet';
            const decel = 0.998;
            const projected =
              event.translationY + (event.velocityY / 1000) * (decel / (1 - decel));
            if (projected > 120) {
              runOnJS(closeAutoClose)();
            } else {
              autoDragY.value = withSpring(0, {
                velocity: event.velocityY,
                damping: 24,
                stiffness: 260,
                mass: 1,
              });
            }
          }),
      [autoDragY, autoTouchStartX, autoTouchStartY, closeAutoClose],
    );

    const autoBackdropStyle = useAnimatedStyle(() => ({
      opacity: interpolate(autoProgress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    }));
    // The SL/TP card is bottom-anchored and its fields take a keyboard, so it
    // rides above one rather than sitting behind it.
    const keyboard = useAnimatedKeyboard();
    const autoCardStyle = useAnimatedStyle(() => ({
      transform: [
        {
          translateY:
            interpolate(autoProgress.value, [0, 1], [AUTO_CARD_TRAVEL, 0], Extrapolation.CLAMP) +
            autoDragY.value -
            keyboard.height.value,
        },
      ],
    }));

    // The market content stacks behind the ticket exactly as the ticket stacks
    // behind Auto Close — one vocabulary for "a screen came up over this one".
    const stackedMarketStyle = useAnimatedStyle(() => ({
      borderRadius: interpolate(orderProgress.value, [0, 1], [0, SHEET_RADIUS], Extrapolation.CLAMP),
      transform: [
        { scale: interpolate(orderProgress.value, [0, 1], [1, STACK_SCALE], Extrapolation.CLAMP) },
        {
          translateY: interpolate(
            orderProgress.value,
            [0, 1],
            [0, STACK_PUSH_Y],
            Extrapolation.CLAMP,
          ),
        },
      ],
    }));
    // The ticket stays anchored while SL/TP rises as a compact modal over it.
    // The scrim supplies the depth, matching the native trade-ticket pattern.
    const orderOverlayStyle = useAnimatedStyle(() => ({
      transform: [
        {
          translateY:
            // The card's own height: anything shorter leaves its footer peeking
            // on the first frame of the open animation.
            interpolate(orderProgress.value, [0, 1], [ORDER_CARD_HEIGHT, 0], Extrapolation.CLAMP) +
            orderDragY.value,
        },
      ],
    }));

    const renderBackdrop = useCallback(
      (props: React.ComponentProps<typeof BottomSheetBackdrop>) => <BlurBackdrop {...props} />,
      [],
    );

    const marketStats = detail?.stats ?? null;
    const markPrice = detail?.markPrice ?? marketStats?.markPrice ?? null;
    const statsChange =
      marketStats && marketStats.previousDayMarkPrice > 0
        ? {
            changeUsd: marketStats.markPrice - marketStats.previousDayMarkPrice,
            changePercent:
              ((marketStats.markPrice - marketStats.previousDayMarkPrice) /
                marketStats.previousDayMarkPrice) *
              100,
          }
        : null;
    // The headline % follows the chart's timeframe. 24h is only a fallback for
    // when the candles failed to load; while they load, the skeleton shows.
    const windowChange = useMemo(() => chartWindowChange(candles, markPrice, rangeBars), [candles, markPrice, rangeBars]);
    const change = windowChange ?? (candlesError ? (detail?.change24h ?? statsChange) : null);
    const changeLoading = loading || (candles.length === 0 && !candlesError);
    const headlineChangePercent = change?.changePercent ?? null;
    useEffect(() => {
      if (!embeddedMarket) return;
      onEmbeddedQuoteChange?.({ price: markPrice, changePercent: headlineChangePercent });
    }, [embeddedMarket, headlineChangePercent, markPrice, onEmbeddedQuoteChange]);
    // The chart's last bar follows the live mark, so the curve and the headline
    // price never disagree.
    const chartCandles = useMemo(() => applyLiveMark(candles, markPrice), [candles, markPrice]);

    const changeColor =
      change == null || change.changePercent === 0
        ? colors.textSecondary
        : change.changePercent > 0
          ? colors.chartPositive
          : colors.chartNegative;

    const latestFunding = detail?.funding?.[detail.funding.length - 1] ?? null;
    const currentFundingRate =
      marketStats?.currentFundingRatePercentage ?? latestFunding?.fundingRatePercentage ?? null;
    const openInterestUsd =
      marketStats && markPrice !== null ? marketStats.openInterestBase * markPrice : null;
    const orderLogoSources = market
      ? perpLogoSources(market, embeddedIconUri)
      : { uri: null, fallbackUris: [] };
    const chartWidth = width - 32;
    // The chart is the reason this sheet is open; give it the room.
    const chartHeight = 320;
    const margin = Number(marginUsd);
    const validMargin = Number.isFinite(margin) && margin >= 1;
    const availableMargin = Math.max(
      0,
      (account?.account.cross?.effectiveCollateral ?? 0) -
        (account?.account.cross?.initialMargin ?? 0),
    );
    /**
     * Liquidation and the stop ceiling for the trade being composed.
     *
     * Computed once, here, and handed to *both* cards in the stack. The order
     * Both surfaces receive the same maintenance-aware projection and use the
     * leverage tier the chosen size actually falls in, rather than reading only
     * the tier-1 headline `market.maxLeverage`.
     */
    const risk = useMemo(
      () =>
        entryRisk({
          side,
          markPrice,
          leverage,
          notionalUsd: validMargin ? margin * leverage : 0,
          market,
        }),
      [leverage, margin, market, markPrice, side, validMargin],
    );
    /**
     * Phoenix's advertised maximum is an initial-margin limit. Its separate
     * maintenance factor normally leaves a valid liquidation band at that exact
     * leverage. Keep a fail-closed scan only for unusual future market params.
     */
    const orderMaxLeverage = selectableMaxLeverage(
      risk.maxLeverage ?? maxLeverage,
      market?.maintenanceMarginBps ?? null,
    );

    useEffect(() => {
      setLeverage((current) => Math.min(current, orderMaxLeverage));
    }, [orderMaxLeverage]);

    const estimatedFee = validMargin ? margin * leverage * (market?.takerFee ?? 0) : 0;
    const estimatedCashMove = validMargin
      ? Math.max(0, margin + Math.max(0.1, estimatedFee) - availableMargin)
      : 0;
    const notEnoughCash = validMargin && estimatedCashMove > cashUsd + 0.000001;
    const canTrade =
      !!wallet &&
      account?.account.registered === true &&
      validMargin &&
      leverage <= orderMaxLeverage &&
      risk.liquidationPrice !== null &&
      !notEnoughCash &&
      !submitting;
    const registered = account?.account.registered === true;

    // Pre-build the order once the pad settles on a tradable set of inputs, so
    // the confirm slide is only sign + send. Same inputs placeTrade sends; the
    // debounce keeps keypad typing and leverage drags from spending Phoenix's
    // shared rate limit on every step. Paper mode never builds.
    const canPrebuild = orderOpen && !isPaperMode() && canTrade;
    const prebuildSymbol = market?.symbol ?? null;
    useEffect(() => {
      if (!canPrebuild || !prebuildSymbol) return;
      const timer = setTimeout(
        () =>
          prebuildPhoenixOrder({
            symbol: prebuildSymbol,
            side,
            marginUsd,
            leverage,
            autoFund: true,
            takeProfitPrice,
            stopLossPrice,
          }),
        400,
      );
      return () => clearTimeout(timer);
    }, [canPrebuild, leverage, marginUsd, prebuildSymbol, side, stopLossPrice, takeProfitPrice]);
    useEffect(() => {
      if (!orderOpen) clearPhoenixOrderPrebuild();
    }, [orderOpen]);

    // Keep `activate` reachable from the imperative handle declared above it.
    activateRef.current = () => void activate();

    // Tell a hoisted host which bar to draw. Mirrors the inline bar's own
    // branches exactly, so the two can never disagree.
    useEffect(() => {
      if (embeddedActionBar !== 'hoisted' || !onEmbeddedActionStateChange) return;
      if (registered) onEmbeddedActionStateChange({ kind: 'trade' });
      else if (account === null && accountLoading) onEmbeddedActionStateChange(null);
      else onEmbeddedActionStateChange({ kind: 'activate', submitting });
    }, [
      account,
      accountLoading,
      embeddedActionBar,
      onEmbeddedActionStateChange,
      registered,
      submitting,
    ]);

    /**
     * Cash the perps account is short for this order, offered as an explicit
     * top-up. Rounded UP to the cent — depositing the exact float can leave the
     * account a fraction of a cent light and the order still refused.
     *
     * Only offered when the wallet can actually cover it; when it can't, the
     * answer is more cash, not a transfer, and `padMessage` says so.
     */
    const moveCashUsd =
      registered && validMargin && estimatedCashMove > 0 && !notEnoughCash
        ? Math.min(Math.ceil(estimatedCashMove * 100) / 100, cashUsd)
        : 0;

    /**
     * Fund the perps account from wallet USDC, without leaving the ticket.
     *
     * The order itself already auto-funds any shortfall in the same
     * transaction, so this is not required to trade — it exists because the
     * ticket shows "$X perps · $Y cash" and the user should be able to act on
     * that split right here rather than backing out to the account sheet.
     */
    const moveCashToPerps = useCallback(async () => {
      if (!wallet || movingCash || moveCashUsd <= 0) return;
      setMovingCash(true);
      setTradeError(null);
      const toastId = toast.showToast('Moving to perps…', 'processing', 0);
      try {
        const built = await buildPhoenixDeposit(moveCashUsd.toFixed(2));
        await signAndSendBase64WithResult(wallet, built.transaction, {
          lastValidBlockHeight: built.lastValidBlockHeight,
          requireConfirmed: true,
        });
        // Both sides moved, so both are re-read before the ticket re-renders:
        // the collateral row and the cash row must agree with each other.
        await Promise.all([loadAccount(), refreshCash()]);
        toast.dismissToast(toastId);
        toast.showToast(`${formatUsd(built.amountUsd)} moved to perps`, 'success');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not move cash to perps.';
        setTradeError(message);
        toast.dismissToast(toastId);
        toast.showToast(message, 'error');
      } finally {
        setMovingCash(false);
      }
    }, [loadAccount, moveCashUsd, movingCash, refreshCash, toast, wallet]);

    // Auto-raise the ticket for a caller that already said "Short this".
    //
    // It waits on `registered` because the account load is async: firing on
    // mount would hit the ACTIVATE PERPS state and put a ticket over a market
    // that can't take an order yet. Fires once per open — the market effect
    // above clears the guard, so re-opening the same market from another call
    // raises it again, while a user who dismisses the pad doesn't have it
    // thrown back at them by the next account poll.
    useEffect(() => {
      if (!embeddedMarket || !embeddedAutoOpenOrder) return;
      if (autoOrderFiredRef.current) return;
      if (!registered || !wallet) return;
      autoOrderFiredRef.current = true;
      openOrderPad(embeddedInitialSide);
    }, [embeddedAutoOpenOrder, embeddedInitialSide, embeddedMarket, openOrderPad, registered, wallet]);

    // No "not enough cash" line: the ADD CASH / MOVE button that replaces the
    // slider already says it, and says what to do about it.
    const padMessage = tradeError
      ? tradeError
      : marginUsd !== '' && !validMargin
        ? 'Minimum margin is $1.'
        : null;

    // The embedded view can also live inside a card-morph surface that is not
    // backed by Gorhom. Its animated native scroll view publishes directly on
    // the UI thread; the standalone modal keeps Gorhom's gesture-aware one.
    const MarketScrollView = embeddedMarket ? Reanimated.ScrollView : BottomSheetScrollView;
    const handleMarketScroll = useAnimatedScrollHandler({
      onScroll: (event) => {
        if (embeddedScrollY) embeddedScrollY.value = event.contentOffset.y;
      },
    });
    // Gorhom wraps the scrollable's `onScroll` in `runOnJS`, which cannot take
    // a Reanimated handler object (Worklets: "wasn't converted to a
    // Serializable"). The Gorhom path gets a plain JS callback instead.
    const handleMarketScrollJS = useCallback(
      (event: { nativeEvent: { contentOffset: { y: number } } }) => {
        if (embeddedScrollY) embeddedScrollY.value = event.nativeEvent.contentOffset.y;
      },
      [embeddedScrollY],
    );

    const perpAboutContent = market ? (
      <View style={styles.aboutContent}>
        <View style={styles.stats}>
          <StatRow
            label="Open interest (OI)"
            hint="Total value of positions that are still open."
            value={
              openInterestUsd !== null
                ? formatCompactUsd(openInterestUsd)
                : loading
                  ? null
                  : '—'
            }
          />
          <StatRow
            label="24h volume"
            hint="Total value traded in the last 24 hours."
            value={
              marketStats
                ? formatCompactUsd(marketStats.volume24hUsd)
                : loading
                  ? null
                  : '—'
            }
          />
          <StatRow
            label="Maker / taker fees"
            hint="Maker adds an order; taker fills an order right away."
            value={`${formatFeePercentage(market.makerFee)} / ${formatFeePercentage(
              market.takerFee,
            )}`}
          />
          <StatRow
            label="Max leverage"
            hint="The largest position multiplier this market allows."
            value={`${market.maxLeverage}x`}
          />
          <StatRow
            label="Funding rate"
            hint={
              currentFundingRate === null || currentFundingRate === 0
                ? 'A regular payment between long and short traders.'
                : currentFundingRate > 0
                  ? 'Long traders pay short traders at this rate.'
                  : 'Short traders pay long traders at this rate.'
            }
            value={
              currentFundingRate !== null
                ? `${formatSignedPercentage(currentFundingRate, 4)} every ${formatFundingInterval(
                    market.fundingIntervalSeconds,
                  )}`
                : loading
                  ? null
                  : '—'
            }
          />
        </View>
      </View>
    ) : null;

    const marketHeader = market ? (
      <View
        style={[
          styles.detailHeader,
          embeddedMarket && styles.scrollingDetailHeader,
          // Embedded, the inset sits on the scroll view instead (below), so
          // content is clipped under the host's chrome rather than scrolling
          // up behind its back button and compact header.
          { paddingTop: embeddedMarket ? 0 : 14 + embeddedTopInset },
        ]}
      >
        {embeddedMarket && (!embeddedTogglePinned || embeddedHeaderActions) ? (
          <View style={styles.topBar}>
            {embeddedHeaderActions}
            {embeddedTogglePinned ? null : <View style={styles.togglePlaceholder} />}
          </View>
        ) : null}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <AssetLogo
              {...perpLogoSources(market, embeddedIconUri)}
              size={40}
              borderRadius={20}
              backgroundColor="transparent"
              fallback={
                <View style={styles.iconFallback}>
                  <Text style={styles.iconFallbackText}>{market.symbol.slice(0, 1)}</Text>
                </View>
              }
            />
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={1}>
                {market.name}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {normalizePhoenixAssetSymbol(market.symbol)}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            {markPrice === null ? (
              <ValueSkeletonLine
                lineHeight={34}
                width={112}
                accessibilityLabel="Loading mark price"
              />
            ) : (
              <Text style={styles.price}>{formatUsd(markPrice)}</Text>
            )}
            {change ? (
              <Text style={[styles.change, { color: changeColor }]}>
                {`${change.changePercent >= 0 ? '+' : ''}${change.changePercent.toFixed(2)}%`}
              </Text>
            ) : changeLoading ? (
              <ValueSkeletonLine
                lineHeight={19}
                width={58}
                accessibilityLabel="Loading price change"
              />
            ) : (
              <Text style={[styles.change, { color: changeColor }]}>—</Text>
            )}
          </View>
        </View>
      </View>
    ) : null;

    const sheetContents = (
        <View style={styles.sheetBody}>
        <Reanimated.View style={[styles.stackedMarket, stackedMarketStyle]}>
        {market ? (
          <LinearGradient
            colors={changeTintColors(change?.changePercent)}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.topTint}
            pointerEvents="none"
          />
        ) : null}
        {!embeddedMarket ? marketHeader : null}
        <MarketScrollView
          style={embeddedMarket ? { marginTop: 14 + embeddedTopInset } : undefined}
          contentContainerStyle={styles.content}
          scrollEventThrottle={16}
          onScroll={embeddedMarket ? handleMarketScroll : handleMarketScrollJS}
        >
          {embeddedMarket ? marketHeader : null}
          {market ? (
            <>
              {chartCandles.length === 0 ? (
                <View style={[styles.chartLoading, { width: chartWidth, height: chartHeight }]}>
                  {/* A candle poll that fails leaves nothing to draw. Say which
                      it is — an empty plot under a live price reads as "this
                      timeframe is broken". The poll retries on its own. */}
                  {candlesError && !loading ? (
                    <>
                      <Text style={styles.error}>Couldn’t load the {range} chart.</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry chart"
                        onPress={refresh}
                        hitSlop={8}
                      >
                        <Text style={styles.retryText}>Try again</Text>
                      </Pressable>
                    </>
                  ) : (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  )}
                </View>
              ) : (
                <PhoenixMarkChart
                  candles={chartCandles}
                  width={chartWidth}
                  height={chartHeight}
                  priceAxis
                  timeAxis
                  interactive
                  interactionActive={embeddedChartGestureActive}
                  viewportKey={range}
                  initialVisibleCandles={rangeBars}
                  markPrice={markPrice}
                  hideAxis
                />
              )}

              <View style={styles.chartControlsWrap}>
                <View style={styles.chartControlSpacer} pointerEvents="none" />
                <View style={styles.tfRow}>
                  {PHOENIX_RANGE_ORDER.map((option) => {
                    const active = range === option;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityLabel={`Show ${option} perp chart`}
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          void Haptics.selectionAsync();
                          setRange(option);
                        }}
                        style={styles.tfChip}
                      >
                        <Text style={[styles.tfText, active && styles.tfTextActive]}>
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.chartControlSpacer} pointerEvents="none" />
              </View>

              {error && markPrice === null ? (
                <Text style={styles.error}>{error}</Text>
              ) : null}

              {embeddedMarket ? (
                <>
                  <View style={styles.tabBarContainer}>
                    <View style={styles.tabBarRow}>
                      {(['sandwiches', 'holders', 'about'] as const).map((tab) => {
                        const active = embeddedActiveTab === tab;
                        const badge = tab === 'holders' ? embeddedHolderCount || null : null;
                        return (
                          <Pressable
                            key={tab}
                            accessibilityRole="button"
                            accessibilityLabel={`Show ${tab}`}
                            accessibilityState={{ selected: active }}
                            onPress={() => onEmbeddedTabChange?.(tab)}
                            style={styles.tabButton}
                          >
                            <Text style={active ? styles.tabLabelActive : styles.tabLabel}>
                              {tab === 'about' ? 'About' : tab === 'sandwiches' ? 'Sandwiches' : 'Holders'}
                              {badge ? ` (${badge > 99 ? '99+' : badge})` : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View style={styles.tabContent}>
                    {embeddedActiveTab === 'about'
                      ? perpAboutContent
                      : embeddedActiveTab === 'holders'
                        ? embeddedHoldersContent ?? null
                        : embeddedSandwichesContent ?? (
                          <Text style={styles.emptyTabText}>No sandwiches include this asset yet.</Text>
                        )}
                  </View>
                </>
              ) : (
                perpAboutContent
              )}
            </>
          ) : null}
        </MarketScrollView>

        {/* Pinned action bar — LONG / SHORT once the perps account exists, and
            the one-tap activation before that. */}
        {market &&
        !orderOpen &&
        embeddedActionBar !== 'hoisted' &&
        !(account === null && accountLoading) ? (
          <View
            style={[
              styles.bottomBar,
              // The transparent bar is a glass-only affordance: without a
              // refracting pill the content scrolls up behind the labels.
              !useGlass && { backgroundColor: sheetColors.background },
            ]}
          >
            {registered ? (
              <View style={styles.bottomBarRow}>
                {/* Not gated on `wallet`. Opening the ticket signs nothing —
                    the wallet is needed at submit, and `placeTrade` says so out
                    loud. Disabling here instead paints both pills at 45%
                    opacity behind a low-opacity glass tint, which on a light sheet is
                    a white label on a white pill: the bar reads as broken
                    rather than as blocked, and nothing on screen says why. */}
                <SideGlassButton
                  label="LONG"
                  color={colors.actionBuy}
                  glass={useGlass}
                  onPress={() => openOrderPad('long')}
                />
                <SideGlassButton
                  label="SHORT"
                  color={colors.actionSell}
                  glass={useGlass}
                  onPress={() => openOrderPad('short')}
                />
              </View>
            ) : (
              <SideGlassButton
                label={submitting ? 'ACTIVATING…' : 'ACTIVATE PERPS'}
                color={colors.actionPrimary}
                glass={useGlass}
                disabled={submitting || accountLoading}
                onPress={() => void activate()}
              />
            )}
          </View>
        ) : null}
        </Reanimated.View>

        {/* Order ticket — a card stacked over the market, not a second modal. */}
        {orderOpen && market ? (
          <GestureDetector gesture={orderDismissPan}>
            <Reanimated.View
              style={[
                styles.orderOverlay,
                // The ticket only has to clear the STATUS BAR, not the host's
                // content inset. `embeddedTopInset` is sized to keep the host's
                // content below the floating back button, and the ticket used
                // to inherit it — which on a notched iPhone started it ~107pt
                // down with a band of market screen stranded above. The ticket
                // covers the whole surface and the back button is hidden while
                // it is up, so none of that clearance applies to it.
                //
                // This top edge, not `ORDER_CARD_HEIGHT`, is what positions the
                // ticket: the card is bottom-anchored and `flexShrink` clamps it
                // to this box, so it fills from here down.
                { top: Math.max(STACK_INSET, safeArea.top + 6) },
                orderOverlayStyle,
              ]}
            >
              <View style={styles.orderCard}>
                <View style={styles.orderBody}>
                {notificationTweetUrl ? <NotificationTweet url={notificationTweetUrl} compact /> : null}
                <PhoenixOrderPad
                  disableGlass={!useGlass}
                  symbol={market.symbol}
                  logoUri={orderLogoSources.uri}
                  logoFallbackUris={orderLogoSources.fallbackUris}
                  openInterestUsd={openInterestUsd}
                  side={side}
                  amount={marginUsd}
                  leverage={leverage}
                  maxLeverage={orderMaxLeverage}
                  markPrice={markPrice}
                  change24hPercent={change?.changePercent ?? null}
                  // One source for the stack: the ticket and Auto Close must
                  // not quote two different liquidation prices for one trade.
                  liquidationPrice={risk.liquidationPrice}
                  estimatedFeeUsd={estimatedFee}
                  feeRatePercent={market.takerFee * 100}
                  availableMarginUsd={availableMargin}
                  cashUsd={cashUsd}
                  message={padMessage}
                  takeProfitPrice={takeProfitPrice}
                  stopLossPrice={stopLossPrice}
                  submitting={submitting}
                  canConfirm={canTrade}
                  moveCashUsd={moveCashUsd}
                  movingCash={movingCash}
                  onMoveCash={() => void moveCashToPerps()}
                  needsCash={notEnoughCash}
                  onAddCash={onEmbeddedAddCash ?? (() => router.push('/deposit'))}
                  onChangeAmount={setMarginUsd}
                  onChangeLeverage={setLeverage}
                  onSubmit={() => void placeTrade()}
                  onAutoClose={() => {
                    if (markPrice === null) {
                      toast.showToast('Waiting for a live price…', 'info');
                      return;
                    }
                    openAutoClose();
                  }}
                />
                </View>
              </View>
            </Reanimated.View>
          </GestureDetector>
        ) : null}

        {/* Auto Close stacks on top of the ticket rather than replacing it, and
            sits at the same inset — every card in the stack is the same height. */}
        {orderOpen && market && autoCloseOpen ? (
          <>
            <Reanimated.View style={[styles.autoBackdrop, autoBackdropStyle]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close auto close"
                onPress={closeAutoClose}
                style={StyleSheet.absoluteFill}
              />
            </Reanimated.View>
            <GestureDetector gesture={autoDismissPan}>
              <Reanimated.View style={[styles.autoCard, autoCardStyle]}>
                <View style={styles.autoBody}>
                  <PhoenixAutoClosePad
                    layout="modal"
                    disableGlass={!useGlass}
                    symbol={market.symbol}
                    side={side}
                    referencePrice={markPrice}
                    candles={chartCandles}
                    chartWidth={chartWidth}
                    notionalUsd={validMargin ? margin * leverage : 0}
                    // The collateral, so the pad can state the return on what
                    // the user is actually putting in rather than on notional.
                    marginUsd={validMargin ? margin : null}
                    liquidationPrice={risk.liquidationPrice}
                    maxStopPercent={risk.maxStopPct}
                    takeProfitPrice={takeProfitPrice}
                    stopLossPrice={stopLossPrice}
                    onCancel={closeAutoClose}
                    onSubmit={(next) => {
                      setTakeProfitPrice(next.takeProfitPrice);
                      setStopLossPrice(next.stopLossPrice);
                      closeAutoClose();
                    }}
                  />
                </View>
              </Reanimated.View>
            </GestureDetector>
          </>
        ) : null}
        </View>
    );

    if (embeddedMarket) return sheetContents;

    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        // The body is a flex:1 View (scroll area + pinned action bar), so the
        // container needs the fixed 92% height. With gorhom's default dynamic
        // sizing it measures itself from the content and the action bar lands
        // below the screen edge.
        enableDynamicSizing={false}
        animatedIndex={animatedIndex}
        onDismiss={handleDismiss}
        // While the order pad is up, a downward swipe must close only the pad.
        enablePanDownToClose={!orderOpen}
        // The chart owns pinch, horizontal pan, crosshair and both scale axes.
        // Making the whole content a sheet drag surface lets the modal steal
        // those gestures. The top handle area and Back action still dismiss.
        enableContentPanningGesture={false}
        backdropComponent={renderBackdrop}
        // No grab pill on any surface in this flow — the drag zone stays, the
        // line does not.
        handleIndicatorStyle={styles.hiddenHandleIndicator}
        backgroundStyle={{
          backgroundColor: sheetColors.background,
          borderTopLeftRadius: SHEET_RADIUS,
          borderTopRightRadius: SHEET_RADIUS,
        }}
      >
        {sheetContents}
      </BottomSheetModal>
    );
});

const StandalonePhoenixMarketDetailSheet = forwardRef<
  PhoenixMarketDetailSheetRef,
  PhoenixMarketDetailSheetProps
>(function StandalonePhoenixMarketDetailSheet(props, ref) {
  const solanaWallet = useEmbeddedSolanaWallet();

  return (
    <PhoenixMarketDetailSheetContent
      {...props}
      ref={ref}
      resolvedWallet={solanaWallet.wallets?.[0] ?? null}
    />
  );
});

/**
 * Keeps the embedded portal path independent of Privy's React context while
 * preserving the provider-backed wallet lookup for standalone perp sheets.
 */
export const PhoenixMarketDetailSheet = forwardRef<
  PhoenixMarketDetailSheetRef,
  PhoenixMarketDetailSheetProps
>(function PhoenixMarketDetailSheet(props, ref) {
  if (props.embeddedMarket) {
    return (
      <PhoenixMarketDetailSheetContent
        {...props}
        ref={ref}
        resolvedWallet={props.embeddedWallet ?? null}
      />
    );
  }

  return <StandalonePhoenixMarketDetailSheet {...props} ref={ref} />;
});

/** `value: null` means the figure is still loading, and shows a skeleton. */
function StatRow({
  label,
  hint,
  value,
}: {
  label: string;
  hint?: string;
  value: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statRow}>
      <View style={styles.statCopy}>
        <Text style={styles.statLabel}>{label}</Text>
        {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
      </View>
      {value === null ? (
        <ValueSkeletonLine
          lineHeight={20}
          width={76}
          style={styles.statValueSkeleton}
          accessibilityLabel={`Loading ${label.toLowerCase()}`}
        />
      ) : (
        <Text style={styles.statValue}>{value}</Text>
      )}
    </View>
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'K' },
  ];
  const unit = units.find(({ threshold }) => absolute >= threshold);
  if (!unit) return formatUsd(value);
  const scaled = value / unit.threshold;
  return `$${scaled.toLocaleString('en-US', {
    minimumFractionDigits: scaled >= 100 ? 0 : 1,
    maximumFractionDigits: scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2,
  })}${unit.suffix}`;
}

function formatSignedPercentage(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${rounded}%`;
}

function formatFeePercentage(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  })}%`;
}

function formatFundingInterval(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // One tone darker than the cards, so a card scaled down to 0.93 is actually
    // visible at its edges instead of white-on-white.
    sheetBody: { flex: 1, backgroundColor: c.backgroundAlt },
    stackedMarket: { flex: 1, overflow: 'hidden', backgroundColor: getSheetColors(c).background },
    topTint: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 300,
    },
    // Bottom padding clears the pinned action bar so the last stat row is never
    // trapped underneath it.
    content: { paddingHorizontal: 16, paddingBottom: 110 },
    detailHeader: {
      zIndex: 10,
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 4,
    },
    scrollingDetailHeader: {
      marginHorizontal: -16,
    },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 2,
      marginBottom: 4,
    },
    togglePlaceholder: { width: 112, height: 44 },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 2,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    headerText: { flex: 1, minWidth: 0 },
    headerRight: { alignItems: 'flex-end', justifyContent: 'center' },
    iconFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconFallbackText: { color: c.textInverse, fontSize: 16, fontWeight: '700', fontFamily: F },
    title: {
      fontFamily: F,
      color: c.text,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '800',
    },
    subtitle: {
      fontFamily: F,
      color: c.textTertiary,
      marginTop: -3,
      fontSize: 13,
      lineHeight: 16,
      fontWeight: '800',
      letterSpacing: 0.3,
    },
    price: {
      fontFamily: F,
      color: c.text,
      fontSize: 27,
      lineHeight: 34,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    change: {
      fontFamily: Fonts.displayMedium,
      marginTop: -6,
      fontSize: 16,
      lineHeight: 19,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    error: { fontFamily: F, color: c.textSecondary, fontSize: 12, marginTop: 8 },
    retryText: {
      fontFamily: F,
      color: c.text,
      fontSize: 12,
      fontWeight: '800',
      marginTop: 6,
    },

    chartControlsWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
      paddingHorizontal: 4,
    },
    chartControlSpacer: { width: 34, height: 40 },
    tfRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
    },
    tfChip: {
      minWidth: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tfText: { fontFamily: F, color: c.textTertiary, fontSize: 14, fontWeight: '700' },
    tfTextActive: { color: c.text, fontSize: 15, fontWeight: '900' },
    chartLoading: { alignItems: 'center', justifyContent: 'center' },

    tabBarContainer: { paddingTop: 10 },
    tabBarRow: {
      flexDirection: 'row',
      gap: 28,
      paddingLeft: 4,
      alignItems: 'center',
    },
    tabButton: {
      minHeight: 40,
      justifyContent: 'center',
      paddingBottom: 10,
    },
    tabLabel: {
      fontSize: 19,
      fontWeight: '800',
      fontFamily: F,
      color: c.textQuaternary,
    },
    tabLabelActive: {
      fontSize: 21,
      fontWeight: '900',
      fontFamily: F,
      color: c.text,
    },
    tabContent: { marginTop: 6, paddingBottom: 12 },
    aboutContent: { paddingBottom: 4 },
    emptyTabText: { fontFamily: F, color: c.textTertiary, fontSize: 13, lineHeight: 19 },

    tradeCard: {
      marginTop: 20,
      padding: 14,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    tradeTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    tradeTitle: { fontFamily: F, color: c.text, fontSize: 16, fontWeight: '800' },
    balanceText: { fontFamily: F, color: c.textSecondary, fontSize: 10 },
    accountLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 20 },
    activateBox: { marginTop: 12 },
    activateTitle: { fontFamily: F, color: c.text, fontSize: 13, fontWeight: '700' },
    activateBody: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 3,
    },

    // Pinned action bar. No background plate on iOS — the glass pills float over
    // the content and refract it, same treatment as the stock sheet's BUY bar.
    bottomBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      // Equal on all three edges so the capsules' corners run parallel to the
      // display's, rather than cutting across them.
      paddingHorizontal: CTA.inset,
      paddingTop: 8,
      paddingBottom: CTA.inset,
      backgroundColor: HAS_GLASS ? 'transparent' : getSheetColors(c).background,
    },
    bottomBarRow: { flexDirection: 'row', gap: 12 },
    // Sits over the shrunken market content, leaving a strip of it visible at
    // the top — that strip is the whole point of the stack, so no scrim: the
    // card's own edge and shadow do the separating.
    // A bottom-anchored *box*, not the card itself: the card paints inside it at a
    // fixed 90% of the screen, so the strip above it stays market content instead
    // of the card stretching to the sheet floor and leaving a dead band under the
    // confirm button. The box's top edge is the ceiling — a short phone shrinks the
    // ticket rather than clipping it.
    orderOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: STACK_INSET,
      bottom: 0,
      justifyContent: 'flex-end',
    },
    orderCard: {
      height: ORDER_CARD_HEIGHT,
      flexShrink: 1,
      backgroundColor: getSheetColors(c).background,
      borderTopLeftRadius: SHEET_RADIUS,
      borderTopRightRadius: SHEET_RADIUS,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.14,
      shadowRadius: 18,
      elevation: 12,
    },
    // Compact SL/TP editor over a dimmed ticket, like a native bottom modal.
    autoBackdrop: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 20,
      backgroundColor: withAlpha('#000000', 0.56),
    },
    // Sized by its content, not pinned to 40% of the screen: the editor needs
    // about half of what that reserved, and the rest showed up as dead white
    // under the warning line. The cap keeps it inside the sheet on a small phone.
    autoCard: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: ORDER_CARD_HEIGHT,
      zIndex: 30,
      backgroundColor: getSheetColors(c).background,
      borderTopLeftRadius: SHEET_RADIUS,
      borderTopRightRadius: SHEET_RADIUS,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.14,
      shadowRadius: 18,
      elevation: 12,
    },
    /** The auto-close card hugs its content, so its body must not stretch. */
    autoBody: { flexShrink: 1 },
    orderBody: { flex: 1 },
    hiddenHandleIndicator: { backgroundColor: 'transparent' },
    tradeNote: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 10,
      lineHeight: 14,
      marginTop: 8,
      textAlign: 'center',
    },
    disabled: { opacity: 0.45 },

    stats: { marginTop: 14, gap: 2 },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 10,
    },
    statCopy: { flex: 1, paddingRight: 12 },
    statLabel: { fontFamily: F, color: c.text, fontSize: 15, fontWeight: '800' },
    statHint: {
      marginTop: 2,
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 12,
      lineHeight: 16,
    },
    statValueSkeleton: {
      marginLeft: 16,
      alignItems: 'flex-end',
    },
    statValue: {
      marginTop: 1,
      fontFamily: F,
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
      textAlign: 'right',
    },
  });
