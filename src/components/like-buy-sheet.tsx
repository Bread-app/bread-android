import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AssetLogo } from "@/components/asset-logo";
import { BlurBackdrop } from "@/components/blur-backdrop";
import { PressableScale } from "@/components/pressable-scale";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useCash } from "@/hooks/use-cash";
import { useSandwichBuy } from "@/hooks/use-sandwich-buy";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import {
  dismissPendingLikeBuy,
  getAutoBuyConfig,
  getPendingLikeBuys,
  getSandwichById,
  type PendingLikeBuy,
  type Sandwich,
} from "@/lib/api";
import { useThemeStore } from "@/lib/theme-store";
import { useToast } from "@/lib/toast-store";
import { useTradeFx } from "@/lib/trade-fx";
import { useWalletStore } from "@/lib/wallet-store";

const F = Fonts.rounded;

/** Breathing room after a buy so the sheet never talks over the celebration. */
const RESWEEP_AFTER_BUY_MS = 4_000;
/** After a skip there is nothing playing — the next pending can follow on. */
const RESWEEP_AFTER_SKIP_MS = 400;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** A pending like joined with everything the sheet needs to settle it. */
type ActiveLikeBuy = {
  pending: PendingLikeBuy;
  sandwich: Sandwich;
  /** The user's configured per-like spend, read at presentation time. */
  amountUsdc: number;
};

/**
 * The other half of "Ask me first": the one-tap buy sheet a like promises.
 *
 * Confirm-mode Like→Buy stores each like server-side as a pending buy
 * (`/api/auto-buy/pending`) and sends a push. The push tap merely opens the
 * app — this component is what actually surfaces the trade: it sweeps the
 * pending queue on launch and on every return to foreground, presents the
 * oldest one as a bottom sheet preloaded with the user's per-like amount, and
 * settles it with one tap through the shared `useSandwichBuy` engine (same
 * bundle, same guards, same bookkeeping as the sandwich detail pad).
 *
 * Mounted once in `(app)/_layout` inside the wallet/cash/toast providers. The
 * modal itself portals above those providers (see [[bottom-sheet-context-loss]]),
 * so every context-reading hook runs HERE and the sheet content only closes
 * over the values.
 *
 * Dismissal semantics: Buy and Skip consume the pending like (server DELETE);
 * a pan-down leaves it, so the like re-presents on the next foreground rather
 * than being silently thrown away.
 */
