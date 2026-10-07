import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Fonts } from "@/constants/theme";
import {
  FlipCard,
  GradientBalance,
  cardStyles,
} from "@/components/balance-card-shell";
import { PressableScale } from '@/components/pressable-scale';
import { HyperliquidLogo } from '@/components/hyperliquid-logo';
import type { PerpsVenue } from '@/lib/perps-venue';

const F = Fonts.rounded;

const POSITIVE = "#02ED45";
const NEGATIVE = "#D2042D";

export type PerpCardSummary = {
  /** False until the venue's trading account exists. */
  registered: boolean;
  /** Collateral + unrealized PnL, i.e. what the perps account is worth. */
  portfolioValue: number;
  collateral: number;
  withdrawable: number;
  unrealizedPnl: number;
  positionCount: number;
  openOrderCount: number;
};

type PerpCardProps = {
  venue?: PerpsVenue;
  /** Null while loading or when the account view could not be read. */
  summary: PerpCardSummary | null;
  loading?: boolean;
  /** Controlled flip state. Omit to let the card own it. */
  flipped?: boolean;
  /** Overrides the default tap-to-flip. Used by the stack to bring a card forward. */
  onPress?: () => void;
  /** Move wallet USDC into the perps account. Shown on the back face. */
  onAddCash?: () => void;
  /** Move free collateral back to wallet USDC. Shown on the back face. */
  onWithdraw?: () => void;
  /** Create the Phoenix trader account. Replaces both controls until it exists. */
  onActivate?: () => void;
};

