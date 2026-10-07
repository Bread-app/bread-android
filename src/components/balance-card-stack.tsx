import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { CARD_ASPECT_RATIO } from "@/components/balance-card-shell";
import { CashCard } from "@/components/cash-card";
import { HyperliquidAccountSheet } from "@/components/hyperliquid-account-sheet";
import { PerpCard, type PerpCardSummary } from "@/components/perp-card";
import {
  PhoenixAccountSheet,
  SETTLE_REFRESH_MS,
  type PhoenixAccountSheetMode,
  type PhoenixAccountSheetRef,
  type PhoenixCollateralMove,
} from "@/components/phoenix-account-sheet";
import { Fonts } from "@/constants/theme";
import { ValueSkeleton } from "@/components/value-skeleton";
import { getHyperliquidAccount, HyperliquidApiError } from "@/lib/hyperliquid-api";
import { PERPS_VENUE, type PerpsVenue } from "@/lib/perps-venue";
import { getPhoenixAccount, PhoenixApiError } from "@/lib/phoenix-api";

const EMPTY_PERP_SUMMARY: PerpCardSummary = {
  registered: false,
  portfolioValue: 0,
  collateral: 0,
  withdrawable: 0,
  unrealizedPnl: 0,
  positionCount: 0,
  openOrderCount: 0,
};

/**
 * The perps card's figures from whichever venue holds the balance. Resolves
 * `EMPTY_PERP_SUMMARY` when there is simply no account, and throws on a real
 * read failure so the card shows a dash rather than a wiped-looking zero.
 */
async function loadPerpSummary(venue: PerpsVenue): Promise<PerpCardSummary> {
  if (venue === "hyperliquid") {
    try {
      const { account } = await getHyperliquidAccount();
      return {
        // An address Hyperliquid has never seen reads as "not activated"; the
        // card's Activate opens the deposit pad, whose first move creates it.
        registered: account.exists,
        portfolioValue: account.accountValue,
        collateral: account.accountValue - account.unrealizedPnl,
        withdrawable: account.withdrawable,
        unrealizedPnl: account.unrealizedPnl,
        positionCount: account.positionCount,
        openOrderCount: 0,
      };
    } catch (error) {
      const code = error instanceof HyperliquidApiError ? error.code : null;
      if (code === "no_wallet" || code === "no_evm_wallet" || code === "Unauthorized") {
        return EMPTY_PERP_SUMMARY;
      }
      throw error;
    }
  }

  try {
    const data = await getPhoenixAccount();
    const cross = data.account.cross;
    return {
      registered: data.account.registered,
      portfolioValue: cross?.portfolioValue ?? 0,
      collateral: cross?.collateralBalance ?? 0,
      withdrawable: cross?.effectiveCollateralForWithdrawals ?? 0,
      unrealizedPnl: cross?.unrealizedPnl ?? 0,
      positionCount: cross?.positions.length ?? 0,
      openOrderCount: cross?.openOrderCount ?? 0,
    };
  } catch (error) {
    // "No wallet yet" and "not signed in" are not failures — there is simply
    // no perps account, which the card already has copy for.
    const code = error instanceof PhoenixApiError ? error.code : null;
    if (code === "no_wallet" || code === "Unauthorized") return EMPTY_PERP_SUMMARY;
    throw error;
  }
}

const F = Fonts.rounded;

function formatPeekUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** How much of the back card stays visible above the front one, in points. */
const PEEK = 30;
/** How much the back card shrinks. Scaled from its top edge, so the peek is exact. */
const BACK_SCALE = 0.93;

type BalanceCardStackProps = {
  /** Show both cards in full rather than an overlapping stack. */
  stacked?: boolean;
  /** Include a separate Hyperliquid card alongside Phoenix perps. */
  includeHyperliquid?: boolean;
  venue?: PerpsVenue;
  /** Pre-formatted cash balance, e.g. "$1,234.56". `null` while it loads. */
  balanceLabel: string | null;
  walletAddress: string | null;
  onWithdraw?: () => void;
  /** Bump to re-read the perps account (pull-to-refresh, screen focus). */
  refreshKey?: number;
};

export type BalanceCardStackRef = {
  /**
   * Opens the cash <-> perps transfer sheet the perps card already owns, so a
   * caller can offer the move without the user having to flip a card first.
   */
  openTransfer: (mode?: PhoenixAccountSheetMode) => void;
};

/**
 * The wallet's balance cards, stacked like cards in a hand: the active one
 * sits in front, the others peek out above it. Tapping the peeking card brings
 * it forward; tapping the front card flips it, as before.
 *
 * Index 0 is cash, index 1 is perps, and optional index 2 is Hyperliquid. They are deliberately separate surfaces —
 * perps collateral is not spendable cash, and stacking them keeps that visible
 * without implying the two numbers add up.
 */
export const BalanceCardStack = React.forwardRef<
  BalanceCardStackRef,
  BalanceCardStackProps
