import { useEmbeddedSolanaWallet, usePrivy } from "@privy-io/expo";
import {
  CrossmintProvider,
  CrossmintEmbeddedCheckout,
} from "@crossmint/client-sdk-react-native-ui";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Buffer } from "buffer";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  Image,
  InteractionManager,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { stashPodcastCall } from "@/lib/podcast-call-handoff";

import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadErrorState } from "@/components/load-error-state";
import { ValueSkeleton } from "@/components/value-skeleton";
import { VerifiedBadge } from "@/components/verified-badge";
import { DepositSheet, type DepositSheetRef } from "@/components/deposit-sheet";
import { WithdrawSheet, type WithdrawSheetRef } from "@/components/withdraw-sheet";
import { settleJupUsdToCash, signAndSendBase64WithResult } from "@/lib/cash";
import { useCash } from "@/hooks/use-cash";
import { PnlChart } from "@/components/portfolio-value-chart";
import { type TakeComposerTarget } from "@/lib/position-takes";
import { useStockDetail } from "@/lib/stock-detail-store";
import { AssetLogo } from "@/components/asset-logo";
import { ClosedPositionRow } from "@/components/closed-position-row";
import {
  PositionDetailSheet,
  type FocusedPositionData,
  type PositionDetailSheetRef,
} from "@/components/position-detail-sheet";
import { publicClosedPositionDetail } from "@/lib/public-position-detail";
import {
  PositionShareSheet,
  type PositionShareSheetRef,
} from "@/components/position-share-sheet";
import { IosSegmentedControl } from "@/components/ios-segmented-control";
import { TradeAmountSheet, type TradeAmountSheetRef } from "@/components/trade-amount-sheet";
import {
  PodcastHoldingMomentModal,
  type PodcastHoldingMomentModalData,
} from "@/components/podcast-holding-moment-modal";

import { cleanStockName } from "@/lib/stock-name";
import { equityLogoFallbackUris, perpLogoSources } from "@/lib/stock-logos";
import { shortAddress } from "@/lib/privy";
import { syncUser } from "@/lib/user-sync";
import {
  appUserPayloadFromPrivyUser,
  createCrossmintOrder,
  createJupiterOrder,
  closePredictionPosition,
  submitPredictionTransaction,
  linkCrossmintWallet,
  executeJupiterOrder,
  getPerpsPositions,
  getClosedPositions,
  getClosedPositionDetail,
  getOpenSandwichPositionDetail,
  getPerpSandwichPositions,
  getHeldSandwichProvenance,
  getSandwichById,
  getSandwichShareUrl,
  type SandwichProvenance,
  getSandwiches,
  humanizeErrorMessage,
  setCardLike,
  getUserProfile,
  getUserCreatedSandwiches,
  getUserPortfolio,
  getUserPnlHistory,
  searchJupiterToken,
  isAlreadyExitedError,
  startSandwichSell,
  type BasketBuyStart,
  startPerpSandwichClose,
  settlePerpSandwichRun,
  buildPhoenixWithdrawAll,
  startPerpSandwichWithdrawAll,
  getSandwichTakes,
  getUserTakes,
  startSandwichBasketBuy,
  submitSignedBasketBuy,
  type CrossmintOrder,
  type PerpsPosition,
  type PerpSandwichPosition,
  type ClosedPosition,
  type PnlHistory,
  type PortfolioRange,
  type PositionTake,
  type Sandwich,
  type SocialUser,
  type Stock,
  type WalletBalanceToken,
} from '@/lib/api';
import { PodcastGroupCard, SandwichCard, TakePostCard } from '@/components/sandwich-card';
import { buildFeedItems } from '@/lib/sandwich-feed';
import {
  SandwichShareSheet,
  type SandwichShareSheetRef,
} from '@/components/sandwich-share-sheet';
import { useSandwichDetail } from '@/lib/sandwich-detail-store';
import type { PodcastGroupVideo } from '@/components/podcast-sandwich-group-card';
import { usePodcastGroup } from '@/lib/podcast-group-store';
import { cardSocial, toggledCardSocial, withCardSocial } from '@/lib/card-social';
import { getAnonymousSocialId } from '@/lib/social-identity';
import { SocialScreen } from '@/screens/social-screen';
import { UserProfileScreen } from '@/screens/user-profile-screen';
import { CreateCuratedSandwichScreen } from '@/screens/create-curated-sandwich-screen';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { withAlpha } from "@/lib/color-utils";
import {
  getStoredSandwichPositions,
  recordSandwichPositionBuy,
  recordSandwichPositionSell,
  removeStoredSandwichPosition,
  seedFromBackend,
  type SandwichPosition,
} from "@/lib/sandwich-positions";
import {
  isPositiveSmallestUnitAmount,
  isValidDisplayAmount,
  toSmallestUnits,
} from "@/lib/trading";
import { computeUnrealizedPnl } from "@/lib/cost-basis";
import {
  formatPnlPercentage,
  formatSignedPnlPercentage,
  pnlPercentageFromBasis,
} from "@/lib/pnl-percentage";
import { valueSandwichPosition } from "@/lib/sandwich-holding-value";
import { hasLivePerpSandwichExposure } from "@/lib/perp-sandwich-visibility";
import {
  formatTimestamp,
  perpSandwichContext,
  phoenixPositionFromPerpSandwich,
  type PerpSandwichContext,
} from "@/lib/perp-sandwich-display";
import { momentCaption } from "@/lib/moment";
import { sandwichHoldingRoute } from "@/lib/sandwich-provenance";
import {
  DUST_USD as HOLDINGS_DUST_USD,
  selectHoldings,
} from "@/lib/holdings";
import { useWalletStore } from "@/lib/wallet-store";
import { useTradeFx } from "@/lib/trade-fx";
import { useThemeStore } from "@/lib/theme-store";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import {
  confirmPhoenixClose,
  getPhoenixAccount,
  type PhoenixAccountResponse,
  type PhoenixPosition,
} from "@/lib/phoenix-api";
import { formatLeverage } from "@/lib/phoenix-position-leverage";
import { takePhoenixCloseBuild } from "@/lib/phoenix-prebuild";
import { usePhoenixPositionSheet } from "@/lib/phoenix-position-sheet-store";
import {
  HyperliquidPositionSheet,
  hyperliquidDisplaySymbol,
  type HyperliquidPositionSheetRef,
} from "@/components/hyperliquid-position-sheet";
import { getHyperliquidAccount, type HyperliquidPosition } from "@/lib/hyperliquid-api";
import { PERPS_VENUE } from "@/lib/perps-venue";
import {
  PhoenixAccountSheet,
  SETTLE_REFRESH_MS,
  type PhoenixAccountSheetRef,
} from "@/components/phoenix-account-sheet";
import { PressableScale } from '@/components/pressable-scale';
import {
  HOLDINGS_CATEGORY_LABELS,
  HoldingsCategorySwitch,
  type HoldingsCategoryFilter,
  type HoldingsCategoryKey,
} from "@/components/holdings-category-switch";
import {
  SandwichHoldingCard,
  closedSandwichProvenance,
  getSandwichCreatorMeta,
  positionDetailProvenance,
  type SandwichCreatorMeta,
  type SandwichHoldingRow,
} from "@/components/sandwich-holding-card";

const F = Fonts.rounded;

// Realized P&L graph (own profile) — mirrors the other-user profile screen.
const PORTFOLIO_RANGES: PortfolioRange[] = ["24H", "7d", "30d"];
const PORTFOLIO_UP = "#02ED45";
const PORTFOLIO_DOWN = "#D2042D";

// Hide dust holdings: anything under this USD value rounds to "$0.00" and reads
// as a placeholder row, so we drop it from the Holdings list entirely.
const DUST_USD = HOLDINGS_DUST_USD;

// How long a focus-triggered refresh may reuse the last on-chain read. Balances
// move only when the user trades or receives funds — and both of those paths
// force an unconditional read — so a short window here costs nothing in
// freshness while removing a full RPC fan-out from every tab switch.
const BALANCE_FRESH_MS = 15_000;
/** Cost basis walks on-chain history, and only a trade can change it. */
const COST_BASIS_FRESH_MS = 60_000;

/** Solana mainnet USDC mint — used when API rows omit symbol text. */
const USDC_MAINNET_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const COMPANY_NAME_OVERRIDES: Record<string, string> = {
  TSLA: "Tesla",
  AAPL: "Apple",
  AMZN: "Amazon",
  GOOGL: "Google",
  GOOG: "Google",
  META: "Meta",
  MSFT: "Microsoft",
  NVDA: "Nvidia",
};

function cleanStockSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.endsWith("X") && normalized.length > 4) {
    return normalized.slice(0, -1);
  }
  return normalized.replace(/ON$/i, "") || symbol;
}



type ToastState = {
  text: string;
  tone: "processing" | "success" | "error";
} | null;

type PodcastHoldingMomentState = PodcastHoldingMomentModalData & {
  row: SandwichHoldingRow;
};

function getProfileImageUrl(linkedAccounts: { type: string }[]): string | null {
  for (const account of linkedAccounts) {
    const record = account as Record<string, unknown>;
    const directUrl =
      record.profile_picture_url ??
      record.profileImageUrl ??
      record.picture ??
      record.avatar_url ??
      record.profile_image_url;

    if (typeof directUrl === "string" && directUrl.length > 0) {
      return directUrl;
    }

    const profile =
      typeof record.profile === "object" && record.profile !== null
        ? (record.profile as Record<string, unknown>)
        : null;

    const profileUrl =
      profile?.picture ??
      profile?.avatar_url ??
      profile?.profile_image_url ??
      profile?.profilePicture;

    if (typeof profileUrl === "string" && profileUrl.length > 0) {
      return profileUrl;
    }
  }

  return null;
}

function getXUsername(linkedAccounts: { type: string }[]): string | null {
  for (const account of linkedAccounts) {
    if (account.type !== "twitter_oauth") {
      continue;
    }

    const record = account as Record<string, unknown>;
    const directUsername =
      record.username ?? record.screen_name ?? record.preferred_username;

    if (typeof directUsername === "string" && directUsername.length > 0) {
      return directUsername.replace(/^@+/, "");
    }

    const profile =
      typeof record.profile === "object" && record.profile !== null
        ? (record.profile as Record<string, unknown>)
        : null;

    const profileUsername =
      profile?.username ?? profile?.screen_name ?? profile?.preferred_username;

    if (typeof profileUsername === "string" && profileUsername.length > 0) {
      return profileUsername.replace(/^@+/, "");
    }
  }

  return null;
}

/**
 * Realized PnL of the slice of a Sandwich just sold — what it is worth now
 * minus what it cost, scaled by the fraction sold.
 *
 * Null whenever either half is unknown: positions recorded before cost basis
 * existed carry no `investedUsd`, and the current value is only known when the
 * holdings row for this position is in hand. The sell burst then plays with no
 * figure rather than announcing a fabricated $0.00.
 */
function sandwichRealizedPnl(
  position: SandwichPosition,
  fraction: number,
  currentValueUsd: number | null,
): number | null {
  const invested = position.investedUsd;
  if (invested === null || invested === undefined) return null;
  if (currentValueUsd === null || !Number.isFinite(currentValueUsd)) return null;
  return (currentValueUsd - invested) * fraction;
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}


/** The two halves of Holdings: live exposure, and what it settled at. */
const HOLDINGS_VIEWS = ["Open", "Closed"] as const;


/**
 * Which drawer a settled position belongs in.
 *
 * Deliberately the same three drawers the open list uses — a Sandwich the user
 * closed should sit where that Sandwich sat, so the toggle changes the contents
 * of the list rather than reorganising it. Standalone perps join the perp
 * drawer for the same reason: on the open side they already share it.
 */
function closedCategory(position: ClosedPosition): HoldingsCategoryKey {
  if (position.kind === "token") return "tokens";
  if (position.kind === "phoenix_perp" || position.kind === "sandwich_perp") return "perps";
  return "sandwiches";
}

/**
 * The Closed half of Holdings.
 *
 * Reuses the open list's category drawers and skeletons rather than inventing a
 * second visual language for the same portfolio.
 */
function ClosedHoldingsList({
  positions,
  loading,
  error,
  hasMore,
  category,
  onRetry,
  onSelect,
  renderSkeletons,
  styles,
}: {
  positions: ClosedPosition[] | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  category: HoldingsCategoryFilter;
  onRetry: () => void;
  onSelect: (position: ClosedPosition) => void;
  renderSkeletons: (count: number, label: string) => React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  // Never seen a response yet — not the same as an empty history, which is a
  // real answer and gets its own copy below.
  if (positions === null) {
    return error ? (
      <LoadErrorState
        size="section"
        title="Couldn't load history"
        onRetry={() => {
          void Haptics.selectionAsync();
          onRetry();
        }}
      />
    ) : (
      <>{renderSkeletons(4, "Loading closed positions")}</>
    );
  }

  if (positions.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>🧾</Text>
        <Text style={styles.emptyText}>No closed positions yet</Text>
      </View>
    );
  }

  const categoryRows =
    category === "all"
      ? (["sandwiches", "tokens", "perps"] as const).flatMap((key) =>
          positions.filter((position) => closedCategory(position) === key),
        )
      : positions.filter((position) => closedCategory(position) === category);

  if (categoryRows.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>🧾</Text>
        <Text style={styles.emptyText}>
          No closed {HOLDINGS_CATEGORY_LABELS[category].toLowerCase()}
        </Text>
      </View>
    );
  }

  return (
    <>
      {/* One compact list row per settled position, sandwiches included:
          title, then when it closed underneath, realized P&L on the right. */}
      {categoryRows.map((position) => (
        <ClosedPositionRow
          key={position.id}
          position={position}
          onPress={() => onSelect(position)}
        />
      ))}

      {/* Older pages arrive by scrolling, not by pressing anything — see
          `handleHoldingsScroll`. One placeholder row is the whole affordance:
          it occupies the space the next rows are about to fill, so the list
          grows instead of jumping. */}
      {hasMore && loading ? <>{renderSkeletons(1, "Loading more")}</> : null}
    </>
  );
}



function formatJoinedDate(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function amountToDisplayString(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return value
    .toFixed(Math.max(0, decimals))
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

function tapAmountKey(current: string, key: string) {
  if (key === "del") {
    return current.length <= 1 ? "0" : current.slice(0, -1);
  }

  if (key === ".") {
    return current.includes(".") ? current : `${current || "0"}.`;
  }

  if (current === "0") return key;
  return `${current}${key}`;
}

function TopToast({ toast }: { toast: ToastState }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  if (!toast) return null;

  const color =
    toast.tone === "success"
      ? "#137a3a"
      : toast.tone === "error"
        ? colors.negative
        : colors.icon;
  const icon =
    toast.tone === "success"
      ? "checkmark-circle"
      : toast.tone === "error"
        ? "alert-circle"
        : "time";

  return (
    <View pointerEvents="none" style={styles.toastWrap}>
      <View style={styles.toastPill}>
        <Ionicons name={icon} size={16} color={color} />
        <Text numberOfLines={1} style={[styles.toastText, { color }]}>
          {toast.text}
        </Text>
      </View>
    </View>
  );
}

function getErrorMessage(error: unknown): string {
  return humanizeErrorMessage(error, "Request failed. Please try again.");
}

/**
 * A sandwich leg's current USD value. Uses the live on-chain price when we have
 * a positive one, otherwise falls back to the leg's invested cost basis (treated
 * as flat). This single rule is used both to total a sandwich's value and to
 * render each leg in the detail sheet, so the header is always exactly the sum
 * of the leg rows — no clamp-to-cost or proportional extrapolation, both of
 * which hid real losses and made the two disagree.
 */
function deserializeTransaction(
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
): string {
  const bytes =
    transaction instanceof VersionedTransaction
      ? transaction.serialize()
      : transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });

  return Buffer.from(bytes).toString("base64");
}