export function LikeBuySheet() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const tradeFx = useTradeFx();
  const cash = useCash({ autoRefresh: false });
  const walletStore = useWalletStore();

  const sheetRef = useRef<BottomSheetModal>(null);
  const [active, setActive] = useState<ActiveLikeBuy | null>(null);
  // The sweep and the buy engine's callbacks both need the CURRENT active
  // entry without re-subscribing listeners on every presentation.
  const activeRef = useRef<ActiveLikeBuy | null>(null);
  activeRef.current = active;
  /**
   * Likes settled this session (bought or skipped). The server DELETE is
   * fire-and-forget, so this stops a slow or failed delete from re-presenting
   * a like the user already answered.
   */
  const settledRef = useRef<Set<string>>(new Set());
  const sweepingRef = useRef(false);
  const resweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sweep = useCallback(async () => {
    if (sweepingRef.current || activeRef.current) return;
    sweepingRef.current = true;
    try {
      const pending = await getPendingLikeBuys();
      // Oldest actionable like first. Entries with no matched sandwich have
      // nothing to buy — leave them for the server to expire.
      const next = pending.find(
        (row) => row.sandwich !== null && !settledRef.current.has(row.likeEventId),
      );
      if (!next?.sandwich) return;

      const [config, sandwich] = await Promise.all([
        getAutoBuyConfig(),
        getSandwichById(next.sandwich.id),
      ]);
      // Auto mode buys server-side and a disabled feature should never prompt;
      // both can flip between the like landing and this sweep running.
      if (!sandwich || !config.enabled || config.mode !== "confirm") return;
      if (activeRef.current) return;
      setActive({ pending: next, sandwich, amountUsdc: config.amountUsdc });
    } catch {
      // Opportunistic: the next foreground retries, and a like that can't be
      // fetched right now is still waiting server-side.
    } finally {
      sweepingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void sweep();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sweep();
    });
    return () => {
      subscription.remove();
      if (resweepTimerRef.current) clearTimeout(resweepTimerRef.current);
    };
  }, [sweep]);

  useEffect(() => {
    if (active) sheetRef.current?.present();
  }, [active]);

  /** Consume the pending like: local first (the guard), then the server. */
  const settlePending = useCallback((likeEventId: string) => {
    settledRef.current.add(likeEventId);
    void dismissPendingLikeBuy(likeEventId).catch(() => {});
  }, []);

  const scheduleResweep = useCallback(
    (delayMs: number) => {
      if (resweepTimerRef.current) clearTimeout(resweepTimerRef.current);
      resweepTimerRef.current = setTimeout(() => void sweep(), delayMs);
    },
    [sweep],
  );

  // The buy engine calls onClose only once the trade has settled, so this IS
  // the success path.
  const handleBought = useCallback(() => {
    const current = activeRef.current;
    if (current) settlePending(current.pending.likeEventId);
    sheetRef.current?.dismiss();
    scheduleResweep(RESWEEP_AFTER_BUY_MS);
  }, [scheduleResweep, settlePending]);

  const buy = useSandwichBuy({
    sandwich: active?.sandwich ?? null,
    onClose: handleBought,
    onToast: useCallback(
      (next: { text: string; tone: "processing" | "success" | "error" }, duration?: number) => {
        toast.showToast(next.text, next.tone, duration);
      },
      [toast],
    ),
    onCelebrate: tradeFx.playSandwich,
    cash,
    walletStore,
  });

  // Preload the configured per-like amount. Runs after the engine's own
  // reset-on-sandwich-change effect (the hook is called above), so the preset
  // survives it. `buy.setAmount` is stable; keying on the sandwich id keeps
  // this from fighting the user if they ever get an editable amount here.
  const activeSandwichId = active?.sandwich.id ?? null;
  const activeAmountUsdc = active?.amountUsdc ?? null;
  useEffect(() => {
    if (activeSandwichId === null || activeAmountUsdc === null) return;
    buy.setAmount(String(activeAmountUsdc));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSandwichId, activeAmountUsdc, buy.setAmount]);

  const skip = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    void Haptics.selectionAsync();
    settlePending(current.pending.likeEventId);
    sheetRef.current?.dismiss();
    scheduleResweep(RESWEEP_AFTER_SKIP_MS);
  }, [scheduleResweep, settlePending]);

  const viewSandwich = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    void Haptics.selectionAsync();
    // The like stays pending: viewing is not answering, and the full pad the
    // user lands on doesn't know about the like event.
    sheetRef.current?.dismiss();
    router.push({ pathname: "/sandwich-detail", params: { id: current.sandwich.id } });
  }, [router]);

  const openLikedPost = useCallback(() => {
    const tweetId = activeRef.current?.pending.tweetId;
    if (!tweetId) return;
    void Linking.openURL(`https://x.com/i/web/status/${encodeURIComponent(tweetId)}`);
  }, []);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => <BlurBackdrop {...props} />,
    [],
  );

  if (!active) return null;

  const { sandwich, amountUsdc } = active;
  const legs = sandwich.legs;
  const shownFaces = legs.slice(0, 3);
  const insufficient =
    !cash.loading && cash.hasLoaded && amountUsdc > cash.totalCash;
  const message =
    buy.sheetMessage ??
    buy.tradeNotice ??
    (buy.availabilityPending ? "Checking whether this order can be filled…" : null) ??
    (insufficient ? "Not enough cash for this buy — add cash or skip." : null);
  const buyDisabled = !buy.canBuy || buy.buying;

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose={!buy.buying}
      backdropComponent={renderBackdrop}
      handleComponent={null}
      backgroundStyle={styles.sheetBg}
      onDismiss={() => {
        const current = activeRef.current;
        setActive(null);
        // A pan-down (neither bought nor skipped) keeps the like pending for
        // the next foreground rather than immediately re-presenting it.
        if (current && !settledRef.current.has(current.pending.likeEventId)) {
          if (resweepTimerRef.current) clearTimeout(resweepTimerRef.current);
        }
      }}
    >
      <BottomSheetView style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.handle} />

        {/* Why this sheet exists: the like that raised it. */}
        <PressableScale
          accessibilityRole="link"
          accessibilityLabel="Open the post you liked on X"
          onPress={openLikedPost}
          style={styles.eyebrowRow}
        >
          <Text style={styles.eyebrowMark}>𝕏</Text>
          <Text style={styles.eyebrow}>You liked a post</Text>
          <Ionicons name="open-outline" size={13} color={colors.textSecondary} />
        </PressableScale>

        <Text style={styles.title}>{sandwich.name}</Text>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`View ${sandwich.name}`}
          onPress={viewSandwich}
          style={styles.legsRow}
        >
          <View style={styles.faces}>
            {shownFaces.map((leg, index) => (
              <View
                key={leg.id}
                style={[styles.face, index > 0 && styles.faceOverlap]}
              >
                <AssetLogo
                  uri={leg.imageUrl}
                  size={28}
                  borderRadius={leg.type === "prediction_market" ? 8 : 14}
                  fallback={
                    <View style={styles.faceFallback}>
                      <Text style={styles.faceFallbackText}>
                        {(leg.symbol ?? leg.label).slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  }
                />
              </View>
            ))}
          </View>
          <Text style={styles.legsLabel}>
            {legs.length === 1
              ? (legs[0].symbol ?? legs[0].label)
              : `${legs.length} assets`}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
        </PressableScale>

        {/* The number the tap commits — the user's own per-like setting. */}
        <View style={styles.amountBlock}>
          <Text style={styles.amount}>{formatUsd(amountUsdc)}</Text>
          <Text style={styles.amountHint}>Your amount per like</Text>
        </View>

        {buy.detailRows.length > 0 ? (
          <View style={styles.details}>
            {buy.detailRows.map((row) => (
              <View key={row.label} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text
                  style={[
                    styles.detailValue,
                    row.tone === "warn" && { color: colors.negative },
                  ]}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Buy ${sandwich.name} for ${formatUsd(amountUsdc)}`}
          disabled={buyDisabled}
          onPressIn={buy.warmBuy}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            void buy.buySandwich();
          }}
          scaleTo={0.97}
          style={[
            styles.buyButton,
            { backgroundColor: colors.actionPrimary },
            buyDisabled && styles.buyButtonDisabled,
          ]}
        >
          {buy.buying ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.buyLabel}>
              {buy.belowMin && buy.minBuyDisplay !== null
                ? `Minimum $${buy.minBuyDisplay}`
                : buy.availabilityPending
                  ? "Checking…"
                : `Buy · ${formatUsd(amountUsdc)}`}
            </Text>
          )}
        </PressableScale>

        <View style={styles.footerRow}>
          <Text style={styles.balance}>
            {cash.hasLoaded ? `Cash balance: ${formatUsd(cash.totalCash)}` : " "}
          </Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Skip this buy"
            disabled={buy.buying}
            hitSlop={10}
            onPress={skip}
          >
            <Text style={styles.skipLabel}>Skip</Text>
          </PressableScale>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    sheetBg: {
      backgroundColor: c.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    sheet: { paddingHorizontal: 22, paddingTop: 10, gap: 12 },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 5,
      borderRadius: 999,
      backgroundColor: c.border,
    },

    eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    eyebrowMark: { fontSize: 13, fontWeight: "700", color: c.textSecondary },
    eyebrow: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: c.textSecondary,
    },

    title: { fontFamily: F, fontSize: 22, fontWeight: "900", color: c.text },

    legsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    faces: { flexDirection: "row", alignItems: "center" },
    face: { borderWidth: 2, borderColor: c.background, borderRadius: 16 },
    faceOverlap: { marginLeft: -8 },
    faceFallback: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    faceFallbackText: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: "800",
      color: c.textSecondary,
    },
    legsLabel: { fontFamily: F, fontSize: 14, fontWeight: "700", color: c.textSecondary },

    amountBlock: { alignItems: "center", paddingVertical: 6, gap: 2 },
    amount: { fontFamily: Fonts.displayMedium, fontSize: 40, fontWeight: "800", color: c.text },
    amountHint: { fontFamily: F, fontSize: 12, fontWeight: "600", color: c.textTertiary },

    details: { gap: 6 },
    detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    detailLabel: { fontFamily: F, fontSize: 13, fontWeight: "600", color: c.textSecondary },
    detailValue: { fontFamily: F, fontSize: 13, fontWeight: "700", color: c.text },

    message: {
      fontFamily: F,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: c.negative,
    },

    buyButton: {
      minHeight: 52,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    buyButtonDisabled: { opacity: 0.5 },
    buyLabel: { fontFamily: F, fontSize: 17, fontWeight: "800", color: "#FFFFFF" },

    footerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    balance: { fontFamily: F, fontSize: 12, fontWeight: "600", color: c.textTertiary },
    skipLabel: { fontFamily: F, fontSize: 14, fontWeight: "800", color: c.textSecondary },
  });
