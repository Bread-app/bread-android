import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { PerpActionBarState } from '@/components/phoenix-market-detail-sheet';
import { SideGlassButton } from '@/components/side-glass-button';
import type { ThemeColors } from '@/constants/theme';
import { CTA } from '@/lib/screen-corners';

/**
 * The perp venue's LONG / SHORT action bar, drawn in the HOST layer rather than
 * inside the asset surface it belongs to.
 *
 * That indirection is not stylistic: hosts that morph or clip the detail
 * surface (the zoom screen, the sandwich leg card) cannot render native Liquid
 * Glass inside it — a GlassView in a transformed, clipped view paints no fill
 * at all on iOS 26, so the pill comes out as a white label on nothing. The
 * asset surface reports which of the three states it wants via
 * `onEmbeddedPerpActionStateChange`; this owns no state of its own.
 */
export function PerpLegActions({
  state,
  colors,
  onTrade,
  onActivate,
}: {
  state: PerpActionBarState | null;
  colors: ThemeColors;
  onTrade: (side: 'long' | 'short') => void;
  onActivate: () => void;
}) {
  if (!state) return null;

  if (state.kind === 'trade') {
    return (
      <View style={styles.row}>
        <SideGlassButton
          label="LONG"
          color={colors.actionBuy}
          onPress={() => onTrade('long')}
        />
        <SideGlassButton
          label="SHORT"
          color={colors.actionSell}
          onPress={() => onTrade('short')}
        />
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <SideGlassButton
        label={state.submitting ? 'ACTIVATING…' : 'ACTIVATE PERPS'}
        color={colors.actionPrimary}
        disabled={state.submitting}
        onPress={onActivate}
      />
    </View>
  );
}

// The row owns its distance from the screen edge, exactly as
// <StockTradeActions> does for the spot venue — the pills' corners are cut to
// sit concentric with the display's.
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: CTA.inset },
});
