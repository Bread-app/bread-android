import { useEmbeddedSolanaWallet, usePrivy } from "@privy-io/expo";
import { Stack, router as expoRouter, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  useWindowDimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  FlatList,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  useDerivedValue,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { ScaleRuler } from "@/components/scale-ruler";
import { LegTapHint } from "@/components/leg-tap-hint";
import { LoadErrorState } from "@/components/load-error-state";
import { ShareIcon } from "@/components/share-icon";
import { RemixIcon } from "@/components/remix-icon";
import {
  CTA_BUTTON_HEIGHT,
  CTA_GLASS_SCALE,
  CTA_LABEL_FONT,
  CTA_LABEL_SIZE,
  CTA_SOLID_SCALE,
  CtaGlassFill,
  ctaGlassTint,
} from "@/components/side-glass-button";
import { VerifiedBadge } from "@/components/verified-badge";
import { FollowButton } from "@/components/follow-button";
import { AssetLogo as RemoteAssetLogo } from "@/components/asset-logo";
import { PressableScale } from "@/components/pressable-scale";
import { NewsFeed } from "@/components/news/news-feed";
import { markLegTapHintSeen, shouldShowLegTapHint } from "@/lib/leg-tap-hint";
import { buildNewsStories, setActiveNewsStory, type NewsStory } from "@/lib/news-feed";
import { SandwichPositionCard } from "@/components/sandwich-position-card";
import { ScrubReturnText } from "@/components/scrub-return-text";
import { useComposeAction } from "@/components/compose-fab";
import { PositionTakesSection } from '@/components/position-takes-section';
import { TakeCard } from '@/components/take-card';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { SandwichResearchCard } from "@/components/sandwich-research-card";
import { RecommendedSandwiches } from "@/components/recommended-sandwiches";
import { Fonts, Motion, type ThemeColors } from "@/constants/theme";
import { withAlpha } from "@/lib/color-utils";
import { formatSandwichDetailDateTime } from "@/lib/sandwich-detail-date";
import { markShareNudgeDismissed, shouldShowShareNudge } from "@/lib/share-nudge";
import {
  formatTimestamp,
  getMomentWindow,
  momentReceiptLine,
  type MomentWindow,
} from "@/lib/moment";
import { YouTubeClipPlayer, type YouTubeClipPlayerHandle } from "@/components/youtube-clip-player";
import { useSavedStore } from "@/lib/saved-store";
import { useThemeStore } from "@/lib/theme-store";
import { userDisplayName } from "@/lib/user-display";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import {
  dismissSandwichFx,
  updateSandwichFx,
  useTradeFx,
  type SandwichFxEvent,
} from "@/lib/trade-fx";
import { type PodcastGroupVideo } from "@/components/podcast-sandwich-group-card";
import { CookingOverlay, NotifyHandoffOverlay } from "@/components/cooking-overlay";
import { startPodcastSpec } from "@/lib/podcast-job";
import {
  SandwichBasketChart,
  type SandwichChartRange,
} from "@/components/sandwich-basket-chart";
import { AnimatedScrubText } from "@/components/animated-scrub-text";
import {
  StockDetailSheet,
  type StockDetailSheetRef,
} from "@/components/stock-detail-sheet";
import { SandwichLegCard } from "@/components/sandwich-leg-card";
import {
  SandwichShareSheet,
  type SandwichShareSheetRef,
} from "@/components/sandwich-share-sheet";
import { TradeAmountPad } from "@/components/trade-amount-sheet";
import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import {
  SandwichCommentsSheet,
  type SandwichCommentsSheetRef,
} from "@/components/sandwich-comments-sheet";
import { UserProfileScreen } from "@/screens/user-profile-screen";
import {
  humanizeErrorMessage,
  Sandwich,
  SandwichDirection,
  SandwichLeg,
  SandwichResearch,
  appUserPayloadFromPrivyUser,
  closePredictionPosition,
  commitSandwichDraft,
  MAX_COMMENTARY_LENGTH,
  MAX_PERP_SANDWICH_LEGS,
  PAYWALLED_ARTICLE_WARNING,
  createJupiterOrder,
  createManualSandwich,
  createSandwichFromInput,
  youTubeWatchUrl,
  isYouTubeUrl,
  executeJupiterOrder,
  getCachedPosts,
  getSandwichById,
  getUserProfile,
  getPostPage,
  getSavedStock,
  searchJupiterToken,
  getTokenNews,
  getCurrentPrompt,
  getTopHolderStocks,
  setCardLike,
  submitPredictionTransaction,
  startSandwichSell,
  submitSignedBasketBuy,
  searchUsers,
  followUser,
  unfollowUser,
  type ManualSandwichLegInput,
  type SandwichPost,
  type SocialUser,
  type Stock,
  type NewsItem,
  type AppUserPayload,
  type DailyPrompt,
  type WalletBalanceToken,
} from "@/lib/api";
import {
  applyCardSocialToPosts,
  cardSocial,
  POST_COMMENTS_ENABLED,
  toggledCardSocial,
} from "@/lib/card-social";
import {
  settleJupUsdToCash,
} from "@/lib/cash";
import { type UseCashValue } from "@/hooks/use-cash";
import { useWalletStore } from "@/lib/wallet-store";
import {
  SOLANA_USDC_MINT,
  isPositiveSmallestUnitAmount,
  isValidDisplayAmount,
  toSmallestUnits,
} from "@/lib/trading";
import {
  recordSandwichPositionSell,
  type SandwichPosition,
} from "@/lib/sandwich-positions";
import { demoSandwichExit } from "@/lib/demo-account";
import { isDemoBuyMode } from "@/lib/demo-buy-mode";
import { RotatingChevron } from "@/components/rotating-chevron";
import {
  valueSandwichPosition,
} from "@/lib/sandwich-holding-value";
import { useSandwichDetail } from "@/lib/sandwich-detail-store";
import { usePodcastGroup } from "@/lib/podcast-group-store";
import { useSandwichComposer } from "@/lib/sandwich-composer-store";
import { getAnonymousSocialId } from "@/lib/social-identity";
import { useComposerProgress } from "@/lib/composer-progress-store";
import { useToast } from "@/lib/toast-store";
import { nextManualSelection } from "@/lib/manual-sandwich-selection";
import { XSummonBadge } from "@/components/x-summon-badge";
import {
  ScaledSandwichSection,
  useSandwichActionSettings,
  useSandwichScaleSettings,
} from "@/components/dev-sandwich-scale-tool";
import {
  SourcePostCard,
  XPostPreview,
  isArticleSource,
  isXPostSource,
} from "@/components/x-post-preview";
import { SandwichPerpPanel } from "@/components/sandwich-perp-panel";
import { useSandwichBuy } from "@/hooks/use-sandwich-buy";
import {
  findPhoenixMarketForAsset,
  listPhoenixMarkets,
  type PhoenixMarket,
} from "@/lib/phoenix-api";
import { resolveLegVenue } from "@/lib/sandwich-leg-venue";
import { useStockDetail } from "@/lib/stock-detail-store";
import type { ZoomSourceRect } from "@/lib/zoom-transition";
import {
  NATIVE_ZOOM_TARGET_TEST_ID,
} from "@/lib/native-zoom";
import { detectLinkPreview, type LinkPreview } from "@/lib/link-preview";
import type { ToastState } from "@/lib/toast-state";
import { useSandwichTradeSheet } from "@/lib/sandwich-trade-sheet-store";
import { HeartToggle, type HeartToggleRef } from "@/components/heart-toggle";
import { HandleText } from "@/components/handle-text";
import { DailyPromptBanner, DailyPromptCard } from "@/components/daily-prompt-card";
import {
  PodcastGroupCard,
  RemixCitation,
  SandwichCard,
  SandwichLegRow,
  SourceVideoCard,
  type LegCardOrigin,
} from "@/components/sandwich-card";
import {
  EMPTY_FEED,
  LIKE_PINK,
  PLATFORM_ICON,
  buildFeedItemsFromPosts,
  sortPosts,
  formatMoneyUsd,
  formatSocialCount,
  getAvatarColor,
  getBuilderMeta,
  getCreatorMeta,
  getBuilderTake,
  getLegPrimaryLine,
  getLegTitle,
  getSourceAuthorMeta,
  getSourceVideo,
  getThesisBullets,
  getThesisDescription,
  stockPreviewFromLeg,
  type FeedItem,
  type FeedSort,
  type SourceVideo,
} from "@/lib/sandwich-feed";

const F = Fonts.rounded;

// The buy / sell pad's sheet fill: the page's own surface, opaque, so the
// page's BUY bar never shows through under the keypad. (Was fixed white while
// the pad's palette was hardcoded light; the pad is themed now.)
const tradeSheetBg = (c: ThemeColors) => c.background;
// The post preview inside it — one step off the sheet so it reads as a
// quoted object on it.
const tradePreviewBg = (c: ThemeColors) => c.surfaceAlt;

const FILTER_OUTLINE = "#000000";
const FILTER_OUTLINE_RADIUS = 3;
const FILTER_OUTLINE_OFFSETS: [number, number][] = Array.from(
  { length: 24 },
  (_, i): [number, number] => {
    const angle = (Math.PI * 2 * i) / 24;
    return [
      Math.cos(angle) * FILTER_OUTLINE_RADIUS,
      Math.sin(angle) * FILTER_OUTLINE_RADIUS,
    ];
  },
);

const FEED_SORT_LABEL: Partial<Record<FeedSort, string>> = {
  recent: "Recent",
  pnl: "Top PnL",
};

/**
 * The For You feed's order, as a quiet text button in the header's top-right:
 * the current order + a swap glyph. Two orders only, so a tap flips them.
 */
function FeedSortToggle({
  value,
  onChange,
}: {
  value: FeedSort;
  onChange: (next: FeedSort) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const next: FeedSort = value === "pnl" ? "recent" : "pnl";
  const label = FEED_SORT_LABEL[value] ?? "Recent";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sorted by ${label}`}
      accessibilityHint={`Switches to ${FEED_SORT_LABEL[next]}`}
      onPress={() => onChange(next)}
      hitSlop={10}
      style={({ pressed }) => [styles.feedSortToggle, pressed && styles.feedSortTogglePressed]}
    >
      <Text style={styles.feedSortToggleText}>{label}</Text>
      <Ionicons name="swap-vertical" size={15} color={colors.textTertiary} />
    </Pressable>
  );
}

function FilterLabel({ label, active }: { label: string; active: boolean }) {
  const styles = useThemedStyles(makeStyles);

  if (!active) {
    return <Text style={styles.filterText}>{label}</Text>;
  }

  return (
    <View style={styles.filterStack}>
      {FILTER_OUTLINE_OFFSETS.map(([dx, dy], i) => (
        <Text
          key={i}
          style={[
            styles.filterTextActive,
            styles.filterOutline,
            { left: dx, top: dy, color: FILTER_OUTLINE },
          ]}
        >
          {label}
        </Text>
      ))}
      <View>
        <Text style={[styles.filterTextActive, { color: "#ffffff" }]}>{label}</Text>
        <MaskedView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          maskElement={<Text style={[styles.filterTextActive, { color: "#ffffff" }]}>{label}</Text>}
        >
          <LinearGradient
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0)", "#FAFAFD"]}
            locations={[0, 0.9, 1]}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      </View>
    </View>
  );
}
// Heavy Rubik face for the big P&L numbers + BUY label; Poppins SemiBold for
// the thesis copy (per the detail-sheet design spec).
const F_DISPLAY = Fonts.display;
const F_DISPLAY_MEDIUM = Fonts.displayMedium;
const F_MONO = Fonts.mono;
const HAS_GLASS = isGlassEffectAPIAvailable();


function getErrorMessage(error: unknown) {
  return humanizeErrorMessage(error, "Could not create Sandwich right now.");
}

function deserializeJupiterTransaction(
  base64Transaction: string,
): Transaction | VersionedTransaction {
  const bytes = Buffer.from(base64Transaction, "base64");

  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

function serializeSignedTransaction(
  transaction: Transaction | VersionedTransaction,
): Uint8Array {
  if (transaction instanceof VersionedTransaction) {
    return transaction.serialize();
  }

  return transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
}


/**
 * Shown under a sandwich's full reasoning, where someone who read it will see
 * it before acting.
 *
 * PLACEHOLDER COPY — written to say the true things about what this product
 * does (it derives tradeable baskets from someone else's published view; it
 * does not advise), but it is not drafted or reviewed legal language and should
 * be replaced with wording your counsel signs off on.
 */
const DISCLAIMER_TEXT =
  "Bread turns published views into tradeable baskets. It is not investment " +
  "advice, a recommendation, or an offer to buy or sell anything, and nothing " +
  "here is personalised to you. Assets are routed to whatever liquid markets " +
  "exist — prices, fills and returns can differ from what a source said, and " +
  "you can lose money. Do your own research.";






/**
 * CARDS per request. `/api/posts` pages over the Post table, so one row of the
 * reply is one card and a page is a screenful — the card-counting loop and its
 * `MIN_FEED_CARDS` / `MAX_*_PAGES` ceilings existed only because the old
 * endpoint paged over markets.
 */
const FEED_PAGE_SIZE = 20;





function SandwichLoadingScreen() {
  const styles = useThemedStyles(makeStyles);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading posts"
      style={styles.sandwichLoadingScreen}
    >
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.sandwichSkeletonCard}>
          <View style={styles.sandwichSkeletonAvatar} />
          <View style={styles.sandwichSkeletonContent}>
            <View style={styles.sandwichSkeletonByline}>
              <View style={styles.sandwichSkeletonHandle} />
              <View style={styles.sandwichSkeletonTime} />
            </View>
            <View style={styles.sandwichSkeletonBodyLong} />
            <View style={styles.sandwichSkeletonBodyMedium} />
            {index !== 1 ? <View style={styles.sandwichSkeletonBodyShort} /> : null}
            <View style={styles.sandwichSkeletonActions}>
              <View style={styles.sandwichSkeletonActionGroup}>
                <View style={styles.sandwichSkeletonAction} />
                <View style={styles.sandwichSkeletonAction} />
                <View style={styles.sandwichSkeletonAction} />
              </View>
              <View style={styles.sandwichSkeletonPill} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

interface SandwichBuySheetProps {
  sandwich: Sandwich | null;
  onClose: () => void;
  onToast: (toast: ToastState, duration?: number) => void;
  /**
   * Play the Sandwich celebration — the legs stacking into a sandwich, then the
   * basket's logos raining down. Handed up to the host screen rather than fired
   * here, so the overlay lives above every sheet this pad can sit inside.
   */
  onCelebrate?: (event: SandwichFxEvent) => void;
  /**
   * Cash data + wallet store, computed by the sheet *body* and passed in as
   * props. The pad renders inside gorhom's portal, where `WalletStoreProvider`
   * is out of scope and `useWalletStore`/`useCash` read back an empty store —
   * collapsing the cash balance to $0.00. See [[bottom-sheet-context-loss]].
   */
  cash: UseCashValue;
  walletStore: ReturnType<typeof useWalletStore>;
  onRequestAddCash?: () => void;
  onPositionUpdated?: (position: SandwichPosition | null) => void;
}

export function SandwichBuyPad({
  sandwich,
  onClose,
  onToast,
  onCelebrate,
  cash,
  walletStore,
  onRequestAddCash,
  onPositionUpdated,
  initialAmount,
}: SandwichBuySheetProps & { initialAmount?: string | null }) {
  const buyPadStyles = useThemedStyles(makeBuyPadStyles);
  const { colors } = useThemeStore();
  // Everything about executing this sandwich — amount, gates, live terms, perp
  // risk, and the buy itself — lives in the shared engine, so the podcast call
  // sheet buys a call exactly the way this pad buys a sandwich.
  const buy = useSandwichBuy({
    sandwich,
    onClose,
    onToast,
    onCelebrate,
    cash,
    walletStore,
    onRequestAddCash,
    onPositionUpdated,
    initialAmount,
  });
  const {
    buyAmount,
    buying,
    sheetMessage,
    predictionNote,
    canBuy,
    needsCash,
    belowMin,
    minBuyDisplay,
    detailRows: buyDetailRows,
    tradeNotice,
    availabilityPending,
    isPerp,
    perpSide,
    perpRisk,
    leverage,
    changeLeverage,
    tapKey,
    tapPreset,
    buySandwich,
    warmBuy,
  } = buy;

  const thesisText = sandwich ? getBuilderTake(sandwich) : null;

  // A perp entry spends the slot on risk controls instead. The quote survives as
  // one bare line — the card chrome (avatar row, padding, video) is ~90pt, which
  // is the difference between the confirm button fitting and being pushed off
  // the sheet. The user just came from the card that showed all of it.
  const thesisCard = isPerp ? (
    thesisText ? (
      <Text numberOfLines={1} style={buyPadStyles.thesisCompactText}>
        &quot;{thesisText}&quot;
      </Text>
    ) : null
  ) : (
    <SandwichTradeThesisCard sandwich={sandwich} />
  );
  const confirmationContent = (
    <>
      {thesisCard}
      {isPerp ? (
        <SandwichPerpPanel
          side={perpSide}
          risk={perpRisk}
          leverage={leverage}
          onChangeLeverage={changeLeverage}
        />
      ) : null}
    </>
  );

  return (
    <TradeAmountPad
      side="buy"
      // Perp calls need an explicit direction in the header; spot retains its
      // compact, thesis-led header.
      title={isPerp ? `${perpSide === "long" ? "Long" : "Short"} Perps` : ""}
      accentColor={
        needsCash
          ? colors.actionPrimary
          : isPerp && perpSide === "short"
            ? colors.actionSell
            : undefined
      }
      // Native iOS Liquid Glass confirm button (green for Buy, sky blue for Add cash).
      // The buy pad is a tall (82%) sheet — keep the amount + thesis fixed in
      // their flex slot instead of letting that area scroll/bounce when tapped.
      scrollEnabled={false}
      amount={buyAmount}
      message={sheetMessage}
      amountNote={predictionNote}
      // Terms live in the footer, so an empty quote slot would lift the
      // number above the midpoint between the sheet top and the post.
      reservePreviewSpace={false}
      submitting={buying}
      canConfirm={canBuy}
      availableLabel={`Cash balance: $${cash.totalCash.toFixed(2)}`}
      thesisContent={confirmationContent}
      detailRows={buyDetailRows}
      noticeText={tradeNotice}
      noticeCollapsible
      noticeLabel="Check this trade"
      presets={[]}
      onSubmit={needsCash && onRequestAddCash ? onRequestAddCash : buySandwich}
      // Builds and simulates the Phoenix order during the press, so the tap
      // itself is only sign + send — the spot pad warms its swap the same way.
      onSubmitPressIn={needsCash ? undefined : warmBuy}
      onTapDigit={tapKey}
      onTapPreset={tapPreset}
      slideToConfirm
      addCash={needsCash}
      // A perp opens a Long or a Short; "Buy" is the spot verb and would read
      // as backwards on a short.
      actionLabel={
        isPerp
          ? perpSide === "long"
            ? "Long"
            : "Short"
          : availabilityPending
            ? "Checking"
            : undefined
      }
      confirmLabel={
        needsCash
          ? "Add cash"
          : belowMin && minBuyDisplay !== null
            ? `Minimum $${minBuyDisplay}`
            : // Withheld so the pad slides instead: there is nothing left to
              // say that the slider does not, and the gesture is the
              // confirmation the tap used to stand in for.
              undefined
      }
      submittingLabel={isPerp ? "Opening..." : "Buying..."}
      // No chevron on either side of this pad. It was a second dismissal
      // competing with the sheet's own drag handle directly above it, which
      // already closes the sheet — so the affordance cost header space without
      // adding a way out.
    />
  );
}

/**
 * The sandwich's take, above the keypad on a trade pad.
 *
 * Shared by the buy and the sell pad: selling is a decision about the same
 * idea, and the sell pad used to show a bare "Sell" title where the buy pad
 * showed the post. Rendered null when there is nothing to say — no take, no
 * embed — so a pad with no thesis shows empty space rather than empty chrome.
 */
function SandwichTradeThesisCard({ sandwich }: { sandwich: Sandwich | null }) {
  const buyPadStyles = useThemedStyles(makeBuyPadStyles);
  const thesisText = sandwich ? getBuilderTake(sandwich) : null;
  const creator = sandwich ? getBuilderMeta(sandwich) : null;
  const sourceVideo = sandwich ? getSourceVideo(sandwich) : null;
  const isXPost = sandwich ? isXPostSource(sandwich.source) : false;

  if (!thesisText && !sourceVideo && !isXPost) return null;

  return (
    <View style={buyPadStyles.thesisCard}>
      {/* The AUTHOR, not the builder. A sourced sandwich is quoting someone —
          the post's own author, the episode's own channel — and those embeds
          carry their identity themselves. Only an own thesis has no one else to
          credit, and there the builder IS the author. */}
      {creator && !sourceVideo && !isXPost ? (
        <View style={buyPadStyles.thesisCreatorRow}>
          {creator.avatarUrl ? (
            <Image
              source={{ uri: creator.avatarUrl }}
              style={buyPadStyles.thesisAvatar}
            />
          ) : (
            <View style={[buyPadStyles.thesisAvatar, buyPadStyles.thesisAvatarFallback]}>
              <Text style={buyPadStyles.thesisAvatarInitials}>{creator.initials}</Text>
            </View>
          )}
          <Text style={buyPadStyles.thesisCreatorName} numberOfLines={1}>
            <Text style={buyPadStyles.thesisCreatorAt}>@</Text>
            {creator.name.replace(/^@/, "").toLowerCase()}
          </Text>
          {sandwich && sandwich.source.sourceType !== "x_summon" ? (
            <VerifiedBadge size={14} />
          ) : null}
          {sandwich ? <XSummonBadge sandwich={sandwich} size="xs" /> : null}
        </View>
      ) : null}
      {sourceVideo ? (
        // Video-born sandwich: show the video card, not its title in quotes
        // as if the creator wrote it.
        <SourceVideoCard video={sourceVideo} compact />
      ) : isXPost && sandwich ? (
        // Same rule for a post: show the post, under its own author. Quoting it
        // as the builder's line would credit them with someone else's words.
        <XPostPreview source={sandwich.source} compact maxLines={3} />
      ) : thesisText ? (
        <Text numberOfLines={3} style={buyPadStyles.thesisCardText}>
          {thesisText}
        </Text>
      ) : null}
    </View>
  );
}

const makeBuyPadStyles = (c: ThemeColors) => StyleSheet.create({
  // The post being bought, laid out like a feed card in miniature: byline on
  // top, the take underneath, left-aligned on a white card. The sheet is
  // opaque now, so the card is too — a translucent panel had nothing to show.
  thesisCard: {
    alignSelf: "stretch",
    backgroundColor: tradePreviewBg(c),
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
    // Breathing room under the card so the post doesn't sit flush against the
    // top row of the keypad.
    marginBottom: 16,
    gap: 8,
  },
  thesisCreatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  thesisAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.actionBuy,
  },
  thesisAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.actionBuy,
  },
  thesisAvatarInitials: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
    fontFamily: F,
  },
  thesisCreatorName: {
    flexShrink: 1,
    color: c.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: F,
  },
  thesisCreatorAt: {
    color: c.textSecondary,
    fontWeight: "700",
  },
  thesisVerifiedBadge: {
    width: 16,
    height: 16,
    resizeMode: "contain",
  },
  thesisCardText: {
    color: c.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    fontFamily: F,
    textAlign: "left",
  },
  // Perp variant of the quote — no card, no avatar, one line.
  thesisCompactText: {
    alignSelf: "stretch",
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: F,
    textAlign: "center",
  },
});

export type SandwichBuyOverlayRef = {
  open: (sandwich: Sandwich) => void;
  close: () => void;
  /** Drop the pad with no animation — for a route change or a hand-off to another sheet. */
  hideImmediately: () => void;
};

export type SandwichBuyOverlayProps = {
  onToast: (toast: ToastState, duration?: number) => void;
  onCelebrate?: (event: SandwichFxEvent) => void;
  /**
   * Cash + wallet store, read by the HOST screen and passed down. See
   * [[bottom-sheet-context-loss]] — reading them inside a portalled sheet body
   * returns an empty store and collapses the balance to $0.00.
   */
  cash: UseCashValue;
  walletStore: ReturnType<typeof useWalletStore>;
  onRequestAddCash?: () => void;
  /**
   * Open progress (-1 closed → 0 open), for a host that animates behind the pad.
   * The detail screen passes its own shared value so the page recedes; hosts
   * that don't care can omit it and the overlay keeps its own.
   */
  progress?: SharedValue<number>;
  onOpenChange?: (open: boolean) => void;
};

/**
 * The buy pad and the sheet it lives in — a tall in-screen overlay rather than a
 * modal, so it composes with whatever the host is already animating.
 *
 * Opened imperatively through the ref, from the tap handler, for the reason in
 * [[bottom-sheet-present-pattern]]. It carries the whole buy experience for both
 * venues: the spot keypad and the perp keypad + leverage/stop sliders. That
 * matters for the podcast screen, where every timestamped call is its own
 * Sandwich — routing a short there through a single-market order pad would have
 * executed the lead ticker and silently dropped the call's other weighted legs.
 */
export const SandwichBuyOverlay = forwardRef<SandwichBuyOverlayRef, SandwichBuyOverlayProps>(
  function SandwichBuyOverlay(
    { onToast, onCelebrate, cash, walletStore, onRequestAddCash, progress, onOpenChange },
    ref,
  ) {
    const styles = useThemedStyles(makeBuyOverlayStyles);
    const insets = useSafeAreaInsets();
    // Explicit pixel height, not `82%`. A percentage resolves against whatever
    // the host happens to give this absolutely-positioned view, and when that
    // parent has no definite height the sheet silently sizes to its content —
    // which lets the dialpad and confirm button slide off the bottom edge.
    const { height: windowHeight } = useWindowDimensions();
    const sheetHeight = Math.round(windowHeight * 0.82);
    const [sandwich, setSandwich] = useState<Sandwich | null>(null);
    const [open, setOpen] = useState(false);

    const ownIndex = useSharedValue(-1);
    const index = progress ?? ownIndex;
    // Live finger offset while dragging the pad down to dismiss. Added on top of
    // the index-driven translate so the sheet follows the drag, then either
    // snaps back to 0 or rides the close animation out.
    const dragY = useSharedValue(0);

    const setOpenState = useCallback(
      (next: boolean) => {
        setOpen(next);
        onOpenChange?.(next);
      },
      [onOpenChange],
    );

    const hideImmediately = useCallback(() => {
      Keyboard.dismiss();
      index.value = -1;
      dragY.value = 0;
      setOpenState(false);
    }, [dragY, index, setOpenState]);

    const close = useCallback(() => {
      Keyboard.dismiss();
      // Ride any in-progress drag out alongside the index animation so the sheet
      // slides cleanly off-screen. Springs (not timing) so a fast re-tap on the
      // trigger can grab the sheet mid-close and reverse it without a hard cut
      // (Apple §3 interruptibility). Critically damped — no bounce on a
      // non-momentum close.
      dragY.value = withSpring(0, Motion.spring.snap);
      index.value = withSpring(-1, Motion.spring.reveal, (finished) => {
        if (finished) runOnJS(setOpenState)(false);
      });
    }, [dragY, index, setOpenState]);

    const openWith = useCallback(
      (next: Sandwich) => {
        Keyboard.dismiss();
        setSandwich(next);
        dragY.value = 0;
        setOpenState(true);
        // Critically damped spring — purposeful open, no overshoot (Apple §4).
        index.value = withSpring(0, Motion.spring.reveal);
      },
      [dragY, index, setOpenState],
    );

    useImperativeHandle(ref, () => ({ open: openWith, close, hideImmediately }), [
      close,
      hideImmediately,
      openWith,
    ]);

    const backdropStyle = useAnimatedStyle(() => ({
      opacity:
        interpolate(index.value, [-1, 0], [0, 1], Extrapolation.CLAMP) *
        interpolate(dragY.value, [0, 300], [1, 0.2], Extrapolation.CLAMP),
    }));
    const overlayStyle = useAnimatedStyle(() => ({
      opacity: interpolate(index.value, [-1, 0], [0, 1], Extrapolation.CLAMP),
      transform: [
        {
          translateY:
            interpolate(index.value, [-1, 0], [72, 0], Extrapolation.CLAMP) + dragY.value,
        },
      ],
    }));

    const pan = useMemo(
      () =>
        Gesture.Pan()
          .activeOffsetY(12)
          // Yield immediately to the leverage ruler's horizontal scrub. Waiting
          // 20pt here made the parent sheet hold the gesture long enough for the
          // sandwich-perp slider to feel inert.
          .failOffsetX([-4, 4])
          .onUpdate((e) => {
            "worklet";
            if (e.translationY >= 0) {
              dragY.value = e.translationY;
            } else {
              // Rubber-band upward drag (WWDC 2018 formula) — resistance
              // increases progressively so the sheet feels responsive at its
              // seat, not frozen.
              const overshoot = -e.translationY;
              const dim = 480; // roughly a sheet's vertical dimension
              const damped = (overshoot * dim * 0.55) / (dim + 0.55 * overshoot);
              dragY.value = -damped;
            }
          })
          .onEnd((e) => {
            "worklet";
            // Apple momentum projection — where would the finger, decelerating
            // from its release velocity, come to rest? Dismiss if that
            // projected point crosses roughly a third of the sheet.
            const decel = 0.998;
            const projected = e.translationY + (e.velocityY / 1000) * (decel / (1 - decel));
            if (projected > 160) {
              runOnJS(close)();
            } else {
              // Spring back with velocity handoff so the return matches the
              // pace the user let go at (no visible seam at release).
              dragY.value = withSpring(0, { ...Motion.spring.settle, velocity: e.velocityY });
            }
          }),
      [close, dragY],
    );

    if (!open) return null;

    return (
      <>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close buy sheet"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              styles.overlay,
              overlayStyle,
              { height: sheetHeight, paddingBottom: Math.max(insets.bottom, 40) },
            ]}
          >
            <View style={styles.handle} />
            {/* Binds the pad to the sheet's box. Without it the pad's own
                `flex: 1` root measures against an unbounded parent and sizes to
                content, which pushes the dialpad + confirm button past the
                sheet's bottom edge — the button simply vanishes off-screen. */}
            <View style={styles.padFill}>
              <SandwichBuyPad
                sandwich={sandwich}
                onClose={close}
                onToast={onToast}
                onCelebrate={onCelebrate}
                cash={cash}
                walletStore={walletStore}
                onRequestAddCash={onRequestAddCash}
              />
            </View>
          </Animated.View>
        </GestureDetector>
      </>
    );
  },
);

const makeBuyOverlayStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 20,
      // Deliberately light: the pad above it is glass, and a heavier dim would
      // leave the material nothing worth refracting.
      backgroundColor: "rgba(15, 23, 42, 0.10)",
    },
    overlay: {
      // Anchored to the bottom (no `top`) and given a fixed 82%-of-screen height so
      // it reads as a tall sheet — the amount entry + thesis sit centered in the
      // upper flex slot (TradeAmountPad), with the dialpad + Buy pinned to the
      // bottom — rather than a short content-height drawer.
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 30,
      paddingHorizontal: 16,
      paddingBottom: 28,
      // Opaque, pinned light — the pad's own palette is hardcoded light, and
      // the page underneath is dimmed by the backdrop, not seen through.
      backgroundColor: tradeSheetBg(c),
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      shadowColor: c.text,
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.08,
      shadowRadius: 18,
      elevation: 12,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginTop: 10,
      marginBottom: 4,
    },
    // `minHeight: 0` matters as much as `flex: 1` — without it the flex child
    // refuses to shrink below its content and the overflow comes straight back.
    padFill: { flex: 1, minHeight: 0 },
  });

// ─── SandwichComposerScreen (picker → prompt | manual → review → confirm) ──

// "preview" is the read-only "Preview sandwich" step shown after the AI builds
// a draft: the user sees the thesis, a performance preview chart and the legs,
// then taps "Looks good" to persist. Tapping a leg drops into "review" to edit.
type ComposerMode = "picker" | "prompt" | "preview" | "review";

/** How long the "we'll notify you" beat holds before the composer pops itself. */
const PODCAST_HANDOFF_MS = 2600;

type ComposerDraft = {
  thesisId: string | null;
  isManual: boolean;
  /** Null means normal routing; `perp` preserves an explicit picker choice. */
  executionVenue: "perp" | null;
  name: string;
  summary: string;
  horizon: string;
  direction: SandwichDirection;
  confidence: string;
  thesisText: string;
  /** The builder's own read — the headline of the published card. */
  commentary: string;
  warnings: string[];
  /** Grounded research behind the draft. Null for manual drafts. */
  research: SandwichResearch | null;
  legs: SandwichLeg[];
  // Stable timestamp used to anchor the preview chart's basket history. The
  // draft isn't persisted yet so it has no server createdAt of its own.
  createdAt: string;
  /** The sandwich this draft remixes. Null for everything else. */
  remixOf: { sandwichId: string; builderUsername: string | null; builderName: string | null; builderAvatarUrl: string | null; name: string; summary: string } | null;
};

function makeManualDraft(): ComposerDraft {
  return {
    thesisId: null,
    isManual: true,
    executionVenue: null,
    name: "",
    summary: "",
    horizon: "weeks",
    direction: "up",
    confidence: "medium",
    thesisText: "",
    commentary: "",
    warnings: [],
    // A hand-stacked sandwich was never researched, and must not borrow the
    // credibility of a research card it didn't earn.
    research: null,
    legs: [],
    createdAt: new Date().toISOString(),
    remixOf: null,
  };
}

/**
 * "I'd do this differently": the parent's basket, as a hand-built draft the
 * viewer owns. Composition, direction and venue carry over — that's the thing
 * being corrected. The take does not: an empty take is the prompt to say what
 * they'd change. Research doesn't either — the remixer didn't do it, and a
 * card must not borrow credibility it didn't earn (same rule as a manual draft).
 */
function draftForRemix(parent: Sandwich): ComposerDraft {
  // Prediction legs can no longer be published (the server 400s them), so a
  // legacy parent that has one is remixed without it.
  const spotLegs = [...parent.legs]
    .sort((a, b) => a.order - b.order)
    .filter((leg) => leg.type !== "prediction_market");
  const legs =
    spotLegs.length === parent.legs.length ? spotLegs : rebalanceLegsEqually(spotLegs);
  return {
    ...makeManualDraft(),
    executionVenue: parent.venue === "perp" ? "perp" : null,
    name: parent.name,
    summary: "",
    horizon: parent.horizon,
    direction: parent.direction,
    confidence: parent.confidence,
    thesisText: "",
    legs: legs.map((leg) => sideForDirection(leg, parent.direction)),
    remixOf: { sandwichId: parent.id, builderUsername: parent.builder?.username ?? null, builderName: parent.builder?.name ?? null, builderAvatarUrl: parent.builder?.avatarUrl ?? null, name: parent.name, summary: parent.commentary?.trim() || parent.summary },
  };
}

function draftFromSandwich(sandwich: Sandwich): ComposerDraft {
  return {
    thesisId: sandwich.thesisId,
    isManual: false,
    executionVenue: sandwich.venue === "perp" ? "perp" : null,
    name: sandwich.name,
    summary: sandwich.summary,
    horizon: sandwich.horizon,
    direction: sandwich.direction,
    confidence: sandwich.confidence,
    thesisText: sandwich.thesis?.summary ?? sandwich.summary,
    commentary: sandwich.commentary ?? "",
    warnings: sandwich.warnings,
    research: sandwich.research,
    legs: [...sandwich.legs].sort((a, b) => a.order - b.order),
    createdAt: sandwich.createdAt ?? new Date().toISOString(),
    remixOf: null,
  };
}

function makeLegId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

// Equal allocation in basis points that always sums to 10000 (100%), with any
// rounding remainder folded into the first leg — mirrors the curated/portfolio
// basket's `equalWeights`. Used so the user just picks legs and the weights are
// assigned automatically, then fine-tuned afterwards.
function equalWeightBps(count: number): number[] {
  if (count <= 0) return [];
  const basePercent = Math.floor(100 / count);
  const remPercent = 100 - basePercent * count;
  return Array.from({ length: count }, (_, i) => (basePercent + (i === 0 ? remPercent : 0)) * 100);
}

function rebalanceLegsEqually(legs: SandwichLeg[]): SandwichLeg[] {
  const weights = equalWeightBps(legs.length);
  return legs.map((leg, i) => ({ ...leg, order: i, weightBps: weights[i] }));
}

// Round every leg's ratio to a whole percentage point such that the integers
// always sum to exactly 100 — e.g. three equal legs (33.33/33.33/33.34)
// round independently to 33/33/33 (99!), but the largest-remainder method
// used here hands the leftover point(s) to whichever leg(s) had the biggest
// fractional part, giving 33/33/34. Used for every on-screen leg percentage
// in the composer so the numbers a user sees always add up to 100.
function fairPercents(ratios: number[]): number[] {
  "worklet";
  const n = ratios.length;
  const floors = new Array<number>(n);
  const fracs = new Array<number>(n);
  let flooredSum = 0;
  for (let i = 0; i < n; i++) {
    const pct = Math.max(0, ratios[i] ?? 0) * 100;
    const f = Math.floor(pct);
    floors[i] = f;
    fracs[i] = pct - f;
    flooredSum += f;
  }
  const result = floors.slice();
  let remainder = Math.round(100 - flooredSum);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => fracs[b] - fracs[a]);
  for (let k = 0; k < order.length && remainder > 0; k++) {
    result[order[k]] += 1;
    remainder -= 1;
  }
  if (remainder < 0) {
    const trimOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => fracs[a] - fracs[b]);
    let over = -remainder;
    for (let k = 0; k < trimOrder.length && over > 0; k++) {
      if (result[trimOrder[k]] > 0) {
        result[trimOrder[k]] -= 1;
        over -= 1;
      }
    }
  }
  return result;
}

function legToCommitInput(leg: SandwichLeg): ManualSandwichLegInput {
  return {
    type: leg.type,
    label: leg.label,
    symbol: leg.symbol,
    underlyingSymbol: leg.underlyingSymbol,
    mint: leg.mint,
    marketId: leg.marketId,
    eventId: leg.eventId,
    question: leg.question,
    side: leg.side,
    weightBps: leg.weightBps,
    priceUsd: leg.priceUsd,
    volume24hUsd: leg.volume24hUsd,
    holderCount: leg.holderCount,
    closeTime: leg.closeTime,
    reason: leg.reason,
    matchSummary: leg.matchSummary,
    imageUrl: leg.imageUrl,
  };
}

/**
 * Force a leg's side to agree with the sandwich's direction.
 *
 * The server does exactly this on commit (`rowsForVenue`), so doing it in the
 * draft is what keeps the composer honest: what the review screen shows is what
 * gets published. Prediction legs are left alone — their YES/NO is not a
 * long/short — but they can no longer be composed anyway.
 */
function sideForDirection(leg: SandwichLeg, direction: SandwichDirection): SandwichLeg {
  if (leg.type === "prediction_market") return leg;
  const side = direction === "down" ? "short" : "long";
  return leg.side === side ? leg : { ...leg, side };
}

function stockToLeg(stock: Stock, weightBps: number): SandwichLeg {
  return {
    id: makeLegId("manual-stock"),
    order: 0,
    type: "tokenized_stock",
    venue: "spot",
    label: stock.name,
    imageUrl: stock.icon,
    symbol: stock.symbol,
    underlyingSymbol: stock.symbol.replace(/x$/i, ""),
    mint: stock.id,
    marketId: null,
    eventId: null,
    question: null,
    // Normalized against the draft's direction by `sideForDirection` on add.
    side: "long",
    weightBps,
    priceUsd: stock.usdPrice,
    currentPriceUsd: stock.usdPrice,
    // Composer-local draft: the same on-chain price the search row showed. A
    // draft leg is never quoted for a buy, so this only has to be honest, not
    // live — the committed leg gets the server's own on-chain price.
    onchainPriceUsd: stock.usdPrice,
    pnlPct: 0,
    volume24hUsd: stock.volume24h,
    holderCount: stock.holderCount,
    closeTime: null,
    reason: `Add ${stock.symbol} to express the thesis.`,
    matchSummary: null,
    // Hand-picked in the composer, so there is no generated reasoning to show.
    legRole: null,
    legMechanism: null,
    startMs: null,
    endMs: null,
    execution: { execution: "jupiter_swap" },
  };
}

function perpStockToLeg(stock: Stock, market: PhoenixMarket, weightBps: number): SandwichLeg {
  return {
    ...stockToLeg(stock, weightBps),
    id: makeLegId("manual-perp"),
    venue: "perp",
    label: market.name || stock.name,
    underlyingSymbol: market.symbol,
    reason: `Use the ${market.symbol} perpetual market to express the thesis.`,
    execution: { execution: "phoenix_perp" },
  };
}


/**
 * Full-screen "New sandwich" composer — the route at `(app)/sandwich-composer`,
 * pushed over the tab bar with the standard native side-push. Reads the viewer
 * identity (appUser + anonymousId) and the onCreated callback from the shared
 * {@link useSandwichComposer} provider, so the feed FAB opens the exact same
 * screen. Replaces the former `ComposerSheet` bottom sheet; the picker → prompt
 * → preview → review flow and every commit path are unchanged.
 */
export function SandwichComposerScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const pickerInsets = useSafeAreaInsets();
  const {
    appUser,
    anonymousId,
    avatarUrl: composerAvatarUrl,
    close,
    notifyCreated,
    getRemixSource,
    getPromptSource,
    getSeedText,
  } = useSandwichComposer();
  // The daily question this composer was opened to answer. Fixed for the life
  // of the screen; it rides along on whichever publish path the user takes.
  const [dailyPrompt] = useState(() => (getRemixSource() ? null : getPromptSource()));
  // The generating overlay paints over the notch, so it positions its own back
  // control rather than inheriting the SafeAreaView's padding.

  // A remix skips the prompt: the basket already exists, so it opens on review.
  // Opened from a news story, it lands on the text prompt with the headline
  // already typed — one tap from cooking, still editable.
  const [mode, setMode] = useState<ComposerMode>(() =>
    getRemixSource() ? "review" : getSeedText() ? "prompt" : "picker",
  );
  const [prompt, setPrompt] = useState(() => (getRemixSource() ? "" : getSeedText() ?? ""));
  // The long pipeline runs above the router, in ComposerProgressProvider, so
  // leaving this screen mid-build no longer strands it. What is left here is a
  // read of that one job plus the result hand-off below.
  const { job, result, runJob, clearJob, setComposerVisible } = useComposerProgress();
  // A running job holds the full-screen cooking state — but only until it is
  // durable. The moment the podcast exists on the server (`resume` is set) the
  // wait belongs to the banner and the push, not to this screen, so the overlay
  // drops and `handOff` below returns the user to the feed. A text thesis never
  // becomes durable, so it holds the overlay for its whole life, as before.
  const generating = job?.status === "running" && !job.resume;
  const stage = job?.stage ?? null;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComposerDraft | null>(() => {
    const parent = getRemixSource();
    return parent ? draftForRemix(parent) : null;
  });
  const isRemix = !!draft?.remixOf;
  // iOS uses a UIKit page sheet; other platforms keep the inline picker.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInitialCategory, setPickerInitialCategory] = useState<LegCategory>("stocks");
  // pickerSlideY: 0 = fully visible, positive = slid down off-screen.
  // Drives both the open/close animation and the live drag-to-dismiss gesture.
  const pickerSlideY = useSharedValue(600);

  const pickerBackdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pickerSlideY.value, [0, 400], [1, 0], Extrapolation.CLAMP),
  }));
  const pickerOverlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pickerSlideY.value }],
  }));

  const openPicker = useCallback((initialCategory: LegCategory = "stocks") => {
    Keyboard.dismiss();
    setPickerInitialCategory(initialCategory);
    if (Platform.OS === "ios") {
      setPickerOpen(true);
      return;
    }
    pickerSlideY.value = 600;
    setPickerOpen(true);
    pickerSlideY.value = withTiming(0, { duration: 260 });
  }, [pickerSlideY]);

  const closePicker = useCallback(() => {
    Keyboard.dismiss();
    if (Platform.OS === "ios") {
      setPickerOpen(false);
      return;
    }
    pickerSlideY.value = withTiming(600, { duration: Motion.duration.base }, (finished) => {
      if (finished) {
        runOnJS(setPickerOpen)(false);
        pickerSlideY.value = 600;
      }
    });
  }, [pickerSlideY]);

  const sheetDragGesture = Gesture.Pan()
    .onUpdate((e) => {
      pickerSlideY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 130 || e.velocityY > 600) {
        runOnJS(closePicker)();
      } else {
        pickerSlideY.value = withSpring(0, Motion.spring.settle);
      }
    });

  // Shared inline publish used by both the BQ-cook and YouTube flows. Errors
  // bubble up to the caller — no internal submitting state so the parent's
  // `generating` indicator covers the whole operation without flicker.

  // A 2–3h podcast is comprehended server-side: create the source, then hand
  // the wait off. Every timestamp is its own callable trade, so the episode is
  // NOT collapsed into a single sandwich — each one becomes its own market, in
  // the background, without the user being asked to approve a list of them.
  const startPodcast = useCallback(
    (url: string) => {
      Keyboard.dismiss();
      setError(null);
      // The whole pipeline — on-device captions, source creation, the durable
      // handoff, and the wait — lives in `startPodcastSpec` so the app-wide
      // progress provider can resume the same job at launch without reaching
      // into this screen.
      runJob(startPodcastSpec({ url, appUser }));
    },
    [appUser, runJob],
  );

  // Hand the user their app back the instant the episode is safe on the server.
  //
  // "Safe" is either of two things: the source exists and can be resumed, or the
  // analysis was already cached and is done. From that point the work outlives
  // the app, the markets are built without anyone watching, and a push says when
  // they are ready — so there is nothing here to preview and nothing to confirm.
  // The overlay says exactly that, holds for a beat, and pops the composer.
  //
  // Derived rather than state so the swap is one render: the frame where the
  // cooking overlay drops is the frame the hand-off appears, with no flash of
  // the composer underneath.
  const handoff =
    job?.kind === "podcast" && job.status !== "error" && (job.resume !== null || job.status === "ready");

  // Keyed on the job's identity, not the job object: the analysis keeps
  // reporting new stages behind this overlay, and re-running on each one would
  // cancel and never restart the timer that pops the screen.
  const handoffJobId = handoff ? job?.id ?? null : null;
  useEffect(() => {
    if (handoffJobId === null) return;
    Keyboard.dismiss();
    const timer = setTimeout(() => close(), PODCAST_HANDOFF_MS);
    return () => clearTimeout(timer);
  }, [close, handoffJobId]);

  const submitPrompt = useCallback((inputOverride?: string) => {
    const trimmed = (inputOverride ?? prompt).trim();
    if (!trimmed || generating) return;
    if (isYouTubeUrl(trimmed)) {
      startPodcast(trimmed);
      return;
    }
    Keyboard.dismiss();
    setError(null);
    // Real per-stage labels, driven by the three requests the pipeline actually
    // makes. The generation is research-backed and therefore slow, so one opaque
    // "cooking" label for the whole wait is not honest about what is happening.
    // The draft lands in the job and the hand-off below stops at the preview
    // instead of publishing: the basket is built from sources the user can
    // check, and publishing before they have seen either the legs or that
    // research would waste the reason for gathering it.
    runJob({
      kind: "sandwich",
      title: "Cooking your sandwich",
      stage: "Reading your thesis…",
      readyStage: "Your sandwich is ready",
      run: async (onStage) => ({
        kind: "sandwich",
        sandwich: await createSandwichFromInput(trimmed, appUser, onStage),
      }),
    });
  }, [appUser, generating, prompt, runJob, startPodcast]);

  // One hand-off point for a finished job, whether the user waited here or the
  // banner brought them back afterwards — both land on exactly the same view.
  // A layout effect so a job that finished while the user was away is adopted
  // before the first paint: reopening lands on the result, never on the picker.
  useLayoutEffect(() => {
    if (!job) return;
    if (job.status === "error") {
      setError(job.error ?? "Something went wrong. Try again.");
      clearJob();
      return;
    }
    if (job.status !== "ready" || !result) return;
    // A finished episode belongs to the provider now: it builds every call's
    // market in the background and the banner/push report it. Adopting it here
    // would put back the preview-then-build step this flow just removed.
    if (result.kind !== "sandwich") return;
    setDraft(draftFromSandwich(result.sandwich));
    setMode("preview");
    clearJob();
  }, [clearJob, job, result]);

  // The banner reports the job on every other screen, so it stays out of the way
  // while the composer's own full-screen loading state is up.
  useEffect(() => {
    setComposerVisible(true);
    return () => setComposerVisible(false);
  }, [setComposerVisible]);

  const startManual = useCallback((inputOverride?: string) => {
    // "What do you believe?" is the single source for a hand-stacked sandwich —
    // the review sheet no longer asks for a name or thesis, so the prompt seeds
    // both. The picker cards are disabled until this is non-empty.
    const belief = (inputOverride ?? prompt).trim();
    if (belief.length === 0) {
      setError("Type what you believe first.");
      return;
    }
    setDraft({
      ...makeManualDraft(),
      name: belief,
      summary: belief,
      thesisText: belief,
      // The user already wrote their take on the first screen. Carry it into
      // review for editing instead of presenting a second empty essay box.
      commentary: belief.slice(0, MAX_COMMENTARY_LENGTH),
    });
    setMode("review");
    setError(null);
  }, [prompt]);

  const updateDraft = useCallback(
    (updater: (current: ComposerDraft) => ComposerDraft) => {
      setDraft((current) => (current ? updater(current) : current));
    },
    [],
  );

  const addLeg = useCallback(
    (leg: SandwichLeg) => {
      // Append, then split the basket evenly across every leg. The user selects
      // legs and the allocation is assigned for them (adjustable in review).
      // A sandwich is homogeneous (see venue.ts) — the server rewrites every
      // leg's side from the sandwich direction on commit — so the new leg
      // adopts the draft's direction here rather than defaulting to long and
      // then flipping under the user at publish time.
      updateDraft((current) => {
        const selection = nextManualSelection(
          {
            direction: current.direction,
            executionVenue: current.executionVenue,
            legs: current.legs,
          },
          leg,
        );
        return {
          ...current,
          direction: selection.direction,
          executionVenue: selection.executionVenue,
          legs: rebalanceLegsEqually(
            selection.legs.map((entry) => sideForDirection(entry, selection.direction)),
          ),
        };
      });
      // Keep the picker open so several legs can be stacked before reviewing.
    },
    [updateDraft],
  );

  const removeLeg = useCallback(
    (id: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      updateDraft((current) => {
        const legs = rebalanceLegsEqually(current.legs.filter((leg) => leg.id !== id));
        return {
          ...current,
          legs,
          executionVenue: legs.length === 0 ? null : current.executionVenue,
        };
      });
    },
    [updateDraft],
  );

  // Remove every leg backed by a given mint (used when toggling a stock off
  // from the picker grid) and re-even the remaining allocation.
  const removeLegByMint = useCallback(
    (mint: string) => {
      void Haptics.selectionAsync();
      updateDraft((current) => {
        const legs = rebalanceLegsEqually(current.legs.filter((leg) => leg.mint !== mint));
        return {
          ...current,
          legs,
          executionVenue: legs.length === 0 ? null : current.executionVenue,
        };
      });
    },
    [updateDraft],
  );


  // Commit a full ratios array (one per leg, in order) into integer bps
  // weights. Each leg's ratio maps straight to its own bps — no normalizing
  // the set back to sum to 10000, so dragging one leg never silently rescales
  // the others. The total is validated (and reported to the user) only at
  // confirm time, in `confirmDraft`. This only runs once, when the drag ends,
  // so React re-renders don't throttle the live animation. See
  // {@link ComposerLegRow}.
  const commitLegRatios = useCallback(
    (ratios: number[]) => {
      updateDraft((current) => {
        if (current.legs.length === 0) return current;
        const bps = current.legs.map((_, i) =>
          Math.round(Math.max(0, Math.min(1, ratios[i] ?? 0)) * 10000),
        );
        return {
          ...current,
          legs: current.legs.map((leg, i) => ({ ...leg, weightBps: bps[i] })),
        };
      });
    },
    [updateDraft],
  );

  // Re-even the allocation across all legs (used by the "even split" button in
  // review after the user has manually nudged some weights).
  const evenSplitLegs = useCallback(() => {
    void Haptics.selectionAsync();
    updateDraft((current) => ({
      ...current,
      legs: rebalanceLegsEqually(current.legs),
    }));
  }, [updateDraft]);

  /**
   * Set the direction of the WHOLE draft.
   *
   * Deliberately not a per-leg control. A sandwich is homogeneous — every leg
   * is spot or every leg is perp, and `rowsForVenue` on the server rewrites
   * each leg's side from the sandwich's own direction — so a per-leg side
   * toggle was a promise the commit could not keep: flipping one stock leg to
   * SHORT was silently discarded and the card published as a spot buy.
   * Direction is the one knob, and the legs follow it.
   */
  const setDraftDirection = useCallback(
    (direction: SandwichDirection) => {
      void Haptics.selectionAsync();
      updateDraft((current) =>
        current.direction === direction
          ? current
          : {
              ...current,
              direction,
              legs: current.legs.map((leg) => sideForDirection(leg, direction)),
            },
      );
    },
    [updateDraft],
  );

  // The agent's work lands back on THIS screen — the draft, the moments feed and
  // the publish write into local state here, so popping the route mid-flight
  // strands those requests. They are short, so while one is in flight every exit
  // is locked: the header back / cancel controls, and Android's hardware back.
  // The native swipe-back is already off via `gestureEnabled: false` on the
  // `sandwich-composer` Stack.Screen in `(app)/_layout`.
  //
  // Generation is deliberately NOT in here. It is the long wait, it now runs
  // above the router, and the loading screen offers its own way out — leaving
  // hands the job to the global progress banner instead of killing it.
  const cooking = submitting;

  const guardedClose = useCallback(() => {
    if (cooking) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    close();
  }, [close, cooking]);

  useEffect(() => {
    if (!cooking) return;
    // Registered last, so this runs before the navigator's own handler and
    // swallows the press instead of popping the screen.
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [cooking]);

  const totalWeightPct = useMemo(() => {
    if (!draft) return 0;
    return draft.legs.reduce((sum, leg) => sum + leg.weightBps, 0) / 100;
  }, [draft]);

  const canConfirm =
    !!draft &&
    !submitting &&
    draft.name.trim().length > 0 &&
    // Remixes need the builder’s own thesis; other manual drafts may omit it.
    (draft.remixOf ? draft.commentary.trim().length > 0 : draft.isManual || draft.summary.trim().length > 0) &&
    draft.legs.length > 0;

  const confirmDraft = useCallback(async () => {
    if (!draft || submitting) return;
    if (!canConfirm) {
      setError(
        draft.isManual && !draft.remixOf
          ? "Add a name and at least one leg before confirming."
          : "Add a name, a thesis, and at least one leg before confirming.",
      );
      return;
    }
    // Slider drags keep the split at 100%, but a draft's starting weights
    // (AI / remix parent) may not — block here, at the moment of confirming,
    // with a tolerance for rounding drift.
    const totalPct = draft.legs.reduce((sum, leg) => sum + leg.weightBps, 0) / 100;
    if (Math.abs(totalPct - 100) > 0.5) {
      setError(
        `Allocations must add up to 100% before confirming (currently ${Math.round(totalPct)}%).`,
      );
      return;
    }
    // The server would reject this with `too_many_perp_legs`; say it here, in
    // the composer's own words, while the legs are still editable.
    if (
      (draft.direction === "down" || draft.executionVenue === "perp") &&
      draft.legs.length > MAX_PERP_SANDWICH_LEGS
    ) {
      setError(
        "A perp Sandwich executes as a single position. Keep one leg, or select spot assets instead.",
      );
      return;
    }
    Keyboard.dismiss();
    setSubmitting(true);
    setError(null);

    try {
      const legs = draft.legs.map(legToCommitInput);
      const sandwich =
        draft.thesisId && !draft.isManual
          ? await commitSandwichDraft(
              draft.thesisId,
              {
                name: draft.name.trim(),
                summary: draft.summary.trim(),
                horizon: draft.horizon,
                direction: draft.direction,
                confidence: draft.confidence,
                commentary: draft.commentary.trim() || null,
                warnings: draft.warnings,
                legs,
                executionVenue: draft.executionVenue,
                promptId: dailyPrompt?.id ?? null,
              },
              appUser,
              anonymousId,
            )
          : await createManualSandwich(
              {
                name: draft.name.trim(),
                summary: draft.summary.trim(),
                horizon: draft.horizon,
                direction: draft.direction,
                confidence: draft.confidence,
                thesisText: draft.thesisText || draft.summary,
                warnings: draft.warnings,
                legs,
                executionVenue: draft.executionVenue,
                commentary: draft.commentary.trim() || null,
                remixOf: draft.remixOf?.sandwichId ?? null,
                promptId: dailyPrompt?.id ?? null,
              },
              appUser,
              anonymousId,
            );
      // Pop first, then hand off: an opener that navigates to the new sandwich
      // (a remix opens its own detail) must push AFTER the composer is gone,
      // or this pop would take the new screen with it.
      close();
      notifyCreated(sandwich);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [anonymousId, appUser, canConfirm, close, dailyPrompt, draft, notifyCreated, submitting]);

  const pickerContent = (
    <LegPickerOverlay
      active={pickerOpen}
      initialCategory={pickerInitialCategory}
      onClose={closePicker}
      onPicked={addLeg}
      onRemoveMint={removeLegByMint}
      legsCount={draft ? draft.legs.length : 0}
      selectedMints={
        new Set(
          draft?.legs
            .filter(() => draft.executionVenue !== "perp")
            .map((leg) => leg.mint)
            .filter((mint): mint is string => !!mint) ?? [],
        )
      }
      selectedPerpMints={
        new Set(
          draft?.legs
            .filter(() => draft.executionVenue === "perp")
            .map((leg) => leg.mint)
            .filter((mint): mint is string => !!mint) ?? [],
        )
      }
    />
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
    <SafeAreaView style={styles.detailScreenRoot} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
        {mode === "picker" ? (
          <View style={styles.newPostRoot}>
            <View style={styles.composerNav}>
              <View style={styles.composerNavSideLeft}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  accessibilityState={{ disabled: cooking }}
                  hitSlop={12}
                  disabled={cooking}
                  onPress={guardedClose}
                  style={[
                    styles.composerHeaderBackButton,
                    cooking && styles.composerHeaderBackDisabled,
                  ]}
                >
                  {HAS_GLASS ? (
                    <GlassView glassEffectStyle="clear" isInteractive style={styles.composerHeaderBackGlass}>
                      <Ionicons name="chevron-back" size={21} color={colors.text} />
                    </GlassView>
                  ) : (
                    <View style={styles.composerHeaderBackFallback}>
                      <Ionicons name="chevron-back" size={21} color={colors.text} />
                    </View>
                  )}
                </Pressable>
              </View>
              <Text style={styles.composerNavTitle}>New Sandwich</Text>
              <View style={styles.composerNavSideRight} />
            </View>

            {error ? (
              <View style={styles.thesisComposerError}>
                <Text style={styles.thesisComposerErrorText}>{error}</Text>
              </View>
            ) : null}

            <ComposerPickerView
              value={prompt}
              onChangeText={(value) => {
                setPrompt(value);
                if (error) setError(null);
              }}
              onContinue={(input, useAgent) => {
                setPrompt(input);
                if (!input.trim()) {
                  setError("Type your take or add a link first.");
                  return;
                }
                if (useAgent) {
                  submitPrompt(input);
                  return;
                }
                startManual(input);
                openPicker();
              }}
              generating={generating}
              stage={stage}
              avatarUrl={composerAvatarUrl ?? appUser?.avatarUrl ?? null}
              dailyPrompt={dailyPrompt}
            />
          </View>
        ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScrollBeginDrag={Keyboard.dismiss}
            style={[styles.thesisComposerScroll, mode === "preview" && styles.thesisComposerScrollPreview]}
            contentContainerStyle={[
              styles.thesisComposerScrollContent,
              mode === "preview" && styles.thesisComposerScrollContentPreview,
              { paddingBottom: 130 },
            ]}
          >
            <View style={[styles.composerNav, mode === "preview" && styles.composerNavPreview]}>
              {mode === "preview" ? (
                <View style={styles.composerNavSideLeft}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    accessibilityState={{ disabled: cooking }}
                    hitSlop={12}
                    disabled={cooking}
                    onPress={() => {
                      setMode("picker");
                      setError(null);
                    }}
                    style={[
                      styles.composerHeaderBackButton,
                      cooking && styles.composerHeaderBackDisabled,
                    ]}
                  >
                    {HAS_GLASS ? (
                      <GlassView glassEffectStyle="clear" isInteractive style={styles.composerHeaderBackGlass}>
                        <Ionicons name="chevron-back" size={21} color={colors.text} />
                      </GlassView>
                    ) : (
                      <View style={styles.composerHeaderBackFallback}>
                        <Ionicons name="chevron-back" size={21} color={colors.text} />
                      </View>
                    )}
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  accessibilityState={{ disabled: cooking }}
                  hitSlop={12}
                  disabled={cooking}
                  onPress={guardedClose}
                  style={({ pressed }) => [
                    styles.composerNavSide,
                    pressed && styles.thesisComposerClosePressed,
                    cooking && styles.composerHeaderBackDisabled,
                  ]}
                >
                  <Text style={styles.composerNavCancelText}>cancel</Text>
                </Pressable>
              )}
              <Text style={styles.composerNavTitle}>
                {mode === "review"
                  ? isRemix ? "Remix sandwich" : draft?.isManual ? "Build sandwich" : "Review sandwich"
                  : mode === "preview"
                    ? isRemix ? "Preview remix" : "Preview sandwich"
                    : ""}
              </Text>
              <View style={styles.composerNavSide} />
            </View>

            {error ? (
              <View style={styles.thesisComposerError}>
                <Text style={styles.thesisComposerErrorText}>{error}</Text>
              </View>
            ) : null}

            {mode === "prompt" ? (
              <ComposerPromptView
                value={prompt}
                onChangeText={(value) => {
                  setPrompt(value);
                  if (error) setError(null);
                }}
                onBack={() => {
                  setMode("picker");
                  setError(null);
                }}
                onSubmit={() => submitPrompt()}
                creating={generating}
                stage={stage}
                canSubmit={prompt.trim().length > 0 && !generating}
              />
            ) : mode === "preview" && draft ? (
              <ComposerPreviewView
                draft={draft}
                appUser={appUser}
                avatarUrl={composerAvatarUrl ?? appUser?.avatarUrl ?? null}
                onTweak={() => {
                  setMode("review");
                  setError(null);
                }}
                onConfirm={() => void confirmDraft()}
                submitting={submitting}
                canConfirm={canConfirm}
                onBack={() => {
                  // A remix never had a prompt screen to return to.
                  setMode(isRemix ? "review" : "picker");
                  setError(null);
                }}
              />
            ) : draft ? (
              <ComposerReviewView
                draft={draft}
                appUser={appUser}
                avatarUrl={composerAvatarUrl ?? appUser?.avatarUrl ?? null}
                onChangeName={(value) => updateDraft((current) => ({ ...current, name: value }))}
                onChangeSummary={(value) =>
                  updateDraft((current) => ({ ...current, summary: value, thesisText: value }))
                }
                onChangeCommentary={(value) =>
                  updateDraft((current) => ({ ...current, commentary: value, ...(current.remixOf ? { summary: value, thesisText: value } : {}) }))
                }
                onRemoveLeg={removeLeg}
                onCommitRatios={commitLegRatios}
                onEvenSplit={evenSplitLegs}
                onChangeDirection={setDraftDirection}
                onAddLeg={openPicker}
                totalWeightPct={totalWeightPct}
                onConfirm={() => {
                  setMode("preview");
                  setError(null);
                }}
                submitting={submitting}
                canConfirm={canConfirm}
                onBack={() => {
                  // The thesis prompt now lives on the picker screen, so both
                  // manual and AI drafts step back to the same entry screen.
                  // A remix started here, so backing out leaves the composer.
                  if (isRemix) {
                    guardedClose();
                    return;
                  }
                  setMode("picker");
                  setError(null);
                }}
              />
            ) : null}
          </ScrollView>

          <View style={styles.fixedBottomCtaContainer}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={
                  mode === "review"
                    ? "Preview"
                    : mode === "preview"
                      ? isRemix ? "Publish remix" : "Confirm sandwich"
                      : "Cook sandwich"
                }
                disabled={
                  mode === "prompt"
                    ? (prompt.trim().length === 0 || generating)
                    : !canConfirm
                }
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (mode === "prompt") {
                    submitPrompt();
                  } else if (mode === "preview") {
                    void confirmDraft();
                  } else if (mode === "review") {
                    setMode("preview");
                    setError(null);
                  }
                }}
                style={[styles.thesisComposerCtaWrap, (mode === "prompt"
                    ? (prompt.trim().length === 0 || generating)
                    : !canConfirm) && styles.thesisComposerCtaDisabled]}
              >
                {HAS_GLASS ? (
                  <GlassView
                    glassEffectStyle="regular"
                    isInteractive
                    tintColor={colors.actionPrimary}
                    style={styles.thesisComposerCta}
                  >
                    {(mode === "prompt" && generating) || (mode === "preview" && submitting) ? (
                      <ActivityIndicator size="small" color={colors.textInverse} />
                    ) : null}
                    <Text style={styles.thesisComposerCtaLabel}>
                      {mode === "prompt"
                        ? (generating ? stage ?? "Firing oven..." : "Generate")
                        : mode === "preview"
                          ? (submitting ? "Publishing..." : isRemix ? "Publish remix" : "Confirm sandwich")
                          : "Preview"}
                    </Text>
                  </GlassView>
                ) : (
                  <View style={[styles.thesisComposerCta, styles.thesisComposerCtaSolid]}>
                    {(mode === "prompt" && generating) || (mode === "preview" && submitting) ? (
                      <ActivityIndicator size="small" color={colors.textInverse} />
                    ) : null}
                    <Text style={styles.thesisComposerCtaLabel}>
                      {mode === "prompt"
                        ? (generating ? stage ?? "Firing oven..." : "Generate")
                        : mode === "preview"
                          ? (submitting ? "Publishing..." : isRemix ? "Publish remix" : "Confirm sandwich")
                          : "Preview"}
                    </Text>
                  </View>
                )}
              </PressableScale>
          </View>
        </View>
        )}

        {/* UIKit owns the iOS sheet transition, dimming and swipe dismissal. */}
        {Platform.OS === "ios" ? (
          <Modal
            visible={pickerOpen}
            animationType="slide"
            presentationStyle="pageSheet"
            allowSwipeDismissal
            onRequestClose={closePicker}
          >
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
              <View style={{ flex: 1, paddingTop: 16, paddingBottom: pickerInsets.bottom }}>
                <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
                  {pickerContent}
                </KeyboardAvoidingView>
              </View>
            </GestureHandlerRootView>
          </Modal>
        ) : pickerOpen ? (
          <>
            <Animated.View style={[styles.legPickerBackdrop, pickerBackdropStyle]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close leg picker"
                onPress={closePicker}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <Animated.View style={[styles.legPickerOverlay, pickerOverlayStyle]}>
              {/* Drag handle — GestureDetector covers only this zone so the
                  ScrollView below is completely unaffected. */}
              <GestureDetector gesture={sheetDragGesture}>
                <View style={styles.legPickerHandleArea}>
                  <View style={styles.legPickerHandlePill} />
                </View>
              </GestureDetector>
              {pickerContent}
            </Animated.View>
          </>
        ) : null}
    </SafeAreaView>

    {/* Full-screen generation state, outside the SafeAreaView so the white takes
        the notch and the bottom CTA too. A pasted episode needs the app open
        only until its captions are up — the hint says so, because backgrounding
        before that genuinely loses the job, and after it genuinely does not. */}
    <CookingOverlay
      visible={generating && !handoff}
      stage={stage}
      kind={job?.kind ?? "sandwich"}
      input={job?.kind === "sandwich" ? prompt : undefined}
      startedAt={job?.startedAt}
      hint={
        job?.kind === "podcast"
          ? "Hang tight — reading the captions needs the app open."
          : undefined
      }
      onBack={close}
    />

    {/* The episode is on the server now. Nothing left to watch, nothing to
        confirm — just the promise to come back with it. */}
    <NotifyHandoffOverlay visible={handoff === true} onDone={close} />
    </KeyboardAvoidingView>
  );
}

// ─── Link preview helpers ────────────────────────────────────────────────────


function YouTubePreviewCard({
  preview,
  onDismiss,
}: {
  preview: LinkPreview;
  onDismiss: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const thumbnailUrl = `https://img.youtube.com/vi/${preview.videoId}/hqdefault.jpg`;
  const displayUrl = preview.url.replace("https://", "");
  return (
    <View style={[styles.linkPreviewCard, styles.linkPreviewCardYt]}>
      <View style={styles.linkPreviewHeader}>
        <Text style={styles.linkPreviewLabel}>YOUTUBE VIDEO PREVIEW</Text>
        <Pressable hitSlop={8} onPress={onDismiss}>
          <Ionicons name="close" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>
      <View style={styles.linkPreviewYtBody}>
        <View style={styles.linkPreviewYtThumbWrap}>
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.linkPreviewYtThumb}
            resizeMode="cover"
          />
          <View style={styles.linkPreviewYtPlayBtn}>
            <Ionicons name="play" size={18} color="#FFFFFF" />
          </View>
        </View>
        <View style={styles.linkPreviewYtMeta}>
          <Text style={styles.linkPreviewYtTitle} numberOfLines={3}>
            {displayUrl}
          </Text>
        </View>
      </View>
      <View style={styles.linkPreviewFooter}>
        <Ionicons name="logo-youtube" size={14} color="#FF0000" />
        <Text style={styles.linkPreviewFooterUrl} numberOfLines={1}>
          {displayUrl}
        </Text>
      </View>
    </View>
  );
}

// YouTube-style attribution card for sandwiches created from a video. Tapping
// it opens the video on YouTube. `compact` is the feed-card variant (small
// side thumbnail); the default is the detail-hero variant (16:9 thumbnail with
// a play badge, then channel + title).

// Inline video for the sandwich detail hero — plays automatically (muted) the
// moment the sandwich opens, with YouTube's own chrome disabled so it feels
// like a video rather than an embedded YouTube page. Tap toggles play/pause; a
// corner button toggles sound. If the video refuses to embed, fall back to the
// static thumbnail card (which deep-links out).
//
// For a sandwich built from a podcast moment the video opens SEEKED to the
// timestamp the call was made at — the whole point of a timestamped market is
// that you land on the sentence, not on the top of a two-hour episode.
function SourceVideoPlayer({
  video,
  momentWindow,
  playerRef,
}: {
  video: SourceVideo;
  /** Where in the episode this sandwich's call was made, if it came from one. */
  momentWindow?: MomentWindow | null;
  playerRef?: React.RefObject<YouTubeClipPlayerHandle | null>;
}) {
  const styles = useThemedStyles(makeStyles);
  // `playing` mirrors the actual player state (reported by the page), so if a
  // platform ever refuses the muted autoplay the UI honestly shows the play
  // badge and the first tap starts playback instead of "pausing" a video that
  // never ran.
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const internalRef = useRef<YouTubeClipPlayerHandle>(null);
  const handleRef = playerRef ?? internalRef;
  const channelLine = video.channelName ? `${video.channelName} · YouTube` : "Watch on YouTube";

  if (failed) return <SourceVideoCard video={video} />;

  return (
    <View style={styles.sourceVideoHeroShadow}>
      <View style={styles.sourceVideoHero}>
        <View style={styles.sourceVideoHeroThumbWrap}>
          <YouTubeClipPlayer
            ref={handleRef}
            videoId={video.videoId}
            // Seek to the call, but deliberately WITHOUT its end: the hero is
            // "watch the call and keep listening", and an `endSeconds` would stop
            // the video dead mid-episode. The chip below re-seeks with the bound.
            initialStartMs={momentWindow?.startMs ?? null}
            initialEndMs={null}
            hideControls
            onError={() => setFailed(true)}
            onStateChange={(state) => setPlaying(state === "playing")}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? "Pause video" : "Play video"}
            onPress={() => {
              if (playing) handleRef.current?.pause();
              else handleRef.current?.play();
              setPlaying((p) => !p);
            }}
            style={styles.sourceVideoTapLayer}
          >
            {!playing ? (
              <View style={styles.sourceVideoHeroPlayBadge}>
                <Ionicons name="play" size={22} color="#FFFFFF" />
              </View>
            ) : null}
          </Pressable>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={muted ? "Unmute video" : "Mute video"}
            hitSlop={8}
            onPress={() => {
              handleRef.current?.setMuted(!muted);
              setMuted((m) => !m);
            }}
            style={styles.sourceVideoMuteBtn}
          >
            <Ionicons name={muted ? "volume-mute" : "volume-high"} size={15} color="#FFFFFF" />
          </PressableScale>
        </View>
        <PressableScale
          accessibilityRole="link"
          accessibilityLabel={`Watch ${video.title} on YouTube`}
          onPress={() => {
            // Even the escape hatch lands on the moment.
            void Linking.openURL(
              momentWindow ? youTubeWatchUrl(video.videoId, momentWindow.startMs) : video.url,
            ).catch(() => {});
          }}
          style={styles.sourceVideoHeroMeta}
        >
          {video.channelAvatarUrl ? (
            <Image source={{ uri: video.channelAvatarUrl }} style={styles.sourceVideoAvatar} />
          ) : (
            <Ionicons name="logo-youtube" size={26} color="#FF0000" />
          )}
          <View style={styles.sourceVideoHeroMetaText}>
            <Text style={styles.linkPreviewYtTitle} numberOfLines={2}>
              {video.title}
            </Text>
            <Text style={styles.sourceVideoChannel} numberOfLines={1}>
              {channelLine}
            </Text>
          </View>
          <Ionicons name="open-outline" size={16} color="#FF0000" />
        </PressableScale>
      </View>
    </View>
  );
}

