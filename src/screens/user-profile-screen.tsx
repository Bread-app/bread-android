import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import {
  followUser,
  getFollowers,
  getSandwichById,
  getSandwichShareUrl,
  getSandwiches,
  getStockById,
  getUserClosedPositions,
  getUserHoldings,
  getUserTakes,
  getUserPnlHistory,
  getUserProfile,
  getUserSandwichPositions,
  setCardLike,
  unfollowUser,
  type AppUserPayload,
  type ClosedPosition,
  type EnrichedHolding,
  type PositionTake,
  type PnlHistory,
  type PublicSandwichHolding,
  type PortfolioRange,
  type Sandwich,
  type SocialUser,
  type Stock,
} from '@/lib/api';
import { Fonts, type ThemeColors } from '@/constants/theme';
import {
  HoldingsCategorySwitch,
  type HoldingsCategoryFilter,
  type HoldingsCategoryKey,
} from '@/components/holdings-category-switch';
import { LoadErrorState } from '@/components/load-error-state';
import { PublicSandwichHoldingCard } from '@/components/sandwich-holding-card';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { cardSocial, toggledCardSocial, withCardSocial } from '@/lib/card-social';
import { getAnonymousSocialId } from '@/lib/social-identity';
import { useSandwichDetail } from '@/lib/sandwich-detail-store';
import { NATIVE_ZOOM_SPIKE } from '@/lib/native-zoom';
import type { PodcastGroupVideo } from '@/components/podcast-sandwich-group-card';
import { usePodcastGroup, type PodcastGroup } from '@/lib/podcast-group-store';
import {
  getPhoenixMarket,
  getUserPerpPositions,
  type PublicPerpPosition,
} from '@/lib/phoenix-api';
import { perpLogoSources } from '@/lib/stock-logos';
import { AssetLogo } from '@/components/asset-logo';
import { ClosedPositionRow } from '@/components/closed-position-row';
import { FollowButton } from '@/components/follow-button';
import { IosSegmentedControl } from '@/components/ios-segmented-control';
import { PnlChart } from '@/components/portfolio-value-chart';
import { SandwichShareSheet, type SandwichShareSheetRef } from '@/components/sandwich-share-sheet';
import { StockDetailSheet, type StockDetailSheetRef } from '@/components/stock-detail-sheet';
import { ValueSkeleton, ValueSkeletonLine } from '@/components/value-skeleton';
import { VerifiedBadge } from '@/components/verified-badge';
import { PodcastGroupCard, SandwichCard, TakePostCard } from '@/components/sandwich-card';
import { buildFeedItems, type FeedItem } from '@/lib/sandwich-feed';
import { formatPnlPercentage, formatSignedPnlPercentage, pnlPercentageFromBasis } from '@/lib/pnl-percentage';
import { PressableScale } from '@/components/pressable-scale';
import {
  PositionDetailSheet,
  type FocusedPositionData,
  type PositionDetailSheetRef,
} from '@/components/position-detail-sheet';
import {
  PositionShareSheet,
  type PositionShareSheetRef,
} from '@/components/position-share-sheet';
import {
  publicClosedPositionDetail,
  viewedPositionFromHolding,
} from '@/lib/public-position-detail';

const F = Fonts.rounded;

const COLOR_UP = '#02ED45';
const COLOR_DOWN = '#FF1AB8';
const RANGES: PortfolioRange[] = ['24H', '7d', '30d'];

type Tab = 'holdings' | 'sandwiches';

/**
 * A row in the Holdings tab. Perp positions share the list with spot holdings
 * but are never mixed into it — they carry their own kind and sit above a
 * labelled divider, because a leveraged position and an owned token are not the
 * same claim and must not read as one.
 */
type HoldingsCategory = HoldingsCategoryKey;

type HoldingsRow =
  | { kind: 'sandwich'; position: PublicSandwichHolding }
  | { kind: 'perp'; position: PublicPerpPosition }
  | { kind: 'holding'; holding: EnrichedHolding }
  | { kind: 'closed'; position: ClosedPosition };

/**
 * A take, interleaved with the Posts tab. `takeRow`, not `take`: the feed already uses `take`
 * for its card shape, and one discriminant meaning two things is a switch
 * waiting to render the wrong component.
 */
type TakeListRow = { kind: 'takeRow'; take: PositionTake };

type ProfileListItem = HoldingsRow | FeedItem | TakeListRow | { kind: 'profileTabs' };

/** The two halves of Holdings — the same toggle the own profile carries. */
const HOLDINGS_VIEWS = ['Open', 'Closed'] as const;

type HoldingsView = (typeof HOLDINGS_VIEWS)[number];

/**
 * Which drawer a settled position belongs in.
 *
 * The same three drawers the open list uses: a Sandwich this user closed sits
 * where that Sandwich sat, so the toggle changes what the list contains rather
 * than how it is organised.
 */
function closedCategory(position: ClosedPosition): HoldingsCategory {
  if (position.kind === 'token') return 'tokens';
  if (position.kind === 'phoenix_perp' || position.kind === 'sandwich_perp') return 'perps';
  return 'sandwiches';
}

type Props = {
  visible: boolean;
  onClose: () => void;
  targetPrivyUserId: string;
  viewerPrivyUserId: string | null;
  viewerPayload: AppUserPayload | null;
};

function formatUsd(value: number | null): string {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}


function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatJoinedDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function followedByLabel(followedBy: SocialUser['followedBy']): string | null {
  if (!followedBy || followedBy.count <= 0) return null;
  if (followedBy.sample.length === 0) return `followed by ${followedBy.count}`;
  const extra = followedBy.count - followedBy.sample.length;
  const names = followedBy.sample.join(', ');
  return extra > 0 ? `followed by ${names} +${extra}` : `followed by ${names}`;
}

function Avatar({ avatarUrl, size = 56 }: { avatarUrl: string | null; name?: string | null; size?: number }) {
  const { colors } = useThemeStore();
  const radius = size / 2;
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surfaceAlt }} />;
  }
  // Neutral default profile picture (person glyph) — no per-user color.
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="person" size={size * 0.5} color={colors.textTertiary} />
    </View>
  );
}

