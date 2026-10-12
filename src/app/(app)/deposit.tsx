import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { RouteSheetFrame } from '@/components/route-sheet-frame';
import { DepositFlow } from '@/components/deposit-sheet';
import { useThemeStore } from '@/lib/theme-store';

/**
 * TRIAL — the deposit flow hosted in a native iOS form sheet
 * (`presentation: 'formSheet'` in `(app)/_layout.tsx`) instead of the gorhom
 * bottom sheet. UIKit owns the dimming, grabber, drag-to-dismiss and the
 * parent-stacking effect; we only render the content. Open with
 * `router.push('/deposit')`. Other callers still use `<DepositSheet>`.
 */
export default function DepositRoute() {
  const router = useRouter();
  const { colors } = useThemeStore();
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletAddress = solanaWallet.wallets?.[0]?.address ?? null;
  const dismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  return (
    <RouteSheetFrame>
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <DepositFlow walletAddress={walletAddress} dismiss={dismiss} host="native" />
      </View>
    </RouteSheetFrame>
  );
}

const styles = StyleSheet.create({
  // `fitToContents` already adds the home-indicator inset below the content;
  // a full 34pt on top of that left a dead band under every step.
  sheet: {
    // No grabber on this sheet: the header needs its own breathing room.
    paddingTop: 20,
    paddingBottom: 12,
  },
});
