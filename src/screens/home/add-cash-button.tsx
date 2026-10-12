import React from "react";

import { GlassActionButton } from "@/components/glass-action-button";
import { HeaderPalette } from "./header-palette";

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
 * Filled white on the blue board. Clear glass tinted with the board's own
 * ground disappeared once the board itself became that colour, and the accent
 * fill it had before is now the board — so the only tone left with contrast in
 * both directions is white. The label has to be the board's blue rather than
 * white for the same reason.
 */
export function AddCashButton({ onPress }: Props) {
  return (
    <GlassActionButton
      variant="glassProminent"
      tint="#FFFFFF"
      label="+ Add cash"
      labelColor={HeaderPalette.background}
      labelWeight="heavy"
      labelDesign="rounded"
      width={WIDTH}
      height={HEIGHT}
      // What iOS 26 renders this glass as over the board (sampled on device).
      fallbackFill="#C8FFFF"
      onPress={onPress}
    />
  );
}