function Stat({ count, label }: { count: number; label: string }) {
  const styles = useThemedStyles(makeStyles);
  // Briefly pop the number when it changes so the follow-toggle registers here
  // too — the button flipped instantly, the count should acknowledge (Emil:
  // state indication). No animation on initial mount (prev === count).
  const scale = useSharedValue(1);
  const prev = useRef(count);
  useEffect(() => {
    if (prev.current === count) return;
    prev.current = count;
    scale.value = withSequence(
      withSpring(1.12, { damping: 8, stiffness: 380, mass: 0.6 }),
      withSpring(1, { damping: 16, stiffness: 260, mass: 0.6 }),
    );
  }, [count, scale]);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <View style={styles.statItem}>
      <Animated.Text style={[styles.statCount, animStyle]}>{formatCount(count)}</Animated.Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StockHoldingRow({ holding, onPress }: { holding: EnrichedHolding; onPress: (stock: Stock) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { stock, valueUsd, pnlPct } = holding;
  const tintColor = pnlPct == null
    ? colors.textTertiary
    : pnlPct >= 0 ? COLOR_UP : COLOR_DOWN;
  const pnlLabel = formatPnlPercentage(pnlPct);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Open ${stock.name} details`}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress(stock);
      }}
      style={styles.holdingRow}>
      <AssetLogo
        uri={stock.icon}
        size={40}
        borderRadius={20}
        backgroundColor={colors.surfaceAlt}
        fallback={
          <View style={styles.holdingIconFallback}>
            <Text style={styles.holdingIconFallbackText}>{(stock.symbol ?? stock.name).slice(0, 1).toUpperCase()}</Text>
          </View>
        }
      />
      <View style={styles.holdingInfo}>
        <Text style={styles.holdingName} numberOfLines={1}>{stock.name}</Text>
        {/* The ticker is the sub-line, as on the own profile — the unit price
            duplicated a number the value column already carries. */}
        {stock.symbol ? (
          <Text style={styles.holdingSub} numberOfLines={1}>
            {stock.symbol}
          </Text>
        ) : null}
      </View>
      <View style={styles.holdingRight}>
        <Text style={styles.holdingValue}>{formatUsd(valueUsd)}</Text>
        {pnlLabel != null ? (
          <Text style={[styles.holdingChange, { color: tintColor }]} numberOfLines={1}>
            {pnlLabel}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

/**
 * One Sandwich this user still has on, read-only.
 *
 * The value column is what the basket is worth now over its return percentage,
 * mirroring the token rows below it. A null value is a dash, never a zero: the
 * server refuses to mark a basket it cannot price every leg of, and an
 * unpriceable basket is unknown, not worthless.
 */
function PerpPositionRow({
  position,
  onPress,
}: {
  position: PublicPerpPosition;
  onPress: (position: PublicPerpPosition) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const symbol = position.symbol.trim().toUpperCase();
  const short = position.positionSize < 0;
  const displayName = position.name?.trim() || symbol;
  const pnlColor = position.unrealizedPnl >= 0 ? COLOR_UP : COLOR_DOWN;
  const entryNotional = Math.abs(position.positionSize * position.entryPrice);
  const pnlLabel = formatPnlPercentage(
    pnlPercentageFromBasis(position.unrealizedPnl, entryNotional),
  );
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${displayName} ${short ? 'short' : 'long'} position, ${formatUsd(
        Math.abs(position.positionValue),
      )}`}
      accessibilityHint="Opens this market"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress(position);
      }}
      style={styles.holdingRow}
    >
      <AssetLogo
        {...perpLogoSources(position)}
        size={40}
        borderRadius={20}
        backgroundColor={colors.surfaceAlt}
        fallback={
          <View style={styles.holdingIconFallback}>
            <Text style={styles.holdingIconFallbackText}>
              {displayName.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        }
      />
      <View style={styles.holdingInfo}>
        <Text style={styles.holdingName} numberOfLines={1}>{displayName}</Text>
        {/* Direction in the display face the own profile's perp rows use. The
            public payload carries no leverage, so there is no multiplier. */}
        <Text
          style={[styles.holdingSide, { color: short ? COLOR_DOWN : COLOR_UP }]}
          numberOfLines={1}
        >
          {short ? 'SHORT' : 'LONG'}
        </Text>
      </View>
      <View style={styles.holdingRight}>
        <Text style={styles.holdingValue}>{formatUsd(Math.abs(position.positionValue))}</Text>
        {pnlLabel ? (
          <Text style={[styles.holdingChange, { color: pnlColor }]} numberOfLines={1}>
            {pnlLabel}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

/**
 * Opens another user's profile as a real stack screen (`/user-profile`).
 *
 * Kept with its old modal-style props so every host stays unchanged: when a
 * host flips `visible`, this pushes the route and hands the flag straight back.
 *
 * It used to BE a native <Modal>, which sits above the navigator — so nothing
 * could be pushed on top of it. Opening a position had to push the Sandwich
 * screen underneath and close the profile, which flashed whatever screen the
 * profile was opened from (search, a feed) and left Back with no profile to
 * return to. As a route, the Sandwich screen stacks on it like anywhere else.
 */
export function UserProfileScreen({ visible, onClose, targetPrivyUserId }: Props) {
  const router = useRouter();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!visible) return;
    router.push({ pathname: '/user-profile', params: { id: targetPrivyUserId } });
    onCloseRef.current();
  }, [router, targetPrivyUserId, visible]);
  return null;
}

/** The `/user-profile` route's body. */
export function UserProfileRouteScreen({
  targetPrivyUserId,
  viewerPrivyUserId,
  viewerPayload,
}: Pick<Props, 'targetPrivyUserId' | 'viewerPrivyUserId' | 'viewerPayload'>) {
  const router = useRouter();
  const onClose = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);
  return (
    <UserProfileView
      asRoute
      visible
      onClose={onClose}
      targetPrivyUserId={targetPrivyUserId}
      viewerPrivyUserId={viewerPrivyUserId}
      viewerPayload={viewerPayload}
    />
  );
}

