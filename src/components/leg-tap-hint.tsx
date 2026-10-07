import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { withAlpha } from '@/lib/color-utils';
import { useThemeStore } from '@/lib/theme-store';

const RING = 44;
const DOT = 22;
/** One tap: press, ripple out, rest. */
const PRESS_MS = 220;
const RIPPLE_MS = 700;
const REST_MS = 900;

/**
 * A looping "tap here" cue laid over an asset row: a touch dot presses down and
 * a ring ripples out from it. Purely visual — it ignores touches so the row
 * under it still takes the tap.
 *
 * With Reduce Motion on, the dot and ring hold still instead of looping.
 */
export function LegTapHint() {
  const { colors } = useThemeStore();
  const reducedMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      t.value = 0.35;
      return;
    }
    const total = PRESS_MS + RIPPLE_MS;
    t.value = withDelay(
      400,
      withRepeat(
        withSequence(
          withTiming(1, { duration: total, easing: Easing.out(Easing.quad) }),
          withDelay(REST_MS, withTiming(0, { duration: 0 })),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(t);
  }, [reducedMotion, t]);

  const pressPoint = PRESS_MS / (PRESS_MS + RIPPLE_MS);

  // The dot squeezes on the press, then eases back.
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(t.value, [0, pressPoint, 1], [1, 0.78, 1], 'clamp') }],
  }));

  // The ring starts at the press and grows out as it fades.
  const ringStyle = useAnimatedStyle(() => {
    const p = interpolate(t.value, [pressPoint, 1], [0, 1], 'clamp');
    return {
      opacity: t.value < pressPoint ? 0 : interpolate(p, [0, 1], [0.55, 0]),
      transform: [{ scale: interpolate(p, [0, 1], [0.4, 1.4]) }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      entering={FadeIn.duration(250)}
      exiting={FadeOut.duration(180)}
      style={styles.root}
    >
      <View style={styles.anchor}>
        <Animated.View style={[styles.ring, { borderColor: colors.accentBlue }, ringStyle]} />
        <Animated.View
          style={[styles.dot, { backgroundColor: withAlpha(colors.accentBlue, 0.35), borderColor: colors.accentBlue }, dotStyle]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchor: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
  },
});