type TwitterOEmbed = {
  author_name: string;
  author_url: string;
  html: string;
};

function parseTweetText(html: string): string {
  // oEmbed wraps content in <blockquote><p>text</p> — strip all tags
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function TwitterPreviewCard({
  preview,
  onDismiss,
}: {
  preview: LinkPreview;
  onDismiss: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const displayUrl = preview.url.replace("https://", "");
  const username = preview.statusPath?.split("/")[0] ?? "";

  const [oembed, setOembed] = useState<TwitterOEmbed | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOembed(null);
    fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(preview.url)}&omit_script=true`,
    )
      .then((r) => r.json())
      .then((data: TwitterOEmbed) => {
        if (!cancelled) {
          setOembed(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview.url]);

  const tweetText = oembed ? parseTweetText(oembed.html) : null;
  // unavatar proxies Twitter/X profile pictures without auth
  const pfpUrl = `https://unavatar.io/x/${username}`;

  return (
    <View style={styles.linkPreviewCard}>
      <View style={styles.linkPreviewHeader}>
        <Text style={styles.linkPreviewLabel}>X (TWITTER) POST PREVIEW</Text>
        <Pressable hitSlop={8} onPress={onDismiss}>
          <Ionicons name="close" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>
      <View style={styles.linkPreviewXBody}>
        {loading ? (
          <View style={styles.linkPreviewXIconWrap}>
            <ActivityIndicator size="small" color="#FFFFFF" />
          </View>
        ) : (
          <Image
            source={{ uri: pfpUrl }}
            style={styles.linkPreviewXAvatar}
          />
        )}
        <View style={styles.linkPreviewXMeta}>
          <Text style={styles.linkPreviewXHandle} numberOfLines={1}>
            {oembed ? (
              oembed.author_name
            ) : (
              <HandleText>{`@${username}`}</HandleText>
            )}
            {oembed ? (
              <Text style={styles.linkPreviewXUsername}>
                {" "}
                <HandleText>{`@${username}`}</HandleText>
              </Text>
            ) : null}
          </Text>
          {tweetText ? (
            <Text style={styles.linkPreviewXTweetText} numberOfLines={3}>
              {tweetText}
            </Text>
          ) : loading ? (
            <Text style={styles.linkPreviewXTweetId}>Loading…</Text>
          ) : (
            <HandleText style={styles.linkPreviewXTweetId}>{`@${username}`}</HandleText>
          )}
        </View>
      </View>
      <View style={styles.linkPreviewFooter}>
        <Text style={styles.linkPreviewFooterUrl} numberOfLines={1}>
          {displayUrl}
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────


const PLACEHOLDER_SLIDES = [
  { label: "What's on your mind?", icon: null as null | "youtube" },
  { label: "Paste a YouTube link", icon: "youtube" as null | "youtube" },
  { label: "Paste an article link", icon: null as null | "youtube" },
] as const;

function AnimatedPlaceholder() {
  const { colors } = useThemeStore();
  const [index, setIndex] = useState(0);
  const fadeAnim = useSharedValue(1);
  // Track index on the UI thread so the worklet callback can compute next value
  const indexSV = useSharedValue(0);

  useEffect(() => {
    const cycle = setInterval(() => {
      fadeAnim.value = withTiming(0, { duration: Motion.duration.fast }, (finished) => {
        if (finished) {
          const next = (indexSV.value + 1) % PLACEHOLDER_SLIDES.length;
          indexSV.value = next;
          runOnJS(setIndex)(next);
          fadeAnim.value = withTiming(1, { duration: Motion.duration.fast });
        }
      });
    }, 1600);
    return () => clearInterval(cycle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.value }));
  const slide = PLACEHOLDER_SLIDES[index];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: 5,
          left: 0,
          right: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        animStyle,
      ]}
    >
      {slide?.icon === "youtube" && (
        <Ionicons name="logo-youtube" size={20} color="rgba(255,0,0,0.35)" />
      )}
      <Text
        style={{
          color: colors.textTertiary,
          opacity: 0.5,
          fontSize: 21,
          lineHeight: 27,
          fontWeight: "500",
          fontFamily: F,
        }}
        numberOfLines={1}
      >
        {slide?.label}
      </Text>
    </Animated.View>
  );
}