function UserProfileView({
  visible,
  onClose,
  targetPrivyUserId,
  viewerPrivyUserId,
  viewerPayload,
  asRoute = false,
}: Props & { asRoute?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const screenWidth = Dimensions.get('window').width;
  const [closingForNativeZoom, setClosingForNativeZoom] = useState(false);
  // Horizontal translate for the interactive swipe-right-to-dismiss gesture.
  // Reset to 0 whenever the modal re-opens so it doesn't remember prior state.
  const dragX = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      dragX.value = 0;
      setClosingForNativeZoom(false);
    }
  }, [visible, dragX]);
  const commitDismissHaptic = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);
  const swipeToDismiss = Gesture.Pan()
    // A route gets the native edge-swipe back gesture instead.
    .enabled(!asRoute)
    .activeOffsetX(10)
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      if (e.translationX >= 0) {
        // 1:1 tracking on the forward direction (Apple §2 direct manipulation).
        dragX.value = e.translationX;
      } else {
        // Rubber-band leftward drag so there's no hard wall — signals
        // "this direction has nowhere to go" without freezing the interface
        // (Apple §9). Formula from the WWDC 2018 Fluid Interfaces sample.
        const overshoot = -e.translationX;
        const damped = (overshoot * screenWidth * 0.55) / (screenWidth + 0.55 * overshoot);
        dragX.value = -damped;
      }
    })
    .onEnd((e) => {
      // Apple momentum projection (WWDC 2018): decide dismiss vs. cancel based
      // on where a decelerating gesture would come to rest, not where the
      // finger currently is. Unifies distance + velocity into one rule.
      const decel = 0.998;
      const projected = e.translationX + (e.velocityX / 1000) * (decel / (1 - decel));
      const shouldDismiss = projected > screenWidth * 0.4;
      if (shouldDismiss) {
        // Haptic on the causal moment (Apple §13 harmony), not after the
        // animation resolves.
        runOnJS(commitDismissHaptic)();
        dragX.value = withSpring(
          screenWidth,
          {
            // Velocity handoff (Apple §5) — spring inherits finger velocity.
            velocity: e.velocityX,
            damping: 22,
            stiffness: 210,
            mass: 1,
          },
          (finished) => {
            if (finished) runOnJS(onClose)();
          },
        );
      } else {
        dragX.value = withSpring(0, {
          velocity: e.velocityX,
          damping: 26,
          stiffness: 280,
          mass: 1,
        });
      }
    });
  const shellStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
    opacity: interpolate(dragX.value, [0, screenWidth], [1, 0.6], Extrapolation.CLAMP),
  }));
  const [profile, setProfile] = useState<SocialUser | null>(null);
  // Faces for the "followed by" line. The profile payload carries names only,
  // so the mutuals are picked out of the followers list: the ones the viewer
  // follows, matched to the sample the server named.
  const [followedByUsers, setFollowedByUsers] = useState<SocialUser[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [holdings, setHoldings] = useState<EnrichedHolding[]>([]);
  /** This user's latest take per sandwich, shown as a quote on the holding card. */
  const [userTakes, setUserTakes] = useState<Record<string, PositionTake>>({});
  /** Every take, newest first, for the Takes tab. Null until the read answers. */
  const [userTakeList, setUserTakeList] = useState<PositionTake[] | null>(null);
  // SOL is included in these rows; stablecoin cash remains off the public
  // holdings list, just as it does in the own-profile Open view.
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  // A failed read is NOT an empty portfolio. The holdings endpoint now errors
  // rather than answering "[]" when it can't read the chain, so the UI has to
  // tell the two apart — "No holdings yet" about someone who holds plenty is
  // exactly the kind of wrong data this screen must never show.
  const [holdingsFailed, setHoldingsFailed] = useState(false);
  const [history, setHistory] = useState<PnlHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Portfolio value at the start of the range — what the P&L is a return on,
  // so the line under it is a percentage, as on the own profile.
  const [pnlBasisUsd, setPnlBasisUsd] = useState<number | null>(null);
  const [range, setRange] = useState<PortfolioRange>('7d');
  // The point under the user's finger while scrubbing the chart; null when idle.
  const [scrub, setScrub] = useState<{ index: number; valueUsd: number } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('holdings');
  // The same All / Sandwiches / Tokens / Perps chips the own profile filters by.
  const [holdingsCategory, setHoldingsCategory] = useState<HoldingsCategoryFilter>('all');
  const changeHoldingsCategory = useCallback((category: HoldingsCategoryFilter) => {
    void Haptics.selectionAsync();
    setHoldingsCategory(category);
  }, []);
  const [holdingsView, setHoldingsView] = useState<HoldingsView>('Open');
  // Sandwiches this user still HOLDS — distinct from the ones they authored,
  // which are the Posts tab. Marked server-side: a viewer cannot value another
  // wallet's basket from the device.
  const [sandwichPositions, setSandwichPositions] = useState<PublicSandwichHolding[]>([]);
  const [sandwichPositionsLoading, setSandwichPositionsLoading] = useState(false);
  // null = never answered, which is not the same as an empty history and must
  // not render as one.
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[] | null>(null);
  const [closedCursor, setClosedCursor] = useState<string | null>(null);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedFailed, setClosedFailed] = useState(false);
  const [perpPositions, setPerpPositions] = useState<PublicPerpPosition[]>([]);
  const [perpsLoading, setPerpsLoading] = useState(false);
  // Sandwiches this user *created* (authored) — distinct from holdings. Same
  // full feed-shaped `Sandwich` type the rest of the app uses (home, saved,
  // own profile), so the card UI here matches everywhere else.
  const [sandwichPosts, setSandwichPosts] = useState<Sandwich[]>([]);
  const [sandwichesLoading, setSandwichesLoading] = useState(false);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const stockDetailSheetRef = useRef<StockDetailSheetRef>(null);
  const shareSheetRef = useRef<SandwichShareSheetRef>(null);
  const positionShareSheetRef = useRef<PositionShareSheetRef>(null);
  const positionDetailSheetRef = useRef<PositionDetailSheetRef>(null);
  /**
   * The Sandwiches behind this user's open holdings, fetched as the list loads.
   * A tap used to fetch first and navigate after, with nothing on screen for
   * the whole round trip — that wait was the lag. Now the tap navigates at once.
   */
  const holdingSandwichesRef = useRef(new Map<string, Sandwich>());
  /** The position card open over this profile — theirs, so read-only. */
  const [focusedPosition, setFocusedPosition] = useState<FocusedPositionData | null>(null);
  const sandwichDetail = useSandwichDetail();
  const podcastGroup = usePodcastGroup();
  const [followOverride, setFollowOverride] = useState<boolean | null>(null);
  const [followLoading, setFollowLoading] = useState(false);
  // Only the verified linked-X handle opens X. The bread username is not an X
  // username, so never fall back to it — that lands on a stranger's profile.
  const xHandle = profile?.xHandle?.trim().replace(/^@+/, '') || null;

  const openXProfile = useCallback(() => {
    if (!xHandle) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const encodedHandle = encodeURIComponent(xHandle);
    const appUrl = `twitter://user?screen_name=${encodedHandle}`;
    const webUrl = `https://x.com/${encodedHandle}`;

    void Linking.openURL(appUrl).catch(() => Linking.openURL(webUrl).catch(() => {}));
  }, [xHandle]);


  useEffect(() => {
    let cancelled = false;
    setAnonymousId(null);
    void getAnonymousSocialId(viewerPrivyUserId).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [viewerPrivyUserId]);

  const load = useCallback(async () => {
    if (!targetPrivyUserId) return;
    setProfileLoading(true);
    setHoldingsLoading(true);
    setSandwichesLoading(true);
    setFollowOverride(null);

    // /api/sandwiches filters server-side by the `privyUserId` param (despite
    // what the client naming suggests, it's a creator filter, not a "viewer"
    // one) — so pass the profile owner's id here to get just their sandwiches,
    // and anonymousId separately so `viewerHasLiked` still reflects the viewer.
    getSandwiches(
      100,
      { privyUserId: targetPrivyUserId, email: null, walletAddress: null, name: null, avatarUrl: null },
      anonymousId,
    )
      .then(setSandwichPosts)
      .catch(() => setSandwichPosts([]))
      .finally(() => setSandwichesLoading(false));

    // Real on-chain holdings (units + USD value) for the Holdings tab — sourced
    // from the wallet's balances, so they appear for any user, not just those
    // whose app has synced sandwich positions.
    setHoldingsFailed(false);
    getUserHoldings(targetPrivyUserId)
      .then(({ holdings }) => {
        setHoldings(holdings);
      })
      .catch(() => {
        setHoldings([]);
        setHoldingsFailed(true);
      })
      .finally(() => setHoldingsLoading(false));

    // This user's own theses on the positions they hold (§8). Keyed by sandwich
    // so a holding card can find its author's line without a second read per
    // card; a failure simply leaves the quote off.
    getUserTakes(targetPrivyUserId)
      .then(({ takes }) => {
        const bySandwich: Record<string, PositionTake> = {};
        for (const take of takes) if (!bySandwich[take.sandwichId]) bySandwich[take.sandwichId] = take;
        setUserTakes(bySandwich);
        setUserTakeList(takes);
      })
      .catch(() => {
        setUserTakes({});
        setUserTakeList([]);
      });

    // Open perp positions. A failed read leaves the section hidden rather than
    // claiming an empty book — "no positions" about someone carrying leverage is
    // the same class of wrong data the holdings read guards against above.
    setPerpsLoading(true);
    getUserPerpPositions(targetPrivyUserId)
      .then(({ positions }) => setPerpPositions(positions))
      .catch(() => setPerpPositions([]))
      .finally(() => setPerpsLoading(false));

    // The Sandwiches this user is still in. Same failure rule as the two reads
    // around it: an error empties the section rather than inventing one.
    setSandwichPositionsLoading(true);
    getUserSandwichPositions(targetPrivyUserId)
      .then((rows) => {
        setSandwichPositions(rows);
        const cache = holdingSandwichesRef.current;
        for (const sandwichId of [...new Set(rows.map((row) => row.sandwichId))].slice(0, 20)) {
          if (cache.has(sandwichId)) continue;
          void getSandwichById(sandwichId, anonymousId)
            .then((sandwich) => {
              if (sandwich) cache.set(sandwichId, sandwich);
            })
            .catch(() => {});
        }
        return rows;
      })
      .catch(() => setSandwichPositions([]))
      .finally(() => setSandwichPositionsLoading(false));

    try {
      const prof = await getUserProfile(targetPrivyUserId, viewerPrivyUserId);
      setProfile(prof);
      const sample = prof?.followedBy?.sample ?? [];
      if (viewerPrivyUserId && sample.length > 0) {
        getFollowers(targetPrivyUserId, viewerPrivyUserId, 50)
          .then(({ entries }) => {
            const named = new Set(sample.map((name) => name.toLowerCase()));
            const mutuals = entries.filter((entry) => entry.isFollowing);
            const matched = mutuals.filter(
              (entry) =>
                (entry.username && named.has(entry.username.toLowerCase())) ||
                (entry.name && named.has(entry.name.toLowerCase())),
            );
            // The named ones first; if the page missed them, any mutual with
            // a face still makes the line truer than none.
            setFollowedByUsers((matched.length > 0 ? matched : mutuals).slice(0, 3));
          })
          .catch(() => setFollowedByUsers([]));
      } else {
        setFollowedByUsers([]);
      }
    } catch {
      setProfile(null);
      setFollowedByUsers([]);
    } finally {
      setProfileLoading(false);
    }
  }, [targetPrivyUserId, viewerPrivyUserId, anonymousId]);

  /**
   * The settled half, loaded the first time it is asked for.
   *
   * Deliberately NOT part of `load`: most visits never open the Closed tab, and
   * this read walks the whole record plus the wallet's trade ledger.
   */
  const loadClosed = useCallback((options?: { cursor?: string | null; append?: boolean }) => {
    if (!targetPrivyUserId) return;
    setClosedLoading(true);
    setClosedFailed(false);
    getUserClosedPositions(targetPrivyUserId, {
      limit: 20,
      cursor: options?.cursor ?? null,
    })
      .then((page) => {
        setClosedPositions((previous) => {
          if (!options?.append || !previous) return page.positions;
          const seen = new Set(previous.map((position) => position.id));
          return [
            ...previous,
            ...page.positions.filter((position) => !seen.has(position.id)),
          ];
        });
        setClosedCursor(page.nextCursor);
      })
      .catch(() => {
        setClosedFailed(true);
        setClosedPositions((previous) => previous ?? []);
      })
      .finally(() => setClosedLoading(false));
  }, [targetPrivyUserId]);

  // Reset when the screen is pointed at a different person, so one profile's
  // history is never shown under another's name.
  useEffect(() => {
    setHoldingsView('Open');
    setClosedPositions(null);
    setClosedCursor(null);
    setClosedFailed(false);
  }, [targetPrivyUserId]);

  useEffect(() => {
    if (!visible || holdingsView !== 'Closed') return;
    if (closedPositions !== null || closedLoading) return;
    loadClosed();
  }, [visible, holdingsView, closedPositions, closedLoading, loadClosed]);

  const loadHistory = useCallback(() => {
    if (!targetPrivyUserId) return;
    setHistory(null);
    setHistoryLoading(true);
    // The percentage is a return on the capital in the trades behind the P&L,
    // which the P&L response carries. It used to be the portfolio's value at
    // the START of the range: a user who funded mid-month started 30d at a
    // hundredth of a cent and read +73,877,478%.
    getUserPnlHistory(targetPrivyUserId, range)
      .then((next) => {
        setHistory(next);
        setPnlBasisUsd(next.basisUsd ?? null);
      })
      .catch(() => {
        setHistory({ points: [], realizedUsd: 0, unrealizedUsd: 0, changeUsd: 0 });
        setPnlBasisUsd(null);
      })
      .finally(() => setHistoryLoading(false));
  }, [targetPrivyUserId, range]);

  useEffect(() => {
    if (visible) {
      setActiveTab('holdings');
      setRange('7d');
      setScrub(null);
      void load();
      return;
    }
    stockDetailSheetRef.current?.close();
  }, [visible, load]);

  // (Re)load the value chart whenever the screen opens or the range changes.
  useEffect(() => {
    if (visible) loadHistory();
  }, [visible, loadHistory]);

  const openStockDetail = useCallback((stock: Stock) => {
    stockDetailSheetRef.current?.open(stock);
  }, []);

  /**
   * Open the thesis behind one of this user's Sandwich positions.
   *
   * The position row carries only the tradeable's id, so the card is fetched on
   * tap rather than prefetched for every row — a profile with a dozen positions
   * would otherwise download a dozen full sandwiches nobody opens. A sandwich
   * that no longer resolves simply does nothing, which is the honest outcome
   * for a post that was deleted out from under a position.
   */

  const applyUpdatedSandwich = useCallback((updated: Sandwich) => {
    setSandwichPosts((current) => current.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  const handleToggleLike = useCallback(
    async (sandwich: Sandwich) => {
      if (!anonymousId) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // The like belongs to the card this market sits on, so one request covers
      // an episode however many markets it produced.
      const before = cardSocial([sandwich]);
      const optimistic = toggledCardSocial(before);
      applyUpdatedSandwich(withCardSocial(sandwich, optimistic));
      try {
        const updated = await setCardLike(sandwich, optimistic.viewerHasLiked, anonymousId);
        applyUpdatedSandwich(withCardSocial(sandwich, updated));
      } catch {
        applyUpdatedSandwich(withCardSocial(sandwich, before));
      }
    },
    [anonymousId, applyUpdatedSandwich],
  );

  const handleShareSandwich = useCallback((sandwich: Sandwich) => {
    shareSheetRef.current?.open(sandwich);
  }, []);

  /**
   * Push a route from inside this screen.
   *
   * This screen is a native <Modal>, which sits ABOVE the navigator — so a
   * router.push on its own mounts the detail screen behind the modal and reads
   * as "the post doesn't open". Pushing first and then closing the modal means
   * the route is already there when the modal comes down.
   */
  const pushBehindModal = useCallback(
    (navigate: () => void) => {
      navigate();
      // As a route the pushed screen simply stacks on top; Back returns here.
      if (!asRoute) onClose();
    },
    [asRoute, onClose],
  );

  /**
   * A take opens the basket it is about. Through `pushBehindModal`, like every
   * other route this screen opens: it is a native <Modal>, so a bare push would
   * land the detail screen behind it. A take on a bare Phoenix position is filed
   * under a market symbol, not a sandwich, and so has no basket to open.
   */
  const openTakeSandwich = useCallback(
    (take: PositionTake) => {
      void getSandwichById(take.sandwichId, anonymousId).then((sandwich) => {
        if (sandwich) pushBehindModal(() => sandwichDetail.open(sandwich));
      });
    },
    [anonymousId, pushBehindModal, sandwichDetail],
  );

  /**
   * Fill in the chart once the Sandwich arrives. The card is already up; this
   * only adds the legs the basket chart draws, and is dropped if the viewer has
   * since closed the card or opened another one.
   */
  const hydrateFocusedSandwich = useCallback(
    (positionId: string, sandwichId: string, rebuild: (sandwich: Sandwich) => FocusedPositionData['detail']) => {
      void getSandwichById(sandwichId, anonymousId)
        .then((sandwich) => {
          if (!sandwich) return;
          startTransition(() =>
            setFocusedPosition((current) =>
              current?.detail.id === positionId
                ? { ...current, sandwich, detail: rebuild(sandwich) }
                : current,
            ),
          );
        })
        .catch(() => {});
    },
    [anonymousId],
  );

  /**
   * A held position opens the Sandwich screen with that holding on it — the
   * same screen the viewer's own profile opens, showing THIS user's value and
   * return, read-only. The Sandwich is normally already cached from the list
   * load, so the push happens on the tap.
   */
  const openSandwichPosition = useCallback(
    (position: PublicSandwichHolding) => {
      void Haptics.selectionAsync();
      const open = (sandwich: Sandwich) =>
        pushBehindModal(() =>
          sandwichDetail.open(sandwich, {
            onUpdated: applyUpdatedSandwich,
            viewedPosition: viewedPositionFromHolding(position),
          }),
        );
      const cached = holdingSandwichesRef.current.get(position.sandwichId);
      if (cached) {
        open(cached);
        return;
      }
      void getSandwichById(position.sandwichId, anonymousId).then((sandwich) => {
        if (!sandwich) return;
        holdingSandwichesRef.current.set(position.sandwichId, sandwich);
        open(sandwich);
      });
    },
    [anonymousId, applyUpdatedSandwich, pushBehindModal, sandwichDetail],
  );

  /** A perp row opens its market in this screen's own asset sheet. */
  const openPerpMarket = useCallback(
    (symbol: string, side: 'long' | 'short') => {
      void getPhoenixMarket(symbol)
        .then(({ market }) => stockDetailSheetRef.current?.openPerp(market, null, side))
        .catch(() => {});
    },
    [],
  );

  const openPerpPosition = useCallback(
    (position: PublicPerpPosition) =>
      openPerpMarket(position.symbol, position.positionSize < 0 ? 'short' : 'long'),
    [openPerpMarket],
  );

  /**
   * A closed row opens what it closed: the sandwich's thesis, the perp market,
   * or the token. Nothing here is the viewer's own, so there is no position
   * sheet to open — the live subject is the useful destination.
   */
  const openClosedPosition = useCallback(
    (position: ClosedPosition) => {
      void Haptics.selectionAsync();
      if (position.sandwichId) {
        // Same card as an open position: entry and exit, the result, Share.
        const initial: FocusedPositionData = {
          detail: publicClosedPositionDetail(position),
          sandwich: null,
        };
        // The sheet renders `initial` on this frame; this screen's own copy
        // catches up without blocking the rise.
        positionDetailSheetRef.current?.present(initial);
        startTransition(() => setFocusedPosition(initial));
        hydrateFocusedSandwich(position.id, position.sandwichId, (sandwich) =>
          publicClosedPositionDetail(position, sandwich),
        );
        return;
      }
      if (position.kind === 'phoenix_perp' && position.symbols[0]) {
        openPerpMarket(position.symbols[0], 'long');
        return;
      }
      if (position.mint) {
        void getStockById(position.mint)
          .then((stock) => stockDetailSheetRef.current?.open(stock))
          .catch(() => {});
      }
    },
    [hydrateFocusedSandwich, openPerpMarket],
  );

  const shareFocusedPosition = useCallback((data: FocusedPositionData) => {
    positionShareSheetRef.current?.open({
      detail: data.detail,
      currentValueUsd: data.currentValueUsd,
      pnlUsd: data.pnlUsd,
      pnlPct: data.pnlPct,
      iconUri: data.detail.logoUri,
      publicUrl: data.detail.sandwichId ? getSandwichShareUrl(data.detail.sandwichId) : null,
    });
  }, []);

  /** "View Full Sandwich" leaves the profile, so it goes behind the modal. */
  const viewFullFocusedPosition = useCallback(
    (data: FocusedPositionData) => {
      const sandwichId = data.detail.sandwichId;
      if (!sandwichId) return;
      setFocusedPosition(null);
      const open = (sandwich: Sandwich) =>
        pushBehindModal(() => sandwichDetail.open(sandwich, { onUpdated: applyUpdatedSandwich }));
      if (data.sandwich) {
        open(data.sandwich);
        return;
      }
      void getSandwichById(sandwichId, anonymousId).then((sandwich) => {
        if (sandwich) open(sandwich);
      });
    },
    [anonymousId, applyUpdatedSandwich, pushBehindModal, sandwichDetail],
  );

  const openSandwich = useCallback(
    (sandwich: Sandwich) => {
      if (NATIVE_ZOOM_SPIKE && !asRoute) {
        // Commit animationType="none" before marking the post. The provider
        // keeps this modal alive through UIKit's source capture and calls
        // onClose one frame after the native push starts, so a fade cannot sit
        // over and hide the zoom.
        setClosingForNativeZoom(true);
        requestAnimationFrame(() =>
          sandwichDetail.open(sandwich, {
            onUpdated: applyUpdatedSandwich,
            onNavigationStarted: onClose,
          }),
        );
        return;
      }
      pushBehindModal(() =>
        sandwichDetail.open(sandwich, { onUpdated: applyUpdatedSandwich }),
      );
    },
    [asRoute, pushBehindModal, sandwichDetail, applyUpdatedSandwich, onClose],
  );

  const openSandwichComments = useCallback(
    (sandwich: Sandwich) => {
      if (NATIVE_ZOOM_SPIKE && !asRoute) {
        setClosingForNativeZoom(true);
        requestAnimationFrame(() =>
          sandwichDetail.open(sandwich, {
            onUpdated: applyUpdatedSandwich,
            showComments: true,
            onNavigationStarted: onClose,
          }),
        );
        return;
      }
      pushBehindModal(() =>
        sandwichDetail.open(sandwich, {
          onUpdated: applyUpdatedSandwich,
          showComments: true,
        }),
      );
    },
    [asRoute, pushBehindModal, sandwichDetail, applyUpdatedSandwich, onClose],
  );

  const openPodcastGroup = useCallback(
    (group: PodcastGroup) => {
      pushBehindModal(() => podcastGroup.open(group));
    },
    [pushBehindModal, podcastGroup],
  );

  const isFollowing = followOverride !== null ? followOverride : (profile?.isFollowing ?? false);
  const isOwnProfile = targetPrivyUserId === viewerPrivyUserId;

  async function handleFollow() {
    if (!viewerPayload || !profile || followLoading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const currently = isFollowing;
    const delta = currently ? -1 : 1;
    // Optimistic: flip the button AND bump the count on the same frame as the
    // tap. The Stat component watches for count changes and pops the number,
    // so the whole gesture reads as one atomic acknowledgement. Revert both
    // together if the request fails.
    setFollowOverride(!currently);
    setProfile((prev) =>
      prev ? { ...prev, followerCount: Math.max(0, prev.followerCount + delta) } : prev,
    );
    setFollowLoading(true);
    try {
      if (currently) {
        await unfollowUser(viewerPayload, targetPrivyUserId);
      } else {
        await followUser(viewerPayload, targetPrivyUserId);
      }
    } catch {
      setFollowOverride(currently);
      setProfile((prev) =>
        prev ? { ...prev, followerCount: Math.max(0, prev.followerCount - delta) } : prev,
      );
    } finally {
      setFollowLoading(false);
    }
  }

  // Every mint that belongs to an open Sandwich this user holds. A leg is
  // listed under its Sandwich, so the same balance must not appear again as a
  // loose token row — one NVDA position rendered twice reads as two, and the
  // two rows even disagree, because the Sandwich marks the basket while the
  // token row marks the wallet.
  //
  // Matched on MINT, never on ticker: the same company trades as several
  // wrapper mints at different prices, and a symbol match would suppress a
  // genuinely separate holding.
  const sandwichLegMints = useMemo(
    () => new Set(sandwichPositions.flatMap((position) => position.legMints)),
    [sandwichPositions],
  );

  // Holdings stay in their own tab; the performance chart intentionally does
  // not use their market value or the user's cash balance.
  const visibleHoldings = useMemo(
    () => holdings.filter((holding) => !sandwichLegMints.has(holding.mint)),
    [holdings, sandwichLegMints],
  );
  // Dust and fully-closed positions are noise, not exposure.
  const visiblePerpPositions = perpPositions.filter(
    (position) =>
      Math.abs(position.positionSize) > 0 && Math.abs(position.positionValue) >= 1,
  );
  const points = history?.points ?? [];
  const displayedPnlUsd = scrub?.valueUsd ?? history?.changeUsd ?? 0;
  const pnlPositive = displayedPnlUsd >= 0;

  const followLabel = followedByLabel(profile?.followedBy);
  const followedByExtra = Math.max(0, (profile?.followedBy?.count ?? 0) - followedByUsers.length);
  const joinedDate = formatJoinedDate(profile?.createdAt);
  const profileMeta = profile && joinedDate ? `Joined ${joinedDate}` : '';

  const ListHeader = profile ? (
    <View>
      {/* Identity */}
      <View style={styles.profileSection}>
        <View style={styles.profileTop}>
          <Avatar avatarUrl={profile.avatarUrl} name={profile.name} size={64} />
          <View style={styles.identityWrap}>
            <View style={styles.nameRow}>
              <Text style={styles.profileName} numberOfLines={1}>
                {profile.username ? (
                  <>
                    <Text style={styles.profileNameAt}>@</Text>
                    {profile.username}
                  </>
                ) : (
                  profile.privyUserId.slice(0, 12)
                )}
              </Text>
              <VerifiedBadge size={18} />
              {xHandle ? (
                <PressableScale
                  accessibilityRole="link"
                  accessibilityLabel={`Open @${xHandle} on X`}
                  hitSlop={9}
                  onPress={openXProfile}
                  style={styles.xLogoBtn}>
                  <Text style={styles.xLogo}>𝕏</Text>
                </PressableScale>
              ) : null}
            </View>
          </View>
        </View>

        {/* Bio reads before the social proof — who this person is, then how
            many people follow them. Mirrors the own-profile order. */}
        {profile.bio ? (
          <Text style={styles.bioText} numberOfLines={4}>
            {profile.bio}
          </Text>
        ) : null}

        <View style={styles.statsRow}>
          <Stat count={profile.followerCount} label="Followers" />
          <Stat count={profile.followingCount} label="Following" />
          <View style={{ flex: 1 }} />
          {/* The list-row size: it sits in a row of 15pt stat labels, and the
              header pill at 18pt / 46pt tall outweighed the name. */}
          {!isOwnProfile && viewerPayload ? (
            <FollowButton
              size="sm"
              following={isFollowing}
              followingTone="sky"
              disabled={followLoading}
              onPress={() => { void handleFollow(); }}
            />
          ) : null}
        </View>

        {/* Quiet: when the account was made, right under the counts. The track
            record (traded / hit rate / median) is deliberately not shown here —
            the P&L chart under it is the receipt. */}
        {profileMeta ? <Text style={styles.profileMeta}>{profileMeta}</Text> : null}

        {/* Faces instead of names: "followed by [pfp][pfp] +3". The names
            only show while the faces are still loading or can't be resolved. */}
        {followLabel ? (
          <View style={styles.followedByRow}>
            {followedByUsers.length > 0 ? (
              <>
                <Text style={styles.followedBy}>followed by</Text>
                <View style={styles.followedByFaces}>
                  {followedByUsers.map((user, index) => (
                    <View
                      key={user.privyUserId}
                      style={[styles.followedByFace, index > 0 && styles.followedByFaceOverlap]}>
                      <Avatar avatarUrl={user.avatarUrl} name={user.name} size={24} />
                    </View>
                  ))}
                </View>
                {followedByExtra > 0 ? (
                  <Text style={styles.followedBy}>{`+${followedByExtra}`}</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.followedBy} numberOfLines={1}>
                {followLabel}
              </Text>
            )}
          </View>
        ) : null}
      </View>

      {/* Total P&L + range + chart */}
      <View style={styles.portfolioBlock}>
        <View style={styles.valueRow}>
          <View>
            <Text style={styles.pnlLabel}>PnL</Text>
            <Text style={styles.bigValue}>{formatUsd(displayedPnlUsd)}</Text>
          </View>
          <View style={styles.rangeToggle}>
            {RANGES.map((r) => (
              <Pressable
                key={r}
                onPress={() => { void Haptics.selectionAsync(); setScrub(null); setRange(r); }}
                style={styles.rangeBtn}>
                <Text style={[styles.rangeText, range === r && styles.rangeTextActive]}>{r}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {historyLoading ? (
          <ValueSkeletonLine
            lineHeight={21}
            width={72}
            style={styles.absChangeSkeleton}
            accessibilityLabel="Loading realized P&L"
          />
        ) : (
          <Text style={[styles.absChange, { color: pnlPositive ? COLOR_UP : COLOR_DOWN }]}>
            {formatSignedPnlPercentage(
              pnlBasisUsd !== null ? (displayedPnlUsd / pnlBasisUsd) * 100 : null,
            ) ?? '—'}
          </Text>
        )}

        <PnlChart
          points={points}
          changeUsd={displayedPnlUsd}
          loading={historyLoading}
          showHeader={false}
          onScrub={setScrub}
          containerStyle={{ paddingHorizontal: 0, paddingBottom: 0, paddingTop: 10 }}
        />
      </View>

    </View>
  ) : null;

  // Kept outside ListHeader so FlatList can pin exactly this row, matching the
  // own profile's sticky Holdings / Posts bar without pinning the whole hero.
  const ProfileTabs = useMemo(() => profile ? (
      <View style={styles.tabBar}>
        <View style={styles.tabBarRow}>
          <Pressable
            onPress={() => { void Haptics.selectionAsync(); setActiveTab('holdings'); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'holdings' }}
            style={styles.tab}>
            <Text style={[styles.tabText, activeTab === 'holdings' ? styles.tabTextActive : styles.tabTextInactive]}>
              Holdings
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { void Haptics.selectionAsync(); setActiveTab('sandwiches'); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'sandwiches' }}
            style={styles.tab}>
            <Text style={[styles.tabText, activeTab === 'sandwiches' ? styles.tabTextActive : styles.tabTextInactive]}>
              Posts
            </Text>
          </Pressable>
          {/* Trailing the tabs rather than sitting on its own row: it filters the
              Holdings list, so it belongs on the line with the thing it filters —
              exactly where the own profile puts it. */}
          {activeTab === 'holdings' ? (
            <View style={styles.tabBarFilter}>
              <IosSegmentedControl
                options={HOLDINGS_VIEWS}
                value={holdingsView}
                onChange={setHoldingsView}
                accessibilityLabel="Show open or closed positions"
              />
            </View>
          ) : null}
        </View>
        {activeTab === 'holdings' ? (
          <HoldingsCategorySwitch value={holdingsCategory} onChange={changeHoldingsCategory} />
        ) : null}
      </View>
    ) : null,
    [activeTab, changeHoldingsCategory, holdingsCategory, holdingsView, profile, styles],
  );

  const holdingsActive = activeTab === 'holdings';
  // Posts from one YouTube episode collapse into a single card listing its
  // markets, same as the main feed — otherwise a three-call video posts three
  // near-identical cards to the profile.
  // Memoized: this is the FlatList's `data`, and a fresh array identity every
  // render makes the list re-diff and re-render every visible cell.
  const postItems = useMemo(() => buildFeedItems(sandwichPosts), [sandwichPosts]);
  const postsById = useMemo(
    () => new Map(sandwichPosts.map((post) => [post.id, post] as const)),
    [sandwichPosts],
  );
  // The Sandwiches this user is still in. A basket the server could not mark is
  // still exposure and still listed — the value column carries the dash, the
  // row is not silently dropped.
  const visibleSandwichPositions = sandwichPositions;

  // The chip narrows both halves of the toggle the same way, so Open and
  // Closed cannot drift apart in ordering: sandwiches, then perps, then tokens.
  const showCategory = (category: HoldingsCategory) =>
    holdingsCategory === 'all' || holdingsCategory === category;

  const openRows: HoldingsRow[] = [
    ...(showCategory('sandwiches')
      ? visibleSandwichPositions.map((position): HoldingsRow => ({ kind: 'sandwich', position }))
      : []),
    ...(showCategory('perps')
      ? visiblePerpPositions.map((position): HoldingsRow => ({ kind: 'perp', position }))
      : []),
    ...(showCategory('tokens')
      ? visibleHoldings.map((holding): HoldingsRow => ({ kind: 'holding', holding }))
      : []),
  ];

  const closedRows: HoldingsRow[] = (() => {
    if (closedPositions === null) return [];
    const byCategory: Record<HoldingsCategory, HoldingsRow[]> = {
      sandwiches: [],
      perps: [],
      tokens: [],
    };
    for (const position of closedPositions) {
      byCategory[closedCategory(position)].push({ kind: 'closed', position });
    }
    const order: HoldingsCategory[] = ['sandwiches', 'perps', 'tokens'];
    return order.flatMap((category) => (showCategory(category) ? byCategory[category] : []));
  })();

  const holdingsRows: HoldingsRow[] = holdingsView === 'Closed' ? closedRows : openRows;
  // Posts and takes are one timeline — a take is a post about a position, so
  // it has no tab of its own. Newest first across both.
  const postTimeline = useMemo<(FeedItem | TakeListRow)[]>(() => {
    const timeOf = (row: FeedItem | TakeListRow) => {
      const dates =
        row.kind === 'takeRow' || row.kind === 'take'
          ? [row.take.createdAt]
          : row.kind === 'video'
            ? row.sandwiches.map((sw) => sw.createdAt)
            : [row.sandwich.createdAt];
      return Math.max(0, ...dates.map((d) => Date.parse(d) || 0));
    };
    const takeRows: TakeListRow[] = (userTakeList ?? []).map((take) => ({ kind: 'takeRow', take }));
    return [...postItems, ...takeRows]
      .map((row) => ({ row, time: timeOf(row) }))
      .sort((a, b) => b.time - a.time)
      .map(({ row }) => row);
  }, [postItems, userTakeList]);
  const contentRows: (HoldingsRow | FeedItem | TakeListRow)[] = holdingsActive
    ? holdingsRows
    : postTimeline;
  const listData: ProfileListItem[] = profile
    ? [{ kind: 'profileTabs' }, ...contentRows]
    : contentRows;

  // `renderItem` / `keyExtractor` must be stable: FlatList treats a new
  // function identity as a reason to re-render every visible cell, which undoes
  // the `React.memo` on the cards below.
  const openGroup = useCallback(
    (video: PodcastGroupVideo, group: Sandwich[]) =>
      openPodcastGroup({ video, sandwiches: group }),
    [openPodcastGroup],
  );

  const toggleLikeGroup = useCallback(
    (group: Sandwich[]) => {
      // One card, one like: the markets share a Post, so any one of them
      // addresses the whole episode.
      const [card] = group;
      if (card) void handleToggleLike(card);
    },
    [handleToggleLike],
  );


  const keyExtractor = useCallback(
    (item: ProfileListItem) => {
      if (item.kind === 'profileTabs') return 'profile-tabs';
      if (item.kind === 'takeRow') return `take:${item.take.id}`;
      if (!holdingsActive) return (item as FeedItem).key;
      const row = item as HoldingsRow;
      if (row.kind === 'perp') return `perp:${row.position.symbol.toUpperCase()}`;
      if (row.kind === 'sandwich') return `sandwich:${row.position.id}`;
      if (row.kind === 'closed') return `closed:${row.position.kind}:${row.position.id}`;
      return `holding:${row.holding.stock.id}`;
    },
    [holdingsActive],
  );

  const renderItem = useCallback(
    ({ item }: { item: ProfileListItem }) => {
      if (item.kind === 'profileTabs') return ProfileTabs;
      if (item.kind === 'takeRow') {
        // The stamp is the point of the row; the tap goes to the basket it is
        // about, where the other holders' takes and the buy both live.
        return (
          <View style={styles.sandwichCardWrap}>
            <TakePostCard
              take={item.take}
              sandwich={postsById.get(item.take.sandwichId) ?? null}
              onPress={openTakeSandwich}
            />
          </View>
        );
      }
      if (holdingsActive) {
        const row = item as HoldingsRow;
        if (row.kind === 'perp') {
          return <PerpPositionRow position={row.position} onPress={openPerpPosition} />;
        }
        if (row.kind === 'sandwich') {
          // The same card the owner sees on their own profile.
          return (
            <View style={styles.holdingCardWrap}>
              <PublicSandwichHoldingCard
                holding={row.position}
                takes={
                  userTakes[row.position.sandwichId]
                    ? { count: 1, latest: userTakes[row.position.sandwichId] }
                    : null
                }
                onOpen={() => openSandwichPosition(row.position)}
              />
            </View>
          );
        }
        if (row.kind === 'closed') {
          return (
            <View style={styles.closedPositionWrap}>
              <ClosedPositionRow
                position={row.position}
                onPress={() => openClosedPosition(row.position)}
              />
            </View>
          );
        }
        return <StockHoldingRow holding={row.holding} onPress={openStockDetail} />;
      }
      const feedItem = item as FeedItem;
      return (
        <View style={styles.sandwichCardWrap}>
          {feedItem.kind === 'video' ? (
            <PodcastGroupCard
              video={feedItem.video}
              sandwiches={feedItem.sandwiches}
              onOpenGroup={openGroup}
              onToggleLikeGroup={toggleLikeGroup}
              onComment={openSandwichComments}
              onShare={handleShareSandwich}
            />
          ) : (
            <SandwichCard
              sandwich={feedItem.sandwich}
              onPress={openSandwich}
              onToggleLike={handleToggleLike}
              onComment={openSandwichComments}
              onShare={handleShareSandwich}
            />
          )}
        </View>
      );
    },
    [
      holdingsActive,
      ProfileTabs,
      openStockDetail,
      openSandwichPosition,
      openPerpPosition,
      openClosedPosition,
      openTakeSandwich,
      postsById,
      userTakes,
      styles.sandwichCardWrap,
      styles.holdingCardWrap,
      styles.closedPositionWrap,
      openGroup,
      toggleLikeGroup,
      openSandwichComments,
      handleShareSandwich,
      openSandwich,
      handleToggleLike,
    ],
  );

  // Skeletons shaped like the rows they stand in for, so the list doesn't
  // collapse to a spinner and re-expand when data lands.
  const rowSkeletons = (count: number, label: string) => (
    <View accessibilityLabel={label} style={styles.skeletonList}>
      {Array.from({ length: count }, (_, index) => (
        <View key={`${label}-${index}`} style={styles.skeletonRow}>
          <ValueSkeleton width={44} height={44} radius={22} accessibilityLabel="" />
          <View style={styles.skeletonCopy}>
            <ValueSkeleton width="55%" height={14} accessibilityLabel="" />
            <ValueSkeleton width="35%" height={11} accessibilityLabel="" />
          </View>
          <View style={styles.skeletonValue}>
            <ValueSkeleton width={64} height={16} accessibilityLabel="" />
            <ValueSkeleton width={44} height={11} accessibilityLabel="" />
          </View>
        </View>
      ))}
    </View>
  );

  const emptyComponent = !profile ? null : holdingsActive && holdingsView === 'Closed' ? (
    // The settled half answers for itself: it has its own read, its own
    // failure, and "nothing closed yet" is a real answer that must not be
    // reported as an empty portfolio.
    closedLoading || closedPositions === null ? (
      rowSkeletons(4, 'Loading closed positions')
    ) : closedFailed ? (
      <LoadErrorState size="section" title="Couldn't load history" onRetry={() => loadClosed()} />
    ) : (
      <View style={styles.listLoading}><Text style={styles.emptyText}>No closed positions yet</Text></View>
    )
  ) : holdingsActive ? (
    holdingsLoading || perpsLoading || sandwichPositionsLoading ? (
      rowSkeletons(4, 'Loading holdings')
    ) : holdingsFailed ? (
      <LoadErrorState size="section" title="Couldn't load holdings" onRetry={() => void load()} />
    ) : (
      <View style={styles.listLoading}><Text style={styles.emptyText}>No holdings yet</Text></View>
    )
  ) : sandwichesLoading || userTakeList === null ? (
    rowSkeletons(3, 'Loading posts')
  ) : (
    <View style={styles.listLoading}><Text style={styles.emptyText}>No Sandwiches yet</Text></View>
  );

  const listFooter = contentRows.length === 0
    ? emptyComponent
    : holdingsActive && holdingsView === 'Closed' && closedLoading
      ? <View style={styles.loadingMore}><ActivityIndicator color={colors.text} /></View>
      : null;

  const loadMoreClosed = useCallback(() => {
    if (!holdingsActive || holdingsView !== 'Closed' || closedLoading || !closedCursor) return;
    loadClosed({ cursor: closedCursor, append: true });
  }, [closedCursor, closedLoading, holdingsActive, holdingsView, loadClosed]);

  const body = (
    <>
      {/* A native <Modal> creates its own view hierarchy, so gorhom bottom sheets
          rendered here would otherwise portal to the app-root provider and
          appear BEHIND this Modal (tapping a holding did nothing). Nesting a
          GestureHandlerRootView + BottomSheetModalProvider inside the Modal gives
          the StockDetailSheet a portal host in-tree so it presents on top and
          its gestures work. Mirrors buy-success-sheet's in-Modal provider. */}
      <GestureHandlerRootView style={styles.container}>
        <BottomSheetModalProvider>
      <GestureDetector gesture={swipeToDismiss}>
      <Animated.View style={[styles.container, shellStyle]}>
        <View style={[styles.header, { paddingTop: insets.top > 0 ? insets.top + 46 : 48 }]} />

        {profileLoading && !profile ? (
          /* The header's own shape — avatar, name, bio, stats, follow pill —
             then rows, in the same slots the real content lands in. */
          <View accessibilityLabel="Loading profile" style={styles.list}>
            <View style={styles.profileSection}>
              <View style={styles.profileTop}>
                <ValueSkeleton width={64} height={64} radius={32} accessibilityLabel="" />
                <View style={styles.identityWrap}>
                  <ValueSkeleton width="60%" height={22} accessibilityLabel="" />
                  <ValueSkeleton width="85%" height={13} style={styles.skeletonGap} accessibilityLabel="" />
                  <ValueSkeleton width="50%" height={13} style={styles.skeletonGapTight} accessibilityLabel="" />
                </View>
              </View>
              <View style={styles.statsRow}>
                <ValueSkeleton width={92} height={16} accessibilityLabel="" />
                <ValueSkeleton width={92} height={16} accessibilityLabel="" />
                <View style={styles.skeletonSpacer} />
                <ValueSkeleton width={112} height={40} radius={20} accessibilityLabel="" />
              </View>
            </View>
            <View style={styles.skeletonTabs}>
              <ValueSkeleton width={72} height={16} accessibilityLabel="" />
              <ValueSkeleton width={56} height={16} accessibilityLabel="" />
            </View>
            {rowSkeletons(5, '')}
          </View>
        ) : !profile ? (
          <View style={styles.center}><Text style={styles.emptyText}>User not found</Text></View>
        ) : (
          <FlatList
            style={styles.list}
            data={listData}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ListHeaderComponent={ListHeader}
            ListFooterComponent={listFooter}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            stickyHeaderIndices={[1]}
            onEndReached={loadMoreClosed}
            onEndReachedThreshold={0.8}
            // Freeze the list while the header chart is being scrubbed, or the
            // native scroll view pans the page out from under the finger.
            scrollEnabled={scrub === null}
          />
        )}
      </Animated.View>
      </GestureDetector>
      <StockDetailSheet
        ref={stockDetailSheetRef}
        onOpenSandwich={(sandwich, options) =>
          pushBehindModal(() => sandwichDetail.open(sandwich, options))
        }
      />
      <SandwichShareSheet ref={shareSheetRef} />
      <PositionDetailSheet
        ref={positionDetailSheetRef}
        data={focusedPosition}
        onDismiss={() => setFocusedPosition(null)}
        onShare={shareFocusedPosition}
        onViewFull={viewFullFocusedPosition}
      />
      <PositionShareSheet ref={positionShareSheetRef} />
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </>
  );
  if (asRoute) return body;
  return (
    <Modal
      visible={visible}
      animationType={closingForNativeZoom ? 'none' : 'fade'}
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {body}
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 4,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  list: { flex: 1 },
  listContent: { paddingBottom: 40, flexGrow: 1 },
  // SandwichCard has only 2px of its own horizontal inset — everywhere else it
  // renders inside a 16px-padded container (home, saved, own profile). This
  // screen's list has no horizontal padding otherwise, so add it here to match.
  sandwichCardWrap: { paddingHorizontal: 16 },

  profileSection: { paddingHorizontal: 20, paddingTop: 6 },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  identityWrap: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileName: { color: c.text, fontSize: 23, fontWeight: '900', fontFamily: F, letterSpacing: -0.3, flexShrink: 1 },
  profileNameAt: { color: c.textQuaternary, fontSize: 17, fontWeight: '400' },
  bioText: { color: c.textSecondary, fontSize: 15, fontWeight: '500', lineHeight: 20, fontFamily: F, marginTop: 10 },
  xLogoBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  xLogo: { color: c.text, fontSize: 22, fontWeight: '900', fontFamily: F },


  // The two stats plus the follow pill only just fit on a narrow phone at the
  // old 18pt gap, which pushed the pill's right edge past the section padding.
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  statItem: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 },
  // Trimmed from the lg default so the pill sits inside the 20pt gutter.
  // Tabular figures so the pop animation on count changes doesn't shove the
  // label sideways as digit widths swap.
  statCount: { color: c.text, fontSize: 18, fontWeight: '900', fontFamily: F, fontVariant: ['tabular-nums'] },
  statLabel: { color: c.textTertiary, fontSize: 14, fontWeight: '600', fontFamily: F },
  profileMeta: { color: c.textTertiary, fontSize: 12, lineHeight: 16, fontWeight: '600', fontFamily: F, marginTop: 6 },
  followedByRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  followedByFaces: { flexDirection: 'row', alignItems: 'center' },
  followedByFace: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: c.background,
  },
  followedByFaceOverlap: { marginLeft: -8 },
  followedBy: { color: c.text, fontSize: 14, fontWeight: '700', fontFamily: F, flexShrink: 1 },


  portfolioBlock: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6 },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  // Tighter negative tracking on the display sum (Apple §15 — large text needs
  // it to read as one unit, not spaced letters). Tabular figures so chart-scrub
  // digit changes don't jitter the width.
  bigValue: {
    color: c.text,
    fontSize: 28,
    fontWeight: '900',
    fontFamily: F,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  pnlLabel: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: F,
    marginBottom: 2,
  },
  absChangeSkeleton: {
    marginTop: 2,
  },
  absChange: {
    fontSize: 17,
    fontWeight: '900',
    fontFamily: Fonts.displayMedium,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  rangeToggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  rangeBtn: { paddingVertical: 2 },
  rangeText: { color: c.textQuaternary, fontSize: 14, fontWeight: '800', fontFamily: F },
  rangeTextActive: { color: c.text },

  tabBar: {
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: c.background,
  },
  tabBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 14,
  },
  tab: { paddingVertical: 5, flexShrink: 0 },
  // Pushed to the trailing edge of the tab row, optically centred against the
  // tab labels on a row that is otherwise bottom-aligned.
  tabBarFilter: {
    marginLeft: 'auto',
    flexShrink: 1,
    minWidth: 108,
    maxWidth: 148,
    marginBottom: 2,
  },
  // Overlapping leg artwork for a basket row, in place of the single 40pt logo
  // a token row carries.
  sandwichIconStack: { flexDirection: 'row', alignItems: 'center', width: 40 },
  sandwichIconOverlap: { marginLeft: -10 },
  sandwichIconPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.surfaceAlt,
  },
  tabText: { fontSize: 20, fontWeight: '900', fontFamily: F, letterSpacing: -0.3 },
  tabTextActive: { color: c.text },
  tabTextInactive: { color: c.textQuaternary },
  listLoading: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  skeletonList: { paddingHorizontal: 20, paddingTop: 8 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  skeletonCopy: { flex: 1, gap: 8 },
  skeletonValue: { alignItems: 'flex-end', gap: 8 },
  skeletonGap: { marginTop: 12 },
  skeletonGapTight: { marginTop: 8 },
  skeletonSpacer: { flex: 1 },
  skeletonTabs: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 6,
  },
  loadingMore: { paddingVertical: 20, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: c.textSecondary, fontSize: 15, fontWeight: '600', fontFamily: F },
  holdingsRetryBtn: {
    marginTop: 14,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: c.text,
  },
  holdingsRetryText: {
    color: c.background,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: F,
  },

  // Every measurement below mirrors the own profile's Holdings tab (tokenRow /
  // tokenSymbol / tokenValue there), so a portfolio reads identically whether
  // it is yours or someone else's. Only the horizontal inset is local: this
  // list is a FlatList, so each row carries the padding the own profile's
  // scroll container applies once.
  holdingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  holdingRowPressed: { opacity: 0.72 },
  // ClosedPositionRow receives this gutter from the own profile's shared
  // holdings container. FlatList cells need to provide that same gutter here.
  closedPositionWrap: { paddingHorizontal: 20 },
  // Groups each holding type into its own collapsible drawer.
  holdingIconFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdingIconFallbackText: { color: c.icon, fontSize: 12, fontWeight: '800', fontFamily: F },
  holdingInfo: { flex: 1, minWidth: 0 },
  holdingName: { color: c.text, fontSize: 15, fontWeight: '800', fontFamily: F },
  holdingSub: { marginTop: 2, color: c.textTertiary, fontSize: 12, fontWeight: '600', fontFamily: F },
  holdingSide: { marginTop: 1, fontSize: 16, lineHeight: 19, fontFamily: Fonts.displayOne, letterSpacing: 0.2 },
  // The shared sandwich card carries no gutter of its own.
  holdingCardWrap: { paddingHorizontal: 20 },
  holdingRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 1 },
  holdingValue: {
    color: c.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    fontFamily: F,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  holdingChange: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    fontFamily: F,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
});
