import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { useCash } from '@/hooks/use-cash';
import { useSandwichTradeSheet } from '@/lib/sandwich-trade-sheet-store';
import type { ToastState } from '@/lib/toast-state';
import { useToast } from '@/lib/toast-store';
import { useTradeFx, type SandwichFxEvent } from '@/lib/trade-fx';
import { useWalletStore } from '@/lib/wallet-store';
import { SandwichBuyPad, SandwichSellPad } from '@/screens/sandwich-screen';

/**
 * The Sandwich buy / sell pad as a native iOS form sheet
 * (`presentation: 'formSheet'` in `(app)/_layout.tsx`). UIKit owns dimming,
 * drag-to-dismiss and the parent-stacking effect; the sandwich and the
 * opener's callbacks come from {@link useSandwichTradeSheet}.
 *
 * Toasts go to the app-wide toast (a FullWindowOverlay, so it draws above this
 * sheet) rather than the detail screen's own banner, which sits underneath.
 * The receipt (`tradeFx`) draws in the root view, under this sheet — both
 * pads close themselves as the receipt lands, so it is revealed as the sheet
 * slides away.
 */
export default function SandwichTradeRoute() {
  const sheet = useSandwichTradeSheet();
  const { side, sandwich, position, initialAmount, handlers, close, markClosed } = sheet;
  const { height } = useWindowDimensions();
  // Spot needs only the amount, post and keypad. Perps also have risk controls.
  // On shorter phones, preserve room for the fixed keypad and confirm slider.
  const sheetHeight = Math.round(Math.min(
    height - 90,
    Math.max(600, height * (sandwich?.venue === 'perp' ? 0.88 : 0.78)),
  ));
  const cash = useCash();
  const walletStore = useWalletStore();
  const toast = useToast();
  const tradeFx = useTradeFx();

  useEffect(() => markClosed, [markClosed]);

  const onToast = useCallback(
    (next: ToastState, duration?: number) => {
      if (!next) return;
      toast.showToast(next.text, next.tone, duration);
    },
    [toast],
  );
  const onCelebrate = useCallback(
    (event: SandwichFxEvent) => handlers.current.onCelebrate?.(event) ?? tradeFx.playSandwich(event),
    [handlers, tradeFx],
  );
  const onPositionUpdated = useCallback<NonNullable<typeof handlers.current.onPositionUpdated>>(
    (next) => handlers.current.onPositionUpdated?.(next),
    [handlers],
  );
  const onRequestAddCash = useCallback(() => handlers.current.onRequestAddCash?.(), [handlers]);

  return (
    <View
      collapsable={false}
      style={[
        styles.sheet,
        { height: sheetHeight, paddingBottom: 12 },
      ]}
    >
      {side === 'sell' && position ? (
        <SandwichSellPad
          position={position}
          sandwich={sandwich}
          onClose={close}
          onToast={onToast}
          onCelebrate={onCelebrate}
          onPositionUpdated={onPositionUpdated}
        />
      ) : sandwich ? (
        <SandwichBuyPad
          sandwich={sandwich}
          onClose={close}
          onToast={onToast}
          onCelebrate={onCelebrate}
          cash={cash}
          walletStore={walletStore}
          onRequestAddCash={handlers.current.onRequestAddCash ? onRequestAddCash : undefined}
          onPositionUpdated={onPositionUpdated}
          initialAmount={initialAmount}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Keep a concrete bounded container so the pad's ScrollView stays inside
  // this layout rather than being hoisted to fill the native sheet. UIKit
  // adds the home-indicator inset with fitToContents; don't add it twice.
  // The sheet fill comes from contentStyle in the layout.
  sheet: {
    paddingTop: 20,
    paddingHorizontal: 16,
  },
});