function ComposerPickerView({
  value,
  onChangeText,
  onContinue,
  generating,
  stage,
  avatarUrl,
  dailyPrompt,
}: {
  value: string;
  onChangeText: (next: string) => void;
  onContinue: (input: string, useAgent: boolean) => void;
  generating: boolean;
  stage: string | null;
  avatarUrl: string | null;
  /** The question being answered, pinned above the input. */
  dailyPrompt: DailyPrompt | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
  const [agentOn, setAgentOn] = useState(true);
  const [attachedPreview, setAttachedPreview] = useState<LinkPreview | null>(null);
  const linkPreview = attachedPreview && attachedPreview.url !== dismissedUrl ? attachedPreview : null;
  // Links always need the agent: X needs the post fetched and understood, and
  // YouTube needs its full transcript extracted before a basket can be built.
  const effectiveAgentOn = agentOn || linkPreview !== null;
  // A link-only take is valid because the agent can fetch the X post or
  // YouTube transcript; manual mode still requires typed thesis text.
  const canProceed = value.trim().length > 0 || linkPreview !== null;

  // Intercept every text change: the moment a YouTube/X link appears in the
  // input, lift it out of the text and turn it into a preview card below.
  const handleChangeText = useCallback(
    (next: string) => {
      const detected = detectLinkPreview(next);
      if (detected) {
        setAttachedPreview(detected);
        setDismissedUrl(null);
        // Strip the raw URL (the matched http(s) span) so only the card remains.
        const urlSpan = next.match(
          /(?:https?:\/\/)?(?:www\.|m\.)?[^\s]*(?:youtu\.?be|youtube\.com|x\.com|twitter\.com)\/[^\s]*/i,
        );
        const cleaned = (urlSpan ? next.replace(urlSpan[0], "") : next)
          .replace(/[ \t]{2,}/g, " ")
          .trimEnd();
        onChangeText(cleaned);
        return;
      }
      onChangeText(next);
    },
    [onChangeText],
  );

  // A sandwich requires multiple legs (tickers). A single ticker is just a post
  // Inline cashtag autocomplete: while the take ends with a `$AAPL`-style token
  // being typed, surface matching tickers so tapping one completes the cashtag.
  // Mirrors X/Twitter's inline "$" ticker suggestions.
  const cashtagQuery = useMemo(() => {
    const m = value.match(/\$([A-Za-z][A-Za-z0-9]{0,7})$/);
    return m ? m[1] : null;
  }, [value]);
  const [cashtagResults, setCashtagResults] = useState<Stock[]>([]);
  const cashtagDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!cashtagQuery) {
      setCashtagResults([]);
      return;
    }
    if (cashtagDebounceRef.current) clearTimeout(cashtagDebounceRef.current);
    cashtagDebounceRef.current = setTimeout(() => {
      void getTopHolderStocks({ q: cashtagQuery, limit: 6 })
        .then((rows) => setCashtagResults(rows))
        .catch(() => setCashtagResults([]));
    }, 220);
    return () => {
      if (cashtagDebounceRef.current) clearTimeout(cashtagDebounceRef.current);
    };
  }, [cashtagQuery]);

  // Replace the in-progress `$xx` token at the end of the take with the full
  // `$SYMBOL ` cashtag.
  const completeCashtag = useCallback(
    (symbol: string) => {
      void Haptics.selectionAsync();
      const full = `$${symbol.replace(/^\$/, "").toUpperCase()} `;
      onChangeText(value.replace(/\$([A-Za-z][A-Za-z0-9]{0,7})$/, full));
    },
    [onChangeText, value],
  );

  const contentOpacity = useSharedValue(0);
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    contentOpacity.value = withTiming(1, { duration: 180 });
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(focusTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));

  return (
    <Animated.View style={[styles.newPostBody, contentStyle]}>
      {dailyPrompt ? <DailyPromptBanner prompt={dailyPrompt} /> : null}
      {/* Tapping anywhere in the (tall) input zone focuses the field. */}
      <Pressable
        style={styles.newPostInputRow}
        onPress={() => inputRef.current?.focus()}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.newPostAvatar} />
        ) : (
          <View style={[styles.newPostAvatar, { backgroundColor: colors.surfaceAlt }]} />
        )}
        <View style={{ flex: 1 }}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={handleChangeText}
            multiline
            accessibilityLabel="Your take"
            textAlignVertical="top"
            autoCapitalize="sentences"
            placeholder=""
            placeholderTextColor="transparent"
            style={[styles.newPostInput, linkPreview ? styles.newPostInputWithPreview : null]}
          />
          {value.length === 0 ? <AnimatedPlaceholder /> : null}

          {/* The attached link's card renders on the next line of the take
              itself — same column as the typed text, not below the row. */}
          {linkPreview ? (
            linkPreview.type === "youtube" ? (
              <YouTubePreviewCard
                preview={linkPreview}
                onDismiss={() => { setDismissedUrl(linkPreview.url); setAttachedPreview(null); }}
              />
            ) : (
              <TwitterPreviewCard
                preview={linkPreview}
                onDismiss={() => { setDismissedUrl(linkPreview.url); setAttachedPreview(null); }}
              />
            )
          ) : null}
        </View>
      </Pressable>

      {cashtagQuery && cashtagResults.length > 0 ? (
        <View style={styles.cashtagCard}>
          <Text style={styles.cashtagMatchLabel}>MATCHING ${cashtagQuery.toUpperCase()}</Text>
          <Text style={styles.cashtagSectionLabel}>COMPANIES</Text>
          {cashtagResults.map((stock) => (
            <PressableScale
              key={stock.id}
              accessibilityRole="button"
              accessibilityLabel={`Add $${stock.symbol}`}
              onPress={() => completeCashtag(stock.symbol)}
              style={styles.cashtagRow}
            >
              <RemoteAssetLogo
                uri={stock.icon}
                size={40}
                borderRadius={20}
                backgroundColor={colors.surfaceAlt}
                fallback={
                  <View style={[styles.cashtagRowLogo, { backgroundColor: getAvatarColor(stock.symbol) }]}>
                    <Text style={styles.cashtagRowLogoLetter}>
                      {stock.symbol.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                }
              />
              <View style={styles.cashtagRowInfo}>
                <Text style={styles.cashtagRowName} numberOfLines={1}>
                  {stock.name}
                </Text>
                <Text style={styles.cashtagRowSymbol} numberOfLines={1}>
                  ${stock.symbol}
                </Text>
              </View>
            </PressableScale>
          ))}
        </View>
      ) : null}

      {generating && stage ? (
        <Text style={styles.believeStage}>{stage}</Text>
      ) : null}

      {/* Bottom toolbar — sits above the keyboard (the composer is wrapped in a
          KeyboardAvoidingView). "$" attaches assets to the take; "Post" hands
          the take to Bread Quant to build the sandwich. */}
      <View style={[styles.newPostToolbar, { paddingBottom: 10 + insets.bottom }]}>
        <View style={styles.newPostToolIcons}>
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Mention"
            onPress={() => onChangeText(`${value}${value.length && !value.endsWith(" ") ? " " : ""}@`)}
          >
            <Ionicons name="at" size={24} color={colors.iconMuted} />
          </Pressable>
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add a ticker"
            onPress={() => onChangeText(`${value}${value.length && !value.endsWith(" ") ? " " : ""}$`)}
          >
            <Ionicons name="logo-usd" size={23} color={colors.iconMuted} />
          </Pressable>

          <View style={styles.agentToggleWrap}>
            <Text style={styles.agentToggleLabel}>Sandwich Agent</Text>
            <Switch
              value={effectiveAgentOn}
              disabled={linkPreview !== null}
              onValueChange={(next) => {
                void Haptics.selectionAsync();
                setAgentOn(next);
              }}
              trackColor={{ true: colors.actionPrimary, false: colors.surfaceAlt }}
              ios_backgroundColor={colors.surfaceAlt}
              style={{ transform: [{ scale: 0.82 }] }}
            />
          </View>
        </View>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Continue"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            const combinedInput = linkPreview
              ? [value.trim(), linkPreview.url].filter(Boolean).join("\n")
              : value.trim();
            onContinue(combinedInput, effectiveAgentOn);
          }}
          disabled={generating || !canProceed}
          style={[styles.newPostSubmit, effectiveAgentOn && styles.newPostSubmitGlow, (!canProceed || generating) && styles.newPostSubmitDisabled]}
        >
          {HAS_GLASS ? (
            <GlassView
              glassEffectStyle="regular"
              isInteractive
              tintColor={colors.actionPrimary}
              style={styles.newPostSubmitGlass}
            >
              {generating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.newPostSubmitLabel}>
                  Continue
                </Text>
              )}
            </GlassView>
          ) : (
            <View style={[styles.newPostSubmitGlass, styles.newPostSubmitSolid]}>
              {generating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.newPostSubmitLabel}>
                  Continue
                </Text>
              )}
            </View>
          )}
        </PressableScale>
      </View>
    </Animated.View>
  );
}

