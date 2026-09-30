import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/**
 * The drawer a YouTube call is traded in: blurred backdrop, a sheet flush to the
 * bottom edge, and a whole-surface drag to dismiss.
 *
 * Shared by the episode screen and the `podcast-call` route (Holdings' "Buy"
 * on a held YouTube position), so a call looks and behaves the same wherever it
 * is bought from. It rises on mount; `close` — handed to `children` and fired by
 * the backdrop and the drag — animates it away and only then calls `onClosed`,
 * which is where the owner unmounts it.
 *
 * Rendered inline, never portaled: the sheets inside it run the buy engine,
 * which needs the wallet/cash/toast providers a portal would strip.
 */
export function PodcastCallDrawer({
  tall = false,
  onClosed,
  children,
}: {
  /**
   * A perp needs the extra band: the risk panel — leverage ruler, size, debit
   * and the per-leg line — shares the slot above the keypad, and that slot does
   * not scroll. 0.9 is what the sandwich detail sheet gives the same panel; at
   * 0.86 the ruler was landing under the keypad.
   */
  tall?: boolean;
  onClosed: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const expand = useSharedValue(0);
  /** Live offset while the drawer follows a downward finger drag. */
  const dragY = useSharedValue(0);

  useEffect(() => {
    expand.value = withSpring(1, { damping: 26, stiffness: 280, mass: 1 });
  }, [expand]);

  const close = useCallback(() => {
    dragY.value = withSpring(0, { damping: 26, stiffness: 320, mass: 1 });
    expand.value = withSpring(0, { damping: 28, stiffness: 320, mass: 1 }, (finished) => {
      if (finished) runOnJS(onClosed)();
    });
  }, [dragY, expand, onClosed]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));
  // Rises from the bottom edge, the way the app's other buy drawers do.
  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0, 0.25, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(expand.value, [0, 1], [56, 0], Extrapolation.CLAMP) + dragY.value,
      },
    ],
  }));

  /**
   * The whole surface—not only the little handle—follows a deliberate vertical
   * drag. Horizontal movement fails immediately, leaving the nested leverage
   * scrubber in control.
   */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(12)
        .failOffsetX([-4, 4])
        .onUpdate((event) => {
          'worklet';
          dragY.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          'worklet';
          const projected = event.translationY + event.velocityY * 0.18;
          if (projected > 160) {
            runOnJS(close)();
          } else {
            dragY.value = withSpring(0, {
              velocity: event.velocityY,
              damping: 24,
              stiffness: 260,
              mass: 1,
            });
          }
        }),
    [close, dragY],
  );

  return (
    <>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <BlurView
          intensity={26}
          tint="dark"
          // Android needs an explicit blur method to render a real blur.
          experimentalBlurMethod="dimezisBlurView"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.scrim]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close call"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.card,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              // Tall enough for the pad, short enough to still read as a drawer
              // over what is behind it rather than a screen of its own.
              height: Math.min(windowHeight * (tall ? 0.9 : 0.76), windowHeight - insets.top - 10),
            },
            cardStyle,
          ]}
        >
          {children(close)}
        </Animated.View>
      </GestureDetector>
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, zIndex: 12 },
    // Sits on top of the blur, not instead of it: the blur alone lifts the
    // content's own brightness, and this is what actually pushes it back.
    scrim: { backgroundColor: 'rgba(0, 0, 0, 0.38)' },
    // Flush to the screen's edges and bottom, rounded only where it meets the
    // content above — the shape every other buy surface in the app takes.
    card: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 13,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      backgroundColor: c.background,
      shadowColor: c.text,
      shadowRadius: 28,
      shadowOpacity: 0.14,
      shadowOffset: { width: 0, height: 12 },
      elevation: 16,
    },
  });
}