>(function BalanceCardStack(
  { balanceLabel, walletAddress, onWithdraw, refreshKey = 0, stacked = true, venue = PERPS_VENUE, includeHyperliquid = false },
  ref,
) {
  const showHyperliquid = includeHyperliquid && venue !== "hyperliquid";
  const cardCount = showHyperliquid ? 3 : 2;
  const [order, setOrder] = useState<number[]>(() => showHyperliquid ? [2, 1, 0] : [1, 0]);
  const activeIndex = order[order.length - 1];
  const [flipped, setFlipped] = useState<boolean[]>([false, false, false]);
  const [hyperliquid, setHyperliquid] = useState<PerpCardSummary | null>(null);
  const [hyperliquidLoading, setHyperliquidLoading] = useState(true);
  const [hyperliquidRefresh, setHyperliquidRefresh] = useState(0);
  const hyperliquidSheetRef = useRef<PhoenixAccountSheetRef>(null);
  const [perp, setPerp] = useState<PerpCardSummary | null>(null);
  const [perpLoading, setPerpLoading] = useState(true);
  // Bumped by the account sheet after a move, so the card figure and the sheet
  // never disagree about the balance the user just changed.
  const [selfRefresh, setSelfRefresh] = useState(0);
  const accountSheetRef = useRef<PhoenixAccountSheetRef>(null);

  useImperativeHandle(
    ref,
    () => ({
      openTransfer(mode: PhoenixAccountSheetMode = "deposit") {
        accountSheetRef.current?.open(mode);
      },
    }),
    [],
  );

  const ranks = useRef([
    new Animated.Value(cardCount - 1),
    new Animated.Value(cardCount - 2),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    Animated.parallel(order.map((index, rank) => Animated.spring(ranks[index], {
      toValue: rank,
      friction: 9,
      tension: 70,
      useNativeDriver: true,
    }))).start();
  }, [order, ranks]);

  useEffect(() => {
    if (!showHyperliquid) return;
    let cancelled = false;
    setHyperliquidLoading(true);
    void loadPerpSummary("hyperliquid")
      .then((summary) => { if (!cancelled) setHyperliquid(summary); })
      .catch(() => { if (!cancelled) setHyperliquid(null); })
      .finally(() => { if (!cancelled) setHyperliquidLoading(false); });
    return () => { cancelled = true; };
  }, [showHyperliquid, walletAddress, refreshKey, hyperliquidRefresh]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setPerpLoading(true);
      try {
        const summary = await loadPerpSummary(venue);
        if (!cancelled) setPerp(summary);
      } catch {
        // An em dash rather than a zero, so a transient venue outage never
        // looks like a wiped account.
        if (!cancelled) setPerp(null);
      } finally {
        if (!cancelled) setPerpLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, selfRefresh, walletAddress, venue]);

  // A move is shown the moment it lands, then re-read once Phoenix's view has
  // caught up — an immediate read can still return the pre-move balance.
  const applyAccountChange = useCallback((move?: PhoenixCollateralMove) => {
    if (!move) {
      setSelfRefresh((value) => value + 1);
      return;
    }
    const delta = move.mode === "deposit" ? move.amountUsd : -move.amountUsd;
    setPerp((current) =>
      current?.registered
        ? {
            ...current,
            portfolioValue: Math.max(0, current.portfolioValue + delta),
            collateral: Math.max(0, current.collateral + delta),
            withdrawable: Math.max(0, current.withdrawable + delta),
          }
        : current,
    );
    setTimeout(() => setSelfRefresh((value) => value + 1), SETTLE_REFRESH_MS);
  }, []);

  const bringToFront = useCallback((index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOrder((current) => [...current.filter((card) => card !== index), index]);
    // A card that drops to the back always shows its front face again.
    setFlipped([false, false, false]);
  }, []);

  const flip = useCallback((index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFlipped((current) => {
      const next = [...current];
      next[index] = !next[index];
      return next;
    });
  }, []);

  const layerStyle = (index: number) => ({
    zIndex: order.indexOf(index) + 1,
    elevation: (order.indexOf(index) + 1) * 6,
    transform: [
      { translateY: ranks[index].interpolate({
        inputRange: [0, cardCount - 1],
        outputRange: [0, (cardCount - 1) * PEEK],
      }) },
      { scale: ranks[index].interpolate({
        inputRange: [0, cardCount - 1],
        outputRange: [1 - (cardCount - 1) * (1 - BACK_SCALE), 1],
      }) },
    ],
  });

  const peekOpacity = (index: number) => ranks[index].interpolate({
    inputRange: [cardCount - 2, cardCount - 1],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  const handlePress = (index: number) => () => {
    if (!stacked || activeIndex === index) flip(index);
    else bringToFront(index);
  };

  // The perps balance mirrors PerpCard's own headline logic: a skeleton while
  // the account is still being read, a dash only when there is no figure.
  const perpPeekLoading = !perp && perpLoading;
  const perpPeekLabel = !perp
    ? "—"
    : !perp.registered
      ? "—"
      : formatPeekUsd(perp.portfolioValue);

  return (
    <View style={[styles.stack, !stacked && styles.cardList]}>
      {/* Sizes the stack: one card tall, plus room for the peeking card. */}
      {stacked ? <View style={[styles.sizer, { marginBottom: PEEK * (cardCount - 1) }]} pointerEvents="none" /> : null}

      <Animated.View style={stacked ? [styles.layer, layerStyle(0)] : undefined}>
        <CashCard
          balanceLabel={balanceLabel ?? "—"}
          loading={balanceLabel === null}
          walletAddress={walletAddress}
          onWithdraw={onWithdraw}
          flipped={flipped[0]}
          onPress={handlePress(0)}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.peekStrip, { opacity: peekOpacity(0) }, !stacked && styles.hiddenPeek]}
        >
          <Text style={[styles.peekLabel, styles.peekTextDark]}>CASH</Text>
          {balanceLabel === null ? (
            <ValueSkeleton
              width={78}
              height={13}
              color="rgba(0,0,0,0.16)"
              accessibilityLabel="Loading cash balance"
            />
          ) : (
            <Text style={[styles.peekValue, styles.peekTextDark]}>{balanceLabel}</Text>
          )}
        </Animated.View>
      </Animated.View>

      <Animated.View style={stacked ? [styles.layer, layerStyle(1)] : undefined}>
        <PerpCard
          venue={venue}
          summary={perp}
          loading={perpLoading}
          flipped={flipped[1]}
          onPress={handlePress(1)}
          onAddCash={() => accountSheetRef.current?.open("deposit")}
          onWithdraw={() => accountSheetRef.current?.open("withdraw")}
          onActivate={() => accountSheetRef.current?.open("deposit")}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.peekStrip, { opacity: peekOpacity(1) }, !stacked && styles.hiddenPeek]}
        >
          <Text style={[styles.peekLabel, styles.peekTextLight, venue === 'hyperliquid' && styles.hyperliquidPeek]}>
            {venue === 'hyperliquid' ? 'HYPERLIQUID' : 'PERPS'}
          </Text>
          {perpPeekLoading ? (
            <ValueSkeleton
              width={78}
              height={13}
              color="rgba(255,255,255,0.20)"
              accessibilityLabel={venue === 'hyperliquid' ? 'Loading Hyperliquid balance' : 'Loading perps balance'}
            />
          ) : (
            <Text style={[styles.peekValue, styles.peekTextLight]}>{perpPeekLabel}</Text>
          )}
        </Animated.View>
      </Animated.View>

      {showHyperliquid ? (
        <Animated.View style={stacked ? [styles.layer, layerStyle(2)] : undefined}>
          <PerpCard
            venue="hyperliquid"
            summary={hyperliquid}
            loading={hyperliquidLoading}
            flipped={flipped[2]}
            onPress={handlePress(2)}
            onAddCash={() => hyperliquidSheetRef.current?.open("deposit")}
            onWithdraw={() => hyperliquidSheetRef.current?.open("withdraw")}
            onActivate={() => hyperliquidSheetRef.current?.open("deposit")}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.peekStrip, { opacity: peekOpacity(2) }, !stacked && styles.hiddenPeek]}
          >
            <Text style={[styles.peekLabel, styles.hyperliquidPeek]}>HYPERLIQUID</Text>
            {!hyperliquid && hyperliquidLoading ? (
              <ValueSkeleton width={78} height={13} color="rgba(255,255,255,0.20)" accessibilityLabel="Loading Hyperliquid balance" />
            ) : (
              <Text style={[styles.peekValue, styles.peekTextLight]}>
                {hyperliquid?.registered ? formatPeekUsd(hyperliquid.portfolioValue) : "—"}
              </Text>
            )}
          </Animated.View>
        </Animated.View>
      ) : null}
      {showHyperliquid ? (
        <HyperliquidAccountSheet
          ref={hyperliquidSheetRef}
          onAccountChanged={() => setHyperliquidRefresh((value) => value + 1)}
        />
      ) : null}

      {venue === "hyperliquid" ? (
        <HyperliquidAccountSheet ref={accountSheetRef} onAccountChanged={applyAccountChange} />
      ) : (
        <PhoenixAccountSheet ref={accountSheetRef} onAccountChanged={applyAccountChange} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  cardList: { gap: 20 },
  hiddenPeek: { display: 'none' },
  stack: {
    width: "100%",
    alignSelf: "stretch",
  },
  sizer: {
    width: "100%",
    aspectRatio: CARD_ASPECT_RATIO,
    marginBottom: PEEK,
  },
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // Android draws the elevation shadow from the view outline, so the layer
    // needs the card's own radius or the shadow comes out square.
    borderRadius: 24,
    // Scaling from the top edge keeps the back card's peek exactly PEEK tall,
    // instead of the shrink eating into it.
    transformOrigin: "top center",
  },
  // Compact balance shown in the visible peek strip of the back card.
  peekStrip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: PEEK,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  peekLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
    fontFamily: F,
  },
  peekValue: {
    fontSize: 15,
    fontWeight: "800",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  peekTextDark: { color: "rgba(0,0,0,0.72)" },
  peekTextLight: { color: "rgba(255,255,255,0.9)" },
  hyperliquidPeek: { color: '#97FCE4' },
});