function ComposerPromptView({
  value,
  onChangeText,
  onBack,
  onSubmit,
  creating,
  stage,
  canSubmit,
}: {
  value: string;
  onChangeText: (next: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  creating: boolean;
  stage: string | null;
  canSubmit: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to picker"
        onPress={onBack}
        style={styles.composerBackChip}
      >
        <Ionicons name="chevron-back" size={14} color={colors.icon} />
        <Text style={styles.composerBackChipLabel}>back</Text>
      </Pressable>

      <View style={styles.thesisComposerInputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          multiline
          accessibilityLabel="Sandwich prompt"
          textAlignVertical="top"
          autoCapitalize="sentences"
          placeholder="Paste a tweet, article link, or thesis. e.g. nvidia keeps eating ai infra spend"
          placeholderTextColor={colors.textTertiary}
          style={styles.thesisComposerInput}
        />
      </View>


    </View>
  );
}

// Backtest windows for the preview chart. A draft has no history of its own,
// so the chart is anchored `range` ago and shows how this exact basket would
// have moved — the highs and lows — over that stretch.
const PREVIEW_CHART_RANGES: { label: string; range: SandwichChartRange; seconds: number }[] = [
  { label: "24H", range: "24H", seconds: 24 * 60 * 60 },
  { label: "1W", range: "1W", seconds: 7 * 24 * 60 * 60 },
  { label: "1M", range: "1M", seconds: 30 * 24 * 60 * 60 },
  { label: "3M", range: "3M", seconds: 90 * 24 * 60 * 60 },
];

/**
 * The "Preview sandwich" step, laid out like the published detail screen: the
 * builder's byline, the post, a chart with timeframe pills, then the legs as
 * the same rows the detail screen uses — so what you confirm is what you get.
 * Tapping a leg drops into review to tweak it.
 */
function ComposerPreviewView({
  draft,
  appUser,
  avatarUrl,
  onTweak,
}: {
  draft: ComposerDraft;
  appUser: AppUserPayload | null;
  avatarUrl: string | null;
  onTweak: () => void;
  onConfirm: () => void;
  submitting: boolean;
  canConfirm: boolean;
  onBack: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const legs = draft.legs;
  const [chartRange, setChartRange] = useState<SandwichChartRange>("1M");
  const chartAnchor = useMemo(() => {
    const window = PREVIEW_CHART_RANGES.find((entry) => entry.range === chartRange);
    // One hour past the window so the chart treats it as a zoomed view and
    // reports that window's return at rest — the figure the headline shows.
    return new Date(Date.now() - ((window?.seconds ?? 0) + 60 * 60) * 1000).toISOString();
  }, [chartRange]);
  const chartReturnPct = useSharedValue(Number.NaN);
  const chartReturnActive = useSharedValue(0);
  const backtestText = useDerivedValue(() => {
    const value = chartReturnActive.value > 0 ? chartReturnPct.value : Number.NaN;
    if (Number.isNaN(value)) return "--";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  });
  const backtestColor = useDerivedValue(() => {
    const value = chartReturnActive.value > 0 ? chartReturnPct.value : Number.NaN;
    if (Number.isNaN(value) || value === 0) return colors.text;
    return value > 0 ? colors.chartPositive : colors.negative;
  });

  // The composer only carries the Privy-side user, which has no handle; the
  // byline must read as the @username the published post will wear.
  const [profile, setProfile] = useState<SocialUser | null>(null);
  const privyUserId = appUser?.privyUserId ?? null;
  useEffect(() => {
    if (!privyUserId) return;
    let cancelled = false;
    void getUserProfile(privyUserId)
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [privyUserId]);
  const handle = profile?.username?.trim().replace(/^@+/, "") || null;
  const bylineName = handle
    ? `@${handle}`
    : profile
      ? userDisplayName(profile)
      : appUser
        ? userDisplayName(appUser)
        : "You";
  const bylineAvatarUrl = avatarUrl ?? profile?.avatarUrl ?? null;
  const initials = (handle ?? appUser?.name?.trim() ?? "Y").slice(0, 1).toUpperCase();
  const postText = draft.commentary.trim() || draft.summary.trim() || draft.name.trim();
  const fromPaywallPreview = draft.warnings.includes(PAYWALLED_ARTICLE_WARNING);

  return (
    <View>
      <View style={styles.sheetHero}>
        <View style={styles.sheetCreatorRow}>
          <View style={styles.sheetCreatorTap}>
            <View style={styles.sheetCreatorAvatarRing}>
              {bylineAvatarUrl ? (
                <Image source={{ uri: bylineAvatarUrl }} style={styles.sheetCreatorAvatar} />
              ) : (
                <View style={styles.sheetCreatorAvatarFallback}>
                  <Text style={styles.sheetCreatorAvatarInitials}>{initials}</Text>
                </View>
              )}
            </View>
            <View style={styles.sheetCreatorInfo}>
              <View style={styles.sheetCreatorNameRow}>
                <HandleText numberOfLines={1} style={styles.sheetCreatorName}>
                  {bylineName}
                </HandleText>
                {handle ? <VerifiedBadge size={18} /> : null}
              </View>
            </View>
          </View>
        </View>
        {postText ? <Text style={styles.sheetHeroThesis}>{postText}</Text> : null}
        {fromPaywallPreview ? (
          <View style={styles.previewPaywallNotice}>
            <Ionicons name="lock-closed" size={14} color={colors.textSecondary} />
            <Text style={styles.previewPaywallNoticeText}>
              This post is paywalled, so only its free preview was read. Paste the full text for a sharper Sandwich.
            </Text>
          </View>
        ) : null}
        {draft.remixOf?.builderUsername ? (
          <Text style={styles.detailCreatedAt}>
            remix of @{draft.remixOf.builderUsername.replace(/^@+/, "")}
          </Text>
        ) : null}
      </View>

      {legs.length > 0 ? (
        <View style={styles.detailMetaRow}>
          <View style={{ flex: 1 }} />
          <AnimatedScrubText
            text={backtestText}
            color={backtestColor}
            style={styles.detailMetaPnl}
          />
        </View>
      ) : null}

      {legs.length > 0 ? (
        <View style={styles.detailChartSection}>
          <SandwichBasketChart
            legs={legs}
            createdAt={chartAnchor}
            window={chartRange}
            showReturn={false}
            showDotGrid
            scrubValue={chartReturnPct}
            scrubValueActive={chartReturnActive}
          />
          <View style={styles.chartRangeRow}>
            {PREVIEW_CHART_RANGES.map(({ label, range }) => {
              const active = chartRange === range;
              return (
                <Pressable
                  key={range}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Show ${label} backtest`}
                  hitSlop={8}
                  onPress={() => {
                    if (active) return;
                    void Haptics.selectionAsync();
                    setChartRange(range);
                  }}
                  style={styles.chartRangePill}
                >
                  <Text
                    style={[styles.chartRangePillText, active && styles.chartRangePillTextActive]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {legs.length === 0 ? (
        <View style={styles.composerLegEmpty}>
          <Text style={styles.composerLegEmptyText}>
            this sandwich has no legs yet. tap &quot;tweak&quot; to add some.
          </Text>
        </View>
      ) : (
        <View style={styles.detailLegsSection}>
          {legs.map((leg, index) => (
            <SandwichLegRow
              key={leg.id}
              leg={leg}
              isLast={index === legs.length - 1}
              onPress={() => onTweak()}
            />
          ))}
        </View>
      )}

      {/* What the basket was researched from — sources the user can check
          before this goes out under their name. */}
      <SandwichResearchCard research={draft.research} colors={colors} />
    </View>
  );
}

function ComposerReviewView({
  draft,
  appUser,
  avatarUrl,
  onChangeName,
  onChangeSummary,
  onChangeCommentary,
  onRemoveLeg,
  onCommitRatios,
  onEvenSplit,
  onChangeDirection,
  onAddLeg,
  totalWeightPct,
  onConfirm,
  submitting,
  canConfirm,
  onBack,
}: {
  draft: ComposerDraft;
  appUser: AppUserPayload | null;
  avatarUrl: string | null;
  onChangeName: (value: string) => void;
  onChangeSummary: (value: string) => void;
  onChangeCommentary: (value: string) => void;
  onRemoveLeg: (id: string) => void;
  onCommitRatios: (ratios: number[]) => void;
  onEvenSplit: () => void;
  onChangeDirection: (direction: SandwichDirection) => void;
  onAddLeg: (category?: LegCategory) => void;
  totalWeightPct: number;
  onConfirm: () => void;
  submitting: boolean;
  canConfirm: boolean;
  onBack: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  // Every ruler shares the same allocation array. Moving one leg rescales
  // the others proportionally, keeping the displayed total at 100%.
  const ratios = useSharedValue<number[]>(
    fairPercents(draft.legs.map((leg) => leg.weightBps / 10000)).map((p) => p / 100),
  );
  const [liveRatios, setLiveRatios] = useState<number[]>(() =>
    fairPercents(draft.legs.map((leg) => leg.weightBps / 10000)).map((p) => p / 100),
  );
  const legCount = draft.legs.length;

  // Re-seed the shared ratios whenever the leg set or weights change from a
  // non-drag source (add / remove / even-split / commit). This never fires
  // mid-drag because the draft is only committed on gesture end.
  useEffect(() => {
    const rounded = fairPercents(draft.legs.map((leg) => leg.weightBps / 10000)).map((p) => p / 100);
    ratios.value = rounded;
    setLiveRatios(rounded);
  }, [draft.legs, ratios]);

  // Fair (largest-remainder) whole-percent labels for the initial paint,
  // before the first animated frame — guarantees they sum to 100 even when
  // the underlying split isn't evenly divisible (e.g. 3 legs at ~33.3% each).
  const initialPercents = useMemo(
    () => fairPercents(draft.legs.map((leg) => leg.weightBps / 10000)),
    [draft.legs],
  );

  const [addLegSize, setAddLegSize] = useState({ width: 0, height: 0 });
  const commentaryLeft = MAX_COMMENTARY_LENGTH - draft.commentary.length;
  const isShortDraft = draft.direction === "down";
  const isPerpDraft = draft.executionVenue === "perp";

  return (
    <View>
      {draft.remixOf ? (
        <View style={styles.composerRemixThesis}>
          <View style={styles.composerRemixSource}>
            {draft.remixOf.builderAvatarUrl ? (
              <Image source={{ uri: draft.remixOf.builderAvatarUrl }} style={styles.composerRemixSourceAvatar} />
            ) : (
              <View style={[styles.composerRemixSourceAvatar, styles.composerRemixSourceAvatarFallback]}>
                <Text style={styles.composerRemixSourceInitial}>
                  {(draft.remixOf.builderName || draft.remixOf.builderUsername || "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.composerRemixPostIdentity}>
              <Text style={styles.composerRemixOrigin} numberOfLines={1}>
                {draft.remixOf.builderUsername
                  ? `Remixing @${draft.remixOf.builderUsername.replace(/^@+/, "")}`
                  : draft.remixOf.builderName ? `Remixing ${draft.remixOf.builderName}` : "Original post"}
              </Text>
              <Text style={styles.composerRemixSourceSummary} numberOfLines={2}>
                {draft.remixOf.summary || draft.remixOf.name}
              </Text>
            </View>
          </View>
          <Text style={styles.composerRemixLabel}>Your thesis</Text>
          <TextInput
            value={draft.commentary}
            onChangeText={onChangeCommentary}
            multiline
            accessibilityLabel="Your remix thesis"
            textAlignVertical="top"
            autoCapitalize="sentences"
            maxLength={MAX_COMMENTARY_LENGTH}
            placeholder="What’s your view? Explain how you’d play it."
            placeholderTextColor={colors.textTertiary}
            style={styles.composerRemixThesisInput}
          />

        </View>
      ) : null}
      <View style={styles.composerLegsHeader}>
        <Text style={styles.composerFieldLabel}>assets</Text>
        <View style={styles.composerLegsHeaderRight}>
          {draft.legs.length > 1 ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Split allocation evenly"
              hitSlop={8}
              onPress={onEvenSplit}
              style={styles.composerEvenSplitBtn}
            >
              <Ionicons name="options-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.composerEvenSplitLabel}>Even split</Text>
            </PressableScale>
          ) : null}

        </View>
      </View>

      {draft.legs.length === 0 ? (
        <View style={styles.composerAssetChoices}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add stocks"
            onPress={() => onAddLeg("stocks")}
            style={({ pressed }) => [
              styles.composerAssetChoice,
              pressed && styles.composerAssetChoicePressed,
            ]}
          >
            <View style={styles.composerAssetChoiceIcon}>
              <Ionicons name="layers-outline" size={21} color={colors.text} />
            </View>
            <Text style={styles.composerAssetChoiceTitle}>Stocks</Text>
            <Text style={styles.composerAssetChoiceBody}>
              Build a long basket with multiple assets.
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a perp"
            onPress={() => onAddLeg("perps")}
            style={({ pressed }) => [
              styles.composerAssetChoice,
              styles.composerAssetChoicePerp,
              pressed && styles.composerAssetChoicePressed,
            ]}
          >
            <View style={[styles.composerAssetChoiceIcon, styles.composerAssetChoiceIconPerp]}>
              <Ionicons name="trending-up" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.composerAssetChoiceTitle}>Perp</Text>
            <Text style={styles.composerAssetChoiceBody}>
              Choose one asset, then go long or short.
            </Text>
          </Pressable>
        </View>
      ) : (
        draft.legs.map((leg, index) => (
          <ComposerLegRow
            key={leg.id}
            leg={leg}
            index={index}
            ratios={ratios}
            liveRatios={liveRatios}
            setLiveRatios={setLiveRatios}
            initialPct={initialPercents[index] ?? 0}
            onRemove={() => onRemoveLeg(leg.id)}
            onCommitRatios={onCommitRatios}
            sliderDisabled={legCount <= 1}
          />
        ))
      )}

      {draft.legs.length > 0 ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={isPerpDraft ? "Change asset" : "Add another stock"}
          onPress={() => onAddLeg(isPerpDraft ? "perps" : "stocks")}
          style={styles.composerAddLeg}
        >
          <View
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            onLayout={({ nativeEvent: { layout } }) => {
              setAddLegSize((current) => current.width === layout.width && current.height === layout.height
                ? current : { width: layout.width, height: layout.height });
            }}
          >
            {addLegSize.width > 4 && addLegSize.height > 4 ? (
              <Svg width="100%" height="100%" viewBox={`0 0 ${addLegSize.width} ${addLegSize.height}`}>
                <Rect
                  x={2}
                  y={2}
                  width={addLegSize.width - 4}
                  height={addLegSize.height - 4}
                  rx={12}
                  fill="none"
                  stroke={colors.border}
                  strokeWidth={1.5}
                  strokeDasharray="8 5"
                />
              </Svg>
            ) : null}
          </View>
          <Ionicons name={isPerpDraft ? "swap-horizontal" : "add"} size={18} color={colors.textSecondary} />
          <Text style={styles.composerAddLegLabel}>
            {isPerpDraft ? "Change asset" : "Add stock"}
          </Text>
        </PressableScale>
      ) : null}

      {isPerpDraft && draft.legs.length === 1 ? (
        <>
          <View style={styles.composerLegsHeader}>
            <Text style={styles.composerFieldLabel}>outlook</Text>
          </View>
          <View style={styles.composerOutlookRow}>
            {(["up", "down"] as const).map((option) => {
              const active = isShortDraft ? option === "down" : option === "up";
              const bearish = option === "down";
              const tone = bearish ? colors.negative : colors.positive;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={bearish ? "Bearish, price falls" : "Bullish, price rises"}
                  onPress={() => onChangeDirection(option)}
                  style={({ pressed }) => [
                    styles.composerOutlookChoice,
                    {
                      backgroundColor: active ? withAlpha(tone, 0.13) : colors.surfaceAlt,
                      borderColor: active ? tone : colors.border,
                    },
                    pressed && styles.composerOutlookChoicePressed,
                  ]}
                >
                  <View style={[styles.composerOutlookIcon, { backgroundColor: tone }]}>
                    <Ionicons
                      name={bearish ? "trending-down" : "trending-up"}
                      size={20}
                      color={bearish ? "#FFFFFF" : "#0B1622"}
                    />
                  </View>
                  <View style={styles.composerOutlookCopy}>
                    <Text style={styles.composerOutlookTitle}>
                      {bearish ? "Bearish" : "Bullish"}
                    </Text>
                    <Text style={styles.composerOutlookBody}>
                      {bearish ? "Price falls" : "Price rises"}
                    </Text>
                  </View>
                  <Ionicons
                    name={active ? "checkmark-circle" : "ellipse-outline"}
                    size={19}
                    color={active ? tone : colors.iconMuted}
                  />
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {!draft.remixOf ? (
        <>
      {/* Choose the composition first, then explain the take. */}
      <View style={styles.composerLegsHeader}>
        <Text style={styles.composerFieldLabel}>your take</Text>
        {draft.commentary.length > 0 ? (
          <Text
            style={[
              styles.composerCommentaryCount,
              commentaryLeft < 0 && styles.composerCommentaryCountOver,
            ]}
          >
            {commentaryLeft}
          </Text>
        ) : null}
      </View>
      <View style={styles.composerCommentaryWrap}>
        <TextInput
          value={draft.commentary}
          onChangeText={onChangeCommentary}
          multiline
          accessibilityLabel="Your take on this Sandwich"
          textAlignVertical="top"
          autoCapitalize="sentences"
          maxLength={MAX_COMMENTARY_LENGTH}
          placeholder={
            draft.remixOf ? "What did you change, and why?" : "Why this asset, and why now?"
          }
          placeholderTextColor={colors.textTertiary}
          style={styles.composerCommentaryInput}
        />
      </View>
        </>
      ) : null}
    </View>
  );
}

/**
 * Set leg `index` to `target` (0–1) and rescale every OTHER leg proportionally
 * to its share in `base` (the split when the drag began) so the total stays at
 * exactly 100%. Results are whole percentage points: the dragged leg gets its
 * rounded target, the remainder is spread over the others by largest
 * remainder. Rescaling from the drag-start snapshot (not the live array) keeps
 * the others' relative proportions stable however far the thumb travels, and
 * lets a leg drained to 0% grow back when the drag reverses.
 */
function redistributeFromBase(base: number[], index: number, target: number): number[] {
  "worklet";
  const n = base.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const targetPct = Math.round(Math.max(0, Math.min(1, target)) * 100);
  const remaining = 100 - targetPct;
  let othersSum = 0;
  for (let i = 0; i < n; i++) {
    if (i !== index) othersSum += Math.max(0, base[i] ?? 0);
  }
  const floors = new Array<number>(n).fill(0);
  const fracs = new Array<number>(n).fill(-1);
  let assigned = 0;
  for (let i = 0; i < n; i++) {
    if (i === index) continue;
    // Others that were all at 0% share the remainder equally.
    const share = othersSum > 0 ? Math.max(0, base[i] ?? 0) / othersSum : 1 / (n - 1);
    const exact = share * remaining;
    floors[i] = Math.floor(exact);
    fracs[i] = exact - floors[i];
    assigned += floors[i];
  }
  let left = remaining - assigned;
  while (left > 0) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (i !== index && (best < 0 || fracs[i] > fracs[best])) best = i;
    }
    floors[best] += 1;
    fracs[best] = -1;
    left -= 1;
  }
  floors[index] = targetPct;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = floors[i] / 100;
  return out;
}

function ComposerLegRow({
  leg,
  index,
  ratios,
  liveRatios,
  setLiveRatios,
  initialPct,
  onRemove,
  onCommitRatios,
  sliderDisabled = false,
}: {
  leg: SandwichLeg;
  index: number;
  // Shared array of every leg's allocation ratio (0–1), owned by the parent.
  ratios: SharedValue<number[]>;
  liveRatios: number[];
  setLiveRatios: React.Dispatch<React.SetStateAction<number[]>>;
  // Fair (largest-remainder) whole-percent value for this leg's very first
  // paint, computed across all legs so every row's label sums to exactly 100.
  initialPct: number;
  onRemove: () => void;
  // Commit the final ratios array to React state (called once, on gesture end).
  onCommitRatios: (ratios: number[]) => void;
  sliderDisabled?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();

  const dragBase = useRef<number[] | null>(null);
  const changeAllocation = (percent: number, commit = false) => {
    if (!dragBase.current) dragBase.current = ratios.value.slice();
    const next = redistributeFromBase(dragBase.current, index, percent / 100);
    ratios.value = next;
    setLiveRatios(next);
    if (commit) {
      dragBase.current = null;
      onCommitRatios(next);
    }
  };
  const percent = fairPercents(liveRatios)[index] ?? initialPct;

  return (
    <View style={styles.composerLegRow}>
      {/* Header: icon | name + subtitle | allocation | remove */}
      <View style={styles.composerLegHead}>
        <RemoteAssetLogo
          uri={leg.imageUrl}
          size={32}
          borderRadius={16}
          backgroundColor={colors.surfaceAlt}
          fallback={
            <View style={[styles.composerLegImage, styles.composerLegImageFallback]}>
              <Text style={styles.composerLegImageFallbackLabel}>
                {leg.symbol?.slice(0, 2) ?? leg.label.slice(0, 2)}
              </Text>
            </View>
          }
        />
        <View style={styles.composerLegInfo}>
          <Text style={styles.composerLegTitle} numberOfLines={1}>
            {leg.symbol ?? leg.label ?? leg.question}
          </Text>
          <Text style={styles.composerLegSubtitle} numberOfLines={1}>
            {leg.type === "tokenized_stock"
              ? leg.venue === "perp" ? "Perpetual" : "xStock"
              : leg.question && leg.question !== leg.label
                ? leg.question
                : "prediction market"}
          </Text>
        </View>
        <Text style={styles.composerAllocationPct}>{percent}%</Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Remove ${leg.symbol ?? leg.label}`}
          hitSlop={8}
          onPress={onRemove}
          style={styles.composerLegRemove}
        >
          <Ionicons name="close" size={16} color={colors.textTertiary} />
        </PressableScale>
      </View>

      {!sliderDisabled ? (
        <ScaleRuler
          value={percent}
          min={0}
          max={100}
          step={1}
          majorEvery={25}
          accent={colors.actionPrimary}
          formatValue={(value) => `${value}%`}
          formatTick={(value) => `${value}`}
          hideBubble
          height={28}
          relativeDrag
          smoothDrag
          hapticEvery={5}
          onChange={(value) => changeAllocation(value)}
          onCommit={(value) => changeAllocation(value, true)}
        />
      ) : null}
    </View>
  );
}

// Deterministic, lightweight sparkline for the Add-legs grid. The Stock API
// returns a price + 24h change but no series, and fetching OHLCV per card would
// be far too heavy for an 80-item grid — so this draws a seeded squiggle that
// trends in the direction of the real 24h move and is colored to match.
function seededLine(seed: string, up: boolean): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };
  const count = 16;
  const points: number[] = [];
  for (let i = 0; i < count; i++) {
    const trend = (i / (count - 1)) * (up ? -0.55 : 0.55);
    const jitter = (rand() - 0.5) * 0.5;
    points.push(0.5 + trend + jitter);
  }
  return points;
}

function MiniSparkline({ seed, up }: { seed: string; up: boolean }) {
  const W = 150;
  const H = 44;
  const { line, area } = useMemo(() => {
    const ys = seededLine(seed, up);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const span = max - min || 1;
    const pad = 4;
    const coords = ys.map((y, i) => {
      const x = (i / (ys.length - 1)) * W;
      const norm = (y - min) / span;
      const py = pad + (1 - norm) * (H - pad * 2);
      return [x, py] as const;
    });
    const linePath = coords
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ");
    const areaPath = `${linePath} L${W} ${H} L0 ${H} Z`;
    return { line: linePath, area: areaPath };
  }, [seed, up]);

  const stroke = up ? "#22C55E" : "#EB1C40";
  const fill = up ? "rgba(34,197,94,0.12)" : "rgba(255,51,201,0.12)";

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <Path d={area} fill={fill} />
      <Path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

// Sandwiches are tokenized stocks only. The "Prediction" tab was removed with
// prediction-market legs: they settle on a separate venue that the atomic buy
// bundle can't include, so a basket containing one was never executable.
// Prediction markets are still tradeable on their own from search.
type LegCategory = "stocks" | "perps" | "crypto";

const LEG_CATEGORIES: { key: LegCategory; label: string }[] = [
  { key: "stocks", label: "Stocks" },
  { key: "perps", label: "Perps" },
  { key: "crypto", label: "Crypto" },
];

// Rendered as an inline animated overlay *inside* the ComposerSheet modal (not
// a second BottomSheetModal — nesting modals is broken on this stack). `active`
// reflects the overlay's open state so the data effects only fetch while it's
// visible. See [[bottom-sheet-present-pattern]].
function LegPickerOverlay({
  active,
  initialCategory,
  onClose,
  onPicked,
  onRemoveMint,
  legsCount,
  selectedMints,
  selectedPerpMints,
}: {
  active: boolean;
  initialCategory: LegCategory;
  onClose: () => void;
  onPicked: (leg: SandwichLeg) => void;
  onRemoveMint: (mint: string) => void;
  legsCount: number;
  selectedMints: Set<string>;
  selectedPerpMints: Set<string>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const [category, setCategory] = useState<LegCategory>("stocks");
  const [query, setQuery] = useState("");
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [perpAssets, setPerpAssets] = useState<{ stock: Stock; market: PhoenixMarket }[]>([]);
  const [perpsLoading, setPerpsLoading] = useState(false);
  const stocksDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Each open starts on the venue the review screen asked for. "Change perp"
  // returns directly to perps; the generic first open still starts on Stocks.
  useEffect(() => {
    if (!active) return;
    setCategory(initialCategory);
    setQuery("");
  }, [active, initialCategory]);

  // Stocks: free-text search hits the tokens.xyz catalogue (full asset
  // universe); an empty query falls back to the curated top-volume list.
  useEffect(() => {
    if (!active || category !== "stocks") return;
    const term = query.trim();
    if (stocksDebounceRef.current) clearTimeout(stocksDebounceRef.current);
    setStocksLoading(true);
    stocksDebounceRef.current = setTimeout(
      () => {
        void getTopHolderStocks(term ? { q: term, limit: 60 } : { limit: 80 })
          .then((rows) => setStocks(rows))
          .catch(() => setStocks([]))
          .finally(() => setStocksLoading(false));
      },
      term ? 320 : 0,
    );
    return () => {
      if (stocksDebounceRef.current) clearTimeout(stocksDebounceRef.current);
    };
  }, [active, category, query]);

  // Perps use the same asset identity and mint as their xStock counterpart,
  // but only assets with a live Phoenix equity market belong on this board.
  // Fetching the full stock catalogue once gives the eventual commit the mint
  // it needs while Phoenix remains the source of truth for availability.
  useEffect(() => {
    if (!active || category !== "perps") return;
    let cancelled = false;
    setPerpsLoading(true);
    void Promise.all([
      listPhoenixMarkets(),
      getTopHolderStocks({ limit: 500 }),
    ])
      .then(([markets, stockRows]) => {
        if (cancelled) return;
        const equityMarkets = markets.filter((market) => market.category === "equity");
        const seen = new Set<string>();
        const matches: { stock: Stock; market: PhoenixMarket }[] = [];
        for (const stock of stockRows) {
          const market = findPhoenixMarketForAsset(equityMarkets, {
            symbol: stock.symbol,
            name: stock.name,
            category: stock.category,
          });
          const key = market?.symbol.trim().toUpperCase();
          if (!market || !key || seen.has(key)) continue;
          seen.add(key);
          matches.push({ stock, market });
        }
        setPerpAssets(matches);
      })
      .catch(() => {
        if (!cancelled) setPerpAssets([]);
      })
      .finally(() => {
        if (!cancelled) setPerpsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, category]);

  const visiblePerpAssets = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return perpAssets;
    return perpAssets.filter(({ stock, market }) =>
      `${stock.symbol} ${stock.name} ${market.symbol} ${market.name}`.toLowerCase().includes(term),
    );
  }, [perpAssets, query]);

  // Tap-to-select: stocks toggle on/off the basket. The basket weight is
  // assigned automatically (equal split) by the parent's addLeg, then
  // fine-tuned in the review step — so there's no per-leg weight prompt while
  // picking.
  const handlePickStock = useCallback(
    (stock: Stock) => {
      void Haptics.selectionAsync();
      if (stock.id && selectedMints.has(stock.id)) {
        onRemoveMint(stock.id);
        return;
      }
      onPicked(stockToLeg(stock, 0));
    },
    [onPicked, onRemoveMint, selectedMints],
  );

  const handlePickPerp = useCallback(
    (stock: Stock, market: PhoenixMarket) => {
      void Haptics.selectionAsync();
      if (stock.id && selectedPerpMints.has(stock.id)) {
        onRemoveMint(stock.id);
        return;
      }
      onPicked(perpStockToLeg(stock, market, 0));
    },
    [onPicked, onRemoveMint, selectedPerpMints],
  );

  return (
    <View style={styles.legPickerShell}>
          <View style={styles.addLegsHeader}>
            <Text style={styles.addLegsTitle}>Add legs</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done"
              hitSlop={12}
              onPress={onClose}
            >
              <Text style={styles.composerNavCancelText}>done</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.categoryTabsScroll}
            contentContainerStyle={styles.categoryTabsRow}
          >
            {LEG_CATEGORIES.map((cat) => {
              const isActive = category === cat.key;
              return (
                <PressableScale
                  key={cat.key}
                  accessibilityRole="button"
                  accessibilityLabel={cat.label}
                  onPress={() => {
                    setCategory(cat.key);
                    // Each tab keeps its own discovery list; clear the shared
                    // query so a search doesn't leak across tabs.
                    setQuery("");
                  }}
                  style={[styles.categoryTab, isActive && styles.categoryTabActive]}
                >
                  <Text
                    style={[
                      styles.categoryTabLabel,
                      isActive && styles.categoryTabLabelActive,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
          {category !== "crypto" ? (
            <View style={styles.legPickerSearchRow}>
              <View style={styles.composerSearchWrap}>
                <Ionicons name="search" size={16} color={colors.textSecondary} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={category === "perps" ? "Search perp assets" : "Search all assets"}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.composerSearchInput}
                />
                {query.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={8}
                    onPress={() => setQuery("")}
                  >
                    <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
          {category === "perps" ? (
            <View style={styles.perpPickerNotice}>
              <Ionicons name="shield-checkmark" size={14} color={colors.textSecondary} />
              <Text style={styles.perpPickerNoticeText}>
                One perp per Sandwich. Choosing one replaces any stock basket.
              </Text>
            </View>
          ) : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
            style={styles.thesisComposerScroll}
            contentContainerStyle={styles.addLegsScrollContent}
          >
            {category === "stocks" ? (
              stocksLoading ? (
                <View style={styles.composerLoading}>
                  <ActivityIndicator color={colors.icon} />
                </View>
              ) : stocks.length === 0 ? (
                <Text style={styles.composerEmptyHint}>
                  {query.trim()
                    ? "No assets found."
                    : "No stocks available right now."}
                </Text>
              ) : (
                <View style={styles.stockGrid}>
                  {stocks.slice(0, 60).map((stock) => (
                    <StockGridCard
                      key={stock.id}
                      stock={stock}
                      selected={!!stock.id && selectedMints.has(stock.id)}
                      onPick={() => handlePickStock(stock)}
                    />
                  ))}
                </View>
              )
            ) : category === "perps" ? (
              perpsLoading ? (
                <View style={styles.composerLoading}>
                  <ActivityIndicator color={colors.icon} />
                </View>
              ) : visiblePerpAssets.length === 0 ? (
                <Text style={styles.composerEmptyHint}>
                  {query.trim() ? "No perp assets found." : "No perp markets available right now."}
                </Text>
              ) : (
                <View style={styles.stockGrid}>
                  {visiblePerpAssets.map(({ stock, market }) => (
                    <PerpGridCard
                      key={market.marketPubkey}
                      stock={stock}
                      market={market}
                      selected={!!stock.id && selectedPerpMints.has(stock.id)}
                      onPick={() => handlePickPerp(stock, market)}
                    />
                  ))}
                </View>
              )
            ) : (
              <View style={styles.comingSoonWrap}>
                <Text style={styles.comingSoonEmoji}>🪙</Text>
                <Text style={styles.comingSoonTitle}>Crypto coming soon</Text>
                <Text style={styles.comingSoonBody}>
                  {"Spot crypto legs aren't available yet. Stack stocks or choose a perp for now."}
                </Text>
              </View>
            )}
          </ScrollView>
          <View style={styles.reviewBar}>
            <View style={styles.reviewBarLeft}>
              <Text style={styles.reviewBarEmoji}>🥪</Text>
              <Text style={styles.reviewBarCount}>
                {legsCount === 0
                  ? "No legs yet"
                  : `${legsCount} leg${legsCount === 1 ? "" : "s"}`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Review sandwich"
              onPress={onClose}
              style={styles.reviewBarBtn}
            >
              <Text style={styles.reviewBarBtnText}>Review</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.text} />
            </Pressable>
          </View>
    </View>
  );
}
function StockGridCard({
  stock,
  selected,
  onPick,
}: {
  stock: Stock;
  selected: boolean;
  onPick: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const change = stock.priceChange24h;
  const up = (change ?? 0) >= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${stock.symbol}`}
      onPress={onPick}
      style={({ pressed }) => [
        styles.stockCard,
        selected && styles.stockCardSelected,
        pressed && styles.stockCardPressed,
      ]}
    >
      <View style={styles.stockCardTop}>
        <RemoteAssetLogo
          uri={stock.icon}
          size={46}
          borderRadius={12}
          fallback={
            <View
              style={[styles.stockLogo, { backgroundColor: getAvatarColor(stock.symbol) }]}
            >
              <Text style={styles.stockLogoLetter}>
                {stock.symbol.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          }
        />
        <View style={[styles.stockPlus, selected && styles.stockPlusSelected]}>
          <Ionicons name={selected ? "checkmark" : "add"} size={18} color={colors.textInverse} />
        </View>
      </View>
      <Text style={styles.stockName} numberOfLines={1}>
        {stock.name}
      </Text>
      <View style={styles.stockTickerRow}>
        <Text style={styles.stockTicker} numberOfLines={1}>
          {stock.symbol}
        </Text>
        <View style={styles.stockBadge}>
          <Text style={styles.stockBadgeText}>STOCK</Text>
        </View>
      </View>
      <View style={styles.stockSparkWrap}>
        <MiniSparkline seed={stock.symbol} up={up} />
      </View>
      <View style={styles.stockPriceRow}>
        <Text style={styles.stockPrice} numberOfLines={1}>
          {stock.usdPrice != null ? `$${stock.usdPrice.toFixed(2)}` : "--"}
        </Text>
        <Text
          style={[styles.stockChange, up ? styles.stockChangeUp : styles.stockChangeDown]}
          numberOfLines={1}
        >
          {change != null ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "--"}
        </Text>
      </View>
    </Pressable>
  );
}
function PerpGridCard({
  stock,
  market,
  selected,
  onPick,
}: {
  stock: Stock;
  market: PhoenixMarket;
  selected: boolean;
  onPick: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const change = stock.priceChange24h;
  const up = (change ?? 0) >= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${selected ? "Remove" : "Add"} ${market.symbol} perp`}
      onPress={onPick}
      style={({ pressed }) => [
        styles.stockCard,
        selected && styles.stockCardSelected,
        pressed && styles.stockCardPressed,
      ]}
    >
      <View style={styles.stockCardTop}>
        <RemoteAssetLogo
          uri={market.iconUri ?? stock.icon ?? market.logoUri}
          size={46}
          borderRadius={12}
          fallback={
            <View style={[styles.stockLogo, { backgroundColor: getAvatarColor(market.symbol) }]}>
              <Text style={styles.stockLogoLetter}>{market.symbol.slice(0, 1)}</Text>
            </View>
          }
        />
        <View style={[styles.stockPlus, selected && styles.stockPlusSelected]}>
          <Ionicons name={selected ? "checkmark" : "add"} size={18} color={colors.textInverse} />
        </View>
      </View>
      <Text style={styles.stockName} numberOfLines={1}>{market.name || stock.name}</Text>
      <View style={styles.stockTickerRow}>
        <Text style={styles.stockTicker} numberOfLines={1}>{market.symbol}</Text>
        <View style={styles.stockBadge}>
          <Text style={styles.stockBadgeText}>PERP · {market.maxLeverage}X</Text>
        </View>
      </View>
      <View style={styles.stockSparkWrap}>
        <MiniSparkline seed={`perp-${market.symbol}`} up={up} />
      </View>
      <View style={styles.stockPriceRow}>
        <Text style={styles.stockPrice} numberOfLines={1}>
          {stock.usdPrice != null ? `$${stock.usdPrice.toFixed(2)}` : "--"}
        </Text>
        <Text style={[styles.stockChange, up ? styles.stockChangeUp : styles.stockChangeDown]} numberOfLines={1}>
          {change != null ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "--"}
        </Text>
      </View>
    </Pressable>
  );
}
// Timeframe pills under the detail chart. Order = shortest → longest lookback.
const CHART_RANGE_PILLS: { label: string; range: SandwichChartRange; seconds: number }[] = [
  { label: "24H", range: "24H", seconds: 24 * 60 * 60 },
  { label: "1W", range: "1W", seconds: 7 * 24 * 60 * 60 },
  { label: "1M", range: "1M", seconds: 30 * 24 * 60 * 60 },
  { label: "3M", range: "3M", seconds: 90 * 24 * 60 * 60 },
  { label: "ALL", range: "ALL", seconds: Number.POSITIVE_INFINITY },
];

function sandwichAgeSeconds(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const age = (Date.now() - new Date(createdAt).getTime()) / 1000;
  return Number.isFinite(age) ? age : null;
}

/**
 * The pills a sandwich offers depend on how long it has been live: only windows
 * shorter than its life, plus ALL (since it was posted). A two-day-old sandwich
 * gets 24H and ALL; a two-month-old one 24H, 1W, 1M and ALL. A window longer
 * than the sandwich's life would just be ALL again under another name.
 */
function chartRangePills(createdAt: string | null) {
  const age = sandwichAgeSeconds(createdAt);
  if (age === null) return CHART_RANGE_PILLS;
  return CHART_RANGE_PILLS.filter((pill) => pill.range === "ALL" || pill.seconds < age);
}

// Open on ALL — the whole life of the thesis — so the curve on open spans exactly
// the period the headline "since posted" PnL is measured over. The pills then let
// the viewer zoom into a more recent window (which reports its own return to the
// headline; see the chart's `isWindowedView`).
function defaultChartRange(): SandwichChartRange {
  return "ALL";
}
// Lines the hero thesis quote shows before it collapses behind a "more" toggle.
const HERO_THESIS_COLLAPSED_LINES = 6;
/**
 * Detail-screen like button. Same interaction as elsewhere, but the icon
 * scales up briefly on like-commit — asymmetric on purpose: the loud action
 * (liking) gets a small burst; the quiet action (unliking) stays silent
 * (Emil: state indication + asymmetric enter/exit timing).
 */
function DetailLikeButton({
  liked,
  count,
  onPress,
}: {
  liked: boolean;
  count: number;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const heartRef = useRef<HeartToggleRef>(null);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={liked ? "Unlike sandwich" : "Like sandwich"}
      onPress={() => {
        // Fire the heart from the tap itself. Waiting on the `liked` prop meant
        // waiting on a full detail-screen re-render — chart and all — before
        // the burst could even start.
        heartRef.current?.toggle(!liked);
        onPress();
      }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.detailMetaBtn,
        styles.detailMetaBtnLeading,
        pressed && { opacity: 0.6 },
      ]}
    >
      {/* The heart anchors to the timestamp's left edge; the count hangs off it
          out of flow so appearing digits never shift that alignment. */}
      <View style={styles.detailLikeHeart}>
        <HeartToggle ref={heartRef} liked={liked} size={26} idleColor={colors.textSecondary} />
        {count > 0 ? (
          <View pointerEvents="none" style={styles.detailLikeCountSlot}>
            <Text
              numberOfLines={1}
              style={[
                styles.detailMetaCount,
                liked && { color: LIKE_PINK },
              ]}
            >
              {formatSocialCount(count)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
function formatSellTokenAmount(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value
    .toFixed(Math.max(0, decimals))
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
function scaleSandwichPosition(
  position: SandwichPosition,
  soldFraction: number,
): SandwichPosition | null {
  const normalizedFraction = Math.max(0, Math.min(1, soldFraction));
  if (normalizedFraction >= 0.995) return null;
  const remainingFraction = 1 - normalizedFraction;
  const remainingBps = BigInt(Math.round(remainingFraction * 10_000));
  const legs = position.legs.map((leg) => {
    const inputAmount = leg.inputAmount ? BigInt(leg.inputAmount) : null;
    const outputAmount = leg.outputAmount ? BigInt(leg.outputAmount) : null;
    return {
      ...leg,
      inputAmount:
        inputAmount === null
          ? null
          : ((inputAmount * remainingBps) / 10_000n).toString(),
      outputAmount:
        outputAmount === null
          ? null
          : ((outputAmount * remainingBps) / 10_000n).toString(),
      investedUsd:
        leg.investedUsd === null ? null : leg.investedUsd * remainingFraction,
    };
  });
  return {
    ...position,
    investedUsd:
      position.investedUsd === null
        ? null
        : position.investedUsd * remainingFraction,
    updatedAt: new Date().toISOString(),
    pendingSync: true,
    legs,
  };
}
/**
 * Closing a Sandwich position. Exported because the podcast episode screen owns
 * the only other surface a held Sandwich is reachable from — a YouTube call has
 * no detail route of its own — and a second copy of this exit path is the last
 * thing a sell should have.
 */
export function SandwichSellPad({
  position,
  sandwich,
  thesisContent,
  onClose,
  onToast,
  onCelebrate,
  onPositionUpdated,
}: {
  position: SandwichPosition;
  /** The sandwich behind the position. A position carries no thesis or origin
   *  of its own, and the sell pad shows the same post the buy pad did. */
  sandwich?: Sandwich | null;
  /**
   * What sits above the keypad, when the caller's own buy pad shows something
   * other than the post. The podcast episode screen passes its call caption:
   * the default card would draw the episode's YouTube embed a second time,
   * directly under the player already playing it.
   */
  thesisContent?: React.ReactNode;
  onClose: () => void;
  onToast: (toast: ToastState, duration?: number) => void;
  /** Opens the exit receipt (`tradeFx.playSandwich`); returns its id so the
   *  "selling…" state can be flipped to the result or taken down. */
  onCelebrate?: (event: SandwichFxEvent) => number;
  onPositionUpdated: (position: SandwichPosition | null) => void;
}) {
  const solanaWallet = useEmbeddedSolanaWallet();
  const wallet = solanaWallet.wallets?.[0] ?? null;
  const walletStore = useWalletStore();
  // The sell amount must be the buyer's own marked stake, never the sandwich's
  // return since creation. That older model made a late buyer sell units they
  // never owned on paper.
  const positionValuation = valueSandwichPosition(
    position.legs,
    new Map(walletStore.tokens.filter((token) => token.mint).map((token) => [token.mint!, token])),
    walletStore.hasLoaded,
    position.legs.map((leg) => leg.mint),
  );
  const positionValue = positionValuation.valueUsd;
  const fullPositionAmount = positionValue.toFixed(2);
  const hasPredictionLeg = position.legs.some(
    (leg) => leg.kind === "prediction",
  );
  const [amount, setAmount] = useState(fullPositionAmount);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setAmount(fullPositionAmount);
    setMessage(null);
    setSubmitting(false);
  }, [fullPositionAmount, position.id]);
  const numericAmount = Number(amount);
  const amountIsValid =
    isValidDisplayAmount(amount) &&
    numericAmount > 0 &&
    numericAmount <= positionValue + Math.max(positionValue * 1e-6, 0.01);
  const isFullClose =
    positionValue > 0 &&
    numericAmount >= positionValue - Math.max(positionValue * 1e-4, 0.01);
  const canSell =
    !!wallet?.address &&
    amountIsValid &&
    (!hasPredictionLeg || isFullClose) &&
    !submitting;
  const tapKey = useCallback((key: string) => {
    setMessage(null);
    setAmount((current) => {
      if (key === "del") return current.length <= 1 ? "0" : current.slice(0, -1);
      if (key === ".") return current.includes(".") ? current : `${current || "0"}.`;
      if (current === "0") return key;
      return `${current}${key}`;
    });
  }, []);
  const tapPreset = useCallback(
    (preset: string) => {
      setMessage(null);
      const fraction =
        preset === "25%" ? 0.25 : preset === "50%" ? 0.5 : 1;
      setAmount((positionValue * fraction).toFixed(2));
    },
    [positionValue],
  );
  const sell = useCallback(async () => {
    if (!wallet?.address) {
      setMessage("Wallet is not available.");
      return;
    }
    if (!amountIsValid) {
      setMessage(`Enter an amount up to ${formatMoneyUsd(positionValue) ?? "$0.00"}.`);
      return;
    }
    if (hasPredictionLeg && !isFullClose) {
      setMessage("Prediction baskets can only be closed in full.");
      return;
    }
    const sellFraction = hasPredictionLeg
      ? 1
      : Math.max(0, Math.min(1, numericAmount / positionValue));
    // The exit receipt for a given executed share. It opens at once in its
    // "selling…" state — the same progress surface a stock sell uses — so the
    // wait happens on the screen that reports the result, not behind the pad.
    const sellReceipt = (executedFraction: number): SandwichFxEvent => ({
      action: "sell",
      icons: position.legs.map((leg) => leg.imageUrl),
      label: position.name,
      percent: Math.round(executedFraction * 100),
      amountUsd: positionValue * executedFraction,
      pnlUsd: positionValuation.pnlUsd * executedFraction,
      sincePnlPct: sandwich?.pnlPct ?? null,
      source: sandwich?.source ?? null,
      // Same receipt as the buy: a sell closes the same moment, so it quotes
      // the same line.
      caption: momentReceiptLine(sandwich ?? null),
    });
    // Spot legs share the server's packed exit path with the profile screen:
    // quote all legs in parallel, sign the compact transaction set, then submit
    // once. The former loop below is kept only for legacy prediction positions.
    if (!hasPredictionLeg) {
      Keyboard.dismiss();
      setSubmitting(true);
      setMessage(null);
      const receiptId = onCelebrate?.({ ...sellReceipt(sellFraction), loading: true }) ?? null;
      // Once the sell has landed the receipt is the result; a later bookkeeping
      // error must not take it away.
      let receiptSettled = false;
      try {
        const fractionBps = sellFraction >= 0.995
          ? 10_000
          : Math.max(1, Math.round(sellFraction * 10_000));
        // Demo mode exits against the paper account at the value on screen.
        const result = isDemoBuyMode()
          ? await demoSandwichExit({
              sandwichId: position.sandwichId,
              fraction: sellFraction,
              proceedsUsd: positionValue * sellFraction,
            })
          : await (async () => {
            const started = await startSandwichSell(position.sandwichId, fractionBps);
            if (started.status !== "needs_signature" || started.transactions.length === 0) {
              throw new Error(started.status === "failed" ? started.reason : "Sell was not ready to sign.");
            }
            const provider = await wallet.getProvider();
            const signed: string[] = [];
            for (const transaction of started.transactions) {
              const signedPayload = await provider.request({
                method: "signTransaction",
                params: { transaction: deserializeJupiterTransaction(transaction) },
              });
              signed.push(Buffer.from(serializeSignedTransaction(signedPayload.signedTransaction)).toString("base64"));
            }
            const submitted = await submitSignedBasketBuy(started.basketRunId, signed);
            if (submitted.status === "failed") throw new Error(submitted.reason || "Sell did not confirm.");
            return submitted;
            })();
        const attempted = result.status === "partial"
          ? result.landedLegIds.length + result.failedLegIds.length
          : position.legs.length;
        const filledShare = result.status === "partial"
          ? result.landedLegIds.length / Math.max(1, attempted)
          : 1;
        const executedFraction = sellFraction * filledShare;
        if (executedFraction <= 0) throw new Error("No sandwich layers were sold.");
        // The sell landed: flip the receipt now. Ledger and balance refreshes
        // are bookkeeping and never stand between a fill and its success screen.
        if (receiptId !== null) updateSandwichFx(receiptId, sellReceipt(executedFraction));
        receiptSettled = true;
        onClose();
        // Local ledger only — the sell already landed, so a write error here
        // must not read as "Sell stopped".
        await recordSandwichPositionSell(wallet.address, position.id, executedFraction).catch(
          () => undefined,
        );
        onPositionUpdated(scaleSandwichPosition(position, executedFraction));
        void Promise.all([walletStore.refresh(), walletStore.reloadCostBasis()]).catch(
          () => undefined,
        );
      } catch (error) {
        if (receiptId !== null && !receiptSettled) dismissSandwichFx(receiptId);
        const nextMessage = humanizeErrorMessage(error, "Sell failed. Your unsold assets are still in your wallet.");
        setMessage(nextMessage);
        onToast({ text: "Sell stopped", tone: "error" });
      } finally {
        setSubmitting(false);
      }
      return;
    }
    type SellableLeg =
      | {
          kind: "prediction";
          leg: SandwichPosition["legs"][number];
        }
      | {
          kind: "swap";
          leg: SandwichPosition["legs"][number];
          token: WalletBalanceToken;
        };
    const sellableLegs = position.legs.flatMap((leg): SellableLeg[] => {
      if (leg.kind === "prediction") {
        return leg.positionPubkey ? [{ kind: "prediction" as const, leg }] : [];
      }
      const token = walletStore.tokens.find(
        (candidate) => candidate.mint === leg.mint && candidate.balance > 0,
      );
      return token ? [{ kind: "swap" as const, leg, token }] : [];
    });
    if (sellableLegs.length === 0) {
      setMessage("No remaining sandwich assets are available to sell.");
      return;
    }
    Keyboard.dismiss();
    // Exits run silent — the receipt opens in its "selling…" state at once.
    setSubmitting(true);
    setMessage(null);
    const receiptId = onCelebrate?.({ ...sellReceipt(sellFraction), loading: true }) ?? null;
    let receiptSettled = false;
    let closedPrediction = false;
    try {
      const provider = await wallet.getProvider();
      for (const sellable of sellableLegs) {
        const leg = sellable.leg;
        const label = leg.symbol ?? leg.label;
        if (sellable.kind === "prediction") {
          const closeOrder = await closePredictionPosition({
            positionPubkey: leg.positionPubkey!,
            ownerPubkey: wallet.address,
          });
          const signedPayload = await provider.request({
            method: "signTransaction",
            params: {
              transaction: deserializeJupiterTransaction(closeOrder.transaction),
            },
          });
          const submission = await submitPredictionTransaction({
            signedTransaction: Buffer.from(
              serializeSignedTransaction(signedPayload.signedTransaction),
            ).toString("base64"),
            ...(closeOrder.blockhash ? { blockhash: closeOrder.blockhash } : {}),
            ...(closeOrder.lastValidBlockHeight !== null
              ? { lastValidBlockHeight: closeOrder.lastValidBlockHeight }
              : {}),
          });
          if (
            submission.errorMessage ||
            (submission.status && submission.status !== "Success") ||
            (submission.code !== null && submission.code !== 0)
          ) {
            throw new Error(
              `Stopped at ${label}: ${submission.errorMessage ?? submission.status ?? `error ${submission.code}`}`,
            );
          }
          closedPrediction = true;
          continue;
        }
        const decimals =
          sellable.token.decimals ??
          (await searchJupiterToken(leg.mint, leg.mint).catch(() => null))
            ?.decimals ??
          6;
        const sellAmount = toSmallestUnits(
          formatSellTokenAmount(sellable.token.balance * sellFraction, decimals),
          decimals,
        );
        if (!sellAmount || !isPositiveSmallestUnitAmount(sellAmount)) continue;
        const order = await createJupiterOrder({
          inputMint: leg.mint,
          outputMint: SOLANA_USDC_MINT,
          amount: sellAmount,
          taker: wallet.address,
        });
        const signedPayload = await provider.request({
          method: "signTransaction",
          params: {
            transaction: deserializeJupiterTransaction(order.transaction),
          },
        });
        const execution = await executeJupiterOrder({
          signedTransaction: Buffer.from(
            serializeSignedTransaction(signedPayload.signedTransaction),
          ).toString("base64"),
          requestId: order.requestId,
          ...(order.lastValidBlockHeight
            ? { lastValidBlockHeight: order.lastValidBlockHeight }
            : {}),
        });
        if (
          execution.errorMessage ||
          (execution.status && execution.status !== "Success") ||
          (execution.code !== null && execution.code !== 0)
        ) {
          throw new Error(
            `Stopped at ${label}: ${execution.errorMessage ?? execution.status ?? `error ${execution.code}`}`,
          );
        }
      }
      if (closedPrediction) {
        const settlement = await settleJupUsdToCash({ wallet });
        if (settlement.swapError) {
          onToast({
            text: "Sold — proceeds still converting",
            tone: "processing",
          });
        }
      }
      // Every leg is out: the receipt flips to the result, and the ledger and
      // balance refreshes run behind it.
      if (receiptId !== null) updateSandwichFx(receiptId, sellReceipt(sellFraction));
      receiptSettled = true;
      setMessage(null);
      onClose();
      await recordSandwichPositionSell(wallet.address, position.id, sellFraction).catch(
        () => undefined,
      );
      onPositionUpdated(scaleSandwichPosition(position, sellFraction));
      void Promise.all([walletStore.refresh(), walletStore.reloadCostBasis()]).catch(
        () => undefined,
      );
    } catch (error) {
      if (receiptId !== null && !receiptSettled) dismissSandwichFx(receiptId);
      const nextMessage = humanizeErrorMessage(
        error,
        "Sell failed. Your unsold assets are still in your wallet.",
      );
      setMessage(nextMessage);
      onToast({ text: "Sell stopped", tone: "error" });
    } finally {
      setSubmitting(false);
    }
  }, [
    amountIsValid,
    hasPredictionLeg,
    isFullClose,
    numericAmount,
    onCelebrate,
    onClose,
    onPositionUpdated,
    onToast,
    position,
    positionValuation,
    positionValue,
    sandwich,
    wallet,
    walletStore,
  ]);
  return (
    <TradeAmountPad
      side="sell"
      // Empty for the same reason the buy pad's is: the slider states the verb,
      // and a title repeating it over an empty logo slot said nothing twice.
      title=""
      // Liquid glass confirm, in the sell accent — the buy pad's button with
      // the side's own color, not a green one bolted onto a sell.
      // Same deliberate gesture the buy takes. Suppressed automatically while
      // `confirmLabel` is set, so a blocked prediction close still renders the
      // plain button that can carry the reason.
      slideToConfirm
      amount={amount}
      message={message}
      submitting={submitting}
      canConfirm={canSell}
      onSubmit={sell}
      onTapDigit={tapKey}
      onTapPreset={tapPreset}
      thesisContent={
        thesisContent ?? <SandwichTradeThesisCard sandwich={sandwich ?? null} />
      }
      confirmLabel={
        hasPredictionLeg && !isFullClose ? "Full close only" : undefined
      }
      submittingLabel="Selling..."
      availableLabel={`Position value: ${formatMoneyUsd(positionValue) ?? "$0.00"}`}
      presets={hasPredictionLeg ? ["Max"] : ["25%", "50%", "Max"]}
      noticeText={
        hasPredictionLeg
          ? "Prediction baskets close in full so every outcome position settles together."
          : null
      }
      scrollEnabled={false}
      // No chevron, matching the buy pad: the sheet's drag handle directly
      // above already closes it, and a second dismissal only cost header space.
    />
  );
}
/**
 * Full-screen thesis detail — the route at `(app)/sandwich-detail`. Reads the
 * active sandwich (plus the like/share/toast wiring) from the shared
 * {@link useSandwichDetail} provider, so the feed, search and saved screens all
 * push the exact same screen. Replaces the former `SandwichDetailSheet` bottom
 * sheet; the BUY action is now a button pinned to the bottom of the screen.
 */
export function SandwichDetailScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useThemeStore();
  const isDarkScheme = scheme === "dark";
  const toast = useToast();
  const { canSave, isSaved, toggleSave } = useSavedStore();
  const tradeFx = useTradeFx();
  const commentsSheetRef = useRef<SandwichCommentsSheetRef>(null);
  const commentsAutoOpenedRef = useRef<string | null>(null);
  const buyAutoOpenedRef = useRef<string | null>(null);
  const {
    comments: commentsParam,
    buy: buyParam,
    amount: amountParam,
    id: idParam,
  } = useLocalSearchParams<{
    comments?: string;
    buy?: string;
    /** Copy trade's pre-fill. Only honoured alongside `buy`. */
    amount?: string;
    id?: string;
  }>();
  // Tapping "Trade <asset>" hands off to the shared asset SCREEN, which zooms
  // out of the leg card's own rect. This screen no longer embeds a second copy
  // of the stock detail inside the leg card.
  const {
    open: openStockRoute,
    update: updateStockRoute,
    updateOptions: updateStockRouteOptions,
  } = useStockDetail();
  const insets = useSafeAreaInsets();
  const { scales: elementScales } = useSandwichScaleSettings();
  const { actionSettings } = useSandwichActionSettings();
  // What Buy / Buy more / Sell render as with no dev override in play.
  const actionDefaultColors = useMemo(
    () => ({
      buy: colors.actionPrimary,
      buyMore: colors.actionBuy,
      sell: colors.actionSell,
    }),
    [colors.actionBuy, colors.actionPrimary, colors.actionSell],
  );
  // The fills actually handed to the buttons. `solid` means the fill is meant
  // to read flat, so the alpha the glass tint would soften it with is dropped.
  const { buy: buyFill, buyMore: buyMoreFill, sell: sellFill } = useMemo(() => {
    const resolve = (key: keyof typeof actionDefaultColors) => {
      const setting = actionSettings.actions[key];
      const base = setting.color ?? actionDefaultColors[key];
      return actionSettings.solid ? base : withAlpha(base, setting.opacity);
    };
    return { buy: resolve("buy"), buyMore: resolve("buyMore"), sell: resolve("sell") };
  }, [actionDefaultColors, actionSettings]);
  const {
    sandwich: activeSandwich,
    position,
    viewedPosition,
    updatePosition,
    appUser,
    recoverById,
    peekById,
    toggleLike,
    updateCommentCount,
    share,
    open: openSandwichDetail,
  } =
    useSandwichDetail();
  const { open: openComposer } = useSandwichComposer();
  const isFocused = useIsFocused();
  // Detail routes stack — tapping a leg's related post, or a link inside one,
  // pushes a SECOND copy of this screen — but the provider holds a single
  // "active" sandwich. Left alone, the screen underneath re-renders with
  // whatever the newer route opened, so popping back showed the wrong post.
  // Pin to the id on THIS route, and render the remembered copy while the
  // provider still points at someone else's.
  const sandwich = useMemo(() => {
    if (!idParam) return activeSandwich;
    if (activeSandwich?.id === idParam) return activeSandwich;
    return peekById(idParam);
  }, [activeSandwich, idParam, peekById]);
  const bookmarked = sandwich ? isSaved("sandwich", sandwich.id) : false;
  // The buy / sell pad is a native form sheet route (`(app)/sandwich-trade`).
  const tradeSheet = useSandwichTradeSheet();
  const [thesisExpanded, setThesisExpanded] = useState(false);
  const [showShareNudge, setShowShareNudge] = useState(false);
  const [creatorFollowing, setCreatorFollowing] = useState(false);
  const [creatorFollowReady, setCreatorFollowReady] = useState(false);
  const [creatorFollowLoading, setCreatorFollowLoading] = useState(false);
  // Hero thesis (the user's quote) collapses past a few lines with a "more"
  // toggle. Its line count is measured once per sandwich via onTextLayout.
  const [heroThesisExpanded, setHeroThesisExpanded] = useState(false);
  const [heroThesisLineCount, setHeroThesisLineCount] = useState<number | null>(
    null,
  );
  // The scrubbed chart figure is a shared value, not state: the chart writes it
  // from the gesture worklet so dragging the line never re-renders this screen.
  const chartReturnPct = useSharedValue(Number.NaN);
  const chartReturnActive = useSharedValue(0);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const [creatorProfileOpen, setCreatorProfileOpen] = useState(false);
  const [chartRange, setChartRange] = useState<SandwichChartRange>(() =>
    defaultChartRange(),
  );
  // Leg detail card — a hero expansion, not a sheet. `legExpand` drives the
  // single 0→1 progress: 0 is the card sitting exactly on top of the tapped
  // row, 1 is the opened card. Every geometry value interpolates between those
  // two rects, so open and close are the same animation run in either
  // direction and it can be interrupted mid-flight.
  const [legCardLeg, setLegCardLeg] = useState<SandwichLeg | null>(null);
  const legAssetRequestRef = useRef(0);
  const legExpand = useSharedValue(0);
  const legDragY = useSharedValue(0);
  // Opacity of the row the card came from. Set directly by the open/close
  // paths — see the `rowVisible` note on SandwichLegRow for why this can't be
  // derived from legExpand.
  const legRowVisible = useSharedValue(1);
  const legOrigin = useSharedValue<LegCardOrigin>({ x: 0, y: 0, width: 0, height: 0 });
  // The card's resolved height, measured off the card itself once laid out.
  // Used ONLY to pick the starting scaleY, never to size anything — so a stale
  // or missing value costs a slightly different squash on the first frame,
  // not a mis-sized card.
  const legCardH = useSharedValue(0);
  const { width: screenW, height: screenH } = useWindowDimensions();
  // Keep the expanded card in the area of the tapped asset instead of always
  // pulling it to the top of the screen. This is resolved when a row is tapped
  // and held until that card closes, so the return path targets the same place.
  const [legTargetTop, setLegTargetTop] = useState(insets.top + 46);
  // Horizontal geometry and the vertical bounds. Height/top are resolved in the
  // worklet from the measured content. The content width is fixed here so text
  // never reflows during the expansion — the growing frame just clips it.
  // Resting rect. The card has NO explicit height — it sizes to its content and
  // is merely bounded by maxHeight.
  //
  // Deriving the height from an onLayout measurement is circular: fixing the
  // container's height makes its only child stretch to fill it, so the next
  // measurement reports the height that was just imposed and the card locks at
  // whatever it started as. Anchoring to a fixed top instead of centring is
  // what removes the need to know the height at layout time at all.
  const legTarget = useMemo(() => {
    const left = 12;
    return {
      left,
      top: legTargetTop,
      width: screenW - left * 2,
      maxHeight: screenH - legTargetTop - Math.max(insets.bottom, 16) - 24,
    };
  }, [insets.bottom, legTargetTop, screenH, screenW]);
  const sortedLegs = useMemo(
    () =>
      sandwich ? [...sandwich.legs].sort((a, b) => a.order - b.order) : [],
    [sandwich],
  );
  const thesisDescription = sandwich ? getThesisDescription(sandwich) : "";
  const thesisBullets = sandwich ? getThesisBullets(sandwich) : [];
  const thesisPreview = thesisDescription || thesisBullets[0] || "";
  // Research alone is enough to earn the expander: a sandwich can carry sources
  // and catalysts worth reading even when the thesis prose is thin.
  const hasThesisContent = Boolean(
    thesisPreview || thesisBullets.length > 0 || sandwich?.research,
  );
  const creator = sandwich ? getCreatorMeta(sandwich) : null;
  const sourceAuthor = sandwich ? getSourceAuthorMeta(sandwich) : null;
  const sourceVideo = sandwich ? getSourceVideo(sandwich) : null;
  // Where in the episode this sandwich's call was made. Drives the hero's
  // initial seek and the chip that jumps back to it.
  const momentWindow = useMemo(
    () => (sandwich ? getMomentWindow(sandwich) : null),
    [sandwich],
  );
  const heroPlayerRef = useRef<YouTubeClipPlayerHandle>(null);
  const router = useRouter();
  // Reached without a sandwich in memory — a share link, a cold launch, or a
  // Privy user swap that cleared the store. `id` is on the route purely so this
  // can put the screen back rather than showing "Sandwich unavailable".
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  useEffect(() => {
    setRecoveryFailed(false);
  }, [idParam]);
  // Only the focused screen may pull the provider onto its own sandwich —
  // otherwise two stacked detail routes would fight over it, each recovering
  // its id and invalidating the other's on every render.
  useEffect(() => {
    if (!isFocused || !idParam) return;
    if (activeSandwich?.id === idParam) return;
    let cancelled = false;
    void recoverById(idParam).then((ok) => {
      if (!cancelled && !ok) setRecoveryFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSandwich?.id, idParam, isFocused, recoverById]);
  // A YouTube call belongs on its episode screen, and `sandwich-detail-store`
  // redirects every list that opens one. A raw deep link straight to this route
  // never goes through that store, so the guard is repeated here — otherwise a
  // pasted link would be the one way back into the screen this replaced.
  // `replace`, not `push`: the episode IS this route's destination, so Back
  // should leave rather than bounce through an empty detail screen.
  const youtubeSourceId =
    sandwich?.source.sourceType === "youtube" ? sandwich.sourceId : null;
  const youtubeSandwichId = youtubeSourceId ? sandwich?.id ?? null : null;
  useEffect(() => {
    if (!youtubeSourceId || !youtubeSandwichId) return;
    router.replace({
      pathname: "/podcast-sandwich",
      params: { sourceId: youtubeSourceId, focus: youtubeSandwichId },
    });
  }, [router, youtubeSourceId, youtubeSandwichId]);
  // Per-leg timestamps are only worth showing when the legs genuinely came from
  // different points in the episode. A sandwich built from one moment stamps
  // the same window on every leg, so the `Set` collapses to one and no chips
  // render — the branch exists so a future multi-moment sandwich needs no UI
  // work, not because it fires today.
  const legWindowsDiffer = useMemo(() => {
    const starts = new Set(
      sortedLegs.map((l) => l.startMs).filter((v): v is number => v != null),
    );
    return starts.size > 1;
  }, [sortedLegs]);
  const creatorPrivyUserId = sandwich?.source.user?.privyUserId ?? null;
  const openCreatorProfile = useCallback(() => {
    if (!creatorPrivyUserId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCreatorProfileOpen(true);
  }, [creatorPrivyUserId]);
  /**
   * Who this screen is bylined to: the Bread creator, always, when there is
   * one. The cited account keeps its identity inside the embed card — putting
   * an X avatar and @handle in our header made the page read as that account's
   * rather than as the creator's sandwich built from it. An unowned sandwich
   * has no builder, so it falls back to the source rather than going nameless.
   */
  const heroIdentity = useMemo(() => {
    if (creator) {
      return {
        name: `@${creator.name.replace(/^@+/, "")}`,
        avatarUrl: creator.avatarUrl,
        initials: creator.initials,
        verified: true,
        platform: null as string | null,
        url: null as string | null,
      };
    }
    if (!sourceAuthor) return null;
    return {
      name: sourceAuthor.displayName ?? `${sourceAuthor.isHandle ? "@" : ""}${sourceAuthor.name}`,
      avatarUrl: sourceAuthor.avatarUrl,
      initials: sourceAuthor.initials,
      verified: false,
      platform: sourceAuthor.platform as string | null,
      url: sourceAuthor.url,
    };
  }, [creator, sourceAuthor]);
  const openPrimaryIdentity = useCallback(() => {
    if (creator) {
      openCreatorProfile();
      return;
    }
    if (heroIdentity?.url) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void Linking.openURL(heroIdentity.url).catch(() => {});
    }
  }, [creator, heroIdentity?.url, openCreatorProfile]);
  const viewerPrivyUserId = appUser?.privyUserId ?? null;
  const canFollowCreator = Boolean(
    creator &&
      creatorPrivyUserId &&
      viewerPrivyUserId &&
      creatorPrivyUserId !== viewerPrivyUserId,
  );
  useEffect(() => {
    let cancelled = false;
    setCreatorFollowing(false);
    setCreatorFollowReady(false);
    setCreatorFollowLoading(false);
    if (!canFollowCreator || !creatorPrivyUserId || !viewerPrivyUserId) {
      return () => {
        cancelled = true;
      };
    }
    setCreatorFollowLoading(true);
    void getUserProfile(creatorPrivyUserId, viewerPrivyUserId)
      .then((profile) => {
        if (!cancelled) {
          setCreatorFollowing(profile?.isFollowing ?? false);
          setCreatorFollowReady(true);
        }
      })
      .catch(() => {
        // Keep Follow available when the passive status read fails; the
        // follow endpoint remains authoritative and safely idempotent.
        if (!cancelled) setCreatorFollowReady(true);
      })
      .finally(() => {
        if (!cancelled) setCreatorFollowLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canFollowCreator, creatorPrivyUserId, viewerPrivyUserId]);
  const toggleCreatorFollow = useCallback(async () => {
    if (
      !canFollowCreator ||
      !creatorPrivyUserId ||
      !appUser ||
      creatorFollowLoading
    ) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasFollowing = creatorFollowing;
    setCreatorFollowing(!wasFollowing);
    setCreatorFollowLoading(true);
    try {
      if (wasFollowing) {
        await unfollowUser(appUser, creatorPrivyUserId);
      } else {
        await followUser(appUser, creatorPrivyUserId);
      }
    } catch {
      setCreatorFollowing(wasFollowing);
      toast.showToast("Couldn't update follow. Try again.", "error");
    } finally {
      setCreatorFollowLoading(false);
    }
  }, [
    appUser,
    canFollowCreator,
    creatorFollowLoading,
    creatorFollowing,
    creatorPrivyUserId,
    toast,
  ]);
  const hasChartData = sortedLegs.length > 0;
  const createdAtLabel = useMemo(
    () => formatSandwichDetailDateTime(sandwich?.createdAt ?? null),
    [sandwich?.createdAt],
  );
  useEffect(() => {
    let cancelled = false;
    setShowShareNudge(false);
    void shouldShowShareNudge(appUser?.privyUserId ?? null).then((shouldShow) => {
      if (!cancelled) setShowShareNudge(shouldShow);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.privyUserId]);
  const dismissShareNudge = useCallback(() => {
    setShowShareNudge(false);
    void markShareNudgeDismissed(appUser?.privyUserId ?? null).catch(() => {});
  }, [appUser?.privyUserId]);
  // Keep the native share sheet inside the original tap gesture; persistence
  // runs in the background so iOS still treats this as a user-triggered open.
  const shareSandwich = useCallback(() => {
    dismissShareNudge();
    share();
  }, [dismissShareNudge, share]);
  // The thread belongs to the CARD; the market rides along as the anchor for
  // anything written while looking at it.
  const openComments = useCallback(() => {
    if (!sandwich) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    commentsSheetRef.current?.open(sandwich, sandwich.commentCount);
  }, [sandwich]);
  useEffect(() => {
    if (!POST_COMMENTS_ENABLED || commentsParam !== "1" || !sandwich) return;
    if (commentsAutoOpenedRef.current === sandwich.id) return;
    commentsAutoOpenedRef.current = sandwich.id;
    const frame = requestAnimationFrame(() => {
      commentsSheetRef.current?.open(sandwich, sandwich.commentCount);
    });
    return () => cancelAnimationFrame(frame);
  }, [commentsParam, sandwich]);
  const legBackdropStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(legExpand.value, [0, 1], [0, 1], Extrapolation.CLAMP) *
      interpolate(legDragY.value, [0, 300], [1, 0.2], Extrapolation.CLAMP),
  }));
  // The hero itself: one interpolation per geometry property, from the row's
  // measured rect to the opened card's rect.
  const legHeroStyle = useAnimatedStyle(() => {
    const p = legExpand.value;
    const o = legOrigin.value;
    // TRANSFORMS ONLY — never width/height/left/top.
    //
    // Animating layout props forces a Yoga layout pass over this whole subtree
    // every frame. Transforms keep the close on the compositor instead.
    // Transforms are composited on the UI thread and touch no layout at all,
    // so the card holds its size and is simply squashed onto the row at p=0.
    //
    // Every transform resolves to IDENTITY at p=1. That matters beyond
    // tidiness: the card's static layout box is its resting rect, so at rest
    // the visual and layout positions coincide and touches inside the card
    // land where they look. Carrying the resting offset in translateY instead
    // (with a top of 0) renders identically but silently breaks hit testing —
    // the Trade link stops responding.
    const scaleX = o.width > 0 ? o.width / legTarget.width : 1;
    const scaleY = o.height > 0 && legCardH.value > 0 ? o.height / legCardH.value : 1;
    return {
      // Crossfade the travelling card into the already-restored source row.
      // Without this, the card's opaque background covers the row until the
      // spring callback unmounts it, which makes the asset logo pop in late.
      opacity: interpolate(p, [0, 0.3, 1], [0, 1, 1], Extrapolation.CLAMP),
      transform: [
        // transformOrigin is 'top left' (static style), so translate places the
        // card's top-left and scale grows it down-right from there.
        { translateX: interpolate(p, [0, 1], [o.x - legTarget.left, 0]) },
        {
          translateY:
            interpolate(p, [0, 1], [o.y - legTarget.top, 0]) + legDragY.value,
        },
        { scaleX: interpolate(p, [0, 1], [scaleX, 1]) },
        { scaleY: interpolate(p, [0, 1], [scaleY, 1]) },
      ],
      // Shadow only once it has actually lifted, so a seated card doesn't
      // shadow the row it's sitting on.
      shadowOpacity: interpolate(p, [0, 0.3, 1], [0, 0, 0.18], Extrapolation.CLAMP),
    };
  });
  // Hold the secondary copy back until the card is nearly unsquashed. The asset
  // header remains mounted through the whole morph, while the prose avoids
  // visibly stretching as the frame compresses.
  const legDetailsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      legExpand.value,
      [0.55, 0.92],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));
  const hideBuySheetImmediately = tradeSheet.close;



  // The same native form sheet route Home's "+ Add cash" opens, so there is
  // one Add cash surface in the app. The buy pad closes first: it lives in the
  // gorhom portal, which would otherwise draw over the native sheet.
  const openDepositSheet = useCallback(() => {
    hideBuySheetImmediately();
    router.push("/deposit");
  }, [hideBuySheetImmediately, router]);

  const openTradeSheet = useCallback(
    (side: "buy" | "sell", initialAmount: string | null = null) => {
      if (!sandwich) return;
      if (side === "sell" && !position) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Keyboard.dismiss();
      tradeSheet.open({
        side,
        sandwich,
        position,
        initialAmount,
        onCelebrate: tradeFx.playSandwich,
        onPositionUpdated: updatePosition,
        onRequestAddCash: openDepositSheet,
      });
    },
    [openDepositSheet, position, sandwich, tradeFx.playSandwich, tradeSheet, updatePosition],
  );
  const openBuySheet = useCallback(() => openTradeSheet("buy"), [openTradeSheet]);
  const openSellSheet = useCallback(() => openTradeSheet("sell"), [openTradeSheet]);

  // Arrived here from a Buy tap on a feed card: land on the amount pad rather
  // than making the user find the button a second time. Guarded per sandwich so
  // dismissing the pad doesn't immediately reopen it.
  useEffect(() => {
    if (buyParam !== "1" || !sandwich) return;
    if (buyAutoOpenedRef.current === sandwich.id) return;
    buyAutoOpenedRef.current = sandwich.id;
    const initialAmount = amountParam && /^\d+(\.\d+)?$/.test(amountParam) ? amountParam : null;
    const frame = requestAnimationFrame(() => openTradeSheet("buy", initialAmount));
    return () => cancelAnimationFrame(frame);
  }, [amountParam, buyParam, sandwich, openTradeSheet]);

  const collapseLegCardToRow = useCallback(() => {
    // Cancel a stock lookup if the user dismisses the card before it resolves.
    legAssetRequestRef.current += 1;
    // Immediately, not animated and not waiting on the spring: the row is the
    // card's destination, so it should already be there as the card travels
    // back to it. The card is opaque and on top, so it covers the row for most
    // of the trip anyway.
    legRowVisible.value = 1;
    legDragY.value = withSpring(0, Motion.spring.snap);
    // Reverse of the open: the card shrinks back into the row it came from.
    // The leg is held in state until it lands, or the content would unmount
    // mid-flight and the card would collapse empty.
    legExpand.value = withSpring(0, Motion.spring.travel, (finished) => {
      if (finished) runOnJS(setLegCardLeg)(null);
    });
  }, [legExpand, legDragY, legRowVisible]);

  const closeLegCard = useCallback(
    () => collapseLegCardToRow(),
    [collapseLegCardToRow],
  );

  const openLegCard = useCallback(
    (leg: SandwichLeg, origin: LegCardOrigin) => {
      legAssetRequestRef.current += 1;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // The buy pad recedes the page, which would move the row out from under
      // the rect we just measured — drop it before seeding the hero.
      hideBuySheetImmediately();
      legOrigin.value = origin;
      legDragY.value = 0;
      // Lift the opened card slightly above the selected leg. The card still
      // grows from the row's exact measured rect, but its resting header lands
      // just above that row so the motion reads as the asset opening rather
      // than a panel appearing below it.
      const minimumTop = insets.top + 46;
      // Reserve enough vertical room for the asset header, reasoning and Trade
      // action. If the tapped row sits lower than this allows, the resting card
      // moves farther upward instead of clipping its bottom action off-screen.
      const minimumCardRoom = 340;
      const maximumTop = Math.max(
        minimumTop,
        screenH - Math.max(insets.bottom, 16) - 24 - minimumCardRoom,
      );
      setLegTargetTop(
        Math.min(Math.max(origin.y - 72, minimumTop), maximumTop),
      );
      // Short fade rather than an instant cut: the card is still row-sized for
      // the first frames, so snapping the row off would read as a flicker.
      legRowVisible.value = withTiming(0, { duration: Motion.duration.instant });
      // Seat the card exactly on the row before the first frame paints, so the
      // spring starts from the row rather than from wherever it last closed.
      legExpand.value = 0;
      setLegCardLeg(leg);
      // Slightly softer than the buy pad's open: a growing card overshooting
      // reads as rubbery, so damping is up.
      legExpand.value = withSpring(1, Motion.spring.travel);
    },
    [
      hideBuySheetImmediately,
      insets.bottom,
      insets.top,
      legDragY,
      legExpand,
      legOrigin,
      legRowVisible,
      screenH,
    ],
  );
  // New users get a looping tap cue on the first asset row until they open an
  // asset once (forced on for everyone by EXPO_PUBLIC_FORCE_LEG_TAP_HINT).
  const [showLegTapHint, setShowLegTapHint] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setShowLegTapHint(false);
    void shouldShowLegTapHint(appUser?.privyUserId ?? null).then((shouldShow) => {
      if (!cancelled) setShowLegTapHint(shouldShow);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.privyUserId, sandwich?.id]);
  const handleLegPress = useCallback(
    (leg: SandwichLeg, origin: LegCardOrigin) => {
      if (showLegTapHint) {
        setShowLegTapHint(false);
        void markLegTapHintSeen(appUser?.privyUserId ?? null).catch(() => {});
      }
      openLegCard(leg, origin);
    },
    [appUser?.privyUserId, openLegCard, showLegTapHint],
  );

  // Drag the opened card down to shrink it back into its row.
  const legPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(12)
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          "worklet";
          if (e.translationY >= 0) {
            legDragY.value = e.translationY;
          } else {
            // Rubber-band upward (WWDC 2018) — the card is already at its
            // resting size, so pulling further up should resist.
            const overshoot = -e.translationY;
            const dim = 480;
            const damped = (overshoot * dim * 0.55) / (dim + 0.55 * overshoot);
            legDragY.value = -damped;
          }
        })
        .onEnd((e) => {
          "worklet";
          const decel = 0.998;
          const projected = e.translationY + (e.velocityY / 1000) * (decel / (1 - decel));
          if (projected > 140) {
            runOnJS(closeLegCard)();
          } else {
            legDragY.value = withSpring(0, { ...Motion.spring.settle, velocity: e.velocityY });
          }
        }),
    [closeLegCard, legDragY],
  );

  // Start with metadata already present on the sandwich leg, so the zoom starts
  // on the same frame as the tap. Canonical stock metadata and the leg's real
  // venue both hydrate silently afterwards, into the already-open screen.
  const openLegAsset = useCallback(
    (leg: SandwichLeg, source: ZoomSourceRect | null) => {
      const previewStock = stockPreviewFromLeg(leg);
      if (!previewStock) return;
      const requestId = ++legAssetRequestRef.current;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // The asset screen zooms out of the leg card's measured rect, so the card
      // stays where it is and is simply covered as the screen grows over it.
      openStockRoute(previewStock, { source });

      // Hydration is deliberately detached from the interaction. The user sees
      // no loading phase and the transition never waits on the network.
      void getSavedStock(previewStock.id)
        .then((resolved) => {
          if (!resolved || requestId !== legAssetRequestRef.current) return;
          updateStockRoute(resolved);
        })
        .catch(() => {});

      // Same discipline for the venue: a perp leg opens on the Phoenix market
      // and the side it actually holds, but resolving that market must not
      // stand between the tap and the transition. `listPhoenixMarkets` is
      // cached and single-flighted, so this is usually free — and a failure or
      // a ticker with no live market simply leaves the spot view in place.
      if (leg.venue === "perp") {
        void listPhoenixMarkets()
          .then((markets) => {
            if (requestId !== legAssetRequestRef.current) return;
            const target = resolveLegVenue({ leg, markets });
            updateStockRouteOptions({
              venue: target.venue,
              perpMarket: target.market,
              side: target.side,
              // A short leg that fell back to spot must not be offered a BUY.
              hideActions: target.perpUnavailable,
            });
          })
          .catch(() => {});
      }
    },
    [openStockRoute, updateStockRoute, updateStockRouteOptions],
  );

  // Drag-down-to-dismiss for the buy pad. Requires a deliberate vertical move
  // before it claims the gesture (so taps on the amount/buttons still work).
  // Downward drag tracks 1:1; upward drag rubber-bands (Apple §9 — no hard
  // walls). At release, Apple momentum projection (§6) unifies distance +
  // velocity into a single dismiss decision so a fast flick from anywhere
  // throws the sheet off, and a slow drag only commits if you've actually
  // pulled it far enough.

  // Reset transient view state whenever a different sandwich is shown. The
  // trade pad is not reset here: it is a native sheet covering this screen, so
  // the sandwich cannot change under it — and closing it on every `pnlPct`
  // tick would yank it away mid-entry.
  useEffect(() => {
    legAssetRequestRef.current += 1;
    legExpand.value = 0;
    legDragY.value = 0;
    legRowVisible.value = 1;
    setLegCardLeg(null);
    setThesisExpanded(false);
    setHeroThesisExpanded(false);
    setHeroThesisLineCount(null);
    chartReturnActive.value = 0;
    setShowStickyHeader(false);
    setChartRange(defaultChartRange());
  }, [
    sandwich?.id,
    sandwich?.pnlPct,
    sandwich?.createdAt,
    chartReturnActive,
    legExpand,
    legDragY,
    legRowVisible,
  ]);

  // Resting PnL, mirrored to the UI thread so the headline can fall back to it
  // the instant the finger lifts.
  const restPnlPct = useSharedValue(Number.NaN);
  useEffect(() => {
    restPnlPct.value = sandwich?.pnlPct ?? Number.NaN;
  }, [restPnlPct, sandwich?.pnlPct]);

  // The arrow carries the sign (see ScrubReturnText), so this is the raw value.
  const detailPnlValue = useDerivedValue(() =>
    chartReturnActive.value > 0 ? chartReturnPct.value : restPnlPct.value,
  );


  const rangePills = useMemo(
    () => chartRangePills(sandwich?.createdAt ?? null),
    [sandwich?.createdAt],
  );
  const detailPnlColor = useDerivedValue(() => {
    const value = chartReturnActive.value > 0 ? chartReturnPct.value : restPnlPct.value;
    if (Number.isNaN(value) || value === 0) return colors.text;
    return value > 0 ? colors.chartPositive : colors.negative;
  });

  return (
    <View style={styles.detailScreenRoot}>
          {/* The back button is the native nav-bar button (iOS 26 Liquid Glass).
              Once the hero scrolls away, keep only the creator identity in the
              collapsed header; the sandwich title and PnL remain in content. */}
          <Stack.Screen
            options={{
              // The native header (Liquid Glass back button) renders above all
              // in-screen content, so it would float over the buy pad, asset
              // card, and embedded stock sheet. Keep it hidden for the entire
              // overlay lifecycle, including closing animations.
              headerShown: !legCardLeg,
              headerTitle:
                showStickyHeader && sandwich && heroIdentity
                  ? () => (
                      <PressableScale
                        accessibilityRole={heroIdentity?.url ? "link" : "button"}
                        accessibilityLabel={
                          creator
                            ? `Open ${creator.name}'s profile`
                            : `Open ${heroIdentity?.name ?? "source"}'s source`
                        }
                        disabled={creator ? !creatorPrivyUserId : !heroIdentity?.url}
                        onPress={openPrimaryIdentity}
                        style={styles.stickyHeaderUser}
                      >
                        {heroIdentity?.avatarUrl ? (
                          <Image
                            source={{ uri: heroIdentity.avatarUrl }}
                            style={styles.stickyHeaderAvatar}
                          />
                        ) : (
                          <View style={styles.stickyHeaderAvatarFallback}>
                            <Text style={styles.stickyHeaderAvatarText}>
                              {heroIdentity?.initials ?? "S"}
                            </Text>
                          </View>
                        )}
                        <View style={styles.stickyHeaderIdentity}>
                          <HandleText
                            numberOfLines={1}
                            style={styles.stickyHeaderUserName}
                          >
                            {heroIdentity?.name ?? ""}
                          </HandleText>
                        </View>
                      </PressableScale>
                    )
                  : "",
              headerRight: undefined,
            }}
          />
          <Animated.View style={{ flex: 1 }}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
              scrollEventThrottle={16}
              onScroll={(e) => {
                const scrolled = e.nativeEvent.contentOffset.y > 120;
                if (scrolled !== showStickyHeader) setShowStickyHeader(scrolled);
              }}
              style={styles.sheetScrollView}
              contentContainerStyle={[
                styles.sheetContent,
                { paddingTop: insets.top + 52 },
              ]}
            >
              {!sandwich ? (
                // A refetch is in flight whenever the route carries an id and
                // hasn't failed yet — showing "unavailable" over a load that is
                // about to succeed is what made a cold entry look broken.
                idParam && !recoveryFailed ? (
                  <View style={styles.stateCard}>
                    <ActivityIndicator color={colors.textTertiary} />
                  </View>
                ) : (
                  <View style={styles.stateCard}>
                    <Text style={styles.stateTitle}>Sandwich unavailable</Text>
                    <Text style={styles.stateBody}>
                      Go back and open it again.
                    </Text>
                  </View>
                )
              ) : (
                <>
                  <ScaledSandwichSection scale={elementScales.postHeader}>
                    <View>
                    {/* The Bread creator is the byline; the cited account's
                        own name and avatar live inside the embed below. */}
                    <View
                      style={styles.sheetHero}
                      testID={NATIVE_ZOOM_TARGET_TEST_ID}
                    >
                      <>
                        <View style={styles.sheetCreatorRow}>
                          <Pressable
                            accessibilityRole={heroIdentity?.url ? "link" : "button"}
                            accessibilityLabel={
                              creator
                                ? `Open ${creator.name}'s profile`
                                : heroIdentity?.url
                                  ? `Open ${heroIdentity.name}'s source`
                                  : "Sandwich creator"
                            }
                            style={styles.sheetCreatorTap}
                            onPress={openPrimaryIdentity}
                            disabled={creator ? !creatorPrivyUserId : !heroIdentity?.url}
                            hitSlop={8}
                          >
                            <View style={styles.sheetCreatorAvatarRing}>
                              {heroIdentity?.avatarUrl ? (
                                <Image
                                  source={{ uri: heroIdentity.avatarUrl }}
                                  style={styles.sheetCreatorAvatar}
                                />
                              ) : (
                                <View style={styles.sheetCreatorAvatarFallback}>
                                  <Text style={styles.sheetCreatorAvatarInitials}>
                                    {heroIdentity?.initials ?? "S"}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View style={styles.sheetCreatorInfo}>
                              <View style={styles.sheetCreatorNameRow}>
                                <HandleText numberOfLines={1} style={styles.sheetCreatorName}>
                                  {heroIdentity?.name ?? "Unattributed"}
                                </HandleText>
                                {heroIdentity?.verified ? (
                                  <VerifiedBadge size={18} />
                                ) : heroIdentity?.platform ? (
                                  <Ionicons
                                    name={PLATFORM_ICON[heroIdentity.platform] ?? "link-outline"}
                                    size={15}
                                    color={
                                      heroIdentity.platform === "youtube"
                                        ? "#FF0000"
                                        : colors.textTertiary
                                    }
                                  />
                                ) : null}
                              </View>
                            </View>
                          </Pressable>
                          {canFollowCreator ? (
                            creatorFollowReady ? (
                              <FollowButton
                                size="sm"
                                shape="rounded"
                                following={creatorFollowing}
                                disabled={creatorFollowLoading}
                                onPress={() => {
                                  void toggleCreatorFollow();
                                }}
                                style={styles.sheetFollowButton}
                              />
                            ) : (
                              <View style={styles.sheetFollowButtonPlaceholder} />
                            )
                          ) : null}
                        </View>
                        {/* A cited post is someone else's object: it gets the
                            boxed X-style embed under our byline, and the whole
                            card links out to the original rather than
                            paraphrasing it inline. An article keeps the
                            builder's take above the same embed, because there
                            the take and the source are different writing. */}
                        {isXPostSource(sandwich.source) ? (
                          <SourcePostCard source={sandwich.source} />
                        ) : sourceVideo ? (
                          // The "thesis" here is a video's title, not the
                          // creator's words — play the video itself, attributed
                          // to the channel, instead of plain text.
                          <>
                            <SourceVideoPlayer
                              video={sourceVideo}
                              momentWindow={momentWindow}
                              playerRef={heroPlayerRef}
                            />
                            {momentWindow ? (
                              <PressableScale
                                accessibilityRole="button"
                                accessibilityLabel={`Play the call from ${formatTimestamp(momentWindow.startMs)}`}
                                hitSlop={8}
                                onPress={() => {
                                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                  // Re-seek WITH the end bound: the chip means
                                  // "replay just this call", unlike the initial
                                  // load which plays on past it.
                                  heroPlayerRef.current?.seek(
                                    momentWindow.startMs,
                                    momentWindow.endMs,
                                  );
                                }}
                                style={styles.momentChip}
                              >
                                <Ionicons name="play" size={10} color={colors.accentBlue} />
                                <Text style={styles.momentChipText}>
                                  {formatTimestamp(momentWindow.startMs)}
                                </Text>
                                <Text style={styles.momentChipHint}>replay this call</Text>
                              </PressableScale>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <Text
                              style={styles.sheetHeroThesis}
                              numberOfLines={
                                heroThesisLineCount === null
                                  ? undefined
                                  : heroThesisExpanded
                                    ? undefined
                                    : HERO_THESIS_COLLAPSED_LINES
                              }
                              onTextLayout={(e) => {
                                // Measure the full quote once (numberOfLines is left off
                                // until we know the count) so we only show "more" when it
                                // actually overflows the collapsed cap.
                                if (heroThesisLineCount === null) {
                                  setHeroThesisLineCount(e.nativeEvent.lines.length);
                                }
                              }}
                            >
                              {getBuilderTake(sandwich)}
                            </Text>
                            {(heroThesisLineCount ?? 0) > HERO_THESIS_COLLAPSED_LINES ? (
                              <PressableScale
                                accessibilityRole="button"
                                accessibilityLabel={
                                  heroThesisExpanded ? "Show less" : "Show more"
                                }
                                hitSlop={8}
                                onPress={() => setHeroThesisExpanded((v) => !v)}
                              >
                                <Text style={styles.heroThesisMore}>
                                  {heroThesisExpanded ? "less" : "more"}
                                </Text>
                              </PressableScale>
                            ) : null}
                            {isArticleSource(sandwich.source) ? (
                              <SourcePostCard source={sandwich.source} />
                            ) : null}
                            <RemixCitation parent={sandwich.remixedFrom} />
                          </>
                        )}
                      </>
                    </View>

                  {/* Absolute post time sits above the actions on their shared
                      left edge, matching the reference social-post layout. */}
                    {createdAtLabel ? (
                      <Text style={styles.detailCreatedAt}>{createdAtLabel}</Text>
                    ) : null}
                    <View style={styles.detailLikeShareRow}>
                    <DetailLikeButton
                      liked={sandwich.viewerHasLiked}
                      count={sandwich.likeCount}
                      onPress={toggleLike}
                    />
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel="Remix sandwich"
                      accessibilityHint="Opens this basket in the composer to change and publish as your own"
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        openComposer({
                          remixOf: sandwich,
                          // Land on the remix itself, stacked over the original
                          // so back returns to what was remixed.
                          onCreated: (created) => {
                            toast.showToast("Your remix is live", "success");
                            openSandwichDetail(created);
                          },
                        });
                      }}
                      hitSlop={8}
                      style={styles.detailMetaBtn}
                    >
                      <RemixIcon size={24} color={colors.textSecondary} />
                    </PressableScale>
                    {POST_COMMENTS_ENABLED ? (
                      <PressableScale
                        accessibilityRole="button"
                        accessibilityLabel="Comment on sandwich"
                        onPress={openComments}
                        hitSlop={8}
                        style={styles.detailMetaBtn}
                      >
                        <Ionicons
                          name="chatbubble-outline"
                          size={24}
                          color={colors.textSecondary}
                        />
                        {sandwich.commentCount > 0 ? (
                          <Text style={styles.detailMetaCount}>
                            {formatSocialCount(sandwich.commentCount)}
                          </Text>
                        ) : null}
                      </PressableScale>
                    ) : null}
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={bookmarked ? "Remove bookmark" : "Bookmark sandwich"}
                      accessibilityState={{ selected: bookmarked }}
                      onPress={() => {
                        if (!canSave) {
                          toast.showToast("Sign in to save sandwiches", "info");
                          return;
                        }
                        void toggleSave("sandwich", sandwich.id).then((saved) => {
                          toast.showToast(
                            saved ? "Sandwich bookmarked" : "Bookmark removed",
                            "info",
                          );
                        });
                      }}
                      hitSlop={8}
                      style={styles.detailMetaBtn}
                    >
                      <Ionicons
                        name={bookmarked ? "bookmark" : "bookmark-outline"}
                        size={24}
                        color={bookmarked ? colors.accentBlue : colors.textSecondary}
                      />
                    </PressableScale>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel="Share sandwich"
                      onPress={shareSandwich}
                      hitSlop={8}
                      style={styles.detailMetaBtn}
                    >
                      <ShareIcon size={24} color={colors.textSecondary} />
                    </PressableScale>
                    </View>

                    {showShareNudge ? (
                      <View style={styles.shareNudge}>
                        <View pointerEvents="none" style={styles.shareNudgePointer} />
                        <View accessible={false} style={styles.shareNudgeIcon}>
                          <ShareIcon size={24} color={colors.icon} />
                        </View>
                        <Text
                          accessibilityLiveRegion="polite"
                          style={styles.shareNudgeText}
                        >
                          Share this post with anyone, even if they aren’t on Bread yet
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Dismiss sharing tip"
                          hitSlop={4}
                          onPress={dismissShareNudge}
                          style={({ pressed }) => [
                            styles.shareNudgeDismiss,
                            pressed && styles.shareNudgeDismissPressed,
                          ]}
                        >
                          <Ionicons name="close" size={24} color={colors.icon} />
                        </Pressable>
                      </View>
                    ) : null}

                    </View>
                  </ScaledSandwichSection>

                  {/* Chart + timeframe pills */}
                  {hasChartData ? (
                    <ScaledSandwichSection scale={elementScales.chart}>
                      <View style={styles.detailChartSection}>
                        <SandwichBasketChart
                          legs={sortedLegs}
                          createdAt={sandwich.createdAt}
                          targetReturnPct={
                            sandwich.pnlStatus !== 'unavailable' &&
                            sandwich.pnlPct !== null &&
                            Math.abs(sandwich.pnlPct) > 0.05
                              ? sandwich.pnlPct
                              : null
                          }
                          window={chartRange}
                          showReturn={false}
                          showDotGrid
                          scrubValue={chartReturnPct}
                          scrubValueActive={chartReturnActive}
                        />
                        {/* Under a day old there's only ALL, so no row at all. */}
                        {rangePills.length > 1 ? (
                          <View style={styles.chartRangeRow}>
                            {rangePills.map(({ label, range }) => {
                              const active = chartRange === range;
                              return (
                                <Pressable
                                  key={range}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: active }}
                                  accessibilityLabel={`Show ${label} chart`}
                                  hitSlop={8}
                                  onPress={() => {
                                    if (active) return;
                                    void Haptics.selectionAsync();
                                    setChartRange(range);
                                  }}
                                  style={styles.chartRangePill}
                                >
                                  <Text
                                    style={[
                                      styles.chartRangePillText,
                                      active && styles.chartRangePillTextActive,
                                    ]}
                                  >
                                    {label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    </ScaledSandwichSection>
                  ) : null}

                  {position ? (
                    <ScaledSandwichSection scale={elementScales.positionCard}>
                      <SandwichPositionCard
                        position={position}
                        sandwich={sandwich}
                        onShare={shareSandwich}
                      />
                    </ScaledSandwichSection>
                  ) : viewedPosition && viewedPosition.position.sandwichId === sandwich.id ? (
                    // Someone else's holding, opened from their profile: their
                    // figures, no thesis button, and the actions below stay the
                    // viewer's own (Buy), never Buy more / Sell.
                    <ScaledSandwichSection scale={elementScales.positionCard}>
                      <SandwichPositionCard
                        position={viewedPosition.position}
                        sandwich={sandwich}
                        onShare={shareSandwich}
                        onAddThesis={null}
                        valuationOverride={viewedPosition.valuation}
                      />
                    </ScaledSandwichSection>
                  ) : null}

                  {/* Flat legs list */}
                  <ScaledSandwichSection scale={elementScales.assetRows}>
                    {/* The return heads the list for every sandwich. A single
                        asset has nothing to split, so it is labelled "Asset" —
                        its row shows the asset's own move, not this return. */}
                    {sortedLegs.length > 0 ? (
                      <>
                        {/* The basket's return — scrubbed by the chart above — right
                            above the legs it is made of. */}
                        <View style={styles.detailMetaRow}>
                          <View style={styles.detailMetaLabel}>
                            {/* Heads the asset list below: how the basket is split. */}
                            <Text
                              accessibilityLabel={sortedLegs.length > 1 ? `Split across ${sortedLegs.length} assets` : "Single asset"}
                              numberOfLines={1}
                              style={styles.detailMetaLabelText}
                            >
                              {sortedLegs.length > 1 ? (
                                <>
                                  Split{" "}
                                  <Text style={styles.detailMetaLabelCount}>{`(${sortedLegs.length})`}</Text>
                                </>
                              ) : (
                                "Asset"
                              )}
                            </Text>
                          </View>
                          {/* A perp sandwich's percentage is the move in the
                              UNDERLYING — no leverage, no funding — because that is
                              the only figure available without an open position. Say
                              which one this is rather than letting it read as the
                              realized return. */}
                          {sandwich.pnlBasis === "underlying_move" ? (
                            <Text style={styles.detailMetaPnlBasis}>underlying</Text>
                          ) : null}
                          <ScrubReturnText
                            value={detailPnlValue}
                            color={detailPnlColor}
                            textStyle={styles.detailMetaPnl}
                            width={190}
                            arrowSize={18}
                          />
                        </View>
                      </>
                    ) : null}
                    <View style={styles.detailLegsSection}>
                      {sortedLegs.map((leg, index) => (
                        <View key={leg.id}>
                        <SandwichLegRow
                          leg={leg}
                          isLast={index === sortedLegs.length - 1}
                          onPress={handleLegPress}
                          isCardOpen={legCardLeg?.id === leg.id}
                          rowVisible={legRowVisible}
                          priceScale={elementScales.assetPrices}
                          onSeekToLeg={
                            sourceVideo && legWindowsDiffer
                              ? (target) => {
                                  if (target.startMs == null) return;
                                  heroPlayerRef.current?.seek(target.startMs, target.endMs);
                                }
                              : undefined
                          }
                        />
                        {index === 0 && showLegTapHint && legCardLeg === null ? (
                          <LegTapHint />
                        ) : null}
                        </View>
                      ))}
                    </View>
                  </ScaledSandwichSection>

                  {/* Thesis expand */}
                  {hasThesisContent ? (
                    <ScaledSandwichSection scale={elementScales.details}>
                      <View>
                      {thesisExpanded ? (
                        <View style={styles.thesisExpandedBody}>
                          {thesisPreview ? (
                            <Text style={styles.thesisText}>
                              {thesisDescription ? thesisDescription : thesisPreview}
                            </Text>
                          ) : null}
                          {thesisBullets.length > 0 ? (
                            <View style={styles.thesisBullets}>
                              {thesisBullets.map((bullet) => (
                                <View key={bullet} style={styles.thesisBulletRow}>
                                  <View style={styles.thesisBulletDot} />
                                  <Text style={styles.thesisBulletText}>
                                    {bullet}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                          {/* The sources this basket was built from. Renders
                              nothing for sandwiches created before research
                              existed. */}
                          <SandwichResearchCard
                            research={sandwich?.research ?? null}
                            colors={colors}
                          />

                          {/* Last thing under the reasoning, where someone who
                              read all of it will see it before they act. */}
                          <View style={styles.thesisDisclaimer}>
                            <Ionicons
                              name="information-circle-outline"
                              size={14}
                              color={colors.textTertiary}
                            />
                            <Text style={styles.thesisDisclaimerText}>
                              {DISCLAIMER_TEXT}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={thesisExpanded ? "Show less" : "Show more"}
                        onPress={() => setThesisExpanded((current) => !current)}
                        style={({ pressed }) => [
                          styles.showMoreButton,
                          pressed && styles.showMoreButtonPressed,
                        ]}
                      >
                        <Text style={styles.showMoreText}>
                          {thesisExpanded ? "show less" : "show more"}
                        </Text>
                        <RotatingChevron up={thesisExpanded} size={13} color={colors.textSecondary} />
                      </Pressable>
                      </View>
                    </ScaledSandwichSection>
                  ) : null}

                  {/* Outside the scaled details section: the feed cards keep
                      their own size and line up with the asset rows. */}
                  {sandwich ? (
                    <RecommendedSandwiches
                      sandwich={sandwich}
                      onOpen={(next, options) => openSandwichDetail(next, options)}
                    />
                  ) : null}

                  {/* Takes — what HOLDERS said while holding, between the
                      thesis and the comments. Renders nothing when nobody has
                      written one. */}
                  {sandwich ? <PositionTakesSection sandwichId={sandwich.id} /> : null}
                </>
              )}
            </ScrollView>
            {sandwich ? (
              <View
                pointerEvents="box-none"
                style={[
                  styles.floatingBuyWrap,
                  { paddingBottom: ctaBottomInset(insets.bottom) },
                ]}
              >
                <ScaledSandwichSection scale={elementScales.actions}>
                  {position ? (
                    <View style={styles.positionActionRow}>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel="Buy more of this sandwich"
                      onPress={openBuySheet}
                      scaleTo={HAS_GLASS && !actionSettings.solid ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
                      style={[styles.buyButtonWrap, styles.positionActionButton]}
                    >
                      {HAS_GLASS && !actionSettings.solid ? (
                        <GlassView
                          glassEffectStyle="clear"
                          isInteractive
                          tintColor={ctaGlassTint(buyMoreFill, isDarkScheme)}
                          colorScheme={isDarkScheme ? "dark" : "light"}
                          style={[styles.buyButton, styles.positionActionFill]}
                        >
                          <CtaGlassFill color={buyMoreFill} isDark={isDarkScheme} />
                          <Text
                            style={[
                              styles.positionActionButtonText,
                              styles.buyMoreButtonText,
                            ]}
                          >
                            BUY MORE
                          </Text>
                        </GlassView>
                      ) : (
                        <View style={[styles.buyButton, styles.positionActionFill]}>
                          <CtaGlassFill color={buyMoreFill} isDark={isDarkScheme} glass={false} />
                          <Text
                            style={[
                              styles.positionActionButtonText,
                              styles.buyMoreButtonText,
                            ]}
                          >
                            BUY MORE
                          </Text>
                        </View>
                      )}
                    </PressableScale>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel="Sell this sandwich position"
                      onPress={openSellSheet}
                      scaleTo={HAS_GLASS && !actionSettings.solid ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
                      style={[styles.buyButtonWrap, styles.positionActionButton]}
                    >
                      {HAS_GLASS && !actionSettings.solid ? (
                        <GlassView
                          glassEffectStyle="clear"
                          isInteractive
                          tintColor={ctaGlassTint(sellFill, isDarkScheme)}
                          colorScheme={isDarkScheme ? "dark" : "light"}
                          style={[styles.buyButton, styles.positionActionFill]}
                        >
                          <CtaGlassFill color={sellFill} isDark={isDarkScheme} />
                          <Text
                            style={[
                              styles.positionActionButtonText,
                              styles.sellButtonText,
                            ]}
                          >
                            SELL
                          </Text>
                        </GlassView>
                      ) : (
                        <View style={[styles.buyButton, styles.positionActionFill]}>
                          <CtaGlassFill color={sellFill} isDark={isDarkScheme} glass={false} />
                          <Text
                            style={[
                              styles.positionActionButtonText,
                              styles.sellButtonText,
                            ]}
                          >
                            SELL
                          </Text>
                        </View>
                      )}
                    </PressableScale>
                    </View>
                  ) : (
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel="Open sandwich buy sheet"
                      onPress={openBuySheet}
                      scaleTo={HAS_GLASS && !actionSettings.solid ? CTA_GLASS_SCALE : CTA_SOLID_SCALE}
                      style={styles.buyButtonWrap}
                    >
                      {HAS_GLASS && !actionSettings.solid ? (
                        <GlassView
                          glassEffectStyle="clear"
                          isInteractive
                          tintColor={ctaGlassTint(buyFill, isDarkScheme)}
                          colorScheme={isDarkScheme ? "dark" : "light"}
                          style={styles.buyButton}
                        >
                          <CtaGlassFill color={buyFill} isDark={isDarkScheme} />
                          <Text style={styles.buyButtonText}>BUY</Text>
                        </GlassView>
                      ) : (
                        <View style={styles.buyButton}>
                          <CtaGlassFill color={buyFill} isDark={isDarkScheme} glass={false} />
                          <Text style={styles.buyButtonText}>BUY</Text>
                        </View>
                      )}
                    </PressableScale>
                  )}
                </ScaledSandwichSection>
              </View>
            ) : null}
          </Animated.View>

        {/* Leg detail card — a hero that grows out of the tapped row. */}
        {legCardLeg ? (
          <>
            <Animated.View
              style={[
                styles.buySheetBackdrop,
                styles.legCardBackdrop,
                legBackdropStyle,
              ]}
            >
              <BlurView
                intensity={12}
                tint={scheme === "dark" ? "dark" : "light"}
                experimentalBlurMethod="dimezisBlurView"
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
              />
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, styles.legCardDarkScrim]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close asset details"
                onPress={closeLegCard}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <GestureDetector gesture={legPan}>
              <Animated.View
                style={[
                  styles.legCardHero,
                  // Static resting rect — see the hit-testing note in
                  // legHeroStyle for why this must not live in the transform.
                  // No height: the card sizes to its content.
                  {
                    left: legTarget.left,
                    top: legTarget.top,
                    width: legTarget.width,
                    maxHeight: legTarget.maxHeight,
                  },
                  legHeroStyle,
                ]}
                onLayout={(e) => {
                  legCardH.value = e.nativeEvent.layout.height;
                }}
              >
                {/* Laid out at the OPENED width from frame one and clipped by
                    the growing container (overflow: hidden above). Sizing it to
                    the container instead would reflow every line of text on
                    every frame of the expansion. */}
                <Animated.View
                  style={[
                    styles.legCardHeroContent,
                    { width: legTarget.width },
                  ]}
                >
                  <View style={styles.buySheetHandle} />
                  {/* colors passed in rather than read inside: keeps the card
                      reusable from a portaled sheet, where providers are out of
                      scope. */}
                  <SandwichLegCard
                    leg={legCardLeg}
                    title={
                      legCardLeg.type === "tokenized_stock"
                        ? getLegPrimaryLine(legCardLeg).trim().toUpperCase()
                        : getLegTitle(legCardLeg)
                    }
                    colors={colors}
                    onOpenAsset={openLegAsset}
                    detailsStyle={legDetailsStyle}
                  />
                </Animated.View>
              </Animated.View>
            </GestureDetector>
          </>
        ) : null}
        <SandwichCommentsSheet
          ref={commentsSheetRef}
          onCountChange={updateCommentCount}
        />
        {creatorPrivyUserId ? (
          <UserProfileScreen
            visible={creatorProfileOpen}
            onClose={() => setCreatorProfileOpen(false)}
            targetPrivyUserId={creatorPrivyUserId}
            viewerPrivyUserId={appUser?.privyUserId ?? null}
            viewerPayload={appUser}
          />
        ) : null}
    </View>
  );
}

export function SandwichScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { user } = usePrivy();
  const appToast = useToast();
  const insets = useSafeAreaInsets();
  const composeFabBottom = 88 + Math.max(insets.bottom, 10);
  // The feed's state is CARDS, straight off `/api/posts`. It used to be markets
  // off `/api/sandwiches`, grouped into cards on the way to the screen — see
  // `buildFeedItemsFromPosts`.
  const [posts, setPosts] = useState<SandwichPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Feed paging. A page is 20 CARDS now, so one request is one screenful — the
  // page-until-we-have-enough loop this replaces exists in the git history.
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [hasMoreFeed, setHasMoreFeed] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Guards against the scroll handler firing another page while one is in
  // flight (state updates lag the scroll events).
  const loadingMoreRef = useRef(false);
  // Card order. Read through a ref by the page fetcher so switching sort
  // re-sorts what's loaded instead of refetching the feed.
  const [feedSort, setFeedSort] = useState<FeedSort>("recent");
  const feedSortRef = useRef<FeedSort>("recent");
  const feedListRef = useRef<FlatList<FeedItem>>(null);
  // Share / deep-link param: a tap on bread://(app)/sandwich?sandwichId=… lands
  // here. We push that sandwich's detail screen once, below.
  const { sandwichId: deepLinkSandwichId } = useLocalSearchParams<{
    sandwichId?: string;
  }>();
  const navigation = useNavigation();
  const deepLinkHandledRef = useRef<string | null>(null);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const stockDetailSheetRef = useRef<StockDetailSheetRef>(null);
  // Single, app-wide detail screen — opened imperatively from the tap below.
  const sandwichDetail = useSandwichDetail();
  const podcastGroup = usePodcastGroup();
  const shareSheetRef = useRef<SandwichShareSheetRef>(null);
  const composer = useSandwichComposer();
  const appUser = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);

  const showToast = useCallback(
    (nextToast: ToastState, duration = 2200) => {
      if (!nextToast) {
        appToast.dismissToast();
        return;
      }

      appToast.showToast(nextToast.text, nextToast.tone, duration);
    },
    [appToast],
  );

  useEffect(() => {
    let cancelled = false;
    // The feed is viewer-specific because viewerHasLiked is part of every row.
    // Clear it before resolving the next identity so account A's red hearts
    // never flash for account B.
    setAnonymousId(null);
    setPosts([]);
    setFeedCursor(null);
    setHasMoreFeed(true);
    setLoading(true);
    void getAnonymousSocialId(appUser?.privyUserId).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.privyUserId]);

  // Keep the feed row in sync with social-state changes made on the detail
  // screen (e.g. a like toggle), via the detail provider's onUpdated callback.
  const applyUpdatedSandwich = useCallback((updated: Sandwich) => {
    setPosts((current) =>
      current.map((post) =>
        post.sandwiches.some((item) => item.id === updated.id)
          ? {
              ...post,
              sandwiches: post.sandwiches.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : post,
      ),
    );
  }, []);

  /**
   * The flat market list, for the paths that address a MARKET rather than a
   * card — the share deep link, and the empty check. Derived rather than stored
   * so there is exactly one source of truth.
   */
  const sandwiches = useMemo(
    () => posts.flatMap((post) => post.sandwiches),
    [posts],
  );

  // One post is one card: the server states the grouping, the client no longer
  // infers it. `posts` is already in display order — each page is sorted as it
  // arrives (see `sortPosts`), so rendering never reorders what's on screen.
  const feedItems = useMemo(() => buildFeedItemsFromPosts(posts), [posts]);

  const onSelectSandwich = useCallback(
    (sandwich: Sandwich) => {
      Keyboard.dismiss();
      sandwichDetail.open(sandwich, { onUpdated: applyUpdatedSandwich });
    },
    [sandwichDetail, applyUpdatedSandwich],
  );

  const onCommentSandwich = useCallback(
    (sandwich: Sandwich) => {
      Keyboard.dismiss();
      sandwichDetail.open(sandwich, {
        onUpdated: applyUpdatedSandwich,
        showComments: true,
      });
    },
    [sandwichDetail, applyUpdatedSandwich],
  );


  /**
   * One page of the feed.
   *
   * `/api/posts` pages over CARDS, so `FEED_PAGE_SIZE` cards is what comes back
   * — no loop. Paging over markets is what needed one: an episode's markets all
   * collapse into a single card, so 20 rows of one podcast run rendered as ONE,
   * and the feed opened on three cards no matter how much had been built. The
   * client had to keep requesting pages and counting cards to compensate.
   */
  const fetchFeedPages = useCallback(
    async (startCursor: string | null, existing: SandwichPost[]) => {
      // Pass the viewer's anonymous id so the server marks which cards this user
      // already liked (viewerHasLiked) — that's what renders the heart red on
      // load. Without it every post comes back unliked.
      const result = await getPostPage(FEED_PAGE_SIZE, startCursor, null, anonymousId);
      // The cursor is stable, but a card republished between two pages could
      // still arrive twice — a duplicate key would break the list outright.
      const seen = new Set(existing.map((post) => post.id));
      // Sort this page on its own and append it — never re-sort what the
      // reader has already scrolled past.
      const page = result.posts.filter((post) => !seen.has(post.id));
      return {
        rows: [...existing, ...sortPosts(page, feedSortRef.current)],
        cursor: result.nextCursor,
        more: result.nextCursor !== null,
      };
    },
    [anonymousId],
  );

  const loadSandwiches = useCallback(
    async (refreshMode = false) => {
      const cached = getCachedPosts(FEED_PAGE_SIZE, null, anonymousId);

      if (!refreshMode && cached) {
        // Paint the cached first page immediately, then refresh it in the
        // background. The top-up this replaces existed to reach a full screen
        // of cards; a page of cards already is one.
        setPosts(sortPosts(cached, feedSortRef.current));
        setLoading(false);
        void fetchFeedPages(null, [])
          .then(({ rows, cursor, more }) => {
            setPosts(rows);
            setFeedCursor(cursor);
            setHasMoreFeed(more);
          })
          .catch(() => {});
        return;
      }

      if (refreshMode) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorMessage(null);

      try {
        const { rows, cursor, more } = await fetchFeedPages(null, []);
        setPosts(rows);
        setFeedCursor(cursor);
        setHasMoreFeed(more);
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [anonymousId, fetchFeedPages],
  );

  const changeFeedSort = useCallback((next: FeedSort) => {
    if (next === feedSortRef.current) return;
    void Haptics.selectionAsync();
    feedSortRef.current = next;
    setFeedSort(next);
    setPosts((current) => sortPosts(current, next));
    feedListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  /** Next page(s), triggered as the user nears the bottom of the feed. */
  const loadMoreSandwiches = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreFeed || !feedCursor || !anonymousId) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    void (async () => {
      try {
        const { rows, cursor, more } = await fetchFeedPages(feedCursor, posts);
        setPosts(rows);
        setFeedCursor(cursor);
        setHasMoreFeed(more);
      } catch {
        // A failed page is not worth an error card over the feed the user is
        // already reading — the next scroll to the bottom retries.
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    })();
  }, [anonymousId, fetchFeedPages, feedCursor, hasMoreFeed, posts]);

  useEffect(() => {
    // Wait until the anonymous social id is resolved before the first load so
    // the feed comes back with correct like state. getAnonymousSocialId always
    // resolves (and fast), so this doesn't block the feed in practice.
    if (!anonymousId) return;
    void loadSandwiches(false);
  }, [anonymousId, loadSandwiches]);

  // Latest values for the deep-link handler below, read through refs so it can
  // depend on the link alone.
  const deepLinkContextRef = useRef({ sandwiches, anonymousId, sandwichDetail, applyUpdatedSandwich });
  useEffect(() => {
    deepLinkContextRef.current = { sandwiches, anonymousId, sandwichDetail, applyUpdatedSandwich };
  }, [sandwiches, anonymousId, sandwichDetail, applyUpdatedSandwich]);

  // Open the shared sandwich's detail when arriving via a share link.
  //
  // Keyed on the link ONLY. It used to also depend on the feed + anonymousId,
  // which change while a cold-start feed loads — that cancelled the in-flight
  // fetch, the handled-guard blocked the retry, and the link opened nothing.
  // Once opened, the param is consumed so the SAME link tapped again later
  // arrives as a change and opens again (the guard used to swallow it).
  useEffect(() => {
    const id = typeof deepLinkSandwichId === "string" ? deepLinkSandwichId.trim() : "";
    if (!id) {
      deepLinkHandledRef.current = null;
      return;
    }
    if (deepLinkHandledRef.current === id) return;
    deepLinkHandledRef.current = id;

    let unmounted = false;
    void (async () => {
      const context = deepLinkContextRef.current;
      // Prefer a sandwich already in the loaded feed; otherwise fetch by id so
      // links to sandwiches outside the first page still resolve.
      const existing = context.sandwiches.find((item) => item.id === id);
      const target = existing ?? (await getSandwichById(id, context.anonymousId));
      if (unmounted) return;
      if (target) {
        const latest = deepLinkContextRef.current;
        latest.sandwichDetail.open(target, { onUpdated: latest.applyUpdatedSandwich });
      }
      navigation.setParams({ sandwichId: undefined } as never);
    })();

    return () => {
      unmounted = true;
    };
  }, [deepLinkSandwichId, navigation]);

  /**
   * Like/unlike the CARD a market belongs to. ONE request, whatever it holds.
   *
   * An episode is N markets in this list rendering as one card, so the write
   * lands on every row sharing the postId — the feed row and the episode screen
   * must not disagree about a heart they both read from the same card.
   */
  const handleToggleLike = useCallback(
    async (sandwich: Sandwich) => {
      if (!anonymousId) {
        showToast({ text: "Preparing reactions...", tone: "processing" });
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const before = cardSocial([sandwich]);
      const optimistic = toggledCardSocial(before);
      // Social fields only — keeping the rest of each object (and its `legs`
      // array) identical is what lets the memoised card skip a re-render.
      setPosts((current) => applyCardSocialToPosts(current, sandwich, optimistic));

      try {
        const updated = await setCardLike(sandwich, optimistic.viewerHasLiked, anonymousId);
        setPosts((current) => applyCardSocialToPosts(current, sandwich, updated));
      } catch (error) {
        setPosts((current) => applyCardSocialToPosts(current, sandwich, before));
        showToast({ text: getErrorMessage(error), tone: "error" });
      }
    },
    [anonymousId, showToast],
  );

  /**
   * The episode heart. The markets under a card share one like, so this is the
   * same single request as a lone card's heart — not a loop over the group.
   */
  const handleToggleLikeGroup = useCallback(
    (group: Sandwich[]) => {
      const [card] = group;
      if (card) void handleToggleLike(card);
    },
    [handleToggleLike],
  );

  // Open our own themed share sheet (thesis + markets preview, copy-link, native
  // share). `present()` must run synchronously from the tap, so keep this sync.
  const handleShareSandwich = useCallback((sandwich: Sandwich) => {
    shareSheetRef.current?.open(sandwich);
  }, []);

  const handleOpenGroup = useCallback(
    (video: PodcastGroupVideo, group: Sandwich[]) =>
      podcastGroup.open({ video, sandwiches: group }),
    [podcastGroup],
  );

  const handleSandwichCreated = useCallback(
    (created: Sandwich) => {
      // The feed holds cards, and the commit hands back a market — so wrap it in
      // the card it landed on. Built locally rather than refetched so the new
      // sandwich appears the instant it exists; the next refresh replaces this
      // with the server's own copy of the same post.
      const card: SandwichPost = {
        id: created.postId ?? created.id,
        kind: "thesis",
        sourceId: created.sourceId,
        title: created.name,
        coverUrl: null,
        originHandle: created.source.authorHandle,
        marketCount: 1,
        publishedAt: created.createdAt,
        createdAt: created.createdAt,
        sandwiches: [created],
        likeCount: created.likeCount,
        commentCount: created.commentCount,
        viewerHasLiked: created.viewerHasLiked,
      };
      setPosts((current) => [card, ...current.filter((post) => post.id !== card.id)]);
      showToast({ text: `🥪 ${created.name} created!`, tone: "success" });
    },
    [showToast],
  );

  const empty = !loading && sandwiches.length === 0 && !errorMessage;

  // Today's question. Refetched on pull-to-refresh and after any publish, so
  // the answer count moves when someone (including this user) answers it.
  const [dailyPrompt, setDailyPrompt] = useState<DailyPrompt | null>(null);
  const loadDailyPrompt = useCallback(() => {
    void getCurrentPrompt().then(setDailyPrompt);
  }, []);
  useEffect(() => {
    loadDailyPrompt();
  }, [loadDailyPrompt]);

  const openPromptComposer = useCallback(() => {
    if (!dailyPrompt) return;
    Keyboard.dismiss();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    composer.open({
      prompt: dailyPrompt,
      onCreated: (created) => {
        handleSandwichCreated(created);
        loadDailyPrompt();
      },
    });
  }, [composer, dailyPrompt, handleSandwichCreated, loadDailyPrompt]);

  // The feed is virtualized. It used to be a `ScrollView` whose children were
  // `feedItems.map(...)`, which mounted every card ever paged in and kept them
  // mounted — so the deeper you scrolled the worse the frame time got, and each
  // new card paid a full mount on the JS thread mid-scroll.
  const renderFeedItem = useCallback(
    ({ item }: { item: FeedItem }) =>
      item.kind === "video" ? (
        <PodcastGroupCard
          video={item.video}
          sandwiches={item.sandwiches}
          onOpenGroup={handleOpenGroup}
          onToggleLikeGroup={handleToggleLikeGroup}
          onComment={onCommentSandwich}
          onShare={handleShareSandwich}
        />
      ) : item.kind === "take" ? (
        <TakeCard
          take={item.take}
          sandwich={item.sandwich}
          onPress={onSelectSandwich}
        />
      ) : (
        <SandwichCard
          sandwich={item.sandwich}
          onPress={onSelectSandwich}
          onToggleLike={handleToggleLike}
          onComment={onCommentSandwich}
          onShare={handleShareSandwich}
          showRemix={false}
          layout="holding"
        />
      ),
    [
      handleOpenGroup,
      handleToggleLikeGroup,
      onCommentSandwich,
      handleShareSandwich,
      onSelectSandwich,
      handleToggleLike,
    ],
  );

  const feedKeyExtractor = useCallback((item: FeedItem) => item.key, []);

  /**
   * The header and footer were inline JSX in the FlatList's props, so they were
   * a fresh element identity on every render of this screen — and this screen
   * re-renders for search typing, follow toggles, tab switches and news
   * loading, none of which change what the header shows. Every one of those
   * updates made the list reconcile the header subtree.
   */
  const feedHeader = useMemo(
    () => (
      <>
        {dailyPrompt && !loading ? (
          <DailyPromptCard prompt={dailyPrompt} onPress={openPromptComposer} />
        ) : null}

        {/* Only when there's nothing to show — a failed refresh over a loaded
            feed keeps the feed on screen. */}
        {errorMessage && feedItems.length === 0 && !loading ? (
          <LoadErrorState
            title="Couldn't load sandwiches"
            onRetry={() => void loadSandwiches(true)}
          />
        ) : null}

        {loading ? <SandwichLoadingScreen /> : null}

        {empty ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>No Sandwiches yet</Text>
            <Text style={styles.stateBody}>Created cards will appear here.</Text>
          </View>
        ) : null}
      </>
    ),
    [dailyPrompt, empty, errorMessage, feedItems.length, loadSandwiches, loading, openPromptComposer, styles],
  );

  const feedFooter = useMemo(
    () =>
      loadingMore ? (
        <ActivityIndicator
          style={styles.feedFooterSpinner}
          color={colors.textSecondary}
        />
      ) : null,
    [colors.textSecondary, loadingMore, styles],
  );


  const screenWidth = Dimensions.get("window").width;

  // Compose FAB → open the composer directly. (Previously the "+" circle
  // bloomed to fill the screen before the route pushed — that full-screen blue
  // flash was removed in favor of a plain slide-in push.)
  // The "+" itself is the tabs layout's single instance (shared with Home);
  // the feed only supplies what it does here.
  const openComposer = useCallback(() => {
    composer.open({ onCreated: handleSandwichCreated });
  }, [composer, handleSandwichCreated]);
  useComposeAction("sandwich", openComposer);
  const [activeTab, setActiveTab] = useState<"for-you" | "news">("for-you");
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  // Stocks + crypto the feed's headlines are matched against for ticker chips.
  const [newsCatalog, setNewsCatalog] = useState<Stock[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const newsRequestIdRef = useRef(0);
  const newsLoadedRef = useRef(false);
  const tabProgress = useSharedValue(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SocialUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  const searchBarWidth = useSharedValue(0);
  const searchBarStyle = useAnimatedStyle(() => ({
    width: `${searchBarWidth.value}%` as unknown as number,
    opacity: interpolate(searchBarWidth.value, [0, 40, 100], [0, 0.5, 1]),
  }));
  const followOverrideRef = useRef<Map<string, boolean>>(new Map());
  const [, forceFollowUpdate] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userProfileOpen, setUserProfileOpen] = useState(false);

  // Pull the live tokens.xyz news feed (global crypto + @tokens posts). No
  // params = global mode; cached server-side so re-entering the tab is cheap.
  const loadNews = useCallback(async (force = false) => {
    if (!force && newsLoadedRef.current) return;

    const requestId = ++newsRequestIdRef.current;
    newsLoadedRef.current = true;
    setNewsLoading(true);
    if (force) setNewsRefreshing(true);

    // The whole feed (the proxy's 50-item cap) plus the catalog its headlines
    // are matched against. The catalog is best-effort: without it the stories
    // still render, just without ticker chips.
    const [itemsResult, stocksResult, cryptoResult] = await Promise.allSettled([
      getTokenNews({ limit: 50 }),
      getTopHolderStocks({ limit: 150, category: "all" }),
      getTopHolderStocks({ limit: 60, category: "crypto" }),
    ]);
    if (requestId !== newsRequestIdRef.current) return;

    if (itemsResult.status === "fulfilled") {
      setNewsItems(itemsResult.value);
    } else {
      console.warn("[news-tab] news fetch failed", itemsResult.reason);
    }
    const catalog = [
      ...(cryptoResult.status === "fulfilled" ? cryptoResult.value : []),
      ...(stocksResult.status === "fulfilled" ? stocksResult.value : []),
    ];
    if (catalog.length > 0) setNewsCatalog(catalog);
    setNewsLoading(false);
    setNewsRefreshing(false);
  }, []);

  const newsStories = useMemo(
    () => buildNewsStories(newsItems, newsCatalog),
    [newsItems, newsCatalog],
  );

  const openNewsStory = useCallback((story: NewsStory) => {
    setActiveNewsStory(story);
    expoRouter.push("/news-story");
  }, []);

  const switchTab = useCallback(
    (next: "for-you" | "news") => {
      if (next === activeTab) {
        if (next === "news") void loadNews(true);
        return;
      }
      void Haptics.selectionAsync();
      setActiveTab(next);
      if (next === "news") void loadNews();
      tabProgress.value = withTiming(next === "for-you" ? 0 : 1, {
        duration: 240,
        easing: Easing.bezier(0.32, 0.72, 0, 1),
      });
    },
    [activeTab, loadNews, tabProgress],
  );

  const pagesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -tabProgress.value * screenWidth }],
  }));

  // Search users functionality
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchLoading(true);

    searchDebounceRef.current = setTimeout(() => {
      const viewerId = user?.id ?? null;
      void searchUsers(q, viewerId, 20)
        .then((results) => {
          setSearchResults(results);
          setSearchLoading(false);
        })
        .catch(() => setSearchLoading(false));
    }, 280);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, user?.id]);

  function getSearchIsFollowing(u: SocialUser): boolean {
    const override = followOverrideRef.current.get(u.privyUserId);
    return override !== undefined ? override : u.isFollowing;
  }

  async function handleSearchFollow(u: SocialUser) {
    if (!user) return;
    const payload = appUserPayloadFromPrivyUser(user);
    if (!payload) return;

    const currently = getSearchIsFollowing(u);
    followOverrideRef.current.set(u.privyUserId, !currently);
    forceFollowUpdate((n) => n + 1);

    try {
      if (currently) {
        await unfollowUser(payload, u.privyUserId);
      } else {
        await followUser(payload, u.privyUserId);
      }
    } catch {
      followOverrideRef.current.set(u.privyUserId, currently);
      forceFollowUpdate((n) => n + 1);
    }
  }


  return (
    <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
      <View style={styles.screenStack}>
        <View style={styles.screenShell}>

          {/* ── Inline tab header ── */}
          <LinearGradient
            colors={[
              colors.background,
              withAlpha(colors.background, 0.9),
              withAlpha(colors.background, 0),
            ]}
            // Solid through the sort toggle's line, fading only in the last
            // stretch, so scrolled text never shows behind the toggle.
            locations={[0, 0.8, 1]}
            style={styles.tabHeaderFade}
          >
            {searchOpen ? (
              <Animated.View style={[styles.inlineSearchBar, searchBarStyle]}>
                <Ionicons name="search" size={18} color={colors.textTertiary} />
                <TextInput
                  ref={searchInputRef}
                  style={styles.searchInput}
                  placeholder="Search people..."
                  placeholderTextColor={colors.textTertiary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    setSearchQuery('');
                    setSearchOpen(false);
                    searchBarWidth.value = withTiming(0, {
                      duration: 180,
                      easing: Easing.bezier(0.23, 1, 0.32, 1),
                    });
                  }}
                  hitSlop={8}
                  style={styles.searchClearBtn}
                >
                  <Ionicons name="close" size={18} color={colors.textTertiary} />
                </Pressable>
              </Animated.View>
            ) : (
              <View style={styles.tabHeaderRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="For You"
                  onPress={() => switchTab('for-you')}
                  style={({ pressed }) => [
                    styles.tabHeaderBtn,
                    pressed && styles.tabHeaderBtnPressed,
                  ]}
                >
                  <FilterLabel label="For You" active={activeTab === 'for-you'} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="News"
                  onPress={() => switchTab('news')}
                  style={({ pressed }) => [
                    styles.tabHeaderBtn,
                    pressed && styles.tabHeaderBtnPressed,
                  ]}
                >
                  <FilterLabel label="News" active={activeTab === 'news'} />
                </Pressable>
                {/* Clips: video sandwiches, one call per screen. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Video clips"
                  hitSlop={10}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    expoRouter.push("/reels");
                  }}
                  style={({ pressed }) => [
                    styles.reelsButton,
                    pressed && styles.tabHeaderBtnPressed,
                  ]}
                >
                  <Ionicons name="play-circle" size={28} color={colors.text} />
                </Pressable>
              </View>
            )}
            {/* Inside the header, not the list: the fade overlaps the feed's
                first 18pt, and a toggle there sat under it and took no taps. */}
            {activeTab === 'for-you' && !searchOpen ? (
              <View style={styles.feedSortRow}>
                <FeedSortToggle value={feedSort} onChange={changeFeedSort} />
              </View>
            ) : null}
          </LinearGradient>

          <Animated.View
            style={[styles.pagesRow, { width: screenWidth * 2 }, pagesStyle]}
          >
            <View style={{ width: screenWidth }}>
              {/* Search results overlay */}
              {searchQuery.trim().length >= 2 ? (
                <View style={styles.searchOverlay}>
                  {searchLoading ? (
                    <View style={styles.searchCenter}>
                      <ActivityIndicator color={colors.icon} size="small" />
                    </View>
                  ) : searchResults.length === 0 ? (
                    <View style={styles.searchCenter}>
                      <Text style={styles.searchEmptyText}>No users found</Text>
                    </View>
                  ) : (
                    searchResults.map((u) => {
                      const isMe = u.privyUserId === user?.id;
                      const isFollowing = getSearchIsFollowing(u);
                      return (
                        <PressableScale
                          key={u.id}
                          style={styles.searchRow}
                          onPress={() => {
                            if (!isMe) {
                              setSelectedUserId(u.privyUserId);
                              setUserProfileOpen(true);
                            }
                          }}
                        >
                          {u.avatarUrl ? (
                            <Image
                              source={{ uri: u.avatarUrl }}
                              style={styles.searchAvatar}
                            />
                          ) : (
                            <View style={styles.searchAvatarFallback}>
                              <Text style={styles.searchAvatarLetter}>
                                {(u.name ?? "?").slice(0, 1).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <View style={styles.searchRowInfo}>
                            <Text
                              style={styles.searchRowName}
                              numberOfLines={1}
                            >
                              {userDisplayName(u)}
                            </Text>
                            <Text style={styles.searchRowSub}>
                              {u.followerCount} followers
                            </Text>
                          </View>
                          {isMe ? (
                            <View style={styles.searchYouPill}>
                              <Text style={styles.searchYouPillText}>You</Text>
                            </View>
                          ) : (
                            <FollowButton
                              size="sm"
                              following={isFollowing}
                              onPress={(e) => {
                                e.stopPropagation();
                                void handleSearchFollow(u);
                              }}
                            />
                          )}
                        </PressableScale>
                      );
                    })
                  )}
                </View>
              ) : null}

              <FlatList
                ref={feedListRef}
                style={styles.scrollView}
                keyboardShouldPersistTaps="handled"
                data={loading ? EMPTY_FEED : feedItems}
                keyExtractor={feedKeyExtractor}
                renderItem={renderFeedItem}
                contentContainerStyle={[
                  styles.content,
                  { paddingBottom: composeFabBottom + 56 },
                ]}
                // Cards are tall, so a small window still covers the screen with
                // a screen of runway either side.
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                // Deliberately NOT `removeClippedSubviews`. The detail screen is
                // pushed with UIKit's iOS 18 zoom, and the patched screen stack
                // holds only a __weak reference to the card it grew out of (see
                // patches/react-native-screens+4.16.0.patch). That flag detaches
                // offscreen cells from the native hierarchy, and a detached or
                // re-created source view makes `sourceViewProvider` return nil
                // mid-transition — UIKit then falls back to its default and the
                // zoom-out stalls on a blurred frame instead of landing on the
                // card. Windowing alone gives nearly all of the scroll win.
                windowSize={7}
                onEndReachedThreshold={1}
                onEndReached={loadMoreSandwiches}
                ListHeaderComponent={feedHeader}
                ListFooterComponent={feedFooter}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => {
                      void loadSandwiches(true);
                      loadDailyPrompt();
                    }}
                  />
                }
              />
            </View>

            {/* News tab */}
            <View style={{ width: screenWidth, flex: 1 }}>
              <NewsFeed
                stories={newsStories}
                loading={newsLoading}
                refreshing={newsRefreshing}
                onRefresh={() => void loadNews(true)}
                bottomInset={composeFabBottom + 56}
                onOpenStory={openNewsStory}
                onOpenStock={(stock) => stockDetailSheetRef.current?.open(stock)}
              />
            </View>
          </Animated.View>
        </View>
      </View>


      <SandwichShareSheet ref={shareSheetRef} />
      <StockDetailSheet
        ref={stockDetailSheetRef}
        onOpenUser={(privyUserId) => {
          setSelectedUserId(privyUserId);
          setUserProfileOpen(true);
        }}
      />
      {selectedUserId && (
        <UserProfileScreen
          visible={userProfileOpen}
          onClose={() => setUserProfileOpen(false)}
          targetPrivyUserId={selectedUserId}
          viewerPrivyUserId={user?.id ?? ""}
          viewerPayload={appUser}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * Themed. The tinted pills (status, risk, side, warning) keep their hue in
 * both modes: a pastel wash in light, a translucent wash of the same accent
 * in dark — a pastel block on a near-black page read as a hole in it.
 */
const makeStyles = (c: ThemeColors) => {
  const isDark = c.background !== "#ffffff";
  /** Light pastel in light mode, the accent at low alpha in dark. */
  const wash = (accent: string, pastel: string) => (isDark ? withAlpha(accent, 0.18) : pastel);
  /** Saturated ink in light mode, a lighter step of the same hue in dark. */
  const ink = (light: string, dark: string) => (isDark ? dark : light);
  return StyleSheet.create({
  podcastRoot: {
    flex: 1,
  },
  podcastLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 14,
  },
  podcastLoadingText: {
    fontFamily: F,
    fontWeight: "700",
    fontSize: 16,
    color: c.text,
    textAlign: "center",
  },
  podcastLoadingHint: {
    fontFamily: F,
    fontWeight: "500",
    fontSize: 13,
    color: c.textTertiary,
    textAlign: "center",
    lineHeight: 18,
  },
  page: {
    flex: 1,
    backgroundColor: c.background,
  },
  screenStack: {
    flex: 1,
    backgroundColor: c.background,
    shadowColor: c.shadow,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 14 },
    elevation: 22,
  },
  screenShell: {
    flex: 1,
    backgroundColor: c.background,
    overflow: "hidden",
    borderRadius: 0,
  },
  scrollView: {
    flex: 1,
  },
  feedFooterSpinner: {
    paddingVertical: 18,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 24,
  },
  floatingTabBar: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    zIndex: 20,
    paddingHorizontal: 16,
  },
  floatingSearchIcon: {
    position: "absolute",
    right: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  floatingSearchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.background,
    borderRadius: 22,
    paddingHorizontal: 16,
    height: 48,
    gap: 10,
    overflow: "hidden",
  },
  floatingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 100,
    backgroundColor: c.background,
  },
  floatingPillActive: {},
  floatingPillEmoji: {
    fontSize: 20,
    lineHeight: 26,
  },
  floatingPillLabel: {
    fontSize: 20,
    fontWeight: "600",
    color: c.iconMuted,
    fontFamily: F,
    letterSpacing: 0.2,
  },
  floatingPillLabelActive: {
    color: c.text,
    fontWeight: "800",
  },
  pagesRow: {
    flex: 1,
    flexDirection: "row",
  },
  // Its own right-aligned line under the tabs; the list's top padding is
  // trimmed so the first card follows it closely.
  feedSortRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 22,
    marginTop: -2,
  },
  feedSortToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  feedSortTogglePressed: {
    opacity: 0.55,
  },
  feedSortToggleText: {
    fontFamily: F,
    fontSize: 13,
    fontWeight: "800",
    color: c.textTertiary,
  },
  tabHeaderFade: {
    zIndex: 20,
    paddingBottom: 18,
    marginBottom: -18,
  },
  tabHeaderRow: {
    paddingTop: 24,
    paddingHorizontal: 22,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 18,
    backgroundColor: "transparent",
    position: "relative",
  },
  tabHeaderBtn: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  reelsButton: {
    position: "absolute",
    right: 18,
    bottom: 12,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  tabHeaderBtnPressed: {
    // Emil's canonical scale-on-press value — subtle but felt.
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  filterText: {
    color: c.textQuaternary,
    fontSize: 22,
    textTransform: "capitalize",
    fontWeight: "800",
    fontFamily: F,
  },
  filterStack: {
    position: "relative",
    alignSelf: "flex-start",
  },
  filterTextActive: {
    fontSize: 24,
    fontWeight: "900",
    fontFamily: F,
    textTransform: "capitalize",
    color: c.text,
  },
  filterOutline: {
    position: "absolute",
  },
  tabSearchIcon: {
    display: "none",
  },
  inlineSearchBar: {
    minHeight: 42,
    marginTop: 12,
    marginHorizontal: 18,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: wash("#0834F4", "#F1F4FF"),
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    overflow: "hidden",
  },
  // ── Composer nav (cancel / New sandwich) ──
  composerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    paddingVertical: 2,
  },
  composerNavPreview: {
    marginTop: 4,
    marginBottom: 10,
  },
  composerNavSide: {
    minWidth: 56,
  },
  composerNavSideLeft: {
    minWidth: 56,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  composerNavSideRight: {
    minWidth: 56,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  composerHeaderBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
  },
  // Applied to every exit control while the agent is cooking, so a locked back
  // button reads as unavailable instead of unresponsive.
  composerHeaderBackDisabled: {
    opacity: 0.35,
  },
  composerHeaderBackGlass: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  composerHeaderBackFallback: {
    width: "100%",
    height: "100%",
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  composerNavCancelText: {
    color: ink("#EB1C40", "#EB1C40"),
    fontSize: 16,
    fontWeight: "700",
    fontFamily: F,
  },
  newPostCancelText: {
    color: "rgba(255,26,184,0.4)",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: F,
  },
  composerNavTitle: {
    color: c.text,
    fontSize: 20,
    fontWeight: "800",
    fontFamily: F,
    textAlign: "center",
  },

  // ── "New Post" composer (picker entry screen) ──
  newPostRoot: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 2,
  },
  newPostNavClose: {
    minWidth: 56,
    alignItems: "flex-end",
  },
  newPostCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  newPostBody: {
    flex: 1,
  },
  newPostInputRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingTop: 32,
  },
  newPostAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  newPostInputWithPreview: {
    // With a card attached the field hugs the take so the preview lands on the
    // line right under the text instead of at the bottom of the tall tap zone.
    flex: 0,
    minHeight: 46,
  },
  newPostInput: {
    flex: 1,
    color: c.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "500",
    fontFamily: F,
    paddingTop: 5,
  },
  newPostToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: "auto",
    paddingTop: 14,
    paddingBottom: 4,
  },
  newPostToolIcons: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 18,
  },
  agentToggleWrap: {
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  agentToggleLabel: {
    color: c.textTertiary,
    fontSize: 10,
    fontWeight: "600",
    fontFamily: F,
  },
  newPostSubmit: {
    width: 116,
    height: 44,
    flexShrink: 0,
    borderRadius: 22,
  },
  newPostSubmitGlass: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 22,
    overflow: "hidden",
  },
  newPostSubmitSolid: {
    backgroundColor: c.actionPrimary,
  },
  newPostSubmitGlow: {
    shadowColor: c.actionPrimary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 8,
  },
  newPostSubmitDisabled: {
    opacity: 0.45,
  },
  newPostSubmitLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: F,
  },

  // ── Link preview cards ──
  linkPreviewCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  // The YouTube card drops the outline and reads as a raised surface instead.
  linkPreviewCardYt: {
    // overflow:hidden clips the iOS shadow; the thumbnail already clips itself.
    overflow: "visible",
    borderWidth: 0,
    borderColor: "transparent",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  linkPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  linkPreviewLabel: {
    color: c.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: F,
    letterSpacing: 0.5,
  },
  linkPreviewYtBody: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  linkPreviewYtThumbWrap: {
    width: 88,
    height: 60,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  linkPreviewYtThumb: {
    width: "100%",
    height: "100%",
  },
  linkPreviewYtPlayBtn: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  linkPreviewYtMeta: {
    flex: 1,
    gap: 3,
  },
  linkPreviewYtTitle: {
    color: c.text,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: F,
    lineHeight: 17,
  },
  linkPreviewXBody: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  linkPreviewXIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  linkPreviewXAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  linkPreviewXMeta: {
    flex: 1,
    gap: 2,
  },
  linkPreviewXHandle: {
    color: c.text,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: F,
  },
  linkPreviewXUsername: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "400",
    fontFamily: F,
  },
  linkPreviewXTweetText: {
    color: c.text,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: F,
  },
  linkPreviewXTweetId: {
    color: c.textSecondary,
    fontSize: 12,
    fontFamily: F,
  },
  linkPreviewFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  linkPreviewFooterUrl: {
    color: c.textTertiary,
    fontSize: 11,
    fontFamily: F,
    flex: 1,
  },

  // ── Source-video attribution (sandwich from a YouTube video) ──
  sourceVideoCompact: {
    marginTop: 2,
    marginBottom: 4,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: c.surface,
    padding: 8,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  sourceVideoChannelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sourceVideoChannel: {
    color: c.textSecondary,
    fontSize: 12,
    fontFamily: F,
    flexShrink: 1,
  },
  // "12:34 · replay this call" under the hero video. Matches the moments feed's
  // clip chip so the same affordance looks the same everywhere.
  momentChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.backgroundAlt,
  },
  momentChipText: {
    fontFamily: F_MONO,
    fontWeight: "700",
    fontSize: 11.5,
    color: c.accentBlue,
  },
  momentChipHint: {
    fontFamily: F_DISPLAY_MEDIUM,
    fontWeight: "600",
    fontSize: 11.5,
    color: c.textTertiary,
  },
  sourceVideoHeroShadow: {
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: c.surface,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  sourceVideoHero: {
    borderRadius: 16,
    backgroundColor: c.surface,
    overflow: "hidden",
  },
  sourceVideoHeroThumbWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },
  sourceVideoTapLayer: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceVideoMuteBtn: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  sourceVideoHeroPlayWrap: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceVideoHeroPlayBadge: {
    width: 64,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#FF0000",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sourceVideoHeroMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  sourceVideoHeroMetaText: {
    flex: 1,
    gap: 2,
  },
  sourceVideoAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.surfaceAlt,
  },

  // ── "What do you believe?" picker ──
  believeHeading: {
    color: c.text,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    fontFamily: F,
    marginBottom: 18,
  },
  believeInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 88,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
  },
  believeAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#22C55E",
  },
  believeInput: {
    flex: 1,
    color: c.text,
    fontSize: 17,
    fontWeight: "600",
    fontFamily: F,
    paddingVertical: 8,
    maxHeight: 72,
  },
  believeCards: {
    marginTop: 28,
    gap: 14,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  optionCardPrimary: {
    backgroundColor: wash("#0834F4", "#ECECFB"),
  },
  optionCardSecondary: {
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
  },
  optionCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  optionEmoji: {
    fontSize: 32,
    lineHeight: 38,
  },
  optionBody: {
    flex: 1,
    gap: 4,
  },
  optionTitle: {
    color: c.text,
    fontSize: 19,
    fontWeight: "900",
    fontFamily: F,
  },
  optionSubtitle: {
    color: c.textSecondary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
    fontFamily: F,
  },
  believeStage: {
    marginTop: 18,
    textAlign: "center",
    color: c.textSecondary,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: F,
  },

  // ── Add legs screen ──
  legPickerShell: {
    flex: 1,
    backgroundColor: c.background,
  },
  legPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: "rgba(15, 23, 42, 0.22)",
  },
  legPickerOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "8%",
    bottom: 0,
    zIndex: 30,
    backgroundColor: c.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  legPickerHandleArea: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  legPickerHandlePill: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
  },
  addLegsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 10,
  },
  addLegsTitle: {
    color: c.text,
    fontSize: 20,
    fontWeight: "900",
    fontFamily: F,
  },
  categoryTabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  legPickerSearchRow: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 2,
  },
  previewPaywallNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
  },
  previewPaywallNoticeText: {
    flex: 1,
    color: c.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    fontFamily: F,
  },
  perpPickerNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginHorizontal: 18,
    marginTop: 6,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
  },
  perpPickerNoticeText: {
    flex: 1,
    color: c.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    fontFamily: F,
  },
  categoryTabsRow: {
    paddingHorizontal: 20,
    paddingVertical: 4,
    gap: 4,
  },
  categoryTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryTabActive: {
    // no background — active state is text-only
  },
  categoryTabLabel: {
    color: c.textQuaternary,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: F,
  },
  categoryTabLabelActive: {
    color: c.text,
    fontWeight: "900",
    fontSize: 16,
  },
  addLegsScrollContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
  },
  stockGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  stockCard: {
    width: "48%",
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  stockCardSelected: {
    borderColor: ink("#0834F4", "#7c93ff"),
    borderWidth: 2,
  },
  stockCardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  stockCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stockLogo: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: c.surfaceAlt,
  },
  stockLogoLetter: {
    color: c.background,
    fontSize: 20,
    fontWeight: "900",
    fontFamily: F,
  },
  stockPlus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
  },
  stockPlusSelected: {
    backgroundColor: "#0834F4",
  },
  stockName: {
    color: c.text,
    fontSize: 17,
    fontWeight: "900",
    fontFamily: F,
    marginTop: 12,
  },
  stockTickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  stockTicker: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  stockBadge: {
    backgroundColor: wash("#B7791F", "#FBE9C7"),
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  stockBadgeText: {
    color: ink("#B7791F", "#F5C04B"),
    fontSize: 10,
    fontWeight: "900",
    fontFamily: F,
    letterSpacing: 0.5,
  },
  stockSparkWrap: {
    height: 44,
    marginTop: 12,
    marginBottom: 8,
  },
  stockPriceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  stockPrice: {
    color: c.text,
    fontSize: 17,
    fontWeight: "900",
    fontFamily: F,
  },
  stockChange: {
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F_DISPLAY_MEDIUM,
  },
  stockChangeUp: {
    color: ink("#16A34A", "#4ade80"),
  },
  stockChangeDown: {
    color: ink("#EB1C40", "#EB1C40"),
  },
  comingSoonWrap: {
    paddingTop: 56,
    paddingHorizontal: 28,
    alignItems: "center",
    gap: 10,
  },
  comingSoonEmoji: {
    fontSize: 42,
    lineHeight: 48,
  },
  comingSoonTitle: {
    color: c.text,
    fontSize: 18,
    fontWeight: "900",
    fontFamily: F,
  },
  comingSoonBody: {
    color: c.textTertiary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: F,
    textAlign: "center",
  },
  reviewBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 28,
    backgroundColor: c.surfaceSelected,
  },
  reviewBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  reviewBarEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  reviewBarCount: {
    color: c.text,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: F,
  },
  reviewBarBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  reviewBarBtnText: {
    color: c.text,
    fontSize: 17,
    fontWeight: "900",
    fontFamily: F,
  },

  // ── Weight slider ──
  sliderTouch: {
    height: 36,
    justifyContent: "center",
    marginTop: 8,
  },
  sliderTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: c.border,
    overflow: "hidden",
  },
  sliderFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#0834F4",
  },
  sliderThumb: {
    position: "absolute",
    top: 5,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#0834F4",
    borderWidth: 3,
    borderColor: c.background,
  },

  // ── Leg config sheet ──
  legConfig: {
    paddingTop: 6,
  },
  legConfigHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 26,
  },
  legConfigLogo: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: c.surfaceAlt,
  },
  legConfigHeaderInfo: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  legConfigTitle: {
    color: c.text,
    fontSize: 20,
    fontWeight: "900",
    fontFamily: F,
  },
  legConfigSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legConfigSub: {
    color: c.textTertiary,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: F,
    flexShrink: 1,
  },
  legConfigChange: {
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  legConfigRemove: {
    backgroundColor: wash("#EB1C40", "#FFEFF1"),
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  legConfigRemoveText: {
    color: ink("#EB1C40", "#EB1C40"),
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  legConfigLabel: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "900",
    fontFamily: F,
    letterSpacing: 1,
    marginBottom: 12,
  },
  positionToggle: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 26,
  },
  positionBtn: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  positionBtnActive: {
    backgroundColor: c.text,
    borderColor: c.text,
  },
  positionBtnText: {
    color: c.textTertiary,
    fontSize: 17,
    fontWeight: "900",
    fontFamily: F,
    letterSpacing: 0.5,
  },
  positionBtnTextActive: {
    color: c.background,
  },
  legConfigWeightRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  legConfigWeightValue: {
    color: ink("#0834F4", "#7c93ff"),
    fontSize: 20,
    fontWeight: "900",
    fontFamily: F,
  },
  legConfigThesisWrap: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 84,
  },
  legConfigThesisInput: {
    color: c.text,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: F,
    minHeight: 60,
  },
  legConfigDone: {
    marginTop: 26,
    height: 58,
    borderRadius: 18,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
  legConfigDoneText: {
    color: c.background,
    fontSize: 18,
    fontWeight: "900",
    fontFamily: F,
  },
  // Flat timeline row — no boxed background, posts separated by a hairline
  // divider (feed-reference design).
  card: {
    paddingHorizontal: 2,
    paddingTop: 20,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardContentFull: {
    alignSelf: "stretch",
  },
  cardMark: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 9,
  },
  cardTitleGroup: {
    flex: 1,
  },
  cardTitle: {
    color: c.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: F,
  },
  cardSubtitle: {
    marginTop: 3,
    color: c.text,
    fontSize: 12,
    fontWeight: "500",
    fontFamily: F,
  },
  cardWrapper: {
    marginBottom: 18,
  },
  cardBlock: {
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    overflow: "hidden",
  },
  cardContext: {
    marginBottom: 6,
    color: c.text,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "900",
    textAlign: "center",
    fontFamily: F,
  },
  cardCreatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 3,
  },
  cardAvatarRing: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.surfaceAlt,
  },
  cardAvatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    // Neutral default avatar (person glyph) — no per-user color or initials.
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  // Fallback for a cited X account whose avatar URL is missing: initials read
  // as "someone specific", where the person glyph reads as "nobody".
  cardSourceAvatarInitials: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: F,
  },
  cardVerifiedBadge: {
    width: 14,
    height: 14,
    resizeMode: "contain",
  },
  cardHandleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  cardHandle: {
    flexShrink: 1,
    color: c.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "700",
    letterSpacing: 0,
    fontFamily: F,
  },
  // A cited account sits one step back from a builder's byline — same size and
  // weight so the row doesn't reflow, lower contrast so the hierarchy holds.
  cardHandleSource: {
    color: c.textSecondary,
  },
  // The builder's credit under a channel-led byline. Pulled up tight against
  // the name above it so the two read as one identity block, not two rows.
  cardSubHandleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: -2,
    marginBottom: 4,
  },
  cardSubHandle: {
    flexShrink: 1,
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
    fontFamily: F,
  },
  // Rung 4 (quaternary): the "@" prefix is decoration around the handle.
  // Faded in the color itself rather than via `opacity`, which does not apply
  // reliably to a nested Text span across platforms.
  cardHandleAt: {
    color: c.textQuaternary,
    fontSize: 13,
    fontWeight: "600",
  },
  cardPnlBig: {
    color: c.actionBuy,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: 0,
    textAlign: "right",
    fontFamily: F,
  },
  cardAvatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
  cardAvatarInitials: {
    color: c.background,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: F,
  },
  cardCreatorName: {
    color: c.text,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  // Rung 3 (tertiary): metadata, set back from the thesis by the token alone.
  cardTimestamp: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "500",
    fontFamily: F,
  },
  cardReturnPill: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
  },
  cardPnlPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  cardDirectionBadge: {
    fontSize: 13,
    fontWeight: "900",
    fontFamily: F,
  },
  cardReturnValue: {
    marginTop: 10,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: F,
  },
  cardReturnLabel: {
    color: c.textSecondary,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    fontFamily: F,
  },
  cardLegsRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  cardLegChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.surfaceAlt,
  },
  cardLegChipImage: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: c.surfaceAlt,
  },
  cardLegChipIconWrap: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardLegChipText: {
    color: c.text,
    fontSize: 11,
    fontWeight: "800",
    fontFamily: F,
  },
  cardLegsMore: {
    color: c.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: F,
  },
  cardFooterRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLegsStack: {
    flexDirection: "row",
    alignItems: "center",
    // Last line of defence on very narrow screens: the stack gives up width
    // (clipping a circle) before the PnL is allowed to leave the screen.
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  cardLegsStackOverlap: {
    marginLeft: -10,
  },
  cardLegsStackImage: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: c.surfaceAlt,
    backgroundColor: c.surfaceAlt,
  },
  cardLegsStackFallback: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: c.surfaceAlt,
    backgroundColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  // No gap: spacing comes from the fixed slot width below, so the distance
  // between every pair of icons is exactly one slot.
  cardActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    marginTop: 12,
  },
  // Avatar (34) + cardRow gap (10): keeps X cards' actions on the same left
  // edge as cards that render the avatar column.
  cardActionsRowInset: {
    marginLeft: 44,
  },
  cardAssetPnlPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: c.background,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: isDark ? 0.34 : 0.13,
    shadowRadius: 8,
    elevation: 3,
    // Pushed to the trailing edge without a flex spacer — a spacer would have
    // eaten a row gap on each side of itself.
    marginLeft: "auto",
    flexShrink: 1,
    minWidth: 0,
  },
  cardActionSpacer: {
    flex: 1,
  },
  cardPnlInline: {
    // Never yields width — the icon stack shrinks first.
    flexShrink: 0,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: F_DISPLAY_MEDIUM,
    letterSpacing: -0.3,
    fontVariant: ["tabular-nums"],
  },
  // "2/5" trailing the episode return: a qualifier on the number, so it must
  // read as secondary and must NOT pick up the red/green tint.
  cardPnlCoverage: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: F_DISPLAY_MEDIUM,
    color: c.textTertiary,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  // Equal fixed slots, icon pinned to the leading edge — so icon-to-icon
  // distance is 44 for every pair, and it is the same 44 on every card. (With
  // `flex: 1` the icons drifted card to card, because the space they shared
  // depended on the like count, whether Share rendered, and the pill's width.
  // The like count then made the first gap visibly wider than the rest; it is
  // now out of flow, living in this slot's trailing 24pt.)
  // 44×44 is the whole touch target — no hitSlop, which at this width would
  // have spilled each button's hit area over its neighbour's.
  cardActionButton: {
    width: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  // The sandwich feed hides Share, so three slots can each be wider without
  // crowding the PnL pill. Screens that show all four keep the 44 above —
  // 4 × 52 would not leave the pill enough room on a 375pt screen.
  cardActionButtonWide: {
    width: 52,
  },
  likeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  likeButtonActive: {},
  // Out of flow, sitting in the slot's trailing space just past the 20pt
  // heart. An absent count therefore costs nothing and a growing one moves
  // nothing — the icons keep their rhythm either way.
  heartLayer: {
    alignItems: "center",
    justifyContent: "center",
  },
  likeCountSlot: {
    position: "absolute",
    left: 25,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  likeButtonText: {
    fontVariant: ["tabular-nums"],
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: F,
  },
  likeButtonTextActive: {
    color: c.negative,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  thesisHighlight: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  pnlColumn: {
    width: 84,
    alignItems: "flex-end",
    paddingTop: 1,
  },
  pnlLabel: {
    color: c.text,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    fontFamily: F,
  },
  signalPercent: {
    marginTop: 2,
    width: 84,
    color: ink("#067647", "#4ade80"),
    fontSize: 19,
    lineHeight: 23,
    fontWeight: "900",
    textAlign: "right",
    fontFamily: F,
  },
  tradeRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  basketThumbOuter: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.82,
  },
  basketThumbStack: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  basketThumbCellOverlap: {
    marginLeft: -9,
  },
  basketThumbImage: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.background,
    backgroundColor: c.surfaceAlt,
  },
  basketThumbFallback: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.background,
    backgroundColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  tradeTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  tradeTitle: {
    color: c.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    fontFamily: F,
  },
  tradeSubtitle: {
    marginTop: 2,
    color: c.text,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  positionLine: {
    marginTop: 8,
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  pricePath: {
    flex: 1,
    minWidth: 0,
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    fontFamily: F,
  },
  socialActionRow: {
    marginTop: 8,
    paddingTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
  },
  socialActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  socialActionButtonActive: {
    backgroundColor: "transparent",
  },
  socialActionText: {
    color: c.textTertiary,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "700",
    fontFamily: F,
  },
  socialActionTextActive: {
    color: c.negative,
  },
  cardDivider: {
    height: 1,
    backgroundColor: c.surfaceAlt,
    marginTop: 12,
  },
  sourceFooter: {
    minHeight: 38,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  postRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  postBody: {
    flex: 1,
    minWidth: 0,
  },
  postHeader: {
    minHeight: 20,
    marginBottom: 3,
    flexDirection: "row",
    alignItems: "center",
  },
  postAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  postAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.surfaceAlt,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.text,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: c.background,
    fontSize: 13,
    fontWeight: "900",
    fontFamily: F,
  },
  sourceTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  sourceName: {
    color: c.text,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "900",
    fontFamily: F,
  },
  summaryText: {
    marginTop: 9,
    color: c.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: F,
  },
  cardLegsPreview: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  previewLegPill: {
    minHeight: 28,
    maxWidth: "48%",
    borderRadius: 8,
    backgroundColor: c.backgroundAlt,
    borderWidth: 1,
    borderColor: c.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  previewLegText: {
    minWidth: 0,
    color: c.text,
    fontSize: 11,
    fontWeight: "900",
    fontFamily: F,
  },
  previewLegWeight: {
    color: c.text,
    fontSize: 11,
    fontWeight: "900",
    fontFamily: F,
  },
  cardFooter: {
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: c.surfaceAlt,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardFooterText: {
    color: c.text,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "capitalize",
    fontFamily: F,
  },
  // The citation is deliberately the quietest thing on the card: tertiary text,
  // one line, small icon. It has to be findable and tappable without competing
  // with the builder's take for attention.
  citationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
  },
  citationText: {
    flexShrink: 1,
    color: c.textTertiary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    fontFamily: F,
  },
  citationUnavailable: {
    color: c.textTertiary,
    backgroundColor: c.surfaceAlt,
    borderRadius: 4,
    overflow: "hidden",
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 9,
    fontWeight: "700",
    fontFamily: F,
  },
  citationEmbed: {
    marginTop: 8,
  },
  // Plain, readable post body — regular-ish weight and generous line height
  // instead of heavy quote styling.
  cardThesisWrap: {
    position: "relative",
  },
  cardThesisText: {
    color: c.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "500",
    fontFamily: F,
  },
  cardShowMoreOverlay: {
    position: "absolute",
    right: 0,
    bottom: 0,
    minHeight: 23,
    justifyContent: "center",
    paddingLeft: 6,
    backgroundColor: c.background,
  },
  cardShowMore: {
    color: c.accentBlue,
    fontSize: 14,
    lineHeight: 23,
    fontWeight: "500",
    fontFamily: F,
  },
  routeBox: {
    marginTop: 9,
    borderRadius: 12,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    padding: 9,
  },
  routeLabel: {
    color: c.text,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    fontFamily: F,
  },
  routeText: {
    marginTop: 5,
    color: c.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: F,
  },
  notSayingText: {
    marginTop: 5,
    color: c.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    fontFamily: F,
  },
  thesisBox: {
    marginTop: 10,
  },
  thesisText: {
    marginTop: 7,
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
    fontFamily: F,
  },
  thesisToggle: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: c.surfaceAlt,
  },
  thesisToggleText: {
    color: c.text,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: F,
  },
  thesisArrowToggle: {
    marginTop: 10,
    alignSelf: "center",
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  thesisBullets: {
    marginTop: 8,
    gap: 6,
  },
  thesisBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  thesisBulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.text,
    marginTop: 7,
  },
  thesisBulletText: {
    flex: 1,
    color: c.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    fontFamily: F,
  },
  legsList: {
    marginTop: 6,
    gap: 10,
  },
  thesisDisclaimer: {
    marginTop: 14,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: c.surfaceAlt,
  },
  thesisDisclaimerText: {
    flex: 1,
    minWidth: 0,
    color: c.textTertiary,
    fontFamily: F,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
  },
  thesisExpandedBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.surfaceAlt,
  },
  showMoreButton: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: c.backgroundAlt,
  },
  showMoreButtonPressed: {
    backgroundColor: c.surfaceAlt,
  },
  showMoreText: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: F,
  },
  legRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  legAllocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legAllocationText: {
    // Allocation percentage under the leg name (replaces the old weight bar).
    marginTop: 4,
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  // Per-leg "jump to this leg's moment" chip. Only rendered when the legs came
  // from different points in the episode.
  legTsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.backgroundAlt,
  },
  legTsChipText: {
    fontFamily: F_MONO,
    fontWeight: "700",
    fontSize: 10,
    color: c.accentBlue,
  },
  legRowDivider: {
    borderBottomWidth: 0,
  },
  legImageWrap: {
    width: 48,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  legImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.surfaceAlt,
  },
  legImageFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
  legBody: {
    flex: 1,
    minWidth: 0,
  },
  legTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  legCopyColumn: {
    flex: 1,
    minWidth: 0,
  },
  legPrimaryTitle: {
    color: c.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: F,
  },
  legSidePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  legSidePillYes: {
    backgroundColor: wash("#22C55E", "#e7f8ec"),
  },
  legSidePillNo: {
    backgroundColor: wash(c.negative, "#ffe9f5"),
  },
  legSidePillText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "900",
    fontFamily: F,
  },
  legSidePillTextYes: {
    color: ink("#137a3a", "#4ade80"),
  },
  legSidePillTextNo: {
    color: c.actionSell,
  },
  legMetricCluster: {
    flexShrink: 0,
    flexDirection: "column",
    alignItems: "flex-end",
    alignSelf: "flex-start",
    gap: 3,
  },
  legDescriptionBelow: {
    marginTop: 2,
    color: c.textTertiary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    fontFamily: F,
  },
  legPrice: {
    color: c.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    textAlign: "right",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  legPnl: {
    color: c.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    textAlign: "right",
    fontFamily: F_DISPLAY_MEDIUM,
  },
  legPnlPositive: {
    color: c.chartPositive,
  },
  legPnlNegative: {
    color: c.chartNegative,
  },
  legPnlUnavailable: {
    color: c.textTertiary,
  },
  moreLegsText: {
    color: c.text,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    fontFamily: F,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: c.text,
    fontSize: 13,
    fontWeight: "900",
    fontFamily: F,
  },
  sectionHint: {
    color: c.textTertiary,
    fontSize: 11,
    fontWeight: "800",
    fontFamily: F,
  },
  sectionHintPill: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  stateCard: {
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    shadowColor: c.text,
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  stateTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: F,
  },
  stateBody: {
    marginTop: 4,
    color: c.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    fontFamily: F,
  },
  sandwichLoadingScreen: {
    width: "100%",
    paddingTop: 6,
  },
  sandwichSkeletonCard: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 2,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sandwichSkeletonAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surfaceAlt,
  },
  sandwichSkeletonContent: {
    flex: 1,
    gap: 10,
    paddingTop: 2,
  },
  sandwichSkeletonByline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sandwichSkeletonHandle: {
    width: "42%",
    height: 14,
    borderRadius: 7,
    backgroundColor: c.surfaceAlt,
  },
  sandwichSkeletonTime: {
    width: 44,
    height: 12,
    borderRadius: 6,
    backgroundColor: c.surfaceAlt,
  },
  sandwichSkeletonBodyLong: {
    width: "96%",
    height: 14,
    borderRadius: 7,
    backgroundColor: c.surfaceAlt,
  },
  sandwichSkeletonBodyMedium: {
    width: "78%",
    height: 14,
    borderRadius: 7,
    backgroundColor: c.surfaceAlt,
  },
  sandwichSkeletonBodyShort: {
    width: "54%",
    height: 14,
    borderRadius: 7,
    backgroundColor: c.surfaceAlt,
  },
  sandwichSkeletonActions: {
    minHeight: 40,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sandwichSkeletonActionGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 34,
  },
  sandwichSkeletonAction: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.surfaceAlt,
  },
  sandwichSkeletonPill: {
    width: 104,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  sheetBackground: {
    backgroundColor: c.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetSurface: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetHost: {
    flex: 1,
  },
  // Full-screen detail route container (replaces the old bottom-sheet surface).
  detailScreenRoot: {
    flex: 1,
    backgroundColor: c.background,
  },
  stickyHeaderUser: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    maxWidth: 190,
    gap: 8,
  },
  stickyHeaderAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.surfaceAlt,
  },
  stickyHeaderAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  stickyHeaderAvatarText: {
    color: c.text,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: F,
  },
  stickyHeaderIdentity: {
    flexShrink: 1,
    minWidth: 0,
  },
  stickyHeaderUserName: {
    color: c.text,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: F,
  },
  stickyHeaderSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  stickyHeaderSubName: {
    flexShrink: 1,
    color: c.textSecondary,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "600",
    fontFamily: F,
  },
  sheetScrollView: {
    // Transparent so the hero direction-tint (rendered behind the scroll)
    // shows through; the sheet's own white background backs everything below.
    backgroundColor: "transparent",
  },
  sheetContent: {
    paddingHorizontal: 10,
    paddingTop: 18,
    paddingBottom: 112,
    gap: 4,
  },
  // Direction tint behind the hero: light green (up) / magenta (down) fading
  // to white. Fixed at the sheet top; content scrolls over it.
  heroTint: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 460,
  },
  // Transparent hero (the tint shows through). Modest padding so the thesis
  // doesn't sit in a sea of empty space.
  sheetHero: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 14,
  },
  sheetCreatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sheetCreatorTap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sheetFollowButton: {
    minHeight: 40,
  },
  sheetFollowButtonPlaceholder: {
    width: 96,
    height: 40,
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
  },
  sheetCreatorAvatarRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  sheetCreatorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
  },
  sheetCreatorAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    // Neutral default avatar (person glyph) — no per-user color or initials.
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCreatorAvatarInitials: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  sheetCreatorInfo: {
    flex: 1,
    minWidth: 0,
  },
  sheetCreatorNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sheetCreatorName: {
    color: c.text,
    fontSize: 18,
    fontWeight: "800",
    fontFamily: F,
    flexShrink: 1,
  },
  sheetCreatorNameAt: {
    color: c.textTertiary,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: F,
  },
  sheetCreatorSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 1,
  },
  sheetCreatorSubName: {
    flexShrink: 1,
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
    fontFamily: F,
  },
  verifiedBadge: {
    width: 18,
    height: 18,
    resizeMode: "contain",
  },
  // Return metadata beneath the hero's social block.
  detailMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 2,
  },
  detailMetaLabel: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  // Sized to sit level with the 30pt PnL figure beside it.
  // SF Pro Rounded (the system rounded face).
  detailMetaLabelText: {
    color: c.text,
    fontSize: 24,
    fontWeight: "700",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  detailMetaLabelCount: {
    color: c.textTertiary,
  },
  detailMetaPnl: {
    fontSize: 26,
    // Rubik Bold, a step down from Black: the Black cut read heavier than
    // everything else on the screen.
    fontWeight: "700",
    fontFamily: F_DISPLAY_MEDIUM,
    // Tighter tracking on the display % so it reads as one unit; tabular
    // figures so the number's width doesn't jitter as the user scrubs the
    // chart and digits swap (Apple §15).
    letterSpacing: -0.7,
    fontVariant: ["tabular-nums"],
    // Box width and right-pinning live in ScrubReturnText: the scrub writes
    // this text from the UI thread, which skips Yoga measurement.
  },
  // Sits to the left of the big %, baseline-aligned and untinted so it qualifies
  // the number without competing with it.
  detailMetaPnlBasis: {
    alignSelf: "flex-end",
    marginBottom: 6,
    marginRight: 6,
    fontSize: 11,
    fontWeight: "600",
    fontFamily: F_DISPLAY_MEDIUM,
    letterSpacing: 0.2,
    color: c.textTertiary,
  },
  detailLikeShareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 0,
    marginHorizontal: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  detailMetaBtn: {
    width: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    opacity: 0.76,
  },
  detailMetaBtnLeading: {
    justifyContent: "flex-start",
    opacity: 1,
  },
  shareNudge: {
    position: "relative",
    minHeight: 72,
    marginHorizontal: 10,
    marginTop: 2,
    marginBottom: 8,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: withAlpha(c.accentBlue, 0.14),
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  shareNudgePointer: {
    position: "absolute",
    width: 16,
    height: 16,
    top: -7,
    right: 16,
    backgroundColor: withAlpha(c.accentBlue, 0.14),
    transform: [{ rotate: "45deg" }],
  },
  shareNudgeIcon: {
    width: 32,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  shareNudgeText: {
    flex: 1,
    color: c.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: F,
  },
  shareNudgeDismiss: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  shareNudgeDismissPressed: {
    backgroundColor: withAlpha(c.text, 0.08),
  },
  detailLikeHeart: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  detailLikeCountSlot: {
    position: "absolute",
    left: 32,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  detailMetaCount: {
    color: c.textSecondary,
    fontSize: 17,
    fontWeight: "700",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  detailMetaTime: {
    color: c.textTertiary,
    fontSize: 17,
    fontWeight: "700",
    fontFamily: F,
  },
  detailCreatedAt: {
    color: c.textTertiary,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
    // Match the social action row's horizontal gutter exactly.
    marginHorizontal: 10,
    marginTop: 8,
  },
  sheetHeroReturnRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  sheetHeroReturnText: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: F_DISPLAY,
  },
  sheetHeroReturnLabel: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  sheetHeroMain: {
    flex: 1,
    minWidth: 0,
  },
  sheetHeroThesis: {
    color: c.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    fontFamily: F,
    // Reads like a quote: left-aligned, full content width.
    textAlign: "left",
    alignSelf: "stretch",
  },
  heroThesisMore: {
    marginTop: 6,
    color: c.textSecondary,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: F,
  },
  sheetHeroName: {
    marginTop: 8,
    color: c.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
    fontFamily: F,
  },
  sheetHeroReturn: {
    width: 108,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    alignSelf: "stretch",
    paddingTop: 42,
  },
  sheetHeroSignalPercent: {
    marginTop: 2,
    width: 108,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "900",
    textAlign: "right",
    fontFamily: F,
    textShadowColor: "rgba(16, 34, 61, 0.08)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  sheetShareButton: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  thesisComposerModalBg: {
    backgroundColor: c.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  thesisComposerModalSurface: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: "hidden",
  },
  thesisComposerScroll: {
    flex: 1,
    backgroundColor: c.background,
  },
  thesisComposerScrollPreview: {
    backgroundColor: c.background,
  },
  thesisComposerScrollContent: {
    paddingHorizontal: 22,
    paddingTop: 2,
    paddingBottom: 36,
  },
  thesisComposerScrollContentPreview: {
    paddingTop: 16,
  },
  thesisComposerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
    paddingVertical: 4,
  },
  thesisComposerTitleBlock: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingRight: 4,
    minWidth: 0,
  },
  thesisComposerEmoji: {
    fontSize: 42,
    lineHeight: 50,
    marginTop: -2,
    textShadowColor: "rgba(16, 34, 61, 0.08)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  thesisComposerTitleTexts: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingTop: 2,
  },
  thesisComposerKicker: {
    color: c.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    fontFamily: F,
  },
  thesisComposerHeadline: {
    color: c.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "900",
    letterSpacing: -0.8,
    textTransform: "lowercase",
    fontFamily: F,
  },
  thesisComposerClosePill: {
    marginTop: 4,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  thesisComposerClosePressed: {
    backgroundColor: c.surfaceAlt,
    opacity: 0.94,
  },
  thesisComposerError: {
    marginBottom: 10,
    marginTop: 2,
    padding: 12,
    borderRadius: 14,
    backgroundColor: wash("#EB1C40", "#FFEFF1"),
    borderWidth: 1,
    borderColor: ink("#FFD2D9", withAlpha("#EB1C40", 0.4)),
  },
  thesisComposerErrorText: {
    color: ink("#EB1C40", "#FF5A70"),
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  // Shorter than the thesis prompt: a take is a sentence or two, and a tall box
  // invites an essay the feed card would only clamp.
  composerCommentaryWrap: {
    marginTop: 8,
    marginBottom: 4,
    minHeight: 88,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  composerCommentaryInput: {
    minHeight: 64,
    color: c.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "500",
    paddingVertical: 0,
    fontFamily: F,
  },
  composerCommentaryCount: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  composerCommentaryCountOver: {
    color: c.negative,
  },
  thesisComposerInputWrap: {
    marginTop: 10,
    minHeight: 176,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: c.border,
    borderStyle: "dashed",
    backgroundColor: c.background,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  thesisComposerInput: {
    minHeight: 148,
    color: c.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
    paddingVertical: 0,
    fontFamily: F,
  },
  thesisComposerCtaWrap: {
    borderRadius: CTA.radius,
    overflow: "hidden",
    alignSelf: "stretch",
  },
  thesisComposerCta: {
    minHeight: CTA.height,
    borderRadius: CTA.radius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
  },
  thesisComposerCtaSolid: {
    backgroundColor: c.actionPrimary,
  },
  thesisComposerCtaDisabled: {
    opacity: 0.42,
  },
  thesisComposerCtaLabel: {
    color: c.actionPrimaryText,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.2,
    fontFamily: F,
  },
  fixedBottomCtaContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: c.background,
    paddingHorizontal: CTA.inset,
    paddingTop: 8,
    paddingBottom: CTA.inset,
  },
  reviewHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 20,
  },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  reviewAvatarFallback: {
    backgroundColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewAvatarInitials: {
    fontSize: 14,
    fontWeight: "800",
    color: c.textSecondary,
    fontFamily: F,
  },
  reviewThesisBubble: {
    flex: 1,
    backgroundColor: c.border + "36",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  reviewThesisText: {
    fontSize: 14,
    lineHeight: 20,
    color: c.text,
    fontFamily: F,
  },
  composerPickerWrap: {
    gap: 14,
    marginTop: 8,
  },
  composerPickerCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
    padding: 22,
    gap: 8,
  },
  composerPickerCardSecondary: {
    backgroundColor: c.surfaceAlt,
    borderColor: c.border,
  },
  composerPickerCardPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  composerPickerEmoji: {
    fontSize: 30,
    marginBottom: 4,
  },
  composerPickerTitle: {
    color: c.text,
    fontFamily: F,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
    textTransform: "lowercase",
  },
  composerPickerBody: {
    color: c.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: F,
  },
  composerBackChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: c.surfaceAlt,
    marginBottom: 12,
    marginTop: 2,
  },
  composerBackChipLabel: {
    color: c.text,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: F,
    textTransform: "lowercase",
  },
  composerFieldLabel: {
    color: c.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    fontFamily: F,
    marginTop: 16,
    marginBottom: 6,
  },
  composerTextField: {
    backgroundColor: c.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: c.text,
    fontFamily: F,
    fontSize: 16,
    fontWeight: "700",
  },
  composerThesisWrap: {
    backgroundColor: c.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 110,
  },
  composerThesisField: {
    minHeight: 88,
    color: c.text,
    fontFamily: F,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  composerMetaRow: {
    flexDirection: "row",
    gap: 12,
  },
  composerMetaCol: {
    flex: 1,
  },
  composerOutlookRow: {
    flexDirection: "row",
    gap: 10,
  },
  composerOutlookChoice: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  composerOutlookChoicePressed: {
    opacity: 0.72,
    transform: [{ scale: 0.985 }],
  },
  composerOutlookIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  composerOutlookCopy: {
    flex: 1,
    minWidth: 0,
  },
  composerOutlookTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: "900",
    fontFamily: F,
  },
  composerOutlookBody: {
    marginTop: 2,
    color: c.textSecondary,
    fontSize: 11,
    fontWeight: "600",
    fontFamily: F,
  },
  composerLegsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 6,
  },
  composerRemixThesis: {
    marginTop: 8,
    gap: 12,
  },
  composerRemixSource: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    boxShadow: [{
      offsetX: 0,
      offsetY: 2,
      blurRadius: 10,
      color: withAlpha(c.shadow, 0.08),
    }],
  },
  composerRemixPostIdentity: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  composerRemixOrigin: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "500",
    fontFamily: F,
  },
  composerRemixSourceAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  composerRemixSourceAvatarFallback: {
    backgroundColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  composerRemixSourceInitial: {
    color: c.textSecondary,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: F,
  },
  composerRemixSourceSummary: {
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: F,
  },
  composerRemixLabel: {
    marginTop: 8,
    color: c.text,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: F,
  },
  composerRemixThesisInput: {
    color: c.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "500",
    fontFamily: F,
    minHeight: 112,
    paddingVertical: 0,
  },
  composerAllocationPct: {
    color: c.text,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  composerLegsHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  composerAssetChoices: {
    flexDirection: "row",
    gap: 10,
  },
  composerAssetChoice: {
    flex: 1,
    minHeight: 154,
    padding: 15,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
  },
  composerAssetChoicePerp: {
    backgroundColor: withAlpha(c.actionPrimary, 0.08),
    borderColor: withAlpha(c.actionPrimary, 0.22),
  },
  composerAssetChoicePressed: {
    opacity: 0.72,
    transform: [{ scale: 0.985 }],
  },
  composerAssetChoiceIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    backgroundColor: c.background,
  },
  composerAssetChoiceIconPerp: {
    backgroundColor: c.actionPrimary,
  },
  composerAssetChoiceTitle: {
    color: c.text,
    fontSize: 17,
    fontWeight: "900",
    fontFamily: F,
  },
  composerAssetChoiceBody: {
    marginTop: 5,
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    fontFamily: F,
  },
  composerEvenSplitBtn: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  composerEvenSplitLabel: {
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    fontFamily: F,
  },
  previewSummaryBubble: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: wash("#504F8A", "#EEEDFC"),
    borderRadius: 20,
    padding: 18,
    marginTop: 10,
    marginBottom: 16,
  },
  previewSummaryEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  previewSummaryText: {
    flex: 1,
    color: ink("#504F8A", "#b4b2e6"),
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    fontFamily: F,
  },
  previewChartSection: {
    marginTop: 16,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  previewLegsHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 14,
  },
  previewLegsCount: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: Fonts.mono,
  },
  previewLegsHint: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.mono,
  },
  previewLegRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: c.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.surfaceAlt,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  previewLegImage: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
  },
  previewLegImageFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  previewLegImageFallbackLabel: {
    color: c.background,
    fontSize: 16,
    fontWeight: "900",
    fontFamily: F,
  },
  previewLegTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  previewLegTitle: {
    flexShrink: 1,
    color: c.text,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: F,
  },
  previewLegSideChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  previewLegSideChipLong: {
    backgroundColor: wash("#22C55E", "#E6F9EC"),
  },
  previewLegSideChipShort: {
    backgroundColor: wash("#EB1C40", "#FFEFF1"),
  },
  previewLegSideLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    fontFamily: Fonts.sans,
  },
  previewLegSideLabelLong: {
    color: ink("#059669", "#4ade80"),
  },
  previewLegSideLabelShort: {
    color: ink("#EB1C40", "#EB1C40"),
  },
  previewLegSubtitle: {
    marginTop: 4,
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "500",
    fontFamily: Fonts.sans,
  },
  previewLegMetrics: {
    alignItems: "flex-end",
  },
  composerPreviewLegWeight: {
    color: c.actionPrimary,
    fontSize: 18,
    fontWeight: "800",
    fontFamily: F,
  },
  previewLegPrice: {
    marginTop: 4,
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "500",
    fontFamily: Fonts.sans,
  },
  composerLegsTotal: {
    color: c.text,
    fontFamily: F,
    fontSize: 13,
    fontWeight: "900",
  },
  composerLegsTotalWarn: {
    color: ink("#EB1C40", "#FF5A70"),
  },
  composerLegEmpty: {
    backgroundColor: c.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: "dashed",
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 4,
  },
  composerLegEmptyText: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    fontFamily: F,
  },
  composerLegRow: {
    backgroundColor: c.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    marginBottom: 8,
  },
  composerLegHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  composerLegImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.surfaceAlt,
  },
  composerLegImageFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  composerLegImageFallbackLabel: {
    color: c.text,
    fontSize: 12,
    fontWeight: "900",
    fontFamily: F,
  },
  composerLegInfo: {
    flex: 1,
    minWidth: 0,
  },
  composerLegTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: "900",
    fontFamily: F,
  },
  composerLegSubtitle: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  composerLegRemove: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  composerAddLeg: {
    marginTop: 2,
    marginBottom: 4,
    minHeight: 44,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: c.background,
  },
  composerAddLegLabel: {
    color: c.textSecondary,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: F,
  },
  composerSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
  },

  // ── Inline cashtag autocomplete ("$AAPL" while typing) ──
  cashtagCard: {
    marginTop: 12,
    alignSelf: "flex-start",
    width: 220,
    borderRadius: 16,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  cashtagMatchLabel: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
    letterSpacing: 0.4,
  },
  cashtagSectionLabel: {
    color: c.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: F,
    letterSpacing: 0.4,
    marginTop: -2,
  },
  cashtagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  cashtagRowLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cashtagRowLogoLetter: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    fontFamily: F,
  },
  cashtagRowInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cashtagRowName: {
    color: c.text,
    fontSize: 17,
    fontWeight: "800",
    fontFamily: F,
  },
  cashtagRowSymbol: {
    color: c.actionPrimary,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  composerSearchInput: {
    flex: 1,
    color: c.text,
    fontFamily: F,
    fontSize: 15,
    fontWeight: "700",
    paddingVertical: 0,
  },
  composerLoading: {
    paddingVertical: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  composerEmptyHint: {
    color: c.textSecondary,
    fontSize: 13,
    fontFamily: F,
    fontWeight: "700",
    paddingVertical: 16,
    textAlign: "center",
  },
  composerPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.surfaceAlt,
  },
  composerPickerRowImage: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: c.surfaceAlt,
  },
  composerPickerRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  composerPickerRowTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: "900",
    fontFamily: F,
  },
  composerPickerRowSubtitle: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  composerAnswerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 3,
    marginBottom: 1,
  },
  composerAnswerLabel: {
    color: ink("#0834F4", "#7c93ff"),
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
    fontFamily: F,
    backgroundColor: wash("#0834F4", "#E8EDFF"),
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: "hidden",
  },
  composerAnswerText: {
    flex: 1,
    minWidth: 0,
    color: c.text,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  composerPickerRowMeta: {
    color: c.text,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  composerMarketRow: {
    backgroundColor: c.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.surfaceAlt,
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  composerMarketActions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  pickerUsageHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: c.backgroundAlt,
    alignSelf: "center",
  },
  pickerUsageLabel: {
    color: c.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: F,
  },
  pickerUsageValue: {
    color: c.text,
    fontSize: 13,
    fontWeight: "900",
    fontFamily: F,
  },
  pickerUsageDot: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "900",
  },
  pickerWeightCandidate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    marginTop: 4,
  },
  pickerWeightImage: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: c.surfaceAlt,
  },
  pickerWeightInfo: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  pickerWeightTitle: {
    color: c.text,
    fontFamily: F,
    fontSize: 16,
    fontWeight: "900",
  },
  pickerWeightSubtitle: {
    color: c.textSecondary,
    fontFamily: F,
    fontSize: 13,
    fontWeight: "700",
  },
  pickerWeightInputWrap: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: c.background,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: c.text,
  },
  pickerWeightInputWrapWarn: {
    borderColor: ink("#FFD2D9", withAlpha("#EB1C40", 0.4)),
  },
  pickerWeightInputBig: {
    color: c.text,
    fontFamily: F,
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: -1.2,
    paddingVertical: 0,
    minWidth: 80,
    textAlign: "right",
  },
  pickerWeightInputSuffix: {
    color: c.text,
    fontFamily: F,
    fontSize: 36,
    fontWeight: "900",
    marginLeft: 4,
  },
  pickerWeightWarn: {
    marginTop: 8,
    color: ink("#EB1C40", "#FF5A70"),
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
    textAlign: "center",
  },
  pickerChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
    marginBottom: 22,
    justifyContent: "center",
  },
  pickerChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
  },
  pickerChipLabel: {
    color: c.text,
    fontFamily: F,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "lowercase",
  },
  buySheetBackground: {
    backgroundColor: c.background,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
  },
  buySheetSurface: {
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    overflow: "hidden",
  },
  buySheetScroll: {
    flex: 1,
    backgroundColor: c.background,
  },
  buySheetContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  buyBackButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 4,
    paddingRight: 12,
    marginBottom: 2,
  },
  buyBackText: {
    color: c.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "700",
    fontFamily: F,
  },
  buyPaymentTitle: {
    color: c.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0,
    fontFamily: F,
  },
  buyAmountDisplay: {
    minHeight: 68,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 6,
  },
  buyCurrencySign: {
    color: c.textTertiary,
    fontSize: 32,
    lineHeight: 42,
    fontWeight: "800",
    fontFamily: F,
  },
  buyAmountValue: {
    color: c.text,
    fontSize: 56,
    lineHeight: 66,
    fontWeight: "900",
    letterSpacing: 0,
    includeFontPadding: false,
    fontFamily: F,
  },
  buyPresetRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 6,
  },
  buyPresetPill: {
    flex: 1,
    maxWidth: 82,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.backgroundAlt,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  buyPresetPillActive: {
    backgroundColor: c.text,
  },
  buyPresetText: {
    color: c.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: F,
  },
  buyPresetTextActive: {
    color: c.background,
  },
  buyDialpad: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 280,
    marginTop: 14,
    gap: 8,
  },
  buyDialRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  buyDialKey: {
    flex: 1,
    maxWidth: 72,
    height: 52,
    borderRadius: 16,
    backgroundColor: c.backgroundAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  buyDialKeyPressed: {
    backgroundColor: c.surfaceAlt,
    transform: [{ scale: 0.98 }],
  },
  buyDialKeyText: {
    color: c.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "800",
    fontFamily: F,
  },
  detailCreatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  detailCreatorMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  detailCreatorName: {
    color: c.text,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: F,
    flexShrink: 1,
  },
  detailFollowBtn: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#0e2aa8",
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  detailFollowBtnGradient: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  detailFollowBtnText: {
    color: c.background,
    fontSize: 15,
    fontWeight: "900",
    fontFamily: F,
    letterSpacing: 0.2,
  },
  detailThesisText: {
    color: c.text,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: F,
    marginTop: 14,
  },
  detailActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 14,
    marginBottom: 4,
  },
  detailActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 4,
  },
  detailActionBtnText: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  detailActionBtnTextLiked: {
    color: c.negative,
  },
  detailTimestamp: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: F,
  },
  detailReturnRow: {
    alignItems: "flex-end",
    marginTop: 2,
    marginBottom: 4,
    paddingRight: 10,
  },
  detailReturnText: {
    fontSize: 48,
    lineHeight: 54,
    fontWeight: "900",
    fontFamily: F_DISPLAY,
  },
  detailLegsSection: {
    marginTop: 6,
    gap: 2,
  },
  buyButtonWrap: {
    borderRadius: CTA.radius,
    overflow: "hidden",
  },
  positionActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  positionActionButton: {
    flex: 1,
    minWidth: 0,
  },
  // Buy more / Sell use the shared CTA pill size and label (side-glass-button).
  positionActionFill: {
    minHeight: CTA_BUTTON_HEIGHT,
  },
  positionActionButtonText: {
    fontSize: CTA_LABEL_SIZE,
    lineHeight: CTA_LABEL_SIZE + 4,
    fontFamily: CTA_LABEL_FONT,
    letterSpacing: 0.5,
  },
  buyMoreButtonText: {
    color: "#FFFFFF",
  },
  sellButtonText: {
    color: "#FFFFFF",
  },
  buyButton: {
    minHeight: CTA_BUTTON_HEIGHT,
    borderRadius: CTA.radius,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  floatingBuyWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // Same margin as the bar's bottom padding (set at the call site), so the
    // BUY pill's corners run parallel to the display's own.
    paddingHorizontal: CTA.inset,
    paddingTop: 14,
    backgroundColor: "transparent",
  },
  buySheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    // Deliberately light: the pad above it is glass, and a heavier dim would
    // leave the material nothing worth refracting.
    backgroundColor: "rgba(15, 23, 42, 0.10)",
  },
  legCardBackdrop: {
    // The blur supplies the separation; retain only a very light tint so the
    // selected asset remains the focus without making the page feel disabled.
    backgroundColor: "transparent",
  },
  legCardDarkScrim: {
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  // The leg card hero. Every geometry value (left/top/width/height/radius) is
  // supplied by the animated style, interpolating from the tapped row's
  // measured rect to the opened card — so this only carries what doesn't
  // animate. overflow:hidden is what makes the growth read as a reveal: the
  // full-size content is clipped by the expanding frame.
  legCardHero: {
    position: "absolute",
    // left/top/width/height come from the resting rect and are STATIC — the
    // animated style only moves and scales this with transforms, so none of
    // them change per frame.
    zIndex: 30,
    overflow: "hidden",
    // Scale grows the card down and right from its top-left, which is what lets
    // translate alone put that corner exactly on the tapped row's corner.
    transformOrigin: "top left",
    // Constant, not interpolated: under a non-uniform scale an animated radius
    // renders as a visibly lopsided ellipse during the morph.
    borderRadius: 26,
    backgroundColor: c.background,
    shadowColor: c.text,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
  },
  legCardHeroContent: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  buySheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    marginTop: 10,
    marginBottom: 4,
  },
  buyButtonText: {
    color: "#FFFFFF",
    fontSize: CTA_LABEL_SIZE,
    lineHeight: CTA_LABEL_SIZE + 4,
    fontFamily: CTA_LABEL_FONT,
    letterSpacing: 1,
  },
  buyMessageText: {
    marginTop: 12,
    marginBottom: 12,
    color: c.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
    fontFamily: F,
  },
  toastWrap: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    zIndex: 90,
    alignItems: "center",
  },
  toastPill: {
    maxWidth: "100%",
    minHeight: 38,
    borderRadius: 19,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: c.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 12,
  },
  toastText: {
    fontSize: 13,
    fontWeight: "900",
    fontFamily: F,
  },
  sectionCard: {
    backgroundColor: c.backgroundAlt,
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
  },
  detailSection: {
    marginTop: 6,
  },
  detailChartSection: {
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  // Timeframe pills under the chart (24H / 1W / 1M / 3M).
  chartRangeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 22,
    marginTop: 10,
    position: "relative",
  },
  chartRangePill: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  chartRangePillText: {
    fontSize: 14,
    fontWeight: "700",
    color: c.textTertiary,
    fontFamily: F,
  },
  chartRangePillTextActive: {
    color: c.text,
    fontSize: 15,
    fontWeight: "900",
  },
  searchBarInner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.backgroundAlt,
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 40,
    gap: 6,
    overflow: "hidden",
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    color: c.text,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: F,
    paddingVertical: 0,
  },
  searchClearBtn: {
    padding: 2,
  },
  searchOverlay: {
    position: "absolute",
    top: 58,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.background,
    zIndex: 50,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  searchCenter: {
    paddingTop: 40,
    alignItems: "center",
  },
  searchEmptyText: {
    color: c.textTertiary,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: F,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.backgroundAlt,
  },
  searchAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.surfaceAlt,
  },
  searchAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
  searchAvatarLetter: {
    color: c.background,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: F,
  },
  searchRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  searchRowName: {
    color: c.text,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: F,
  },
  searchRowSub: {
    marginTop: 2,
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "600",
    fontFamily: F,
  },
  searchYouPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: c.backgroundAlt,
    minWidth: 80,
    alignItems: "center",
  },
  searchYouPillText: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
});
};