export function ProfileScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const { user } = usePrivy();
  const solanaWallet = useEmbeddedSolanaWallet();

  const wallet = solanaWallet.wallets?.[0] ?? null;
  const [appUsername, setAppUsername] = useState<string | null>(null);
  /** The server has answered about this user at least once, with or without a username. */
  const [profileResolved, setProfileResolved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [createCuratedOpen, setCreateCuratedOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const walletStore = useWalletStore();
  const balanceTokens = walletStore.tokens;
  const balanceLoading = walletStore.loading;
  const balanceHasLoaded = walletStore.hasLoaded;
  const balanceError = walletStore.error;
  const tokenByMint = useMemo(
    () =>
      new Map(
        balanceTokens
          .filter((token) => token.mint)
          .map((token) => [token.mint as string, token]),
      ),
    [balanceTokens],
  );
  // Balances loaded cleanly, so a mint absent from them is genuinely not held.
  // A failed or in-flight read leaves this false and every valuation keeps its
  // cost-basis fallback — the wallet store's own rule, see `hasLoaded` and the
  // never-show-$0.00 handling built around it.
  //
  // Declared up here beside the balances rather than next to the row builder
  // that consumes it, because the portfolio sync needs it too and runs earlier.
  const balancesKnown = balanceHasLoaded && !balanceError;

  const [sandwichPositions, setSandwichPositions] = useState<SandwichPosition[] | null>(null);
  // A wallet refresh can briefly retain pre-settlement token balances after a
  // full exit. Keep those sandwiches out of catalog recovery for this screen
  // session; a successful re-buy removes the tombstone immediately.
  const deliberatelyClosedSandwichIds = useRef(new Set<string>());

  /**
   * Stored positions the wallet still backs.
   *
   * Null while balances are unknown, which means "do not prune" — every caller
   * falls back to the unfiltered list rather than treating an unread wallet as
   * an empty one.
   */
  const backedSandwichPositions = useMemo(() => {
    if (!balancesKnown || !sandwichPositions) return null;
    return sandwichPositions.filter((position) =>
      position.legs.some((leg) => (tokenByMint.get(leg.mint)?.balance ?? 0) > 0),
    );
  }, [balancesKnown, sandwichPositions, tokenByMint]);

  /** Stable identity for the above — see the note on the sync effect. */
  const backedSandwichKey = useMemo(
    () => (backedSandwichPositions ?? []).map((position) => position.sandwichId).sort().join(","),
    [backedSandwichPositions],
  );

  const [recoverySandwiches, setRecoverySandwiches] = useState<Sandwich[]>([]);
  const [sandwichCreators, setSandwichCreators] = useState<
    Record<string, SandwichCreatorMeta>
  >({});
  const [holdingSandwiches, setHoldingSandwiches] = useState<
    Record<string, Sandwich>
  >({});
  // Where each held sandwich came from: the moment's headline, its offset into
  // the episode, and the card to open. Keyed by sandwichId.
  const [sandwichProvenance, setSandwichProvenance] = useState<
    Record<string, SandwichProvenance>
  >({});
  const [portfolioRefreshKey, setPortfolioRefreshKey] = useState(0);
  const [sandwichRefreshKey, setSandwichRefreshKey] = useState(0);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [refreshArmed, setRefreshArmed] = useState(false);
  const [crossmintOrder, setCrossmintOrder] = useState<CrossmintOrder | null>(
    null,
  );
  const [crossmintEmail, setCrossmintEmail] = useState("");
  const [crossmintAmount, setCrossmintAmount] = useState("");
  const depositSheetRef = useRef<DepositSheetRef>(null);
  const withdrawSheetRef = useRef<WithdrawSheetRef>(null);
  const cash = useCash();
  const [perpsPositions, setPerpsPositions] = useState<PerpsPosition[]>([]);
  const [perpsLoading, setPerpsLoading] = useState(false);
  const [perpSandwichPositions, setPerpSandwichPositions] = useState<PerpSandwichPosition[]>([]);
  const [perpSandwichLoading, setPerpSandwichLoading] = useState(false);
  const [selectedPerpSandwich, setSelectedPerpSandwich] = useState<PerpSandwichPosition | null>(null);
  const [perpSandwichActionId, setPerpSandwichActionId] = useState<string | null>(null);
  const [phoenixAccount, setPhoenixAccount] = useState<PhoenixAccountResponse | null>(null);
  // Hyperliquid positions, when this build trades perps there. Last good read
  // is kept on a failed refresh, same as Phoenix's.
  const [hyperliquidPositions, setHyperliquidPositions] = useState<HyperliquidPosition[]>([]);
  const hyperliquidPositionSheetRef = useRef<HyperliquidPositionSheetRef>(null);
  const [phoenixLoading, setPhoenixLoading] = useState(false);
  const [closingPhoenixSymbol, setClosingPhoenixSymbol] = useState<string | null>(null);
  const positionSheet = usePhoenixPositionSheet();
  // Latest-render handlers for the native position sheet route, which outlives
  // the render that opened it.
  const positionSheetHandlersRef = useRef({
    onUpdated: () => {},
    onRequestClosePosition: (
      _target: PhoenixPosition,
      _options: { fraction: number; returnToCash: boolean; exitPrice: number | null },
    ) => {},
  });
  const openPositionSheet = useCallback(
    (
      position: PhoenixPosition,
      options?: { autoClose?: boolean; context?: PerpSandwichContext | null },
    ) => {
      positionSheet.open(position, {
        ...options,
        onUpdated: () => positionSheetHandlersRef.current.onUpdated(),
        onRequestClosePosition: (target, closeOptions) =>
          positionSheetHandlersRef.current.onRequestClosePosition(target, closeOptions),
      });
    },
    [positionSheet],
  );
  /**
   * The perp Sandwich currently shown in the shared position sheet, if any.
   *
   * The sheet renders standalone Phoenix positions and Sandwich legs through the
   * same `PhoenixPosition` shape, which by design carries no hint of where it
   * came from — so this is what tells the CLOSE handler which exit path to take.
   */
  const perpSandwichSheetPositionRef = useRef<PerpSandwichPosition | null>(null);
  const phoenixAccountSheetRef = useRef<PhoenixAccountSheetRef>(null);
  const [sandwichMessage, setSandwichMessage] = useState<string | null>(null);
  const [selectedSandwichRow, setSelectedSandwichRow] =
    useState<SandwichHoldingRow | null>(null);
  const [podcastHoldingMoment, setPodcastHoldingMoment] =
    useState<PodcastHoldingMomentState | null>(null);
  const positionDetailSheetRef = useRef<PositionDetailSheetRef>(null);
  const [focusedPosition, setFocusedPosition] =
    useState<FocusedPositionData | null>(null);
  const { open: openStockRoute } = useStockDetail();
  const sandwichTradeSheetRef = useRef<TradeAmountSheetRef>(null);
  const positionShareSheetRef = useRef<PositionShareSheetRef>(null);

  /**
   * A sell build started while the finger was still down, and the exact exit it
   * was built for. A build is single-use and only valid for its own fraction,
   * so it is consumed on the tap and discarded whenever the amount changes.
   */
  const warmedSellRef = useRef<{
    key: string;
    started: Promise<BasketBuyStart>;
  } | null>(null);
  /** A swap-only top-up build started before the user confirms. */
  const warmedBuyRef = useRef<{
    key: string;
    started: Promise<BasketBuyStart>;
  } | null>(null);

  const [sandwichTradeSide, setSandwichTradeSide] = useState<
    "buy" | "sell" | null
  >(null);
  const [sandwichTradeAmount, setSandwichTradeAmount] = useState("5");
  const [sandwichTrading, setSandwichTrading] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [profileTab, setProfileTab] = useState<"holdings" | "posts">(
    "holdings",
  );
  /** Takes (§8.3), shown inline in Posts. Null until first read — "loading", not "none". */
  const [myTakes, setMyTakes] = useState<PositionTake[] | null>(null);
  // Open exposure vs settled history. Two different questions about the same
  // portfolio, so they share the Holdings tab rather than living apart: "what am
  // I in" and "how did I do".
  const [holdingsView, setHoldingsView] = useState<"Open" | "Closed">("Open");
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[] | null>(
    null,
  );
  const [closedCursor, setClosedCursor] = useState<string | null>(null);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedError, setClosedError] = useState<string | null>(null);
  // One category at a time keeps unlike position types visually separate.
  const [holdingsCategory, setHoldingsCategory] =
    useState<HoldingsCategoryFilter>("all");
  const changeHoldingsCategory = useCallback((category: HoldingsCategoryFilter) => {
    void Haptics.selectionAsync();
    setHoldingsCategory(category);
  }, []);
  // Sandwiches this user has created, shown as feed-style posts on the Posts tab.
  const [myPosts, setMyPosts] = useState<Sandwich[] | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const sandwichDetail = useSandwichDetail();
  const podcastGroup = usePodcastGroup();
  const postShareSheetRef = useRef<SandwichShareSheetRef>(null);
  const [pnlHistory, setPnlHistory] = useState<PnlHistory | null>(null);
  const [pnlHistoryLoading, setPnlHistoryLoading] = useState(false);
  // Portfolio value at the start of the selected range — the capital the P&L
  // is measured against, so the figure under the P&L can be a return rather
  // than the same dollars printed twice.
  const [pnlBasisUsd, setPnlBasisUsd] = useState<number | null>(null);
  const [portfolioRange, setPortfolioRange] = useState<PortfolioRange>("7d");
  // The point under the user's finger while scrubbing the chart; null when idle.
  const [portfolioScrub, setPortfolioScrub] = useState<{ index: number; valueUsd: number } | null>(null);
  const [socialProfile, setSocialProfile] = useState<SocialUser | null>(null);
  const [socialScreenOpen, setSocialScreenOpen] = useState(false);
  const bootstrappedPortfolioOwner = useRef<string | null>(null);
  const [viewingUser, setViewingUser] = useState<{ privyUserId: string } | null>(null);
  const [pendingViewedUser, setPendingViewedUser] = useState<{ privyUserId: string } | null>(null);
  const [userProfileOpen, setUserProfileOpen] = useState(false);
  const copiedAddressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tradeFx = useTradeFx();

  const showToast = useCallback((nextToast: ToastState, duration = 2200) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }

    setToast(nextToast);

    if (nextToast && duration > 0) {
      toastTimeoutRef.current = setTimeout(() => {
        setToast(null);
        toastTimeoutRef.current = null;
      }, duration);
    }
  }, []);

  useEffect(() => {
    if (socialScreenOpen || !pendingViewedUser) return;
    const task = InteractionManager.runAfterInteractions(() => {
      setViewingUser(pendingViewedUser);
      setPendingViewedUser(null);
      setUserProfileOpen(true);
    });
    return () => task.cancel();
  }, [pendingViewedUser, socialScreenOpen]);

  const openStockDetail = useCallback((token: WalletBalanceToken) => {
    const symbol = (token.symbol ?? '').trim();
    if (!symbol) return;

    const stock: Stock = {
      id: token.mint ?? symbol,
      symbol,
      name: token.name ?? symbol,
      type: 'xstock',
      holderCount: null,
      icon: token.icon ?? null,
      usdPrice: null,
      priceChange1h: null,
      priceChange24h: null,
      volume24h: null,
    };

    // The full asset screen, same as Home and Search push — it reads the
    // holding, cost basis and Sell affordance off the wallet store itself.
    void Haptics.selectionAsync();
    openStockRoute(stock, { source: null });
  }, [openStockRoute]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      if (refreshArmTimeoutRef.current) {
        clearTimeout(refreshArmTimeoutRef.current);
      }
    };
  }, []);

  // Open the full-screen account editor, seeding it with the current values so
  // it renders instantly. On return, useFocusEffect re-reads the canonical
  // profile.
  function openEditProfile() {
    router.push({
      pathname: "/edit-profile",
      params: {
        ...(profileImageUrl ? { avatarUrl: profileImageUrl } : {}),
        ...(appUsername ? { username: appUsername } : {}),
        ...(socialProfile?.bio ? { bio: socialProfile.bio } : {}),
      },
    });
  }

  const primarySolanaAddress = useMemo(() => {
    const fromHook = wallet?.address;

    if (typeof fromHook === "string" && fromHook.length > 0) {
      return fromHook;
    }

    if (!user) {
      return null;
    }

    for (const account of user.linked_accounts) {
      if (account.type === "wallet" && account.chain_type === "solana") {
        const candidate = account as { address?: unknown };
        if (
          typeof candidate.address === "string" &&
          candidate.address.length > 0
        ) {
          return candidate.address;
        }
      }
    }

    return null;
  }, [wallet?.address, user]);

  // Bootstrap authority belongs to one user + wallet pair. Reset it whenever
  // either identity changes so a transient missing wallet can never sync an
  // empty list using the previous account's completed-bootstrap flag.
  useEffect(() => {
    bootstrappedPortfolioOwner.current = null;
    setSandwichPositions(null);
  }, [primarySolanaAddress, user?.id]);

  const profileImageUrl = useMemo(() => {
    const oauthUrl = user ? getProfileImageUrl(user.linked_accounts) : null;
    // Fall back to the avatarUrl stored in our DB (uploaded via R2)
    return oauthUrl ?? socialProfile?.avatarUrl ?? null;
  }, [user, socialProfile?.avatarUrl]);

  const xUsername = useMemo(() => {
    return user ? getXUsername(user.linked_accounts) : null;
  }, [user]);

  // Fetch the app username from server
  useEffect(() => {
    if (!user) return;
    const payload = appUserPayloadFromPrivyUser(user);
    if (!payload) return;
    void syncUser(payload)
      .then((res) => {
        setProfileResolved(true);
        if (res?.user?.username) {
          setAppUsername(res.user.username);
        }
        if (res?.user?.isAdmin) {
          setIsAdmin(true);
        }
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    // This key bumps on every focus. Re-reading the chain each time a user tabs
    // back within a few seconds bought nothing and delayed the reads that
    // matter, so these are freshness-gated; pull-to-refresh and every
    // post-trade call still force a read by passing no `maxAgeMs`.
    void walletStore.refresh({ maxAgeMs: BALANCE_FRESH_MS });
    void walletStore.reloadCostBasis({ maxAgeMs: COST_BASIS_FRESH_MS });
    // walletStore methods are stable refs; re-run only when refresh key bumps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioRefreshKey]);

  useEffect(() => {
    if (!primarySolanaAddress) {
      setSandwichPositions([]);
      return;
    }

    let isCurrent = true;
    const walletAddress = primarySolanaAddress;
    const portfolioOwnerKey = user?.id
      ? `${user.id}:${walletAddress}`
      : null;

    void (async () => {
      // Local cache first: the holdings list is gated on positions being known
      // (a leg token must not flash as a loose row), so making that gate wait on
      // a network round trip made every visit start with skeletons. The device
      // read answers in milliseconds; the backend merge below then corrects it.
      const cached = await getStoredSandwichPositions(walletAddress);
      if (!isCurrent) return;
      setSandwichPositions(cached);

      if (!user?.id) return;

      // Backend is the canonical source of truth (local wins on a newer
      // updatedAt). A null means unreachable — keep the cache and don't sync.
      const backendPositions = await getUserPortfolio(user.id).catch(() => null);
      if (!isCurrent || backendPositions === null) return;

      const merged = await seedFromBackend(walletAddress, backendPositions);
      bootstrappedPortfolioOwner.current = portfolioOwnerKey;
      if (isCurrent) setSandwichPositions(merged);
    })();

    return () => { isCurrent = false; };
  }, [primarySolanaAddress, sandwichRefreshKey, user?.id]);

  // Keyed on the *ids* rather than the positions array: the array is replaced on
  // every refresh (and twice on mount — cache, then the backend merge), and
  // re-fetching the same sandwich details each time is pure latency.
  const heldSandwichIdsKey = useMemo(
    () =>
      [...new Set((sandwichPositions ?? []).map((position) => position.sandwichId))]
        .sort()
        .join(","),
    [sandwichPositions],
  );

  useEffect(() => {
    if (!heldSandwichIdsKey) {
      setSandwichCreators({});
      setHoldingSandwiches({});
      setSandwichProvenance({});
      return;
    }

    const sandwichIds = heldSandwichIdsKey.split(",");
    let isCurrent = true;

    // Failing soft: provenance only enriches a row that already renders, so a
    // hiccup here must cost the headline and timestamp, never the holding.
    void getHeldSandwichProvenance()
      .then((rows) => {
        if (isCurrent) setSandwichProvenance(rows);
      })
      .catch(() => {});

    void Promise.all(
      sandwichIds.map(async (sandwichId) => {
        const sandwich = await getSandwichById(sandwichId);
        return [sandwichId, sandwich, getSandwichCreatorMeta(sandwich)] as const;
      }),
    ).then((entries) => {
      if (isCurrent) {
        setSandwichCreators(
          Object.fromEntries(
            entries.map(([sandwichId, , creator]) => [sandwichId, creator]),
          ),
        );
        setHoldingSandwiches(
          Object.fromEntries(
            entries.flatMap(([sandwichId, sandwich]) =>
              sandwich ? [[sandwichId, sandwich] as const] : [],
            ),
          ),
        );
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [heldSandwichIdsKey]);

  // Older/direct and server-side buys can leave the wallet holding every leg
  // without a synced UserSandwichPosition row. In that case, recover only an
  // unambiguous complete basket from the public catalog: every mint-bearing leg
  // must still be present. Partial matches stay as standalone tokens so we do
  // not guess which sandwich the user owns.
  // Stable signature of the held mints. Every balance refresh hands back a new
  // array, and keying the catalog fetch below on that identity re-ran it (and
  // re-entered its loading state) on every refresh even when nothing changed.
  const heldMintSignature = useMemo(
    () =>
      [
        ...new Set(
          balanceTokens
            .filter(
              (token) =>
                token.balance > 0 &&
                token.mint &&
                token.mint !== USDC_MAINNET_MINT &&
                (token.symbol ?? "").toUpperCase() !== "USDC",
            )
            .map((token) => token.mint as string),
        ),
      ]
        .sort()
        .join(","),
    [balanceTokens],
  );

  // "Loaded, and the user holds no stored sandwich" — the only state in which
  // recovery from the public catalog is worth attempting.
  const positionsKnownEmpty = sandwichPositions !== null && sandwichPositions.length === 0;

  useEffect(() => {
    if (!positionsKnownEmpty) {
      setRecoverySandwiches([]);
      return;
    }

    const heldMintCount = heldMintSignature ? heldMintSignature.split(",").length : 0;
    if (heldMintCount < 2) {
      setRecoverySandwiches([]);
      return;
    }

    let isCurrent = true;
    void getSandwiches(100, null, anonymousId)
      .then((sandwiches) => {
        if (isCurrent) setRecoverySandwiches(sandwiches);
      })
      .catch(() => {
        if (isCurrent) setRecoverySandwiches([]);
      });

    return () => {
      isCurrent = false;
    };
  }, [anonymousId, heldMintSignature, positionsKnownEmpty]);

  useFocusEffect(
    useCallback(() => {
      setPortfolioRefreshKey((value) => value + 1);
      setSandwichRefreshKey((value) => value + 1);
      if (user?.id) {
        void getUserProfile(user.id, user.id).then((profile) => {
          setProfileResolved(true);
          if (profile) {
            setSocialProfile(profile);
            // Reflect username edits made on the account screen without an app
            // reload (the header reads appUsername, not socialProfile.username).
            if (profile.username) setAppUsername(profile.username);
          }
        });
      }
    }, [user?.id]),
  );

  // Realized P&L series powering the graph at the top of the profile. It is
  // derived from completed trades only — never wallet balances or deposits.
  useEffect(() => {
    if (!user?.id) return;
    let isCurrent = true;
    setPnlHistoryLoading(true);
    // The percentage is a return on the capital in the trades behind the P&L
    // (`basisUsd`), never the portfolio's value at the start of the range —
    // a wallet funded mid-range starts near $0 and divides into millions of %.
    getUserPnlHistory(user.id, portfolioRange)
      .then((history) => {
        if (!isCurrent) return;
        setPnlHistory(history);
        setPnlBasisUsd(history.basisUsd ?? null);
      })
      .catch(() => {
        if (isCurrent) {
          setPnlHistory({ points: [], realizedUsd: 0, unrealizedUsd: 0, changeUsd: 0 });
          setPnlBasisUsd(null);
        }
      })
      .finally(() => { if (isCurrent) setPnlHistoryLoading(false); });
    return () => { isCurrent = false; };
  }, [user?.id, portfolioRange, portfolioRefreshKey]);

  useEffect(() => {
    if (!sandwichPositions || !user) return;
    const portfolioOwnerKey = primarySolanaAddress
      ? `${user.id}:${primarySolanaAddress}`
      : null;
    // Sync only data loaded for this exact user + wallet. This blocks both an
    // initial empty state and stale positions carried across an account change.
    if (
      !portfolioOwnerKey ||
      bootstrappedPortfolioOwner.current !== portfolioOwnerKey
    ) return;
    // Drop positions the wallet no longer backs.
    //
    // This used to also mirror the list up to the backend, which stored it as
    // the user's holdings. It no longer does: the server derives holdings from
    // its own execution record, so an exited sandwich disappears from the
    // OTHER-user view when the position resolves server-side, not when this
    // device next happens to open the profile and report it missing.
    //
    // What remains is purely local: keep the device's own store in step so
    // pruned rows stop coming back on the next read.
    //
    // Gated on `balancesKnown` for the obvious reason — pruning on a failed
    // balance read would drop positions the user still holds.
    const backed = backedSandwichPositions ?? sandwichPositions;

    if (balancesKnown && backed.length !== sandwichPositions.length && primarySolanaAddress) {
      const dropped = sandwichPositions.filter((position) => !backed.includes(position));
      void Promise.all(
        dropped.map((position) =>
          removeStoredSandwichPosition(primarySolanaAddress, position.id),
        ),
      ).then(() => setSandwichPositions(backed));
    }
    // Keyed on which sandwiches survive rather than on `tokenByMint`, for the
    // same reason `heldSandwichIdsKey` exists: the token map is replaced on
    // every wallet poll, and depending on it turned a periodic balance refresh
    // into a portfolio write transaction each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backedSandwichKey, primarySolanaAddress, sandwichPositions, user]);



  const loadPerpsData = useCallback(() => {
    if (!primarySolanaAddress) {
      setPerpsPositions([]);
      setPerpsLoading(false);
      return () => {};
    }
    let isCurrent = true;
    setPerpsLoading(true);
    void (async () => {
      try {
        const positions = await getPerpsPositions(primarySolanaAddress);
        if (!isCurrent) return;
        setPerpsPositions(positions);
      } catch {
        if (!isCurrent) return;
        setPerpsPositions([]);
      } finally {
        if (isCurrent) setPerpsLoading(false);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [primarySolanaAddress]);

  useEffect(() => loadPerpsData(), [loadPerpsData, portfolioRefreshKey]);

  /**
   * Load a page of settled history.
   *
   * Lazy on purpose: this walks the whole trade ledger server-side, and most
   * sessions never open the Closed tab. Putting it on the initial profile load
   * would charge every user for a view they did not ask for.
   */
  const loadClosedPositions = useCallback(
    async (options?: { cursor?: string | null; append?: boolean }) => {
      setClosedLoading(true);
      setClosedError(null);
      try {
        const page = await getClosedPositions({
          cursor: options?.cursor ?? null,
          limit: 20,
        });
        setClosedPositions((previous) => {
          if (!options?.append || !previous) return page.positions;
          // De-duped on append. Paging should never hand back a row twice, but
          // a repeat here is uniquely nasty: React sees two children with the
          // same key, and the user sees the same trade listed twice as if they
          // had made it twice. Cheap to make impossible.
          const seen = new Set(previous.map((row) => row.id));
          return [...previous, ...page.positions.filter((row) => !seen.has(row.id))];
        });
        setClosedCursor(page.nextCursor);
      } catch (error) {
        // Keep whatever is already on screen. Blanking a populated list on a
        // failed refresh loses history the user was reading.
        setClosedError(error instanceof Error ? error.message : "Couldn't load history");
        setClosedPositions((previous) => previous ?? []);
      } finally {
        setClosedLoading(false);
      }
    },
    [],
  );

  /**
   * Pull the next page in as the list runs out, rather than parking a button at
   * the bottom of it.
   *
   * The 400pt threshold fires while the last rows are still below the fold, so
   * the next page is usually in place before the user reaches where it goes —
   * the list simply continues. Guarded on `closedLoading` because `onScroll`
   * fires many times per gesture and every one of them would otherwise start
   * another request for the same cursor.
   */
  const handleHoldingsScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (holdingsView !== "Closed" || closedCursor === null || closedLoading) return;
      const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
      const distanceFromEnd =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceFromEnd > 400) return;
      void loadClosedPositions({ cursor: closedCursor, append: true });
    },
    [closedCursor, closedLoading, holdingsView, loadClosedPositions],
  );

  /**
   * Which refresh generation the closed list was loaded for.
   *
   * Toggling Open/Closed must NOT refetch — the history did not change because
   * the user looked away — but a pull-to-refresh must, and that is exactly what
   * `portfolioRefreshKey` already means everywhere else on this screen.
   */
  const closedLoadedForKey = useRef<number | null>(null);
  useEffect(() => {
    if (holdingsView !== "Closed") return;
    if (closedLoadedForKey.current === portfolioRefreshKey) return;
    closedLoadedForKey.current = portfolioRefreshKey;
    void loadClosedPositions();
  }, [holdingsView, loadClosedPositions, portfolioRefreshKey]);

  const loadPerpSandwichData = useCallback(() => {
    if (!primarySolanaAddress) {
      setPerpSandwichPositions([]);
      setPerpSandwichLoading(false);
      return () => {};
    }
    let isCurrent = true;
    setPerpSandwichLoading(true);
    void getPerpSandwichPositions()
      .then((positions) => {
        if (isCurrent) setPerpSandwichPositions(positions);
      })
      .catch(() => {
        if (isCurrent) setPerpSandwichPositions([]);
      })
      .finally(() => {
        if (isCurrent) setPerpSandwichLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [primarySolanaAddress]);

  useEffect(
    () => loadPerpSandwichData(),
    [loadPerpSandwichData, portfolioRefreshKey],
  );

  const loadPhoenixData = useCallback(() => {
    if (!primarySolanaAddress) {
      setPhoenixAccount(null);
      setPhoenixLoading(false);
      return () => {};
    }
    let isCurrent = true;
    setPhoenixLoading(true);
    void getPhoenixAccount()
      .then((next) => {
        if (isCurrent) setPhoenixAccount(next);
      })
      .catch(() => {
        // Preserve the last good Phoenix snapshot on a transient read failure;
        // clearing it would make an open position disappear from Holdings.
      })
      .finally(() => {
        if (isCurrent) setPhoenixLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [primarySolanaAddress]);

  useEffect(() => loadPhoenixData(), [loadPhoenixData, portfolioRefreshKey]);

  const loadHyperliquidData = useCallback(() => {
    if (PERPS_VENUE !== "hyperliquid" || !primarySolanaAddress) {
      setHyperliquidPositions([]);
      return () => {};
    }
    let isCurrent = true;
    void getHyperliquidAccount()
      .then(({ account }) => {
        if (isCurrent) setHyperliquidPositions(account.positions);
      })
      .catch(() => {
        // Keep the last good read; an empty list would look like a closed position.
      });
    return () => {
      isCurrent = false;
    };
  }, [primarySolanaAddress]);

  useEffect(() => loadHyperliquidData(), [loadHyperliquidData, portfolioRefreshKey]);

  const closePhoenixPosition = useCallback(
    async (
      position: PhoenixPosition,
      fraction = 1,
      exitPrice: number | null = null,
    ) => {
      if (!wallet || closingPhoenixSymbol) return;
      const symbol = position.symbol.trim().toUpperCase();
      // Exits run silent. `closingPhoenixSymbol` already disables the pad and
      // spins its button, and the exit receipt below reports the result — a
      // toast in between would only narrate what the screen is showing.
      setClosingPhoenixSymbol(symbol);
      try {
        // The share travels, not a size — the position is measured server-side
        // at build time, so a stale number here can never enlarge the order.
        //
        // The close pad pre-builds while the user slides, so this is usually
        // already done; see lib/phoenix-prebuild.
        const built = await takePhoenixCloseBuild(symbol, fraction, exitPrice);
        const sent = await signAndSendBase64WithResult(wallet, built.transaction, {
          lastValidBlockHeight: built.lastValidBlockHeight,
          requireConfirmed: true,
          // The close build simulates these exact instructions server-side.
          skipSimulation: true,
          // "processed" is a landed exit; see the open path in
          // phoenix-market-detail-sheet.
          fastConfirm: true,
        });
        // Phoenix keeps no record of a position once it is closed, so the server
        // captured this exit's result at build time and is waiting to hear that
        // it landed. Not awaited: the receipt must never delay the exit screen,
        // and a lost confirmation costs a row in the closed list, nothing more.
        if (built.closeRecordId) {
          void confirmPhoenixClose(built.closeRecordId, sent.signature);
        }
        // Re-read in the background: the receipt below is built from the
        // position as it was, so it never needed to wait on Phoenix.
        void getPhoenixAccount()
          .then((nextAccount) => {
            setPhoenixAccount(nextAccount);
            setPortfolioRefreshKey((value) => value + 1);
          })
          .catch(() => undefined);
        // The exit receipt leads with the PnL this exit realizes — the whole
        // carry on a full close, its share on a partial one — over the entry
        // it is being measured against.
        const logo = perpLogoSources(position);
        // The mark the sheet was showing, or — when the close came from
        // somewhere without one — the price implied by the PnL this position
        // is carrying, which is the same number the position card printed.
        const size = Math.abs(position.positionSize);
        const impliedExit =
          size > 0 && Number.isFinite(position.unrealizedPnl)
            ? position.entryPrice +
              (position.unrealizedPnl / size) * (position.positionSize < 0 ? -1 : 1)
            : null;
        tradeFx.playPerp({
          action: "close",
          side: position.positionSize < 0 ? "short" : "long",
          symbol,
          // Phoenix's own mark is an SVG, which the receipt's hero cannot draw;
          // the asset's tokens.xyz art comes first and that is what fixed the
          // icon-less exit screen.
          logoUri: logo.uri,
          logoFallbackUris: logo.fallbackUris,
          leverage: position.leverage ?? null,
          entryPrice: position.entryPrice,
          exitPrice: exitPrice ?? impliedExit,
          // Only the share of collateral this close actually frees.
          marginUsd:
            position.marginUsd != null ? position.marginUsd * fraction : null,
          pnlUsd: position.unrealizedPnl * fraction,
        });
      } catch (cause) {
        showToast({
          text: cause instanceof Error ? cause.message : `Could not close ${symbol}`,
          tone: "error",
        });
      } finally {
        setClosingPhoenixSymbol(null);
      }
    },
    [closingPhoenixSymbol, showToast, tradeFx, wallet],
  );

  /**
   * Run the close the user already confirmed on the sheet's close pad.
   *
   * There is deliberately no alert here. The pad *is* the confirmation: it
   * shows the slice, the size, and the PnL it books before the tap, which a
   * native two-button dialog could never do.
   */
  const submitPhoenixClose = useCallback(
    (
      position: PhoenixPosition,
      options: { fraction: number; exitPrice?: number | null },
    ) => {
      if (closingPhoenixSymbol) return;
      void closePhoenixPosition(position, options.fraction, options.exitPrice ?? null);
    },
    [closePhoenixPosition, closingPhoenixSymbol],
  );

  /**
   * Confirm closing a perp Sandwich, and ask where the collateral should land.
   *
   * The choice is real, not a formality. Closing releases the margin into the
   * Phoenix parent account, where it stays warm for the next perp trade; getting
   * it back to spendable cash costs a second transaction and a trip through
   * Phoenix's withdraw queue. Keeping it on the account is therefore the default,
   * matching how `autoFund` is opt-in on the way in.
   */
  /**
   * Close a perp Sandwich with the collateral destination the user picked on
   * the close pad's switch — the choice the old three-button alert asked for.
   */
  const submitPerpSandwichClose = useCallback(
    (position: PerpSandwichPosition, options: { returnToCash: boolean }) => {
      if (perpSandwichActionId) return;
      void runPerpSandwichAction(position, { returnToCash: options.returnToCash });
    },
    // `runPerpSandwichAction` is a function declaration hoisted in this
    // component body, so it is stable across renders and is deliberately not a
    // dependency — listing it would need it converted to a callback first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perpSandwichActionId],
  );

  // Rebound every render so the native position sheet — which outlives the
  // render that opened it — always calls this render's loaders and submitters.
  positionSheetHandlersRef.current = {
    onUpdated: () => {
      void loadPhoenixData();
      void loadPerpSandwichData();
    },
    onRequestClosePosition: (target, options) => {
      // The sheet serves both kinds of position and closes them by very
      // different paths — a Sandwich exits through its own atomic close, not
      // through the standalone reduce-only order. The ref set when the sheet
      // was opened is what distinguishes them; it is cleared as soon as it
      // is used so a later standalone position can never inherit it.
      const sandwich = perpSandwichSheetPositionRef.current;
      perpSandwichSheetPositionRef.current = null;
      if (sandwich) {
        submitPerpSandwichClose(sandwich, { returnToCash: options.returnToCash });
        return;
      }
      submitPhoenixClose(target, {
        fraction: options.fraction,
        exitPrice: options.exitPrice,
      });
    },
  };

  // Resolve the viewer's anonymous social id once so post like-state comes back
  // correct (mirrors the feed).
  useEffect(() => {
    let cancelled = false;
    setAnonymousId(null);
    void getAnonymousSocialId(user?.id).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Keep a post in sync after a like toggle (here or on the detail screen).
  const applyUpdatedPost = useCallback((updated: Sandwich) => {
    setMyPosts((current) =>
      current
        ? current.map((post) => (post.id === updated.id ? updated : post))
        : current,
    );
  }, []);

  // Fetch this user's own created sandwich ids from the dedicated endpoint,
  // then resolve the full posts needed by SandwichCard. Scanning the newest
  // global feed page made older profile posts disappear as the feed grew.
  const loadMyPosts = useCallback(async () => {
    if (!user?.id) return;
    setPostsLoading(true);
    try {
      const created = await getUserCreatedSandwiches(user.id);
      const posts = await Promise.all(
        created.map(({ sandwichId }) =>
          getSandwichById(sandwichId, anonymousId),
        ),
      );
      setMyPosts(posts.filter((post): post is Sandwich => post !== null));
    } catch {
      setMyPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [user, anonymousId]);

  const refreshProfile = useCallback(() => {
    if (profileRefreshing) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProfileRefreshing(true);
    setRefreshArmed(false);
    setPortfolioScrub(null);
    // Deliberately does NOT clear `sandwichPositions`: blanking it swapped the
    // whole list for skeletons on every pull, which reads as a slow screen even
    // when the data underneath was unchanged. The RefreshControl spinner is the
    // affordance; rows update in place as each source lands.
    setPortfolioRefreshKey((value) => value + 1);
    setSandwichRefreshKey((value) => value + 1);

    // `cash` is a projection of the wallet store, so cash.refresh() is the same
    // network read as walletStore.refresh() — asking for both just doubled it.
    const primaryRefreshes: Promise<unknown>[] = [
      Promise.resolve(walletStore.refresh()),
      Promise.resolve(walletStore.reloadCostBasis()),
    ];
    if (user?.id) {
      primaryRefreshes.push(
        getUserProfile(user.id, user.id).then((profile) => {
          if (!profile) return;
          setSocialProfile(profile);
          if (profile.username) setAppUsername(profile.username);
        }),
      );
    }

    void Promise.allSettled(primaryRefreshes).then(() => {
      if (refreshArmTimeoutRef.current) clearTimeout(refreshArmTimeoutRef.current);
      // Give the key-driven portfolio effects one paint to enter their loading
      // states before the completion watcher is armed.
      refreshArmTimeoutRef.current = setTimeout(() => {
        setRefreshArmed(true);
        refreshArmTimeoutRef.current = null;
      }, 250);
    });
  }, [profileRefreshing, user?.id, walletStore]);

  const refreshSourcesLoading =
    balanceLoading ||
    cash.loading ||
    pnlHistoryLoading ||
    perpsLoading ||
    phoenixLoading ||
    sandwichPositions === null ||
    (profileTab === "posts" && postsLoading);

  useEffect(() => {
    if (!profileRefreshing || !refreshArmed || refreshSourcesLoading) return;
    setProfileRefreshing(false);
    setRefreshArmed(false);
  }, [profileRefreshing, refreshArmed, refreshSourcesLoading]);

  useEffect(() => {
    if (profileTab !== "posts") return;
    void loadMyPosts();
  }, [profileTab, loadMyPosts, sandwichRefreshKey]);

  const handlePostToggleLike = useCallback(
    async (sandwich: Sandwich) => {
      if (!anonymousId) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // The like belongs to the card this market sits on, so one request covers
      // an episode however many markets it produced.
      const before = cardSocial([sandwich]);
      const optimistic = toggledCardSocial(before);
      applyUpdatedPost(withCardSocial(sandwich, optimistic));
      try {
        const updated = await setCardLike(sandwich, optimistic.viewerHasLiked, anonymousId);
        applyUpdatedPost(withCardSocial(sandwich, updated));
      } catch {
        applyUpdatedPost(withCardSocial(sandwich, before));
      }
    },
    [anonymousId, applyUpdatedPost],
  );

  // Every prop handed to a feed card must be referentially stable: the cards are
  // `React.memo` and this screen holds dozens of pieces of state, so an inline
  // arrow here re-renders the whole Posts tab on any unrelated change.
  // Grouped once per posts change, not on every render of a screen that holds
  // dozens of pieces of state.
  const myPostItems = useMemo(() => buildFeedItems(myPosts ?? []), [myPosts]);
  const openTakeSandwich = useCallback(
    (take: PositionTake) => {
      void Haptics.selectionAsync();
      router.push({ pathname: "/sandwich-detail", params: { id: take.sandwichId } });
    },
    [router],
  );
  // Posts and takes are one timeline — a take is a post about a position, so
  // it no longer needs a tab of its own. Newest first across both.
  const myTimeline = useMemo(() => {
    const itemTime = (item: (typeof myPostItems)[number]) => {
      const dates =
        item.kind === "video"
          ? item.sandwiches.map((sw) => sw.createdAt)
          : item.kind === "sandwich"
            ? [item.sandwich.createdAt]
            : [item.take.createdAt];
      return Math.max(0, ...dates.map((d) => Date.parse(d) || 0));
    };
    const entries = [
      ...myPostItems.map((item) => ({ kind: "post" as const, key: item.key, time: itemTime(item), item })),
      ...(myTakes ?? []).map((take) => ({
        kind: "take" as const,
        key: `take:${take.id}`,
        time: Date.parse(take.createdAt) || 0,
        take,
      })),
    ];
    return entries.sort((a, b) => b.time - a.time);
  }, [myPostItems, myTakes]);

  const openPostGroup = useCallback(
    (video: PodcastGroupVideo, group: Sandwich[]) =>
      podcastGroup.open({ video, sandwiches: group }),
    [podcastGroup],
  );

  const togglePostLikeGroup = useCallback(
    (group: Sandwich[]) => {
      // Liked means every market liked, so a partial episode likes the
      // remainder instead of toggling any off.
      const allLiked = group.every((sw) => sw.viewerHasLiked);
      for (const sw of allLiked ? group : group.filter((i) => !i.viewerHasLiked)) {
        void handlePostToggleLike(sw);
      }
    },
    [handlePostToggleLike],
  );

  const openPost = useCallback(
    (sw: Sandwich) => sandwichDetail.open(sw, { onUpdated: applyUpdatedPost }),
    [sandwichDetail, applyUpdatedPost],
  );

  const openPostComments = useCallback(
    (sw: Sandwich) =>
      sandwichDetail.open(sw, { onUpdated: applyUpdatedPost, showComments: true }),
    [sandwichDetail, applyUpdatedPost],
  );

  const handlePostShare = useCallback((sandwich: Sandwich) => {
    postShareSheetRef.current?.open(sandwich);
  }, []);

  useEffect(() => {
    return () => {
      if (copiedAddressTimeoutRef.current) {
        clearTimeout(copiedAddressTimeoutRef.current);
      }
    };
  }, []);

  // ── Derived holdings ───────────────────────────────────────────────────────
  // Memoized and kept above the `!user` guard so they are hooks: this screen
  // holds ~50 pieces of state and every async source that lands re-renders it,
  // which previously rebuilt every map, inference pass and sandwich row from
  // scratch each time.

  // null = positions not yet loaded from storage; [] = loaded, no sandwiches held
  const positionsReady = sandwichPositions !== null;
  // Only the stored positions gate the list. Catalog *recovery* (the fallback
  // that infers a sandwich from loose legs) needs the whole public feed, and
  // making every user wait on that download before seeing a single holding was
  // the bulk of the delay. It runs in the background instead; if it does find a
  // basket, the affected rows regroup under it when it lands.
  const positionsClassified = positionsReady;
  const safePositions = useMemo(() => sandwichPositions ?? [], [sandwichPositions]);


  const inferredPositions = useMemo<SandwichPosition[]>(() => {
    if (recoverySandwiches.length === 0) return [];

    const heldByMint = new Map(
      balanceTokens
        .filter((token) => token.balance > 0 && token.mint)
        .map((token) => [token.mint as string, token]),
    );
    // Recovery runs ALONGSIDE the stored positions, not instead of them: a
    // wallet holding one synced basket and one unsynced basket used to show the
    // second as loose token rows, because a single stored position switched
    // inference off entirely.
    //
    // What it may not do is describe the same tokens twice. A stored position
    // already owns its legs, so those mints are spoken for before inference
    // starts, and a sandwich that is already stored is never a candidate.
    const storedSandwichIds = new Set(safePositions.map((position) => position.sandwichId));
    const claimedMints = new Set<string>(
      safePositions.flatMap((position) => position.legs.map((leg) => leg.mint)),
    );
    const inferred: SandwichPosition[] = [];
    const completeCandidates = recoverySandwiches
      .filter(
        (sandwich) =>
          !deliberatelyClosedSandwichIds.current.has(sandwich.id) &&
          !storedSandwichIds.has(sandwich.id),
      )
      .map((sandwich) => ({
        sandwich,
        legs: sandwich.legs.filter(
          (leg): leg is typeof leg & { mint: string } =>
            leg.type === "tokenized_stock" && Boolean(leg.mint),
        ),
      }))
      .filter(
        ({ legs }) =>
          legs.length >= 2 && legs.every((leg) => heldByMint.has(leg.mint)),
      );
    const signatureCounts = new Map<string, number>();
    for (const { legs } of completeCandidates) {
      const signature = legs.map((leg) => leg.mint).sort().join(":");
      signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
    }
    const candidates = completeCandidates
      .filter(({ legs }) => {
        const signature = legs.map((leg) => leg.mint).sort().join(":");
        return signatureCounts.get(signature) === 1;
      })
      .sort((a, b) => b.legs.length - a.legs.length);

    for (const { sandwich, legs } of candidates) {
      if (legs.some((leg) => claimedMints.has(leg.mint))) continue;

      const positionLegs = legs.map((leg) => {
        const token = heldByMint.get(leg.mint)!;
        const costEntry = walletStore.costBasis[leg.mint];
        const investedUsd = costEntry
          ? Math.min(token.balance, costEntry.qty) * costEntry.avgPriceUsd
          : token.usdValue ?? 0;
        claimedMints.add(leg.mint);
        return {
          legId: leg.id,
          kind: "swap" as const,
          mint: leg.mint,
          symbol: leg.symbol,
          label: leg.label,
          imageUrl: leg.imageUrl,
          weightBps: leg.weightBps,
          inputAmount: Math.round(Math.max(0, investedUsd) * 1_000_000).toString(),
          investedUsd,
        };
      });
      const investedUsd = positionLegs.reduce(
        (sum, leg) => sum + (leg.investedUsd ?? 0),
        0,
      );
      inferred.push({
        id: `recovered:${sandwich.id}`,
        sandwichId: sandwich.id,
        name: sandwich.name,
        summary: sandwich.summary,
        investedUsd,
        createdAt: sandwich.createdAt,
        updatedAt: sandwich.updatedAt,
        pendingSync: false,
        strictAtomic: sandwich.source.sourceType === "youtube",
        legs: positionLegs,
      });
    }

    return inferred;
  }, [balanceTokens, recoverySandwiches, safePositions, walletStore.costBasis]);

  // Stored first, then anything recovery could account for that the store had
  // never seen. The two are disjoint by construction — inference skips stored
  // sandwiches and stored mints — so this is a union, not a merge.
  const effectivePositions = useMemo(
    () => [...safePositions, ...inferredPositions],
    [inferredPositions, safePositions],
  );

  const recoverySandwichById = useMemo(
    () => new Map(recoverySandwiches.map((sandwich) => [sandwich.id, sandwich])),
    [recoverySandwiches],
  );

  /**
   * The source behind a held sandwich, for the trade receipt's X-post card.
   * A position stores only the basket, so the sandwich itself has to be looked
   * up — from the details already fetched for the holdings list, then from the
   * catalog rows that recovered an unsynced position.
   */
  const sandwichSourceFor = useCallback(
    (sandwichId: string) =>
      (holdingSandwiches[sandwichId] ?? recoverySandwichById.get(sandwichId))
        ?.source ?? null,
    [holdingSandwiches, recoverySandwichById],
  );

  /**
   * The captions behind a held sandwich, for its Holdings card. Same two
   * lookups the source uses, and null whenever neither knows the sandwich —
   * which is exactly when the card should keep its written line.
   */
  const sandwichCaptionFor = useCallback(
    (sandwichId: string) =>
      momentCaption(
        holdingSandwiches[sandwichId] ?? recoverySandwichById.get(sandwichId) ?? null,
      ),
    [holdingSandwiches, recoverySandwichById],
  );

  /**
   * The idea's return since it was created — the feed card's figure, for the
   * receipt's pill. Same two lookups the source uses, and null when neither
   * knows the sandwich: an absent number beats a made-up zero.
   */
  const sandwichSincePnlPctFor = useCallback(
    (sandwichId: string) =>
      (holdingSandwiches[sandwichId] ?? recoverySandwichById.get(sandwichId))
        ?.pnlPct ?? null,
    [holdingSandwiches, recoverySandwichById],
  );

  // All mints that belong to any stored sandwich leg — used to suppress individual token rows
  const sandwichLegMints = useMemo(
    () =>
      new Set(effectivePositions.flatMap((position) => position.legs.map((leg) => leg.mint))),
    [effectivePositions],
  );

  const sandwichRows = useMemo(() => effectivePositions
    .map((position) => {
      const legTokens = position.legs
        .map((leg) => ({
          leg,
          token: tokenByMint.get(leg.mint) ?? null,
        }))
        .filter((row): row is { leg: SandwichPosition['legs'][number]; token: WalletBalanceToken } =>
          Boolean(row.token && row.token.balance > 0),
        );
      // Value the units this holder actually acquired. Applying the sandwich's
      // since-created return here credited a buyer with gains from before they
      // entered (for example a new $2 buy showing as $2.82 on a +41% call).
      const valuation = valueSandwichPosition(
        position.legs,
        tokenByMint,
        balancesKnown,
        position.legs.map((leg) => leg.mint),
      );
      const returnPct = valuation.returnPct;
      const usdValue = valuation.valueUsd;
      // Balances are still ground truth for whether the position EXISTS. A
      // sandwich whose legs the wallet no longer holds is sold, and without this
      // it would keep rendering at its modeled value forever.
      const holdsAnyLeg = position.legs.some(
        (leg) => (tokenByMint.get(leg.mint)?.balance ?? 0) > 0,
      );
      const displayUsdValue = balancesKnown && !holdsAnyLeg ? 0 : usdValue;
      const changeValues = legTokens
        .map((row) => row.token?.priceChange24h)
        .filter((value): value is number => typeof value === 'number');
      const priceChange24h =
        changeValues.length > 0
          ? changeValues.reduce((sum, value) => sum + value, 0) / changeValues.length
          : null;
      return {
        position,
        legTokens,
        usdValue: displayUsdValue,
        priceChange24h,
        returnPct,
        realizedPnlUsd: null,
        balancesKnown,
      };
    })
    .filter((row) => row.usdValue >= DUST_USD),
    [balancesKnown, effectivePositions, tokenByMint]);

  const focusedActiveSandwichId =
    focusedPosition?.detail.state === "open"
      ? focusedPosition.detail.sandwichId
      : null;
  useEffect(() => {
    if (!focusedActiveSandwichId) return;
    const row = sandwichRows.find(
      (candidate) => candidate.position.sandwichId === focusedActiveSandwichId,
    );
    if (!row) return;
    const pnlUsd =
      row.position.investedUsd === null
        ? null
        : row.usdValue - row.position.investedUsd;
    setFocusedPosition((current) => {
      if (
        current?.detail.state !== "open" ||
        current.detail.sandwichId !== focusedActiveSandwichId
      ) return current;
      if (
        current.currentValueUsd === row.usdValue &&
        current.pnlUsd === pnlUsd &&
        current.pnlPct === row.returnPct &&
        current.detail.costUsd === row.position.investedUsd
      ) return current;
      return {
        ...current,
        currentValueUsd: row.usdValue,
        pnlUsd,
        pnlPct: row.returnPct,
        detail: { ...current.detail, costUsd: row.position.investedUsd },
      };
    });
  }, [focusedActiveSandwichId, sandwichRows]);

  /**
   * Theses written on the sandwiches this user holds (§8).
   *
   * Keyed by sandwich rather than by position, because the device derives its
   * holdings from on-chain balances and never learns the server's position-row
   * id — the same reason the composer sends a sandwich and lets the server
   * resolve the row.
   */
  const [holdingTakes, setHoldingTakes] = useState<Record<string, PositionTake[]>>({});
  // A stable key rather than the array itself: `sandwichRows` is rebuilt on
  // every balance tick, so depending on it would refetch every take on every
  // price update.
  const heldSandwichKey = useMemo(
    () =>
      [
        ...sandwichRows.map((row) => row.position.sandwichId),
        // From the raw state rather than the filtered `visible…` lists, which
        // are derived below the early return where no hook may read them.
        // Loading takes for a position that ends up hidden costs nothing.
        ...perpSandwichPositions.map((position) => position.sandwich.id),
        // A bare Phoenix position has no sandwich; its takes are filed under
        // its market symbol, which is what the server resolves it to.
        ...(phoenixAccount?.account.cross?.positions ?? []).map((position) => position.symbol.toUpperCase()),
      ].join(","),
    [sandwichRows, perpSandwichPositions, phoenixAccount],
  );

  useEffect(() => {
    const ids = heldSandwichKey ? heldSandwichKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (sandwichId) => [sandwichId, await getSandwichTakes(sandwichId)] as const),
      );
      if (cancelled) return;
      setHoldingTakes(Object.fromEntries(entries.map(([id, page]) => [id, page.takes])));
    })();
    return () => {
      cancelled = true;
    };
    // Re-reads when the held SET changes, not when its values move.
  }, [heldSandwichKey]);

  useEffect(() => {
    if (profileTab !== "posts" || !user?.id) return;
    let cancelled = false;
    void getUserTakes(user.id).then((page) => {
      if (!cancelled) setMyTakes(page.takes);
    });
    return () => {
      cancelled = true;
    };
  }, [profileTab, user?.id]);

  /** The viewer's OWN takes on a sandwich — what the button counts. */
  const ownTakesFor = useCallback(
    (sandwichId: string) => {
      const mine = (holdingTakes[sandwichId] ?? []).filter(
        (take) => Boolean(appUsername) && take.author.username === appUsername,
      );
      return { count: mine.length, latest: mine[0] ?? null };
    },
    [holdingTakes, appUsername],
  );


  if (!user) {
    return (
      <View style={styles.page}>
        <View style={styles.profileCard}>
          <Text style={styles.handle}>No user session</Text>
          <Text style={styles.body}>Please login to view your profile.</Text>
        </View>
      </View>
    );
  }

  async function handleDeposit(
    _method: "apple_pay",
    amount: string,
    email: string,
  ): Promise<void> {
    if (!primarySolanaAddress) {
      throw new Error("Wallet not available.");
    }

    await linkCrossmintWallet({
      email,
      walletAddress: primarySolanaAddress,
    });

    const order = await createCrossmintOrder({
      walletAddress: primarySolanaAddress,
      amount,
      receiptEmail: email,
      paymentMethod: "apple-pay",
    });

    setCrossmintEmail(email);
    setCrossmintAmount(amount);
    setCrossmintOrder(order);
  }

  async function copyAddress(address: string): Promise<void> {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(address);
    setCopiedAddress(address);

    if (copiedAddressTimeoutRef.current) {
      clearTimeout(copiedAddressTimeoutRef.current);
    }

    copiedAddressTimeoutRef.current = setTimeout(() => {
      setCopiedAddress(null);
      copiedAddressTimeoutRef.current = null;
    }, 1000);
  }

  async function refreshFocusedSandwichDetail(sandwichId: string): Promise<void> {
    try {
      const detail = await getOpenSandwichPositionDetail(sandwichId);
      setFocusedPosition((current) =>
        current?.detail.sandwichId === sandwichId
          ? { ...current, detail }
          : current,
      );
    } catch {
      // The live holdings refresh remains authoritative. A detail refresh can
      // legitimately race a full close, in which case there is no open row to
      // return and the sheet is dismissed by the close path below.
    }
  }

  /**
   * What the receipt's "Add thesis" needs about the basket just bought. The
   * value is what went in — the position is seconds old and has no return yet.
   */
  function sandwichThesisTarget(position: SandwichPosition, amountUsd: number): TakeComposerTarget {
    return {
      positionKind: "sandwichId",
      positionId: position.sandwichId,
      name: position.name,
      pct: null,
      valueUsd: Number.isFinite(amountUsd) ? amountUsd : null,
      logoUrl: position.legs[0]?.imageUrl ?? null,
      openedAt: position.createdAt,
      takeCount: ownTakesFor(position.sandwichId).count,
    };
  }

  async function buySandwichPosition(
    position: SandwichPosition,
    amount: string,
  ): Promise<void> {
    if (!wallet?.address) {
      setSandwichMessage("Wallet is not available.");
      showToast({ text: "Wallet is not available", tone: "error" });
      return;
    }

    const totalAmount = toSmallestUnits(amount, 6);
    if (!totalAmount || !isPositiveSmallestUnitAmount(totalAmount)) {
      setSandwichMessage("Enter a valid USDC amount.");
      return;
    }

    const totalAmountBigInt = BigInt(totalAmount);
    const totalWeight = position.legs.reduce(
      (sum, leg) => sum + BigInt(Math.max(0, leg.weightBps)),
      0n,
    );
    if (totalWeight <= 0n) {
      setSandwichMessage("This sandwich has no buyable legs.");
      return;
    }

    if (position.legs.every((leg) => leg.kind !== "prediction")) {
      // Every swap-only sandwich uses the packed basket engine, not a serial
      // client-side loop. Quotes fan out server-side and the wallet signs the
      // resulting packed transactions together, matching normal asset speed.
      setSandwichTrading(true);
      setSandwichMessage(null);
      try {
        const warmKey = buyWarmKey(position.id, amount);
        const warmed = warmedBuyRef.current;
        warmedBuyRef.current = null;
        const started = await (
          warmed?.key === warmKey
            ? warmed.started
            : startSandwichBasketBuy(position.sandwichId, Number(amount))
        );
        if (
          started.status !== "needs_signature" ||
          started.transactions.length === 0 ||
          (position.strictAtomic && started.transactions.length !== 1)
        ) {
          throw new Error(started.status === "failed" ? started.reason : "Buy was not ready to sign.");
        }
        const provider = await wallet.getProvider();
        const signed: string[] = [];
        for (const transaction of started.transactions) {
          const signedPayload = await provider.request({
            method: "signTransaction",
            params: { transaction: deserializeTransaction(transaction) },
          });
          signed.push(serializeSignedTransaction(signedPayload.signedTransaction));
        }
        const result = await submitSignedBasketBuy(started.basketRunId, signed);
        if (result.status === "failed") {
          throw new Error(result.reason || "Buy did not confirm.");
        }
        const landed = result.status === "partial" ? new Set(result.landedLegIds) : null;
        const filledLegs = started.legs.filter((leg) => !landed || landed.has(leg.legId));
        if (filledLegs.length === 0) throw new Error("No sandwich layers were filled.");
        deliberatelyClosedSandwichIds.current.delete(position.sandwichId);
        await recordSandwichPositionBuy(
          wallet.address,
          position,
          filledLegs.map((leg) => ({
            mint: leg.mint,
            inputAmount: leg.amountUsdc,
            outputAmount: leg.quotedOutRaw ?? null,
            decimals: leg.decimals ?? null,
          })),
        );
        setSandwichPositions(await getStoredSandwichPositions(wallet.address));
        sandwichTradeSheetRef.current?.dismiss();
        setSandwichTradeSide(null);
        void refreshFocusedSandwichDetail(position.sandwichId);
        setPortfolioRefreshKey((value) => value + 1);
        tradeFx.playSandwich({
          action: "buy",
          icons: position.legs.map((leg) => leg.imageUrl),
          label: position.name,
          amountUsd: Number(amount),
          sincePnlPct: sandwichSincePnlPctFor(position.sandwichId),
          source: sandwichSourceFor(position.sandwichId),
          thesis: sandwichThesisTarget(position, Number(amount)),
        });
        void walletStore.refresh();
      } catch (error) {
        const message = getErrorMessage(error);
        setSandwichMessage(message);
        showToast({ text: message, tone: "error" });
      } finally {
        setSandwichTrading(false);
      }
      return;
    }

    setSandwichTrading(true);
    setSandwichMessage(null);

    try {
      // Optimistically deduct the buy amount from the cash balance
      const buyAmountNum = Number(amount);
      if (buyAmountNum > 0) {
        const idleDeduction = Math.min(cash.idleUsdc, buyAmountNum);
        if (idleDeduction > 0) {
          walletStore.optimisticAdjust(USDC_MAINNET_MINT, -idleDeduction, -idleDeduction);
        }
      }

      const provider = await wallet.getProvider();
      let allocated = 0n;
      const executedLegs: { mint: string; inputAmount: string }[] = [];

      for (const [index, leg] of position.legs.entries()) {
        const inputAmount =
          index === position.legs.length - 1
            ? totalAmountBigInt - allocated
            : (totalAmountBigInt * BigInt(Math.max(0, leg.weightBps))) /
              totalWeight;
        allocated += inputAmount;

        if (inputAmount <= 0n) continue;

        const order = await createJupiterOrder({
          inputMint: USDC_MAINNET_MINT,
          outputMint: leg.mint,
          amount: inputAmount.toString(),
          taker: wallet.address,
        });
        const transaction = deserializeTransaction(order.transaction);
        const signedPayload = await provider.request({
          method: "signTransaction",
          params: { transaction },
        });
        const signedTransaction = serializeSignedTransaction(
          signedPayload.signedTransaction,
        );
        const execution = await executeJupiterOrder({
          signedTransaction,
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
          const message =
            execution.errorMessage ??
            (execution.status
              ? `Jupiter returned ${execution.status}`
              : `Jupiter error ${execution.code}`);
          setSandwichMessage(
            `Stopped at ${leg.symbol ?? leg.label}: ${message}`,
          );
          showToast({ text: "Buy stopped", tone: "error" });
          void walletStore.refresh();
          return;
        }

        executedLegs.push({
          mint: leg.mint,
          inputAmount: inputAmount.toString(),
        });
      }

      if (executedLegs.length > 0) {
        deliberatelyClosedSandwichIds.current.delete(position.sandwichId);
        await recordSandwichPositionBuy(wallet.address, position, executedLegs);
        const updated = await getStoredSandwichPositions(wallet.address);
        setSandwichPositions(updated);
      }

      sandwichTradeSheetRef.current?.dismiss();
      setSandwichTradeSide(null);
      void refreshFocusedSandwichDetail(position.sandwichId);
      setSandwichMessage(null);
      setPortfolioRefreshKey((value) => value + 1);
      tradeFx.playSandwich({
        action: "buy",
        icons: position.legs.map((leg) => leg.imageUrl),
        label: position.name,
        amountUsd: Number(amount),
        sincePnlPct: sandwichSincePnlPctFor(position.sandwichId),
        source: sandwichSourceFor(position.sandwichId),
        thesis: sandwichThesisTarget(position, Number(amount)),
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setSandwichMessage(message);
      showToast({ text: message, tone: "error" });
      void walletStore.refresh();
    } finally {
      setSandwichTrading(false);
    }
  }

  /**
   * Identity of one exit: the same position at the same fraction. Anything else
   * is a different sell and must not reuse a warmed build.
   */
  function sellWarmKey(positionId: string, fractionBps: number): string {
    return `${positionId}:${fractionBps}`;
  }

  function buyWarmKey(positionId: string, amount: string): string {
    return `${positionId}:${amount}`;
  }

  /**
   * Start quote/build work while the button is pressed or a preset is chosen.
   * The build is bound to the exact dollar amount, so a keypad edit discards it
   * and can never make the user sign an old quote.
   */
  function warmSandwichBuy(amount = sandwichTradeAmount): void {
    if (!selectedTradePosition || sandwichTradeSide !== "buy" || sandwichTrading) return;
    if (selectedTradePosition.legs.some((leg) => leg.kind === "prediction")) return;
    if (!isValidDisplayAmount(amount) || Number(amount) <= 0) return;
    const key = buyWarmKey(selectedTradePosition.id, amount);
    if (warmedBuyRef.current?.key === key) return;
    const started = startSandwichBasketBuy(selectedTradePosition.sandwichId, Number(amount));
    started.catch(() => {});
    warmedBuyRef.current = { key, started };
  }

  /**
   * Start the sell build on touch-down, so the tap itself is just the wallet
   * prompt. Same trick the buy pad uses — the quote round-trip is the slowest
   * part of an exit and it does not depend on anything the tap decides.
   */
  function warmSandwichSell(amount?: string): void {
    if (!selectedTradePosition || sandwichTradeSide !== "sell" || sandwichTrading) return;
    if (selectedTradePosition.legs.some((leg) => leg.kind === "prediction")) return;
    // `amount` is passed by callers that set it in the same render — state has
    // not caught up yet, and warming at the previous size would build a quote
    // the tap then has to discard.
    const fractionBps = sellFractionBpsFor(selectedTradePosition, amount ?? sandwichTradeAmount);
    if (fractionBps === null) return;
    const key = sellWarmKey(selectedTradePosition.id, fractionBps);
    if (warmedSellRef.current?.key === key) return;
    const started = startSandwichSell(selectedTradePosition.sandwichId, fractionBps);
    // The tap re-attaches the real handler; this only stops an early rejection
    // surfacing as an unhandled promise before then.
    started.catch(() => {});
    warmedSellRef.current = { key, started };
  }

  /**
   * The fraction of the position this amount represents, in basis points, or
   * null when it isn't a valid exit.
   *
   * Dollars for every sandwich, timestamp baskets included. Those used to be
   * typed in percent because the engine only accepted 25/50/100 — a restriction
   * that was never about the atomic contract (any fraction scales all the legs
   * equally) and left the one screen where a user closes a position unable to
   * tell them what it is worth. The steps survive as presets.
   *
   * An amount at or above the position's value is a full exit, snapped to
   * 10_000 bps so "sell everything" never leaves a rounding remainder behind —
   * dust is what strands a position as open and later gets recorded as its exit.
   */
  function sellFractionBpsFor(
    position: SandwichPosition,
    amount?: string,
  ): number | null {
    const rowValue =
      selectedSandwichRow?.position.id === position.id
        ? selectedSandwichRow.usdValue
        : null;
    const amountUsd = amount && isValidDisplayAmount(amount) ? Number(amount) : null;
    const fraction =
      amountUsd && rowValue && rowValue > 0
        ? Math.max(0, Math.min(1, amountUsd / rowValue))
        : 1;
    if (!Number.isFinite(fraction) || fraction <= 0) return null;
    if (fraction >= 0.995) return 10_000;
    return Math.max(1, Math.min(10_000, Math.round(fraction * 10_000)));
  }

  async function sellSandwich(
    position: SandwichPosition,
    amount?: string,
  ): Promise<void> {
    if (!wallet?.address) {
      setSandwichMessage("Wallet is not available.");
      showToast({ text: "Wallet is not available", tone: "error" });
      return;
    }

    // Only for the realized-PnL figure on the celebration; the exit size itself
    // comes from `sellFractionBpsFor`.
    const rowValue =
      selectedSandwichRow?.position.id === position.id
        ? selectedSandwichRow.usdValue
        : null;

    const fractionBps = sellFractionBpsFor(position, amount);
    if (fractionBps === null) {
      setSandwichMessage("Enter a valid amount to sell.");
      return;
    }
    const sellFraction = fractionBps / 10_000;

    // ── Packed exit: one request, one signature, one submit ────────────────
    //
    // The server quotes every leg concurrently and packs them into as few
    // transactions as they fit. What this replaces for a multi-leg sandwich is
    // the loop further down: a metadata read, a build, a wallet prompt and a
    // confirmation wait PER LEG, strictly serial — three legs meant three
    // approvals and six sequential round-trips before the user saw anything.
    //
    // Prediction legs stay on that loop. They are a different venue that closes
    // by position pubkey rather than by swap, the engine rejects them outright,
    // and no current sandwich can be built with one — only legacy positions
    // still carry them.
    const hasPredictionLeg = position.legs.some((leg) => leg.kind === "prediction");
    if (!hasPredictionLeg) {
      // Same as the buy: silent unless something goes wrong, or lands short.
      setSandwichTrading(true);
      setSandwichMessage(null);
      try {
        // Reuse the build touch-down started, when it was for this exact exit.
        // Consumed either way: a build is single-use, and re-awaiting a settled
        // one would resurrect a stale quote.
        const warmed = warmedSellRef.current;
        warmedSellRef.current = null;
        const started = await (warmed?.key === sellWarmKey(position.id, fractionBps)
          ? warmed.started
          : startSandwichSell(position.sandwichId, fractionBps));
        if (started.status !== "needs_signature" || started.transactions.length === 0) {
          throw new Error(
            started.status === "failed" ? started.reason : "The sell was not ready to sign.",
          );
        }

        const provider = await wallet.getProvider();
        const signed: string[] = [];
        for (const unsigned of started.transactions) {
          const signedPayload = await provider.request({
            method: "signTransaction",
            params: { transaction: deserializeTransaction(unsigned) },
          });
          signed.push(serializeSignedTransaction(signedPayload.signedTransaction));
        }

        // /submit holds the request open until the bundle confirms on-chain —
        // seconds, sometimes tens of them. Say so; the wallet sheet has closed
        // and otherwise nothing moves until the receipt.
        showToast({ text: "Selling…", tone: "processing" }, 0);
        let result: Awaited<ReturnType<typeof submitSignedBasketBuy>>;
        try {
          result = await submitSignedBasketBuy(started.basketRunId, signed);
        } finally {
          setToast(null);
        }
        if (result.status === "failed") {
          throw new Error(result.reason || "The sell did not land. Please try again.");
        }

        // A partial exit is settled, not an error: the legs that landed are
        // sold and the rest are still in the wallet. Recording the fraction
        // that actually sold keeps the local position row honest.
        const soldShare =
          result.status === "partial"
            ? result.landedLegIds.length /
              Math.max(1, result.landedLegIds.length + result.failedLegIds.length)
            : 1;
        const executedFraction = sellFraction * soldShare;
        const percent = Math.round(executedFraction * 100);

        // The receipt goes up the moment the sell is confirmed — before the
        // storage writes, the position re-render and the sheet dismissal below,
        // each of which used to sit between the confirmation and the celebration.
        tradeFx.playSandwich({
          action: "sell",
          icons: position.legs.map((leg) => leg.imageUrl),
          label: position.name,
          percent,
          amountUsd: rowValue == null ? null : rowValue * executedFraction,
          pnlUsd: sandwichRealizedPnl(position, executedFraction, rowValue),
          sincePnlPct: sandwichSincePnlPctFor(position.sandwichId),
          source: sandwichSourceFor(position.sandwichId),
        });

        if (executedFraction >= 0.9999) {
          deliberatelyClosedSandwichIds.current.add(position.sandwichId);
        }
        await recordSandwichPositionSell(wallet.address, position.id, executedFraction);
        setSandwichPositions(await getStoredSandwichPositions(wallet.address));
        sandwichTradeSheetRef.current?.dismiss();
        setSandwichTradeSide(null);
        if (executedFraction >= 0.9999) {
          setFocusedPosition(null);
          // The holding drawer this sell may have been launched from now
          // describes a position that no longer exists.
          setPodcastHoldingMoment(null);
          void loadClosedPositions();
        } else {
          void refreshFocusedSandwichDetail(position.sandwichId);
        }
        setPortfolioRefreshKey((value) => value + 1);
        // A clean exit says nothing; a partial one has to, because the rest of
        // the position is still open and the receipt does not say so.
        if (result.status === "partial") {
          showToast({
            text: `Sold ${result.landedLegIds.length} of ${
              result.landedLegIds.length + result.failedLegIds.length
            } layers`,
            tone: "processing",
          });
        }
        void walletStore.refresh();
      } catch (error) {
        // Nothing left to sell: this position was exited some other way and the
        // server has just closed the record. The user asked to be out and they
        // are, so this is a completed exit, not a failure to retry.
        if (isAlreadyExitedError(error)) {
          deliberatelyClosedSandwichIds.current.add(position.sandwichId);
          await recordSandwichPositionSell(wallet.address, position.id, 1);
          setSandwichPositions(await getStoredSandwichPositions(wallet.address));
          sandwichTradeSheetRef.current?.dismiss();
          setSandwichTradeSide(null);
          setFocusedPosition(null);
          setPodcastHoldingMoment(null);
          void loadClosedPositions();
          setPortfolioRefreshKey((value) => value + 1);
          showToast({
            text: "Already sold — moved to Closed",
            tone: "processing",
          });
          void walletStore.refresh();
          return;
        }
        const message = getErrorMessage(error);
        setSandwichMessage(message);
        showToast({ text: message, tone: "error" });
      } finally {
        setSandwichTrading(false);
      }
      return;
    }

    type SellableSwap = {
      kind: "swap";
      leg: SandwichPosition["legs"][number];
      token: WalletBalanceToken;
    };
    type SellablePrediction = {
      kind: "prediction";
      leg: SandwichPosition["legs"][number];
    };
    type SellableLeg = SellableSwap | SellablePrediction;

    const sellableLegs: SellableLeg[] = position.legs.flatMap(
      (leg): SellableLeg[] => {
        if (leg.kind === "prediction") {
          if (!leg.positionPubkey) return [];
          return [{ kind: "prediction", leg }];
        }
        const token = balanceTokens.find(
          (t) => t.mint === leg.mint && t.balance > 0,
        );
        if (!token) return [];
        return [{ kind: "swap", leg, token }];
      },
    );

    if (sellableLegs.length === 0) {
      setSandwichMessage("No remaining sandwich legs to sell.");
      deliberatelyClosedSandwichIds.current.add(position.sandwichId);
      await removeStoredSandwichPosition(wallet.address, position.id);
      const updated = await getStoredSandwichPositions(wallet.address);
      setSandwichPositions(updated);
      setPortfolioRefreshKey((value) => value + 1);
      showToast({ text: "No remaining legs", tone: "error" });
      return;
    }

    setSandwichTrading(true);
    setSandwichMessage(null);

    // A closed prediction position pays out in JupUSD, not USDC — track it so we
    // can convert the proceeds back to USDC and park them in the vault afterward.
    let closedPrediction = false;

    try {
      const provider = await wallet.getProvider();

      for (const sellable of sellableLegs) {
        const leg = sellable.leg;
        const labelForError = leg.symbol ?? leg.label;

        if (sellable.kind === "prediction") {
          // Currently only full close is supported (DELETE position). For partial
          // sells we still close the full position — partial fractional sells via
          // POST /orders with isBuy=false are not yet wired.
          if (!leg.positionPubkey) continue;

          const closeOrder = await closePredictionPosition({
            positionPubkey: leg.positionPubkey,
            ownerPubkey: wallet.address,
          });
          const closeTx = deserializeTransaction(closeOrder.transaction);
          const signedClose = await provider.request({
            method: "signTransaction",
            params: { transaction: closeTx },
          });
          const closeSigned = serializeSignedTransaction(
            signedClose.signedTransaction,
          );
          const closeSignedB64 = Buffer.from(closeSigned).toString("base64");
          const submission = await submitPredictionTransaction({
            signedTransaction: closeSignedB64,
            ...(closeOrder.blockhash ? { blockhash: closeOrder.blockhash } : {}),
            ...(closeOrder.lastValidBlockHeight !== null
              ? { lastValidBlockHeight: closeOrder.lastValidBlockHeight }
              : {}),
          });

          if (
            submission.errorMessage ||
            (submission.status && submission.status !== "Success")
          ) {
            setSandwichMessage(
              `Stopped at ${labelForError}: ${submission.errorMessage ?? submission.status}`,
            );
            showToast({ text: "Sell stopped", tone: "error" });
            return;
          }
          closedPrediction = true;
          continue;
        }

        const token = sellable.token;
        const detail = await searchJupiterToken(leg.mint, leg.mint).catch(
          () => null,
        );
        const decimals =
          typeof detail?.decimals === "number" ? detail.decimals : 6;
        const amount = toSmallestUnits(
          amountToDisplayString(token.balance * sellFraction, decimals),
          decimals,
        );

        if (!amount || !isPositiveSmallestUnitAmount(amount)) {
          continue;
        }

        const order = await createJupiterOrder({
          inputMint: leg.mint,
          outputMint: USDC_MAINNET_MINT,
          amount,
          taker: wallet.address,
        });
        const transaction = deserializeTransaction(order.transaction);
        const signedPayload = await provider.request({
          method: "signTransaction",
          params: { transaction },
        });
        const signedTransaction = serializeSignedTransaction(
          signedPayload.signedTransaction,
        );
        const execution = await executeJupiterOrder({
          signedTransaction,
          requestId: order.requestId,
          ...(order.lastValidBlockHeight
            ? { lastValidBlockHeight: order.lastValidBlockHeight }
            : {}),
        });

        if (execution.errorMessage) {
          setSandwichMessage(
            `Stopped at ${leg.symbol ?? leg.label}: ${execution.errorMessage}`,
          );
          showToast({ text: "Sell stopped", tone: "error" });
          return;
        }

        if (execution.status && execution.status !== "Success") {
          setSandwichMessage(
            `Stopped at ${leg.symbol ?? leg.label}: Jupiter returned ${execution.status}.`,
          );
          showToast({ text: "Sell stopped", tone: "error" });
          return;
        }

        if (execution.code !== null && execution.code !== 0) {
          setSandwichMessage(
            `Stopped at ${leg.symbol ?? leg.label}: Jupiter error ${execution.code}.`,
          );
          showToast({ text: "Sell stopped", tone: "error" });
          return;
        }
      }

      // Prediction closes pay out in JupUSD. Convert that to USDC under the
      // hood so the money lands back as spendable cash. Best-effort: the
      // closes already settled on-chain, so a hiccup here never fails the sell.
      if (closedPrediction) {
        const settlement = await settleJupUsdToCash({ wallet });
        if (settlement.swapError) {
          showToast({
            text: "Sold — proceeds still converting",
            tone: "processing",
          });
        }
      }

      await recordSandwichPositionSell(
        wallet.address,
        position.id,
        sellFraction,
      );
      if (sellFraction >= 0.9999) {
        deliberatelyClosedSandwichIds.current.add(position.sandwichId);
      }
      const updated = await getStoredSandwichPositions(wallet.address);
      setSandwichPositions(updated);
      sandwichTradeSheetRef.current?.dismiss();
      setSandwichTradeSide(null);
      if (sellFraction >= 0.9999) {
        setFocusedPosition(null);
        void loadClosedPositions();
      } else {
        void refreshFocusedSandwichDetail(position.sandwichId);
      }
      setSandwichMessage(null);
      setPortfolioRefreshKey((value) => value + 1);
      tradeFx.playSandwich({
        action: "sell",
        icons: position.legs.map((leg) => leg.imageUrl),
        label: position.name,
        percent: Math.round(sellFraction * 100),
        amountUsd: rowValue == null ? null : rowValue * sellFraction,
        pnlUsd: sandwichRealizedPnl(position, sellFraction, rowValue),
        sincePnlPct: sandwichSincePnlPctFor(position.sandwichId),
        source: sandwichSourceFor(position.sandwichId),
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setSandwichMessage(message);
      showToast({ text: message, tone: "error" });
    } finally {
      setSandwichTrading(false);
    }
  }

  /**
   * Move every free dollar of perps collateral back to spendable cash.
   *
   * Deliberately a SECOND transaction chained after the close, not an
   * instruction inside it. A withdraw needs a fixed amount, but the amount is
   * unknowable until the close's reduce-only fill has settled PnL and taker
   * fees: quoting it at build time leaves dust behind on a good fill and, on a
   * bad one, over-draws and rolls back the entire close. Failing to get the cash
   * out must never cost the user the exit itself.
   *
   * Never throws. The collateral is safe in the Phoenix parent account either
   * way, and the account sheet can always move it by hand.
   */
  async function returnCollateralToCash(): Promise<number | null> {
    if (!wallet) return null;
    try {
      const built = await buildPhoenixWithdrawAll();
      await signAndSendBase64WithResult(wallet, built.transaction, {
        lastValidBlockHeight: built.lastValidBlockHeight,
        fastConfirm: true,
        requireConfirmed: true,
      });
      void walletStore.refresh();
      return built.amountUsd;
    } catch (error) {
      console.log("[perp-close] return to cash failed", getErrorMessage(error));
      return null;
    }
  }

  /**
   * Open a perp Sandwich in the same detail sheet a standalone Phoenix position
   * uses: chart with entry/stop/liquidation lines, the shareable position card,
   * and EDIT SL/TP + CLOSE in the bottom bar.
   *
   * One leg per perp Sandwich (`MAX_PERP_SANDWICH_LEGS`), so it maps cleanly
   * onto the sheet's `PhoenixPosition`. The podcast provenance travels beside it
   * as `context`, which is also what routes the SL/TP build at the Sandwich's
   * isolated subaccount rather than the parent cross account.
   *
   * Falls back to the legacy summary modal when the row has no readable leg —
   * a still-registering or failed position has nothing to chart.
   */
  function openPerpSandwichSheet(position: PerpSandwichPosition): void {
    const mapped = phoenixPositionFromPerpSandwich(position);
    const context = perpSandwichContext(position);
    if (!mapped || !context || position.status !== "open") {
      setSelectedPerpSandwich(position);
      return;
    }
    perpSandwichSheetPositionRef.current = position;
    openPositionSheet(mapped, { context });
  }

  async function runPerpSandwichAction(
    position: PerpSandwichPosition,
    options?: { returnToCash?: boolean },
  ): Promise<void> {
    if (!wallet || !position.actionableStatus || position.actionableStatus === "none") return;
    const closing = position.actionableStatus === "close";
    setPerpSandwichActionId(position.id);
    // Closing is a trade and stays silent; the collateral move is bookkeeping
    // with no receipt behind it, so it keeps its running commentary.
    if (!closing) {
      showToast({ text: "Preparing collateral move…", tone: "processing" }, 0);
    }
    try {
      const started = closing
        ? await startPerpSandwichClose(position.id)
        : await startPerpSandwichWithdrawAll(position.id);
      if (started.status !== "needs_signature" || started.transactions.length !== 1) {
        throw new Error(
          started.status === "failed" ? started.reason : "Phoenix transaction was not ready.",
        );
      }
      if (!closing) {
        showToast({ text: "Approve in wallet…", tone: "processing" }, 0);
      }
      // Same client-submit path as the entry: the transaction is already signed
      // by Bread's payer, so /basket-runs/[id]/submit was re-verifying bytes and
      // holding a confirmation poll open for work the app can do itself.
      // `settlePerpSandwichRun` records the outcome behind the success state.
      await signAndSendBase64WithResult(wallet, started.transactions[0], {
        lastValidBlockHeight: started.lastValidBlockHeight,
        skipSimulation: true,
        fastConfirm: true,
        requireConfirmed: true,
      });
      // A closed perp disappears from Phoenix immediately. Keep the success UI
      // responsive, then refresh the Closed tab only after the durable outcome
      // write has finished so it has realized P&L to render.
      const settlePromise = closing
        ? settlePerpSandwichRun(started.basketRunId).catch(() => {})
        : null;

      setSelectedPerpSandwich(null);
      setPortfolioRefreshKey((value) => value + 1);
      // The legacy collateral move genuinely credits wallet USDC, and the
      // refresh-key path is freshness-gated (BALANCE_FRESH_MS), so a read within
      // that window would show the money as still gone. Force it.
      if (!closing) void walletStore.refresh();

      if (closing && options?.returnToCash) {
        await returnCollateralToCash();
      }
      if (!closing) {
        showToast({ text: "Collateral move started", tone: "success" });
      }
      // A perp Sandwich exits as a perp, so it gets the perps close burst (the
      // collateral move is bookkeeping and stays a plain toast).
      if (closing) {
        const closedLeg = position.legs[0];
        const legSymbol = (closedLeg?.symbol ?? position.sandwich.name).toUpperCase();
        // Same treatment as a standalone close: the leg's own asset art, so the
        // exit receipt has a face on it instead of a letter tile.
        const legLogo = closedLeg
          ? perpLogoSources({ symbol: closedLeg.symbol })
          : { uri: null, fallbackUris: [] as (string | null)[] };
        const legPnl = closedLeg?.pnlAfterFundingUsd ?? closedLeg?.unrealizedPnlUsd ?? null;
        tradeFx.playPerp({
          action: "close",
          side: closedLeg?.side === "short" ? "short" : "long",
          symbol: legSymbol,
          name: position.sandwich.name,
          logoUri: legLogo.uri,
          logoFallbackUris: legLogo.fallbackUris,
          leverage: position.leverage ?? null,
          entryPrice: closedLeg?.entryPrice ?? null,
          exitPrice: closedLeg?.markPrice ?? null,
          marginUsd: closedLeg?.marginUsdc ?? position.marginUsdc ?? null,
          pnlUsd: legPnl,
        });
        void settlePromise?.finally(() => loadClosedPositions());
      }
      void loadPerpSandwichData();
      void loadPhoenixData();
    } catch (error) {
      showToast({ text: getErrorMessage(error), tone: "error" });
    } finally {
      setPerpSandwichActionId(null);
    }
  }

  // The Privy DID is never a name — "did:privy:" read as a bug in the header.
  // Nothing known yet means the profile read is still in flight and the
  // header draws a skeleton; a resolved profile with no handle falls back to
  // the wallet, the same chain `userDisplayName` uses in lists.
  const profileHandle =
    appUsername ??
    xUsername ??
    (primarySolanaAddress ? shortAddress(primarySolanaAddress) : null);
  const profileHandleLoading = profileHandle === null && !profileResolved;
  const joinedDate = formatJoinedDate(
    socialProfile?.createdAt ??
      (typeof user.created_at === "number" ? user.created_at * 1000 : undefined),
  );

  const profileMeta = [
    joinedDate ? `Joined ${joinedDate}` : null,
    socialProfile?.tradeCount !== undefined
      ? `${socialProfile.tradeCount.toLocaleString("en-US")} ${socialProfile.tradeCount === 1 ? "trade" : "trades"}`
      : null,
  ]
    .filter((item): item is string => item !== null)
    .join(" · ");

  // Cumulative realized P&L from completed trades, plus live unrealized P&L at
  // the current endpoint. Deposits and wallet balances never move this chart.
  const pnlPoints = pnlHistory?.points ?? [];
  const displayedPnlUsd =
    portfolioScrub?.valueUsd ??
    pnlHistory?.changeUsd ??
    pnlPoints[pnlPoints.length - 1]?.valueUsd ??
    0;
  const pnlPositive = displayedPnlUsd >= 0;
  // The scrubbed or current P&L as a return on the range's starting value.
  const displayedPnlPct =
    pnlBasisUsd !== null ? (displayedPnlUsd / pnlBasisUsd) * 100 : null;
  const displayedPnlPctLabel = formatSignedPnlPercentage(displayedPnlPct);

  // Gate token display until positions are known — prevents leg tokens flashing before
  // sandwichLegMints is populated on first mount (storage read << network, but not guaranteed)
  const visibleBalanceTokens = positionsClassified
    ? selectHoldings(balanceTokens, { solTraded: walletStore.solTraded }).filter(
        // Sandwich legs are listed under their sandwich, not as loose tokens.
        (token) => !token.mint || !sandwichLegMints.has(token.mint),
      )
    : [];

  const visiblePerpsPositions = perpsPositions.filter((position) => position.value >= DUST_USD);
  const visiblePerpSandwichPositions = perpSandwichPositions.filter(
    hasLivePerpSandwichExposure,
  );
  const visiblePhoenixPositions = (phoenixAccount?.account.cross?.positions ?? []).filter(
    (position) =>
      Math.abs(position.positionSize) > 0 && Math.abs(position.positionValue) >= DUST_USD,
  );

  const visibleHyperliquidPositions = hyperliquidPositions.filter(
    (position) => position.size > 0 && Math.abs(position.positionValueUsd) >= DUST_USD,
  );

  const holdingTokens = (() => {
    if (!positionsClassified) return []; // Still classifying — block all token rows
    if (visibleBalanceTokens.length > 0) return visibleBalanceTokens;
    if (effectivePositions.length > 0) return []; // Only sandwiches, no standalone tokens
    if (visiblePerpsPositions.length > 0) return []; // Perps positions render separately
    if (visiblePhoenixPositions.length > 0) return []; // Phoenix positions render separately
    if (visibleHyperliquidPositions.length > 0) return []; // Hyperliquid positions render separately
    if (perpsLoading) return []; // Avoid placeholder flash
    // No holdings yet — return empty so the empty state renders
    return [];
  })();

  const holdingCount =
    sandwichRows.length +
    holdingTokens.length +
    visiblePerpSandwichPositions.length +
    visiblePerpsPositions.length +
    visiblePhoenixPositions.length +
    visibleHyperliquidPositions.length;

  const crossmintClientKey =
    process.env.EXPO_PUBLIC_CROSSMINT_CLIENT_API_KEY ?? "";
  const selectedTradePosition = selectedSandwichRow?.position ?? null;
  const sandwichTradeAmountSmallest = toSmallestUnits(sandwichTradeAmount, 6);
  // A buy spends USDC, so block it when the amount exceeds total cash (liquid +
  // any legacy vault balance). Sells dispose of an owned position and are clamped downstream, so
  // they aren't gated here. Skipped while cash is still loading.
  const sandwichBuyAmount = Number(sandwichTradeAmount);
  const sandwichInsufficient =
    sandwichTradeSide === "buy" &&
    !cash.loading &&
    Number.isFinite(sandwichBuyAmount) &&
    sandwichBuyAmount > 0 &&
    sandwichBuyAmount > cash.totalCash + Math.max(cash.totalCash * 1e-6, 1e-6);
  // What the exit is worth right now, so the sell pad can be denominated in
  // dollars like every other pad in the app. Null while the row's value is
  // still unknown — the pad then falls back to a plain dollar entry.
  const sandwichSellValueUsd =
    sandwichTradeSide === "sell" &&
    selectedSandwichRow?.position.id === selectedTradePosition?.id &&
    selectedSandwichRow?.usdValue
      ? selectedSandwichRow.usdValue
      : null;
  const sandwichSellAvailableLabel =
    sandwichTradeSide === "sell"
      ? sandwichSellValueUsd
        ? `Position value: $${sandwichSellValueUsd.toFixed(2)}${
            selectedTradePosition?.strictAtomic
              ? " · the same share sells from every leg"
              : ""
          }`
        : undefined
      : undefined;
  // Quarter, half and the whole position — the steps the timestamp pad used to
  // offer, now priced so the user can read what they are selling.
  const sandwichTradePresets =
    sandwichTradeSide === "sell"
      ? sandwichSellValueUsd
        ? [0.25, 0.5, 1].map((share) => (sandwichSellValueUsd * share).toFixed(2))
        : ["1", "5", "10"]
      : ["5", "10", "25", "50"];
  const canSubmitSandwichTrade =
    !!selectedTradePosition &&
    !!wallet?.address &&
    isValidDisplayAmount(sandwichTradeAmount) &&
    isPositiveSmallestUnitAmount(sandwichTradeAmountSmallest) &&
    !sandwichInsufficient &&
    !sandwichTrading;

  if (crossmintOrder && crossmintClientKey) {
    return (
      <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
        <Pressable
          onPress={() => {
            setCrossmintOrder(null);
            setPortfolioRefreshKey((v) => v + 1);
          }}
          style={styles.checkoutCloseBtn}
        >
          <Text style={styles.checkoutCloseText}>✕</Text>
        </Pressable>

        <View style={styles.checkoutBody}>
          <View style={styles.checkoutAmountSection}>
            <Text style={styles.checkoutLabel}>You receive</Text>
            <View style={styles.checkoutAmountRow}>
              <Text style={styles.checkoutAmount}>
                {crossmintAmount || "100"}
              </Text>
              <Image
                source={{
                  uri: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png",
                }}
                style={styles.usdcLogo}
              />
            </View>
            <Text style={styles.checkoutCurrency}>USDC</Text>
          </View>
        </View>

        <CrossmintProvider apiKey={crossmintClientKey}>
          <View style={styles.checkoutBottom}>
            <CrossmintEmbeddedCheckout
              orderId={crossmintOrder.orderId}
              clientSecret={crossmintOrder.clientSecret}
              payment={{
                receiptEmail: crossmintEmail,
                crypto: { enabled: false },
                fiat: {
                  enabled: true,
                  allowedMethods: {
                    applePay: true,
                    googlePay: false,
                    card: false,
                  },
                },
                defaultMethod: "fiat",
              }}
              appearance={{
                variables: {
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  borderRadius: "14px",
                  colors: {
                    backgroundPrimary: "#f4f8fb",
                    textPrimary: "#000000",
                    textSecondary: "#000000",
                    borderPrimary: "#edf2f7",
                    accent: "#000000",
                  },
                },
                rules: {
                  ReceiptEmailInput: { display: "hidden" },
                  DestinationInput: { display: "hidden" },
                  Tab: {
                    colors: { text: "transparent", background: "transparent" },
                    selected: {
                      colors: {
                        text: "transparent",
                        background: "transparent",
                      },
                    },
                  },
                  Input: {
                    borderRadius: "14px",
                    colors: {
                      background: "#ffffff",
                      border: "#edf2f7",
                      text: "#000000",
                      placeholder: "#000000",
                    },
                  },
                  PrimaryButton: {
                    borderRadius: "14px",
                    colors: { text: "#ffffff", background: "#000000" },
                    hover: { colors: { background: "#1a1a1a" } },
                  },
                },
              }}
            />
          </View>
        </CrossmintProvider>
      </SafeAreaView>
    );
  }

  const renderRowSkeletons = (count: number, label: string) => (
    <View accessibilityLabel={label} style={styles.skeletonList}>
      {Array.from({ length: count }, (_, index) => (
        <View key={`${label}-${index}`} style={styles.skeletonRow}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonLine, styles.skeletonLinePrimary]} />
            <View style={[styles.skeletonLine, styles.skeletonLineSecondary]} />
          </View>
          <View style={[styles.skeletonLine, styles.skeletonLineValue]} />
        </View>
      ))}
    </View>
  );

  /**
   * Trade a held YouTube call in its own drawer (the `podcast-call` route). The
   * result is written back into the moment drawer underneath: a partial or an
   * add updates its position, a full close dismisses it.
   */
  function openPodcastCall(mode: "buy" | "close"): void {
    const current = podcastHoldingMoment;
    if (!current) return;
    const sandwichId = current.position.sandwichId;
    stashPodcastCall(sandwichId, {
      sandwich: current.sandwich,
      position: current.position,
      onPositionUpdated: (next) => {
        setPodcastHoldingMoment((moment) => {
          if (!moment || moment.position.sandwichId !== sandwichId) return moment;
          return next ? { ...moment, position: next } : null;
        });
      },
    });
    const startMs = current.provenance.source.startMs;
    router.push({
      pathname: "/podcast-call",
      params: {
        sandwichId,
        mode,
        ...(startMs != null ? { startMs: String(startMs) } : {}),
      },
    });
  }

  /**
   * A held podcast call opens as one bounded moment. The full multi-call episode
   * is deliberately one link deeper; non-video Sandwiches keep their shared
   * detail route.
   */
  async function openSandwichScreen(row: SandwichHoldingRow): Promise<void> {
    void Haptics.selectionAsync();
    const sandwichId = row.position.sandwichId;
    // The selection only feeds the trade sheets reached FROM the detail screen,
    // so it must not hold up the push. Set synchronously it re-rendered this
    // whole screen before the navigation's frame could run — the tap lag.
    startTransition(() => setSelectedSandwichRow(row));
    const provenance = sandwichProvenance[sandwichId] ?? null;
    if (provenance?.source.sourceType === "youtube") {
      const knownSandwich =
        holdingSandwiches[sandwichId] ?? recoverySandwichById.get(sandwichId) ?? null;
      setPodcastHoldingMoment({
        row,
        position: row.position,
        provenance,
        sandwich: knownSandwich,
        currentValueUsd: row.usdValue,
        returnPct: row.returnPct,
      });
      return;
    }
    const sandwich =
      holdingSandwiches[sandwichId] ??
      recoverySandwichById.get(sandwichId) ??
      (await getSandwichById(sandwichId, anonymousId).catch(() => null));
    if (!sandwich) {
      showToast({ text: "This sandwich is no longer public", tone: "error" });
      return;
    }
    sandwichDetail.open(sandwich, { position: row.position });
  }

  async function openClosedPosition(position: ClosedPosition): Promise<void> {
    void Haptics.selectionAsync();
    // The sheet goes up on the tap, drawn from what the row already knows;
    // the full detail (fills, prices, legs) and the Sandwich fill it in place.
    // Awaiting both before presenting was the lag between tap and sheet.
    const sandwichId = position.sandwichId;
    const cached = sandwichId
      ? holdingSandwiches[sandwichId] ?? recoverySandwichById.get(sandwichId) ?? null
      : null;
    const provenance = closedSandwichProvenance(position);
    const initial: FocusedPositionData = {
      detail: publicClosedPositionDetail(position, cached),
      sandwich: cached,
      provenance,
    };
    positionDetailSheetRef.current?.present(initial);
    startTransition(() => setFocusedPosition(initial));
    const stillFocused = (update: (current: FocusedPositionData) => FocusedPositionData) =>
      startTransition(() =>
        setFocusedPosition((current) =>
          current?.detail.id === position.id ? update(current) : current,
        ),
      );
    try {
      const [detail, sandwich] = await Promise.all([
        getClosedPositionDetail(position),
        cached || !sandwichId
          ? Promise.resolve(cached)
          : getSandwichById(sandwichId, anonymousId).catch(() => null),
      ]);
      stillFocused(() => ({
        detail,
        sandwich,
        provenance: provenance ?? positionDetailProvenance(detail),
      }));
    } catch {
      // The row's own figures are already on screen; only the fill history is
      // missing. Better than tearing the sheet down with a toast.
      if (sandwichId && !cached) {
        const sandwich = await getSandwichById(sandwichId, anonymousId).catch(() => null);
        if (sandwich) {
          stillFocused((current) => ({
            ...current,
            sandwich,
            detail: publicClosedPositionDetail(position, sandwich),
          }));
        }
      }
    }
  }

  function shareFocusedPosition(data: FocusedPositionData): void {
    positionShareSheetRef.current?.open({
      detail: data.detail,
      currentValueUsd: data.currentValueUsd,
      pnlUsd: data.pnlUsd,
      pnlPct: data.pnlPct,
      iconUri: data.detail.logoUri,
      publicUrl: data.sandwich?.id
        ? getSandwichShareUrl(data.sandwich.id)
        : null,
    });
  }

  async function viewFullFocusedPosition(data: FocusedPositionData): Promise<void> {
    const sandwichId = data.detail.sandwichId;
    if (!sandwichId) return;
    const provenance = data.provenance;
    setFocusedPosition(null);
    const route = sandwichHoldingRoute(provenance, sandwichId);
    if (route.kind === "episode") {
      router.push({
        pathname: route.pathname,
        params: route.params,
      });
      return;
    }
    const sandwich =
      data.sandwich ??
      (await getSandwichById(sandwichId, anonymousId).catch(() => null));
    if (!sandwich) {
      showToast({ text: "This sandwich is no longer public", tone: "error" });
      return;
    }
    sandwichDetail.open(sandwich, {
      ...(data.detail.state === "open" && selectedSandwichRow
        ? { position: selectedSandwichRow.position }
        : {}),
    });
  }

  return (
    <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
      {/* The whole profile scrolls as one surface; the tab bar (child index 1)
          pins to the top once the header scrolls past it. Scrolling is frozen
          while the chart is being scrubbed — otherwise the native scroll view
          keeps panning the page out from under the finger. */}
      <ScrollView
        style={styles.holdingsList}
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical
        scrollEnabled={portfolioScrub === null}
        onScroll={handleHoldingsScroll}
        // Enough to catch the end of a fast flick; the handler itself is a few
        // arithmetic ops and returns early on every tab but Closed.
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            accessibilityLabel="Refresh profile"
            colors={["transparent"]}
            onRefresh={refreshProfile}
            progressBackgroundColor="transparent"
            refreshing={profileRefreshing}
            tintColor="transparent"
          />
        }
      >
        {/* index 0 — header block; scrolls away under the sticky tab bar */}
        <View>
      {/* Lives inside the scrolling header rather than floating over the page:
          once the tab bar pins, an overlay here would sit on the Open/Closed
          toggle and eat its taps. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push("/settings");
        }}
        style={styles.hamburgerBtn}
      >
        <View style={styles.hamburgerLine} />
        <View style={styles.hamburgerLine} />
        <View style={styles.hamburgerLine} />
      </Pressable>
      {/* Profile header */}
      <Pressable
        style={styles.profileHeader}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          openEditProfile();
        }}
        accessibilityRole="button"
        accessibilityLabel="Edit profile"
      >
        <View style={styles.profileTopRow}>
          {profileImageUrl ? (
            <Image source={{ uri: profileImageUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarDefault}>
              <Ionicons name="person" size={26} color={colors.iconMuted} />
            </View>
          )}

          <View style={styles.identityCol}>
            <View style={styles.nameRow}>
              {profileHandleLoading ? (
                <ValueSkeleton width={140} height={18} />
              ) : (
                <>
                  <Text style={styles.handle} numberOfLines={1}>
                    <Text style={styles.handleAt}>@</Text>
                    {profileHandle ?? "Bread user"}
                  </Text>
                  <VerifiedBadge size={18} />
                </>
              )}
            </View>
          </View>
        </View>
      </Pressable>

      {/* Bio sits directly under the handle — who the person is reads before
          how many people follow them. Follower/following counts come after. */}
      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          openEditProfile();
        }}
        style={styles.bioButton}
        accessibilityRole="button"
        accessibilityLabel={socialProfile?.bio ? "Edit bio" : "Add bio"}
      >
        {socialProfile?.bio ? (
          <Text style={styles.bioText} numberOfLines={4}>
            {socialProfile.bio}
          </Text>
        ) : (
          <Text style={styles.bioPlaceholder}>+ Add bio</Text>
        )}
      </Pressable>

      {socialProfile ? (
        <>
          <Pressable
            onPress={() => setSocialScreenOpen(true)}
            style={styles.socialStatsRow}
            accessibilityRole="button">
            <View style={styles.socialStatItem}>
              <Text style={styles.socialStatCount}>{socialProfile.followerCount}</Text>
              <Text style={styles.socialStatLabel}>Followers</Text>
            </View>
            <View style={styles.socialStatItem}>
              <Text style={styles.socialStatCount}>{socialProfile.followingCount}</Text>
              <Text style={styles.socialStatLabel}>Following</Text>
            </View>
          </Pressable>
          {profileMeta ? <Text style={styles.socialProfileMeta}>{profileMeta}</Text> : null}
        </>
      ) : null}

      {/* Admin-only: create curated portfolio */}
      {isAdmin ? (
        <Pressable
          style={styles.adminCreateBtn}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setCreateCuratedOpen(true);
          }}
        >
          <Text style={styles.adminCreateBtnText}>🥪  Create Featured Portfolio</Text>
        </Pressable>
      ) : null}

      {/* Total P&L + range + chart (own profile) */}
      <View style={styles.portfolioBlock}>
        <View style={styles.portfolioValueRow}>
          <View>
            <Text style={styles.portfolioLabel}>PnL</Text>
            {!pnlHistoryLoading ? (
              <Text style={styles.portfolioBigValue}>{formatUsd(displayedPnlUsd)}</Text>
            ) : (
              <ValueSkeleton
                width={138}
                height={28}
                radius={8}
                accessibilityLabel="Loading realized P&L"
              />
            )}
          </View>
          <View style={styles.portfolioRangeToggle}>
            {PORTFOLIO_RANGES.map((r) => (
              <Pressable
                key={r}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setPortfolioScrub(null);
                  setPortfolioRange(r);
                }}
                style={styles.portfolioRangeBtn}
              >
                <Text
                  style={[
                    styles.portfolioRangeText,
                    portfolioRange === r && styles.portfolioRangeTextActive,
                  ]}
                >
                  {r}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {!pnlHistoryLoading ? (
          <Text
            style={[
              styles.portfolioAbsChange,
              { color: pnlPositive ? PORTFOLIO_UP : PORTFOLIO_DOWN },
            ]}
          >
            {displayedPnlPctLabel ?? "—"}
          </Text>
        ) : (
          <ValueSkeleton
            width={62}
            height={14}
            style={styles.portfolioChangeSkeleton}
            accessibilityLabel="Loading portfolio change"
          />
        )}

        <PnlChart
          points={pnlPoints}
          changeUsd={displayedPnlUsd}
          loading={pnlHistoryLoading}
          showHeader={false}
          onScrub={setPortfolioScrub}
          containerStyle={{ paddingHorizontal: 0, paddingBottom: 0, paddingTop: 10 }}
        />
      </View>
        </View>

        {/* index 1 — sticky tab bar; pins to the top when scrolled past. The
            row layout lives on an INNER view — RN's sticky-header wrapper
            mangles flex styles applied directly on the sticky child, which was
            stacking the two tabs vertically. */}
        <View style={styles.tabBar}>
          <View style={styles.tabBarRow}>
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync();
                setProfileTab("holdings");
              }}
              style={[styles.tab, profileTab === "holdings" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  profileTab === "holdings" && styles.tabTextActive,
                ]}
              >
                Holdings
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync();
                setProfileTab("posts");
              }}
              style={[styles.tab, profileTab === "posts" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  profileTab === "posts" && styles.tabTextActive,
                ]}
              >
                Posts
              </Text>
            </Pressable>
            {/* Trailing the tabs rather than sitting on its own row below them:
                it filters the Holdings list, so it belongs on the same line as
                the thing it filters — and a second full-width row of controls
                pushed the first holding below the fold. */}
            {profileTab === "holdings" ? (
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
          {profileTab === "holdings" ? (
            <HoldingsCategorySwitch
              value={holdingsCategory}
              onChange={changeHoldingsCategory}
            />
          ) : null}
        </View>

        {/* index 2 — the holdings / posts list */}
        <View style={styles.holdingsContent}>
        {/* Checked before the open-holdings skeletons below: settled history
            does not wait on the live balance classification that gates them. */}
        {profileTab === "holdings" && holdingsView === "Closed" ? (
          <ClosedHoldingsList
            positions={closedPositions}
            loading={closedLoading}
            error={closedError}
            hasMore={closedCursor !== null}
            category={holdingsCategory}
            onRetry={() => {
              void loadClosedPositions();
            }}
            onSelect={(position) => {
              void openClosedPosition(position);
            }}
            renderSkeletons={renderRowSkeletons}
            styles={styles}
          />
        ) : /* Skeletons only when there is genuinely nothing to show. A refresh
            over existing rows keeps them on screen and updates them in place —
            replacing a populated list with placeholders made a fast refresh
            look like a slow load. */
        (profileRefreshing && holdingCount === 0) ||
        (profileTab === "holdings" && !positionsClassified) ? (
          renderRowSkeletons(4, "Refreshing profile")
        ) : profileTab === "holdings" ? (
          holdingCount > 0 ? (
            <>
              {holdingsCategory === "all" || holdingsCategory === "sandwiches" ? (
                <>
                  {sandwichRows.map((row) => {
                    // Loaded when the per-sandwich read has answered — even
                    // with nothing, which is a real "unattributed" and not a
                    // wait. The recovery list is a second source of the same
                    // facts and settles it just as well.
                    const loadedCreator = sandwichCreators[row.position.sandwichId];
                    const recovered = recoverySandwichById.get(row.position.sandwichId);
                    const creator =
                      loadedCreator ?? getSandwichCreatorMeta(recovered ?? null);
                    return (
                      <SandwichHoldingCard
                        key={row.position.id}
                        row={row}
                        creator={creator}
                        creatorLoading={loadedCreator === undefined && !recovered}
                        provenance={
                          sandwichProvenance[row.position.sandwichId] ?? null
                        }
                        caption={sandwichCaptionFor(row.position.sandwichId)}
                        takes={ownTakesFor(row.position.sandwichId)}
                        onOpen={() => void openSandwichScreen(row)}
                      />
                    );
                  })}
                  {sandwichMessage ? (
                    <Text style={styles.sandwichMessage}>{sandwichMessage}</Text>
                  ) : null}
                  {holdingsCategory === "sandwiches" && sandwichRows.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyIcon}>🥪</Text>
                      <Text style={styles.emptyText}>No open sandwiches</Text>
                    </View>
                  ) : null}
                </>
              ) : null}
              {holdingsCategory === "all" || holdingsCategory === "perps" ? (
                <>
              {visiblePerpSandwichPositions.map((position) => {
                const value =
                  position.effectiveCollateralUsd ??
                  (position.marginUsdc ?? 0) + position.pnlAfterFundingUsd;
                const pnlPositive = position.pnlAfterFundingUsd >= 0;
                const pnlPct = pnlPercentageFromBasis(
                  position.pnlAfterFundingUsd,
                  position.marginUsdc,
                );
                const pnlPctLabel = formatPnlPercentage(pnlPct);
                const leg = position.legs[0];
                // The speaker's actual claim, not the generated Sandwich label.
                const title = position.sandwich.headline?.trim() || position.sandwich.name;
                const sideLabel = leg?.side === "short" ? "SHORT" : "LONG";
                const timestamp = formatTimestamp(
                  leg?.startMs ?? position.sandwich.source.startMs,
                );
                return (
                  <View key={`perp-sandwich:${position.id}`}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`${title}, ${sideLabel} ${formatLeverage(position.leverage ?? 1)}`}
                    accessibilityHint="Opens position details, auto close and close controls"
                    onPress={() => openPerpSandwichSheet(position)}
                    style={styles.leveragePositionCard}
                  >
                    <AssetLogo
                      uri={null}
                      fallbackUris={equityLogoFallbackUris(leg?.symbol ?? "")}
                      size={38}
                      borderRadius={19}
                      backgroundColor="transparent"
                      fallback={
                        <View style={styles.leverageLogoFallback}>
                          <Ionicons
                            name={leg?.side === "short" ? "trending-down" : "trending-up"}
                            size={19}
                            color={colors.text}
                          />
                        </View>
                      }
                    />
                    <View style={styles.leveragePositionCopy}>
                      <View style={styles.leveragePositionNameRow}>
                        <Text numberOfLines={1} style={styles.leveragePositionName}>
                          {title}
                        </Text>
                      </View>
                      {/* Direction with its multiplier, the asset, and where in
                          the episode the call was made. The timestamp is
                          dropped rather than faked when the source has no
                          timeline to point into. */}
                      <Text
                        style={[
                          styles.leveragePositionSide,
                          { color: leg?.side === "short" ? colors.negative : colors.positive },
                        ]}
                      >
                        {[
                          `${sideLabel} ${formatLeverage(position.leverage ?? 1)}`,
                          leg?.symbol?.toUpperCase(),
                          timestamp,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    <View style={styles.leveragePositionMetric}>
                      <Text style={styles.leveragePositionValue}>{formatUsd(value)}</Text>
                      {pnlPctLabel ? (
                        <Text
                          style={[
                            styles.leveragePositionPnl,
                            { color: pnlPositive ? colors.positive : colors.negative },
                          ]}
                        >
                          {pnlPctLabel}
                        </Text>
                      ) : null}
                    </View>
                  </PressableScale>
                  </View>
                );
              })}
              {visibleHyperliquidPositions.map((position) => {
                const pnlColor = position.unrealizedPnlUsd >= 0 ? colors.positive : colors.negative;
                const pnlPctLabel = formatPnlPercentage(
                  pnlPercentageFromBasis(position.unrealizedPnlUsd, position.marginUsedUsd),
                );
                const symbol = hyperliquidDisplaySymbol(position.coin).toUpperCase();
                const displayName = COMPANY_NAME_OVERRIDES[symbol] || symbol;
                return (
                  <View key={`hyperliquid:${position.coin}`}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName} ${position.side} position details`}
                    accessibilityHint="Opens position controls"
                    onPress={() => hyperliquidPositionSheetRef.current?.open(position)}
                    style={styles.leveragePositionCard}
                  >
                    <AssetLogo
                      uri={null}
                      size={40}
                      borderRadius={20}
                      backgroundColor={colors.surfaceAlt}
                      fallback={
                        <View style={styles.leverageLogoFallback}>
                          <Text style={styles.leverageLogoFallbackText}>
                            {displayName.slice(0, 1)}
                          </Text>
                        </View>
                      }
                    />
                    <View style={styles.leveragePositionCopy}>
                      <View style={styles.leveragePositionNameRow}>
                        <Text numberOfLines={1} style={styles.leveragePositionName}>
                          {displayName}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.leveragePositionSide,
                          { color: position.side === "long" ? colors.positive : colors.negative },
                        ]}
                      >
                        {position.side.toUpperCase()} {formatLeverage(position.leverage)}
                      </Text>
                    </View>
                    <View style={styles.leveragePositionMetric}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                        style={styles.leveragePositionValue}
                      >
                        {formatUsd(position.marginUsedUsd + position.unrealizedPnlUsd)}
                      </Text>
                      {pnlPctLabel ? (
                        <Text style={[styles.leveragePositionPnl, { color: pnlColor }]}>
                          {pnlPctLabel}
                        </Text>
                      ) : null}
                    </View>
                  </PressableScale>
                  </View>
                );
              })}
              {visiblePhoenixPositions.map((position) => {
                const side = position.positionSize < 0 ? "short" : "long";
                const pnlPositive = position.unrealizedPnl >= 0;
                const pnlColor = pnlPositive ? colors.positive : colors.negative;
                const entryNotional = Math.abs(position.positionSize * position.entryPrice);
                const pnlBasis = (position.marginUsd ?? 0) > 0
                  ? position.marginUsd
                  : entryNotional;
                const pnlPct = pnlPercentageFromBasis(
                  position.unrealizedPnl,
                  pnlBasis,
                );
                const pnlPctLabel = formatPnlPercentage(pnlPct);
                const symbol = position.symbol.toUpperCase();
                const displayName =
                  position.name?.trim() || COMPANY_NAME_OVERRIDES[symbol] || symbol;
                const currentPositionValue =
                  position.marginUsd === null || position.marginUsd === undefined
                    ? null
                    : position.marginUsd + position.unrealizedPnl;
                return (
                  <View key={`phoenix:${symbol}`}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName} ${side} position details`}
                    accessibilityHint="Opens position controls"
                    // Presented straight from the tap, never via an isOpen
                    // effect. See [[bottom-sheet-present-pattern]].
                    onPress={() => openPositionSheet(position)}
                    style={styles.leveragePositionCard}
                  >
                    <AssetLogo
                      {...perpLogoSources(position)}
                      size={40}
                      borderRadius={20}
                      backgroundColor={colors.surfaceAlt}
                      fallback={
                        <View style={styles.leverageLogoFallback}>
                          <Text style={styles.leverageLogoFallbackText}>
                            {displayName.slice(0, 1)}
                          </Text>
                        </View>
                      }
                    />
                    <View style={styles.leveragePositionCopy}>
                      <View style={styles.leveragePositionNameRow}>
                        <Text
                          numberOfLines={1}
                          style={styles.leveragePositionName}
                        >
                          {displayName}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.leveragePositionSide,
                          { color: side === "long" ? colors.positive : colors.negative },
                        ]}
                      >
                        {side.toUpperCase()}
                        {position.leverage ? ` ${formatLeverage(position.leverage)}` : ""}
                      </Text>
                    </View>
                    <View style={styles.leveragePositionMetric}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                        style={styles.leveragePositionValue}
                      >
                        {currentPositionValue === null ? "—" : formatUsd(currentPositionValue)}
                      </Text>
                      {pnlPctLabel ? (
                        <Text style={[styles.leveragePositionPnl, { color: pnlColor }]}>
                          {pnlPctLabel}
                        </Text>
                      ) : null}
                    </View>
                  </PressableScale>
                  </View>
                );
              })}
              {visiblePerpsPositions.map((position) => {
                const key = position.positionAddress ?? `${position.asset}-${position.side}`;
                const pnlPositive = position.pnl >= 0;
                const pnlColor = pnlPositive ? colors.positive : colors.negative;
                const pnlLine = formatPnlPercentage(
                  pnlPercentageFromBasis(position.pnl, position.collateral),
                );
                const assetSymbol = position.asset.replace(/x$/i, "").toUpperCase();
                const displayName = COMPANY_NAME_OVERRIDES[assetSymbol] ?? position.asset;
                return (
                  <PressableScale
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName} ${position.side} position`}
                    accessibilityHint="Opens the position on Jupiter"
                    onPress={() => {
                      const target = position.positionAddress
                        ? `https://jup.ag/perps-legacy/position/${position.positionAddress}`
                        : "https://jup.ag/perps";
                      void Linking.openURL(target);
                    }}
                    style={styles.leveragePositionCard}
                  >
                    <AssetLogo
                      uri={position.imageUri}
                      size={40}
                      borderRadius={20}
                      backgroundColor={colors.surfaceAlt}
                      fallback={
                        <View style={styles.leverageLogoFallback}>
                          <Text style={styles.leverageLogoFallbackText}>
                            {displayName.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                      }
                    />
                    <View style={styles.leveragePositionCopy}>
                      <View style={styles.leveragePositionNameRow}>
                        <Text numberOfLines={1} style={styles.leveragePositionName}>
                          {displayName}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.leveragePositionSide,
                          {
                            color:
                              position.side === "long" ? colors.positive : colors.negative,
                          },
                        ]}
                      >
                        {position.side.toUpperCase()} {formatLeverage(position.leverage)}
                      </Text>
                    </View>
                    <View style={styles.leveragePositionMetric}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                        style={styles.leveragePositionValue}
                      >
                        {formatUsd(position.value)}
                      </Text>
                      {pnlLine ? (
                        <Text style={[styles.leveragePositionPnl, { color: pnlColor }]}>
                          {pnlLine}
                        </Text>
                      ) : null}
                    </View>
                  </PressableScale>
                );
              })}
              {holdingsCategory === "perps" &&
              visiblePerpSandwichPositions.length === 0 &&
              visiblePhoenixPositions.length === 0 &&
              visibleHyperliquidPositions.length === 0 &&
              visiblePerpsPositions.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>📈</Text>
                  <Text style={styles.emptyText}>No open perps</Text>
                </View>
              ) : null}
                </>
              ) : null}
              {holdingsCategory === "all" || holdingsCategory === "tokens" ? (
                <>
              {holdingTokens.map((token, index) => {
                const rawName = token.name ?? token.symbol ?? "Token";
                const cleanedName = cleanStockName(rawName);
                const cleanSymbol = token.symbol ? cleanStockSymbol(token.symbol) : "";
                const overrideName = COMPANY_NAME_OVERRIDES[cleanSymbol];
                const tokenLabel = overrideName || cleanedName || (token.symbol ?? "Token");
                const costEntry = token.mint ? walletStore.costBasis[token.mint] : undefined;
                const currentPrice =
                  token.balance > 0 && token.usdValue && token.usdValue > 0
                    ? token.usdValue / token.balance
                    : null;
                const pnl = computeUnrealizedPnl(costEntry, token.balance, currentPrice);
                const pnlColor =
                  !pnl ? colors.textTertiary : pnl.pnlPct >= 0 ? colors.positive : colors.negative;
                const pnlLabel = formatPnlPercentage(pnl?.pnlPct);
                const isOpenable = !!(token.symbol && token.symbol.trim());
                return (
                  <Pressable
                    key={`${token.mint ?? tokenLabel}-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${tokenLabel} details`}
                    disabled={!isOpenable}
                    onPress={() => {
                      if (!isOpenable) return;
                      void Haptics.selectionAsync();
                      openStockDetail(token);
                    }}
                    style={({ pressed }) => [
                      styles.tokenRow,
                      pressed && isOpenable && styles.tokenRowPressed,
                    ]}
                  >
                    <AssetLogo
                      uri={token.icon}
                      size={40}
                      borderRadius={20}
                      backgroundColor={colors.surfaceAlt}
                      fallback={
                        <View style={styles.tokenIcon}>
                          <Text style={styles.tokenIconText}>
                            {tokenLabel.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                      }
                    />
                    <View style={styles.tokenTextWrap}>
                      <Text style={styles.tokenSymbol}>{tokenLabel}</Text>
                      {token.symbol ? (
                        <Text style={styles.tokenTicker}>{token.symbol}</Text>
                      ) : null}
                    </View>
                    <View style={styles.tokenValueColumn}>
                      <Text style={styles.tokenValue}>
                        {formatUsd(token.usdValue)}
                      </Text>
                      {pnlLabel ? (
                        <Text style={[styles.tokenPnl, { color: pnlColor }]} numberOfLines={1}>
                          {pnlLabel}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              {holdingsCategory === "tokens" && holdingTokens.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🪙</Text>
                  <Text style={styles.emptyText}>No open tokens</Text>
                </View>
              ) : null}
                </>
              ) : null}
            </>
          ) : balanceLoading || !positionsReady || perpsLoading || perpSandwichLoading || phoenixLoading ? (
            renderRowSkeletons(4, "Loading holdings")
          ) : !balanceError ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyText}>No holdings</Text>
            </View>
          ) : (
            // Balances failed AND nothing cached to fall back on. Without this
            // branch the tab renders nothing at all — a blank screen with no
            // explanation and no way to retry.
            <LoadErrorState
              size="section"
              title="Couldn't load holdings"
              onRetry={() => {
                void Haptics.selectionAsync();
                void walletStore.refresh();
              }}
            />
          )
        ) : myTimeline.length > 0 ? (
          // One episode is one card, exactly as in the feed — posting a card
          // per market repeated the same video player three times for a
          // three-call episode. `buildFeedItems` is the single place that
          // decides what a card is, so the Posts tab groups by calling it
          // rather than by re-deriving the rule here. Takes interleave by time.
          myTimeline.map((entry) => {
            if (entry.kind === "take") {
              const take = entry.take;
              return (
                <TakePostCard
                  key={entry.key}
                  take={take}
                  sandwich={myPosts?.find((post) => post.id === take.sandwichId) ?? null}
                  onPress={openTakeSandwich}
                />
              );
            }
            const item = entry.item;
            return item.kind === "video" ? (
              <PodcastGroupCard
                key={item.key}
                video={item.video}
                sandwiches={item.sandwiches}
                onOpenGroup={openPostGroup}
                onToggleLikeGroup={togglePostLikeGroup}
                onComment={openPostComments}
                onShare={handlePostShare}
              />
            ) : item.kind === "sandwich" ? (
              <SandwichCard
                key={item.key}
                sandwich={item.sandwich}
                onPress={openPost}
                onToggleLike={handlePostToggleLike}
                onComment={openPostComments}
                onShare={handlePostShare}
              />
            ) : null;
          })
        ) : (postsLoading && myPosts === null) || myTakes === null ? (
          renderRowSkeletons(3, "Loading posts")
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🥪</Text>
            <Text style={styles.emptyText}>No posts yet</Text>
          </View>
        )}
        </View>
      </ScrollView>

      <PodcastHoldingMomentModal
        data={podcastHoldingMoment}
        onDismiss={() => setPodcastHoldingMoment(null)}
        onOpenFullPost={() => {
          const current = podcastHoldingMoment;
          if (!current) return;
          setPodcastHoldingMoment(null);
          router.push({
            pathname: '/podcast-sandwich',
            params: {
              sourceId: current.provenance.sourceId,
              focus: current.position.sandwichId,
            },
          });
        }}
        onShare={() => {
          const sandwich = podcastHoldingMoment?.sandwich;
          if (!sandwich) return;
          setPodcastHoldingMoment(null);
          postShareSheetRef.current?.open(sandwich);
        }}
        // The same drawers the episode screen raises — the call sheet to buy,
        // the sell pad under the call's caption to close — presented as a
        // transparent modal over this drawer, which stays put underneath.
        onBuyMore={() => openPodcastCall("buy")}
        onSell={() => openPodcastCall("close")}
      />

      <PositionDetailSheet
        ref={positionDetailSheetRef}
        data={focusedPosition}
        onDismiss={() => setFocusedPosition(null)}
        onShare={shareFocusedPosition}
        onBuyMore={() => {
          setSandwichTradeAmount("5");
          setSandwichTradeSide("buy");
          sandwichTradeSheetRef.current?.present();
        }}
        onClosePosition={() => {
          setSandwichTradeAmount(
            selectedSandwichRow?.usdValue
              ? selectedSandwichRow.usdValue.toFixed(2)
              : "5",
          );
          setSandwichTradeSide("sell");
          sandwichTradeSheetRef.current?.present();
        }}
        onViewFull={(data) => {
          void viewFullFocusedPosition(data);
        }}
      />
      <PositionShareSheet ref={positionShareSheetRef} />
      <Modal
        visible={selectedPerpSandwich !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPerpSandwich(null)}
      >
        <View style={styles.perpBasketBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close perp Sandwich details"
            style={StyleSheet.absoluteFill}
            onPress={() => setSelectedPerpSandwich(null)}
          />
          {selectedPerpSandwich ? (
            <View style={styles.perpBasketSheet}>
              <View style={styles.perpBasketHandle} />
              <View style={styles.perpBasketHeader}>
                <View style={styles.perpBasketHeaderCopy}>
                  <Text style={styles.perpBasketTitle}>{selectedPerpSandwich.sandwich.name}</Text>
                  <Text style={styles.perpBasketSubtitle}>
                    {formatLeverage(selectedPerpSandwich.leverage ?? 1)} · {selectedPerpSandwich.legs.length} {selectedPerpSandwich.legs.length === 1 ? "leg" : "legs"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={() => setSelectedPerpSandwich(null)}
                  style={styles.perpBasketClose}
                >
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>
              <View style={styles.perpBasketSummary}>
                <View>
                  <Text style={styles.perpBasketMetricLabel}>Total value</Text>
                  <Text style={styles.perpBasketMetricValue}>
                    {formatUsd(
                      selectedPerpSandwich.effectiveCollateralUsd ??
                        (selectedPerpSandwich.marginUsdc ?? 0) +
                          selectedPerpSandwich.pnlAfterFundingUsd,
                    )}
                  </Text>
                </View>
                <View style={styles.perpBasketMetricRight}>
                  <Text style={styles.perpBasketMetricLabel}>PnL after funding</Text>
                  <Text
                    style={[
                      styles.perpBasketMetricValue,
                      {
                        color:
                          selectedPerpSandwich.pnlAfterFundingUsd >= 0
                            ? colors.positive
                            : colors.negative,
                      },
                    ]}
                  >
                    {`${selectedPerpSandwich.pnlAfterFundingUsd >= 0 ? "+" : "-"}$${Math.abs(selectedPerpSandwich.pnlAfterFundingUsd).toFixed(2)}`}
                  </Text>
                </View>
              </View>
              <ScrollView style={styles.perpBasketLegs} showsVerticalScrollIndicator={false}>
                {selectedPerpSandwich.legs.map((leg) => (
                  <View key={`${leg.symbol}:${leg.subaccountIndex ?? "legacy"}`} style={styles.perpBasketLeg}>
                    <View style={styles.perpBasketLegTop}>
                      <Text style={styles.perpBasketLegSymbol}>{leg.symbol}</Text>
                      <Text
                        style={[
                          styles.perpBasketLegSide,
                          { color: leg.side === "long" ? colors.positive : colors.negative },
                        ]}
                      >
                        {leg.side.toUpperCase()} · {(leg.weightBps / 100).toFixed(0)}%
                      </Text>
                    </View>
                    <Text style={styles.perpBasketLegDetail}>
                      Entry {leg.entryPrice ? formatUsd(leg.entryPrice) : "—"} · Mark {leg.markPrice ? formatUsd(leg.markPrice) : "—"}
                    </Text>
                    <Text style={styles.perpBasketLegDetail}>
                      Stop {leg.stopLossPrice ? formatUsd(leg.stopLossPrice) : "—"} · Liq {leg.liquidationPrice ? formatUsd(leg.liquidationPrice) : "—"}
                    </Text>
                  </View>
                ))}
              </ScrollView>
              {selectedPerpSandwich.actionableStatus !== "none" ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={
                    selectedPerpSandwich.actionableStatus === "close"
                      ? "Close Sandwich"
                      : "Move collateral to Phoenix"
                  }
                  disabled={perpSandwichActionId !== null}
                  onPress={() => void runPerpSandwichAction(selectedPerpSandwich)}
                  style={[styles.perpBasketPrimary, perpSandwichActionId !== null && styles.perpBasketPrimaryDisabled]}
                >
                  <Text style={styles.perpBasketPrimaryText}>
                    {perpSandwichActionId === selectedPerpSandwich.id
                      ? "Working…"
                      : selectedPerpSandwich.actionableStatus === "close"
                        ? "Close Sandwich"
                        : "Move collateral to Phoenix"}
                  </Text>
                </PressableScale>
              ) : selectedPerpSandwich.status === "closed" ? (
                <>
                  {/* An isolated close already swept every child subaccount back
                      to the cross account, so there is nothing left to move for
                      THIS position — the money is in the perps balance, and the
                      account sheet is where it leaves for cash. */}
                  <Text style={styles.perpBasketNote}>
                    Collateral was returned to your perps balance.
                  </Text>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Withdraw perps collateral to cash"
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setSelectedPerpSandwich(null);
                      phoenixAccountSheetRef.current?.open("withdraw");
                    }}
                    style={styles.perpBasketPrimary}
                  >
                    <Text style={styles.perpBasketPrimaryText}>Withdraw to cash</Text>
                  </PressableScale>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      </Modal>
      <HyperliquidPositionSheet
        ref={hyperliquidPositionSheetRef}
        onChanged={() => {
          // Re-read once the venue can see the fill — see SETTLE_REFRESH_MS.
          setTimeout(() => {
            setPortfolioRefreshKey((value) => value + 1);
            loadHyperliquidData();
          }, SETTLE_REFRESH_MS);
        }}
      />
      <PhoenixAccountSheet
        ref={phoenixAccountSheetRef}
        onAccountChanged={(move) => {
          // After a move, wait for the reads to see it — see SETTLE_REFRESH_MS.
          const refresh = () => {
            setPortfolioRefreshKey((value) => value + 1);
            void loadPhoenixData();
          };
          if (move) setTimeout(refresh, SETTLE_REFRESH_MS);
          else refresh();
        }}
      />
      <TradeAmountSheet
        ref={sandwichTradeSheetRef}
        // Presented over the podcast holding drawer; glass over a second sheet
        // smears, so this one is opaque.
        solid
        side={sandwichTradeSide ?? "buy"}
        title={sandwichTradeSide === "sell" ? "Sell Sandwich" : "Buy Sandwich"}
        amount={sandwichTradeAmount}
        amountUnitSymbol="$"
        amountUnitLabel="dollars"
        amountUnitPosition="prefix"
        message={sandwichMessage}
        submitting={sandwichTrading}
        canConfirm={canSubmitSandwichTrade}
        onClose={() => setSandwichTradeSide(null)}
        onSubmitPressIn={() => {
          if (sandwichTradeSide === "sell") warmSandwichSell();
          else if (sandwichTradeSide === "buy") warmSandwichBuy();
        }}
        onSubmit={() => {
          if (!selectedTradePosition || !sandwichTradeSide) return;
          if (sandwichTradeSide === "buy") {
            void buySandwichPosition(
              selectedTradePosition,
              sandwichTradeAmount,
            );
          } else {
            void sellSandwich(selectedTradePosition, sandwichTradeAmount);
          }
        }}
        onTapDigit={(digit) => {
          setSandwichMessage(null);
          // A build is only valid for the fraction it was made at.
          warmedSellRef.current = null;
          warmedBuyRef.current = null;
          setSandwichTradeAmount((current) => tapAmountKey(current, digit));
        }}
        onTapPreset={(value) => {
          setSandwichMessage(null);
          // A build is only valid for the fraction it was made at, and a preset
          // changes it. Dropping the stale one and starting the build for the
          // new size here — rather than waiting for touch-down on Confirm —
          // covers the common exit: tap "all of it", tap Sell.
          warmedSellRef.current = null;
          warmedBuyRef.current = null;
          setSandwichTradeAmount(value);
          if (sandwichTradeSide === "sell") warmSandwichSell(value);
          else if (sandwichTradeSide === "buy") warmSandwichBuy(value);
        }}
        confirmLabel={
          sandwichInsufficient
            ? "Insufficient balance"
            : sandwichTradeSide === "sell"
              ? "Sell"
              : "Buy"
        }
        availableLabel={
          sandwichTradeSide === "buy"
            ? `Cash balance: $${cash.totalCash.toFixed(2)}`
            : sandwichSellAvailableLabel
        }
        submittingLabel={
          sandwichTradeSide === "sell" ? "Selling..." : "Buying..."
        }
        presets={sandwichTradePresets}
      />
      <DepositSheet
        ref={depositSheetRef}
        walletAddress={primarySolanaAddress}
        onCheckout={handleDeposit}
      />
      <WithdrawSheet ref={withdrawSheetRef} />
      <SandwichShareSheet ref={postShareSheetRef} />
      <TopToast toast={toast} />
      {user ? (
        <SocialScreen
          visible={socialScreenOpen}
          onClose={() => {
            setSocialScreenOpen(false);
            if (!pendingViewedUser) {
              setViewingUser(null);
            }
          }}
          targetPrivyUserId={user.id}
          viewerPrivyUserId={user.id}
          viewerPayload={appUserPayloadFromPrivyUser(user)}
          targetUsername={profileHandle ?? "Bread user"}
          initialFollowerCount={socialProfile?.followerCount ?? 0}
          initialFollowingCount={socialProfile?.followingCount ?? 0}
          onSelectUser={(entry) => {
            setUserProfileOpen(false);
            setViewingUser(null);
            setPendingViewedUser({ privyUserId: entry.privyUserId });
            setSocialScreenOpen(false);
          }}
        />
      ) : null}
      {viewingUser ? (
        <UserProfileScreen
          visible={userProfileOpen}
          onClose={() => setUserProfileOpen(false)}
          targetPrivyUserId={viewingUser.privyUserId}
          viewerPrivyUserId={user?.id ?? null}
          viewerPayload={user ? appUserPayloadFromPrivyUser(user) : null}
        />
      ) : null}

      <CreateCuratedSandwichScreen
        visible={createCuratedOpen}
        onClose={() => setCreateCuratedOpen(false)}
        userPayload={user ? appUserPayloadFromPrivyUser(user) : null}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => {
  const isDark = c.background !== "#ffffff";
  // A pastel wash in light, the same accent at low alpha in dark.
  const wash = (accent: string, pastel: string) => (isDark ? withAlpha(accent, 0.18) : pastel);
  return StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: c.background,
  },
  perpBasketBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  perpBasketSheet: {
    maxHeight: "82%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    backgroundColor: c.surface,
  },
  perpBasketHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 18,
    backgroundColor: c.border,
  },
  perpBasketHeader: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  perpBasketHeaderCopy: { flex: 1 },
  perpBasketTitle: { color: c.text, fontFamily: Fonts.rounded, fontSize: 22, fontWeight: "800" },
  perpBasketSubtitle: { color: c.textSecondary, fontFamily: Fonts.rounded, fontSize: 13, marginTop: 3 },
  perpBasketClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceAlt,
  },
  perpBasketSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    backgroundColor: c.surfaceAlt,
  },
  perpBasketMetricRight: { alignItems: "flex-end" },
  perpBasketMetricLabel: { color: c.textSecondary, fontFamily: Fonts.rounded, fontSize: 12 },
  perpBasketMetricValue: { color: c.text, fontFamily: Fonts.rounded, fontSize: 18, fontWeight: "800", marginTop: 5 },
  perpBasketLegs: { flexGrow: 0, marginBottom: 14 },
  perpBasketLeg: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  perpBasketLegTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  perpBasketLegSymbol: { color: c.text, fontFamily: Fonts.rounded, fontSize: 16, fontWeight: "800" },
  perpBasketLegSide: { fontFamily: Fonts.rounded, fontSize: 12, fontWeight: "800" },
  perpBasketLegDetail: { color: c.textSecondary, fontFamily: Fonts.rounded, fontSize: 12, marginTop: 5 },
  perpBasketPrimary: { height: 54, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: c.text },
  perpBasketPrimaryDisabled: { opacity: 0.55 },
  perpBasketNote: {
    color: c.textSecondary,
    fontFamily: Fonts.rounded,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 10,
  },
  perpBasketPrimaryText: { color: c.background, fontFamily: Fonts.rounded, fontSize: 16, fontWeight: "800" },
  container: {
    padding: 16,
    gap: 12,
    paddingBottom: 140,
  },
  profileHeader: {
    paddingHorizontal: 20,
    marginTop: 36,
    gap: 10,
  },
  profileTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: c.surfaceAlt,
  },
  avatarDefault: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: c.textInverse,
    fontSize: 20,
    fontWeight: "800",
    fontFamily: F,
  },
  profileInfo: {
    flex: 1,
    paddingRight: 8,
  },
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  xLogoBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  identityCol: {
    flex: 1,
    justifyContent: "center",
    gap: 2,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  handle: {
    color: c.text,
    fontWeight: "900",
    fontSize: 23,
    fontFamily: F,
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  handleAt: {
    color: c.textQuaternary,
    fontWeight: "400",
    fontSize: 17,
  },
  verifiedBadge: {
    width: 18,
    height: 18,
    resizeMode: "contain",
  },
  addressText: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
    fontFamily: F,
  },
  socialStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 18,
    marginTop: 10,
    // Far-left page margin, aligned under the profile picture.
    paddingLeft: 20,
  },
  socialStatItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  socialStatCount: {
    color: c.text,
    fontSize: 18,
    fontWeight: '900',
    fontFamily: F,
  },
  socialStatLabel: {
    color: c.textTertiary,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: F,
  },
  socialProfileMeta: {
    color: c.textTertiary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    fontFamily: F,
    marginTop: 6,
    paddingLeft: 20,
  },
  bioText: {
    color: c.textSecondary,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    fontFamily: F,
  },
  bioButton: {
    marginTop: 10,
    paddingHorizontal: 20,
  },
  bioPlaceholder: {
    color: c.textTertiary,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: F,
    alignSelf: 'flex-start',
    backgroundColor: c.surfaceAlt,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  adminCreateBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: c.text,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  adminCreateBtnText: {
    color: c.textInverse,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: Fonts.rounded,
  },
  cardSection: {
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  portfolioBlock: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6 },
  portfolioValueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  portfolioBigValue: {
    color: c.text,
    fontSize: 28,
    fontWeight: "900",
    fontFamily: F,
    letterSpacing: -1,
  },
  portfolioLabel: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
    marginBottom: 2,
  },
  portfolioChangeSkeleton: {
    marginTop: 6,
  },
  portfolioAbsChange: { fontSize: 17, fontWeight: "900", fontFamily: Fonts.displayMedium, marginTop: 2 },
  portfolioRangeToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  portfolioRangeBtn: { paddingVertical: 2 },
  portfolioRangeText: { color: c.iconMuted, fontSize: 14, fontWeight: "800", fontFamily: F },
  portfolioRangeTextActive: { color: c.text },
  cashCardWrapper: {
    // Standard ID-1 / credit-card aspect ratio (85.6mm × 53.98mm ≈ 1.586).
    height: 200,
    aspectRatio: 1.586,
    alignSelf: "flex-start",
    marginVertical: 12,
  },
  cashCardFace: {
    position: "absolute",
    width: "100%",
    height: "100%",
    backfaceVisibility: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  cashCardBack: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  cardTexture: {
    borderRadius: 24,
    opacity: 0.92,
  },
  cardPnlRow: {
    position: "absolute",
    bottom: 14,
    right: 16,
    alignItems: "flex-end",
  },
  cardPnlPercent: {
    color: "#02ED45",
    fontSize: 13,
    fontWeight: "900",
    fontFamily: F,
  },
  cardPnlAmount: {
    color: "#02ED45",
    fontSize: 11,
    fontWeight: "700",
    fontFamily: F,
    marginTop: 1,
  },
  cashCard: {
    flex: 1,
    borderRadius: 24,
    padding: 24,
    justifyContent: "center",
    alignItems: "flex-start",
    overflow: "hidden",
  },
  cashCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardChip: {
    fontSize: 18,
  },
  cashLabel: {
    // #00000087 ≈ rgba(0,0,0,0.53); weight 900 / 5% letter-spacing per Figma.
    color: "rgba(0,0,0,0.53)",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.7,
    fontFamily: F,
  },
  cashValueMask: {
    alignSelf: "flex-start",
    marginTop: 4,
  },
  cashValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  cashValue: {
    // Solid black so the MaskedView alpha covers the full glyphs; the visible
    // color comes from the gradient behind the mask. 56px = Figma 1200 unit.
    color: "#000000",
    fontSize: 56,
    lineHeight: 56,
    fontWeight: "800",
    fontFamily: F,
  },
  cashValueDecimal: {
    // 900/1200 of the integer size per Figma (42 = 56 × 0.75).
    color: "#000000",
    fontSize: 42,
    lineHeight: 42,
    fontWeight: "800",
    fontFamily: F,
  },
  cashCardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  cashStatLabel: {
    color: "rgba(0,0,0,0.4)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    fontFamily: F,
  },
  cashStatValue: {
    color: "#000000",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 2,
    fontFamily: F,
  },
  cashStatRight: {
    alignItems: "flex-end",
  },
  cardBackStripe: {
    height: 32,
    backgroundColor: "rgba(0,0,0,0.15)",
    marginHorizontal: -18,
    marginTop: -2,
  },
  cardBackContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  cardBackLabel: {
    color: "rgba(0,0,0,0.5)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    fontFamily: F,
  },
  cardBackAddress: {
    color: "rgba(0,0,0,0.7)",
    fontSize: 11,
    fontWeight: "600",
    fontFamily: F,
    letterSpacing: 0.3,
  },
  cardBackBtnRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  withdrawBtn: {
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  withdrawBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  withdrawBtnOutline: {
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  withdrawBtnOutlineText: {
    color: "#000000",
    fontSize: 13,
    fontWeight: "800",
    fontFamily: F,
  },
  cardBackFooter: {
    color: "rgba(0,0,0,0.3)",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    fontFamily: F,
  },
  // Outer sticky container: only chrome (bg and padding). No flex layout
  // here — RN's sticky-header wrapper mangles flex on the sticky child itself.
  tabBar: {
    width: "100%",
    paddingHorizontal: 20,
    // Opaque background keeps holding rows hidden once the tabs are pinned.
    backgroundColor: c.background,
    paddingTop: 10,
    paddingBottom: 8,
  },
  // Inner row (not sticky) carries the horizontal layout reliably.
  tabBarRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    // Both tabs cluster on the left, side by side.
    justifyContent: "flex-start",
    gap: 14,
  },
  holdingsList: {
    flex: 1,
    backgroundColor: c.background,
  },
  holdingsContent: {
    paddingHorizontal: 20,
    paddingBottom: 140,
  },
  compactHeader: {
    position: "absolute",
    top: 76,
    left: 16,
    zIndex: 9,
  },
  compactHandle: {
    color: c.text,
    fontSize: 18,
    fontWeight: "800",
    fontFamily: F,
  },
  tab: {
    paddingVertical: 5,
    // Never squashed to make room for the trailing filter — the filter shrinks
    // instead. A wrapped "Holdings (12)" is far worse than a narrower picker.
    flexShrink: 0,
  },
  tabActive: {},
  tabText: {
    color: c.textQuaternary,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
    fontFamily: F,
  },
  tabTextActive: {
    color: c.text,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  skeletonList: {
    paddingTop: 4,
  },
  skeletonRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceSelected,
  },
  skeletonCopy: {
    flex: 1,
    gap: 7,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
    backgroundColor: c.surfaceAlt,
  },
  skeletonLinePrimary: {
    width: "58%",
  },
  skeletonLineSecondary: {
    width: "38%",
    opacity: 0.72,
  },
  skeletonLineValue: {
    width: 64,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyText: {
    color: c.textSecondary,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: F,
  },
  checkoutCloseBtn: {
    alignSelf: "flex-start",
    margin: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  checkoutCloseText: {
    color: c.text,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: F,
  },
  checkoutBody: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  checkoutAmountSection: {
    alignItems: "center",
    gap: 4,
  },
  checkoutLabel: {
    color: c.text,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: F,
  },
  checkoutAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkoutAmount: {
    color: c.text,
    fontSize: 64,
    fontWeight: "900",
    fontFamily: F,
  },
  usdcLogo: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  checkoutCurrency: {
    color: c.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 2,
    fontFamily: F,
  },
  checkoutBottom: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  balanceError: {
    marginTop: 8,
    color: c.negative,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    fontFamily: F,
    textAlign: "center",
  },
  holdingsRetryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: c.surfaceAlt,
  },
  holdingsRetryText: {
    color: c.text,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  tokenRowPressed: {
    opacity: 0.72,
  },
  leveragePositionCard: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  leveragePositionLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  leverageLogoFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  leverageLogoFallbackText: {
    color: c.text,
    fontSize: 14,
    fontWeight: "900",
    fontFamily: F,
  },
  leveragePositionCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  leveragePositionNameRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  leveragePositionName: {
    flexShrink: 1,
    color: c.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    fontFamily: F,
  },
  leveragePositionMultiplier: {
    flexShrink: 0,
    color: c.textSecondary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    fontFamily: F,
  },
  leveragePositionSide: {
    marginTop: 1,
    fontSize: 16,
    lineHeight: 19,
    fontFamily: Fonts.displayOne,
    letterSpacing: 0.2,
  },
  leveragePositionMetric: {
    width: 92,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  leveragePositionValue: {
    color: c.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "700",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  leveragePositionPnl: {
    marginTop: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  tokenIconImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  sandwichIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  tokenIconText: {
    color: c.accent,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: F,
  },
  tokenTextWrap: {
    flex: 1,
  },
  tokenSymbol: {
    color: c.text,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: F,
  },
  tokenTicker: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
    fontFamily: F,
  },
  // Sized to match leveragePositionValue / leveragePositionPnl (perp rows) so
  // every holding's right-hand value + PnL reads at the same scale.
  tokenValue: {
    color: c.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "700",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  tokenValueColumn: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 1,
  },
  tokenPnl: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  toastWrap: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    zIndex: 200,
    alignItems: "center",
  },
  toastPill: {
    maxWidth: "100%",
    minHeight: 38,
    borderRadius: 19,
    backgroundColor: c.surface,
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
    elevation: 60,
  },
  toastText: {
    fontSize: 13,
    fontWeight: "900",
    fontFamily: F,
  },
  sheetBg: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.iconMuted,
    marginBottom: 18,
  },
  sandwichSheetContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 42,
  },
  sandwichSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sandwichIconLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  sandwichIconImgLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  sandwichSheetTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  sandwichSheetTitle: {
    color: c.text,
    fontSize: 19,
    lineHeight: 23,
    fontWeight: "900",
    fontFamily: F,
  },
  sandwichSheetSubtitle: {
    marginTop: 3,
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: F,
  },
  sandwichSheetValue: {
    color: c.text,
    fontSize: 20,
    fontWeight: "900",
    fontFamily: F,
  },
  sandwichActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  sandwichActionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sandwichBuyButton: {
    backgroundColor: c.accent,
  },
  sandwichSellButton: {
    backgroundColor: wash(c.negative, "#FFEFF1"),
  },
  sandwichBuyButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    fontFamily: F,
  },
  sandwichSellButtonText: {
    color: c.negative,
    fontSize: 16,
    fontWeight: "900",
    fontFamily: F,
  },
  sandwichChartSection: {
    marginTop: 18,
  },
  sandwichLegPanel: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  sandwichLegHoldingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  legHoldingMetric: {
    alignItems: "flex-end",
  },
  legHoldingWeight: {
    color: c.text,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: F,
  },
  legHoldingValue: {
    marginTop: 3,
    color: c.text,
    fontSize: 14,
    fontWeight: "900",
    fontFamily: F,
  },
  positionActionColumn: {
    alignItems: "flex-end",
    gap: 6,
  },
  positionBuyButton: {
    borderRadius: 999,
    backgroundColor: wash(c.positive, "#eefcf0"),
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  positionBuyButtonText: {
    color: c.positive,
    fontSize: 12,
    fontWeight: "900",
    fontFamily: F,
  },
  positionSellButton: {
    borderRadius: 999,
    backgroundColor: wash(c.negative, "#FFEFF1"),
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  positionSellButtonText: {
    color: c.negative,
    fontSize: 12,
    fontWeight: "900",
    fontFamily: F,
  },
  sandwichMessage: {
    color: c.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
    marginVertical: 8,
    fontFamily: F,
  },
  sectionTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 8,
    fontFamily: F,
  },
  // The Open / Closed picker, pushed to the trailing edge of the tab row.
  // `marginLeft: auto` rather than a spacer view so the tabs keep their natural
  // widths and the control simply takes what is left.
  // The Open / Closed picker, pushed to the trailing edge of the tab row. It
  // takes whatever the two tabs leave rather than claiming a fixed width:
  // "Holdings (12)" at 20pt/900 plus "Posts" already eats most of a 375pt
  // screen, and a fixed control overflowed the row and wrapped the tab labels.
  // The component measures itself and hands the result to SwiftUI's `frame`.
  tabBarFilter: {
    marginLeft: "auto",
    flexShrink: 1,
    minWidth: 108,
    maxWidth: 148,
    // Optically centres the control against the 20pt tab text on a row that is
    // otherwise bottom-aligned.
    marginBottom: 2,
  },
  // A separate, left-aligned filter row keeps asset types distinct from the
  // Open / Closed time-state control above it without filling unused width.
  body: {
    marginTop: 4,
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: F,
  },
  hamburgerBtn: {
    position: "absolute",
    top: 0,
    right: 16,
    zIndex: 10,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  hamburgerLine: {
    width: 22,
    height: 2,
    borderRadius: 1,
    backgroundColor: c.text,
  },
  linkXInlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: c.surfaceAlt,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  linkXInlineText: {
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  card: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 16,
  },
  profileCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
});
};
