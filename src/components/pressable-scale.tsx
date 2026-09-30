import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Press-in is a quick ease-out so feedback lands instantly; release is a spring
// so the card settles back with a touch of life. Both follow the system
// Reduce Motion setting (they become instant when it's on).
const PRESS_IN = { duration: 120, reduceMotion: ReduceMotion.System };
const RELEASE_SPRING = {
  damping: 18,
  stiffness: 280,
  reduceMotion: ReduceMotion.System,
};

type Props = Omit<PressableProps, 'style'> & {
  /** Scale while pressed. Defaults to 0.97 — subtle "push back". */
  scaleTo?: number;
  /** Static styles only (no `({ pressed }) => ...` function form). */
  style?: StyleProp<ViewStyle>;
  /**
   * A light selection tick on each tap, so every button answers the finger.
   * Off for surfaces that play their own feedback on the same touch (a slider
   * thumb, a key that fires a heavier impact).
   */
  haptic?: boolean;
};

/**
 * Drop-in Pressable that smoothly scales down while pressed instead of
 * snapping between discrete pressed styles. Interruptible (a fast tap-release
 * springs back from wherever the press-in got to) and respects the system
 * Reduce Motion setting. Use for cards, pills, and CTAs; keep plain Pressable
 * where a deliberate zero-overhead pressed style is wanted (see stock-card).
 */
export function PressableScale({
  scaleTo = 0.97,
  style,
  haptic = true,
  onPress,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: Props) {
  const scale = useSharedValue(1);

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      scale.value = withTiming(scaleTo, PRESS_IN);
      onPressIn?.(event);
    },
    [onPressIn, scale, scaleTo],
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      scale.value = withSpring(1, RELEASE_SPRING);
      onPressOut?.(event);
    },
    [onPressOut, scale],
  );

  // On the completed tap, not touch-down: a scroll that starts on a card also
  // fires press-in, and a tick there would buzz through every feed scroll.
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (haptic) void Haptics.selectionAsync();
      onPress?.(event);
    },
    [haptic, onPress],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      onPress={onPress ? handlePress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