function usd(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signedUsd(value: number): string {
  return `${value > 0 ? "+" : ""}${usd(value)}`;
}

/**
 * The perps "credit card" — the dark sibling of the cash card. Front shows the
 * Phoenix portfolio value (collateral plus unrealized PnL), which is deliberately
 * *not* the same thing as spendable cash: it sits behind a withdraw queue and
 * part of it is locked as margin. The back breaks that number down.
 *
 * The money-movement controls live on the **back**, next to the numbers they act
 * on — same placement as the cash card's Withdraw. Collateral only ever moves on
 * an explicit tap; nothing here funds a position implicitly.
 */
export function PerpCard({
  venue = 'phoenix',
  summary,
  loading = false,
  flipped,
  onPress,
  onAddCash,
  onWithdraw,
  onActivate,
}: PerpCardProps) {
  const isHyperliquid = venue === 'hyperliquid';
  const accountName = isHyperliquid ? 'Hyperliquid' : 'Perps';
  const [selfFlipped, setSelfFlipped] = useState(false);
  const isFlipped = flipped ?? selfFlipped;

  const handlePress =
    onPress ??
    (() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSelfFlipped((value) => !value);
    });

  // Never show a real figure we don't have. While the account is still being
  // read the number is unknown, so the card shows a skeleton; a dash is kept
  // for the states where there genuinely is no figure (no account, or the read
  // failed), where it would otherwise read as "you lost everything".
  const balanceLoading = !summary && loading;
  const balanceLabel = !summary
    ? "—"
    : !summary.registered
      ? "—"
      : usd(summary.portfolioValue);

  const subtitle = !summary
    ? loading
      ? `Reading your ${accountName.toLowerCase()} account`
      : `${accountName} account unavailable`
    : !summary.registered
      ? `${accountName} not activated yet`
      : `${summary.positionCount} open ${summary.positionCount === 1 ? "position" : "positions"}`;

  const pnl = summary?.registered ? summary.unrealizedPnl : null;

  return (
    <FlipCard
      flipped={isFlipped}
      onPress={handlePress}
      frontColors={isHyperliquid ? ["#183F38", "#0C2622", "#061713"] : ["#33333A", "#17171B", "#08080A"]}
      backColors={isHyperliquid ? ["#061713", "#0C2622", "#183F38"] : ["#08080A", "#17171B", "#33333A"]}
      textured={!isHyperliquid}
      textureOpacity={0.16}
      front={
        <>
          <View style={styles.brandRow}>
            {isHyperliquid ? <HyperliquidLogo size={24} /> : null}
            <Text style={[cardStyles.label, styles.label, isHyperliquid && styles.hyperliquidLabel]}>
              {isHyperliquid ? 'HYPERLIQUID' : 'PERPS BALANCE'}
            </Text>
          </View>
          <GradientBalance
            label={balanceLabel}
            loading={balanceLoading}
            skeletonColor="rgba(255,255,255,0.18)"
            colors={isHyperliquid ? ["#C8FFF0", "#97FCE4"] : ["rgba(255,255,255,0.98)", "rgba(255,255,255,0.6)"]}
            locations={[0.226, 1]}
          />
          <View style={styles.subtitleRow}>
            {pnl !== null && pnl !== 0 ? (
              <Text
                style={[
                  styles.pnl,
                  { color: pnl > 0 ? POSITIVE : NEGATIVE },
                ]}
              >
                {signedUsd(pnl)}
              </Text>
            ) : null}
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </>
      }
      back={
        <>
          <View style={styles.backStripe} />
          <View style={styles.backContent}>
            <Text style={[cardStyles.backLabel, styles.backLabel, isHyperliquid && styles.hyperliquidLabel]}>
              {isHyperliquid ? 'HYPERLIQUID ACCOUNT' : 'PERPS ACCOUNT'}
            </Text>
            {summary?.registered ? (
              <>
                <BackRow label="Collateral" value={usd(summary.collateral)} />
                <BackRow label="Withdrawable" value={usd(summary.withdrawable)} />
                <BackRow
                  label="Unrealized PnL"
                  value={signedUsd(summary.unrealizedPnl)}
                  valueColor={
                    summary.unrealizedPnl === 0
                      ? undefined
                      : summary.unrealizedPnl > 0
                        ? POSITIVE
                        : NEGATIVE
                  }
                />
                <BackRow
                  label={isHyperliquid ? 'Open positions' : 'Positions / orders'}
                  value={isHyperliquid ? `${summary.positionCount}` : `${summary.positionCount} / ${summary.openOrderCount}`}
                />
                {onAddCash || onWithdraw ? (
                  <View style={styles.actionRow}>
                    {onAddCash ? (
                      <CardButton label="Add cash" onPress={onAddCash} />
                    ) : null}
                    {onWithdraw ? (
                      <CardButton
                        label="Withdraw"
                        onPress={onWithdraw}
                        // Margin behind an open position is not moveable, and the
                        // server refuses it — so the control says so up front
                        // rather than failing on submit.
                        disabled={summary.withdrawable <= 0}
                      />
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.backNote}>
                  {loading
                    ? `Checking your ${accountName.toLowerCase()} account…`
                    : !summary
                      ? 'Balance unavailable. Pull to refresh to try again.'
                      : `Activate ${accountName.toLowerCase()} to trade with leverage and go short.`}
                </Text>
                {!loading && summary && onActivate ? (
                  <View style={styles.actionRow}>
                    <CardButton label={`Activate ${accountName}`} onPress={onActivate} />
                  </View>
                ) : null}
              </>
            )}
          </View>
          <Text style={[cardStyles.backFooter, styles.backFooter]}>Tap to flip back</Text>
        </>
      }
    />
  );
}

/**
 * Taps here must not reach the card, or every button press would also flip it
 * back and hide the sheet behind the animation.
 */
function CardButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={(event) => {
        event.stopPropagation();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={[styles.cardButton, disabled && styles.cardButtonDisabled]}
    >
      <Text style={styles.cardButtonText}>{label}</Text>
    </PressableScale>
  );
}

function BackRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hyperliquidLabel: {
    color: '#97FCE4',
  },
  label: {
    color: "rgba(255,255,255,0.6)",
  },
  subtitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 2,
  },
  pnl: {
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  subtitle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: "600",
    fontFamily: F,
  },
  backStripe: {
    alignSelf: "stretch",
    height: 32,
    backgroundColor: "rgba(0,0,0,0.55)",
    marginHorizontal: -24,
    marginTop: -16,
  },
  backContent: {
    alignSelf: "stretch",
    flex: 1,
    justifyContent: "center",
    gap: 4,
  },
  backLabel: {
    color: "rgba(255,255,255,0.45)",
    marginBottom: 4,
  },
  backNote: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    fontFamily: F,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  cardButton: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  cardButtonDisabled: { opacity: 0.35 },
  cardButtonText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 12,
    fontWeight: "800",
    fontFamily: F,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "600",
    fontFamily: F,
  },
  rowValue: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  backFooter: {
    alignSelf: "stretch",
    color: "rgba(255,255,255,0.3)",
  },
});
