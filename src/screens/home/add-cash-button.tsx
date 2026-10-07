import React from "react";

import { GlassActionButton } from "@/components/glass-action-button";
import { useThemeStore } from "@/lib/theme-store";

// Matches the width the same "+ Add cash" label is given on wallet-screen and
// auto-buy-screen (their action row, halved) — 124 was clipping the text.
const WIDTH = 156;
const HEIGHT = 44;

type Props = {
  onPress: () => void;
};

/**
 * The one action Home always offers.
 *
 * A compact primary action on the same themed ground as the rest of Home.
 */
export function AddCashButton({ onPress }: Props) {
  const { colors } = useThemeStore();

  return (
    <GlassActionButton
      variant="glassProminent"
      tint={colors.actionPrimary}
      label="+ Add cash"
      labelColor={colors.actionPrimaryText}
      labelWeight="heavy"
      labelDesign="rounded"
      width={WIDTH}
      height={HEIGHT}
      onPress={onPress}
    />
  );
}
