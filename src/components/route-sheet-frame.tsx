import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeStore } from '@/lib/theme-store';

/**
 * Stack options for a route that iOS presents as a native form sheet.
 *
 * Android does not use react-native-screens' form sheet for these: its native
 * BottomSheetBehavior claims drags inside the sheet (the slide-to-buy slider,
 * the allocation ruler) and lays the content out without the navigation-bar
 * inset, so the last row of a fit-to-contents sheet sat under the system bar.
 * Instead the route is a transparent modal and {@link RouteSheetFrame} draws
 * the sheet in React Native, where layout and gestures behave like any screen.
 */
export const ANDROID_ROUTE_SHEET_OPTIONS = {
  headerShown: false,
  presentation: 'transparentModal',
  animation: 'fade',
  contentStyle: { backgroundColor: 'transparent' },
} as const;

export const USES_ROUTE_SHEET_FRAME = Platform.OS === 'android';

const SHEET_TOP_GAP = 12;
/** iOS 26 floats its sheets: inset from the screen edges, every corner round. */
const SHEET_SIDE_INSET = 10;
const SHEET_BOTTOM_GAP = 10;
const SHEET_RADIUS = 36;
const SLIDE_IN = SlideInDown.duration(260).reduceMotion(ReduceMotion.System);
const BACKDROP_IN = FadeIn.duration(200).reduceMotion(ReduceMotion.System);

/**
 * The sheet chrome for a form-sheet route on Android: a dimmed backdrop that
 * dismisses on tap, and a card that floats above the navigation bar, inset
 * from the edges with every corner rounded — the iOS 26 sheet's shape.
 * On iOS the native sheet already provides all of this, so it renders the
 * children untouched.
 *
 * `fill` gives the card the full available height, matching iOS's large
 * detent (`sheetAllowedDetents: [1]`); otherwise the card fits its content.
 */
export function RouteSheetFrame({
  fill = false,
  children,
}: {
  fill?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colors } = useThemeStore();

  const dismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  if (!USES_ROUTE_SHEET_FRAME) return <>{children}</>;

  const bottom = insets.bottom + SHEET_BOTTOM_GAP;
  const maxHeight = height - insets.top - SHEET_TOP_GAP - bottom;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={BACKDROP_IN} style={[StyleSheet.absoluteFill, styles.backdrop]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
        />
      </Animated.View>
      <Animated.View
        entering={SLIDE_IN}
        style={[
          styles.card,
          {
            backgroundColor: colors.background,
            bottom,
            maxHeight,
          },
          fill && { height: maxHeight },
        ]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    position: 'absolute',
    left: SHEET_SIDE_INSET,
    right: SHEET_SIDE_INSET,
    borderRadius: SHEET_RADIUS,
    overflow: 'hidden',
    boxShadow: '0px 12px 40px rgba(0,0,0,0.22)',
  },
});
