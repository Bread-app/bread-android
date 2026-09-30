import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Fonts } from "@/constants/theme";
import {
  FlipCard,
  GradientBalance,
  cardStyles,
} from "@/components/balance-card-shell";

const F = Fonts.rounded;

type CashCardProps = {
  /** Pre-formatted balance, e.g. "$1,234.56" / "—". Ignored while `loading`. */
  balanceLabel: string;
  /** The balance is still being read — shows a skeleton instead of a figure. */
  loading?: boolean;
  /** Solana address shown on the back, or null while unknown. */
  walletAddress: string | null;
  /** Opens the withdraw flow from the card back. */
  onWithdraw?: () => void;
  /**
   * Controlled flip state. Omit to let the card own it — the card stack passes
   * both of these so it can un-flip a card as it drops to the back.
   */
  flipped?: boolean;
  /** Overrides the default tap-to-flip. Used by the stack to bring a card forward. */
  onPress?: () => void;
};

/**
 * The cash "credit card". Front shows the spendable balance; tapping flips to
 * the back, which reveals the wallet address and a withdraw action.
 */
export function CashCard({
  balanceLabel,
  loading = false,
  walletAddress,
  onWithdraw,
  flipped,
  onPress,
}: CashCardProps) {
  const [selfFlipped, setSelfFlipped] = useState(false);
  const isFlipped = flipped ?? selfFlipped;

  const handlePress =
    onPress ??
    (() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSelfFlipped((value) => !value);
    });

  return (
    <FlipCard
      flipped={isFlipped}
      onPress={handlePress}
      frontColors={["#f5e4bd", "#ecd29a", "#e3c079"]}
      backColors={["#e3c079", "#ecd29a", "#f5e4bd"]}
      textured
      front={
        <>
          <Text style={[cardStyles.label, styles.cashLabel]}>CASH BALANCE</Text>
          <GradientBalance
            label={balanceLabel}
            loading={loading}
            skeletonColor="rgba(0,0,0,0.16)"
            colors={["rgba(88,88,88,0.9)", "rgba(0,0,0,0.9)"]}
            locations={[0.226, 1]}
          />
        </>
      }
      back={
        <>
          <View style={styles.cardBackStripe} />
          <View style={styles.cardBackContent}>
            <Text style={[cardStyles.backLabel, styles.cardBackLabel]}>
              WALLET ADDRESS
            </Text>
            {walletAddress ? (
              <>
                <Text
                  style={styles.cardBackAddress}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {walletAddress}
                </Text>
                {onWithdraw ? (
                  <View style={styles.cardBackBtnRow}>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        onWithdraw();
                      }}
                      style={styles.withdrawBtnOutline}
                    >
                      <Text style={styles.withdrawBtnOutlineText}>Withdraw</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
          <Text style={[cardStyles.backFooter, styles.cardBackFooter]}>
            Tap to flip back
          </Text>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  cashLabel: {
    color: "rgba(0,0,0,0.53)",
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
  },
});
