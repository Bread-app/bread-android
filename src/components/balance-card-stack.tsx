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
import { getPhoenixAccount, PhoenixApiError } from "@/lib/phoenix-api";

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
 * The wallet's two balance cards, stacked like cards in a hand: the active one
 * sits in front, the other peeks out above it. Tapping the peeking card brings
 * it forward; tapping the front card flips it, as before.
 *
 * Index 0 is cash, index 1 is perps. They are deliberately separate surfaces —
 * perps collateral is not spendable cash, and stacking them keeps that visible
 * without implying the two numbers add up.
 */
export const BalanceCardStack = React.forwardRef<
  BalanceCardStackRef,
  BalanceCardStackProps
>(function BalanceCardStack(
  { balanceLabel, walletAddress, onWithdraw, refreshKey = 0 },
  ref,
) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [flipped, setFlipped] = useState<[boolean, boolean]>([false, false]);
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

  // 0 → cash in front, 1 → perps in front. One value drives both cards so they
  // always swap in lockstep.
  const pos = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pos, {
      toValue: activeIndex,
      friction: 9,
      tension: 70,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, pos]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setPerpLoading(true);
      try {
        const data = await getPhoenixAccount();
        if (cancelled) return;
        const cross = data.account.cross;
        setPerp({
          registered: data.account.registered,
          portfolioValue: cross?.portfolioValue ?? 0,
          collateral: cross?.collateralBalance ?? 0,
          withdrawable: cross?.effectiveCollateralForWithdrawals ?? 0,
          unrealizedPnl: cross?.unrealizedPnl ?? 0,
          positionCount: cross?.positions.length ?? 0,
          openOrderCount: cross?.openOrderCount ?? 0,
        });
      } catch (error) {
        if (cancelled) return;
        // "No wallet yet" and "not signed in" are not failures — there is simply
        // no perps account, which the card already has copy for. Anything else
        // renders an em dash rather than a zero, so a transient Phoenix outage
        // never looks like a wiped account.
        const code = error instanceof PhoenixApiError ? error.code : null;
        setPerp(
          code === "no_wallet" || code === "Unauthorized"
            ? {
                registered: false,
                portfolioValue: 0,
                collateral: 0,
                withdrawable: 0,
                unrealizedPnl: 0,
                positionCount: 0,
                openOrderCount: 0,
              }
            : null,
        );
      } finally {
        if (!cancelled) setPerpLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, selfRefresh]);

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
    setActiveIndex(index);
    // A card that drops to the back always shows its front face again.
    setFlipped([false, false]);
  }, []);

  const flip = useCallback((index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFlipped((current) => {
      const next: [boolean, boolean] = [...current];
      next[index] = !next[index];
      return next;
    });
  }, []);

  // The front card sits PEEK lower at full size; the back one rides at the top
  // of the stack, slightly smaller.
  const layerStyle = (index: number) => {
    const front = index === 0 ? ([PEEK, 0] as const) : ([0, PEEK] as const);
    const size = index === 0 ? ([1, BACK_SCALE] as const) : ([BACK_SCALE, 1] as const);
    return {
      zIndex: activeIndex === index ? 2 : 1,
      elevation: activeIndex === index ? 12 : 6,
      transform: [
        {
          translateY: pos.interpolate({
            inputRange: [0, 1],
            outputRange: [front[0], front[1]],
          }),
        },
        {
          scale: pos.interpolate({
            inputRange: [0, 1],
            outputRange: [size[0], size[1]],
          }),
        },
      ],
    };
  };

  const handlePress = (index: number) => () => {
    if (activeIndex === index) flip(index);
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

  // Each strip is only visible while its card is the one peeking at the back:
  // cash peeks as pos → 1, perps peeks as pos → 0.
  const cashPeekOpacity = pos;
  const perpPeekOpacity = pos.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <View style={styles.stack}>
      {/* Sizes the stack: one card tall, plus room for the peeking card. */}
      <View style={styles.sizer} pointerEvents="none" />

      <Animated.View style={[styles.layer, layerStyle(0)]}>
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
          style={[styles.peekStrip, { opacity: cashPeekOpacity }]}
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

      <Animated.View style={[styles.layer, layerStyle(1)]}>
        <PerpCard
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
          style={[styles.peekStrip, { opacity: perpPeekOpacity }]}
        >
          <Text style={[styles.peekLabel, styles.peekTextLight]}>PERPS</Text>
          {perpPeekLoading ? (
            <ValueSkeleton
              width={78}
              height={13}
              color="rgba(255,255,255,0.20)"
              accessibilityLabel="Loading perps balance"
            />
          ) : (
            <Text style={[styles.peekValue, styles.peekTextLight]}>{perpPeekLabel}</Text>
          )}
        </Animated.View>
      </Animated.View>

      <PhoenixAccountSheet
        ref={accountSheetRef}
        onAccountChanged={applyAccountChange}
      />
    </View>
  );
});

const styles = StyleSheet.create({
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
});
