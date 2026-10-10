import Ionicons from "@expo/vector-icons/Ionicons";
import { router as expoRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from "react-native-reanimated";

import { AddThesisButton } from "@/components/add-thesis-button";
import { AnimatedScrubText } from "@/components/animated-scrub-text";
import { ShareIcon } from "@/components/share-icon";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import type { Sandwich } from "@/lib/api";
import { takeComposerRoute } from "@/lib/position-takes";
import type { ViewedPosition } from "@/lib/sandwich-detail-store";
import { formatMoneyUsd } from "@/lib/sandwich-feed";
import { valueSandwichPosition } from "@/lib/sandwich-holding-value";
import type { SandwichPosition } from "@/lib/sandwich-positions";
import { useThemeStore } from "@/lib/theme-store";
import { useWalletStore } from "@/lib/wallet-store";

const F = Fonts.rounded;
const F_DISPLAY_MEDIUM = Fonts.displayMedium;

/*
 * A leaf module on purpose: the Sandwich detail screen, the podcast episode
 * screen and the position sheet all draw this card, and Metro's inline
 * requires turn an import from `sandwich-screen` into a runtime cycle.
 */

/**
 * How long ago the position was opened. The viewer cares about how long they
 * have held it, not which calendar day they bought on, so this stays relative
 * all the way out rather than falling back to a date the way the feed
 * timestamps do.
 */
function formatOpenedAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** `formatMoneyUsd` for the UI thread, where Intl isn't available. */
function workletMoney(value: number): string {
  "worklet";
  const fixed = Math.abs(value).toFixed(2);
  const [whole, cents] = fixed.split(".");
  let grouped = "";
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += ",";
    grouped += whole[i];
  }
  return `$${grouped}.${cents}`;
}

/**
 * Drives the card from a chart scrub. `ratio` is the basket's value under the
 * finger relative to now — (1 + r_t) / (1 + r_now), the same basis on both
 * sides, so it holds in any range window — and the card shows what this
 * position would have been worth at that moment. `active` is 1 mid-scrub.
 */
export type PositionCardScrub = {
  active: SharedValue<number>;
  ratio: SharedValue<number>;
};
/**
 * Portfolio summary shown only when the viewer owns this sandwich. It mirrors
 * the spot-asset position card: value and unrealized PnL lead, while cost and
 * return provide the basis underneath.
 *
 * The return is the SANDWICH's own — its legs' weighted move since it was
 * created, the same `pnlPct` the hero and the chart print — applied to what the
 * viewer put in. It is deliberately not derived from wallet balances: a leg's
 * wallet value covers every source of that mint, so a position holding one slice
 * of it read as if it owned the lot. One number, one source, and the card can
 * never disagree with the percentage above it.
 *
 * The cost is what makes it the viewer's: `invested × (1 + pnlPct)`. Note the
 * window is since the sandwich was CREATED, not since this buy, so a late entry
 * is credited with the move it missed.
 */
