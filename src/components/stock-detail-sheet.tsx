import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import { NotificationTweet } from '@/components/notification-tweet';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState, ActivityIndicator, Dimensions, Image, Keyboard, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { AssetLogo } from '@/components/asset-logo';
import { AssetPriceText } from '@/components/asset-price-text';
import { ShareIcon } from '@/components/share-icon';
import {
  ASSET_MARKET_TOGGLE_HEIGHT,
  ASSET_MARKET_TOGGLE_WIDTH,
  AssetMarketToggle,
  type AssetMarketMode,
} from '@/components/asset-market-toggle';
import { BlurBackdrop } from '@/components/blur-backdrop';
import { ValueSkeleton, ValueSkeletonLine } from '@/components/value-skeleton';
import { CTA } from '@/lib/screen-corners';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { getSheetColors } from '@/lib/sheet-colors';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  getAssetDetail,
  getAssetHolders,
  getEquityInfo,
  getPerpHolders,
  getMintDecimals,
  getSandwichShareUrl,
  getSandwiches,
  getStockById,
  getStockPerformance,
  getTopHolderStocks,
  setCardLike,
  type AssetDetail,
  type AssetHolderUser,
  type AssetProfile,
  type PerpHolderUser,
  type EquityInfo,
  type Sandwich,
  type Stock,
  type TokenContent,
  type TweetOembedData,
  type SavedItemType,
} from '@/lib/api';
import { cleanStockName } from '@/lib/stock-name';
import {
  ONDO_MARKET_HOURS_URL,
  ONDO_TRADE_UNAVAILABLE_MESSAGE,
} from '@/lib/market-hours';
import { getAnonymousSocialId } from '@/lib/social-identity';
import { useSavedStore } from '@/lib/saved-store';
import { useSandwichDetail } from '@/lib/sandwich-detail-store';
import { useToast } from '@/lib/toast-store';
import { equityLogoFallbackUris } from '@/lib/stock-logos';
import { CandlestickChart, type ChartWindow } from './candlestick-chart';
import { BuySuccessSheet } from './buy-success-sheet';
import { LineChart, type LineChartWindow } from './line-chart';
import { DepositSheet, type DepositSheetRef } from './deposit-sheet';
import { SandwichCard, type SandwichCardSavedControls } from '@/components/sandwich-card';
import { StockTradeActions, useTradeEngine, type TradeContext } from './stock-trade-actions';
import { TradeAmountPad } from './trade-amount-sheet';
import { GlassSheetSurface } from './glass-sheet-surface';
import { TradeQuotePreviewRow } from './trade-quote-preview';
import { useCash } from '@/hooks/use-cash';
import { standaloneHolding, useSandwichLegReserve } from '@/lib/standalone-holding';
import { useWalletStore } from '@/lib/wallet-store';
import { AssetShareSheet, type AssetShareSheetRef } from './asset-share-sheet';
import { TradeShareSheet, type TradeShareSheetRef } from './trade-share-sheet';
import {
  PhoenixMarketDetailSheet,
  type PerpActionBarState,
  type PhoenixMarketDetailSheetRef,
} from './phoenix-market-detail-sheet';
import { usePhoenixMarkets } from '@/hooks/use-phoenix-live';
import {
  findPhoenixMarketForAsset,
  normalizePhoenixAssetSymbol,
  phoenixMarketMatchesAsset,
  type PhoenixMarket,
  type PhoenixTradeSide,
} from '@/lib/phoenix-api';

type ChartMode = 'line' | 'candle';
type DetailTab = 'about' | 'sandwiches' | 'holders';

const SPOT_LIVE_REFRESH_MS = 15_000;

// Time-window pills shown under the chart. Labels match the design (7D) while
// the underlying chart window stays the canonical value (1W).
const WINDOW_PILLS: { label: string; window: ChartWindow }[] = [
  { label: '24H', window: '24H' },
  { label: '7D', window: '1W' },
  { label: '1M', window: '1M' },
  { label: '3M', window: '3M' },
];

const F = Fonts.rounded;
// Rounded Baloo 2 bubble face for the detail-screen tabs.
const BUBBLE = Fonts.bubble;
// Everything below the two headline figures shares one quiet typographic rung.
// Keeping this as a single token prevents labels, values, and the share action
// from drifting into competing weights or opacities again.
const POSITION_SUPPORTING_TEXT = {
  fontWeight: '700' as const,
  fontFamily: F,
  opacity: 0.72,
};
// One silhouette for the stock drawer and the Buy/Sell overlay it opens.
const STOCK_SHEET_TOP_RADIUS = 32;
/**
 * Where the floating venue toggle sits inside this surface, below whatever
 * `embeddedTopInset` a full-screen host passes. Exported so that host can put
 * its own top chrome on the same row instead of guessing at the number.
 */
export const MARKET_TOGGLE_TOP = 14;
/** Right inset of the Spot/Perp toggle. A full-screen host lines its own
 *  chrome up against this edge, so it is shared rather than duplicated. */
export const MARKET_TOGGLE_RIGHT = 18;

/**
 * The dialpad's own surface colour. See the GlassSheetSurface call below: glass
 * cannot paint under this overlay's opacity animation, so the sheet cannot lean
 * on the material for its fill the way a plain modal can.
 */
const TRADE_PAD_SURFACE = '#F7F9FC';
const TRADE_PAD_SURFACE_DARK = '#101312';

/** The buy/sell dialpad's height — the same 90% of the screen the perp ticket uses. */
const TRADE_SHEET_HEIGHT = Dimensions.get('window').height * 0.9;
const TRADE_STACK_SCALE = 0.93;
const TRADE_STACK_PUSH_Y = -38;

const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();
/**
 * The plot on the asset page. Taller than the 220 the charts default to: the
 * graph is the page's centrepiece, and at 220 it sat as a short band between
 * the quote and the tabs rather than filling the space between them.
 */
const DETAIL_CHART_HEIGHT = 300;

export type StockPositionSnapshot = {
  quantity: number;
  currentValueUsd: number | null;
  avgPriceUsd: number | null;
};

type StockDetailOpenOptions = {
  showSell?: boolean;
  pnlPositive?: boolean | null;
  /** Position selected by a Holdings row. Bottom-sheet portal content can
   * mount before the shared wallet store is populated, so carry the known
   * position into the sheet instead of making the card rediscover it. */
  position?: StockPositionSnapshot | null;
  /** A known matching perp keeps this same drawer toggle-ready from its first
   * frame instead of waiting for the drawer's market fetch. */
  perpMarket?: PhoenixMarket | null;
  /** Skip the bottom-up entrance when another surface already morphed into the
   * sheet's final frame. */
  animateOnMount?: boolean;
  /** Present with the requested trade pad already open. */
  openTrade?: 'buy' | 'sell';
};

export type StockDetailSheetRef = {
  open: (stock: Stock, options?: StockDetailOpenOptions) => void;
  /** Silently replace optimistic metadata after the sheet is already visible. */
  update: (stock: Stock) => void;
  /**
   * Open a Phoenix market in this same asset drawer, never a second modal.
   * `side` preselects the order side for callers that already know the
   * direction (a bearish podcast call opens straight on Short).
   */
  openPerp: (
    market: PhoenixMarket,
    spotStock?: Stock | null,
    side?: PhoenixTradeSide,
    options?: {
      /** Raise the order ticket on `side` as soon as the perps account allows
       * it — the perp twin of `open`'s `openTrade`. */
      openTrade?: boolean;
    },
  ) => void;
  trade: (side: 'buy' | 'sell') => void;
  /** Raise the perp order ticket. For a host that draws the LONG / SHORT bar
   *  itself — see `hideEmbeddedActions`. */
  tradePerp: (side: PhoenixTradeSide) => void;
  /** Register the perps account, likewise. */
  activatePerps: () => void;
  close: () => void;
};

type StockDetailSheetProps = {
  notificationTweetUrl?: string;
  onClose?: () => void;
  animatedIndex?: SharedValue<number>;
  onTradeSuccess?: () => void;
  /** Render the complete stock-detail experience inside a parent-owned surface
   * instead of creating a second bottom-sheet modal. */
  embeddedStock?: Stock | null;
  /** Native iOS Glass is enabled only after an embedded parent has finished
   * transforming, because native layers cannot follow the morph itself. */
  embeddedGlassEnabled?: boolean;
  /**
   * Phoenix market backing the embedded asset, when the host already resolved
   * one. Supplying it is what lets an embedded surface offer the venue toggle —
   * the sheet's own lookup only runs against the spot symbol.
   */
  embeddedPerpMarket?: PhoenixMarket | null;
  /**
   * Venue the embedded asset should land on. `perp` needs
   * {@link embeddedPerpMarket}; without one the sheet stays on spot rather than
   * showing an empty venue.
   */
  embeddedVenue?: AssetMarketMode;
  /**
   * Side the embedded perp view opens on. Callers holding a position (a short
   * Sandwich leg) pass its real side so the ticket matches what they own.
   */
  embeddedPerpSide?: PhoenixTradeSide;
  /**
   * Parent renders the native action outside this surface — because this one
   * is transformed and clipped, and (measured on iOS 26) a `GlassView` inside
   * it paints no fill at all. Also hoists the perp venue's LONG / SHORT bar,
   * whose state the parent then follows via
   * {@link onEmbeddedPerpActionStateChange}.
   */
  hideEmbeddedActions?: boolean;
  /** Venue the embedded asset is currently showing, for a host drawing the
   *  matching action bar. */
  onEmbeddedVenueChange?: (venue: AssetMarketMode) => void;
  /**
   * Whether the venue toggle is showing. A full-screen host draws its own
   * chrome (the floating back button) on the toggle's row, so it has to know
   * whether that row exists — the match against a Phoenix market is resolved
   * in here, not by the caller.
   */
  onEmbeddedCanToggleMarketChange?: (canToggle: boolean) => void;
  /** Which perp action bar a `hideEmbeddedActions` host should draw. */
  onEmbeddedPerpActionStateChange?: (state: PerpActionBarState | null) => void;
  /** Whether the embedded spot asset has a confirmed sellable wallet balance. */
  onEmbeddedSellableBalanceChange?: (hasBalance: boolean) => void;
  onEmbeddedTradeOpenChange?: (open: boolean) => void;
  /**
   * Mirror of whichever venue layer is currently showing its scroll offset.
   * A host whose drag-to-dismiss spans the whole screen (the zoom screen) needs
   * it to tell "the user is pulling the screen down" from "the user is
   * scrolling the content".
   */
  embeddedScrollY?: SharedValue<number>;
  /** UI-thread lock used by the parent zoom screen while the perp chart owns touches. */
  embeddedChartGestureActive?: SharedValue<boolean>;
  /**
   * Marks the asset header as the landing point for a native zoom transition.
   * UIKit otherwise aligns the source row to the top-left of this screen, which
   * is safe-area padding — so the transition would open on blank space and the
   * header would arrive late. See the `alignmentRectProvider` note in the
   * `react-native-screens` patch.
   */
  embeddedHeaderTestID?: string;
  /**
   * Safe-area gap for a host that renders this surface full-screen.
   *
   * Applied to the CONTENT, never to the surface: the trade pad and its
   * backdrop are `absoluteFill` children of this surface, so padding the
   * container pushes them down and leaves a dead band of exactly this height at
   * the bottom of the screen.
   */
  embeddedTopInset?: number;
  /**
   * Absolute Y for the Spot/Perp toggle, in the embedded surface's own
   * coordinates. The route draws a floating back button on that same band, so
   * it pins the toggle beside it; passing this also drops the row the sheet
   * would otherwise reserve for the toggle above the asset identity.
   */
  embeddedToggleTop?: number | null;
  /**
   * Opens the deposit / add-cash flow. When provided, a low cash balance swaps
   * the BUY button for "Add cash" (the sheet closes first, then this fires).
   * Omit from callers without a deposit sheet in scope — BUY then always shows.
   */
  onRequestAddCash?: () => void;
  /**
   * Opens another user's profile, used by the Holders tab. Callers that have no
   * profile screen in scope can omit it — the holder rows then just aren't
   * tappable, rather than leading nowhere.
   */
  onOpenUser?: (privyUserId: string) => void;
  /**
   * Opens a sandwich from the Sandwiches tab. Defaults to the shared thesis
   * detail route; a host inside a native <Modal> overrides it, because a bare
   * push would land the route behind that modal.
   */
  onOpenSandwich?: (sandwich: Sandwich, options?: { showComments?: boolean }) => void;
};

type TokenMeta = {
  icon: string | null;
  usdPrice: number | null;
  priceChange24h: number | null;
  decimals: number;
};

type PerformanceSnapshot = {
  oneWeek: number | null;
  oneMonth: number | null;
  threeMonth: number | null;
  sixMonth: number | null;
  oneYear: number | null;
};

