import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { RouteSheetFrame } from '@/components/route-sheet-frame';
import { WithdrawFlow } from '@/components/withdraw-sheet';
import { useThemeStore } from '@/lib/theme-store';

/**
 * The withdraw flow as a native iOS form sheet (`presentation: 'formSheet'` in
 * `(app)/_layout.tsx`), same as `/deposit`. Open with `router.navigate('/withdraw')`.
 */
export default function WithdrawRoute() {
  const router = useRouter();
  const { colors } = useThemeStore();
  const dismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  return (
    <RouteSheetFrame fill>
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <WithdrawFlow dismiss={dismiss} />
      </View>
    </RouteSheetFrame>
  );
}

const styles = StyleSheet.create({
  // No grabber on this sheet: the header needs its own breathing room.
  sheet: {
    flex: 1,
    paddingTop: 20,
  },
});