export function SandwichPositionCard({
  position,
  sandwich = null,
  onShare,
  onAddThesis,
  valuationOverride,
  scrub,
}: {
  position: SandwichPosition;
  /** Follow a chart scrub instead of only showing the live figures. */
  scrub?: PositionCardScrub | null;
  /** The sandwich behind the position — the source of the return shown. */
  sandwich?: Sandwich | null;
  /**
   * Figures for someone else's holding. The viewer's wallet says nothing about
   * another user's position, so these replace the wallet valuation outright.
   */
  valuationOverride?: ViewedPosition["valuation"] | null;
  onShare: () => void;
  /**
   * Wraps the push to the thesis composer. A host that sits in a drawer
   * passes its close, so the composer lands on a screen and not under a sheet.
   * Default is a plain push. `null` hides the button.
   */
  onAddThesis?: ((open: () => void) => void) | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const walletStore = useWalletStore();
  const valuation = valueSandwichPosition(
    position.legs,
    new Map(walletStore.tokens.filter((token) => token.mint).map((token) => [token.mint!, token])),
    walletStore.hasLoaded,
    position.legs.map((leg) => leg.mint),
  );
  const invested = valuationOverride
    ? valuationOverride.costUsd
    : valuation.costUsd || position.investedUsd;
  const returnPct = valuationOverride ? valuationOverride.returnPct : valuation.returnPct;
  const currentValue = valuationOverride ? valuationOverride.valueUsd : valuation.valueUsd;
  const pnl = valuationOverride
    ? valuationOverride.pnlUsd
    : invested === null || returnPct === null ? null : valuation.pnlUsd;
  const positive = (pnl ?? 0) >= 0;
  const accent = positive ? colors.positive : colors.negative;
  const openedLabel = formatOpenedAgo(position.createdAt);
  const valueText = formatMoneyUsd(currentValue) ?? "$0.00";
  const pnlText = pnl === null ? "—" : `${pnl >= 0 ? "+" : "−"}${formatMoneyUsd(Math.abs(pnl)) ?? "$0.00"}`;
  const returnText = returnPct === null ? "—" : `${Math.abs(returnPct).toFixed(2)}%`;
  // Mid-scrub figures, all on the UI thread. Without a value and a cost there
  // is nothing to scale, so the card keeps its live figures.
  const canScrub = !!scrub && currentValue !== null && invested !== null && invested > 0;
  const positiveColor = colors.positive;
  const negativeColor = colors.negative;
  const scrubbed = useDerivedValue(() => {
    if (!scrub || !canScrub || scrub.active.value === 0) return null;
    const value = (currentValue as number) * scrub.ratio.value;
    const delta = value - (invested as number);
    return { value, delta, pct: (delta / (invested as number)) * 100 };
  });
  const valueLabel = useDerivedValue(() => (scrubbed.value ? workletMoney(scrubbed.value.value) : valueText));
  const pnlLabel = useDerivedValue(() => {
    const live = scrubbed.value;
    if (!live) return pnlText;
    return `${live.delta >= 0 ? "+" : "−"}${workletMoney(live.delta)}`;
  });
  const returnLabel = useDerivedValue(() =>
    scrubbed.value ? `${Math.abs(scrubbed.value.pct).toFixed(2)}%` : returnText,
  );
  const accentLive = useDerivedValue(() => {
    const live = scrubbed.value;
    if (!live) return positive ? positiveColor : negativeColor;
    return live.delta >= 0 ? positiveColor : negativeColor;
  });
  const caretUpStyle = useAnimatedStyle(() => {
    const live = scrubbed.value;
    return { opacity: (live ? live.delta >= 0 : positive) ? 1 : 0 };
  });
  const caretDownStyle = useAnimatedStyle(() => {
    const live = scrubbed.value;
    return { opacity: (live ? live.delta >= 0 : positive) ? 0 : 1 };
  });
  const openThesisComposer = () => {
    const route = takeComposerRoute({
      positionKind: "sandwichId",
      positionId: position.sandwichId,
      name: position.name,
      pct: returnPct,
      valueUsd: currentValue,
      logoUrl: position.legs[0]?.imageUrl ?? null,
      openedAt: position.createdAt,
    });
    expoRouter.push({ pathname: route.pathname as never, params: route.params });
  };
  return (
    <View
      style={styles.detailPositionCard}
    >
      <View
        accessible
        accessibilityLabel={`${valuationOverride ? "This position" : "Your position"} is ${formatMoneyUsd(currentValue) ?? "$0.00"}, ${
          pnl === null
            ? "profit and loss unavailable"
            : `${pnl >= 0 ? "up" : "down"} ${formatMoneyUsd(Math.abs(pnl)) ?? "$0.00"}`
        }`}
        style={styles.detailPositionSummary}
      >
        <View style={styles.detailPositionHeadline}>
          <View style={styles.detailPositionValueGroup}>
            {canScrub ? (
              <AnimatedScrubText text={valueLabel} style={styles.detailPositionValue} />
            ) : (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={styles.detailPositionValue}
              >
                {valueText}
              </Text>
            )}
          </View>
          <View style={styles.detailPositionPnlGroup}>
            {canScrub ? (
              <>
                <AnimatedScrubText
                  text={pnlLabel}
                  color={accentLive}
                  style={[styles.detailPositionPnl, styles.detailPositionScrubText]}
                />
                <View style={styles.detailPositionReturnRow}>
                  {returnPct !== null ? (
                    <View style={styles.detailPositionCaret}>
                      <Animated.View style={[StyleSheet.absoluteFill, caretUpStyle]}>
                        <Ionicons name="caret-up" size={13} color={positiveColor} />
                      </Animated.View>
                      <Animated.View style={[StyleSheet.absoluteFill, caretDownStyle]}>
                        <Ionicons name="caret-down" size={13} color={negativeColor} />
                      </Animated.View>
                    </View>
                  ) : null}
                  <AnimatedScrubText
                    text={returnLabel}
                    color={accentLive}
                    style={[styles.detailPositionReturn, styles.detailPositionReturnScrub]}
                  />
                </View>
              </>
            ) : (
              <>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  style={[styles.detailPositionPnl, { color: accent }]}
                >
                  {pnlText}
                </Text>
                <View style={styles.detailPositionReturnRow}>
                  {returnPct !== null ? (
                    <Ionicons
                      name={positive ? "caret-up" : "caret-down"}
                      size={13}
                      color={accent}
                    />
                  ) : null}
                  <Text style={[styles.detailPositionReturn, { color: accent }]}>
                    {returnText}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>
        <View style={styles.detailPositionBasisRow}>
          <View style={styles.detailPositionBasisGroup}>
            <Text style={styles.detailPositionBasisLabel}>Invested</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              style={styles.detailPositionBasisValue}
            >
              {formatMoneyUsd(invested) ?? "—"}
            </Text>
          </View>
          <View
            style={[
              styles.detailPositionBasisGroup,
              styles.detailPositionBasisGroupRight,
            ]}
          >
            <Text style={styles.detailPositionBasisLabel}>Opened</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              style={styles.detailPositionBasisValue}
            >
              {openedLabel}
            </Text>
          </View>
        </View>
      </View>
      {/* One footer row on the grey shell: the holder's next move on the
          left, sharing what they already have on the right. Share stays
          centred when there is no thesis slot. */}
      <View style={[styles.detailPositionFooter, onAddThesis === null && styles.detailPositionFooterCentered]}>
        {onAddThesis === null ? null : (
          <AddThesisButton
            compact
            tone="muted"
            onPress={() => (onAddThesis ? onAddThesis(openThesisComposer) : openThesisComposer())}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share position"
          onPress={onShare}
          style={({ pressed }) => [
            styles.detailPositionShare,
            pressed && styles.detailPositionSharePressed,
          ]}
        >
          {/* Stroke thickened to match the label's weight; the outline glyph
              read as a step lighter than the word beside it. */}
          <ShareIcon size={18} strokeWidth={2} color={colors.textSecondary} />
          <Text style={styles.detailPositionShareText}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  detailPositionFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  detailPositionFooterCentered: { justifyContent: "center" },
  detailPositionCard: {
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 5,
    borderRadius: 16,
    backgroundColor: c.surfaceAlt,
    overflow: "hidden",
  },
  detailPositionSummary: {
    margin: 4,
    marginBottom: 0,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 9,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  detailPositionHeadline: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  detailPositionValueGroup: {
    flex: 1,
    minWidth: 0,
  },
  detailPositionValue: {
    color: c.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  detailPositionPnlGroup: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-end",
  },
  detailPositionPnl: {
    // Green up, pink down — the app's own two, same as the return row under it.
    // Overridden per-sign at the call site; this is only the down fallback.
    color: c.negative,
    fontSize: 19,
    lineHeight: 24,
    // Rubik Bold, like the return row under it: Rubik One read a weight
    // heavier than the $ value beside it.
    fontFamily: F_DISPLAY_MEDIUM,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  // The scrub labels are TextInputs that can't size to their text, so they
  // span their group and align inside it.
  detailPositionScrubText: { alignSelf: "stretch" },
  detailPositionReturnScrub: { minWidth: 56, textAlign: "right" },
  detailPositionCaret: { width: 13, height: 13 },
  detailPositionReturnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  detailPositionReturn: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: F_DISPLAY_MEDIUM,
    fontVariant: ["tabular-nums"],
  },
  detailPositionBasisRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  detailPositionBasisGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  detailPositionBasisGroupRight: {
    justifyContent: "flex-end",
  },
  // Everything on the card but the headline value steps down a weight: the
  // amount is the one figure the card exists to show.
  detailPositionBasisLabel: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: F,
  },
  detailPositionBasisValue: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  detailPositionShare: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  detailPositionSharePressed: {
    opacity: 0.55,
  },
  detailPositionShareText: {
    color: c.textSecondary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    fontFamily: F,
  },
  });