function formatPrice(value: number | null | undefined): string {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function changeColor(value: number | null | undefined, c: ThemeColors): string {
  if (value == null || value === 0) return c.textTertiary;
  return value > 0 ? c.positive : c.negative;
}

/**
 * The asset surface's own background, which is deliberately not `c.background`.
 * Exported because a host that morphs INTO this surface (the zoom screen) has
 * to fill its growing card with the same colour, or the first frames show a
 * hole where the tapped row used to be.
 */
export { getSheetColors };


// Compact USD for large values (market cap): $1.2M, $3.7B, $950K.
function formatCompactUSD(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Full dollars-and-cents, as the holders list shows a position's value. */
function formatUsdAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedUsd(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPositionQuantity(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value).toUpperCase();
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(t);
}

function cleanStockSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.endsWith('X') && normalized.length > 4) {
    return normalized.slice(0, -1);
  }
  return normalized.replace(/ON$/i, '') || symbol;
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

type HeaderQuote = { price: number | null; changePercent: number | null };

/**
 * The perp layer's headline, held OUTSIDE React state. The perp mark polls every
 * few seconds; as sheet state, each tick re-rendered this whole screen — during
 * a scroll, too. Only the compact quote subscribes.
 */
function createQuoteStore() {
  let quote: HeaderQuote = { price: null, changePercent: null };
  const listeners = new Set<() => void>();
  return {
    get: () => quote,
    set: (next: HeaderQuote) => {
      if (next.price === quote.price && next.changePercent === quote.changePercent) return;
      quote = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type QuoteStore = ReturnType<typeof createQuoteStore>;

/** Price + % in the collapsed header, for whichever venue is on screen. */
const CompactQuote = React.memo(function CompactQuote({
  perpStore,
  perp,
  spotPrice,
  spotChange,
  styles,
  colors,
}: {
  perpStore: QuoteStore;
  perp: boolean;
  spotPrice: number | null;
  spotChange: number | null;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const perpQuote = useSyncExternalStore(perpStore.subscribe, perpStore.get);
  const price = perp ? perpQuote.price : spotPrice;
  const change = perp ? perpQuote.changePercent : spotChange;
  return (
    <View style={styles.compactHeaderQuote}>
      {price == null ? (
        <ValueSkeletonLine lineHeight={20} width={72} accessibilityLabel="Loading price" />
      ) : (
        <AssetPriceText
          label={formatPrice(price)}
          size={16}
          lineHeight={20}
          style={styles.compactHeaderPrice}
        />
      )}
      {change == null ? (
        <ValueSkeletonLine lineHeight={14} width={42} accessibilityLabel="Loading price change" />
      ) : (
        <Text style={[styles.compactHeaderChange, { color: changeColor(change, colors) }]}>
          {formatPercent(change)}
        </Text>
      )}
    </View>
  );
});

/**
 * The Spot/Perp toggle, fading out over the first `fadeEnd` points of scroll.
 * Its own component so the "fully hidden" flip (which gates taps) re-renders
 * this pill, not the whole sheet, mid-gesture.
 */
const MarketToggleOverlay = React.memo(function MarketToggleOverlay({
  scrollY,
  perpScrollY,
  marketMode,
  tradeOverlayOpen,
  fadeEnd,
  top,
  style,
  onChange,
}: {
  scrollY: SharedValue<number>;
  perpScrollY: SharedValue<number>;
  marketMode: AssetMarketMode;
  tradeOverlayOpen: boolean;
  fadeEnd: number;
  top: number;
  style: StyleProp<ViewStyle>;
  onChange: (mode: AssetMarketMode) => void;
}) {
  const [scrolledAway, setScrolledAway] = useState(false);
  useAnimatedReaction(
    () => (marketMode === 'perp' ? perpScrollY.value : scrollY.value) >= fadeEnd,
    (hidden, previous) => {
      if (hidden !== previous) runOnJS(setScrolledAway)(hidden);
    },
    [marketMode, fadeEnd],
  );
  const fadeStyle = useAnimatedStyle(() => {
    const y = marketMode === 'perp' ? perpScrollY.value : scrollY.value;
    return {
      opacity: tradeOverlayOpen
        ? 0
        : interpolate(y, [0, fadeEnd], [1, 0], Extrapolation.CLAMP),
    };
  }, [marketMode, tradeOverlayOpen, fadeEnd]);
  const hidden = tradeOverlayOpen || scrolledAway;
  return (
    <Reanimated.View
      style={[style, { top }, fadeStyle]}
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <AssetMarketToggle value={marketMode} onChange={onChange} />
    </Reanimated.View>
  );
});

/** Room kept either side of the centred compact identity (back button / price). */
const COMPACT_IDENTITY_INSET = 96;

function getDisplayName(stock: Stock): string {
  if (stock.type === 'token') return stock.name.trim() || stock.symbol.trim().toUpperCase();
  const ticker = cleanStockSymbol(stock.symbol);
  return COMPANY_NAME_OVERRIDES[ticker] ?? (cleanStockName(stock.name) || ticker);
}

function PerformanceSection({
  windowChangeMap,
  activeWindow,
  loading,
}: {
  windowChangeMap: Record<string, number | null>;
  activeWindow: string;
  loading: boolean;
}) {
  const contentStyles = useThemedStyles(makeContentStyles);
  const { colors } = useThemeStore();
  const keys = Object.keys(windowChangeMap);
  const items = keys.map((label) => ({ label, value: windowChangeMap[label] }));

  return (
    <View style={contentStyles.performanceCard}>
      <View style={contentStyles.performanceGrid}>
        {items.map((item) => {
          const isActive = item.label === activeWindow;
          return (
            <View
              key={item.label}
              style={[
                contentStyles.performanceItem,
                isActive && contentStyles.performanceItemActive,
              ]}>
              <Text style={contentStyles.performanceItemLabel}>{item.label}</Text>
              {loading && item.value === null ? (
                <ValueSkeleton
                  width={52}
                  height={16}
                  radius={999}
                  accessibilityLabel={`Loading ${item.label} change`}
                />
              ) : (
                <Text
                  style={[
                    contentStyles.performanceValue,
                    { color: changeColor(item.value, colors) },
                  ]}>
                  {formatPercent(item.value)}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TokenContentSection({ content }: { content: TokenContent; oembedMap: Map<string, TweetOembedData | null> }) {
  const contentStyles = useThemedStyles(makeContentStyles);
  const [newsExpanded, setNewsExpanded] = useState(false);

  if (!content.newsSummary) return null;

  return (
    <View style={contentStyles.root}>
      {/* Latest News */}
      {content.newsSummary?.summaryShort ? (
        <View style={contentStyles.newsCard}>
          <View style={contentStyles.newsHeader}>
            <View style={contentStyles.newsDot} />
            <Text style={contentStyles.newsHeaderLabel}>LATEST NEWS</Text>
          </View>
          <Text style={contentStyles.newsHeadline}>
            {newsExpanded
              ? content.newsSummary.summaryFull || content.newsSummary.summaryShort
              : content.newsSummary.summaryShort}
          </Text>
          {content.newsSummary.summaryFull ? (
            <Pressable
              onPress={() => setNewsExpanded((v) => !v)}
              style={contentStyles.readMoreBtn}
            >
              <Text style={contentStyles.readMoreText}>{newsExpanded ? 'Show less' : 'Read more'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AboutSection({ description }: { description: string | null }) {
  const contentStyles = useThemedStyles(makeContentStyles);
  const [expanded, setExpanded] = useState(false);
  if (!description) {
    return (
      <Text style={contentStyles.aboutEmpty}>No description available for this asset yet.</Text>
    );
  }
  return (
    <View>
      {expanded ? <Text style={contentStyles.aboutText}>{description}</Text> : null}
      <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={6} style={contentStyles.readMoreBtn}>
        <Text style={contentStyles.readMoreText}>{expanded ? 'Show less' : 'Show more'}</Text>
      </Pressable>
    </View>
  );
}


function SandwichesSection({
  sandwiches,
  loading,
  symbol,
  checkIsSaved,
  onToggleSave,
  canSave,
  onOpenSandwich,
}: {
  sandwiches: Sandwich[];
  loading: boolean;
  symbol: string;
  checkIsSaved: (type: SavedItemType, id: string) => boolean;
  onToggleSave: (type: SavedItemType, id: string) => Promise<void>;
  canSave: boolean;
  /** Opens the thesis detail. Resolved by the host, outside the portal. */
  onOpenSandwich: (sandwich: Sandwich, options?: { showComments?: boolean }) => void;
}) {
  const contentStyles = useThemedStyles(makeContentStyles);
  const { colors } = useThemeStore();
  const { user } = usePrivy();
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const [localLikes, setLocalLikes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setAnonymousId(null);
    setLocalLikes({});
    void getAnonymousSocialId(user?.id).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Likes belong to the card, so this toggles the Post — but the local override
  // stays keyed by market id, because that is what the rendered cards are keyed
  // by and a sheet only ever shows one market of a card at a time.
  const handleToggleLike = useCallback(async (s: Sandwich) => {
    if (!anonymousId) return;
    const wasLiked = localLikes[s.id] ?? s.viewerHasLiked;
    setLocalLikes((prev) => ({ ...prev, [s.id]: !wasLiked }));
    try {
      await setCardLike(s, !wasLiked, anonymousId);
    } catch {
      setLocalLikes((prev) => ({ ...prev, [s.id]: wasLiked }));
    }
  }, [localLikes, anonymousId]);

  const handleShare = useCallback(async (s: Sandwich) => {
    const url = getSandwichShareUrl(s.id);
    await Share.share({ url, message: s.name });
  }, []);

  // The card is rendered inside this sheet, which gorhom portals above the
  // saved store's provider — so it cannot read the store itself. Hand it the
  // controls the host read on the outside.
  const savedControls = useMemo<SandwichCardSavedControls>(
    () => ({
      canSave,
      isSaved: (type, id) => checkIsSaved(type as SavedItemType, id),
      toggleSave: async (type, id) => {
        await onToggleSave(type as SavedItemType, id);
        return checkIsSaved(type as SavedItemType, id);
      },
    }),
    [canSave, checkIsSaved, onToggleSave],
  );

  if (loading && sandwiches.length === 0) {
    return (
      <View style={contentStyles.tabSpinner}>
        <ActivityIndicator color={colors.textTertiary} size="small" />
      </View>
    );
  }
  if (sandwiches.length === 0) {
    return (
      <Text style={contentStyles.aboutEmpty}>
        No sandwiches include {symbol || 'this asset'} yet.
      </Text>
    );
  }
  return (
    <View>
      {sandwiches.map((s) => {
        const isLiked = localLikes[s.id] ?? s.viewerHasLiked;
        return (
          <SandwichCard
            key={s.id}
            sandwich={{ ...s, viewerHasLiked: isLiked }}
            onPress={(sandwich) => onOpenSandwich(sandwich)}
            onToggleLike={handleToggleLike}
            onComment={(sandwich) => onOpenSandwich(sandwich, { showComments: true })}
            onShare={handleShare}
            saved={savedControls}
          />
        );
      })}
    </View>
  );
}

/**
 * "Who's aped in" — the Bread users holding this asset, largest position first.
 * Positions are read on-chain server-side, so this is every real holder on the
 * app, not just people who posted a sandwich about it.
 */
function HoldersSection({
  holders,
  loading,
  symbol,
  onOpenHolder,
}: {
  holders: AssetHolderUser[];
  loading: boolean;
  symbol: string;
  onOpenHolder?: (privyUserId: string) => void;
}) {
  const contentStyles = useThemedStyles(makeContentStyles);
  const { colors } = useThemeStore();

  if (loading && holders.length === 0) {
    return (
      <View style={contentStyles.tabSpinner}>
        <ActivityIndicator color={colors.textTertiary} size="small" />
      </View>
    );
  }
  if (holders.length === 0) {
    return (
      <Text style={contentStyles.aboutEmpty}>
        Nobody on Bread has aped {symbol || 'this asset'} yet. Be the first.
      </Text>
    );
  }

  return (
    <View>
      {holders.map((holder) => {
        // The handle IS the identity everywhere in the app — the display name
        // is only the fallback.
        const handle = holder.username ? holder.username.replace(/^@+/, '') : null;
        const title = handle ?? holder.name ?? 'Bread user';
        const initial = title.slice(0, 1).toUpperCase();
        const tappable = !!onOpenHolder;
        // What they paid, not what they hold — position size is already the
        // number on the right, and units read as noise next to it. A wallet
        // the ledger can't price for this mint just carries no subtitle.
        const subtitle =
          holder.avgEntryUsd !== null ? `Avg. entry ${formatPrice(holder.avgEntryUsd)}` : null;
        const pct = holder.pnlPct;
        const pnlUsd = holder.pnlUsd;
        const pnlDirection = pnlUsd ?? pct;
        const pnlColor =
          pnlDirection === null
            ? colors.textTertiary
            : pnlDirection >= 0
              ? colors.positive
              : colors.negative;
        const pnlLabel =
          pnlUsd !== null
            ? `P&L ${formatSignedUsd(pnlUsd)}`
            : pct !== null
              ? `P&L ${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}%`
              : null;
        return (
          <Pressable
            key={holder.privyUserId}
            disabled={!tappable}
            onPress={() => onOpenHolder?.(holder.privyUserId)}
            accessibilityRole={tappable ? 'button' : undefined}
            accessibilityLabel={
              pnlDirection === null
                ? `${title} holds ${formatPositionQuantity(holder.units)} ${symbol}`
                : `${title} holds ${formatPositionQuantity(holder.units)} ${symbol}, ${
                    pnlDirection >= 0 ? 'up' : 'down'
                  } ${
                    pnlUsd !== null
                      ? formatUsdAmount(Math.abs(pnlUsd))
                      : `${Math.abs(pct ?? 0).toFixed(2)} percent`
                  }`
            }
            style={({ pressed }) => [
              contentStyles.holderRow,
              pressed && tappable && contentStyles.holderRowPressed,
            ]}
          >
            {holder.avatarUrl ? (
              <Image source={{ uri: holder.avatarUrl }} style={contentStyles.holderAvatar} />
            ) : (
              <View style={[contentStyles.holderAvatar, contentStyles.holderAvatarFallback]}>
                <Text style={contentStyles.holderAvatarText}>{initial}</Text>
              </View>
            )}
            <View style={contentStyles.holderIdentity}>
              <View style={contentStyles.holderNameRow}>
                {handle ? <Text style={contentStyles.holderAt}>@</Text> : null}
                <Text style={contentStyles.holderName} numberOfLines={1}>
                  {title}
                </Text>
              </View>
              {subtitle ? (
                <Text style={contentStyles.holderHandle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View style={contentStyles.holderAmounts}>
              <Text style={contentStyles.holderValue} numberOfLines={1}>
                {formatUsdAmount(holder.valueUsd)}
              </Text>
              {pnlLabel ? (
                <Text style={[contentStyles.holderPnl, { color: pnlColor }]} numberOfLines={1}>
                  {pnlLabel}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The perp side's Holders tab: Bread users with an open standalone perp on this
 * market, biggest notional first. Perp-only by construction — spot holders of
 * the same underlying live on the spot side's tab and never appear here.
 */
function PerpHoldersSection({
  holders,
  loading,
  symbol,
  onOpenHolder,
}: {
  holders: PerpHolderUser[];
  loading: boolean;
  symbol: string;
  onOpenHolder?: (privyUserId: string) => void;
}) {
  const contentStyles = useThemedStyles(makeContentStyles);
  const { colors } = useThemeStore();

  if (loading && holders.length === 0) {
    return (
      <View style={contentStyles.tabSpinner}>
        <ActivityIndicator color={colors.textTertiary} size="small" />
      </View>
    );
  }
  if (holders.length === 0) {
    return (
      <Text style={contentStyles.aboutEmpty}>
        Nobody on Bread has a {symbol || 'this'} perp open yet. Be the first.
      </Text>
    );
  }

  return (
    <View>
      {holders.map((holder) => {
        const handle = holder.username ? holder.username.replace(/^@+/, '') : null;
        const title = handle ?? holder.name ?? 'Bread user';
        const initial = title.slice(0, 1).toUpperCase();
        const tappable = !!onOpenHolder;
        const sideLabel = holder.side === 'long' ? 'Long' : 'Short';
        const sideColor = holder.side === 'long' ? colors.positive : colors.negative;
        const pnlColor = holder.pnlUsd >= 0 ? colors.positive : colors.negative;
        return (
          <Pressable
            key={holder.privyUserId}
            disabled={!tappable}
            onPress={() => onOpenHolder?.(holder.privyUserId)}
            accessibilityRole={tappable ? 'button' : undefined}
            accessibilityLabel={`${title} is ${sideLabel.toLowerCase()} ${formatUsdAmount(
              holder.positionValueUsd,
            )} of ${symbol}, ${holder.pnlUsd >= 0 ? 'up' : 'down'} ${formatUsdAmount(
              Math.abs(holder.pnlUsd),
            )}`}
            style={({ pressed }) => [
              contentStyles.holderRow,
              pressed && tappable && contentStyles.holderRowPressed,
            ]}
          >
            {holder.avatarUrl ? (
              <Image source={{ uri: holder.avatarUrl }} style={contentStyles.holderAvatar} />
            ) : (
              <View style={[contentStyles.holderAvatar, contentStyles.holderAvatarFallback]}>
                <Text style={contentStyles.holderAvatarText}>{initial}</Text>
              </View>
            )}
            <View style={contentStyles.holderIdentity}>
              <View style={contentStyles.holderNameRow}>
                {handle ? <Text style={contentStyles.holderAt}>@</Text> : null}
                <Text style={contentStyles.holderName} numberOfLines={1}>
                  {title}
                </Text>
              </View>
              <Text style={contentStyles.holderHandle} numberOfLines={1}>
                <Text style={{ color: sideColor }}>{sideLabel}</Text>
                {holder.entryPrice > 0 ? ` · Entry ${formatPrice(holder.entryPrice)}` : ''}
              </Text>
            </View>
            <View style={contentStyles.holderAmounts}>
              <Text style={contentStyles.holderValue} numberOfLines={1}>
                {formatUsdAmount(holder.positionValueUsd)}
              </Text>
              <Text style={[contentStyles.holderPnl, { color: pnlColor }]} numberOfLines={1}>
                P&L {formatSignedUsd(holder.pnlUsd)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

type StatEntry = { label: string; value: string; valueColor?: string };

// A list of `label ········· value` rows with a dotted leader between the two,
// rendered directly on the sheet (no card) to match the reference layout.
function StatList({ rows }: { rows: StatEntry[] }) {
  const contentStyles = useThemedStyles(makeContentStyles);
  return (
    <View>
      {rows.map((row) => (
        <View key={row.label} style={contentStyles.leaderRow}>
          <Text style={contentStyles.leaderLabel}>{row.label}</Text>
          <View style={contentStyles.leaderDots} />
          <Text style={[contentStyles.leaderValue, row.valueColor ? { color: row.valueColor } : null]}>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

// Company / asset profile from the `profile` include. We surface only the
// all-time high here — it describes the *real* underlying asset. Everything else
// (volume, liquidity, market cap, supply, FDV) reflects the on-chain tokenized
// wrapper, not the underlying, so it's intentionally omitted.
function ProfileSection({ profile }: { profile: AssetProfile | null }) {
  if (!profile || profile.allTimeHigh == null) return null;

  const athValue = formatPrice(profile.allTimeHigh);
  const athDate = formatShortDate(profile.allTimeHighDate);

  const rows: StatEntry[] = [
    {
      label: 'All-time high',
      value: athDate ? `${athValue} · ${athDate}` : athValue,
    },
  ];

  return <StatList rows={rows} />;
}

// Real underlying-equity reference data (Finnhub, by ticker): 52-week high/low,
// market cap and trailing P/E — describing the actual company, not the on-chain
// tokenized wrapper.
function EquitySection({ equity }: { equity: EquityInfo | null }) {
  if (!equity) return null;

  const rows: StatEntry[] = [];
  if (equity.marketCap != null) {
    rows.push({ label: 'Market cap', value: formatCompactUSD(equity.marketCap) });
  }
  if (equity.peRatio != null && equity.peRatio > 0) {
    rows.push({ label: 'P/E ratio', value: `${equity.peRatio.toFixed(2)}x` });
  }
  if (equity.weekHigh52 != null) {
    rows.push({ label: '52-week high', value: formatPrice(equity.weekHigh52) });
  }
  if (equity.weekLow52 != null) {
    rows.push({ label: '52-week low', value: formatPrice(equity.weekLow52) });
  }

  if (rows.length === 0) return null;

  return <StatList rows={rows} />;
}

/**
 * The asset page's own position: units bought as THIS asset, never a Sandwich
 * leg that happens to be it. See `lib/standalone-holding.ts`.
 */
export type DirectHolding = {
  qty: number;
  avgPriceUsd: number | null;
  /** Wallet value of these units, when the balance read priced them. */
  valueUsd: number | null;
};

function PositionCard({
  holding,
  currentPrice,
  onShare,
}: {
  holding: DirectHolding | null;
  currentPrice: number | null;
  onShare: () => void;
}) {
  const contentStyles = useThemedStyles(makeContentStyles);
  const { colors } = useThemeStore();

  const qty = holding?.qty ?? 0;
  if (!holding || qty <= 0) return null;

  const pricedValue =
    currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0
      ? qty * currentPrice
      : null;
  const currentValue =
    holding.valueUsd != null && Number.isFinite(holding.valueUsd) && holding.valueUsd > 0
      ? holding.valueUsd
      : pricedValue;
  const avgPrice = holding.avgPriceUsd;
  const totalCost = avgPrice != null ? avgPrice * qty : null;
  const unrealizedPnl =
    totalCost != null && currentValue != null ? currentValue - totalCost : null;
  const unrealizedPct =
    totalCost != null && totalCost > 0 && currentValue != null
      ? ((currentValue - totalCost) / totalCost) * 100
      : null;

  const positive = (unrealizedPnl ?? 0) >= 0;
  const pnlColor = positive ? '#02ED45' : colors.negative;

  // No current value means the quote hasn't landed yet — every figure derived
  // from it (the position's worth, and both P&L readouts) is pending, not
  // missing. Cost basis is different: if we have no average entry, we never
  // will for this position, and a dash is the honest answer.
  const valuePending = currentValue == null;

  return (
    <View style={contentStyles.positionCard}>
      <View style={contentStyles.positionSummary}>
        <View style={contentStyles.positionHeadlineRow}>
          <View style={contentStyles.positionValueGroup}>
            {valuePending ? (
              <ValueSkeletonLine
                lineHeight={21}
                width={94}
                accessibilityLabel="Loading position value"
              />
            ) : (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={contentStyles.positionValue}
              >
                {formatPrice(currentValue)}
              </Text>
            )}
          </View>

          <View style={contentStyles.positionPnlGroup}>
            {valuePending ? (
              <ValueSkeletonLine
                lineHeight={21}
                width={70}
                accessibilityLabel="Loading unrealized profit and loss"
              />
            ) : (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={[contentStyles.positionPnl, { color: pnlColor }]}
              >
                {unrealizedPnl == null ? '—' : formatSignedUsd(unrealizedPnl)}
              </Text>
            )}
            <View style={contentStyles.positionPctRow}>
              {unrealizedPct != null ? (
                <Ionicons
                  name={positive ? 'caret-up' : 'caret-down'}
                  size={11}
                  color={pnlColor}
                />
              ) : null}
              {valuePending ? (
                <ValueSkeletonLine
                  lineHeight={15}
                  width={44}
                  accessibilityLabel="Loading unrealized return"
                />
              ) : (
                <Text style={contentStyles.positionPct}>
                  {unrealizedPct == null ? '—' : `${Math.abs(unrealizedPct).toFixed(2)}%`}
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={contentStyles.positionPrices}>
          <View style={contentStyles.positionPriceGroup}>
            <Text style={contentStyles.positionPriceLabel}>Invested</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={contentStyles.positionPriceValue}
            >
              {formatUsdAmount(totalCost)}
            </Text>
          </View>
          <View style={[contentStyles.positionPriceGroup, contentStyles.positionPriceGroupRight]}>
            <Text style={contentStyles.positionPriceLabel}>Avg. entry</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={contentStyles.positionPriceValue}
            >
              {formatPrice(avgPrice)}
            </Text>
          </View>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share position"
        onPress={onShare}
        hitSlop={{ top: 3, bottom: 3 }}
        style={({ pressed }) => [
          contentStyles.positionShare,
          pressed && contentStyles.positionSharePressed,
        ]}
      >
        <View style={contentStyles.positionShareIcon}>
          <ShareIcon size={17} color={colors.text} />
        </View>
        <Text style={contentStyles.positionShareText}>Share</Text>
      </Pressable>
    </View>
  );
}

export const StockDetailSheet = forwardRef<StockDetailSheetRef, StockDetailSheetProps>(
function StockDetailSheet({
  onClose,
  animatedIndex,
  onTradeSuccess,
  onRequestAddCash,
  embeddedStock = null,
  notificationTweetUrl,
  embeddedGlassEnabled = false,
  embeddedPerpMarket = null,
  embeddedVenue = 'spot',
  embeddedPerpSide = 'long',
  hideEmbeddedActions = false,
  embeddedScrollY,
  embeddedChartGestureActive,
  embeddedHeaderTestID,
  embeddedTopInset = 0,
  embeddedToggleTop = null,
  onEmbeddedVenueChange,
  onEmbeddedCanToggleMarketChange,
  onEmbeddedPerpActionStateChange,
  onEmbeddedSellableBalanceChange,
  onEmbeddedTradeOpenChange,
  onOpenUser,
  onOpenSandwich,
}: StockDetailSheetProps, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useThemeStore();
  const isDark = scheme === 'dark';
  const sheetColors = getSheetColors(colors);
  const toast = useToast();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [stock, setStock] = useState<Stock | null>(embeddedStock);
  const [marketMode, setMarketMode] = useState<AssetMarketMode>('spot');
  const [selectedPerpMarket, setSelectedPerpMarket] = useState<PhoenixMarket | null>(null);
  // Side the embedded perp view should open on, set by callers that already
  // know the direction. Reset to 'long' on every other entry so a short opened
  // once never leaks into the next market.
  const [perpInitialSide, setPerpInitialSide] = useState<PhoenixTradeSide>('long');
  // Whether that perp view should raise its order ticket on arrival. Same reset
  // discipline as the side: a Buy-button entry must not make the NEXT plain
  // open throw a ticket at the user.
  const [perpAutoOpenOrder, setPerpAutoOpenOrder] = useState(false);
  // True while the perp view has a card raised over the market (order ticket or
  // Auto Close). Used ONLY to hide the venue toggle, which floats above both
  // layers and would otherwise sit on top of the ticket. Never feed this to the
  // sheet's gorhom gesture props — see the note on the modal below.
  const [perpOverlayOpen, setPerpOverlayOpen] = useState(false);
  const perpSpotRequestIdRef = useRef(0);
  const [shouldAnimateOnMount, setShouldAnimateOnMount] = useState(true);
  const [allowSell, setAllowSell] = useState(false);
  const [positionSnapshot, setPositionSnapshot] = useState<StockPositionSnapshot | null>(null);
  // Sign of the viewer's unrealized PnL on this holding, when opened from a
  // Holdings list. Drives the line-chart colour (green in profit / red at loss)
  // instead of a flat accent. null = unknown → fall back to window performance.
  const [positionPnlPositive, setPositionPnlPositive] = useState<boolean | null>(null);
  // Bookmark state is shared app-wide so saving here also fills the feed card
  // and the Saved screen instantly (and vice-versa).
  const { canSave, isSaved, toggleSave } = useSavedStore();
  const metaCacheRef = useRef<Map<string, TokenMeta>>(new Map());
  const performanceCacheRef = useRef<Map<string, PerformanceSnapshot>>(new Map());
  const tokenRequestIdRef = useRef(0);
  const performanceRequestIdRef = useRef(0);

  const [tokenMeta, setTokenMeta] = useState<TokenMeta | null>(null);
  const [, setTokenMetaLoading] = useState(false);
  // News + @tokens (X) posts, sourced from tokens.xyz (`/api/tokens/news`) — NOT
  // Jupiter — so opening the detail screen spends zero of the Jupiter rate-limit
  // bucket reserved for buy/sell execution.
  // Asset detail (profile + risk + description + stats) — the source of truth
  // for the About panel. Cached per asset so reopening the same stock is instant.
  const [assetDetail, setAssetDetail] = useState<AssetDetail | null>(null);
  const assetDetailCacheRef = useRef<Map<string, AssetDetail>>(new Map());
  const assetDetailRequestIdRef = useRef(0);
  // Real underlying-equity reference data (Finnhub, keyed by cleaned ticker).
  const [equityInfo, setEquityInfo] = useState<EquityInfo | null>(null);
  const equityCacheRef = useRef<Map<string, EquityInfo | null>>(new Map());
  const equityRequestIdRef = useRef(0);
  const [performance, setPerformance] = useState<PerformanceSnapshot | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);

  const { markets: phoenixMarkets } = usePhoenixMarkets(Boolean(stock) || marketMode === 'perp');
  const matchedPerpMarket = useMemo(
    () => findPhoenixMarketForAsset(phoenixMarkets, stock),
    [phoenixMarkets, stock],
  );
  const activePerpMarket = selectedPerpMarket ?? matchedPerpMarket;
  const canToggleMarket = Boolean(
    stock &&
      activePerpMarket &&
      phoenixMarketMatchesAsset(activePerpMarket, stock),
  );

  const tradeSheetIndex = useSharedValue(-1);
  // Live finger-follow offset while swiping anywhere on the trade card down.
  const tradeDragY = useSharedValue(0);
  const tradeTouchStartX = useSharedValue(0);
  const tradeTouchStartY = useSharedValue(0);
  const [tradeSheetOpen, setTradeSheetOpen] = useState(false);
  const tradeSheetOpenRef = useRef(false);
  /** Either venue has a ticket raised over the asset — the perp card, or the
   *  spot dialpad. Only the floating venue toggle reads this: it sits above
   *  both layers and must not hover over an order in progress. */
  const tradeOverlayOpen = perpOverlayOpen || tradeSheetOpen;
  const hideTradeSheetImmediately = useCallback(() => {
    Keyboard.dismiss();
    tradeSheetIndex.value = -1;
    setTradeSheetOpen(false);
  }, [tradeSheetIndex]);
  const closeTradeSheet = useCallback(() => {
    Keyboard.dismiss();
    // Gather speed toward the bottom edge, matching the perp ticket's exit.
    // A new tap can still reverse this immediately with the entry spring.
    tradeSheetIndex.value = withTiming(
      -1,
      { duration: 280, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(setTradeSheetOpen)(false);
        }
      },
    );
  }, [tradeSheetIndex]);
  const depositSheetRef = useRef<DepositSheetRef>(null);
  const perpSheetRef = useRef<PhoenixMarketDetailSheetRef>(null);
  const solanaWallet = useEmbeddedSolanaWallet();
  /** The host draws both action bars itself, outside this surface. */
  const hoistActions = Boolean(embeddedStock) && hideEmbeddedActions;
  const depositWalletAddress = solanaWallet.wallets?.[0]?.address ?? null;
  const handleAddCash = useCallback(() => {
    hideTradeSheetImmediately();
    depositSheetRef.current?.open();
  }, [hideTradeSheetImmediately]);
  // Tapping a holder hands off to the parent's profile screen. The sheet closes
  // first (embedded hosts own their own surface and shouldn't be dismissed), so
  // the profile isn't opened underneath a stock sheet the user can't see past.
  const handleOpenHolder = useMemo(
    () =>
      onOpenUser
        ? (privyUserId: string) => {
            if (!embeddedStock) {
              hideTradeSheetImmediately();
              sheetRef.current?.dismiss();
            }
            onOpenUser(privyUserId);
          }
        : undefined,
    [onOpenUser, embeddedStock, hideTradeSheetImmediately],
  );

  // Read here, in the body: the sheet's content is portalled, but this
  // component itself renders inside SandwichDetailProvider.
  const sandwichDetail = useSandwichDetail();
  // Same hand-off as a holder: a presented sheet closes first so the thesis
  // isn't pushed underneath it. The full-screen route stays put, so Back
  // returns to the asset.
  const handleOpenSandwich = useCallback(
    (sandwich: Sandwich, options?: { showComments?: boolean }) => {
      if (!embeddedStock) {
        hideTradeSheetImmediately();
        sheetRef.current?.dismiss();
      }
      if (onOpenSandwich) onOpenSandwich(sandwich, options);
      else sandwichDetail.open(sandwich, options);
    },
    [embeddedStock, hideTradeSheetImmediately, onOpenSandwich, sandwichDetail],
  );

  const displaySymbol = stock
    ? stock.type === 'token'
      ? stock.symbol.trim().toUpperCase()
      : cleanStockSymbol(stock.symbol)
    : '';

  // Post-trade success sheet. Two phases:
  //   1. tap Buy/Sell → close the trade modal AND open this sheet in loading state.
  //   2. trade lands → flip `loading` to false, which triggers the asset-icon
  //      burst from screen center and the success copy to fade in.
  // If the trade fails, the in-flight watcher below auto-dismisses the sheet
  // so the user isn't stuck staring at a loader.
  const [buySuccess, setBuySuccess] = useState<{
    visible: boolean;
    loading: boolean;
    side: 'buy' | 'sell';
    amount: string;
    assetName: string;
    assetSymbol: string;
    assetIcon: string | null;
    realizedPnlUsd: number | null;
    realizedPnlPct: number | null;
  }>({
    visible: false,
    loading: false,
    side: 'buy',
    amount: '',
    assetName: '',
    assetSymbol: '',
    assetIcon: null,
    realizedPnlUsd: null,
    realizedPnlPct: null,
  });
  // True while the trade share sheet is presented on top of the success screen,
  // so the success foreground is hidden and doesn't bleed through the sheet.
  const [sharingTrade, setSharingTrade] = useState(false);

  // Phase 1. The submission has begun but nothing has landed: show the success
  // screen already, in its loading state, so the wait happens on the screen
  // that reports the result rather than behind the dialpad. `BuySuccessSheet`
  // renders "Buying…" with a spinner here and holds back the icon burst.
  const handleTradeStarted = useCallback(
    (ctx: TradeContext) => {
      setBuySuccess({
        visible: true,
        loading: true,
        side: ctx.side,
        amount: ctx.amount,
        assetName: stock ? getDisplayName(stock) : ctx.symbol,
        assetSymbol: ctx.symbol,
        assetIcon: ctx.icon,
        // Not known until the sell settles; the loading state shows neither.
        realizedPnlUsd: null,
        realizedPnlPct: null,
      });
    },
    [stock],
  );

  const handleTradeSucceeded = useCallback(
    (ctx: TradeContext) => {
      // Phase 2. The trade landed on-chain — flip `loading` off, which is what
      // fires the asset-icon burst, the success haptics and the verb cross-fade
      // ("Buying…" → "Bought").
      //
      // Merged onto the existing state rather than replacing it, so the sheet
      // stays mounted across the transition. Remounting would restart the
      // reveal from scratch and lose the cross-fade the loading phase exists
      // for. It still fills in every field, so a success that somehow arrives
      // without a start (a path that never called `onBuyStarted`) opens the
      // sheet correctly on its own.
      setBuySuccess((current) => ({
        ...current,
        visible: true,
        loading: false,
        side: ctx.side,
        amount: ctx.amount,
        assetName: stock ? getDisplayName(stock) : ctx.symbol,
        assetSymbol: ctx.symbol,
        assetIcon: ctx.icon,
        realizedPnlUsd: ctx.realizedPnlUsd ?? null,
        realizedPnlPct: ctx.realizedPnlPct ?? null,
      }));
    },
    [stock],
  );

  const handleCloseBuySuccess = useCallback(() => {
    setSharingTrade(false);
    setBuySuccess((current) => ({ ...current, visible: false, loading: false }));
  }, []);

  const handleShareBuySuccess = useCallback(() => {
    if (!buySuccess.visible) return;
    setSharingTrade(true);
    tradeShareRef.current?.open({
      side: buySuccess.side,
      amount: buySuccess.amount,
      assetName: buySuccess.assetName,
      assetSymbol: buySuccess.assetSymbol,
      assetIcon: buySuccess.assetIcon,
      realizedPnlUsd: buySuccess.realizedPnlUsd,
      realizedPnlPct: buySuccess.realizedPnlPct,
    });
  }, [buySuccess]);

  const tradeEngine = useTradeEngine(stock?.id ?? null, displaySymbol, {
    onSuccess: onTradeSuccess,
    onBuyStarted: handleTradeStarted,
    onSellStarted: handleTradeStarted,
    onBuySuccess: handleTradeSucceeded,
    onSellSuccess: handleTradeSucceeded,
    // Keep the dialpad OPEN while the trade is in flight so its confirm button
    // shows the "Buying…/Selling…" spinner. Once the trade lands the engine
    // calls this to slide the dialpad away, immediately followed by the success
    // callback that opens the bubble-burst success sheet.
    onAfterSubmit: closeTradeSheet,
    icon: stock?.icon ?? null,
    usdPrice: tokenMeta?.usdPrice ?? stock?.usdPrice ?? null,
    onRequestAddCash: handleAddCash,
    // Only quote while the dialpad is actually on screen — the engine is also
    // mounted behind the closed sheet to drive the BUY button.
    quotePreview: tradeSheetOpen,
  });

  useEffect(() => {
    if (!embeddedStock) return;
    onEmbeddedSellableBalanceChange?.(tradeEngine.hasSellableBalance);
  }, [
    embeddedStock,
    onEmbeddedSellableBalanceChange,
    tradeEngine.hasSellableBalance,
  ]);

  // The engine reports success and nothing else, so a failed or abandoned trade
  // would leave the processing screen spinning forever. `submitting` dropping
  // while this sheet is still in its loading phase IS the failure signal: the
  // engine has already raised the error toast, so the only thing left to do is
  // take the screen away. A success can never land here — `onBuySuccess` clears
  // `loading` before the engine's `finally` clears `submitting`.
  useEffect(() => {
    if (!buySuccess.visible || !buySuccess.loading || tradeEngine.submitting) return;
    setBuySuccess((current) => ({ ...current, visible: false, loading: false }));
  }, [buySuccess.visible, buySuccess.loading, tradeEngine.submitting]);

  const isOndoStock = stock?.type === 'ondo' || /ondo$/i.test(stock?.id ?? '');
  const quoteUnavailable = tradeEngine.quotePreview.preview?.unavailable ?? null;
  const isOndoAvailabilityRefusal =
    isOndoStock &&
    (quoteUnavailable?.code === 'market_closed' || quoteUnavailable?.code === 'unroutable');

  // Jupiter's live refusal is the source of truth. Ondo's secondary market is
  // generally 24/5—not limited to the underlying US cash session—so stay quiet
  // while it is tradable and explain the schedule only when the maker declines.
  const tradeNotice = useMemo(() => {
    if (!tradeSheetOpen) return null;
    const preview = tradeEngine.quotePreview.preview;
    if (!preview?.unavailable) return null;
    return isOndoAvailabilityRefusal
      ? ONDO_TRADE_UNAVAILABLE_MESSAGE
      : preview.unavailable.message;
  }, [isOndoAvailabilityRefusal, tradeSheetOpen, tradeEngine.quotePreview.preview]);

  const showOndoHoursLink =
    isOndoAvailabilityRefusal && tradeNotice === ONDO_TRADE_UNAVAILABLE_MESSAGE;

  const handleOpenOndoHours = useCallback(() => {
    void Linking.openURL(ONDO_MARKET_HOURS_URL).catch(() => {
      toast.showToast('Could not open Ondo market hours.', 'error');
    });
  }, [toast]);

  const walletStore = useWalletStore();
  // This component's body runs at its real place in the tree (under the wallet
  // provider), even though its JSX is teleported into gorhom's portal — so this
  // is the correct cash figure to hand to anything rendered inside the sheet.
  const cash = useCash();
  const assetShareRef = useRef<AssetShareSheetRef>(null);
  const tradeShareRef = useRef<TradeShareSheetRef>(null);
  // Sandwich legs held in the wallet, for legs older than the tagged ledger.
  const legReserve = useSandwichLegReserve(walletStore.walletAddress, walletStore.costBasis);
  // Computed here, in the body, because the card itself renders inside
  // gorhom's portal in sheet mode where the wallet store reads empty.
  const directHolding = useMemo<DirectHolding | null>(() => {
    if (!stock) return null;
    const token = walletStore.walletAddress
      ? walletStore.tokens.find((t) => t.mint === stock.id && t.balance > 0)
      : undefined;
    const entry = walletStore.costBasis[stock.id];
    const ledgerReady =
      walletStore.costBasisLoaded &&
      (typeof entry?.standaloneQty === 'number' || legReserve !== null);
    if (!token || !ledgerReady) {
      // Until the ledger is in, only a Holdings row's snapshot is trustworthy:
      // that list already files Sandwich legs under their Sandwich. Guessing
      // from the raw balance is exactly what showed a basket leg as invested.
      const snap = positionSnapshot;
      return snap && snap.quantity > 0
        ? { qty: snap.quantity, avgPriceUsd: snap.avgPriceUsd, valueUsd: snap.currentValueUsd }
        : null;
    }
    const held = standaloneHolding({
      walletBalance: token.balance,
      entry,
      reserve: legReserve,
      mint: stock.id,
    });
    if (held.qty <= 0) return null;
    const share = held.qty / token.balance;
    return {
      qty: held.qty,
      avgPriceUsd: held.avgPriceUsd,
      valueUsd: token.usdValue != null && token.usdValue > 0 ? token.usdValue * share : null,
    };
  }, [
    stock,
    walletStore.walletAddress,
    walletStore.tokens,
    walletStore.costBasis,
    walletStore.costBasisLoaded,
    legReserve,
    positionSnapshot,
  ]);
  const hasOpenPosition = directHolding !== null;

  const handleShareAsset = useCallback(() => {
    if (!stock || !hasOpenPosition) return;
    assetShareRef.current?.open({
      mint: stock.id,
      symbol: activePerpMarket
        ? normalizePhoenixAssetSymbol(activePerpMarket.symbol)
        : cleanStockSymbol(stock.symbol),
      name: activePerpMarket?.name ?? getDisplayName(stock),
      icon: stock.icon ?? tokenMeta?.icon ?? activePerpMarket?.logoUri ?? null,
      price: tokenMeta?.usdPrice ?? stock.usdPrice ?? null,
      change24h: tokenMeta?.priceChange24h ?? stock.priceChange24h ?? null,
    });
  }, [activePerpMarket, hasOpenPosition, stock, tokenMeta]);

  const [scrubPrice, setScrubPrice] = useState<number | null>(null);
  const [scrubChange, setScrubChange] = useState<number | null>(null);
  const [scrubTimestamp, setScrubTimestamp] = useState<number | null>(null);
  const [chartPrice, setChartPrice] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('candle');
  const [chartWindow, setChartWindow] = useState<ChartWindow>('24H');
  const [activeTab, setActiveTab] = useState<DetailTab>('sandwiches');
  const [relatedSandwiches, setRelatedSandwiches] = useState<Sandwich[]>([]);
  const [sandwichesLoading, setSandwichesLoading] = useState(false);
  const sandwichesRequestIdRef = useRef(0);
  // Bread users holding this mint, resolved on-chain server-side.
  const [holders, setHolders] = useState<AssetHolderUser[]>([]);
  // null until the count is known, so the tab label can stay a bare "Holders"
  // while loading instead of flashing a "0" that turns out to be wrong.
  const [holderCount, setHolderCount] = useState<number | null>(null);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const holdersRequestIdRef = useRef(0);
  // The perp view's Holders tab is its own list — open perps on the Phoenix
  // market only, never the spot token holders above.
  const [perpHolders, setPerpHolders] = useState<PerpHolderUser[]>([]);
  const [perpHolderCount, setPerpHolderCount] = useState<number | null>(null);
  const [perpHoldersLoading, setPerpHoldersLoading] = useState(false);
  const perpHoldersRequestIdRef = useRef(0);
  // Per-window change derived directly from whatever candles the chart loaded.
  // Used as a fallback for the header + performance row whenever the canonical
  // backend value is missing (e.g. Birdeye rate-limited the perf endpoint).
  const [chartChangeByWindow, setChartChangeByWindow] = useState<
    Record<string, number | null>
  >({});

  const handleScrub = useCallback((price: number | null, change: number | null) => {
    setScrubPrice(price);
    setScrubChange(change);
  }, []);

  const handleScrubTime = useCallback((ts: number | null) => {
    setScrubTimestamp(ts);
  }, []);

  const handleLineWindowChange = useCallback(
    (price: number | null, change: number | null, window: LineChartWindow) => {
      setChartPrice(price);
      setScrubPrice(null);
      setScrubChange(null);
      setScrubTimestamp(null);
      if (change !== null) {
        setChartChangeByWindow((prev) =>
          prev[window] === change ? prev : { ...prev, [window]: change },
        );
      }
    },
    [],
  );

  const handleCandleWindowChange = useCallback(
    (price: number | null, change: number | null, window: ChartWindow) => {
      setChartPrice(price);
      setScrubPrice(null);
      setScrubChange(null);
      setScrubTimestamp(null);
      if (change !== null) {
        setChartChangeByWindow((prev) =>
          prev[window] === change ? prev : { ...prev, [window]: change },
        );
      }
    },
    [],
  );

  const handleWindowChange = useCallback((window: ChartWindow) => {
    setChartWindow(window);
    setScrubPrice(null);
    setScrubChange(null);
    setScrubTimestamp(null);
  }, []);

  // Toggling chart type only clears transient scrub state.
  const toggleChartMode = useCallback(() => {
    setChartMode((prev) => (prev === 'line' ? 'candle' : 'line'));
    setScrubPrice(null);
    setScrubChange(null);
  }, []);

  // Full reset only when a different stock is loaded.
  useEffect(() => {
    setScrubPrice(null);
    setScrubChange(null);
    setChartPrice(null);
    setChartMode('line');
    setChartWindow('24H');
    setChartChangeByWindow({});
    setActiveTab('sandwiches');
  }, [stock?.id]);

  // The full asset header and chart now live in the scroll content. Only this
  // compact identity fades into the top chrome once the hero has moved away;
  // keeping the chart at a fixed height avoids a Yoga relayout on every frame.
  const COMPACT_HEADER_START = 48;
  const COMPACT_HEADER_END = 84;

  const scrollY = useSharedValue(0);
  // The perp venue is a separate layer with its own scroll view. Both offsets
  // are tracked so the host can be told the ACTIVE one — reporting a single
  // shared value from both would leave the hidden layer's position standing
  // after a venue switch.
  const perpScrollY = useSharedValue(0);
  // The perp layer's own headline, so the collapsed header on the perp side
  // prints the perp's mark and range % rather than spot's.
  const perpQuoteStore = useMemo(() => createQuoteStore(), []);

  useEffect(() => {
    scrollY.value = 0;
    perpScrollY.value = 0;
  }, [perpScrollY, scrollY, stock?.id]);

  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // Gorhom's scrollable already owns the sheet's animated scroll handler and
  // forwards whatever `onScroll` it is handed through `runOnJS` — a Reanimated
  // handler object is not serializable, so that path crashes Worklets. Only
  // the embedded Reanimated.ScrollView may take the worklet version.
  const handleScrollJS = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollY.value = event.nativeEvent.contentOffset.y;
    },
    [scrollY],
  );

  // Report whichever venue layer is on screen. Keyed on `marketMode` so a
  // venue switch immediately publishes that layer's own position instead of
  // leaving the other one's standing.
  useAnimatedReaction(
    () => (marketMode === 'perp' ? perpScrollY.value : scrollY.value),
    (value) => {
      'worklet';
      if (embeddedScrollY) embeddedScrollY.value = value;
    },
    [marketMode, embeddedScrollY],
  );



  const compactHeaderStyle = useAnimatedStyle(() => {
    const activeScrollY = marketMode === 'perp' ? perpScrollY.value : scrollY.value;
    return {
      opacity: interpolate(
        activeScrollY,
        [COMPACT_HEADER_START, COMPACT_HEADER_END],
        [0, 1],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          translateY: interpolate(
            activeScrollY,
            [COMPACT_HEADER_START, COMPACT_HEADER_END],
            [-8, 0],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  }, [marketMode]);

  const stockContentStyle = useAnimatedStyle(() => {
    const entryProgress = interpolate(
      tradeSheetIndex.value,
      [-1, 0],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const dragProgress = Math.max(0, 1 - tradeDragY.value / TRADE_SHEET_HEIGHT);
    const progress = Math.min(entryProgress, dragProgress);
    const scale = interpolate(progress, [0, 1], [1, TRADE_STACK_SCALE]);
    const translateY = interpolate(progress, [0, 1], [0, TRADE_STACK_PUSH_Y]);
    const borderRadius = interpolate(progress, [0, 1], [0, STOCK_SHEET_TOP_RADIUS]);
    return { borderRadius, transform: [{ scale }, { translateY }] };
  });
  const tradeBackdropStyle = useAnimatedStyle(() => {
    const entryProgress = interpolate(
      tradeSheetIndex.value,
      [-1, 0],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const dragProgress = Math.max(0, 1 - tradeDragY.value / TRADE_SHEET_HEIGHT);
    return { opacity: Math.min(entryProgress, dragProgress) };
  });
  const tradeOverlayStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          interpolate(
            tradeSheetIndex.value,
            [-1, 0],
            [TRADE_SHEET_HEIGHT, 0],
            Extrapolation.CLAMP,
          ) +
          tradeDragY.value,
      },
    ],
  }));

  const openTradeSheet = useCallback((tradeSide: 'buy' | 'sell') => {
    tradeEngine.reset(tradeSide);
    tradeDragY.value = 0;
    if (tradeSheetOpenRef.current) {
      // A re-tap during the close reverses the card from its current position.
      tradeSheetIndex.value = withSpring(0, { damping: 26, stiffness: 300, mass: 1 });
    } else {
      // Mount at the bottom edge; the effect below starts the full-height entry
      // only after React has put the card on screen.
      tradeSheetIndex.value = -1;
    }
    setTradeSheetOpen(true);
  }, [tradeEngine, tradeSheetIndex, tradeDragY]);

  useEffect(() => {
    const wasOpen = tradeSheetOpenRef.current;
    tradeSheetOpenRef.current = tradeSheetOpen;
    if (tradeSheetOpen && !wasOpen) {
      tradeSheetIndex.value = withSpring(0, { damping: 30, stiffness: 200, mass: 1 });
    }
  }, [tradeSheetIndex, tradeSheetOpen]);

  // Swipe-down anywhere on the trade overlay dismisses ONLY the trade overlay,
  // not the whole stock-detail modal. gorhom's own pan-down-to-close is disabled
  // while the overlay is open (see the modal props below), so this is the sole
  // drag-to-dismiss path for the buy/sell sheet.
  //
  // Manual activation lets buttons keep taps while still allowing a downward
  // swipe to begin from the header, amount, keypad gaps, or footer.
  const tradeDismissPan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((event) => {
          'worklet';
          const touch = event.allTouches[0];
          if (!touch) return;
          tradeTouchStartX.value = touch.absoluteX;
          tradeTouchStartY.value = touch.absoluteY;
        })
        .onTouchesMove((event, manager) => {
          'worklet';
          const touch = event.allTouches[0];
          if (!touch) return;
          const dx = touch.absoluteX - tradeTouchStartX.value;
          const dy = touch.absoluteY - tradeTouchStartY.value;
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
        .onUpdate((e) => {
          'worklet';
          tradeDragY.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          'worklet';
          const decel = 0.998;
          const projected = e.translationY + (e.velocityY / 1000) * (decel / (1 - decel));
          const shouldDismiss = projected > 160;
          if (shouldDismiss) {
            // Let the overlay fade out from where the finger left it; openTradeSheet
            // resets tradeDragY before the next open.
            runOnJS(closeTradeSheet)();
          } else {
            tradeDragY.value = withSpring(0, {
              velocity: e.velocityY,
              damping: 24,
              stiffness: 260,
              mass: 1,
            });
          }
        }),
    [closeTradeSheet, tradeDragY, tradeTouchStartX, tradeTouchStartY],
  );

  const snapPoints = useMemo(() => ['92%'], []);

  // Tracks whether the modal is actually on screen. The home screen dismisses
  // this sheet on every tab blur; calling gorhom's dismiss() on an
  // already-closed modal desyncs its internal index ref, after which present()
  // silently no-ops and the sheet stops opening. Guarding on real open state
  // keeps dismiss() from ever firing while closed.
  const isOpenRef = useRef(false);

  useImperativeHandle(ref, () => ({
    open(
      nextStock: Stock,
      options?: StockDetailOpenOptions,
    ) {
      perpSpotRequestIdRef.current += 1;
      setStock(nextStock);
      setMarketMode('spot');
      setSelectedPerpMarket(options?.perpMarket ?? null);
      setPerpInitialSide('long');
      setPerpAutoOpenOrder(false);
      setAllowSell(!!options?.showSell);
      setPositionPnlPositive(options?.pnlPositive ?? null);
      setPositionSnapshot(options?.position ?? null);
      const animate = options?.animateOnMount !== false;
      setShouldAnimateOnMount(animate);
      hideTradeSheetImmediately();
      isOpenRef.current = true;
      // Let the requested mount-animation mode commit before presenting. This
      // also restores the normal animated entrance after a prior card-morph
      // open used the non-animated mode.
      requestAnimationFrame(() => {
        sheetRef.current?.present();
        // One more frame so the trade engine is bound to the stock just set —
        // it keys off `stock.id`, which is still the PREVIOUS asset until this
        // state commit lands.
        if (options?.openTrade) {
          requestAnimationFrame(() => openTradeSheet(options.openTrade!));
        }
      });
    },
    openPerp(
      nextMarket: PhoenixMarket,
      spotStock?: Stock | null,
      side: PhoenixTradeSide = 'long',
      options?: { openTrade?: boolean },
    ) {
      const requestId = ++perpSpotRequestIdRef.current;
      setPerpInitialSide(side);
      setPerpAutoOpenOrder(options?.openTrade === true);
      setStock(spotStock ?? null);
      setMarketMode('perp');
      setSelectedPerpMarket(nextMarket);
      setAllowSell(false);
      setPositionPnlPositive(null);
      setPositionSnapshot(null);
      setShouldAnimateOnMount(true);
      hideTradeSheetImmediately();
      isOpenRef.current = true;
      requestAnimationFrame(() => sheetRef.current?.present());

      if (!spotStock) {
        void getTopHolderStocks({ q: normalizePhoenixAssetSymbol(nextMarket.symbol), limit: 20 })
          .then((results) => {
            if (requestId !== perpSpotRequestIdRef.current) return;
            const match = results.find((candidate) =>
              phoenixMarketMatchesAsset(nextMarket, candidate),
            );
            if (match) setStock(match);
          })
          .catch(() => {
            // The perp remains fully usable. Without a confirmed spot match we
            // simply keep the venue toggle hidden instead of offering a dead end.
          });
      }
    },
    update(nextStock: Stock) {
      setStock((current) =>
        current && current.id === nextStock.id ? nextStock : current,
      );
    },
    trade(side: 'buy' | 'sell') {
      openTradeSheet(side);
    },
    tradePerp(side: PhoenixTradeSide) {
      perpSheetRef.current?.openOrder(side);
    },
    activatePerps() {
      perpSheetRef.current?.activate();
    },
    close() {
      if (!isOpenRef.current) return;
      hideTradeSheetImmediately();
      sheetRef.current?.dismiss();
    },
  }), [hideTradeSheetImmediately, openTradeSheet]);

  // Metadata for the embedded asset can be replaced after the card opens
  // (preview → resolved stock). Keep that data fresh without treating it as a
  // new navigation event and resetting the user's selected market.
  useEffect(() => {
    if (embeddedStock) setStock(embeddedStock);
  }, [embeddedStock]);

  const embeddedStockId = embeddedStock?.id ?? null;
  // Seeds the embedded venue from what the host asked for. Keyed on the asset
  // AND on the requested venue/market, so a host that resolves its Phoenix
  // market *after* the morph (the sandwich leg path does, to keep the animation
  // off the network) still lands on perp when it arrives. It deliberately does
  // not re-run on a user toggle, so flipping venue by hand sticks — which holds
  // because every host passes the market as state, not a fresh object per render.
  useEffect(() => {
    if (!embeddedStockId) return;
    const wantsPerp = embeddedVenue === 'perp' && embeddedPerpMarket !== null;
    setSelectedPerpMarket(embeddedPerpMarket);
    setPerpInitialSide(wantsPerp ? embeddedPerpSide : 'long');
    setMarketMode(wantsPerp ? 'perp' : 'spot');
  }, [embeddedStockId, embeddedVenue, embeddedPerpMarket, embeddedPerpSide]);

  useEffect(() => {
    if (!embeddedStock) return;
    // A hoisted host draws the perp bar itself, so "an overlay is up" is the
    // only thing that should hide its controls. Without hoisting the perp
    // venue's own LONG/SHORT sit inside this surface, and the host's floating
    // BUY has to disappear for the whole venue.
    onEmbeddedTradeOpenChange?.(
      hoistActions
        ? tradeSheetOpen || perpOverlayOpen
        : tradeSheetOpen || marketMode === 'perp',
    );
  }, [
    embeddedStock,
    hoistActions,
    marketMode,
    onEmbeddedTradeOpenChange,
    perpOverlayOpen,
    tradeSheetOpen,
  ]);

  useEffect(() => {
    if (embeddedStock) onEmbeddedVenueChange?.(marketMode);
  }, [embeddedStock, marketMode, onEmbeddedVenueChange]);

  useEffect(() => {
    if (embeddedStock) onEmbeddedCanToggleMarketChange?.(canToggleMarket);
  }, [canToggleMarket, embeddedStock, onEmbeddedCanToggleMarketChange]);

  useEffect(() => {
    if (!stock?.id) {
      setTokenMeta(null);
      setTokenMetaLoading(false);
      return;
    }

    const cacheKey = stock.id;
    const cached = metaCacheRef.current.get(cacheKey);

    if (cached) {
      setTokenMeta(cached);
      setTokenMetaLoading(false);
      return;
    }

    const requestId = ++tokenRequestIdRef.current;
    setTokenMetaLoading(true);

    void (async () => {
      try {
        // Price / icon / 24h change all come from the tokens.xyz `stock` prop —
        // the same source the chart uses — so the detail screen no longer hits
        // Jupiter for metadata. Decimals are the only must-be-authoritative
        // field (they drive trade sizing); source them from the on-chain mint
        // (`getMintDecimals` → /api/solana/mint-info, Helius/RPC, cached). This
        // keeps Jupiter's shared rate-limit bucket free for buy/sell execution.
        const resolvedDecimals = await getMintDecimals(stock.id);

        if (requestId !== tokenRequestIdRef.current) return;

        const nextMeta: TokenMeta = {
          icon: stock.icon ?? null,
          usdPrice: stock.usdPrice ?? null,
          priceChange24h: stock.priceChange24h ?? null,
          decimals: resolvedDecimals ?? 6,
        };

        setTokenMeta(nextMeta);
        // Only cache once decimals are authoritative — never persist the 6
        // fallback, so a transient lookup failure doesn't stick for the session.
        if (resolvedDecimals !== null) {
          metaCacheRef.current.set(cacheKey, nextMeta);
        }
      } catch {
        if (requestId !== tokenRequestIdRef.current) return;
        setTokenMeta(null);
      } finally {
        if (requestId === tokenRequestIdRef.current) {
          setTokenMetaLoading(false);
        }
      }
    })();
  }, [stock?.id, stock?.icon, stock?.usdPrice, stock?.priceChange24h]);

  // The card price is only a navigation snapshot. Refresh the exact mint from
  // tokens.xyz while the spot detail is visible so the headline, trade value,
  // position value and chart anchor all move together like the source dashboard.
  useEffect(() => {
    const mint = stock?.id;
    if (!mint || marketMode !== 'spot') return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = async () => {
      try {
        const live = await getStockById(mint);
        if (cancelled) return;
        setTokenMeta((current) => ({
          icon: live.icon ?? current?.icon ?? stock.icon ?? null,
          usdPrice: live.usdPrice ?? current?.usdPrice ?? stock.usdPrice ?? null,
          priceChange24h:
            live.priceChange24h ?? current?.priceChange24h ?? stock.priceChange24h ?? null,
          decimals: current?.decimals ?? 6,
        }));
      } catch {
        // Keep the last good quote; a transient refresh failure must not blank
        // the price or interrupt trading.
      }
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(() => void refresh(), SPOT_LIVE_REFRESH_MS);
    };

    void refresh();
    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
        start();
      } else {
        stop();
      }
    });

    return () => {
      cancelled = true;
      stop();
      subscription.remove();
    };
  }, [marketMode, stock?.icon, stock?.id, stock?.priceChange24h, stock?.usdPrice]);

  useEffect(() => {
    if (!stock?.id) {
      setPerformance(null);
      setPerformanceLoading(false);
      return;
    }

    const cacheKey = stock.id;
    const cached = performanceCacheRef.current.get(cacheKey);
    if (cached) {
      setPerformance(cached);
      setPerformanceLoading(false);
      return;
    }

    const requestId = ++performanceRequestIdRef.current;
    setPerformanceLoading(true);

    void getStockPerformance(stock.id)
      .then((snapshot) => {
        if (requestId !== performanceRequestIdRef.current) return;
        performanceCacheRef.current.set(cacheKey, snapshot);
        setPerformance(snapshot);
      })
      .catch(() => {
        if (requestId !== performanceRequestIdRef.current) return;
        setPerformance({
          oneWeek: null,
          oneMonth: null,
          threeMonth: null,
          sixMonth: null,
          oneYear: null,
        });
      })
      .finally(() => {
        if (requestId === performanceRequestIdRef.current) {
          setPerformanceLoading(false);
        }
      });
  }, [stock?.id]);

  // Asset detail — single `?include=profile,risk` call (+ description) that backs
  // the About panel's Description, Profile, stats and Risk sections.
  useEffect(() => {
    if (!stock?.id) {
      setAssetDetail(null);
      return;
    }
    // Prefer the canonical slug (e.g. "nvidia") when the card carries it; the
    // mint also resolves, but the slug skips an upstream resolve hop.
    const lookupId = stock.assetId ?? stock.id;
    const cached = assetDetailCacheRef.current.get(lookupId);
    if (cached) {
      setAssetDetail(cached);
      return;
    }
    setAssetDetail(null);
    const id = ++assetDetailRequestIdRef.current;
    void getAssetDetail(lookupId).then((detail) => {
      if (id !== assetDetailRequestIdRef.current) return;
      if (detail) assetDetailCacheRef.current.set(lookupId, detail);
      setAssetDetail(detail);
    });
  }, [stock?.id, stock?.assetId]);

  // Real underlying-equity reference data, looked up by the cleaned ticker.
  // Cached per ticker so reopening the same stock is instant.
  useEffect(() => {
    const ticker = stock ? cleanStockSymbol(stock.symbol) : '';
    if (!ticker) {
      setEquityInfo(null);
      return;
    }
    const cached = equityCacheRef.current.get(ticker);
    if (cached !== undefined) {
      setEquityInfo(cached);
      return;
    }
    setEquityInfo(null);
    const id = ++equityRequestIdRef.current;
    void getEquityInfo(ticker).then((info) => {
      if (id !== equityRequestIdRef.current) return;
      equityCacheRef.current.set(ticker, info);
      setEquityInfo(info);
    });
  }, [stock?.id, stock?.symbol]);

  // Sandwiches that include this asset, filtered from the public feed. Spot
  // legs match on mint. A perp leg often has no mint (or another wrapper's),
  // so it matches on ticker instead — equities only, because Sandwich perp
  // legs are equity-only and a token's symbol can collide with a stock's.
  useEffect(() => {
    if (!stock?.id) {
      setRelatedSandwiches([]);
      setSandwichesLoading(false);
      return;
    }
    const mint = stock.id;
    const ticker = stock.type === 'token' ? null : cleanStockSymbol(stock.symbol);
    const id = ++sandwichesRequestIdRef.current;
    setSandwichesLoading(true);
    void getSandwiches(50)
      .then((rows) => {
        if (id !== sandwichesRequestIdRef.current) return;
        setRelatedSandwiches(
          rows.filter((s) =>
            s.legs.some(
              (l) =>
                l.mint === mint ||
                (ticker !== null &&
                  l.venue === 'perp' &&
                  l.symbol !== null &&
                  cleanStockSymbol(l.symbol) === ticker),
            ),
          ),
        );
      })
      .catch(() => {
        if (id !== sandwichesRequestIdRef.current) return;
        setRelatedSandwiches([]);
      })
      .finally(() => {
        if (id === sandwichesRequestIdRef.current) setSandwichesLoading(false);
      });
  }, [stock?.id, stock?.symbol, stock?.type]);

  // Holders. Fetched on open rather than on tab select, because the count is
  // shown ON the tab label — a number that only appears after you've opened the
  // tab tells you nothing. The server caches per mint, so reopening the same
  // asset costs one cheap request.
  useEffect(() => {
    const mint = stock?.id ?? null;
    // A different asset invalidates the previous list outright, so the tab can
    // never show the last stock's holders while the new ones load.
    const id = ++holdersRequestIdRef.current;
    setHolders([]);
    setHolderCount(null);
    if (!mint) {
      setHoldersLoading(false);
      return;
    }
    setHoldersLoading(true);
    void getAssetHolders(mint)
      .then((result) => {
        if (id !== holdersRequestIdRef.current) return;
        setHolders(result.holders);
        setHolderCount(result.holderCount);
      })
      .finally(() => {
        if (id === holdersRequestIdRef.current) setHoldersLoading(false);
      });
  }, [stock?.id]);

  // Perp holders. Fetched the first time the perp view is shown for a market,
  // not on every asset open: the server scans every Bread wallet's Phoenix
  // account (cached for all markets at once), and that budget is shared with
  // live market data — most people never flip to Perp.
  const perpHoldersSymbol = activePerpMarket?.symbol ?? null;
  const perpViewShown = marketMode === 'perp';
  const perpHoldersFetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (perpHoldersFetchedForRef.current !== perpHoldersSymbol) {
      // A different market invalidates the previous list outright.
      perpHoldersFetchedForRef.current = null;
      ++perpHoldersRequestIdRef.current;
      setPerpHolders([]);
      setPerpHolderCount(null);
      setPerpHoldersLoading(false);
    }
    if (!perpHoldersSymbol || !perpViewShown) return;
    if (perpHoldersFetchedForRef.current === perpHoldersSymbol) return;
    perpHoldersFetchedForRef.current = perpHoldersSymbol;
    const id = ++perpHoldersRequestIdRef.current;
    setPerpHoldersLoading(true);
    void getPerpHolders(perpHoldersSymbol)
      .then((result) => {
        if (id !== perpHoldersRequestIdRef.current) return;
        setPerpHolders(result.holders);
        setPerpHolderCount(result.holderCount);
      })
      .finally(() => {
        if (id === perpHoldersRequestIdRef.current) setPerpHoldersLoading(false);
      });
  }, [perpHoldersSymbol, perpViewShown]);

  // Prefer the freshly fetched by-mint price (tokenMeta) once it lands: it runs
  // the backend's real-share guard, so a detached wrapper print carried in on
  // the tapped card (the Ondo HIMS token showed $69.93 vs the ~$37 share) gets
  // replaced. The card's own price only bridges the gap until that fetch
  // resolves, and the chart's last candle is a final fallback.
  const basePrice = tokenMeta?.usdPrice ?? stock?.usdPrice ?? null;
  const windowChangeMap = useMemo((): Record<ChartWindow, number | null> => {
    const baseChange = tokenMeta?.priceChange24h ?? stock?.priceChange24h ?? null;
    const chart24h = chartChangeByWindow['24H'] ?? null;
    // tokens.xyz reports `priceChange24hPercent: 0` — not null — for variants
    // too thin to have a 24h-ago reference print, so Bloom Energy showed a flat
    // 0.00% next to candles that had actually moved. An exact zero can't be
    // told apart from "no reading", so defer to the candles when they disagree;
    // an asset that genuinely didn't move has a ~0 chart change too, so nothing
    // changes for those.
    const change24h =
      baseChange === 0 && chart24h !== null ? chart24h : baseChange ?? chart24h;

    return {
      '24H': change24h,
      '1W': performance?.oneWeek ?? chartChangeByWindow['1W'] ?? null,
      '1M': performance?.oneMonth ?? chartChangeByWindow['1M'] ?? null,
      '3M': performance?.threeMonth ?? chartChangeByWindow['3M'] ?? null,
      '1Y': performance?.oneYear ?? chartChangeByWindow['1Y'] ?? null,
    };
  }, [stock, tokenMeta, performance, chartChangeByWindow]);

  // Headline = the live price (basePrice), which is the exact same value the
  // Home card showed for this stock — so the two screens match. The chart's
  // last-candle close (chartPrice) lags the live price by up to one candle, so
  // it's only used while scrubbing (scrubPrice) or as a fallback when there's
  // no live price (e.g. some prestocks).
  const selectedPrice = scrubPrice ?? basePrice ?? chartPrice;
  // When scrubbing, show change from window start → scrubbed candle so the
  // header tracks the crosshair. When not scrubbing, fall back to the canonical
  // window change (same value the performance section row shows).
  const selectedChange = scrubChange ?? windowChangeMap[chartWindow];
  // When a spot asset also has a Phoenix market, keep one stable identity on
  // both sides of the toggle — and make it the ASSET's, not the venue's. The
  // tokens.xyz icon is the same picture on either side of the toggle, which is
  // what stops the header swapping branding when you flip to perps; Phoenix's
  // own logo is only consulted for a market with no catalog entry at all.
  const selectedIcon = stock?.icon ?? tokenMeta?.icon ?? activePerpMarket?.logoUri ?? null;
  const selectedIconFallbackUris = activePerpMarket
    ? [...equityLogoFallbackUris(activePerpMarket.symbol), activePerpMarket.logoUri]
    : undefined;
  const displayName = activePerpMarket?.name ?? (stock ? getDisplayName(stock) : '');
  const headerSymbol = activePerpMarket
    ? normalizePhoenixAssetSymbol(activePerpMarket.symbol)
    : displaySymbol;
  // Native SwiftUI/Glass surfaces render outside React Native's transformed
  // texture hierarchy. Use stable RN fallbacks when this screen lives inside
  // the card-to-sheet morph.
  const useGlass =
    HAS_GLASS && (!embeddedStock || embeddedGlassEnabled);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BlurBackdrop {...props} />
    ),
    [],
  );
  const DetailScrollView = embeddedStock ? Reanimated.ScrollView : BottomSheetScrollView;
  const handleMarketModeChange = useCallback(
    (nextMode: AssetMarketMode) => {
      if (nextMode === 'perp') {
        const nextMarket = selectedPerpMarket ?? matchedPerpMarket;
        if (!nextMarket) return;
        hideTradeSheetImmediately();
        setSelectedPerpMarket(nextMarket);
      } else if (embeddedChartGestureActive) {
        // Both venue layers stay mounted. If iOS ends a chart touch while its
        // layer is being hidden, RNGH may not deliver that gesture's finalize
        // callback; never carry the perp screen-dismiss lock into Spot.
        embeddedChartGestureActive.value = false;
      }

      setMarketMode(nextMode);
    },
    [
      embeddedChartGestureActive,
      hideTradeSheetImmediately,
      matchedPerpMarket,
      selectedPerpMarket,
    ],
  );
  const spotSheetContents = (
    <View style={styles.stockSheetHost}>
          <Reanimated.View style={[styles.stockContentLayer, stockContentStyle]}>
            {!stock ? (
              <DetailScrollView
                keyboardShouldPersistTaps="handled"
                onScrollBeginDrag={Keyboard.dismiss}
                style={styles.sheetScrollView}
                contentContainerStyle={styles.contentContainer}>
                <View style={styles.stateCard}>
                  <Text style={styles.stateTitle}>Select a stock</Text>
                  <Text style={styles.stateBody}>Tap a card on the home list to open stock details.</Text>
                </View>
              </DetailScrollView>
            ) : (
              <View style={[styles.sheetBody, { paddingTop: 24 + embeddedTopInset }]}>
                {/* One natural scroll: the full identity and chart leave the
                    screen together, while the compact identity above fades in. */}
                <DetailScrollView
                  keyboardShouldPersistTaps="handled"
                  onScrollBeginDrag={Keyboard.dismiss}
                  onScroll={embeddedStock ? handleScroll : handleScrollJS}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}
                  style={styles.unifiedScroll}
                  contentContainerStyle={styles.unifiedScrollContent}>
                  {notificationTweetUrl ? <NotificationTweet url={notificationTweetUrl} /> : null}
                  <View style={styles.scrollingHeader}>
                    {canToggleMarket && embeddedToggleTop == null ? (
                      <View style={styles.topBar}>
                        <View style={styles.marketTogglePlaceholder} />
                      </View>
                    ) : null}
                    <View style={styles.headerRow} testID={embeddedHeaderTestID}>
                      <View style={styles.headerLeft}>
                        <View style={styles.stickerOuter}>
                          <AssetLogo
                            uri={selectedIcon}
                            fallbackUris={selectedIconFallbackUris}
                            size={40}
                            borderRadius={20}
                            backgroundColor="transparent"
                            fallback={
                              <View style={styles.stickerInnerFallback}>
                                <Text style={styles.iconFallbackText}>{displayName.slice(0, 1)}</Text>
                              </View>
                            }
                          />
                        </View>
                        <View style={{ flex: 1, paddingRight: 4 }}>
                          <Text style={styles.symbol} numberOfLines={1} ellipsizeMode="tail">
                            {displayName}
                          </Text>
                          <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">{headerSymbol}</Text>
                        </View>
                      </View>
                      <View style={styles.headerRight}>
                        {/* No price yet means the quote is still in flight, not
                            that the asset is unpriced — so the headline holds a
                            skeleton rather than an "N/A" that reads as broken. */}
                        {selectedPrice == null ? (
                          <ValueSkeletonLine
                            lineHeight={34}
                            width={116}
                            accessibilityLabel="Loading price"
                          />
                        ) : (
                          <AssetPriceText
                            label={formatPrice(selectedPrice)}
                            size={27}
                            lineHeight={34}
                            style={styles.priceText}
                          />
                        )}
                        {selectedChange == null ? (
                          <ValueSkeletonLine
                            lineHeight={19}
                            width={62}
                            style={styles.changeSkeleton}
                            accessibilityLabel="Loading change"
                          />
                        ) : (
                          <Text style={[styles.changeText, { color: changeColor(selectedChange, colors) }]}>
                            {formatPercent(selectedChange)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>

                  {/* The fixed-height chart scrolls naturally; animating its
                      height was forcing a full layout pass on every frame. */}
                  <View style={styles.chartSection}>
                    <View style={{ overflow: 'hidden' }}>
                      {chartMode === 'line' ? (
                        <LineChart
                          mint={stock.id}
                          assetId={stock.assetId ?? assetDetail?.assetId ?? null}
                          activeWindow={chartWindow}
                          height={DETAIL_CHART_HEIGHT}
                          anchorPrice={basePrice}
                          showDotGrid
                          surfaceColor={sheetColors.background}
                          onScrub={handleScrub}
                          onWindowChange={handleLineWindowChange}
                          color={
                            tradeSheetOpen && tradeEngine.side === 'sell'
                              ? colors.negative
                              : positionPnlPositive != null
                                ? positionPnlPositive
                                  ? colors.positive
                                  : colors.negative
                                : selectedChange != null
                                  // Same figure, same colour, as the header:
                                  // the chart's own first-candle→last-candle
                                  // reading uses a different reference print
                                  // than the 24h stat, and the two disagreed
                                  // (a green +2.75% over a red line).
                                  ? changeColor(selectedChange, colors)
                                  : undefined // nothing known → chart's own reading
                          }
                        />
                      ) : (
                        <CandlestickChart
                          mint={stock.id}
                          assetId={stock.assetId ?? assetDetail?.assetId ?? null}
                          activeWindow={chartWindow}
                          height={DETAIL_CHART_HEIGHT}
                          onScrub={handleScrub}
                          onScrubTime={handleScrubTime}
                          onWindowChange={handleCandleWindowChange}
                          livePrice={basePrice}
                        />
                      )}
                    </View>

                    {/* Chart controls — the timeframe pills sit centred under
                        the chart. The scrub date (left) and the line/candle
                        switcher (right) are absolute, so the pills stay centred
                        whether or not the date readout is showing. */}
                    <View style={styles.chartControlsWrap}>
                      {chartMode === 'candle' && scrubTimestamp != null && (
                        <Text style={styles.scrubTimeLabel}>
                          {chartWindow === '24H'
                            ? new Date(scrubTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : chartWindow === '1W'
                            ? new Date(scrubTimestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
                            : new Date(scrubTimestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })}
                        </Text>
                      )}
                      <View style={styles.pillRow}>
                        {WINDOW_PILLS.map(({ label, window: w }) => {
                          const active = chartWindow === w;
                          return (
                            <Pressable
                              key={w}
                              onPress={() => handleWindowChange(w)}
                              style={[styles.pill, active && styles.pillActive]}
                            >
                              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          chartMode === 'line' ? 'Switch to candlestick chart' : 'Switch to line chart'
                        }
                        onPress={toggleChartMode}
                        hitSlop={8}
                        style={styles.chartToggle}
                      >
                        <MaterialCommunityIcons
                          name={chartMode === 'line' ? 'chart-timeline-variant' : 'pulse'}
                          size={22}
                          color={colors.actionBuy}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {/* Position card — only renders when user holds this asset */}
                  <PositionCard
                    holding={directHolding}
                    currentPrice={basePrice}
                    onShare={handleShareAsset}
                  />

                  {/* Tab bar */}
                  <View style={styles.tabBarContainer}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.tabBarScroll}
                      contentContainerStyle={styles.tabBarScrollContent}
                    >
                      {([
                        { key: 'sandwiches', label: 'Sandwiches' },
                        {
                          key: 'holders',
                          // Count rides on the label so the sheet advertises
                          // how many people are in before you tap through. Null
                          // while the count loads, and hidden at zero — a bare
                          // pair of brackets is noise, the tab says it either way.
                          label: 'Holders',
                          badge: holderCount || null,
                        },
                        { key: 'about', label: 'About' },
                      ] as { key: DetailTab; label: string; badge?: number | null }[]).map(
                        ({ key, label, badge }) => {
                        const active = activeTab === key;
                        return (
                          <Pressable
                            key={key}
                            onPress={() => setActiveTab(key)}
                            style={styles.tabBtn}
                            accessibilityRole="button"
                            accessibilityLabel={badge ? `${label}, ${badge}` : label}
                          >
                            <Text style={active ? styles.tabLabelActive : styles.tabLabel}>
                              {label}
                              {/* Nested so the count inherits the tab's own size,
                                  weight and colour, and grows with it on selection. */}
                              {badge ? (
                                <Text style={styles.tabCount}>
                                  {' '}({badge > 99 ? '99+' : badge})
                                </Text>
                              ) : null}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <LinearGradient
                      colors={[`${sheetColors.background}00`, sheetColors.background]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.tabBarFade}
                      pointerEvents="none"
                    />
                  </View>

                  {/* Tab content — scrolls with everything else */}
                  <View style={styles.tabContent}>
                    {activeTab === 'about' ? (
                      <View style={{ gap: 22 }}>
                        <ProfileSection profile={assetDetail?.profile ?? null} />
                        <EquitySection equity={equityInfo} />
                        <AboutSection description={assetDetail?.description ?? null} />
                      </View>
                    ) : activeTab === 'sandwiches' ? (
                      <SandwichesSection
                        sandwiches={relatedSandwiches}
                        loading={sandwichesLoading}
                        symbol={displaySymbol}
                        checkIsSaved={(type, id) => isSaved(type, id)}
                        onToggleSave={async (type, id) => { await toggleSave(type, id); }}
                        canSave={canSave}
                        onOpenSandwich={handleOpenSandwich}
                      />
                    ) : (
                      <HoldersSection
                        holders={holders}
                        loading={holdersLoading}
                        symbol={displaySymbol}
                        onOpenHolder={handleOpenHolder}
                      />
                    )}
                  </View>
                </DetailScrollView>
              </View>
            )}

            {/* `hideEmbeddedActions` hosts own the action themselves, outside
                this clipped surface — rendering it here too stacks a second
                BUY under theirs, and keeps offering one on a leg whose host
                deliberately withheld it (a short with no live perp market). */}
            {stock && marketMode === 'spot' && !(embeddedStock && hideEmbeddedActions) ? (
              <View style={styles.fixedBottomBarHost} pointerEvents="box-none">
                {!useGlass ? (
                  <LinearGradient
                    colors={[`${sheetColors.background}00`, sheetColors.background]}
                    locations={[0, 0.55]}
                    style={styles.fixedBottomFade}
                    pointerEvents="none"
                  />
                ) : null}
                {/* No background bar on iOS — the BUY button is a floating
                    Liquid Glass pill that refracts the content behind it. */}
                <View style={[styles.fixedBottomBar, useGlass && { backgroundColor: 'transparent' }]}>
                  {/* Bottom bar always shows BUY; the "Add cash" handoff now lives
                      on the buy dialpad (see tradeEngine.onRequestAddCash). */}
                  <StockTradeActions
                    stockMint={stock.id}
                    stockSymbol={displaySymbol}
                    onTrade={openTradeSheet}
                    hasPosition={allowSell && tradeEngine.hasSellableBalance}
                    disableGlass={!useGlass}
                  />
                </View>
              </View>
            ) : null}
          </Reanimated.View>

          {tradeSheetOpen ? (
            <>
              <Reanimated.View style={[styles.tradeSheetBackdrop, tradeBackdropStyle]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close trade sheet"
                  onPress={closeTradeSheet}
                  style={StyleSheet.absoluteFill}
                />
              </Reanimated.View>
              <Reanimated.View style={[styles.tradeSheetOverlay, tradeOverlayStyle]}>
                {/* Liquid Glass surface — the chart and the detail sheet stay
                    visible, refracting, behind the dialpad. Pinned light because
                    the pad's own palette is hardcoded light. */}
                <GlassSheetSurface
                  topRadius={STOCK_SHEET_TOP_RADIUS}
                  forceScheme={isDark ? 'dark' : 'light'}
                  // Opaque, unlike the modal pad's 28% scrim: this overlay
                  // animates its own opacity on open, and a native GlassView
                  // inside an animated-opacity layer paints nothing — leaving
                  // the keypad sitting on bare chart and news text, with the
                  // detail's own header ghosting through the pad's. The scrim
                  // is the surface here; glass only adds sheen on top.
                  scrimColor={isDark ? TRADE_PAD_SURFACE_DARK : TRADE_PAD_SURFACE}
                />
                <GestureDetector gesture={tradeDismissPan}>
                  <View style={styles.tradeSheetDragArea}>
                    <View style={styles.tradeSheetHandleHit}>
                      <View style={styles.tradeSheetHandle} />
                    </View>
                    {notificationTweetUrl ? <NotificationTweet url={notificationTweetUrl} compact /> : null}
                    <TradeAmountPad
                  side={tradeEngine.side}
                  symbol={displaySymbol}
                  icon={selectedIcon}
                  subtitleLabel={stock?.mcap != null ? `${formatCompactUSD(stock.mcap)} MC` : null}
                  priceLabel={selectedPrice == null ? null : formatPrice(selectedPrice)}
                  priceLoading={selectedPrice == null}
                  changeLabel={formatPercent(selectedChange)}
                  changePositive={(selectedChange ?? 0) >= 0}
                  presets={tradeEngine.side === 'sell' ? ['25%', '50%', 'Max'] : ['10', '25', '50', 'Max']}
                  amountUnitSymbol={tradeEngine.amountUnitSymbol}
                  amountUnitLabel={tradeEngine.amountUnitLabel}
                  availableLabel={tradeEngine.availableLabel}
                  amount={tradeEngine.amount}
                  message={tradeEngine.message}
                  submitting={tradeEngine.submitting}
                  canConfirm={tradeEngine.canConfirm}
                  confirmLabel={tradeEngine.confirmLabel}
                  detailRows={tradeEngine.detailRows}
                  slideToConfirm
                  addCash={tradeEngine.needsCash}
                  onSubmit={tradeEngine.onSubmit}
                  onSubmitPressIn={tradeEngine.onSubmitPressIn}
                  onTapDigit={tradeEngine.tapDigit}
                  onTapPreset={tradeEngine.tapPreset}
                  previewContent={
                    <TradeQuotePreviewRow
                      preview={tradeEngine.quotePreview.preview}
                      loading={tradeEngine.quotePreview.loading}
                      // The price of the token the trade actually moves, NOT the
                      // header's. The header shows the listed share and follows
                      // the chart scrub, so valuing a fill with it reported the
                      // wrapper-vs-share gap (and any scrubbed历 price) as if it
                      // were profit — a $5 buy printed "≈ $5.18" — and moved
                      // with the scrub while the user dragged the chart.
                      unitPriceUsd={tradeEngine.unitPriceUsd}
                    />
                  }
                  noticeText={tradeNotice}
                  noticeActionLabel={showOndoHoursLink ? 'Learn more' : null}
                  onNoticeAction={showOndoHoursLink ? handleOpenOndoHours : undefined}
                  // Keep the amount/header area fixed — the flex layout already
                  // sizes it to fit, so scrolling only lets the center drift/bounce
                  // when tapped. See [[bottom-sheet-present-pattern]].
                  scrollEnabled={false}
                    />
                  </View>
                </GestureDetector>
              </Reanimated.View>
            </>
          ) : null}
    </View>
  );

  // Keep both venue surfaces mounted after the perp market is selected. The
  // previous conditional replaced the entire detail subtree, which reset the
  // header/chart/tabs and made an in-place venue change look like navigation.
  // These layers preserve component identity (and each chart's own state); the
  // toggle now changes only visibility and interaction ownership.
  const sheetContents = (
    <View style={styles.marketModeStack}>
      <View
        style={[styles.marketModeLayer, marketMode !== 'spot' && styles.marketModeLayerHidden]}
        pointerEvents={marketMode === 'spot' ? 'auto' : 'none'}
        accessibilityElementsHidden={marketMode !== 'spot'}
        importantForAccessibility={marketMode === 'spot' ? 'auto' : 'no-hide-descendants'}
      >
        {spotSheetContents}
      </View>

      {activePerpMarket ? (
        <View
          style={[
            styles.marketModeLayer,
            styles.marketModeLayerOverlay,
            marketMode !== 'perp' && styles.marketModeLayerHidden,
          ]}
          pointerEvents={marketMode === 'perp' ? 'auto' : 'none'}
          accessibilityElementsHidden={marketMode !== 'perp'}
          importantForAccessibility={marketMode === 'perp' ? 'auto' : 'no-hide-descendants'}
        >
          <PhoenixMarketDetailSheet
            ref={perpSheetRef}
            embeddedMarket={activePerpMarket}
            notificationTweetUrl={notificationTweetUrl}
            embeddedActionBar={hoistActions ? 'hoisted' : 'inline'}
            embeddedScrollY={perpScrollY}
            embeddedChartGestureActive={embeddedChartGestureActive}
            embeddedTopInset={embeddedTopInset}
            embeddedTogglePinned={embeddedToggleTop != null}
            onEmbeddedActionStateChange={onEmbeddedPerpActionStateChange}
            onEmbeddedQuoteChange={perpQuoteStore.set}
            embeddedIconUri={selectedIcon}
            embeddedWallet={solanaWallet.wallets?.[0] ?? null}
            embeddedInitialSide={perpInitialSide}
            // Keep the fallback only while the host is morphing. Once settled,
            // the order ticket and its SL/TP editor use the same native Liquid
            // Glass buttons as the hoisted action bar.
            embeddedDisableGlass={!useGlass}
            embeddedAutoOpenOrder={perpAutoOpenOrder}
            onEmbeddedOverlayOpenChange={setPerpOverlayOpen}
            onEmbeddedAddCash={handleAddCash}
            // Read here, not in there: the perp view is portaled above
            // WalletStoreProvider and would see $0. See its prop docs.
            embeddedCashUsd={cash.idleUsdc}
            onEmbeddedCashRefresh={() => cash.refresh(true)}
            embeddedActiveTab={activeTab}
            onEmbeddedTabChange={setActiveTab}
            embeddedHolderCount={perpHolderCount}
            embeddedHoldersContent={
              <PerpHoldersSection
                holders={perpHolders}
                loading={perpHoldersLoading}
                symbol={headerSymbol}
                onOpenHolder={handleOpenHolder}
              />
            }
            embeddedSandwichesContent={
              <SandwichesSection
                sandwiches={relatedSandwiches}
                loading={sandwichesLoading}
                symbol={headerSymbol}
                checkIsSaved={(type, id) => isSaved(type, id)}
                onToggleSave={async (type, id) => { await toggleSave(type, id); }}
                canSave={canSave}
                onOpenSandwich={handleOpenSandwich}
              />
            }
          />
        </View>
      ) : null}

      {stock && !tradeOverlayOpen ? (
        <Reanimated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.compactHeader,
            { top: embeddedToggleTop ?? 4 + embeddedTopInset },
            compactHeaderStyle,
          ]}
        >
          {/* Identity is centred on the screen, like a navigation title; the
              quote rides the right edge. */}
          <View style={styles.compactHeaderIdentity}>
            <AssetLogo
              uri={selectedIcon}
              fallbackUris={selectedIconFallbackUris}
              size={27}
              borderRadius={14}
              backgroundColor="transparent"
              fallback={
                <View style={styles.compactHeaderFallback}>
                  <Text style={styles.compactHeaderFallbackText}>{displayName.slice(0, 1)}</Text>
                </View>
              }
            />
            <Text style={styles.compactHeaderTitle} numberOfLines={1} ellipsizeMode="tail">
              {displayName || headerSymbol}
            </Text>
          </View>
          <CompactQuote
            perpStore={perpQuoteStore}
            perp={marketMode === 'perp'}
            spotPrice={selectedPrice ?? null}
            spotChange={selectedChange ?? null}
            styles={styles}
            colors={colors}
          />
        </Reanimated.View>
      ) : null}

      {canToggleMarket ? (
        // Stays mounted while a ticket is raised over the asset — the toggle
        // belongs to the market underneath, not to the ticket, so it hides
        // rather than unmounting and re-running its layout when that closes.
        // Both tickets count: the perp card AND the spot buy/sell dialpad. The
        // dialpad is an in-sheet overlay rather than its own modal, so nothing
        // covers the toggle for it — it used to float over the keypad, where
        // switching market mid-order is not an action anyone means to take.
        <MarketToggleOverlay
          scrollY={scrollY}
          perpScrollY={perpScrollY}
          marketMode={marketMode}
          tradeOverlayOpen={tradeOverlayOpen}
          fadeEnd={COMPACT_HEADER_START}
          top={embeddedToggleTop ?? MARKET_TOGGLE_TOP + embeddedTopInset}
          style={styles.marketModeToggleOverlay}
          onChange={handleMarketModeChange}
        />
      ) : null}
    </View>
  );

  return (
    <>
      {embeddedStock ? (
        <View style={styles.embeddedSheetSurface}>{sheetContents}</View>
      ) : (
        <BottomSheetModal
          ref={sheetRef}
          name="stock-detail-sheet"
          index={0}
          snapPoints={snapPoints}
          enableDynamicSizing={false}
          animateOnMount={shouldAnimateOnMount}
          // While the in-sheet trade overlay is open, a downward swipe must
          // close only that overlay, not dismiss the stock-detail modal. The
          // spot pad earns that by owning a pan over its whole card, which — as
          // a descendant gesture — wins over the sheet's content pan.
          //
          // These two flags must NEVER be driven by the perp order ticket.
          // Toggling them re-creates gorhom's content-pan gesture, and the
          // GestureDetector wrapping every child of the sheet then rebuilds its
          // subtree: everything inside the modal is UNMOUNTED and remounted.
          // Parent-owned state (the spot pad) survives that, but the perp view
          // keeps its own state, so it came back blank — the ticket vanished a
          // frame after LONG/SHORT opened it and the bar fell back to
          // a stale footer state while the fresh instance re-read the account.
          // The perp ticket owns a manual downward pan over its whole card; see
          // `orderDismissPan` in phoenix-market-detail-sheet. The perp market
          // itself also owns pinch, horizontal pan, crosshair and scale drags,
          // so while that venue is visible the explicit Back action is the
          // modal's dismissal path and the sheet cannot steal chart touches.
          enablePanDownToClose={!tradeSheetOpen && marketMode !== 'perp'}
          enableContentPanningGesture={!tradeSheetOpen && marketMode !== 'perp'}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          animatedIndex={animatedIndex}
          backdropComponent={renderBackdrop}
          handleComponent={null}
          style={styles.sheetSurface}
          backgroundStyle={styles.sheetBackground}
          onChange={(index) => {
            isOpenRef.current = index >= 0;
            if (index === 0) sheetRef.current?.snapToIndex(0);
          }}
          onDismiss={() => {
            isOpenRef.current = false;
            hideTradeSheetImmediately();
            perpSpotRequestIdRef.current += 1;
            setStock(null);
            setMarketMode('spot');
            setSelectedPerpMarket(null);
            setAllowSell(false);
            setPositionPnlPositive(null);
            setPositionSnapshot(null);
            onClose?.();
          }}
        >
          {sheetContents}
        </BottomSheetModal>
      )}
      <DepositSheet
        ref={depositSheetRef}
        walletAddress={depositWalletAddress}
        onCheckout={async () => {}}
      />
      <BuySuccessSheet
        visible={buySuccess.visible}
        loading={buySuccess.loading}
        amount={buySuccess.amount}
        assetName={buySuccess.assetName}
        assetSymbol={buySuccess.assetSymbol}
        assetIcon={buySuccess.assetIcon}
        side={buySuccess.side}
        realizedPnlUsd={buySuccess.realizedPnlUsd}
        realizedPnlPct={buySuccess.realizedPnlPct}
        onShare={handleShareBuySuccess}
        onClose={handleCloseBuySuccess}
        contentHidden={sharingTrade}
      >
        <TradeShareSheet
          ref={tradeShareRef}
          onDismiss={() => setSharingTrade(false)}
        />
      </BuySuccessSheet>
      <AssetShareSheet ref={assetShareRef} />
    </>
  );
});

const makeStyles = (c: ThemeColors) => {
  const sheetColors = getSheetColors(c);
  return StyleSheet.create({
    contentContainer: {
      paddingHorizontal: 16,
      paddingTop: 24,
      paddingBottom: 100,
      gap: 12,
    },
    sheetBackground: {
      backgroundColor: sheetColors.background,
      borderTopLeftRadius: STOCK_SHEET_TOP_RADIUS,
      borderTopRightRadius: STOCK_SHEET_TOP_RADIUS,
      overflow: 'hidden',
    },
    sheetSurface: {
      borderTopLeftRadius: STOCK_SHEET_TOP_RADIUS,
      borderTopRightRadius: STOCK_SHEET_TOP_RADIUS,
      overflow: 'hidden',
    },
    embeddedSheetSurface: {
      flex: 1,
      overflow: 'hidden',
      backgroundColor: sheetColors.background,
    },
    marketModeStack: {
      flex: 1,
      overflow: 'hidden',
    },
    marketModeLayer: {
      flex: 1,
    },
    marketModeLayerOverlay: {
      ...StyleSheet.absoluteFillObject,
    },
    marketModeLayerHidden: {
      // Keep each native GestureDetector attached while the other venue is on
      // screen. `display:none` removes it from the native hierarchy; restoring
      // the Spot layer could leave LineChart's scrub recognizer detached on
      // iOS. The owner already switches pointerEvents and accessibility, so an
      // invisible layer cannot intercept touches.
      opacity: 0,
    },
    compactHeader: {
      position: 'absolute',
      left: 16,
      right: 26,
      minHeight: 44,
      zIndex: 35,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    // Spans the full header and centres itself, so the logo + name sit on the
    // screen's midline regardless of the quote's width. The insets keep a long
    // name clear of the back button and the price.
    compactHeaderIdentity: {
      position: 'absolute',
      left: COMPACT_IDENTITY_INSET,
      right: COMPACT_IDENTITY_INSET - 10,
      top: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    compactHeaderTitle: {
      flexShrink: 1,
      color: c.text,
      fontFamily: F,
      fontSize: 15,
      fontWeight: '900',
    },
    compactHeaderPrice: {
      flexShrink: 0,
      color: c.text,
      fontWeight: '900',
      textAlign: 'right',
    },
    compactHeaderQuote: {
      flexShrink: 0,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    compactHeaderChange: {
      marginTop: -1,
      fontFamily: Fonts.displayMedium,
      fontSize: 12,
      lineHeight: 14,
      fontWeight: '800',
      textAlign: 'right',
    },
    compactHeaderFallback: {
      width: 27,
      height: 27,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.text,
    },
    compactHeaderFallbackText: {
      color: c.textInverse,
      fontFamily: F,
      fontSize: 12,
      fontWeight: '800',
    },
    marketModeToggleOverlay: {
      position: 'absolute',
      top: MARKET_TOGGLE_TOP,
      right: MARKET_TOGGLE_RIGHT,
      zIndex: 30,
    },
    sheetScrollView: {
      backgroundColor: sheetColors.background,
    },
    stockSheetHost: {
      flex: 1,
    },
    stockContentLayer: {
      flex: 1,
      overflow: 'hidden',
    },
    sheetBody: {
      flex: 1,
      paddingHorizontal: 16,
      paddingTop: 24,
    },
    scrollingHeader: {
      gap: 12,
      paddingBottom: 4,
    },
    unifiedScroll: {
      flex: 1,
    },
    unifiedScrollContent: {
      paddingBottom: 120,
    },
    chartSection: {
      position: 'relative',
    },
    chartControlsWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      // The timeframes are centred under the chart they belong to. Both the
      // scrub date (left) and the line/candle switcher (right) are absolutely
      // placed so neither can pull the pills off that centre.
      justifyContent: 'center',
      marginTop: 0,
      paddingHorizontal: 4,
      position: 'relative',
    },
    chartToggle: {
      position: 'absolute',
      right: 4,
      width: 34,
      height: 32,
      borderRadius: 20,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabBarContainer: {
      position: 'relative',
      paddingTop: 10,
      paddingBottom: 0,
    },
    tabBarScroll: {
      overflow: 'visible',
    },
    tabBarScrollContent: {
      flexDirection: 'row',
      gap: 28,
      paddingLeft: 4,
      paddingRight: 60,
      alignItems: 'center',
    },
    tabBarFade: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 60,
    },
    tabBtn: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: 10,
    },
    // The holder count, set in brackets inside the tab label itself. It used to
    // be a filled pill, which read as a status chip — and on the active tab its
    // solid fill was the loudest thing in the row, louder than the label it was
    // annotating. Bracketed text says the same number and stays subordinate.
    // It inherits the label's colour as well as its size, so "Holders (2)"
    // reads as one word rather than a label with a greyed-out suffix.
    tabCount: {
      fontVariant: ['tabular-nums'],
    },
    tabLabel: {
      fontSize: 17,
      fontWeight: '800',
      fontFamily: F,
      color: c.textQuaternary,
      textTransform: 'capitalize',
    },
    tabLabelActive: {
      fontSize: 19,
      fontWeight: '900',
      fontFamily: F,
      color: c.text,
      textTransform: 'capitalize',
    },
    tabContent: {
      marginTop: 6,
      paddingBottom: 12,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 2,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    headerRight: {
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 2,
      marginBottom: 4,
    },
    marketTogglePlaceholder: {
      width: ASSET_MARKET_TOGGLE_WIDTH,
      height: ASSET_MARKET_TOGGLE_HEIGHT,
    },
    stickerOuter: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stickerInnerIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: sheetColors.surfaceAlt,
    },
    stickerInnerFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconFallbackText: {
      color: c.textInverse,
      fontWeight: '700',
      fontSize: 16,
    },
    symbol: {
      color: c.text,
      fontWeight: '800',
      fontSize: 20,
      lineHeight: 26,
      fontFamily: F,
    },
    name: {
      color: c.textTertiary,
      marginTop: -3,
      fontSize: 13,
      lineHeight: 16,
      fontWeight: '800',
      fontFamily: F,
      letterSpacing: 0.3,
    },
    priceText: {
      color: c.text,
      fontSize: 27,
      lineHeight: 34,
      fontWeight: '800',
      fontFamily: F,
      textAlign: 'right',
    },
    changeSkeleton: {
      marginTop: -6,
    },
    changeText: {
      marginTop: -6,
      fontSize: 16,
      lineHeight: 19,
      fontWeight: '800',
      fontFamily: Fonts.displayMedium,
      textAlign: 'right',
    },
    stateCard: {
      borderRadius: 16,
      padding: 12,
      backgroundColor: sheetColors.backgroundAlt,
    },
    stateTitle: {
      color: c.text,
      fontWeight: '800',
      fontSize: 13,
      fontFamily: F,
    },
    stateBody: {
      marginTop: 4,
      color: c.text,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: F,
    },
    fixedBottomBarHost: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    },
    fixedBottomFade: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      top: -60,
    },
    fixedBottomBar: {
      // Flush: <StockTradeActions> insets itself to the shared CTA margin, and
      // the bar matches that below so the BUY pill's corners stay concentric
      // with the display's.
      paddingHorizontal: 0,
      paddingTop: 10,
      paddingBottom: CTA.inset,
      backgroundColor: sheetColors.background,
    },
    tradeSheetBackdrop: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 20,
      // Deliberately light: the pad above it is glass, and a heavier dim would
      // leave the material nothing worth refracting.
      backgroundColor: 'rgba(15, 23, 42, 0.10)',
    },
    // A card, not a full-screen cover: anchored to the bottom at 90% of the
    // screen so the asset stays visible above it and the glass has an edge. Left
    // full-height, the pad spread its header, presets and keypad across the whole
    // display with the detail bleeding through the translucent surface between them.
    tradeSheetOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: TRADE_SHEET_HEIGHT,
      zIndex: 30,
      paddingHorizontal: 16,
      paddingBottom: 28,
      // Fill comes from <GlassSheetSurface> below, not a solid colour. No
      // overflow: 'hidden' here — that would kill the drop shadow on iOS; the
      // surface clips its own material to these corners instead.
      backgroundColor: 'transparent',
      borderTopLeftRadius: STOCK_SHEET_TOP_RADIUS,
      borderTopRightRadius: STOCK_SHEET_TOP_RADIUS,
      shadowColor: c.text,
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.08,
      shadowRadius: 18,
      elevation: 12,
    },
    tradeSheetDragArea: {
      // Fills the overlay so the whole sheet — handle, header and keypad — is a
      // drag-to-dismiss surface. The pan only claims the touch after a downward
      // drag (activeOffsetY), so keypad taps still work.
      flex: 1,
    },
    tradeSheetHandleHit: {
      alignSelf: 'stretch',
      alignItems: 'center',
      // Tall, full-width target so the swipe-to-dismiss gesture is easy to grab —
      // a thin strip here made the sheet feel like it couldn't be dragged.
      paddingTop: 14,
      paddingBottom: 22,
    },
    tradeSheetHandle: {
      width: 44,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: sheetColors.border,
    },
    pillRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
    },
    pill: {
      minHeight: 32,
      justifyContent: 'center',
    },
    pillActive: {},
    pillText: {
      fontSize: 14,
      fontWeight: '700',
      color: c.textQuaternary,
      fontFamily: F,
    },
    pillTextActive: {
      color: c.text,
      fontSize: 15,
      fontWeight: '900',
    },
    scrubTimeLabel: {
      position: 'absolute',
      left: 4,
      top: 0,
      fontSize: 13,
      fontWeight: '700',
      color: c.text,
      fontFamily: F,
    },
  });
};

const makeContentStyles = (c: ThemeColors) => {
  const sheetColors = getSheetColors(c);
  return StyleSheet.create({
    root: {
      gap: 8,
    },
    performanceCard: {
      borderRadius: 14,
      backgroundColor: sheetColors.backgroundAlt,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 12,
    },
    performanceLabel: {
      color: c.textTertiary,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
      fontFamily: F,
    },
    performanceGrid: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
    },
    performanceItem: {
      flex: 1,
      gap: 4,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: 8,
    },
    performanceItemActive: {
      backgroundColor: sheetColors.surfaceAlt,
    },
    performanceItemLabel: {
      color: c.textTertiary,
      fontSize: 11,
      fontWeight: '700',
      fontFamily: F,
    },
    performanceValue: {
      color: c.text,
      fontSize: 14,
      fontWeight: '800',
      fontFamily: Fonts.displayMedium,
      textAlign: 'center',
    },
    /* Latest News */
    newsCard: {
      paddingHorizontal: 2,
      paddingVertical: 12,
      gap: 8,
    },
    newsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    newsDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.actionSell,
    },
    newsHeaderLabel: {
      color: c.actionSell,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      fontFamily: F,
    },
    newsHeadline: {
      color: c.text,
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '600',
      fontFamily: F,
    },
    /* Shared */
    readMoreBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: sheetColors.border,
    },
    readMoreText: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      fontFamily: F,
    },
    aboutText: {
      color: c.text,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: '700',
      fontFamily: F,
      marginTop: 4,
    },
    aboutEmpty: {
      color: c.textTertiary,
      fontSize: 14,
      fontWeight: '600',
      fontFamily: F,
      marginTop: 16,
    },
    tabSpinner: {
      paddingTop: 32,
      alignItems: 'center',
    },
    newsRow: {
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: sheetColors.border,
    },
    /* Stat rows with a dotted leader between label and value */
    leaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingVertical: 11,
    },
    leaderLabel: {
      color: c.textTertiary,
      fontSize: 15,
      fontWeight: '600',
      fontFamily: F,
    },
    leaderDots: {
      flex: 1,
      marginHorizontal: 8,
      marginBottom: 5,
      borderBottomWidth: 1.5,
      borderStyle: 'dotted',
      borderColor: sheetColors.border,
    },
    leaderValue: {
      color: c.text,
      fontSize: 15,
      fontWeight: '800',
      fontFamily: F,
    },
    positionCard: {
      borderRadius: 15,
      backgroundColor: c.surfaceAlt,
      marginTop: 8,
      overflow: 'hidden',
    },
    positionSummary: {
      margin: 3,
      marginBottom: 0,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingTop: 11,
      paddingBottom: 10,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    positionHeadlineRow: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
    },
    positionValueGroup: {
      flex: 1,
      minWidth: 0,
      alignItems: 'flex-start',
    },
    positionValue: {
      color: c.text,
      fontSize: 17,
      lineHeight: 21,
      fontWeight: '900',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    positionPnlGroup: {
      flex: 1,
      minWidth: 0,
      alignItems: 'flex-end',
    },
    positionPnl: {
      fontSize: 17,
      lineHeight: 21,
      fontFamily: Fonts.displayOne,
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    positionPctRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    positionPct: {
      ...POSITION_SUPPORTING_TEXT,
      color: c.text,
      fontSize: 12,
      lineHeight: 15,
      fontVariant: ['tabular-nums'],
    },
    positionPrices: {
      // Was spaced by the dotted divider that used to sit above this row.
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    positionPriceGroup: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 5,
    },
    positionPriceGroupRight: {
      justifyContent: 'flex-end',
    },
    positionPriceLabel: {
      ...POSITION_SUPPORTING_TEXT,
      color: c.text,
      fontSize: 11,
      lineHeight: 15,
    },
    positionPriceValue: {
      ...POSITION_SUPPORTING_TEXT,
      color: c.text,
      flexShrink: 1,
      fontSize: 12,
      lineHeight: 16,
      fontVariant: ['tabular-nums'],
    },
    positionShare: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingHorizontal: 10,
    },
    positionSharePressed: {
      opacity: 0.62,
    },
    positionShareIcon: {
      opacity: POSITION_SUPPORTING_TEXT.opacity,
      transform: [{ translateY: -1 }],
    },
    positionShareText: {
      ...POSITION_SUPPORTING_TEXT,
      color: c.text,
      fontSize: 13,
      lineHeight: 17,
    },
    /* Holders tab */
    holderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
    },
    holderRowPressed: {
      opacity: 0.6,
    },
    holderAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: sheetColors.surfaceAlt,
    },
    holderAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    holderAvatarText: {
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '800',
      fontFamily: F,
    },
    holderIdentity: {
      flex: 1,
      minWidth: 0,
    },
    holderNameRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    holderAt: {
      color: c.textTertiary,
      opacity: 0.58,
      fontSize: 15,
      fontWeight: '800',
      fontFamily: F,
    },
    holderName: {
      flexShrink: 1,
      color: c.text,
      fontSize: 15,
      fontWeight: '800',
      fontFamily: F,
    },
    holderHandle: {
      marginTop: 1,
      color: c.textTertiary,
      fontSize: 12,
      fontWeight: '600',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    holderAmounts: {
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    holderValue: {
      color: c.text,
      fontSize: 15,
      fontWeight: '800',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
    holderPnl: {
      marginTop: 1,
      fontSize: 12,
      fontWeight: '800',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
    },
  });
};
